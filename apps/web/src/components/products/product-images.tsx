'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/components/auth-provider';
import { apiFetch } from '@/lib/api-client';

interface ImageRow {
  id: string;
  fileName: string | null;
  contentType: string | null;
  byteSize: number | null;
  url: string;
}

/** Ürün görselleri (P06): PDF ve Excel çıktılarında da bu görseller kullanılır. */
export function ProductImages({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canWrite = (user?.permissions ?? []).includes('product.write');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const { data } = useQuery({
    queryKey: ['product-images', productId],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/files/products/${productId}/images`);
      if (!res.ok) throw new Error('Görseller yüklenemedi');
      const body = (await res.json()) as { items: ImageRow[] };
      // Images need the session cookie, so fetch them as blobs rather than
      // pointing <img src> at the API.
      const next: Record<string, string> = {};
      await Promise.all(
        body.items.map(async (img) => {
          const r = await apiFetch(img.url);
          if (r.ok) next[img.id] = URL.createObjectURL(await r.blob());
        }),
      );
      setUrls(next);
      return body;
    },
  });

  const upload = async (file: File) => {
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch(`/api/v1/files/products/${productId}/images`, { method: 'POST', body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { errors?: Record<string, string>; detail?: string };
        throw new Error(Object.values(body.errors ?? {})[0] ?? body.detail ?? 'Yüklenemedi');
      }
      await qc.invalidateQueries({ queryKey: ['product-images', productId] });
      if (inputRef.current) inputRef.current.value = '';
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true); setError(null);
    try {
      const res = await apiFetch(`/api/v1/files/images/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Silinemedi');
      await qc.invalidateQueries({ queryKey: ['product-images', productId] });
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const items = data?.items ?? [];

  return (
    <Card>
      <CardHeader><CardTitle>Görseller</CardTitle></CardHeader>
      <CardContent className="space-y-3" data-testid="product-images">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Görsel yok. Yüklenen fotoğraf teklif PDF’inde ve Excel çıktısında hücrenin içinde görünür.
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {items.map((img) => (
              <figure key={img.id} className="relative">
                <img src={urls[img.id] ?? ''} alt={img.fileName ?? 'Ürün görseli'} className="h-24 w-24 rounded-md border object-cover" />
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => void remove(img.id)}
                    aria-label={`${img.fileName ?? 'Görsel'} sil`}
                    className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full border bg-card text-xs shadow hover:text-destructive"
                  >
                    ×
                  </button>
                )}
              </figure>
            ))}
          </div>
        )}

        {canWrite && (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Görsel yükle"
              data-testid="image-upload"
              disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            />
            {busy && <span className="text-xs text-muted-foreground">Yükleniyor…</span>}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
