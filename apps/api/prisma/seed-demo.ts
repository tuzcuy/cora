/**
 * seed-demo.ts — 900-SKU seasonal catalogue for the Cora demo tenant.
 *
 * Separate from prisma/seed.ts on purpose: seed.ts owns the tenant, admin,
 * roles, permissions, units, warehouses and settings. This file owns ONLY the
 * product catalogue and its opening stock, so it can be re-run without
 * touching identity or reference data.
 *
 * Run:  pnpm --filter @cora/api exec tsx prisma/seed-demo.ts
 *
 * Requires (created by seed.ts): Tenant, Unit ADET + KOLI, Warehouse MERKEZ.
 * Writes: Brand, Category, Product, StockReceipt(+Line), StockLevel, StockMovement.
 *
 * There is NO season column on Product or Category (checked against
 * schema.prisma). Seasonality is therefore carried redundantly by five real
 * columns, all derived from ONE map so they cannot disagree:
 *   leaf Category (the indexed facet)  ->  tags[] 'sezon:*'  ->  attributes.sezon
 *   ->  the SKU code segment  ->  searchText (the only GIN-indexed text field).
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildSearchText } from '@cora/shared';

try {
  process.loadEnvFile();
} catch {
  /* env injected in CI */
}

const adapter = new PrismaPg(process.env.DATABASE_URL as string);
const prisma = new PrismaClient({ adapter });

/* ------------------------------------------------------------------ *
 * Deterministic RNG — same mulberry32 as seed.ts, different seed so the
 * catalogue is reproducible byte-for-byte but distinct from the 40 originals.
 * ------------------------------------------------------------------ */
function makeRng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(9000904);
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;
const between = (min: number, max: number) => Math.round(min + rng() * (max - min));
/** The single money/qty converter. dp MUST match the column scale. */
const dec = (v: number, dp = 2) => new Prisma.Decimal(v.toFixed(dp));

/* ------------------------------------------------------------------ *
 * Seasons
 * ------------------------------------------------------------------ */
type SeasonKey = 'TS' | 'YZ' | 'KS' | 'YB' | 'RB' | 'DB';

const SEASONS: Record<SeasonKey, { slug: string; label: string; months: number[]; series: string[] }> = {
  TS: {
    slug: 'tum-sezon',
    label: 'Tüm Sezon',
    months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    series: ['Anadolu', 'Sade', 'Optik', 'Klasik Desen'],
  },
  YZ: {
    slug: 'yaz',
    label: 'Yaz',
    months: [5, 6, 7, 8, 9],
    series: ['Deniz Mavisi', 'Mercan', 'Palmiye', 'Buzlu', 'Havuz Serisi'],
  },
  KS: {
    slug: 'kis',
    label: 'Kış',
    months: [11, 12, 1, 2, 3],
    series: ['Kar Tanesi', 'Bordo', 'Kestane', 'Sıcak Seri'],
  },
  YB: {
    slug: 'yilbasi',
    label: 'Yılbaşı',
    months: [12, 1],
    series: ['Kırmızı Geyik', 'Altın Yıldız', 'Çam Dalı', 'Yeni Yıl'],
  },
  RB: {
    slug: 'ramazan-bayram',
    label: 'Ramazan & Bayram',
    months: [2, 3, 4],
    series: ['Hilal', 'Hurma', 'Sedef', 'İftar Serisi'],
  },
  DB: {
    slug: 'dugun-banket',
    label: 'Düğün & Banket',
    months: [4, 5, 6, 7, 8, 9],
    series: ['Altın Yaldız', 'Platin Bant', 'Kristal', 'Banket', 'Nikâh'],
  },
};

/* ------------------------------------------------------------------ *
 * Brands — Brand has only (id, tenantId, name, deletedAt). The short code
 * below is a script-side handle, never persisted.
 * ------------------------------------------------------------------ */
const BRANDS = [
  { code: 'PSB', name: 'Paşabahçe' },
  { code: 'LAV', name: 'LAV' },
  { code: 'ALK', name: 'Alkan Cam' },
  { code: 'KTH', name: 'Kütahya Porselen' },
  { code: 'GRL', name: 'Güral Porselen' },
  { code: 'CRP', name: 'Cora Pro' },
] as const;

