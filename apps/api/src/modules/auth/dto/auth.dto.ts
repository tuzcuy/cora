import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email('Geçerli bir e-posta girin'),
  password: z.string().min(1, 'Şifre gerekli'),
});
export type LoginDto = z.infer<typeof LoginSchema>;
