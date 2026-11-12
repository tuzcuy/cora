'use client';

import { useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { trDateTime } from '@/components/doc-status';
import { useAuth } from '@/components/auth-provider';
import { apiJson, ApiError } from '@/lib/problem';

interface EDocRow {
  id: string; kind: string; status: string; ettn: string; number: string;
  providerName: string; providerId: string | null;
  responseCode: string | null; responseText: string | null; explanation: string;
  attempts: number; sentAt: string | null; createdAt: string;
  partner: { id: string; name: string } | null;
  shipment: { id: string; number: string } | null;
  document: { id: string; number: string; type: string } | null;
}

interface ListResponse {
  items: EDocRow[];
  total: number;
  facets: { statuses: { status: string; count: number }[] };
  provider: { provider: string; configured: boolean; message: string };
}

const KIND_LABEL: Record<string, string> = { E_INVOICE: 'e-Fatura', E_ARCHIVE: 'e-Arşiv', E_DESPATCH: 'e-İrsaliye' };
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Taslak', QUEUED: 'Kuyrukta', SENDING: 'Gönderiliyor', SENT: 'Gönderildi',
  ACCEPTED: 'Kabul edildi', REJECTED: 'Reddedildi', CANCELLED: 'İptal', ERROR: 'Hata',
};
const STATUS_TONE: Record<string, string> = {
  QUEUED: 'bg-muted text-muted-foreground',
  SENDING: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  SENT: 'bg-primary/10 text-primary',
  ACCEPTED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  REJECTED: 'bg-destructive/10 text-destructive',
  ERROR: 'bg-destructive/10 text-destructive',
  CANCELLED: 'bg-muted text-muted-foreground',
};

