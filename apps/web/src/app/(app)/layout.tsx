'use client';

import { AuthGuard } from '@/components/auth-guard';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <ShellWithUser>{children}</ShellWithUser>
    </AuthGuard>
  );
}

function ShellWithUser({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  return <AppShell session={user}>{children}</AppShell>;
}
