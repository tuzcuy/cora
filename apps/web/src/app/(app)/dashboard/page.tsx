'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMoney, formatQty } from '@cora/shared';
import { apiFetch } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface MonthRow { month: string; orders: number; quotes: number; revenue: string; profit: string }
interface TopProduct { id: string; code: string; name: string; qty: string; revenue: string }
interface TopCustomer { id: string; code: string; name: string; city: string | null; orders: number; revenue: string }
interface Rep { id: string; name: string; repCode: string | null; quotes: number; approved: number; conversion: number; orders: number; revenue: string; profit?: string }

interface Dashboard {
  kpis: Record<string, string | number>;
  months: MonthRow[];
  topProducts: TopProduct[];
  topCustomers: TopCustomer[];
  reps: Rep[];
}

async function fetchDashboard(): Promise<Dashboard> {
  const res = await apiFetch('/api/v1/reports/dashboard');
  if (!res.ok) throw new Error('Panel verisi yüklenemedi');
  return res.json();
}

const MONTH_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const shortMonth = (m: string) => {
  const [y, mm] = m.split('-');
  return `${MONTH_TR[Number(mm) - 1]} ${y!.slice(2)}`;
};

/** Single-series monthly revenue. One measure, one axis, one hue. */
function RevenueChart({ months }: { months: MonthRow[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(...months.map((m) => Number(m.revenue)), 1);
  const peak = months.reduce((a, b) => (Number(b.revenue) > Number(a.revenue) ? b : a), months[0]!);

  if (asTable) {
    return (
      <div>
        <div className="mb-3 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setAsTable(false)}>Grafiğe dön</Button>
        </div>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2">Ay</th><th className="py-2 text-right">Teklif</th>
                <th className="py-2 text-right">Sipariş</th><th className="py-2 text-right">Ciro</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-b last:border-0">
                  <td className="py-1.5">{shortMonth(m.month)}</td>
                  <td className="py-1.5 text-right">{m.quotes}</td>
                  <td className="py-1.5 text-right">{m.orders}</td>
                  <td className="py-1.5 text-right">{formatMoney(m.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Zirve: <span className="font-medium text-foreground">{shortMonth(peak.month)}</span> · {formatMoney(peak.revenue)}
        </p>
        <Button variant="ghost" size="sm" onClick={() => setAsTable(true)}>Tablo görünümü</Button>
      </div>

      <div className="relative">
        {/* recessive gridlines */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          {[0, 1, 2, 3].map((i) => <div key={i} className="border-t border-border/60" />)}
        </div>

        <div className="relative flex h-56 items-end gap-[2px]">
          {months.map((m, i) => {
            const h = (Number(m.revenue) / max) * 100;
            return (
              <div
                key={m.month}
                className="group relative flex flex-1 items-end"
                style={{ height: '100%' }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <div
                  className={`w-full rounded-t-[4px] transition-colors ${
                    hover === i ? 'bg-primary' : 'bg-primary/70'
                  }`}
                  style={{ height: `${Math.max(h, 1)}%` }}
                  role="img"
                  aria-label={`${shortMonth(m.month)}: ${formatMoney(m.revenue)}, ${m.orders} sipariş`}
                />
                {hover === i && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-44 -translate-x-1/2 rounded-md border bg-card p-2 text-xs shadow-lg">
                    <p className="font-medium">{shortMonth(m.month)}</p>
                    <p className="mt-1 flex justify-between"><span className="text-muted-foreground">Ciro</span><span>{formatMoney(m.revenue)}</span></p>
                    <p className="flex justify-between"><span className="text-muted-foreground">Sipariş</span><span>{m.orders}</span></p>
                    <p className="flex justify-between"><span className="text-muted-foreground">Teklif</span><span>{m.quotes}</span></p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-2 flex gap-[2px]">
          {months.map((m, i) => (
            <div key={m.month} className="flex-1 text-center text-[10px] text-muted-foreground">
              {/* label every 3rd month so ticks never collide */}
              {i % 3 === 0 || m.month === peak.month ? shortMonth(m.month) : ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Panel</h1>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}
        </div>
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Panel</h1>
        <Card><CardContent className="py-16 text-center text-sm text-destructive">{(error as Error).message}</CardContent></Card>
      </div>
    );
  }
  if (!data) return null;

  const k = data.kpis;
  const kpis: { label: string; value: string; hint?: string }[] = [
    { label: 'Bu ay ciro', value: formatMoney(k.monthRevenue as string), hint: `${k.monthOrders} sipariş` },
    { label: 'Toplam ciro', value: formatMoney(k.totalRevenue as string), hint: `${k.totalOrders} sipariş` },
    ...(k.monthProfit !== undefined
      ? [{ label: 'Bu ay kâr', value: formatMoney(k.monthProfit as string) }]
      : []),
    { label: 'Açık sipariş', value: String(k.openOrders), hint: 'akışta' },
    { label: 'Bekleyen teklif', value: String(k.pendingQuotes) },
    { label: 'Müşteri', value: String(k.customers) },
    { label: 'Ürün', value: String(k.products) },
    { label: 'Kritik stok', value: String(k.lowStock), hint: 'ürün' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Panel</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((x) => (
          <Card key={x.label}>
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{x.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{x.value}</p>
              {x.hint && <p className="text-xs text-muted-foreground">{x.hint}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Aylık ciro — son 18 ay</CardTitle>
          <p className="text-sm text-muted-foreground">
            Antalya turizm sezonu: Nisan–Ekim yüksek, Mayıs–Haziran zirve, Kasım–Mart düşük.
          </p>
        </CardHeader>
        <CardContent><RevenueChart months={data.months} /></CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>En çok satan 10 ürün</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2">Ürün</th><th className="px-4 py-2 text-right">Adet</th><th className="px-4 py-2 text-right">Ciro</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted">
                    <td className="px-4 py-2">
                      <a className="hover:underline" href={`/products/?id=${p.id}`}>
                        <span className="font-medium">{p.name}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{p.code}</span>
                      </a>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatQty(p.qty, 0)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>En yüksek cirolu 10 müşteri</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2">Müşteri</th><th className="px-4 py-2 text-right">Sipariş</th><th className="px-4 py-2 text-right">Ciro</th>
                </tr>
              </thead>
              <tbody>
                {data.topCustomers.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted">
                    <td className="px-4 py-2">
                      <a className="hover:underline" href={`/partners/?id=${c.id}`}>
                        <span className="font-medium">{c.name}</span>
                        <span className="block text-xs text-muted-foreground">{c.city ?? c.code}</span>
                      </a>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.orders}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(c.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Satış temsilcisi performansı</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-2">Temsilci</th><th className="px-4 py-2 text-right">Teklif</th>
                <th className="px-4 py-2 text-right">Onaylı</th><th className="px-4 py-2 text-right">Dönüşüm</th>
                <th className="px-4 py-2 text-right">Sipariş</th><th className="px-4 py-2 text-right">Ciro</th>
                {data.reps[0]?.profit !== undefined && <th className="px-4 py-2 text-right">Kâr</th>}
              </tr>
            </thead>
            <tbody>
              {data.reps.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted">
                  <td className="px-4 py-2 font-medium">{r.name}<span className="ml-2 text-xs text-muted-foreground">{r.repCode}</span></td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.quotes}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.approved}</td>
                  <td className="px-4 py-2 text-right tabular-nums">%{r.conversion.toFixed(1)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.orders}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.revenue)}</td>
                  {r.profit !== undefined && <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.profit)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
