import { Decimal } from 'decimal.js';

// Global config: high working precision, half-up rounding (Turkish/Logo convention).
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type DecimalInput = Decimal | number | string;

const ZERO = new Decimal(0);
const ONE = new Decimal(1);
const HUNDRED = new Decimal(100);

/** Coerce to Decimal (undefined/null -> 0). */
export function D(value: DecimalInput | null | undefined): Decimal {
  if (value == null) return new Decimal(0);
  return value instanceof Decimal ? value : new Decimal(value);
}

/** Round to money precision: 2 decimals, half-up. */
export function round2(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export interface LineInput {
  /** Quantity in the selected unit (Decimal(18,3)). */
  qty: DecimalInput;
  /** Unit price in document currency (Decimal(18,4)). */
  unitPrice: DecimalInput;
  /** VAT rate as a percentage, e.g. 20 for %20. */
  vatRate: DecimalInput;
  /** Discount as a percentage 0..100. Ignored when discountAmount > 0. */
  discountRate?: DecimalInput;
  /** Absolute discount in document currency. Takes precedence over discountRate. */
  discountAmount?: DecimalInput;
  /** When true the entered price/gross is VAT-inclusive (KDV dahil). */
  priceIncludesVat?: boolean;
  /** Selected-unit -> base-unit factor (stock only; not used in money math). */
  unitFactor?: DecimalInput;
  /** Cost per selected unit in local currency (TRY) — for profit/margin. */
  unitCostLocal?: DecimalInput;
  /** Document currency -> local (TRY) rate; default 1. */
  exchangeRate?: DecimalInput;
}

export interface LineResult {
  gross: Decimal;
  discount: Decimal;
  lineNet: Decimal;
  lineVat: Decimal;
  lineTotal: Decimal;
  lineNetLocal: Decimal;
  lineVatLocal: Decimal;
  lineTotalLocal: Decimal;
  unitCostLocal: Decimal;
  lineCostLocal: Decimal;
  lineProfitLocal: Decimal;
  marginPct: Decimal;
}

/**
 * Calculate a single document line. All money outputs are rounded to 2 decimals
 * at the line level (CORA_MIMARI §8). VAT-inclusive prices are split into net+vat.
 */
export function calculateLine(input: LineInput): LineResult {
  const qty = D(input.qty);
  const unitPrice = D(input.unitPrice);
  const vatRate = D(input.vatRate);
  const exRate = input.exchangeRate == null ? ONE : D(input.exchangeRate);
  const unitCost = D(input.unitCostLocal);
  const priceIncludesVat = input.priceIncludesVat === true;

  const grossRaw = qty.times(unitPrice);

  // Discount: absolute amount wins over rate when provided (> 0). Clamp to gross.
  let discountRaw: Decimal;
  if (input.discountAmount != null && D(input.discountAmount).gt(0)) {
    discountRaw = D(input.discountAmount);
  } else if (input.discountRate != null) {
    discountRaw = grossRaw.times(D(input.discountRate)).div(HUNDRED);
  } else {
    discountRaw = ZERO;
  }
  if (discountRaw.gt(grossRaw)) discountRaw = grossRaw;

  const afterDiscount = grossRaw.minus(discountRaw);

  let netRaw: Decimal;
  let vatRaw: Decimal;
  if (priceIncludesVat) {
    const divisor = ONE.plus(vatRate.div(HUNDRED));
    netRaw = divisor.isZero() ? afterDiscount : afterDiscount.div(divisor);
    vatRaw = afterDiscount.minus(netRaw);
  } else {
    netRaw = afterDiscount;
    vatRaw = netRaw.times(vatRate).div(HUNDRED);
  }

  const gross = round2(grossRaw);
  const discount = round2(discountRaw);
  const lineNet = round2(netRaw);
  const lineVat = round2(vatRaw);
  const lineTotal = round2(lineNet.plus(lineVat));

  const lineNetLocal = round2(lineNet.times(exRate));
  const lineVatLocal = round2(lineVat.times(exRate));
  const lineTotalLocal = round2(lineNetLocal.plus(lineVatLocal));

  const lineCostLocal = round2(qty.times(unitCost));
  const lineProfitLocal = round2(lineNetLocal.minus(lineCostLocal));
  const marginPct = lineNetLocal.isZero()
    ? ZERO
    : round2(lineProfitLocal.div(lineNetLocal).times(HUNDRED));

  return {
    gross,
    discount,
    lineNet,
    lineVat,
    lineTotal,
    lineNetLocal,
    lineVatLocal,
    lineTotalLocal,
    unitCostLocal: unitCost,
    lineCostLocal,
    lineProfitLocal,
    marginPct,
  };
}

export interface DocumentInput {
  currency?: string;
  /** Document currency -> local (TRY); default 1. Applied to lines without their own rate. */
  exchangeRate?: DecimalInput;
  /** Document-level VAT-inclusive default; lines may override. */
  priceIncludesVat?: boolean;
  lines: LineInput[];
}

export interface DocumentResult {
  lines: LineResult[];
  subtotal: Decimal;
  discountTotal: Decimal;
  vatTotal: Decimal;
  grandTotal: Decimal;
  subtotalLocal: Decimal;
  vatTotalLocal: Decimal;
  grandTotalLocal: Decimal;
  costTotalLocal: Decimal;
  profitLocal: Decimal;
  marginPct: Decimal;
}

/** Calculate all lines and roll up document totals (sum of line-rounded values). */
export function calculateDocument(input: DocumentInput): DocumentResult {
  const lines = input.lines.map((line) =>
    calculateLine({
      ...line,
      exchangeRate: line.exchangeRate ?? input.exchangeRate,
      priceIncludesVat: line.priceIncludesVat ?? input.priceIncludesVat,
    }),
  );

  const sum = (pick: (l: LineResult) => Decimal): Decimal =>
    lines.reduce((acc, l) => acc.plus(pick(l)), ZERO);

  const subtotal = round2(sum((l) => l.lineNet));
  const discountTotal = round2(sum((l) => l.discount));
  const vatTotal = round2(sum((l) => l.lineVat));
  const grandTotal = round2(sum((l) => l.lineTotal));
  const subtotalLocal = round2(sum((l) => l.lineNetLocal));
  const vatTotalLocal = round2(sum((l) => l.lineVatLocal));
  const grandTotalLocal = round2(sum((l) => l.lineTotalLocal));
  const costTotalLocal = round2(sum((l) => l.lineCostLocal));
  const profitLocal = round2(subtotalLocal.minus(costTotalLocal));
  const marginPct = subtotalLocal.isZero()
    ? ZERO
    : round2(profitLocal.div(subtotalLocal).times(HUNDRED));

  return {
    lines,
    subtotal,
    discountTotal,
    vatTotal,
    grandTotal,
    subtotalLocal,
    vatTotalLocal,
    grandTotalLocal,
    costTotalLocal,
    profitLocal,
    marginPct,
  };
}
