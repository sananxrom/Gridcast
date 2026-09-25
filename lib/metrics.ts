/**
 * One number, one definition, everywhere.
 *
 * Every figure the product displays that touches money or measurement is defined
 * exactly once, here, and rendered from here on the operator console, the advertiser
 * view, a PDF report and a CSV header. Divergent wording between an operator's screen
 * and an advertiser's report is how a trust product loses an argument.
 *
 * The presence definition is lifted verbatim in substance from the "How we count"
 * card in `app/advertiser/page.tsx`, which was already the clearest statement of it
 * in the product — and, before this file, the only one.
 */

export type Completeness = {
  /** Rendered paid plays carrying valid presence samples. */
  measured: number;
  /** All rendered paid plays in scope, measured or not. */
  total: number;
  /** True when the requested period is not fully covered by the available records. */
  truncated?: boolean;
  startedAt?: string | null;
};

export type Period = {
  /** ISO date, inclusive. */
  from: string;
  /** ISO date, inclusive. */
  to: string;
  /** Human label, e.g. "1–24 September 2026". Derived when absent. */
  label?: string;
};

export type Definition = {
  /** Short noun phrase for the popover heading. Matches the on-screen label. */
  title: string;
  /** What it counts, in one plain sentence. Required. */
  counts: string;
  /** What it leaves out. The honest half — omit only when genuinely nothing is excluded. */
  excludes?: string;
  /** Where the number comes from: the measurement or the record it is derived from. Required. */
  source: string;
  /** Unit or formula, when the label alone is ambiguous. */
  unit?: string;
  /** Deep link to the public methodology or an internal doc. */
  seeAlso?: string;
};

/**
 * Period and completeness are supplied at render time by the page, because both
 * depend on the range control and on what the API actually returned. They are not
 * baked into a definition.
 */
