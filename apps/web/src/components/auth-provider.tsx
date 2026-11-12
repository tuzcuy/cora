'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiLogin, apiLogout, tryRefresh } from '@/lib/api-client';
import type { SessionUser } from '@/lib/types';

type Status = 'loading' | 'authed' | 'anon';

interface AuthContextValue {
  user: SessionUser | null;
  status: Status;
  login: (email: string, password: string, onWaking?: () => void) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  // On load / tab refresh: silent refresh restores the session (no access token in memory yet).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const restored = await tryRefresh();
        if (!active) return;
        if (restored) {
          setUser(restored);
          setStatus('authed');
        } else {
          setStatus('anon');
        }
      } catch {
        // Defensive: never leave the guard stuck on 'loading'.
        if (active) setStatus('anon');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string, onWaking?: () => void) => {
    const u = await apiLogin(email, password, onWaking);
    setUser(u);
    setStatus('authed');
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
    setStatus('anon');
  }, []);

  return (
    <AuthContext.Provider value={{ user, status, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth AuthProvider içinde kullanılmalı');
  return ctx;
}
