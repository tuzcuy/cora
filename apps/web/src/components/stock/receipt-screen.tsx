'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { formatMoney, formatQty } from '@cora/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { trDate } from '@/components/doc-status';
import { useAuth } from '@/components/auth-provider';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import { apiJson, ApiError } from '@/lib/problem';
import { searchProducts, findProductByCode, type ProductRow } from '@/lib/products';
import { fetchReceipt, fetchReceipts, fetchWarehouses, type ReceiptDetail, type Ref } from '@/lib/stock';

const STATUS_LABEL: Record<string, string> = { DRAFT: 'Taslak', POSTED: 'İşlendi', CANCELLED: 'İptal' };
const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  POSTED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  CANCELLED: 'bg-destructive/10 text-destructive',
};

interface EditorLine {
  key: string;
  productId: string;
  code: string;
  name: string;
  qty: number;
  unitCost: number;
  note: string;
}
let seq = 0;
const newKey = () => `r${Date.now().toString(36)}${(seq += 1)}`;

/** Giriş fişi: liste + editör (P05). Stoğun artmasının tek yolu. */
export function ReceiptScreen() {
  const params = useSearchParams();
  const id = params.get('id');
  const isNew = params.get('new') === '1';
  if (id || isNew) return <ReceiptEditor id={id ?? undefined} />;
  return <ReceiptList />;
}

