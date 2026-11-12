import { z } from 'zod';

const name = z
  .string({ error: 'Marka adı gerekli' })
  .trim()
  .min(1, 'Marka adı gerekli')
  .max(120, 'Marka adı en fazla 120 karakter olabilir');

export const CreateBrandSchema = z.object({ name });
export type CreateBrandDto = z.infer<typeof CreateBrandSchema>;

/** `version` is the optimistic-lock token the client loaded with the row. */
export const UpdateBrandSchema = z.object({
  name: name.optional(),
  version: z.coerce.number({ error: 'version gerekli' }).int().min(1),
});
export type UpdateBrandDto = z.infer<typeof UpdateBrandSchema>;

export const DeleteQuerySchema = z.object({
  version: z.coerce.number().int().min(1).optional(),
});
export type DeleteQuery = z.infer<typeof DeleteQuerySchema>;

export const ListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  includeDeleted: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;
