'use client';
import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The split sign-in layout: a brand column that carries the animated paths and
 * a statement, and a form column that stands alone on small screens.
 */
export function AuthLayout({ children, quote, by }: {
  children: React.ReactNode;
  quote: string;
  by: string;
}) {
  return (
    <main className="relative md:h-screen md:overflow-hidden lg:grid lg:grid-cols-2">
      {/* brand column */}
      <div className="relative hidden h-full flex-col border-r border-border bg-muted/60 p-10 lg:flex">
        <div className="absolute inset-0 z-10 bg-gradient-to-t from-background to-transparent" />
        <div className="z-10 flex items-center gap-2.5">
          <div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <Monitor className="size-4" strokeWidth={2} />
          </div>
          <p className="text-xl font-semibold tracking-tight">Gridcast</p>
        </div>
        <div className="z-10 mt-auto">
          <blockquote className="space-y-2">
            <p className="max-w-md text-xl leading-snug">&ldquo;{quote}&rdquo;</p>
            <footer className="font-mono text-sm font-semibold text-muted-foreground">~ {by}</footer>
          </blockquote>
        </div>
        <div className="absolute inset-0">
          <FloatingPaths position={1} />
          <FloatingPaths position={-1} />
        </div>
      </div>

      {/* form column */}
      <div className="relative flex min-h-screen flex-col justify-center p-4">
        <div aria-hidden className="absolute inset-0 -z-10 isolate opacity-60 [contain:strict]">
          <div className="absolute right-0 top-0 h-[80rem] w-[35rem] -translate-y-[21.875rem] rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,hsl(var(--foreground)/0.06)_0,hsl(0_0%_55%_/_0.02)_50%,hsl(var(--foreground)/0.01)_80%)]" />
          <div className="absolute right-0 top-0 h-[80rem] w-[15rem] translate-x-[5%] -translate-y-1/2 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,hsl(var(--foreground)/0.04)_0,hsl(var(--foreground)/0.01)_80%,transparent_100%)]" />
          <div className="absolute right-0 top-0 h-[80rem] w-[15rem] -translate-y-[21.875rem] rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,hsl(var(--foreground)/0.04)_0,hsl(var(--foreground)/0.01)_80%,transparent_100%)]" />
        </div>
        <div className="mx-auto w-full space-y-4 sm:w-[24rem]">
          <div className="flex items-center gap-2.5 lg:hidden">
            <div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <Monitor className="size-4" strokeWidth={2} />
            </div>
            <p className="text-xl font-semibold tracking-tight">Gridcast</p>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}

export function AuthSeparator({ label = 'OR' }: { label?: string }) {
  return (
    <div className="flex w-full items-center justify-center">
      <div className="h-px w-full bg-border" />
      <span className="px-2 text-xs text-muted-foreground">{label}</span>
      <div className="h-px w-full bg-border" />
    </div>
  );
}

function FloatingPaths({ position }: { position: number }) {
  const still = useReducedMotion();
  const paths = Array.from({ length: 36 }, (_, i) => ({
    id: i,
    d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${380 - i * 5 * position} -${189 + i * 6} -${
      312 - i * 5 * position} ${216 - i * 6} ${152 - i * 5 * position} ${343 - i * 6}C${
      616 - i * 5 * position} ${470 - i * 6} ${684 - i * 5 * position} ${875 - i * 6} ${
      684 - i * 5 * position} ${875 - i * 6}`,
    width: 0.5 + i * 0.03,
  }));
  return (
    <div className="pointer-events-none absolute inset-0">
      <svg className="h-full w-full text-primary" viewBox="0 0 696 316" fill="none">
        <title>Background paths</title>
        {paths.map(path => (
          <motion.path key={path.id} d={path.d} stroke="currentColor"
            strokeWidth={path.width} strokeOpacity={0.08 + path.id * 0.02}
            initial={{ pathLength: 0.3, opacity: 0.6 }}
            animate={still ? undefined : { pathLength: 1, opacity: [0.3, 0.6, 0.3], pathOffset: [0, 1, 0] }}
            transition={{ duration: 20 + (path.id % 7) * 1.4, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }} />
        ))}
      </svg>
    </div>
  );
}

export function AuthTabs({ value, onChange, options }: {
  value: string; onChange: (v: any) => void; options: { value: string; label: string }[];
}) {
  return (
    <div className={cn('grid gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5',
      options.length === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cn('rounded-md py-2 text-[13px] font-medium transition-colors',
            value === o.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
