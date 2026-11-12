'use client';

import { z } from 'zod';
import { CrudScreen, type CrudConfig, type CrudRow } from '@/components/crud/crud-screen';

interface GroupRow extends CrudRow {
  code: string;
  name: string;
  partnerCount: number;
}

const schema = z.object({
  code: z.string().trim().min(1, 'Grup kodu gerekli').max(24, 'En fazla 24 karakter'),
  name: z.string().trim().min(1, 'Grup adı gerekli').max(80, 'En fazla 80 karakter'),
});
type Form = z.infer<typeof schema>;

const cfg: CrudConfig<GroupRow, Form> = {
  title: 'Cari Grupları',
  singular: 'Cari grubu',
  endpoint: '/api/v1/partner-groups',
  writePermission: 'partner.write',
  searchPlaceholder: 'Grup ara',
  columns: [
    { key: 'code', label: 'Kod', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'name', label: 'Grup' },
    { key: 'partnerCount', label: 'Cari', align: 'right' },
  ],
  fields: [
    { name: 'code', label: 'Kod', placeholder: '120.05', autoFocus: true },
    { name: 'name', label: 'Ad', placeholder: 'Belek Bölgesi' },
  ],
  schema,
  defaults: { code: '', name: '' },
  toForm: (r) => ({ code: r.code, name: r.name }),
  rowLabel: (r) => `${r.code} — ${r.name}`,
  usage: (r) => (r.partnerCount > 0 ? `${r.partnerCount} cari bu gruba bağlı — silme reddedilecek.` : null),
};

export default function Page() {
  return <CrudScreen cfg={cfg} />;
}
