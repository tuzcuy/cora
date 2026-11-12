'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { formatMoney, formatQty } from '@cora/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { trDateTime } from '@/components/doc-status';
import { useAuth } from '@/components/auth-provider';
import { apiJson, ApiError } from '@/lib/problem';
import { searchProducts, type ProductRow } from '@/lib/products';
import { fetchLevels, fetchMovements, fetchWarehouses, type Ref } from '@/lib/stock';

const PAGE = 50;
const MOVEMENT_TYPES = [
  ['RECEIPT', 'Giriş'], ['SALE', 'Satış'], ['ADJUSTMENT', 'Düzeltme'],
  ['TRANSFER_IN', 'Transfer giriş'], ['TRANSFER_OUT', 'Transfer çıkış'],
  ['COUNT', 'Sayım farkı'], ['RETURN_IN', 'İade girişi'],
] as const;

const TONE: Record<string, string> = {
  RECEIPT: 'text-emerald-700 dark:text-emerald-400',
  RETURN_IN: 'text-emerald-700 dark:text-emerald-400',
  TRANSFER_IN: 'text-emerald-700 dark:text-emerald-400',
  SALE: 'text-destructive',
  TRANSFER_OUT: 'text-destructive',
};

/** Stok durumu + hareket defteri + düzeltme/transfer işlemleri (P05). */
export function StockScreen() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const perms = user?.permissions ?? [];
  const [tab, setTab] = useState<'levels' | 'ledger'>('levels');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [type, setType] = useState('');
  const [belowMin, setBelowMin] = useState(false);
  const [page, setPage] = useState(1);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => setPage(1), [dq, warehouseId, type, belowMin, tab]);

  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: fetchWarehouses });
  const levels = useQuery({
    queryKey: ['stock-levels', dq, warehouseId, belowMin, page],
    queryFn: () => fetchLevels({ q: dq, warehouseId, belowMin: belowMin || undefined, page, pageSize: PAGE }),
    enabled: tab === 'levels',
    placeholderData: keepPreviousData,
  });
  const moves = useQuery({
    queryKey: ['stock-moves', dq, warehouseId, type, page],
    queryFn: () => fetchMovements({ q: dq, warehouseId, type, page, pageSize: PAGE }),
    enabled: tab === 'ledger',
    placeholderData: keepPreviousData,
  });

  const active = tab === 'levels' ? levels : moves;
  const total = active.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE));

  const done = (msg: string) => {
    setFlash(msg);
    qc.invalidateQueries({ queryKey: ['stock-levels'] });
    qc.invalidateQueries({ queryKey: ['stock-moves'] });
    setTimeout(() => setFlash(null), 6000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Stok</h1>
          <p className="text-sm text-muted-foreground">
            {active.isLoading ? 'Yükleniyor…' : `${total.toLocaleString('tr-TR')} kayıt`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ürün kodu veya adı" className="w-56" aria-label="Ürün ara" />
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="h-10 rounded-md border border-input bg-card px-3 text-sm" aria-label="Depo">
            <option value="">Tüm depolar</option>
            {(warehouses.data?.items ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          {tab === 'ledger' && (
            <select value={type} onChange={(e) => setType(e.target.value)} className="h-10 rounded-md border border-input bg-card px-3 text-sm" aria-label="Hareket tipi">
              <option value="">Tüm hareketler</option>
              {MOVEMENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
          {perms.includes('stock.adjust') && <Button variant="outline" onClick={() => setAdjustOpen(true)} data-testid="open-adjust">Düzeltme</Button>}
          {perms.includes('stock.transfer') && <Button variant="outline" onClick={() => setTransferOpen(true)} data-testid="open-transfer">Transfer</Button>}
          {perms.includes('stock.receive') && <a href="/stock/receipts/" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Giriş fişleri</a>}
        </div>
      </div>

      {flash && <div role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">{flash}</div>}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={tab === 'levels' ? 'default' : 'outline'} onClick={() => setTab('levels')} data-testid="tab-levels">Stok durumu</Button>
        <Button size="sm" variant={tab === 'ledger' ? 'default' : 'outline'} onClick={() => setTab('ledger')} data-testid="tab-ledger">Hareket defteri</Button>
        {tab === 'levels' && (
          <label className="ml-2 flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={belowMin} onChange={(e) => setBelowMin(e.target.checked)} /> Kritik seviyedekiler
          </label>
        )}
        <a href="/stock/counts/" className="ml-auto text-sm text-primary hover:underline">Sayım fişleri →</a>
      </div>

      <Card>
        <CardContent className="p-0">
          {active.error ? (
            <p className="py-20 text-center text-sm text-destructive">{(active.error as Error).message}</p>
          ) : active.isLoading ? (
            <div className="space-y-2 p-6">{Array.from({ length: 10 }, (_, i) => <div key={i} className="h-9 animate-pulse rounded bg-muted" />)}</div>
          ) : tab === 'levels' ? (
            <LevelTable rows={levels.data?.items ?? []} />
          ) : (
            <LedgerTable rows={moves.data?.items ?? []} />
          )}
        </CardContent>
      </Card>

      {total > PAGE && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Önceki</Button>
          <span className="text-sm text-muted-foreground">{page} / {lastPage}</span>
          <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>Sonraki →</Button>
        </div>
      )}

      <AdjustDialog open={adjustOpen} onClose={() => setAdjustOpen(false)} warehouses={warehouses.data?.items ?? []} onDone={done} />
      <TransferDialog open={transferOpen} onClose={() => setTransferOpen(false)} warehouses={warehouses.data?.items ?? []} onDone={done} />
    </div>
  );
}

function LevelTable({ rows }: { rows: { id: string; onHand: string; reserved: string; available: string; minStock: string; belowMin: boolean; unitCode: string | null; product: Ref; warehouse: Ref }[] }) {
  if (rows.length === 0) return <p className="py-20 text-center text-sm text-muted-foreground">Kayıt yok.</p>;
  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full text-sm" data-testid="levels-table">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b text-left text-xs uppercase text-muted-foreground">
            <th className="px-4 py-3">Ürün</th><th className="px-4 py-3">Depo</th>
            <th className="px-4 py-3 text-right">Eldeki</th><th className="px-4 py-3 text-right">Rezerve</th>
            <th className="px-4 py-3 text-right">Satılabilir</th><th className="px-4 py-3 text-right">Min.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`border-b last:border-0 ${r.belowMin ? 'bg-amber-500/5' : ''}`}>
              <td className="px-4 py-2">
                <span className="font-mono text-xs text-muted-foreground">{r.product.code}</span> {r.product.name}
              </td>
              <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{r.warehouse.name}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatQty(r.onHand, 0)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatQty(r.reserved, 0)}</td>
              <td className={`px-4 py-2 text-right font-medium tabular-nums ${r.belowMin ? 'text-amber-700 dark:text-amber-500' : ''}`}>
                {formatQty(r.available, 0)} {r.unitCode ?? ''}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatQty(r.minStock, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LedgerTable({ rows }: { rows: { id: string; qty: string; typeLabel: string; type: string; unitCost: string | null; note: string | null; at: string; product: Ref; warehouse: Ref; userName: string | null }[] }) {
  if (rows.length === 0) return <p className="py-20 text-center text-sm text-muted-foreground">Hareket yok.</p>;
  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full text-sm" data-testid="ledger-table">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b text-left text-xs uppercase text-muted-foreground">
            <th className="px-4 py-3">Tarih</th><th className="px-4 py-3">Ürün</th>
            <th className="px-4 py-3">Depo</th><th className="px-4 py-3">Tip</th>
            <th className="px-4 py-3 text-right">Miktar</th><th className="px-4 py-3 text-right">Birim maliyet</th>
            <th className="px-4 py-3">Açıklama</th><th className="px-4 py-3">Kullanıcı</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} className="border-b last:border-0">
              <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{trDateTime(m.at)}</td>
              <td className="px-4 py-2"><span className="font-mono text-xs text-muted-foreground">{m.product.code}</span> {m.product.name}</td>
              <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{m.warehouse.name}</td>
              <td className="whitespace-nowrap px-4 py-2">{m.typeLabel}</td>
              <td className={`px-4 py-2 text-right font-medium tabular-nums ${TONE[m.type] ?? ''}`}>{formatQty(m.qty, 0)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{m.unitCost ? formatMoney(m.unitCost) : '—'}</td>
              <td className="px-4 py-2 text-muted-foreground">{m.note ?? '—'}</td>
              <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{m.userName ?? 'Sistem'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Product picker shared by the two dialogs. */
function ProductField({ value, onChange, label = 'Ürün' }: { value: ProductRow | null; onChange: (p: ProductRow | null) => void; label?: string }) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [cursor, setCursor] = useState(0);
  useEffect(() => { const t = setTimeout(() => setDq(q), 200); return () => clearTimeout(t); }, [q]);
  const { data } = useQuery({ queryKey: ['stock-product-search', dq], queryFn: () => searchProducts(dq, { pageSize: 8 }), enabled: dq.trim().length >= 2 });
  const items = q.trim().length >= 2 && dq === q ? (data?.items ?? []) : [];

  return (
    <div className="relative">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      {value ? (
        <div className="flex h-10 items-center justify-between rounded-md border border-input bg-card px-3 text-sm">
          <span className="truncate"><span className="font-mono text-xs text-muted-foreground">{value.code}</span> {value.name}</span>
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => onChange(null)}>Değiştir</button>
        </div>
      ) : (
        <Input
          value={q}
          autoFocus
          data-testid="stock-product-search"
          aria-label="Ürün ara"
          placeholder="Kod veya ad ile ara…"
          onChange={(e) => { setQ(e.target.value); setCursor(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            else if (e.key === 'Enter' && items[cursor]) { e.preventDefault(); onChange(items[cursor]!); setQ(''); }
          }}
        />
      )}
      {items.length > 0 && !value && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-card shadow-lg" role="listbox">
          {items.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === cursor} onMouseDown={() => { onChange(p); setQ(''); }} onMouseEnter={() => setCursor(i)}
                className={`cursor-pointer px-3 py-2 text-sm ${i === cursor ? 'bg-muted' : ''}`}>
              <span className="font-mono text-xs text-muted-foreground">{p.code}</span> {p.name}
              <span className="ml-2 text-xs text-muted-foreground">{formatQty(p.stock.available, 0)} adet</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AdjustDialog({ open, onClose, warehouses, onDone }: { open: boolean; onClose: () => void; warehouses: Ref[]; onDone: (m: string) => void }) {
  const [product, setProduct] = useState<ProductRow | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setProduct(null); setQty(''); setReason(''); setError(null); setWarehouseId(warehouses[0]?.id ?? ''); } }, [open, warehouses]);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await apiJson('/api/v1/stock/adjust', { method: 'POST', json: { productId: product?.id, warehouseId, qty: Number(qty), reason } });
      onDone(`${product?.code} için ${qty} adet düzeltme işlendi.`);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Stok düzeltme" description="Sebep zorunludur; hareket deftere sebebiyle yazılır."
      footer={<><Button variant="outline" onClick={onClose}>Vazgeç</Button><Button onClick={() => void submit()} disabled={busy || !product || !warehouseId || !qty || reason.trim().length < 3} data-testid="adjust-submit">Kaydet</Button></>}>
      <div className="space-y-3 text-sm">
        <ProductField value={product} onChange={setProduct} />
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Depo</span>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm" aria-label="Düzeltme deposu">
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Miktar (eksiltmek için negatif)</span>
          <Input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Düzeltme miktarı" data-testid="adjust-qty" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Sebep</span>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Kırık ürün, fire, sayım hatası…" aria-label="Düzeltme sebebi" data-testid="adjust-reason" />
        </label>
        {error && <p className="text-destructive">{error}</p>}
      </div>
    </Dialog>
  );
}

function TransferDialog({ open, onClose, warehouses, onDone }: { open: boolean; onClose: () => void; warehouses: Ref[]; onDone: (m: string) => void }) {
  const [product, setProduct] = useState<ProductRow | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setProduct(null); setQty(''); setNote(''); setError(null); setFrom(warehouses[0]?.id ?? ''); setTo(warehouses[1]?.id ?? ''); }
  }, [open, warehouses]);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await apiJson('/api/v1/stock/transfer', { method: 'POST', json: { productId: product?.id, fromWarehouseId: from, toWarehouseId: to, qty: Number(qty), note: note || undefined } });
      onDone(`${product?.code}: ${qty} adet transfer edildi.`);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  const opts = useMemo(() => warehouses, [warehouses]);
  return (
    <Dialog open={open} onClose={onClose} title="Depolar arası transfer" description="Çıkış ve giriş tek işlemde yazılır."
      footer={<><Button variant="outline" onClick={onClose}>Vazgeç</Button><Button onClick={() => void submit()} disabled={busy || !product || !from || !to || from === to || !qty} data-testid="transfer-submit">Aktar</Button></>}>
      <div className="space-y-3 text-sm">
        <ProductField value={product} onChange={setProduct} />
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">Kaynak depo</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm" aria-label="Kaynak depo">
              {opts.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">Hedef depo</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm" aria-label="Hedef depo">
              {opts.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Miktar</span>
          <Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Transfer miktarı" data-testid="transfer-qty" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Not</span>
          <Input value={note} onChange={(e) => setNote(e.target.value)} aria-label="Transfer notu" />
        </label>
        {from === to && <p className="text-destructive">Kaynak ve hedef depo aynı olamaz.</p>}
        {error && <p className="text-destructive">{error}</p>}
      </div>
    </Dialog>
  );
}
