'use client';
import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { BrandLogo } from './brand-mark';
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
      <div className="relative hidden h-full flex-col overflow-hidden border-r border-border bg-muted/60 p-10 lg:flex">
        <div className="absolute inset-0 z-10 bg-gradient-to-t from-background to-transparent" />
        <BrandLogo className="z-10" />
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
        {/* one painted layer instead of three oversized ones — the old stack
            cost more compositor memory than the effect was worth */}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-70">
          <div className="absolute -right-40 -top-40 size-[46rem] rounded-full bg-[radial-gradient(closest-side,hsl(var(--foreground)/0.05),transparent)]" />
          <div className="absolute -bottom-56 -right-20 size-[34rem] rounded-full bg-[radial-gradient(closest-side,hsl(var(--primary)/0.05),transparent)]" />
        </div>
        <div className="relative z-10 mx-auto w-full space-y-4 sm:w-[24rem]">
          <BrandLogo className="lg:hidden" />
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
  // 14 per direction rather than 36: the effect reads the same and the
  // compositor is not asked to repaint 72 dashed strokes every frame
  const paths = Array.from({ length: 14 }, (_, k) => {
    const i = k * 2.4;
    return {
      id: k,
      d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${380 - i * 5 * position} -${189 + i * 6} -${
        312 - i * 5 * position} ${216 - i * 6} ${152 - i * 5 * position} ${343 - i * 6}C${
        616 - i * 5 * position} ${470 - i * 6} ${684 - i * 5 * position} ${875 - i * 6} ${
        684 - i * 5 * position} ${875 - i * 6}`,
      width: 0.6 + k * 0.07,
      opacity: 0.1 + k * 0.035,
      duration: 26 + (k % 5) * 3,
    };
  });

  return (
    <div className="pointer-events-none absolute inset-0 [transform:translateZ(0)] [will-change:transform]">
      <svg className="h-full w-full text-primary" viewBox="0 0 696 316" fill="none" aria-hidden>
        {paths.map(path => (
          <motion.path
            key={path.id}
            d={path.d}
            stroke="currentColor"
            strokeWidth={path.width}
            strokeOpacity={path.opacity}
            // pathLength stays fixed; only the offset moves, so framer never
            // has to recompute stroke-dasharray mid-animation
            pathLength={0.35}
            initial={{ pathOffset: 0 }}
            animate={still ? undefined : { pathOffset: [0, 1] }}
            transition={{ duration: path.duration, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
          />
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
