'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMoney } from '@cora/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiJson } from '@/lib/problem';

interface RiskRow {
  id: string; code: string; name: string; city: string | null;
  creditLimit: number; exposure: number; usagePct: number; overLimit: boolean;
}

/** Kredi riski ekranı (P07): limitine yaklaşan ve aşan cariler. */
export function RiskScreen() {
  const [threshold, setThreshold] = useState(80);
  const { data, isLoading, error } = useQuery({
    queryKey: ['partner-risk', threshold],
    queryFn: () => apiJson<{ items: RiskRow[]; threshold: number }>(`/api/v1/partners/risk?threshold=${threshold}`),
  });

  const rows = data?.items ?? [];
  const over = rows.filter((r) => r.overLimit);

  return (
    <div className="space-y-6" data-testid="risk-screen">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <a href="/partners/" className="text-sm text-primary hover:underline">← Cariler</a>
          <h1 className="text-2xl font-semibold">Kredi riski</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? 'Yükleniyor…' : `${rows.length} cari eşiğin üstünde · ${over.length} tanesi limiti aşmış`}
          </p>
        </div>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Eşik (limit kullanımı %)</span>
          <Input type="number" min={1} max={200} value={threshold} onChange={(e) => setThreshold(Number(e.target.value) || 80)}
                 className="w-32" aria-label="Eşik" data-testid="risk-threshold" />
        </label>
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? <p className="py-16 text-center text-sm text-destructive">{(error as Error).message}</p>
            : isLoading ? <div className="space-y-2 p-6">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-9 animate-pulse rounded bg-muted" />)}</div>
            : rows.length === 0 ? (
              <div className="grid place-items-center gap-2 py-20 text-center">
                <p className="text-sm font-medium">Eşiği aşan cari yok</p>
                <p className="max-w-md text-sm text-muted-foreground">Açık siparişler ve bakiye, kredi limitinin %{threshold}’ının altında.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-sm" data-testid="risk-table">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="px-4 py-3">Cari</th><th className="px-4 py-3">Şehir</th>
                      <th className="px-4 py-3 text-right">Limit</th><th className="px-4 py-3 text-right">Risk</th>
                      <th className="px-4 py-3">Kullanım</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} onClick={() => window.location.assign(`/partners/?id=${r.id}&tab=statement`)}
                          className={`cursor-pointer border-b last:border-0 hover:bg-muted ${r.overLimit ? 'bg-destructive/5' : ''}`}>
                        <td className="px-4 py-2"><span className="font-mono text-xs text-muted-foreground">{r.code}</span> {r.name}</td>
                        <td className="px-4 py-2 text-muted-foreground">{r.city ?? '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.creditLimit)}</td>
                        <td className={`px-4 py-2 text-right font-medium tabular-nums ${r.overLimit ? 'text-destructive' : ''}`}>{formatMoney(r.exposure)}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-28 rounded-full bg-muted">
                              <div className={`h-2 rounded-full ${r.overLimit ? 'bg-destructive' : 'bg-amber-500'}`} style={{ width: `${Math.min(r.usagePct, 100)}%` }} />
                            </div>
                            <span className="tabular-nums">%{r.usagePct}</span>
                          </div>
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
  );
}
