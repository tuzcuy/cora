import { z } from 'zod';
import { versionField } from '../../../common/crud/crud-query.dto.js';

const code = z
  .string({ error: 'Grup kodu gerekli' })
  .trim()
  .min(1, 'Grup kodu gerekli')
  .max(24, 'En fazla 24 karakter');
const name = z
  .string({ error: 'Grup adı gerekli' })
  .trim()
  .min(1, 'Grup adı gerekli')
  .max(80, 'En fazla 80 karakter');

export const CreatePartnerGroupSchema = z.object({ code, name });
export type CreatePartnerGroupDto = z.infer<typeof CreatePartnerGroupSchema>;

export const UpdatePartnerGroupSchema = z.object({
  code: code.optional(),
  name: name.optional(),
  version: versionField,
});
export type UpdatePartnerGroupDto = z.infer<typeof UpdatePartnerGroupSchema>;
