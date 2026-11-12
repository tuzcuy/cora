/**
 * P08 proof: user lifecycle without deletion, the role/permission matrix,
 * company settings feeding the PDF, exchange rates, and the audit viewer.
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
import { AdminService, PERMISSION_GROUPS } from '../src/modules/admin/admin.service.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const DB_URL = process.env.TEST_DATABASE_URL;
const dbDescribe = DB_URL ? describe : describe.skip;

const ADMIN: Permission[] = ['user.manage', 'settings.manage', 'audit.read', 'product.read'];
/** Fake hasher: argon2's native module segfaults in this runner. */
const hash = async (plain: string) => `hashed:${plain}`;

describe('Yetki matrisi kataloğu', () => {
  it('her grup dolu ve kodlar benzersiz', () => {
    const codes = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.code));
    expect(new Set(codes).size).toBe(codes.length);
    expect(PERMISSION_GROUPS.every((g) => g.permissions.length > 0)).toBe(true);
  });
});

dbDescribe('P08 — yönetim', () => {
  const base = new PrismaClient({ adapter: new PrismaPg(DB_URL!) });
  const db = base.$extends(tenantExtension());
  const prismaSvc = { db } as unknown as PrismaService;
  const slug = randomUUID().slice(0, 8);
  let T = '', adminId = '', roleId = '', createdUserId = '';
  let admin: AdminService;

  const as = <R>(fn: () => Promise<R>) => TenantContext.runAsync({ tenantId: T, userId: adminId, permissions: ADMIN }, fn);
  const sys = <R>(fn: () => Promise<R>) => TenantContext.runSystem(fn);

  beforeAll(async () => {
    await base.$connect();
    const t = await sys(() => db.tenant.create({ data: { name: `P08 ${slug}`, slug: `p08-${slug}` } }));
    T = t.id;
    adminId = (await sys(() => db.user.create({ data: { tenantId: T, email: `p08-${slug}@test.local`, passwordHash: 'x', fullName: 'P08 Yönetici' } }))).id;
    await as(async () => {
      const role = await db.role.create({ data: { name: 'Satış', isSystem: false } as never });
      roleId = role.id;
      // the permission catalogue is global (no tenantId), seeded by seed-permissions
      for (const code of ['quote.read', 'quote.write', 'order.read']) {
        await sys(() => db.permission.upsert({ where: { code }, update: {}, create: { code, group: 'sales' } as never }));
      }
    });
    admin = new AdminService(prismaSvc, new AuditService(prismaSvc));
  });

  afterAll(async () => {
    if (!T) return;
    await sys(async () => {
      await db.auditLog.deleteMany({ where: { tenantId: T } });
      await db.rolePermission.deleteMany({ where: { role: { tenantId: T } } });
      await db.userRole.deleteMany({ where: { role: { tenantId: T } } });
      await db.role.deleteMany({ where: { tenantId: T } });
      await db.exchangeRate.deleteMany({ where: { tenantId: T } });
      await db.setting.deleteMany({ where: { tenantId: T } });
      await db.user.deleteMany({ where: { tenantId: T } });
      await db.tenant.delete({ where: { id: T } });
    });
    await base.$disconnect();
  });

  it('kullanıcı eklenir, şifre bir kez döner, aynı e-posta reddedilir', async () => {
    const created = await as(() => admin.createUser({ email: `sat-${slug}@test.local`, fullName: 'Satış Temsilcisi', roleIds: [roleId] } as never, hash));
    createdUserId = created.id;
    expect(created.generatedPassword).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const dup = await as(() => admin.createUser({ email: `sat-${slug}@test.local`, fullName: 'Kopya' } as never, hash)).catch((e) => e);
    expect(JSON.stringify(dup.getResponse?.() ?? dup.message)).toMatch(/zaten kayıtlı/);

    const list = await as(() => admin.users({ includeInactive: true }));
    const row = list.items.find((u) => u.id === createdUserId)!;
    expect(row.roles.map((r) => r.name)).toContain('Satış');
  });

  it('şifre sıfırlama yeni şifre döner, hash değişir', async () => {
    const before = await as(() => db.user.findFirst({ where: { id: createdUserId }, select: { passwordHash: true } }));
    const res = await as(() => admin.resetPassword(createdUserId, hash));
    expect(res.password).toBeTruthy();
    const after = await as(() => db.user.findFirst({ where: { id: createdUserId }, select: { passwordHash: true } }));
    expect(after!.passwordHash).not.toBe(before!.passwordHash);
  });

  it('kullanıcı silinmez, pasifleşir; kendi hesabını pasifleştiremez', async () => {
    await as(() => admin.deactivateUser(createdUserId));
    const row = await as(() => db.user.findFirst({ where: { id: createdUserId }, select: { isActive: true } }));
    expect(row!.isActive).toBe(false);

    const self = await as(() => admin.deactivateUser(adminId)).catch((e) => e);
    expect(JSON.stringify(self.getResponse?.() ?? self.message)).toMatch(/Kendi hesabınızı/);
  });

  it('rol yetkileri yazılır, bilinmeyen kod reddedilir', async () => {
    const res = await as(() => admin.setRolePermissions(roleId, { permissions: ['quote.read', 'quote.write'] }));
    const role = res.items.find((r) => r.id === roleId)!;
    expect(role.permissions.sort()).toEqual(['quote.read', 'quote.write']);

    const bad = await as(() => admin.setRolePermissions(roleId, { permissions: ['uydurma.izin'] })).catch((e) => e);
    expect(JSON.stringify(bad.getResponse?.() ?? bad.message)).toMatch(/Bilinmeyen yetki/);
  });

  it('ayarlar kaydedilir ve varsayılanlarla birleşir', async () => {
    const saved = await as(() => admin.saveSettings({
      company: { name: 'Test Toptan A.Ş.', taxNumber: '1234567890' },
      minMarginPct: 12,
    } as never));
    expect((saved.company as Record<string, string>).name).toBe('Test Toptan A.Ş.');
    expect(saved.minMarginPct).toBe(12);
    // untouched keys keep their defaults
    expect(saved.quoteValidityDays).toBe(15);
    expect((saved.numberPrefixes as Record<string, string>).QUOTE).toBe('TEK');
  });

  it('kur elle girilir ve son kur listelenir', async () => {
    await as(() => admin.setRate({ currency: 'USD', rate: 41.25 } as never));
    const rates = await as(() => admin.rates(30));
    expect(rates.items[0]!.currency).toBe('USD');
    expect(Number(rates.latest.USD)).toBeCloseTo(41.25, 2);
  });

  it('audit görüntüleyici kayıtları ve tip fasetlerini döner', async () => {
    const log = await as(() => admin.auditLog({ page: 1, pageSize: 20 } as never));
    expect(log.total).toBeGreaterThan(0);
    expect(log.items[0]!.at).toBeInstanceOf(Date);
    expect(log.facets.entities.length).toBeGreaterThan(0);

    const filtered = await as(() => admin.auditLog({ entity: 'User', page: 1, pageSize: 20 } as never));
    expect(filtered.items.every((i) => i.entity === 'User')).toBe(true);
  });
});
