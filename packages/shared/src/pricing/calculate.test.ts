import { describe, it, expect } from 'vitest';
import { calculateLine, calculateDocument, D, round2 } from './calculate.js';

describe('calculateLine', () => {
  it('1) simple line, %20 VAT, exclusive', () => {
    const r = calculateLine({ qty: 10, unitPrice: 100, vatRate: 20 });
    expect(r.gross.toFixed(2)).toBe('1000.00');
    expect(r.lineNet.toFixed(2)).toBe('1000.00');
    expect(r.lineVat.toFixed(2)).toBe('200.00');
    expect(r.lineTotal.toFixed(2)).toBe('1200.00');
  });

  it('2) %0 VAT', () => {
    const r = calculateLine({ qty: 5, unitPrice: 50, vatRate: 0 });
    expect(r.lineNet.toFixed(2)).toBe('250.00');
    expect(r.lineVat.toFixed(2)).toBe('0.00');
    expect(r.lineTotal.toFixed(2)).toBe('250.00');
  });

  it('3) %100 discount rate -> zero net/vat, zero margin', () => {
    const r = calculateLine({ qty: 3, unitPrice: 100, vatRate: 20, discountRate: 100 });
    expect(r.discount.toFixed(2)).toBe('300.00');
    expect(r.lineNet.toFixed(2)).toBe('0.00');
    expect(r.lineVat.toFixed(2)).toBe('0.00');
    expect(r.lineTotal.toFixed(2)).toBe('0.00');
    expect(r.marginPct.toFixed(2)).toBe('0.00');
  });

  it('4) absolute discount amount', () => {
    const r = calculateLine({ qty: 10, unitPrice: 100, vatRate: 20, discountAmount: 150 });
    expect(r.discount.toFixed(2)).toBe('150.00');
    expect(r.lineNet.toFixed(2)).toBe('850.00');
    expect(r.lineVat.toFixed(2)).toBe('170.00');
    expect(r.lineTotal.toFixed(2)).toBe('1020.00');
  });

  it('5) percentage discount', () => {
    const r = calculateLine({ qty: 10, unitPrice: 100, vatRate: 20, discountRate: 10 });
    expect(r.discount.toFixed(2)).toBe('100.00');
    expect(r.lineNet.toFixed(2)).toBe('900.00');
    expect(r.lineVat.toFixed(2)).toBe('180.00');
    expect(r.lineTotal.toFixed(2)).toBe('1080.00');
  });

  it('6) VAT-inclusive price (KDV dahil) is split into net+vat', () => {
    const r = calculateLine({ qty: 1, unitPrice: 120, vatRate: 20, priceIncludesVat: true });
    expect(r.lineNet.toFixed(2)).toBe('100.00');
    expect(r.lineVat.toFixed(2)).toBe('20.00');
    expect(r.lineTotal.toFixed(2)).toBe('120.00');
  });

  it('7) 3-decimal quantity', () => {
    const r = calculateLine({ qty: 2.5, unitPrice: 10, vatRate: 10 });
    expect(r.gross.toFixed(2)).toBe('25.00');
    expect(r.lineVat.toFixed(2)).toBe('2.50');
    expect(r.lineTotal.toFixed(2)).toBe('27.50');
  });

  it('7b) 3-decimal quantity with rounding', () => {
    const r = calculateLine({ qty: 1.333, unitPrice: 3, vatRate: 20 });
    expect(r.gross.toFixed(2)).toBe('4.00');
    expect(r.lineVat.toFixed(2)).toBe('0.80'); // 3.999 * 0.20 = 0.7998 -> 0.80
    expect(r.lineTotal.toFixed(2)).toBe('4.80');
  });

  it('8) foreign currency line -> local (TRY) values', () => {
    const r = calculateLine({ qty: 10, unitPrice: 100, vatRate: 20, exchangeRate: 30 });
    expect(r.lineNet.toFixed(2)).toBe('1000.00');
    expect(r.lineNetLocal.toFixed(2)).toBe('30000.00');
    expect(r.lineVatLocal.toFixed(2)).toBe('6000.00');
    expect(r.lineTotalLocal.toFixed(2)).toBe('36000.00');
  });

  it('9) profit and margin (local)', () => {
    const r = calculateLine({ qty: 10, unitPrice: 100, vatRate: 20, unitCostLocal: 60 });
    expect(r.lineCostLocal.toFixed(2)).toBe('600.00');
    expect(r.lineProfitLocal.toFixed(2)).toBe('400.00');
    expect(r.marginPct.toFixed(2)).toBe('40.00');
  });

  it('9b) profit/margin with foreign currency', () => {
    const r = calculateLine({
      qty: 10,
      unitPrice: 100,
      vatRate: 20,
      exchangeRate: 30,
      unitCostLocal: 1800,
    });
    expect(r.lineNetLocal.toFixed(2)).toBe('30000.00');
    expect(r.lineCostLocal.toFixed(2)).toBe('18000.00');
    expect(r.lineProfitLocal.toFixed(2)).toBe('12000.00');
    expect(r.marginPct.toFixed(2)).toBe('40.00');
  });

  it('10) half-up rounding at 2 decimals', () => {
    const r = calculateLine({ qty: 1, unitPrice: 0.125, vatRate: 0 });
    expect(r.lineNet.toFixed(2)).toBe('0.13');
  });

  it('12) zero quantity -> all zero, margin 0', () => {
    const r = calculateLine({ qty: 0, unitPrice: 100, vatRate: 20, unitCostLocal: 60 });
    expect(r.lineNet.toFixed(2)).toBe('0.00');
    expect(r.lineTotal.toFixed(2)).toBe('0.00');
    expect(r.marginPct.toFixed(2)).toBe('0.00');
  });

  it('13) margin is 0 when net is 0 (no divide-by-zero)', () => {
    const r = calculateLine({
      qty: 5,
      unitPrice: 100,
      vatRate: 20,
      discountRate: 100,
      unitCostLocal: 10,
    });
    expect(r.lineNet.toFixed(2)).toBe('0.00');
    expect(r.marginPct.toFixed(2)).toBe('0.00');
  });

  it('14) absolute discount takes precedence over rate', () => {
    const r = calculateLine({
      qty: 10,
      unitPrice: 100,
      vatRate: 20,
      discountRate: 50,
      discountAmount: 200,
    });
    expect(r.discount.toFixed(2)).toBe('200.00');
    expect(r.lineNet.toFixed(2)).toBe('800.00');
  });

  it('15) discount is clamped to gross', () => {
    const r = calculateLine({ qty: 10, unitPrice: 100, vatRate: 20, discountAmount: 5000 });
    expect(r.discount.toFixed(2)).toBe('1000.00');
    expect(r.lineNet.toFixed(2)).toBe('0.00');
  });

  it('16) VAT-inclusive with discount', () => {
    const r = calculateLine({
      qty: 1,
      unitPrice: 120,
      vatRate: 20,
      priceIncludesVat: true,
      discountRate: 10,
    });
    expect(r.discount.toFixed(2)).toBe('12.00');
    expect(r.lineNet.toFixed(2)).toBe('90.00');
    expect(r.lineVat.toFixed(2)).toBe('18.00');
    expect(r.lineTotal.toFixed(2)).toBe('108.00');
  });
});

