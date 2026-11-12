'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { formatMoney } from '@cora/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';
import { trDate, trDateTime } from '@/components/doc-status';
import { apiJson, ApiError } from '@/lib/problem';

/* ─────────────────────────────── types ──────────────────────────────── */

interface UserRow {
  id: string; email: string; fullName: string; phone: string | null;
  isActive: boolean; repCode: string | null; lastLoginAt: string | null;
  roles: { id: string; name: string }[];
}
interface RoleRow { id: string; name: string; isSystem: boolean; userCount: number; permissions: string[] }
interface RolesResponse {
  groups: { key: string; label: string; permissions: { code: string; label: string }[] }[];
  items: RoleRow[];
}
interface Settings {
  allowNegativeStock: boolean; minMarginPct: number; defaultVatRate: number;
  quoteValidityDays: number; autoSendToWarehouse: boolean;
  vatRates: number[];
  numberPrefixes: Record<string, string>;
  company: { name: string; address: string; phone: string; email: string; web: string; taxOffice: string; taxNumber: string; logo: string };
  bank: { name: string; branch: string; iban: string; accountName: string };
}
interface RateRow { id: string; date: string; currency: string; rate: string; source: string }
interface AuditRow {
  id: string; entity: string; entityId: string; action: string;
  diff: Record<string, { from: unknown; to: unknown }> | null;
  ip: string | null; at: string; userName: string | null; userEmail: string | null;
}

