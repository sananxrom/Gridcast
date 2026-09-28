'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Stored per browser. Absent means "follow the system", which is also what the pre-paint script in app/layout.tsx does. */
export const THEME_KEY = 'gc_theme';

function systemDark() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
}

function stored(): 'light' | 'dark' | null {
  try { const t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : null; } catch { return null; }
}

function apply(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
}

export function ThemeToggle({ className }: { className?: string }) {
  // null until mounted: the server cannot know the theme, so render a same-sized placeholder instead of a wrong icon.
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
    // Until the user chooses, keep following the system if it changes while the dashboard is open.
    let media: MediaQueryList | null = null;
    try { media = window.matchMedia('(prefers-color-scheme: dark)'); } catch {}
    const follow = (e: MediaQueryListEvent) => { if (!stored()) { apply(e.matches); setDark(e.matches); } };
    media?.addEventListener?.('change', follow);
    return () => media?.removeEventListener?.('change', follow);
  }, []);

  const flip = () => {
    const next = !(dark ?? systemDark());
    apply(next);
    setDark(next);
    try { localStorage.setItem(THEME_KEY, next ? 'dark' : 'light'); } catch {}
  };

  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button type="button" onClick={flip} aria-label={label} title={label}
      className={cn('grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5', className)}>
      {dark === null
        ? <span className="size-[18px]" />
        : dark
          ? <Sun className="size-[18px]" strokeWidth={1.5} />
          : <Moon className="size-[18px]" strokeWidth={1.5} />}
    </button>
  );
}
