import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { calculateDocument, type LineInput } from '@cora/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { DocumentNumberService } from '../../common/numbering/document-number.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';
import { SalesService } from '../sales/sales.service.js';
import type { CreateReturnDto } from './dto/shipment.dto.js';

const qty3 = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(Number(v).toFixed(3));
const money4 = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(Number(v).toFixed(4));

/**
 * Customer returns (P05). A return is a SalesDocument of type RETURN linked to
 * the original order through sourceDocumentId. Amounts are computed by the same
 * pricing engine and kept positive; the document type is what makes it a
 * credit, and its profit is the negative of the original sale's.
 *
 * Approving the return is a state-machine transition whose POST_STOCK_RETURN
 * effect puts the goods back through the ledger.
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbers: DocumentNumberService,
    private readonly reader: SalesService,
  ) {}

  /** Lines of a shipped order that may still be returned. */
  async returnable(orderId: string) {
    const order = await this.prisma.db.salesDocument.findFirst({
      where: { id: orderId, type: 'ORDER' },
      include: {
        partner: { select: { id: true, code: true, name: true } },
        lines: { orderBy: { lineNo: 'asc' }, include: { product: { select: { id: true, code: true, name: true } } } },
      },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');
    return {
      order: { id: order.id, number: order.number, status: order.status, date: order.date },
      partner: order.partner,
      lines: order.lines.map((l) => ({
        orderLineId: l.id,
        lineNo: l.lineNo,
        description: l.description,
        product: l.product,
        shippedQty: l.shippedQty.toString(),
        returnedQty: l.returnedQty.toString(),
        returnableQty: Math.max(Number(l.shippedQty) - Number(l.returnedQty), 0).toFixed(3),
        unitPrice: l.unitPrice.toString(),
      })),
    };
  }

  async create(dto: CreateReturnDto) {
    const id = await this.prisma.db.$transaction(
      async (tx) => {
        const order = await tx.salesDocument.findFirst({
          where: { id: dto.orderId, type: 'ORDER' },
          include: { lines: true },
        });
        if (!order) throw new NotFoundException('Sipariş bulunamadı');

        const byId = new Map(order.lines.map((l) => [l.id, l]));
        const lines = dto.lines.map((l, i) => {
          const ol = byId.get(l.orderLineId);
          if (!ol) throw new BadRequestException({ errors: { [`lines[${i}].orderLineId`]: 'Sipariş satırı bulunamadı' } });
          const returnable = Number(ol.shippedQty) - Number(ol.returnedQty);
          if (Number(l.qty) > returnable + 0.0005) {
            throw new BadRequestException({
              errors: { [`lines[${i}].qty`]: `${ol.description}: iade edilebilir ${returnable.toFixed(3)}, ${l.qty} istendi` },
            });
          }
          return { ol, qty: Number(l.qty), note: l.note ?? null, index: i };
        });

        const engineLines: LineInput[] = lines.map(({ ol, qty }) => ({
          qty,
          unitPrice: Number(ol.unitPrice),
          vatRate: Number(ol.vatRate),
          discountRate: Number(ol.discountRate) || undefined,
          unitCostLocal: Number(ol.unitCostLocal),
          exchangeRate: Number(order.exchangeRate),
        }));
        const totals = calculateDocument({ lines: engineLines, exchangeRate: Number(order.exchangeRate) });
        const { number } = await this.numbers.nextAvailable(tx as never, 'RETURN', async (n) => !!(await tx.salesDocument.findFirst({ where: { type: 'RETURN', number: n }, select: { id: true } })));

        const created = await tx.salesDocument.create({
          data: {
            type: 'RETURN',
            number,
            date: dto.date ?? new Date(),
            partnerId: order.partnerId,
            salesRepId: order.salesRepId,
            shippingAddressId: order.shippingAddressId,
            billingAddressId: order.billingAddressId,
            currency: order.currency,
            exchangeRate: order.exchangeRate,
            rateDate: order.rateDate,
            status: 'DRAFT',
            sourceDocumentId: order.id,
            notes: dto.reason,
            createdById: TenantContext.getUserId() ?? null,
            subtotal: money4(totals.subtotal.toString()),
            discountTotal: money4(totals.discountTotal.toString()),
            vatTotal: money4(totals.vatTotal.toString()),
            grandTotal: money4(totals.grandTotal.toString()),
            subtotalLocal: money4(totals.subtotalLocal.toString()),
            vatTotalLocal: money4(totals.vatTotalLocal.toString()),
            grandTotalLocal: money4(totals.grandTotalLocal.toString()),
            costTotalLocal: money4(totals.costTotalLocal.toString()),
            profitLocal: money4(totals.profitLocal.toString()),
            marginPct: new Prisma.Decimal(Number(totals.marginPct).toFixed(4)),
            lines: {
              create: lines.map(({ ol, qty, note, index }) => {
                const r = totals.lines[index]!;
                return {
                  lineNo: index + 1,
                  productId: ol.productId,
                  description: ol.description,
                  qty: qty3(qty),
                  unitId: ol.unitId,
                  unitFactor: ol.unitFactor,
                  unitPrice: ol.unitPrice,
                  discountRate: ol.discountRate,
                  discountAmount: ol.discountAmount,
                  vatRate: ol.vatRate,
                  lineNet: money4(r.lineNet.toString()),
                  lineVat: money4(r.lineVat.toString()),
                  lineTotal: money4(r.lineTotal.toString()),
                  unitCostLocal: ol.unitCostLocal,
                  lineProfitLocal: money4(r.lineProfitLocal.toString()),
                  warehouseId: ol.warehouseId,
                  isPriceOverridden: ol.isPriceOverridden,
                };
              }),
            },
          } as never,
        });
        await tx.documentStatusHistory.create({
          data: { documentId: created.id, fromStatus: null, toStatus: 'DRAFT', userId: TenantContext.getUserId() ?? null, note: dto.reason } as never,
        });
        await this.audit.record({ entity: 'SalesDocument', entityId: created.id, action: 'create', after: { type: 'RETURN', number, orderId: order.id, lines: lines.length } }, tx as never);
        return created.id;
      },
      { maxWait: 20_000, timeout: 60_000 },
    );
    return this.reader.detail(id, TenantContext.getStore()?.permissions?.includes('cost.view') ?? false);
  }
}
