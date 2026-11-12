import { z } from 'zod';

/**
 * Sort keys. None of these columns is indexed on Product (only tenantId+isActive,
 * tenantId+brandId, tenantId+categoryId, barcode and the searchText GIN are), so
 * ordering happens over the filtered set. Adding a new sort key that must scale
 * means adding an index in a migration first.
 */
export const ProductSortSchema = z.enum(['name', 'code', 'price_asc', 'price_desc', 'newest']);
export type ProductSort = z.infer<typeof ProductSortSchema>;

const boolish = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

export const ProductListQuerySchema = z.object({
  /** Free text. Folded with turkishFold and matched against Product.searchText. */
  q: z.string().trim().max(120).optional(),
  brandId: z.string().trim().min(1).optional(),
  categoryId: z.string().trim().min(1).optional(),
  /** Only products with stock on hand in at least one warehouse. */
  inStock: boolish,
  priceMin: z.coerce.number().nonnegative().optional(),
  priceMax: z.coerce.number().nonnegative().optional(),
  sort: ProductSortSchema.default('name'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ProductListQuery = z.infer<typeof ProductListQuerySchema>;

export const ProductIdParamSchema = z.object({
  id: z.string().trim().min(1, 'Ürün kimliği gerekli'),
});
export type ProductIdParam = z.infer<typeof ProductIdParamSchema>;

/** Shortest query that the pg_trgm GIN index can still serve well. */
export const MIN_SEARCH_LENGTH = 2;
