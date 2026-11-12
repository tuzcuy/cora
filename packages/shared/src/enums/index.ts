/**
 * Domain enums for Cora. String values MUST match the Prisma enum member names
 * so the same literal can be used across web, api and DB.
 */

export const SalesDocumentType = {
  QUOTE: 'QUOTE',
  ORDER: 'ORDER',
  RETURN: 'RETURN',
} as const;
export type SalesDocumentType = (typeof SalesDocumentType)[keyof typeof SalesDocumentType];

/** Document families that get their own numbering sequence (DocumentSequence). */
export const DocumentType = {
  QUOTE: 'QUOTE',
  ORDER: 'ORDER',
  SHIPMENT: 'SHIPMENT',
  STOCK_RECEIPT: 'STOCK_RECEIPT',
  STOCK_COUNT: 'STOCK_COUNT',
  RETURN: 'RETURN',
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

/** Full sales document lifecycle (CORA_MIMARI §6). */
export const SalesStatus = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  /** Margin under Setting.minMarginPct or credit over limit — waits for a manager (P04 D2/D3). */
  APPROVAL_PENDING: 'APPROVAL_PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  SENT_TO_WAREHOUSE: 'SENT_TO_WAREHOUSE',
  PICKING: 'PICKING',
  READY: 'READY',
  PARTIALLY_SHIPPED: 'PARTIALLY_SHIPPED',
  SHIPPED: 'SHIPPED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type SalesStatus = (typeof SalesStatus)[keyof typeof SalesStatus];

export const PartnerType = {
  CUSTOMER: 'CUSTOMER',
  SUPPLIER: 'SUPPLIER',
  BOTH: 'BOTH',
} as const;
export type PartnerType = (typeof PartnerType)[keyof typeof PartnerType];

export const AddressType = {
  BILLING: 'BILLING',
  SHIPPING: 'SHIPPING',
} as const;
export type AddressType = (typeof AddressType)[keyof typeof AddressType];

export const StockMovementType = {
  RECEIPT: 'RECEIPT',
  SALE: 'SALE',
  ADJUSTMENT: 'ADJUSTMENT',
  TRANSFER_IN: 'TRANSFER_IN',
  TRANSFER_OUT: 'TRANSFER_OUT',
  COUNT: 'COUNT',
} as const;
export type StockMovementType = (typeof StockMovementType)[keyof typeof StockMovementType];

export const StockReceiptStatus = {
  DRAFT: 'DRAFT',
  POSTED: 'POSTED',
  CANCELLED: 'CANCELLED',
} as const;
export type StockReceiptStatus = (typeof StockReceiptStatus)[keyof typeof StockReceiptStatus];

export const ShipmentStatus = {
  DRAFT: 'DRAFT',
  POSTED: 'POSTED',
  CANCELLED: 'CANCELLED',
} as const;
export type ShipmentStatus = (typeof ShipmentStatus)[keyof typeof ShipmentStatus];

export const WarehouseTaskStatus = {
  PENDING: 'PENDING',
  PICKING: 'PICKING',
  READY: 'READY',
  CANCELLED: 'CANCELLED',
} as const;
export type WarehouseTaskStatus = (typeof WarehouseTaskStatus)[keyof typeof WarehouseTaskStatus];

export const PriceKind = {
  PURCHASE: 'PURCHASE',
  SALES: 'SALES',
} as const;
export type PriceKind = (typeof PriceKind)[keyof typeof PriceKind];

export const ExchangeRateSource = {
  TCMB: 'TCMB',
  MANUAL: 'MANUAL',
} as const;
export type ExchangeRateSource = (typeof ExchangeRateSource)[keyof typeof ExchangeRateSource];

export const EmailStatus = {
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  FAILED: 'FAILED',
} as const;
export type EmailStatus = (typeof EmailStatus)[keyof typeof EmailStatus];

/** Currencies handled in V1. */
export const Currency = {
  TRY: 'TRY',
  USD: 'USD',
  EUR: 'EUR',
} as const;
export type Currency = (typeof Currency)[keyof typeof Currency];

/** License modules (feature flags). */
export const LicenseModule = {
  SALES: 'SALES',
  WAREHOUSE: 'WAREHOUSE',
  REPORTS: 'REPORTS',
  FINANCE: 'FINANCE',
  EINVOICE: 'EINVOICE',
  PURCHASING: 'PURCHASING',
} as const;
export type LicenseModule = (typeof LicenseModule)[keyof typeof LicenseModule];

/**
 * Permission codes (`area.action`) — CORA_MIMARI §4.1.
 * The single source of truth for RBAC; seeded into the Permission table.
 */
export const PERMISSIONS = [
  'product.read',
  'product.write',
  'product.import',
  'partner.read',
  'partner.write',
  'partner.import',
  'quote.read',
  'quote.write',
  'quote.send',
  'quote.approve',
  'order.read',
  'order.write',
  'order.cancel',
  'order.edit_approved',
  'sales.view_all',
  /** Approve a document whose margin is under Setting.minMarginPct (P04 D3). */
  'sales.approve_low_margin',
  /** Approve a document that pushes the partner over its credit limit (P04 D2). */
  'partner.override_credit',
  'stock.read',
  'stock.receive',
  'stock.adjust',
  /** Move stock between warehouses (P05). */
  'stock.transfer',
  /** Open and post a physical count sheet (P05). */
  'stock.count',
  'warehouse.pick',
  'shipment.create',
  'shipment.post',
  'shipment.cancel',
  /** Customer returns: create and post a RETURN document (P05). */
  'return.write',
  'cost.view',
  'report.view',
  'export.excel',
  'user.manage',
  'settings.manage',
  'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permission grouping for UI (role editor). */
export const PERMISSION_GROUPS: Record<string, Permission[]> = {
  product: ['product.read', 'product.write', 'product.import'],
  partner: ['partner.read', 'partner.write', 'partner.import', 'partner.override_credit'],
  quote: ['quote.read', 'quote.write', 'quote.send', 'quote.approve'],
  order: [
    'order.read',
    'order.write',
    'order.cancel',
    'order.edit_approved',
    'sales.view_all',
    'sales.approve_low_margin',
  ],
  stock: ['stock.read', 'stock.receive', 'stock.adjust'],
  warehouse: ['warehouse.pick', 'shipment.create', 'shipment.post'],
  finance: ['cost.view'],
  reports: ['report.view', 'export.excel'],
  admin: ['user.manage', 'settings.manage', 'audit.read'],
};

/** System role packages (CORA_MIMARI §4.1). Copied per-tenant at seed time. */
export const SYSTEM_ROLES: Record<string, { permissions: Permission[] | '*' }> = {
  Yönetici: { permissions: '*' },
  Satış: {
    permissions: [
      'product.read',
      'partner.read',
      'partner.write',
      'quote.read',
      'quote.write',
      'quote.send',
      'quote.approve',
      'order.read',
      'order.write',
      'order.cancel',
      'stock.read',
      'export.excel',
    ],
  },
  Depo: {
    permissions: [
      'product.read',
      'order.read',
      'stock.read',
      'stock.receive',
      'stock.adjust',
      'warehouse.pick',
      'shipment.create',
      'shipment.post',
    ],
  },
  Muhasebe: {
    permissions: [
      'partner.read',
      'partner.write',
      'order.read',
      'shipment.create',
      'report.view',
      'export.excel',
      'audit.read',
    ],
  },
};

export function expandRolePermissions(spec: Permission[] | '*'): Permission[] {
  return spec === '*' ? [...PERMISSIONS] : spec;
}
