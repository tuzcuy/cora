import { z } from 'zod';

export const PartnerSortSchema = z.enum(['name', 'code', 'balance_desc', 'newest']);

export const PartnerListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  groupId: z.string().trim().min(1).optional(),
  type: z.enum(['CUSTOMER', 'SUPPLIER', 'BOTH']).optional(),
  sort: PartnerSortSchema.default('name'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type PartnerListQuery = z.infer<typeof PartnerListQuerySchema>;

export const MIN_SEARCH_LENGTH = 2;
