/**
 * seed-demo-sales.ts — 18 months of seasonal sales history for the demo tenant.
 *
 * Third seed file; prisma/seed.ts and prisma/seed-demo.ts are both untouched.
 *   seed.ts        -> tenant, admin, roles, permissions, units, warehouses, settings
 *   seed-demo.ts   -> 900-SKU product catalogue + opening stock
 *   seed-demo-sales.ts (this) -> reps, customers, suppliers, quotes, orders
 *
 * Run:  pnpm --filter @cora/api exec tsx prisma/seed-demo-sales.ts
 *
 * NOTE ON PASSWORDS: this file deliberately does NOT import argon2 — the native
 * module segfaults on some dev machines and importing it would make the seed
 * unrunnable there. The 5 demo reps reuse the admin's existing argon2 PHC hash,
 * which is self-contained (salt + params embedded), so they log in with the
 * admin's password. Fine for a demo; see the console note at the end.
 *
 * SEASONALITY: Antalya is a summer destination and hotels buy AHEAD of season,
 * so the procurement curve leads occupancy by ~6-8 weeks. Peak is May-June,
 * high band April-October, trough November-March. Orders trail quotes, so the
 * order curve is a lagged blend of the quote curve.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildSearchText, calculateDocument, type LineInput } from '@cora/shared';
import { REGION_GROUPS, CUSTOMERS, SUPPLIERS, REPS } from './seed-demo-sales.data.js';

try {
  process.loadEnvFile();
} catch {
  /* env injected in CI */
}

const adapter = new PrismaPg(process.env.DATABASE_URL as string);
const prisma = new PrismaClient({ adapter });

/* ------------------------------------------------------------------ */
function makeRng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(20260905);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
const between = (min: number, max: number) => Math.round(min + rng() * (max - min));
const dec = (v: number, dp = 2) => new Prisma.Decimal(v.toFixed(dp));
const chunk = <T>(a: T[], n: number): T[][] => {
  const o: T[][] = [];
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n));
  return o;
};

/** Run `fn` over `items` with bounded concurrency (free-tier Postgres pool). */
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

/* ------------------------------------------------------------------ *
 * Seasonality
 * ------------------------------------------------------------------ */
const TODAY = new Date(2026, 8, 5); // 2026-09-05, the end of the window
const MONTHS = 18; // 2025-04 .. 2026-09

/** Calendar procurement weight per month (1 = Jan). Peak May-Jun. */
const S: Record<number, number> = {
  1: 0.35, 2: 0.6, 3: 1.1, 4: 1.5, 5: 1.8, 6: 1.7,
  7: 1.15, 8: 0.95, 9: 0.85, 10: 0.6, 11: 0.35, 12: 0.45,
};

const TARGET_QUOTES = 1400;

interface MonthSlot { year: number; month: number; weight: number; days: number; quotes: number }

function buildMonths(): MonthSlot[] {
  const slots: MonthSlot[] = [];
  for (let i = 0; i < MONTHS; i += 1) {
    const d = new Date(2025, 3 + i, 1); // start 2025-04
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const yearFactor = year === 2026 ? 1.1 : 1.0;
    const isPartial = year === 2026 && month === 9;
    const partial = isPartial ? 5 / 30 : 1;
    const days = isPartial ? 5 : new Date(year, month, 0).getDate();
    slots.push({ year, month, weight: S[month]! * yearFactor * partial, days, quotes: 0 });
  }
  // Largest-remainder allocation so the counts sum EXACTLY to TARGET_QUOTES.
  const total = slots.reduce((s, m) => s + m.weight, 0);
  const raw = slots.map((m) => (m.weight / total) * TARGET_QUOTES);
  const base = raw.map(Math.floor);
  let left = TARGET_QUOTES - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (const o of order) {
    if (left <= 0) break;
    base[o.i]! += 1;
    left -= 1;
  }
  slots.forEach((m, i) => (m.quotes = base[i]!));
  return slots;
}

