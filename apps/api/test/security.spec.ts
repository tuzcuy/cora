/**
 * P03 security proof.
 *
 * Runs against a REAL Postgres given by TEST_DATABASE_URL. It creates two
 * throwaway tenants with unique slugs, works only inside them, and deletes
 * everything it created in afterAll — so it is safe on the shared demo DB.
 * Without TEST_DATABASE_URL the DB-backed suites are skipped with a message;
 * the static suites (route scan, cost stripping, diff masking) always run.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Controller, Get, Post, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { tenantExtension, TENANT_MODELS, TENANT_FREE_MODELS } from '../src/prisma/prisma-tenant.extension.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TenantContext, TenantContextMissingError } from '../src/common/context/tenant-context.js';
import { AuditService, buildDiff } from '../src/common/audit/audit.service.js';
import { DocumentNumberService } from '../src/common/numbering/document-number.service.js';
import { PermissionsGuard } from '../src/common/guards/permissions.guard.js';
import { CostFieldsInterceptor, stripCostFields } from '../src/common/interceptors/cost-fields.interceptor.js';
import { ProblemJsonFilter } from '../src/common/filters/problem.filter.js';
import { RequirePermission } from '../src/common/decorators/permissions.decorator.js';
import { assertWriteRoutesGuarded, scanWriteRoutes } from '../src/common/security/write-route-scan.js';
import { BrandsService } from '../src/modules/brands/brands.service.js';
import { referencesOf } from '../src/common/crud/base-crud.service.js';
import { BrandsController } from '../src/modules/brands/brands.controller.js';
import { CategoriesController } from '../src/modules/categories/categories.controller.js';
import { UnitsController } from '../src/modules/units/units.controller.js';
import { WarehousesController } from '../src/modules/warehouses/warehouses.controller.js';
import { PartnerGroupsController } from '../src/modules/partner-groups/partner-groups.controller.js';
import { ProductsController } from '../src/modules/products/products.controller.js';
import { PartnersController } from '../src/modules/partners/partners.controller.js';
import { SalesController } from '../src/modules/sales/sales.controller.js';
import { ReportsController } from '../src/modules/reports/reports.controller.js';
import { WarehouseController } from '../src/modules/warehouse/warehouse.controller.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const DB_URL = process.env.TEST_DATABASE_URL;
const dbDescribe = DB_URL ? describe : describe.skip;
if (!DB_URL) console.warn('TEST_DATABASE_URL yok — DB tabanlı güvenlik testleri atlanıyor.');

/* ------------------------------------------------------------------ harness */

function makeDb() {
  const base = new PrismaClient({ adapter: new PrismaPg(DB_URL!) });
  const db = base.$extends(tenantExtension());
  return { base, db };
}
type Db = ReturnType<typeof makeDb>['db'];

// Both await inside the store: a Prisma query only executes on `.then`, so the
// store must still be active at that moment (see TenantContext.runSystem).
// userId must reference a real User row: AuditLog.userId is a foreign key.
let currentUserId: string | undefined;
const inTenant = <T>(tenantId: string, fn: () => Promise<T>, extra: Record<string, unknown> = {}) =>
  TenantContext.runAsync({ tenantId, userId: currentUserId, ...extra }, fn);
const asSystem = <T>(fn: () => Promise<T>) => TenantContext.runSystem(fn);

/* ------------------------------------------------------------ static suites */

describe('4. Yazma uçları @RequirePermission taşıyor (rota taraması)', () => {
  const controllers = [
    BrandsController, CategoriesController, UnitsController, WarehousesController, PartnerGroupsController,
    ProductsController, PartnersController, SalesController, ReportsController, WarehouseController,
  ];

  it('mevcut her yazma ucu korumalı', () => {
    const routes = assertWriteRoutesGuarded(controllers);
    expect(routes.length).toBeGreaterThanOrEqual(20); // 5 CRUD × (POST, PATCH, DELETE, restore)
    expect(routes.every((r) => r.guarded || r.isPublic)).toBe(true);
  });

  it('korumasız bir yazma ucu tarama tarafından yakalanır', () => {
    @Controller('leaky')
    class LeakyController {
      @Post() create() { return 1; }
      @Get() read() { return 1; }
    }
    const routes = scanWriteRoutes([LeakyController]);
    expect(routes).toHaveLength(1);
    expect(routes[0]!.guarded).toBe(false);
    expect(() => assertWriteRoutesGuarded([LeakyController])).toThrow(/RequirePermission olmayan yazma uçları/);
  });
});

