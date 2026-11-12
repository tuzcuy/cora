import { z } from 'zod';
import { versionField } from '../../../common/crud/crud-query.dto.js';

const id = z.string().trim().min(1);
const money = z.coerce.number().finite();
const pct = z.coerce.number().min(0).max(100);
const isoDate = z.coerce.date();
const email = z
  .string()
  .trim()
  .email('Geçerli bir e-posta girin')
  .or(z.literal(''))
  .transform((v) => v || null);

export const ContactSchema = z.object({
  name: z.string({ error: 'Ad gerekli' }).trim().min(2, 'Ad gerekli').max(120),
  title: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: email.nullable().optional(),
  isPrimary: z.boolean().optional(),
});

export const AddressSchema = z.object({
  id: id.optional(),
  type: z.enum(['BILLING', 'SHIPPING']).optional(),
  title: z.string().trim().max(80).nullable().optional(),
  line1: z.string({ error: 'Adres gerekli' }).trim().min(3, 'Adres gerekli').max(300),
  line2: z.string().trim().max(300).nullable().optional(),
  district: z.string().trim().max(80).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  country: z.string().trim().max(60).optional(),
  isDefault: z.boolean().optional(),
});

export const CreatePartnerSchema = z.object({
  code: z.string({ error: 'Cari kodu gerekli' }).trim().min(2, 'Cari kodu gerekli').max(40),
  name: z.string({ error: 'Ünvan gerekli' }).trim().min(2, 'Ünvan gerekli').max(200),
  name2: z.string().trim().max(200).nullable().optional(),
  type: z.enum(['CUSTOMER', 'SUPPLIER', 'BOTH']).optional(),
  groupId: id.nullable().optional(),
  taxOffice: z.string().trim().max(80).nullable().optional(),
  taxNumber: z.string().trim().max(20).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: email.nullable().optional(),
  website: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  country: z.string().trim().max(60).optional(),
  currency: z.enum(['TRY', 'USD', 'EUR']).optional(),
  paymentTermDays: z.coerce.number().int().min(0).max(365).optional(),
  paymentTerms: z.string().trim().max(200).nullable().optional(),
  salesRepId: id.nullable().optional(),
  priceListId: id.nullable().optional(),
  defaultDiscountRate: pct.nullable().optional(),
  creditLimit: money.nonnegative().nullable().optional(),
  openingBalance: money.nullable().optional(),
  externalBalance: money.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  isActive: z.boolean().optional(),
  contacts: z.array(ContactSchema).max(50).optional(),
  addresses: z.array(AddressSchema).max(50).optional(),
});
export type CreatePartnerDto = z.infer<typeof CreatePartnerSchema>;

export const UpdatePartnerSchema = CreatePartnerSchema.partial().extend({ version: versionField });
export type UpdatePartnerDto = z.infer<typeof UpdatePartnerSchema>;

export const PartnerBalanceSchema = z.object({
  externalBalance: money,
  asOf: isoDate.optional(),
});
export type PartnerBalanceDto = z.infer<typeof PartnerBalanceSchema>;

export const StatementQuerySchema = z.object({
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});
export type StatementQuery = z.infer<typeof StatementQuerySchema>;
