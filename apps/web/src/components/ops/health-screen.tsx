'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { trDateTime } from '@/components/doc-status';
import { apiJson, ApiError } from '@/lib/problem';

interface ExplainItem { name: string; ms: number; planMs: number; plan: string; seqScan: boolean; rows: number }
interface DbStats {
  tables: { table_name: string; row_estimate: number; total_size: string }[];
  unusedIndexes: { table_name: string; index_name: string; scans: number }[];
}
interface Retention { auditLogDays: number; emailLogDays: number; documentDays: number; deletedPartnerDays: number }
interface RetentionRun { applied: boolean; policy: Retention; plan: { what: string; count: number }[]; deleted?: number }
interface BackupReport {
  counts: { documents: number; movements: number; partners: number; products: number };
  lastWrite: { document: { number: string; at: string } | null; movement: string | null };
  drill: string[];
  note: string;
}

const TABS = [
  { key: 'perf', label: 'Performans' },
  { key: 'kvkk', label: 'KVKK' },
  { key: 'backup', label: 'Yedek tatbikatı' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/** Sistem sağlığı (P10): sorgu planları, saklama süreleri, yedek tatbikatı. */
export function HealthScreen() {
  const [tab, setTab] = useState<TabKey>('perf');

  return (
    <div className="space-y-6" data-testid="health-screen" data-tab={tab}>
      <div>
        <a href="/settings/" className="text-sm text-primary hover:underline">← Ayarlar</a>
        <h1 className="text-2xl font-semibold">Sistem sağlığı</h1>
        <p className="text-sm text-muted-foreground">Sorgu planları, veri saklama (KVKK) ve yedekten geri yükleme tatbikatı.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button key={t.key} size="sm" variant={tab === t.key ? 'default' : 'outline'} onClick={() => setTab(t.key)} data-testid={`health-tab-${t.key}`}>
            {t.label}
          </Button>
        ))}
      </div>

      {tab === 'perf' && <PerfTab />}
      {tab === 'kvkk' && <KvkkTab />}
      {tab === 'backup' && <BackupTab />}
    </div>
  );
}