describe('5. cost.view yoksa maliyet alanları cevaptan SİLİNİR', () => {
  it('stripCostFields anahtarı tamamen kaldırır (null bırakmaz)', () => {
    const body = {
      items: [{ id: 'p1', salesPrice: '10', purchasePrice: '6', stock: { onHand: '1' }, nested: { profitLocal: '1', marginPct: '2' } }],
      kpis: { totalRevenue: '1', totalProfit: '2' },
    };
    const json = JSON.stringify(stripCostFields(body));
    for (const k of ['purchasePrice', 'profitLocal', 'marginPct', 'totalProfit']) expect(json).not.toContain(`"${k}"`);
    expect(json).toContain('"salesPrice"');
    expect(json).toContain('"totalRevenue"');
  });
});

describe('6b. Audit diff sadece değişen alanları içerir ve hassas alanları maskeler', () => {
  it('değişmeyen alanlar yok, passwordHash maskeli', () => {
    const diff = buildDiff(
      { name: 'A', passwordHash: 'h1', email: 'x@y', updatedAt: new Date(1) },
      { name: 'B', passwordHash: 'h2', email: 'x@y', updatedAt: new Date(2) },
    );
    expect(Object.keys(diff).sort()).toEqual(['name', 'passwordHash']);
    expect(diff.name).toEqual({ from: 'A', to: 'B' });
    expect(diff.passwordHash).toEqual({ from: '***', to: '***' });
    expect(JSON.stringify(diff)).not.toContain('h1');
  });
  it('token/secret içeren alan adları da maskelenir', () => {
    const diff = buildDiff({ apiToken: 't1', clientSecret: 's1' }, { apiToken: 't2', clientSecret: 's2' });
    expect(diff.apiToken).toEqual({ from: '***', to: '***' });
    expect(diff.clientSecret).toEqual({ from: '***', to: '***' });
  });
});

describe('Silme korumasının FK haritası (runtime DMMF konvansiyonla)', () => {
  it('Brand ← Product.brandId; Category ← Product.categoryId + Category.parentId; liste tarafı atlanır', () => {
    expect(referencesOf('Brand')).toEqual([{ model: 'Product', fk: 'brandId' }]);
    expect(referencesOf('Category')).toEqual(
      expect.arrayContaining([{ model: 'Category', fk: 'parentId' }, { model: 'Product', fk: 'categoryId' }]),
    );
    expect(referencesOf('Category')).toHaveLength(2);
    expect(referencesOf('Unit').map((r) => r.fk).sort()).toEqual(['packageUnitId', 'unitId']);
    expect(referencesOf('Warehouse').map((r) => r.model)).toEqual(
      expect.arrayContaining(['StockLevel', 'StockMovement', 'StockReceipt', 'SalesDocumentLine', 'Shipment', 'WarehouseTask']),
    );
    expect(referencesOf('PartnerGroup')).toEqual([{ model: 'BusinessPartner', fk: 'groupId' }]);
  });
});

describe('Extension model sınıflandırması DMMF’ten gelir', () => {
  it('tenantId taşıyan her model kapsamda, taşımayanlar beyaz listede', () => {
    expect(TENANT_MODELS.has('Brand')).toBe(true);
    expect(TENANT_MODELS.has('AuditLog')).toBe(true);
    expect(TENANT_FREE_MODELS.has('Permission')).toBe(true);
    expect(TENANT_FREE_MODELS.has('SalesDocumentLine')).toBe(true);
    expect([...TENANT_MODELS].some((m) => TENANT_FREE_MODELS.has(m))).toBe(false);
  });
});

/* ---------------------------------------------------------------- DB suites */

