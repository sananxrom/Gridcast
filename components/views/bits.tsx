'use client';
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn, ytThumb } from '@/lib/utils';

export function StatusBadge({ st }: { st?: { state: string; label: string } }) {
  const map: Record<string, any> = {
    live: ['onair', true], stalled: ['warn', false], offline: ['destructive', false], unpaired: ['muted', false],
  };
  const [variant, blip] = map[st?.state ?? 'unpaired'] ?? map.unpaired;
  return <Badge variant={variant} blip={blip}>{st?.label ?? 'not paired'}</Badge>;
}

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

export function Thumb({ id, w = 110, className }: { id?: string; w?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={ytThumb(id)} alt="" loading="lazy"
      onError={e => { const t = e.currentTarget; t.onerror = null; t.src = BLANK; t.style.borderStyle = 'dashed'; }}
      style={{ width: w }}
      className={cn('aspect-video shrink-0 rounded border border-border/70 bg-muted object-cover', className)} />
  );
}

export function Money({ children }: { children: React.ReactNode }) {
  return <span className="font-mono tnum">{children}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-border/60 bg-card py-12 text-center text-[13px] text-muted-foreground shadow-sm">{children}</div>;
}

export function SoonPage({ title, note }: { title: string; note: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
      <div className="mx-auto mb-3 inline-flex rounded-full bg-warn/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-warn">Not built yet</div>
      <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] text-muted-foreground">{note}</p>
    </div>
  );
}
