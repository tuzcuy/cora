import { z } from 'zod';
import { versionField } from '../../../common/crud/crud-query.dto.js';

const money = z.coerce.number().finite().nonnegative();
const qty = z.coerce.number({ error: 'Miktar gerekli' }).finite().positive('Miktar 0’dan büyük olmalı');
const pct = z.coerce.number().min(0, 'En az 0').max(100, 'En fazla 100');
const isoDate = z.coerce.date();

/**
 * One editor line as the CLIENT sends it. No totals: the server recomputes
 * every amount with the shared pricing engine (P04 A1). `unitPrice` present
 * means "manual price" and marks the line overridden.
 */
export const LineInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1).nullable().optional(),
  description: z.string().trim().max(500).optional(),
  qty,
  /** Selected unit (ADET/KOLİ) — free string on the schema; unitFactor converts to base units. */
  unitId: z.string().trim().min(1).nullable().optional(),
  unitFactor: z.coerce.number().positive('Birim çarpanı 0’dan büyük olmalı').default(1),
  unitPrice: money.optional(),
  discountRate: pct.optional(),
  discountAmount: money.optional(),
  vatRate: pct.optional(),
  warehouseId: z.string().trim().min(1).nullable().optional(),
});
export type LineInputDto = z.infer<typeof LineInputSchema>;

const header = {
  partnerId: z.string({ error: 'Müşteri gerekli' }).trim().min(1, 'Müşteri gerekli'),
  date: isoDate.optional(),
  validUntil: isoDate.nullable().optional(),
  deliveryDate: isoDate.nullable().optional(),
  currency: z.enum(['TRY', 'USD', 'EUR']).optional(),
  priceIncludesVat: z.boolean().optional(),
  contactId: z.string().trim().min(1).nullable().optional(),
  shippingAddressId: z.string().trim().min(1).nullable().optional(),
  billingAddressId: z.string().trim().min(1).nullable().optional(),
  salesRepId: z.string().trim().min(1).nullable().optional(),
  paymentTerms: z.string().trim().max(200).nullable().optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  internalNotes: z.string().trim().max(2000).nullable().optional(),
};

export const CreateDocumentSchema = z.object({
  type: z.enum(['QUOTE', 'ORDER'], { error: 'Belge türü QUOTE veya ORDER olmalı' }),
  ...header,
  lines: z.array(LineInputSchema).max(500, 'En fazla 500 satır').default([]),
});
export type CreateDocumentDto = z.infer<typeof CreateDocumentSchema>;

/** PATCH: every header field optional; `lines` replaces the whole line set when present. */
export const UpdateDocumentSchema = z.object({
  ...Object.fromEntries(Object.entries(header).map(([k, v]) => [k, v.optional()])),
  lines: z.array(LineInputSchema).max(500).optional(),
  version: versionField,
}) as z.ZodObject<
  { [K in keyof typeof header]: z.ZodOptional<(typeof header)[K]> } & {
    lines: z.ZodOptional<z.ZodArray<typeof LineInputSchema>>;
    version: typeof versionField;
  }
>;
export type UpdateDocumentDto = z.infer<typeof UpdateDocumentSchema>;

export const TransitionSchema = z.object({
  toStatus: z.enum([
    'DRAFT', 'SENT', 'APPROVAL_PENDING', 'APPROVED', 'REJECTED', 'EXPIRED',
    'SENT_TO_WAREHOUSE', 'PICKING', 'READY', 'PARTIALLY_SHIPPED', 'SHIPPED', 'COMPLETED', 'CANCELLED',
  ]),
  note: z.string().trim().max(500).optional(),
  version: versionField.optional(),
});
export type TransitionDto = z.infer<typeof TransitionSchema>;

export const BulkTransitionSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(200),
  toStatus: TransitionSchema.shape.toStatus,
  note: z.string().trim().max(500).optional(),
});
export type BulkTransitionDto = z.infer<typeof BulkTransitionSchema>;

export const ReviseSchema = z.object({ note: z.string().trim().max(500).optional() });
export const ConvertSchema = z.object({ deliveryDate: isoDate.nullable().optional() });
