/**
 * Turkish-aware case folding for search keys (CORA_MIMARI §9).
 *
 * Mapping (as specified in the constitution): İ→i, I→ı, Ş→s, Ğ→g, Ü→u, Ö→o, Ç→c,
 * everything else lower-cased. The i/ı distinction is intentionally preserved
 * (I→ı, İ→i) while the diacritic letters are folded to ASCII so that e.g.
 * "ŞİŞE" and "şişe" both fold to "sise"-family keys.
 */
const FOLD_MAP: Record<string, string> = {
  İ: 'i',
  i: 'i',
  I: 'ı',
  ı: 'ı',
  Ş: 's',
  ş: 's',
  Ğ: 'g',
  ğ: 'g',
  Ü: 'u',
  ü: 'u',
  Ö: 'o',
  ö: 'o',
  Ç: 'c',
  ç: 'c',
};

export function turkishFold(input: string | null | undefined): string {
  if (!input) return '';
  let out = '';
  for (const ch of input) {
    out += ch in FOLD_MAP ? FOLD_MAP[ch] : ch.toLowerCase();
  }
  return out;
}

/**
 * Build a normalized `searchText` value from arbitrary parts (code, name,
 * description, brand, manufacturer code, barcode…). Folds each part, drops
 * empties, and collapses whitespace to single spaces.
 */
export function buildSearchText(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => turkishFold(p))
    .filter((p) => p.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
