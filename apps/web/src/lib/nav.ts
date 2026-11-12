export type ModuleCode = 'SALES' | 'WAREHOUSE' | 'REPORTS';

export interface NavItem {
  href: string;
  label: string;
  icon: string; // lucide-react icon name
  module?: ModuleCode;
  permission?: string;
}

/** Sidebar navigation. Filtered by the user's license modules and permissions. */
export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Panel', icon: 'LayoutDashboard' },
  {
    href: '/products',
    label: 'Ürünler',
    icon: 'Package',
    module: 'SALES',
    permission: 'product.read',
  },
  {
    href: '/partners',
    label: 'Cariler',
    icon: 'Users',
    module: 'SALES',
    permission: 'partner.read',
  },
  {
    href: '/quotes',
    label: 'Teklifler',
    icon: 'FileText',
    module: 'SALES',
    permission: 'quote.read',
  },
  {
    href: '/orders',
    label: 'Siparişler',
    icon: 'ShoppingCart',
    module: 'SALES',
    permission: 'order.read',
  },
  {
    href: '/pricing',
    label: 'Fiyatlar',
    icon: 'Tags',
    module: 'SALES',
    permission: 'product.read',
  },
  {
    href: '/stock',
    label: 'Stok',
    icon: 'Boxes',
    module: 'WAREHOUSE',
    permission: 'stock.read',
  },
  {
    href: '/warehouse',
    label: 'Depo',
    icon: 'Warehouse',
    module: 'WAREHOUSE',
    permission: 'stock.read',
  },
  {
    href: '/shipments',
    label: 'Sevkiyat',
    icon: 'Truck',
    module: 'WAREHOUSE',
    permission: 'order.read',
  },
  {
    href: '/edocs',
    label: 'e-Belgeler',
    icon: 'FileCheck',
    module: 'SALES',
    permission: 'order.read',
  },
  {
    href: '/returns',
    label: 'İadeler',
    icon: 'Undo2',
    module: 'SALES',
    permission: 'order.read',
  },
  {
    href: '/reports',
    label: 'Raporlar',
    icon: 'ChartColumn',
    module: 'REPORTS',
    permission: 'report.view',
  },
  { href: '/settings', label: 'Ayarlar', icon: 'Settings', permission: 'settings.manage' },
];

export function visibleNav(modules: string[], permissions: string[]): NavItem[] {
  return NAV.filter((item) => {
    if (item.module && !modules.includes(item.module)) return false;
    if (item.permission && !permissions.includes(item.permission)) return false;
    return true;
  });
}
