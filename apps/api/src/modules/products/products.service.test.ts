import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ProductsService } from './products.service.js';
import { ProductListQuerySchema } from './dto/product.dto.js';

const D = (v: string | number) => new Prisma.Decimal(v);

function makeProduct(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p1',
    code: 'CAM-BSU-TS-001',
    name: 'Su Bardağı 250 ml Klasik',
    brandId: 'b1',
    categoryId: 'c1',
    barcode: '8681234567890',
    currency: 'TRY',
    salesPrice: D('24.5000'),
    purchasePrice: D('14.0000'),
    vatRate: D('20.0000'),
    minStock: D('20.000'),
    tags: ['sezon:tum-sezon'],
    isActive: true,
    brand: { id: 'b1', name: 'LAV' },
    category: { id: 'c1', name: 'Su & Meşrubat Bardağı' },
    unit: { code: 'ADET', name: 'Adet' },
    stockLevels: [
      { onHand: D('100.000'), reserved: D('30.000') },
      { onHand: D('50.000'), reserved: D('0.000') },
    ],
    ...over,
  };
}

/** Captures the args the service passes to Prisma so we can assert on them. */
function makePrisma(rows: unknown[] = [makeProduct()]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const count = vi.fn().mockResolvedValue(rows.length);
  const groupBy = vi.fn().mockResolvedValue([]);
  const brandFindMany = vi.fn().mockResolvedValue([]);
  const categoryFindMany = vi.fn().mockResolvedValue([]);
  return {
    service: new ProductsService({
      db: {
        product: { findMany, count, groupBy },
        brand: { findMany: brandFindMany },
        category: { findMany: categoryFindMany },
      },
    } as never),
    findMany,
    count,
    groupBy,
  };
}

const query = (over: Record<string, unknown> = {}) => ProductListQuerySchema.parse(over);

describe('ProductsService.list — arama', () => {
  it('aramayı Türkçe katlayıp yalnızca searchText üzerinde çalıştırır', async () => {
    const { service, findMany } = makePrisma();
    await service.list(query({ q: 'BARDAĞI' }), false);

    const where = findMany.mock.calls[0]![0].where;
    // İ/I katlaması: 'BARDAĞI' -> 'bardagı'
    expect(where.searchText).toEqual({ contains: 'bardagı' });
    // Rule 12: code/name üzerinde OR'lu contains YOK (indekssiz kolon = seq scan)
    expect(where.OR).toBeUndefined();
    expect(where.name).toBeUndefined();
    expect(where.code).toBeUndefined();
  });

  it('mode: insensitive eklemez — searchText zaten katlanmış', async () => {
    const { service, findMany } = makePrisma();
    await service.list(query({ q: 'bardak' }), false);
    expect(findMany.mock.calls[0]![0].where.searchText).not.toHaveProperty('mode');
  });

  it('tek karakterlik aramayı yok sayar (trigram indeksi kısa desende işe yaramaz)', async () => {
    const { service, findMany } = makePrisma();
    await service.list(query({ q: 'b' }), false);
    expect(findMany.mock.calls[0]![0].where.searchText).toBeUndefined();
  });

  it('silinmiş ürünleri her zaman dışarıda bırakır', async () => {
    const { service, findMany } = makePrisma();
    await service.list(query(), false);
    expect(findMany.mock.calls[0]![0].where.deletedAt).toBeNull();
  });
});

describe('ProductsService.list — filtreler ve sayfalama', () => {
  it('marka, kategori, fiyat aralığı ve stok filtrelerini uygular', async () => {
    const { service, findMany } = makePrisma();
    await service.list(
      query({ brandId: 'b1', categoryId: 'c1', priceMin: '10', priceMax: '99', inStock: 'true' }),
      false,
    );
    const where = findMany.mock.calls[0]![0].where;
    expect(where.brandId).toBe('b1');
    expect(where.categoryId).toBe('c1');
    expect(where.salesPrice.gte.toString()).toBe('10');
    expect(where.salesPrice.lte.toString()).toBe('99');
    expect(where.stockLevels).toEqual({ some: { onHand: { gt: 0 } } });
  });

  it('sayfalamayı sunucu tarafında yapar', async () => {
    const { service, findMany } = makePrisma();
    await service.list(query({ page: '3', pageSize: '25' }), false);
    expect(findMany.mock.calls[0]![0].skip).toBe(50);
    expect(findMany.mock.calls[0]![0].take).toBe(25);
  });

  it('sıralama anahtarlarını doğru orderBy alanlarına çevirir', async () => {
    for (const [sort, expected] of [
      ['name', { name: 'asc' }],
      ['code', { code: 'asc' }],
      ['price_asc', { salesPrice: 'asc' }],
      ['price_desc', { salesPrice: 'desc' }],
      ['newest', { createdAt: 'desc' }],
    ] as const) {
      const { service, findMany } = makePrisma();
      await service.list(query({ sort }), false);
      expect(findMany.mock.calls[0]![0].orderBy).toEqual(expected);
    }
  });

  it('marka faseti kendi seçimiyle daraltılmaz', async () => {
    const { service, groupBy } = makePrisma();
    await service.list(query({ brandId: 'b1', categoryId: 'c1' }), false);
    const brandFacetWhere = groupBy.mock.calls.find((c) => c[0].by[0] === 'brandId')![0].where;
    expect(brandFacetWhere.brandId).toBeUndefined(); // kendi boyutu düşürülmüş
    expect(brandFacetWhere.categoryId).toBe('c1'); // diğer filtre korunmuş
  });
});

describe('ProductsService.list — maliyet gizleme (INVARIANTS.md kural 5)', () => {
  it('cost.view yoksa purchasePrice cevapta HİÇ bulunmaz', async () => {
    const { service } = makePrisma();
    const res = await service.list(query(), false);
    expect(res.items[0]).not.toHaveProperty('purchasePrice');
  });

  it('cost.view varsa purchasePrice döner', async () => {
    const { service } = makePrisma();
    const res = await service.list(query(), true);
    expect(res.items[0]!.purchasePrice).toBe('14');
  });
});

describe('ProductsService.list — stok özeti', () => {
  it('depoları toplar, available = onHand - reserved', async () => {
    const { service } = makePrisma();
    const res = await service.list(query(), false);
    expect(res.items[0]!.stock).toMatchObject({
      onHand: '150',
      reserved: '30',
      available: '120',
      belowMin: false,
    });
  });

  it('available minStock altındaysa belowMin işaretler', async () => {
    const { service } = makePrisma([
      makeProduct({
        minStock: D('500.000'),
        stockLevels: [{ onHand: D('100.000'), reserved: D('30.000') }],
      }),
    ]);
    const res = await service.list(query(), false);
    expect(res.items[0]!.stock.available).toBe('70');
    expect(res.items[0]!.stock.belowMin).toBe(true);
  });

  it('para ve miktarları string olarak döner (Decimal hassasiyeti korunur)', async () => {
    const { service } = makePrisma();
    const res = await service.list(query(), true);
    expect(typeof res.items[0]!.salesPrice).toBe('string');
    expect(res.items[0]!.salesPrice).toBe('24.5');
  });
});
