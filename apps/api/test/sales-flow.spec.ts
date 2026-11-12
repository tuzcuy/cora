/**
 * P04 proof: pricing engine
 * bound to the API, state machine enforced, reservations, guards (stock /
 * credit / margin), convert, revise, optimistic lock. Real Postgres via
 * TEST_DATABASE_URL, throwaway tenant, everything deleted in afterAll.
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

vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });
const DB_URL = process.env.TEST_DATABASE_URL;
const dbDescribe = DB_URL ? describe : describe.skip;

const REP: Permission[] = ['quote.read', 'quote.write', 'quote.send', 'quote.approve', 'order.read', 'order.write', 'order.cancel', 'stock.read', 'product.read', 'partner.read'];
const MANAGER: Permission[] = [...REP, 'sales.approve_low_margin', 'partner.override_credit', 'order.edit_approved', 'cost.view', 'warehouse.pick', 'shipment.post'];

dbDescribe('P04 — teklif/sipariş yazma akışı', () => {
  const base = new PrismaClient({ adapter: new PrismaPg(DB_URL!) });
  const db = base.$extends(tenantExtension());
  const prismaSvc = { db } as unknown as PrismaService;
  const slug = randomUUID().slice(0, 8);
  let T = '';
  let userId = '';
  let partnerId = '';
  let whId = '';
  let unitId = '';
  let koliId = '';
  let pHigh = ''; // margin ok, stock 100
  let pLow = '';  // margin 10%, stock 100
  let pScarce = ''; // stock 5
  let svc: SalesDocumentsService;

  const as = <R>(perms: Permission[], fn: () => Promise<R>) =>
    TenantContext.runAsync({ tenantId: T, userId, permissions: perms }, fn);
  const sys = <R>(fn: () => Promise<R>) => TenantContext.runSystem(fn);
  const level = (productId: string) => as(REP, () => db.stockLevel.findFirst({ where: { productId, warehouseId: whId } }));

  beforeAll(async () => {
    await base.$connect();
    const t = await sys(() => db.tenant.create({ data: { name: `P04 ${slug}`, slug: `p04-${slug}` } }));
    T = t.id;
    const u = await sys(() => db.user.create({ data: { tenantId: T, email: `p04-${slug}@test.local`, passwordHash: 'x', fullName: 'P04 Test' } }));
    userId = u.id;
    await as(REP, async () => {
      const unit = await db.unit.create({ data: { code: 'ADET', name: 'Adet' } as never });
      const koli = await db.unit.create({ data: { code: 'KOLI', name: 'Koli' } as never });
      unitId = unit.id; koliId = koli.id;
      const wh = await db.warehouse.create({ data: { code: 'MERKEZ', name: 'Merkez', isDefault: true } as never });
      whId = wh.id;
      const partner = await db.businessPartner.create({ data: { code: `C${slug}`, name: 'Test Otel', type: 'CUSTOMER', creditLimit: 1000, externalBalance: 0 } as never });
      partnerId = partner.id;
      const mk = async (code: string, sales: number, cost: number, onHand: number, pkg?: number) => {
        const p = await db.product.create({
          data: { code, name: `Ürün ${code}`, unitId, salesPrice: sales, purchasePrice: cost, vatRate: 20, ...(pkg ? { packageUnitId: koliId, packageQty: pkg } : {}) } as never,
        });
        await db.stockLevel.create({ data: { productId: p.id, warehouseId: whId, onHand, reserved: 0 } });
        return p.id;
      };
      pHigh = await mk(`H${slug}`, 100, 50, 100, 12);
      pLow = await mk(`L${slug}`, 100, 90, 100);
      pScarce = await mk(`S${slug}`, 100, 50, 5);
    });
    const audit = new AuditService(prismaSvc);
    const settings = new SettingsService(prismaSvc);
    svc = new SalesDocumentsService(
      prismaSvc, audit, new DocumentNumberService(prismaSvc), new PriceResolverService(),
      new DocumentGuardsService(prismaSvc, settings), settings, new SalesService(prismaSvc),
    );
  });

  afterAll(async () => {
    if (!T) return;
    await sys(async () => {
      await db.documentStatusHistory.deleteMany({ where: { document: { tenantId: T } } });
      await db.warehouseTask.deleteMany({ where: { order: { tenantId: T } } });
      await db.salesDocumentLine.deleteMany({ where: { document: { tenantId: T } } });
      await db.salesDocument.deleteMany({ where: { tenantId: T } });
      await db.stockMovement.deleteMany({ where: { tenantId: T } });
      await db.stockLevel.deleteMany({ where: { warehouseId: whId } });
      await db.product.deleteMany({ where: { tenantId: T } });
      await db.unit.deleteMany({ where: { tenantId: T } });
      await db.warehouse.deleteMany({ where: { tenantId: T } });
      await db.businessPartner.deleteMany({ where: { tenantId: T } });
      await db.auditLog.deleteMany({ where: { tenantId: T } });
      await db.documentSequence.deleteMany({ where: { tenantId: T } });
      await db.user.deleteMany({ where: { tenantId: T } });
      await db.tenant.delete({ where: { id: T } });
    });
    await base.$disconnect();
  });

  it('A1 hesap motoru sunucuda: toplamlar istemciden değil, engine’den', async () => {
    // MANAGER holds cost.view, so cost/profit fields are present in the response.
    const q = await as(MANAGER, () => svc.create({
      type: 'QUOTE', partnerId,
      lines: [
        { qty: 10, productId: pHigh, unitPrice: 100, discountRate: 10, unitFactor: 1 }, // manual
        { qty: 2, productId: pHigh, unitFactor: 1 },                                    // resolved from product
      ],
    } as never)) as Record<string, any>;
    expect(q.number).toMatch(/^TEK\d{4}-\d{4}$/);
    expect(q.status).toBe('DRAFT');
    // 10×100 −10% = 900 net; 2×100 = 200 net → 1100; VAT 220; gross 1320
    expect(q.subtotal).toBe('1100');
    expect(q.vatTotal).toBe('220');
    expect(q.grandTotal).toBe('1320');
    expect(q.lines[0].isPriceOverridden).toBe(true);
    expect(q.lines[1].isPriceOverridden).toBe(false);
    expect(q.lines[1].unitPrice).toBe('100');
    // cost snapshot & profit: (900+200) − 12×50 = 500 → margin 45.45
    expect(q.costTotalLocal).toBe('600');
    expect(q.profitLocal).toBe('500');
  });

  it('birim çevrimi: KOLİ seçilince unitFactor = packageQty, fiyat ve maliyet koli başına', async () => {
    const q = await as(MANAGER, () => svc.create({ type: 'QUOTE', partnerId, lines: [{ qty: 1, productId: pHigh, unitId: koliId }] } as never)) as Record<string, any>;
    expect(q.lines[0].unitFactor).toBe('12');
    expect(q.lines[0].unitPrice).toBe('1200'); // 12 × 100
    expect(q.lines[0].unitCostLocal).toBe('600'); // 12 × 50
  });

  it('cost.view yoksa satır ve başlıkta maliyet/kâr alanı hiç yok', async () => {
    const q = await as(REP, () => svc.create({ type: 'QUOTE', partnerId, lines: [{ qty: 1, productId: pHigh }] } as never)) as Record<string, any>;
    expect(q).not.toHaveProperty('profitLocal');
    expect(q).not.toHaveProperty('costTotalLocal');
    expect(q.lines[0]).not.toHaveProperty('unitCostLocal');
  });

  it('A2 durum makinesi: tablo dışı geçiş 409, yetkisiz geçiş 403', async () => {
    const q = await as(REP, () => svc.create({ type: 'QUOTE', partnerId, lines: [{ qty: 1, productId: pHigh }] } as never)) as Record<string, any>;
    await expect(as(REP, () => svc.transition(q.id, { toStatus: 'SHIPPED' }))).rejects.toMatchObject({ status: 409 });
    await expect(as(['quote.read'], () => svc.transition(q.id, { toStatus: 'SENT' }))).rejects.toMatchObject({ status: 403 });
    const sent = await as(REP, () => svc.transition(q.id, { toStatus: 'SENT' })) as Record<string, any>;
    expect(sent.status).toBe('SENT');
    expect(sent.sentAt).toBeTruthy();
  });

  it('D1 onayda rezervasyon; iptalde serbest; onHand değişmez', async () => {
    const o = await as(REP, () => svc.create({ type: 'ORDER', partnerId, lines: [{ qty: 3, productId: pHigh }] } as never)) as Record<string, any>;
    const before = await level(pHigh);
    const approved = await as(REP, () => svc.transition(o.id, { toStatus: 'APPROVED' })) as Record<string, any>;
    expect(approved.status).toBe('APPROVED');
    expect(approved.lines[0].reservedQty).toBe('3');
    const mid = await level(pHigh);
    expect(Number(mid!.reserved) - Number(before!.reserved)).toBe(3);
    expect(Number(mid!.onHand)).toBe(Number(before!.onHand));
    await expect(as(REP, () => svc.transition(o.id, { toStatus: 'CANCELLED' }))).rejects.toMatchObject({ status: 400 }); // sebep zorunlu
    const cancelled = await as(REP, () => svc.transition(o.id, { toStatus: 'CANCELLED', note: 'Müşteri vazgeçti' })) as Record<string, any>;
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelReason).toBe('Müşteri vazgeçti');
    const after = await level(pHigh);
    expect(Number(after!.reserved)).toBe(Number(before!.reserved));
    const hist = cancelled.statusHistory.map((h: { toStatus: string }) => h.toStatus);
    expect(hist).toEqual(['DRAFT', 'APPROVED', 'CANCELLED']);
  });

  it('D1 yetersiz stok: onay reddedilir, mesaj ürünü ve eksik miktarı söyler', async () => {
    const o = await as(REP, () => svc.create({ type: 'ORDER', partnerId, lines: [{ qty: 50, productId: pScarce }] } as never)) as Record<string, any>;
    const v = await as(REP, () => svc.validate(o.id));
    expect(v.ok).toBe(false);
    expect(v.blockers[0]!.code).toBe('STOCK_SHORT');
    expect(v.blockers[0]!.message).toMatch(/45 adet eksik/);
    expect(v.blockers[0]!.message).toContain(`S${slug}`);
    const err = await as(REP, () => svc.transition(o.id, { toStatus: 'APPROVED' })).catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.getResponse().message).toMatch(/45 adet eksik/);
    expect((await level(pScarce))!.reserved.toString()).toBe('0');
  });

  it('D2 kredi limiti: uyarı + yönetici onayı (APPROVAL_PENDING), yetkili onaylar', async () => {
    // partner limit 1000; 12 × 100 = 1200 net → 1440 gross > limit
    const o = await as(REP, () => svc.create({ type: 'ORDER', partnerId, lines: [{ qty: 12, productId: pHigh }] } as never)) as Record<string, any>;
    const v = await as(REP, () => svc.validate(o.id));
    expect(v.warnings.some((w) => w.code === 'CREDIT_LIMIT')).toBe(true);
    expect(v.needsApproval).toBe(true);
    const routed = await as(REP, () => svc.transition(o.id, { toStatus: 'APPROVED' })) as Record<string, any>;
    expect(routed.status).toBe('APPROVAL_PENDING');
    expect(routed.warnings.length).toBeGreaterThan(0);
    // rep cannot finish it
    await expect(as(REP, () => svc.transition(o.id, { toStatus: 'APPROVED' }))).rejects.toMatchObject({ status: 403 });
    const ok = await as(MANAGER, () => svc.transition(o.id, { toStatus: 'APPROVED', note: 'Limit onayı' })) as Record<string, any>;
    expect(ok.status).toBe('APPROVED');
    expect(ok.lines[0].reservedQty).toBe('12');
    await as(MANAGER, () => svc.transition(o.id, { toStatus: 'CANCELLED', note: 'test temizliği' }));
  });

  it('D3 marj eşiği: %10 < %15 → APPROVAL_PENDING; sales.approve_low_margin ile onay', async () => {
    const o = await as(REP, () => svc.create({ type: 'ORDER', partnerId, lines: [{ qty: 1, productId: pLow }] } as never)) as Record<string, any>;
    const av = await as(REP, () => svc.availableTransitions(o.id));
    const approve = av.transitions.find((t) => t.to === 'APPROVED')!;
    expect(approve.routesTo).toBe('APPROVAL_PENDING');
    expect(approve.reasons.join(' ')).toMatch(/marj/i);
    const routed = await as(REP, () => svc.transition(o.id, { toStatus: 'APPROVED' })) as Record<string, any>;
    expect(routed.status).toBe('APPROVAL_PENDING');
    const ok = await as(MANAGER, () => svc.transition(o.id, { toStatus: 'APPROVED' })) as Record<string, any>;
    expect(ok.status).toBe('APPROVED');
    await as(MANAGER, () => svc.transition(o.id, { toStatus: 'CANCELLED', note: 'test temizliği' }));
  });

  it('teklif onayı → bağlı APPROVED sipariş oluşur, rezervasyon siparişte', async () => {
    const q = await as(REP, () => svc.create({ type: 'QUOTE', partnerId, lines: [{ qty: 2, productId: pHigh }] } as never)) as Record<string, any>;
    const before = await level(pHigh);
    const approved = await as(REP, () => svc.transition(q.id, { toStatus: 'APPROVED' })) as Record<string, any>;
    expect(approved.status).toBe('APPROVED');
    expect(approved.flow.derived).toHaveLength(1);
    const order = approved.flow.derived[0];
    expect(order.type).toBe('ORDER');
    expect(['APPROVED', 'SENT_TO_WAREHOUSE']).toContain(order.status); // autoSendToWarehouse default true
    const orderDetail = await as(REP, () => svc.availableTransitions(order.id));
    expect(orderDetail.status).toBe(order.status);
    expect(Number((await level(pHigh))!.reserved) - Number(before!.reserved)).toBe(2);
    await as(MANAGER, () => svc.transition(order.id, { toStatus: 'CANCELLED', note: 'test temizliği' }));
  });

  it('teklif→sipariş dönüştürme: sourceDocumentId bağlı, satırlar kopyalı, ikinci dönüştürme 409', async () => {
    const q = await as(REP, () => svc.create({ type: 'QUOTE', partnerId, lines: [{ qty: 4, productId: pHigh, discountRate: 5 }] } as never)) as Record<string, any>;
    const o = await as(REP, () => svc.convert(q.id)) as Record<string, any>;
    expect(o.type).toBe('ORDER');
    expect(o.status).toBe('DRAFT');
    expect(o.sourceDocumentId).toBe(q.id);
    expect(o.number).toMatch(/^SIP/);
    expect(o.lines).toHaveLength(1);
    expect(o.lines[0].discountRate).toBe('5');
    expect(o.subtotal).toBe(q.subtotal);
    await expect(as(REP, () => svc.convert(q.id))).rejects.toMatchObject({ status: 409 });
  });

  it('revizyon: rev+1, numara /R2, zincir bağlı, eski teklif iptal', async () => {
    const q = await as(REP, () => svc.create({ type: 'QUOTE', partnerId, lines: [{ qty: 1, productId: pHigh }] } as never)) as Record<string, any>;
    await as(REP, () => svc.transition(q.id, { toStatus: 'SENT' }));
    const r2 = await as(REP, () => svc.revise(q.id, 'Fiyat güncellendi')) as Record<string, any>;
    expect(r2.revision).toBe(2);
    expect(r2.number).toBe(`${q.number}/R2`);
    expect(r2.revisedFromId).toBe(q.id);
    expect(r2.status).toBe('DRAFT');
    const parent = await as(REP, () => svc.availableTransitions(q.id));
    expect(parent.status).toBe('CANCELLED');
    const r3 = await as(REP, () => svc.revise(r2.id)) as Record<string, any>;
    expect(r3.number).toBe(`${q.number}/R3`);
    expect(r3.flow.revisedFrom.id).toBe(r2.id);
  });

  it('optimistic lock: aynı version ile ikinci güncelleme 409', async () => {
    const q = await as(REP, () => svc.create({ type: 'QUOTE', partnerId, lines: [{ qty: 1, productId: pHigh }] } as never)) as Record<string, any>;
    const u1 = await as(REP, () => svc.update(q.id, { reference: 'A', version: q.version }, q.version)) as Record<string, any>;
    expect(u1.version).toBe(q.version + 1);
    const err = await as(REP, () => svc.update(q.id, { reference: 'B', version: q.version }, q.version)).catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.getResponse().currentVersion).toBe(q.version + 1);
  });

  it('PATCH lines: satırlar yeniden numaralanır, toplamlar yeniden hesaplanır; taslak silinir, gönderilmiş silinemez', async () => {
    const q = await as(REP, () => svc.create({ type: 'QUOTE', partnerId, lines: [{ qty: 1, productId: pHigh }, { qty: 1, productId: pLow }] } as never)) as Record<string, any>;
    const u = await as(REP, () => svc.update(q.id, { version: q.version, lines: [{ qty: 5, productId: pLow }] }, q.version)) as Record<string, any>;
    expect(u.lines).toHaveLength(1);
    expect(u.lines[0].lineNo).toBe(1);
    expect(u.subtotal).toBe('500');
    await as(REP, () => svc.softDelete(q.id));
    const s = await as(REP, () => svc.create({ type: 'QUOTE', partnerId, lines: [{ qty: 1, productId: pHigh }] } as never)) as Record<string, any>;
    await as(REP, () => svc.transition(s.id, { toStatus: 'SENT' }));
    await expect(as(REP, () => svc.softDelete(s.id))).rejects.toMatchObject({ status: 409 });
  });

  it('ledger tutarlı: onHand hiç değişmedi, reserved = açık satırların toplamı', async () => {
    const lv = await as(REP, () => db.stockLevel.findMany({ where: { warehouseId: whId } }));
    const open = await as(REP, () => db.salesDocumentLine.findMany({
      where: { document: { tenantId: T, type: 'ORDER', status: { in: ['APPROVED', 'SENT_TO_WAREHOUSE', 'PICKING', 'READY', 'PARTIALLY_SHIPPED'] } } },
    }));
    for (const l of lv) {
      const expected = open.filter((x) => x.productId === l.productId).reduce((a, x) => a + Number(x.reservedQty), 0);
      expect(Number(l.reserved)).toBe(expected);
    }
    expect(Number(lv.find((l) => l.productId === pHigh)!.onHand)).toBe(100);
  });
});
