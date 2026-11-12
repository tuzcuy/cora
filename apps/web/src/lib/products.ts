import { apiJson } from '@/lib/problem';

/** Shared product read model (GET /api/v1/products) — lifted out of the products page for pickers. */
export interface ProductStock {
  onHand: string;
  reserved: string;
  available: string;
  belowMin: boolean;
}

export interface ProductRow {
  id: string;
  code: string;
  name: string;
  brandName: string | null;
  categoryName: string | null;
  unitCode: string | null;
  barcode: string | null;
  currency: string;
  salesPrice: string;
  vatRate: string;
  /** Present only with cost.view. */
  purchasePrice?: string;
  tags: string[];
  isActive: boolean;
  stock: ProductStock;
}

export interface ProductListResponse {
  items: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProductDetail extends ProductRow {
  unitId?: string;
  packageUnitCode: string | null;
  packageQty: string | null;
  minStock: string;
  warehouses: { warehouseId: string; code: string; name: string; onHand: string; reserved: string; available: string }[];
}

export async function searchProducts(q: string, opts: { pageSize?: number; inStock?: boolean } = {}) {
  const p = new URLSearchParams({ page: '1', pageSize: String(opts.pageSize ?? 20), sort: 'name' });
  if (q.trim()) p.set('q', q.trim());
  if (opts.inStock) p.set('inStock', 'true');
  return apiJson<ProductListResponse>(`/api/v1/products?${p}`);
}

/** Exact-code lookup for "paste a code" flows: search then match code/barcode case-insensitively. */
export async function findProductByCode(code: string): Promise<ProductRow | null> {
  const needle = code.trim().toLocaleLowerCase('tr');
  if (!needle) return null;
  const res = await searchProducts(code, { pageSize: 10 });
  return (
    res.items.find((p) => p.code.toLocaleLowerCase('tr') === needle) ??
    res.items.find((p) => (p.barcode ?? '').toLocaleLowerCase('tr') === needle) ??
    null
  );
}
