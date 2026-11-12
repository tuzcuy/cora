'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { formatMoney } from '@cora/shared';
import { apiFetch } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge, STATUS_LABEL, trDate } from '@/components/doc-status';
import { apiJson, ApiError } from '@/lib/problem';
import { DocumentEditor } from '@/components/sales/document-editor';
import { downloadFile } from '@/lib/download';
import { useAuth } from '@/components/auth-provider';

interface DocRow {
  id: string;
  type: string;
  number: string;
  status: string;
  date: string;
  currency: string;
  lineCount: number;
  subtotalLocal: string;
  grandTotal: string;
  grandTotalLocal: string;
  profitLocal?: string;
  marginPct?: string;
  partner: { id: string; code: string; name: string; city: string | null } | null;
  salesRep: { id: string; name: string } | null;
}

interface ListResponse {
  items: DocRow[];
  total: number;
  totals: { netLocal: string; grossLocal: string };
  facets: { statuses: { status: string; count: number }[] };
}

const PAGE_SIZE = 100;
/** Bulk targets — the state machine still validates each document individually. */
const BULK_TARGETS = [
  { to: 'SENT', label: 'Gönderildi', types: ['QUOTE'] },
  { to: 'APPROVED', label: 'Onayla', types: ['QUOTE', 'ORDER'] },
  { to: 'SENT_TO_WAREHOUSE', label: 'Depoya Gönder', types: ['ORDER'] },
  { to: 'EXPIRED', label: 'Süresi Doldu', types: ['QUOTE'] },
  { to: 'CANCELLED', label: 'İptal', types: ['QUOTE', 'ORDER'] },
];

