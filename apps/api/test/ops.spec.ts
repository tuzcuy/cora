/**
 * P10 proof: notifications from real data, EXPLAIN telling index from seq scan,
 * KVKK retention and erasure, the backup drill report, security headers and the
 * per-IP rate limit.
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
import { SettingsService } from '../src/common/settings/settings.service.js';
import { OpsService } from '../src/modules/ops/ops.service.js';
import { RateLimitMiddleware, SecurityHeadersMiddleware } from '../src/common/security/security.middleware.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const DB_URL = process.env.TEST_DATABASE_URL;
const dbDescribe = DB_URL ? describe : describe.skip;

const ALL: Permission[] = ['order.read', 'stock.read', 'settings.manage', 'partner.read', 'product.read', 'audit.read'];

/** Minimal express-ish doubles. */
function fakeRes() {
  const headers: Record<string, string> = {};
  const res = {
    headers,
    statusCode: 200,
    body: undefined as unknown,
    setHeader(k: string, v: string) { headers[k] = v; },
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; return res; },
  };
  return res;
}

describe('Güvenlik başlıkları', () => {
  it('temel başlıkları koyar, HTTPS’te HSTS ekler', () => {
    const mw = new SecurityHeadersMiddleware();
    const res = fakeRes();
    mw.use({ path: '/api/v1/products', secure: false, headers: {} } as never, res as never, () => undefined);
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['X-Frame-Options']).toBe('DENY');
    expect(res.headers['Content-Security-Policy']).toContain("default-src 'none'");
    expect(res.headers['Strict-Transport-Security']).toBeUndefined();

    const secure = fakeRes();
    mw.use({ path: '/api/v1/products', secure: false, headers: { 'x-forwarded-proto': 'https' } } as never, secure as never, () => undefined);
    expect(secure.headers['Strict-Transport-Security']).toContain('max-age=');
  });

  it('Swagger sayfasına daha gevşek CSP verir', () => {
    const mw = new SecurityHeadersMiddleware();
    const res = fakeRes();
    mw.use({ path: '/api/docs', secure: true, headers: {} } as never, res as never, () => undefined);
    expect(res.headers['Content-Security-Policy']).toContain("script-src 'self' 'unsafe-inline'");
  });
});

describe('Oran sınırlama', () => {
  it('yazma bütçesi aşılınca 429 ve Retry-After döner, sağlık ucu muaf', () => {
    process.env.RATE_LIMIT_WRITE = '3';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    const mw = new RateLimitMiddleware();
    const req = { path: '/api/v1/products', method: 'POST', ip: '1.2.3.4', headers: {} } as never;

    let passed = 0;
    let blocked = 0;
    for (let i = 0; i < 5; i += 1) {
      const res = fakeRes();
      mw.use(req, res as never, () => { passed += 1; });
      if (res.statusCode === 429) {
        blocked += 1;
        expect(res.headers['Retry-After']).toBeTruthy();
        expect(JSON.stringify(res.body)).toMatch(/Çok fazla istek/);
      }
    }
    expect(passed).toBe(3);
    expect(blocked).toBe(2);

    // health must answer even while the bucket is full
    const health = fakeRes();
    let healthPassed = false;
    mw.use({ path: '/api/health', method: 'GET', ip: '1.2.3.4', headers: {} } as never, health as never, () => { healthPassed = true; });
    expect(healthPassed).toBe(true);
    delete process.env.RATE_LIMIT_WRITE;
    delete process.env.RATE_LIMIT_WINDOW_MS;
  });

  it('okuma ve yazma bütçeleri ayrı sayılır', () => {
    process.env.RATE_LIMIT_WRITE = '1';
    process.env.RATE_LIMIT_READ = '5';
    const mw = new RateLimitMiddleware();
    const write = fakeRes();
    mw.use({ path: '/api/v1/x', method: 'POST', ip: '9.9.9.9', headers: {} } as never, write as never, () => undefined);
    const read = fakeRes();
    let ok = false;
    mw.use({ path: '/api/v1/x', method: 'GET', ip: '9.9.9.9', headers: {} } as never, read as never, () => { ok = true; });
    expect(ok).toBe(true);
    delete process.env.RATE_LIMIT_WRITE;
    delete process.env.RATE_LIMIT_READ;
  });
});