/** Seasonal tilt on the win rate: hotels commit in spring, browse in winter. */
function seasonWinFactor(month: number): number {
  if (month >= 3 && month <= 6) return 1.06;
  if (month >= 7 && month <= 10) return 0.97;
  return 0.85;
}

/* ------------------------------------------------------------------ *
 * Quantities — hotel purchasing, scaled by product family and hotel size.
 * ------------------------------------------------------------------ */
const FAMILY_QTY: Record<string, [number, number]> = {
  B: [120, 800], // Bardak — the highest-rotation, highest-breakage family
  T: [80, 400],  // Tabak & Kase
  F: [60, 300],  // Fincan & Kupa
  S: [4, 60],    // Servis — chafing, semaver: equipment, not consumables
  A: [20, 150],  // Aksesuar
};
const VOLUME_FACTOR: Record<string, number> = { large: 1.8, medium: 1.0, small: 0.42 };

/** Mean lines per document by procurement phase. */
function linesForMonth(month: number): number {
  const mean = month >= 2 && month <= 5 ? 13 : month >= 6 && month <= 9 ? 8 : 9;
  const n = Math.round(mean + (rng() - 0.5) * mean * 1.1);
  return Math.max(3, Math.min(25, n));
}

/* ------------------------------------------------------------------ *
 * Status targets — must sum exactly.
 * ------------------------------------------------------------------ */
const QUOTE_TARGETS = { APPROVED: 835, EXPIRED: 320, REJECTED: 219, SENT: 14, DRAFT: 6, CANCELLED: 6 };
const ORDER_TARGETS = {
  COMPLETED: 848, CANCELLED: 22, APPROVED: 8,
  SENT_TO_WAREHOUSE: 7, PICKING: 6, READY: 5, PARTIALLY_SHIPPED: 4,
};
/** Order statuses that hold reserved stock. */
const RESERVING = new Set(['APPROVED', 'SENT_TO_WAREHOUSE', 'PICKING', 'READY', 'PARTIALLY_SHIPPED']);

/* ------------------------------------------------------------------ */

interface ProductRow {
  id: string; code: string; name: string; family: string;
  salesPrice: number; vatRate: number; purchasePrice: number;
}

