'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useForm, type DefaultValues, type FieldValues, type Path } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type { ZodType } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { apiJson, ApiError, toFormPath } from '@/lib/problem';
import { zodResolver } from '@/lib/zod-resolver';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import { useAuth } from '@/components/auth-provider';

/* ------------------------------------------------------------------ types */

export interface Option {
  value: string;
  label: string;
}

export interface CrudField<TForm extends FieldValues> {
  name: Path<TForm>;
  label: string;
  type?: 'text' | 'number' | 'checkbox' | 'select';
  placeholder?: string;
  hint?: string;
  /** For selects: static options or a loader (e.g. category tree). */
  options?: Option[] | (() => Promise<Option[]>);
  /** Allow an empty choice for selects (rendered as "—"). */
  allowEmpty?: boolean;
  autoFocus?: boolean;
}

export interface CrudColumn<TRow> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  render?: (row: TRow) => ReactNode;
}

export interface CrudRow {
  id: string;
  version: number;
  deletedAt: string | null;
}

export interface CrudConfig<TRow extends CrudRow, TForm extends FieldValues> {
  title: string;
  /** Singular noun for dialogs: "Marka" */
  singular: string;
  /** API collection path, e.g. /api/v1/brands */
  endpoint: string;
  /** Permission required for Yeni/Düzenle/Sil. */
  writePermission: string;
  columns: CrudColumn<TRow>[];
  fields: CrudField<TForm>[];
  schema: ZodType<TForm>;
  defaults: DefaultValues<TForm>;
  /** Row → form values for editing. */
  toForm: (row: TRow) => TForm;
  /** Human label for a row in confirmations. */
  rowLabel: (row: TRow) => string;
  searchPlaceholder?: string;
  /** Extra "in use" summary shown in the delete confirmation. */
  usage?: (row: TRow) => string | null;
}

interface ListResponse<TRow> {
  items: TRow[];
  total: number;
}

/* ------------------------------------------------------------------ form */

