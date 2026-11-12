'use client';

import { usePathname } from 'next/navigation';
import { useState, type ComponentType } from 'react';
import * as Lucide from 'lucide-react';
import { visibleNav } from '@/lib/nav';
import type { SessionUser } from '@/lib/types';
import { useAuth } from './auth-provider';
import { cn } from '@/lib/utils';
import { NotificationBell } from '@/components/ops/notification-bell';
import { CommandPalette } from '@/components/command-palette';

function Icon({ name, className }: { name: string; className?: string }) {
  const registry = Lucide as unknown as Record<string, ComponentType<{ className?: string }>>;
  const Cmp = registry[name] ?? Lucide.Circle;
  return <Cmp className={className} />;
}

export function AppShell({
  session,
  children,
}: {
  session: SessionUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { logout: doLogout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const nav = visibleNav(session.modules, session.permissions);
  const initials = session.fullName
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  async function logout() {
    await doLogout();
    window.location.replace('/login/');
  }

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <SidebarContent nav={nav} pathname={pathname} tenantName={session.tenantName} />
      </aside>

      {/* Mobile drawer: the sidebar is hidden under md, so navigation lives here */}
      {navOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          role="dialog"
          aria-label="Menü"
          data-testid="mobile-nav"
        >
          <button
            type="button"
            aria-label="Menüyü kapat"
            className="absolute inset-0 bg-black/50"
            onClick={() => setNavOpen(false)}
          />
          <div className="relative flex h-full w-64 max-w-[80vw] flex-col bg-sidebar text-sidebar-foreground shadow-xl">
            <SidebarContent
              nav={nav}
              pathname={pathname}
              tenantName={session.tenantName}
              onNavigate={() => setNavOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b bg-card px-3 sm:gap-4 sm:px-4">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Menüyü aç"
            data-testid="open-nav"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md hover:bg-muted md:hidden"
          >
            <Lucide.Menu className="h-5 w-5" />
          </button>
          <CommandPalette />
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
          </div>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
            >
              <div className="grid h-8 w-8 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {initials}
              </div>
              <div className="hidden text-left sm:block">
                <div className="text-sm font-medium leading-tight">{session.fullName}</div>
                <div className="text-xs leading-tight text-muted-foreground">{session.email}</div>
              </div>
              <Lucide.ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 z-10 mt-1 w-52 rounded-md border bg-card p-1 shadow-md">
                <div className="px-3 py-2 text-xs text-muted-foreground">{session.tenantName}</div>
                <button
                  onClick={logout}
                  className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-muted"
                >
                  <Lucide.LogOut className="h-4 w-4" /> Çıkış yap
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

/** Sidebar body, shared by the desktop rail and the mobile drawer. */
function SidebarContent({
  nav,
  pathname,
  tenantName,
  onNavigate,
}: {
  nav: { href: string; label: string; icon: string }[];
  pathname: string;
  tenantName: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-accent font-bold text-accent-foreground">
          C
        </div>
        <span className="font-semibold text-white">Cora</span>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {nav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            // Hard navigation (<a>) — Next client router unreliable on static host.
            <a
              key={item.href}
              href={`${item.href}/`}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-white/10 text-white'
                  : 'text-sidebar-foreground hover:bg-white/5 hover:text-white',
              )}
            >
              <Icon name={item.icon} className="h-4 w-4" />
              {item.label}
            </a>
          );
        })}
      </nav>
      <div className="truncate px-4 py-3 text-xs text-sidebar-foreground/60">{tenantName}</div>
    </>
  );
}
