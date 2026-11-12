'use client';

import { z } from 'zod';
import { CrudScreen, type CrudConfig, type CrudRow, type Option } from '@/components/crud/crud-screen';
import { apiJson } from '@/lib/problem';

interface CategoryRow extends CrudRow {
  name: string;
  parentId: string | null;
  parentName: string | null;
  productCount: number;
  childCount: number;
}

interface TreeNode {
  id: string;
  name: string;
  children: TreeNode[];
}

const schema = z.object({
  name: z.string().trim().min(1, 'Kategori adı gerekli').max(120, 'En fazla 120 karakter'),
  parentId: z.string(),
});
type Form = z.infer<typeof schema>;

/** Flatten the tree into indented options so the hierarchy is readable in a <select>. */
async function loadParents(): Promise<Option[]> {
  const { roots } = await apiJson<{ roots: TreeNode[] }>('/api/v1/categories/tree');
  const out: Option[] = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      out.push({ value: n.id, label: `${'  '.repeat(depth)}${depth ? '└ ' : ''}${n.name}` });
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

const cfg: CrudConfig<CategoryRow, Form> = {
  title: 'Kategoriler',
  singular: 'Kategori',
  endpoint: '/api/v1/categories',
  writePermission: 'product.write',
  searchPlaceholder: 'Kategori ara',
  columns: [
    {
      key: 'name',
      label: 'Kategori',
      render: (r) => (
        <span>
          {r.parentName && <span className="text-muted-foreground">{r.parentName} › </span>}
          {r.name}
        </span>
      ),
    },
    { key: 'childCount', label: 'Alt kategori', align: 'right' },
    { key: 'productCount', label: 'Ürün', align: 'right' },
  ],
  fields: [
    { name: 'name', label: 'Kategori adı', autoFocus: true },
    {
      name: 'parentId',
      label: 'Üst kategori',
      type: 'select',
      allowEmpty: true,
      options: loadParents,
      hint: 'Boş bırakılırsa kök kategori olur.',
    },
  ],
  schema,
  defaults: { name: '', parentId: '' },
  toForm: (r) => ({ name: r.name, parentId: r.parentId ?? '' }),
  rowLabel: (r) => (r.parentName ? `${r.parentName} › ${r.name}` : r.name),
  usage: (r) => {
    const parts = [];
    if (r.childCount > 0) parts.push(`${r.childCount} alt kategori`);
    if (r.productCount > 0) parts.push(`${r.productCount} ürün`);
    return parts.length ? `${parts.join(' ve ')} bu kategoriye bağlı — silme reddedilecek.` : null;
  },
};

export default function Page() {
  return <CrudScreen cfg={cfg} />;
}