interface DocPlan {
  kind: 'QUOTE' | 'ORDER';
  date: Date;
  partnerId: string;
  partnerVolume: string;
  salesRepId: string;
  repCode: string;
  status: string;
  number: string;
  currency: 'TRY' | 'USD' | 'EUR';
  exchangeRate: number;
  sourceDocumentId?: string;
  addressId: string | null;
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: 'demo' } });
  if (!tenant) throw new Error("Tenant 'demo' bulunamadı — önce prisma/seed.ts çalıştırılmalı.");
  const tenantId = tenant.id;

  const existingDocs = await prisma.salesDocument.count({ where: { tenantId } });
  if (existingDocs > 0) {
    console.log(`Bu kiracıda zaten ${existingDocs} belge var — seed-demo-sales atlandı.`);
    return { skipped: true as const };
  }

  const products: ProductRow[] = (
    await prisma.product.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, code: true, name: true, salesPrice: true, vatRate: true, purchasePrice: true },
    })
  ).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    family: p.code.startsWith('CAM-') && p.code.length > 4 ? p.code[4]! : 'B',
    salesPrice: Number(p.salesPrice),
    vatRate: Number(p.vatRate),
    purchasePrice: Number(p.purchasePrice),
  }));
  if (products.length === 0) {
    throw new Error('Ürün bulunamadı — önce prisma/seed-demo.ts çalıştırılmalı.');
  }
  const productNameById = new Map(products.map((p) => [p.id, p.name]));

  const units = await prisma.unit.findMany({ where: { tenantId } });
  const adetUnitId = units.find((u) => u.code === 'ADET')?.id ?? units[0]!.id;
  const warehouses = await prisma.warehouse.findMany({ where: { tenantId } });
  const merkezId = warehouses.find((w) => w.code === 'MERKEZ')?.id ?? warehouses[0]!.id;

  const rates = await prisma.exchangeRate.findMany({ where: { tenantId }, orderBy: { date: 'desc' } });
  const rateOf = (cur: string) =>
    Number(rates.find((r) => r.currency === cur)?.rate ?? (cur === 'USD' ? 41.25 : 44.8));

  /* -------- Sales rep users -------- */
  const admin = await prisma.user.findFirst({
    where: { tenantId, email: process.env.SEED_ADMIN_EMAIL || 'admin@demo.local' },
    select: { passwordHash: true },
  });
  if (!admin?.passwordHash) {
    throw new Error('Admin kullanıcı/passwordHash bulunamadı — önce prisma/seed.ts çalıştırılmalı.');
  }
  const salesRole = await prisma.role.findFirst({ where: { tenantId, name: 'Satış' } });
  if (!salesRole) throw new Error("'Satış' rolü bulunamadı — önce prisma/seed.ts çalıştırılmalı.");

  const repIdByCode: Record<string, string> = {};
  for (const rep of REPS) {
    const u = await prisma.user.create({
      data: {
        tenantId,
        email: rep.email,
        passwordHash: admin.passwordHash, // reused on purpose — see file header
        fullName: rep.fullName,
        phone: rep.phone,
        repCode: rep.repCode,
        isActive: true,
        roles: { create: { roleId: salesRole.id } },
      },
    });
    repIdByCode[rep.repCode] = u.id;
  }

  /* -------- Partner groups -------- */
  const groupIdByCode: Record<string, string> = {};
  for (const g of REGION_GROUPS) {
    const row = await prisma.partnerGroup.upsert({
      where: { tenantId_code: { tenantId, code: g.code } },
      update: { name: g.name },
      create: { tenantId, code: g.code, name: g.name },
    });
    groupIdByCode[g.code] = row.id;
  }
  for (const s of SUPPLIERS) {
    if (groupIdByCode[s.groupCode]) continue;
    const row = await prisma.partnerGroup.upsert({
      where: { tenantId_code: { tenantId, code: s.groupCode } },
      update: { name: s.groupName },
      create: { tenantId, code: s.groupCode, name: s.groupName },
    });
    groupIdByCode[s.groupCode] = row.id;
  }

  /* -------- Customers + suppliers -------- */
  interface PartnerRow { id: string; code: string; volume: string; repCode: string; addressId: string | null }
  const customers: PartnerRow[] = [];

  for (const c of CUSTOMERS) {
    const p = await prisma.businessPartner.create({
      data: {
        tenantId,
        code: c.code,
        name: c.name,
        type: 'CUSTOMER',
        groupId: groupIdByCode[c.groupCode]!,
        taxOffice: c.taxOffice,
        taxNumber: c.taxNumber,
        phone: c.phone,
        email: c.email,
        city: c.city,
        country: c.country,
        currency: 'TRY',
        paymentTermDays: c.paymentTermDays,
        salesRepId: repIdByCode[c.salesRepCode] ?? null,
        defaultDiscountRate: dec(c.defaultDiscountRate * 100, 4),
        creditLimit: dec(c.creditLimit, 4),
        notes: `${c.hotelClass} — ${c.region}`,
        tags: c.tags,
        searchText: buildSearchText([c.code, c.name, c.region, c.city, c.taxNumber, c.hotelClass]),
        isActive: true,
        contacts: {
          create: {
            name: c.contact.name,
            title: c.contact.title,
            phone: c.contact.phone,
            email: c.contact.email,
            isPrimary: true,
          },
        },
        addresses: {
          create: {
            type: 'SHIPPING',
            title: 'Otel Sevkiyat',
            line1: c.addressLine,
            district: c.district,
            city: c.city,
            country: c.country,
            isDefault: true,
          },
        },
      },
      include: { addresses: { select: { id: true } } },
    });
    customers.push({
      id: p.id,
      code: c.code,
      volume: c.volume,
      repCode: c.salesRepCode,
      addressId: p.addresses[0]?.id ?? null,
    });
  }

  for (const s of SUPPLIERS) {
    await prisma.businessPartner.create({
      data: {
        tenantId,
        code: s.code,
        name: s.name,
        type: 'SUPPLIER',
        groupId: groupIdByCode[s.groupCode]!,
        taxOffice: s.taxOffice,
        taxNumber: s.taxNumber,
        phone: s.phone,
        email: s.email,
        city: s.city,
        country: s.country,
        currency: 'TRY',
        paymentTermDays: s.paymentTermDays,
        tags: s.tags,
        searchText: buildSearchText([s.code, s.name, s.city, s.taxNumber]),
        isActive: true,
        contacts: {
          create: {
            name: s.contact.name,
            title: s.contact.title,
            phone: s.contact.phone,
            email: s.contact.email,
            isPrimary: true,
          },
        },
        addresses: {
          create: { type: 'BILLING', title: 'Fatura', line1: s.addressLine, district: s.district, city: s.city, country: s.country, isDefault: true },
        },
      },
    });
  }

  /* -------- Plan the quotes -------- */
  const months = buildMonths();
  const repByCode = Object.fromEntries(REPS.map((r) => [r.repCode, r]));
  const custByRep: Record<string, PartnerRow[]> = {};
  for (const c of customers) (custByRep[c.repCode] ??= []).push(c);

  // Customers are weighted so large hotels buy more often.
  const weightedPool: PartnerRow[] = [];
  for (const c of customers) {
    const reps = c.volume === 'large' ? 5 : c.volume === 'medium' ? 3 : 1;
    for (let i = 0; i < reps; i += 1) weightedPool.push(c);
  }

  interface QuotePlan extends DocPlan { month: number; year: number; lineCount: number }
  const quotePlans: QuotePlan[] = [];
  for (const m of months) {
    for (let i = 0; i < m.quotes; i += 1) {
      const cust = pick(weightedPool);
      const day = between(1, m.days);
      const date = new Date(m.year, m.month - 1, day, between(9, 17), between(0, 59));
      const useFx = rng() < 0.12;
      const currency: 'TRY' | 'USD' | 'EUR' = useFx ? (rng() < 0.6 ? 'EUR' : 'USD') : 'TRY';
      quotePlans.push({
        kind: 'QUOTE',
        date,
        month: m.month,
        year: m.year,
        partnerId: cust.id,
        partnerVolume: cust.volume,
        salesRepId: repIdByCode[cust.repCode]!,
        repCode: cust.repCode,
        status: 'DRAFT',
        number: '',
        currency,
        exchangeRate: currency === 'TRY' ? 1 : rateOf(currency),
        addressId: cust.addressId,
        lineCount: linesForMonth(m.month),
      });
    }
  }
  quotePlans.sort((a, b) => a.date.getTime() - b.date.getTime());

  /* -------- Assign quote statuses to hit the targets exactly -------- */
  // Approval propensity = rep conversion rate x seasonal tilt.
  const scored = quotePlans
    .map((q, i) => ({ i, score: (repByCode[q.repCode]!.quoteToOrderRate * seasonWinFactor(q.month)) + rng() * 0.35 }))
    .sort((a, b) => b.score - a.score);
  const approvedIdx = new Set(scored.slice(0, QUOTE_TARGETS.APPROVED).map((s) => s.i));

  // Open (SENT/DRAFT) quotes must be recent enough that validUntil has not passed.
  const recent = quotePlans
    .map((q, i) => ({ i, t: q.date.getTime() }))
    .filter((x) => !approvedIdx.has(x.i))
    .sort((a, b) => b.t - a.t);
  const sentIdx = new Set(recent.slice(0, QUOTE_TARGETS.SENT).map((x) => x.i));
  const draftIdx = new Set(
    recent.slice(QUOTE_TARGETS.SENT, QUOTE_TARGETS.SENT + QUOTE_TARGETS.DRAFT).map((x) => x.i),
  );

  const rest = quotePlans
    .map((_, i) => i)
    .filter((i) => !approvedIdx.has(i) && !sentIdx.has(i) && !draftIdx.has(i));
  // Deterministic split of the remainder.
  const cancelledIdx = new Set(rest.slice(0, QUOTE_TARGETS.CANCELLED));
  const rejectedIdx = new Set(
    rest.slice(QUOTE_TARGETS.CANCELLED, QUOTE_TARGETS.CANCELLED + QUOTE_TARGETS.REJECTED),
  );

  quotePlans.forEach((q, i) => {
    q.status = approvedIdx.has(i)
      ? 'APPROVED'
      : sentIdx.has(i)
        ? 'SENT'
        : draftIdx.has(i)
          ? 'DRAFT'
          : cancelledIdx.has(i)
            ? 'CANCELLED'
            : rejectedIdx.has(i)
              ? 'REJECTED'
              : 'EXPIRED';
  });

  // Document numbers, per year, in date order.
  const qSeq: Record<number, number> = {};
  for (const q of quotePlans) {
    const y = q.date.getFullYear();
    qSeq[y] = (qSeq[y] ?? 0) + 1;
    q.number = `TEK${y}-${String(qSeq[y]).padStart(4, '0')}`;
  }

  /* -------- Build lines + persist -------- */
  const buildLines = (n: number, volume: string, exchangeRate: number): LineInput[] & { productId: string }[] => {
    const out: (LineInput & { productId: string })[] = [];
    const used = new Set<string>();
    for (let i = 0; i < n; i += 1) {
      let p = pick(products);
      let guard = 0;
      while (used.has(p.id) && guard++ < 12) p = pick(products);
      used.add(p.id);
      const [lo, hi] = FAMILY_QTY[p.family] ?? FAMILY_QTY['B']!;
      const qty = Math.max(1, Math.round(between(lo, hi) * VOLUME_FACTOR[volume]!));
      out.push({
        productId: p.id,
        qty,
        // Price is expressed in the document currency; cost stays in TRY.
        unitPrice: Number((p.salesPrice / exchangeRate).toFixed(4)),
        vatRate: p.vatRate,
        discountRate: pick([0, 0, 0, 3, 5, 8, 10]),
        unitCostLocal: p.purchasePrice,
        exchangeRate,
      });
    }
    return out as never;
  };

  /** Plausible status chain so DocumentStatusHistory is not a single row. */
  const historyChain = (kind: 'QUOTE' | 'ORDER', final: string): string[] => {
    if (kind === 'QUOTE') {
      if (final === 'DRAFT') return ['DRAFT'];
      if (final === 'SENT') return ['DRAFT', 'SENT'];
      if (final === 'APPROVED') return ['DRAFT', 'SENT', 'APPROVED'];
      if (final === 'REJECTED') return ['DRAFT', 'SENT', 'REJECTED'];
      if (final === 'EXPIRED') return ['DRAFT', 'SENT', 'EXPIRED'];
      return ['DRAFT', 'SENT', 'CANCELLED'];
    }
    const flow = ['DRAFT', 'APPROVED', 'SENT_TO_WAREHOUSE', 'PICKING', 'READY', 'SHIPPED', 'COMPLETED'];
    if (final === 'CANCELLED') return ['DRAFT', 'APPROVED', 'CANCELLED'];
    if (final === 'PARTIALLY_SHIPPED') return ['DRAFT', 'APPROVED', 'SENT_TO_WAREHOUSE', 'PICKING', 'READY', 'PARTIALLY_SHIPPED'];
    const at = flow.indexOf(final);
    return at >= 0 ? flow.slice(0, at + 1) : ['DRAFT', final];
  };

  const persist = async (plan: DocPlan, lineCount: number, reserve: boolean) => {
    const lineInputs = buildLines(lineCount, plan.partnerVolume, plan.exchangeRate);
    const calc = calculateDocument({ lines: lineInputs, exchangeRate: plan.exchangeRate });
    const chain = historyChain(plan.kind, plan.status);
    const isApproved = ['APPROVED', 'SENT_TO_WAREHOUSE', 'PICKING', 'READY', 'PARTIALLY_SHIPPED', 'SHIPPED', 'COMPLETED'].includes(plan.status);

    return prisma.salesDocument.create({
      data: {
        tenantId,
        type: plan.kind as Prisma.SalesDocumentCreateInput['type'],
        number: plan.number,
        status: plan.status as Prisma.SalesDocumentCreateInput['status'],
        partnerId: plan.partnerId,
        shippingAddressId: plan.addressId,
        salesRepId: plan.salesRepId,
        date: plan.date,
        validUntil: plan.kind === 'QUOTE' ? new Date(plan.date.getTime() + 30 * 864e5) : null,
        deliveryDate: plan.kind === 'ORDER' ? new Date(plan.date.getTime() + between(7, 21) * 864e5) : null,
        currency: plan.currency,
        exchangeRate: dec(plan.exchangeRate, 6),
        rateDate: plan.currency === 'TRY' ? null : plan.date,
        priceIncludesVat: false,
        subtotal: dec(calc.subtotal.toNumber(), 4),
        discountTotal: dec(calc.discountTotal.toNumber(), 4),
        vatTotal: dec(calc.vatTotal.toNumber(), 4),
        grandTotal: dec(calc.grandTotal.toNumber(), 4),
        subtotalLocal: dec(calc.subtotalLocal.toNumber(), 4),
        vatTotalLocal: dec(calc.vatTotalLocal.toNumber(), 4),
        grandTotalLocal: dec(calc.grandTotalLocal.toNumber(), 4),
        costTotalLocal: dec(calc.costTotalLocal.toNumber(), 4),
        profitLocal: dec(calc.profitLocal.toNumber(), 4),
        marginPct: dec(calc.marginPct.toNumber(), 4),
        sourceDocumentId: plan.sourceDocumentId,
        sentAt: chain.includes('SENT') || plan.kind === 'ORDER' ? plan.date : null,
        approvedAt: isApproved ? new Date(plan.date.getTime() + 864e5) : null,
        lines: {
          create: lineInputs.map((li, idx) => {
            const r = calc.lines[idx]!;
            return {
              lineNo: idx + 1,
              productId: (li as unknown as { productId: string }).productId,
              // description is NOT nullable in the schema — always supply a string.
              description: productNameById.get((li as unknown as { productId: string }).productId) ?? 'Cam/sofra ürünü',
              qty: dec(Number(li.qty), 3),
              unitId: adetUnitId,
              unitPrice: dec(Number(li.unitPrice), 4),
              discountRate: dec(Number(li.discountRate ?? 0), 4),
              vatRate: dec(Number(li.vatRate), 4),
              lineNet: dec(r.lineNet.toNumber(), 4),
              lineVat: dec(r.lineVat.toNumber(), 4),
              lineTotal: dec(r.lineTotal.toNumber(), 4),
              unitCostLocal: dec(r.unitCostLocal.toNumber(), 4),
              lineProfitLocal: dec(r.lineProfitLocal.toNumber(), 4),
              warehouseId: merkezId,
              reservedQty: dec(reserve ? Number(li.qty) : 0, 3),
            };
          }),
        },
        statusHistory: {
          create: chain.map((st, k) => ({
            // toStatus is REQUIRED on DocumentStatusHistory, so cast to the
            // non-optional enum, not to SalesDocumentCreateInput['status'].
            toStatus: st as Prisma.DocumentStatusHistoryCreateWithoutDocumentInput['toStatus'],
            fromStatus:
              k === 0
                ? null
                : (chain[k - 1] as Prisma.DocumentStatusHistoryCreateWithoutDocumentInput['toStatus']),
            userId: plan.salesRepId,
            note: 'seed-demo-sales',
            at: new Date(plan.date.getTime() + k * 6 * 36e5),
          })),
        },
      },
      select: { id: true },
    });
  };

  console.log(`Teklifler yazılıyor (${quotePlans.length})...`);
  const quoteIds = await mapPool(quotePlans, 6, (q) => persist(q, q.lineCount, false));

  /* -------- Orders: 835 derived from approved quotes + 65 direct -------- */
  interface OrderPlan extends DocPlan { lineCount: number }
  const orderPlans: OrderPlan[] = [];
  quotePlans.forEach((q, i) => {
    if (q.status !== 'APPROVED') return;
    const lag = between(1, 12);
    const t = Math.min(q.date.getTime() + lag * 864e5, TODAY.getTime());
    orderPlans.push({
      ...q,
      kind: 'ORDER',
      date: new Date(t),
      status: 'COMPLETED',
      number: '',
      sourceDocumentId: quoteIds[i]!.id,
      lineCount: q.lineCount,
    });
  });
  const directCount = 900 - orderPlans.length;
  for (let i = 0; i < directCount; i += 1) {
    const m = months[between(0, months.length - 1)]!;
    const cust = pick(weightedPool);
    const date = new Date(m.year, m.month - 1, between(1, m.days), between(9, 17));
    orderPlans.push({
      kind: 'ORDER',
      date: date > TODAY ? TODAY : date,
      partnerId: cust.id,
      partnerVolume: cust.volume,
      salesRepId: repIdByCode[cust.repCode]!,
      repCode: cust.repCode,
      status: 'COMPLETED',
      number: '',
      currency: 'TRY',
      exchangeRate: 1,
      addressId: cust.addressId,
      lineCount: linesForMonth(m.month),
    });
  }
  orderPlans.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Open statuses go to the most recent orders; CANCELLED spread across all.
  const openSpec: [string, number][] = [
    ['READY', ORDER_TARGETS.READY],
    ['PICKING', ORDER_TARGETS.PICKING],
    ['SENT_TO_WAREHOUSE', ORDER_TARGETS.SENT_TO_WAREHOUSE],
    ['APPROVED', ORDER_TARGETS.APPROVED],
    ['PARTIALLY_SHIPPED', ORDER_TARGETS.PARTIALLY_SHIPPED],
  ];
  let cursor = orderPlans.length - 1;
  for (const [st, n] of openSpec) {
    for (let k = 0; k < n; k += 1) orderPlans[cursor--]!.status = st;
  }
  const cancellable = orderPlans.slice(0, cursor + 1);
  for (let k = 0; k < ORDER_TARGETS.CANCELLED; k += 1) {
    cancellable[Math.floor((k + 0.5) * (cancellable.length / ORDER_TARGETS.CANCELLED))]!.status = 'CANCELLED';
  }

  const oSeq: Record<number, number> = {};
  for (const o of orderPlans) {
    const y = o.date.getFullYear();
    oSeq[y] = (oSeq[y] ?? 0) + 1;
    o.number = `SIP${y}-${String(oSeq[y]).padStart(4, '0')}`;
  }

  console.log(`Siparişler yazılıyor (${orderPlans.length})...`);
  await mapPool(orderPlans, 6, (o) => persist(o, o.lineCount, RESERVING.has(o.status)));

  /* -------- Reflect reservations on stock levels -------- */
  const reservedLines = await prisma.salesDocumentLine.findMany({
    where: { document: { tenantId, type: 'ORDER', status: { in: [...RESERVING] as never } } },
    select: { productId: true, reservedQty: true },
  });
  const byProduct = new Map<string, Prisma.Decimal>();
  for (const l of reservedLines) {
    if (!l.productId) continue;
    byProduct.set(l.productId, (byProduct.get(l.productId) ?? new Prisma.Decimal(0)).plus(l.reservedQty));
  }
  for (const batch of chunk([...byProduct.entries()], 40)) {
    await Promise.all(
      batch.map(([productId, qty]) =>
        prisma.stockLevel.updateMany({
          where: { productId, warehouseId: merkezId },
          data: { reserved: { increment: qty } },
        }),
      ),
    );
  }

  /* -------- Replenishment so no SKU is over-reserved --------
   * Opening stock in seed-demo.ts is 40-600 per SKU, but a large hotel can
   * order more than that in a single line. Any SKU whose open reservations
   * exceed what the warehouse holds gets a real replenishment receipt, so
   * StockLevel stays backed by the StockMovement ledger (INVARIANTS.md rule 8)
   * instead of being patched directly.
   */
  const short = await prisma.stockLevel.findMany({
    where: { warehouseId: merkezId },
    select: { productId: true, onHand: true, reserved: true },
  });
  const topUps = short
    .filter((s) => Number(s.reserved) > Number(s.onHand))
    .map((s) => {
      const target = Math.ceil(Number(s.reserved) * 1.5) + 50;
      return { productId: s.productId, delta: target - Number(s.onHand) };
    });

  let replenished = 0;
  if (topUps.length > 0) {
    const costById = new Map(products.map((p) => [p.id, p.purchasePrice]));
    const receipt = await prisma.stockReceipt.create({
      data: {
        tenantId,
        number: 'GIR2026-0004',
        warehouseId: merkezId,
        date: new Date(2026, 6, 1),
        note: 'Sezon takviye stoğu',
        status: 'POSTED',
      },
    });
    for (const batch of chunk(topUps, 200)) {
      await prisma.stockReceiptLine.createMany({
        data: batch.map((t) => ({
          receiptId: receipt.id,
          productId: t.productId,
          qty: dec(t.delta, 3),
          unitCost: dec(costById.get(t.productId) ?? 0, 4),
        })),
      });
      await prisma.stockMovement.createMany({
        data: batch.map((t) => ({
          tenantId,
          productId: t.productId,
          warehouseId: merkezId,
          qty: dec(t.delta, 3),
          type: 'RECEIPT' as const,
          refType: 'StockReceipt',
          refId: receipt.id,
          note: 'Sezon takviye stoğu',
        })),
      });
      await Promise.all(
        batch.map((t) =>
          prisma.stockLevel.updateMany({
            where: { productId: t.productId, warehouseId: merkezId },
            data: { onHand: { increment: dec(t.delta, 3) } },
          }),
        ),
      );
    }
    replenished = topUps.length;
    console.log(`Takviye stoğu: ${replenished} ürün (GIR2026-0004).`);
  }

  /* -------- Document sequences reflect the last numbers issued -------- */
  const year = TODAY.getFullYear();
  for (const [docType, last] of [
    ['QUOTE', qSeq[year] ?? 0],
    ['ORDER', oSeq[year] ?? 0],
  ] as const) {
    await prisma.documentSequence.upsert({
      where: { tenantId_docType_year: { tenantId, docType, year } },
      update: { lastNumber: last },
      create: { tenantId, docType, year, lastNumber: last, prefix: docType === 'QUOTE' ? 'TEK' : 'SIP' },
    });
  }

  return {
    skipped: false as const,
    reps: REPS.length,
    customers: CUSTOMERS.length,
    suppliers: SUPPLIERS.length,
    quotes: quotePlans.length,
    orders: orderPlans.length,
    reservedProducts: byProduct.size,
    replenished,
  };
}

main()
  .then(async (res) => {
    await prisma.$disconnect();
    if (!res.skipped) {
      console.log('────────────────────────────────────────────');
      console.log('  SATIŞ DEMO VERİSİ YÜKLENDİ');
      console.log(`  Satış temsilcisi : ${res.reps}`);
      console.log(`  Müşteri          : ${res.customers}`);
      console.log(`  Tedarikçi        : ${res.suppliers}`);
      console.log(`  Teklif           : ${res.quotes}`);
      console.log(`  Sipariş          : ${res.orders}`);
      console.log(`  Rezervasyonlu ürün: ${res.reservedProducts}`);
      console.log(`  Takviye stoğu    : ${res.replenished} ürün`);
      console.log('────────────────────────────────────────────');
      console.log('  NOT: 5 temsilci admin ile AYNI şifreyi kullanır');
      console.log('       (argon2 bu makinede çalışmadığı için hash kopyalandı).');
      console.log('────────────────────────────────────────────');
    }
    console.log('Seed-demo-sales tamam.');
  })
  .catch(async (e) => {
    console.error('Seed-demo-sales hatası:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
