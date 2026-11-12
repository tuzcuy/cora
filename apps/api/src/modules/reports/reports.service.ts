import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';

/** Orders that count as real revenue. */
const REVENUE_STATUSES = [
  'APPROVED', 'SENT_TO_WAREHOUSE', 'PICKING', 'READY',
  'PARTIALLY_SHIPPED', 'SHIPPED', 'COMPLETED',
] as const;

const num = (d: Prisma.Decimal | null | undefined) => (d ?? new Prisma.Decimal(0)).toString();

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Monthly revenue. Needs date_trunc, which Prisma's groupBy cannot express, so
   * this is raw SQL — and raw SQL is NOT covered by the tenant extension, so the
   * tenantId is bound explicitly.
   */
  private async monthly(tenantId: string, months = 18) {
    const rows = await this.prisma.db.$queryRaw<
      { ay: string; siparis: bigint; ciro: Prisma.Decimal; kar: Prisma.Decimal; teklif: bigint }[]
    >(Prisma.sql`
      select to_char(date_trunc('month', d.date), 'YYYY-MM')                       as ay,
             count(*) filter (where d.type = 'ORDER')                              as siparis,
             count(*) filter (where d.type = 'QUOTE')                              as teklif,
             coalesce(sum(d."subtotalLocal") filter (where d.type = 'ORDER'
                     and d.status <> 'CANCELLED'), 0)                              as ciro,
             coalesce(sum(d."profitLocal")   filter (where d.type = 'ORDER'
                     and d.status <> 'CANCELLED'), 0)                              as kar
      from "SalesDocument" d
      where d."tenantId" = ${tenantId}
        and d.date >= date_trunc('month', now()) - (${months - 1} || ' months')::interval
      group by 1
      order by 1
    `);
    return rows.map((r) => ({
      month: r.ay,
      orders: Number(r.siparis),
      quotes: Number(r.teklif),
      revenue: num(r.ciro),
      profit: num(r.kar),
    }));
  }

  async dashboard(canViewCost: boolean) {
    const tenantId = TenantContext.requireTenantId();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const orderWhere: Prisma.SalesDocumentWhereInput = {
      type: 'ORDER',
      status: { in: [...REVENUE_STATUSES] as never },
    };

    const [monthAgg, allAgg, openOrders, quoteCount, partnerCount, productCount, lowStock, months] =
      await Promise.all([
        this.prisma.db.salesDocument.aggregate({
          where: { ...orderWhere, date: { gte: monthStart } },
          _sum: { subtotalLocal: true, profitLocal: true },
          _count: { _all: true },
        }),
        this.prisma.db.salesDocument.aggregate({
          where: orderWhere,
          _sum: { subtotalLocal: true, profitLocal: true },
          _count: { _all: true },
        }),
        this.prisma.db.salesDocument.count({
          where: {
            type: 'ORDER',
            status: { in: ['APPROVED', 'SENT_TO_WAREHOUSE', 'PICKING', 'READY', 'PARTIALLY_SHIPPED'] },
          },
        }),
        this.prisma.db.salesDocument.count({ where: { type: 'QUOTE', status: 'SENT' } }),
        this.prisma.db.businessPartner.count({ where: { type: 'CUSTOMER', deletedAt: null } }),
        this.prisma.db.product.count({ where: { deletedAt: null } }),
        this.prisma.db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
          select count(*)::bigint as n
          from "StockLevel" sl
          join "Product" p on p.id = sl."productId"
          where p."tenantId" = ${tenantId}
            and p."deletedAt" is null
            and (sl."onHand" - sl.reserved) < p."minStock"
        `),
        this.monthly(tenantId),
      ]);

    const [topProducts, topCustomers, reps] = await Promise.all([
      this.topProducts(tenantId, 10),
      this.topCustomers(10),
      this.repPerformance(),
    ]);

    const kpis: Record<string, unknown> = {
      monthRevenue: num(monthAgg._sum.subtotalLocal),
      monthOrders: monthAgg._count._all,
      totalRevenue: num(allAgg._sum.subtotalLocal),
      totalOrders: allAgg._count._all,
      openOrders,
      pendingQuotes: quoteCount,
      customers: partnerCount,
      products: productCount,
      lowStock: Number(lowStock[0]?.n ?? 0),
    };
    if (canViewCost) {
      kpis.monthProfit = num(monthAgg._sum.profitLocal);
      kpis.totalProfit = num(allAgg._sum.profitLocal);
    }

    return { kpis, months, topProducts, topCustomers, reps: canViewCost ? reps : reps.map(({ profit: _p, ...r }) => r) };
  }

  private async topProducts(tenantId: string, take: number) {
    const rows = await this.prisma.db.$queryRaw<
      { id: string; code: string; name: string; adet: Prisma.Decimal; ciro: Prisma.Decimal }[]
    >(Prisma.sql`
      select p.id, p.code, p.name,
             sum(l.qty)        as adet,
             sum(l."lineNet")  as ciro
      from "SalesDocumentLine" l
      join "SalesDocument" d on d.id = l."documentId"
      join "Product" p       on p.id = l."productId"
      where d."tenantId" = ${tenantId}
        and d.type = 'ORDER'
        and d.status <> 'CANCELLED'
      group by p.id, p.code, p.name
      order by ciro desc
      limit ${take}
    `);
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      qty: num(r.adet),
      revenue: num(r.ciro),
    }));
  }

  private async topCustomers(take: number) {
    const groups = await this.prisma.db.salesDocument.groupBy({
      by: ['partnerId'],
      where: { type: 'ORDER', status: { notIn: ['CANCELLED'] } },
      _sum: { subtotalLocal: true },
      _count: { _all: true },
      orderBy: { _sum: { subtotalLocal: 'desc' } },
      take,
    });
    const partners = await this.prisma.db.businessPartner.findMany({
      where: { id: { in: groups.map((g) => g.partnerId) } },
      select: { id: true, code: true, name: true, city: true },
    });
    return groups.map((g) => {
      const p = partners.find((x) => x.id === g.partnerId);
      return {
        id: g.partnerId,
        code: p?.code ?? '—',
        name: p?.name ?? '—',
        city: p?.city ?? null,
        orders: g._count._all,
        revenue: num(g._sum.subtotalLocal),
      };
    });
  }

  private async repPerformance() {
    const groups = await this.prisma.db.salesDocument.groupBy({
      by: ['salesRepId', 'type'],
      where: { salesRepId: { not: null } },
      _sum: { subtotalLocal: true },
      _count: { _all: true },
    });
    const approved = await this.prisma.db.salesDocument.groupBy({
      by: ['salesRepId'],
      where: { type: 'QUOTE', status: 'APPROVED', salesRepId: { not: null } },
      _count: { _all: true },
    });
    const profit = await this.prisma.db.salesDocument.groupBy({
      by: ['salesRepId'],
      where: { type: 'ORDER', status: { notIn: ['CANCELLED'] }, salesRepId: { not: null } },
      _sum: { profitLocal: true },
    });
    const ids = [...new Set(groups.map((g) => g.salesRepId).filter((v): v is string => !!v))];
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, repCode: true },
    });

    return users
      .map((u) => {
        const quotes = groups.find((g) => g.salesRepId === u.id && g.type === 'QUOTE');
        const orders = groups.find((g) => g.salesRepId === u.id && g.type === 'ORDER');
        const won = approved.find((a) => a.salesRepId === u.id)?._count._all ?? 0;
        const q = quotes?._count._all ?? 0;
        return {
          id: u.id,
          name: u.fullName,
          repCode: u.repCode,
          quotes: q,
          approved: won,
          conversion: q ? Math.round((won / q) * 1000) / 10 : 0,
          orders: orders?._count._all ?? 0,
          revenue: num(orders?._sum.subtotalLocal),
          profit: num(profit.find((p) => p.salesRepId === u.id)?._sum.profitLocal),
        };
      })
      .sort((a, b) => Number(b.revenue) - Number(a.revenue));
  }

  /** Report tabs: sales / product / customer / rep. */
  async sales(groupBy: 'month' | 'product' | 'customer' | 'rep', canViewCost: boolean) {
    const tenantId = TenantContext.requireTenantId();
    switch (groupBy) {
      case 'product':
        return { rows: await this.topProducts(tenantId, 50) };
      case 'customer':
        return { rows: await this.topCustomers(50) };
      case 'rep': {
        const rows = await this.repPerformance();
        return { rows: canViewCost ? rows : rows.map(({ profit: _p, ...r }) => r) };
      }
      default:
        return { rows: await this.monthly(tenantId, 24) };
    }
  }
}
