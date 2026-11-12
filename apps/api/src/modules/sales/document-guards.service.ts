import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { GuardContext, Permission } from '@cora/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../../common/settings/settings.service.js';

export interface GuardIssue {
  code: 'STOCK_SHORT' | 'CREDIT_LIMIT' | 'LOW_MARGIN' | 'NO_LINES';
  message: string;
  /** Machine-readable detail; cost-bearing keys are stripped by the interceptor. */
  meta?: Record<string, unknown>;
}

export interface GuardResult {
  ok: boolean;
  warnings: GuardIssue[];
  blockers: GuardIssue[];
  /** True when a manager (sales.approve_low_margin / partner.override_credit) must approve. */
  needsApproval: boolean;
  ctx: GuardContext;
}

/** Statuses whose lines hold stock reservations. */
export const RESERVING_STATUSES = new Set([
  'APPROVED', 'SENT_TO_WAREHOUSE', 'PICKING', 'READY', 'PARTIALLY_SHIPPED',
]);

interface DocForGuards {
  id: string;
  status: string;
  partnerId: string;
  marginPct: Prisma.Decimal;
  grandTotalLocal: Prisma.Decimal;
  lines: {
    id: string;
    productId: string | null;
    qty: Prisma.Decimal;
    unitFactor: Prisma.Decimal;
    reservedQty: Prisma.Decimal;
    warehouseId: string | null;
  }[];
}

/**
 * The three approval checks of P04 D1–D3 in one shape so the UI can show them
 * before saving and the transition service can decide APPROVED vs
 * APPROVAL_PENDING. Stock is a blocker (unless allowNegativeStock); credit and
 * margin never block — they either pass, or demand a manager (needsApproval).
 */
@Injectable()
export class DocumentGuardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async evaluate(doc: DocForGuards, permissions: Permission[]): Promise<GuardResult> {
    const [settings, stock, credit] = await Promise.all([
      this.settings.sales(),
      this.stockCheck(doc),
      this.creditCheck(doc),
    ]);
    const warnings: GuardIssue[] = [];
    const blockers: GuardIssue[] = [];

    if (doc.lines.length === 0) blockers.push({ code: 'NO_LINES', message: 'Belgede satır yok' });

    // D1 — stock, line by line, naming the product, the shortfall and where stock exists.
    let canReserve = true;
    for (const s of stock) {
      const issue: GuardIssue = {
        code: 'STOCK_SHORT',
        message:
          `${s.code} ${s.name}: ${fmt(s.shortfall)} adet eksik (istenen ${fmt(s.needed)}, satılabilir ${fmt(s.available)})` +
          (s.elsewhere.length
            ? ` — ${s.elsewhere.map((e) => `${e.warehouse}: ${fmt(e.available)}`).join(', ')} deposunda var`
            : ' — başka depoda da yok'),
        meta: { productId: s.productId, shortfall: s.shortfall, needed: s.needed, available: s.available, elsewhere: s.elsewhere },
      };
      if (settings.allowNegativeStock) warnings.push(issue);
      else {
        blockers.push(issue);
        canReserve = false;
      }
    }

    // D2 — credit: warn and require a manager, never a hard stop.
    let creditOk = true;
    if (credit && credit.exposure > credit.limit) {
      const canOverride = permissions.includes('partner.override_credit');
      creditOk = canOverride;
      warnings.push({
        code: 'CREDIT_LIMIT',
        message:
          `Kredi limiti aşılıyor: açık risk ${money(credit.exposure)} / limit ${money(credit.limit)}` +
          (canOverride ? ' (yetkinizle onaylanabilir)' : ' — yönetici onayı gerekecek'),
        meta: { exposure: credit.exposure, limit: credit.limit, openOrders: credit.openOrders, externalBalance: credit.externalBalance },
      });
    }

