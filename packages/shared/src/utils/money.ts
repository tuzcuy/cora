import { Decimal } from 'decimal.js';
import type { Currency } from '../enums/index.js';

export type Numeric = Decimal | number | string;

function toNumber(value: Numeric): number {
  if (value instanceof Decimal) return value.toNumber();
  if (typeof value === 'number') return value;
  return Number(value);
}

/** Format a monetary amount for display in tr-TR (e.g. "1.234,50 ₺"). Display-only. */
export function formatMoney(value: Numeric, currency: Currency | string = 'TRY'): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

/** Format a plain number in tr-TR grouping (e.g. "1.234,5"). */
export function formatNumber(value: Numeric, decimals = 2): string {
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(toNumber(value));
}

/** Format a quantity with up to `decimals` (default 3, per Decimal(18,3)). */
export function formatQty(value: Numeric, decimals = 3): string {
  return formatNumber(value, decimals);
}

/** Format a percentage value (e.g. 18 -> "%18"). */
export function formatPercent(value: Numeric, decimals = 2): string {
  return `%${formatNumber(value, decimals)}`;
}
