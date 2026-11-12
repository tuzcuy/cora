import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PERMISSIONS, type Permission } from '@cora/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';
import type {
  AuditQuery,
  CreateUserDto,
  ExchangeRateDto,
  RolePermissionsDto,
  SettingsDto,
  UpdateUserDto,
} from './dto/admin.dto.js';

/** Turkish labels for the permission matrix, grouped the way the screen shows them. */
export const PERMISSION_GROUPS: { key: string; label: string; permissions: { code: Permission; label: string }[] }[] = [
  {
    key: 'catalog', label: 'Katalog',
    permissions: [
      { code: 'product.read', label: 'Ürünleri görüntüle' },
      { code: 'product.write', label: 'Ürün ekle/düzenle' },
      { code: 'product.import', label: 'Excel’den ürün aktar' },
    ],
  },
  {
    key: 'partner', label: 'Cariler',
    permissions: [
      { code: 'partner.read', label: 'Carileri görüntüle' },
      { code: 'partner.write', label: 'Cari ekle/düzenle' },
      { code: 'partner.import', label: 'Excel’den cari aktar' },
      { code: 'partner.override_credit', label: 'Kredi limitini aşan belgeyi onayla' },
    ],
  },
  {
    key: 'sales', label: 'Satış',
    permissions: [
      { code: 'quote.read', label: 'Teklifleri görüntüle' },
      { code: 'quote.write', label: 'Teklif yaz' },
      { code: 'quote.send', label: 'Teklif gönder' },
      { code: 'quote.approve', label: 'Teklif onayla' },
      { code: 'order.read', label: 'Siparişleri görüntüle' },
      { code: 'order.write', label: 'Sipariş yaz' },
      { code: 'order.cancel', label: 'Sipariş iptal et' },
      { code: 'order.edit_approved', label: 'Onaylı belgeyi düzenle' },
      { code: 'sales.view_all', label: 'Tüm temsilcilerin belgelerini gör' },
      { code: 'sales.approve_low_margin', label: 'Düşük marjlı belgeyi onayla' },
      { code: 'return.write', label: 'İade belgesi' },
    ],
  },
  {
    key: 'stock', label: 'Stok ve depo',
    permissions: [
      { code: 'stock.read', label: 'Stoğu görüntüle' },
      { code: 'stock.receive', label: 'Giriş fişi' },
      { code: 'stock.adjust', label: 'Stok düzeltme' },
      { code: 'stock.transfer', label: 'Depo transferi' },
      { code: 'stock.count', label: 'Sayım' },
      { code: 'warehouse.pick', label: 'Toplama' },
      { code: 'shipment.create', label: 'İrsaliye oluştur' },
      { code: 'shipment.post', label: 'İrsaliye işle' },
      { code: 'shipment.cancel', label: 'İrsaliye iptal' },
    ],
  },
  {
    key: 'admin', label: 'Yönetim',
    permissions: [
      { code: 'cost.view', label: 'Maliyet ve kâr gör' },
      { code: 'report.view', label: 'Raporlar' },
      { code: 'export.excel', label: 'Excel’e aktar' },
      { code: 'user.manage', label: 'Kullanıcı ve rol yönetimi' },
      { code: 'settings.manage', label: 'Ayarlar' },
      { code: 'audit.read', label: 'İşlem günlüğü' },
    ],
  },
];

/** Settings the admin screen edits, with defaults. */
const SETTING_DEFAULTS: Record<string, unknown> = {
  allowNegativeStock: false,
  minMarginPct: 15,
  defaultVatRate: 20,
  quoteValidityDays: 15,
  autoSendToWarehouse: true,
  vatRates: [1, 10, 20],
  numberPrefixes: { QUOTE: 'TEK', ORDER: 'SIP', SHIPMENT: 'IRS', STOCK_RECEIPT: 'GIR', STOCK_COUNT: 'SAY', RETURN: 'IAD' },
  company: { name: '', address: '', phone: '', email: '', web: '', taxOffice: '', taxNumber: '', logo: '' },
  bank: { name: '', branch: '', iban: '', accountName: '' },
};

const TCMB_URL = 'https://www.tcmb.gov.tr/kurlar/today.xml';