function ReceiptList() {
  const { user } = useAuth();
  const canWrite = (user?.permissions ?? []).includes('stock.receive');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['receipts', dq, status, page],
    queryFn: () => fetchReceipts({ q: dq, status, page, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });
  const rows = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <a href="/stock/" className="text-sm text-primary hover:underline">← Stok</a>
          <h1 className="text-2xl font-semibold">Giriş fişleri</h1>
          <p className="text-sm text-muted-foreground">{isLoading ? 'Yükleniyor…' : `${(data?.total ?? 0).toLocaleString('tr-TR')} fiş`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Fiş no, tedarikçi, referans" className="w-64" aria-label="Fiş ara" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-md border border-input bg-card px-3 text-sm" aria-label="Durum">
            <option value="">Tüm durumlar</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {canWrite && <a href="/stock/receipts/?new=1" data-testid="new-receipt" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">+ Yeni giriş fişi</a>}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? <p className="py-20 text-center text-sm text-destructive">{(error as Error).message}</p>
            : isLoading ? <div className="space-y-2 p-6">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-9 animate-pulse rounded bg-muted" />)}</div>
            : rows.length === 0 ? (
              <div className="grid place-items-center gap-2 py-20 text-center">
                <p className="text-sm font-medium">Giriş fişi yok</p>
                <p className="max-w-md text-sm text-muted-foreground">Stok yalnız giriş fişiyle artar. Tedarikçiden gelen malı fişe girip işleyin.</p>
              </div>
            ) : (
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full text-sm" data-testid="receipts-table">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="px-4 py-3">Fiş</th><th className="px-4 py-3">Tarih</th><th className="px-4 py-3">Tedarikçi</th>
                      <th className="px-4 py-3">Depo</th><th className="px-4 py-3">Durum</th>
                      <th className="px-4 py-3 text-right">Satır</th><th className="px-4 py-3 text-right">Tutar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} onClick={() => window.location.assign(`/stock/receipts/?id=${r.id}`)} className="cursor-pointer border-b last:border-0 hover:bg-muted">
                        <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{r.number}</td>
                        <td className="whitespace-nowrap px-4 py-2">{trDate(r.date)}</td>
                        <td className="px-4 py-2">{r.supplier?.name ?? '—'}</td>
                        <td className="px-4 py-2 text-muted-foreground">{r.warehouse.name}</td>
                        <td className="px-4 py-2"><span className={`rounded px-2 py-0.5 text-xs ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{r.lineCount}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right font-medium">{formatMoney(r.totalCost, r.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </CardContent>
      </Card>

      {(data?.total ?? 0) > 50 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Önceki</Button>
          <span className="text-sm text-muted-foreground">{page} / {Math.max(1, Math.ceil((data?.total ?? 0) / 50))}</span>
          <Button variant="outline" size="sm" disabled={page >= Math.ceil((data?.total ?? 0) / 50)} onClick={() => setPage((p) => p + 1)}>Sonraki →</Button>
        </div>
      )}
    </div>
  );
}

function ReceiptEditor({ id }: { id?: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canWrite = (user?.permissions ?? []).includes('stock.receive');

  const [doc, setDoc] = useState<ReceiptDetail | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const guardClose = useUnsavedChanges(dirty);

  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: fetchWarehouses });
  const detail = useQuery({ queryKey: ['receipt', id], queryFn: () => fetchReceipt(id!), enabled: !!id });

  useEffect(() => {
    const d = detail.data;
    if (!d) return;
    setDoc(d);
    setWarehouseId(d.warehouse.id);
    setSupplierId(d.supplier?.id ?? '');
    setSupplierName(d.supplier?.name ?? '');
    setDate(d.date.slice(0, 10));
    setReference(d.reference ?? '');
    setNote(d.note ?? '');
    setLines(d.lines.map((l) => ({ key: l.id, productId: l.product.id, code: l.product.code, name: l.product.name, qty: Number(l.qty), unitCost: Number(l.unitCost), note: l.note ?? '' })));
    setDirty(false);
  }, [detail.data]);

  useEffect(() => {
    if (!id && !warehouseId && warehouses.data?.items?.length) setWarehouseId(warehouses.data.items[0]!.id);
  }, [id, warehouseId, warehouses.data]);

  const editable = canWrite && (!doc || doc.status === 'DRAFT');
  const total = lines.reduce((a, l) => a + l.qty * l.unitCost, 0);

  const addProduct = (p: ProductRow) => {
    setLines((ls) => [...ls, { key: newKey(), productId: p.id, code: p.code, name: p.name, qty: 1, unitCost: Number(p.purchasePrice ?? 0), note: '' }]);
    setDirty(true);
  };

  const save = async () => {
    setBusy(true); setError(null);
    const body = {
      warehouseId, supplierId: supplierId || null, date: new Date(date).toISOString(),
      reference: reference || null, note: note || null,
      lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, unitCost: l.unitCost, unitFactor: 1, note: l.note || null })),
    };
    try {
      const saved = doc
        ? await apiJson<ReceiptDetail>(`/api/v1/stock/receipts/${doc.id}`, { method: 'PATCH', json: { ...body, version: doc.version } })
        : await apiJson<ReceiptDetail>('/api/v1/stock/receipts', { method: 'POST', json: body });
      setDoc(saved);
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['receipts'] });
      if (!doc) window.history.replaceState(null, '', `/stock/receipts/?id=${saved.id}`);
      setFlash('Kaydedildi.');
      setTimeout(() => setFlash(null), 4000);
      return saved;
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
      return null;
    } finally { setBusy(false); }
  };

  const post = async () => {
    let target = doc;
    if (dirty || !doc) target = await save();
    if (!target) return;
    setBusy(true); setError(null);
    try {
      const posted = await apiJson<ReceiptDetail>(`/api/v1/stock/receipts/${target.id}/post`, { method: 'POST', json: {} });
      setDoc(posted);
      qc.invalidateQueries({ queryKey: ['receipts'] });
      qc.invalidateQueries({ queryKey: ['stock-levels'] });
      qc.invalidateQueries({ queryKey: ['stock-moves'] });
      setFlash(`${posted.number} işlendi — stok arttı.`);
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (editable) void save(); }
      if (e.key === 'Escape' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        guardClose(() => window.location.assign('/stock/receipts/'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (detail.isLoading) return <p className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</p>;

  return (
    <div className="space-y-4" data-testid="receipt-editor" data-status={doc?.status ?? 'NEW'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => guardClose(() => window.location.assign('/stock/receipts/'))}>← Giriş fişleri</Button>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold">{doc?.number ?? 'Yeni giriş fişi'}</h1>
            {doc && <span className={`rounded px-2 py-0.5 text-xs ${STATUS_TONE[doc.status]}`}>{STATUS_LABEL[doc.status]}</span>}
            {dirty && <span className="text-xs text-amber-700 dark:text-amber-500" data-testid="receipt-dirty">● kaydedilmedi</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editable && <Button variant="outline" onClick={() => void save()} disabled={busy || lines.length === 0} data-testid="receipt-save">Kaydet</Button>}
          {editable && <Button onClick={() => void post()} disabled={busy || lines.length === 0} data-testid="receipt-post">Fişi işle</Button>}
        </div>
      </div>

      {flash && <div role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">{flash}</div>}
      {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {doc?.status === 'POSTED' && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          Bu fiş işlendi{doc.postedByName ? ` (${doc.postedByName})` : ''}; stok hareketleri yazıldı. Düzeltmek için stok düzeltme fişi girin.
        </div>
      )}

      <Card>
        <CardContent className="grid gap-3 p-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Depo</span>
            <select value={warehouseId} disabled={!editable} onChange={(e) => { setWarehouseId(e.target.value); setDirty(true); }} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm" aria-label="Depo">
              {(warehouses.data?.items ?? []).map((w: Ref) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <SupplierField
            valueId={supplierId} valueName={supplierName} disabled={!editable}
            onChange={(p) => { setSupplierId(p?.id ?? ''); setSupplierName(p?.name ?? ''); setDirty(true); }}
          />
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Tarih</span>
            <Input type="date" value={date} disabled={!editable} onChange={(e) => { setDate(e.target.value); setDirty(true); }} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">İrsaliye / fatura no</span>
            <Input value={reference} disabled={!editable} onChange={(e) => { setReference(e.target.value); setDirty(true); }} aria-label="Referans" />
          </label>
          <label className="block text-sm md:col-span-2 lg:col-span-4">
            <span className="mb-1 block text-xs text-muted-foreground">Not</span>
            <Input value={note} disabled={!editable} onChange={(e) => { setNote(e.target.value); setDirty(true); }} aria-label="Not" />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm" data-testid="receipt-lines">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="w-8 px-2 py-2">#</th><th className="px-2 py-2">Ürün</th>
                  <th className="w-28 px-2 py-2 text-right">Miktar</th>
                  <th className="w-32 px-2 py-2 text-right">Birim maliyet</th>
                  <th className="w-32 px-2 py-2 text-right">Tutar</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.key} className="border-b last:border-0">
                    <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-2"><span className="font-mono text-xs text-muted-foreground">{l.code}</span> {l.name}</td>
                    <td className="px-2 py-1.5">
                      <input type="number" min={0} step="any" value={l.qty} disabled={!editable} data-testid={`receipt-qty-${i}`} aria-label={`Satır ${i + 1} miktar`}
                        onChange={(e) => { const v = Number(e.target.value); setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, qty: v } : x)); setDirty(true); }}
                        className="h-8 w-full rounded border border-input bg-card px-2 text-right text-sm" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min={0} step="any" value={l.unitCost} disabled={!editable} data-testid={`receipt-cost-${i}`} aria-label={`Satır ${i + 1} birim maliyet`}
                        onChange={(e) => { const v = Number(e.target.value); setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, unitCost: v } : x)); setDirty(true); }}
                        className="h-8 w-full rounded border border-input bg-card px-2 text-right text-sm" />
                    </td>
                    <td className="px-2 py-2 text-right font-medium tabular-nums">{formatMoney(l.qty * l.unitCost)}</td>
                    <td className="px-1 py-1.5">
                      {editable && <button type="button" aria-label={`Satır ${i + 1} sil`} onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); setDirty(true); }} className="rounded px-1.5 text-muted-foreground hover:bg-muted hover:text-destructive">×</button>}
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">Satır yok — aşağıdan ürün arayın ya da kod yapıştırın.</td></tr>}
              </tbody>
              <tfoot>
                <tr className="border-t">
                  <td colSpan={4} className="px-2 py-2 text-right text-sm font-medium">Toplam</td>
                  <td className="px-2 py-2 text-right text-base font-semibold tabular-nums" data-testid="receipt-total">{formatMoney(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          {editable && <div className="border-t p-3"><LineSearch onAdd={addProduct} /></div>}
        </CardContent>
      </Card>
    </div>
  );
}

function LineSearch({ onAdd }: { onAdd: (p: ProductRow) => void }) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [cursor, setCursor] = useState(0);
  useEffect(() => { const t = setTimeout(() => setDq(q), 200); return () => clearTimeout(t); }, [q]);
  const { data } = useQuery({ queryKey: ['receipt-product-search', dq], queryFn: () => searchProducts(dq, { pageSize: 8 }), enabled: dq.trim().length >= 2 });
  // Only show results that belong to what is currently typed — acting on a
  // stale list would add the wrong product.
  const items = q.trim().length >= 2 && dq === q ? (data?.items ?? []) : [];

  return (
    <div className="relative">
      <Input
        value={q}
        placeholder="Ürün ara (kod/ad) veya kod yapıştır — Enter ekler"
        aria-label="Ürün ara"
        data-testid="receipt-search"
        onChange={(e) => { setQ(e.target.value); setCursor(0); }}
        onKeyDown={async (e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            if (items[cursor]) { onAdd(items[cursor]!); setQ(''); }
            else if (q.trim()) { const p = await findProductByCode(q.trim()); if (p) { onAdd(p); setQ(''); } }
          }
        }}
      />
      {items.length > 0 && (
        <ul className="absolute bottom-full left-0 z-20 mb-1 max-h-64 w-[36rem] max-w-full overflow-auto rounded-md border bg-card shadow-lg" role="listbox" data-testid="receipt-search-results">
          {items.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === cursor} onMouseDown={() => { onAdd(p); setQ(''); }} onMouseEnter={() => setCursor(i)}
                className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm ${i === cursor ? 'bg-muted' : ''}`}>
              <span><span className="font-mono text-xs text-muted-foreground">{p.code}</span> {p.name}</span>
              <span className="tabular-nums text-muted-foreground">{formatQty(p.stock.available, 0)} adet</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SupplierField({ valueId, valueName, onChange, disabled }: { valueId: string; valueName: string; onChange: (p: { id: string; name: string } | null) => void; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['supplier-search', q],
    queryFn: () => apiJson<{ items: { id: string; code: string; name: string }[] }>(`/api/v1/partners?type=SUPPLIER&pageSize=8&q=${encodeURIComponent(q)}`),
    enabled: open && q.trim().length >= 2,
  });
  const items = data?.items ?? [];
  return (
    <div className="relative text-sm">
      <span className="mb-1 block text-xs text-muted-foreground">Tedarikçi</span>
      {valueId && !open ? (
        <div className="flex h-10 items-center justify-between rounded-md border border-input bg-card px-3">
          <span className="truncate">{valueName}</span>
          {!disabled && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setOpen(true)}>Değiştir</button>}
        </div>
      ) : (
        <Input value={q} disabled={disabled} placeholder="Tedarikçi ara…" aria-label="Tedarikçi ara" data-testid="supplier-search"
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && items[0]) { e.preventDefault(); onChange(items[0]!); setOpen(false); setQ(''); } }} />
      )}
      {open && items.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-card shadow-lg" role="listbox">
          {items.map((p) => (
            <li key={p.id} role="option" aria-selected={false} onMouseDown={() => { onChange(p); setOpen(false); setQ(''); }} className="cursor-pointer px-3 py-2 hover:bg-muted">
              <span className="font-mono text-xs text-muted-foreground">{p.code}</span> {p.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