const TABS = [
  { key: 'users', label: 'Kullanıcılar' },
  { key: 'roles', label: 'Roller ve yetkiler' },
  { key: 'company', label: 'Firma ve belge' },
  { key: 'rates', label: 'Döviz kurları' },
  { key: 'audit', label: 'İşlem günlüğü' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/** Yönetim ekranı (P08): kullanıcı, rol matrisi, firma ayarları, kur, audit. */
export function AdminScreen() {
  const params = useSearchParams();
  const initial = (params.get('tab') as TabKey) ?? 'users';
  const [tab, setTab] = useState<TabKey>(TABS.some((t) => t.key === initial) ? initial : 'users');

  return (
    <div className="space-y-6" data-testid="admin-screen" data-tab={tab}>
      <div>
        <a href="/settings/" className="text-sm text-primary hover:underline">← Ayarlar</a>
        <h1 className="text-2xl font-semibold">Yönetim</h1>
        <p className="text-sm text-muted-foreground">Kullanıcılar, yetkiler, firma bilgileri, kurlar ve işlem günlüğü.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button key={t.key} size="sm" variant={tab === t.key ? 'default' : 'outline'} onClick={() => setTab(t.key)} data-testid={`admin-tab-${t.key}`}>
            {t.label}
          </Button>
        ))}
      </div>

      {tab === 'users' && <UsersTab />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'company' && <CompanyTab />}
      {tab === 'rates' && <RatesTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}

/* ─────────────────────────────── users ──────────────────────────────── */

function UsersTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState({ email: '', fullName: '', phone: '', repCode: '', roleIds: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState<UserRow | null>(null);

  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => apiJson<{ items: UserRow[] }>('/api/v1/admin/users?includeInactive=true') });
  const roles = useQuery({ queryKey: ['admin-roles'], queryFn: () => apiJson<RolesResponse>('/api/v1/admin/roles') });

  const openNew = () => { setEditing(null); setForm({ email: '', fullName: '', phone: '', repCode: '', roleIds: [] }); setError(null); setOpen(true); };
  const openEdit = (u: UserRow) => {
    setEditing(u);
    setForm({ email: u.email, fullName: u.fullName, phone: u.phone ?? '', repCode: u.repCode ?? '', roleIds: u.roles.map((r) => r.id) });
    setError(null); setOpen(true);
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const payload = { email: form.email, fullName: form.fullName, phone: form.phone || null, repCode: form.repCode || null, roleIds: form.roleIds };
      if (editing) {
        await apiJson(`/api/v1/admin/users/${editing.id}`, { method: 'PATCH', json: payload });
        setNotice(`${form.fullName} güncellendi.`);
      } else {
        const res = await apiJson<{ generatedPassword: string | null }>('/api/v1/admin/users', { method: 'POST', json: payload });
        setNotice(res.generatedPassword ? `Kullanıcı oluşturuldu. Geçici şifre: ${res.generatedPassword} (bir daha gösterilmez)` : 'Kullanıcı oluşturuldu.');
      }
      await qc.invalidateQueries({ queryKey: ['admin-users'] });
      setOpen(false);
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  const reset = async (u: UserRow) => {
    setBusy(true);
    try {
      const res = await apiJson<{ password: string | null }>(`/api/v1/admin/users/${u.id}/reset-password`, { method: 'POST', json: {} });
      setNotice(`${u.fullName} için yeni şifre: ${res.password} (bir daha gösterilmez)`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const deactivate = async (u: UserRow) => {
    setBusy(true);
    try {
      await apiJson(`/api/v1/admin/users/${u.id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['admin-users'] });
      setNotice(`${u.fullName} pasifleştirildi.`);
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); setConfirmOff(null); }
  };

  const rows = users.data?.items ?? [];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{rows.length} kullanıcı</p>
        <Button onClick={openNew} data-testid="new-user">+ Yeni kullanıcı</Button>
      </div>
      {notice && <div role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm" data-testid="user-notice">{notice}</div>}
      {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm" data-testid="users-table">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-3">Ad soyad</th><th className="px-4 py-3">E-posta</th>
                  <th className="px-4 py-3">Roller</th><th className="px-4 py-3">Son giriş</th>
                  <th className="px-4 py-3">Durum</th><th className="px-4 py-3 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className={`border-b last:border-0 ${u.isActive ? '' : 'opacity-60'}`}>
                    <td className="px-4 py-2 font-medium">{u.fullName}{u.repCode ? <span className="ml-2 text-xs text-muted-foreground">{u.repCode}</span> : null}</td>
                    <td className="px-4 py-2 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-2">{u.roles.map((r) => r.name).join(', ') || <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{u.lastLoginAt ? trDate(u.lastLoginAt) : '—'}</td>
                    <td className="px-4 py-2">{u.isActive ? 'Aktif' : <span className="text-muted-foreground">Pasif</span>}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <button type="button" className="rounded px-2 py-1 text-xs text-primary hover:bg-muted" onClick={() => openEdit(u)} data-testid={`edit-user-${u.email}`}>Düzenle</button>
                      <button type="button" className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted" onClick={() => void reset(u)} disabled={busy}>Şifre sıfırla</button>
                      {u.isActive && <button type="button" className="rounded px-2 py-1 text-xs text-destructive hover:bg-muted" onClick={() => setConfirmOff(u)}>Pasifleştir</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? 'Kullanıcıyı düzenle' : 'Yeni kullanıcı'} width="max-w-lg"
        description={editing ? undefined : 'Şifre otomatik üretilir ve kaydettikten sonra bir kez gösterilir.'}
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Vazgeç</Button><Button onClick={() => void save()} disabled={busy || !form.email || form.fullName.length < 3} data-testid="save-user">Kaydet</Button></>}>
        <div className="space-y-3 text-sm">
          {([['fullName', 'Ad soyad'], ['email', 'E-posta'], ['phone', 'Telefon'], ['repCode', 'Temsilci kodu']] as const).map(([k, label]) => (
            <label key={k} className="block">
              <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
              <Input value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} aria-label={label} data-testid={`user-${k}`} />
            </label>
          ))}
          <fieldset>
            <legend className="mb-1 text-xs text-muted-foreground">Roller</legend>
            <div className="flex flex-wrap gap-3">
              {(roles.data?.items ?? []).map((r) => (
                <label key={r.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={form.roleIds.includes(r.id)} data-testid={`role-${r.name}`}
                         onChange={(e) => setForm((f) => ({ ...f, roleIds: e.target.checked ? [...f.roleIds, r.id] : f.roleIds.filter((x) => x !== r.id) }))} />
                  {r.name}
                </label>
              ))}
            </div>
          </fieldset>
          {error && <p className="text-destructive">{error}</p>}
        </div>
      </Dialog>

      <ConfirmDialog open={!!confirmOff} title="Kullanıcı pasifleştirilsin mi?" danger confirmLabel="Pasifleştir"
        description={confirmOff ? `${confirmOff.fullName} artık giriş yapamayacak. Belgeleri kullanıcıya bağlı kalır.` : undefined}
        onCancel={() => setConfirmOff(null)} onConfirm={() => confirmOff && void deactivate(confirmOff)} />
    </div>
  );
}

/* ────────────────────────── roles & permissions ─────────────────────── */

function RolesTab() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const { data } = useQuery({ queryKey: ['admin-roles'], queryFn: () => apiJson<RolesResponse>('/api/v1/admin/roles') });

  useEffect(() => {
    if (!data) return;
    const role = data.items.find((r) => r.id === selected) ?? data.items[0];
    if (role) { setSelected(role.id); setDraft(new Set(role.permissions)); }
  }, [data, selected]);

  const role = data?.items.find((r) => r.id === selected);
  const toggle = (code: string) => setDraft((d) => { const n = new Set(d); if (n.has(code)) n.delete(code); else n.add(code); return n; });

  const save = async () => {
    if (!role) return;
    setBusy(true); setError(null);
    try {
      await apiJson(`/api/v1/admin/roles/${role.id}/permissions`, { method: 'POST', json: { permissions: [...draft] } });
      await qc.invalidateQueries({ queryKey: ['admin-roles'] });
      setFlash(`${role.name} rolünün yetkileri güncellendi.`);
      setTimeout(() => setFlash(null), 5000);
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="roles-tab">
      {flash && <div role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">{flash}</div>}
      {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <div className="flex flex-wrap gap-2">
        {(data?.items ?? []).map((r) => (
          <Button key={r.id} size="sm" variant={selected === r.id ? 'default' : 'outline'} onClick={() => { setSelected(r.id); setDraft(new Set(r.permissions)); }} data-testid={`role-tab-${r.name}`}>
            {r.name} <span className="ml-1 opacity-70">({r.userCount})</span>
          </Button>
        ))}
      </div>

      {role && (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{draft.size} yetki seçili · {role.userCount} kullanıcı bu rolde</p>
              <Button onClick={() => void save()} disabled={busy} data-testid="save-role">Yetkileri kaydet</Button>
            </div>
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {(data?.groups ?? []).map((g) => (
                <div key={g.key} className="rounded-md border p-3">
                  <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{g.label}</p>
                  <ul className="space-y-1.5 text-sm">
                    {g.permissions.map((p) => (
                      <li key={p.code}>
                        <label className="flex items-start gap-2">
                          <input type="checkbox" className="mt-0.5" checked={draft.has(p.code)} onChange={() => toggle(p.code)} data-testid={`perm-${p.code}`} />
                          <span>{p.label}<span className="ml-1 font-mono text-[11px] text-muted-foreground">{p.code}</span></span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─────────────────────────── company settings ───────────────────────── */

function CompanyTab() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data } = useQuery({ queryKey: ['admin-settings'], queryFn: () => apiJson<Settings>('/api/v1/admin/settings') });
  useEffect(() => { if (data) setForm(data); }, [data]);

  if (!form) return <p className="py-10 text-center text-sm text-muted-foreground">Yükleniyor…</p>;

  const setCompany = (k: keyof Settings['company'], v: string) => setForm((f) => f && ({ ...f, company: { ...f.company, [k]: v } }));
  const setBank = (k: keyof Settings['bank'], v: string) => setForm((f) => f && ({ ...f, bank: { ...f.bank, [k]: v } }));

  const pickLogo = (file: File) => {
    if (file.size > 300_000) { setError('Logo 300 KB’ı aşamaz.'); return; }
    const reader = new FileReader();
    reader.onload = () => setCompany('logo', String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await apiJson('/api/v1/admin/settings', {
        method: 'PATCH',
        json: {
          company: form.company, bank: form.bank,
          minMarginPct: Number(form.minMarginPct), defaultVatRate: Number(form.defaultVatRate),
          quoteValidityDays: Number(form.quoteValidityDays),
          allowNegativeStock: form.allowNegativeStock, autoSendToWarehouse: form.autoSendToWarehouse,
          vatRates: form.vatRates, numberPrefixes: form.numberPrefixes,
        },
      });
      await qc.invalidateQueries({ queryKey: ['admin-settings'] });
      setFlash('Ayarlar kaydedildi. PDF ve belge numaraları bu bilgileri kullanır.');
      setTimeout(() => setFlash(null), 6000);
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="company-tab">
      {flash && <div role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">{flash}</div>}
      {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <Card>
        <CardContent className="grid gap-3 p-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          <p className="md:col-span-2 lg:col-span-3 text-xs font-semibold uppercase text-muted-foreground">Firma bilgileri (PDF başlığında görünür)</p>
          {([['name', 'Ünvan'], ['address', 'Adres'], ['phone', 'Telefon'], ['email', 'E-posta'], ['web', 'Web'], ['taxOffice', 'Vergi dairesi'], ['taxNumber', 'VKN']] as const).map(([k, label]) => (
            <label key={k} className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
              <Input value={form.company[k] ?? ''} onChange={(e) => setCompany(k, e.target.value)} aria-label={label} data-testid={`company-${k}`} />
            </label>
          ))}
          <div className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Logo (PDF)</span>
            <div className="flex items-center gap-3">
              {form.company.logo ? <img src={form.company.logo} alt="Logo" className="h-12 rounded border bg-white object-contain p-1" /> : <span className="text-xs text-muted-foreground">Yok</span>}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg" aria-label="Logo yükle" data-testid="company-logo"
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) pickLogo(f); }}
                     className="text-sm file:mr-2 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm" />
              {form.company.logo && <Button size="sm" variant="ghost" onClick={() => setCompany('logo', '')}>Kaldır</Button>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 p-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          <p className="md:col-span-2 lg:col-span-4 text-xs font-semibold uppercase text-muted-foreground">Banka (teklif altında görünür)</p>
          {([['name', 'Banka'], ['branch', 'Şube'], ['iban', 'IBAN'], ['accountName', 'Hesap adı']] as const).map(([k, label]) => (
            <label key={k} className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
              <Input value={form.bank[k] ?? ''} onChange={(e) => setBank(k, e.target.value)} aria-label={label} data-testid={`bank-${k}`} />
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 p-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          <p className="md:col-span-2 lg:col-span-4 text-xs font-semibold uppercase text-muted-foreground">İş kuralları</p>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Minimum marj %</span>
            <Input type="number" step="any" value={form.minMarginPct} onChange={(e) => setForm({ ...form, minMarginPct: Number(e.target.value) })} aria-label="Minimum marj" data-testid="setting-minMargin" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Varsayılan KDV %</span>
            <Input type="number" step="any" value={form.defaultVatRate} onChange={(e) => setForm({ ...form, defaultVatRate: Number(e.target.value) })} aria-label="Varsayılan KDV" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Teklif geçerlilik (gün)</span>
            <Input type="number" value={form.quoteValidityDays} onChange={(e) => setForm({ ...form, quoteValidityDays: Number(e.target.value) })} aria-label="Teklif geçerliliği" data-testid="setting-validity" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">KDV oranları (virgülle)</span>
            <Input value={form.vatRates.join(', ')} onChange={(e) => setForm({ ...form, vatRates: e.target.value.split(',').map((v) => Number(v.trim())).filter((v) => !Number.isNaN(v)) })} aria-label="KDV oranları" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.allowNegativeStock} onChange={(e) => setForm({ ...form, allowNegativeStock: e.target.checked })} /> Negatif stoğa izin ver
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.autoSendToWarehouse} onChange={(e) => setForm({ ...form, autoSendToWarehouse: e.target.checked })} /> Onaylanan sipariş otomatik depoya gitsin
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 p-4 grid-cols-1 md:grid-cols-3 lg:grid-cols-6">
          <p className="md:col-span-3 lg:col-span-6 text-xs font-semibold uppercase text-muted-foreground">Belge numara önekleri</p>
          {Object.entries(form.numberPrefixes).map(([k, v]) => (
            <label key={k} className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">{k}</span>
              <Input value={v} maxLength={6} onChange={(e) => setForm({ ...form, numberPrefixes: { ...form.numberPrefixes, [k]: e.target.value.toUpperCase() } })} aria-label={`${k} öneki`} />
            </label>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={busy} data-testid="save-settings">Ayarları kaydet</Button>
      </div>
    </div>
  );
}

/* ─────────────────────────── exchange rates ─────────────────────────── */

function RatesTab() {
  const qc = useQueryClient();
  const [currency, setCurrency] = useState<'USD' | 'EUR'>('USD');
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const { data } = useQuery({ queryKey: ['admin-rates'], queryFn: () => apiJson<{ items: RateRow[]; latest: Record<string, string> }>('/api/v1/admin/rates?days=60') });

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await apiJson('/api/v1/admin/rates', { method: 'POST', json: { currency, rate: Number(rate) } });
      await qc.invalidateQueries({ queryKey: ['admin-rates'] });
      setRate('');
      setFlash('Kur kaydedildi.');
      setTimeout(() => setFlash(null), 4000);
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  const fetchTcmb = async () => {
    setBusy(true); setError(null);
    try {
      const res = await apiJson<{ saved: { currency: string; rate: string }[] }>('/api/v1/admin/rates/fetch-tcmb', { method: 'POST', json: {} });
      await qc.invalidateQueries({ queryKey: ['admin-rates'] });
      setFlash(`TCMB kurları alındı: ${res.saved.map((s) => `${s.currency} ${s.rate}`).join(', ')}`);
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="rates-tab">
      {flash && <div role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm" data-testid="rate-flash">{flash}</div>}
      {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        {['USD', 'EUR'].map((c) => (
          <Card key={c}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{c} / TRY (son)</p>
              <p className="text-xl font-semibold tabular-nums">{data?.latest?.[c] ? formatMoney(data.latest[c]!) : '—'}</p>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="flex items-center p-4">
            <Button onClick={() => void fetchTcmb()} disabled={busy} data-testid="fetch-tcmb">TCMB’den çek</Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Para birimi</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value as 'USD' | 'EUR')} aria-label="Para birimi" className="h-10 rounded-md border border-input bg-card px-3 text-sm">
              <option value="USD">USD</option><option value="EUR">EUR</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Kur</span>
            <Input type="number" step="any" min={0} value={rate} onChange={(e) => setRate(e.target.value)} className="w-40" aria-label="Kur" data-testid="rate-input" />
          </label>
          <Button onClick={() => void save()} disabled={busy || !rate} data-testid="save-rate">Elle kaydet</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm" data-testid="rates-table">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3">Tarih</th><th className="px-4 py-3">Para birimi</th>
                <th className="px-4 py-3 text-right">Kur</th><th className="px-4 py-3">Kaynak</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-4 py-2">{trDate(r.date)}</td>
                  <td className="px-4 py-2">{r.currency}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{Number(r.rate).toLocaleString('tr-TR', { minimumFractionDigits: 4 })}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.source}</td>
                </tr>
              ))}
              {(data?.items.length ?? 0) === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">Kur kaydı yok — TCMB’den çekin ya da elle girin.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────────────────────── audit log ────────────────────────────── */

function AuditTab() {
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [openRow, setOpenRow] = useState<AuditRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit', entity, action, page],
    queryFn: () => apiJson<{ items: AuditRow[]; total: number; facets: { entities: { entity: string; count: number }[] } }>(
      `/api/v1/admin/audit?${new URLSearchParams({ entity, action, page: String(page), pageSize: '50' })}`),
    placeholderData: keepPreviousData,
  });

  const rows = data?.items ?? [];
  const lastPage = Math.max(1, Math.ceil((data?.total ?? 0) / 50));

  return (
    <div className="space-y-4" data-testid="audit-tab">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Kayıt tipi</span>
          <select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} aria-label="Kayıt tipi" data-testid="audit-entity"
                  className="h-10 rounded-md border border-input bg-card px-3 text-sm">
            <option value="">Tümü</option>
            {(data?.facets.entities ?? []).map((e) => <option key={e.entity} value={e.entity}>{e.entity} ({e.count})</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">İşlem</span>
          <Input value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="create / update / status:" className="w-48" aria-label="İşlem" />
        </label>
        <p className="ml-auto text-sm text-muted-foreground">{isLoading ? 'Yükleniyor…' : `${(data?.total ?? 0).toLocaleString('tr-TR')} kayıt`}</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[44rem] text-sm" data-testid="audit-table">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-3">Zaman</th><th className="px-4 py-3">Kullanıcı</th>
                  <th className="px-4 py-3">Kayıt</th><th className="px-4 py-3">İşlem</th>
                  <th className="px-4 py-3">Değişiklik</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} onClick={() => setOpenRow(a)} className="cursor-pointer border-b last:border-0 hover:bg-muted">
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{trDateTime(a.at)}</td>
                    <td className="px-4 py-2">{a.userName ?? 'Sistem'}</td>
                    <td className="px-4 py-2"><span className="font-medium">{a.entity}</span> <span className="font-mono text-xs text-muted-foreground">{a.entityId.slice(0, 8)}</span></td>
                    <td className="px-4 py-2">{a.action}</td>
                    <td className="max-w-[24rem] truncate px-4 py-2 text-muted-foreground">
                      {a.diff ? Object.keys(a.diff).join(', ') : '—'}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && !isLoading && <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">Kayıt yok.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {(data?.total ?? 0) > 50 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Önceki</Button>
          <span className="text-sm text-muted-foreground">{page} / {lastPage}</span>
          <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>Sonraki →</Button>
        </div>
      )}

      <Dialog open={!!openRow} onClose={() => setOpenRow(null)} title={openRow ? `${openRow.entity} · ${openRow.action}` : ''} width="max-w-2xl"
        description={openRow ? `${openRow.userName ?? 'Sistem'} · ${trDateTime(openRow.at)}${openRow.ip ? ` · ${openRow.ip}` : ''}` : undefined}>
        {openRow?.diff ? (
          <table className="w-full text-sm" data-testid="audit-diff">
            <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="px-2 py-2">Alan</th><th className="px-2 py-2">Önce</th><th className="px-2 py-2">Sonra</th>
            </tr></thead>
            <tbody>
              {Object.entries(openRow.diff).map(([k, v]) => (
                <tr key={k} className="border-b last:border-0 align-top">
                  <td className="px-2 py-1.5 font-medium">{k}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{JSON.stringify(v?.from ?? null)}</td>
                  <td className="px-2 py-1.5">{JSON.stringify(v?.to ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm text-muted-foreground">Bu kayıtta alan değişikliği yok.</p>}
      </Dialog>
    </div>
  );
}