/**
 * Administration (P08): users, the role/permission matrix, company and document
 * settings, exchange rates and the audit trail viewer.
 *
 * Password hashing is delegated to a callback so this service never imports
 * argon2 directly — the native module segfaults in this environment's test
 * runner, and the auth module already owns hashing.
 */
@Injectable()
export class AdminService {
  private readonly log = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  /* ─────────────────────────────── users ──────────────────────────────── */

  async users(q: { q?: string; includeInactive?: boolean } = {}) {
    const where: Prisma.UserWhereInput = {};
    if (!q.includeInactive) where.isActive = true;
    if (q.q?.trim()) {
      where.OR = [
        { fullName: { contains: q.q.trim(), mode: 'insensitive' } },
        { email: { contains: q.q.trim(), mode: 'insensitive' } },
      ];
    }
    const users = await this.db.user.findMany({
      where,
      orderBy: { fullName: 'asc' },
      select: {
        id: true, email: true, fullName: true, phone: true, isActive: true, repCode: true, lastLoginAt: true,
        roles: { select: { role: { select: { id: true, name: true } } } },
      },
    });
    return {
      items: users.map((u) => ({
        id: u.id, email: u.email, fullName: u.fullName, phone: u.phone,
        isActive: u.isActive, repCode: u.repCode, lastLoginAt: u.lastLoginAt,
        roles: u.roles.map((r) => r.role),
      })),
      total: users.length,
    };
  }

