import { reasonLabel } from './readiness';
import { campaignInterval } from './inventory';

/**
 * One honest campaign state with its reason, derived from evidence (doc 31 Phase 1).
 * Pure: no React, no fetches. Live needs BOTH a recent successful paid play (by play time)
 * AND current device evidence that the screen is online; anything less is Unknown.
 */
export const LIVE_EVIDENCE_WINDOW_MS = 30 * 60 * 1000;
/** A heartbeat younger than this means the player is online now. Matches `screenStatus` in lib/api.ts (age < 90 s). */
export const ONLINE_HEARTBEAT_MS = 90_000;
/** Heartbeats younger than this (but not online) are stalled; older are offline. Matches lib/api.ts (age < 900 s). */
export const STALLED_HEARTBEAT_MS = 900_000;
/** Evidence timestamped later than now + this tolerance is treated as clock error and ignored. */
export const CLOCK_TOLERANCE_MS = 120_000;

export type CampaignState = 'draft' | 'in_review' | 'changes_needed' | 'scheduled' | 'live' | 'not_delivering' | 'paused' | 'ended' | 'unknown';
export type StatusTone = 'muted' | 'default' | 'onair' | 'ok' | 'warn' | 'destructive' | 'outline';
export type StatusWarning = { code: string; text: string };
export type StatusEvidence = {
  screens_recent: number;
  screens_targeted: number;
  last_success_at: string | null;
  source: 'receipts' | 'report_summary' | 'none';
  /** Targeted screens with a successful paid play inside the window, regardless of device state. */
  screens_delivered_recently: number;
  /** Targeted screens whose device heartbeat says online now. null when device status is unavailable. */
  screens_online: number | null;
  window_ms: number;
  budget_checked: boolean;
  ineligible_screens: { screen_id: string; reason: string; text: string }[];
};
export type CampaignStatus = {
  state: CampaignState; label: string; tone: StatusTone;
  reason_code: string | null; reason: string | null;
  warnings: StatusWarning[]; evidence: StatusEvidence;
};
export type EligibilityDecision = { screen_id: string; creative_id?: string; eligible: boolean; reason: string; warnings?: string[] };
export type CampaignStatusInput = {
  campaign: any;
  creatives?: any[];
  /**
   * Screens the viewer can see, with `_status` from bootstrap when available. Online is derived from
   * `_status.device.last_heartbeat_at` (or `observed_at - age_s`) re-aged at `now`, not from `_status.state`.
   */
  screens?: any[];
  advertiser?: any;
  /** Detail page: receipts from GET /campaign/:id. Filtered here to rendered, valid-time, device-reported, paid. */
  receipts?: any[];
  /** List: campaignScreens[campaign.id] from /metrics (screen_id → last_success_at). null/undefined = not loaded. */
  reportScreens?: Record<string, string | null | undefined> | null;
  /** True once the /metrics summary has loaded, even when this campaign has no entry. */
  reportLoaded?: boolean;
  /** Server eligibility decisions for this campaign (detail page only). */
  decisions?: EligibilityDecision[] | null;
  now?: number;
};

const SCHEDULE_NORMAL = new Set(['outside_operating_hours', 'outside_campaign_daypart']);
const CAMPAIGN_REASONS: Record<string, string> = {
  campaign_not_active: 'Campaign is not active',
  campaign_pending: 'Not started',
  budget_exhausted: 'Budget reached',
  outside_operating_hours: 'Outside delivery hours (normal)',
  outside_campaign_daypart: 'Outside delivery hours (normal)',
  no_creative: 'No creatives assigned',
  screen_not_active: 'All screens paused or inactive',
  all_screens_offline: 'All screens offline',
  no_targeted_screens: 'No screens selected',
  evidence_not_loaded: 'delivery evidence not loaded',
  no_recent_delivery: 'no delivery in the last 30 min',
  device_status_unknown: 'screen online status not available',
  screens_not_online: 'delivered recently, but no screen is online now',
};
const plain = (text: string) => text.replace(/\.$/, '');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Campaign wording where the screen wording reads wrong; otherwise readiness `reasonLabel`. */
export function campaignReason(code: string, ctx: { pending?: number; rejected?: number; missing?: number } = {}): string {
  if (code === 'creative_not_approved') {
    const { pending = 0, rejected = 0, missing = 0 } = ctx;
    if (rejected && !pending && !missing) return plural(rejected, 'creative') + ' rejected';
    if (pending && !rejected && !missing) return plural(pending, 'creative') + ' awaiting approval';
    if (pending || rejected || missing) return plural(pending + rejected + missing, 'creative') + ' not approved';
    return plain(reasonLabel(code));
  }
  if (code === 'no_recent_delivery') return `no delivery in the last ${Math.round(LIVE_EVIDENCE_WINDOW_MS / 60000)} min`;
  return CAMPAIGN_REASONS[code] ?? plain(reasonLabel(code));
}

