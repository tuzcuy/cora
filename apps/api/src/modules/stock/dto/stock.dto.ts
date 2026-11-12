import { z } from 'zod';
import { versionField } from '../../../common/crud/crud-query.dto.js';

const qty = z.coerce.number({ error: 'Miktar gerekli' }).finite().positive('Miktar 0’dan büyük olmalı');
const money = z.coerce.number().finite().nonnegative();
const isoDate = z.coerce.date();
const id = z.string().trim().min(1);

/* ───────────────────────────── ledger / levels ───────────────────────── */

export const MovementQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  productId: id.optional(),
  warehouseId: id.optional(),
  type: z.enum(['RECEIPT', 'SALE', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'COUNT', 'RETURN_IN']).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type MovementQuery = z.infer<typeof MovementQuerySchema>;

export const LevelQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  warehouseId: id.optional(),
  /** Only rows at or below Product.minStock. */
  belowMin: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type LevelQuery = z.infer<typeof LevelQuerySchema>;

/* ─────────────────────────── goods receipt ───────────────────────────── */

export const ReceiptLineSchema = z.object({
  productId: id,
  qty,
  unitId: id.nullable().optional(),
  unitFactor: z.coerce.number().positive().default(1),
  unitCost: money,
  note: z.string().trim().max(300).nullable().optional(),
});

export const CreateReceiptSchema = z.object({
  warehouseId: id,
  supplierId: id.nullable().optional(),
  date: isoDate.optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  currency: z.enum(['TRY', 'USD', 'EUR']).optional(),
  exchangeRate: z.coerce.number().positive().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  lines: z.array(ReceiptLineSchema).max(500, 'En fazla 500 satır').default([]),
});
export type CreateReceiptDto = z.infer<typeof CreateReceiptSchema>;

export const UpdateReceiptSchema = CreateReceiptSchema.partial().extend({ version: versionField });
export type UpdateReceiptDto = z.infer<typeof UpdateReceiptSchema>;

export const ReceiptQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['DRAFT', 'POSTED', 'CANCELLED']).optional(),
  warehouseId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ReceiptQuery = z.infer<typeof ReceiptQuerySchema>;

/* ─────────────────────── adjustment / transfer ───────────────────────── */

export const AdjustSchema = z.object({
  productId: id,
  warehouseId: id,
  /** Signed: positive adds, negative removes. */
  qty: z.coerce.number({ error: 'Miktar gerekli' }).finite().refine((v) => v !== 0, 'Miktar 0 olamaz'),
  reason: z.string({ error: 'Sebep zorunlu' }).trim().min(3, 'Sebep zorunlu (en az 3 karakter)').max(300),
});
export type AdjustDto = z.infer<typeof AdjustSchema>;

export const TransferSchema = z.object({
  productId: id,
  fromWarehouseId: id,
  toWarehouseId: id,
  qty,
  note: z.string().trim().max(300).nullable().optional(),
});
export type TransferDto = z.infer<typeof TransferSchema>;

/* ────────────────────────────── counting ─────────────────────────────── */

export const CreateCountSchema = z.object({
  warehouseId: id,
  date: isoDate.optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  /** Products to count; empty means "every product that has a level in this warehouse". */
  productIds: z.array(id).max(2000).optional(),
});
export type CreateCountDto = z.infer<typeof CreateCountSchema>;

export const CountLineSchema = z.object({
  productId: id,
  countedQty: z.coerce.number().finite().min(0),
  note: z.string().trim().max(300).nullable().optional(),
});

export const UpdateCountSchema = z.object({
  version: versionField,
  note: z.string().trim().max(1000).nullable().optional(),
  lines: z.array(CountLineSchema).max(2000).optional(),
});
export type UpdateCountDto = z.infer<typeof UpdateCountSchema>;

export const CountQuerySchema = z.object({
  status: z.enum(['DRAFT', 'POSTED', 'CANCELLED']).optional(),
  warehouseId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type CountQuery = z.infer<typeof CountQuerySchema>;

export const PostSchema = z.object({ version: versionField.optional(), note: z.string().trim().max(500).optional() });
export type PostDto = z.infer<typeof PostSchema>;
