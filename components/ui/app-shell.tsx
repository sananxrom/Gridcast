'use client';
import React, { useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Search, LogOut, User } from 'lucide-react';
import { SidebarNav, type NavGroupData, type NavItemData, type OrgOption } from './sidebar-nav';
import { CommandPalette, type CmdItem } from './command-palette';
import { cn } from '@/lib/utils';
import { TopProgress } from './loader';

export type Crumb = string | { label: string; go?: string };

export function AppShell({
  groups, bottom, activeId, onSelect, orgs, currentOrg, onOrgSelect,
  breadcrumb, cmdItems, onGo, user, children,
}: {
  groups: NavGroupData[]; bottom: NavItemData[]; activeId: string; onSelect: (id: string) => void;
  orgs: OrgOption[]; currentOrg: OrgOption; onOrgSelect: (id: string) => void;
  breadcrumb: Crumb[]; cmdItems: CmdItem[]; onGo: (go: string) => void;
  user: { name: string; role: string }; children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem('gc_rail') === '1'); } catch {}
  }, []);
  const toggle = () => setCollapsed(c => { try { localStorage.setItem('gc_rail', c ? '0' : '1'); } catch {} return !c; });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen(true); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const handleSelect = (id: string) => {
    if (id === 'search') return setCmdOpen(true);
    if (id === 'logout') { try { localStorage.removeItem('gc_user'); } catch {}; location.href = '/'; return; }
    onSelect(id);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <TopProgress />
      <div className={cn('h-full shrink-0 transition-[width] duration-300 ease-in-out', collapsed ? 'w-[64px]' : 'w-[260px]')}>
        <SidebarNav groups={groups} bottom={bottom} activeId={activeId} onSelect={handleSelect}
          orgs={orgs} currentOrg={currentOrg} onOrgSelect={onOrgSelect} collapsed={collapsed} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 bg-card px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={toggle} aria-label="Toggle sidebar"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5">
              {collapsed ? <PanelLeftOpen className="size-[18px]" strokeWidth={1.5} /> : <PanelLeftClose className="size-[18px]" strokeWidth={1.5} />}
            </button>
            <nav className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
              {breadcrumb.map((b, i) => {
                const c = typeof b === 'string' ? { label: b } : b;
                const last = i === breadcrumb.length - 1;
                return (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="text-muted-foreground/40">/</span>}
                    {c.go && !last
                      ? <button onClick={() => onGo(c.go!)} className="max-w-[220px] truncate rounded transition-colors hover:text-foreground hover:underline">{c.label}</button>
                      : <span className={cn('max-w-[280px] truncate', last && 'font-medium text-foreground')}>{c.label}</span>}
                  </React.Fragment>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setCmdOpen(true)}
              className="hidden h-8 w-56 items-center gap-2 rounded-md border border-border/60 bg-black/[0.03] px-2.5 text-[12.5px] text-muted-foreground/70 transition-colors hover:bg-black/5 md:flex dark:bg-white/[0.03] dark:hover:bg-white/5">
              <Search className="size-3.5" strokeWidth={1.5} />
              <span className="flex-1 text-left">Search…</span>
              <kbd className="rounded border border-border/60 px-1 font-mono text-[10px]">⌘K</kbd>
            </button>
            <div className="relative">
              <button onClick={() => setMenuOpen(!menuOpen)}
                className="grid size-8 place-items-center rounded-full border border-primary/25 bg-primary/10 text-[11px] font-semibold text-primary">
                {user.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-10 z-50 w-56 rounded-lg border border-border/60 bg-card py-1 shadow-xl">
                    <div className="border-b border-border/60 px-3 py-2">
                      <div className="text-[13px] font-medium">{user.name}</div>
                      <div className="text-[11.5px] capitalize text-muted-foreground">{user.role.replace(/_/g, ' ')}</div>
                    </div>
                    <button onClick={() => { setMenuOpen(false); handleSelect('profile'); }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-foreground/80 transition-colors hover:bg-black/5 dark:hover:bg-white/5">
                      <User className="size-4 text-muted-foreground/70" strokeWidth={1.5} /> Profile & account
                    </button>
                    <button onClick={() => handleSelect('logout')}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-foreground/80 transition-colors hover:bg-black/5 dark:hover:bg-white/5">
                      <LogOut className="size-4 text-muted-foreground/70" strokeWidth={1.5} /> Log out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="no-sb flex-1 overflow-y-auto bg-black/[0.015] p-6 md:p-8 dark:bg-white/[0.015]">
          {children}
        </main>
      </div>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} items={cmdItems} onGo={onGo} />
    </div>
  );
}

export function PageHead({ title, sub, back, actions }: {
  title: string; sub?: React.ReactNode; back?: { label: string; go: string; onGo: (g: string) => void }; actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {back && (
          <button onClick={() => back.onGo(back.go)} className="mb-1 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground">
            ← {back.label}
          </button>
        )}
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-[13px] text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionHead({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <h2 className="mb-3 mt-8 text-[15px] font-semibold tracking-tight">
      {children}
      {hint && <span className="ml-2 text-[13px] font-normal text-muted-foreground">{hint}</span>}
    </h2>
  );
}
