'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { formatQty } from '@cora/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { trDate, StatusBadge } from '@/components/doc-status';
import { useAuth } from '@/components/auth-provider';
import { apiJson, ApiError } from '@/lib/problem';
import { openPdf } from '@/lib/download';

const STATUS_LABEL: Record<string, string> = { DRAFT: 'Taslak', POSTED: 'İşlendi', CANCELLED: 'İptal' };
const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  POSTED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  CANCELLED: 'bg-destructive/10 text-destructive',
};

interface ShipmentRow {
  id: string; number: string; date: string; status: string;
  carrier: string | null; vehiclePlate: string | null; packageCount: number;
  partner: { id: string; name: string; city: string | null } | null;
  order: { id: string; number: string; status: string } | null;
  warehouse: { id: string; name: string } | null;
  lineCount: number;
}

interface ShipmentDetail extends ShipmentRow {
  version: number;
  carrierVkn: string | null; carrierTitle: string | null; trailerPlate: string | null;
  driverName: string | null; driverTckn: string | null;
  packageTypeCode: string | null; grossWeightKg: string | null; deliveryTermsCode: string | null;
  actualDespatchDate: string | null; notes: string | null;
  ublUuid: string | null; ublProfileId: string; ublTypeCode: string;
  gibStatus: string | null; sentToGibAt: string | null;
  postedAt: string | null; postedByName: string | null;
  shippingAddress: { title?: string; line1?: string; district?: string; city?: string } | null;
  lines: {
    id: string; lineNo: number; qty: string; note: string | null;
    product: { id: string; code: string; name: string }; unitCode: string | null;
    orderLine: { id: string; lineNo: number; description: string; orderedQty: string; shippedQty: string } | null;
  }[];
}

interface Outstanding {
  order: { id: string; number: string; status: string; date: string };
  partner: { id: string; code: string; name: string; city: string | null } | null;
  shippingAddress: { id: string; title: string | null; line1: string; city: string | null } | null;
  lines: { orderLineId: string; lineNo: number; description: string; product: { id: string; code: string; name: string } | null; unitCode: string | null; orderedQty: string; pickedQty: string; shippedQty: string; remainingQty: string }[];
}

/** Sevkiyat: irsaliye listesi, detay, siparişten kesme (kısmi sevk), işleme (P05). */
export function ShipmentScreen() {
  const params = useSearchParams();
  const id = params.get('id');
  const newFor = params.get('new');
  if (id) return <ShipmentDetailView id={id} />;
  if (newFor) return <ShipmentCreate orderId={newFor} />;
  return <ShipmentList />;
}

