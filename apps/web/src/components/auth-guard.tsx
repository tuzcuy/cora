'use client';

import { useEffect } from 'react';
import { useAuth } from './auth-provider';

/**
 * Client-side route protection (UX only; real authz is enforced by the API).
 * Uses a hard navigation (window.location) because Next's app-router client
 * navigation does not complete reliably on a plain static host (RSC .txt fetch).
 * Each page load re-establishes the session via the refresh cookie (silent refresh).
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();

  useEffect(() => {
    if (status === 'anon') window.location.replace('/login/');
  }, [status]);

  if (status !== 'authed') {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }
  return <>{children}</>;
}
