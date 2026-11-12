'use client';

import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { formatMoney, formatQty } from '@cora/shared';
import { apiFetch } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type Tab = 'month' | 'product' | 'customer' | 'rep';

const TABS: { key: Tab; label: string }[] = [
  { key: 'month', label: 'Satış (aylık)' },
  { key: 'product', label: 'Ürün' },
  { key: 'customer', label: 'Müşteri' },
  { key: 'rep', label: 'Temsilci' },
];

async function fetchReport(groupBy: Tab): Promise<{ rows: Record<string, unknown>[] }> {
  const res = await apiFetch(`/api/v1/reports/sales?groupBy=${groupBy}`);
  if (!res.ok) throw new Error('Rapor yüklenemedi');
  return res.json();
}

const MONTH_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const shortMonth = (m: string) => {
  const [y, mm] = m.split('-');
  return `${MONTH_TR[Number(mm) - 1]} ${y}`;
};

/** Column spec per tab: [header, accessor, align]. */
const COLUMNS: Record<Tab, [string, (r: Record<string, unknown>) => string, 'left' | 'right'][]> = {
  month: [
    ['Ay', (r) => shortMonth(r.month as string), 'left'],
    ['Teklif', (r) => String(r.quotes ?? 0), 'right'],
    ['Sipariş', (r) => String(r.orders ?? 0), 'right'],
    ['Ciro', (r) => formatMoney(r.revenue as string), 'right'],
    ['Kâr', (r) => formatMoney((r.profit as string) ?? '0'), 'right'],
  ],
  product: [
    ['Kod', (r) => r.code as string, 'left'],
    ['Ürün', (r) => r.name as string, 'left'],
    ['Adet', (r) => formatQty(r.qty as string, 0), 'right'],
    ['Ciro', (r) => formatMoney(r.revenue as string), 'right'],
  ],
  customer: [
    ['Kod', (r) => r.code as string, 'left'],
    ['Müşteri', (r) => r.name as string, 'left'],
    ['Şehir', (r) => (r.city as string) ?? '—', 'left'],
    ['Sipariş', (r) => String(r.orders ?? 0), 'right'],
    ['Ciro', (r) => formatMoney(r.revenue as string), 'right'],
  ],
  rep: [
    ['Temsilci', (r) => r.name as string, 'left'],
    ['Teklif', (r) => String(r.quotes ?? 0), 'right'],
    ['Onaylı', (r) => String(r.approved ?? 0), 'right'],
    ['Dönüşüm', (r) => `%${Number(r.conversion ?? 0).toFixed(1)}`, 'right'],
    ['Sipariş', (r) => String(r.orders ?? 0), 'right'],
    ['Ciro', (r) => formatMoney(r.revenue as string), 'right'],
  ],
};

/** Excel only reads a UTF-8 CSV correctly when it starts with a byte-order mark.
 *  Built with fromCharCode so no BOM character ever sits in this source file. */
const BOM = String.fromCharCode(0xfeff);

function toCsv(tab: Tab, rows: Record<string, unknown>[]) {
  const cols = COLUMNS[tab];
  const head = cols.map((c) => c[0]).join(';');
  const body = rows.map((r) => cols.map((c) => c[1](r).replace(/;/g, ',')).join(';')).join('\n');
  return `${head}\n${body}`;
}

export default function Page() {
  const [tab, setTab] = useState<Tab>('month');
  const { data, isLoading, error } = useQuery({
    queryKey: ['report', tab],
    queryFn: () => fetchReport(tab),
    placeholderData: keepPreviousData,
  });

  const cols = COLUMNS[tab];
  const rows = data?.rows ?? [];

  const download = () => {
    const blob = new Blob([BOM + toCsv(tab, rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cora-rapor-${tab}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Raporlar</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? 'Yükleniyor…' : `${rows.length} satır`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={download} disabled={rows.length === 0}>
          CSV indir
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button
            key={t.key}
            variant={tab === t.key ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <p className="py-20 text-center text-sm text-destructive">{(error as Error).message}</p>
          ) : isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 10 }, (_, i) => <div key={i} className="h-8 animate-pulse rounded bg-muted" />)}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-20 text-center text-sm text-muted-foreground">Bu kırılımda veri yok.</p>
          ) : (
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b text-xs uppercase text-muted-foreground">
                    {cols.map((c) => (
                      <th key={c[0]} className={`px-4 py-3 ${c[2] === 'right' ? 'text-right' : 'text-left'}`}>
                        {c[0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted">
                      {cols.map((c) => (
                        <td
                          key={c[0]}
                          className={`px-4 py-2 ${c[2] === 'right' ? 'text-right tabular-nums' : ''}`}
                        >
                          {c[1](r)}
                        </td>
                      ))}
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
