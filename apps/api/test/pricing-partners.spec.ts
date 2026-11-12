/**
 * P07 proof: the price resolver's list and tier steps are real now, partner
 * writes keep contacts/addresses and the version lock, credit risk and the
 * statement add up, and a bulk price change lands in ProductPriceHistory.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import type { Permission } from '@cora/shared';

import { tenantExtension } from '../src/prisma/prisma-tenant.extension.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TenantContext } from '../src/common/context/tenant-context.js';
import { AuditService } from '../src/common/audit/audit.service.js';
import { DocumentNumberService } from '../src/common/numbering/document-number.service.js';
import { SettingsService } from '../src/common/settings/settings.service.js';
import { SalesService } from '../src/modules/sales/sales.service.js';
import { PriceResolverService } from '../src/modules/sales/price-resolver.service.js';
import { DocumentGuardsService } from '../src/modules/sales/document-guards.service.js';
import { SalesDocumentsService } from '../src/modules/sales/sales-documents.service.js';
import { PricingService } from '../src/modules/pricing/pricing.service.js';
import { PartnerWriteService } from '../src/modules/partners/partner-write.service.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const DB_URL = process.env.TEST_DATABASE_URL;
const dbDescribe = DB_URL ? describe : describe.skip;

const ALL: Permission[] = [
  'quote.read', 'quote.write', 'quote.approve', 'order.read', 'order.write',
  'product.read', 'product.write', 'partner.read', 'partner.write',
  'stock.read', 'cost.view', 'sales.approve_low_margin', 'partner.override_credit',
];

dbDescribe('P07 — fiyat listesi, kademe, cari ve risk', () => {
  const base = new PrismaClient({ adapter: new PrismaPg(DB_URL!) });
  const db = base.$extends(tenantExtension());
  const prismaSvc = { db } as unknown as PrismaService;
  const slug = randomUUID().slice(0, 8);
  let T = '', userId = '', unitId = '', whId = '';
  let productId = '', listPartnerId = '', plainPartnerId = '', listId = '';
  let pricing: PricingService;
  let partners: PartnerWriteService;
  let resolver: PriceResolverService;
  let sales: SalesDocumentsService;

  const as = <R>(fn: () => Promise<R>) => TenantContext.runAsync({ tenantId: T, userId, permissions: ALL }, fn);
  const sys = <R>(fn: () => Promise<R>) => TenantContext.runSystem(fn);

  beforeAll(async () => {
    await base.$connect();
    const t = await sys(() => db.tenant.create({ data: { name: `P07 ${slug}`, slug: `p07-${slug}` } }));
    T = t.id;
    userId = (await sys(() => db.user.create({ data: { tenantId: T, email: `p07-${slug}@test.local`, passwordHash: 'x', fullName: 'P07 Test' } }))).id;

    const audit = new AuditService(prismaSvc);
    const settings = new SettingsService(prismaSvc);
    pricing = new PricingService(prismaSvc, audit);
    partners = new PartnerWriteService(prismaSvc, audit, settings);
    resolver = new PriceResolverService(prismaSvc);
    sales = new SalesDocumentsService(
      prismaSvc, audit, new DocumentNumberService(prismaSvc), resolver,
      new DocumentGuardsService(prismaSvc, settings), settings, new SalesService(prismaSvc),
    );

    await as(async () => {
      unitId = (await db.unit.create({ data: { code: 'ADET', name: 'Adet' } as never })).id;
      whId = (await db.warehouse.create({ data: { code: 'MERKEZ', name: 'Merkez', isDefault: true } as never })).id;
      productId = (await db.product.create({
        data: { code: `P${slug}`, name: 'Test Bardak', unitId, salesPrice: 100, purchasePrice: 40, vatRate: 20 } as never,
      })).id;
      await db.stockLevel.create({ data: { productId, warehouseId: whId, onHand: 10_000, reserved: 0 } });
    });
  });

  afterAll(async () => {
    if (!T) return;
    await sys(async () => {
      await db.documentStatusHistory.deleteMany({ where: { document: { tenantId: T } } });
      await db.salesDocumentLine.deleteMany({ where: { document: { tenantId: T } } });
      await db.salesDocument.deleteMany({ where: { tenantId: T } });
      await db.priceTier.deleteMany({ where: { tenantId: T } });
      await db.priceListItem.deleteMany({ where: { priceList: { tenantId: T } } });
      await db.priceList.deleteMany({ where: { tenantId: T } });
      await db.productPriceHistory.deleteMany({ where: { product: { tenantId: T } } });
      await db.stockLevel.deleteMany({ where: { warehouseId: whId } });
      await db.product.deleteMany({ where: { tenantId: T } });
      await db.partnerContact.deleteMany({ where: { partner: { tenantId: T } } });
      await db.partnerAddress.deleteMany({ where: { partner: { tenantId: T } } });
      await db.businessPartner.deleteMany({ where: { tenantId: T } });
      await db.unit.deleteMany({ where: { tenantId: T } });
      await db.warehouse.deleteMany({ where: { tenantId: T } });
      await db.auditLog.deleteMany({ where: { tenantId: T } });
      await db.documentSequence.deleteMany({ where: { tenantId: T } });
      await db.user.deleteMany({ where: { tenantId: T } });
      await db.tenant.delete({ where: { id: T } });
    });
    await base.$disconnect();
  });

  it('cari kartı kişiler ve adreslerle yazılır, aynı kod ikinci kez reddedilir', async () => {
    const p = await as(() => partners.create({
      code: `C${slug}`,
      name: 'Kemer Panorama Otel A.Ş.',
      city: 'Antalya',
      creditLimit: 100_000,
      paymentTermDays: 30,
      contacts: [{ name: 'Ayşe Yılmaz', title: 'Satın alma', email: 'ayse@panorama.test', isPrimary: true }],
      addresses: [{ type: 'SHIPPING', title: 'Otel', line1: 'Sahil Cad. 1', city: 'Antalya', isDefault: true }],
    } as never));
    listPartnerId = p.id;
    expect(p.contacts).toHaveLength(1);
    expect(p.addresses[0]!.line1).toBe('Sahil Cad. 1');
    expect(p.risk.creditLimit).toBe(100_000);

    const dup = await as(() => partners.create({ code: `C${slug}`, name: 'Kopya' } as never)).catch((e) => e);
    expect(JSON.stringify(dup.getResponse?.() ?? dup.message)).toMatch(/zaten kullanılıyor/);

    plainPartnerId = (await as(() => partners.create({ code: `C2${slug}`, name: 'Liste Dışı Otel', creditLimit: 50_000 } as never))).id;
  });

  it('optimistic lock: eski sürümle güncelleme 409', async () => {
    const p = await as(() => partners.detail(listPartnerId));
    await as(() => partners.update(listPartnerId, { version: p.version, phone: '0242 111 11 11' } as never));
    await expect(as(() => partners.update(listPartnerId, { version: p.version, phone: '0242 222 22 22' } as never))).rejects.toThrow();
  });

  it('fiyat listesi kurulur ve müşteriye bağlanır', async () => {
    const list = await as(() => pricing.createList({ name: `Otel Fiyatları ${slug}`, currency: 'TRY' }));
    listId = list.id;
    await as(() => pricing.setItems(listId, { items: [{ productId, price: 80 }] }));
    const detail = await as(() => pricing.list(listId));
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]!.price).toBe('80');

    const p = await as(() => partners.detail(listPartnerId));
    await as(() => partners.update(listPartnerId, { version: p.version, priceListId: listId } as never));
  });

  it('çözümleme sırası: liste fiyatı ürün fiyatını geçer, kademe listeyi geçer', async () => {
    const product = await as(() => db.product.findFirst({ where: { id: productId } }));

    // no list → product price
    const plain = await as(() => resolver.resolve({ product: product as never, partnerId: plainPartnerId, qty: 1, unitFactor: 1, exchangeRate: 1 }));
    expect(plain.source).toBe('product');
    expect(plain.unitPrice).toBe(100);

    // list customer → list price
    const listed = await as(() => resolver.resolve({ product: product as never, partnerId: listPartnerId, qty: 1, unitFactor: 1, exchangeRate: 1 }));
    expect(listed.source).toBe('price_list');
    expect(listed.unitPrice).toBe(80);

    // 500+ → 5% off the list price
    const item = (await as(() => pricing.list(listId))).items[0]!;
    await as(() => pricing.setTiers({ itemId: item.id, priceListId: listId, tiers: [{ minQty: 500, discountRate: 5 }] }));
    const small = await as(() => resolver.resolve({ product: product as never, partnerId: listPartnerId, qty: 100, unitFactor: 1, exchangeRate: 1 }));
    expect(small.source).toBe('price_list');
    const big = await as(() => resolver.resolve({ product: product as never, partnerId: listPartnerId, qty: 500, unitFactor: 1, exchangeRate: 1 }));
    expect(big.source).toBe('tier');
    expect(big.unitPrice).toBe(76); // 80 − 5%

    // manual still wins over everything
    const manual = await as(() => resolver.resolve({ product: product as never, partnerId: listPartnerId, qty: 500, unitFactor: 1, exchangeRate: 1, manualPrice: 65 }));
    expect(manual.source).toBe('manual');
    expect(manual.isPriceOverridden).toBe(true);
  });

  it('editör değişmeden: belge kaydı liste/kademe fiyatını kullanır', async () => {
    const doc = await as(() => sales.create({
      type: 'QUOTE', partnerId: listPartnerId,
      lines: [{ qty: 500, productId, unitFactor: 1 }],
    } as never)) as Record<string, any>;
    expect(doc.lines[0].unitPrice).toBe('76');
    expect(doc.subtotal).toBe('38000'); // 500 × 76
    expect(doc.lines[0].isPriceOverridden).toBe(false);
  });

  it('kredi riski: açık siparişler + bakiye limite karşı ölçülür', async () => {
    await as(() => partners.setBalance(plainPartnerId, { externalBalance: 20_000 }));
    const order = await as(() => sales.create({ type: 'ORDER', partnerId: plainPartnerId, lines: [{ qty: 100, productId, unitFactor: 1 }] } as never)) as Record<string, string>;
    await as(() => sales.transition(order.id, { toStatus: 'APPROVED' }));

    const risk = await as(() => partners.risk(plainPartnerId));
    expect(risk.balance).toBe(20_000);
    expect(risk.openOrders).toBeGreaterThan(0);
    expect(risk.exposure).toBeCloseTo(risk.balance + risk.openOrders, 2);
    expect(risk.usagePct).toBeGreaterThan(0);

    const list = await as(() => partners.riskList(1));
    expect(list.items.some((r) => r.id === plainPartnerId)).toBe(true);
  });

  it('ekstre: açılış + borç/alacak yürüyen bakiyeyi verir', async () => {
    const st = await as(() => partners.statement(plainPartnerId));
    expect(st.partner.id).toBe(plainPartnerId);
    expect(st.lines.length).toBeGreaterThan(0);
    const last = st.lines[st.lines.length - 1]!;
    expect(Number(st.closing)).toBeCloseTo(Number(last.balance), 2);
    expect(Number(st.totalDebit)).toBeGreaterThan(0);
  });

  it('toplu fiyat güncelleme: önizleme yazmaz, uygulama geçmişe kaydeder', async () => {
    const before = await as(() => db.product.findFirst({ where: { id: productId } }));
    const dry = await as(() => pricing.bulkUpdate({ percent: 10, target: 'sales', roundTo: '0.01', dryRun: true } as never));
    expect(dry.changed).toBeGreaterThan(0);
    const unchanged = await as(() => db.product.findFirst({ where: { id: productId } }));
    expect(Number(unchanged!.salesPrice)).toBe(Number(before!.salesPrice));

    const applied = await as(() => pricing.bulkUpdate({ percent: 10, target: 'sales', roundTo: '0.01' } as never));
    expect(applied.changed).toBeGreaterThan(0);
    const after = await as(() => db.product.findFirst({ where: { id: productId } }));
    expect(Number(after!.salesPrice)).toBeCloseTo(Number(before!.salesPrice) * 1.1, 2);

    const history = await as(() => pricing.history(productId));
    expect(history.items[0]!.kind).toBe('SALES');
    expect(Number(history.items[0]!.price)).toBeCloseTo(Number(after!.salesPrice), 2);
  });

  it('kullanımdaki fiyat listesi silinemez', async () => {
    const err = await as(() => pricing.deleteList(listId)).catch((e) => e);
    expect(JSON.stringify(err.getResponse?.() ?? err.message)).toMatch(/cariye bağlı/);
  });
});
