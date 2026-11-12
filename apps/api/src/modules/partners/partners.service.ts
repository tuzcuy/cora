import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { turkishFold } from '@cora/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';
import { MIN_SEARCH_LENGTH, type PartnerListQuery } from './dto/partner.dto.js';

const listSelect = {
  id: true,
  code: true,
  name: true,
  type: true,
  city: true,
  phone: true,
  email: true,
  taxNumber: true,
  taxOffice: true,
  currency: true,
  paymentTermDays: true,
  creditLimit: true,
  externalBalance: true,
  notes: true,
  tags: true,
  isActive: true,
  group: { select: { id: true, code: true, name: true } },
  salesRep: { select: { id: true, fullName: true, repCode: true } },
} satisfies Prisma.BusinessPartnerSelect;

type PartnerRow = Prisma.BusinessPartnerGetPayload<{ select: typeof listSelect }>;

@Injectable()
export class PartnersService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(q: PartnerListQuery, skip?: 'groupId'): Prisma.BusinessPartnerWhereInput {
    const where: Prisma.BusinessPartnerWhereInput = { deletedAt: null };
    // Same rule as products: only the GIN-indexed folded column.
    if (q.q && q.q.length >= MIN_SEARCH_LENGTH) {
      where.searchText = { contains: turkishFold(q.q) };
    }
    if (q.type) where.type = q.type;
    if (q.groupId && skip !== 'groupId') where.groupId = q.groupId;
    return where;
  }

  private orderBy(sort: PartnerListQuery['sort']): Prisma.BusinessPartnerOrderByWithRelationInput {
    switch (sort) {
      case 'code':
        return { code: 'asc' };
      case 'balance_desc':
        return { externalBalance: 'desc' };
      case 'newest':
        return { createdAt: 'desc' };
      default:
        return { name: 'asc' };
    }
  }

  private toItem(p: PartnerRow) {
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      type: p.type,
      groupId: p.group?.id ?? null,
      groupName: p.group?.name ?? null,
      city: p.city,
      phone: p.phone,
      email: p.email,
      taxNumber: p.taxNumber,
      taxOffice: p.taxOffice,
      currency: p.currency,
      paymentTermDays: p.paymentTermDays,
      creditLimit: p.creditLimit?.toString() ?? null,
      balance: p.externalBalance?.toString() ?? null,
      salesRep: p.salesRep ? { id: p.salesRep.id, name: p.salesRep.fullName } : null,
      notes: p.notes,
      tags: p.tags,
      isActive: p.isActive,
    };
  }

  async list(query: PartnerListQuery) {
    const where = this.buildWhere(query);
    const [rows, total, groups] = await Promise.all([
      this.prisma.db.businessPartner.findMany({
        where,
        select: listSelect,
        orderBy: this.orderBy(query.sort),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.db.businessPartner.count({ where }),
      this.prisma.db.businessPartner.groupBy({
        by: ['groupId'],
        where: this.buildWhere(query, 'groupId'),
        _count: { _all: true },
      }),
    ]);

    const groupIds = groups.map((g) => g.groupId).filter((v): v is string => !!v);
    const groupRows = groupIds.length
      ? await this.prisma.db.partnerGroup.findMany({
          where: { id: { in: groupIds } },
          select: { id: true, name: true },
        })
      : [];

    return {
      items: rows.map((r) => this.toItem(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      facets: {
        groups: groups
          .filter((g) => g.groupId)
          .map((g) => ({
            id: g.groupId!,
            name: groupRows.find((x) => x.id === g.groupId)?.name ?? '—',
            count: g._count._all,
          }))
          .sort((a, b) => b.count - a.count),
      },
    };
  }

  async detail(id: string) {
    // findUnique is not tenant-scoped by the extension — use findFirst + tenantId.
    const tenantId = TenantContext.requireTenantId();
    const p = await this.prisma.db.businessPartner.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        ...listSelect,
        defaultDiscountRate: true,
        externalBalanceDate: true,
        country: true,
        website: true,
        createdAt: true,
        contacts: { select: { id: true, name: true, title: true, phone: true, email: true, isPrimary: true } },
        addresses: {
          select: { id: true, type: true, title: true, line1: true, district: true, city: true, isDefault: true },
        },
      },
    });
    if (!p) throw new NotFoundException('Cari bulunamadı');

    const [docs, orderAgg, quoteCount, statusGroups] = await Promise.all([
      this.prisma.db.salesDocument.findMany({
        where: { partnerId: id },
        select: {
          id: true,
          type: true,
          number: true,
          status: true,
          date: true,
          currency: true,
          grandTotal: true,
          grandTotalLocal: true,
        },
        orderBy: { date: 'desc' },
        take: 20,
      }),
      this.prisma.db.salesDocument.aggregate({
        where: { partnerId: id, type: 'ORDER', status: { notIn: ['CANCELLED'] } },
        _sum: { subtotalLocal: true, grandTotalLocal: true },
        _count: { _all: true },
      }),
      this.prisma.db.salesDocument.count({ where: { partnerId: id, type: 'QUOTE' } }),
      this.prisma.db.salesDocument.groupBy({
        by: ['type', 'status'],
        where: { partnerId: id },
        _count: { _all: true },
      }),
    ]);

    return {
      ...this.toItem(p as PartnerRow),
      country: p.country,
      website: p.website,
      defaultDiscountRate: p.defaultDiscountRate?.toString() ?? null,
      balanceDate: p.externalBalanceDate,
      createdAt: p.createdAt,
      contacts: p.contacts,
      addresses: p.addresses,
      totals: {
        orderCount: orderAgg._count._all,
        quoteCount,
        netSales: (orderAgg._sum.subtotalLocal ?? new Prisma.Decimal(0)).toString(),
        grossSales: (orderAgg._sum.grandTotalLocal ?? new Prisma.Decimal(0)).toString(),
      },
      statusCounts: statusGroups.map((g) => ({
        type: g.type,
        status: g.status,
        count: g._count._all,
      })),
      documents: docs.map((d) => ({
        id: d.id,
        type: d.type,
        number: d.number,
        status: d.status,
        date: d.date,
        currency: d.currency,
        grandTotal: d.grandTotal.toString(),
        grandTotalLocal: d.grandTotalLocal.toString(),
      })),
    };
  }
}
