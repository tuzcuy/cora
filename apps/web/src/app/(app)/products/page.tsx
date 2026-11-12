'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { formatMoney, formatQty } from '@cora/shared';
import { apiFetch } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/components/auth-provider';
import { downloadFile } from '@/lib/download';
import { ProductImages } from '@/components/products/product-images';

/* ------------------------------------------------------------------ types */

interface Stock {
  onHand: string;
  reserved: string;
  available: string;
  belowMin: boolean;
}

interface ProductRow {
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
  purchasePrice?: string;
  tags: string[];
  isActive: boolean;
  stock: Stock;
}

interface Facet {
  id: string;
  name: string;
  count: number;
}

interface ProductListResponse {
  items: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
  facets: { brands: Facet[]; categories: Facet[] };
}

interface ProductDetail extends ProductRow {
  description: string | null;
  manufacturerCode: string | null;
  groupCode: string | null;
  packageUnitCode: string | null;
  packageQty: string | null;
  minStock: string;
  supplier: { id: string; code: string; name: string } | null;
  warehouses: {
    warehouseId: string;
    code: string;
    name: string;
    onHand: string;
    reserved: string;
    available: string;
  }[];
}

const PAGE_SIZE = 50;

/* ------------------------------------------------------------------ data */

async function fetchList(params: URLSearchParams): Promise<ProductListResponse> {
  const res = await apiFetch(`/api/v1/products?${params.toString()}`);
  if (!res.ok) throw new Error('Ürünler yüklenemedi');
  return res.json();
}