/** Successful paid play time from a receipt, or null. Never uses `billable` as a stand-in for rendered. */
export function receiptSuccessAt(play: any): number | null {
  if (!play || play.rendered !== true || play.timestamp_valid !== true || play.source !== 'device_report') return null;
  if (!play.campaign_id || (play.kind && play.kind !== 'paid')) return null;
  const start = Date.parse(play.started_at_device ?? play.started_at);
  if (!Number.isFinite(start)) return null;
  const offset = play.applied_clock_offset_ms === undefined ? 0 : Number(play.applied_clock_offset_ms);
  return Number.isFinite(offset) ? start + offset : null;
}

/**
 * Latest heartbeat time for a screen's `_status`, re-evaluated by the caller against `now`.
 * Uses `device.last_heartbeat_at`; otherwise `observed_at - age_s` when the snapshot time is known.
 * Returns null when no timestamp is available: the bootstrap `state` alone is a stale snapshot, never proof of online.
 */
export function heartbeatAt(st: any): number | null {
  if (!st) return null;
  const hb = Date.parse(st.device?.last_heartbeat_at);
  if (Number.isFinite(hb)) return hb;
  const observed = typeof st.observed_at === 'number' ? st.observed_at : Date.parse(st.observed_at);
  if (Number.isFinite(observed) && typeof st.age_s === 'number' && Number.isFinite(st.age_s)) return observed - st.age_s * 1000;
  return null;
}
/** Device state at `now`: live/stalled/offline from an aged heartbeat, unpaired, or null when unknown. */
export function deviceStateAt(st: any, now: number): 'live' | 'stalled' | 'offline' | 'unpaired' | null {
  if (st?.state === 'unpaired') return 'unpaired';
  const hb = heartbeatAt(st);
  if (hb === null || hb > now + CLOCK_TOLERANCE_MS) return null;
  const age = now - hb;
  return age < ONLINE_HEARTBEAT_MS ? 'live' : age < STALLED_HEARTBEAT_MS ? 'stalled' : 'offline';
}

function mostCommon(values: string[]): [string, number] | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best: [string, number] | null = null;
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
  return best;
}

