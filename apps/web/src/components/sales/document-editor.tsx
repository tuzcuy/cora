'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { calculateDocument, formatMoney, formatQty, type LineInput } from '@cora/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/doc-status';
import { useAuth } from '@/components/auth-provider';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import { apiJson, ApiError } from '@/lib/problem';
import { findProductByCode, searchProducts, type ProductRow } from '@/lib/products';
import { ProductBrowser, type PickedProduct } from '@/components/sales/product-browser';
import { StatusStepper, type HistoryRow } from '@/components/sales/status-stepper';
import { EmailDialog } from '@/components/documents/email-dialog';
import { openPdf } from '@/lib/download';

/* ------------------------------------------------------------------ types */

type DocType = 'QUOTE' | 'ORDER';

interface PartnerLite {
  id: string;
  code: string;
  name: string;
  city: string | null;
  email?: string | null;
  currency?: string;
  paymentTermDays?: number;
  salesRep?: { id: string; name: string } | null;
  defaultDiscountRate?: string | null;
  addresses?: { id: string; type: string; title: string | null; line1: string; city: string | null; isDefault: boolean }[];
}

interface EditorLine {
  key: string;
  productId: string | null;
  code: string;
  name: string;
  description: string;
  qty: number;
  unitId: string | null;
  baseUnitId: string | null;
  packageUnitId: string | null;
  packageQty: number | null;
  unitFactor: number;
  /** TRY price per base unit from the product (null when unknown). */
  basePrice: number | null;
  /** TRY cost per base unit (only with cost.view). */
  baseCost: number | null;
  unitPrice: number;
  isPriceOverridden: boolean;
  discountRate: number;
  discountAmount: number;
  vatRate: number;
  available: number | null;
  unitCode: string | null;
}

interface ServerLine {
  id: string; lineNo: number; description: string; qty: string; unitId: string | null; unitFactor: string;
  unitPrice: string; discountRate: string; discountAmount: string; vatRate: string; isPriceOverridden: boolean;
  unitCostLocal?: string; reservedQty: string; packageUnitId: string | null; packageQty: string | null; baseUnitId: string | null;
  product: { id: string; code: string; name: string } | null;
}

interface ServerDoc {
  id: string; type: DocType; number: string; status: string; version: number; revision: number;
  date: string; validUntil: string | null; deliveryDate: string | null; currency: string; exchangeRate: string;
  reference: string | null; tags: string[]; notes: string | null; paymentTerms: string | null;
  shippingAddressId: string | null; billingAddressId: string | null; salesRepId?: string | null;
  partner: PartnerLite | null; salesRep: { id: string; name: string } | null;
  subtotal: string; discountTotal: string; vatTotal: string; grandTotal: string; grandTotalLocal: string;
  profitLocal?: string; marginPct?: string; costTotalLocal?: string;
  lines: ServerLine[]; statusHistory: HistoryRow[];
  flow: {
    source: { id: string; type: DocType; number: string; status: string } | null;
    derived: { id: string; type: DocType; number: string; status: string; revision: number }[];
    revisedFrom: { id: string; number: string; revision: number; status: string } | null;
    revisions: { id: string; number: string; revision: number; status: string }[];
  };
  warnings?: { code: string; message: string }[];
}

interface Transitions {
  status: string;
  transitions: { to: string; label: string; permission: string; allowed: boolean; routesTo?: string; reasons: string[]; requiresNote: boolean }[];
  guard: { ok: boolean; warnings: { code: string; message: string }[]; blockers: { code: string; message: string }[]; needsApproval: boolean };
}

const EDITABLE = new Set(['DRAFT', 'SENT', 'APPROVAL_PENDING']);
const VAT_RATES = [1, 10, 20];
const RECENT_KEY = 'cora.recentPartners';
const r2 = (n: number) => Math.round(n * 100) / 100;
let keySeq = 0;
const newKey = () => `l${Date.now().toString(36)}${(keySeq += 1)}`;

/* ------------------------------------------------------------- helpers */

function lineFromProduct(p: ProductRow, qty: number, discountRate = 0): EditorLine {
  const base = Number(p.salesPrice);
  return {
    key: newKey(),
    productId: p.id, code: p.code, name: p.name, description: p.name,
    qty, unitId: null, baseUnitId: null, packageUnitId: null, packageQty: null, unitFactor: 1,
    basePrice: base, baseCost: p.purchasePrice !== undefined ? Number(p.purchasePrice) : null,
    unitPrice: base, isPriceOverridden: false,
    discountRate, discountAmount: 0, vatRate: Number(p.vatRate),
    available: Number(p.stock.available), unitCode: p.unitCode,
  };
}

function lineFromServer(l: ServerLine): EditorLine {
  const factor = Number(l.unitFactor) || 1;
  const price = Number(l.unitPrice);
  return {
    key: l.id,
    productId: l.product?.id ?? null, code: l.product?.code ?? '', name: l.product?.name ?? l.description,
    description: l.description, qty: Number(l.qty),
    unitId: l.unitId, baseUnitId: l.baseUnitId, packageUnitId: l.packageUnitId,
    packageQty: l.packageQty ? Number(l.packageQty) : null, unitFactor: factor,
    basePrice: l.isPriceOverridden ? null : price / factor,
    baseCost: l.unitCostLocal !== undefined ? Number(l.unitCostLocal) / factor : null,
    unitPrice: price, isPriceOverridden: l.isPriceOverridden,
    discountRate: Number(l.discountRate), discountAmount: Number(l.discountAmount), vatRate: Number(l.vatRate),
    available: null, unitCode: null,
  };
}