type BrandCode = (typeof BRANDS)[number]['code'];

/* ------------------------------------------------------------------ *
 * Catalogue: 5 root categories, 29 season-scoped leaves, 900 SKUs.
 * skuCount per family: 300 + 230 + 130 + 180 + 60 = 900.
 * ------------------------------------------------------------------ */
type SizeKind = 'ml' | 'cm' | 'lt' | 'none';

interface Leaf {
  code: string; // 3-letter leaf code; first letter = family
  root: string; // existing top-level category name
  name: string; // stored in Category.name
  season: SeasonKey;
  count: number;
  priceMin: number; // wholesale sales price, TRY, KDV hariç
  priceMax: number;
  sizeKind: SizeKind;
  sizes: (number | string)[];
  types: string[];
  brands: BrandCode[];
  bulky?: boolean; // equipment: ships 1/2/4 per carton, not 6/12/24
}

const LEAVES: Leaf[] = [
  // ---- Bardak (300) ----
  { code: 'BSU', root: 'Bardak', name: 'Su & Meşrubat Bardağı', season: 'TS', count: 55, priceMin: 18, priceMax: 65, sizeKind: 'ml', sizes: [200, 250, 300, 330, 400, 500],
    types: ['Su Bardağı', 'Meşrubat Bardağı', 'Long Drink Bardağı', 'Kokteyl Su Bardağı', 'Highball Bardak'], brands: ['PSB', 'LAV', 'ALK'] },
  { code: 'BCK', root: 'Bardak', name: 'Çay & Türk Kahvesi Bardağı', season: 'TS', count: 45, priceMin: 15, priceMax: 55, sizeKind: 'ml', sizes: [90, 110, 130, 150, 180],
    types: ['Çay Bardağı', 'İnce Belli Çay Bardağı', 'Türk Kahvesi Bardağı', 'Heybeli Çay Bardağı'], brands: ['PSB', 'LAV', 'ALK'] },
  { code: 'BKH', root: 'Bardak', name: 'Kokteyl & Havuz Bar Bardağı', season: 'YZ', count: 60, priceMin: 22, priceMax: 140, sizeKind: 'ml', sizes: [250, 300, 350, 400, 450, 500],
    types: ['Kokteyl Bardağı', 'Margarita Bardağı', 'Mojito Bardağı', 'Smoothie Bardağı', 'Havuz Bar Bardağı', 'Tiki Bardak'], brands: ['PSB', 'LAV', 'CRP'] },
  { code: 'BKD', root: 'Bardak', name: 'Şarap & Şampanya Kadehi', season: 'DB', count: 50, priceMin: 45, priceMax: 260, sizeKind: 'ml', sizes: [150, 180, 210, 250, 350, 450],
    types: ['Şarap Kadehi', 'Kırmızı Şarap Kadehi', 'Beyaz Şarap Kadehi', 'Şampanya Kadehi', 'Kokteyl Kadehi'], brands: ['PSB', 'GRL', 'CRP'] },
  { code: 'BRB', root: 'Bardak', name: 'Rakı & Bira Bardağı', season: 'TS', count: 40, priceMin: 20, priceMax: 90, sizeKind: 'ml', sizes: [180, 200, 300, 400, 500],
    types: ['Rakı Bardağı', 'Bira Bardağı', 'Pilsner Bardak', 'Kupa Bira Bardağı'], brands: ['PSB', 'LAV', 'ALK'] },
  { code: 'BSC', root: 'Bardak', name: 'Sıcak İçecek Camı (Latte & Irish)', season: 'KS', count: 30, priceMin: 30, priceMax: 120, sizeKind: 'ml', sizes: [200, 250, 300, 350, 400],
    types: ['Latte Bardağı', 'Irish Coffee Bardağı', 'Sıcak İçecek Bardağı', 'Kulplu Cam Kupa'], brands: ['PSB', 'LAV', 'KTH'] },
  { code: 'BSR', root: 'Bardak', name: 'Şerbet & Ayran Bardağı', season: 'RB', count: 20, priceMin: 18, priceMax: 75, sizeKind: 'ml', sizes: [200, 250, 300, 330],
    types: ['Şerbet Bardağı', 'Ayran Bardağı', 'Hoşaf Bardağı', 'Şerbetlik'], brands: ['PSB', 'ALK', 'CRP'] },

  // ---- Tabak & Kase (230) ----
  { code: 'TYT', root: 'Tabak & Kase', name: 'Yemek Tabağı (Porselen)', season: 'TS', count: 55, priceMin: 55, priceMax: 260, sizeKind: 'cm', sizes: [19, 21, 24, 27, 31],
    types: ['Yemek Tabağı', 'Servis Tabağı', 'Ara Sıcak Tabağı', 'Pizza Tabağı', 'Düz Tabak'], brands: ['KTH', 'GRL', 'CRP'] },
  { code: 'TAB', root: 'Tabak & Kase', name: 'Açık Büfe Kase & Salatalık', season: 'YZ', count: 40, priceMin: 40, priceMax: 320, sizeKind: 'cm', sizes: [12, 16, 19, 21, 24, 27],
    types: ['Salata Kasesi', 'Açık Büfe Kasesi', 'Meyve Kasesi', 'Sos Kasesi', 'Büfe Salatalık'], brands: ['KTH', 'GRL', 'CRP'] },
  { code: 'TCG', root: 'Tabak & Kase', name: 'Çorba & Güveç Kasesi', season: 'KS', count: 35, priceMin: 45, priceMax: 190, sizeKind: 'cm', sizes: [12, 14, 16, 19, 21],
    types: ['Çorba Kasesi', 'Güveç Kabı', 'Kulplu Çorba Kasesi', 'Fırın Güveci'], brands: ['KTH', 'GRL', 'ALK'] },
  { code: 'TTP', root: 'Tabak & Kase', name: 'Tatlı & Pasta Tabağı', season: 'TS', count: 30, priceMin: 35, priceMax: 160, sizeKind: 'cm', sizes: [16, 19, 21, 24],
    types: ['Tatlı Tabağı', 'Pasta Tabağı', 'Sunum Tabağı', 'Kek Tabağı'], brands: ['KTH', 'GRL', 'PSB'] },
  { code: 'TBS', root: 'Tabak & Kase', name: 'Banket Sunum Tabağı & Supla', season: 'DB', count: 30, priceMin: 90, priceMax: 450, sizeKind: 'cm', sizes: [27, 31, 33, 36],
    types: ['Banket Sunum Tabağı', 'Supla', 'Şov Tabağı', 'Nikâh Sunum Tabağı'], brands: ['GRL', 'KTH', 'CRP'] },
  { code: 'TIF', root: 'Tabak & Kase', name: 'İftar & Sahur Tabak Grubu', season: 'RB', count: 25, priceMin: 60, priceMax: 380, sizeKind: 'none', sizes: ['4 Bölmeli', '5 Bölmeli', '6 Bölmeli', '2 Katlı'],
    types: ['İftar Tabağı', 'Sahur Tabağı', 'Bölmeli İftar Tabağı', 'Kahvaltılık Takım'], brands: ['KTH', 'CRP', 'GRL'] },
  { code: 'TKV', root: 'Tabak & Kase', name: 'Kahvaltı Tabağı & Reçellik', season: 'TS', count: 15, priceMin: 25, priceMax: 130, sizeKind: 'cm', sizes: [12, 14, 16, 19],
    types: ['Kahvaltı Tabağı', 'Reçellik', 'Tereyağlık', 'Zeytinlik'], brands: ['KTH', 'ALK', 'CRP'] },

  // ---- Fincan & Kupa (130) ----
  { code: 'FTK', root: 'Fincan & Kupa', name: 'Türk Kahvesi Fincanı & Tabağı', season: 'TS', count: 30, priceMin: 35, priceMax: 180, sizeKind: 'ml', sizes: [70, 90, 110],
    types: ['Türk Kahvesi Fincanı', 'Kahve Fincan Takımı', 'Kapaklı Kahve Fincanı'], brands: ['KTH', 'GRL', 'PSB'] },
  { code: 'FCF', root: 'Fincan & Kupa', name: 'Çay Fincanı & Tabağı', season: 'TS', count: 25, priceMin: 30, priceMax: 150, sizeKind: 'ml', sizes: [150, 180, 200, 220],
    types: ['Çay Fincanı', 'Çay Fincan Takımı', 'Kulplu Çay Fincanı'], brands: ['KTH', 'GRL', 'ALK'] },
  { code: 'FES', root: 'Fincan & Kupa', name: 'Espresso & Cappuccino Fincanı', season: 'TS', count: 30, priceMin: 35, priceMax: 170, sizeKind: 'ml', sizes: [80, 100, 160, 200, 250],
    types: ['Espresso Fincanı', 'Cappuccino Fincanı', 'Latte Fincanı', 'Barista Fincan Takımı'], brands: ['KTH', 'GRL', 'CRP'] },
  { code: 'FSC', root: 'Fincan & Kupa', name: 'Sıcak Çikolata & Salep Kupası', season: 'KS', count: 25, priceMin: 45, priceMax: 200, sizeKind: 'ml', sizes: [250, 300, 350, 400],
    types: ['Salep Kupası', 'Sıcak Çikolata Kupası', 'Kulplu Porselen Kupa', 'Kış Kupası'], brands: ['KTH', 'GRL', 'CRP'] },
  { code: 'FYB', root: 'Fincan & Kupa', name: 'Yılbaşı Temalı Kupa', season: 'YB', count: 20, priceMin: 55, priceMax: 220, sizeKind: 'ml', sizes: [250, 300, 320, 400],
    types: ['Yılbaşı Kupası', 'Temalı Kupa', 'Hediyelik Kupa', 'Yeni Yıl Fincanı'], brands: ['KTH', 'CRP', 'GRL'] },

  // ---- Servis Ürünleri (180) ----
  { code: 'SSK', root: 'Servis Ürünleri', name: 'Sürahi & Karaf', season: 'YZ', count: 30, priceMin: 70, priceMax: 380, sizeKind: 'lt', sizes: ['0,5 lt', '1 lt', '1,5 lt', '2 lt'],
    types: ['Sürahi', 'Karaf', 'Kulplu Sürahi', 'Limonata Sürahisi', 'Buzluk Sürahi'], brands: ['PSB', 'LAV', 'CRP'] },
  { code: 'SCS', root: 'Servis Ürünleri', name: 'Çaydanlık, Cezve & Semaver', season: 'TS', count: 30, priceMin: 120, priceMax: 4500, sizeKind: 'lt', sizes: ['1 lt', '2 lt', '4 lt', '9 lt', '12 lt'],
    types: ['Çelik Çaydanlık', 'Cezve', 'Elektrikli Semaver', 'Çay Kazanı', 'Demlik'], brands: ['CRP', 'ALK', 'KTH'], bulky: true },
  { code: 'SAB', root: 'Servis Ürünleri', name: 'Açık Büfe Servis & Chafing', season: 'TS', count: 35, priceMin: 350, priceMax: 9500, sizeKind: 'lt', sizes: ['4 lt', '6 lt', '9 lt', '12 lt'],
    types: ['Chafing Dish', 'Açık Büfe Isıtıcı', 'Büfe Sunum Standı', 'Soğuk Büfe Ünitesi', 'Kapaklı Chafing'], brands: ['CRP', 'GRL'], bulky: true },
  { code: 'SHP', root: 'Servis Ürünleri', name: 'Havuz & Plaj Servis (Kırılmaz)', season: 'YZ', count: 35, priceMin: 45, priceMax: 650, sizeKind: 'none', sizes: ['Küçük', 'Orta', 'Büyük', 'XL'],
    types: ['Kırılmaz Servis Tepsisi', 'Polikarbonat Bardak', 'Havuz Bar Tepsisi', 'Plaj Servis Seti', 'Melamin Tabak'], brands: ['CRP', 'LAV'] },
  { code: 'SBD', root: 'Servis Ürünleri', name: 'Banket & Düğün Servis Takımları', season: 'DB', count: 30, priceMin: 250, priceMax: 3800, sizeKind: 'none', sizes: ['6 Kişilik', '12 Kişilik', '24 Kişilik', 'Tekli'],
    types: ['Banket Servis Takımı', 'Düğün Sunum Seti', 'Kule Sunum Standı', 'Nikâh Servis Takımı'], brands: ['GRL', 'CRP'], bulky: true },
  { code: 'SIF', root: 'Servis Ürünleri', name: 'İftar Servis & Hurmalık', season: 'RB', count: 20, priceMin: 80, priceMax: 950, sizeKind: 'none', sizes: ['Tekli', '2 Katlı', '3 Katlı', '6 Bölmeli'],
    types: ['Hurmalık', 'İftar Servis Standı', 'Ramazan Sunum Seti', 'Katlı Servis Standı'], brands: ['CRP', 'GRL', 'KTH'], bulky: true },

  // ---- Aksesuar (60) ----
  { code: 'ATB', root: 'Aksesuar', name: 'Tuzluk, Biberlik & Baharatlık', season: 'TS', count: 15, priceMin: 25, priceMax: 140, sizeKind: 'none', sizes: ['Tekli', 'İkili Set', 'Üçlü Set'],
    types: ['Tuzluk & Biberlik', 'Baharatlık', 'Değirmenli Tuzluk', 'Masa Baharat Seti'], brands: ['KTH', 'CRP', 'ALK'] },
  { code: 'ABA', root: 'Aksesuar', name: 'Bardak Altlığı & Peçetelik', season: 'TS', count: 10, priceMin: 12, priceMax: 90, sizeKind: 'none', sizes: ['Tekli', '6’lı', '12’li'],
    types: ['Bardak Altlığı', 'Peçetelik', 'Masa Peçeteliği', 'Servis Altlığı'], brands: ['CRP', 'ALK'] },
  { code: 'AYB', root: 'Aksesuar', name: 'Yılbaşı Masa Dekoru & Süsleme', season: 'YB', count: 20, priceMin: 20, priceMax: 450, sizeKind: 'none', sizes: ['Küçük', 'Orta', 'Büyük', 'Set'],
    types: ['Yılbaşı Masa Süsü', 'Mumluk Set', 'Masa Dekor Seti', 'Yeni Yıl Süsleme'], brands: ['CRP', 'ALK'] },
  { code: 'AMV', root: 'Aksesuar', name: 'Mumluk, Vazo & Masa Çiçekliği', season: 'DB', count: 15, priceMin: 45, priceMax: 700, sizeKind: 'cm', sizes: [12, 18, 25, 32, 40],
    types: ['Cam Vazo', 'Mumluk', 'Masa Çiçekliği', 'Banket Vazo'], brands: ['PSB', 'CRP', 'GRL'], bulky: true },
];