  async createUser(dto: CreateUserDto, hash: (plain: string) => Promise<string>) {
    const exists = await this.db.user.findFirst({ where: { email: dto.email }, select: { id: true } });
    if (exists) throw new ConflictException({ errors: { email: 'Bu e-posta zaten kayıtlı' } });

    const password = dto.password ?? this.randomPassword();
    const user = await this.prisma.db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: dto.email, fullName: dto.fullName, phone: dto.phone ?? null,
          repCode: dto.repCode ?? null, isActive: dto.isActive ?? true,
          passwordHash: await hash(password),
        } as never,
      });
      for (const roleId of dto.roleIds ?? []) {
        await tx.userRole.create({ data: { userId: u.id, roleId } as never });
      }
      await this.audit.record({ entity: 'User', entityId: u.id, action: 'create', after: { email: dto.email, fullName: dto.fullName, roles: (dto.roleIds ?? []).length } }, tx as never);
      return u;
    });
    // The generated password is returned exactly once, never stored in the clear.
    return { id: user.id, email: user.email, fullName: user.fullName, generatedPassword: dto.password ? null : password };
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await tx.user.findFirst({ where: { id }, include: { roles: true } });
      if (!before) throw new NotFoundException('Kullanıcı bulunamadı');
      if (dto.email && dto.email !== before.email) {
        const clash = await tx.user.findFirst({ where: { email: dto.email, id: { not: id } }, select: { id: true } });
        if (clash) throw new ConflictException({ errors: { email: 'Bu e-posta zaten kayıtlı' } });
      }
      const data: Prisma.UserUncheckedUpdateInput = {};
      for (const k of ['email', 'fullName', 'phone', 'repCode', 'isActive'] as const) {
        if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k];
      }
      if (dto.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        for (const roleId of dto.roleIds) await tx.userRole.create({ data: { userId: id, roleId } as never });
      }
      const after = await tx.user.update({ where: { id }, data });
      await this.audit.record({ entity: 'User', entityId: id, action: 'update', before: before as never, after: after as never }, tx as never);
    });
    return this.users({ includeInactive: true });
  }

  /** Deactivate rather than delete: documents keep pointing at a real user. */
  async deactivateUser(id: string) {
    const me = TenantContext.getUserId();
    if (me === id) throw new BadRequestException({ errors: { id: 'Kendi hesabınızı pasifleştiremezsiniz' } });
    await this.db.user.update({ where: { id }, data: { isActive: false } });
    await this.audit.record({ entity: 'User', entityId: id, action: 'update', diff: { isActive: { from: true, to: false } } });
    return { ok: true };
  }

  async resetPassword(id: string, hash: (plain: string) => Promise<string>, password?: string) {
    const user = await this.db.user.findFirst({ where: { id }, select: { id: true, email: true } });
    if (!user) throw new NotFoundException('Kullanıcı bulunamadı');
    const plain = password ?? this.randomPassword();
    await this.db.user.update({ where: { id }, data: { passwordHash: await hash(plain) } });
    await this.audit.record({ entity: 'User', entityId: id, action: 'update', diff: { password: { from: '***', to: '*** (sıfırlandı)' } } });
    return { ok: true, email: user.email, password: password ? null : plain };
  }

  private randomPassword() {
    // Readable but random: 4 groups of 4 from an unambiguous alphabet.
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(16);
    const out = [...bytes].map((b) => abc[b % abc.length]).join('');
    return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
  }

  /* ────────────────────────── roles & permissions ─────────────────────── */

  async roles() {
    const roles = await this.db.role.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, isSystem: true,
        permissions: { select: { permissionCode: true } },
        _count: { select: { users: true } },
      },
    });
    return {
      groups: PERMISSION_GROUPS,
      items: roles.map((r) => ({
        id: r.id, name: r.name, isSystem: r.isSystem,
        userCount: r._count.users,
        permissions: r.permissions.map((p) => p.permissionCode),
      })),
    };
  }

  /** Replace a role's permission set; unknown codes are refused. */
  async setRolePermissions(roleId: string, dto: RolePermissionsDto) {
    const role = await this.db.role.findFirst({ where: { id: roleId }, select: { id: true, name: true } });
    if (!role) throw new NotFoundException('Rol bulunamadı');
    const unknown = dto.permissions.filter((c) => !(PERMISSIONS as readonly string[]).includes(c));
    if (unknown.length) throw new BadRequestException({ errors: { permissions: `Bilinmeyen yetki: ${unknown.join(', ')}` } });

    await this.prisma.db.$transaction(async (tx) => {
      const before = await tx.rolePermission.findMany({ where: { roleId }, select: { permissionCode: true } });
      const rows = await tx.permission.findMany({ where: { code: { in: dto.permissions } }, select: { code: true } });
      await tx.rolePermission.deleteMany({ where: { roleId } });
      for (const p of rows) await tx.rolePermission.create({ data: { roleId, permissionCode: p.code } as never });
      await this.audit.record({
        entity: 'Role', entityId: roleId, action: 'update',
        diff: { permissions: { from: before.map((b) => b.permissionCode).sort(), to: dto.permissions.slice().sort() } },
      }, tx as never);
    });
    return this.roles();
  }

  /* ──────────────────────────── settings ──────────────────────────────── */

  async settings() {
    const rows = await this.db.setting.findMany({ select: { key: true, value: true } });
    const bag: Record<string, unknown> = { ...SETTING_DEFAULTS };
    for (const r of rows) bag[r.key] = r.value;
    return bag;
  }

  async saveSettings(dto: SettingsDto) {
    const entries = Object.entries(dto).filter(([, v]) => v !== undefined);
    await this.prisma.db.$transaction(async (tx) => {
      for (const [key, value] of entries) {
        await tx.setting.upsert({
          where: { tenantId_key: { tenantId: TenantContext.requireTenantId(), key } },
          update: { value: value as Prisma.InputJsonValue },
          create: { key, value: value as Prisma.InputJsonValue } as never,
        });
      }
      await this.audit.record({ entity: 'Setting', entityId: 'tenant', action: 'update', diff: { keys: { from: null, to: entries.map(([k]) => k) } } }, tx as never);
    });
    return this.settings();
  }

  /* ────────────────────────── exchange rates ──────────────────────────── */

  async rates(days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.db.exchangeRate.findMany({
      where: { date: { gte: since } },
      orderBy: [{ date: 'desc' }, { currency: 'asc' }],
      take: 500,
    });
    return {
      items: rows.map((r) => ({ id: r.id, date: r.date, currency: r.currency, rate: r.rate.toString(), source: r.source })),
      latest: await this.latestRates(),
    };
  }

  async latestRates(): Promise<Record<string, string>> {
    const out: Record<string, string> = { TRY: '1' };
    for (const currency of ['USD', 'EUR'] as const) {
      const row = await this.db.exchangeRate.findFirst({ where: { currency }, orderBy: { date: 'desc' } });
      if (row) out[currency] = row.rate.toString();
    }
    return out;
  }

  async setRate(dto: ExchangeRateDto) {
    const date = dto.date ?? new Date();
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    await this.db.exchangeRate.upsert({
      where: { tenantId_date_currency: { tenantId: TenantContext.requireTenantId(), date: day, currency: dto.currency } },
      update: { rate: new Prisma.Decimal(dto.rate), source: 'MANUAL' },
      create: { date: day, currency: dto.currency, rate: new Prisma.Decimal(dto.rate), source: 'MANUAL' } as never,
    });
    await this.audit.record({ entity: 'ExchangeRate', entityId: `${dto.currency}:${day.toISOString().slice(0, 10)}`, action: 'update', diff: { rate: { from: null, to: dto.rate } } });
    return this.rates();
  }

  /**
   * Pull today's rates from the central bank. Parsed with a small regex rather
   * than an XML dependency; a failure is reported, never silently swallowed.
   */
  async fetchTcmb() {
    let xml: string;
    try {
      const res = await fetch(TCMB_URL, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`TCMB ${res.status}`);
      xml = await res.text();
    } catch (e) {
      this.log.warn(`TCMB kuru alınamadı: ${(e as Error).message}`);
      throw new BadRequestException({ errors: { tcmb: `TCMB’ye ulaşılamadı: ${(e as Error).message}` } });
    }

    const dateMatch = /Tarih="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
    const date = dateMatch
      ? new Date(Date.UTC(Number(dateMatch[3]), Number(dateMatch[2]) - 1, Number(dateMatch[1])))
      : new Date(new Date().toISOString().slice(0, 10));

    const saved: { currency: string; rate: string }[] = [];
    for (const currency of ['USD', 'EUR'] as const) {
      const block = new RegExp(`<Currency[^>]*CurrencyCode="${currency}"[\\s\\S]*?</Currency>`).exec(xml)?.[0];
      const rate = block ? /<ForexSelling>([\d.]+)<\/ForexSelling>/.exec(block)?.[1] : undefined;
      if (!rate) continue;
      await this.db.exchangeRate.upsert({
        where: { tenantId_date_currency: { tenantId: TenantContext.requireTenantId(), date, currency } },
        update: { rate: new Prisma.Decimal(rate), source: 'TCMB' },
        create: { date, currency, rate: new Prisma.Decimal(rate), source: 'TCMB' } as never,
      });
      saved.push({ currency, rate });
    }
    if (saved.length === 0) throw new BadRequestException({ errors: { tcmb: 'TCMB yanıtında kur bulunamadı' } });
    await this.audit.record({ entity: 'ExchangeRate', entityId: date.toISOString().slice(0, 10), action: 'create', diff: { tcmb: { from: null, to: saved } } });
    return { date, saved, ...(await this.rates()) };
  }

  /* ───────────────────────────── audit log ────────────────────────────── */

  async auditLog(q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {};
    if (q.entity) where.entity = q.entity;
    if (q.entityId) where.entityId = q.entityId;
    if (q.userId) where.userId = q.userId;
    if (q.action) where.action = { startsWith: q.action };
    if (q.dateFrom || q.dateTo) {
      where.at = {};
      if (q.dateFrom) where.at.gte = q.dateFrom;
      if (q.dateTo) where.at.lte = new Date(q.dateTo.getTime() + 86_399_999);
    }
    const [items, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        orderBy: { at: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true, entity: true, entityId: true, action: true, diff: true, ip: true, at: true,
          user: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.db.auditLog.count({ where }),
    ]);
    const entities = await this.db.auditLog.groupBy({ by: ['entity'], _count: { _all: true }, orderBy: { _count: { entity: 'desc' } }, take: 20 });
    return {
      items: items.map((a) => ({
        id: a.id, entity: a.entity, entityId: a.entityId, action: a.action,
        diff: a.diff, ip: a.ip, at: a.at,
        userName: a.user?.fullName ?? null, userEmail: a.user?.email ?? null,
      })),
      total, page: q.page, pageSize: q.pageSize,
      facets: { entities: entities.map((e) => ({ entity: e.entity, count: e._count._all })) },
    };
  }
}
