import { z } from 'zod';
import { versionField } from '../../../common/crud/crud-query.dto.js';

const code = z
  .string({ error: 'Birim kodu gerekli' })
  .trim()
  .min(1, 'Birim kodu gerekli')
  .max(16, 'En fazla 16 karakter')
  .transform((v) => v.toLocaleUpperCase('tr-TR'));
const name = z
  .string({ error: 'Birim adı gerekli' })
  .trim()
  .min(1, 'Birim adı gerekli')
  .max(60, 'En fazla 60 karakter');
const decimals = z.coerce.number().int().min(0, 'En az 0').max(6, 'En fazla 6');

export const CreateUnitSchema = z.object({ code, name, decimals: decimals.default(0) });
export type CreateUnitDto = z.infer<typeof CreateUnitSchema>;

export const UpdateUnitSchema = z.object({
  code: code.optional(),
  name: name.optional(),
  decimals: decimals.optional(),
  version: versionField,
});
export type UpdateUnitDto = z.infer<typeof UpdateUnitSchema>;
