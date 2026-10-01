import { ADVERTISER, PLATFORM_ADMIN, assignable, can, type Cap } from './roles';
import { LOCKED_KEYS, BY_KEY } from './config';
import { DRAFT_FIELDS, DRAFT_STEPS, draftVisibleTo } from './campaign-drafts';

export class AccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const fail = (status: number, message: string): never => { throw new AccessError(status, message); };
export const pick = (value: any, keys: readonly string[]) => Object.fromEntries(
  keys.filter(k => Object.prototype.hasOwnProperty.call(value, k)).map(k => [k, value[k]]));
export const publicUser = (u: any) => pick(u, [
  'id', 'org_id', 'name', 'email', 'phone', 'role', 'advertiser_id', 'must_change', 'status', 'created_at', 'last_login_at',
]);
const admin = (u: any) => u?.role === PLATFORM_ADMIN;
export function own(rows: any[], id: unknown, actor: any) {
  const row = rows.find(r => r.id === id);
  if (!row || (!admin(actor) && row.org_id !== actor.org_id)) fail(404, 'Not found');
  return row;
}
function org(db: any, id: unknown, actor: any) {
  const found = db.orgs.find((o: any) => o.id === id);
  if (!found || (!admin(actor) && found.id !== actor.org_id)) fail(404, 'Not found');
  return found;
}
export function campaignVisible(c: any, actor: any) {
  return admin(actor) || ((c.org_id === actor.org_id || (actor.role !== ADVERTISER && c.campaign_type === 'network' && c.participant_org_ids?.includes(actor.org_id))) && (actor.role === ADVERTISER
    ? !!actor.advertiser_id && c.advertiser_id === actor.advertiser_id
    : can(actor.role, 'sales') || can(actor.role, 'money')));
}

// Exact method/path policy: new business routes are denied until explicitly listed here.
// Empty capabilities mean a valid human session, not an anonymous route.
export const ROUTES: { method: string; path: RegExp; caps: Cap[] }[] = [
  { method: 'GET', path: /^(me|bootstrap|metrics)$/, caps: [] },
  { method: 'GET', path: /^network-inventory$/, caps: ['platform'] },
  { method: 'POST', path: /^(password|logout)$/, caps: [] },
  { method: 'GET', path: /^team$/, caps: ['team'] },
  { method: 'GET', path: /^(directory|audit)$/, caps: ['platform', 'org'] },
  { method: 'GET', path: /^advertiser\/[^/]+$/, caps: ['sales'] },
  { method: 'POST', path: /^advertiser\/[^/]+(?:\/(archive|restore))?$/, caps: ['sales'] },
  { method: 'GET', path: /^(users|settings)$/, caps: ['platform'] },
  { method: 'POST', path: /^(invite)$/, caps: ['team'] },
  { method: 'POST', path: /^user\/[^/]+$/, caps: [] },
  { method: 'POST', path: /^user\/[^/]+\/(role|status|newpassword)$/, caps: ['team'] },
  { method: 'GET', path: /^campaign\/[^/]+$/, caps: [] },
  { method: 'POST', path: /^campaign(?:\/[^/]+)?$/, caps: ['sales'] },
  // Review workflow (doc 31 Phase 5): the seller submits and activates; only the platform reviews content.
  { method: 'POST', path: /^campaign\/[^/]+\/(submit|activate)$/, caps: ['sales'] },
  { method: 'POST', path: /^campaign\/[^/]+\/review$/, caps: ['platform'] },
  { method: 'GET', path: /^review-queue$/, caps: ['platform'] },
  // Campaign drafts: creator-only, never read by playback, inventory, settlement or bootstrap.
  { method: 'POST', path: /^campaign-draft(?:\/[^/]+(?:\/(discard|submit))?)?$/, caps: ['sales'] },
  { method: 'GET', path: /^campaign-draft\/[^/]+$/, caps: ['sales'] },
  { method: 'GET', path: /^campaign-drafts$/, caps: ['sales'] },
  { method: 'POST', path: /^(creative|advertiser)$/, caps: ['sales'] },
  { method: 'POST', path: /^creative\/[^/]+$/, caps: ['sales'] },
  { method: 'POST', path: /^creative\/[^/]+\/approve$/, caps: ['platform'] },
  { method: 'GET', path: /^creative\/[^/]+\/asset$/, caps: ['sales'] },
  { method: 'GET', path: /^creative\/[^/]+\/preview$/, caps: ['sales'] },
  { method: 'POST', path: /^creative\/[^/]+\/asset$/, caps: ['sales'] },
  { method: 'POST', path: /^screen\/[^/]+\/test(?:\/[^/]+\/revoke)?$/, caps: ['screens'] },
  { method: 'GET', path: /^screen\/[^/]+$/, caps: ['screens', 'sales'] },
  { method: 'POST', path: /^screens(?:\/[^/]+\/(pairing|revoke-device))?$/, caps: ['screens'] },
  { method: 'POST', path: /^group(?:\/(?!resolve$)[^/]+)?$/, caps: ['screens'] },
  { method: 'POST', path: /^screen\/[^/]+\/attention$/, caps: ['platform'] },
  { method: 'POST', path: /^screen\/[^/]+(?:\/(exclusions|config|reprice))?$/, caps: ['screens'] },
  { method: 'POST', path: /^group\/resolve$/, caps: ['screens', 'sales'] },
  { method: 'POST', path: /^(org|settings|reset)$/, caps: ['platform'] },
  { method: 'POST', path: /^org\/[^/]+$/, caps: ['org'] },
  { method: 'GET', path: /^config(?:\/schema)?$/, caps: ['screens'] },
  { method: 'POST', path: /^config(?:\/[^/]+(?:\/delete)?)?$/, caps: ['screens'] },
];
const ADVERTISER_EDIT = ['name','contact','email','phone','category','notes','exclusions'];
const SCREEN_EDIT = ['name','venue_name','venue_type','address','photo_url','size_in','orientation','aspect',
  'venue_base','size_factor','location_factor','location_tier','exposure_factor','exposure_source','advertiser_slots',
  'loop_length_s','slot_duration_s','min_creative_duration_s','max_creative_duration_s','operating_hours','owner_share_pct','network_slots','network_available',
  'tags','has_camera','status','geo_lat','geo_lng'];