const VARIANTS = ['Ekonomik', 'Klasik', 'Premium', 'Otel Serisi'];
const QUALIFIERS = ['Temperli', 'Kırılmaz', 'Porselen', 'Kristal'];

/* ------------------------------------------------------------------ */

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const formatSize = (leaf: Leaf, size: number | string): string => {
  if (leaf.sizeKind === 'none' || leaf.sizeKind === 'lt') return String(size);
  return `${size} ${leaf.sizeKind}`;
};

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: 'demo' } });
  if (!tenant) throw new Error("Tenant 'demo' bulunamadı — önce prisma/seed.ts çalıştırılmalı.");
  const tenantId = tenant.id;

  const existingProducts = await prisma.product.count({ where: { tenantId } });
  if (existingProducts > 0) {
    console.log(`Bu kiracıda zaten ${existingProducts} ürün var — seed-demo atlandı.`);
    console.log('Yeniden yüklemek için önce ürün kataloğunu temizleyin.');
    return { skipped: true as const };
  }

  const units = await prisma.unit.findMany({ where: { tenantId } });
  const unitByCode = Object.fromEntries(units.map((u) => [u.code, u.id]));
  const unitId = unitByCode['ADET'];
  const packageUnitId = unitByCode['KOLI'] ?? null;
  if (!unitId) throw new Error("Unit 'ADET' bulunamadı — önce prisma/seed.ts çalıştırılmalı.");

  const warehouses = await prisma.warehouse.findMany({ where: { tenantId } });
  const whByCode = Object.fromEntries(warehouses.map((w) => [w.code, w.id]));
  const mainWarehouseId = whByCode['MERKEZ'] ?? warehouses[0]?.id;
  const shipWarehouseId = whByCode['SEVK'] ?? null;
  if (!mainWarehouseId) throw new Error('Depo bulunamadı — önce prisma/seed.ts çalıştırılmalı.');

  /* -------- Brands -------- */
  const brandIdByCode: Record<string, string> = {};
  for (const b of BRANDS) {
    const row = await prisma.brand.create({ data: { tenantId, name: b.name } });
    brandIdByCode[b.code] = row.id;
  }
  const brandNameByCode = Object.fromEntries(BRANDS.map((b) => [b.code, b.name]));

  /* -------- Categories: roots first (self-relation needs parent ids) -------- */
  const rootNames = [...new Set(LEAVES.map((l) => l.root))];
  const rootIdByName: Record<string, string> = {};
  for (const name of rootNames) {
    const row = await prisma.category.create({ data: { tenantId, name } });
    rootIdByName[name] = row.id;
  }
  const leafIdByCode: Record<string, string> = {};
  for (const leaf of LEAVES) {
    const row = await prisma.category.create({
      data: { tenantId, name: leaf.name, parentId: rootIdByName[leaf.root]! },
    });
    leafIdByCode[leaf.code] = row.id;
  }

  /* -------- 900 products -------- */
  const productRows: Prisma.ProductCreateManyInput[] = [];

  for (const leaf of LEAVES) {
    const season = SEASONS[leaf.season];
    const usedNames = new Set<string>();

    for (let i = 1; i <= leaf.count; i += 1) {
      const code = `CAM-${leaf.code}-${leaf.season}-${String(i).padStart(3, '0')}`;

      // Name: [Tip] [Ölçü] [Seri] [Varyant]; series present on ~60% of SKUs.
      let name = '';
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const type = pick(leaf.types);
        const size = formatSize(leaf, pick(leaf.sizes));
        const series = rng() < 0.6 ? ` ${pick(season.series)}` : '';
        const qualifier = rng() < 0.25 ? ` ${pick(QUALIFIERS)}` : '';
        const variant = pick(VARIANTS);
        const candidate = `${type} ${size}${series}${qualifier} ${variant}`.replace(/\s+/g, ' ').trim();
        if (!usedNames.has(candidate)) {
          name = candidate;
          break;
        }
        if (attempt === 39) name = `${candidate} ${i}`;
      }
      usedNames.add(name);

      const brandCode = pick([...leaf.brands]);
      const brandName = brandNameByCode[brandCode]!;

      // Price band is the SALES price; purchase is derived at a 1.40–2.00 markup.
      const salesPrice = leaf.priceMin + rng() * (leaf.priceMax - leaf.priceMin);
      const markup = 1.4 + rng() * 0.6;
      const purchasePrice = salesPrice / markup;

      const manufacturerCode = `M${between(1000, 9999)}`;
      const barcode = `868${String(between(1000000000, 9999999999))}`;
      const packageQty = leaf.bulky ? pick([1, 2, 4]) : pick([6, 12, 24]);

      productRows.push({
        tenantId,
        code,
        name,
        description: `${brandName} ${name} — ${leaf.name} (${season.label})`,
        brandId: brandIdByCode[brandCode]!,
        categoryId: leafIdByCode[leaf.code]!,
        unitId,
        packageUnitId,
        packageQty: dec(packageQty, 3),
        barcode,
        manufacturerCode,
        groupCode: leaf.name,
        vatRate: dec(20, 4), // whole percent: 20 = %20
        currency: 'TRY',
        purchasePrice: dec(purchasePrice, 4),
        salesPrice: dec(salesPrice, 4),
        minStock: dec(pick([10, 20, 50]), 3),
        isActive: true,
        tags: [`sezon:${season.slug}`, `kategori:${leaf.code.toLowerCase()}`, `marka:${brandCode.toLowerCase()}`],
        attributes: {
          sezon: season.slug,
          sezonEtiket: season.label,
          sezonAylar: season.months,
          kategoriKodu: leaf.code,
          markaKodu: brandCode,
        } as Prisma.InputJsonValue,
        // searchText is NOT computed by the DB — no trigger, no generated column.
        // The season slug is appended so the single search box can find "yaz".
        searchText: buildSearchText([code, name, brandName, manufacturerCode, barcode, leaf.name, season.slug]),
      });
    }
  }

  if (productRows.length !== 900) {
    throw new Error(`Beklenen 900 ürün, üretilen ${productRows.length} — kategori sayıları tutmuyor.`);
  }

  const created: { id: string; code: string; purchasePrice: Prisma.Decimal }[] = [];
  for (const batch of chunk(productRows, 150)) {
    const rows = await prisma.product.createManyAndReturn({
      data: batch,
      select: { id: true, code: true, purchasePrice: true },
    });
    created.push(...rows);
  }

  /* -------- Opening stock -------- */
  const now = new Date();
  const receiptDate = new Date(now.getFullYear(), now.getMonth(), 1);

  const buildStock = async (warehouseId: string, number: string, subset: typeof created, note: string) => {
    const receipt = await prisma.stockReceipt.create({
      data: { tenantId, number, warehouseId, date: receiptDate, note, status: 'POSTED' },
    });

    const qtyByProduct = new Map<string, number>();
    for (const p of subset) qtyByProduct.set(p.id, between(40, 600));

    for (const batch of chunk(subset, 300)) {
      await prisma.stockReceiptLine.createMany({
        data: batch.map((p) => ({
          receiptId: receipt.id,
          productId: p.id,
          qty: dec(qtyByProduct.get(p.id)!, 3),
          unitCost: dec(Number(p.purchasePrice), 4),
        })),
      });
      await prisma.stockLevel.createMany({
        data: batch.map((p) => ({
          productId: p.id,
          warehouseId,
          onHand: dec(qtyByProduct.get(p.id)!, 3),
          reserved: dec(0, 3),
        })),
      });
      await prisma.stockMovement.createMany({
        data: batch.map((p) => ({
          tenantId,
          productId: p.id,
          warehouseId,
          qty: dec(qtyByProduct.get(p.id)!, 3),
          type: 'RECEIPT' as const,
          refType: 'StockReceipt',
          refId: receipt.id,
          note,
        })),
      });
    }
    return subset.length;
  };

  const mainLines = await buildStock(mainWarehouseId, 'GIR2026-0002', created, 'Açılış stoğu — demo katalog');

  // A third of the catalogue also carries stock in the dispatch warehouse.
  let shipLines = 0;
  if (shipWarehouseId) {
    const subset = created.filter((_, idx) => idx % 3 === 0);
    shipLines = await buildStock(shipWarehouseId, 'GIR2026-0003', subset, 'Açılış stoğu — sevk deposu');
  }

  return {
    skipped: false as const,
    brands: BRANDS.length,
    rootCategories: rootNames.length,
    leafCategories: LEAVES.length,
    products: created.length,
    mainLines,
    shipLines,
  };
}

main()
  .then(async (res) => {
    await prisma.$disconnect();
    if (!res.skipped) {
      console.log('────────────────────────────────────────────');
      console.log('  DEMO KATALOG YÜKLENDİ');
      console.log(`  Marka            : ${res.brands}`);
      console.log(`  Kategori         : ${res.rootCategories} kök + ${res.leafCategories} alt`);
      console.log(`  Ürün             : ${res.products}`);
      console.log(`  Merkez depo stok : ${res.mainLines} kalem`);
      console.log(`  Sevk depo stok   : ${res.shipLines} kalem`);
      console.log('────────────────────────────────────────────');
    }
    console.log('Seed-demo tamam.');
  })
  .catch(async (e) => {
    console.error('Seed-demo hatası:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
