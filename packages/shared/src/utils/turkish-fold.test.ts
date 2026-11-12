import { describe, it, expect } from 'vitest';
import { turkishFold, buildSearchText } from './turkish-fold.js';

describe('turkishFold', () => {
  it('folds diacritics to ASCII and lowercases', () => {
    expect(turkishFold('ŞİŞE')).toBe('sise');
    expect(turkishFold('Çaydanlık')).toBe('caydanlık');
    expect(turkishFold('Ğğ Üü Öö')).toBe('gg uu oo');
  });

  it('preserves the i / ı distinction (İ->i, I->ı)', () => {
    expect(turkishFold('İ')).toBe('i');
    expect(turkishFold('I')).toBe('ı');
    expect(turkishFold('IŞIK')).toBe('ısık');
    expect(turkishFold('İstanbul')).toBe('istanbul');
  });

  it('handles empty / null / undefined', () => {
    expect(turkishFold('')).toBe('');
    expect(turkishFold(null)).toBe('');
    expect(turkishFold(undefined)).toBe('');
  });

  it('lowercases plain ASCII', () => {
    expect(turkishFold('CAM-01 Bardak')).toBe('cam-01 bardak');
  });
});

describe('buildSearchText', () => {
  it('folds, drops empties and collapses whitespace', () => {
    const s = buildSearchText(['CAM-01', 'Şişe', '  Ürün   Açıklaması ', null, '', undefined]);
    expect(s).toBe('cam-01 sise urun acıklaması');
  });

  it('returns empty string for no usable parts', () => {
    expect(buildSearchText([null, '', undefined])).toBe('');
  });
});