const CAMPAIGN_EDIT = ['name','starts_at','ends_at','committed_budget','rate_type','rate_value','status','invoice_status','screen_ids','creative_ids','bookings','dayparts'];
const CONFIG_EDIT = ['name','description','tags','layer','target_id','priority','target_platform','values','status'];
const SETTINGS_EDIT = ['platform_name','default_fee_pct','support_email','blocked_categories','category_blocklist'];
const ORG_EDIT = ['name','legal_name','support_email','phone','website','registered_address','billing_address'];
const ORG_MONEY = ['gstin','pan','state_code','payout_method','upi_id','payout_note'];
const SCREEN_MONEY = ['venue_base','size_factor','location_factor','exposure_factor','exposure_source','monthly_value',
  'slot_price_month','owner_share_pct','priced_against'];
/** Fields that re-derive a screen's price or its sellable inventory. Writing one is a pricing action even when
 *  the field itself carries no rupee value, so it needs the same access as writing the price outright. */
const SCREEN_PRICING_INPUTS = [...SCREEN_MONEY, 'advertiser_slots', 'loop_length_s', 'slot_duration_s', 'network_slots', 'network_available'];
function rejectUnknown(body: any, allowed: string[]) {
  if (Object.keys(body).some(k => !allowed.includes(k))) fail(400, 'Unsupported field');
}
function ids(value: any): string[] {
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string') || new Set(value).size !== value.length)
    fail(400, 'Expected a list of unique IDs');
  return value;
}
function configValues(values: any) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) fail(400, 'Invalid configuration values');
  if (Object.keys(values).some(k => !Object.hasOwn(BY_KEY, k))) fail(400, 'Unknown configuration key');
  for (const [key,value] of Object.entries(values)) {
    const def = BY_KEY[key];
    if (def.ctl === 'derived' && JSON.stringify(value) !== JSON.stringify(def.def)) fail(400, 'Privacy and derived guarantees cannot be changed');
    if (def.ctl === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) fail(400, 'Invalid numeric setting');
    if (def.ctl === 'rect' && (!value || typeof value !== 'object' || Array.isArray(value) || ['x','y','w','h'].some(k => typeof (value as any)[k] !== 'number' || !Number.isFinite((value as any)[k]) || (value as any)[k] < 0) || (value as any).w <= 0 || (value as any).h <= 0 || (value as any).x + (value as any).w > 100 || (value as any).y + (value as any).h > 100)) fail(400, 'Invalid percentage rectangle');
    if (def.ctl === 'toggle' && typeof value !== 'boolean') fail(400, 'Invalid toggle setting');
    if (def.ctl === 'select' && def.options && !def.options.map(o => Array.isArray(o) ? o[0] : o).includes(value as string)) fail(400, 'Unsupported setting option');
  }
  for (const key of ['loop_length_s','slot_duration_s','heartbeat_s','count_ceiling']) if (key in values && (!Number.isInteger(values[key]) || values[key] < 1 || values[key] > 86400)) fail(400, 'Invalid positive integer setting');
  if ('count_ceiling' in values && values.count_ceiling > 500) fail(400, 'Count ceiling may not exceed 500');
  if ('sample_interval_s' in values && values.sample_interval_s !== 2) fail(400, 'Measurement interval is fixed at two seconds');
  if ('confidence_min' in values && (values.confidence_min < 0 || values.confidence_min > 1)) fail(400, 'Confidence must be between zero and one');
}
function configValid(db: any, c: any, actor: any) {
  if (!['platform','org','group','screen'].includes(c.layer)) fail(400, 'Unknown config layer');
  if (c.layer === 'platform' && !admin(actor)) fail(403, 'Only platform admins can change platform configuration');
  org(db, c.org_id, actor);
  if (c.layer === 'screen' || c.layer === 'group') {
    const target = own(c.layer === 'screen' ? db.screens : db.groups, c.target_id, actor);
    if (target.org_id !== c.org_id) fail(400, 'Config and target must belong to the same organisation');
  } else if (c.target_id != null) fail(400, 'This layer has no target');
  configValues(c.values);
  if (c.layer !== 'platform' && Object.keys(c.values).some(k => LOCKED_KEYS.includes(k)))
    fail(403, 'Locked settings can only be changed at the platform layer');
}
function teamTarget(db: any, id: string, actor: any) {
  const u = own(db.users, id, actor);
  if (u.id !== actor.id && !can(actor.role, 'team')) fail(403, 'You cannot edit another account');
  if (!admin(actor) && u.id !== actor.id && (u.role === PLATFORM_ADMIN ||
      (actor.role === 'manager' && ['owner','org_admin'].includes(u.role))))
    fail(403, 'You cannot manage an account above your role');
  return u;
}
/** Ownership and relation checks for a campaign body. Activation re-runs this, so it is exported. */
export function campaignRelations(db: any, c: any, actor: any) {
  const origin = org(db, c.org_id, actor);
  if (c.campaign_type === 'network' && (!admin(actor) || origin.type !== 'gridcast' || c.origin_org_id !== c.org_id)) fail(403, 'Only platform administrators can manage Gridcast network campaigns');
  if (c.campaign_type === 'network' && c.rate_type !== 'per_play') fail(400, 'Network campaigns currently support per-play pricing only');
  const adv = db.advertisers.find((a: any) => a.id === c.advertiser_id);
  // Network campaigns deliberately reference the originating organisation's advertiser/creative.
  const sourceOrg = c.campaign_type === 'network' ? c.origin_org_id : c.org_id;
  if (!adv || adv.org_id !== sourceOrg) fail(400, 'Advertiser does not belong to this campaign');
  if (adv.status === 'archived') fail(409, 'Restore this advertiser before creating or changing campaigns');
  for (const id of ids(c.screen_ids)) {
    const s = own(db.screens, id, actor);
    if (c.campaign_type !== 'network' && s.org_id !== c.org_id) fail(400, 'Campaign screens must belong to the receiving organisation');
  }
  for (const id of ids(c.creative_ids)) {
    const cr = db.creatives.find((x: any) => x.id === id);
    if (!cr || cr.org_id !== sourceOrg || cr.advertiser_id !== adv.id || cr.purpose === 'filler') fail(400, 'Creative does not belong to this advertiser');
  }
}

