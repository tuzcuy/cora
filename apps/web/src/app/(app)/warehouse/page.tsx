'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMoney, formatQty } from '@cora/shared';
import { apiFetch } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import { trDate } from '@/components/doc-status';
import { PickingPanel } from '@/components/warehouse/picking-panel';

interface BoardItem {
  id: string; number: string; status: string; date: string;
  deliveryDate: string | null; lineCount: number; grandTotalLocal: string;
  partner: { id: string; name: string; city: string | null } | null;
}
interface Board {
  columns: { key: string; label: string; total: number; items: BoardItem[] }[];
  reservedTotal: string;
}

async function fetchBoard(): Promise<Board> {
  const res = await apiFetch('/api/v1/warehouse/board');
  if (!res.ok) throw new Error('Depo panosu yüklenemedi');
  return res.json();
}

const COLUMN_TONE: Record<string, string> = {
  SENT_TO_WAREHOUSE: 'border-t-primary',
  PICKING: 'border-t-amber-500',
  READY: 'border-t-emerald-500',
  SHIPPED: 'border-t-muted-foreground',
};

export default function Page() {
  const { data, isLoading, error } = useQuery({ queryKey: ['warehouse-board'], queryFn: fetchBoard });
  // Clicking a card opens the pick list (P05); the order screen stays a link.
  const [pickingOrderId, setPickingOrderId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Depo</h1>
        <p className="text-sm text-muted-foreground">
          {isLoading
            ? 'Yükleniyor…'
            : data
              ? `Toplam ${formatQty(data.reservedTotal, 0)} adet rezerve stok`
              : ''}
        </p>
      </div>

      {error ? (
        <Card><CardContent className="py-16 text-center text-sm text-destructive">{(error as Error).message}</CardContent></Card>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-96 animate-pulse rounded-xl bg-muted" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {data!.columns.map((col) => (
            <div key={col.key} className="flex flex-col">
              <div className={`rounded-t-xl border-t-4 bg-card px-4 py-3 ${COLUMN_TONE[col.key] ?? 'border-t-border'}`}>
                <div className="flex items-baseline justify-between">
                  <h2 className="font-medium">{col.label}</h2>
                  <span className="rounded bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {col.total}
                  </span>
                </div>
              </div>
              <div className="max-h-[70vh] space-y-2 overflow-y-auto rounded-b-xl border border-t-0 bg-muted/30 p-2">
                {col.items.length === 0 ? (
                  <p className="px-2 py-8 text-center text-sm text-muted-foreground">Bu kolonda sipariş yok.</p>
                ) : (
                  col.items.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => setPickingOrderId(it.id)}
                      data-testid="board-card"
                      className="block w-full rounded-lg border bg-card p-3 text-left text-sm transition-colors hover:border-primary"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-primary">{it.number}</span>
                        <span className="text-xs text-muted-foreground">{it.lineCount} satır</span>
                      </div>
                      <p className="mt-1 truncate font-medium">{it.partner?.name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">{it.partner?.city ?? ''}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {it.deliveryDate ? `Teslim ${trDate(it.deliveryDate)}` : trDate(it.date)}
                        </span>
                        <span className="text-xs font-medium tabular-nums">{formatMoney(it.grandTotalLocal)}</span>
                      </div>
                    </button>
                  ))
                )}
                {col.total > col.items.length && (
                  <p className="px-2 py-2 text-center text-xs text-muted-foreground">
                    +{col.total - col.items.length} sipariş daha
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {pickingOrderId && <PickingPanel orderId={pickingOrderId} onClose={() => setPickingOrderId(null)} />}
    </div>
  );
}
