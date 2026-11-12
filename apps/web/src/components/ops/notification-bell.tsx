'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiJson } from '@/lib/problem';

interface Notification {
  id: string;
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  href: string;
  count?: number;
}

const TONE: Record<string, string> = {
  critical: 'border-l-destructive',
  warning: 'border-l-amber-500',
  info: 'border-l-primary',
};

/** Bildirim merkezi (P10): kritik stok, süresi dolan teklif, bekleyen sipariş… */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiJson<{ items: Notification[]; counts: Record<string, number> }>('/api/v1/ops/notifications'),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const items = data?.items ?? [];
  const critical = data?.counts.critical ?? 0;
  const total = items.length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Bildirimler${total ? ` (${total})` : ''}`}
        aria-expanded={open}
        data-testid="notification-bell"
        className="relative grid h-9 w-9 place-items-center rounded-md hover:bg-muted"
      >
        <span aria-hidden className="text-lg">🔔</span>
        {total > 0 && (
          <span
            data-testid="notification-count"
            className={`absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-medium text-white ${critical ? 'bg-destructive' : 'bg-amber-500'}`}
          >
            {total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-md border bg-card shadow-lg" data-testid="notification-panel">
          <p className="border-b px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">Bildirimler</p>
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Bekleyen uyarı yok.</p>
          ) : (
            <ul className="max-h-96 overflow-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <a href={n.href} className={`block border-l-4 px-3 py-2.5 hover:bg-muted ${TONE[n.severity] ?? 'border-l-border'}`}>
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="text-xs text-muted-foreground">{n.detail}</p>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <a href="/settings/health/" className="block border-t px-3 py-2 text-center text-xs text-primary hover:bg-muted">
            Sistem sağlığı →
          </a>
        </div>
      )}
    </div>
  );
}