/** POST /campaign authorization. Draft submit calls this same function, so both paths share one rule set. */
export function authorizeCampaignCreate(db: any, actor: any, input: any) {
  let body = { ...input };
  const orgId = body.org_id || actor.org_id;
  org(db, orgId, actor);
  rejectUnknown(body, [...CAMPAIGN_EDIT, 'org_id', 'advertiser_id', 'campaign_type']);
  if ('invoice_status' in body && !can(actor.role, 'money')) fail(403, 'Billing requires money access');
  if (!['operator','network'].includes(body.campaign_type || 'operator')) fail(400,'Unknown campaign type');
  body = { ...body, org_id: orgId, origin_org_id: orgId, campaign_type:body.campaign_type || 'operator' };
  campaignRelations(db, body, actor);
  return body;
}

/**
 * Generic campaign edits may pause, resume, complete or cancel (doc 31 Phase 5). A draft or pending campaign
 * goes live only through POST /campaign/:id/activate, which requires approved creatives and revalidates.
 * Pausing is allowed only from active, so pending → paused → active cannot be used as a detour.
 */
export function campaignStatusChange(from: string, to: string) {
  if (from === to || to === 'complete' || to === 'cancelled') return;
  if ((from === 'active' && to === 'paused') || (from === 'paused' && to === 'active')) return;
  if (to === 'active') fail(409, 'A draft or pending campaign goes live through review: submit it for review, or activate it once every creative is approved');
  fail(409, `A ${from} campaign cannot be set to ${to}`);
}
const REVIEW_DECISIONS = ['approved', 'rejected'];

const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const money = (v: any) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e12;
/** Type checks for the fields a draft may carry. Nothing is required; null clears a field; nothing defaults to zero. */
function draftFields(input: any) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Invalid draft fields');
  rejectUnknown(input, [...DRAFT_FIELDS]);
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(input) as [string, any][]) {
    if (value === null) { out[key] = null; continue; }
    if (key === 'name') { if (typeof value !== 'string' || value.length > 200) fail(400, 'Campaign name must be text of up to 200 characters'); out.name = value; }
    else if (key === 'starts_at' || key === 'ends_at') {
      const at = typeof value === 'string' && DATE.test(value) ? Date.parse(value + 'T00:00:00Z') : NaN;
      if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== value) fail(400, 'Dates must be valid YYYY-MM-DD dates');
      out[key] = value;
    } else if (key === 'dayparts') {
      if (!Array.isArray(value) || value.length > 4 || value.some((w: any) => !w || typeof w !== 'object' || Array.isArray(w) || Object.keys(w).some(k => !['from','to'].includes(k)) || !TIME.test(w.from) || !TIME.test(w.to))) fail(400, 'Daily windows must use HH:MM times');
      out.dayparts = value.map((w: any) => ({ from: w.from, to: w.to }));
    } else if (key === 'screen_ids' || key === 'creative_ids') {
      if (ids(value).length > 2000) fail(400, 'Too many IDs');
      out[key] = value;
    } else if (key === 'bookings') {
      if (!Array.isArray(value) || value.length > 2000 || value.some((b: any) => !b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !['screen_id','rotation_weight'].includes(k)) || typeof b.screen_id !== 'string' || !Number.isInteger(b.rotation_weight) || b.rotation_weight < 1 || b.rotation_weight > 100)
        || new Set(value.map((b: any) => b.screen_id)).size !== value.length) fail(400, 'Turns per round must be whole numbers from 1 to 100, one per screen');
      out.bookings = value.map((b: any) => ({ screen_id: b.screen_id, rotation_weight: b.rotation_weight }));
    } else if (key === 'rate_type') { if (!['per_play','flat'].includes(value as string)) fail(400, 'Unknown rate type'); out.rate_type = value; }
    else if (key === 'rate_value' || key === 'committed_budget') { if (!money(value)) fail(400, 'Rate and budget must be finite numbers of zero or more'); out[key] = value; }
  }
  return out;
}
/** The subset of campaignRelations that applies to an incomplete draft. Capacity, economics and dates wait for submit. */
function draftRelations(db: any, d: any, actor: any) {
  const origin = org(db, d.org_id, actor);
  if (!['operator','network'].includes(d.campaign_type)) fail(400, 'Choose a campaign type');
  if (d.campaign_type === 'network' && (!admin(actor) || origin.type !== 'gridcast')) fail(403, 'Only platform administrators can manage Gridcast network campaigns');
  const f = d.fields || {};
  if (d.campaign_type === 'network' && f.rate_type != null && f.rate_type !== 'per_play') fail(400, 'Network campaigns currently support per-play pricing only');
  let adv: any = null;
  if (d.advertiser_id != null) {
    if (typeof d.advertiser_id !== 'string') fail(400, 'Invalid advertiser');
    adv = db.advertisers.find((a: any) => a.id === d.advertiser_id);
    if (!adv || adv.org_id !== d.org_id) fail(400, 'Advertiser does not belong to this campaign');
    if (adv.status === 'archived') fail(409, 'Restore this advertiser before creating or changing campaigns');
  }
  for (const id of f.screen_ids || []) {
    const s = own(db.screens, id, actor);
    if (d.campaign_type !== 'network' && s.org_id !== d.org_id) fail(400, 'Campaign screens must belong to the receiving organisation');
  }
  if ((f.bookings || []).some((b: any) => !(f.screen_ids || []).includes(b.screen_id))) fail(400, 'Bookings must target selected screens');
  if ((f.creative_ids || []).length && !adv) fail(400, 'Choose an advertiser before adding creatives');
  for (const id of f.creative_ids || []) {
    const cr = db.creatives.find((x: any) => x.id === id);
    if (!cr || cr.org_id !== d.org_id || cr.advertiser_id !== adv.id || cr.purpose === 'filler') fail(400, 'Creative does not belong to this advertiser');
  }
}
/** Draft routes. Another user's or another organisation's draft is 404, never 403, so existence does not leak. */
function authorizeDraft(db: any, actor: any, method: string, seg: string[], input: any, q: URLSearchParams) {
  const [entity, id, action] = seg;
  if (entity === 'campaign-drafts') { rejectUnknown(input, []); const scope = q.get('org') || q.get('org_id'); if (scope) org(db, scope, actor); return {}; }
  if (!id) {
    rejectUnknown(input, ['org_id','campaign_type','advertiser_id','step','fields']);
    const orgId = input.org_id || actor.org_id;
    if (typeof orgId !== 'string') fail(400, 'Choose an organisation');
    if (input.step !== undefined && !DRAFT_STEPS.includes(input.step)) fail(400, 'Unknown draft step');
    const fields = Object.fromEntries(Object.entries(draftFields(input.fields ?? {})).filter(([, v]) => v !== null));
    const draft = { org_id: orgId, campaign_type: input.campaign_type, advertiser_id: input.advertiser_id ?? null, step: input.step ?? 'basics', fields };
    draftRelations(db, draft, actor);
    return draft;
  }
  const draft = (db.campaign_drafts || []).find((d: any) => d.id === id);
  if (!draftVisibleTo(draft, actor)) fail(404, 'Not found');
  if (method === 'GET') return {};
  if (draft.submitted_campaign_id && action !== 'submit') fail(409, 'This draft was submitted and is read-only');
  if (action === 'discard') { rejectUnknown(input, []); return {}; }
  if (action === 'submit') {
    rejectUnknown(input, ['mode']);
    if (!['submit','launch'].includes(input.mode)) fail(400, 'Choose submit or launch');
    return { mode: input.mode };
  }
  rejectUnknown(input, ['revision','step','fields','advertiser_id','campaign_type']);
  if (!Number.isInteger(input.revision)) fail(400, 'Draft revision is required');
  if (input.step !== undefined && !DRAFT_STEPS.includes(input.step)) fail(400, 'Unknown draft step');
  const patch = draftFields(input.fields ?? {});
  const fields = { ...draft.fields, ...patch };
  for (const k of Object.keys(fields)) if (fields[k] === null) delete fields[k];
  const next = { ...draft, fields, ...('advertiser_id' in input ? { advertiser_id: input.advertiser_id } : {}), ...('campaign_type' in input ? { campaign_type: input.campaign_type } : {}), ...(input.step !== undefined ? { step: input.step } : {}) };
  draftRelations(db, next, actor);
  return { revision: input.revision, step: next.step, fields, advertiser_id: next.advertiser_id ?? null, campaign_type: next.campaign_type };
}