async function fetchList(p: URLSearchParams): Promise<ListResponse> {
  const res = await apiFetch(`/api/v1/sales/documents?${p}`);
  if (!res.ok) throw new Error('Belgeler yüklenemedi');
  return res.json();
}
export function DocumentsScreen({
  type,
  title,
  statusIn,
  emptyText,
}: {
  type: 'QUOTE' | 'ORDER';
  title: string;
  statusIn?: string[];
  emptyText?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const basePath = typeof window !== 'undefined' ? window.location.pathname : '/';

  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const { user } = useAuth();
  const perms = user?.permissions ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTo, setBulkTo] = useState('');
  const [bulkNote, setBulkNote] = useState('');
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rowAction = async (d: DocRow, action: 'copy' | 'revise' | 'convert') => {
    setBusy(true);
    try {
      const res = await apiJson<{ id: string; type: string }>(`/api/v1/sales-documents/${d.id}/${action}`, { method: 'POST', json: {} });
      window.location.assign(`${res.type === 'ORDER' ? '/orders/' : '/quotes/'}?id=${res.id}`);
    } catch (e) { setBulkMsg((e as Error).message); setBusy(false); }
  };
  const bulkTransition = async () => {
    if (!bulkTo || selected.size === 0) return;
    if (bulkTo === 'CANCELLED' && !bulkNote.trim()) { setBulkMsg('İptal için sebep zorunlu.'); return; }
    setBusy(true); setBulkMsg(null);
    try {
      const res = await apiJson<{ results: { id: string; ok: boolean; error?: string }[] }>('/api/v1/sales-documents/bulk-transition', {
        method: 'POST', json: { ids: [...selected], toStatus: bulkTo, note: bulkNote || undefined },
      });
      const ok = res.results.filter((r) => r.ok).length;
      const fail = res.results.filter((r) => !r.ok);
      setBulkMsg(`${ok} belge güncellendi${fail.length ? `, ${fail.length} başarısız: ${fail.map((f) => f.error).filter(Boolean).slice(0, 3).join(' · ')}` : ''}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['documents'] });
    } catch (e) { setBulkMsg(e instanceof ApiError ? e.message : (e as Error).message); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const t = setTimeout(() => setDq(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [dq, status, dateFrom, dateTo]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ type, page: String(page), pageSize: String(PAGE_SIZE) });
    if (dq.trim()) p.set('q', dq.trim());
    if (status) p.set('status', status);
    else if (statusIn?.length === 1) p.set('status', statusIn[0]!);
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    return p;
  }, [type, dq, status, statusIn, dateFrom, dateTo, page]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['documents', params.toString()],
    queryFn: () => fetchList(params),
    placeholderData: keepPreviousData,
  });

  if (id) return <DocumentEditor type={type} id={id} basePath={basePath} />;

  const rows = (data?.items ?? []).filter((d) => !statusIn || statusIn.includes(d.status));
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const facets = (data?.facets.statuses ?? []).filter((s) => !statusIn || statusIn.includes(s.status));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? 'Yükleniyor…' : `${total.toLocaleString('tr-TR')} belge · ${formatMoney(data?.totals.netLocal ?? '0')} net`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Belge no veya müşteri" className="w-64" aria-label="Belge ara" />
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" aria-label="Başlangıç tarihi" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" aria-label="Bitiş tarihi" />
          {perms.includes('export.excel') && (
            <Button
              variant="outline"
              onClick={() => void downloadFile(`/api/v1/documents/export/documents.xlsx?type=${type}${status ? `&status=${status}` : ''}${dateFrom ? `&dateFrom=${dateFrom}` : ''}${dateTo ? `&dateTo=${dateTo}` : ''}`, 'cora-belgeler.xlsx').catch((e) => setBulkMsg((e as Error).message))}
              data-testid="export-documents"
            >
              Excel
            </Button>
          )}
          {perms.includes(type === 'QUOTE' ? 'quote.write' : 'order.write') && (
            <a href={`${basePath}new/`} data-testid="new-document" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              + Yeni {type === 'QUOTE' ? 'teklif' : 'sipariş'}
            </a>
          )}
        </div>
      </div>

      {(selected.size > 0 || bulkMsg) && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm" data-testid="bulk-bar">
          {selected.size > 0 && (
            <>
              <span className="font-medium">{selected.size} seçili</span>
              <select value={bulkTo} onChange={(e) => setBulkTo(e.target.value)} className="h-9 rounded-md border border-input bg-card px-2 text-sm" aria-label="Toplu durum">
                <option value="">Durum seç…</option>
                {BULK_TARGETS.filter((t) => t.types.includes(type)).map((t) => <option key={t.to} value={t.to}>{t.label}</option>)}
              </select>
              <Input value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} placeholder={bulkTo === 'CANCELLED' ? 'İptal sebebi (zorunlu)' : 'Not'} className="h-9 w-56" aria-label="Toplu not" />
              <Button size="sm" onClick={() => void bulkTransition()} disabled={busy || !bulkTo}>Uygula</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Temizle</Button>
            </>
          )}
          {bulkMsg && <span className="text-muted-foreground">{bulkMsg}</span>}
        </div>
      )}

      {facets.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Button variant={status ? 'outline' : 'default'} size="sm" onClick={() => setStatus(null)}>
            Tümü {total > 0 && <span className="opacity-70">({total})</span>}
          </Button>
          {facets.map((s) => (
            <Button
              key={s.status}
              variant={status === s.status ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatus(status === s.status ? null : s.status)}
            >
              {STATUS_LABEL[s.status] ?? s.status} <span className="opacity-70">({s.count})</span>
            </Button>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {error ? (
            <p className="py-20 text-center text-sm text-destructive">{(error as Error).message}</p>
          ) : isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 10 }, (_, i) => <div key={i} className="h-9 animate-pulse rounded bg-muted" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="grid place-items-center gap-2 py-20 text-center">
              <p className="text-sm font-medium">Kayıt yok</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {emptyText ?? 'Seçili filtrelerle eşleşen belge bulunamadı.'}
              </p>
            </div>
          ) : (
            // Windowed by server-side paging; the container scrolls so a 100-row
            // page stays responsive without a virtualiser dependency.
            <div ref={scroller} className="max-h-[70vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="w-8 px-3 py-3">
                      <input type="checkbox" aria-label="Tümünü seç" checked={rows.length > 0 && rows.every((r) => selected.has(r.id))} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
                    </th>
                    <th className="px-4 py-3">Belge</th><th className="px-4 py-3">Tarih</th>
                    <th className="px-4 py-3">Müşteri</th><th className="px-4 py-3">Temsilci</th>
                    <th className="px-4 py-3">Durum</th><th className="px-4 py-3 text-right">Satır</th>
                    <th className="px-4 py-3 text-right">Tutar</th>
                    <th className="px-2 py-3 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr
                      key={d.id}
                      onClick={() => router.push(`${basePath}?id=${d.id}`)}
                      className="cursor-pointer border-b last:border-0 hover:bg-muted"
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`${d.number} seç`} checked={selected.has(d.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n; })} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{d.number}</td>
                      <td className="whitespace-nowrap px-4 py-2">{trDate(d.date)}</td>
                      <td className="px-4 py-2">{d.partner?.name ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{d.salesRep?.name ?? '—'}</td>
                      <td className="px-4 py-2"><StatusBadge status={d.status} /></td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{d.lineCount}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right font-medium">
                        {formatMoney(d.grandTotal, d.currency)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-right" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => void rowAction(d, 'copy')} disabled={busy} title="Kopyala">Kopyala</button>
                        {type === 'QUOTE' && d.status !== 'APPROVED' && d.status !== 'CANCELLED' && (
                          <button type="button" className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => void rowAction(d, 'revise')} disabled={busy} title="Revize et">Revize</button>
                        )}
                        {type === 'QUOTE' && ['DRAFT', 'SENT', 'APPROVED'].includes(d.status) && (
                          <button type="button" className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => void rowAction(d, 'convert')} disabled={busy} title="Siparişe dönüştür">Dönüştür</button>
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

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => { setPage((p) => p - 1); scroller.current?.scrollTo({ top: 0 }); }}>← Önceki</Button>
          <span className="text-sm text-muted-foreground">{page} / {lastPage}</span>
          <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => { setPage((p) => p + 1); scroller.current?.scrollTo({ top: 0 }); }}>Sonraki →</Button>
        </div>
      )}
    </div>
  );
}
