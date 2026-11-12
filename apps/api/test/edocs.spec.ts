/**
 * P09 proof: the provider contract, the honest NullProvider default, the queue
 * (idempotent per source document), GİB code explanations and the payload shape
 * a real integrator will receive.
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
import { EDocsService } from '../src/modules/edocs/edocs.service.js';
import {
  NullProvider,
  explainGib,
  type EDocumentPayload,
  type EInvoiceProvider,
  type SendResult,
  type StatusResult,
} from '../src/modules/edocs/provider.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const DB_URL = process.env.TEST_DATABASE_URL;
const dbDescribe = DB_URL ? describe : describe.skip;

const ALL: Permission[] = ['order.read', 'order.write', 'shipment.create', 'shipment.post', 'shipment.cancel', 'stock.read', 'product.read', 'partner.read'];

/** Stand-in integrator that records what it was handed. */
class FakeProvider implements EInvoiceProvider {
  readonly name = 'fake';
  readonly configured = true;
  sent: EDocumentPayload[] = [];
  nextResult: SendResult = { ok: true, providerId: 'PRV-1', status: 'SENT', code: '1000', message: 'Zarf başarıyla alındı.' };

  async sendInvoice(p: EDocumentPayload) { this.sent.push(p); return this.nextResult; }
  async sendDespatch(p: EDocumentPayload) { this.sent.push(p); return this.nextResult; }
  async queryStatus(): Promise<StatusResult> { return { status: 'ACCEPTED', code: '1175', message: 'Kabul edildi.' }; }
  async getIncoming() { return []; }
}

describe('e-Belge sağlayıcı sözleşmesi', () => {
  it('NullProvider sessiz başarı üretmez', async () => {
    const p = new NullProvider();
    expect(p.configured).toBe(false);
    const res = await p.sendDespatch({ number: 'IRS2026-0001' } as EDocumentPayload);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('NO_PROVIDER');
    expect(res.message).toMatch(/Entegratör tanımlı değil/);
    expect(await p.getIncoming()).toEqual([]);
  });

  it('GİB kodları Türkçe açıklanır', () => {
    expect(explainGib('1230')).toMatch(/e-fatura mükellefi olmayabilir/);
    expect(explainGib('1300')).toMatch(/aynı ETTN/);
    expect(explainGib('9999', 'ham mesaj')).toBe('ham mesaj');
  });
});

