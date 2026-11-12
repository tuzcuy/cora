'use client';

import { z } from 'zod';
import { CrudScreen, type CrudConfig, type CrudRow } from '@/components/crud/crud-screen';

interface BrandRow extends CrudRow {
  name: string;
  productCount: number;
}

const schema = z.object({
  name: z.string().trim().min(1, 'Marka adı gerekli').max(120, 'En fazla 120 karakter'),
});
type Form = z.infer<typeof schema>;

const cfg: CrudConfig<BrandRow, Form> = {
  title: 'Markalar',
  singular: 'Marka',
  endpoint: '/api/v1/brands',
  writePermission: 'product.write',
  searchPlaceholder: 'Marka ara',
  columns: [
    { key: 'name', label: 'Marka' },
    { key: 'productCount', label: 'Ürün', align: 'right' },
  ],
  fields: [{ name: 'name', label: 'Marka adı', placeholder: 'Örn. Paşabahçe', autoFocus: true }],
  schema,
  defaults: { name: '' },
  toForm: (r) => ({ name: r.name }),
  rowLabel: (r) => r.name,
  usage: (r) => (r.productCount > 0 ? `${r.productCount} ürün bu markaya bağlı — silme reddedilecek.` : null),
};

export default function Page() {
  return <CrudScreen cfg={cfg} />;
}
