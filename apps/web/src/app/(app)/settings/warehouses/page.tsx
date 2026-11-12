'use client';

import { z } from 'zod';
import { CrudScreen, type CrudConfig, type CrudRow } from '@/components/crud/crud-screen';

interface WarehouseRow extends CrudRow {
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  stockLevelCount: number;
  movementCount: number;
}

const schema = z.object({
  code: z.string().trim().min(1, 'Depo kodu gerekli').max(16, 'En fazla 16 karakter'),
  name: z.string().trim().min(1, 'Depo adı gerekli').max(80, 'En fazla 80 karakter'),
  isDefault: z.boolean(),
  isActive: z.boolean(),
});
type Form = z.infer<typeof schema>;

const cfg: CrudConfig<WarehouseRow, Form> = {
  title: 'Depolar',
  singular: 'Depo',
  endpoint: '/api/v1/warehouses',
  writePermission: 'settings.manage',
  searchPlaceholder: 'Depo ara',
  columns: [
    { key: 'code', label: 'Kod', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'name', label: 'Depo' },
    {
      key: 'isDefault',
      label: 'Durum',
      render: (r) => (
        <span className="flex gap-1">
          {r.isDefault && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">Varsayılan</span>}
          {!r.isActive && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Pasif</span>}
        </span>
      ),
    },
    { key: 'stockLevelCount', label: 'Stok kaydı', align: 'right' },
  ],
  fields: [
    { name: 'code', label: 'Kod', placeholder: 'MERKEZ', hint: 'Büyük harfe çevrilir.', autoFocus: true },
    { name: 'name', label: 'Ad', placeholder: 'Merkez Depo' },
    { name: 'isDefault', label: 'Varsayılan depo (diğerlerinden alınır)', type: 'checkbox' },
    { name: 'isActive', label: 'Aktif', type: 'checkbox' },
  ],
  schema,
  defaults: { code: '', name: '', isDefault: false, isActive: true },
  toForm: (r) => ({ code: r.code, name: r.name, isDefault: r.isDefault, isActive: r.isActive }),
  rowLabel: (r) => `${r.code} — ${r.name}`,
  usage: (r) =>
    r.stockLevelCount > 0 || r.movementCount > 0
      ? `${r.stockLevelCount} stok kaydı ve ${r.movementCount} hareket bu depoya bağlı — silme reddedilecek.`
      : null,
};

export default function Page() {
  return <CrudScreen cfg={cfg} />;
}
