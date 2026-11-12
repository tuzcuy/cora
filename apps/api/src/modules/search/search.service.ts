import { Injectable } from '@nestjs/common';
import { turkishFold } from '@cora/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';

const TAKE = 6;

/**
 * Global search (FAZ 2): one box over products, partners, sales documents and
 * shipments. Tenant isolation and soft-delete come from the Prisma extension;
 * each group is only queried when the caller holds the matching read permission
 * so results never leak past RBAC. Text search reuses the folded, pg_trgm-indexed
 * `searchText` column (INVARIANTS.md rule 12) — never an ILIKE over code/name.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(qRaw: string, user: AuthUser) {
    const q = (qRaw ?? '').trim();
    if (q.length < 2) {
      return { q, products: [], partners: [], documents: [], shipments: [] };
    }
    const folded = turkishFold(q);
    const perms = new Set(user.permissions);
    const canProduct = perms.has('product.read');
    const canPartner = perms.has('partner.read');
    const canDoc = perms.has('order.read') || perms.has('quote.read');
    const canShip = perms.has('order.read');

    const [products, partners, documents, shipments] = await Promise.all([
      canProduct
        ? this.prisma.db.product.findMany({
            where: { searchText: { contains: folded } },
            take: TAKE,
            orderBy: { name: 'asc' },
            select: { id: true, code: true, name: true, salesPrice: true, primaryImageId: true },
          })
        : Promise.resolve([]),
      canPartner
        ? this.prisma.db.businessPartner.findMany({
            where: { searchText: { contains: folded } },
            take: TAKE,
            orderBy: { name: 'asc' },
            select: { id: true, code: true, name: true, city: true, type: true },
          })
        : Promise.resolve([]),
      canDoc
        ? this.prisma.db.salesDocument.findMany({
            where: {
              OR: [
                { number: { contains: q, mode: 'insensitive' } },
                { partner: { searchText: { contains: folded } } },
              ],
            },
            take: TAKE,
            orderBy: { date: 'desc' },
            select: {
              id: true,
              type: true,
              number: true,
              status: true,
              grandTotalLocal: true,
              partner: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
      canShip
        ? this.prisma.db.shipment.findMany({
            where: {
              OR: [
                { number: { contains: q, mode: 'insensitive' } },
                { vehiclePlate: { contains: q, mode: 'insensitive' } },
                { partner: { searchText: { contains: folded } } },
              ],
            },
            take: TAKE,
            orderBy: { date: 'desc' },
            select: {
              id: true,
              number: true,
              status: true,
              order: { select: { number: true } },
              partner: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    return {
      q,
      products: products.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        salesPrice: p.salesPrice.toString(),
        hasImage: !!p.primaryImageId,
      })),
      partners: partners.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        city: p.city,
        type: p.type,
      })),
      documents: documents.map((d) => ({
        id: d.id,
        type: d.type,
        number: d.number,
        status: d.status,
        partner: d.partner?.name ?? null,
        grandTotalLocal: d.grandTotalLocal.toString(),
      })),
      shipments: shipments.map((s) => ({
        id: s.id,
        number: s.number,
        status: s.status,
        order: s.order?.number ?? null,
        partner: s.partner?.name ?? null,
      })),
    };
  }
}