async function fetchDetail(id: string): Promise<ProductDetail> {
  const res = await apiFetch(`/api/v1/products/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error('Ürün bulunamadı');
  if (!res.ok) throw new Error('Ürün yüklenemedi');
  return res.json();
}

/* ------------------------------------------------------------------ bits */

function StockCell({ stock }: { stock: Stock }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className={stock.belowMin ? 'font-medium text-destructive' : ''}>
        {formatQty(stock.available, 0)}
      </span>
      {stock.belowMin && (
        <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
          Kritik
        </span>
      )}
      {Number(stock.reserved) > 0 && (
        <span className="text-xs text-muted-foreground">
          {formatQty(stock.reserved, 0)} rezerve
        </span>
      )}
    </div>
  );
}

function FacetList({
  title,
  items,
  selected,
  onSelect,
}: {
  title: string;
  items: Facet[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {selected && (
        <button
          onClick={() => onSelect(null)}
          className="w-full rounded px-2 py-1 text-left text-sm text-primary hover:bg-muted"
        >
          ← Filtreyi kaldır
        </button>
      )}
      <ul className="max-h-64 overflow-y-auto">
        {items.map((f) => (
          <li key={f.id}>
            <button
              onClick={() => onSelect(selected === f.id ? null : f.id)}
              className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-muted ${
                selected === f.id ? 'bg-muted font-medium' : ''
              }`}
            >
              <span className="truncate">{f.name}</span>
              <span className="ml-2 shrink-0 text-xs text-muted-foreground">{f.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ detail */

function ProductDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['product', id],
    queryFn: () => fetchDetail(id),
  });

  if (isLoading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</div>;
  }
  if (error) {
    return (
      <Card>
        <CardContent className="grid place-items-center gap-3 py-16 text-center">
          <p className="text-sm text-destructive">{(error as Error).message}</p>
          <Button variant="outline" onClick={onBack}>
            Listeye dön
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const rows: [string, string][] = [
    ['Kod', data.code],
    ['Marka', data.brandName ?? '—'],
    ['Kategori', data.categoryName ?? '—'],
    ['Birim', data.unitCode ?? '—'],
    ['Koli', data.packageQty ? `${formatQty(data.packageQty, 0)} ${data.packageUnitCode ?? ''}` : '—'],
    ['Barkod', data.barcode ?? '—'],
    ['Üretici kodu', data.manufacturerCode ?? '—'],
    ['Tedarikçi', data.supplier?.name ?? '—'],
    ['KDV', `%${Number(data.vatRate)}`],
    ['Satış fiyatı', formatMoney(data.salesPrice, data.currency)],
    ...(data.purchasePrice ? ([['Alış fiyatı', formatMoney(data.purchasePrice, data.currency)]] as [string, string][]) : []),
    ['Kritik stok', formatQty(data.minStock, 0)],
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 -ml-2">
            ← Ürünler
          </Button>
          <h1 className="text-2xl font-semibold">{data.name}</h1>
          <p className="text-sm text-muted-foreground">{data.code}</p>
        </div>
        {!data.isActive && (
          <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">Pasif</span>
        )}
      </div>

      {data.description && <p className="text-sm text-muted-foreground">{data.description}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ürün bilgileri</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {data.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1">
                {data.tags.map((t) => (
                  <span key={t} className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <ProductImages productId={data.id} />

        <Card>
          <CardHeader>
            <CardTitle>Depo stoğu</CardTitle>
          </CardHeader>
          <CardContent>
            {data.warehouses.length === 0 ? (
              <p className="text-sm text-muted-foreground">Bu ürün için stok kaydı yok.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="pb-2">Depo</th>
                    <th className="pb-2 text-right">Eldeki</th>
                    <th className="pb-2 text-right">Rezerve</th>
                    <th className="pb-2 text-right">Kullanılabilir</th>
                  </tr>
                </thead>
                <tbody>
                  {data.warehouses.map((w) => (
                    <tr key={w.warehouseId} className="border-b last:border-0">
                      <td className="py-2">{w.name}</td>
                      <td className="py-2 text-right">{formatQty(w.onHand, 0)}</td>
                      <td className="py-2 text-right">{formatQty(w.reserved, 0)}</td>
                      <td className="py-2 text-right font-medium">{formatQty(w.available, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ list */

function ProductsScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const detailId = search.get('id');

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [brandId, setBrandId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [inStock, setInStock] = useState(false);
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const [cursor, setCursor] = useState(0);
  const tableRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Any filter change resets to the first page.
  useEffect(() => setPage(1), [debouncedQ, brandId, categoryId, inStock, sort]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort });
    if (debouncedQ.trim()) p.set('q', debouncedQ.trim());
    if (brandId) p.set('brandId', brandId);
    if (categoryId) p.set('categoryId', categoryId);
    if (inStock) p.set('inStock', 'true');
    return p;
  }, [debouncedQ, brandId, categoryId, inStock, sort, page]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['products', params.toString()],
    queryFn: () => fetchList(params),
    placeholderData: keepPreviousData,
  });

  const open = useCallback(
    (id: string) => router.push(`/products/?id=${encodeURIComponent(id)}`),
    [router],
  );

  // Keyboard: ↑ ↓ move the cursor, Enter opens the row.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = data?.items ?? [];
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = items[cursor];
      if (row) open(row.id);
    }
  };

  useEffect(() => {
    const el = tableRef.current?.querySelectorAll('tr')[cursor];
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (detailId) {
    return <ProductDetailView id={detailId} onBack={() => router.push('/products/')} />;
  }

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Ürünler</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? 'Yükleniyor…' : `${total.toLocaleString('tr-TR')} ürün`}
            {isFetching && !isLoading ? ' · güncelleniyor…' : ''}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ürün ara — kod, ad, marka, barkod"
            className="w-full sm:w-72"
            aria-label="Ürün ara"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Sıralama"
            className="h-10 rounded-md border border-input bg-card px-3 text-sm"
          >
            <option value="name">Ada göre</option>
            <option value="code">Koda göre</option>
            <option value="price_asc">Fiyat ↑</option>
            <option value="price_desc">Fiyat ↓</option>
            <option value="newest">En yeni</option>
          </select>
          <ExportButton q={q} brandId={brandId} categoryId={categoryId} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[16rem_1fr]">
        <aside className="space-y-5">
          <Button
            variant={inStock ? 'default' : 'outline'}
            size="sm"
            onClick={() => setInStock((v) => !v)}
            className="w-full"
          >
            {inStock ? '✓ Stokta olanlar' : 'Stokta olanlar'}
          </Button>
          <FacetList
            title="Marka"
            items={data?.facets.brands ?? []}
            selected={brandId}
            onSelect={setBrandId}
          />
          <FacetList
            title="Kategori"
            items={data?.facets.categories ?? []}
            selected={categoryId}
            onSelect={setCategoryId}
          />
        </aside>

        <Card>
          <CardContent className="p-0">
            {error ? (
              <div className="grid place-items-center gap-2 py-20 text-center">
                <p className="text-sm text-destructive">{(error as Error).message}</p>
                <p className="text-xs text-muted-foreground">
                  API'ye ulaşılamıyor olabilir. Sayfayı yenileyin.
                </p>
              </div>
            ) : isLoading ? (
              <div className="space-y-2 p-6">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="h-9 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : (data?.items.length ?? 0) === 0 ? (
              <div className="grid place-items-center gap-2 py-20 text-center">
                <p className="text-sm font-medium">Sonuç yok</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Arama veya filtrelerle eşleşen ürün bulunamadı. Filtreleri temizleyip tekrar deneyin.
                </p>
              </div>
            ) : (
              <div
                tabIndex={0}
                onKeyDown={onKeyDown}
                className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Ürün listesi"
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="px-4 py-3">Kod</th>
                      <th className="px-4 py-3">Ürün</th>
                      <th className="px-4 py-3">Marka</th>
                      <th className="px-4 py-3 text-right">Fiyat</th>
                      <th className="px-4 py-3">Kullanılabilir</th>
                    </tr>
                  </thead>
                  <tbody ref={tableRef}>
                    {data!.items.map((p, i) => (
                      <tr
                        key={p.id}
                        onClick={() => open(p.id)}
                        onMouseEnter={() => setCursor(i)}
                        aria-selected={i === cursor}
                        className={`cursor-pointer border-b last:border-0 hover:bg-muted ${
                          i === cursor ? 'bg-muted' : ''
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{p.code}</td>
                        <td className="px-4 py-2">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.categoryName}</div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2">{p.brandName ?? '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right">
                          {formatMoney(p.salesPrice, p.currency)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2">
                          <StockCell stock={p.stock} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Önceki
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {lastPage}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= lastPage}
            onClick={() => setPage((p) => p + 1)}
          >
            Sonraki →
          </Button>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  // useSearchParams needs a Suspense boundary under output: 'export'.
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</div>}>
      <ProductsScreen />
    </Suspense>
  );
}

/** Excel export of the current product filter — photos embedded in the cells. */
function ExportButton({ q, brandId, categoryId }: { q: string; brandId: string | null; categoryId: string | null }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!(user?.permissions ?? []).includes('export.excel')) return null;

  const run = async () => {
    setBusy(true);
    setError(null);
    const params = new URLSearchParams({ withImages: 'true' });
    if (q.trim()) params.set('q', q.trim());
    if (brandId) params.set('brandId', brandId);
    if (categoryId) params.set('categoryId', categoryId);
    try {
      await downloadFile(`/api/v1/documents/export/products.xlsx?${params}`, 'cora-urunler.xlsx');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => void run()} disabled={busy} data-testid="export-products" title="Fotoğraflar hücreye gömülü olarak aktarılır">
        {busy ? 'Hazırlanıyor…' : 'Excel'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </>
  );
}
