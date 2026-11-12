import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { turkishFold } from '@cora/shared';
import { PrismaService, type ExtendedPrismaClient } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { DocumentNumberService } from '../../common/numbering/document-number.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';
import type {
  AdjustDto,
  CountQuery,
  CreateCountDto,
  CreateReceiptDto,
  LevelQuery,
  MovementQuery,
  ReceiptQuery,
  TransferDto,
  UpdateCountDto,
  UpdateReceiptDto,
} from './dto/stock.dto.js';

type Tx = Omit<ExtendedPrismaClient, '$transaction' | '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>;

const qty3 = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(Number(v).toFixed(3));
const money4 = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(Number(v).toFixed(4));

/** Movement types that add to on-hand; everything else subtracts. */
const INBOUND = new Set(['RECEIPT', 'TRANSFER_IN', 'RETURN_IN']);

export const MOVEMENT_LABEL: Record<string, string> = {
  RECEIPT: 'Giriş',
  SALE: 'Satış',
  ADJUSTMENT: 'Düzeltme',
  TRANSFER_IN: 'Transfer giriş',
  TRANSFER_OUT: 'Transfer çıkış',
  COUNT: 'Sayım farkı',
  RETURN_IN: 'İade girişi',
};

/**
 * Stock write path (P05). INVARIANTS.md rule 8: on-hand changes ONLY as the
 * side-effect of a StockMovement row, written in the same transaction, so the
 * ledger and the StockLevel projection can never drift. Every entry point here
 * ends in `move()`.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbers: DocumentNumberService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  /* ─────────────────────────────── ledger ─────────────────────────────── */

  /** Append one ledger row and move the projection with it. */
  private async move(
    tx: Tx,
    input: {
      productId: string;
      warehouseId: string;
      /** Always positive; direction comes from `type`. */
      qty: number | string | Prisma.Decimal;
      type: 'RECEIPT' | 'SALE' | 'ADJUSTMENT' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'COUNT' | 'RETURN_IN';
      unitCost?: number | string | Prisma.Decimal | null;
      refType?: string;
      refId?: string;
      note?: string | null;
      /** COUNT and ADJUSTMENT carry a signed delta instead of a direction. */
      signedDelta?: number;
    },
  ) {
    const delta =
      input.signedDelta !== undefined
        ? qty3(input.signedDelta)
        : INBOUND.has(input.type)
          ? qty3(input.qty)
          : qty3(input.qty).negated();

    await tx.stockMovement.create({
      data: {
        productId: input.productId,
        warehouseId: input.warehouseId,
        qty: delta,
        type: input.type,
        unitCost: input.unitCost != null ? money4(input.unitCost) : null,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        note: input.note ?? null,
        userId: TenantContext.getUserId() ?? null,
      } as never,
    });

    await tx.stockLevel.upsert({
      where: { productId_warehouseId: { productId: input.productId, warehouseId: input.warehouseId } },
      update: { onHand: { increment: delta } },
      create: { productId: input.productId, warehouseId: input.warehouseId, onHand: delta, reserved: 0 },
    });
    return delta;
  }

  async movements(q: MovementQuery) {
    const where: Prisma.StockMovementWhereInput = {};
    if (q.productId) where.productId = q.productId;
    if (q.warehouseId) where.warehouseId = q.warehouseId;
    if (q.type) where.type = q.type;
    if (q.dateFrom || q.dateTo) {
      where.createdAt = {};
      if (q.dateFrom) where.createdAt.gte = q.dateFrom;
      if (q.dateTo) where.createdAt.lte = new Date(q.dateTo.getTime() + 86_399_999);
    }
    if (q.q?.trim()) {
      const folded = turkishFold(q.q.trim());
      where.product = { searchText: { contains: folded } };
    }
    const [items, total] = await Promise.all([
      this.db.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true, qty: true, type: true, unitCost: true, note: true, refType: true, refId: true, createdAt: true,
          product: { select: { id: true, code: true, name: true } },
          warehouse: { select: { id: true, code: true, name: true } },
          user: { select: { id: true, fullName: true } },
        },
      }),
      this.db.stockMovement.count({ where }),
    ]);
    return {
      items: items.map((m) => ({
        id: m.id,
        qty: m.qty.toString(),
        type: m.type,
        typeLabel: MOVEMENT_LABEL[m.type] ?? m.type,
        unitCost: m.unitCost?.toString() ?? null,
        note: m.note,
        refType: m.refType,
        refId: m.refId,
        at: m.createdAt,
        product: m.product,
        warehouse: m.warehouse,
        userName: m.user?.fullName ?? null,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async levels(q: LevelQuery) {
    const where: Prisma.StockLevelWhereInput = {};
    if (q.warehouseId) where.warehouseId = q.warehouseId;
    if (q.q?.trim()) where.product = { searchText: { contains: turkishFold(q.q.trim()) } };

    const [rows, total] = await Promise.all([
      this.db.stockLevel.findMany({
        where,
        orderBy: [{ product: { code: 'asc' } }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true, onHand: true, reserved: true,
          product: { select: { id: true, code: true, name: true, minStock: true, unit: { select: { code: true } } } },
          warehouse: { select: { id: true, code: true, name: true } },
        },
      }),
      this.db.stockLevel.count({ where }),
    ]);
    const items = rows
      .map((r) => ({
        id: r.id,
        onHand: r.onHand.toString(),
        reserved: r.reserved.toString(),
        available: r.onHand.minus(r.reserved).toString(),
        minStock: r.product.minStock.toString(),
        belowMin: r.onHand.minus(r.reserved).lessThanOrEqualTo(r.product.minStock),
        unitCode: r.product.unit?.code ?? null,
        product: { id: r.product.id, code: r.product.code, name: r.product.name },
        warehouse: r.warehouse,
      }))
      .filter((r) => (q.belowMin ? r.belowMin : true));
    return { items, total: q.belowMin ? items.length : total, page: q.page, pageSize: q.pageSize };
  }

  /* ─────────────────────── adjustment & transfer ───────────────────────── */

  /** Signed correction with a mandatory reason (P05). */
  async adjust(dto: AdjustDto) {
    return this.prisma.db.$transaction(async (tx) => {
      await this.assertProductAndWarehouse(tx as Tx, dto.productId, dto.warehouseId);
      const delta = await this.move(tx as Tx, {
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        qty: Math.abs(dto.qty),
        type: 'ADJUSTMENT',
        signedDelta: dto.qty,
        refType: 'ADJUSTMENT',
        note: dto.reason,
      });
      await this.audit.record(
        { entity: 'StockLevel', entityId: `${dto.productId}:${dto.warehouseId}`, action: 'update', diff: { qty: { from: 0, to: Number(delta) }, reason: { from: null, to: dto.reason } } },
        tx as never,
      );
      const level = await tx.stockLevel.findFirst({ where: { productId: dto.productId, warehouseId: dto.warehouseId } });
      return { ok: true, onHand: level?.onHand.toString() ?? '0', delta: delta.toString() };
    });
  }

  /** Warehouse-to-warehouse move: two ledger rows, one transaction. */
  async transfer(dto: TransferDto) {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException({ errors: { toWarehouseId: 'Kaynak ve hedef depo aynı olamaz' } });
    }
    return this.prisma.db.$transaction(async (tx) => {
      await this.assertProductAndWarehouse(tx as Tx, dto.productId, dto.fromWarehouseId);
      await this.assertProductAndWarehouse(tx as Tx, dto.productId, dto.toWarehouseId);

      const from = await tx.stockLevel.findFirst({ where: { productId: dto.productId, warehouseId: dto.fromWarehouseId } });
      const available = (from?.onHand ?? new Prisma.Decimal(0)).minus(from?.reserved ?? 0);
      if (available.lessThan(dto.qty)) {
        const product = await tx.product.findFirst({ where: { id: dto.productId }, select: { code: true, name: true } });
        throw new BadRequestException({
          errors: {
            qty: `${product?.code ?? ''} ${product?.name ?? ''}: kaynak depoda ${available.toString()} satılabilir, ${dto.qty} istendi`,
          },
        });
      }
      const ref = `TRF-${Date.now().toString(36)}`;
      await this.move(tx as Tx, { productId: dto.productId, warehouseId: dto.fromWarehouseId, qty: dto.qty, type: 'TRANSFER_OUT', refType: 'TRANSFER', refId: ref, note: dto.note ?? null });
      await this.move(tx as Tx, { productId: dto.productId, warehouseId: dto.toWarehouseId, qty: dto.qty, type: 'TRANSFER_IN', refType: 'TRANSFER', refId: ref, note: dto.note ?? null });
      await this.audit.record(
        { entity: 'StockTransfer', entityId: ref, action: 'create', after: { productId: dto.productId, from: dto.fromWarehouseId, to: dto.toWarehouseId, qty: dto.qty } },
        tx as never,
      );
      return { ok: true, ref, qty: qty3(dto.qty).toString() };
    });
  }

  private async assertProductAndWarehouse(tx: Tx, productId: string, warehouseId: string) {
    const [p, w] = await Promise.all([
      tx.product.findFirst({ where: { id: productId }, select: { id: true } }),
      tx.warehouse.findFirst({ where: { id: warehouseId }, select: { id: true } }),
    ]);
    if (!p) throw new NotFoundException({ errors: { productId: 'Ürün bulunamadı' } });
    if (!w) throw new NotFoundException({ errors: { warehouseId: 'Depo bulunamadı' } });
  }

  /* ────────────────────────── goods receipts ──────────────────────────── */

  async receipts(q: ReceiptQuery) {
    const where: Prisma.StockReceiptWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.warehouseId) where.warehouseId = q.warehouseId;
    if (q.q?.trim()) {
      where.OR = [
        { number: { contains: q.q.trim(), mode: 'insensitive' } },
        { reference: { contains: q.q.trim(), mode: 'insensitive' } },
        { supplier: { name: { contains: q.q.trim(), mode: 'insensitive' } } },
      ];
    }
    const [items, total] = await Promise.all([
      this.db.stockReceipt.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true, number: true, date: true, status: true, totalCost: true, currency: true, reference: true,
          warehouse: { select: { id: true, code: true, name: true } },
          supplier: { select: { id: true, code: true, name: true } },
          _count: { select: { lines: true } },
        },
      }),
      this.db.stockReceipt.count({ where }),
    ]);
    return {
      items: items.map((r) => ({
        id: r.id, number: r.number, date: r.date, status: r.status,
        totalCost: r.totalCost.toString(), currency: r.currency, reference: r.reference,
        warehouse: r.warehouse, supplier: r.supplier, lineCount: r._count.lines,
      })),
      total, page: q.page, pageSize: q.pageSize,
    };
  }

  async receipt(id: string) {
    const r = await this.db.stockReceipt.findFirst({
      where: { id },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        supplier: { select: { id: true, code: true, name: true } },
        postedBy: { select: { id: true, fullName: true } },
        lines: {
          orderBy: { lineNo: 'asc' },
          include: { product: { select: { id: true, code: true, name: true, unit: { select: { code: true } } } } },
        },
      },
    });
    if (!r) throw new NotFoundException('Giriş fişi bulunamadı');
    return {
      id: r.id, number: r.number, date: r.date, status: r.status, version: r.version,
      reference: r.reference, note: r.note, currency: r.currency, exchangeRate: r.exchangeRate.toString(),
      totalCost: r.totalCost.toString(), postedAt: r.postedAt,
      postedByName: r.postedBy?.fullName ?? null,
      warehouse: r.warehouse, supplier: r.supplier,
      lines: r.lines.map((l) => ({
        id: l.id, lineNo: l.lineNo, qty: l.qty.toString(), unitId: l.unitId,
        unitFactor: l.unitFactor.toString(), unitCost: l.unitCost.toString(),
        lineTotal: l.lineTotal.toString(), note: l.note,
        product: l.product, unitCode: l.product.unit?.code ?? null,
      })),
    };
  }

  async createReceipt(dto: CreateReceiptDto) {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const { number } = await this.numbers.nextAvailable(tx as never, 'STOCK_RECEIPT', async (n) => !!(await tx.stockReceipt.findFirst({ where: { number: n }, select: { id: true } })));
      const lines = (dto.lines ?? []).map((l, i) => ({
        lineNo: i + 1,
        productId: l.productId,
        qty: qty3(l.qty),
        unitId: l.unitId ?? null,
        unitFactor: qty3(l.unitFactor ?? 1),
        unitCost: money4(l.unitCost),
        lineTotal: money4(Number(l.qty) * Number(l.unitCost)),
        note: l.note ?? null,
      }));
      const created = await tx.stockReceipt.create({
        data: {
          number,
          warehouseId: dto.warehouseId,
          supplierId: dto.supplierId ?? null,
          date: dto.date ?? new Date(),
          reference: dto.reference ?? null,
          currency: dto.currency ?? 'TRY',
          exchangeRate: new Prisma.Decimal(dto.exchangeRate ?? 1),
          note: dto.note ?? null,
          totalCost: money4(lines.reduce((a, l) => a + Number(l.lineTotal), 0)),
          createdById: TenantContext.getUserId() ?? null,
          lines: { create: lines },
        } as never,
      });
      await this.audit.record({ entity: 'StockReceipt', entityId: created.id, action: 'create', after: { number, warehouseId: dto.warehouseId, lines: lines.length } }, tx as never);
      return created.id;
    });
    return this.receipt(id);
  }

  async updateReceipt(id: string, dto: UpdateReceiptDto) {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await tx.stockReceipt.findFirst({ where: { id }, include: { lines: true } });
      if (!before) throw new NotFoundException('Giriş fişi bulunamadı');
      if (before.status !== 'DRAFT') throw new ConflictException('Yalnız taslak giriş fişi düzenlenebilir.');
      if (before.version !== dto.version) {
        throw new ConflictException({ title: 'Kayıt değişti', currentVersion: before.version });
      }
      const data: Prisma.StockReceiptUncheckedUpdateInput = { version: { increment: 1 } };
      if (dto.warehouseId) data.warehouseId = dto.warehouseId;
      if (dto.supplierId !== undefined) data.supplierId = dto.supplierId;
      if (dto.date) data.date = dto.date;
      if (dto.reference !== undefined) data.reference = dto.reference;
      if (dto.note !== undefined) data.note = dto.note;
      if (dto.currency) data.currency = dto.currency;
      if (dto.exchangeRate) data.exchangeRate = new Prisma.Decimal(dto.exchangeRate);

      if (dto.lines) {
        await tx.stockReceiptLine.deleteMany({ where: { receiptId: id } });
        const lines = dto.lines.map((l, i) => ({
          receiptId: id,
          lineNo: i + 1,
          productId: l.productId,
          qty: qty3(l.qty),
          unitId: l.unitId ?? null,
          unitFactor: qty3(l.unitFactor ?? 1),
          unitCost: money4(l.unitCost),
          lineTotal: money4(Number(l.qty) * Number(l.unitCost)),
          note: l.note ?? null,
        }));
        if (lines.length) await tx.stockReceiptLine.createMany({ data: lines });
        data.totalCost = money4(lines.reduce((a, l) => a + Number(l.lineTotal), 0));
      }
      const after = await tx.stockReceipt.update({ where: { id }, data });
      await this.audit.record({ entity: 'StockReceipt', entityId: id, action: 'update', before: before as never, after: after as never }, tx as never);
    });
    return this.receipt(id);
  }

  async deleteReceipt(id: string, version?: number) {
    await this.prisma.db.$transaction(async (tx) => {
      const r = await tx.stockReceipt.findFirst({ where: { id } });
      if (!r) throw new NotFoundException('Giriş fişi bulunamadı');
      if (r.status !== 'DRAFT') throw new ConflictException('İşlenmiş fiş silinemez; ters düzeltme girin.');
      if (version !== undefined && r.version !== version) {
        throw new ConflictException({ title: 'Kayıt değişti', currentVersion: r.version });
      }
      await tx.stockReceipt.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      await this.audit.record({ entity: 'StockReceipt', entityId: id, action: 'delete', before: r as never }, tx as never);
    });
    return { ok: true };
  }

  /**
   * Post a receipt: RECEIPT movements, on-hand up, and the product's purchase
   * price re-averaged (weighted by the stock that was already on hand), with a
   * ProductPriceHistory row so the change is traceable.
   */
  async postReceipt(id: string) {
    await this.prisma.db.$transaction(
      async (tx) => {
        const r = await tx.stockReceipt.findFirst({ where: { id }, include: { lines: true } });
        if (!r) throw new NotFoundException('Giriş fişi bulunamadı');
        if (r.status !== 'DRAFT') throw new ConflictException('Fiş zaten işlenmiş veya iptal edilmiş.');
        if (r.lines.length === 0) throw new BadRequestException({ errors: { lines: 'En az bir satır gerekli' } });

        for (const l of r.lines) {
          const baseQty = Number(l.qty) * Number(l.unitFactor);
          const unitCostBase = Number(l.unitCost) / Number(l.unitFactor || 1);
          const localCost = unitCostBase * Number(r.exchangeRate);

          const levels = await tx.stockLevel.findMany({ where: { productId: l.productId } });
          const onHandAll = levels.reduce((a, s) => a + Number(s.onHand), 0);
          const product = await tx.product.findFirst({ where: { id: l.productId }, select: { purchasePrice: true } });
          const oldCost = Number(product?.purchasePrice ?? 0);
          const newCost =
            onHandAll + baseQty > 0 ? (Math.max(onHandAll, 0) * oldCost + baseQty * localCost) / (Math.max(onHandAll, 0) + baseQty) : localCost;

          await this.move(tx as Tx, {
            productId: l.productId,
            warehouseId: r.warehouseId,
            qty: baseQty,
            type: 'RECEIPT',
            unitCost: localCost,
            refType: 'STOCK_RECEIPT',
            refId: r.id,
            note: r.number,
          });

          if (Math.abs(newCost - oldCost) > 0.0001) {
            await tx.product.update({ where: { id: l.productId }, data: { purchasePrice: money4(newCost) } });
            await tx.productPriceHistory.create({
              data: { productId: l.productId, kind: 'PURCHASE', price: money4(newCost), currency: 'TRY', userId: TenantContext.getUserId() ?? null },
            });
          }
        }

        await tx.stockReceipt.update({
          where: { id },
          data: { status: 'POSTED', postedAt: new Date(), postedById: TenantContext.getUserId() ?? null, version: { increment: 1 } },
        });
        await this.audit.record({ entity: 'StockReceipt', entityId: id, action: 'update', diff: { status: { from: 'DRAFT', to: 'POSTED' } } }, tx as never);
      },
      { maxWait: 20_000, timeout: 60_000 },
    );
    return this.receipt(id);
  }

  /* ──────────────────────────── stock counts ──────────────────────────── */

  async counts(q: CountQuery) {
    const where: Prisma.StockCountWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.warehouseId) where.warehouseId = q.warehouseId;
    const [items, total] = await Promise.all([
      this.db.stockCount.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true, number: true, date: true, status: true,
          warehouse: { select: { id: true, code: true, name: true } },
          _count: { select: { lines: true } },
        },
      }),
      this.db.stockCount.count({ where }),
    ]);
    return {
      items: items.map((c) => ({ id: c.id, number: c.number, date: c.date, status: c.status, warehouse: c.warehouse, lineCount: c._count.lines })),
      total, page: q.page, pageSize: q.pageSize,
    };
  }

  async count(id: string) {
    const c = await this.db.stockCount.findFirst({
      where: { id },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        postedBy: { select: { id: true, fullName: true } },
        lines: { orderBy: { lineNo: 'asc' }, include: { product: { select: { id: true, code: true, name: true, unit: { select: { code: true } } } } } },
      },
    });
    if (!c) throw new NotFoundException('Sayım fişi bulunamadı');
    return {
      id: c.id, number: c.number, date: c.date, status: c.status, version: c.version, note: c.note,
      postedAt: c.postedAt, postedByName: c.postedBy?.fullName ?? null, warehouse: c.warehouse,
      lines: c.lines.map((l) => ({
        id: l.id, lineNo: l.lineNo, systemQty: l.systemQty.toString(), countedQty: l.countedQty.toString(),
        diff: l.countedQty.minus(l.systemQty).toString(), note: l.note,
        product: l.product, unitCode: l.product.unit?.code ?? null,
      })),
    };
  }

  /** Opens a sheet and freezes the system quantity of every counted product. */
  async createCount(dto: CreateCountDto) {
    const id = await this.prisma.db.$transaction(
      async (tx) => {
        const { number } = await this.numbers.nextAvailable(tx as never, 'STOCK_COUNT', async (n) => !!(await tx.stockCount.findFirst({ where: { number: n }, select: { id: true } })), { prefix: 'SAY' });
        const levels = await tx.stockLevel.findMany({
          where: {
            warehouseId: dto.warehouseId,
            ...(dto.productIds?.length ? { productId: { in: dto.productIds } } : {}),
          },
          select: { productId: true, onHand: true },
          orderBy: { product: { code: 'asc' } },
          take: 2000,
        });
        const created = await tx.stockCount.create({
          data: {
            number,
            warehouseId: dto.warehouseId,
            date: dto.date ?? new Date(),
            note: dto.note ?? null,
            createdById: TenantContext.getUserId() ?? null,
            lines: {
              create: levels.map((l, i) => ({
                lineNo: i + 1,
                productId: l.productId,
                systemQty: l.onHand,
                countedQty: l.onHand,
              })),
            },
          } as never,
        });
        await this.audit.record({ entity: 'StockCount', entityId: created.id, action: 'create', after: { number, warehouseId: dto.warehouseId, lines: levels.length } }, tx as never);
        return created.id;
      },
      { maxWait: 20_000, timeout: 60_000 },
    );
    return this.count(id);
  }

  async updateCount(id: string, dto: UpdateCountDto) {
    await this.prisma.db.$transaction(async (tx) => {
      const c = await tx.stockCount.findFirst({ where: { id } });
      if (!c) throw new NotFoundException('Sayım fişi bulunamadı');
      if (c.status !== 'DRAFT') throw new ConflictException('Yalnız taslak sayım düzenlenebilir.');
      if (c.version !== dto.version) throw new ConflictException({ title: 'Kayıt değişti', currentVersion: c.version });

      for (const l of dto.lines ?? []) {
        await tx.stockCountLine.updateMany({
          where: { countId: id, productId: l.productId },
          data: { countedQty: qty3(l.countedQty), note: l.note ?? null },
        });
      }
      await tx.stockCount.update({ where: { id }, data: { note: dto.note ?? c.note, version: { increment: 1 } } });
      await this.audit.record({ entity: 'StockCount', entityId: id, action: 'update', diff: { lines: { from: null, to: (dto.lines ?? []).length } } }, tx as never);
    });
    return this.count(id);
  }

  /** Posting writes a COUNT movement for each line whose count differs. */
  async postCount(id: string) {
    await this.prisma.db.$transaction(
      async (tx) => {
        const c = await tx.stockCount.findFirst({ where: { id }, include: { lines: true } });
        if (!c) throw new NotFoundException('Sayım fişi bulunamadı');
        if (c.status !== 'DRAFT') throw new ConflictException('Sayım zaten işlenmiş veya iptal edilmiş.');

        let diffs = 0;
        for (const l of c.lines) {
          const delta = Number(l.countedQty) - Number(l.systemQty);
          if (Math.abs(delta) < 0.0005) continue;
          diffs += 1;
          await this.move(tx as Tx, {
            productId: l.productId,
            warehouseId: c.warehouseId,
            qty: Math.abs(delta),
            type: 'COUNT',
            signedDelta: delta,
            refType: 'STOCK_COUNT',
            refId: c.id,
            note: `${c.number} sayım farkı`,
          });
        }
        await tx.stockCount.update({
          where: { id },
          data: { status: 'POSTED', postedAt: new Date(), postedById: TenantContext.getUserId() ?? null, version: { increment: 1 } },
        });
        await this.audit.record({ entity: 'StockCount', entityId: id, action: 'update', diff: { status: { from: 'DRAFT', to: 'POSTED' }, differences: { from: null, to: diffs } } }, tx as never);
      },
      { maxWait: 20_000, timeout: 60_000 },
    );
    return this.count(id);
  }
}
