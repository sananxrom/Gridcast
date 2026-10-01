'use client';
import React, { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { type CampaignStatus, LIVE_EVIDENCE_WINDOW_MS } from '@/lib/campaign-status';

const istTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' IST';
const SOURCE: Record<string, string> = { receipts: 'recent receipts on this page', report_summary: 'delivery report summary (yesterday and today)', none: 'not loaded' };

/** One campaign state with its reason; the popover shows the evidence behind it. */
export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const e = status.evidence;
  const windowMin = Math.round(e.window_ms / 60000);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Campaign status: ${status.label}`} className="inline-flex max-w-full items-center gap-1 rounded-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <Badge variant={status.tone} blip={status.state === 'live'}>{status.label}</Badge>
          {status.warnings.length > 0 && <Badge variant="warn" title={status.warnings.map(w => w.text).join('\n')}>{status.warnings.length === 1 ? '1 warning' : `${status.warnings.length} warnings`}</Badge>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 text-[12.5px]">
        <div className="font-medium">{status.label}</div>
        {status.reason && <p className="mt-1 text-muted-foreground">{status.reason}</p>}
        {status.warnings.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-4 text-warn">{status.warnings.map(w => <li key={w.code}>{w.text}</li>)}</ul>}
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-muted-foreground">Last successful paid play</dt><dd>{e.last_success_at ? istTime(e.last_success_at) : 'none in loaded evidence'}</dd>
          <dt className="text-muted-foreground">Delivered in last {windowMin} min</dt><dd>{e.source === 'none' ? '—' : `${e.screens_delivered_recently} of ${e.screens_targeted} screens`}</dd>
          <dt className="text-muted-foreground">Online now</dt><dd>{e.screens_online === null ? 'not available' : `${e.screens_online} of ${e.screens_targeted} screens`}</dd>
          <dt className="text-muted-foreground">Evidence</dt><dd>{SOURCE[e.source]}</dd>
          {!e.budget_checked && <><dt className="text-muted-foreground">Budget</dt><dd>not checked (not visible to you)</dd></>}
        </dl>
        {e.ineligible_screens.length > 0 && <p className="mt-2 text-muted-foreground">{e.ineligible_screens.length} screen{e.ineligible_screens.length === 1 ? '' : 's'} not eligible: {[...new Set(e.ineligible_screens.map(s => s.text))].join('; ')}.</p>}
        <p className="mt-2 text-[11px] text-muted-foreground">Live means a rendered paid play in the last {windowMin} minutes on a screen whose player is online now. It is not proof of the current frame.</p>
      </PopoverContent>
    </Popover>
  );
}

/** Fresh `now` for status evaluation, re-read at least every 30 s so stale heartbeats and receipts age out. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

/** Calls `refresh` every `intervalMs` while enabled and the tab is visible (screen status is a load-time snapshot). */
export function usePeriodicRefresh(refresh: () => unknown, enabled: boolean, intervalMs = 60_000) {
  const ref = React.useRef(refresh);
  ref.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') Promise.resolve(ref.current()).catch(() => {}); }, intervalMs);
    return () => clearInterval(t);
  }, [enabled, intervalMs]);
}

const DAY = 86_400_000;
const istDate = (at: number) => new Date(at + 330 * 60_000).toISOString().slice(0, 10);
type CampaignScreens = Record<string, Record<string, string>>;

/** Reads /metrics for yesterday–today IST and merges `campaignScreens` across pages. Refreshes every 5 minutes. */
export function useCampaignEvidence(org?: string | null, enabled = true) {
  const [state, setState] = useState<{ loaded: boolean; error: string | null; campaignScreens: CampaignScreens }>({ loaded: false, error: null, campaignScreens: {} });
  const [tick, setTick] = useState(0);
  useEffect(() => { if (!enabled) return; const t = setInterval(() => setTick(n => n + 1), 5 * 60_000); return () => clearInterval(t); }, [enabled]);
  useEffect(() => {
    let cancelled = false;
    if (!enabled) { setState({ loaded: false, error: null, campaignScreens: {} }); return; }
    (async () => {
      const now = Date.now(), merged: CampaignScreens = {}, seen = new Set<string>();
      let after: string | null = null;
      do {
        const q = new URLSearchParams({ from: istDate(now - DAY), to: istDate(now) });
        if (org) q.set('org', org);
        if (after) q.set('after', after);
        const page: any = await api('/metrics?' + q, undefined, { quiet: true });
        if (cancelled) return;
        for (const [cid, screens] of Object.entries<Record<string, string>>(page.campaignScreens || {})) {
          const target = merged[cid] ||= {};
          for (const [sid, at] of Object.entries(screens)) if (!target[sid] || at > target[sid]) target[sid] = at;
        }
        after = page.has_more ? page.next_cursor : null;
        if (after && seen.has(after)) throw new Error('Delivery evidence could not finish loading.');
        if (after) seen.add(after);
      } while (after);
      if (!cancelled) setState({ loaded: true, error: null, campaignScreens: merged });
    })().catch(e => { if (!cancelled) setState({ loaded: false, error: e instanceof Error ? e.message : 'Could not load delivery evidence.', campaignScreens: {} }); });
    return () => { cancelled = true; };
  }, [org, enabled, tick]);
  return state;
}
export { LIVE_EVIDENCE_WINDOW_MS };