/** Validate all targets before the dispatcher mutates any of them. Returns a whitelisted body. */
export function authorize(db: any, actor: any, method: string, seg: string[], input: any, q: URLSearchParams) {
  const path = seg.join('/');
  const rule = ROUTES.find(r => r.method === method && r.path.test(path));
  if (!rule) return fail(404, 'Not found');
  if (rule.caps.length && !rule.caps.some(c => can(actor.role, c))) fail(403, 'Not permitted for this role');
  if (actor.must_change && !['me','password','logout'].includes(path)) fail(403, 'Change your temporary password first');
  let body = { ...input };
  const [entity, id, action] = seg;
  const externalKey = body.external_key;
  if (externalKey !== undefined) {
    if (!admin(actor)) fail(403,'External keys are platform-only');
    if (method !== 'POST' || id || !['org','screens','advertiser','creative','campaign'].includes(entity) || typeof externalKey !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,119}$/.test(externalKey)) fail(400,'Invalid external key');
    delete body.external_key;
  }
  if (path === 'reset' && (process.env.NODE_ENV === 'production' || process.env.GC_ALLOW_RESET !== '1')) fail(403, 'Reset is disabled');
  const requestedOrg = q.get('org') || q.get('org_id');
  if (['team','bootstrap','directory','audit','config','network-inventory','metrics'].includes(path) && requestedOrg) org(db, requestedOrg, actor);
  if (path === 'metrics') {
    if (!admin(actor) && actor.role !== ADVERTISER && !can(actor.role,'screens') && !can(actor.role,'sales') && !can(actor.role,'money')) fail(403,'Not permitted for this role');
    const campaignId = q.get('campaign'), screenId = q.get('screen');
    if (campaignId && !db.campaigns.some((c: any) => c.id === campaignId && campaignVisible(c,actor))) fail(404,'Not found');
    if (screenId && actor.role !== ADVERTISER) own(db.screens,screenId,actor);
  }
  if (entity === 'advertiser' && id) {
    const a = own(db.advertisers, id, actor);
    if (method === 'POST') {
      rejectUnknown(body, action ? [] : ADVERTISER_EDIT);
      if (action === 'archive' && db.campaigns.some((c: any) => c.advertiser_id === a.id && ['active','pending','paused'].includes(c.status)))
        fail(409, 'Pause is not archive: finish or cancel all active, pending and paused campaigns before archiving');
    }
  }
  if (entity === 'campaign' && id) {
    const c = db.campaigns.find((x: any) => x.id === id);
    if (!c || !campaignVisible(c, actor)) fail(404, 'Not found');
    if (method === 'POST') {
      if (c.campaign_type === 'network' && !admin(actor)) fail(403, 'Network campaigns are managed by the platform');
      if (!action) {
        rejectUnknown(body, CAMPAIGN_EDIT);
        if ('invoice_status' in body && !can(actor.role, 'money')) fail(403, 'Billing requires money access');
        if ('status' in body) campaignStatusChange(c.status, body.status);
        campaignRelations(db, { ...c, ...body }, actor);
      } else if (action === 'submit') {
        rejectUnknown(body, []);
        campaignRelations(db, c, actor);
      } else if (action === 'activate') {
        // Relations, dates, capacity and budget are rechecked inside the activation attempt, so a failure is
        // recorded on the campaign as review.activation_error instead of being lost.
        rejectUnknown(body, []);
      } else if (action === 'review') {
        rejectUnknown(body, ['creatives', 'note']);
        const decisions = body.creatives ?? {};
        if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions)) fail(400, 'Expected creative decisions as {creative id: approved | rejected}');
        if (Object.keys(decisions).length > 200) fail(400, 'Too many creative decisions');
        for (const [cid, decision] of Object.entries(decisions)) {
          if (!(c.creative_ids || []).includes(cid)) fail(400, 'Only creatives assigned to this campaign can be reviewed here');
          if (!REVIEW_DECISIONS.includes(decision as string)) fail(400, 'Each creative decision must be approved or rejected');
        }
        if (body.note !== undefined && body.note !== null && (typeof body.note !== 'string' || body.note.length > 1000)) fail(400, 'The review note must be text of up to 1000 characters');
        body = { creatives: { ...decisions }, note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null };
      }
    }
  }
  if (path === 'campaign' && method === 'POST') body = authorizeCampaignCreate(db, actor, body);
  if (entity === 'campaign-draft' || entity === 'campaign-drafts') body = authorizeDraft(db, actor, method, seg, body, q);
  if ((path === 'creative' || path === 'advertiser') && method === 'POST') {
    const orgId = body.org_id || actor.org_id; org(db, orgId, actor);
    const allowed = path === 'creative' ? ['org_id','advertiser_id','name','category','youtube_id','duration_s','aspect','media_type','purpose']
      : ['org_id', ...ADVERTISER_EDIT];
    rejectUnknown(body, allowed);
    if (path === 'creative' && body.purpose !== 'filler') {
      const a = own(db.advertisers, body.advertiser_id, actor);
      if (a.org_id !== orgId) fail(400, 'Advertiser must belong to the creative organisation');
      if (a.status === 'archived') fail(409, 'Restore this advertiser before adding creatives');
    }
    body.org_id = orgId;
  }
  if (entity === 'advertiser' && method === 'POST' && 'exclusions' in body) {
    const ex = body.exclusions;
    if (!ex || typeof ex !== 'object' || Array.isArray(ex)) fail(400,'Invalid exclusions');
    rejectUnknown(ex,['venue_types','screens','tag_rules']);
    const venues = ids(ex.venue_types || []), screens = ids(ex.screens || []);
    if (venues.length > 100 || venues.some(v => !v.trim() || v.length > 100) || screens.length > 2000) fail(400,'Too many or invalid exclusions');
    for (const sid of screens) own(db.screens,sid,actor);
    const rules = ex.tag_rules || [];
    if (!Array.isArray(rules) || rules.length > 100 || rules.some((r: any) => !r || typeof r !== 'object' || Array.isArray(r) || !Object.keys(r).length || Object.keys(r).length > 20 || Object.entries(r).some(([k,v]) => ['__proto__','constructor','prototype'].includes(k) || !k.trim() || k.length > 100 || typeof v !== 'string' || !v.trim() || v.length > 200))) fail(400,'Invalid tag exclusion rule');
    body.exclusions = {venue_types:venues,screens,tag_rules:rules};
  }
  if (entity === 'creative' && id) {
    const creative = own(db.creatives, id, actor);
    if (method === 'POST' && !action) {
      rejectUnknown(body, ['name','category','source','youtube_id','duration_s']);
      if ('source' in body && body.source !== 'youtube') fail(400, 'Choose YouTube or upload a verified media file');
      const existingYoutubeEdit = body.source === undefined && creative.media_type !== 'image' && !creative.assets?.length && !!creative.youtube_id;
      if ('youtube_id' in body && body.source !== 'youtube' && !existingYoutubeEdit)
        fail(400, 'Choose YouTube as the creative source before setting a video ID');
      if ('duration_s' in body && body.source !== 'youtube' && !existingYoutubeEdit && creative.media_type !== 'image')
        fail(400, 'Uploaded video metadata comes from the file. Choose YouTube to change the source.');
      if ((body.source === 'youtube' || existingYoutubeEdit) && creative.purpose === 'filler') fail(400, 'Filler must use uploaded media');
    }
    if (method === 'POST' && db.advertisers.some((a: any) => a.id === creative.advertiser_id && a.status === 'archived')) fail(409, 'Restore this advertiser before changing creatives');
    if (action === 'asset' && method === 'POST') {
      rejectUnknown(body,['proof','replace_mode','name','category']);
      if (body.replace_mode !== undefined && !['append','replace_all'].includes(body.replace_mode)) fail(400,'Choose whether to add a variation or replace active media');
    }
    if (action === 'approve' && !['approved','rejected','pending'].includes(body.status || 'approved')) fail(400, 'Unknown approval state');
  }
  if (entity === 'screen' && id) {
    own(db.screens, id, actor);
    if (action === 'test') rejectUnknown(body, []);
    if (method === 'POST' && !action) {
      rejectUnknown(body, SCREEN_EDIT);
      if (!can(actor.role, 'money') && 'owner_share_pct' in body) fail(403, 'Owner shares require money access');
      if (!can(actor.role, 'sales') && SCREEN_PRICING_INPUTS.some(k => k in body)) fail(403, 'Pricing requires sales access');
    }
    if (action === 'exclusions') {
      const ex = body.exclusions;
      if (!ex || !Array.isArray(ex.categories)) fail(400, 'Invalid exclusions');
      for (const aid of ids(ex.advertisers || [])) {
        const a = db.advertisers.find((x: any) => x.id === aid);
        const participant = db.campaigns.some((c: any) => campaignVisible(c,actor) && c.screen_ids?.includes(id) && c.advertiser_id === aid);
        if (!a || (!admin(actor) && a.org_id !== actor.org_id && !participant)) fail(404, 'Not found');
      }
    }
    if (action === 'reprice' && !can(actor.role, 'sales')) fail(403, 'Pricing requires sales access');
    if (action === 'config') {
      rejectUnknown(body, ['values','unset']);
      if (body.values != null) configValues(body.values);
      if (body.unset != null) for (const key of ids(body.unset)) {
        if (!Object.hasOwn(BY_KEY, key)) fail(400, 'Unknown configuration key');
        if (LOCKED_KEYS.includes(key)) fail(403, 'Locked settings can only be changed at the platform layer');
      }
    }
  }
  if (entity === 'screens') {
    if (id) { own(db.screens, id, actor); rejectUnknown(body, []); }
    else {
      const orgId = body.org_id || actor.org_id; org(db, orgId, actor);
      rejectUnknown(body, [...SCREEN_EDIT, 'org_id','city','area','mount_notes','resolution_w','resolution_h','rate_seed']);
      if (!can(actor.role, 'sales')) fail(403, 'Screen onboarding requires pricing access');
      if (!can(actor.role, 'money') && body.owner_share_pct) fail(403, 'Owner shares require money access');
      body.org_id = orgId;
    }
  }
  if (entity === 'group' && id !== 'resolve') {
    const old = id ? own(db.groups, id, actor) : null;
    rejectUnknown(body, ['name','org_id','group_type','screen_ids','rule_json']);
    const orgId = old?.org_id || body.org_id || actor.org_id; org(db, orgId, actor);
    if (old && body.org_id && body.org_id !== old.org_id) fail(400,'Cannot move group to another organisation');
    body = { ...old, ...body, org_id: orgId };
    if (typeof body.name !== 'string' || !body.name.trim() || !['static','dynamic'].includes(body.group_type)) fail(400,'Invalid group');
    if (body.group_type === 'static') for (const sid of ids(body.screen_ids || [])) { const screen = own(db.screens,sid,actor); if (screen.org_id !== orgId) fail(400,'Group screens must share an organisation'); }
    else {
      const r = body.rule_json;
      if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some(k => !['venue_types','min_size','location_tier','city','area','tags'].includes(k))) fail(400,'Invalid group rule');
      if (r.venue_types !== undefined && (!Array.isArray(r.venue_types) || r.venue_types.some((v: any) => typeof v !== 'string' || !v.trim()))) fail(400,'Invalid venue type rule');
      if (r.min_size !== undefined && (typeof r.min_size !== 'number' || !Number.isFinite(r.min_size) || r.min_size <= 0)) fail(400,'Invalid size rule');
      if (r.location_tier !== undefined && !['prime','good','standard','peripheral'].includes(r.location_tier)) fail(400,'Invalid location tier');
      for (const k of ['city','area']) if (r[k] !== undefined && (typeof r[k] !== 'string' || r[k].length > 1000)) fail(400,'Invalid location rule');
      if (r.tags !== undefined && (!r.tags || typeof r.tags !== 'object' || Array.isArray(r.tags) || Object.entries(r.tags).some(([k,v]) => ['__proto__','constructor','prototype'].includes(k) || !k.trim() || typeof v !== 'string'))) fail(400,'Invalid tag rule');
    }
  }
  if (path === 'group/resolve') {
    const g = own(db.groups || [], body.group_id, actor);
    if (body.org_id && body.org_id !== g.org_id) fail(404, 'Not found');
    body.org_id = g.org_id;
  }
  if (path === 'settings' && method === 'POST') {
    rejectUnknown(body, SETTINGS_EDIT);
    if ('default_fee_pct' in body && (typeof body.default_fee_pct !== 'number' || !Number.isFinite(body.default_fee_pct) || body.default_fee_pct < 0 || body.default_fee_pct > 100))
      fail(400, 'Platform fee must be a percentage between 0 and 100');
    for (const k of ['blocked_categories','category_blocklist']) if (k in body) ids(body[k]);
  }
  if (entity === 'org' && method === 'POST') {
    if ('platform_fee_pct' in body && (typeof body.platform_fee_pct !== 'number' || !Number.isFinite(body.platform_fee_pct) || body.platform_fee_pct < 0 || body.platform_fee_pct > 100 || Math.abs(body.platform_fee_pct * 100 - Math.round(body.platform_fee_pct * 100)) > .000001)) fail(400,'Invalid platform fee percentage');
    if ('fee_basis' in body && !['gross','net_of_owner_share'].includes(body.fee_basis)) fail(400,'Invalid fee basis');
    if (id) {
      org(db, id, actor);
      if (!can(actor.role, 'money') && ORG_MONEY.some(k => k in body)) fail(403, 'Billing requires money access');
      if (!admin(actor) && ['platform_fee_pct','fee_basis','type','status','_as'].some(k => k in body)) fail(403, 'Platform-only field');
      rejectUnknown(body, [...ORG_EDIT, ...ORG_MONEY, ...(admin(actor) ? ['platform_fee_pct','fee_basis','type','status','_as'] : [])]);
      delete body._as;
    } else {
      rejectUnknown(body, [...ORG_EDIT, 'platform_fee_pct','fee_basis','type','admin_email','admin_name']);
      // A platform retry returns the existing organisation before any user or audit mutation.
      // Its already-created owner is not a conflicting new login; a different key still is.
      const reusesOrganisation = externalKey !== undefined && db.orgs.some((o: any) => o.external_key === externalKey);
      if (!reusesOrganisation && body.admin_email && db.users.some((u: any) => u.email.toLowerCase() === String(body.admin_email).trim().toLowerCase()))
        fail(409, 'That email already has a login');
      if (body.admin_email) body.admin_email = String(body.admin_email).trim().toLowerCase();
    }
  }
  if (entity === 'user' && id) {
    const u = teamTarget(db, id, actor);
    if (action === 'role' && !assignable(actor.role).some(r => r.id === body.role)) fail(403, 'You cannot assign this role');
    if (action === 'status' && body.status === 'disabled' && ['owner','org_admin'].includes(u.role)) {
      const owners = db.users.filter((x: any) => x.org_id === u.org_id && x.status !== 'disabled' && ['owner','org_admin'].includes(x.role));
      if (owners.length <= 1) fail(400, 'The organisation must retain an active owner');
    }
    if (!action) {
      rejectUnknown(body, ['name','email','phone']);
      if ('email' in body) {
        body.email = String(body.email).trim().toLowerCase();
        if (!body.email.includes('@')) fail(400, 'Invalid email');
        if (db.users.some((x: any) => x.id !== u.id && x.email.toLowerCase() === body.email)) fail(409, 'Email already in use');
      }
    }
  }
  if (path === 'invite') {
    const orgId = body.org_id || actor.org_id; org(db, orgId, actor);
    if (body.role !== ADVERTISER && !assignable(actor.role).some(r => r.id === body.role)) fail(403, 'You cannot assign this role');
    if (body.role === ADVERTISER) {
      const a = own(db.advertisers, body.advertiser_id, actor);
      if (a.org_id !== orgId) fail(400, 'Advertiser must belong to the invited organisation');
      if (a.status === 'archived') fail(409, 'Restore this advertiser before inviting users');
    } else if (body.advertiser_id) fail(400, 'Only advertiser accounts may have an advertiser ID');
  }
  if (entity === 'config' && method === 'POST') {
    if (id === 'assign') {
      const c = (db.configs || []).find((x: any) => x.id === body.config_id);
      if (!c || (!admin(actor) && c.org_id !== actor.org_id && c.layer !== 'platform')) fail(404, 'Not found');
      configValues(c.values || {});
      if (Object.keys(c.values || {}).some(k => LOCKED_KEYS.includes(k))) fail(403, 'Locked settings cannot be copied to screen overrides');
      for (const sid of ids(body.screen_ids)) {
        const s = own(db.screens, sid, actor);
        if (c.layer !== 'platform' && c.org_id !== s.org_id) fail(400, 'Config and screens must share an organisation');
      }
    } else if (id) {
      const c = own(db.configs || [], id, actor);
      if (c.layer === 'platform' && !admin(actor)) fail(403, 'Only platform admins can change platform configuration');
      if (!action) { rejectUnknown(body, CONFIG_EDIT); configValid(db, { ...c, ...body }, actor); }
    } else {
      rejectUnknown(body, [...CONFIG_EDIT, 'org_id']);
      body = { layer: 'group', target_id: null, values: {}, ...body, org_id: body.org_id || actor.org_id };
      configValid(db, body, actor);
    }
  }
  return externalKey === undefined ? body : {...body,external_key:externalKey};
}

