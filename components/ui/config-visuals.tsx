'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------ screen ----- */

/** Size, resolution and orientation, drawn rather than described. */
export function ScreenPreview({ sizeIn, res, orientation }: {
  sizeIn: number; res: { w: number; h: number }; orientation: string;
}) {
  const portrait = orientation === 'portrait';
  const w = portrait ? res.h : res.w, h = portrait ? res.w : res.h;
  const ratio = w && h ? w / h : 16 / 9;
  const boxW = Math.min(230, 130 * Math.max(1, ratio));
  const boxH = boxW / ratio;

  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = res.w && res.h ? gcd(res.w, res.h) : 1;
  const aspect = res.w && res.h ? `${res.w / g}:${res.h / g}` : '—';

  // diagonal pixels over diagonal inches — flags a panel claiming a resolution it cannot have
  const ppi = sizeIn > 0 && res.w && res.h ? Math.round(Math.hypot(res.w, res.h) / sizeIn) : 0;
  const note = !ppi ? null
    : ppi < 25 ? { tone: 'warn', text: `${ppi} ppi — unusually low for a ${sizeIn}″ panel. Check the resolution.` }
    : ppi > 160 ? { tone: 'warn', text: `${ppi} ppi — unusually high for a ${sizeIn}″ panel.` }
    : { tone: 'ok', text: `${ppi} ppi — size and resolution agree` };

  return (
    <div className="flex flex-wrap items-center gap-6 border-b border-border/60 bg-muted/30 px-4 py-4">
      <div className="grid h-[150px] w-[250px] shrink-0 place-items-center">
        <div className="relative rounded-[3px] border-2 border-foreground/70 bg-background transition-all duration-300"
          style={{ width: boxW, height: boxH }}>
          <div className="absolute inset-0 grid place-items-center font-mono text-[11px] text-muted-foreground">{aspect}</div>
          <div className="absolute -bottom-1 left-1/2 h-1 w-8 -translate-x-1/2 translate-y-full rounded-b bg-foreground/40" />
        </div>
      </div>
      <div className="min-w-[180px] space-y-1 text-[12.5px]">
        <div><span className="font-mono text-[15px] font-semibold">{sizeIn}″</span>
          <span className="ml-2 font-mono text-muted-foreground">{res.w}×{res.h}</span></div>
        <div className="text-muted-foreground">{portrait ? 'Portrait' : orientation === 'auto' ? 'Auto (sensor)' : 'Landscape'} · {aspect}</div>
        {note && <div className={cn('text-[12px]', note.tone === 'warn' ? 'text-warn' : 'text-muted-foreground')}>
          {note.tone === 'warn' ? '⚠ ' : '✓ '}{note.text}</div>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- day ----- */

const toMin = (t?: string) => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const pct = (m: number) => (m / 1440) * 100;

/** Trading hours, sync window and restart on one day, so a clash is visible. */
export function DayBar({ trading, syncWindow, restartAt }: {
  trading?: { from: string; to: string };
  syncWindow?: { from: string; to: string };
  restartAt?: string;
}) {
  const band = (r?: { from: string; to: string }) => {
    if (!r || !r.from || !r.to) return null;
    const a = toMin(r.from), b = toMin(r.to);
    if (a === b) return null;                                   // 00:00..00:00 means "any time"
    return b > a ? [{ l: pct(a), w: pct(b - a) }] : [{ l: pct(a), w: pct(1440 - a) }, { l: 0, w: pct(b) }];
  };
  const tr = band(trading), sw = band(syncWindow);
  const rm = restartAt ? toMin(restartAt) : null;
  const inTrading = rm != null && tr?.some(s => pct(rm) >= s.l && pct(rm) <= s.l + s.w);

  const Row = ({ label, bands, cls }: { label: string; bands: any[] | null; cls: string }) => (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-right text-[11px] text-muted-foreground">{label}</span>
      <div className="relative h-3 flex-1 overflow-hidden rounded bg-muted">
        {(bands ?? [{ l: 0, w: 100 }]).map((s, i) => (
          <div key={i} className={cn('absolute inset-y-0 rounded-sm', cls)} style={{ left: `${s.l}%`, width: `${s.w}%` }} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-2 border-b border-border/60 bg-muted/30 px-4 py-4">
      <Row label="Trading" bands={tr} cls="bg-primary/70" />
      <Row label="Sync window" bands={sw} cls="bg-primary/25" />
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-right text-[11px] text-muted-foreground">Restart</span>
        <div className="relative h-3 flex-1">
          {rm != null && (
            <div className="absolute -top-0.5 h-4 w-0.5 rounded bg-warn" style={{ left: `${pct(rm)}%` }}>
              <span className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] text-warn">{restartAt}</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0" />
        <div className="flex flex-1 justify-between font-mono text-[10px] text-muted-foreground/60">
          {['00', '06', '12', '18', '24'].map(h => <span key={h}>{h}</span>)}
        </div>
      </div>
      {rm != null && (
        <p className={cn('pl-[108px] text-[12px]', inTrading ? 'text-warn' : 'text-muted-foreground')}>
          {inTrading ? '⚠ The restart falls inside trading hours — the screen goes dark while the venue is open.'
            : '✓ The restart falls outside trading hours.'}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- loop ----- */

/** How full the loop is, and how often one advertiser comes back around. */
export function LoopBar({ loopS, slotS, slotsSold, slotsTotal, hours }: {
  loopS: number; slotS: number; slotsSold: number; slotsTotal: number; hours: number;
}) {
  const positions = slotS > 0 ? Math.floor(loopS / slotS) : 0;
  const recurrence = slotsSold > 0 ? Math.round(loopS) : 0;
  const playsPerDay = positions > 0 && loopS > 0 ? Math.round((hours * 3600) / loopS) * 1 : 0;
  const fill = slotsTotal > 0 ? Math.min(100, (slotsSold / slotsTotal) * 100) : 0;

  return (
    <div className="space-y-2 border-b border-border/60 bg-muted/30 px-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[12px] text-muted-foreground">
        <span>loop <b className="text-foreground">{loopS}s</b></span>
        <span>slot <b className="text-foreground">{slotS}s</b></span>
        <span><b className="text-foreground">{positions}</b> positions</span>
        <span><b className="text-foreground">{slotsSold}</b> of {slotsTotal} advertiser slots sold</span>
      </div>
      <div className="flex h-4 gap-[2px] overflow-hidden rounded">
        {Array.from({ length: Math.min(positions || 1, 60) }, (_, i) => (
          <div key={i} className={cn('flex-1 rounded-[2px]',
            i < Math.round((Math.min(positions, 60) * fill) / 100) ? 'bg-primary' : 'bg-muted-foreground/15')} />
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">
        Each advertiser plays once every <b className="text-foreground">{recurrence}s</b>
        {playsPerDay > 0 && <> · about <b className="text-foreground">{playsPerDay}</b> plays each per day over {hours}h</>}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- zone ----- */

/**
 * Drag a rectangle over the camera's view to say what counts as in front of
 * the screen. The gap between this and the whole frame is the adjustment factor.
 */
export function ZoneEditor({ value, frameUrl, onChange, disabled }: {
  value: { x: number; y: number; w: number; h: number };
  frameUrl?: string | null;
  onChange?: (v: { x: number; y: number; w: number; h: number }) => void;
  disabled?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState<{ x: number; y: number } | null>(null);
  const [live, setLive] = React.useState<typeof value | null>(null);
  const v = live ?? value ?? { x: 0, y: 0, w: 100, h: 100 };

  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
             y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)) };
  };
  const down = (e: React.PointerEvent) => { if (disabled) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag(at(e)); };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = at(e);
    setLive({ x: Math.round(Math.min(drag.x, p.x)), y: Math.round(Math.min(drag.y, p.y)),
      w: Math.round(Math.abs(p.x - drag.x)), h: Math.round(Math.abs(p.y - drag.y)) });
  };
  const up = () => { if (live && live.w > 4 && live.h > 4) onChange?.(live); setDrag(null); setLive(null); };

  const coverage = Math.round((v.w * v.h) / 100);

  return (
    <div className="space-y-3 border-b border-border/60 bg-muted/30 px-4 py-4">
      <div ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up}
        className={cn('relative aspect-video w-full max-w-[440px] select-none overflow-hidden rounded-lg border border-border bg-foreground/[0.06]',
          disabled ? 'cursor-not-allowed' : 'cursor-crosshair')}>
        {frameUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={frameUrl} alt="" className="pointer-events-none h-full w-full object-cover" />
          : (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="text-center text-[12px] text-muted-foreground">
                <div className="font-medium">No frame yet</div>
                <div className="mt-0.5">Pair a player and turn on setup preview to aim the camera</div>
              </div>
            </div>
          )}
        <div className="pointer-events-none absolute inset-0 bg-foreground/25" />
        <div className="pointer-events-none absolute rounded-sm border-2 border-primary bg-primary/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
          style={{ left: `${v.x}%`, top: `${v.y}%`, width: `${v.w}%`, height: `${v.h}%` }}>
          <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
            counted
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
        <span className="font-mono text-muted-foreground">{v.x},{v.y} · {v.w}×{v.h}%</span>
        <span className="text-muted-foreground">covers <b className="text-foreground">{coverage}%</b> of the frame</span>
        {!disabled && (
          <div className="flex gap-1.5">
            {([['Whole frame', { x: 0, y: 0, w: 100, h: 100 }],
               ['Centre 60%', { x: 20, y: 20, w: 60, h: 60 }],
               ['Lower half', { x: 0, y: 50, w: 100, h: 50 }]] as const).map(([label, r]) => (
              <button key={label} onClick={() => onChange?.(r as any)}
                className="rounded border border-border bg-card px-2 py-1 text-[11.5px] transition-colors hover:bg-muted">{label}</button>
            ))}
          </div>
        )}
      </div>
      <p className="max-w-2xl text-[12px] text-muted-foreground">
        People detected outside this rectangle are not counted. Drag it to cover the area where someone could
        actually read the screen — the difference between this and the whole frame is what keeps a presence
        figure honest.
      </p>
    </div>
  );
}
