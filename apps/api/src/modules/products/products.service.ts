import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { turkishFold } from '@cora/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';
import { MIN_SEARCH_LENGTH, type ProductListQuery } from './dto/product.dto.js';

/** A stock roll-up across warehouses. available = onHand - reserved. */
interface StockSummary {
  onHand: string;
  reserved: string;
  available: string;
  belowMin: boolean;
}

export interface ProductListItem {
  id: string;
  code: string;
  name: string;
  brandId: string | null;
  brandName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  unitCode: string | null;
  barcode: string | null;
  currency: string;
  salesPrice: string;
  vatRate: string;
  /** Present only when the caller holds cost.view — stripped otherwise. */
  purchasePrice?: string;
  tags: string[];
  isActive: boolean;
  stock: StockSummary;
}

const listInclude = {
  brand: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  unit: { select: { code: true, name: true } },
  stockLevels: { select: { onHand: true, reserved: true } },
} satisfies Prisma.ProductInclude;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the WHERE clause. `skip` lets a facet count itself without being
   * narrowed by its own selection (choosing a brand should not empty the
   * brand facet).
   */
  private buildWhere(q: ProductListQuery, skip?: 'brandId' | 'categoryId'): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = { deletedAt: null };

    // Rule 12: search ONLY through the folded searchText column, which is the
    // one covered by the pg_trgm GIN index. Never OR over code/name — those
    // columns have no trigram index and would force a sequential scan.
    if (q.q && q.q.length >= MIN_SEARCH_LENGTH) {
      where.searchText = { contains: turkishFold(q.q) };
    }
    if (q.brandId && skip !== 'brandId') where.brandId = q.brandId;
    if (q.categoryId && skip !== 'categoryId') where.categoryId = q.categoryId;
    if (q.priceMin !== undefined || q.priceMax !== undefined) {
      where.salesPrice = {
        ...(q.priceMin !== undefined ? { gte: new Prisma.Decimal(q.priceMin) } : {}),
        ...(q.priceMax !== undefined ? { lte: new Prisma.Decimal(q.priceMax) } : {}),
      };
    }
    if (q.inStock) where.stockLevels = { some: { onHand: { gt: 0 } } };
    return where;
  }

  private orderBy(sort: ProductListQuery['sort']): Prisma.ProductOrderByWithRelationInput {
    switch (sort) {
      case 'code':
        return { code: 'asc' };
      case 'price_asc':
        return { salesPrice: 'asc' };
      case 'price_desc':
        return { salesPrice: 'desc' };
      case 'newest':
        return { createdAt: 'desc' };
      default:
        return { name: 'asc' };
    }
  }

  private summariseStock(
    levels: { onHand: Prisma.Decimal; reserved: Prisma.Decimal }[],
    minStock: Prisma.Decimal,
  ): StockSummary {
    const onHand = levels.reduce((a, l) => a.plus(l.onHand), new Prisma.Decimal(0));
    const reserved = levels.reduce((a, l) => a.plus(l.reserved), new Prisma.Decimal(0));
    const available = onHand.minus(reserved);
    return {
      onHand: onHand.toString(),
      reserved: reserved.toString(),
      available: available.toString(),
      belowMin: available.lessThan(minStock),
    };
  }

  /**
   * Cost stripping is done HERE, not in the UI: INVARIANTS.md rule 5 requires the
   * field to be absent from the response when the caller lacks cost.view.
   */
  private toListItem(
    p: Prisma.ProductGetPayload<{ include: typeof listInclude }>,
    canViewCost: boolean,
  ): ProductListItem {
    const item: ProductListItem = {
      id: p.id,
      code: p.code,
      name: p.name,
      brandId: p.brandId,
      brandName: p.brand?.name ?? null,
      categoryId: p.categoryId,
      categoryName: p.category?.name ?? null,
      unitCode: p.unit?.code ?? null,
      barcode: p.barcode,
      currency: p.currency,
      salesPrice: p.salesPrice.toString(),
      vatRate: p.vatRate.toString(),
      tags: p.tags,
      isActive: p.isActive,
      stock: this.summariseStock(p.stockLevels, p.minStock),
    };
    if (canViewCost) item.purchasePrice = p.purchasePrice.toString();
    return item;
  }

  async list(query: ProductListQuery, canViewCost: boolean) {
    const where = this.buildWhere(query);
    const skip = (query.page - 1) * query.pageSize;

    const [rows, total, brandGroups, categoryGroups] = await Promise.all([
      this.prisma.db.product.findMany({
        where,
        include: listInclude,
        orderBy: this.orderBy(query.sort),
        skip,
        take: query.pageSize,
      }),
      this.prisma.db.product.count({ where }),
      this.prisma.db.product.groupBy({
        by: ['brandId'],
        where: this.buildWhere(query, 'brandId'),
        _count: { _all: true },
      }),
      this.prisma.db.product.groupBy({
        by: ['categoryId'],
        where: this.buildWhere(query, 'categoryId'),
        _count: { _all: true },
      }),
    ]);

    const brandIds = brandGroups.map((g) => g.brandId).filter((v): v is string => !!v);
    const categoryIds = categoryGroups.map((g) => g.categoryId).filter((v): v is string => !!v);
    const [brands, categories] = await Promise.all([
      brandIds.length
        ? this.prisma.db.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      categoryIds.length
        ? this.prisma.db.category.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const nameOf = (rowsIn: { id: string; name: string }[], id: string) =>
      rowsIn.find((r) => r.id === id)?.name ?? '—';

    return {
      items: rows.map((p) => this.toListItem(p, canViewCost)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      facets: {
        brands: brandGroups
          .filter((g) => g.brandId)
          .map((g) => ({ id: g.brandId!, name: nameOf(brands, g.brandId!), count: g._count._all }))
          .sort((a, b) => b.count - a.count),
        categories: categoryGroups
          .filter((g) => g.categoryId)
          .map((g) => ({
            id: g.categoryId!,
            name: nameOf(categories, g.categoryId!),
            count: g._count._all,
          }))
          .sort((a, b) => b.count - a.count),
      },
    };
  }

  async detail(id: string, canViewCost: boolean) {
    // findUnique is NOT auto-scoped by the tenant extension, so this uses
    // findFirst AND passes tenantId explicitly.
    const tenantId = TenantContext.requireTenantId();
    const p = await this.prisma.db.product.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        ...listInclude,
        packageUnit: { select: { code: true, name: true } },
        supplier: { select: { id: true, code: true, name: true } },
        stockLevels: {
          select: {
            onHand: true,
            reserved: true,
            warehouse: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Ürün bulunamadı');

    const base = this.toListItem(
      { ...p, stockLevels: p.stockLevels } as never,
      canViewCost,
    );
    return {
      ...base,
      description: p.description,
      manufacturerCode: p.manufacturerCode,
      groupCode: p.groupCode,
      packageUnitCode: p.packageUnit?.code ?? null,
      packageQty: p.packageQty?.toString() ?? null,
      minStock: p.minStock.toString(),
      supplier: p.supplier ? { id: p.supplier.id, code: p.supplier.code, name: p.supplier.name } : null,
      attributes: p.attributes,
      createdAt: p.createdAt,
      warehouses: p.stockLevels.map((l) => ({
        warehouseId: l.warehouse.id,
        code: l.warehouse.code,
        name: l.warehouse.name,
        onHand: l.onHand.toString(),
        reserved: l.reserved.toString(),
        available: l.onHand.minus(l.reserved).toString(),
      })),
    };
  }
}
