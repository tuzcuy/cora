'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import { downloadFile } from '@/lib/download';
import { fetchWarehouses } from '@/lib/stock';

interface Column {
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
}

interface Analysis {
  columns: Column[];
  headers: string[];
  mapping: Record<string, string | null>;
  rowCount: number;
  preview: Record<string, unknown>[];
  issues: { row: number; column: string; message: string; value?: string }[];
  issueCount: number;
  validCount: number;
}

interface CommitResult {
  created: number;
  updated: number;
  failed: { row: number; message: string }[];
  failedCount: number;
  openingStockLines: number;
  receiptNumber: string | null;
}

type Kind = 'products' | 'partners';
const KIND_LABEL: Record<Kind, string> = { products: 'Ürünler', partners: 'Cariler' };

/**
 * Excel içe aktarım sihirbazı (P06): yükle → sütun eşle → doğrula/önizle →
 * aktar. Hatalı satırlar CSV olarak indirilebilir, açılış stoğu giriş fişine
 * dönüşür.
 */
export function ImportWizard() {
  const [kind, setKind] = useState<Kind>('products');
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [warehouseId, setWarehouseId] = useState('');
  const [result, setResult] = useState<CommitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: fetchWarehouses });
  const step = result ? 4 : analysis ? (file ? 2 : 1) : 1;

  const missingRequired = useMemo(
    () => (analysis?.columns ?? []).filter((c) => c.required && !mapping[c.key]).map((c) => c.label),
    [analysis, mapping],
  );

  const post = async <T,>(path: string, form: FormData): Promise<T> => {
    const res = await apiFetch(path, { method: 'POST', body: form });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: string; errors?: Record<string, string> };
      throw new Error(Object.values(body.errors ?? {})[0] ?? body.detail ?? `İşlem başarısız (${res.status})`);
    }
    return (await res.json()) as T;
  };

  const analyze = async (f: File) => {
    setBusy(true); setError(null); setResult(null);
    try {
      const form = new FormData();
      form.append('file', f);
      form.append('kind', kind);
      const a = await post<Analysis>('/api/v1/documents/import/analyze', form);
      setAnalysis(a);
      setMapping(a.mapping);
      setFile(f);
    } catch (e) {
      setError((e as Error).message);
      setAnalysis(null);
    } finally { setBusy(false); }
  };

  const commit = async () => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);
      form.append('mapping', JSON.stringify(mapping));
      if (warehouseId) form.append('warehouseId', warehouseId);
      setResult(await post<CommitResult>('/api/v1/documents/import/commit', form));
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const downloadErrors = async () => {
    if (!result?.failed.length) return;
    const res = await apiFetch('/api/v1/documents/import/errors.csv', {
      method: 'POST',
      body: JSON.stringify({ failed: result.failed }),
    });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cora-import-hatalar.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const reset = () => { setFile(null); setAnalysis(null); setResult(null); setError(null); if (inputRef.current) inputRef.current.value = ''; };

  return (
    <div className="space-y-6" data-testid="import-wizard" data-step={step}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <a href="/settings/" className="text-sm text-primary hover:underline">← Ayarlar</a>
          <h1 className="text-2xl font-semibold">Excel’den içe aktar</h1>
          <p className="text-sm text-muted-foreground">Yükle → sütunları eşle → doğrula → aktar. Türkçe ondalık virgülü desteklenir.</p>
        </div>
        <Button variant="outline" onClick={() => void downloadFile(`/api/v1/documents/import/template/${kind}.xlsx`, `cora-${kind}-sablon.xlsx`)} data-testid="download-template">
          Şablonu indir
        </Button>
      </div>

      <ol className="flex flex-wrap gap-2 text-sm">
        {['Dosya', 'Eşleme', 'Doğrulama', 'Sonuç'].map((label, i) => (
          <li key={label} className={`rounded-full border px-3 py-1 ${step > i ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground'}`}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      {/* 1 — file */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="flex gap-2">
            {(['products', 'partners'] as Kind[]).map((k) => (
              <Button key={k} size="sm" variant={kind === k ? 'default' : 'outline'} onClick={() => { setKind(k); reset(); }} data-testid={`kind-${k}`}>
                {KIND_LABEL[k]}
              </Button>
            ))}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            aria-label="Excel dosyası"
            data-testid="import-file"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void analyze(f); }}
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
          />
          {file && <span className="text-sm text-muted-foreground">{file.name}</span>}
          {busy && <span className="text-sm text-muted-foreground">İşleniyor…</span>}
          {file && <Button variant="ghost" size="sm" onClick={reset}>Temizle</Button>}
        </CardContent>
      </Card>

      {analysis && !result && (
        <>
          {/* 2 — mapping */}
          <Card>
            <CardContent className="p-4">
              <h2 className="mb-3 font-medium">Sütun eşleme</h2>
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {analysis.columns.map((c) => (
                  <label key={c.key} className="block text-sm">
                    <span className="mb-1 block text-xs text-muted-foreground">
                      {c.label}{c.required ? ' *' : ''}{c.hint ? ` · ${c.hint}` : ''}
                    </span>
                    <select
                      value={mapping[c.key] ?? ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [c.key]: e.target.value || null }))}
                      aria-label={`${c.label} sütunu`}
                      data-testid={`map-${c.key}`}
                      className={`h-10 w-full rounded-md border bg-card px-3 text-sm ${c.required && !mapping[c.key] ? 'border-destructive' : 'border-input'}`}
                    >
                      <option value="">— eşlenmedi —</option>
                      {analysis.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {kind === 'products' && (
                <label className="mt-4 block max-w-xs text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">Açılış stoğu deposu</span>
                  <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label="Açılış stoğu deposu" data-testid="opening-warehouse"
                          className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm">
                    <option value="">Açılış stoğu aktarma</option>
                    {(warehouses.data?.items ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </label>
              )}
            </CardContent>
          </Card>

          {/* 3 — validation + preview */}
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 className="font-medium">Doğrulama</h2>
                <span className="text-sm text-muted-foreground" data-testid="import-summary">
                  {analysis.rowCount} satır · {analysis.validCount} sorunsuz · {analysis.issueCount} uyarı
                </span>
              </div>

              {analysis.issues.length > 0 && (
                <div className="mb-4 max-h-48 overflow-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                        <th className="px-3 py-2">Satır</th><th className="px-3 py-2">Sütun</th><th className="px-3 py-2">Uyarı</th>
                      </tr>
                    </thead>
                    <tbody data-testid="import-issues">
                      {analysis.issues.map((i, idx) => (
                        <tr key={idx} className="border-b last:border-0">
                          <td className="px-3 py-1.5 tabular-nums">{i.row}</td>
                          <td className="px-3 py-1.5">{i.column}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{i.message}{i.value ? ` (${i.value})` : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="max-h-64 overflow-auto rounded-md border">
                <table className="w-full text-sm" data-testid="import-preview">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      {analysis.headers.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.preview.map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {analysis.headers.map((h) => <td key={h} className="whitespace-nowrap px-3 py-1.5">{String(row[h] ?? '')}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Button onClick={() => void commit()} disabled={busy || missingRequired.length > 0} data-testid="import-commit">
                  {busy ? 'Aktarılıyor…' : `${analysis.rowCount} satırı aktar`}
                </Button>
                {missingRequired.length > 0 && (
                  <span className="text-sm text-destructive">Zorunlu sütun eşlenmedi: {missingRequired.join(', ')}</span>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* 4 — result */}
      {result && (
        <Card>
          <CardContent className="space-y-3 p-4" data-testid="import-result">
            <h2 className="font-medium">Aktarım tamamlandı</h2>
            <ul className="space-y-1 text-sm">
              <li><span className="font-medium tabular-nums">{result.created}</span> yeni kayıt</li>
              <li><span className="font-medium tabular-nums">{result.updated}</span> güncellenen kayıt</li>
              <li><span className="font-medium tabular-nums">{result.failedCount}</span> hatalı satır</li>
              {result.openingStockLines > 0 && (
                <li><span className="font-medium tabular-nums">{result.openingStockLines}</span> satır açılış stoğu → giriş fişi {result.receiptNumber}</li>
              )}
            </ul>
            <div className="flex gap-2">
              {result.failedCount > 0 && <Button variant="outline" onClick={() => void downloadErrors()} data-testid="download-errors">Hatalı satırları indir (CSV)</Button>}
              <Button variant="outline" onClick={reset}>Yeni dosya</Button>
              <a href={kind === 'products' ? '/products/' : '/partners/'} className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                {KIND_LABEL[kind]} listesine git
              </a>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