dbDescribe('P09 — e-belge kuyruğu', () => {
  const base = new PrismaClient({ adapter: new PrismaPg(DB_URL!) });
  const db = base.$extends(tenantExtension());
  const prismaSvc = { db } as unknown as PrismaService;
  const slug = randomUUID().slice(0, 8);
  let T = '', userId = '', partnerId = '', whId = '', unitId = '', productId = '';
  let orderId = '', shipmentId = '';
  let fake: FakeProvider;
  let edocs: EDocsService;
  let nullEdocs: EDocsService;

  const as = <R>(fn: () => Promise<R>) => TenantContext.runAsync({ tenantId: T, userId, permissions: ALL }, fn);
  const sys = <R>(fn: () => Promise<R>) => TenantContext.runSystem(fn);

  beforeAll(async () => {
    await base.$connect();
    const t = await sys(() => db.tenant.create({ data: { name: `P09 ${slug}`, slug: `p09-${slug}` } }));
    T = t.id;
    userId = (await sys(() => db.user.create({ data: { tenantId: T, email: `p09-${slug}@test.local`, passwordHash: 'x', fullName: 'P09 Test' } }))).id;

    await as(async () => {
      unitId = (await db.unit.create({ data: { code: 'ADET', name: 'Adet' } as never })).id;
      whId = (await db.warehouse.create({ data: { code: 'MERKEZ', name: 'Merkez', isDefault: true } as never })).id;
      partnerId = (await db.businessPartner.create({
        data: { code: `C${slug}`, name: 'Kaş Deniz Otel A.Ş.', type: 'CUSTOMER', city: 'Antalya', taxOffice: 'Kaş', taxNumber: '1112223334' } as never,
      })).id;
      productId = (await db.product.create({ data: { code: `P${slug}`, name: 'Çay Bardağı', unitId, salesPrice: 20, purchasePrice: 10, vatRate: 20 } as never })).id;
      await db.setting.create({ data: { key: 'company', value: { name: 'Demo Toptan A.Ş.', taxNumber: '9998887776', taxOffice: 'Muratpaşa' } } as never });

      const order = await db.salesDocument.create({
        data: {
          type: 'ORDER', number: `SIP-P09-${slug}`, partnerId, status: 'SHIPPED',
          subtotal: 200, vatTotal: 40, grandTotal: 240, grandTotalLocal: 240,
          lines: { create: [{ lineNo: 1, productId, description: 'Çay Bardağı', qty: 10, unitPrice: 20, vatRate: 20, lineTotal: 240, warehouseId: whId }] },
        } as never,
      });
      orderId = order.id;
      const lines = await db.salesDocumentLine.findMany({ where: { documentId: orderId } });
      const shipment = await db.shipment.create({
        data: {
          number: `IRS-P09-${slug}`, orderId, partnerId, warehouseId: whId, status: 'POSTED',
          carrier: 'Aras Kargo', carrierVkn: '1234567890', vehiclePlate: '07 ABC 123',
          driverName: 'Ali Veli', packageCount: 3, ublUuid: randomUUID(), postedAt: new Date(),
          lines: { create: [{ lineNo: 1, orderLineId: lines[0]!.id, productId, qty: 10 }] },
        } as never,
      });
      shipmentId = shipment.id;
    });

    const audit = new AuditService(prismaSvc);
    fake = new FakeProvider();
    edocs = new EDocsService(prismaSvc, audit, fake);
    nullEdocs = new EDocsService(prismaSvc, audit, new NullProvider());
  });

  afterAll(async () => {
    if (!T) return;
    await sys(async () => {
      await db.eDocument.deleteMany({ where: { tenantId: T } });
      await db.shipmentLine.deleteMany({ where: { shipment: { tenantId: T } } });
      await db.shipment.deleteMany({ where: { tenantId: T } });
      await db.salesDocumentLine.deleteMany({ where: { document: { tenantId: T } } });
      await db.salesDocument.deleteMany({ where: { tenantId: T } });
      await db.product.deleteMany({ where: { tenantId: T } });
      await db.businessPartner.deleteMany({ where: { tenantId: T } });
      await db.unit.deleteMany({ where: { tenantId: T } });
      await db.warehouse.deleteMany({ where: { tenantId: T } });
      await db.setting.deleteMany({ where: { tenantId: T } });
      await db.auditLog.deleteMany({ where: { tenantId: T } });
      await db.user.deleteMany({ where: { tenantId: T } });
      await db.tenant.delete({ where: { id: T } });
    });
    await base.$disconnect();
  });

  it('irsaliye kuyruğa alınır, UBL-TR alanları payload’a girer', async () => {
    const e = await as(() => edocs.queueDespatch(shipmentId));
    expect(e.kind).toBe('E_DESPATCH');
    expect(e.status).toBe('QUEUED');
    expect(e.ettn).toMatch(/^[0-9a-f-]{36}$/);

    const payload = e.payload as unknown as EDocumentPayload;
    expect(payload.profileId).toBe('TEMELIRSALIYE');
    expect(payload.supplier.taxNumber).toBe('9998887776');
    expect(payload.customer.name).toBe('Kaş Deniz Otel A.Ş.');
    expect(payload.despatch?.vehiclePlate).toBe('07 ABC 123');
    expect(payload.lines[0]!.qty).toBe('10');
  });

  it('aynı irsaliye ikinci kez kuyruğa alınmaz', async () => {
    const first = await as(() => edocs.queueDespatch(shipmentId));
    const second = await as(() => edocs.queueDespatch(shipmentId));
    expect(second.id).toBe(first.id);
  });

  it('gönderim sağlayıcıya gider, yanıt ve irsaliye durumu güncellenir', async () => {
    const queued = await as(() => edocs.queueDespatch(shipmentId));
    const sent = await as(() => edocs.send(queued.id));
    expect(sent.status).toBe('SENT');
    expect(sent.providerId).toBe('PRV-1');
    expect(sent.explanation).toMatch(/başarıyla alındı/);
    expect(fake.sent.at(-1)!.number).toContain('IRS-P09');

    const shipment = await as(() => db.shipment.findFirst({ where: { id: shipmentId } }));
    expect(shipment!.gibStatus).toBe('SENT');
    expect(shipment!.sentToGibAt).toBeTruthy();
  });

  it('durum sorgusu entegratörden gelen sonucu yazar', async () => {
    const list = await as(() => edocs.list({ kind: 'E_DESPATCH' }));
    const id = list.items[0]!.id;
    const refreshed = await as(() => edocs.refresh(id));
    expect(refreshed.status).toBe('ACCEPTED');
    expect(refreshed.explanation).toMatch(/kabul edildi/i);
  });

  it('fatura kuyruğu: taslak sipariş reddedilir, sevk edilen kabul edilir', async () => {
    const draft = await as(() => db.salesDocument.create({
      data: { type: 'ORDER', number: `SIP-DRAFT-${slug}`, partnerId, status: 'DRAFT' } as never,
    }));
    const err = await as(() => edocs.queueInvoice(draft.id)).catch((e) => e);
    expect(JSON.stringify(err.getResponse?.() ?? err.message)).toMatch(/faturalanamaz/);

    const inv = await as(() => edocs.queueInvoice(orderId, 'E_ARCHIVE'));
    expect(inv.kind).toBe('E_ARCHIVE');
    const payload = inv.payload as unknown as EDocumentPayload;
    expect(payload.profileId).toBe('EARSIVFATURA');
    expect(payload.totals?.grandTotal).toBe('240');
  });

  it('entegratör yokken kuyruk dolu kalır ve durum dürüstçe söylenir', async () => {
    expect(nullEdocs.status().configured).toBe(false);
    const inv = await as(() => nullEdocs.list({ status: 'QUEUED' }));
    expect(inv.provider.message).toMatch(/Entegratör bağlı değil/);

    const queued = await as(() => nullEdocs.queueInvoice(orderId));
    const res = await as(() => nullEdocs.send(queued.id));
    expect(res.status).toBe('ERROR');
    expect(res.responseCode).toBe('NO_PROVIDER');
    expect(res.explanation).toMatch(/kuyrukta bekliyor/);
  });

  it('reddedilen gönderim tekrar denenebilir, deneme sayısı artar', async () => {
    fake.nextResult = { ok: false, status: 'ERROR', code: '1210', message: 'Şematron hatası' };
    // a fresh source document: queueing is idempotent, so the earlier accepted
    // despatch would be returned as-is
    const order2 = await as(() => db.salesDocument.create({
      data: {
        type: 'ORDER', number: `SIP-RETRY-${slug}`, partnerId, status: 'SHIPPED',
        subtotal: 100, vatTotal: 20, grandTotal: 120, grandTotalLocal: 120,
        lines: { create: [{ lineNo: 1, productId, description: 'Çay Bardağı', qty: 5, unitPrice: 20, vatRate: 20, lineTotal: 120, warehouseId: whId }] },
      } as never,
    }));
    const q = await as(() => edocs.queueInvoice(order2.id));
    const failed = await as(() => edocs.send(q.id));
    expect(failed.status).toBe('ERROR');
    expect(failed.explanation).toMatch(/Şematron/);
    const attempts = failed.attempts;

    fake.nextResult = { ok: true, providerId: 'PRV-2', status: 'SENT', code: '1000', message: 'Zarf başarıyla alındı.' };
    const retried = await as(() => edocs.send(q.id));
    expect(retried.status).toBe('SENT');
    expect(retried.attempts).toBeGreaterThan(attempts);
  });

  it('kabul edilmiş belge Cora’dan iptal edilemez', async () => {
    const list = await as(() => edocs.list({}));
    const accepted = list.items.find((i) => i.status === 'ACCEPTED');
    if (!accepted) return;
    const err = await as(() => edocs.cancel(accepted.id, 'test')).catch((e) => e);
    expect(JSON.stringify(err.getResponse?.() ?? err.message)).toMatch(/entegratör üzerinden/i);
  });
});
