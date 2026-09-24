/** Inventory quantities are not measured presence. Date-only bookings use inclusive IST days.
 * Pending, active and paused campaigns hold inventory; drafts/complete/cancelled do not.
 * slots_per_loop is the number of appearances, each reserving ceil(creative seconds / slot seconds).
 */
export class InventoryError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = 'InventoryError'; }
}
type Row = Record<string, any>;
export const INVENTORY_TIMEZONE = 'Asia/Kolkata';
export const HOLD_STATUSES = new Set(['pending', 'active', 'paused']);
const STATUSES = new Set(['draft', 'pending', 'active', 'paused', 'complete', 'cancelled']);
const bad = (message: string): never => { throw new InventoryError(message); };
const number = (value: unknown, name: string, min = 0, max = Infinity): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) bad(`${name} must be a finite number between ${min} and ${max}`);
  return value as number;
};
const integer = (value: unknown, name: string, min = 1, max = 10000) => {
  const n = number(value, name, min, max); if (!Number.isInteger(n)) bad(`${name} must be an integer`); return n;
};
const text = (value: unknown, name: string, required = true) => {
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > 1000) bad(`${name} must be text${required ? ' and is required' : ''}`);
  return (value as string).trim();
};
const round = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
function minute(value: unknown) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) bad('Time must use HH:MM (00:00–23:59)');
  const [h,m] = (value as string).split(':').map(Number); return h * 60 + m;
}
export function validateTimeWindow(window: any) {
  if (!window || typeof window !== 'object' || Array.isArray(window)) bad('Operating hours must have from and to times');
  minute(window.from); minute(window.to);
  if (window.days !== undefined && (!Array.isArray(window.days) || !window.days.length || window.days.some((n: any) => !Number.isInteger(n) || n < 0 || n > 6))) bad('days must contain weekday numbers, Sunday 0 through Saturday 6');
  return { from: window.from as string, to: window.to as string, ...(window.days ? { days: [...new Set<number>(window.days)] } : {}) };
}
/** Overnight windows belong to the day on which they start. Equal from/to means 24 hours. */
export function withinWindow(at: Date | string | number, window: any): boolean {
  const w = validateTimeWindow(window), time = new Date(at);
  if (!Number.isFinite(time.getTime())) bad('Invalid schedule time');
  const local = new Date(time.getTime() + 330 * 60000), now = local.getUTCHours() * 60 + local.getUTCMinutes();
  const from = minute(w.from), to = minute(w.to);
  const startsYesterday = from > to && now < to;
  const day = (local.getUTCDay() + (startsYesterday ? 6 : 0)) % 7;
  return (!w.days || w.days.includes(day)) && (from === to || (from < to ? now >= from && now < to : now >= from || now < to));
}
function endpoint(value: any, end: boolean): number {
  if (typeof value !== 'string') return bad('Campaign dates are required');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const utc = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0,10) !== value) return bad('Invalid campaign calendar date');
    return utc - 330 * 60000 + (end ? 86400000 : 0);
  }
  // Reject timezone-less timestamps rather than interpreting in the server's local timezone.
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return bad('Campaign timestamps require an explicit timezone');
  return Date.parse(value);
}
export function campaignInterval(campaign: Row): [number, number] {
  const start = endpoint(campaign.starts_at, false), end = endpoint(campaign.ends_at, true);
  if (start >= end) bad('Campaign end must be after its start');
  return [start,end];
}
export function physicalCapacity(screen: Row): number {
  const loop = number(screen.loop_length_s, 'loop_length_s', 1, 86400);
  const slot = number(screen.slot_duration_s, 'slot_duration_s', 1, loop);
  return Math.floor(loop / slot);
}
export function defaultSlotsPerLoop(screen: Row): number {
  return Math.max(1, Math.floor(physicalCapacity(screen) / integer(screen.advertiser_slots, 'advertiser_slots')));
}
export function validateScreenInput(input: Row): Row {
  const size = typeof input.size_in === 'string' && /^\d+(\.\d+)?$/.test(input.size_in) ? Number(input.size_in) : input.size_in;
  const screen: Row = {
    name: text(input.name, 'name'), venue_name: text(input.venue_name, 'venue_name'),
    address: text(input.address, 'address'), venue_type: text(input.venue_type, 'venue_type'),
    size_in: String(number(size, 'size_in', 1, 1000)), orientation: input.orientation ?? 'landscape',
    aspect: input.aspect ?? (input.orientation === 'portrait' ? '9:16' : '16:9'),
    loop_length_s: input.loop_length_s ?? 600, slot_duration_s: input.slot_duration_s ?? 10,
    advertiser_slots: input.advertiser_slots ?? 10,
    operating_hours: validateTimeWindow(input.operating_hours ?? { from: '09:00', to: '21:00' }),
    timezone: INVENTORY_TIMEZONE, owner_share_pct: number(input.owner_share_pct ?? 0, 'owner_share_pct', 0, 100),
    has_camera: input.has_camera ?? false, network_available: input.network_available ?? false,
    network_slots: integer(input.network_slots ?? 0, 'network_slots', 0),
    location_tier: input.location_tier ?? 'standard', tags: {},
    exclusions: { categories: [], advertisers: [] }, status: input.status ?? 'active',
    venue_base: number(input.venue_base ?? ({grocery:3000,cafe:5000,gym:6000,salon:4000,mall:15000,pharmacy:3500} as Row)[input.venue_type] ?? 3000, 'venue_base', 0.01),
    size_factor: number(input.size_factor ?? (Number(size) >= 65 ? 1.8 : Number(size) >= 50 ? 1.3 : 1), 'size_factor', 0.01),
    location_factor: number(input.location_factor ?? ({ prime: 1.5, good: 1.2, standard: 1, peripheral: 0.8 } as Row)[input.location_tier ?? 'standard'], 'location_factor', 0.01),
    exposure_factor: number(input.exposure_factor ?? 1, 'exposure_factor', 0.6, 2), exposure_source: 'estimated',
  };
  if (!['landscape','portrait'].includes(screen.orientation)) bad('Invalid orientation');
  if (!Number.isFinite(aspectRatio(screen.aspect))) bad('Invalid aspect ratio');
  if (!['active','inactive','maintenance'].includes(screen.status)) bad('Invalid screen status');
  if (!['prime','good','standard','peripheral'].includes(screen.location_tier)) bad('Invalid location tier');
  if (typeof screen.has_camera !== 'boolean' || typeof screen.network_available !== 'boolean') bad('Camera and network flags must be boolean');
  const capacity = physicalCapacity(screen);
  integer(screen.advertiser_slots, 'advertiser_slots', 1, capacity);
  if (screen.network_slots > screen.advertiser_slots) bad('Network advertiser allocation exceeds advertiser slots');
  if (input.tags !== undefined) {
    if (!input.tags || typeof input.tags !== 'object' || Array.isArray(input.tags)) bad('tags must be a key-value object');
    for (const [k,v] of Object.entries(input.tags)) {
      if (['__proto__','constructor','prototype'].includes(k) || !k.trim() || k.length > 100) bad('Invalid tag key');
      screen.tags[k] = text(v, 'tag value', false);
    }
  }
  for (const k of ['geo_lat','geo_lng']) if (input[k] !== undefined && input[k] !== null) screen[k] = number(input[k], k, k === 'geo_lat' ? -90 : -180, k === 'geo_lat' ? 90 : 180);
  for (const k of ['city','area','mount_notes','photo_url']) if (input[k] !== undefined) screen[k] = text(input[k], k, false);
  for (const k of ['resolution_w','resolution_h']) if (input[k] !== undefined) screen[k] = integer(input[k], k, 1, 32768);
  if (input.exclusions !== undefined) {
    if (!input.exclusions || typeof input.exclusions !== 'object' || Array.isArray(input.exclusions)) bad('Invalid exclusions');
    for (const key of ['categories','advertisers']) {
      const values = input.exclusions[key] ?? [];
      if (!Array.isArray(values) || values.some((v: any)=>typeof v !== 'string' || !v.trim())) bad(`Invalid exclusion ${key}`);
      screen.exclusions[key] = [...new Set(values)];
    }
    if (input.exclusions.competitive_separation !== undefined) {
      if (typeof input.exclusions.competitive_separation !== 'boolean') bad('competitive_separation must be boolean');
      screen.exclusions.competitive_separation = input.exclusions.competitive_separation;
    }
  }
  screen.monthly_value = round(screen.venue_base * screen.size_factor * screen.location_factor * screen.exposure_factor);
  screen.slot_price_month = round(screen.monthly_value / screen.advertiser_slots);
  screen.pricing_source = 'derived'; screen.valuation_input_source = 'operator_estimate';
  screen.pricing_provenance = { venue_base: input.venue_base === undefined ? 'illustrative_rate_table' : 'operator_estimate', size_factor: input.size_factor === undefined ? 'derived_from_diagonal' : 'operator_estimate', location_factor: 'operator_estimate', exposure_factor: 'estimated', monthly_value: 'derived', slot_price_month: 'derived' };
  return screen;
}

