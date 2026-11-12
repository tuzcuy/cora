import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { SettingsService } from '../../common/settings/settings.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';

export interface Notification {
  id: string;
  kind: 'STOCK_LOW' | 'QUOTE_EXPIRING' | 'ORDER_WAITING' | 'CREDIT_OVER' | 'EDOC_STUCK';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  href: string;
  count?: number;
  at?: Date;
}

/** KVKK retention defaults, in days. Zero means "keep". */
const RETENTION_DEFAULTS = {
  auditLogDays: 730,
  emailLogDays: 365,
  /** Documents are commercial records: kept for the statutory 10 years. */
  documentDays: 3650,
  /** Deleted (soft) partner cards are purged after this long. */
  deletedPartnerDays: 365,
};

/**
 * Operations (P10): notifications, index/plan checks, KVKK retention and the
 * personal-data endpoints (export and erasure request), plus a backup drill
 * report the operator can actually act on.
 */
@Injectable()
export class OpsService {
  private readonly log = new Logger(OpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  /* ─────────────────────────── notifications ──────────────────────────── */

  /** Everything that needs someone's attention right now, newest first. */
  async notifications(): Promise<{ items: Notification[]; counts: Record<string, number> }> {
    const items: Notification[] = [];
    const now = new Date();

    // 1. Stock at or below the critical level.
    const levels = await this.db.stockLevel.findMany({
      select: { onHand: true, reserved: true, product: { select: { id: true, code: true, name: true, minStock: true } } },
      take: 5000,
    });
    const low = levels.filter((l) => Number(l.product.minStock) > 0 && Number(l.onHand) - Number(l.reserved) <= Number(l.product.minStock));
    if (low.length) {
      items.push({
        id: 'stock-low',
        kind: 'STOCK_LOW',
        severity: low.length > 20 ? 'critical' : 'warning',
        title: `${low.length} üründe kritik stok`,
        detail: low.slice(0, 3).map((l) => `${l.product.code} ${l.product.name}`).join(', ') + (low.length > 3 ? '…' : ''),
        href: '/stock/?belowMin=1',
        count: low.length,
      });
    }

    // 2. Quotes about to expire (or already past their date but still open).
    const soon = new Date(now.getTime() + 3 * 86_400_000);
    const expiring = await this.db.salesDocument.findMany({
      where: { type: 'QUOTE', status: { in: ['SENT', 'DRAFT', 'APPROVAL_PENDING'] as never }, validUntil: { not: null, lte: soon } },
      select: { id: true, number: true, validUntil: true, partner: { select: { name: true } } },
      orderBy: { validUntil: 'asc' },
      take: 50,
    });
    if (expiring.length) {
      items.push({
        id: 'quote-expiring',
        kind: 'QUOTE_EXPIRING',
        severity: 'warning',
        title: `${expiring.length} teklifin süresi doluyor`,
        detail: expiring.slice(0, 3).map((q) => `${q.number} · ${q.partner.name}`).join(', ') + (expiring.length > 3 ? '…' : ''),
        href: '/quotes/',
        count: expiring.length,
        at: expiring[0]?.validUntil ?? undefined,
      });
    }

    // 3. Orders sitting in the warehouse queue for more than a day.
    const yesterday = new Date(now.getTime() - 86_400_000);
    const waiting = await this.db.salesDocument.count({
      where: { type: 'ORDER', status: { in: ['SENT_TO_WAREHOUSE', 'PICKING'] as never }, updatedAt: { lt: yesterday } },
    });
    if (waiting) {
      items.push({
        id: 'order-waiting',
        kind: 'ORDER_WAITING',
        severity: waiting > 10 ? 'critical' : 'warning',
        title: `${waiting} sipariş depoda 24 saatten uzun bekliyor`,
        detail: 'Toplama başlamamış ya da tamamlanmamış siparişler.',
        href: '/warehouse/',
        count: waiting,
      });
    }

    // 4. Partners over their credit limit.
    const partners = await this.db.businessPartner.findMany({
      where: { creditLimit: { gt: 0 }, isActive: true },
      select: { id: true, name: true, creditLimit: true, externalBalance: true, openingBalance: true },
      take: 500,
    });
    let over = 0;
    for (const p of partners) {
      const open = await this.db.salesDocument.aggregate({
        where: { partnerId: p.id, type: 'ORDER', status: { in: ['APPROVED', 'SENT_TO_WAREHOUSE', 'PICKING', 'READY', 'PARTIALLY_SHIPPED', 'SHIPPED'] as never } },
        _sum: { grandTotalLocal: true },
      });
      const exposure = Number(p.externalBalance ?? 0) + Number(p.openingBalance ?? 0) + Number(open._sum.grandTotalLocal ?? 0);
      if (exposure > Number(p.creditLimit)) over += 1;
    }
    if (over) {
      items.push({
        id: 'credit-over',
        kind: 'CREDIT_OVER',
        severity: 'critical',
        title: `${over} cari kredi limitini aştı`,
        detail: 'Yeni sipariş onayı yönetici onayı isteyecek.',
        href: '/partners/risk/',
        count: over,
      });
    }

    // 5. e-Documents stuck in the queue.
    const stuck = await this.db.eDocument.count({ where: { status: { in: ['QUEUED', 'ERROR'] } } });
    if (stuck) {
      items.push({
        id: 'edoc-stuck',
        kind: 'EDOC_STUCK',
        severity: 'info',
        title: `${stuck} e-belge kuyrukta bekliyor`,
        detail: 'Entegratör bağlı değilse gönderim beklemededir.',
        href: '/edocs/',
        count: stuck,
      });
    }

    const counts = { critical: 0, warning: 0, info: 0 } as Record<string, number>;
    for (const i of items) counts[i.severity] = (counts[i.severity] ?? 0) + 1;
    return { items, counts };
  }

  /* ───────────────────────── performance checks ───────────────────────── */

  /**
   * Runs EXPLAIN ANALYZE on the queries the big screens use and reports the
   * planner's choice, so a missing index shows up as a sequential scan instead
   * of a slow page nobody can explain.
   */
  async explain(): Promise<{ items: { name: string; ms: number; plan: string; seqScan: boolean; rows: number }[]; totalMs: number }> {
    const tenantId = TenantContext.requireTenantId();
    const probes: { name: string; sql: Prisma.Sql }[] = [
      {
        name: 'Ürün arama (searchText + trigram)',
        sql: Prisma.sql`select id, code, name from "Product" where "tenantId" = ${tenantId} and "deletedAt" is null and "searchText" like ${'%bardak%'} order by name limit 50`,
      },
      {
        name: 'Belge listesi (tür + durum + tarih)',
        sql: Prisma.sql`select id, number, date from "SalesDocument" where "tenantId" = ${tenantId} and type = 'ORDER'::"SalesDocumentType" and "deletedAt" is null order by date desc limit 100`,
      },
      {
        name: 'Stok hareket defteri (ürün + depo)',
        sql: Prisma.sql`select id, qty, type from "StockMovement" where "tenantId" = ${tenantId} order by "createdAt" desc limit 100`,
      },
      {
        name: 'Cari arama',
        sql: Prisma.sql`select id, code, name from "BusinessPartner" where "tenantId" = ${tenantId} and "deletedAt" is null and "searchText" like ${'%otel%'} limit 50`,
      },
      {
        name: 'Belge satırları (belge başına)',
        sql: Prisma.sql`select l.id from "SalesDocumentLine" l join "SalesDocument" d on d.id = l."documentId" where d."tenantId" = ${tenantId} limit 200`,
      },
    ];

    const items: { name: string; ms: number; planMs: number; plan: string; seqScan: boolean; rows: number }[] = [];
    let totalMs = 0;
    for (const p of probes) {
      const started = Date.now();
      const rows = await this.prisma.db.$queryRaw<{ 'QUERY PLAN': string }[]>(
        Prisma.sql`explain (analyze, buffers, format text) ${p.sql}`,
      ).catch(() => [] as { 'QUERY PLAN': string }[]);
      const ms = Date.now() - started;
      totalMs += ms;
      const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
      const timeMatch = /actual time=[\d.]+\.\.([\d.]+)/.exec(plan);
      items.push({
        name: p.name,
        ms,
        planMs: Number(timeMatch?.[1] ?? 0),
        plan,
        seqScan: /Seq Scan/.test(plan),
        rows: Number(/rows=(\d+)/.exec(plan)?.[1] ?? 0),
      });
    }
    return { items, totalMs };
  }

  /** Row counts and table sizes — the "will this scale" answer in one call. */
  async dbStats() {
    const rows = await this.prisma.db.$queryRaw<{ table_name: string; row_estimate: number; total_size: string }[]>(Prisma.sql`
      select
        c.relname as table_name,
        c.reltuples::bigint as row_estimate,
        pg_size_pretty(pg_total_relation_size(c.oid)) as total_size
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by pg_total_relation_size(c.oid) desc
      limit 25
    `);
    const indexes = await this.prisma.db.$queryRaw<{ table_name: string; index_name: string; scans: number }[]>(Prisma.sql`
      select relname as table_name, indexrelname as index_name, idx_scan as scans
      from pg_stat_user_indexes
      order by idx_scan asc
      limit 25
    `);
    return {
      tables: rows.map((r) => ({ ...r, row_estimate: Number(r.row_estimate) })),
      unusedIndexes: indexes.filter((i) => Number(i.scans) === 0).map((i) => ({ ...i, scans: Number(i.scans) })),
    };
  }

  /* ──────────────────────────── KVKK / GDPR ───────────────────────────── */

  async retention() {
    const rows = await this.db.setting.findMany({ where: { key: 'retention' }, select: { value: true } });
    return { ...RETENTION_DEFAULTS, ...((rows[0]?.value ?? {}) as Record<string, number>) };
  }

  async setRetention(input: Partial<typeof RETENTION_DEFAULTS>) {
    const merged = { ...(await this.retention()), ...input };
    await this.db.setting.upsert({
      where: { tenantId_key: { tenantId: TenantContext.requireTenantId(), key: 'retention' } },
      update: { value: merged as Prisma.InputJsonValue },
      create: { key: 'retention', value: merged as Prisma.InputJsonValue } as never,
    });
    await this.audit.record({ entity: 'Setting', entityId: 'retention', action: 'update', diff: { retention: { from: null, to: merged } } });
    return merged;
  }

  /** What retention would delete today; `apply` actually deletes. */
  async runRetention(apply = false) {
    const policy = await this.retention();
    const cut = (days: number) => new Date(Date.now() - days * 86_400_000);
    const plan: { what: string; count: number }[] = [];

    const auditCount = policy.auditLogDays > 0 ? await this.db.auditLog.count({ where: { at: { lt: cut(policy.auditLogDays) } } }) : 0;
    plan.push({ what: `İşlem günlüğü (> ${policy.auditLogDays} gün)`, count: auditCount });

    const emailCount = policy.emailLogDays > 0 ? await this.db.emailLog.count({ where: { createdAt: { lt: cut(policy.emailLogDays) } } }) : 0;
    plan.push({ what: `E-posta günlüğü (> ${policy.emailLogDays} gün)`, count: emailCount });

    const partnerCount = policy.deletedPartnerDays > 0
      ? await TenantContext.withDeleted(() => this.db.businessPartner.count({ where: { deletedAt: { lt: cut(policy.deletedPartnerDays) } } }))
      : 0;
    plan.push({ what: `Silinmiş cari kartları (> ${policy.deletedPartnerDays} gün)`, count: partnerCount });

    if (!apply) return { applied: false, policy, plan };

    let deleted = 0;
    if (auditCount) deleted += (await this.db.auditLog.deleteMany({ where: { at: { lt: cut(policy.auditLogDays) } } })).count;
    if (emailCount) deleted += (await this.db.emailLog.deleteMany({ where: { createdAt: { lt: cut(policy.emailLogDays) } } })).count;
    await this.audit.record({ entity: 'Setting', entityId: 'retention', action: 'delete', diff: { deleted: { from: null, to: deleted } } });
    return { applied: true, policy, plan, deleted };
  }

  /**
   * KVKK data subject access: everything Cora holds about one partner or one
   * user, in one JSON payload.
   */
  async personalData(kind: 'partner' | 'user', id: string) {
    if (kind === 'partner') {
      const p = await this.db.businessPartner.findFirst({
        where: { id },
        include: { contacts: true, addresses: true },
      });
      if (!p) throw new BadRequestException({ errors: { id: 'Cari bulunamadı' } });
      const documents = await this.db.salesDocument.findMany({
        where: { partnerId: id },
        select: { id: true, type: true, number: true, date: true, status: true, grandTotal: true },
        take: 1000,
      });
      const emails = await this.db.emailLog.findMany({
        where: { documentId: { in: documents.map((d) => d.id) } },
        select: { to: true, subject: true, status: true, createdAt: true },
        take: 500,
      });
      await this.audit.record({ entity: 'BusinessPartner', entityId: id, action: 'read', diff: { kvkk: { from: null, to: 'kişisel veri dışa aktarımı' } } });
      return { kind, partner: p, documents, emails };
    }
    const u = await this.db.user.findFirst({
      where: { id },
      select: { id: true, email: true, fullName: true, phone: true, repCode: true, lastLoginAt: true, createdAt: true },
    });
    if (!u) throw new BadRequestException({ errors: { id: 'Kullanıcı bulunamadı' } });
    const activity = await this.db.auditLog.findMany({ where: { userId: id }, select: { entity: true, entityId: true, action: true, at: true, ip: true }, orderBy: { at: 'desc' }, take: 500 });
    await this.audit.record({ entity: 'User', entityId: id, action: 'read', diff: { kvkk: { from: null, to: 'kişisel veri dışa aktarımı' } } });
    return { kind, user: u, activity };
  }

  /**
   * KVKK erasure: personal fields of a partner card are anonymised while the
   * commercial documents (a statutory record) keep their totals.
   */
  async anonymisePartner(id: string, reason: string) {
    const p = await this.db.businessPartner.findFirst({ where: { id }, select: { id: true, code: true, name: true } });
    if (!p) throw new BadRequestException({ errors: { id: 'Cari bulunamadı' } });

    await this.prisma.db.$transaction(async (tx) => {
      await tx.partnerContact.deleteMany({ where: { partnerId: id } });
      await tx.partnerAddress.updateMany({ where: { partnerId: id }, data: { line1: '(silindi)', line2: null, postalCode: null } });
      await tx.businessPartner.update({
        where: { id },
        data: {
          name: `(KVKK silindi) ${p.code}`,
          name2: null, phone: null, email: null, website: null, notes: null,
          taxNumber: null, taxOffice: null,
          searchText: p.code.toLowerCase(),
          isActive: false,
          deletedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await this.audit.record({
        entity: 'BusinessPartner', entityId: id, action: 'update',
        diff: { kvkk: { from: p.name, to: '(KVKK silindi)' }, reason: { from: null, to: reason } },
      }, tx as never);
    });
    this.log.log(`KVKK anonimleştirme: ${p.code}`);
    return { ok: true, code: p.code };
  }

  /* ───────────────────────────── backup drill ─────────────────────────── */

  /**
   * Restore drill report: how much data exists, when the last write happened
   * and what the operator must do to prove a restore. Cora cannot restore the
   * managed database itself, so it reports rather than pretends.
   */
  async backupReport() {
    const [documents, movements, partners, products, lastDoc, lastMovement] = await Promise.all([
      this.db.salesDocument.count(),
      this.db.stockMovement.count(),
      this.db.businessPartner.count(),
      this.db.product.count(),
      this.db.salesDocument.findFirst({ orderBy: { createdAt: 'desc' }, select: { number: true, createdAt: true } }),
      this.db.stockMovement.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);
    const settings = await this.settings.sales();
    return {
      counts: { documents, movements, partners, products },
      lastWrite: {
        document: lastDoc ? { number: lastDoc.number, at: lastDoc.createdAt } : null,
        movement: lastMovement?.createdAt ?? null,
      },
      settings,
      drill: [
        'Render → Database → Backups: en son yedeği indir (ücretsiz katmanda günlük otomatik yedek).',
        'Yeni bir boş Postgres oluştur ve yedeği `pg_restore` ile geri yükle.',
        'DATABASE_URL’i geçici olarak kopyaya çevirip API’yi başlat.',
        'Bu ekrandaki sayıları karşılaştır: belge, hareket, cari ve ürün sayıları tutmalı.',
        'Son belge numarası ve son stok hareketi tarihi yedeğin tazeliğini gösterir.',
        'Doğrulama sonrası DATABASE_URL’i geri al; tatbikat tarihini karar günlüğüne yaz.',
      ],
      note: 'Cora yönetilen veritabanını kendi geri yükleyemez; bu rapor tatbikatı doğrulamak içindir.',
    };
  }
}