describe('calculateDocument', () => {
  it('11) rolls up multi-line totals', () => {
    const doc = calculateDocument({
      lines: [
        { qty: 2, unitPrice: 100, vatRate: 20 },
        { qty: 1, unitPrice: 50, vatRate: 10 },
      ],
    });
    expect(doc.subtotal.toFixed(2)).toBe('250.00');
    expect(doc.discountTotal.toFixed(2)).toBe('0.00');
    expect(doc.vatTotal.toFixed(2)).toBe('45.00');
    expect(doc.grandTotal.toFixed(2)).toBe('295.00');
  });

  it('17) applies document-level exchangeRate and priceIncludesVat defaults', () => {
    const doc = calculateDocument({
      currency: 'USD',
      exchangeRate: 30,
      priceIncludesVat: true,
      lines: [{ qty: 1, unitPrice: 120, vatRate: 20 }],
    });
    expect(doc.subtotal.toFixed(2)).toBe('100.00');
    expect(doc.vatTotal.toFixed(2)).toBe('20.00');
    expect(doc.subtotalLocal.toFixed(2)).toBe('3000.00');
    expect(doc.grandTotalLocal.toFixed(2)).toBe('3600.00');
  });

  it('computes document profit and margin from local values', () => {
    const doc = calculateDocument({
      lines: [
        { qty: 10, unitPrice: 100, vatRate: 20, unitCostLocal: 60 },
        { qty: 5, unitPrice: 40, vatRate: 20, unitCostLocal: 30 },
      ],
    });
    // net 1000 + 200 = 1200 ; cost 600 + 150 = 750 ; profit 450 ; margin 37.5
    expect(doc.subtotalLocal.toFixed(2)).toBe('1200.00');
    expect(doc.costTotalLocal.toFixed(2)).toBe('750.00');
    expect(doc.profitLocal.toFixed(2)).toBe('450.00');
    expect(doc.marginPct.toFixed(2)).toBe('37.50');
  });
});

describe('helpers', () => {
  it('D coerces number/string/nullish', () => {
    expect(D(5).toString()).toBe('5');
    expect(D('2.5').toString()).toBe('2.5');
    expect(D(null).toString()).toBe('0');
    expect(D(undefined).toString()).toBe('0');
  });

  it('round2 rounds half-up', () => {
    expect(round2(D('1.005')).toFixed(2)).toBe('1.01');
    expect(round2(D('2.344')).toFixed(2)).toBe('2.34');
  });
});