export function advertiserView(a: any, actor: any) {
  if (!a) return null;
  return a.org_id === actor.org_id || admin(actor) ? a : pick(a, ['id','org_id','name','category']);
}
export const capabilities = (actor: any) => (['screens','sales','money','team','org','platform'] as const).filter(c => can(actor.role, c));
const ORG_PUBLIC = ['id','name','type','status','support_email','website'];
export function orgView(o: any, actor: any) {
  if (!o) return null;
  if (admin(actor) || (o.id === actor.org_id && can(actor.role, 'money'))) return o;
  return pick(o, can(actor.role, 'org') && o.id === actor.org_id ? [...ORG_PUBLIC, ...ORG_EDIT] : ORG_PUBLIC);
}
export function screenView(s: any, actor: any) {
  if (!s) return null;
  // These screens are already scoped by the caller. Share freshness, never raw device/config details.
  const publicStatus = s._status ? pick(s._status, ['state','age_s','observed_at']) : undefined;
  if (actor.role === ADVERTISER) return { ...pick(s, ['id','org_id','name','status','venue_name','venue_type','address','size_in','orientation','aspect','photo_url']), ...(publicStatus ? { _status: publicStatus } : {}) };
  const out = { ...s };
  if (!can(actor.role, 'screens')) { delete out.code; if (publicStatus) out._status = publicStatus; else delete out._status; delete out.exclusions; delete out.priced_against; }
  if (!can(actor.role, 'money')) delete out.owner_share_pct;
  if (!can(actor.role, 'sales') && !can(actor.role, 'money')) for (const k of SCREEN_MONEY) delete out[k];
  if (actor.role !== PLATFORM_ADMIN) { delete out.attention_settings; delete out.attention_calibration; }
  return out;
}
export function settlementView(db: any, actor: any, campaignId?: string, orgId?: string | null) {
  const rows = (db.settlement_buckets || []).filter((b: any) => (!campaignId || b.campaign_id === campaignId) && (!orgId || b.org_id === orgId) &&
    (admin(actor) || (actor.role === ADVERTISER ? b.advertiser_id === actor.advertiser_id && db.campaigns.some((c: any) => c.id === b.campaign_id && campaignVisible(c,actor)) : b.org_id === actor.org_id)));
  if (actor.role === ADVERTISER) return rows.map((b: any) => pick(b,['id','campaign_id','screen_id','period','billable_plays','gross_paise','rate_value','rate_version','source','updated_at']));
  return rows.map((b: any) => can(actor.role,'money') ? b : pick(b,['id','campaign_id','screen_id','org_id','period','billable_plays','source','updated_at']));
}
const ADVERTISER_PLAY_FIELDS = ['id','campaign_id','screen_id','creative_id','kind','media_type','duration_ms','source','rendered','timestamp_valid','billable'] as const;
const ADVERTISER_PRESENCE_FIELDS = ['measured','avg_persons','sample_count','model_ver'] as const;
/**
 * Advertiser view of a play receipt: an allowlist of what the delivery report and campaign status need.
 * Device ids, assignment/sequence/payload identifiers, clock offsets and lag, non-billable reasons, measurement
 * bindings and org/ledger economics are withheld. Times are shifted to the server-applied clock so status and the
 * "When" column stay correct without exposing the offset itself. Operator/admin payloads are unchanged.
 */