export function campaignStatus(input: CampaignStatusInput): CampaignStatus {
  const { campaign: c, creatives = [], screens = [], advertiser, receipts, reportScreens, reportLoaded, decisions } = input;
  const now = input.now ?? Date.now();
  const targeted: string[] = Array.isArray(c?.screen_ids) ? [...new Set<string>(c.screen_ids)] : [];
  const screenById = new Map(screens.map((s: any) => [s.id, s]));
  const warnings: StatusWarning[] = [];
  const warn = (code: string, text: string) => { if (!warnings.some(w => w.code === code)) warnings.push({ code, text }); };

  // Delivery evidence: per targeted screen, the latest successful paid play time.
  let source: StatusEvidence['source'] = 'none';
  const lastByScreen = new Map<string, number>();
  // Future evidence beyond the clock tolerance is ignored on both paths, never counted.
  const usable = (at: number | null): at is number => at !== null && Number.isFinite(at) && at <= now + CLOCK_TOLERANCE_MS;
  if (Array.isArray(receipts)) {
    source = 'receipts';
    for (const p of receipts) {
      if (p?.campaign_id !== c?.id || !targeted.includes(p.screen_id)) continue;
      const at = receiptSuccessAt(p);
      if (usable(at) && at > (lastByScreen.get(p.screen_id) ?? -Infinity)) lastByScreen.set(p.screen_id, at);
    }
  } else if (reportLoaded || reportScreens) {
    source = 'report_summary';
    for (const [sid, iso] of Object.entries(reportScreens || {})) {
      const at = typeof iso === 'string' ? Date.parse(iso) : NaN;
      if (targeted.includes(sid) && usable(at) && at > (lastByScreen.get(sid) ?? -Infinity)) lastByScreen.set(sid, at);
    }
  }
  const lastAll = Math.max(-Infinity, ...lastByScreen.values());
  const recent = targeted.filter(sid => (lastByScreen.get(sid) ?? -Infinity) >= now - LIVE_EVIDENCE_WINDOW_MS);
  // Device state is re-aged from heartbeat timestamps at `now`; a snapshot `state` without a timestamp is unknown.
  const deviceState = new Map(targeted.map(sid => [sid, deviceStateAt(screenById.get(sid)?._status, now)] as const));
  const deviceKnown = targeted.filter(sid => deviceState.get(sid) !== null);
  const online = deviceKnown.filter(sid => deviceState.get(sid) === 'live');
  const liveScreens = recent.filter(sid => online.includes(sid));
  const budgetCheckable = typeof c?.committed_budget === 'number' && typeof c?.accrued_spend === 'number';

  // Per-screen eligibility (detail page): a screen can deliver if any decision for it is eligible.
  const ineligible: StatusEvidence['ineligible_screens'] = [];
  let decisionBlocker: { code: string; others: number } | null = null;
  if (Array.isArray(decisions) && decisions.length) {
    const byScreen = new Map<string, EligibilityDecision[]>();
    for (const d of decisions) if (targeted.includes(d.screen_id)) byScreen.set(d.screen_id, [...(byScreen.get(d.screen_id) || []), d]);
    const reasons: string[] = [];
    for (const [sid, rows] of byScreen) {
      if (rows.some(r => r.eligible)) continue;
      const reason = mostCommon(rows.map(r => r.reason))?.[0] || 'unavailable';
      reasons.push(reason); ineligible.push({ screen_id: sid, reason, text: campaignReason(reason) });
    }
    // Campaign-wide only with complete coverage: every targeted screen visible to the viewer has a decision
    // and none is eligible. Screens without a decision stay evidence-based.
    const visible = targeted.filter(sid => screenById.has(sid));
    const coverage = visible.length ? visible : targeted;
    if (coverage.length && coverage.every(sid => byScreen.has(sid)) && ineligible.length === byScreen.size) {
      const top = mostCommon(reasons)!;
      decisionBlocker = { code: top[0], others: new Set(reasons).size - 1 };
    }
  }

  const evidence: StatusEvidence = {
    screens_recent: liveScreens.length, screens_targeted: targeted.length,
    last_success_at: Number.isFinite(lastAll) ? new Date(lastAll).toISOString() : null, source,
    screens_delivered_recently: recent.length, screens_online: deviceKnown.length ? online.length : null,
    window_ms: LIVE_EVIDENCE_WINDOW_MS, budget_checked: budgetCheckable, ineligible_screens: ineligible,
  };
  const out = (state: CampaignState, label: string, tone: StatusTone, reason_code: string | null = null, reason: string | null = null): CampaignStatus =>
    ({ state, label, tone, reason_code, reason, warnings, evidence });

  // Rows 1-5: lifecycle states that need no delivery evidence.
  if (c?.status === 'draft') return out('draft', 'Draft', 'muted');
  if (c?.review?.state === 'in_review') return out('in_review', 'In review', 'default');
  if (c?.review?.state === 'changes_needed') return out('changes_needed', 'Changes needed', 'warn', 'changes_needed', c.review.note || 'Creatives rejected in review');
  // Approved in review but activation failed (doc 31 Phase 5). Shown before Ended: an expired end date is the reason.
  if (c?.review?.state === 'approved_not_started' && c.status !== 'active') {
    const text = 'Approved, cannot start: ' + plain(String(c.review.activation_error || 'activation failed'));
    return out('not_delivering', 'Not delivering · ' + text, 'destructive', 'approved_not_started', text);
  }
  let interval: [number, number] | null = null;
  try { interval = campaignInterval(c); } catch { interval = null; }
  if (c?.status === 'complete' || c?.status === 'cancelled' || (interval && now >= interval[1])) return out('ended', 'Ended', 'muted');
  if (c?.status === 'paused') return out('paused', 'Paused', 'warn');
  if (c?.status === 'pending') return out('not_delivering', 'Not delivering · Not started', 'warn', 'campaign_pending', 'Holding screens, not active');
  if (c?.status !== 'active') return out('unknown', 'Unknown · ' + campaignReason('campaign_not_active'), 'outline', 'campaign_not_active', campaignReason('campaign_not_active'));

  // Campaign-wide blockers from fields the client already has.
  const blockers: { code: string; text: string }[] = [];
  const block = (code: string, text = campaignReason(code)) => blockers.push({ code, text });
  if (!interval) block('campaign_dates_invalid');
  const ids: string[] = Array.isArray(c.creative_ids) ? c.creative_ids : [];
  const assigned = ids.map(id => creatives.find((x: any) => x.id === id));
  const approved = assigned.filter((x: any) => x && x.approval_status === 'approved' && x.purpose !== 'filler').length;
  const pending = assigned.filter((x: any) => x && x.approval_status === 'pending').length;
  const rejected = assigned.filter((x: any) => x && x.approval_status === 'rejected').length;
  const missing = assigned.length - approved - pending - rejected;
  if (!ids.length) block('no_creative');
  else if (!approved) block('creative_not_approved', campaignReason('creative_not_approved', { pending, rejected, missing }));
  else if (pending || rejected) warn('some_creatives_not_approved', 'Some creatives awaiting approval: ' + campaignReason('creative_not_approved', { pending, rejected, missing: 0 }));
  if (budgetCheckable) {
    if (c.rate_type === 'per_play' && c.accrued_spend >= c.committed_budget) block('budget_exhausted');
    else if (c.committed_budget > 0 && c.accrued_spend >= c.committed_budget * 0.8) warn('budget_80_percent', plain(reasonLabel('budget_80_percent')));
  }
  if (advertiser?.status === 'archived') block('advertiser_archived');
  if (!targeted.length) block('no_targeted_screens');
  const known = targeted.filter(sid => screenById.has(sid));
  if (targeted.length && known.length === targeted.length && known.every(sid => screenById.get(sid).status !== 'active')) block('screen_not_active');
  if (targeted.length && deviceKnown.length === targeted.length && deviceKnown.every(sid => deviceState.get(sid) === 'offline')) block('all_screens_offline');
  else {
    const offline = deviceKnown.filter(sid => deviceState.get(sid) === 'offline').length;
    if (offline) warn('some_screens_offline', `${offline} of ${targeted.length} screens offline`);
  }

  // Row 6: future start shows Scheduled; any blocker becomes a warning chip.
  if (interval && now < interval[0]) {
    for (const b of blockers) warn(b.code, b.code === 'creative_not_approved' ? 'Creatives awaiting approval: ' + b.text : b.text);
    return out('scheduled', 'Scheduled', 'default');
  }
  // Row 7: campaign-wide blocker, then server eligibility when every visible screen is ineligible.
  if (blockers.length) {
    const b = blockers[0];
    for (const other of blockers.slice(1)) warn(other.code, other.text);
    return out('not_delivering', 'Not delivering · ' + b.text, 'destructive', b.code, b.text);
  }
  if (decisionBlocker) {
    const text = campaignReason(decisionBlocker.code) + (decisionBlocker.others ? ` and ${plural(decisionBlocker.others, 'other reason')}` : '');
    return out('not_delivering', 'Not delivering · ' + text, SCHEDULE_NORMAL.has(decisionBlocker.code) ? 'muted' : 'destructive', decisionBlocker.code, text);
  }
  if (ineligible.length) warn('some_screens_ineligible', `${plural(ineligible.length, 'screen')} not eligible (see Diagnostics)`);

  // Row 8: Live needs recent successful paid play AND current device evidence on the same screen.
  if (liveScreens.length) return out('live', `Live · ${liveScreens.length} of ${targeted.length} screens`, 'onair');
  // Row 9: Unknown with the most specific reason we can honestly give.
  const code = source === 'none' ? 'evidence_not_loaded'
    : !recent.length ? 'no_recent_delivery'
    : !deviceKnown.length ? 'device_status_unknown'
    : 'screens_not_online';
  const text = campaignReason(code);
  return out('unknown', 'Unknown · ' + text, 'outline', code, text);
}

