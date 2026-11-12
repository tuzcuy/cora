'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, formatQty } from '@cora/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { useAuth } from '@/components/auth-provider';
import { apiJson, ApiError } from '@/lib/problem';
import { searchProducts, type ProductRow } from '@/lib/products';

interface ListRow {
  id: string; name: string; currency: string; isDefault: boolean; isActive: boolean;
  validFrom: string | null; validTo: string | null; note: string | null; version: number;
  itemCount: number; partnerCount: number;
}

interface Tier { id: string; minQty: string; discountRate: string | null; price: string | null }

interface ListDetail extends Omit<ListRow, 'itemCount' | 'partnerCount'> {
  partners: { id: string; code: string; name: string }[];
  items: {
    id: string; price: string; discountRate: string | null; updatedAt: string;
    product: { id: string; code: string; name: string; salesPrice: string; currency: string };
    tiers: Tier[];
  }[];
  itemTotal: number;
}

/** Fiyat listeleri, miktar kademeleri ve toplu fiyat güncelleme (P07). */
export function PricingScreen() {
  const params = useSearchParams();
  const id = params.get('id');
  return id ? <PriceListDetail id={id} /> : <PriceListIndex />;
}

function PriceListIndex() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canWrite = (user?.permissions ?? []).includes('product.write');
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['price-lists-all'], queryFn: () => apiJson<{ items: ListRow[]; total: number }>('/api/v1/pricing/lists?pageSize=100') });

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const l = await apiJson<{ id: string }>('/api/v1/pricing/lists', { method: 'POST', json: { name, isDefault } });
      qc.invalidateQueries({ queryKey: ['price-lists-all'] });
      window.location.assign(`/pricing/?id=${l.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
      setBusy(false);
    }
  };

  const rows = data?.items ?? [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Fiyat listeleri</h1>
          <p className="text-sm text-muted-foreground">{isLoading ? 'Yükleniyor…' : `${rows.length} liste`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && <Button variant="outline" onClick={() => setBulkOpen(true)} data-testid="open-bulk">Toplu fiyat güncelle</Button>}
          {canWrite && <Button onClick={() => setCreateOpen(true)} data-testid="new-price-list">+ Yeni liste</Button>}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? <div className="space-y-2 p-6">{Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 animate-pulse rounded bg-muted" />)}</div>
            : rows.length === 0 ? (
              <div className="grid place-items-center gap-2 py-20 text-center">
                <p className="text-sm font-medium">Fiyat listesi yok</p>
                <p className="max-w-md text-sm text-muted-foreground">Liste açıp ürün fiyatı girin; carilere bağlayın. Teklif ekranı bu fiyatı otomatik kullanır.</p>
              </div>
            ) : (
              <table className="w-full text-sm" data-testid="price-lists-table">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-3">Liste</th><th className="px-4 py-3">Para birimi</th>
                    <th className="px-4 py-3 text-right">Ürün</th><th className="px-4 py-3 text-right">Cari</th>
                    <th className="px-4 py-3">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id} onClick={() => window.location.assign(`/pricing/?id=${l.id}`)} className="cursor-pointer border-b last:border-0 hover:bg-muted">
                      <td className="px-4 py-2 font-medium">{l.name} {l.isDefault && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">varsayılan</span>}</td>
                      <td className="px-4 py-2 text-muted-foreground">{l.currency}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{l.itemCount}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{l.partnerCount}</td>
                      <td className="px-4 py-2">{l.isActive ? 'Aktif' : <span className="text-muted-foreground">Pasif</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Yeni fiyat listesi" width="max-w-md"
        footer={<><Button variant="outline" onClick={() => setCreateOpen(false)}>Vazgeç</Button><Button onClick={() => void create()} disabled={busy || name.trim().length < 2} data-testid="create-price-list">Oluştur</Button></>}>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">Liste adı</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Liste adı" data-testid="price-list-name" />
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Varsayılan liste yap</label>
          {error && <p className="text-destructive">{error}</p>}
        </div>
      </Dialog>

      <BulkPriceDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </div>
  );
}

function PriceListDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canWrite = (user?.permissions ?? []).includes('product.write');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [tierFor, setTierFor] = useState<{ itemId: string; code: string; tiers: Tier[] } | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['price-list', id, q], queryFn: () => apiJson<ListDetail>(`/api/v1/pricing/lists/${id}?q=${encodeURIComponent(q)}&pageSize=200`) });

  const addProduct = async (p: ProductRow) => {
    setBusy(true); setError(null);
    try {
      await apiJson(`/api/v1/pricing/lists/${id}/items`, { method: 'POST', json: { items: [{ productId: p.id, price: Number(p.salesPrice) }] } });
      await qc.invalidateQueries({ queryKey: ['price-list', id] });
      setFlash(`${p.code} listeye eklendi.`);
      setTimeout(() => setFlash(null), 4000);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const setPrice = async (productId: string, price: number) => {
    try {
      await apiJson(`/api/v1/pricing/lists/${id}/items`, { method: 'POST', json: { items: [{ productId, price }] } });
      await qc.invalidateQueries({ queryKey: ['price-list', id] });
    } catch (e) { setError((e as Error).message); }
  };

  const removeProduct = async (productId: string) => {
    try {
      await apiJson(`/api/v1/pricing/lists/${id}/items`, { method: 'POST', json: { items: [], removeProductIds: [productId] } });
      await qc.invalidateQueries({ queryKey: ['price-list', id] });
    } catch (e) { setError((e as Error).message); }
  };

  if (isLoading || !data) return <p className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</p>;

  return (
    <div className="space-y-4" data-testid="price-list-detail">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <a href="/pricing/" className="text-sm text-primary hover:underline">← Fiyat listeleri</a>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{data.name}</h1>
            {data.isDefault && <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">varsayılan</span>}
          </div>
          <p className="text-sm text-muted-foreground">
            {data.itemTotal} ürün · {data.partners.length} cari bağlı{data.partners.length ? `: ${data.partners.slice(0, 3).map((p) => p.name).join(', ')}${data.partners.length > 3 ? '…' : ''}` : ''}
          </p>
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Listede ürün ara" className="w-64" aria-label="Listede ara" />
      </div>

      {flash && <div role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">{flash}</div>}
      {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm" data-testid="price-list-items">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2">Ürün</th>
                  <th className="px-4 py-2 text-right">Liste dışı fiyat</th>
                  <th className="px-4 py-2 text-right">Liste fiyatı</th>
                  <th className="px-4 py-2">Kademeler</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((it, i) => (
                  <tr key={it.id} className="border-b last:border-0">
                    <td className="px-4 py-2"><span className="font-mono text-xs text-muted-foreground">{it.product.code}</span> {it.product.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatMoney(it.product.salesPrice, it.product.currency)}</td>
                    <td className="px-4 py-1.5 text-right">
                      <input type="number" step="any" min={0} defaultValue={Number(it.price)} disabled={!canWrite}
                             aria-label={`${it.product.code} liste fiyatı`} data-testid={`list-price-${i}`}
                             onBlur={(e) => { const v = Number(e.target.value); if (v !== Number(it.price)) void setPrice(it.product.id, v); }}
                             className="h-8 w-28 rounded border border-input bg-card px-2 text-right text-sm" />
                    </td>
                    <td className="px-4 py-2">
                      {it.tiers.length === 0 ? <span className="text-xs text-muted-foreground">—</span> : (
                        <span className="text-xs">{it.tiers.map((t) => `${formatQty(t.minQty, 0)}+ ${t.price ? formatMoney(t.price) : `%${Number(t.discountRate)}`}`).join(' · ')}</span>
                      )}
                      {canWrite && (
                        <button type="button" onClick={() => setTierFor({ itemId: it.id, code: it.product.code, tiers: it.tiers })}
                                className="ml-2 text-xs text-primary hover:underline" data-testid={`edit-tiers-${i}`}>
                          düzenle
                        </button>
                      )}
                    </td>
                    <td className="px-1">
                      {canWrite && <button type="button" aria-label={`${it.product.code} listeden çıkar`} onClick={() => void removeProduct(it.product.id)} className="rounded px-1.5 text-muted-foreground hover:text-destructive">×</button>}
                    </td>
                  </tr>
                ))}
                {data.items.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">Bu listede ürün yok — aşağıdan ekleyin.</td></tr>}
              </tbody>
            </table>
          </div>
          {canWrite && <div className="border-t p-3"><ProductAdder onAdd={addProduct} busy={busy} /></div>}
        </CardContent>
      </Card>

      <TierDialog listId={id} target={tierFor} onClose={() => setTierFor(null)} onSaved={() => { setTierFor(null); void qc.invalidateQueries({ queryKey: ['price-list', id] }); }} />
    </div>
  );
}

function ProductAdder({ onAdd, busy }: { onAdd: (p: ProductRow) => void; busy: boolean }) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [cursor, setCursor] = useState(0);
  useEffect(() => { const t = setTimeout(() => setDq(q), 200); return () => clearTimeout(t); }, [q]);
  const { data } = useQuery({ queryKey: ['pricing-product-search', dq], queryFn: () => searchProducts(dq, { pageSize: 8 }), enabled: dq.trim().length >= 2 });
  const items = q.trim().length >= 2 && dq === q ? (data?.items ?? []) : [];

  return (
    <div className="relative">
      <Input value={q} disabled={busy} placeholder="Listeye ürün ekle — kod veya ad" aria-label="Listeye ürün ekle" data-testid="price-list-search"
             onChange={(e) => { setQ(e.target.value); setCursor(0); }}
             onKeyDown={(e) => {
               if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)); }
               else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
               else if (e.key === 'Enter' && items[cursor]) { e.preventDefault(); onAdd(items[cursor]!); setQ(''); }
             }} />
      {items.length > 0 && (
        <ul className="absolute bottom-full left-0 z-20 mb-1 max-h-64 w-[36rem] max-w-full overflow-auto rounded-md border bg-card shadow-lg" role="listbox">
          {items.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === cursor} onMouseDown={() => { onAdd(p); setQ(''); }} onMouseEnter={() => setCursor(i)}
                className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm ${i === cursor ? 'bg-muted' : ''}`}>
              <span><span className="font-mono text-xs text-muted-foreground">{p.code}</span> {p.name}</span>
              <span className="tabular-nums text-muted-foreground">{formatMoney(p.salesPrice, p.currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TierDialog({ listId, target, onClose, onSaved }: { listId: string; target: { itemId: string; code: string; tiers: Tier[] } | null; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<{ minQty: string; discountRate: string; price: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setRows(target.tiers.map((t) => ({ minQty: t.minQty, discountRate: t.discountRate ?? '', price: t.price ?? '' })));
      setError(null);
    }
  }, [target]);

  const save = async () => {
    if (!target) return;
    setBusy(true); setError(null);
    try {
      await apiJson('/api/v1/pricing/tiers', {
        method: 'POST',
        json: {
          itemId: target.itemId,
          priceListId: listId,
          tiers: rows.filter((r) => Number(r.minQty) > 0).map((r) => ({
            minQty: Number(r.minQty),
            discountRate: r.discountRate ? Number(r.discountRate) : null,
            price: r.price ? Number(r.price) : null,
          })),
        },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={!!target} onClose={onClose} title={`Miktar kademeleri · ${target?.code ?? ''}`} width="max-w-lg"
      description="Örnek: 500 adet ve üzeri %5 iskonto. En yüksek eşiği geçen kademe uygulanır."
      footer={<><Button variant="outline" onClick={onClose}>Vazgeç</Button><Button onClick={() => void save()} disabled={busy} data-testid="save-tiers">Kaydet</Button></>}>
      <div className="space-y-2 text-sm">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
            <label className="block"><span className="mb-1 block text-xs text-muted-foreground">Min. miktar</span>
              <Input type="number" min={1} value={r.minQty} aria-label={`Kademe ${i + 1} miktar`} data-testid={`tier-qty-${i}`}
                     onChange={(e) => setRows((rs) => rs.map((x, j) => j === i ? { ...x, minQty: e.target.value } : x))} /></label>
            <label className="block"><span className="mb-1 block text-xs text-muted-foreground">İskonto %</span>
              <Input type="number" min={0} max={100} step="any" value={r.discountRate} aria-label={`Kademe ${i + 1} iskonto`} data-testid={`tier-disc-${i}`}
                     onChange={(e) => setRows((rs) => rs.map((x, j) => j === i ? { ...x, discountRate: e.target.value, price: '' } : x))} /></label>
            <label className="block"><span className="mb-1 block text-xs text-muted-foreground">Sabit fiyat</span>
              <Input type="number" min={0} step="any" value={r.price} aria-label={`Kademe ${i + 1} fiyat`}
                     onChange={(e) => setRows((rs) => rs.map((x, j) => j === i ? { ...x, price: e.target.value, discountRate: '' } : x))} /></label>
            <button type="button" aria-label={`Kademe ${i + 1} sil`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="mb-2 rounded px-2 text-muted-foreground hover:text-destructive">×</button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, { minQty: '', discountRate: '', price: '' }])} data-testid="add-tier">+ Kademe</Button>
        {error && <p className="text-destructive">{error}</p>}
      </div>
    </Dialog>
  );
}

function BulkPriceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [percent, setPercent] = useState('10');
  const [target, setTarget] = useState<'sales' | 'purchase'>('sales');
  const [roundTo, setRoundTo] = useState('0.01');
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<{ count: number; changed: number; preview: { code: string; name: string; oldPrice: number; newPrice: number }[] } | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setPreview(null); setApplied(null); setError(null); } }, [open]);

  const run = async (dryRun: boolean) => {
    setBusy(true); setError(null);
    try {
      const res = await apiJson<{ count: number; changed: number; preview: { code: string; name: string; oldPrice: number; newPrice: number }[] }>(
        '/api/v1/pricing/bulk-update',
        { method: 'POST', json: { percent: Number(percent), target, roundTo, q: q || undefined, dryRun } },
      );
      if (dryRun) setPreview(res);
      else { setApplied(res.changed); setPreview(res); }
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Toplu fiyat güncelleme" width="max-w-2xl"
      description="Filtreye uyan ürünlerde yüzde değişiklik. Önce önizleyin; uygulanan her değişiklik fiyat geçmişine yazılır."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Kapat</Button>
          <Button variant="outline" onClick={() => void run(true)} disabled={busy} data-testid="bulk-preview">Önizle</Button>
          <Button onClick={() => void run(false)} disabled={busy || !preview} data-testid="bulk-apply">Uygula</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-4">
          <label className="block"><span className="mb-1 block text-xs text-muted-foreground">Değişim %</span>
            <Input type="number" step="any" value={percent} onChange={(e) => setPercent(e.target.value)} aria-label="Değişim yüzdesi" data-testid="bulk-percent" /></label>
          <label className="block"><span className="mb-1 block text-xs text-muted-foreground">Hedef</span>
            <select value={target} onChange={(e) => setTarget(e.target.value as 'sales' | 'purchase')} aria-label="Hedef fiyat" className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm">
              <option value="sales">Satış fiyatı</option><option value="purchase">Alış fiyatı</option>
            </select></label>
          <label className="block"><span className="mb-1 block text-xs text-muted-foreground">Yuvarlama</span>
            <select value={roundTo} onChange={(e) => setRoundTo(e.target.value)} aria-label="Yuvarlama" className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm">
              <option value="none">Yok</option><option value="0.01">0,01</option><option value="0.05">0,05</option><option value="0.10">0,10</option><option value="1">1</option>
            </select></label>
          <label className="block"><span className="mb-1 block text-xs text-muted-foreground">Ürün filtresi</span>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="boş = tümü" aria-label="Ürün filtresi" data-testid="bulk-filter" /></label>
        </div>

        {error && <p className="text-destructive">{error}</p>}
        {applied !== null && <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2" data-testid="bulk-result">{applied} ürünün fiyatı güncellendi ve geçmişe yazıldı.</p>}

        {preview && (
          <div className="max-h-60 overflow-auto rounded-md border" data-testid="bulk-preview-table">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card"><tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Ürün</th><th className="px-3 py-2 text-right">Eski</th><th className="px-3 py-2 text-right">Yeni</th>
              </tr></thead>
              <tbody>
                {preview.preview.map((p) => (
                  <tr key={p.code} className="border-b last:border-0">
                    <td className="px-3 py-1.5"><span className="font-mono text-xs text-muted-foreground">{p.code}</span> {p.name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{formatMoney(p.oldPrice)}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">{formatMoney(p.newPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {preview && <p className="text-xs text-muted-foreground">{preview.count} ürün eşleşti, {preview.changed} tanesinin fiyatı değişecek (ilk 50 satır gösteriliyor).</p>}
      </div>
    </Dialog>
  );
}
