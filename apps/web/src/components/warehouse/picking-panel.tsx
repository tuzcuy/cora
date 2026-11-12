'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatQty } from '@cora/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/doc-status';
import { useAuth } from '@/components/auth-provider';
import { apiJson, ApiError } from '@/lib/problem';
import { openPdf } from '@/lib/download';

export interface PickTask {
  order: { id: string; number: string; status: string; date: string; deliveryDate: string | null };
  partner: { id: string; code: string; name: string; city: string | null } | null;
  task: { id: string; status: string; startedAt: string | null; readyAt: string | null; assignee: string | null } | null;
  lines: {
    id: string; lineNo: number; description: string;
    product: { id: string; code: string; name: string; barcode: string | null } | null;
    barcode: string | null; unitCode: string | null;
    warehouse: { id: string; code: string; name: string } | null;
    targetQty: string; pickedQty: string; shippedQty: string; done: boolean;
  }[];
  progress: { lines: number; done: number; allPicked: boolean };
}

const fetchTask = (orderId: string) => apiJson<PickTask>(`/api/v1/warehouse/tasks/${orderId}`);

/**
 * Toplama listesi (P05). Barkod okuyucu klavye emülasyonu yapar: alan hep
 * odakta kalır, okuyucu kodu yazıp Enter'a basar, satır otomatik artar.
 */
export function PickingPanel({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canPick = (user?.permissions ?? []).includes('warehouse.pick');
  const [scan, setScan] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error } = useQuery({ queryKey: ['pick-task', orderId], queryFn: () => fetchTask(orderId) });

  useEffect(() => { scanRef.current?.focus(); }, [data?.order.status]);

  const refresh = (task: PickTask) => {
    qc.setQueryData(['pick-task', orderId], task);
    qc.invalidateQueries({ queryKey: ['warehouse-board'] });
  };

  const call = async <T,>(path: string, body?: unknown): Promise<T | null> => {
    setBusy(true);
    try {
      return await apiJson<T>(path, { method: 'POST', json: body ?? {} });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message });
      return null;
    } finally { setBusy(false); }
  };

  const start = async () => {
    const t = await call<PickTask>(`/api/v1/warehouse/tasks/${orderId}/start`);
    if (t) { refresh(t); setMsg({ ok: true, text: 'Toplama başladı.' }); }
  };

  const submitScan = async () => {
    const code = scan.trim();
    if (!code) return;
    setScan('');
    const res = await call<{ ok: boolean; message: string; task: PickTask }>(`/api/v1/warehouse/tasks/${orderId}/scan`, { barcode: code, qty: 1 });
    if (res) {
      refresh(res.task);
      setMsg({ ok: res.ok, text: res.message });
    }
    scanRef.current?.focus();
  };

  const setQty = async (lineId: string, pickedQty: number) => {
    const t = await call<PickTask>(`/api/v1/warehouse/tasks/${orderId}/pick`, { lines: [{ lineId, pickedQty }] });
    if (t) refresh(t);
  };

  const finish = async () => {
    const t = await call<PickTask>(`/api/v1/warehouse/tasks/${orderId}/ready`);
    if (t) { refresh(t); setMsg({ ok: true, text: 'Sipariş hazır.' }); }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={data ? `${data.order.number} · toplama` : 'Toplama listesi'}
      description={data?.partner ? `${data.partner.name}${data.partner.city ? ` · ${data.partner.city}` : ''}` : undefined}
      width="max-w-4xl"
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted-foreground">
            {data ? `${data.progress.done}/${data.progress.lines} satır tamam` : ''}
          </span>
          <Button variant="outline" onClick={() => void openPdf(`/api/v1/documents/orders/${orderId}/pick-list.pdf`).catch((e) => setMsg({ ok: false, text: (e as Error).message }))} data-testid="picklist-pdf">
            Toplama listesi PDF
          </Button>
          <Button variant="outline" onClick={onClose}>Kapat</Button>
          {canPick && data?.order.status === 'SENT_TO_WAREHOUSE' && <Button onClick={() => void start()} disabled={busy} data-testid="pick-start">Toplamaya başla</Button>}
          {canPick && data?.order.status === 'PICKING' && (
            <Button onClick={() => void finish()} disabled={busy || !data.progress.allPicked} data-testid="pick-ready">Hazır</Button>
          )}
          {data && ['READY', 'PARTIALLY_SHIPPED'].includes(data.order.status) && (
            <a href={`/shipments/?new=${orderId}`} className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90" data-testid="pick-to-shipment">
              İrsaliye kes
            </a>
          )}
        </>
      }
    >
      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Yükleniyor…</p>
      ) : error ? (
        <p className="py-10 text-center text-sm text-destructive">{(error as Error).message}</p>
      ) : data ? (
        <div className="space-y-3" data-testid="picking-panel" data-status={data.order.status}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={data.order.status} />
            {data.task?.assignee && <span className="text-xs text-muted-foreground">{data.task.assignee}</span>}
            {data.order.status === 'PICKING' && canPick && (
              <form
                className="ml-auto flex items-center gap-2"
                onSubmit={(e) => { e.preventDefault(); void submitScan(); }}
              >
                <Input
                  ref={scanRef}
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  placeholder="Barkod okut ya da kod yaz…"
                  aria-label="Barkod"
                  data-testid="scan-input"
                  className="w-64"
                  autoFocus
                />
                <Button type="submit" variant="outline" size="sm" disabled={busy}>Okut</Button>
              </form>
            )}
          </div>

          {msg && (
            <p role="status" data-testid="scan-message"
               className={`rounded-md border p-2 text-sm ${msg.ok ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}>
              {msg.text}
            </p>
          )}

          <div className="max-h-[50vh] overflow-auto rounded-md border">
            <table className="w-full text-sm" data-testid="pick-lines">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="w-8 px-2 py-2">#</th><th className="px-2 py-2">Ürün</th>
                  <th className="px-2 py-2">Barkod</th><th className="px-2 py-2 text-right">Sipariş</th>
                  <th className="px-2 py-2 text-right">Toplanan</th><th className="w-8 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l, i) => (
                  <tr key={l.id} className={`border-b last:border-0 ${l.done ? 'bg-emerald-500/5' : ''}`} data-done={l.done}>
                    <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-2">
                      <span className="font-mono text-xs text-muted-foreground">{l.product?.code}</span> {l.description}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{l.barcode ?? '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatQty(l.targetQty, 0)} {l.unitCode ?? ''}</td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number" min={0} step="any" value={Number(l.pickedQty)}
                        disabled={!canPick || data.order.status !== 'PICKING'}
                        aria-label={`${l.product?.code} toplanan`}
                        data-testid={`pick-qty-${i}`}
                        onChange={(e) => void setQty(l.id, Number(e.target.value))}
                        className="h-8 w-24 rounded border border-input bg-card px-2 text-right text-sm"
                      />
                    </td>
                    <td className="px-2 py-2 text-center">{l.done ? '✓' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