export type InboxAlert = { kind: string; tone: string; text: string; go: string };
function openCampaign(c: any, now: number) {
  if (!c || ['draft', 'complete', 'cancelled'].includes(c.status)) return false;
  try { return now < campaignInterval(c)[1]; } catch { return true; }
}
/**
 * Approval inbox items point at the blocked campaign: one item per visible open campaign that uses a
 * pending creative. Pending creatives in no open visible campaign keep the caller's existing item.
 */
export function approvalAlerts(d: { campaigns?: any[] }, pending: any[], fallbackGo: string, fallbackText: (creative: any) => string, now = Date.now()): InboxAlert[] {
  const pendingIds = new Set(pending.map(cr => cr.id)), used = new Set<string>(), out: InboxAlert[] = [];
  for (const c of d.campaigns || []) {
    if (!openCampaign(c, now)) continue;
    const waiting = (c.creative_ids || []).filter((id: string) => pendingIds.has(id));
    if (!waiting.length) continue;
    waiting.forEach((id: string) => used.add(id));
    out.push({ kind: 'Approval', tone: 'warn', text: `${c.name} is waiting on ${plural(waiting.length, 'creative')} for approval`, go: 'c/' + c.id });
  }
  for (const cr of pending) if (!used.has(cr.id)) out.push({ kind: 'Approval', tone: 'warn', text: fallbackText(cr), go: fallbackGo });
  return out;
}
/** Active campaigns with a campaign-wide blocker (no delivery evidence needed), excluding pure approval waits. */
export function blockedAlerts(d: { campaigns?: any[]; creatives?: any[]; screens?: any[]; advertisers?: any[] }, now = Date.now()): InboxAlert[] {
  return (d.campaigns || []).filter((c: any) => c.status === 'active').flatMap((c: any) => {
    const s = campaignStatus({ campaign: c, creatives: d.creatives, screens: d.screens, advertiser: (d.advertisers || []).find((a: any) => a.id === c.advertiser_id), now });
    if (s.state !== 'not_delivering') return [];
    const waitingOnApproval = s.reason_code === 'creative_not_approved' && (c.creative_ids || []).some((id: string) => (d.creatives || []).find((x: any) => x.id === id)?.approval_status === 'pending');
    return waitingOnApproval ? [] : [{ kind: 'Delivery', tone: 'destructive', text: `${c.name}: ${s.label}`, go: 'c/' + c.id }];
  });
}
/**
 * Overview headline counts from Phase 1 states (doc 31 Phase 6), replacing date-only `isLive` counts. Live needs the
 * delivery-evidence summary: before it loads the live count is unknown, not 0. Not delivering needs no evidence.
 */
export function campaignStateSummary(statuses: Pick<CampaignStatus, 'state'>[], evidence: { loaded: boolean; error?: string | null }) {
  const count = (state: CampaignState) => statuses.filter(s => s.state === state).length;
  const live = evidence.loaded ? `${count('live')} live` : evidence.error ? 'live unknown' : 'live checking…';
  return { live: evidence.loaded ? count('live') : null, not_delivering: count('not_delivering'), text: `${live} · ${count('not_delivering')} not delivering campaigns` };
}