/** 30 days is an explicit quotation assumption, not a measured delivery promise.
 * Spec §4B's worked per-play price assumes ONE appearance/loop. That is returned separately:
 * entitlement view uses the supplied/derived repeated appearances and is never silently one sixtieth.
 */
export function reverseCalculate(input: Row): Row {
  const revenue = number(input.monthly_revenue, 'monthly_revenue', 0);
  const clients = integer(input.client_count, 'client_count');
  const fill = number(input.fill_rate, 'fill_rate', Number.MIN_VALUE, 1);
  const base = number(input.venue_base, 'venue_base', 0.01), size = number(input.size_factor, 'size_factor', 0.01);
  const capacity = physicalCapacity(input), inferred = clients / fill, advertisers = input.advertiser_slots ?? Math.round(inferred);
  integer(advertisers, 'advertiser_slots', clients, capacity);
  const slots = integer(input.slots_per_loop ?? Math.max(1, Math.floor(capacity / advertisers)), 'slots_per_loop', 1, capacity);
  const hours = number(input.operating_hours, 'operating_hours', Number.MIN_VALUE, 24);
  const days = integer(input.days_per_month ?? 30, 'days_per_month', 1, 31);
  const price = revenue / clients, capacityValue = price * advertisers;
  const loops = hours * 3600 / input.loop_length_s;
  const views = (n: number) => {
    const plays = loops * days * n, airtime = plays * input.slot_duration_s;
    return { slots_per_loop: n, planned_plays_per_month: round(plays), planned_airtime_sec_month: round(airtime),
      per_advertiser_month: round(price), per_play: round(price / plays), per_airtime_second: round(price / airtime), per_airtime_minute: round(price / (airtime / 60)) };
  };
  return {
    reported_monthly_revenue: revenue, reported_client_count: clients, reported_fill_rate: fill,
    revenue_source: 'self_reported', measurement_source: null, presence: null,
    inferred_advertiser_slots: round(inferred), advertiser_slots: advertisers, capacity_value: round(capacityValue),
    reported_fill_capacity_value: round(revenue / fill), derived_slot_price: round(price), derived_quality_factor: round(capacityValue / (base * size)),
    // Preserve the operator's price without claiming an out-of-range exposure factor is measured.
    seed_monthly_value: round(price * advertisers), seed_slot_price_month: round(price),
    provenance: { inputs: 'self_reported', outputs: 'derived', assumptions: { days_per_month: days, operating_hours_per_day: hours, timezone: INVENTORY_TIMEZONE } },
    loops_per_day: round(loops), physical_slots_per_loop: capacity, entitlement: views(slots),
    one_appearance_reference: views(1),
    warnings: inferred !== advertisers ? ['Inferred advertiser capacity was rounded or overridden; price is preserved using the confirmed integer capacity.'] : [],
  };
}

