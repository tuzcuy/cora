import { describe, it, expect, vi } from 'vitest';
import { SearchService } from './search.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';

function fakePrisma() {
  const db = {
    product: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          {
            id: 'p1',
            code: 'CAM-01',
            name: 'Bardak',
            salesPrice: { toString: () => '10' },
            primaryImageId: null,
          },
        ]),
    },
    businessPartner: { findMany: vi.fn().mockResolvedValue([]) },
    salesDocument: { findMany: vi.fn().mockResolvedValue([]) },
    shipment: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { prisma: { db } as unknown as PrismaService, db };
}

const user = (perms: string[]) =>
  ({
    id: 'u',
    email: 'a@b.c',
    fullName: 'A',
    tenantId: 't',
    permissions: perms,
  }) as unknown as AuthUser;

describe('SearchService', () => {
  it('returns empty and touches no table for a query under 2 chars', async () => {
    const { prisma, db } = fakePrisma();
    const r = await new SearchService(prisma).search('a', user(['product.read']));
    expect(r).toEqual({ q: 'a', products: [], partners: [], documents: [], shipments: [] });
    expect(db.product.findMany).not.toHaveBeenCalled();
  });

  it('only queries the groups the caller may read (RBAC gating)', async () => {
    const { prisma, db } = fakePrisma();
    const r = await new SearchService(prisma).search('bardak', user(['product.read']));
    expect(db.product.findMany).toHaveBeenCalledTimes(1);
    expect(db.businessPartner.findMany).not.toHaveBeenCalled();
    expect(db.salesDocument.findMany).not.toHaveBeenCalled();
    expect(db.shipment.findMany).not.toHaveBeenCalled();
    expect(r.products[0]).toMatchObject({ code: 'CAM-01', name: 'Bardak', salesPrice: '10' });
  });

  it('queries every group for a full-permission user', async () => {
    const { prisma, db } = fakePrisma();
    await new SearchService(prisma).search(
      'otel',
      user(['product.read', 'partner.read', 'order.read', 'quote.read']),
    );
    expect(db.product.findMany).toHaveBeenCalled();
    expect(db.businessPartner.findMany).toHaveBeenCalled();
    expect(db.salesDocument.findMany).toHaveBeenCalled();
    expect(db.shipment.findMany).toHaveBeenCalled();
  });
});
