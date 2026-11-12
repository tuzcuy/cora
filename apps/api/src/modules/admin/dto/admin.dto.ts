import { z } from 'zod';

const id = z.string().trim().min(1);
const isoDate = z.coerce.date();

export const CreateUserSchema = z.object({
  email: z.string({ error: 'E-posta gerekli' }).trim().email('Geçerli bir e-posta girin'),
  fullName: z.string({ error: 'Ad soyad gerekli' }).trim().min(3, 'Ad soyad gerekli').max(120),
  phone: z.string().trim().max(40).nullable().optional(),
  repCode: z.string().trim().max(20).nullable().optional(),
  isActive: z.boolean().optional(),
  /** Omit to have one generated and shown once. */
  password: z.string().trim().min(8, 'Şifre en az 8 karakter').max(72).optional(),
  roleIds: z.array(id).max(10).optional(),
});
export type CreateUserDto = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = CreateUserSchema.omit({ password: true }).partial();
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;

export const ResetPasswordSchema = z.object({
  password: z.string().trim().min(8, 'Şifre en az 8 karakter').max(72).optional(),
});
export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;

export const RolePermissionsSchema = z.object({
  permissions: z.array(z.string().trim().min(1)).max(100),
});
export type RolePermissionsDto = z.infer<typeof RolePermissionsSchema>;

export const SettingsSchema = z.object({
  allowNegativeStock: z.boolean().optional(),
  minMarginPct: z.coerce.number().min(0).max(100).optional(),
  defaultVatRate: z.coerce.number().min(0).max(100).optional(),
  quoteValidityDays: z.coerce.number().int().min(1).max(365).optional(),
  autoSendToWarehouse: z.boolean().optional(),
  vatRates: z.array(z.coerce.number().min(0).max(100)).max(10).optional(),
  numberPrefixes: z.record(z.string(), z.string().trim().max(6)).optional(),
  company: z.object({
    name: z.string().trim().max(160).optional(),
    address: z.string().trim().max(300).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().max(120).optional(),
    web: z.string().trim().max(120).optional(),
    taxOffice: z.string().trim().max(80).optional(),
    taxNumber: z.string().trim().max(20).optional(),
    /** data: URL, capped so a huge logo cannot bloat every PDF. */
    logo: z.string().max(400_000).optional(),
  }).optional(),
  bank: z.object({
    name: z.string().trim().max(80).optional(),
    branch: z.string().trim().max(80).optional(),
    iban: z.string().trim().max(40).optional(),
    accountName: z.string().trim().max(160).optional(),
  }).optional(),
});
export type SettingsDto = z.infer<typeof SettingsSchema>;

export const ExchangeRateSchema = z.object({
  currency: z.enum(['USD', 'EUR']),
  rate: z.coerce.number().positive('Kur 0’dan büyük olmalı'),
  date: isoDate.optional(),
});
export type ExchangeRateDto = z.infer<typeof ExchangeRateSchema>;

export const AuditQuerySchema = z.object({
  entity: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(60).optional(),
  userId: id.optional(),
  action: z.string().trim().max(40).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