function ShipmentList() {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['shipments', dq, status, page],
    queryFn: () => apiJson<{ items: ShipmentRow[]; total: number; facets: { statuses: { status: string; count: number }[] } }>(
      `/api/v1/shipments?${new URLSearchParams({ q: dq, status, page: String(page), pageSize: '50' })}`),
    placeholderData: keepPreviousData,
  });
  const rows = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sevkiyat</h1>
          <p className="text-sm text-muted-foreground">{isLoading ? 'Yükleniyor…' : `${(data?.total ?? 0).toLocaleString('tr-TR')} irsaliye`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="İrsaliye no, müşteri, plaka" className="w-64" aria-label="İrsaliye ara" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-md border border-input bg-card px-3 text-sm" aria-label="Durum">
            <option value="">Tüm durumlar</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <a href="/warehouse/" className="inline-flex h-10 items-center rounded-md border border-input px-4 text-sm hover:bg-muted">Depo panosu</a>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? <p className="py-20 text-center text-sm text-destructive">{(error as Error).message}</p>
            : isLoading ? <div className="space-y-2 p-6">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-9 animate-pulse rounded bg-muted" />)}</div>
            : rows.length === 0 ? (
              <div className="grid place-items-center gap-2 py-20 text-center">
                <p className="text-sm font-medium">İrsaliye yok</p>
                <p className="max-w-md text-sm text-muted-foreground">Depo panosunda hazır olan siparişten "İrsaliye kes" ile başlayın. Kısmi sevk desteklenir.</p>
              </div>
            ) : (
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full text-sm" data-testid="shipments-table">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="px-4 py-3">İrsaliye</th><th className="px-4 py-3">Tarih</th>
                      <th className="px-4 py-3">Müşteri</th><th className="px-4 py-3">Sipariş</th>
                      <th className="px-4 py-3">Taşıyıcı</th><th className="px-4 py-3">Durum</th>
                      <th className="px-4 py-3 text-right">Satır</th><th className="px-4 py-3 text-right">Koli</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id} onClick={() => window.location.assign(`/shipments/?id=${s.id}`)} className="cursor-pointer border-b last:border-0 hover:bg-muted">
                        <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{s.number}</td>
                        <td className="whitespace-nowrap px-4 py-2">{trDate(s.date)}</td>
                        <td className="px-4 py-2">{s.partner?.name ?? '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-muted-foreground">{s.order?.number ?? '—'}</td>
                        <td className="px-4 py-2 text-muted-foreground">{s.carrier ?? '—'}{s.vehiclePlate ? ` · ${s.vehiclePlate}` : ''}</td>
                        <td className="px-4 py-2"><span className={`rounded px-2 py-0.5 text-xs ${STATUS_TONE[s.status]}`}>{STATUS_LABEL[s.status]}</span></td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{s.lineCount}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{s.packageCount || '—'}</td>
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

function ShipmentCreate({ orderId }: { orderId: string }) {
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ carrier: '', carrierVkn: '', vehiclePlate: '', trailerPlate: '', driverName: '', driverTckn: '', packageCount: '', grossWeightKg: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['outstanding', orderId], queryFn: () => apiJson<Outstanding>(`/api/v1/shipments/outstanding/${orderId}`) });

  useEffect(() => {
    if (data) setQtys(Object.fromEntries(data.lines.map((l) => [l.orderLineId, Number(l.remainingQty)])));
  }, [data]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const totalQty = useMemo(() => Object.values(qtys).reduce((a, b) => a + b, 0), [qtys]);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const lines = Object.entries(qtys).filter(([, q]) => q > 0).map(([orderLineId, qty]) => ({ orderLineId, qty }));
      const s = await apiJson<ShipmentDetail>('/api/v1/shipments', {
        method: 'POST',
        json: {
          orderId,
          carrier: form.carrier || null,
          carrierVkn: form.carrierVkn || null,
          vehiclePlate: form.vehiclePlate || null,
          trailerPlate: form.trailerPlate || null,
          driverName: form.driverName || null,
          driverTckn: form.driverTckn || null,
          packageCount: form.packageCount ? Number(form.packageCount) : 0,
          grossWeightKg: form.grossWeightKg ? Number(form.grossWeightKg) : null,
          notes: form.notes || null,
          lines,
        },
      });
      window.location.assign(`/shipments/?id=${s.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
      setBusy(false);
    }
  };

  if (isLoading || !data) return <p className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</p>;

  return (
    <div className="space-y-4" data-testid="shipment-create">
      <div>
        <a href="/shipments/" className="text-sm text-primary hover:underline">← Sevkiyat</a>
        <h1 className="text-2xl font-semibold">İrsaliye kes</h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{data.order.number}</span> · {data.partner?.name}
          {data.shippingAddress ? ` · ${data.shippingAddress.line1}${data.shippingAddress.city ? `, ${data.shippingAddress.city}` : ''}` : ''}
        </p>
      </div>

      {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm" data-testid="outstanding-lines">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="w-8 px-2 py-2">#</th><th className="px-4 py-2">Ürün</th>
                <th className="px-4 py-2 text-right">Sipariş</th><th className="px-4 py-2 text-right">Toplanan</th>
                <th className="px-4 py-2 text-right">Sevk edilen</th><th className="px-4 py-2 text-right">Kalan</th>
                <th className="px-4 py-2 text-right">Bu sevkiyat</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l, i) => (
                <tr key={l.orderLineId} className="border-b last:border-0">
                  <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-2"><span className="font-mono text-xs text-muted-foreground">{l.product?.code}</span> {l.description}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatQty(l.orderedQty, 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatQty(l.pickedQty, 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatQty(l.shippedQty, 0)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{formatQty(l.remainingQty, 0)}</td>
                  <td className="px-4 py-1.5 text-right">
                    <input type="number" min={0} max={Number(l.remainingQty)} step="any" value={qtys[l.orderLineId] ?? 0}
                      onChange={(e) => setQtys((s) => ({ ...s, [l.orderLineId]: Number(e.target.value) }))}
                      aria-label={`${l.product?.code} sevk miktarı`} data-testid={`ship-qty-${i}`}
                      className="h-8 w-24 rounded border border-input bg-card px-2 text-right text-sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 p-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          <p className="md:col-span-2 lg:col-span-4 text-xs text-muted-foreground">
            Taşıma bilgileri e-İrsaliye (UBL-TR) alanlarıdır; boş bırakılabilir.
          </p>
          {([
            ['carrier', 'Taşıyıcı firma'], ['carrierVkn', 'Taşıyıcı VKN'],
            ['vehiclePlate', 'Plaka'], ['trailerPlate', 'Dorse plakası'],
            ['driverName', 'Sürücü'], ['driverTckn', 'Sürücü TCKN'],
            ['packageCount', 'Koli sayısı'], ['grossWeightKg', 'Brüt ağırlık (kg)'],
          ] as const).map(([k, label]) => (
            <label key={k} className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
              <Input value={form[k]} onChange={(e) => set(k, e.target.value)} aria-label={label} data-testid={`ship-${k}`} />
            </label>
          ))}
          <label className="block text-sm md:col-span-2 lg:col-span-4">
            <span className="mb-1 block text-xs text-muted-foreground">Not</span>
            <Input value={form.notes} onChange={(e) => set('notes', e.target.value)} aria-label="Not" />
          </label>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-sm text-muted-foreground">Toplam {formatQty(totalQty, 0)} adet sevk edilecek</span>
        <a href="/shipments/" className="inline-flex h-10 items-center rounded-md border border-input px-4 text-sm hover:bg-muted">Vazgeç</a>
        <Button onClick={() => void create()} disabled={busy || totalQty <= 0} data-testid="shipment-create-submit">İrsaliyeyi oluştur</Button>
      </div>
    </div>
  );
}

function ShipmentDetailView({ id }: { id: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const perms = user?.permissions ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['shipment', id], queryFn: () => apiJson<ShipmentDetail>(`/api/v1/shipments/${id}`) });

  const post = async () => {
    setBusy(true); setError(null);
    try {
      const s = await apiJson<ShipmentDetail>(`/api/v1/shipments/${id}/post`, { method: 'POST', json: {} });
      qc.setQueryData(['shipment', id], s);
      qc.invalidateQueries({ queryKey: ['shipments'] });
      qc.invalidateQueries({ queryKey: ['warehouse-board'] });
      setFlash(`${s.number} işlendi — stok düştü, sipariş durumu güncellendi.`);
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    setBusy(true); setError(null);
    try {
      const s = await apiJson<ShipmentDetail>(`/api/v1/shipments/${id}/cancel`, { method: 'POST', json: { reason } });
      qc.setQueryData(['shipment', id], s);
      setCancelOpen(false);
      setFlash('İrsaliye iptal edildi.');
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  if (isLoading || !data) return <p className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</p>;

  const field = (label: string, value: string | null | undefined) => (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || '—'}</dd>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="shipment-detail" data-status={data.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <a href="/shipments/" className="text-sm text-primary hover:underline">← Sevkiyat</a>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold">{data.number}</h1>
            <span className={`rounded px-2 py-0.5 text-xs ${STATUS_TONE[data.status]}`}>{STATUS_LABEL[data.status]}</span>
            {data.order && <a href={`/orders/?id=${data.order.id}`} className="font-mono text-sm text-primary hover:underline">{data.order.number}</a>}
            {data.order && <StatusBadge status={data.order.status} />}
          </div>
          <p className="text-sm text-muted-foreground">{data.partner?.name} · {trDate(data.date)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void openPdf(`/api/v1/documents/shipments/${data.id}/pdf`).catch((e) => setError((e as Error).message))} data-testid="shipment-pdf">PDF</Button>
          {data.status === 'DRAFT' && perms.includes('shipment.cancel') && <Button variant="ghost" className="text-destructive" onClick={() => setCancelOpen(true)}>İptal</Button>}
          {data.status === 'DRAFT' && perms.includes('shipment.post') && <Button onClick={() => void post()} disabled={busy} data-testid="shipment-post">İrsaliyeyi işle</Button>}
          {data.status === 'POSTED' && perms.includes('shipment.post') && (
            <Button
              variant="outline"
              data-testid="queue-edespatch"
              onClick={async () => {
                setError(null);
                try {
                  await apiJson('/api/v1/edocs/despatch', { method: 'POST', json: { shipmentId: data.id } });
                  setFlash('e-İrsaliye kuyruğa alındı. Durumu e-Belgeler ekranından izleyin.');
                } catch (e) {
                  setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
                }
              }}
            >
              e-İrsaliye gönder
            </Button>
          )}
          {data.order && perms.includes('return.write') && data.status === 'POSTED' && (
            <a href={`/returns/?new=${data.order.id}`} className="inline-flex h-10 items-center rounded-md border border-input px-4 text-sm hover:bg-muted" data-testid="to-return">İade oluştur</a>
          )}
        </div>
      </div>

      {flash && <div role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">{flash}</div>}
      {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <Card>
        <CardContent className="grid gap-4 p-4 grid-cols-1 md:grid-cols-3 lg:grid-cols-4">
          {field('Taşıyıcı', data.carrier)}
          {field('Taşıyıcı VKN', data.carrierVkn)}
          {field('Plaka', data.vehiclePlate)}
          {field('Dorse', data.trailerPlate)}
          {field('Sürücü', data.driverName)}
          {field('Sürücü TCKN', data.driverTckn)}
          {field('Koli', data.packageCount ? String(data.packageCount) : null)}
          {field('Brüt ağırlık', data.grossWeightKg ? `${data.grossWeightKg} kg` : null)}
          {field('Depo', data.warehouse?.name)}
          {field('Sevk adresi', data.shippingAddress?.line1 ? `${data.shippingAddress.line1}${data.shippingAddress.city ? `, ${data.shippingAddress.city}` : ''}` : null)}
          {field('İşleyen', data.postedByName)}
          {field('Not', data.notes)}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm" data-testid="shipment-lines">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="w-8 px-2 py-2">#</th><th className="px-4 py-2">Ürün</th>
                <th className="px-4 py-2 text-right">Sevk edilen</th>
                <th className="px-4 py-2 text-right">Sipariş miktarı</th>
                <th className="px-4 py-2 text-right">Toplam sevk</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l, i) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-2"><span className="font-mono text-xs text-muted-foreground">{l.product.code}</span> {l.product.name}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{formatQty(l.qty, 0)} {l.unitCode ?? ''}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{l.orderLine ? formatQty(l.orderLine.orderedQty, 0) : '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{l.orderLine ? formatQty(l.orderLine.shippedQty, 0) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 p-4 grid-cols-1 md:grid-cols-4">
          <p className="md:col-span-4 text-xs font-semibold uppercase text-muted-foreground">e-İrsaliye (UBL-TR)</p>
          {field('ETTN', data.ublUuid)}
          {field('Profil', data.ublProfileId)}
          {field('Tip', data.ublTypeCode)}
          {field('GİB durumu', data.gibStatus ?? 'Gönderilmedi')}
        </CardContent>
      </Card>

      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} title="İrsaliyeyi iptal et" width="max-w-md"
        footer={<><Button variant="outline" onClick={() => setCancelOpen(false)}>Vazgeç</Button><Button className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void cancel()} disabled={busy || reason.trim().length < 3}>İptal et</Button></>}>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Sebep (zorunlu)</span>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus aria-label="İptal sebebi" />
        </label>
      </Dialog>
    </div>
  );
}
