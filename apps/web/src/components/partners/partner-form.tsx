'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '@cora/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/components/auth-provider';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import { apiJson, ApiError } from '@/lib/problem';

export interface PartnerCard {
  id: string; code: string; name: string; name2: string | null; type: string; version: number;
  group: { id: string; name: string } | null;
  salesRep: { id: string; fullName: string } | null;
  priceList: { id: string; name: string; currency: string } | null;
  taxOffice: string | null; taxNumber: string | null; phone: string | null; email: string | null;
  website: string | null; city: string | null; country: string; currency: string;
  paymentTermDays: number; paymentTerms: string | null;
  defaultDiscountRate: string | null; creditLimit: string | null;
  openingBalance: string | null; externalBalance: string | null;
  notes: string | null; tags: string[]; isActive: boolean;
  contacts: { id: string; name: string; title: string | null; phone: string | null; email: string | null; isPrimary: boolean }[];
  addresses: { id: string; type: string; title: string | null; line1: string; line2: string | null; district: string | null; city: string | null; postalCode: string | null; country: string; isDefault: boolean }[];
  risk: { creditLimit: number; balance: number; openOrders: number; exposure: number; available: number | null; overLimit: boolean; usagePct: number | null };
}

type Contact = PartnerCard['contacts'][number];
type Address = PartnerCard['addresses'][number];

const emptyContact = (): Contact => ({ id: `new-${Math.random().toString(36).slice(2)}`, name: '', title: '', phone: '', email: '', isPrimary: false });
const emptyAddress = (): Address => ({ id: `new-${Math.random().toString(36).slice(2)}`, type: 'SHIPPING', title: '', line1: '', line2: '', district: '', city: '', postalCode: '', country: 'TR', isDefault: false });