    // D3 — margin threshold. Numbers only under a cost-bearing key.
    let marginOk = true;
    const margin = Number(doc.marginPct);
    if (doc.lines.length > 0 && margin < settings.minMarginPct) {
      const canApprove = permissions.includes('sales.approve_low_margin');
      marginOk = canApprove;
      warnings.push({
        code: 'LOW_MARGIN',
        message: canApprove
          ? 'Belge marjı eşiğin altında (yetkinizle onaylanabilir)'
          : 'Belge marjı eşiğin altında — yönetici onayı gerekecek',
        meta: { marginPct: margin, minMarginPct: settings.minMarginPct },
      });
    }

    return {
      ok: blockers.length === 0,
      warnings,
      blockers,
      needsApproval: !creditOk || !marginOk,
      ctx: { canReserve, creditOk, marginOk, now: new Date() },
    };
  }

  /**
   * ATP per line: available = onHand − reserved in the line's warehouse
   * (default warehouse when unset). A line that already holds a reservation
   * (editing an approved order) only needs the delta.
   */
  private async stockCheck(doc: DocForGuards) {
    const lines = doc.lines.filter((l) => l.productId);
    if (lines.length === 0) return [];
    const defaultWh = await this.prisma.db.warehouse.findFirst({ where: { isDefault: true } });
    const productIds = [...new Set(lines.map((l) => l.productId!))];
    const [levels, products] = await Promise.all([
      this.prisma.db.stockLevel.findMany({
        where: { productId: { in: productIds } },
        include: { warehouse: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, code: true, name: true } }),
    ]);

    // Aggregate demand per (product, warehouse) so two lines of one product add up.
    const demand = new Map<string, number>();
    for (const l of lines) {
      const wh = l.warehouseId ?? defaultWh?.id ?? '';
      const base = Number(l.qty) * Number(l.unitFactor || 1);
      const already = RESERVING_STATUSES.has(doc.status) ? Number(l.reservedQty) : 0;
      const key = `${l.productId}|${wh}`;
      demand.set(key, (demand.get(key) ?? 0) + Math.max(0, base - already));
    }

    const out: {
      productId: string; code: string; name: string; needed: number; available: number; shortfall: number;
      elsewhere: { warehouse: string; available: number }[];
    }[] = [];
    for (const [key, needed] of demand) {
      const [productId, wh] = key.split('|');
      const here = levels.find((x) => x.productId === productId && x.warehouseId === wh);
      const available = here ? Number(here.onHand) - Number(here.reserved) : 0;
      if (needed <= available) continue;
      const p = products.find((x) => x.id === productId);
      out.push({
        productId: productId!,
        code: p?.code ?? '?',
        name: p?.name ?? '',
        needed,
        available,
        shortfall: needed - available,
        elsewhere: levels
          .filter((x) => x.productId === productId && x.warehouseId !== wh && Number(x.onHand) - Number(x.reserved) > 0)
          .map((x) => ({ warehouse: x.warehouse.name, available: Number(x.onHand) - Number(x.reserved) })),
      });
    }
    return out;
  }

  /**
   * Exposure = external balance (imported from Logo, V1 has no invoicing) +
   * open orders' gross totals + this document. Only partners with a limit.
   */
  private async creditCheck(doc: DocForGuards) {
    const partner = await this.prisma.db.businessPartner.findFirst({
      where: { id: doc.partnerId },
      select: { creditLimit: true, externalBalance: true },
    });
    if (!partner?.creditLimit) return null;
    const open = await this.prisma.db.salesDocument.aggregate({
      where: {
        partnerId: doc.partnerId,
        type: 'ORDER',
        status: { in: [...RESERVING_STATUSES] as never },
        id: { not: doc.id },
      },
      _sum: { grandTotalLocal: true },
    });
    const openOrders = Number(open._sum.grandTotalLocal ?? 0);
    const externalBalance = Number(partner.externalBalance ?? 0);
    return {
      limit: Number(partner.creditLimit),
      openOrders,
      externalBalance,
      exposure: externalBalance + openOrders + Number(doc.grandTotalLocal),
    };
  }
}

const fmt = (n: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 }).format(n);
const money = (n: number) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n);
