'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { formatMoney, formatQty } from '@cora/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge, trDate } from '@/components/doc-status';
import { apiJson, ApiError } from '@/lib/problem';

interface Returnable {
  order: { id: string; number: string; status: string; date: string };
  partner: { id: string; code: string; name: string } | null;
  lines: {
    orderLineId: string; lineNo: number; description: string;
    product: { id: string; code: string; name: string } | null;
    shippedQty: string; returnedQty: string; returnableQty: string; unitPrice: string;
  }[];
}

interface ReturnLineView {
  id: string;
  description: string;
  qty: string;
  unitPrice: string;
  lineTotal: string;
  product: { id: string; code: string; name: string } | null;
}

interface ReturnDoc {
  id: string; number: string; date: string; status: string; currency: string;
  grandTotal: string; notes: string | null;
  partner: { id: string; name: string } | null;
  flow?: { source: { id: string; number: string } | null };
  lines: ReturnLineView[];
}

interface DocRow {
  id: string; number: string; date: string; status: string; currency: string;
  grandTotal: string; lineCount: number;
  partner: { id: string; name: string } | null;
}

/** İade belgeleri: liste + sevk edilen siparişten iade oluşturma (P05). */
export function ReturnScreen() {
  const params = useSearchParams();
  const newFor = params.get('new');
  const id = params.get('id');
  if (newFor) return <ReturnCreate orderId={newFor} />;
  if (id) return <ReturnDetail id={id} />;
  return <ReturnList />;
}

function ReturnList() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ['returns', page],
    queryFn: () => apiJson<{ items: DocRow[]; total: number }>(`/api/v1/sales/documents?type=RETURN&page=${page}&pageSize=50`),
    placeholderData: keepPreviousData,
  });
  const rows = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">İadeler</h1>
        <p className="text-sm text-muted-foreground">{isLoading ? 'Yükleniyor…' : `${(data?.total ?? 0).toLocaleString('tr-TR')} iade belgesi`}</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? <p className="py-20 text-center text-sm text-destructive">{(error as Error).message}</p>
            : isLoading ? <div className="space-y-2 p-6">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-9 animate-pulse rounded bg-muted" />)}</div>
            : rows.length === 0 ? (
              <div className="grid place-items-center gap-2 py-20 text-center">
                <p className="text-sm font-medium">İade yok</p>
                <p className="max-w-md text-sm text-muted-foreground">İade, sevk edilmiş bir siparişten başlar: Sevkiyat → işlenmiş irsaliye → "İade oluştur".</p>
              </div>
            ) : (
              <div className="overflow-x-auto"><table className="w-full min-w-[36rem] text-sm" data-testid="returns-table">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-3">Belge</th><th className="px-4 py-3">Tarih</th>
                    <th className="px-4 py-3">Müşteri</th><th className="px-4 py-3">Durum</th>
                    <th className="px-4 py-3 text-right">Satır</th><th className="px-4 py-3 text-right">Tutar</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} onClick={() => window.location.assign(`/returns/?id=${r.id}`)} className="cursor-pointer border-b last:border-0 hover:bg-muted">
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{r.number}</td>
                      <td className="whitespace-nowrap px-4 py-2">{trDate(r.date)}</td>
                      <td className="px-4 py-2">{r.partner?.name ?? '—'}</td>
                      <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{r.lineCount}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right font-medium">{formatMoney(r.grandTotal, r.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
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

