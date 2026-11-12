'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatQty } from '@cora/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { trDate } from '@/components/doc-status';
import { useAuth } from '@/components/auth-provider';
import { apiJson, ApiError } from '@/lib/problem';
import { fetchCount, fetchCounts, fetchWarehouses, type CountDetail } from '@/lib/stock';

const STATUS_LABEL: Record<string, string> = { DRAFT: 'Taslak', POSTED: 'İşlendi', CANCELLED: 'İptal' };
const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  POSTED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  CANCELLED: 'bg-destructive/10 text-destructive',
};

/** Sayım fişi: aç → say → farkları işle (P05). */
export function CountScreen() {
  const params = useSearchParams();
  const id = params.get('id');
  return id ? <CountSheet id={id} /> : <CountList />;
}

function CountList() {
  const { user } = useAuth();
  const canCount = (user?.permissions ?? []).includes('stock.count');
  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: fetchWarehouses });
  const { data, isLoading } = useQuery({ queryKey: ['counts'], queryFn: () => fetchCounts({ page: 1, pageSize: 50 }) });
  useEffect(() => { if (!warehouseId && warehouses.data?.items?.length) setWarehouseId(warehouses.data.items[0]!.id); }, [warehouseId, warehouses.data]);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const c = await apiJson<CountDetail>('/api/v1/stock/counts', { method: 'POST', json: { warehouseId } });
      window.location.assign(`/stock/counts/?id=${c.id}`);
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
          <a href="/stock/" className="text-sm text-primary hover:underline">← Stok</a>
          <h1 className="text-2xl font-semibold">Sayım fişleri</h1>
          <p className="text-sm text-muted-foreground">{isLoading ? 'Yükleniyor…' : `${(data?.total ?? 0).toLocaleString('tr-TR')} sayım`}</p>
        </div>
        {canCount && <Button onClick={() => setOpen(true)} data-testid="new-count">+ Yeni sayım</Button>}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? <div className="space-y-2 p-6">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-9 animate-pulse rounded bg-muted" />)}</div>
            : rows.length === 0 ? (
              <div className="grid place-items-center gap-2 py-20 text-center">
                <p className="text-sm font-medium">Sayım yok</p>
                <p className="max-w-md text-sm text-muted-foreground">Yeni sayım açtığınızda o andaki sistem miktarları dondurulur; yalnız farklar stok hareketi olur.</p>
              </div>
            ) : (
              <table className="w-full text-sm" data-testid="counts-table">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-3">Fiş</th><th className="px-4 py-3">Tarih</th>
                    <th className="px-4 py-3">Depo</th><th className="px-4 py-3">Durum</th><th className="px-4 py-3 text-right">Satır</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} onClick={() => window.location.assign(`/stock/counts/?id=${c.id}`)} className="cursor-pointer border-b last:border-0 hover:bg-muted">
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{c.number}</td>
                      <td className="whitespace-nowrap px-4 py-2">{trDate(c.date)}</td>
                      <td className="px-4 py-2 text-muted-foreground">{c.warehouse.name}</td>
                      <td className="px-4 py-2"><span className={`rounded px-2 py-0.5 text-xs ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span></td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{c.lineCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title="Yeni sayım" description="Seçilen depodaki tüm ürünlerin sistem miktarı dondurulur."
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Vazgeç</Button><Button onClick={() => void create()} disabled={busy || !warehouseId} data-testid="count-create">Sayımı aç</Button></>}>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Depo</span>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm" aria-label="Sayım deposu">
            {(warehouses.data?.items ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </Dialog>
    </div>
  );
}

function CountSheet({ id }: { id: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canCount = (user?.permissions ?? []).includes('stock.count');
  const [counted, setCounted] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [onlyDiff, setOnlyDiff] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['count', id], queryFn: () => fetchCount(id) });

  useEffect(() => {
    if (data) setCounted(Object.fromEntries(data.lines.map((l) => [l.product.id, Number(l.countedQty)])));
  }, [data]);

  if (isLoading || !data) return <p className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</p>;
  const editable = canCount && data.status === 'DRAFT';
  const rows = data.lines.filter((l) => !onlyDiff || Math.abs((counted[l.product.id] ?? 0) - Number(l.systemQty)) > 0.0005);
  const diffCount = data.lines.filter((l) => Math.abs((counted[l.product.id] ?? 0) - Number(l.systemQty)) > 0.0005).length;

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const saved = await apiJson<CountDetail>(`/api/v1/stock/counts/${id}`, {
        method: 'PATCH',
        json: { version: data.version, lines: data.lines.map((l) => ({ productId: l.product.id, countedQty: counted[l.product.id] ?? Number(l.systemQty) })) },
      });
      qc.setQueryData(['count', id], saved);
      setDirty(false);
      setFlash('Sayım kaydedildi.');
      setTimeout(() => setFlash(null), 4000);
      return saved;
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
      return null;
    } finally { setBusy(false); }
  };

  const post = async () => {
    if (dirty && !(await save())) return;
    setBusy(true); setError(null);
    try {
      const posted = await apiJson<CountDetail>(`/api/v1/stock/counts/${id}/post`, { method: 'POST', json: {} });
      qc.setQueryData(['count', id], posted);
      qc.invalidateQueries({ queryKey: ['stock-levels'] });
      qc.invalidateQueries({ queryKey: ['stock-moves'] });
      setFlash(`${posted.number} işlendi — farklar stok hareketi olarak yazıldı.`);
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="count-sheet" data-status={data.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <a href="/stock/counts/" className="text-sm text-primary hover:underline">← Sayım fişleri</a>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold">{data.number}</h1>
            <span className={`rounded px-2 py-0.5 text-xs ${STATUS_TONE[data.status]}`}>{STATUS_LABEL[data.status]}</span>
            {dirty && <span className="text-xs text-amber-700 dark:text-amber-500">● kaydedilmedi</span>}
          </div>
          <p className="text-sm text-muted-foreground">{data.warehouse.name} · {trDate(data.date)} · {data.lines.length} satır · {diffCount} farklı</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Yalnız farklar
          </label>
          {editable && <Button variant="outline" onClick={() => void save()} disabled={busy} data-testid="count-save">Kaydet</Button>}
          {editable && <Button onClick={() => void post()} disabled={busy} data-testid="count-post">Farkları işle</Button>}
        </div>
      </div>

      {flash && <div role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">{flash}</div>}
      {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm" data-testid="count-lines">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="w-8 px-2 py-3">#</th><th className="px-4 py-3">Ürün</th>
                  <th className="px-4 py-3 text-right">Sistem</th><th className="px-4 py-3 text-right">Sayılan</th>
                  <th className="px-4 py-3 text-right">Fark</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l, i) => {
                  const value = counted[l.product.id] ?? Number(l.countedQty);
                  const diff = value - Number(l.systemQty);
                  return (
                    <tr key={l.id} className={`border-b last:border-0 ${Math.abs(diff) > 0.0005 ? 'bg-amber-500/5' : ''}`}>
                      <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-2"><span className="font-mono text-xs text-muted-foreground">{l.product.code}</span> {l.product.name}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatQty(l.systemQty, 0)}</td>
                      <td className="px-4 py-1.5 text-right">
                        <input type="number" step="any" min={0} value={value} disabled={!editable} data-testid={`count-qty-${i}`} aria-label={`${l.product.code} sayılan`}
                          onChange={(e) => { const v = Number(e.target.value); setCounted((c) => ({ ...c, [l.product.id]: v })); setDirty(true); }}
                          className="h-8 w-24 rounded border border-input bg-card px-2 text-right text-sm" />
                      </td>
                      <td className={`px-4 py-2 text-right font-medium tabular-nums ${diff > 0 ? 'text-emerald-700 dark:text-emerald-400' : diff < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {diff > 0 ? '+' : ''}{formatQty(diff, 0)}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">{onlyDiff ? 'Fark yok.' : 'Bu depoda stok kaydı yok.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
