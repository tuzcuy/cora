import { z } from 'zod';
import { versionField } from '../../../common/crud/crud-query.dto.js';

const id = z.string().trim().min(1);
const qty = z.coerce.number().finite().positive('Miktar 0’dan büyük olmalı');
const isoDate = z.coerce.date();

/** UBL-TR 1.2 DespatchAdvice header fields, captured at creation (P05). */
const ubl = {
  carrier: z.string().trim().max(160).nullable().optional(),
  carrierVkn: z.string().trim().max(11).nullable().optional(),
  carrierTitle: z.string().trim().max(160).nullable().optional(),
  vehiclePlate: z.string().trim().max(20).nullable().optional(),
  trailerPlate: z.string().trim().max(20).nullable().optional(),
  driverName: z.string().trim().max(120).nullable().optional(),
  driverTckn: z.string().trim().max(11).nullable().optional(),
  packageCount: z.coerce.number().int().min(0).max(100000).optional(),
  packageTypeCode: z.string().trim().max(10).nullable().optional(),
  grossWeightKg: z.coerce.number().nonnegative().nullable().optional(),
  deliveryTermsCode: z.string().trim().max(10).nullable().optional(),
  actualDespatchDate: isoDate.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
};

export const ShipmentLineInputSchema = z.object({
  orderLineId: id,
  qty,
  note: z.string().trim().max(300).nullable().optional(),
});

export const CreateShipmentSchema = z.object({
  orderId: id,
  warehouseId: id.optional(),
  date: isoDate.optional(),
  ...ubl,
  /** Omit to ship everything still outstanding on the order. */
  lines: z.array(ShipmentLineInputSchema).max(500).optional(),
});
export type CreateShipmentDto = z.infer<typeof CreateShipmentSchema>;

export const UpdateShipmentSchema = z.object({
  version: versionField,
  date: isoDate.optional(),
  ...ubl,
  lines: z.array(ShipmentLineInputSchema).max(500).optional(),
});
export type UpdateShipmentDto = z.infer<typeof UpdateShipmentSchema>;

export const ShipmentQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['DRAFT', 'POSTED', 'CANCELLED']).optional(),
  orderId: id.optional(),
  warehouseId: id.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ShipmentQuery = z.infer<typeof ShipmentQuerySchema>;

export const CancelShipmentSchema = z.object({
  reason: z.string({ error: 'Sebep zorunlu' }).trim().min(3, 'Sebep zorunlu').max(300),
});
export type CancelShipmentDto = z.infer<typeof CancelShipmentSchema>;

/* ─────────────────────────── warehouse picking ───────────────────────── */

export const PickLineSchema = z.object({
  lineId: id,
  pickedQty: z.coerce.number().finite().min(0),
});
export const PickSchema = z.object({
  lines: z.array(PickLineSchema).min(1).max(500),
});
export type PickDto = z.infer<typeof PickSchema>;

/** Barcode-gun input: the scanner types a code and presses Enter. */
export const ScanSchema = z.object({
  barcode: z.string({ error: 'Barkod gerekli' }).trim().min(1).max(64),
  qty: z.coerce.number().finite().positive().default(1),
});
export type ScanDto = z.infer<typeof ScanSchema>;

/* ────────────────────────────── returns ──────────────────────────────── */

export const ReturnLineSchema = z.object({
  orderLineId: id,
  qty,
  note: z.string().trim().max(300).nullable().optional(),
});

export const CreateReturnSchema = z.object({
  orderId: id,
  warehouseId: id.optional(),
  date: isoDate.optional(),
  reason: z.string({ error: 'İade sebebi zorunlu' }).trim().min(3, 'İade sebebi zorunlu').max(500),
  lines: z.array(ReturnLineSchema).min(1, 'En az bir satır gerekli').max(500),
});
export type CreateReturnDto = z.infer<typeof CreateReturnSchema>;
