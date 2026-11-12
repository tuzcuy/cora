'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMoney } from '@cora/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge, trDate } from '@/components/doc-status';
import { apiJson } from '@/lib/problem';

interface Statement {
  partner: { id: string; code: string; name: string; currency: string };
  opening: string;
  closing: string;
  totalDebit: string;
  totalCredit: string;
  lines: { id: string; type: string; number: string; date: string; status: string; debit: string; credit: string; balance: string }[];
  risk: { creditLimit: number; balance: number; openOrders: number; exposure: number; available: number | null; overLimit: boolean; usagePct: number | null; paymentTermDays: number };
}

/** Cari ekstre (P07): açılış, belge bazında borç/alacak, yürüyen bakiye, risk. */
export function PartnerStatement({ partnerId, onBack }: { partnerId: string; onBack: () => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['statement', partnerId, from, to],
    queryFn: () => {
      const p = new URLSearchParams();
      if (from) p.set('dateFrom', from);
      if (to) p.set('dateTo', to);
      return apiJson<Statement>(`/api/v1/partners/${partnerId}/statement?${p}`);
    },
  });

  if (isLoading) return <p className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</p>;
  if (error) return <p className="py-16 text-center text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  return (
    <div className="space-y-4" data-testid="partner-statement">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={onBack}>← Cari kartı</Button>
          <h1 className="text-2xl font-semibold">{data.partner.name}</h1>
          <p className="text-sm text-muted-foreground">{data.partner.code} · cari ekstre</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Başlangıç" className="w-40" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Bitiş" className="w-40" />
        </div>
      </div>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Açılış bakiyesi', data.opening],
          ['Toplam borç', data.totalDebit],
          ['Toplam alacak', data.totalCredit],
          ['Kapanış bakiyesi', data.closing],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg font-semibold tabular-nums">{formatMoney(value, data.partner.currency)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-4 text-sm">
          <div><span className="block text-xs text-muted-foreground">Kredi limiti</span><span className="font-medium">{formatMoney(data.risk.creditLimit)}</span></div>
          <div><span className="block text-xs text-muted-foreground">Açık siparişler</span><span className="font-medium">{formatMoney(data.risk.openOrders)}</span></div>
          <div><span className="block text-xs text-muted-foreground">Toplam risk</span><span className={`font-medium ${data.risk.overLimit ? 'text-destructive' : ''}`}>{formatMoney(data.risk.exposure)}</span></div>
          {data.risk.available !== null && (
            <div><span className="block text-xs text-muted-foreground">Kalan limit</span><span className={`font-medium ${data.risk.available < 0 ? 'text-destructive' : ''}`}>{formatMoney(data.risk.available)}</span></div>
          )}
          <div><span className="block text-xs text-muted-foreground">Vade</span><span className="font-medium">{data.risk.paymentTermDays} gün</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {data.lines.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Bu aralıkta hareket yok.</p>
          ) : (
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full min-w-[44rem] text-sm" data-testid="statement-lines">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-3">Tarih</th><th className="px-4 py-3">Belge</th><th className="px-4 py-3">Durum</th>
                    <th className="px-4 py-3 text-right">Borç</th><th className="px-4 py-3 text-right">Alacak</th><th className="px-4 py-3 text-right">Bakiye</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b bg-muted/40">
                    <td className="px-4 py-2 text-muted-foreground" colSpan={3}>Açılış</td>
                    <td /><td />
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{formatMoney(data.opening)}</td>
                  </tr>
                  {data.lines.map((l) => (
                    <tr key={l.id} className="cursor-pointer border-b last:border-0 hover:bg-muted"
                        onClick={() => window.location.assign(l.type === 'RETURN' ? `/returns/?id=${l.id}` : `/orders/?id=${l.id}`)}>
                      <td className="whitespace-nowrap px-4 py-2">{trDate(l.date)}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{l.number}</td>
                      <td className="px-4 py-2"><StatusBadge status={l.status} /></td>
                      <td className="px-4 py-2 text-right tabular-nums">{Number(l.debit) ? formatMoney(l.debit) : '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{Number(l.credit) ? formatMoney(l.credit) : '—'}</td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums">{formatMoney(l.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