export function advertiserPlayView(play: any, presence: any) {
  const offset = Number.isFinite(Number(play.applied_clock_offset_ms)) ? Number(play.applied_clock_offset_ms) : 0;
  const shift = (v: any) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t + offset).toISOString() : v; };
  return { ...pick(play, ADVERTISER_PLAY_FIELDS), started_at: shift(play.started_at_device ?? play.started_at), ended_at: shift(play.ended_at_device ?? play.ended_at),
    presence: presence ? pick(presence, ADVERTISER_PRESENCE_FIELDS) : null };
}
export function campaignView(db: any, c: any, actor: any, orgId?: string | null) {
  const all = admin(actor) || actor.role === ADVERTISER;
  const scopedOrg = orgId || (!all ? actor.org_id : null);
  const scopedNetwork = c.campaign_type === 'network' && !!scopedOrg;
  const ownScreens = new Set(db.screens.filter((s: any) => s.org_id === scopedOrg).map((s: any) => s.id));
  const buckets = settlementView(db,actor,c.id,scopedOrg);
  const out = {...c};
  if (c.campaign_type === 'network' || c.bookings?.some((b: any) => b.econ_version)) {
    out.accrued_spend = buckets.reduce((sum: number,b: any) => sum + (b.gross_paise || 0),0) / 100 + (c.campaign_type === 'network' ? 0 : (c.accrued_spend || 0));
    out.spend_source = c.campaign_type !== 'network' && c.accrued_spend ? 'legacy_accrual_and_verified_settlement' : 'settlement_buckets';
    // Do not present unavailable economics as zero to sales-only users.
    if (!all && !can(actor.role,'money')) delete out.accrued_spend;
  }
  if (scopedNetwork) {
    out.screen_ids = (c.screen_ids || []).filter((id: string) => ownScreens.has(id));
    out.bookings = (c.bookings || []).filter((b: any) => ownScreens.has(b.screen_id));
    for (const key of ['committed_budget','rate_type','rate_value','invoice_status','platform_fee_pct','fee_basis','participant_org_ids']) delete out[key];
    out.reporting_scope = 'organisation';
  }
  if (actor.role === ADVERTISER) out.bookings = (out.bookings || []).map((b: any) => pick(b,['screen_id','slots_per_loop','rotation_weight','rate_type','rate_value','rate_version','booked_at']));
  // Advertisers get the review state for status, not reviewer/seller user ids, reviewer notes or activation diagnostics
  // (doc 31 Phase 6). Eligibility decisions are already withheld from them by GET /campaign/:id.
  if (actor.role === ADVERTISER && out.review) out.review = pick(out.review,['state','submitted_at','decided_at']);
  return out;
}
export function bootstrap(db: any, actor: any, screenStatus: (s: any) => any, orgId?: string | null) {
  if (orgId && admin(actor)) {
    const campaignRows = db.campaigns.filter((c: any) => c.org_id === orgId || c.participant_org_ids?.includes(orgId));
    const advIds = new Set(campaignRows.map((c: any) => c.advertiser_id));
    const crIds = new Set(campaignRows.flatMap((c: any) => c.creative_ids || []));
    db = { ...db, campaigns: campaignRows, orgs: db.orgs.filter((o: any) => o.id === orgId || o.id === actor.org_id),
      advertisers: db.advertisers.filter((a: any) => a.org_id === orgId || advIds.has(a.id)),
      creatives: db.creatives.filter((c: any) => c.org_id === orgId || crIds.has(c.id)),
      ...Object.fromEntries(['screens','groups','devices','plays','presence','settlement_buckets'].map(k => [k, (db[k] || []).filter((r: any) => r.org_id === orgId)])),
      configs: (db.configs || []).filter((c: any) => c.org_id === orgId || c.layer === 'platform') };
  }
  const campaigns = db.campaigns.filter((c: any) => campaignVisible(c, actor)).map((c: any) => campaignView(db,c,actor,orgId && admin(actor) ? orgId : null));
  const campaignIds = new Set(campaigns.map((c: any) => c.id));
  const plays = db.plays.filter((p: any) => admin(actor) || (actor.role === ADVERTISER ? campaignIds.has(p.campaign_id) : p.org_id === actor.org_id)).slice(-1500);
  const playIds = new Set(plays.map((p: any) => p.id));
  const screenIds = new Set([...campaigns.flatMap((c: any) => c.screen_ids), ...plays.map((p: any) => p.screen_id), ...settlementView(db,actor).map((b: any) => b.screen_id)]);
  const advIds = new Set(campaigns.map((c: any) => c.advertiser_id));
  const crIds = new Set(campaigns.flatMap((c: any) => c.creative_ids));
  const advertiser = actor.role === ADVERTISER;
  const sales = can(actor.role, 'sales');
  const screens = db.screens.filter((s: any) => admin(actor) || (advertiser ? screenIds.has(s.id) : s.org_id === actor.org_id));
  return {
    pagination: db.pagination || {}, scope_org: orgId || null, history: db.history || { complete: true, scope: 'local_demo' }, config_version: db.settings?.config_revision || 1, user: publicUser(actor), org: orgView(db.orgs.find((o: any) => o.id === actor.org_id), actor), isAdmin: admin(actor),
    orgs: db.orgs.filter((o: any) => admin(actor) || o.id === actor.org_id).map((o: any) => orgView(o, actor)),
    screens: screens.map((s: any) => screenView({ ...s, _status: screenStatus(s) }, actor)),
    campaigns, settlement_buckets:settlementView(db,actor,undefined,orgId && admin(actor) ? orgId : null), advertisers: db.advertisers.filter((a: any) => admin(actor) || (sales && a.org_id === actor.org_id) || advIds.has(a.id))
      .map((a: any) => advertiserView(a, actor)),
    creatives: db.creatives.filter((c: any) => admin(actor) || (sales && c.org_id === actor.org_id) || crIds.has(c.id)),
    groups: (db.groups || []).filter((g: any) => admin(actor) || (!advertiser && g.org_id === actor.org_id)),
    devices: can(actor.role, 'screens') ? db.devices.filter((d: any) => admin(actor) || d.org_id === actor.org_id) : [],
    plays: [], presence: [],
    settings: admin(actor) ? db.settings || {} : {},
    configs: can(actor.role, 'screens') ? (db.configs || []).filter((c: any) => admin(actor) || c.org_id === actor.org_id || c.layer === 'platform') : [],
    caps: capabilities(actor),
  };
}