dbDescribe('Kiracı izolasyonu, audit, optimistic lock, numaralandırma, soft delete', () => {
  let base: PrismaClient;
  let db: Db;
  let A = '';
  let B = '';
  let brandB = '';
  let userA = '';
  const slug = randomUUID().slice(0, 8);

  // Minimal PrismaService stand-in: the services only touch `.db`.
  const prismaSvc = () => ({ db }) as unknown as PrismaService;
  let brands: BrandsService;
  let numbering: DocumentNumberService;

  beforeAll(async () => {
    ({ base, db } = makeDb());
    await base.$connect();
    const [ta, tb] = await asSystem(() =>
      Promise.all([
        db.tenant.create({ data: { name: `Test A ${slug}`, slug: `test-a-${slug}` } }),
        db.tenant.create({ data: { name: `Test B ${slug}`, slug: `test-b-${slug}` } }),
      ]),
    );
    A = ta.id;
    B = tb.id;
    // A real user for audit rows (passwordHash is any string here; login is not exercised).
    const u = await asSystem(() =>
      db.user.create({
        data: { tenantId: A, email: `audit-${slug}@test.local`, passwordHash: 'x', fullName: 'Test Kullanıcı' },
      }),
    );
    userA = u.id;
    currentUserId = userA;
    const audit = new AuditService(prismaSvc());
    brands = new BrandsService(prismaSvc(), audit);
    numbering = new DocumentNumberService(prismaSvc());
    // The extension injects tenantId at runtime; the static type still asks for it.
    const b = await inTenant(B, () => db.brand.create({ data: { name: 'B-Marka' } as never }));
    brandB = b.id;
  });

  afterAll(async () => {
    if (!base) return;
    await asSystem(async () => {
      for (const t of [A, B]) {
        if (!t) continue;
        await db.auditLog.deleteMany({ where: { tenantId: t } });
        await db.documentSequence.deleteMany({ where: { tenantId: t } });
        // child rows created by the tenant-scoping tests
        await db.salesDocumentLine.deleteMany({ where: { document: { tenantId: t } } });
        await db.salesDocument.deleteMany({ where: { tenantId: t } });
        await db.partnerAddress.deleteMany({ where: { partner: { tenantId: t } } });
        await db.businessPartner.deleteMany({ where: { tenantId: t } });
        await db.stockLevel.deleteMany({ where: { product: { tenantId: t } } });
        await db.warehouse.deleteMany({ where: { tenantId: t } });
        await db.product.deleteMany({ where: { tenantId: t } });
        await db.unit.deleteMany({ where: { tenantId: t } });
        await db.brand.deleteMany({ where: { tenantId: t } });
        await db.userRole.deleteMany({ where: { user: { tenantId: t } } });
        await db.user.deleteMany({ where: { tenantId: t } });
        await db.tenant.delete({ where: { id: t } });
      }
    });
    await base.$disconnect();
  });

  describe('1. A kiracısı B’nin kaydını ID bilerek isterse bulamaz', () => {
    it('findMany B’yi listelemez', async () => {
      const rows = await inTenant(A, () => db.brand.findMany());
      expect(rows.some((r) => r.id === brandB)).toBe(false);
    });
    it('findFirst → null', async () => {
      expect(await inTenant(A, () => db.brand.findFirst({ where: { id: brandB } }))).toBeNull();
    });
    it('findUnique → null (extended where-unique ile tenantId eklenir)', async () => {
      expect(await inTenant(A, () => db.brand.findUnique({ where: { id: brandB } }))).toBeNull();
    });
    it('update → P2025 (kayıt yok), B’nin satırı değişmez', async () => {
      await expect(
        inTenant(A, () => db.brand.update({ where: { id: brandB }, data: { name: 'HACK' } })),
      ).rejects.toMatchObject({ code: 'P2025' });
      const still = await inTenant(B, () => db.brand.findFirst({ where: { id: brandB } }));
      expect(still?.name).toBe('B-Marka');
    });
    it('delete → P2025, B’nin satırı durur', async () => {
      await expect(inTenant(A, () => db.brand.delete({ where: { id: brandB } }))).rejects.toMatchObject({ code: 'P2025' });
      expect(await inTenant(B, () => db.brand.findFirst({ where: { id: brandB } }))).not.toBeNull();
    });
    it('servis katmanı: A, B’nin markasını güncellemeye kalkarsa 404', async () => {
      await expect(inTenant(A, () => brands.update(brandB, { name: 'X', version: 1 }, 1))).rejects.toMatchObject({ status: 404 });
    });
    it('create’te gönderilen yabancı tenantId ezilir', async () => {
      const row = await inTenant(A, () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db.brand.create({ data: { name: 'Sızma', tenantId: B } as any }),
      );
      expect(row.tenantId).toBe(A);
    });
  });

  describe('1b. tenantId taşımayan alt tablolar ebeveyn üzerinden kapsanır (P10)', () => {
    it('StockLevel doğrudan sorgulansa bile diğer kiracının satırı gelmez', async () => {
      const unitA = await inTenant(A, () => db.unit.create({ data: { code: 'ADET', name: 'Adet' } as never }));
      const unitB = await inTenant(B, () => db.unit.create({ data: { code: 'ADET', name: 'Adet' } as never }));
      const whA = await inTenant(A, () => db.warehouse.create({ data: { code: 'WA', name: 'A Depo' } as never }));
      const whB = await inTenant(B, () => db.warehouse.create({ data: { code: 'WB', name: 'B Depo' } as never }));
      const prodA = await inTenant(A, () => db.product.create({ data: { code: 'PA-SEC', name: 'A Ürün', unitId: unitA.id } as never }));
      const prodB = await inTenant(B, () => db.product.create({ data: { code: 'PB-SEC', name: 'B Ürün', unitId: unitB.id } as never }));
      await inTenant(A, () => db.stockLevel.create({ data: { productId: prodA.id, warehouseId: whA.id, onHand: 5, reserved: 0 } }));
      await inTenant(B, () => db.stockLevel.create({ data: { productId: prodB.id, warehouseId: whB.id, onHand: 7, reserved: 0 } }));

      const seenByA = await inTenant(A, () => db.stockLevel.findMany({ select: { productId: true } }));
      expect(seenByA.some((r) => r.productId === prodA.id)).toBe(true);
      expect(seenByA.some((r) => r.productId === prodB.id)).toBe(false);

      const countB = await inTenant(B, () => db.stockLevel.count());
      expect(countB).toBe(1);
    });

    it('SalesDocumentLine ve PartnerAddress da ebeveyn kiracısıyla sınırlanır', async () => {
      const partnerA = await inTenant(A, () => db.businessPartner.create({ data: { code: 'CA-SEC', name: 'A Cari', type: 'CUSTOMER' } as never }));
      const partnerB = await inTenant(B, () => db.businessPartner.create({ data: { code: 'CB-SEC', name: 'B Cari', type: 'CUSTOMER' } as never }));
      await inTenant(A, () => db.partnerAddress.create({ data: { partnerId: partnerA.id, type: 'SHIPPING', line1: 'A adres' } as never }));
      await inTenant(B, () => db.partnerAddress.create({ data: { partnerId: partnerB.id, type: 'SHIPPING', line1: 'B adres' } as never }));

      const addressesForA = await inTenant(A, () => db.partnerAddress.findMany({ select: { line1: true } }));
      expect(addressesForA.map((a) => a.line1)).toEqual(['A adres']);

      const docA = await inTenant(A, () => db.salesDocument.create({
        data: { type: 'QUOTE', number: 'TEK-SEC-A', partnerId: partnerA.id, lines: { create: [{ lineNo: 1, description: 'A satır', qty: 1, unitPrice: 1 }] } } as never,
      }));
      const docB = await inTenant(B, () => db.salesDocument.create({
        data: { type: 'QUOTE', number: 'TEK-SEC-B', partnerId: partnerB.id, lines: { create: [{ lineNo: 1, description: 'B satır', qty: 1, unitPrice: 1 }] } } as never,
      }));
      expect(docA.id).not.toBe(docB.id);

      const linesForA = await inTenant(A, () => db.salesDocumentLine.findMany({ select: { description: true } }));
      expect(linesForA.every((l) => l.description === 'A satır')).toBe(true);
    });
  });

  describe('2. TenantContext boşken sorgu hata fırlatır (sessiz geçiş yok)', () => {
    it('bağlam yok → TenantContextMissingError', async () => {
      await expect(TenantContext.runAsync({}, () => db.brand.findMany())).rejects.toBeInstanceOf(TenantContextMissingError);
    });
    it('hiç store yok → yine hata', async () => {
      await expect(db.brand.count()).rejects.toBeInstanceOf(TenantContextMissingError);
    });
    it('kiracı bağımsız model (Permission) bağlam istemez', async () => {
      await expect(TenantContext.runAsync({}, () => db.permission.count())).resolves.toBeTypeOf('number');
    });
  });

  describe('6. Güncelleme AuditLog satırı üretir, diff doğru', () => {
    it('create + update → iki satır, update diff yalnız name', async () => {
      const created = await inTenant(A, () => brands.create({ name: 'Audit-1' }));
      await inTenant(A, () => brands.update(created.id as string, { name: 'Audit-2', version: 1 }, 1));
      const logs = await inTenant(A, () =>
        db.auditLog.findMany({ where: { entity: 'Brand', entityId: created.id as string }, orderBy: { at: 'asc' } }),
      );
      expect(logs.map((l) => l.action)).toEqual(['create', 'update']);
      const diff = logs[1]!.diff as Record<string, { from: unknown; to: unknown }>;
      expect(Object.keys(diff)).toEqual(['name']);
      expect(diff.name).toEqual({ from: 'Audit-1', to: 'Audit-2' });
      expect(logs[1]!.userId).toBe(userA);
    });
    it('audit satırı yazma ile aynı transaction’da: yazma geri alınırsa audit de yok', async () => {
      const created = await inTenant(A, () => brands.create({ name: 'Rollback-1' }));
      // Duplicate name → unique violation inside the tx → the whole tx (incl. audit) rolls back.
      await inTenant(A, () => brands.create({ name: 'Rollback-2' }));
      await expect(inTenant(A, () => brands.update(created.id as string, { name: 'Rollback-2', version: 1 }, 1))).rejects.toBeTruthy();
      const logs = await inTenant(A, () => db.auditLog.findMany({ where: { entity: 'Brand', entityId: created.id as string } }));
      expect(logs.map((l) => l.action)).toEqual(['create']);
    });
  });

  describe('7. Eski version ile update → 409', () => {
    it('ikinci güncelleme bayat version ile 409 + currentVersion döner', async () => {
      const row = await inTenant(A, () => brands.create({ name: 'Lock-1' }));
      await inTenant(A, () => brands.update(row.id as string, { name: 'Lock-2', version: 1 }, 1));
      const err = await inTenant(A, () => brands.update(row.id as string, { name: 'Lock-3', version: 1 }, 1)).catch((e) => e);
      expect(err.status).toBe(409);
      expect(err.getResponse().currentVersion).toBe(2);
      expect(err.getResponse().message).toMatch(/başkası tarafından değiştirildi/);
    });
  });

  describe('8. 50 paralel numara → tekrar yok', () => {
    it('DocumentSequence FOR UPDATE ile seri ve boşluksuz', async () => {
      const year = 2099;
      const results = await inTenant(A, () =>
        Promise.all(
          Array.from({ length: 50 }, () =>
            db.$transaction((tx) => numbering.next(tx as unknown as Prisma.TransactionClient, 'QUOTE', { year }), {
              // 50 writers share a 10-connection pool and serialise on the row lock — queue, don't give up.
              maxWait: 60_000,
              timeout: 60_000,
            }),
          ),
        ),
      );
      const numbers = results.map((r) => r.number);
      expect(new Set(numbers).size).toBe(50);
      const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
      expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
      expect(numbers[0]).toMatch(/^TEK2099-\d{4}$/);
    });
  });

  describe('9. Soft delete edilen kayıt listede görünmez', () => {
    it('softDelete sonrası findMany/findFirst boş, withDeleted ile görünür, restore geri getirir', async () => {
      const row = await inTenant(A, () => brands.create({ name: 'Soft-1' }));
      await inTenant(A, () => brands.softDelete(row.id as string, 1));
      expect(await inTenant(A, () => db.brand.findFirst({ where: { id: row.id as string } }))).toBeNull();
      expect((await inTenant(A, () => db.brand.findMany())).some((b) => b.id === row.id)).toBe(false);
      const seen = await inTenant(A, () => TenantContext.withDeleted(() => db.brand.findFirst({ where: { id: row.id as string } })));
      expect(seen?.deletedAt).toBeInstanceOf(Date);
      const restored = await inTenant(A, () => brands.restore(row.id as string));
      expect(restored.deletedAt).toBeNull();
    });
    it('kullanımdaki marka silinemez (409, hangi kayıtların bağlı olduğunu söyler)', async () => {
      const brand = await inTenant(A, () => brands.create({ name: 'InUse-1' }));
      const unit = await inTenant(A, () => db.unit.create({ data: { code: `U${slug}`, name: 'Adet' } as never }));
      await inTenant(A, () =>
        db.product.create({ data: { code: `P${slug}`, name: 'Ürün', unitId: unit.id, brandId: brand.id as string } as never }),
      );
      const err = await inTenant(A, () => brands.softDelete(brand.id as string)).catch((e) => e);
      expect(err.status).toBe(409);
      expect(err.getResponse().message).toMatch(/kullanımda/);
      expect(err.getResponse().message).toMatch(/1 ürün/);
      await asSystem(async () => {
        await db.product.deleteMany({ where: { tenantId: A } });
        await db.unit.deleteMany({ where: { tenantId: A } });
      });
    });
  });

  describe('3. HTTP: yetkisiz kullanıcı POST atınca 403; cost.view yoksa alan yok', () => {
    /** Test-only guard: trusts x-test-perms so we never touch argon2/JWT. */
    @Injectable()
    class HeaderAuthGuard implements CanActivate {
      canActivate(ctx: ExecutionContext): boolean {
        const req = ctx.switchToHttp().getRequest();
        const perms = String(req.headers['x-test-perms'] ?? '').split(',').filter(Boolean);
        req.user = { userId: userA, tenantId: A, permissions: perms, modules: [] };
        TenantContext.set({ tenantId: A, userId: userA });
        return true;
      }
    }
    @Controller('cost-probe')
    class CostProbeController {
      @Get() @RequirePermission('product.read')
      read() { return { items: [{ id: 'x', salesPrice: '10', purchasePrice: '6', marginPct: '40' }] }; }
      @Post() @RequirePermission('product.write')
      write() { return { ok: true }; }
    }

    let url = '';
    let close: () => Promise<void> = async () => {};

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [BrandsController, CostProbeController],
        providers: [
          { provide: PrismaService, useValue: prismaSvc() },
          AuditService,
          BrandsService,
          { provide: APP_GUARD, useClass: HeaderAuthGuard },
          { provide: APP_GUARD, useClass: PermissionsGuard },
          { provide: APP_INTERCEPTOR, useClass: CostFieldsInterceptor },
        ],
      }).compile();
      const app = moduleRef.createNestApplication({ logger: false });
      app.use((_req: unknown, _res: unknown, next: () => void) => TenantContext.run({}, next));
      app.useGlobalFilters(new ProblemJsonFilter());
      await app.listen(0);
      const port = (app.getHttpServer().address() as AddressInfo).port;
      url = `http://127.0.0.1:${port}`;
      close = () => app.close();
    });
    afterAll(async () => close());

    type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const call = (path: string, init: RequestInit & { perms?: string } = {}) =>
      fetch(url + path, {
        ...init,
        headers: { 'content-type': 'application/json', 'x-test-perms': init.perms ?? '', ...(init.headers ?? {}) },
      });

    it('product.write olmayan kullanıcı POST /brands → 403 problem+json', async () => {
      const res = await call('/brands', { method: 'POST', body: JSON.stringify({ name: 'Yetkisiz' }), perms: 'product.read' });
      expect(res.status).toBe(403);
      expect(res.headers.get('content-type')).toContain('application/problem+json');
      const body = (await res.json()) as Json;
      expect(body.detail).toMatch(/Yetki yok: product.write/);
    });
    it('yetkili kullanıcı POST /brands → 201 ve audit satırı', async () => {
      const res = await call('/brands', { method: 'POST', body: JSON.stringify({ name: `HTTP-${slug}` }), perms: 'product.write' });
      expect(res.status).toBe(201);
      const body = (await res.json()) as Json;
      expect(body.version).toBe(1);
      const log = await inTenant(A, () => db.auditLog.findFirst({ where: { entity: 'Brand', entityId: body.id } }));
      expect(log?.action).toBe('create');
      expect(log?.userId).toBe(userA);
    });
    it('doğrulama hatası alan bazlı errors haritası döner', async () => {
      const res = await call('/brands', { method: 'POST', body: JSON.stringify({ name: '' }), perms: 'product.write' });
      expect(res.status).toBe(400);
      const body = (await res.json()) as Json;
      expect(body.errors).toEqual({ name: 'Marka adı gerekli' });
    });
    it('cost.view yoksa purchasePrice/marginPct anahtarı JSON’da HİÇ yok', async () => {
      const res = await call('/cost-probe', { perms: 'product.read' });
      const text = await res.text();
      expect(text).not.toContain('"purchasePrice"');
      expect(text).not.toContain('"marginPct"');
      expect(text).toContain('"salesPrice"');
    });
    it('cost.view varsa alanlar gelir', async () => {
      const res = await call('/cost-probe', { perms: 'product.read,cost.view' });
      expect(await res.text()).toContain('"purchasePrice"');
    });
  });
});
