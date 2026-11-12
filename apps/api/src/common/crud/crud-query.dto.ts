import { z } from 'zod';

const boolish = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

/** Common list query for card entities: search, "silinenleri göster", paging. */
export const CrudListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  includeDeleted: boolish,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});
export type CrudListQuery = z.infer<typeof CrudListQuerySchema>;

/** DELETE ?version=N — optional optimistic-lock token. */
export const CrudDeleteQuerySchema = z.object({
  version: z.coerce.number().int().min(1).optional(),
});
export type CrudDeleteQuery = z.infer<typeof CrudDeleteQuerySchema>;

/** Every update carries the version the client loaded (INVARIANTS.md rule 7). */
export const versionField = z.coerce.number({ error: 'version gerekli' }).int().min(1);
