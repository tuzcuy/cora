import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';
import type { DocumentListQuery } from './dto/sales.dto.js';

const listSelect = {
  id: true,
  type: true,
  number: true,
  status: true,
  date: true,
  validUntil: true,
  deliveryDate: true,
  currency: true,
  exchangeRate: true,
  subtotalLocal: true,
  vatTotalLocal: true,
  grandTotal: true,
  grandTotalLocal: true,
  costTotalLocal: true,
  profitLocal: true,
  marginPct: true,
  partner: { select: { id: true, code: true, name: true, city: true } },
  salesRep: { select: { id: true, fullName: true, repCode: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.SalesDocumentSelect;

type DocRow = Prisma.SalesDocumentGetPayload<{ select: typeof listSelect }>;

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(q: DocumentListQuery, skip?: 'status'): Prisma.SalesDocumentWhereInput {
    const where: Prisma.SalesDocumentWhereInput = {};
    if (q.type) where.type = q.type;
    if (q.status && skip !== 'status') where.status = q.status;
    if (q.partnerId) where.partnerId = q.partnerId;
    if (q.salesRepId) where.salesRepId = q.salesRepId;
    // Document numbers are short and exact-ish; partner name search goes through
    // the partner's own GIN-indexed searchText rather than an ILIKE on this table.
    if (q.q && q.q.trim().length >= 2) {
      const term = q.q.trim();
      where.OR = [
        { number: { contains: term, mode: 'insensitive' } },
        { partner: { searchText: { contains: term.toLocaleLowerCase('tr') } } },
      ];
    }
    if (q.dateFrom || q.dateTo) {
      where.date = {
        ...(q.dateFrom ? { gte: new Date(q.dateFrom) } : {}),
        ...(q.dateTo ? { lte: new Date(`${q.dateTo}T23:59:59.999Z`) } : {}),
      };
    }
    return where;
  }

  private orderBy(sort: DocumentListQuery['sort']): Prisma.SalesDocumentOrderByWithRelationInput {
    switch (sort) {
      case 'date_asc':
        return { date: 'asc' };
      case 'total_desc':
        return { grandTotalLocal: 'desc' };
      case 'number':
        return { number: 'desc' };
      default:
        return { date: 'desc' };
    }
  }

  private toItem(d: DocRow, canViewCost: boolean) {
    const item: Record<string, unknown> = {
      id: d.id,
      type: d.type,
      number: d.number,
      status: d.status,
      date: d.date,
      validUntil: d.validUntil,
      deliveryDate: d.deliveryDate,
      currency: d.currency,
      exchangeRate: d.exchangeRate.toString(),
      lineCount: d._count.lines,
      subtotalLocal: d.subtotalLocal.toString(),
      vatTotalLocal: d.vatTotalLocal.toString(),
      grandTotal: d.grandTotal.toString(),
      grandTotalLocal: d.grandTotalLocal.toString(),
      partner: d.partner
        ? { id: d.partner.id, code: d.partner.code, name: d.partner.name, city: d.partner.city }
        : null,
      salesRep: d.salesRep ? { id: d.salesRep.id, name: d.salesRep.fullName } : null,
    };
    // INVARIANTS.md rule 5: cost/profit leave the payload entirely without cost.view.
    if (canViewCost) {
      item.costTotalLocal = d.costTotalLocal.toString();
      item.profitLocal = d.profitLocal.toString();
      item.marginPct = d.marginPct.toString();
    }
    return item;
  }

  async list(query: DocumentListQuery, canViewCost: boolean) {
    const where = this.buildWhere(query);
    const [rows, total, statusGroups, agg] = await Promise.all([
      this.prisma.db.salesDocument.findMany({
        where,
        select: listSelect,
        orderBy: this.orderBy(query.sort),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.db.salesDocument.count({ where }),
      this.prisma.db.salesDocument.groupBy({
        by: ['status'],
        where: this.buildWhere(query, 'status'),
        _count: { _all: true },
      }),
      this.prisma.db.salesDocument.aggregate({
        where,
        _sum: { subtotalLocal: true, grandTotalLocal: true },
      }),
    ]);

    return {
      items: rows.map((r) => this.toItem(r, canViewCost)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totals: {
        netLocal: (agg._sum.subtotalLocal ?? new Prisma.Decimal(0)).toString(),
        grossLocal: (agg._sum.grandTotalLocal ?? new Prisma.Decimal(0)).toString(),
      },
      facets: {
        statuses: statusGroups
          .map((g) => ({ status: g.status, count: g._count._all }))
          .sort((a, b) => b.count - a.count),
      },
    };
  }

  async detail(id: string, canViewCost: boolean) {
    const tenantId = TenantContext.requireTenantId();
    const d = await this.prisma.db.salesDocument.findFirst({
      where: { id, tenantId },
      select: {
        ...listSelect,
        discountTotal: true,
        vatTotal: true,
        subtotal: true,
        rateDate: true,
        notes: true,
        internalNotes: true,
        paymentTerms: true,
        version: true,
        sourceDocumentId: true,
        revision: true,
        revisedFromId: true,
        billingAddressId: true,
        shippingAddressId: true,
        contactId: true,
        reference: true,
        tags: true,
        cancelReason: true,
        priceIncludesVat: true,
        approvedAt: true,
        sentAt: true,
        createdAt: true,
        sourceDocument: { select: { id: true, type: true, number: true, status: true, revision: true } },
        derivedDocuments: { select: { id: true, type: true, number: true, status: true, revision: true, date: true }, orderBy: { date: 'asc' } },
        revisedFrom: { select: { id: true, number: true, revision: true, status: true } },
        revisions: { select: { id: true, number: true, revision: true, status: true, date: true }, orderBy: { revision: 'asc' } },
        lines: {
          orderBy: { lineNo: 'asc' },
          select: {
            id: true,
            lineNo: true,
            description: true,
            qty: true,
            unitPrice: true,
            discountRate: true,
            vatRate: true,
            lineNet: true,
            lineVat: true,
            lineTotal: true,
            unitCostLocal: true,
            lineProfitLocal: true,
            reservedQty: true,
            shippedQty: true,
            unitId: true,
            unitFactor: true,
            discountAmount: true,
            isPriceOverridden: true,
            product: { select: { id: true, code: true, name: true, unitId: true, packageUnitId: true, packageQty: true } },
            warehouse: { select: { id: true, code: true, name: true } },
          },
        },
        statusHistory: {
          orderBy: { at: 'asc' },
          select: { id: true, fromStatus: true, toStatus: true, at: true, note: true, userId: true },
        },
      },
    });
    if (!d) throw new NotFoundException('Belge bulunamadı');

    // Resolve the free-text userId on history rows (no FK, so no relation).
    const userIds = [...new Set(d.statusHistory.map((h) => h.userId).filter((v): v is string => !!v))];
    const users = userIds.length
      ? await this.prisma.db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true },
        })
      : [];

    const base = this.toItem(d as DocRow, canViewCost);
    return {
      ...base,
      subtotal: d.subtotal.toString(),
      discountTotal: d.discountTotal.toString(),
      vatTotal: d.vatTotal.toString(),
      rateDate: d.rateDate,
      notes: d.notes,
      internalNotes: d.internalNotes,
      paymentTerms: d.paymentTerms,
      version: d.version,
      sourceDocumentId: d.sourceDocumentId,
      revision: d.revision,
      revisedFromId: d.revisedFromId,
      billingAddressId: d.billingAddressId,
      shippingAddressId: d.shippingAddressId,
      contactId: d.contactId,
      reference: d.reference,
      tags: d.tags,
      cancelReason: d.cancelReason,
      priceIncludesVat: d.priceIncludesVat,
      approvedAt: d.approvedAt,
      sentAt: d.sentAt,
      createdAt: d.createdAt,
      flow: {
        source: d.sourceDocument,
        derived: d.derivedDocuments,
        revisedFrom: d.revisedFrom,
        revisions: d.revisions,
      },
      lines: d.lines.map((l) => {
        const line: Record<string, unknown> = {
          id: l.id,
          lineNo: l.lineNo,
          description: l.description,
          product: l.product,
          warehouse: l.warehouse,
          qty: l.qty.toString(),
          unitId: l.unitId,
          unitFactor: l.unitFactor.toString(),
          isPriceOverridden: l.isPriceOverridden,
          packageUnitId: l.product?.packageUnitId ?? null,
          packageQty: l.product?.packageQty?.toString() ?? null,
          baseUnitId: l.product?.unitId ?? null,
          unitPrice: l.unitPrice.toString(),
          discountRate: l.discountRate.toString(),
          discountAmount: l.discountAmount.toString(),
          vatRate: l.vatRate.toString(),
          lineNet: l.lineNet.toString(),
          lineVat: l.lineVat.toString(),
          lineTotal: l.lineTotal.toString(),
          reservedQty: l.reservedQty.toString(),
          shippedQty: l.shippedQty.toString(),
        };
        if (canViewCost) {
          line.unitCostLocal = l.unitCostLocal.toString();
          line.lineProfitLocal = l.lineProfitLocal.toString();
        }
        return line;
      }),
      statusHistory: d.statusHistory.map((h) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        at: h.at,
        note: h.note,
        userName: users.find((u) => u.id === h.userId)?.fullName ?? null,
      })),
    };
  }
}
