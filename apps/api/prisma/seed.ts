/**
 * Cora demo seed — idempotent.
 * Reference data (permissions, roles, units, warehouses, settings, admin, license)
 * is upserted; bulk demo data (products, partners, documents) is created once
 * (skipped if the tenant already has products). Dogfoods @cora/shared pricing.
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  SYSTEM_ROLES,
  expandRolePermissions,
  buildSearchText,
  calculateDocument,
  type LineInput,
} from '@cora/shared';

try {
  process.loadEnvFile();
} catch {
  /* env injected in CI */
}

const adapter = new PrismaPg(process.env.DATABASE_URL as string);
const prisma = new PrismaClient({ adapter });

// Deterministic PRNG (mulberry32) so re-seeds are stable.
function makeRng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(20260904);
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;
const between = (min: number, max: number) => Math.round(min + rng() * (max - min));

const dec = (v: number, dp = 2) => new Prisma.Decimal(v.toFixed(dp));

async function main() {
  const now = new Date();

  // ── Tenant ───────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      slug: 'demo',
      name: 'Demo Toptan A.Ş.',
      timezone: 'Europe/Istanbul',
      settings: {},
    },
  });
  const tenantId = tenant.id;
  console.log(`Tenant: ${tenant.name} (${tenantId})`);

  // ── Permissions ──────────────────────────────────────────
  const groupOf = (code: string) =>
    Object.entries(PERMISSION_GROUPS).find(([, list]) => (list as string[]).includes(code))?.[0] ??
    'other';
  for (const code of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: { group: groupOf(code) },
      create: { code, group: groupOf(code) },
    });
  }

  // ── Roles (system packages) ──────────────────────────────
  const roleByName: Record<string, string> = {};
  for (const [name, spec] of Object.entries(SYSTEM_ROLES)) {
    const role = await prisma.role.upsert({
      where: { tenantId_name: { tenantId, name } },
      update: { isSystem: true },
      create: { tenantId, name, isSystem: true },
    });
    roleByName[name] = role.id;
    const perms = expandRolePermissions(spec.permissions);
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: perms.map((permissionCode) => ({ roleId: role.id, permissionCode })),
      skipDuplicates: true,
    });
  }

  // ── Admin user ───────────────────────────────────────────
  // SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD env ile sen belirlersin (prod'da önerilir).
  // Verilmezse admin@demo.local + rastgele şifre (log'a bir kez yazılır).
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@demo.local';
  const providedPw = process.env.SEED_ADMIN_PASSWORD;
  const adminPassword = providedPw || randomBytes(9).toString('base64url');
  const existingAdmin = await prisma.user.findFirst({ where: { tenantId, email: adminEmail } });
  let generatedPassword: string | null = null;
  if (existingAdmin) {
    if (providedPw) {
      await prisma.user.update({
        where: { id: existingAdmin.id },
        data: { passwordHash: await argon2.hash(adminPassword) },
      });
      console.log(`Admin şifresi SEED_ADMIN_PASSWORD ile güncellendi: ${adminEmail}`);
    } else {
      console.log(`Admin zaten var (${adminEmail}), şifre değiştirilmedi.`);
    }
  } else {
    const passwordHash = await argon2.hash(adminPassword);
    const admin = await prisma.user.create({
      data: {
        tenantId,
        email: adminEmail,
        passwordHash,
        fullName: 'Sistem Yöneticisi',
        repCode: '001',
        isActive: true,
        roles: { create: { roleId: roleByName['Yönetici']! } },
      },
    });
    if (!providedPw) generatedPassword = adminPassword;
    console.log(`Admin oluşturuldu: ${admin.email}`);
  }

  // ── License (all modules) ────────────────────────────────
  const validUntil = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  const modules = ['SALES', 'WAREHOUSE', 'REPORTS'];
  const anyLicense = await prisma.license.findFirst({ where: { tenantId } });
  if (!anyLicense) {
    await prisma.license.create({
      data: { tenantId, key: 'DEMO-LICENSE', modules, userLimit: 25, validUntil },
    });
  }

  // ── Settings ─────────────────────────────────────────────
  const settings: Record<string, unknown> = {
    company: { name: 'Demo Toptan A.Ş.', city: 'Antalya', country: 'TR' },
    defaultVatRate: 20,
    vatRates: [1, 10, 20],
    quoteValidityDays: 15,
    allowNegativeStock: false,
    autoSendToWarehouse: true,
    numberFormat: { quote: 'TEK{YYYY}-{seq}', order: 'SIP{YYYY}-{seq}' },
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: { value: value as Prisma.InputJsonValue },
      create: { tenantId, key, value: value as Prisma.InputJsonValue },
    });
  }

  // ── Units ────────────────────────────────────────────────
  const unitDefs = [
    { code: 'ADET', name: 'Adet', decimals: 0 },
    { code: 'KOLI', name: 'Koli', decimals: 0 },
    { code: 'KG', name: 'Kilogram', decimals: 3 },
    { code: 'M', name: 'Metre', decimals: 2 },
  ];
  const unitByCode: Record<string, string> = {};
  for (const u of unitDefs) {
    const unit = await prisma.unit.upsert({
      where: { tenantId_code: { tenantId, code: u.code } },
      update: { name: u.name, decimals: u.decimals },
      create: { tenantId, ...u },
    });
    unitByCode[u.code] = unit.id;
  }

  // ── Warehouses ───────────────────────────────────────────
  const whMerkez = await prisma.warehouse.upsert({
    where: { tenantId_code: { tenantId, code: 'MERKEZ' } },
    update: {},
    create: { tenantId, code: 'MERKEZ', name: 'Merkez Depo', isDefault: true },
  });
  await prisma.warehouse.upsert({
    where: { tenantId_code: { tenantId, code: 'SEVK' } },
    update: {},
    create: { tenantId, code: 'SEVK', name: 'Sevkiyat Deposu', isDefault: false },
  });

  // ── Exchange rates (manual) ──────────────────────────────
  for (const [currency, rate] of [
    ['USD', 41.25],
    ['EUR', 44.8],
  ] as const) {
    await prisma.exchangeRate.upsert({
      where: { tenantId_date_currency: { tenantId, date: new Date(now.toDateString()), currency } },
      update: { rate: dec(rate, 6) },
      create: {
        tenantId,
        date: new Date(now.toDateString()),
        currency,
        rate: dec(rate, 6),
        source: 'MANUAL',
      },
    });
  }

  // ── Skip bulk demo data if already present ───────────────
  const productCount = await prisma.product.count({ where: { tenantId } });
  if (productCount > 0) {
    console.log(`Demo veri zaten var (${productCount} ürün). Bulk seed atlandı.`);
    return { generatedPassword, adminEmail };
  }

  // ── Brands & Categories ──────────────────────────────────
  const brandNames = ['Paşabahçe', 'LAV', 'Alkan Cam'];
  const brandByName: Record<string, string> = {};
  for (const name of brandNames) {
    const b = await prisma.brand.create({ data: { tenantId, name } });
    brandByName[name] = b.id;
  }
  const categoryNames = ['Bardak', 'Tabak & Kase', 'Fincan & Kupa', 'Servis Ürünleri', 'Aksesuar'];
  const categoryByName: Record<string, string> = {};
  for (const name of categoryNames) {
    const c = await prisma.category.create({ data: { tenantId, name } });
    categoryByName[name] = c.id;
  }

  // ── Supplier ─────────────────────────────────────────────
  const supplierGroup = await prisma.partnerGroup.create({
    data: { tenantId, code: 'TED-IST', name: 'İstanbul Tedarikçileri' },
  });
  const supplier = await prisma.businessPartner.create({
    data: {
      tenantId,
      code: '320.01.0001',
      name: 'İstanbul Cam Toptan Ltd.',
      type: 'SUPPLIER',
      groupId: supplierGroup.id,
      city: 'İstanbul',
      currency: 'TRY',
      searchText: buildSearchText(['320.01.0001', 'İstanbul Cam Toptan Ltd.']),
    },
  });

  // ── 40 Products (glass / tableware) ──────────────────────
  const productBases = [
    ['Su Bardağı', 'Bardak', 'ADET'],
    ['Çay Bardağı', 'Bardak', 'ADET'],
    ['Kahve Fincanı', 'Fincan & Kupa', 'ADET'],
    ['Çay Tabağı', 'Tabak & Kase', 'ADET'],
    ['Servis Tabağı', 'Servis Ürünleri', 'ADET'],
    ['Salata Kasesi', 'Tabak & Kase', 'ADET'],
    ['Sürahi', 'Servis Ürünleri', 'ADET'],
    ['Vazo', 'Aksesuar', 'ADET'],
    ['Tuzluk', 'Aksesuar', 'ADET'],
    ['Biberlik', 'Aksesuar', 'ADET'],
    ['Cezve', 'Servis Ürünleri', 'ADET'],
    ['Çaydanlık', 'Servis Ürünleri', 'ADET'],
    ['Şarap Kadehi', 'Bardak', 'ADET'],
    ['Rakı Kadehi', 'Bardak', 'ADET'],
    ['Bira Bardağı', 'Bardak', 'ADET'],
    ['Kupa', 'Fincan & Kupa', 'ADET'],
    ['Fincan Tabağı', 'Fincan & Kupa', 'ADET'],
    ['Kase', 'Tabak & Kase', 'ADET'],
    ['Yemek Tabağı', 'Tabak & Kase', 'ADET'],
    ['Bardak Altlığı', 'Aksesuar', 'ADET'],
  ];
  const variants = ['Klasik', 'Premium'];
  const productIds: { id: string; salesPrice: number; vatRate: number; purchasePrice: number }[] =
    [];
  let pi = 0;
  for (const [base, cat] of productBases) {
    for (const variant of variants) {
      pi += 1;
      const code = `CAM-${String(pi).padStart(4, '0')}`;
      const brand = pick(brandNames);
      const name = `${base} ${variant}`;
      const purchasePrice = between(15, 120);
      const salesPrice = Math.round(purchasePrice * (1.4 + rng() * 0.6));
      const vatRate = 20;
      const manufacturerCode = `M${between(1000, 9999)}`;
      const barcode = `868${between(1000000000, 9999999999)}`;
      const product = await prisma.product.create({
        data: {
          tenantId,
          code,
          name,
          description: `${brand} ${name} — cam/sofra ürünü`,
          brandId: brandByName[brand!],
          categoryId: categoryByName[cat!],
          supplierId: supplier.id,
          unitId: unitByCode['ADET']!,
          packageUnitId: unitByCode['KOLI']!,
          packageQty: dec(pick([6, 12, 24]), 3),
          barcode,
          manufacturerCode,
          groupCode: cat!,
          vatRate: dec(vatRate, 4),
          currency: 'TRY',
          purchasePrice: dec(purchasePrice, 4),
          salesPrice: dec(salesPrice, 4),
          minStock: dec(pick([10, 20, 50]), 3),
          searchText: buildSearchText([code, name, brand, manufacturerCode, barcode, cat]),
        },
      });
      productIds.push({ id: product.id, salesPrice, vatRate, purchasePrice });
    }
  }
  console.log(`${productIds.length} ürün oluşturuldu.`);

  // ── Opening stock (StockReceipt + RECEIPT ledger) ────────
  const receipt = await prisma.stockReceipt.create({
    data: {
      tenantId,
      number: 'GIR2026-0001',
      warehouseId: whMerkez.id,
      supplierId: supplier.id,
      status: 'POSTED',
      note: 'Açılış stoğu',
    },
  });
  for (const p of productIds) {
    const qty = between(50, 400);
    await prisma.stockReceiptLine.create({
      data: {
        receiptId: receipt.id,
        productId: p.id,
        qty: dec(qty, 3),
        unitCost: dec(p.purchasePrice, 4),
      },
    });
    await prisma.stockLevel.create({
      data: { productId: p.id, warehouseId: whMerkez.id, onHand: dec(qty, 3), reserved: dec(0, 3) },
    });
    await prisma.stockMovement.create({
      data: {
        tenantId,
        productId: p.id,
        warehouseId: whMerkez.id,
        qty: dec(qty, 3),
        type: 'RECEIPT',
        refType: 'StockReceipt',
        refId: receipt.id,
        unitCost: dec(p.purchasePrice, 4),
        note: 'Açılış stoğu',
      },
    });
  }
  console.log('Açılış stoğu girildi.');

  // ── 15 Customers (Antalya hotels), grouped by region ─────
  const regions = ['Belek', 'Lara', 'Side', 'Kemer', 'Manavgat', 'Alanya', 'Kaş'];
  const regionGroups: Record<string, string> = {};
  let rgi = 4;
  for (const r of regions) {
    rgi += 1;
    const g = await prisma.partnerGroup.create({
      data: { tenantId, code: `120.${String(rgi).padStart(2, '0')}`, name: `${r} Bölgesi` },
    });
    regionGroups[r] = g.id;
  }
  const hotelNames = [
    'Belek Resort & Spa',
    'Lara Beach Palace',
    'Side Sun Hotel',
    'Kemer Marina Otel',
    'Manavgat Garden Hotel',
    'Alanya Grand Resort',
    'Kaş Bay Hotel',
    'Belek Golf Otel',
    'Lara Deniz Otel',
    'Side Antik Hotel',
    'Kemer Pine Resort',
    'Manavgat River Hotel',
    'Alanya Castle Otel',
    'Belek Sunrise Resort',
    'Lara City Hotel',
  ];
  const customerIds: string[] = [];
  let ci = 0;
  for (const hotel of hotelNames) {
    ci += 1;
    const region = pick(regions);
    const code = `120.${String(rgi).padStart(2, '0')}.${String(ci).padStart(4, '0')}`;
    const customer = await prisma.businessPartner.create({
      data: {
        tenantId,
        code,
        name: hotel,
        type: 'CUSTOMER',
        groupId: regionGroups[region],
        city: 'Antalya',
        currency: 'TRY',
        phone: `0242${between(2000000, 8999999)}`,
        email: `satinalma@${hotel.toLowerCase().replace(/[^a-z]/g, '')}.com`,
        paymentTermDays: pick([0, 30, 45, 60]),
        externalBalance: dec(between(-50000, 120000), 4),
        externalBalanceDate: now,
        searchText: buildSearchText([code, hotel, region]),
        contacts: {
          create: {
            name: `${pick(['Ahmet', 'Mehmet', 'Ayşe', 'Fatma', 'Can'])} ${pick(['Yılmaz', 'Demir', 'Kaya'])}`,
            title: 'Satın Alma Sorumlusu',
            isPrimary: true,
            phone: `0532${between(1000000, 9999999)}`,
          },
        },
      },
    });
    customerIds.push(customer.id);
  }
  console.log(`${customerIds.length} müşteri oluşturuldu.`);

  // ── Document numbering sequences ─────────────────────────
  const year = now.getFullYear();
  const buildLines = (n: number): LineInput[] =>
    Array.from({ length: n }, () => {
      const p = pick(productIds);
      return {
        qty: between(5, 60),
        unitPrice: p.salesPrice,
        vatRate: p.vatRate,
        discountRate: pick([0, 0, 5, 10]),
        unitCostLocal: p.purchasePrice,
        exchangeRate: 1,
      } satisfies LineInput;
    });

  const persistDocument = async (opts: {
    type: 'QUOTE' | 'ORDER';
    number: string;
    status: string;
    partnerId: string;
    lineInputs: LineInput[];
    sourceDocumentId?: string;
    reserve?: boolean;
  }) => {
    const calc = calculateDocument({ lines: opts.lineInputs, exchangeRate: 1 });
    const doc = await prisma.salesDocument.create({
      data: {
        tenantId,
        type: opts.type as Prisma.SalesDocumentCreateInput['type'],
        number: opts.number,
        status: opts.status as Prisma.SalesDocumentCreateInput['status'],
        partnerId: opts.partnerId,
        currency: 'TRY',
        exchangeRate: dec(1, 6),
        validUntil:
          opts.type === 'QUOTE' ? new Date(year, now.getMonth(), now.getDate() + 15) : null,
        subtotal: dec(calc.subtotal.toNumber(), 4),
        discountTotal: dec(calc.discountTotal.toNumber(), 4),
        vatTotal: dec(calc.vatTotal.toNumber(), 4),
        grandTotal: dec(calc.grandTotal.toNumber(), 4),
        subtotalLocal: dec(calc.subtotalLocal.toNumber(), 4),
        vatTotalLocal: dec(calc.vatTotalLocal.toNumber(), 4),
        grandTotalLocal: dec(calc.grandTotalLocal.toNumber(), 4),
        costTotalLocal: dec(calc.costTotalLocal.toNumber(), 4),
        profitLocal: dec(calc.profitLocal.toNumber(), 4),
        marginPct: dec(calc.marginPct.toNumber(), 4),
        sourceDocumentId: opts.sourceDocumentId,
        approvedAt: opts.status === 'APPROVED' ? now : null,
        sentAt: ['SENT', 'APPROVED'].includes(opts.status) ? now : null,
        lines: {
          create: opts.lineInputs.map((li, idx) => {
            const r = calc.lines[idx]!;
            const reservedQty = opts.reserve ? Number(li.qty) : 0;
            return {
              lineNo: idx + 1,
              productId: productIds.find((p) => p.salesPrice === Number(li.unitPrice))?.id,
              description: 'Cam/sofra ürünü',
              qty: dec(Number(li.qty), 3),
              unitId: unitByCode['ADET']!,
              unitPrice: dec(Number(li.unitPrice), 4),
              discountRate: dec(Number(li.discountRate ?? 0), 4),
              vatRate: dec(Number(li.vatRate), 4),
              lineNet: dec(r.lineNet.toNumber(), 4),
              lineVat: dec(r.lineVat.toNumber(), 4),
              lineTotal: dec(r.lineTotal.toNumber(), 4),
              unitCostLocal: dec(r.unitCostLocal.toNumber(), 4),
              lineProfitLocal: dec(r.lineProfitLocal.toNumber(), 4),
              warehouseId: whMerkez.id,
              reservedQty: dec(reservedQty, 3),
            };
          }),
        },
        statusHistory: {
          create: {
            toStatus: opts.status as Prisma.SalesDocumentCreateInput['status'],
            note: 'seed',
          },
        },
      },
    });
    return doc;
  };

  // 5 quotes with varied statuses
  const quoteStatuses = ['DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED'];
  let approvedQuoteId: string | undefined;
  let qn = 0;
  for (const status of quoteStatuses) {
    qn += 1;
    const doc = await persistDocument({
      type: 'QUOTE',
      number: `TEK${year}-${String(qn).padStart(4, '0')}`,
      status,
      partnerId: pick(customerIds),
      lineInputs: buildLines(between(2, 5)),
    });
    if (status === 'APPROVED') approvedQuoteId = doc.id;
  }

  // 3 orders in warehouse-flow statuses (reservations set, no SALE ledger yet)
  const orderStatuses = ['SENT_TO_WAREHOUSE', 'PICKING', 'READY'];
  let on = 0;
  for (const status of orderStatuses) {
    on += 1;
    const order = await persistDocument({
      type: 'ORDER',
      number: `SIP${year}-${String(on).padStart(4, '0')}`,
      status,
      partnerId: pick(customerIds),
      lineInputs: buildLines(between(2, 4)),
      sourceDocumentId: on === 1 ? approvedQuoteId : undefined,
      reserve: true,
    });
    if (['PICKING', 'READY'].includes(status)) {
      await prisma.warehouseTask.create({
        data: {
          orderId: order.id,
          warehouseId: whMerkez.id,
          status: status === 'READY' ? 'READY' : 'PICKING',
          startedAt: now,
          readyAt: status === 'READY' ? now : null,
        },
      });
    }
    // reflect reservations on stock levels
    const lines = await prisma.salesDocumentLine.findMany({ where: { documentId: order.id } });
    for (const l of lines) {
      if (l.productId) {
        await prisma.stockLevel.updateMany({
          where: { productId: l.productId, warehouseId: whMerkez.id },
          data: { reserved: { increment: l.reservedQty } },
        });
      }
    }
  }
  console.log('Teklif ve siparişler oluşturuldu.');

  // Document sequences reflecting last numbers
  for (const [docType, last] of [
    ['QUOTE', qn],
    ['ORDER', on],
    ['STOCK_RECEIPT', 1],
  ] as const) {
    await prisma.documentSequence.upsert({
      where: { tenantId_docType_year: { tenantId, docType, year } },
      update: { lastNumber: last },
      create: { tenantId, docType, year, prefix: '', lastNumber: last },
    });
  }

  return { generatedPassword, adminEmail };
}

main()
  .then(async (res) => {
    await prisma.$disconnect();
    if (res?.generatedPassword) {
      console.log('\n────────────────────────────────────────────');
      console.log('  DEMO GİRİŞ BİLGİLERİ (yalnızca bir kez gösterilir)');
      console.log(`  E-posta : ${res.adminEmail}`);
      console.log(`  Şifre   : ${res.generatedPassword}`);
      console.log('────────────────────────────────────────────\n');
    }
    console.log('Seed tamam.');
  })
  .catch(async (e) => {
    console.error('Seed hatası:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
