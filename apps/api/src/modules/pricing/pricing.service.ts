import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { turkishFold } from '@cora/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';
import type {
  BulkPriceUpdateDto,
  CreatePriceListDto,
  PriceListItemsDto,
  PriceListQuery,
  TierInputDto,
  UpdatePriceListDto,
} from './dto/pricing.dto.js';

const money4 = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(Number(v).toFixed(4));
const qty3 = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(Number(v).toFixed(3));

/**
 * Price lists and quantity tiers (P07). These fill the two steps the P04 price
 * resolver left as stubs; the editor did not change, only the resolver's answer.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  /* ───────────────────────────── price lists ──────────────────────────── */

  async lists(q: PriceListQuery) {
    const where: Prisma.PriceListWhereInput = {};
    if (q.q?.trim()) where.name = { contains: q.q.trim(), mode: 'insensitive' };
    if (q.activeOnly) where.isActive = true;
    const [items, total] = await Promise.all([
      this.db.priceList.findMany({
        where,
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true, name: true, currency: true, isDefault: true, isActive: true,
          validFrom: true, validTo: true, note: true, version: true,
          _count: { select: { items: true, partners: true } },
        },
      }),
      this.db.priceList.count({ where }),
    ]);
    return {
      items: items.map((l) => ({
        id: l.id, name: l.name, currency: l.currency, isDefault: l.isDefault, isActive: l.isActive,
        validFrom: l.validFrom, validTo: l.validTo, note: l.note, version: l.version,
        itemCount: l._count.items, partnerCount: l._count.partners,
      })),
      total, page: q.page, pageSize: q.pageSize,
    };
  }

  async list(id: string, opts: { q?: string; page?: number; pageSize?: number } = {}) {
    const list = await this.db.priceList.findFirst({
      where: { id },
      select: {
        id: true, name: true, currency: true, isDefault: true, isActive: true,
        validFrom: true, validTo: true, note: true, version: true,
        partners: { select: { id: true, code: true, name: true }, take: 50 },
      },
    });
    if (!list) throw new NotFoundException('Fiyat listesi bulunamadı');

    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const where: Prisma.PriceListItemWhereInput = { priceListId: id };
    if (opts.q?.trim()) where.product = { searchText: { contains: turkishFold(opts.q.trim()) } };

    const [items, itemTotal] = await Promise.all([
      this.db.priceListItem.findMany({
        where,
        orderBy: { product: { code: 'asc' } },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, price: true, discountRate: true, updatedAt: true,
          product: { select: { id: true, code: true, name: true, salesPrice: true, currency: true } },
          tiers: { orderBy: { minQty: 'asc' }, select: { id: true, minQty: true, discountRate: true, price: true } },
        },
      }),
      this.db.priceListItem.count({ where }),
    ]);

    return {
      ...list,
      items: items.map((i) => ({
        id: i.id,
        price: i.price.toString(),
        discountRate: i.discountRate?.toString() ?? null,
        updatedAt: i.updatedAt,
        product: { ...i.product, salesPrice: i.product.salesPrice.toString() },
        tiers: i.tiers.map((t) => ({
          id: t.id, minQty: t.minQty.toString(),
          discountRate: t.discountRate?.toString() ?? null,
          price: t.price?.toString() ?? null,
        })),
      })),
      itemTotal, page, pageSize,
    };
  }

  async createList(dto: CreatePriceListDto) {
    const created = await this.prisma.db.$transaction(async (tx) => {
      if (dto.isDefault) await tx.priceList.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      const l = await tx.priceList.create({
        data: {
          name: dto.name, currency: dto.currency ?? 'TRY', isDefault: dto.isDefault ?? false,
          isActive: dto.isActive ?? true, validFrom: dto.validFrom ?? null, validTo: dto.validTo ?? null,
          note: dto.note ?? null,
        } as never,
      });
      await this.audit.record({ entity: 'PriceList', entityId: l.id, action: 'create', after: { name: dto.name } }, tx as never);
      return l;
    });
    return this.list(created.id);
  }

  async updateList(id: string, dto: UpdatePriceListDto) {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await tx.priceList.findFirst({ where: { id } });
      if (!before) throw new NotFoundException('Fiyat listesi bulunamadı');
      if (before.version !== dto.version) throw new ConflictException({ title: 'Kayıt değişti', currentVersion: before.version });
      if (dto.isDefault) await tx.priceList.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });

      const data: Prisma.PriceListUncheckedUpdateInput = { version: { increment: 1 } };
      for (const k of ['name', 'currency', 'isDefault', 'isActive', 'note'] as const) {
        if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k];
      }
      if (dto.validFrom !== undefined) data.validFrom = dto.validFrom;
      if (dto.validTo !== undefined) data.validTo = dto.validTo;
      const after = await tx.priceList.update({ where: { id }, data });
      await this.audit.record({ entity: 'PriceList', entityId: id, action: 'update', before: before as never, after: after as never }, tx as never);
    });
    return this.list(id);
  }

  async deleteList(id: string) {
    const inUse = await this.db.businessPartner.count({ where: { priceListId: id } });
    if (inUse > 0) throw new ConflictException(`Bu liste ${inUse} cariye bağlı; önce carilerden kaldırın.`);
    await this.db.priceList.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, version: { increment: 1 } } });
    await this.audit.record({ entity: 'PriceList', entityId: id, action: 'delete' });
    return { ok: true };
  }

  /** Replace or upsert the lines of a list. */
  async setItems(listId: string, dto: PriceListItemsDto) {
    await this.prisma.db.$transaction(async (tx) => {
      const list = await tx.priceList.findFirst({ where: { id: listId }, select: { id: true } });
      if (!list) throw new NotFoundException('Fiyat listesi bulunamadı');
      for (const it of dto.items) {
        await tx.priceListItem.upsert({
          where: { priceListId_productId: { priceListId: listId, productId: it.productId } },
          update: { price: money4(it.price), discountRate: it.discountRate != null ? money4(it.discountRate) : null },
          create: { priceListId: listId, productId: it.productId, price: money4(it.price), discountRate: it.discountRate != null ? money4(it.discountRate) : null },
        });
      }
      for (const productId of dto.removeProductIds ?? []) {
        await tx.priceListItem.deleteMany({ where: { priceListId: listId, productId } });
      }
      await this.audit.record(
        { entity: 'PriceList', entityId: listId, action: 'update', diff: { items: { from: null, to: dto.items.length }, removed: { from: null, to: (dto.removeProductIds ?? []).length } } },
        tx as never,
      );
    });
    return this.list(listId);
  }

  /* ────────────────────────────── tiers ───────────────────────────────── */

  async setTiers(dto: TierInputDto) {
    if (!dto.itemId && !dto.productId) {
      throw new BadRequestException({ errors: { productId: 'Kademe bir liste satırına ya da ürüne bağlanmalı' } });
    }
    await this.prisma.db.$transaction(async (tx) => {
      const where: Prisma.PriceTierWhereInput = dto.itemId ? { itemId: dto.itemId } : { productId: dto.productId, itemId: null };
      await tx.priceTier.deleteMany({ where });
      for (const t of dto.tiers) {
        await tx.priceTier.create({
          data: {
            itemId: dto.itemId ?? null,
            productId: dto.productId ?? null,
            priceListId: dto.priceListId ?? null,
            minQty: qty3(t.minQty),
            discountRate: t.discountRate != null ? money4(t.discountRate) : null,
            price: t.price != null ? money4(t.price) : null,
          } as never,
        });
      }
      await this.audit.record(
        { entity: 'PriceTier', entityId: dto.itemId ?? dto.productId ?? 'bulk', action: 'update', diff: { tiers: { from: null, to: dto.tiers.length } } },
        tx as never,
      );
    });
    return this.tiersFor({ itemId: dto.itemId, productId: dto.productId });
  }

  async tiersFor(ref: { itemId?: string; productId?: string }) {
    const where: Prisma.PriceTierWhereInput = ref.itemId ? { itemId: ref.itemId } : { productId: ref.productId, itemId: null };
    const tiers = await this.db.priceTier.findMany({ where, orderBy: { minQty: 'asc' } });
    return {
      items: tiers.map((t) => ({
        id: t.id, minQty: t.minQty.toString(),
        discountRate: t.discountRate?.toString() ?? null,
        price: t.price?.toString() ?? null,
      })),
    };
  }

  /* ─────────────────────── bulk price update ──────────────────────────── */

  /**
   * Filtered percentage change on product sales prices, with every change
   * written to ProductPriceHistory so "who raised this and when" is answerable.
   */
  async bulkUpdate(dto: BulkPriceUpdateDto) {
    const where: Prisma.ProductWhereInput = {};
    if (dto.q?.trim()) where.searchText = { contains: turkishFold(dto.q.trim()) };
    if (dto.brandId) where.brandId = dto.brandId;
    if (dto.categoryId) where.categoryId = dto.categoryId;
    if (dto.supplierId) where.supplierId = dto.supplierId;

    const products = await this.db.product.findMany({
      where,
      select: { id: true, code: true, name: true, salesPrice: true, purchasePrice: true },
      take: 20000,
    });

    const factor = 1 + dto.percent / 100;
    const round = (v: number) => {
      if (dto.roundTo === 'none') return Number(v.toFixed(4));
      const step = dto.roundTo === '0.05' ? 0.05 : dto.roundTo === '0.10' ? 0.1 : dto.roundTo === '1' ? 1 : 0.01;
      return Number((Math.round(v / step) * step).toFixed(2));
    };

    const preview = products.map((p) => {
      const base = Number(dto.target === 'purchase' ? p.purchasePrice : p.salesPrice);
      return { id: p.id, code: p.code, name: p.name, oldPrice: base, newPrice: round(base * factor) };
    });

    if (dto.dryRun) {
      return { count: preview.length, changed: preview.filter((p) => p.newPrice !== p.oldPrice).length, preview: preview.slice(0, 50) };
    }

    const userId = TenantContext.getUserId() ?? null;
    let changed = 0;
    for (const p of preview) {
      if (p.newPrice === p.oldPrice) continue;
      changed += 1;
      await this.prisma.db.$transaction(async (tx) => {
        await tx.product.update({
          where: { id: p.id },
          data: dto.target === 'purchase' ? { purchasePrice: money4(p.newPrice) } : { salesPrice: money4(p.newPrice) },
        });
        await tx.productPriceHistory.create({
          data: { productId: p.id, kind: dto.target === 'purchase' ? 'PURCHASE' : 'SALES', price: money4(p.newPrice), userId } as never,
        });
      });
    }
    await this.audit.record({
      entity: 'Product',
      entityId: 'bulk-price',
      action: 'update',
      diff: { percent: { from: null, to: dto.percent }, target: { from: null, to: dto.target }, changed: { from: null, to: changed } },
    });
    return { count: preview.length, changed, preview: preview.slice(0, 50) };
  }

  /** Price history of one product (both kinds), newest first. */
  async history(productId: string) {
    const rows = await this.db.productPriceHistory.findMany({
      where: { productId },
      orderBy: { validFrom: 'desc' },
      take: 100,
      select: { id: true, kind: true, price: true, currency: true, validFrom: true, userId: true },
    });
    const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
    const users = userIds.length ? await this.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [];
    const nameOf = new Map(users.map((u) => [u.id, u.fullName]));
    return {
      items: rows.map((r) => ({
        id: r.id, kind: r.kind, price: r.price.toString(), currency: r.currency,
        at: r.validFrom, userName: r.userId ? (nameOf.get(r.userId) ?? null) : null,
      })),
    };
  }
}
