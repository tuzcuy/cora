'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { formatMoney, formatQty } from '@cora/shared';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { searchProducts, type ProductRow } from '@/lib/products';

export interface PickedProduct {
  product: ProductRow;
  qty: number;
}

/**
 * ProductBrowser — picker mode (P04 E2 way #2). Search, multi-select with a
 * quantity per row, "Ekle" adds everything at once. Fully keyboard-driven:
 * ↑↓ move, Space toggles, digits type into the qty of the focused row,
 * Enter adds the selection (or the focused row when nothing is selected),
 * Esc closes. Opened from the editor with F2.
 */
export function ProductBrowser({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (items: PickedProduct[]) => void;
}) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDq(q), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (open) {
      setQ('');
      setSelected(new Map());
      setCursor(0);
      setTimeout(() => searchRef.current?.focus(), 30);
    }
  }, [open]);

  const { data, isFetching } = useQuery({
    queryKey: ['product-browser', dq],
    queryFn: () => searchProducts(dq, { pageSize: 30 }),
    enabled: open,
    placeholderData: keepPreviousData,
  });
  const items = useMemo(() => data?.items ?? [], [data]);

  useEffect(() => {
    listRef.current?.querySelectorAll('tr')[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const toggle = (p: ProductRow, qty = 1) =>
    setSelected((s) => {
      const n = new Map(s);
      if (n.has(p.id)) n.delete(p.id);
      else n.set(p.id, qty);
      return n;
    });
  const setQty = (id: string, qty: number) =>
    setSelected((s) => {
      const n = new Map(s);
      n.set(id, Math.max(1, qty));
      return n;
    });

  const confirm = () => {
    const picks: PickedProduct[] = [];
    for (const p of items) if (selected.has(p.id)) picks.push({ product: p, qty: selected.get(p.id)! });
    if (picks.length === 0 && items[cursor]) picks.push({ product: items[cursor]!, qty: 1 });
    if (picks.length) onPick(picks);
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === ' ' && e.target === searchRef.current && q === '') { e.preventDefault(); toggle(items[cursor]!); }
    else if (e.key === ' ' && e.target !== searchRef.current) { e.preventDefault(); toggle(items[cursor]!); }
    else if (e.key === 'Enter') { e.preventDefault(); confirm(); }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Ürün ekle"
      description="↑↓ gez · Boşluk seç · miktar yaz · Enter ekle · Esc kapat"
      width="max-w-4xl"
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted-foreground">
            {selected.size > 0 ? `${selected.size} ürün seçili` : items.length ? `${items.length} sonuç` : ''}
          </span>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button onClick={confirm} disabled={items.length === 0} data-testid="browser-add">
            Ekle {selected.size > 0 ? `(${selected.size})` : ''}
          </Button>
        </>
      }
    >
      <div onKeyDown={onKey}>
        <Input
          ref={searchRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setCursor(0); }}
          placeholder="Kod, ad, marka, barkod…"
          aria-label="Ürün ara"
          data-testid="browser-search"
        />
        <div className="mt-3 max-h-[55vh] overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="w-8 px-2 py-2" />
                <th className="px-2 py-2">Kod</th>
                <th className="px-2 py-2">Ürün</th>
                <th className="px-2 py-2 text-right">Fiyat</th>
                <th className="px-2 py-2 text-right">Satılabilir</th>
                <th className="w-24 px-2 py-2 text-right">Miktar</th>
              </tr>
            </thead>
            <tbody ref={listRef}>
              {items.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">{isFetching ? 'Aranıyor…' : 'Sonuç yok'}</td></tr>
              )}
              {items.map((p, i) => {
                const on = selected.has(p.id);
                const avail = Number(p.stock.available);
                return (
                  <tr
                    key={p.id}
                    aria-selected={i === cursor}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => toggle(p)}
                    className={`cursor-pointer border-b last:border-0 ${i === cursor ? 'bg-muted' : ''} ${on ? 'font-medium' : ''}`}
                  >
                    <td className="px-2 py-1.5"><input type="checkbox" checked={on} readOnly className="h-4 w-4" /></td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{p.code}</td>
                    <td className="px-2 py-1.5">
                      {p.name}
                      <span className="block text-xs text-muted-foreground">{p.brandName ?? ''}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formatMoney(p.salesPrice, p.currency)}</td>
                    <td className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${avail <= 0 ? 'text-destructive' : ''}`}>
                      {formatQty(p.stock.available, 0)} {p.unitCode ?? ''}
                    </td>
                    <td className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="number"
                        min={1}
                        value={on ? selected.get(p.id) : ''}
                        placeholder="—"
                        aria-label={`${p.code} miktar`}
                        onChange={(e) => setQty(p.id, Number(e.target.value) || 1)}
                        onFocus={() => { if (!on) toggle(p); }}
                        className="h-8 w-20 rounded-md border border-input bg-card px-2 text-right text-sm"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Dialog>
  );
}
