import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService, type ExtendedPrismaClient } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { DocumentNumberService } from '../../common/numbering/document-number.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';
import { SalesDocumentsService } from '../sales/sales-documents.service.js';
import type {
  CancelShipmentDto,
  CreateShipmentDto,
  ShipmentQuery,
  UpdateShipmentDto,
} from './dto/shipment.dto.js';

type Tx = Omit<ExtendedPrismaClient, '$transaction' | '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>;
const qty3 = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(Number(v).toFixed(3));

const SHIPPABLE = new Set(['READY', 'PICKING', 'SENT_TO_WAREHOUSE', 'PARTIALLY_SHIPPED', 'APPROVED']);

/**
 * Delivery notes (irsaliye) — P05.
 *
 * A shipment is created from an order, may cover only part of it, and only
 * *posting* touches stock: SALE movements through the ledger, `shippedQty` on
 * the order lines, the reservation released for what left, and the order moved
 * to PARTIALLY_SHIPPED or SHIPPED through the shared state machine.
 *
 * UBL-TR fields live on the row from day one so the e-İrsaliye provider in P09
 * only has to read them.
 */
@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbers: DocumentNumberService,
    private readonly sales: SalesDocumentsService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  /* ─────────────────────────────── read ───────────────────────────────── */

  async list(q: ShipmentQuery) {
    const where: Prisma.ShipmentWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.orderId) where.orderId = q.orderId;
    if (q.warehouseId) where.warehouseId = q.warehouseId;
    if (q.dateFrom || q.dateTo) {
      where.date = {};
      if (q.dateFrom) where.date.gte = q.dateFrom;
      if (q.dateTo) where.date.lte = new Date(q.dateTo.getTime() + 86_399_999);
    }
    if (q.q?.trim()) {
      where.OR = [
        { number: { contains: q.q.trim(), mode: 'insensitive' } },
        { partner: { name: { contains: q.q.trim(), mode: 'insensitive' } } },
        { order: { number: { contains: q.q.trim(), mode: 'insensitive' } } },
        { vehiclePlate: { contains: q.q.trim(), mode: 'insensitive' } },
      ];
    }
    const [items, total, facets] = await Promise.all([
      this.db.shipment.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true, number: true, date: true, status: true, carrier: true, vehiclePlate: true, packageCount: true,
          partner: { select: { id: true, code: true, name: true, city: true } },
          order: { select: { id: true, number: true, status: true } },
          warehouse: { select: { id: true, code: true, name: true } },
          _count: { select: { lines: true } },
        },
      }),
      this.db.shipment.count({ where }),
      this.db.shipment.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    return {
      items: items.map((s) => ({
        id: s.id, number: s.number, date: s.date, status: s.status,
        carrier: s.carrier, vehiclePlate: s.vehiclePlate, packageCount: s.packageCount,
        partner: s.partner, order: s.order, warehouse: s.warehouse, lineCount: s._count.lines,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
      facets: { statuses: facets.map((f) => ({ status: f.status, count: f._count._all })) },
    };
  }

  async detail(id: string) {
    const s = await this.db.shipment.findFirst({
      where: { id },
      include: {
        partner: { select: { id: true, code: true, name: true, city: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        order: { select: { id: true, number: true, status: true, date: true } },
        postedBy: { select: { id: true, fullName: true } },
        lines: {
          orderBy: { lineNo: 'asc' },
          include: {
            product: { select: { id: true, code: true, name: true, unit: { select: { code: true } } } },
            orderLine: { select: { id: true, lineNo: true, qty: true, shippedQty: true, description: true } },
          },
        },
      },
    });
    if (!s) throw new NotFoundException('İrsaliye bulunamadı');
    return {
      id: s.id, number: s.number, date: s.date, status: s.status, version: s.version,
      carrier: s.carrier, carrierVkn: s.carrierVkn, carrierTitle: s.carrierTitle,
      vehiclePlate: s.vehiclePlate, trailerPlate: s.trailerPlate,
      driverName: s.driverName, driverTckn: s.driverTckn,
      packageCount: s.packageCount, packageTypeCode: s.packageTypeCode,
      grossWeightKg: s.grossWeightKg?.toString() ?? null,
      deliveryTermsCode: s.deliveryTermsCode,
      actualDespatchDate: s.actualDespatchDate,
      notes: s.notes, shippingAddress: s.shippingAddress,
      ublUuid: s.ublUuid, ublProfileId: s.ublProfileId, ublTypeCode: s.ublTypeCode,
      gibStatus: s.gibStatus, sentToGibAt: s.sentToGibAt,
      postedAt: s.postedAt, postedByName: s.postedBy?.fullName ?? null,
      partner: s.partner, warehouse: s.warehouse, order: s.order,
      lines: s.lines.map((l) => ({
        id: l.id, lineNo: l.lineNo, qty: l.qty.toString(), note: l.note,
        product: l.product, unitCode: l.product.unit?.code ?? null,
        orderLine: l.orderLine
          ? {
              id: l.orderLine.id, lineNo: l.orderLine.lineNo, description: l.orderLine.description,
              orderedQty: l.orderLine.qty.toString(), shippedQty: l.orderLine.shippedQty.toString(),
            }
          : null,
      })),
    };
  }

  /** What is still outstanding on an order — the create screen starts here. */
  async outstanding(orderId: string) {
    const order = await this.db.salesDocument.findFirst({
      where: { id: orderId, type: 'ORDER' },
      include: {
        partner: { select: { id: true, code: true, name: true, city: true } },
        shippingAddress: true,
        lines: {
          orderBy: { lineNo: 'asc' },
          include: { product: { select: { id: true, code: true, name: true, unit: { select: { code: true } } } } },
        },
      },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');
    return {
      order: { id: order.id, number: order.number, status: order.status, date: order.date },
      partner: order.partner,
      shippingAddress: order.shippingAddress,
      lines: order.lines.map((l) => {
        const base = Number(l.qty) * Number(l.unitFactor);
        const remaining = base - Number(l.shippedQty);
        return {
          orderLineId: l.id,
          lineNo: l.lineNo,
          description: l.description,
          product: l.product,
          unitCode: l.product?.unit?.code ?? null,
          orderedQty: base.toFixed(3),
          pickedQty: l.pickedQty.toString(),
          shippedQty: l.shippedQty.toString(),
          remainingQty: Math.max(remaining, 0).toFixed(3),
        };
      }),
    };
  }

  /* ────────────────────────────── write ───────────────────────────────── */

  async create(dto: CreateShipmentDto) {
    const id = await this.prisma.db.$transaction(
      async (tx) => {
        const order = await tx.salesDocument.findFirst({
          where: { id: dto.orderId, type: 'ORDER' },
          include: { lines: { orderBy: { lineNo: 'asc' } } },
        });
        if (!order) throw new NotFoundException('Sipariş bulunamadı');
        if (!SHIPPABLE.has(order.status)) {
          throw new ConflictException(`Bu durumdaki siparişten irsaliye kesilemez: ${order.status}`);
        }

        const byId = new Map(order.lines.map((l) => [l.id, l]));
        const requested =
          dto.lines?.length
            ? dto.lines
            : order.lines
                .map((l) => ({
                  orderLineId: l.id,
                  qty: Number(l.qty) * Number(l.unitFactor) - Number(l.shippedQty),
                  note: null as string | null,
                }))
                .filter((l) => l.qty > 0.0005);
        if (requested.length === 0) throw new BadRequestException({ errors: { lines: 'Sevk edilecek miktar kalmadı' } });

        const lines = requested.map((l, i) => {
          const ol = byId.get(l.orderLineId);
          if (!ol) throw new BadRequestException({ errors: { [`lines[${i}].orderLineId`]: 'Sipariş satırı bulunamadı' } });
          const remaining = Number(ol.qty) * Number(ol.unitFactor) - Number(ol.shippedQty);
          if (Number(l.qty) > remaining + 0.0005) {
            throw new BadRequestException({
              errors: { [`lines[${i}].qty`]: `${ol.description}: kalan ${remaining.toFixed(3)}, ${l.qty} istendi` },
            });
          }
          if (!ol.productId) throw new BadRequestException({ errors: { [`lines[${i}].orderLineId`]: 'Ürünsüz satır sevk edilemez' } });
          return {
            lineNo: i + 1,
            orderLineId: ol.id,
            productId: ol.productId,
            qty: qty3(l.qty),
            note: l.note ?? null,
          };
        });

        const warehouseId =
          dto.warehouseId ??
          order.lines.find((l) => l.warehouseId)?.warehouseId ??
          (await tx.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } }))?.id ??
          (await tx.warehouse.findFirst({ select: { id: true } }))?.id;
        if (!warehouseId) throw new BadRequestException({ errors: { warehouseId: 'Depo bulunamadı' } });

        const { number } = await this.numbers.nextAvailable(tx as never, 'SHIPMENT', async (n) => !!(await tx.shipment.findFirst({ where: { number: n }, select: { id: true } })));
        const address = order.shippingAddressId
          ? await tx.partnerAddress.findFirst({ where: { id: order.shippingAddressId } })
          : null;

        const created = await tx.shipment.create({
          data: {
            number,
            orderId: order.id,
            partnerId: order.partnerId,
            warehouseId,
            date: dto.date ?? new Date(),
            carrier: dto.carrier ?? null,
            carrierVkn: dto.carrierVkn ?? null,
            carrierTitle: dto.carrierTitle ?? dto.carrier ?? null,
            vehiclePlate: dto.vehiclePlate ?? null,
            trailerPlate: dto.trailerPlate ?? null,
            driverName: dto.driverName ?? null,
            driverTckn: dto.driverTckn ?? null,
            packageCount: dto.packageCount ?? 0,
            packageTypeCode: dto.packageTypeCode ?? null,
            grossWeightKg: dto.grossWeightKg != null ? qty3(dto.grossWeightKg) : null,
            deliveryTermsCode: dto.deliveryTermsCode ?? null,
            actualDespatchDate: dto.actualDespatchDate ?? dto.date ?? new Date(),
            issueTime: new Date(),
            ublUuid: randomUUID(),
            notes: dto.notes ?? null,
            shippingAddress: address
              ? ({ title: address.title, line1: address.line1, district: address.district, city: address.city, postalCode: address.postalCode, country: address.country } as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            createdById: TenantContext.getUserId() ?? null,
            lines: { create: lines },
          } as never,
        });
        await this.audit.record({ entity: 'Shipment', entityId: created.id, action: 'create', after: { number, orderId: order.id, lines: lines.length } }, tx as never);
        return created.id;
      },
      { maxWait: 20_000, timeout: 60_000 },
    );
    return this.detail(id);
  }

  async update(id: string, dto: UpdateShipmentDto) {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await tx.shipment.findFirst({ where: { id } });
      if (!before) throw new NotFoundException('İrsaliye bulunamadı');
      if (before.status !== 'DRAFT') throw new ConflictException('Yalnız taslak irsaliye düzenlenebilir.');
      if (before.version !== dto.version) throw new ConflictException({ title: 'Kayıt değişti', currentVersion: before.version });

      const data: Prisma.ShipmentUncheckedUpdateInput = { version: { increment: 1 } };
      if (dto.date) data.date = dto.date;
      for (const k of ['carrier', 'carrierVkn', 'carrierTitle', 'vehiclePlate', 'trailerPlate', 'driverName', 'driverTckn', 'packageTypeCode', 'deliveryTermsCode', 'notes'] as const) {
        if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k];
      }
      if (dto.packageCount !== undefined) data.packageCount = dto.packageCount;
      if (dto.grossWeightKg !== undefined) data.grossWeightKg = dto.grossWeightKg == null ? null : qty3(dto.grossWeightKg);
      if (dto.actualDespatchDate !== undefined) data.actualDespatchDate = dto.actualDespatchDate;

      if (dto.lines) {
        const order = await tx.salesDocument.findFirst({ where: { id: before.orderId }, include: { lines: true } });
        const byId = new Map((order?.lines ?? []).map((l) => [l.id, l]));
        await tx.shipmentLine.deleteMany({ where: { shipmentId: id } });
        const lines = dto.lines.map((l, i) => {
          const ol = byId.get(l.orderLineId);
          if (!ol?.productId) throw new BadRequestException({ errors: { [`lines[${i}].orderLineId`]: 'Sipariş satırı bulunamadı' } });
          return { shipmentId: id, lineNo: i + 1, orderLineId: ol.id, productId: ol.productId, qty: qty3(l.qty), note: l.note ?? null };
        });
        if (lines.length) await tx.shipmentLine.createMany({ data: lines });
      }
      const after = await tx.shipment.update({ where: { id }, data });
      await this.audit.record({ entity: 'Shipment', entityId: id, action: 'update', before: before as never, after: after as never }, tx as never);
    });
    return this.detail(id);
  }

  /**
   * Post: stock leaves through the ledger, shippedQty grows, the reservation
   * for the shipped amount is released, and the order status follows.
   */
  async post(id: string) {
    let orderId = '';
    let target: 'SHIPPED' | 'PARTIALLY_SHIPPED' = 'PARTIALLY_SHIPPED';

    await this.prisma.db.$transaction(
      async (tx) => {
        const s = await tx.shipment.findFirst({ where: { id }, include: { lines: true } });
        if (!s) throw new NotFoundException('İrsaliye bulunamadı');
        if (s.status !== 'DRAFT') throw new ConflictException('İrsaliye zaten işlenmiş veya iptal edilmiş.');
        if (s.lines.length === 0) throw new BadRequestException({ errors: { lines: 'En az bir satır gerekli' } });
        orderId = s.orderId;

        const order = await tx.salesDocument.findFirst({ where: { id: s.orderId }, include: { lines: true } });
        if (!order) throw new NotFoundException('Sipariş bulunamadı');

        for (const l of s.lines) {
          const ol = order.lines.find((x) => x.id === l.orderLineId);
          if (!ol) continue;
          const shipQty = Number(l.qty);

          await tx.stockMovement.create({
            data: {
              productId: l.productId,
              warehouseId: s.warehouseId,
              qty: qty3(shipQty).negated(),
              type: 'SALE',
              refType: 'SHIPMENT',
              refId: s.id,
              unitCost: ol.unitCostLocal,
              note: `${s.number} / ${order.number}`,
              userId: TenantContext.getUserId() ?? null,
            } as never,
          });
          await tx.stockLevel.upsert({
            where: { productId_warehouseId: { productId: l.productId, warehouseId: s.warehouseId } },
            update: {
              onHand: { decrement: qty3(shipQty) },
              // Free the part of the reservation that has now physically left.
              reserved: { decrement: qty3(Math.min(shipQty, Number(ol.reservedQty))) },
            },
            create: { productId: l.productId, warehouseId: s.warehouseId, onHand: qty3(shipQty).negated(), reserved: 0 },
          });
          await tx.salesDocumentLine.update({
            where: { id: ol.id },
            data: {
              shippedQty: { increment: qty3(shipQty) },
              reservedQty: { decrement: qty3(Math.min(shipQty, Number(ol.reservedQty))) },
            },
          });
        }

        const fresh = await tx.salesDocumentLine.findMany({ where: { documentId: order.id } });
        const allShipped = fresh.every((l) => Number(l.shippedQty) + 0.0005 >= Number(l.qty) * Number(l.unitFactor));
        target = allShipped ? 'SHIPPED' : 'PARTIALLY_SHIPPED';

        await tx.shipment.update({
          where: { id },
          data: { status: 'POSTED', postedAt: new Date(), postedById: TenantContext.getUserId() ?? null, version: { increment: 1 } },
        });
        await this.audit.record({ entity: 'Shipment', entityId: id, action: 'update', diff: { status: { from: 'DRAFT', to: 'POSTED' } } }, tx as never);
      },
      { maxWait: 20_000, timeout: 60_000 },
    );

    // Status moves through the shared state machine (never written directly).
    await this.sales.transition(orderId, { toStatus: target, note: 'İrsaliye işlendi' }, { skipStockPosting: true });
    return this.detail(id);
  }

  async cancel(id: string, dto: CancelShipmentDto) {
    await this.prisma.db.$transaction(async (tx) => {
      const s = await tx.shipment.findFirst({ where: { id } });
      if (!s) throw new NotFoundException('İrsaliye bulunamadı');
      if (s.status === 'CANCELLED') throw new ConflictException('İrsaliye zaten iptal edilmiş.');
      if (s.status === 'POSTED') {
        throw new ConflictException('İşlenmiş irsaliye iptal edilemez; iade belgesi oluşturun.');
      }
      await tx.shipment.update({ where: { id }, data: { status: 'CANCELLED', notes: dto.reason, version: { increment: 1 } } });
      await this.audit.record({ entity: 'Shipment', entityId: id, action: 'update', diff: { status: { from: s.status, to: 'CANCELLED' }, reason: { from: null, to: dto.reason } } }, tx as never);
    });
    return this.detail(id);
  }
}
