import { z } from 'zod';

export const DocumentSortSchema = z.enum(['date_desc', 'date_asc', 'total_desc', 'number']);

const SALES_STATUSES = [
  'DRAFT',
  'SENT',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'SENT_TO_WAREHOUSE',
  'PICKING',
  'READY',
  'PARTIALLY_SHIPPED',
  'SHIPPED',
  'COMPLETED',
  'CANCELLED',
] as const;

export const DocumentListQuerySchema = z.object({
  type: z.enum(['QUOTE', 'ORDER', 'RETURN']).optional(),
  status: z.enum(SALES_STATUSES).optional(),
  q: z.string().trim().max(120).optional(),
  partnerId: z.string().trim().min(1).optional(),
  salesRepId: z.string().trim().min(1).optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sort: DocumentSortSchema.default('date_desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;
