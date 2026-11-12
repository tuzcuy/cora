import { z } from 'zod';
import { versionField } from '../../../common/crud/crud-query.dto.js';

const id = z.string().trim().min(1);
const money = z.coerce.number().finite().nonnegative();
const pct = z.coerce.number().min(0).max(100);
const isoDate = z.coerce.date();

export const PriceListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  activeOnly: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type PriceListQuery = z.infer<typeof PriceListQuerySchema>;

export const CreatePriceListSchema = z.object({
  name: z.string({ error: 'Liste adı gerekli' }).trim().min(2, 'Liste adı gerekli').max(120),
  currency: z.enum(['TRY', 'USD', 'EUR']).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  validFrom: isoDate.nullable().optional(),
  validTo: isoDate.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type CreatePriceListDto = z.infer<typeof CreatePriceListSchema>;

export const UpdatePriceListSchema = CreatePriceListSchema.partial().extend({ version: versionField });
export type UpdatePriceListDto = z.infer<typeof UpdatePriceListSchema>;

export const PriceListItemsSchema = z.object({
  items: z.array(z.object({
    productId: id,
    price: money,
    discountRate: pct.nullable().optional(),
  })).max(2000),
  removeProductIds: z.array(id).max(2000).optional(),
});
export type PriceListItemsDto = z.infer<typeof PriceListItemsSchema>;

export const TierInputSchema = z.object({
  priceListId: id.optional(),
  itemId: id.optional(),
  productId: id.optional(),
  tiers: z.array(z.object({
    minQty: z.coerce.number().positive('Miktar 0’dan büyük olmalı'),
    discountRate: pct.nullable().optional(),
    price: money.nullable().optional(),
  })).max(20),
});
export type TierInputDto = z.infer<typeof TierInputSchema>;

export const BulkPriceUpdateSchema = z.object({
  q: z.string().trim().max(120).optional(),
  brandId: id.optional(),
  categoryId: id.optional(),
  supplierId: id.optional(),
  /** Signed: +10 raises by 10%, -5 lowers by 5%. */
  percent: z.coerce.number().min(-90).max(500),
  target: z.enum(['sales', 'purchase']).default('sales'),
  roundTo: z.enum(['none', '0.01', '0.05', '0.10', '1']).default('0.01'),
  dryRun: z.coerce.boolean().optional(),
});
export type BulkPriceUpdateDto = z.infer<typeof BulkPriceUpdateSchema>;