/** e-Belge kuyruğu (P09): hazırla → gönder → durum takibi. */
export function EDocsScreen() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canSend = (user?.permissions ?? []).includes('shipment.post');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<EDocRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['edocs', status, kind, page],
    queryFn: () => apiJson<ListResponse>(`/api/v1/edocs?${new URLSearchParams({ status, kind, page: String(page), pageSize: '50' })}`),
    placeholderData: keepPreviousData,
  });

  const act = async (path: string, ok: string) => {
    setBusy(true); setError(null);
    try {
      await apiJson(path, { method: 'POST', json: {} });
      await qc.invalidateQueries({ queryKey: ['edocs'] });
      setFlash(ok);
      setTimeout(() => setFlash(null), 6000);
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  const rows = data?.items ?? [];
  const provider = data?.provider;
  const lastPage = Math.max(1, Math.ceil((data?.total ?? 0) / 50));

  return (
    <div className="space-y-6" data-testid="edocs-screen">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">e-Belgeler</h1>
          <p className="text-sm text-muted-foreground">{isLoading ? 'Yükleniyor…' : `${(data?.total ?? 0).toLocaleString('tr-TR')} belge kuyrukta / gönderilmiş`}</p>
        </div>
        {canSend && <Button onClick={() => void act('/api/v1/edocs/send-queue', 'Kuyruk işlendi.')} disabled={busy} data-testid="send-queue">Kuyruğu gönder</Button>}
      </div>

      {provider && (
        <div className={`rounded-md border p-3 text-sm ${provider.configured ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'}`} data-testid="provider-status">
          {provider.message} Mali mühür Cora’da tutulmaz; imzalama ve GİB’e iletim entegratörde kalır.
        </div>
      )}
      {flash && <div role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">{flash}</div>}
      {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} aria-label="Belge tipi" className="h-10 rounded-md border border-input bg-card px-3 text-sm">
          <option value="">Tüm tipler</option>
          {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <Button size="sm" variant={status ? 'outline' : 'default'} onClick={() => { setStatus(''); setPage(1); }}>Tümü</Button>
        {(data?.facets.statuses ?? []).map((f) => (
          <Button key={f.status} size="sm" variant={status === f.status ? 'default' : 'outline'} onClick={() => { setStatus(f.status); setPage(1); }}>
            {STATUS_LABEL[f.status] ?? f.status} <span className="ml-1 opacity-70">({f.count})</span>
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? <div className="space-y-2 p-6">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-9 animate-pulse rounded bg-muted" />)}</div>
            : rows.length === 0 ? (
              <div className="grid place-items-center gap-2 py-20 text-center">
                <p className="text-sm font-medium">e-Belge yok</p>
                <p className="max-w-lg text-sm text-muted-foreground">
                  İşlenmiş bir irsaliyeyi Sevkiyat ekranından “e-İrsaliye gönder” ile kuyruğa alın. Entegratör bağlı
                  değilse belge hazırlanır, kuyrukta bekler ve durumu burada görünür.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[48rem] text-sm" data-testid="edocs-table">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="px-4 py-3">Belge</th><th className="px-4 py-3">Tip</th>
                      <th className="px-4 py-3">Müşteri</th><th className="px-4 py-3">Durum</th>
                      <th className="px-4 py-3">Açıklama</th><th className="px-4 py-3 text-right">Deneme</th>
                      <th className="px-4 py-3 text-right">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e) => (
                      <tr key={e.id} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="cursor-pointer whitespace-nowrap px-4 py-2 font-mono text-xs" onClick={() => setDetail(e)}>{e.number}</td>
                        <td className="whitespace-nowrap px-4 py-2">{KIND_LABEL[e.kind] ?? e.kind}</td>
                        <td className="px-4 py-2">{e.partner?.name ?? '—'}</td>
                        <td className="px-4 py-2"><span className={`rounded px-2 py-0.5 text-xs ${STATUS_TONE[e.status] ?? 'bg-muted'}`}>{STATUS_LABEL[e.status] ?? e.status}</span></td>
                        <td className="max-w-[22rem] truncate px-4 py-2 text-muted-foreground" title={e.explanation}>{e.explanation}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{e.attempts}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right">
                          <button type="button" className="rounded px-2 py-1 text-xs text-primary hover:bg-muted" onClick={() => setDetail(e)}>Detay</button>
                          {canSend && ['QUEUED', 'ERROR'].includes(e.status) && (
                            <button type="button" className="rounded px-2 py-1 text-xs text-primary hover:bg-muted" disabled={busy}
                                    onClick={() => void act(`/api/v1/edocs/${e.id}/send`, `${e.number} gönderildi.`)} data-testid={`send-${e.id}`}>Gönder</button>
                          )}
                          {['SENT', 'SENDING'].includes(e.status) && (
                            <button type="button" className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted" disabled={busy}
                                    onClick={() => void act(`/api/v1/edocs/${e.id}/refresh`, `${e.number} durumu güncellendi.`)}>Durum sorgula</button>
                          )}
                        </td>
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
          <span className="text-sm text-muted-foreground">{page} / {lastPage}</span>
          <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>Sonraki →</Button>
        </div>
      )}

      <Dialog open={!!detail} onClose={() => setDetail(null)} title={detail ? `${KIND_LABEL[detail.kind]} · ${detail.number}` : ''} width="max-w-2xl">
        {detail && (
          <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm" data-testid="edoc-detail">
            <dt className="text-muted-foreground">Durum</dt><dd>{STATUS_LABEL[detail.status] ?? detail.status}</dd>
            <dt className="text-muted-foreground">ETTN</dt><dd className="font-mono text-xs">{detail.ettn}</dd>
            <dt className="text-muted-foreground">Entegratör</dt><dd>{detail.providerName}{detail.providerId ? ` · ${detail.providerId}` : ''}</dd>
            <dt className="text-muted-foreground">Yanıt kodu</dt><dd>{detail.responseCode ?? '—'}</dd>
            <dt className="text-muted-foreground">Açıklama</dt><dd>{detail.explanation}</dd>
            <dt className="text-muted-foreground">Deneme</dt><dd>{detail.attempts}</dd>
            <dt className="text-muted-foreground">Gönderim</dt><dd>{detail.sentAt ? trDateTime(detail.sentAt) : '—'}</dd>
            <dt className="text-muted-foreground">Kaynak</dt>
            <dd>
              {detail.shipment && <a className="text-primary hover:underline" href={`/shipments/?id=${detail.shipment.id}`}>{detail.shipment.number}</a>}
              {detail.document && <a className="text-primary hover:underline" href={`/orders/?id=${detail.document.id}`}>{detail.document.number}</a>}
            </dd>
          </dl>
        )}
      </Dialog>
    </div>
  );
}
