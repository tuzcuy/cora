import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { SalesDocumentsService } from '../sales/sales-documents.service.js';
import type { PickDto, ScanDto } from '../shipments/dto/shipment.dto.js';

const qty3 = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(Number(v).toFixed(3));

/**
 * Picking (P05). The pick list is the order's own lines; progress is kept in
 * `SalesDocumentLine.pickedQty` so the shipment screen can offer exactly what
 * was picked. Status changes still go through the state machine
 * (SENT_TO_WAREHOUSE → PICKING → READY).
 */
@Injectable()
export class PickingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sales: SalesDocumentsService,
  ) {}

  /** Pick list for one order. */
  async task(orderId: string) {
    const order = await this.prisma.db.salesDocument.findFirst({
      where: { id: orderId, type: 'ORDER' },
      include: {
        partner: { select: { id: true, code: true, name: true, city: true } },
        warehouseTask: { include: { assignee: { select: { id: true, fullName: true } } } },
        lines: {
          orderBy: { lineNo: 'asc' },
          include: {
            product: { select: { id: true, code: true, name: true, barcode: true, unit: { select: { code: true } } } },
            warehouse: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');

    const lines = order.lines.map((l) => {
      const target = Number(l.qty) * Number(l.unitFactor);
      return {
        id: l.id,
        lineNo: l.lineNo,
        description: l.description,
        product: l.product,
        barcode: l.product?.barcode ?? null,
        unitCode: l.product?.unit?.code ?? null,
        warehouse: l.warehouse,
        targetQty: target.toFixed(3),
        pickedQty: l.pickedQty.toString(),
        shippedQty: l.shippedQty.toString(),
        done: Number(l.pickedQty) + 0.0005 >= target,
      };
    });
    return {
      order: { id: order.id, number: order.number, status: order.status, date: order.date, deliveryDate: order.deliveryDate },
      partner: order.partner,
      task: order.warehouseTask
        ? {
            id: order.warehouseTask.id,
            status: order.warehouseTask.status,
            startedAt: order.warehouseTask.startedAt,
            readyAt: order.warehouseTask.readyAt,
            assignee: order.warehouseTask.assignee?.fullName ?? null,
          }
        : null,
      lines,
      progress: {
        lines: lines.length,
        done: lines.filter((l) => l.done).length,
        allPicked: lines.length > 0 && lines.every((l) => l.done),
      },
    };
  }

  /** Start picking: moves the order SENT_TO_WAREHOUSE → PICKING. */
  async start(orderId: string) {
    const order = await this.prisma.db.salesDocument.findFirst({ where: { id: orderId }, select: { status: true } });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');
    if (order.status === 'PICKING') return this.task(orderId);
    await this.sales.transition(orderId, { toStatus: 'PICKING' });
    return this.task(orderId);
  }

  /** Set picked quantities for one or more lines. */
  async pick(orderId: string, dto: PickDto) {
    await this.prisma.db.$transaction(async (tx) => {
      const order = await tx.salesDocument.findFirst({ where: { id: orderId }, include: { lines: true } });
      if (!order) throw new NotFoundException('Sipariş bulunamadı');
      if (['COMPLETED', 'CANCELLED'].includes(order.status)) throw new ConflictException('Kapanmış siparişte toplama yapılamaz.');

      for (const l of dto.lines) {
        const line = order.lines.find((x) => x.id === l.lineId);
        if (!line) throw new BadRequestException({ errors: { lineId: 'Satır bu siparişte değil' } });
        const target = Number(line.qty) * Number(line.unitFactor);
        if (l.pickedQty > target + 0.0005) {
          throw new BadRequestException({ errors: { pickedQty: `${line.description}: sipariş miktarı ${target.toFixed(3)}, ${l.pickedQty} okutuldu` } });
        }
        await tx.salesDocumentLine.update({ where: { id: line.id }, data: { pickedQty: qty3(l.pickedQty) } });
      }
      await this.audit.record(
        { entity: 'SalesDocument', entityId: orderId, action: 'update', diff: { picked: { from: null, to: dto.lines.length } } },
        tx as never,
      );
    });
    return this.task(orderId);
  }

  /**
   * Barcode gun: the scanner types a code + Enter. Adds `qty` to the matching
   * line and answers with what was hit so the UI can beep or warn.
   */
  async scan(orderId: string, dto: ScanDto) {
    const order = await this.prisma.db.salesDocument.findFirst({
      where: { id: orderId },
      include: { lines: { include: { product: { select: { id: true, code: true, name: true, barcode: true } } } } },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');

    const code = dto.barcode.trim();
    const line = order.lines.find((l) => l.product?.barcode === code) ?? order.lines.find((l) => l.product?.code.toLowerCase() === code.toLowerCase());
    if (!line) {
      return { ok: false, reason: 'NOT_IN_ORDER', message: `${code}: bu siparişte böyle bir ürün yok`, task: await this.task(orderId) };
    }
    const target = Number(line.qty) * Number(line.unitFactor);
    const next = Number(line.pickedQty) + dto.qty;
    if (next > target + 0.0005) {
      return {
        ok: false,
        reason: 'OVER_PICK',
        message: `${line.product?.code}: sipariş ${target.toFixed(0)} adet, ${next.toFixed(0)} okutuldu`,
        task: await this.task(orderId),
      };
    }
    await this.prisma.db.salesDocumentLine.update({ where: { id: line.id }, data: { pickedQty: qty3(next) } });
    const task = await this.task(orderId);
    return {
      ok: true,
      lineId: line.id,
      product: line.product,
      pickedQty: next.toFixed(3),
      targetQty: target.toFixed(3),
      message: `${line.product?.code} ${next.toFixed(0)}/${target.toFixed(0)}`,
      task,
    };
  }

  /** Finish picking: PICKING → READY (state machine), task marked READY. */
  async ready(orderId: string) {
    const t = await this.task(orderId);
    if (!t.progress.allPicked) {
      const missing = t.lines.filter((l) => !l.done).map((l) => `${l.product?.code ?? ''} ${(Number(l.targetQty) - Number(l.pickedQty)).toFixed(0)} eksik`);
      throw new BadRequestException({ errors: { lines: `Toplama tamamlanmadı — ${missing.slice(0, 3).join(', ')}` } });
    }
    await this.sales.transition(orderId, { toStatus: 'READY' });
    return this.task(orderId);
  }
}