function CrudForm<TRow extends CrudRow, TForm extends FieldValues>({
  cfg,
  row,
  onClose,
  onSaved,
}: {
  cfg: CrudConfig<TRow, TForm>;
  row: TRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = row !== null;
  const form = useForm<TForm>({
    resolver: zodResolver(cfg.schema),
    defaultValues: (isEdit ? (cfg.toForm(row) as DefaultValues<TForm>) : cfg.defaults),
    mode: 'onBlur',
  });
  const { register, handleSubmit, formState, setError } = form;
  const guardClose = useUnsavedChanges(formState.isDirty);
  const [conflict, setConflict] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [optionsByField, setOptionsByField] = useState<Record<string, Option[]>>({});

  // Load dynamic select options once.
  useEffect(() => {
    let cancelled = false;
    for (const f of cfg.fields) {
      if (typeof f.options === 'function') {
        f.options().then((opts) => {
          if (!cancelled) setOptionsByField((s) => ({ ...s, [f.name]: opts }));
        });
      }
    }
    return () => {
      cancelled = true;
    };
  }, [cfg.fields]);

  const mutation = useMutation({
    mutationFn: async (values: TForm) => {
      if (isEdit) {
        return apiJson(`${cfg.endpoint}/${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          json: { ...values, version: row.version },
        });
      }
      return apiJson(cfg.endpoint, { method: 'POST', json: values });
    },
    onSuccess: () => onSaved(),
    onError: (err) => {
      if (!(err instanceof ApiError)) {
        setFormError((err as Error).message);
        return;
      }
      if (err.isVersionConflict) {
        setConflict(err.problem.currentVersion ?? null);
        return;
      }
      const errors = err.fieldErrors;
      let placed = false;
      for (const [path, message] of Object.entries(errors)) {
        if (path === '_') continue;
        setError(toFormPath(path) as Path<TForm>, { type: 'server', message });
        placed = true;
      }
      if (!placed || errors._) setFormError(errors._ ?? err.message);
    },
  });

  const close = useCallback(() => guardClose(onClose), [guardClose, onClose]);

  // Ctrl+S saves; Esc is routed via Dialog.onClose → guardClose.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSubmit((v) => mutation.mutate(v))();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSubmit, mutation]);

  const fieldError = (name: string) => {
    const err = (formState.errors as Record<string, { message?: string } | undefined>)[name];
    return err?.message;
  };

  return (
    <Dialog
      open
      onClose={close}
      title={isEdit ? `${cfg.singular} düzenle` : `Yeni ${cfg.singular.toLocaleLowerCase('tr')}`}
      description={isEdit ? cfg.rowLabel(row) : undefined}
      footer={
        <>
          <Button variant="outline" type="button" onClick={close} disabled={mutation.isPending}>
            Vazgeç <span className="ml-2 text-xs opacity-60">Esc</span>
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit((v) => mutation.mutate(v))()}
            disabled={mutation.isPending || conflict !== null}
          >
            {mutation.isPending ? 'Kaydediliyor…' : 'Kaydet'}
            <span className="ml-2 text-xs opacity-60">Ctrl+S</span>
          </Button>
        </>
      }
    >
      {conflict !== null && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          <p className="font-medium">Kayıt başkası tarafından değiştirildi.</p>
          <p className="mt-1 text-muted-foreground">
            Sizin açtığınız sürüm {row?.version}, güncel sürüm {conflict}. Değişikliklerinizi kaybetmemek için
            not alın, sonra yenileyin.
          </p>
          <Button size="sm" variant="outline" className="mt-2" onClick={onSaved}>
            Yenile ve kapat
          </Button>
        </div>
      )}
      {formError && (
        <div role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {formError}
        </div>
      )}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit((v) => mutation.mutate(v))();
        }}
      >
        {cfg.fields.map((f) => {
          const err = fieldError(f.name);
          const id = `f-${f.name}`;
          if (f.type === 'checkbox') {
            return (
              <div key={f.name} className="flex items-center gap-2">
                <input id={id} type="checkbox" className="h-4 w-4" {...register(f.name)} />
                <Label htmlFor={id}>{f.label}</Label>
              </div>
            );
          }
          if (f.type === 'select') {
            const opts = Array.isArray(f.options) ? f.options : (optionsByField[f.name] ?? []);
            return (
              <div key={f.name} className="space-y-1">
                <Label htmlFor={id}>{f.label}</Label>
                <select
                  id={id}
                  className="flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
                  aria-invalid={!!err}
                  {...register(f.name)}
                >
                  {f.allowEmpty && <option value="">—</option>}
                  {opts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {err && <p className="text-xs text-destructive">{err}</p>}
                {f.hint && !err && <p className="text-xs text-muted-foreground">{f.hint}</p>}
              </div>
            );
          }
          return (
            <div key={f.name} className="space-y-1">
              <Label htmlFor={id}>{f.label}</Label>
              <Input
                id={id}
                type={f.type === 'number' ? 'number' : 'text'}
                placeholder={f.placeholder}
                autoFocus={f.autoFocus}
                aria-invalid={!!err}
                {...register(f.name, f.type === 'number' ? { valueAsNumber: true } : undefined)}
              />
              {err && <p className="text-xs text-destructive">{err}</p>}
              {f.hint && !err && <p className="text-xs text-muted-foreground">{f.hint}</p>}
            </div>
          );
        })}
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ screen */

export function CrudScreen<TRow extends CrudRow, TForm extends FieldValues>({
  cfg,
}: {
  cfg: CrudConfig<TRow, TForm>;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canWrite = user?.permissions.includes(cfg.writePermission) ?? false;

  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [editing, setEditing] = useState<TRow | null | 'new'>(null);
  const [deleting, setDeleting] = useState<TRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDq(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ pageSize: '500' });
    if (dq.trim()) p.set('q', dq.trim());
    if (showDeleted) p.set('includeDeleted', 'true');
    return p.toString();
  }, [dq, showDeleted]);

  const listKey = [cfg.endpoint, params];
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: listKey,
    queryFn: () => apiJson<ListResponse<TRow>>(`${cfg.endpoint}?${params}`),
    placeholderData: keepPreviousData,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: [cfg.endpoint] });

  const del = useMutation({
    mutationFn: (row: TRow) =>
      apiJson(`${cfg.endpoint}/${encodeURIComponent(row.id)}?version=${row.version}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleting(null);
      setDeleteError(null);
      invalidate();
    },
    onError: (err) => setDeleteError(err instanceof ApiError ? err.fieldErrors._ ?? err.message : (err as Error).message),
  });
  const restore = useMutation({
    mutationFn: (row: TRow) => apiJson(`${cfg.endpoint}/${encodeURIComponent(row.id)}/restore`, { method: 'POST' }),
    onSuccess: invalidate,
  });

  const rows = data?.items ?? [];

  // Keyboard on the list: ↑↓ move, Enter edits.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (rows.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter' && canWrite) {
      e.preventDefault();
      const r = rows[cursor];
      if (r && !r.deletedAt) setEditing(r);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <a href="/settings/" className="text-xs text-muted-foreground hover:underline">← Ayarlar</a>
          <h1 className="text-2xl font-semibold">{cfg.title}</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? 'Yükleniyor…' : `${data?.total ?? 0} kayıt`}
            {isFetching && !isLoading ? ' · güncelleniyor…' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={cfg.searchPlaceholder ?? 'Ara'}
            className="w-64"
            aria-label={`${cfg.singular} ara`}
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
            Silinenleri göster
          </label>
          {canWrite && (
            <Button onClick={() => setEditing('new')} data-testid="crud-new">
              + Yeni {cfg.singular.toLocaleLowerCase('tr')}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="grid place-items-center gap-2 py-20 text-center">
              <p className="text-sm text-destructive">{(error as Error).message}</p>
              <Button variant="outline" size="sm" onClick={invalidate}>Tekrar dene</Button>
            </div>
          ) : isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-9 animate-pulse rounded bg-muted" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="grid place-items-center gap-3 py-20 text-center">
              <p className="text-sm font-medium">{dq ? 'Sonuç yok' : `Henüz ${cfg.singular.toLocaleLowerCase('tr')} yok`}</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {dq ? 'Aramayla eşleşen kayıt bulunamadı.' : `"Yeni" ile ilk kaydı oluşturun.`}
              </p>
              {canWrite && !dq && (
                <Button size="sm" onClick={() => setEditing('new')}>+ Yeni {cfg.singular.toLocaleLowerCase('tr')}</Button>
              )}
            </div>
          ) : (
            <div
              tabIndex={0}
              onKeyDown={onKeyDown}
              className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${cfg.title} listesi`}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    {cfg.columns.map((c) => (
                      <th key={c.key} className={`px-4 py-3 ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>
                    ))}
                    <th className="px-4 py-3 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={r.id}
                      aria-selected={i === cursor}
                      onMouseEnter={() => setCursor(i)}
                      onDoubleClick={() => canWrite && !r.deletedAt && setEditing(r)}
                      className={`border-b last:border-0 ${i === cursor ? 'bg-muted' : 'hover:bg-muted/60'} ${r.deletedAt ? 'opacity-60' : ''}`}
                    >
                      {cfg.columns.map((c) => (
                        <td key={c.key} className={`px-4 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                          {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '—')}
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        {r.deletedAt ? (
                          <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-[11px]">Silinmiş</span>
                        ) : null}
                        {canWrite && r.deletedAt && (
                          <Button size="sm" variant="ghost" onClick={() => restore.mutate(r)} disabled={restore.isPending}>
                            Geri getir
                          </Button>
                        )}
                        {canWrite && !r.deletedAt && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(r)} data-testid="crud-edit">
                              Düzenle
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => { setDeleteError(null); setDeleting(r); }}
                              data-testid="crud-delete"
                            >
                              Sil
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {editing !== null && (
        <CrudForm
          cfg={cfg}
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`${cfg.singular} silinsin mi?`}
        danger
        confirmLabel="Sil"
        busy={del.isPending}
        onCancel={() => { setDeleting(null); setDeleteError(null); }}
        onConfirm={() => deleting && del.mutate(deleting)}
        description={
          deleting && (
            <div className="space-y-2">
              <p><span className="font-medium text-foreground">{cfg.rowLabel(deleting)}</span> silinecek. Kayıt geri getirilebilir.</p>
              {cfg.usage?.(deleting) && <p className="text-amber-700 dark:text-amber-500">{cfg.usage(deleting)}</p>}
              {deleteError && <p role="alert" className="text-destructive">{deleteError}</p>}
            </div>
          )
        }
      />
    </div>
  );
}
