import { z } from 'zod';
import { versionField } from '../../../common/crud/crud-query.dto.js';

const code = z
  .string({ error: 'Depo kodu gerekli' })
  .trim()
  .min(1, 'Depo kodu gerekli')
  .max(16, 'En fazla 16 karakter')
  .transform((v) => v.toLocaleUpperCase('tr-TR'));
const name = z
  .string({ error: 'Depo adı gerekli' })
  .trim()
  .min(1, 'Depo adı gerekli')
  .max(80, 'En fazla 80 karakter');

export const CreateWarehouseSchema = z.object({
  code,
  name,
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type CreateWarehouseDto = z.infer<typeof CreateWarehouseSchema>;

export const UpdateWarehouseSchema = z.object({
  code: code.optional(),
  name: name.optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  version: versionField,
});
export type UpdateWarehouseDto = z.infer<typeof UpdateWarehouseSchema>;
