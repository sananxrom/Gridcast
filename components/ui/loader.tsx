'use client';
import React, { useEffect, useRef, useState } from 'react';
import { onLoading } from '@/lib/client';
import { cn } from '@/lib/utils';

/** Thin indeterminate progress bar pinned to the top of the viewport. */
export function TopProgress() {
  const [pct, setPct] = useState(0);
  const [on, setOn] = useState(false);
  const timer = useRef<any>(null);

  useEffect(() => onLoading(n => {
    if (n > 0) {
      setOn(true);
      setPct(p => (p === 0 ? 12 : p));
      if (!timer.current) {
        timer.current = setInterval(() => setPct(p => (p >= 92 ? p : p + Math.max(0.6, (92 - p) * 0.09))), 180);
      }
    } else {
      clearInterval(timer.current); timer.current = null;
      setPct(100);
      setTimeout(() => setOn(false), 260);
      setTimeout(() => setPct(0), 520);
    }
  }), []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5">
      <div
        className={cn('h-full bg-primary transition-[width,opacity] duration-200 ease-out', on ? 'opacity-100' : 'opacity-0')}
        style={{ width: `${pct}%`, boxShadow: '0 0 8px hsl(var(--primary) / 0.6)' }} />
    </div>
  );
}

/** Full-page splash used before the first payload lands. */
export function BootLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="grid h-screen place-items-center bg-background">
      <div className="w-[220px] text-center">
        <div className="mb-4 text-[13px] font-semibold tracking-tight">Gridcast</div>
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 rounded-full bg-primary animate-slide" />
        </div>
        <div className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground/70">{label}</div>
      </div>
    </div>
  );
}

/** Placeholder block for content still in flight. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}
