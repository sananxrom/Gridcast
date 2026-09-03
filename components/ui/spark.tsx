'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A trend line for a short series. Empty slots (days with no data) break the
 * line rather than being drawn as zero — a screen that played nothing is not
 * a screen that measured nobody.
 */
export function Spark({ data, w = 62, h = 20, className }: {
  data: (number | null)[]; w?: number; h?: number; className?: string;
}) {
  const pts = data.map((v, i) => ({ v, i })).filter(p => p.v != null) as { v: number; i: number }[];
  if (pts.length < 2) return <span className={cn('text-[12px] text-muted-foreground', className)}>—</span>;

  const vals = pts.map(p => p.v);
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const x = (i: number) => (i / Math.max(1, data.length - 1)) * (w - 3) + 1.5;
  const y = (v: number) => h - 3 - ((v - min) / range) * (h - 6);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');

  const first = pts[0].v, last = pts[pts.length - 1].v;
  const dir = last > first ? 'up' : last < first ? 'down' : 'flat';
  const stroke = dir === 'up' ? 'hsl(var(--ok))' : dir === 'down' ? 'hsl(var(--warn))' : 'hsl(var(--muted-foreground))';

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden>
        <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={x(pts[pts.length - 1].i)} cy={y(last)} r="1.8" fill={stroke} />
      </svg>
      <span className="tnum font-mono text-[12.5px] font-medium">{last.toFixed(1)}</span>
      <span className="text-[11px]" style={{ color: stroke }}>{dir === 'up' ? '↗' : dir === 'down' ? '↘' : '→'}</span>
    </span>
  );
}
