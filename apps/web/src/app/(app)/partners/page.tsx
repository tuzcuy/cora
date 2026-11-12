'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { formatMoney } from '@cora/shared';
import { apiFetch } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/components/auth-provider';
import { PartnerForm } from '@/components/partners/partner-form';
import { PartnerStatement } from '@/components/partners/partner-statement';
import { StatusBadge, trDate } from '@/components/doc-status';

interface PartnerRow {
  id: string;
  code: string;
  name: string;
  type: string;
  groupName: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  paymentTermDays: number;
  balance: string | null;
  creditLimit: string | null;
  salesRep: { id: string; name: string } | null;
  tags: string[];
}

interface PartnerListResponse {
  items: PartnerRow[];
  total: number;
  facets: { groups: { id: string; name: string; count: number }[] };
}

interface PartnerDetail extends PartnerRow {
  taxOffice: string | null;
  taxNumber: string | null;
  country: string;
  notes: string | null;
  contacts: { id: string; name: string; title: string | null; phone: string | null; email: string | null; isPrimary: boolean }[];
  addresses: { id: string; type: string; title: string | null; line1: string; district: string | null; city: string | null }[];
  totals: { orderCount: number; quoteCount: number; netSales: string; grossSales: string };
  documents: {
    id: string; type: string; number: string; status: string;
    date: string; currency: string; grandTotal: string; grandTotalLocal: string;
  }[];
}

const PAGE_SIZE = 50;

