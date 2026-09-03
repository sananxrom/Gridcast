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

const VENUE_GLYPH: Record<string, string> = {
  cafe: 'M4 8h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Zm12 1h1.5a2.5 2.5 0 0 1 0 5H16',
};

export function ScreenPhoto({
  src, venue, className, children,
}: { src?: string; venue?: string; className?: string; children?: React.ReactNode }) {
  const [bad, setBad] = React.useState(false);
  return (
    <div className={cn('relative overflow-hidden rounded-lg border border-border/70 bg-muted', className)}>
      {src && !bad ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" onError={() => setBad(true)}
          className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center bg-[linear-gradient(135deg,hsl(var(--muted))_0%,hsl(var(--background))_100%)]">
          <div className="text-center">
            <svg viewBox="0 0 24 24" className="mx-auto h-6 w-6 text-muted-foreground/40" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" />
            </svg>
            <div className="mt-1 text-[10.5px] uppercase tracking-wider text-muted-foreground/60">{venue || 'no photo'}</div>
          </div>
        </div>
      )}
      {children}
    </div>
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
