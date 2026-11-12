'use client';

import { z } from 'zod';
import { CrudScreen, type CrudConfig, type CrudRow } from '@/components/crud/crud-screen';

interface UnitRow extends CrudRow {
  code: string;
  name: string;
  decimals: number;
  productCount: number;
}

const schema = z.object({
  code: z.string().trim().min(1, 'Birim kodu gerekli').max(16, 'En fazla 16 karakter'),
  name: z.string().trim().min(1, 'Birim adı gerekli').max(60, 'En fazla 60 karakter'),
  decimals: z.number({ error: 'Sayı girin' }).int('Tam sayı olmalı').min(0, 'En az 0').max(6, 'En fazla 6'),
});
type Form = z.infer<typeof schema>;

const cfg: CrudConfig<UnitRow, Form> = {
  title: 'Birimler',
  singular: 'Birim',
  endpoint: '/api/v1/units',
  writePermission: 'settings.manage',
  searchPlaceholder: 'Birim ara',
  columns: [
    { key: 'code', label: 'Kod', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'name', label: 'Birim' },
    { key: 'decimals', label: 'Ondalık', align: 'right' },
    { key: 'productCount', label: 'Ürün', align: 'right' },
  ],
  fields: [
    { name: 'code', label: 'Kod', placeholder: 'ADET', hint: 'Büyük harfe çevrilir.', autoFocus: true },
    { name: 'name', label: 'Ad', placeholder: 'Adet' },
    { name: 'decimals', label: 'Ondalık basamak', type: 'number', hint: '0–6' },
  ],
  schema,
  defaults: { code: '', name: '', decimals: 0 },
  toForm: (r) => ({ code: r.code, name: r.name, decimals: r.decimals }),
  rowLabel: (r) => `${r.code} — ${r.name}`,
  usage: (r) => (r.productCount > 0 ? `${r.productCount} ürün bu birimi kullanıyor — silme reddedilecek.` : null),
};

export default function Page() {
  return <CrudScreen cfg={cfg} />;
}