dbDescribe('P10 — sertleştirme', () => {
  const base = new PrismaClient({ adapter: new PrismaPg(DB_URL!) });
  const db = base.$extends(tenantExtension());
  const prismaSvc = { db } as unknown as PrismaService;
  const slug = randomUUID().slice(0, 8);
  let T = '', userId = '', partnerId = '', productId = '', whId = '', unitId = '';
  let ops: OpsService;

  const as = <R>(fn: () => Promise<R>) => TenantContext.runAsync({ tenantId: T, userId, permissions: ALL }, fn);
  const sys = <R>(fn: () => Promise<R>) => TenantContext.runSystem(fn);

  beforeAll(async () => {
    await base.$connect();
    const t = await sys(() => db.tenant.create({ data: { name: `P10 ${slug}`, slug: `p10-${slug}` } }));
    T = t.id;
    userId = (await sys(() => db.user.create({ data: { tenantId: T, email: `p10-${slug}@test.local`, passwordHash: 'x', fullName: 'P10 Test' } }))).id;
    await as(async () => {
      unitId = (await db.unit.create({ data: { code: 'ADET', name: 'Adet' } as never })).id;
      whId = (await db.warehouse.create({ data: { code: 'MERKEZ', name: 'Merkez', isDefault: true } as never })).id;
      partnerId = (await db.businessPartner.create({
        data: { code: `C${slug}`, name: 'KVKK Test Otel', type: 'CUSTOMER', phone: '0242 111 11 11', email: 'kvkk@test.local', taxNumber: '1234567890', creditLimit: 1000 } as never,
      })).id;
      await db.partnerContact.create({ data: { partnerId, name: 'Test Kişi', email: 'kisi@test.local' } as never });
      await db.partnerAddress.create({ data: { partnerId, type: 'SHIPPING', line1: 'Gizli Adres 1', city: 'Antalya' } as never });
      productId = (await db.product.create({ data: { code: `P${slug}`, name: 'Kritik Ürün', unitId, salesPrice: 10, purchasePrice: 5, vatRate: 20, minStock: 100 } as never })).id;
      await db.stockLevel.create({ data: { productId, warehouseId: whId, onHand: 5, reserved: 0 } });
      // an expiring quote
      await db.salesDocument.create({
        data: { type: 'QUOTE', number: `TEK-P10-${slug}`, partnerId, status: 'SENT', validUntil: new Date(Date.now() + 86_400_000) } as never,
      });
    });
    ops = new OpsService(prismaSvc, new AuditService(prismaSvc), new SettingsService(prismaSvc));
  });

  afterAll(async () => {
    if (!T) return;
    await sys(async () => {
      await db.salesDocumentLine.deleteMany({ where: { document: { tenantId: T } } });
      await db.salesDocument.deleteMany({ where: { tenantId: T } });
      await db.stockLevel.deleteMany({ where: { warehouseId: whId } });
      await db.product.deleteMany({ where: { tenantId: T } });
      await db.partnerContact.deleteMany({ where: { partner: { tenantId: T } } });
      await db.partnerAddress.deleteMany({ where: { partner: { tenantId: T } } });
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

  it('bildirimler gerçek veriden üretilir: kritik stok ve süresi dolan teklif', async () => {
    const res = await as(() => ops.notifications());
    const kinds = res.items.map((i) => i.kind);
    expect(kinds).toContain('STOCK_LOW');
    expect(kinds).toContain('QUOTE_EXPIRING');
    const stock = res.items.find((i) => i.kind === 'STOCK_LOW')!;
    expect(stock.detail).toContain(`P${slug}`);
    expect(stock.href).toBe('/stock/?belowMin=1');
  });

  it('EXPLAIN ana sorguları ölçer ve seq scan’i işaretler', async () => {
    const res = await as(() => ops.explain());
    expect(res.items.length).toBeGreaterThanOrEqual(5);
    expect(res.items.every((i) => typeof i.seqScan === 'boolean')).toBe(true);
    expect(res.items.some((i) => i.plan.length > 0)).toBe(true);
    expect(res.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('tablo istatistikleri boyut ve satır tahmini döner', async () => {
    const res = await as(() => ops.dbStats());
    expect(res.tables.length).toBeGreaterThan(0);
    expect(res.tables[0]!.total_size).toMatch(/(kB|MB|bytes|GB)/);
  });

  it('KVKK saklama süresi kaydedilir, önizleme silmez', async () => {
    const saved = await as(() => ops.setRetention({ auditLogDays: 30 }));
    expect(saved.auditLogDays).toBe(30);

    const before = await as(() => db.auditLog.count());
    const preview = await as(() => ops.runRetention(false));
    expect(preview.applied).toBe(false);
    expect(preview.plan.length).toBeGreaterThan(0);
    expect(await as(() => db.auditLog.count())).toBe(before);
  });

  it('kişisel veri dışa aktarımı cari ve kullanıcı için çalışır', async () => {
    const p = await as(() => ops.personalData('partner', partnerId)) as Record<string, any>;
    expect(p.partner.contacts).toHaveLength(1);
    expect(p.partner.addresses[0].line1).toBe('Gizli Adres 1');

    const u = await as(() => ops.personalData('user', userId)) as Record<string, any>;
    expect(u.user.email).toContain('p10-');
    expect(Array.isArray(u.activity)).toBe(true);
  });

  it('KVKK silme: kişisel alanlar anonimleşir, kod ve belgeler kalır', async () => {
    await as(() => ops.anonymisePartner(partnerId, 'Müşteri silme talebi #123'));
    const p = await TenantContext.runAsync({ tenantId: T, userId, permissions: ALL, includeDeleted: true } as never,
      () => db.businessPartner.findFirst({ where: { id: partnerId }, include: { contacts: true, addresses: true } }));
    expect(p!.name).toMatch(/KVKK silindi/);
    expect(p!.phone).toBeNull();
    expect(p!.email).toBeNull();
    expect(p!.taxNumber).toBeNull();
    expect(p!.contacts).toHaveLength(0);
    expect(p!.addresses[0]!.line1).toBe('(silindi)');
    expect(p!.code).toBe(`C${slug}`);

    // the quote is a commercial record and stays
    const docs = await as(() => db.salesDocument.count({ where: { partnerId } }));
    expect(docs).toBeGreaterThan(0);

    const trail = await as(() => db.auditLog.findFirst({ where: { entityId: partnerId, entity: 'BusinessPartner' }, orderBy: { at: 'desc' } }));
    expect(JSON.stringify(trail!.diff)).toMatch(/Müşteri silme talebi #123/);
  });

  it('yedek tatbikatı raporu sayıları ve adımları verir', async () => {
    const res = await as(() => ops.backupReport());
    expect(res.counts.documents).toBeGreaterThan(0);
    expect(res.drill.length).toBeGreaterThanOrEqual(5);
    expect(res.note).toMatch(/kendi geri yükleyemez/);
  });
});
