import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildSearchText } from '@cora/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { SettingsService } from '../../common/settings/settings.service.js';
import type {
  CreatePartnerDto,
  PartnerBalanceDto,
  UpdatePartnerDto,
} from './dto/partner-write.dto.js';

const money4 = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(Number(v).toFixed(4));

/** Statuses whose value counts as outstanding risk (not yet invoiced/paid). */
const OPEN_STATUSES = ['APPROVED', 'SENT_TO_WAREHOUSE', 'PICKING', 'READY', 'PARTIALLY_SHIPPED', 'SHIPPED'];

/**
 * Partner write path and credit risk (P07). Contacts and addresses are replaced
 * wholesale in one save, the way the form submits them, and every write goes
 * through AuditLog with the version lock the rest of the app uses.
 */
@Injectable()
export class PartnerWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  private searchText(p: { code: string; name: string; name2?: string | null; taxNumber?: string | null; city?: string | null; phone?: string | null }) {
    return buildSearchText([p.code, p.name, p.name2, p.taxNumber, p.city, p.phone]);
  }

  async create(dto: CreatePartnerDto) {
    const id = await this.prisma.db.$transaction(async (tx) => {
      const clash = await tx.businessPartner.findFirst({ where: { code: dto.code }, select: { id: true } });
      if (clash) throw new ConflictException({ errors: { code: 'Bu cari kodu zaten kullanılıyor' } });

      const created = await tx.businessPartner.create({
        data: {
          code: dto.code,
          name: dto.name,
          name2: dto.name2 ?? null,
          type: dto.type ?? 'CUSTOMER',
          groupId: dto.groupId ?? null,
          taxOffice: dto.taxOffice ?? null,
          taxNumber: dto.taxNumber ?? null,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          website: dto.website ?? null,
          city: dto.city ?? null,
          country: dto.country ?? 'TR',
          currency: dto.currency ?? 'TRY',
          paymentTermDays: dto.paymentTermDays ?? 0,
          paymentTerms: dto.paymentTerms ?? null,
          salesRepId: dto.salesRepId ?? null,
          priceListId: dto.priceListId ?? null,
          defaultDiscountRate: dto.defaultDiscountRate != null ? money4(dto.defaultDiscountRate) : null,
          creditLimit: dto.creditLimit != null ? money4(dto.creditLimit) : null,
          openingBalance: dto.openingBalance != null ? money4(dto.openingBalance) : null,
          externalBalance: dto.externalBalance != null ? money4(dto.externalBalance) : null,
          notes: dto.notes ?? null,
          tags: dto.tags ?? [],
          isActive: dto.isActive ?? true,
          searchText: this.searchText(dto),
          contacts: { create: (dto.contacts ?? []).map((c) => ({ ...c, isPrimary: c.isPrimary ?? false })) },
          addresses: { create: (dto.addresses ?? []).map((a) => ({ ...a, isDefault: a.isDefault ?? false })) },
        } as never,
      });
      await this.audit.record({ entity: 'BusinessPartner', entityId: created.id, action: 'create', after: { code: dto.code, name: dto.name } }, tx as never);
      return created.id;
    });
    return this.detail(id);
  }

  async update(id: string, dto: UpdatePartnerDto) {
    await this.prisma.db.$transaction(async (tx) => {
      const before = await tx.businessPartner.findFirst({ where: { id } });
      if (!before) throw new NotFoundException('Cari bulunamadı');
      if (before.version !== dto.version) {
        throw new ConflictException({ title: 'Kayıt değişti', currentVersion: before.version });
      }
      if (dto.code && dto.code !== before.code) {
        const clash = await tx.businessPartner.findFirst({ where: { code: dto.code, id: { not: id } }, select: { id: true } });
        if (clash) throw new ConflictException({ errors: { code: 'Bu cari kodu zaten kullanılıyor' } });
      }

      const data: Prisma.BusinessPartnerUncheckedUpdateInput = { version: { increment: 1 } };
      for (const k of ['code', 'name', 'name2', 'type', 'groupId', 'taxOffice', 'taxNumber', 'phone', 'email',
        'website', 'city', 'country', 'currency', 'paymentTerms', 'salesRepId', 'priceListId', 'notes', 'isActive'] as const) {
        if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k];
      }
      if (dto.paymentTermDays !== undefined) data.paymentTermDays = dto.paymentTermDays;
      if (dto.tags !== undefined) data.tags = dto.tags;
      for (const k of ['defaultDiscountRate', 'creditLimit', 'openingBalance', 'externalBalance'] as const) {
        if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k] == null ? null : money4(dto[k]!);
      }
      data.searchText = this.searchText({
        code: dto.code ?? before.code,
        name: dto.name ?? before.name,
        name2: dto.name2 ?? before.name2,
        taxNumber: dto.taxNumber ?? before.taxNumber,
        city: dto.city ?? before.city,
        phone: dto.phone ?? before.phone,
      });

      if (dto.contacts) {
        await tx.partnerContact.deleteMany({ where: { partnerId: id } });
        if (dto.contacts.length) {
          await tx.partnerContact.createMany({ data: dto.contacts.map((c) => ({ ...c, partnerId: id, isPrimary: c.isPrimary ?? false })) });
        }
      }
      if (dto.addresses) {
        // Addresses referenced by a document must survive an edit.
        const used = await tx.partnerAddress.findMany({
          where: { partnerId: id, OR: [{ shippedDocuments: { some: {} } }, { billedDocuments: { some: {} } }] },
          select: { id: true },
        });
        const keep = new Set(used.map((u) => u.id));
        const incoming = new Set(dto.addresses.filter((a) => a.id).map((a) => a.id!));
        await tx.partnerAddress.deleteMany({ where: { partnerId: id, id: { notIn: [...new Set([...keep, ...incoming])] } } });
        for (const a of dto.addresses) {
          const payload = {
            type: a.type ?? 'SHIPPING', title: a.title ?? null, line1: a.line1, line2: a.line2 ?? null,
            district: a.district ?? null, city: a.city ?? null, postalCode: a.postalCode ?? null,
            country: a.country ?? 'TR', isDefault: a.isDefault ?? false,
          };
          if (a.id) await tx.partnerAddress.update({ where: { id: a.id }, data: payload as never });
          else await tx.partnerAddress.create({ data: { partnerId: id, ...payload } as never });
        }
      }

      const after = await tx.businessPartner.update({ where: { id }, data });
      await this.audit.record({ entity: 'BusinessPartner', entityId: id, action: 'update', before: before as never, after: after as never }, tx as never);
    });
    return this.detail(id);
  }

  async remove(id: string, version?: number) {
    const partner = await this.db.businessPartner.findFirst({ where: { id }, select: { id: true, version: true } });
    if (!partner) throw new NotFoundException('Cari bulunamadı');
    if (version !== undefined && partner.version !== version) {
      throw new ConflictException({ title: 'Kayıt değişti', currentVersion: partner.version });
    }
    const docs = await this.db.salesDocument.count({ where: { partnerId: id } });
    if (docs > 0) throw new ConflictException(`Bu cariye bağlı ${docs} belge var; kart pasife alınabilir ama silinemez.`);
    await this.db.businessPartner.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, version: { increment: 1 } } });
    await this.audit.record({ entity: 'BusinessPartner', entityId: id, action: 'delete' });
    return { ok: true };
  }

  async detail(id: string) {
    const p = await this.db.businessPartner.findFirst({
      where: { id },
      include: {
        group: { select: { id: true, name: true } },
        salesRep: { select: { id: true, fullName: true } },
        priceList: { select: { id: true, name: true, currency: true } },
        contacts: { orderBy: { isPrimary: 'desc' } },
        addresses: { orderBy: [{ isDefault: 'desc' }, { type: 'asc' }] },
      },
    });
    if (!p) throw new NotFoundException('Cari bulunamadı');
    const risk = await this.risk(id);
    return {
      id: p.id, code: p.code, name: p.name, name2: p.name2, type: p.type, version: p.version,
      group: p.group, salesRep: p.salesRep, priceList: p.priceList,
      taxOffice: p.taxOffice, taxNumber: p.taxNumber, phone: p.phone, email: p.email, website: p.website,
      city: p.city, country: p.country, currency: p.currency,
      paymentTermDays: p.paymentTermDays, paymentTerms: p.paymentTerms,
      defaultDiscountRate: p.defaultDiscountRate?.toString() ?? null,
      creditLimit: p.creditLimit?.toString() ?? null,
      openingBalance: p.openingBalance?.toString() ?? null,
      externalBalance: p.externalBalance?.toString() ?? null,
      externalBalanceDate: p.externalBalanceDate,
      notes: p.notes, tags: p.tags, isActive: p.isActive,
      contacts: p.contacts,
      addresses: p.addresses,
      risk,
    };
  }

  /** Update just the balance fields (until accounting integration lands). */
  async setBalance(id: string, dto: PartnerBalanceDto) {
    const before = await this.db.businessPartner.findFirst({ where: { id }, select: { id: true, externalBalance: true } });
    if (!before) throw new NotFoundException('Cari bulunamadı');
    await this.db.businessPartner.update({
      where: { id },
      data: {
        externalBalance: money4(dto.externalBalance),
        externalBalanceDate: dto.asOf ?? new Date(),
        version: { increment: 1 },
      },
    });
    await this.audit.record({
      entity: 'BusinessPartner', entityId: id, action: 'update',
      diff: { externalBalance: { from: before.externalBalance?.toString() ?? null, to: String(dto.externalBalance) } },
    });
    return this.detail(id);
  }

  /* ────────────────────────── credit risk & statement ─────────────────── */

  /** Open exposure vs. limit, in the same shape the sales guard uses. */
  async risk(partnerId: string) {
    const partner = await this.db.businessPartner.findFirst({
      where: { id: partnerId },
      select: { creditLimit: true, externalBalance: true, openingBalance: true, paymentTermDays: true },
    });
    if (!partner) throw new NotFoundException('Cari bulunamadı');

    const open = await this.db.salesDocument.findMany({
      where: { partnerId, type: 'ORDER', status: { in: OPEN_STATUSES as never } },
      select: { grandTotalLocal: true },
    });
    const openTotal = open.reduce((a, d) => a + Number(d.grandTotalLocal), 0);
    const balance = Number(partner.externalBalance ?? 0) + Number(partner.openingBalance ?? 0);
    const limit = Number(partner.creditLimit ?? 0);
    const exposure = balance + openTotal;
    return {
      creditLimit: limit,
      balance,
      openOrders: openTotal,
      openOrderCount: open.length,
      exposure,
      available: limit > 0 ? limit - exposure : null,
      overLimit: limit > 0 && exposure > limit,
      usagePct: limit > 0 ? Math.round((exposure / limit) * 1000) / 10 : null,
      paymentTermDays: partner.paymentTermDays,
    };
  }

  /**
   * Account statement: opening balance, then every document that moves it
   * (orders and shipments as debit, returns as credit), with a running balance.
   */
  async statement(partnerId: string, opts: { dateFrom?: Date; dateTo?: Date } = {}) {
    const partner = await this.db.businessPartner.findFirst({
      where: { id: partnerId },
      select: { id: true, code: true, name: true, currency: true, openingBalance: true, externalBalance: true, creditLimit: true },
    });
    if (!partner) throw new NotFoundException('Cari bulunamadı');

    const where: Prisma.SalesDocumentWhereInput = {
      partnerId,
      type: { in: ['ORDER', 'RETURN'] },
      status: { notIn: ['DRAFT', 'CANCELLED', 'REJECTED'] as never },
    };
    if (opts.dateFrom || opts.dateTo) {
      where.date = {};
      if (opts.dateFrom) where.date.gte = opts.dateFrom;
      if (opts.dateTo) where.date.lte = new Date(opts.dateTo.getTime() + 86_399_999);
    }

    const docs = await this.db.salesDocument.findMany({
      where,
      orderBy: { date: 'asc' },
      take: 2000,
      select: { id: true, type: true, number: true, date: true, status: true, grandTotalLocal: true },
    });

    const opening = Number(partner.openingBalance ?? 0);
    let running = opening;
    const lines = docs.map((d) => {
      const amount = Number(d.grandTotalLocal);
      const debit = d.type === 'ORDER' ? amount : 0;
      const credit = d.type === 'RETURN' ? amount : 0;
      running += debit - credit;
      return {
        id: d.id, type: d.type, number: d.number, date: d.date, status: d.status,
        debit: debit.toFixed(2), credit: credit.toFixed(2), balance: running.toFixed(2),
      };
    });

    return {
      partner: { id: partner.id, code: partner.code, name: partner.name, currency: partner.currency },
      opening: opening.toFixed(2),
      closing: running.toFixed(2),
      totalDebit: lines.reduce((a, l) => a + Number(l.debit), 0).toFixed(2),
      totalCredit: lines.reduce((a, l) => a + Number(l.credit), 0).toFixed(2),
      lines,
      risk: await this.risk(partnerId),
    };
  }

  /** Partners at or over their limit — the risk screen's list. */
  async riskList(limitPct = 80) {
    const partners = await this.db.businessPartner.findMany({
      where: { creditLimit: { gt: 0 }, isActive: true },
      select: { id: true, code: true, name: true, city: true, creditLimit: true, externalBalance: true, openingBalance: true },
      take: 500,
    });
    const rows = [];
    for (const p of partners) {
      const open = await this.db.salesDocument.aggregate({
        where: { partnerId: p.id, type: 'ORDER', status: { in: OPEN_STATUSES as never } },
        _sum: { grandTotalLocal: true },
      });
      const exposure = Number(p.externalBalance ?? 0) + Number(p.openingBalance ?? 0) + Number(open._sum.grandTotalLocal ?? 0);
      const limit = Number(p.creditLimit ?? 0);
      const usage = limit > 0 ? (exposure / limit) * 100 : 0;
      if (usage >= limitPct) {
        rows.push({
          id: p.id, code: p.code, name: p.name, city: p.city,
          creditLimit: limit, exposure, usagePct: Math.round(usage * 10) / 10, overLimit: exposure > limit,
        });
      }
    }
    rows.sort((a, b) => b.usagePct - a.usagePct);
    return { items: rows, threshold: limitPct };
  }
}