async function fetchList(p: URLSearchParams): Promise<PartnerListResponse> {
  const res = await apiFetch(`/api/v1/partners?${p}`);
  if (!res.ok) throw new Error('Cariler yüklenemedi');
  return res.json();
}
async function fetchDetail(id: string): Promise<PartnerDetail> {
  const res = await apiFetch(`/api/v1/partners/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error('Cari yüklenemedi');
  return res.json();
}

function DetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['partner', id], queryFn: () => fetchDetail(id) });
  if (isLoading) return <div className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</div>;
  if (error) return <p className="py-16 text-center text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  const info: [string, string][] = [
    ['Kod', data.code],
    ['Bölge', data.groupName ?? '—'],
    ['Şehir', data.city ?? '—'],
    ['Vergi dairesi', data.taxOffice ?? '—'],
    ['Vergi no', data.taxNumber ?? '—'],
    ['Telefon', data.phone ?? '—'],
    ['E-posta', data.email ?? '—'],
    ['Vade', `${data.paymentTermDays} gün`],
    ['Temsilci', data.salesRep?.name ?? '—'],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 -ml-2">← Cariler</Button>
          <h1 className="text-2xl font-semibold">{data.name}</h1>
          <p className="text-sm text-muted-foreground">{data.code} · {data.notes ?? data.groupName}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/partners/?id=${id}&tab=statement`} data-testid="detail-statement"
             className="inline-flex h-10 items-center rounded-md border border-input px-4 text-sm hover:bg-muted">Ekstre</a>
          <a href={`/partners/?id=${id}&tab=edit`} data-testid="detail-edit"
             className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Kartı düzenle</a>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Toplam satış (net)', value: formatMoney(data.totals.netSales) },
          { label: 'Sipariş', value: String(data.totals.orderCount) },
          { label: 'Teklif', value: String(data.totals.quoteCount) },
          { label: 'Bakiye', value: data.balance ? formatMoney(data.balance) : '—' },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</p>
              <p className="mt-1 text-xl font-semibold">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Cari bilgileri</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              {info.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt><dd className="truncate">{v}</dd>
                </div>
              ))}
            </dl>
            {data.contacts.length > 0 && (
              <div className="mt-4 border-t pt-4">
                <p className="mb-2 text-xs uppercase text-muted-foreground">Yetkili</p>
                {data.contacts.map((c) => (
                  <div key={c.id} className="text-sm">
                    <span className="font-medium">{c.name}</span>
                    {c.title && <span className="text-muted-foreground"> · {c.title}</span>}
                    {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
                  </div>
                ))}
              </div>
            )}
            {data.addresses.length > 0 && (
              <div className="mt-4 border-t pt-4">
                <p className="mb-2 text-xs uppercase text-muted-foreground">Adres</p>
                {data.addresses.map((a) => (
                  <p key={a.id} className="text-sm text-muted-foreground">{a.line1}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Son belgeler</CardTitle></CardHeader>
          <CardContent className="p-0">
            {data.documents.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">Bu cariye ait belge yok.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2">Belge</th><th className="px-4 py-2">Tarih</th>
                    <th className="px-4 py-2">Durum</th><th className="px-4 py-2 text-right">Tutar</th>
                  </tr>
                </thead>
                <tbody>
                  {data.documents.map((d) => (
                    <tr key={d.id} className="border-b last:border-0 hover:bg-muted">
                      <td className="px-4 py-2">
                        <a
                          className="font-mono text-xs text-primary hover:underline"
                          href={`/${d.type === 'QUOTE' ? 'quotes' : 'orders'}/?id=${d.id}`}
                        >
                          {d.number}
                        </a>
                      </td>
                      <td className="px-4 py-2">{trDate(d.date)}</td>
                      <td className="px-4 py-2"><StatusBadge status={d.status} /></td>
                      <td className="px-4 py-2 text-right">{formatMoney(d.grandTotal, d.currency)}</td>
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

function PartnersScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const id = search.get('id');
  const tab = search.get('tab');
  const isNew = search.get('new') === '1';
  const { user } = useAuth();
  const canWrite = (user?.permissions ?? []).includes('partner.write');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setDq(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [dq, groupId]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), type: 'CUSTOMER' });
    if (dq.trim()) p.set('q', dq.trim());
    if (groupId) p.set('groupId', groupId);
    return p;
  }, [dq, groupId, page]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['partners', params.toString()],
    queryFn: () => fetchList(params),
    placeholderData: keepPreviousData,
  });

  // P07: `?id=` opens the card, `?tab=statement` the account statement,
  // `?new=1` an empty card.
  if (isNew) return <PartnerForm onDone={(newId) => router.push(`/partners/?id=${newId}`)} onCancel={() => router.push('/partners/')} />;
  if (id && tab === 'statement') return <PartnerStatement partnerId={id} onBack={() => router.push(`/partners/?id=${id}`)} />;
  if (id && tab === 'edit') return <PartnerForm id={id} onDone={() => router.push(`/partners/?id=${id}`)} onCancel={() => router.push(`/partners/?id=${id}`)} />;
  if (id) return <DetailView id={id} onBack={() => router.push('/partners/')} />;

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cariler</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? 'Yükleniyor…' : `${total.toLocaleString('tr-TR')} müşteri`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari ara — ad, kod, şehir, vergi no"
            className="w-full sm:w-80"
            aria-label="Cari ara"
          />
          <a href="/partners/risk/" className="inline-flex h-10 items-center rounded-md border border-input px-4 text-sm hover:bg-muted" data-testid="open-risk">Risk</a>
          {canWrite && (
            <a href="/partners/?new=1" data-testid="new-partner" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              + Yeni cari
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[15rem_1fr]">
        <aside className="space-y-1">
          <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bölge</p>
          {groupId && (
            <button onClick={() => setGroupId(null)} className="w-full rounded px-2 py-1 text-left text-sm text-primary hover:bg-muted">
              ← Filtreyi kaldır
            </button>
          )}
          {(data?.facets.groups ?? []).map((g) => (
            <button
              key={g.id}
              onClick={() => setGroupId(groupId === g.id ? null : g.id)}
              className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-muted ${groupId === g.id ? 'bg-muted font-medium' : ''}`}
            >
              <span className="truncate">{g.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">{g.count}</span>
            </button>
          ))}
        </aside>

        <Card>
          <CardContent className="p-0">
            {error ? (
              <p className="py-20 text-center text-sm text-destructive">{(error as Error).message}</p>
            ) : isLoading ? (
              <div className="space-y-2 p-6">
                {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-9 animate-pulse rounded bg-muted" />)}
              </div>
            ) : (data?.items.length ?? 0) === 0 ? (
              <div className="grid place-items-center gap-2 py-20 text-center">
                <p className="text-sm font-medium">Sonuç yok</p>
                <p className="text-sm text-muted-foreground">Arama veya bölge filtresiyle eşleşen cari bulunamadı.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="px-4 py-3">Kod</th><th className="px-4 py-3">Ünvan</th>
                      <th className="px-4 py-3">Bölge</th><th className="px-4 py-3">Temsilci</th>
                      <th className="px-4 py-3">Vade</th><th className="px-4 py-3 text-right">Bakiye</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.items.map((p) => (
                      <tr
                        key={p.id}
                        onClick={() => router.push(`/partners/?id=${p.id}`)}
                        className="cursor-pointer border-b last:border-0 hover:bg-muted"
                      >
                        <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{p.code}</td>
                        <td className="px-4 py-2 font-medium">{p.name}</td>
                        <td className="whitespace-nowrap px-4 py-2">{p.groupName ?? '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2">{p.salesRep?.name ?? '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2">{p.paymentTermDays} gün</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right">
                          {p.balance ? formatMoney(p.balance) : '—'}
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
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Önceki</Button>
          <span className="text-sm text-muted-foreground">{page} / {lastPage}</span>
          <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>Sonraki →</Button>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</div>}>
      <PartnersScreen />
    </Suspense>
  );
}