function PerfTab() {
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  const explain = useQuery({ queryKey: ['ops-explain'], queryFn: () => apiJson<{ items: ExplainItem[]; totalMs: number }>('/api/v1/ops/explain') });
  const stats = useQuery({ queryKey: ['ops-db'], queryFn: () => apiJson<DbStats>('/api/v1/ops/db-stats') });

  const items = explain.data?.items ?? [];
  const seqScans = items.filter((i) => i.seqScan);

  return (
    <div className="space-y-4" data-testid="perf-tab">
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">Ana sorgular (EXPLAIN ANALYZE)</h2>
            <p className="text-sm text-muted-foreground">
              {explain.isLoading ? 'Ölçülüyor…' : `${items.length} sorgu · toplam ${explain.data?.totalMs ?? 0} ms · ${seqScans.length} sequential scan`}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm" data-testid="explain-table">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2">Sorgu</th><th className="px-3 py-2 text-right">Süre</th>
                  <th className="px-3 py-2 text-right">Satır</th><th className="px-3 py-2">Plan</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.name} className="border-b last:border-0 align-top">
                    <td className="px-3 py-2">{i.name}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${i.ms > 500 ? 'text-destructive' : ''}`}>{i.ms} ms</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{i.rows}</td>
                    <td className="px-3 py-2">
                      {i.seqScan ? <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">Sequential scan</span>
                        : <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">İndeks kullanıyor</span>}
                      <button type="button" className="ml-2 text-xs text-primary hover:underline" onClick={() => setOpenPlan(openPlan === i.name ? null : i.name)}>
                        {openPlan === i.name ? 'gizle' : 'planı gör'}
                      </button>
                      {openPlan === i.name && <pre className="mt-2 max-h-56 overflow-auto rounded bg-muted p-2 text-[11px] leading-tight">{i.plan}</pre>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 font-medium">Tablolar</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm" data-testid="tables-table">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2">Tablo</th><th className="px-3 py-2 text-right">Tahmini satır</th><th className="px-3 py-2 text-right">Boyut</th>
                </tr>
              </thead>
              <tbody>
                {(stats.data?.tables ?? []).slice(0, 12).map((t) => (
                  <tr key={t.table_name} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-mono text-xs">{t.table_name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{t.row_estimate.toLocaleString('tr-TR')}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{t.total_size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(stats.data?.unusedIndexes.length ?? 0) > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Hiç kullanılmamış indeks: {stats.data!.unusedIndexes.slice(0, 5).map((i) => i.index_name).join(', ')}
              {stats.data!.unusedIndexes.length > 5 ? '…' : ''} (yeni kurulumda normaldir)
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KvkkTab() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Retention | null>(null);
  const [run, setRun] = useState<RetentionRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['ops-retention'],
    queryFn: async () => {
      const r = await apiJson<Retention>('/api/v1/ops/retention');
      setForm(r);
      return r;
    },
  });

  const save = async () => {
    if (!form) return;
    setBusy(true); setError(null);
    try {
      await apiJson('/api/v1/ops/retention', { method: 'POST', json: form });
      await qc.invalidateQueries({ queryKey: ['ops-retention'] });
      setFlash('Saklama süreleri kaydedildi.');
      setTimeout(() => setFlash(null), 5000);
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  const preview = async (apply: boolean) => {
    setBusy(true); setError(null);
    try {
      setRun(await apiJson<RetentionRun>(`/api/v1/ops/retention/run?apply=${apply}`, { method: 'POST', json: {} }));
      if (apply) setFlash('Saklama süresi uygulandı.');
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  if (!data || !form) return <p className="py-10 text-center text-sm text-muted-foreground">Yükleniyor…</p>;

  return (
    <div className="space-y-4" data-testid="kvkk-tab">
      {flash && <div role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">{flash}</div>}
      {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="font-medium">Saklama süreleri (gün)</h2>
          <p className="text-sm text-muted-foreground">
            Ticari belgeler yasal saklama süresi boyunca korunur; kişisel veri içeren günlükler süre dolunca silinir.
          </p>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-4">
            {([
              ['auditLogDays', 'İşlem günlüğü'],
              ['emailLogDays', 'E-posta günlüğü'],
              ['documentDays', 'Ticari belgeler'],
              ['deletedPartnerDays', 'Silinmiş cari kartı'],
            ] as const).map(([k, label]) => (
              <label key={k} className="block text-sm">
                <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
                <Input type="number" min={0} value={form[k]} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} aria-label={label} data-testid={`retention-${k}`} />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={busy} data-testid="save-retention">Kaydet</Button>
            <Button variant="outline" onClick={() => void preview(false)} disabled={busy} data-testid="preview-retention">Ne silinecek?</Button>
            <Button variant="outline" className="text-destructive" onClick={() => void preview(true)} disabled={busy || !run}>Uygula</Button>
          </div>
        </CardContent>
      </Card>

      {run && (
        <Card>
          <CardContent className="p-4" data-testid="retention-plan">
            <h2 className="mb-2 font-medium">{run.applied ? 'Uygulandı' : 'Önizleme'}</h2>
            <ul className="space-y-1 text-sm">
              {run.plan.map((p) => (
                <li key={p.what} className="flex justify-between border-b py-1 last:border-0">
                  <span>{p.what}</span><span className="tabular-nums">{p.count.toLocaleString('tr-TR')} kayıt</span>
                </li>
              ))}
            </ul>
            {run.applied && <p className="mt-2 text-sm text-muted-foreground">{run.deleted ?? 0} kayıt silindi.</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="font-medium">Veri sahibi talepleri</h2>
          <p className="text-sm text-muted-foreground">
            Erişim talebi: <span className="font-mono text-xs">/api/v1/ops/personal-data/partner/&lt;id&gt;</span> bir carinin tüm verisini JSON olarak döndürür.
            Silme talebi cari kartında kişisel alanları anonimleştirir; ticari belgeler yasal zorunluluk nedeniyle kalır ve
            işlem günlüğüne sebebiyle yazılır.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function BackupTab() {
  const { data, isLoading } = useQuery({ queryKey: ['ops-backup'], queryFn: () => apiJson<BackupReport>('/api/v1/ops/backup-report') });
  if (isLoading || !data) return <p className="py-10 text-center text-sm text-muted-foreground">Yükleniyor…</p>;

  return (
    <div className="space-y-4" data-testid="backup-tab">
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {([
          ['Belge', data.counts.documents],
          ['Stok hareketi', data.counts.movements],
          ['Cari', data.counts.partners],
          ['Ürün', data.counts.products],
        ] as const).map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-xl font-semibold tabular-nums">{value.toLocaleString('tr-TR')}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="font-medium">Son yazma</h2>
          <p className="text-sm text-muted-foreground">
            Belge: {data.lastWrite.document ? `${data.lastWrite.document.number} · ${trDateTime(data.lastWrite.document.at)}` : '—'}
            {' · '}Stok hareketi: {data.lastWrite.movement ? trDateTime(data.lastWrite.movement) : '—'}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-2 font-medium">Geri yükleme tatbikatı</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {data.drill.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">{data.note}</p>
        </CardContent>
      </Card>
    </div>
  );
}