function ReturnCreate({ orderId }: { orderId: string }) {
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['returnable', orderId], queryFn: () => apiJson<Returnable>(`/api/v1/shipments/returnable/${orderId}`) });
  useEffect(() => { if (data) setQtys(Object.fromEntries(data.lines.map((l) => [l.orderLineId, 0]))); }, [data]);

  const total = Object.values(qtys).reduce((a, b) => a + b, 0);
  const create = async () => {
    setBusy(true); setError(null);
    try {
      const lines = Object.entries(qtys).filter(([, q]) => q > 0).map(([orderLineId, qty]) => ({ orderLineId, qty }));
      const doc = await apiJson<{ id: string }>('/api/v1/shipments/returns', { method: 'POST', json: { orderId, reason, lines } });
      window.location.assign(`/returns/?id=${doc.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
      setBusy(false);
    }
  };

  if (isLoading || !data) return <p className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</p>;

  return (
    <div className="space-y-4" data-testid="return-create">
      <div>
        <a href="/returns/" className="text-sm text-primary hover:underline">← İadeler</a>
        <h1 className="text-2xl font-semibold">İade oluştur</h1>
        <p className="text-sm text-muted-foreground"><span className="font-mono">{data.order.number}</span> · {data.partner?.name}</p>
      </div>

      {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto"><table className="w-full min-w-[42rem] text-sm" data-testid="returnable-lines">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="w-8 px-2 py-2">#</th><th className="px-4 py-2">Ürün</th>
                <th className="px-4 py-2 text-right">Sevk edilen</th><th className="px-4 py-2 text-right">İade edilmiş</th>
                <th className="px-4 py-2 text-right">İade edilebilir</th><th className="px-4 py-2 text-right">Bu iade</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l, i) => (
                <tr key={l.orderLineId} className="border-b last:border-0">
                  <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-2"><span className="font-mono text-xs text-muted-foreground">{l.product?.code}</span> {l.description}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatQty(l.shippedQty, 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatQty(l.returnedQty, 0)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{formatQty(l.returnableQty, 0)}</td>
                  <td className="px-4 py-1.5 text-right">
                    <input type="number" min={0} max={Number(l.returnableQty)} step="any" value={qtys[l.orderLineId] ?? 0}
                      onChange={(e) => setQtys((s) => ({ ...s, [l.orderLineId]: Number(e.target.value) }))}
                      aria-label={`${l.product?.code} iade miktarı`} data-testid={`return-qty-${i}`}
                      className="h-8 w-24 rounded border border-input bg-card px-2 text-right text-sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">İade sebebi (zorunlu)</span>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Hasarlı teslim, yanlış ürün, fazla gönderim…" aria-label="İade sebebi" data-testid="return-reason" />
          </label>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-sm text-muted-foreground">Toplam {formatQty(total, 0)} adet iade edilecek</span>
        <a href="/returns/" className="inline-flex h-10 items-center rounded-md border border-input px-4 text-sm hover:bg-muted">Vazgeç</a>
        <Button onClick={() => void create()} disabled={busy || total <= 0 || reason.trim().length < 3} data-testid="return-create-submit">İade belgesi oluştur</Button>
      </div>
    </div>
  );
}

function ReturnDetail({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['return', id],
    queryFn: () => apiJson<ReturnDoc>(`/api/v1/sales-documents/${id}`),
  });

  const approve = async () => {
    setBusy(true); setError(null);
    try {
      await apiJson(`/api/v1/sales-documents/${id}/transition`, { method: 'POST', json: { toStatus: 'APPROVED', note: 'İade onaylandı' } });
      await refetch();
      setFlash('İade onaylandı — ürünler stoğa geri girdi.');
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  if (isLoading || !data) return <p className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</p>;

  return (
    <div className="space-y-4" data-testid="return-detail" data-status={data.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <a href="/returns/" className="text-sm text-primary hover:underline">← İadeler</a>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold">{data.number}</h1>
            <StatusBadge status={data.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {data.partner?.name} · {trDate(data.date)}
            {data.flow?.source && <> · kaynak <a className="font-mono text-primary hover:underline" href={`/orders/?id=${data.flow.source.id}`}>{data.flow.source.number}</a></>}
          </p>
        </div>
        {data.status === 'DRAFT' && <Button onClick={() => void approve()} disabled={busy} data-testid="return-approve">İadeyi onayla</Button>}
      </div>

      {flash && <div role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">{flash}</div>}
      {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {data.notes && <p className="rounded-md border bg-muted/40 p-3 text-sm">Sebep: {data.notes}</p>}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto"><table className="w-full min-w-[40rem] text-sm" data-testid="return-lines">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="w-8 px-2 py-2">#</th><th className="px-4 py-2">Ürün</th>
                <th className="px-4 py-2 text-right">Miktar</th><th className="px-4 py-2 text-right">Birim fiyat</th>
                <th className="px-4 py-2 text-right">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {(data.lines ?? []).map((l, i) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-2"><span className="font-mono text-xs text-muted-foreground">{l.product?.code}</span> {l.description}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatQty(l.qty, 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.unitPrice, data.currency)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{formatMoney(l.lineTotal, data.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t">
                <td colSpan={4} className="px-4 py-2 text-right font-medium">İade tutarı</td>
                <td className="px-4 py-2 text-right text-base font-semibold tabular-nums" data-testid="return-total">{formatMoney(data.grandTotal, data.currency)}</td>
              </tr>
            </tfoot>
          </table></div>
        </CardContent>
      </Card>
    </div>
  );
}
