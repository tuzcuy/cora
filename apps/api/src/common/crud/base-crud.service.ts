import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantContext } from '../context/tenant-context.js';

type Plain = Record<string, unknown>;

/** Turkish labels for models that can block a delete. Falls back to the model name. */
const REF_LABELS: Record<string, string> = {
  Product: 'ürün',
  Category: 'alt kategori',
  BusinessPartner: 'cari',
  PartnerGroup: 'cari grubu',
  StockLevel: 'stok kaydı',
  StockMovement: 'stok hareketi',
  StockReceipt: 'stok fişi',
  StockReceiptLine: 'stok fişi satırı',
  SalesDocument: 'belge',
  SalesDocumentLine: 'belge satırı',
  Shipment: 'irsaliye',
  ShipmentLine: 'irsaliye satırı',
  WarehouseTask: 'depo görevi',
  PriceListItem: 'fiyat listesi kalemi',
  User: 'kullanıcı',
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Relations that do not follow the `<relation>Id` naming convention. None
 * today; add here if a schema change introduces one (the startup self-check in
 * security.spec.ts fails otherwise).
 */
const EXTRA_REFERENCES: Record<string, { model: string; fk: string }[]> = {};

const relationCache = new Map<string, { model: string; fk: string }[]>();

/**
 * Every model that holds a foreign key TO `target`, derived from the runtime
 * DMMF so a new FK is honoured without touching this file.
 *
 * Prisma 7's runtime DMMF strips `relationFromFields`; an object field only
 * carries name/kind/type/relationName, and both ends of a relation look alike
 * (Brand.products ↔ Product.brand). The FK side is identified by the schema's
 * own convention: the relation field `brand` is backed by a scalar `brandId`.
 * A model that has the object field but NO such scalar is the list side and
 * is skipped — Tenant.brands has no `brandsId`, Category.children has no
 * `childrenId`, while Category.parent → `parentId` is picked up.
 */
function referencingRelations(target: string): { model: string; fk: string }[] {
  const cached = relationCache.get(target);
  if (cached) return cached;
  const out: { model: string; fk: string }[] = [...(EXTRA_REFERENCES[target] ?? [])];
  for (const m of Prisma.dmmf.datamodel.models) {
    for (const f of m.fields) {
      if (f.kind !== 'object' || f.type !== target) continue;
      const fk = `${f.name}Id`;
      const hasScalar = m.fields.some((x) => x.name === fk && x.kind !== 'object');
      if (hasScalar && !out.some((r) => r.model === m.name && r.fk === fk)) {
        out.push({ model: m.name, fk });
      }
    }
  }
  relationCache.set(target, out);
  return out;
}

/** Exposed for the security self-check: which FKs guard a delete of `target`. */
export function referencesOf(target: string): { model: string; fk: string }[] {
  return referencingRelations(target);
}

/**
 * Shared write path for "card" entities (INVARIANTS.md rules 1, 6, 7; CORA_MIMARI §4.7-4.8):
 *
 *  - tenant scoping and soft-delete filtering come from the Prisma extension,
 *    so this class never touches tenantId itself;
 *  - every write runs in ONE transaction together with its AuditLog row;
 *  - updates and deletes are optimistic-locked on `version` → 409 on mismatch;
 *  - delete is a soft delete, refused while other rows still reference the record.
 *
 * Subclasses only declare the model, a Turkish label, and the DTO types.
 */
export abstract class BaseCrudService<TCreate extends Plain, TUpdate extends Plain> {
  protected abstract readonly model: string;
  protected abstract readonly label: string;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly audit: AuditService,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected delegateOf(client: any, model = this.model): any {
    return client[lowerFirst(model)];
  }

  /** Hook: shape the row before it is returned (e.g. Decimal → string). */
  protected present(row: Plain): Plain {
    return row;
  }

  /** Hook: turn a DTO into Prisma data (e.g. derive searchText). */
  protected toCreateData(dto: TCreate): Plain {
    return dto;
  }
  protected toUpdateData(dto: TUpdate, _before: Plain): Plain {
    const { version: _v, ...rest } = dto as Plain & { version?: number };
    return rest;
  }
  /** Hook: runs inside the write transaction after create/update (e.g. "only one default"). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async afterWrite(_tx: any, _row: Plain): Promise<void> {}
  /** Hook: runs inside the transaction before create/update (uniqueness that the DB cannot express). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async beforeWrite(_tx: any, _data: Plain, _id?: string): Promise<void> {}

  async getOrThrow(id: string): Promise<Plain> {
    const row = await this.delegateOf(this.prisma.db).findFirst({ where: { id } });
    if (!row) throw new NotFoundException(`${this.label} bulunamadı`);
    return this.present(row);
  }

  async create(dto: TCreate): Promise<Plain> {
    const created = await this.prisma.db.$transaction(async (tx) => {
      const data = this.toCreateData(dto);
      await this.beforeWrite(tx, data);
      const row = await this.delegateOf(tx).create({ data });
      await this.afterWrite(tx, row);
      await this.audit.record({ entity: this.model, entityId: row.id, action: 'create', after: row }, tx);
      return row;
    });
    return this.present(created);
  }

  /**
   * Optimistic lock: the client sends the `version` it loaded. If the row moved
   * on since, nothing is written and the caller gets 409 with the current
   * version so the UI can offer a reload (INVARIANTS.md rule 7).
   */
  async update(id: string, dto: TUpdate, expectedVersion: number): Promise<Plain> {
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const delegate = this.delegateOf(tx);
      const before = await delegate.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`${this.label} bulunamadı`);
      if (before.version !== expectedVersion) this.throwVersionConflict(before.version);

      const data = this.toUpdateData(dto, before);
      await this.beforeWrite(tx, data, id);
      const result = await delegate.updateMany({
        where: { id, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      // Lost the race between the read above and this write.
      if (result.count === 0) {
        const now = await delegate.findFirst({ where: { id } });
        this.throwVersionConflict(now?.version ?? expectedVersion + 1);
      }
      const after = await delegate.findFirst({ where: { id } });
      await this.afterWrite(tx, after);
      await this.audit.record({ entity: this.model, entityId: id, action: 'update', before, after }, tx);
      return after;
    });
    return this.present(updated);
  }

  /** Soft delete (INVARIANTS.md rule 6). Refused while any live row still points here. */
  async softDelete(id: string, expectedVersion?: number): Promise<{ id: string; deletedAt: Date }> {
    return this.prisma.db.$transaction(async (tx) => {
      const delegate = this.delegateOf(tx);
      const before = await delegate.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`${this.label} bulunamadı`);
      if (expectedVersion !== undefined && before.version !== expectedVersion) {
        this.throwVersionConflict(before.version);
      }
      await this.assertNotInUse(tx, id);

      const deletedAt = new Date();
      const result = await delegate.updateMany({
        where: { id, version: before.version },
        data: { deletedAt, version: { increment: 1 } },
      });
      if (result.count === 0) this.throwVersionConflict(before.version + 1);

      await this.audit.record(
        { entity: this.model, entityId: id, action: 'delete', before, after: { ...before, deletedAt } },
        tx,
      );
      return { id, deletedAt };
    });
  }

  /** Bring a soft-deleted row back. */
  async restore(id: string): Promise<Plain> {
    const restored = await TenantContext.withDeleted(() =>
      this.prisma.db.$transaction(async (tx) => {
        const delegate = this.delegateOf(tx);
        const before = await delegate.findFirst({ where: { id, deletedAt: { not: null } } });
        if (!before) throw new NotFoundException(`${this.label} bulunamadı`);
        await delegate.updateMany({
          where: { id },
          data: { deletedAt: null, version: { increment: 1 } },
        });
        const after = await delegate.findFirst({ where: { id, deletedAt: null } });
        await this.audit.record({ entity: this.model, entityId: id, action: 'restore', before, after }, tx);
        return after;
      }),
    );
    return this.present(restored);
  }

  /**
   * "Kullanımda olan kayıt silinemez": count live rows in every model that holds
   * a foreign key to this one. Soft-deleted referrers do not count — the tenant
   * extension already filters them out of the count.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async assertNotInUse(client: any, id: string): Promise<void> {
    const found: string[] = [];
    for (const ref of referencingRelations(this.model)) {
      const delegate = this.delegateOf(client, ref.model);
      if (!delegate?.count) continue;
      const n: number = await delegate.count({ where: { [ref.fk]: id } });
      if (n > 0) found.push(`${n} ${REF_LABELS[ref.model] ?? ref.model}`);
    }
    if (found.length > 0) {
      throw new ConflictException({
        error: 'InUse',
        message: `${this.label} kullanımda olduğu için silinemiyor: ${found.join(', ')}`,
        errors: { _: `Bağlı kayıtlar: ${found.join(', ')}` },
      });
    }
  }

  protected throwVersionConflict(currentVersion: number): never {
    throw new ConflictException({
      error: 'VersionConflict',
      message: 'Kayıt başkası tarafından değiştirildi. Sayfayı yenileyip tekrar deneyin.',
      currentVersion,
    });
  }
}