function appearances(c: Row, s: Row): number {
  const booking = c.bookings?.find((b: Row) => b.screen_id === s.id);
  return integer(booking?.slots_per_loop ?? defaultSlotsPerLoop(s), 'slots_per_loop', 1, physicalCapacity(s));
}
function slotUnits(c: Row, s: Row, creatives: Row[]) {
  const selected = (c.creative_ids || []).map((id: string) => creatives.find(cr => cr.id === id)).filter(Boolean) as Row[];
  const durations = selected.flatMap(cr => Array.isArray(cr.assets) && cr.assets.length ? cr.assets.map((a: Row)=>a.duration_s) : [cr.duration_s]);
  const longest = Math.max(s.slot_duration_s, ...durations.map(n=>number(n, 'creative duration_s', 0.001, 86400)));
  return appearances(c,s) * Math.ceil(longest / s.slot_duration_s);
}
/** Returns normalized bookings, never mutates records. Call inside the same transaction as save. */
export function validateBooking(candidate: Row, campaigns: Row[], screens: Row[], creatives: Row[] = []): Row[] {
  if (!STATUSES.has(candidate.status)) bad('Invalid campaign status');
  const [start,end] = campaignInterval(candidate);
  if (!Array.isArray(candidate.screen_ids) || !candidate.screen_ids.length || candidate.screen_ids.some((id: any) => typeof id !== 'string')) bad('Select at least one screen');
  if (new Set(candidate.screen_ids).size !== candidate.screen_ids.length) bad('Duplicate screen target');
  if (candidate.bookings !== undefined && (!Array.isArray(candidate.bookings) || candidate.bookings.some((b: Row) => !b || !candidate.screen_ids.includes(b.screen_id)) || new Set(candidate.bookings.map((b: Row) => b.screen_id)).size !== candidate.bookings.length)) bad('Bookings must target selected screens exactly once');
  const bookings = candidate.screen_ids.map((id: string) => {
    const screen = screens.find(s => s.id === id && s.org_id === candidate.org_id);
    if (!screen) throw new InventoryError('Screen not found',404);
    const normalized = { screen_id: id, slots_per_loop: appearances(candidate, screen) };
    const currentUnits = slotUnits(candidate,screen,creatives), capacity = physicalCapacity(screen);
    if (currentUnits > capacity) throw new InventoryError('Campaign appearances exceed physical loop capacity',409);
    if (!HOLD_STATUSES.has(candidate.status)) return normalized;
    const overlapping = campaigns.filter(c => c.id !== candidate.id && c.org_id === screen.org_id && HOLD_STATUSES.has(c.status) && c.screen_ids?.includes(id))
      .map(c => ({ campaign:c, interval:campaignInterval(c) })).filter(r => r.interval[0] < end && r.interval[1] > start);
    const points = new Set([start,...overlapping.map(r=>Math.max(start,r.interval[0]))]);
    for (const point of points) {
      const active = overlapping.filter(r=>r.interval[0] <= point && point < r.interval[1]).map(r=>r.campaign);
      const advertisers = new Set([candidate.advertiser_id, ...active.map(c=>c.advertiser_id)]);
      if (advertisers.size > integer(screen.advertiser_slots, 'advertiser_slots')) throw new InventoryError(`Advertiser capacity exceeded for ${screen.name || id}`,409);
      if (currentUnits + active.reduce((sum,c)=>sum+slotUnits(c,screen,creatives),0) > capacity) throw new InventoryError(`Physical loop capacity exceeded for ${screen.name || id}`,409);
    }
    return normalized;
  });
  return bookings;
}

