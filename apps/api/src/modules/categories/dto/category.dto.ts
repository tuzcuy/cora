import { z } from 'zod';
import { versionField } from '../../../common/crud/crud-query.dto.js';

const name = z.string({ error: 'Kategori adı gerekli' }).trim().min(1, 'Kategori adı gerekli').max(120, 'En fazla 120 karakter');
// Forms post '' for "no parent"; normalise to null so the tree root is unambiguous.
const parentId = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));

export const CreateCategorySchema = z.object({ name, parentId });
export type CreateCategoryDto = z.infer<typeof CreateCategorySchema>;

export const UpdateCategorySchema = z.object({ name: name.optional(), parentId, version: versionField });
export type UpdateCategoryDto = z.infer<typeof UpdateCategorySchema>;
