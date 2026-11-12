'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Lucide from 'lucide-react';
import { apiJson } from '@/lib/problem';
import { useAuth } from './auth-provider';

interface SearchResult {
  q: string;
  products: { id: string; code: string; name: string; salesPrice: string; hasImage: boolean }[];
  partners: { id: string; code: string; name: string; city: string | null; type: string }[];
  documents: {
    id: string;
    type: string;
    number: string;
    status: string;
    partner: string | null;
    grandTotalLocal: string;
  }[];
  shipments: {
    id: string;
    number: string;
    status: string;
    order: string | null;
    partner: string | null;
  }[];
}

interface Item {
  icon: string;
  label: string;
  sub?: string;
  href: string;
  group: string;
  recent?: boolean;
}

const RECENTS_KEY = 'cora:recents';
const docHref = (type: string, id: string) =>
  type === 'QUOTE'
    ? `/quotes/?id=${id}`
    : type === 'RETURN'
      ? `/returns/?id=${id}`
      : `/orders/?id=${id}`;
const headerOf = (it: Item) => (it.recent ? 'Son bakılanlar' : it.group);

function loadRecents(): Item[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]') as Item[];
  } catch {
    return [];
  }
}
function pushRecent(item: Item) {
  try {
    const cur = loadRecents().filter((r) => r.href !== item.href);
    localStorage.setItem(
      RECENTS_KEY,
      JSON.stringify([{ ...item, recent: true }, ...cur].slice(0, 6)),
    );
  } catch {
    /* ignore quota / disabled storage */
  }
}

/** Global command palette (FAZ 2): one box over products, partners, documents,
 *  shipments + quick actions. Opens with ⌘K / Ctrl+K or the header button. */
export function CommandPalette() {
  const { user } = useAuth();
  const perms = useMemo(() => new Set(user?.permissions ?? []), [user]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [res, setRes] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<Item[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setRecents(loadRecents());
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    } else {
      setQ('');
      setDq('');
      setRes(null);
    }
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDq(q), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open || dq.trim().length < 2) {
      setRes(null);
      return;
    }
    let alive = true;
    setLoading(true);
    apiJson<SearchResult>(`/api/v1/search?q=${encodeURIComponent(dq.trim())}`)
      .then((r) => alive && setRes(r))
      .catch(() => alive && setRes(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [dq, open]);

  const commands: Item[] = useMemo(() => {
    const c: Item[] = [];
    if (perms.has('quote.write'))
      c.push({ icon: 'FilePlus', label: 'Yeni teklif', href: '/quotes/new/', group: 'Eylemler' });
    if (perms.has('order.write'))
      c.push({ icon: 'FilePlus', label: 'Yeni sipariş', href: '/orders/new/', group: 'Eylemler' });
    if (perms.has('partner.write'))
      c.push({ icon: 'UserPlus', label: 'Yeni cari', href: '/partners/?new=1', group: 'Eylemler' });
    if (perms.has('stock.receive'))
      c.push({
        icon: 'PackagePlus',
        label: 'Stok girişi',
        href: '/stock/receipts/',
        group: 'Eylemler',
      });
    return c;
  }, [perms]);

  const items: Item[] = useMemo(() => {
    const term = dq.trim().toLocaleLowerCase('tr');
    if (term.length < 2) return [...recents, ...commands];
    const list: Item[] = commands.filter((c) => c.label.toLocaleLowerCase('tr').includes(term));
    if (res) {
      for (const p of res.products)
        list.push({
          icon: 'Package',
          label: p.name,
          sub: `${p.code} · ₺${p.salesPrice}`,
          href: `/products/?id=${p.id}`,
          group: 'Ürünler',
        });
      for (const p of res.partners)
        list.push({
          icon: 'Users',
          label: p.name,
          sub: [p.code, p.city].filter(Boolean).join(' · '),
          href: `/partners/?id=${p.id}`,
          group: 'Cariler',
        });
      for (const d of res.documents)
        list.push({
          icon: 'FileText',
          label: d.number,
          sub: [d.partner, `₺${d.grandTotalLocal}`].filter(Boolean).join(' · '),
          href: docHref(d.type, d.id),
          group: 'Belgeler',
        });
      for (const s of res.shipments)
        list.push({
          icon: 'Truck',
          label: s.number,
          sub: [s.partner, s.order].filter(Boolean).join(' · '),
          href: `/shipments/?id=${s.id}`,
          group: 'İrsaliyeler',
        });
    }
    return list;
  }, [dq, res, recents, commands]);

  useEffect(() => setActive(0), [dq, res]);

  const go = useCallback((it: Item) => {
    if (it.group !== 'Eylemler' && !it.recent) pushRecent(it);
    setOpen(false);
    window.location.assign(it.href);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[active];
      if (it) go(it);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="global-search"
        className="hidden h-9 w-full max-w-md items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground hover:bg-muted sm:flex"
      >
        <Lucide.Search className="h-4 w-4" />
        <span>Ara…</span>
        <kbd className="ml-auto rounded border bg-card px-1.5 text-[10px]">⌘K</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]"
          role="dialog"
          aria-label="Genel arama"
        >
          <button
            type="button"
            aria-label="Kapat"
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <div className="relative w-full max-w-xl overflow-hidden rounded-lg border bg-card shadow-2xl">
            <div className="flex items-center gap-2 border-b px-3">
              <Lucide.Search className="h-4 w-4 text-muted-foreground" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ürün, cari, belge no, irsaliye ara — ya da 'yeni teklif'…"
                className="h-12 w-full bg-transparent text-sm outline-none"
                data-testid="global-search-input"
              />
              {loading && <Lucide.Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <div className="max-h-[60vh] overflow-auto p-1" data-testid="global-search-results">
              {items.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {dq.trim().length < 2
                    ? 'Aramak için yazın (en az 2 harf) veya bir eylem seçin.'
                    : 'Sonuç yok.'}
                </p>
              ) : (
                items.map((it, i) => {
                  const showGroup = i === 0 || headerOf(items[i - 1]) !== headerOf(it);
                  return (
                    <div key={`${it.href}-${i}`}>
                      {showGroup && (
                        <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase text-muted-foreground">
                          {headerOf(it)}
                        </div>
                      )}
                      <button
                        type="button"
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(it)}
                        className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${i === active ? 'bg-primary/10' : 'hover:bg-muted'}`}
                      >
                        <Icon name={it.icon} />
                        <span className="min-w-0 flex-1 truncate">{it.label}</span>
                        {it.sub && (
                          <span className="shrink-0 truncate text-xs text-muted-foreground">
                            {it.sub}
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Icon({ name }: { name: string }) {
  const reg = Lucide as unknown as Record<string, React.ComponentType<{ className?: string }>>;
  const Cmp = reg[name] ?? Lucide.Circle;
  return <Cmp className="h-4 w-4 shrink-0 text-muted-foreground" />;
}
