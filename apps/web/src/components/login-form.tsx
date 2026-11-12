'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface FormValues {
  email: string;
  password: string;
}

export function LoginForm() {
  const { login, status } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const [waking, setWaking] = useState(false);
  // Static export: guard against a native form submit before React hydrates —
  // that would GET-submit the password into the URL. The submit button (the only
  // submit trigger) stays disabled until mounted, so click/Enter can't fire early.
  const [hydrated, setHydrated] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { email: '', password: '' } });

  // Already authenticated (e.g. silent refresh succeeded) → go to the app.
  // Hard navigation (static host: Next client router unreliable).
  useEffect(() => {
    if (status === 'authed') window.location.replace('/dashboard/');
  }, [status]);

  useEffect(() => setHydrated(true), []);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setWaking(false);
    try {
      await login(values.email, values.password, () => setWaking(true));
      window.location.replace('/dashboard/');
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Giriş başarısız');
    } finally {
      setWaking(false);
    }
  });

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <div className="mb-2 flex items-center gap-2 lg:hidden">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary font-bold text-primary-foreground">
            C
          </div>
          <span className="text-lg font-semibold">Cora</span>
        </div>
        <CardTitle>Giriş yap</CardTitle>
        <CardDescription>Hesabınıza erişmek için bilgilerinizi girin.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email">E-posta</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="admin@demo.local"
              aria-invalid={!!errors.email}
              {...register('email', { required: 'E-posta gerekli' })}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Şifre</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              aria-invalid={!!errors.password}
              {...register('password', { required: 'Şifre gerekli' })}
            />
            {errors.password && (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            )}
          </div>

          {waking && !serverError && (
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
              Sistem başlatılıyor, birkaç saniye sürebilir…
            </div>
          )}

          {serverError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {serverError}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={!hydrated || isSubmitting}>
            {waking ? 'Sistem başlatılıyor…' : isSubmitting ? 'Giriş yapılıyor…' : 'Giriş yap'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