export function groupMatches(screen: Row, rule: Row = {}): boolean {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule) || Object.keys(rule).some(k=>!['venue_types','min_size','location_tier','city','area','tags'].includes(k))) return false;
  return (!rule.venue_types?.length || rule.venue_types.includes(screen.venue_type)) &&
    (rule.min_size === undefined || Number(screen.size_in) >= Number(rule.min_size)) &&
    (!rule.location_tier || screen.location_tier === rule.location_tier) &&
    (!rule.city || screen.city === rule.city) && (!rule.area || screen.area === rule.area) &&
    Object.entries(rule.tags || {}).every(([key,value]) => Object.hasOwn(screen.tags || {},key) && screen.tags[key] === value);
}
function aspectRatio(value: any): number {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value)) return NaN;
  const [w,h] = value.split(':').map(Number); return w > 0 && h > 0 ? w / h : NaN;
}
export type EligibilityInput = { screen: Row; campaign: Row; creative: Row | undefined; advertiser?: Row; settings?: Row; at?: Date | string | number; config?: Row; loopAdvertisers?: Row[] };
export type EligibilityResult = { eligible: boolean; rejected_at_step: number | null; reason: string; warnings: string[]; asset: Row | null; letterbox: boolean };
export function eligibility({screen, campaign:c, creative:cr, advertiser, settings = {}, at = new Date(), config = {}, loopAdvertisers = []}: EligibilityInput): EligibilityResult {
  const result = (step: number | null, reason: string, asset: Row | null = null, letterbox = false): EligibilityResult => ({ eligible: step === null, rejected_at_step: step, reason, warnings, asset, letterbox });
  const warnings: string[] = [];
  if (!c.screen_ids?.includes(screen.id) || c.org_id !== screen.org_id) return result(1,'screen_not_targeted');
  if (screen.status !== 'active') return result(2,'screen_not_active');
  if (c.status !== 'active') return result(2,'campaign_not_active');
  const time = new Date(at).getTime();
  let start: number, end: number;
  try { [start,end] = campaignInterval(c); } catch { return result(2,'campaign_dates_invalid'); }
  if (!Number.isFinite(time) || time < start || time >= end) return result(2,'outside_campaign_dates');
  // Budget alerts inform an operator; stopped delivery is always an explicit status action.
  if (typeof c.committed_budget === 'number' && c.committed_budget > 0 && c.accrued_spend >= c.committed_budget * 0.8) warnings.push(c.accrued_spend >= c.committed_budget ? 'budget_exhausted_manual_action' : 'budget_80_percent');
  const hours = config.operating_hours ?? screen.operating_hours;
  if (hours !== undefined) {
    // Legacy numeric hours express duration, not a start/end window. Do not invent one.
    if (typeof hours === 'number') warnings.push('operating_window_unconfigured');
    else try { if (!withinWindow(at,hours)) return result(2,'outside_operating_hours'); } catch { return result(2,'operating_hours_invalid'); }
  }
  if (c.dayparts !== undefined) {
    try { if (!Array.isArray(c.dayparts) || !c.dayparts.length || !c.dayparts.some((w: Row)=>withinWindow(at,w))) return result(2,'outside_campaign_daypart'); }
    catch { return result(2,'campaign_daypart_invalid'); }
  }
  if (!cr || !c.creative_ids?.includes(cr.id) || cr.advertiser_id !== c.advertiser_id || cr.org_id !== (c.origin_org_id || c.org_id) || cr.approval_status !== 'approved') return result(3,'creative_not_approved');
  if ((settings.blocked_categories || settings.category_blocklist || []).includes(cr.category)) return result(4,'platform_category_block');
  if ((screen.exclusions?.categories || []).includes(cr.category)) return result(5,'screen_category_block');
  if ((screen.exclusions?.advertisers || []).includes(c.advertiser_id)) return result(6,'screen_advertiser_block');
  const exclusions = advertiser?.exclusions || {};
  if ((exclusions.venue_types || []).includes(screen.venue_type) || (exclusions.screens || []).includes(screen.id) || (exclusions.tag_rules || []).some((rule: Row)=>groupMatches(screen,{tags:rule}))) return result(7,'advertiser_venue_block');
  if (screen.exclusions?.competitive_separation === true && loopAdvertisers.some(a=>a.id !== c.advertiser_id && a.category === cr.category)) return result(8,'competitive_separation');
  const target = aspectRatio(screen.aspect);
  if (!Number.isFinite(target)) return result(9,'screen_aspect_invalid');
  const assets: Row[] = Array.isArray(cr.assets) && cr.assets.length ? cr.assets : [{ id: cr.id, youtube_id: cr.youtube_id, uri: cr.uri, aspect: cr.aspect, duration_s: cr.duration_s }];
  const suitable = assets.filter(a => (a.youtube_id || a.uri) && Number.isFinite(aspectRatio(a.aspect)) && typeof a.duration_s === 'number' && a.duration_s > 0)
    .sort((a,b)=>Math.abs(Math.log(aspectRatio(a.aspect)/target))-Math.abs(Math.log(aspectRatio(b.aspect)/target)));
  if (!suitable.length) return result(9,'no_playable_asset');
  const asset = suitable[0];
  return result(null,'eligible',asset,Math.abs(aspectRatio(asset.aspect)-target)>0.0001);
}