function toPayload(l: EditorLine) {
  return {
    productId: l.productId,
    description: l.description || undefined,
    qty: l.qty,
    unitId: l.unitId ?? undefined,
    unitFactor: l.unitFactor,
    unitPrice: l.isPriceOverridden ? l.unitPrice : undefined,
    discountRate: l.discountRate || undefined,
    discountAmount: l.discountAmount || undefined,
    vatRate: l.vatRate,
  };
}

function readRecent(): PartnerLite[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}
function pushRecent(p: PartnerLite) {
  try {
    const list = [p, ...readRecent().filter((x) => x.id !== p.id)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.map(({ id, code, name, city }) => ({ id, code, name, city }))));
  } catch { /* storage may be unavailable */ }
}

/* ---------------------------------------------------------- component */

export function DocumentEditor({ type, id, basePath }: { type: DocType; id?: string; basePath: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const perms = user?.permissions ?? [];
  const canViewCost = perms.includes('cost.view');

  const [doc, setDoc] = useState<ServerDoc | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [loadError, setLoadError] = useState<string | null>(null);

  // header
  const [partner, setPartner] = useState<PartnerLite | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState(() => {
    // Default quote validity (SalesSettings.quoteValidityDays); the server keeps the final word.
    const d = new Date(); d.setDate(d.getDate() + 15);
    return type === 'QUOTE' ? d.toISOString().slice(0, 10) : '';
  });
  const [deliveryDate, setDeliveryDate] = useState('');
  const [currency, setCurrency] = useState('TRY');
  const [exchangeRate, setExchangeRate] = useState(1);
  const [reference, setReference] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [shippingAddressId, setShippingAddressId] = useState<string>('');
  const [billingAddressId, setBillingAddressId] = useState<string>('');
  const [defaultDiscount, setDefaultDiscount] = useState(0);

  // lines
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [cursor, setCursor] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<number | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tab, setTab] = useState<'lines' | 'flow'>('lines');
  const [transitionTo, setTransitionTo] = useState<{ to: string; label: string; requiresNote: boolean } | null>(null);
  const [transitionNote, setTransitionNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const guardClose = useUnsavedChanges(dirty);

  const status = doc?.status ?? 'DRAFT';
  const editable = !doc || EDITABLE.has(status) || perms.includes('order.edit_approved');
  const isDraft = !doc || status === 'DRAFT';
  const currencySymbolic = currency;

  /* ---------------------------------------------------- load document */

  const applyServer = useCallback((d: ServerDoc, opts: { keepLocal?: boolean } = {}) => {
    setDoc(d);
    // The user kept typing while the request was in flight: take the server's
    // identity (id, number, status, version) but leave their edits alone — the
    // next save sends them.
    if (opts.keepLocal) return;
    setPartner(d.partner);
    setDate(d.date.slice(0, 10));
    setValidUntil(d.validUntil ? d.validUntil.slice(0, 10) : '');
    setDeliveryDate(d.deliveryDate ? d.deliveryDate.slice(0, 10) : '');
    setCurrency(d.currency);
    setExchangeRate(Number(d.exchangeRate) || 1);
    setReference(d.reference ?? '');
    setTags(d.tags.join(', '));
    setNotes(d.notes ?? '');
    setPaymentTerms(d.paymentTerms ?? '');
    setShippingAddressId(d.shippingAddressId ?? '');
    setBillingAddressId(d.billingAddressId ?? '');
    setLines(d.lines.map(lineFromServer));
    setDirty(false);
    setConflict(null);
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    apiJson<ServerDoc>(`/api/v1/sales-documents/${encodeURIComponent(id)}`)
      .then((d) => { if (!cancelled) { applyServer(d); setLoadError(null); } })
      .catch((e) => { if (!cancelled) setLoadError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, applyServer]);

  // Partner defaults + addresses (fetched once we know the partner).
  const partnerDetail = useQuery({
    queryKey: ['partner', partner?.id],
    queryFn: () => apiJson<PartnerLite>(`/api/v1/partners/${partner!.id}`),
    enabled: !!partner?.id,
  });
  const addresses = partnerDetail.data?.addresses ?? [];

  const transitions = useQuery({
    queryKey: ['transitions', doc?.id, doc?.version],
    queryFn: () => apiJson<Transitions>(`/api/v1/sales-documents/${doc!.id}/available-transitions`),
    enabled: !!doc?.id,
  });

  /* ------------------------------------------------------ live totals */

  const calc = useMemo(() => {
    const inputs: LineInput[] = lines.map((l) => ({
      qty: l.qty,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      discountRate: l.discountRate || undefined,
      discountAmount: l.discountAmount || undefined,
      unitCostLocal: l.baseCost !== null ? l.baseCost * l.unitFactor : 0,
      exchangeRate,
    }));
    return calculateDocument({ lines: inputs, exchangeRate });
  }, [lines, exchangeRate]);

  const vatBreakdown = useMemo(() => {
    const m = new Map<number, number>();
    lines.forEach((l, i) => m.set(l.vatRate, (m.get(l.vatRate) ?? 0) + Number(calc.lines[i]?.lineVat ?? 0)));
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [lines, calc]);

  /* --------------------------------------------------------- mutate */

  const editSeq = useRef(0);
  const mark = () => { editSeq.current += 1; setDirty(true); };

  const updateLine = (key: string, patch: Partial<EditorLine>) => {
    setLines((ls) => ls.map((l) => {
      if (l.key !== key) return l;
      const next = { ...l, ...patch };
      // Re-derive an automatic price when the unit changes.
      if ('unitId' in patch && !next.isPriceOverridden) {
        next.unitFactor = next.unitId && next.unitId === next.packageUnitId && next.packageQty ? next.packageQty : 1;
        if (next.basePrice !== null) next.unitPrice = r2((next.basePrice * next.unitFactor) / exchangeRate);
      }
      return next;
    }));
    mark();
  };

  const addProducts = (picks: PickedProduct[]) => {
    setLines((ls) => [...ls, ...picks.map((p) => lineFromProduct(p.product, p.qty, defaultDiscount))]);
    mark();
    setTimeout(() => searchRef.current?.focus(), 20);
  };

  const removeLine = (key: string) => { setLines((ls) => ls.filter((l) => l.key !== key)); mark(); };
  const moveLine = (from: number, to: number) => {
    if (to < 0 || to >= lines.length) return;
    setLines((ls) => { const n = [...ls]; const [it] = n.splice(from, 1); n.splice(to, 0, it!); return n; });
    setCursor(to);
    mark();
  };

  const selectPartner = async (p: PartnerLite) => {
    setPartner(p);
    pushRecent(p);
    mark();
    try {
      const full = await apiJson<PartnerLite>(`/api/v1/partners/${p.id}`);
      if (full.currency) setCurrency(full.currency);
      if (full.paymentTermDays) setPaymentTerms(`${full.paymentTermDays} gün`);
      if (full.defaultDiscountRate) setDefaultDiscount(Number(full.defaultDiscountRate));
      const ship = full.addresses?.find((a) => a.type === 'SHIPPING' && a.isDefault) ?? full.addresses?.find((a) => a.type === 'SHIPPING');
      const bill = full.addresses?.find((a) => a.type === 'BILLING');
      setShippingAddressId(ship?.id ?? '');
      setBillingAddressId(bill?.id ?? '');
      qc.setQueryData(['partner', p.id], full);
    } catch { /* defaults are optional */ }
  };

  /* ------------------------------------------------------------ save */

  const buildPayload = () => ({
    partnerId: partner?.id,
    date: date ? new Date(date).toISOString() : undefined,
    validUntil: validUntil ? new Date(validUntil).toISOString() : null,
    deliveryDate: deliveryDate ? new Date(deliveryDate).toISOString() : null,
    currency,
    reference: reference || null,
    tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    notes: notes || null,
    paymentTerms: paymentTerms || null,
    shippingAddressId: shippingAddressId || null,
    billingAddressId: billingAddressId || null,
    lines: lines.map(toPayload),
  });

  const save = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!partner) { setFieldErrors({ partnerId: 'Müşteri seçin' }); return null; }
    if (saving) return null;
    const seq = editSeq.current;
    setSaving(true); setError(null); setFieldErrors({});
    try {
      let saved: ServerDoc;
      if (doc) {
        saved = await apiJson<ServerDoc>(`/api/v1/sales-documents/${doc.id}`, { method: 'PATCH', json: { ...buildPayload(), version: doc.version } });
      } else {
        saved = await apiJson<ServerDoc>('/api/v1/sales-documents', { method: 'POST', json: { type, ...buildPayload() } });
        // history only — a router navigation would remount this editor.
        window.history.replaceState(null, '', `${basePath}?id=${saved.id}`);
      }
      const stale = editSeq.current !== seq;
      applyServer(saved, { keepLocal: stale });
      if (stale) setDirty(true);
      setLastSaved(new Date());
      qc.invalidateQueries({ queryKey: ['documents'] });
      return saved;
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.isVersionConflict) setConflict(e.problem.currentVersion ?? null);
        else { setFieldErrors(e.fieldErrors); if (!opts.silent) setError(e.message); }
      } else if (!opts.silent) setError((e as Error).message);
      return null;
    } finally { setSaving(false); }
  }, [partner, saving, doc, lines, date, validUntil, deliveryDate, currency, reference, tags, notes, paymentTerms, shippingAddressId, billingAddressId, type, basePath]);

  // Autosave drafts: every 30 s while dirty, and 1.5 s after a line is added.
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    if (!dirty || !isDraft || !partner || lines.length === 0) return;
    const t = setInterval(() => void saveRef.current({ silent: true }), 30_000);
    return () => clearInterval(t);
  }, [dirty, isDraft, partner, lines.length]);
  const lineCount = lines.length;
  const prevCount = useRef(lineCount);
  useEffect(() => {
    if (lineCount > prevCount.current && isDraft && partner) {
      const t = setTimeout(() => void saveRef.current({ silent: true }), 1500);
      prevCount.current = lineCount;
      return () => clearTimeout(t);
    }
    prevCount.current = lineCount;
  }, [lineCount, isDraft, partner]);

  /* ------------------------------------------------------ transitions */

  const doTransition = async (to: string, note?: string) => {
    if (!doc) return;
    if (dirty) { const s = await save(); if (!s) return; }
    setError(null);
    try {
      const res = await apiJson<ServerDoc>(`/api/v1/sales-documents/${doc.id}/transition`, { method: 'POST', json: { toStatus: to, note: note || undefined } });
      applyServer(res);
      qc.invalidateQueries({ queryKey: ['documents'] });
      setTransitionTo(null); setTransitionNote('');
    } catch (e) {
      setError(e instanceof ApiError ? (e.fieldErrors._ ?? e.message) : (e as Error).message);
    }
  };

  const act = async (action: 'copy' | 'revise' | 'convert') => {
    if (!doc) return;
    try {
      const res = await apiJson<ServerDoc>(`/api/v1/sales-documents/${doc.id}/${action}`, { method: 'POST', json: {} });
      const path = res.type === 'ORDER' ? '/orders/' : '/quotes/';
      window.location.assign(`${path}?id=${res.id}`);
    } catch (e) { setError((e as Error).message); }
  };

  const remove = async () => {
    if (!doc) return;
    try {
      await apiJson(`/api/v1/sales-documents/${doc.id}?version=${doc.version}`, { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['documents'] });
      window.location.assign(basePath);
    } catch (e) { setError((e as Error).message); setConfirmDelete(false); }
  };

  /* -------------------------------------------------------- keyboard */

  const close = () => guardClose(() => window.location.assign(basePath));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (browserOpen || transitionTo || helpOpen) return; // dialogs own the keyboard
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); searchRef.current?.focus(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'Delete') { e.preventDefault(); const l = lines[cursor]; if (l && editable) removeLine(l.key); }
      else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); moveLine(cursor, cursor - 1); }
      else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); moveLine(cursor, cursor + 1); }
      else if (e.key === 'F2') { e.preventDefault(); if (editable) setBrowserOpen(true); }
      else if (e.key === 'Escape' && !typing) { e.preventDefault(); close(); }
      else if (e.key === '?' && !typing) { e.preventDefault(); setHelpOpen((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, lines, cursor, editable, browserOpen, transitionTo, helpOpen, dirty]);

  /* ---------------------------------------------------------- render */

  if (loading) return <div className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</div>;
  if (loadError) return <p className="py-16 text-center text-sm text-destructive">{loadError}</p>;

  const title = doc ? doc.number : type === 'QUOTE' ? 'Yeni teklif' : 'Yeni sipariş';
  const guard = transitions.data?.guard;
  const lowMargin = guard?.warnings.some((w) => w.code === 'LOW_MARGIN');
  const money = (v: unknown) => formatMoney(String(v), currencySymbolic);
  const moneyLocal = (v: unknown) => formatMoney(String(v));

  return (
    <div ref={rootRef} className="space-y-4" data-testid="document-editor" data-status={status}>
      {/* ------------------------------------------------------- header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" onClick={close} className="mb-1 -ml-2">← {type === 'QUOTE' ? 'Teklifler' : 'Siparişler'}</Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold">{title}</h1>
            {doc && <StatusBadge status={status} />}
            {doc && doc.revision > 1 && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Rev.{doc.revision}</span>}
            {dirty && <span className="text-xs text-amber-700 dark:text-amber-500" data-testid="dirty">● kaydedilmedi</span>}
            {!dirty && lastSaved && <span className="text-xs text-muted-foreground">kaydedildi {lastSaved.toLocaleTimeString('tr-TR')}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setHelpOpen(true)} aria-label="Klavye kısayolları" title="Klavye kısayolları (?)">?</Button>
          {doc && (
            <Button variant="outline" size="sm" onClick={() => void openPdf(`/api/v1/documents/sales/${doc.id}/pdf`).catch((e) => setError((e as Error).message))} data-testid="doc-pdf">
              PDF
            </Button>
          )}
          {doc && perms.includes('quote.send') && (
            <Button variant="outline" size="sm" onClick={() => setEmailOpen(true)} data-testid="doc-email">E-posta</Button>
          )}
          {doc && <Button variant="outline" size="sm" onClick={() => act('copy')}>Kopyala</Button>}
          {doc && type === 'ORDER' && ['SHIPPED', 'PARTIALLY_SHIPPED', 'COMPLETED'].includes(status) && perms.includes('order.write') && (
            <Button
              variant="outline"
              size="sm"
              data-testid="queue-einvoice"
              onClick={async () => {
                setError(null);
                try {
                  await apiJson('/api/v1/edocs/invoice', { method: 'POST', json: { documentId: doc.id, kind: 'E_INVOICE' } });
                  window.location.assign('/edocs/');
                } catch (e) {
                  setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
                }
              }}
            >
              e-Fatura
            </Button>
          )}
          {doc && type === 'QUOTE' && status !== 'APPROVED' && <Button variant="outline" size="sm" onClick={() => act('revise')}>Revize et</Button>}
          {doc && type === 'QUOTE' && ['DRAFT', 'SENT', 'APPROVED'].includes(status) && (
            <Button variant="outline" size="sm" onClick={() => act('convert')} data-testid="convert">Siparişe dönüştür</Button>
          )}
          {doc && status === 'DRAFT' && <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>Sil</Button>}
          {editable && (
            <Button onClick={() => void save()} disabled={saving} data-testid="save">
              {saving ? 'Kaydediliyor…' : 'Kaydet'} <span className="ml-2 text-xs opacity-60">Ctrl+S</span>
            </Button>
          )}
        </div>
      </div>

      {doc && <StatusStepper type={type} status={status} history={doc.statusHistory} />}

      {/* transitions */}
      {doc && transitions.data && transitions.data.transitions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="transitions">
          {transitions.data.transitions.map((t) => (
            <Button
              key={t.to}
              size="sm"
              variant={t.to === 'APPROVED' ? 'default' : t.to === 'CANCELLED' || t.to === 'REJECTED' ? 'ghost' : 'outline'}
              disabled={!t.allowed}
              title={t.reasons.join('\n') || undefined}
              className={t.to === 'CANCELLED' || t.to === 'REJECTED' ? 'text-destructive' : ''}
              onClick={() => (t.requiresNote || t.routesTo ? setTransitionTo({ to: t.to, label: t.label, requiresNote: t.requiresNote }) : void doTransition(t.to))}
              data-testid={`transition-${t.to}`}
            >
              {t.label}{t.routesTo ? ' (onaya)' : ''}
            </Button>
          ))}
        </div>
      )}

      {conflict !== null && (
        <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Kayıt başkası tarafından değiştirildi (sizde v{doc?.version}, güncel v{conflict}).</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => window.location.reload()}>Yenile</Button>
        </div>
      )}
      {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {guard && (guard.blockers.length > 0 || guard.warnings.length > 0) && (
        <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="guard-panel">
          {guard.blockers.map((b, i) => <p key={`b${i}`} className="text-destructive">⛔ {b.message}</p>)}
          {guard.warnings.map((w, i) => <p key={`w${i}`} className="text-amber-800 dark:text-amber-400">⚠ {w.message}</p>)}
        </div>
      )}

      {/* ---------------------------------------------------- body */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {/* header card */}
          <Card>
            <CardContent className="grid gap-3 p-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
              <div className="md:col-span-2">
                <PartnerPicker value={partner} onChange={(p) => void selectPartner(p)} disabled={!editable} error={fieldErrors.partnerId} />
              </div>
              <Field label="Tarih"><Input type="date" value={date} onChange={(e) => { setDate(e.target.value); mark(); }} disabled={!editable} /></Field>
              {type === 'QUOTE'
                ? <Field label="Geçerlilik"><Input type="date" value={validUntil} onChange={(e) => { setValidUntil(e.target.value); mark(); }} disabled={!editable} /></Field>
                : <Field label="Teslim tarihi"><Input type="date" value={deliveryDate} onChange={(e) => { setDeliveryDate(e.target.value); mark(); }} disabled={!editable} /></Field>}
              <Field label="Para birimi">
                <select value={currency} onChange={(e) => { setCurrency(e.target.value); mark(); }} disabled={!editable || !!doc} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm">
                  {['TRY', 'USD', 'EUR'].map((c) => <option key={c}>{c}</option>)}
                </select>
                {currency !== 'TRY' && <p className="mt-1 text-xs text-muted-foreground">Kur {exchangeRate.toFixed(4)} (belge tarihinde dondurulur)</p>}
              </Field>
              <Field label="Referans"><Input value={reference} onChange={(e) => { setReference(e.target.value); mark(); }} disabled={!editable} placeholder="Müşteri sipariş no…" /></Field>
              <Field label="Vade / ödeme"><Input value={paymentTerms} onChange={(e) => { setPaymentTerms(e.target.value); mark(); }} disabled={!editable} /></Field>
              <Field label="Etiketler"><Input value={tags} onChange={(e) => { setTags(e.target.value); mark(); }} disabled={!editable} placeholder="sezon, banket" /></Field>
              <Field label="Sevk adresi">
                <select value={shippingAddressId} onChange={(e) => { setShippingAddressId(e.target.value); mark(); }} disabled={!editable} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm">
                  <option value="">—</option>
                  {addresses.map((a) => <option key={a.id} value={a.id}>{a.title ?? a.type} · {a.line1}</option>)}
                </select>
              </Field>
              <Field label="Fatura adresi">
                <select value={billingAddressId} onChange={(e) => { setBillingAddressId(e.target.value); mark(); }} disabled={!editable} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm">
                  <option value="">Sevk adresiyle aynı</option>
                  {addresses.map((a) => <option key={a.id} value={a.id}>{a.title ?? a.type} · {a.line1}</option>)}
                </select>
              </Field>
              <Field label="Notlar" className="md:col-span-2 lg:col-span-4">
                <textarea value={notes} onChange={(e) => { setNotes(e.target.value); mark(); }} disabled={!editable} rows={2} className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm" />
              </Field>
            </CardContent>
          </Card>

          {/* tabs */}
          <div className="flex gap-2">
            <Button size="sm" variant={tab === 'lines' ? 'default' : 'outline'} onClick={() => setTab('lines')}>Satırlar ({lines.length})</Button>
            {doc && <Button size="sm" variant={tab === 'flow' ? 'default' : 'outline'} onClick={() => setTab('flow')} data-testid="tab-flow">Belge akışı</Button>}
          </div>

          {tab === 'flow' && doc ? (
            <FlowCard doc={doc} />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[70rem] text-sm" data-testid="lines-table">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                        <th className="px-2 py-2 w-8">#</th>
                        <th className="px-2 py-2 min-w-[18rem]">Ürün</th>
                        <th className="px-2 py-2 w-24 whitespace-nowrap text-right">Miktar</th>
                        <th className="px-2 py-2 w-24">Birim</th>
                        <th className="px-2 py-2 w-32 whitespace-nowrap text-right">Birim fiyat</th>
                        <th className="px-2 py-2 w-20 whitespace-nowrap text-right">İsk. %</th>
                        <th className="px-2 py-2 w-24 whitespace-nowrap text-right">İsk. tutar</th>
                        <th className="px-2 py-2 w-20">KDV</th>
                        <th className="px-2 py-2 w-28 whitespace-nowrap text-right">Toplam</th>
                        {canViewCost && <th className="px-2 py-2 w-24 text-right">Kâr</th>}
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => {
                        const c = calc.lines[i];
                        const baseQty = l.qty * l.unitFactor;
                        const short = l.available !== null && baseQty > l.available;
                        const cell = 'h-8 w-full rounded border border-input bg-card px-2 text-sm disabled:opacity-60';
                        return (
                          <tr key={l.key} data-row={i} aria-selected={i === cursor} onFocus={() => setCursor(i)} onClick={() => setCursor(i)} className={`border-b align-top last:border-0 ${i === cursor ? 'bg-muted/50' : ''}`}>
                            <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                            <td className="min-w-[18rem] px-2 py-1.5">
                              <div className="whitespace-nowrap font-mono text-xs text-muted-foreground">{l.code}</div>
                              <input value={l.description} disabled={!editable} onChange={(e) => updateLine(l.key, { description: e.target.value })} className={`${cell} mt-0.5`} aria-label={`Satır ${i + 1} açıklama`} />
                              {short && <p className="mt-1 whitespace-nowrap text-xs text-amber-700 dark:text-amber-500">⚠ satılabilir {formatQty(l.available!, 0)}, {formatQty(baseQty - l.available!, 0)} eksik</p>}
                              {!short && l.available !== null && <p className="mt-1 whitespace-nowrap text-[11px] text-muted-foreground">satılabilir {formatQty(l.available, 0)} {l.unitCode ?? ''}</p>}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5"><input type="number" min={0.001} step="any" value={l.qty} disabled={!editable} onChange={(e) => updateLine(l.key, { qty: Number(e.target.value) })} className={`${cell} text-right`} aria-label={`Satır ${i + 1} miktar`} data-testid={`qty-${i}`} /></td>
                            <td className="px-2 py-1.5">
                              {l.packageUnitId ? (
                                <select value={l.unitId ?? ''} disabled={!editable} onChange={(e) => updateLine(l.key, { unitId: e.target.value || null })} className={cell} aria-label={`Satır ${i + 1} birim`}>
                                  <option value="">ADET</option>
                                  <option value={l.packageUnitId}>KOLİ ×{l.packageQty}</option>
                                </select>
                              ) : <span className="text-xs text-muted-foreground">{l.unitCode ?? 'ADET'}</span>}
                            </td>
                            <td className="px-2 py-1.5">
                              <input type="number" min={0} step="any" value={l.unitPrice} disabled={!editable} onChange={(e) => updateLine(l.key, { unitPrice: Number(e.target.value), isPriceOverridden: true })} className={`${cell} text-right ${l.isPriceOverridden ? 'border-amber-500/60' : ''}`} aria-label={`Satır ${i + 1} birim fiyat`} data-testid={`price-${i}`} />
                              {l.isPriceOverridden && <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-500">elle</p>}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5"><input type="number" min={0} max={100} step="any" value={l.discountRate} disabled={!editable} onChange={(e) => updateLine(l.key, { discountRate: Number(e.target.value), discountAmount: 0 })} className={`${cell} text-right`} aria-label={`Satır ${i + 1} iskonto yüzdesi`} data-testid={`disc-${i}`} /></td>
                            <td className="px-2 py-1.5"><input type="number" min={0} step="any" value={l.discountAmount} disabled={!editable} onChange={(e) => updateLine(l.key, { discountAmount: Number(e.target.value), discountRate: 0 })} className={`${cell} text-right`} aria-label={`Satır ${i + 1} iskonto tutarı`} /></td>
                            <td className="px-2 py-1.5">
                              <select value={l.vatRate} disabled={!editable} onChange={(e) => updateLine(l.key, { vatRate: Number(e.target.value) })} className={cell} aria-label={`Satır ${i + 1} KDV`}>
                                {[...new Set([...VAT_RATES, l.vatRate])].sort((a, b) => a - b).map((v) => <option key={v} value={v}>%{v}</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums font-medium">{money(c?.lineTotal ?? 0)}</td>
                            {canViewCost && <td className="px-2 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{moneyLocal(c?.lineProfitLocal ?? 0)}<span className="block text-[11px] text-muted-foreground">%{Number(c?.marginPct ?? 0).toFixed(1)}</span></td>}
                            <td className="px-1 py-1.5">
                              {editable && <button type="button" onClick={() => removeLine(l.key)} className="rounded px-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`Satır ${i + 1} sil`} title="Ctrl+Delete">×</button>}
                            </td>
                          </tr>
                        );
                      })}
                      {lines.length === 0 && (
                        <tr><td colSpan={11} className="px-4 py-8 text-center text-sm text-muted-foreground">Henüz satır yok — aşağıdan ürün arayın, kod yapıştırın ya da F2 ile ürün seçin.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {editable && (
                  <div className="border-t p-3">
                    <InlineProductSearch ref={searchRef} onAdd={(picks) => addProducts(picks)} onBrowse={() => setBrowserOpen(true)} />
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ---------------------------------------------------- totals */}
        <aside className="xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Toplam</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-1.5 text-sm" data-testid="totals">
                <Row k="Ara toplam" v={money(calc.subtotal)} />
                <Row k="İskonto" v={money(calc.discountTotal)} />
                {vatBreakdown.map(([rate, amt]) => <Row key={rate} k={`KDV %${rate}`} v={money(amt)} />)}
                <Row k="Genel toplam" v={money(calc.grandTotal)} strong testId="grand-total" />
                {currency !== 'TRY' && <Row k="Genel toplam (TRY)" v={moneyLocal(calc.grandTotalLocal)} />}
                {canViewCost && (
                  <>
                    <div className="border-t pt-1.5" />
                    <Row k="Toplam kâr" v={moneyLocal(calc.profitLocal)} />
                    <Row k="Marj" v={`%${Number(calc.marginPct).toFixed(1)}`} className={lowMargin ? 'text-destructive' : ''} />
                    {lowMargin && <p className="text-xs text-destructive">Marj eşiğin altında — yönetici onayı gerekecek</p>}
                  </>
                )}
              </dl>
              {partner && (
                <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                  {partner.name}{partnerDetail.data?.salesRep ? ` · ${partnerDetail.data.salesRep.name}` : ''}
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* ---------------------------------------------------- dialogs */}
      <ProductBrowser open={browserOpen} onClose={() => setBrowserOpen(false)} onPick={addProducts} />

      {doc && (
        <EmailDialog
          open={emailOpen}
          onClose={() => setEmailOpen(false)}
          documentId={doc.id}
          documentNumber={doc.number}
          defaultTo={partnerDetail.data?.email ?? null}
          onSent={() => { qc.invalidateQueries({ queryKey: ['document', doc.id] }); window.location.reload(); }}
        />
      )}

      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} title="Klavye kısayolları" width="max-w-md">
        <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5 text-sm">
          {[
            ['Tab', 'Hücreler arası'], ['Ctrl+Enter', 'Yeni satır (ürün ara)'], ['Ctrl+Delete', 'Satırı sil'],
            ['Ctrl+S', 'Kaydet'], ['Esc', 'Kapat (kaydedilmemişse sorar)'], ['F2', 'Ürün seçici'],
            ['Alt+↑ / Alt+↓', 'Satır sırasını değiştir'], ['Enter (aramada)', 'Seçili ürünü ekle'], ['?', 'Bu pencere'],
          ].map(([k, v]) => <div key={k} className="contents"><dt><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd></dt><dd className="text-muted-foreground">{v}</dd></div>)}
        </dl>
      </Dialog>

      <Dialog
        open={transitionTo !== null}
        onClose={() => setTransitionTo(null)}
        title={transitionTo?.label ?? ''}
        width="max-w-md"
        footer={
          <>
            <Button variant="outline" onClick={() => setTransitionTo(null)}>Vazgeç</Button>
            <Button onClick={() => transitionTo && void doTransition(transitionTo.to, transitionNote)} disabled={!!transitionTo?.requiresNote && !transitionNote.trim()} data-testid="transition-confirm">Onayla</Button>
          </>
        }
      >
        <label className="text-sm">
          <span className="text-muted-foreground">{transitionTo?.requiresNote ? 'Sebep (zorunlu)' : 'Not (isteğe bağlı)'}</span>
          <textarea value={transitionNote} onChange={(e) => setTransitionNote(e.target.value)} rows={3} autoFocus className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm" />
        </label>
      </Dialog>

      <ConfirmDialog open={confirmDelete} title="Taslak silinsin mi?" danger confirmLabel="Sil" onCancel={() => setConfirmDelete(false)} onConfirm={() => void remove()} description={doc ? `${doc.number} silinecek.` : undefined} />
    </div>
  );
}

/* -------------------------------------------------------------- pieces */

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Row({ k, v, strong, className = '', testId }: { k: string; v: string; strong?: boolean; className?: string; testId?: string }) {
  return (
    <div className={`flex justify-between ${strong ? 'border-t pt-1.5 text-base font-semibold' : ''} ${className}`}>
      <dt className={strong ? '' : 'text-muted-foreground'}>{k}</dt>
      <dd className="tabular-nums" data-testid={testId}>{v}</dd>
    </div>
  );
}

function FlowCard({ doc }: { doc: ServerDoc }) {
  const link = (d: { id: string; type?: DocType; number: string; status: string; revision?: number }, kind: DocType) => (
    <a key={d.id} href={`${kind === 'ORDER' ? '/orders/' : '/quotes/'}?id=${d.id}`} className="flex items-center justify-between rounded-md border bg-card p-3 text-sm hover:border-primary">
      <span className="font-mono">{d.number}{d.revision && d.revision > 1 ? ` (Rev.${d.revision})` : ''}</span>
      <StatusBadge status={d.status} />
    </a>
  );
  return (
    <Card>
      <CardContent className="space-y-4 p-4" data-testid="flow">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Belge akışı (teklif → sipariş → irsaliye)</p>
          <div className="space-y-2">
            {doc.flow.source && link(doc.flow.source, doc.flow.source.type)}
            <div className="rounded-md border border-primary bg-primary/5 p-3 text-sm"><span className="font-mono">{doc.number}</span> <span className="text-muted-foreground">— bu belge</span></div>
            {doc.flow.derived.map((d) => link(d, d.type))}
            {!doc.flow.source && doc.flow.derived.length === 0 && <p className="text-sm text-muted-foreground">Bağlı belge yok.</p>}
          </div>
        </div>
        {(doc.flow.revisedFrom || doc.flow.revisions.length > 0) && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Revizyon zinciri</p>
            <div className="space-y-2">
              {doc.flow.revisedFrom && link(doc.flow.revisedFrom, 'QUOTE')}
              <div className="rounded-md border border-primary bg-primary/5 p-3 text-sm"><span className="font-mono">{doc.number}</span> <span className="text-muted-foreground">Rev.{doc.revision}</span></div>
              {doc.flow.revisions.map((r) => link(r, 'QUOTE'))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Customer picker: type-ahead + 5 recents. */
function PartnerPicker({ value, onChange, disabled, error }: { value: PartnerLite | null; onChange: (p: PartnerLite) => void; disabled?: boolean; error?: string }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const recent = useMemo(() => (typeof window !== 'undefined' ? readRecent() : []), [open]);
  const { data } = useQuery({
    queryKey: ['partner-search', q],
    queryFn: () => apiJson<{ items: PartnerLite[] }>(`/api/v1/partners?type=CUSTOMER&pageSize=8&q=${encodeURIComponent(q)}`),
    enabled: open && q.trim().length >= 2,
  });
  const options = q.trim().length >= 2 ? (data?.items ?? []) : recent;

  const pick = (p: PartnerLite) => { onChange(p); setOpen(false); setQ(''); };
  return (
    <div className="relative text-sm">
      <span className="mb-1 block text-xs text-muted-foreground">Müşteri</span>
      {value && !open ? (
        <div className="flex h-10 items-center justify-between rounded-md border border-input bg-card px-3">
          <span className="truncate"><span className="font-medium">{value.name}</span> <span className="text-muted-foreground">{value.code}{value.city ? ` · ${value.city}` : ''}</span></span>
          {!disabled && <button type="button" onClick={() => setOpen(true)} className="text-xs text-primary hover:underline">Değiştir</button>}
        </div>
      ) : (
        <Input
          value={q}
          autoFocus={!value}
          disabled={disabled}
          placeholder="Müşteri ara (ad, kod, şehir)…"
          aria-label="Müşteri ara"
          data-testid="partner-search"
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => { setQ(e.target.value); setCursor(0); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, options.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); const p = options[cursor]; if (p) pick(p); }
            else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
          }}
          aria-invalid={!!error}
        />
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      {open && options.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-card shadow-lg" role="listbox">
          {q.trim().length < 2 && <li className="px-3 py-1 text-[11px] uppercase text-muted-foreground">Son kullanılanlar</li>}
          {options.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === cursor} onMouseDown={() => pick(p)} onMouseEnter={() => setCursor(i)} className={`cursor-pointer px-3 py-2 ${i === cursor ? 'bg-muted' : ''}`}>
              <span className="font-medium">{p.name}</span> <span className="text-muted-foreground">{p.code}{p.city ? ` · ${p.city}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Inline product search row: type to search (Enter adds), paste codes to add directly, button/F2 for the browser. */
import { forwardRef } from 'react';
const InlineProductSearch = forwardRef<HTMLInputElement, { onAdd: (picks: PickedProduct[]) => void; onBrowse: () => void }>(function InlineProductSearch({ onAdd, onBrowse }, ref) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDq(q), 200); return () => clearTimeout(t); }, [q]);
  const { data } = useQuery({ queryKey: ['inline-products', dq], queryFn: () => searchProducts(dq, { pageSize: 8 }), enabled: dq.trim().length >= 2 });
  const items = q.trim().length >= 2 && dq === q ? (data?.items ?? []) : [];

  const addCodes = async (raw: string) => {
    const codes = raw.split(/[\n,;\t]+/).map((c) => c.trim()).filter(Boolean);
    if (codes.length === 0) return;
    setBusy(true);
    const picks: PickedProduct[] = [];
    for (const c of codes) {
      const [code, qtyStr] = c.split(/\s+x\s*|\*|\s{2,}/i);
      const p = await findProductByCode(code!);
      if (p) picks.push({ product: p, qty: Number(qtyStr) || 1 });
    }
    setBusy(false);
    if (picks.length) { onAdd(picks); setQ(''); }
  };

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <Input
        ref={ref}
        value={q}
        onChange={(e) => { setQ(e.target.value); setCursor(0); }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (/[\n,;\t]/.test(text) || (!text.includes(' ') && text.length >= 4)) { e.preventDefault(); void addCodes(text); }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            const p = items[cursor];
            if (p) { onAdd([{ product: p, qty: 1 }]); setQ(''); }
            else if (q.trim()) void addCodes(q);
          }
        }}
        placeholder="Ürün ara (kod/ad) veya kod yapıştır — Enter ekler, F2 ürün seçici"
        aria-label="Ürün ara"
        data-testid="line-search"
        className="flex-1"
      />
      <Button type="button" variant="outline" size="sm" onClick={onBrowse} data-testid="open-browser">Ürün Ekle <span className="ml-1 text-xs opacity-60">F2</span></Button>
      {busy && <span className="text-xs text-muted-foreground">ekleniyor…</span>}
      {items.length > 0 && (
        <ul className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-64 overflow-auto rounded-md border bg-card shadow-lg sm:right-auto sm:w-[36rem]" role="listbox" data-testid="line-search-results">
          {items.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === cursor} onMouseDown={() => { onAdd([{ product: p, qty: 1 }]); setQ(''); }} onMouseEnter={() => setCursor(i)} className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm ${i === cursor ? 'bg-muted' : ''}`}>
              <span><span className="font-mono text-xs text-muted-foreground">{p.code}</span> {p.name}</span>
              <span className="tabular-nums text-muted-foreground">{formatMoney(p.salesPrice, p.currency)} · {formatQty(p.stock.available, 0)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
