'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Me {
  userId: string;
  tenantId: string;
  email?: string;
  fullName?: string;
  repCode?: string | null;
  permissions: string[];
  modules?: string[];
  roles?: string[];
}

async function fetchMe(): Promise<Me> {
  const res = await apiFetch('/api/v1/auth/me');
  if (!res.ok) throw new Error('Oturum bilgisi alınamadı');
  return res.json();
}

/** Groups a permission code list by its prefix, e.g. product.* / order.*. */
function groupPermissions(perms: string[]) {
  const map = new Map<string, string[]>();
  for (const p of perms) {
    const [group] = p.split('.');
    const key = group ?? 'other';
    map.set(key, [...(map.get(key) ?? []), p]);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr'));
}

const GROUP_TR: Record<string, string> = {
  product: 'Ürün',
  partner: 'Cari',
  quote: 'Teklif',
  order: 'Sipariş',
  sales: 'Satış',
  stock: 'Stok',
  warehouse: 'Depo',
  shipment: 'Sevkiyat',
  cost: 'Maliyet',
  report: 'Rapor',
  export: 'Dışa aktarma',
  user: 'Kullanıcı',
  settings: 'Ayarlar',
  audit: 'Denetim',
};

export default function Page() {
  const { data, isLoading, error } = useQuery({ queryKey: ['me'], queryFn: fetchMe });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Ayarlar</h1>
        <p className="text-sm text-muted-foreground">Oturum, yetkiler ve kiracı bilgisi.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Tanımlar</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { href: '/settings/brands/', label: 'Markalar', hint: 'Ürün markaları' },
              { href: '/settings/categories/', label: 'Kategoriler', hint: 'Ağaç yapısı' },
              { href: '/settings/units/', label: 'Birimler', hint: 'Adet, koli, kg…' },
              { href: '/settings/warehouses/', label: 'Depolar', hint: 'Varsayılan depo' },
              { href: '/settings/partner-groups/', label: 'Cari Grupları', hint: 'Bölge / tedarikçi grupları' },
              { href: '/settings/import/', label: 'Excel’den içe aktar', hint: 'Ürün ve cari aktarımı' },
              { href: '/settings/admin/?tab=users', label: 'Kullanıcılar', hint: 'Hesap, rol, şifre sıfırlama' },
              { href: '/settings/admin/?tab=roles', label: 'Roller ve yetkiler', hint: 'Yetki matrisi' },
              { href: '/settings/admin/?tab=company', label: 'Firma ve belge', hint: 'Logo, banka, KDV, numaralar' },
              { href: '/settings/admin/?tab=rates', label: 'Döviz kurları', hint: 'TCMB veya elle giriş' },
              { href: '/settings/admin/?tab=audit', label: 'İşlem günlüğü', hint: 'Kim, ne, ne zaman' },
              { href: '/settings/health/', label: 'Sistem sağlığı', hint: 'Performans, KVKK, yedek' },
            ].map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-lg border bg-card p-4 transition-colors hover:border-primary"
              >
                <p className="font-medium">{l.label}</p>
                <p className="text-xs text-muted-foreground">{l.hint}</p>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card><CardContent className="py-16 text-center text-sm text-destructive">{(error as Error).message}</CardContent></Card>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => <div key={i} className="h-64 animate-pulse rounded-xl bg-muted" />)}
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Oturum</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
                {[
                  ['Ad soyad', data.fullName ?? '—'],
                  ['E-posta', data.email ?? '—'],
                  ['Temsilci kodu', data.repCode ?? '—'],
                  ['Kiracı', data.tenantId],
                  ['Yetki sayısı', String(data.permissions.length)],
                ].map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="truncate font-mono text-xs">{v}</dd>
                  </div>
                ))}
              </dl>
              {data.modules && data.modules.length > 0 && (
                <div className="mt-4 border-t pt-4">
                  <p className="mb-2 text-xs uppercase text-muted-foreground">Lisanslı modüller</p>
                  <div className="flex flex-wrap gap-1">
                    {data.modules.map((m) => (
                      <span key={m} className="rounded bg-muted px-2 py-0.5 text-xs">{m}</span>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Yetkiler</CardTitle></CardHeader>
            <CardContent>
              <div className="max-h-96 space-y-3 overflow-y-auto">
                {groupPermissions(data.permissions).map(([group, perms]) => (
                  <div key={group}>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {GROUP_TR[group] ?? group}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {perms.map((p) => (
                        <span key={p} className="rounded bg-muted px-2 py-0.5 font-mono text-[11px]">{p}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
                Maliyet ve kâr alanları <code className="font-mono">cost.view</code> yetkisi yoksa
                API cevabından tamamen çıkarılır — arayüzde gizlenmez.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