/** Response defence: no password material, including nested detail and mutation responses. */
export function redact(value: any, actor: any): any {
  if (Array.isArray(value)) return value.map(v => redact(v, actor));
  if (!value || typeof value !== 'object') return value;
  const hidden = new Set(['password_hash','password_salt','auth_version','token_hash','session_hash','pairing_code_hash','payload_hash','storage_path','frame','frame_url','preview_frame','frameUrl']);
  if (!can(actor?.role, 'money')) for (const k of [...ORG_MONEY, 'owner_share_pct']) hidden.add(k);
  if (!can(actor?.role, 'sales') && !can(actor?.role, 'money'))
    for (const k of [...SCREEN_MONEY, ...(actor?.role === ADVERTISER ? [] : ['committed_budget']),...(actor?.role === ADVERTISER ? [] : ['rate_value','accrued_spend','gross_paise','rate_paise']), 'platform_fee_pct','invoice_status']) hidden.add(k);
  if (!can(actor?.role, 'money')) for (const k of ['invoice_status','platform_fee_pct','fee_basis','fee_paise','owner_paise','net_paise','fee_version','econ_version']) hidden.add(k);
  if (!can(actor?.role, 'screens')) for (const k of ['code','priced_against','frameUrl','config','configStack','configConflicts','pricingDrift']) hidden.add(k);
  return Object.fromEntries(Object.entries(value).filter(([k]) => !hidden.has(k)).map(([k,v]) => [k, redact(v, actor)]));
}