export const METRICS = {
  recorded_campaign_accrual: {
    title: 'Recorded lifetime accrual',
    counts: 'The accrued amounts currently recorded for the campaigns visible in this view, over their lifetime.',
    excludes: 'This is not filtered by the delivery-report dates, and it is not a record of cash received. Unreported offline playback is absent.',
    source: 'Campaign accrued-spend records and, where available, verified settlement buckets. Legacy or flat-fee amounts are not proof of per-play settlement at frozen booking terms. A limited directory covers loaded campaigns only.',
    unit: '₹',
  },
  live_screen_count: {
    title: 'Screens on air now',
    counts: 'Loaded screens whose current device status is live, out of the loaded screens in this view.',
    excludes: 'Unloaded inventory, unpaired and stale devices. A live heartbeat does not prove the physical display panel is visible or powered.',
    source: 'The latest device status returned with the screen directory. This is a current snapshot, not historical uptime.',
  },
  current_exceptions: {
    title: 'Needs attention',
    counts: 'The issues listed in this view: offline or stalled screens, fresh device-reported camera or detector failures, pending approvals, and high-budget alerts where this role can see them.',
    excludes: 'This is a count of issues, not unique screens. Unknown camera state and missing reports are not diagnosed as detector failures.',
    source: 'Loaded screen status, active device observations reported within five minutes, campaign budget records and creative approval status.',
  },
  live_campaign_count: {
    title: 'Live campaigns',
    counts: 'Campaigns currently marked active and inside their campaign dates on this screen.',
    excludes: 'This is not proof of delivery; operating hours, media readiness, budget and other eligibility checks can still prevent playback.',
    source: 'Current campaign records assigned to the screen.',
  },
  advertiser_monthly_price: {
    title: 'Monthly price per advertiser',
    counts: 'The screen’s current monthly inventory value divided by its advertiser limit.',
    excludes: 'This is a current asking rate, not the price of an existing booking or recorded revenue.',
    source: 'Screen rate factors and advertiser-limit settings. Existing bookings can carry separately agreed terms.',
    unit: '₹ per advertiser per month',
  },

  presence_avg: {
    title: 'Average people present',
    counts:
      'The average number of people in front of the screen while an ad was playing.',
    excludes:
      'Unmeasured, failed, invalid-clock, diagnostic and filler plays are excluded, never treated as zero people.',
    source:
      'Sampled on the device roughly every 2 seconds during playback and averaged per play. Camera images never leave the device.',
    unit: 'mean people per measured play',
  },

  measured_ratio: {
    title: 'Measured plays',
    counts: 'Rendered paid plays with valid presence samples. Some samples do not prove uninterrupted camera coverage.',
    excludes: 'Plays without valid presence samples, failed plays, diagnostics and filler.',
    source: 'Counted from play receipts carrying presence samples.',
    unit: 'measured rendered paid plays ÷ rendered paid plays',
  },

  plays_rendered: {
    title: 'Plays delivered',
    counts:
      'Creatives that played to completion on a screen: the media reached its end and the playing duration matched the creative.',
    excludes:
      'Interrupted, errored, timed-out and invalid-clock plays. Diagnostic plays. Filler is counted separately and never as advertiser delivery.',
    source: 'Device play receipts, one per completed playback.',
  },

  plays_billable: {
    title: 'Billable plays',
    counts:
      'Delivered paid plays that passed the server’s clock, camera-policy, assignment, duration and budget-authorization checks.',
    excludes:
      'Filler and plays that fail any billing check. A delivered play may be non-billable; delivery and billing are separate facts.',
    source:
      'The same receipts as delivered plays, after the billing predicates are applied server-side.',
  },

  accrued_spend: {
    title: 'Accrued spend',
    counts:
      'Money owed for billable plays so far, at the rate and fee agreed when each screen was booked.',
    excludes:
      'Non-billable plays. Filler. Anything not yet reported by a device that was offline.',
    source:
      'Settlement buckets written with each play receipt, carrying the rate and fee version frozen at booking.',
    unit: 'integer paise, rounded half-up once per line',
  },

  screen_status: {
    title: 'Screen status',
    counts:
      'Whether the screen is reporting: live, stalled, offline, or not yet paired.',
    excludes: 'Says nothing about whether the display panel itself is powered or visible.',
    source:
      'Time since the last heartbeat: live under 90 seconds, stalled from 90 seconds to under 15 minutes, offline from 15 minutes. No active paired device means not paired.',
  },

  slot_fill: {
    title: 'Advertisers today',
    counts:
      'Distinct advertisers with a live booking on this screen right now, against the number of distinct advertisers it will carry.',
    excludes:
      'This counts advertisers, not appearances. One advertiser appearing six times is one.',
    source: 'Live bookings on the screen, resolved to distinct advertisers.',
    unit: 'distinct advertisers ÷ advertiser slots',
  },

  monthly_inventory_value: {
    title: 'Monthly inventory',
    counts:
      'What this screen would earn in a month if every advertiser slot were sold at the current rate.',
    excludes:
      'It is a ceiling, not a forecast and not revenue. Nothing about it is booked.',
    source:
      'venue base × size × location × exposure, divided across advertiser slots. Exposure is an operator estimate, not a measurement.',
    unit: '₹ per month at full sell-through',
  },

  plays_not_rendered: {
    title: 'Failed plays',
    counts: 'Paid play receipts that did not pass the playback completion check.',
    excludes: 'Diagnostic and filler receipts. A device that has not reported cannot be counted as a failure.',
    source: 'Accepted device receipts, using the server’s rendered flag.',
  },
  plays_filler: {
    title: 'Filler reports',
    counts: 'Accepted filler play receipts, including failed filler playback.',
    excludes: 'Invalid-clock receipts, paid advertising and diagnostic playback. Filler is never billed as advertiser delivery; its presence and airtime include only rendered filler.',
    source: 'Accepted device receipts identified as filler.',
  },
  airtime_ms: {
    title: 'Paid airtime',
    counts: 'The recorded playback duration of rendered paid plays.',
    excludes: 'Failed plays, diagnostic playback and filler.',
    source: 'Playback duration reported by the device and accepted with each rendered paid receipt.',
    unit: 'milliseconds',
  },
} as const satisfies Record<string, Definition>;

export type MetricId = keyof typeof METRICS;

/** Human period label: "1–24 Sep 2026", or the explicit label when one is given. */
export function periodLabel(p?: Period): string | null {
  if (!p) return null;
  if (p.label) return p.label;
  const fmt = (iso: string, withYear: boolean) => {
    const d = new Date(iso + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) return iso;
    const day = d.getUTCDate();
    const mon = d.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' });
    return withYear ? `${day} ${mon} ${d.getUTCFullYear()}` : `${day} ${mon}`;
  };
  if (p.from === p.to) return fmt(p.from, true);
  const sameMonth = p.from.slice(0, 7) === p.to.slice(0, 7);
  return sameMonth
    ? `${new Date(p.from + 'T00:00:00Z').getUTCDate()}–${fmt(p.to, true)}`
    : `${fmt(p.from, false)} – ${fmt(p.to, true)}`;
}

/** Explain the denominator without implying that partial averages are lower bounds. */
export function completenessLabel(c?: Completeness): string | null {
  if (!c || !Number.isFinite(c.total) || c.total < 0) return null;
  const n = (v: number) => v.toLocaleString('en-IN');
  const measured = Number.isFinite(c.measured) ? c.measured : 0;
  const sample = c.total > 0
    ? `${n(measured)} measured of ${n(c.total)} rendered paid plays (${Math.round(measured / c.total * 100)}%).`
    : 'No rendered paid plays recorded in this range.';
  return c.truncated
    ? `${sample} The selected period is only partly covered; these figures describe available records, not the full period.`
    : sample;
}