/** Cari kartı formu (P07): kimlik, ticari koşullar, kişiler, adresler, risk. */
export function PartnerForm({ id, onDone, onCancel }: { id?: string; onDone: (id: string) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canWrite = (user?.permissions ?? []).includes('partner.write');

  const [form, setForm] = useState<Partial<PartnerCard>>({ type: 'CUSTOMER', currency: 'TRY', country: 'TR', isActive: true, paymentTermDays: 0 });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const guardClose = useUnsavedChanges(dirty);

  const card = useQuery({ queryKey: ['partner-card', id], queryFn: () => apiJson<PartnerCard>(`/api/v1/partners/${id}/card`), enabled: !!id });
  const lists = useQuery({ queryKey: ['price-lists'], queryFn: () => apiJson<{ items: { id: string; name: string }[] }>('/api/v1/pricing/lists?activeOnly=true&pageSize=100') });
  const groups = useQuery({ queryKey: ['partner-groups'], queryFn: () => apiJson<{ items: { id: string; name: string }[] }>('/api/v1/partner-groups?pageSize=100') });

  useEffect(() => {
    const d = card.data;
    if (!d) return;
    setForm(d);
    setContacts(d.contacts.map((c) => ({ ...c })));
    setAddresses(d.addresses.map((a) => ({ ...a })));
    setDirty(false);
  }, [card.data]);

  const set = <K extends keyof PartnerCard>(k: K, v: PartnerCard[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };

  const save = async () => {
    setBusy(true); setError(null); setFieldErrors({});
    const payload = {
      code: form.code, name: form.name, name2: form.name2 || null, type: form.type,
      groupId: form.group?.id ?? null,
      taxOffice: form.taxOffice || null, taxNumber: form.taxNumber || null,
      phone: form.phone || null, email: form.email || '', website: form.website || null,
      city: form.city || null, country: form.country || 'TR', currency: form.currency,
      paymentTermDays: Number(form.paymentTermDays ?? 0), paymentTerms: form.paymentTerms || null,
      priceListId: form.priceList?.id ?? null,
      defaultDiscountRate: form.defaultDiscountRate ? Number(form.defaultDiscountRate) : null,
      creditLimit: form.creditLimit ? Number(form.creditLimit) : null,
      openingBalance: form.openingBalance ? Number(form.openingBalance) : null,
      notes: form.notes || null,
      isActive: form.isActive ?? true,
      contacts: contacts.filter((c) => c.name.trim()).map((c) => ({ name: c.name, title: c.title || null, phone: c.phone || null, email: c.email || '', isPrimary: c.isPrimary })),
      addresses: addresses.filter((a) => a.line1.trim()).map((a) => ({
        ...(a.id.startsWith('new-') ? {} : { id: a.id }),
        type: a.type, title: a.title || null, line1: a.line1, line2: a.line2 || null,
        district: a.district || null, city: a.city || null, postalCode: a.postalCode || null,
        country: a.country || 'TR', isDefault: a.isDefault,
      })),
    };
    try {
      const saved = id
        ? await apiJson<PartnerCard>(`/api/v1/partners/${id}`, { method: 'PATCH', json: { ...payload, version: card.data!.version } })
        : await apiJson<PartnerCard>('/api/v1/partners', { method: 'POST', json: payload });
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['partners'] });
      qc.invalidateQueries({ queryKey: ['partner-card', saved.id] });
      onDone(saved.id);
    } catch (e) {
      if (e instanceof ApiError) {
        setFieldErrors(e.fieldErrors);
        setError(e.isVersionConflict ? 'Kayıt başkası tarafından değiştirildi — sayfayı yenileyin.' : (Object.values(e.fieldErrors)[0] ?? e.message));
      } else setError((e as Error).message);
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (canWrite) void save(); }
      if (e.key === 'Escape' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) guardClose(onCancel);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (id && card.isLoading) return <p className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</p>;

  const field = (label: string, key: keyof PartnerCard, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block text-sm">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <Input
        value={(form[key] as string | number | undefined) ?? ''}
        disabled={!canWrite}
        aria-label={label}
        data-testid={`partner-${String(key)}`}
        aria-invalid={!!fieldErrors[String(key)]}
        onChange={(e) => set(key, (props.type === 'number' ? e.target.value : e.target.value) as never)}
        {...props}
      />
      {fieldErrors[String(key)] && <span className="mt-1 block text-xs text-destructive">{fieldErrors[String(key)]}</span>}
    </label>
  );

  return (
    <div className="space-y-4" data-testid="partner-form">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => guardClose(onCancel)}>← Cariler</Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{id ? (form.name ?? '') : 'Yeni cari'}</h1>
            {dirty && <span className="text-xs text-amber-700 dark:text-amber-500">● kaydedilmedi</span>}
          </div>
          {id && <p className="text-sm text-muted-foreground">{form.code}</p>}
        </div>
        <div className="flex items-center gap-2">
          {id && <a href={`/partners/?id=${id}&tab=statement`} className="inline-flex h-10 items-center rounded-md border border-input px-4 text-sm hover:bg-muted" data-testid="open-statement">Ekstre</a>}
          {canWrite && <Button onClick={() => void save()} disabled={busy} data-testid="partner-save">Kaydet <span className="ml-2 text-xs opacity-60">Ctrl+S</span></Button>}
        </div>
      </div>

      {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      {form.risk && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-6 p-4 text-sm" data-testid="partner-risk">
            <div><span className="block text-xs text-muted-foreground">Kredi limiti</span><span className="font-medium">{formatMoney(form.risk.creditLimit)}</span></div>
            <div><span className="block text-xs text-muted-foreground">Bakiye</span><span className="font-medium">{formatMoney(form.risk.balance)}</span></div>
            <div><span className="block text-xs text-muted-foreground">Açık siparişler</span><span className="font-medium">{formatMoney(form.risk.openOrders)}</span></div>
            <div><span className="block text-xs text-muted-foreground">Toplam risk</span><span className={`font-medium ${form.risk.overLimit ? 'text-destructive' : ''}`}>{formatMoney(form.risk.exposure)}</span></div>
            {form.risk.usagePct !== null && (
              <div className="min-w-[10rem] flex-1">
                <span className="block text-xs text-muted-foreground">Limit kullanımı %{form.risk.usagePct}</span>
                <div className="mt-1 h-2 w-full rounded-full bg-muted">
                  <div className={`h-2 rounded-full ${form.risk.overLimit ? 'bg-destructive' : form.risk.usagePct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                       style={{ width: `${Math.min(form.risk.usagePct, 100)}%` }} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="grid gap-3 p-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          {field('Cari kodu', 'code')}
          {field('Ünvan', 'name')}
          {field('Ünvan 2', 'name2')}
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Tip</span>
            <select value={form.type ?? 'CUSTOMER'} disabled={!canWrite} onChange={(e) => set('type', e.target.value)} aria-label="Tip" className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm">
              <option value="CUSTOMER">Müşteri</option><option value="SUPPLIER">Tedarikçi</option><option value="BOTH">Her ikisi</option>
            </select>
          </label>
          {field('Vergi dairesi', 'taxOffice')}
          {field('VKN / TCKN', 'taxNumber')}
          {field('Telefon', 'phone')}
          {field('E-posta', 'email', { type: 'email' })}
          {field('Şehir', 'city')}
          {field('Web', 'website')}
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Cari grubu</span>
            <select value={form.group?.id ?? ''} disabled={!canWrite} onChange={(e) => { const g = groups.data?.items.find((x) => x.id === e.target.value); set('group', g ? { id: g.id, name: g.name } : null); }}
                    aria-label="Cari grubu" className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm">
              <option value="">—</option>
              {(groups.data?.items ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Fiyat listesi</span>
            <select value={form.priceList?.id ?? ''} disabled={!canWrite} data-testid="partner-pricelist"
                    onChange={(e) => { const l = lists.data?.items.find((x) => x.id === e.target.value); set('priceList', l ? { id: l.id, name: l.name, currency: 'TRY' } : null); }}
                    aria-label="Fiyat listesi" className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm">
              <option value="">Varsayılan liste</option>
              {(lists.data?.items ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          {field('Vade (gün)', 'paymentTermDays', { type: 'number', min: 0 })}
          {field('Ödeme koşulu', 'paymentTerms')}
          {field('Varsayılan iskonto %', 'defaultDiscountRate', { type: 'number', step: 'any', min: 0, max: 100 })}
          {field('Kredi limiti', 'creditLimit', { type: 'number', step: 'any', min: 0 })}
          {field('Açılış bakiyesi', 'openingBalance', { type: 'number', step: 'any' })}
          <label className="flex items-end gap-2 text-sm">
            <input type="checkbox" checked={form.isActive ?? true} disabled={!canWrite} onChange={(e) => set('isActive', e.target.checked)} className="mb-3" /> Aktif
          </label>
          <label className="block text-sm md:col-span-2 lg:col-span-4">
            <span className="mb-1 block text-xs text-muted-foreground">Notlar</span>
            <textarea value={form.notes ?? ''} disabled={!canWrite} onChange={(e) => set('notes', e.target.value)} rows={2} aria-label="Notlar" className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm" />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-medium">Yetkili kişiler</h2>
            {canWrite && <Button size="sm" variant="outline" onClick={() => { setContacts((c) => [...c, emptyContact()]); setDirty(true); }} data-testid="add-contact">+ Kişi</Button>}
          </div>
          {contacts.length === 0 ? <p className="text-sm text-muted-foreground">Kişi eklenmedi.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm" data-testid="contacts-table">
                <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-2 py-2">Ad</th><th className="px-2 py-2">Ünvan</th><th className="px-2 py-2">Telefon</th>
                  <th className="px-2 py-2">E-posta</th><th className="w-20 px-2 py-2">Birincil</th><th className="w-8" />
                </tr></thead>
                <tbody>
                  {contacts.map((c, i) => (
                    <tr key={c.id} className="border-b last:border-0">
                      {(['name', 'title', 'phone', 'email'] as const).map((k) => (
                        <td key={k} className="px-2 py-1.5">
                          <input value={c[k] ?? ''} disabled={!canWrite} aria-label={`Kişi ${i + 1} ${k}`} data-testid={`contact-${k}-${i}`}
                                 onChange={(e) => { const v = e.target.value; setContacts((cs) => cs.map((x) => x.id === c.id ? { ...x, [k]: v } : x)); setDirty(true); }}
                                 className="h-8 w-full rounded border border-input bg-card px-2 text-sm" />
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={c.isPrimary} disabled={!canWrite} aria-label={`Kişi ${i + 1} birincil`}
                               onChange={(e) => { const v = e.target.checked; setContacts((cs) => cs.map((x) => ({ ...x, isPrimary: x.id === c.id ? v : v ? false : x.isPrimary }))); setDirty(true); }} />
                      </td>
                      <td className="px-1">
                        {canWrite && <button type="button" aria-label={`Kişi ${i + 1} sil`} onClick={() => { setContacts((cs) => cs.filter((x) => x.id !== c.id)); setDirty(true); }} className="rounded px-1.5 text-muted-foreground hover:text-destructive">×</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-medium">Adresler</h2>
            {canWrite && <Button size="sm" variant="outline" onClick={() => { setAddresses((a) => [...a, emptyAddress()]); setDirty(true); }} data-testid="add-address">+ Adres</Button>}
          </div>
          {addresses.length === 0 ? <p className="text-sm text-muted-foreground">Adres eklenmedi.</p> : (
            <div className="space-y-3">
              {addresses.map((a, i) => (
                <div key={a.id} className="grid gap-2 rounded-md border p-3 grid-cols-1 md:grid-cols-6">
                  <select value={a.type} disabled={!canWrite} aria-label={`Adres ${i + 1} tipi`}
                          onChange={(e) => { const v = e.target.value; setAddresses((as) => as.map((x) => x.id === a.id ? { ...x, type: v } : x)); setDirty(true); }}
                          className="h-9 rounded border border-input bg-card px-2 text-sm">
                    <option value="SHIPPING">Sevk</option><option value="BILLING">Fatura</option>
                  </select>
                  {(['title', 'line1', 'district', 'city'] as const).map((k) => (
                    <input key={k} value={a[k] ?? ''} disabled={!canWrite} placeholder={k === 'line1' ? 'Adres' : k === 'title' ? 'Başlık' : k === 'district' ? 'İlçe' : 'Şehir'}
                           aria-label={`Adres ${i + 1} ${k}`} data-testid={`address-${k}-${i}`}
                           onChange={(e) => { const v = e.target.value; setAddresses((as) => as.map((x) => x.id === a.id ? { ...x, [k]: v } : x)); setDirty(true); }}
                           className={`h-9 rounded border border-input bg-card px-2 text-sm ${k === 'line1' ? 'md:col-span-2' : ''}`} />
                  ))}
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <input type="checkbox" checked={a.isDefault} disabled={!canWrite} aria-label={`Adres ${i + 1} varsayılan`}
                             onChange={(e) => { const v = e.target.checked; setAddresses((as) => as.map((x) => x.id === a.id ? { ...x, isDefault: v } : x)); setDirty(true); }} /> Varsayılan
                    </label>
                    {canWrite && <button type="button" aria-label={`Adres ${i + 1} sil`} onClick={() => { setAddresses((as) => as.filter((x) => x.id !== a.id)); setDirty(true); }} className="ml-auto rounded px-1.5 text-muted-foreground hover:text-destructive">×</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
