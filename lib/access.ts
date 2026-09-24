import { ADVERTISER, PLATFORM_ADMIN, assignable, can, type Cap } from './roles';
import { LOCKED_KEYS, BY_KEY } from './config';

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
  return admin(actor) || (c.org_id === actor.org_id && (actor.role === ADVERTISER
    ? !!actor.advertiser_id && c.advertiser_id === actor.advertiser_id
    : can(actor.role, 'sales') || can(actor.role, 'money')));
}

// Exact method/path policy: new business routes are denied until explicitly listed here.
// Empty capabilities mean a valid human session, not an anonymous route.
export const ROUTES: { method: string; path: RegExp; caps: Cap[] }[] = [
  { method: 'GET', path: /^(me|bootstrap)$/, caps: [] },
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
  { method: 'POST', path: /^(creative|advertiser)$/, caps: ['sales'] },
  { method: 'POST', path: /^creative\/[^/]+$/, caps: ['sales'] },
  { method: 'POST', path: /^creative\/[^/]+\/approve$/, caps: ['platform'] },
  { method: 'GET', path: /^creative\/[^/]+\/asset$/, caps: ['sales'] },
  { method: 'POST', path: /^creative\/[^/]+\/asset$/, caps: ['sales'] },
  { method: 'POST', path: /^screen\/[^/]+\/test(?:\/[^/]+\/revoke)?$/, caps: ['screens'] },
  { method: 'GET', path: /^screen\/[^/]+$/, caps: ['screens', 'sales'] },
  { method: 'POST', path: /^screens(?:\/[^/]+\/(pairing|revoke-device))?$/, caps: ['screens'] },
  { method: 'POST', path: /^group(?:\/(?!resolve$)[^/]+)?$/, caps: ['screens'] },
  { method: 'POST', path: /^screen\/[^/]+(?:\/(exclusions|config|reprice))?$/, caps: ['screens'] },
  { method: 'POST', path: /^group\/resolve$/, caps: ['screens', 'sales'] },
  { method: 'POST', path: /^(org|settings|reset)$/, caps: ['platform'] },
  { method: 'POST', path: /^org\/[^/]+$/, caps: ['org'] },
  { method: 'GET', path: /^config(?:\/schema)?$/, caps: ['screens'] },
  { method: 'POST', path: /^config(?:\/[^/]+(?:\/delete)?)?$/, caps: ['screens'] },
];
const ADVERTISER_EDIT = ['name','contact','email','phone','category','notes'];
const SCREEN_EDIT = ['name','venue_name','venue_type','address','photo_url','size_in','orientation','aspect',
  'venue_base','size_factor','location_factor','location_tier','exposure_factor','exposure_source','advertiser_slots',
  'loop_length_s','slot_duration_s','operating_hours','owner_share_pct','network_slots','network_available',
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
const SCREEN_PRICING_INPUTS = [...SCREEN_MONEY, 'advertiser_slots', 'loop_length_s', 'slot_duration_s'];
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
function campaignRelations(db: any, c: any, actor: any) {
  org(db, c.org_id, actor);
  const adv = db.advertisers.find((a: any) => a.id === c.advertiser_id);
  // Network campaigns deliberately reference the originating organisation's advertiser/creative.
  const sourceOrg = c.campaign_type === 'network' ? c.origin_org_id : c.org_id;
  if (!adv || adv.org_id !== sourceOrg) fail(400, 'Advertiser does not belong to this campaign');
  if (adv.status === 'archived') fail(409, 'Restore this advertiser before creating or changing campaigns');
  for (const id of ids(c.screen_ids)) {
    const s = own(db.screens, id, actor);
    if (s.org_id !== c.org_id) fail(400, 'Campaign screens must belong to the receiving organisation');
  }
  for (const id of ids(c.creative_ids)) {
    const cr = db.creatives.find((x: any) => x.id === id);
    if (!cr || cr.org_id !== sourceOrg || cr.advertiser_id !== adv.id) fail(400, 'Creative does not belong to this advertiser');
  }
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
  if (path === 'reset' && (process.env.NODE_ENV === 'production' || process.env.GC_ALLOW_RESET !== '1')) fail(403, 'Reset is disabled');
  const requestedOrg = q.get('org') || q.get('org_id');
  if (['team','bootstrap','directory','audit','config'].includes(path) && requestedOrg) org(db, requestedOrg, actor);
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
      rejectUnknown(body, CAMPAIGN_EDIT);
      if ('invoice_status' in body && !can(actor.role, 'money')) fail(403, 'Billing requires money access');
      campaignRelations(db, { ...c, ...body }, actor);
    }
  }
  if (path === 'campaign' && method === 'POST') {
    const orgId = body.org_id || actor.org_id;
    org(db, orgId, actor);
    rejectUnknown(body, [...CAMPAIGN_EDIT, 'org_id', 'advertiser_id']);
    if ('invoice_status' in body && !can(actor.role, 'money')) fail(403, 'Billing requires money access');
    body = { ...body, org_id: orgId, origin_org_id: orgId };
    campaignRelations(db, { ...body, campaign_type: 'operator' }, actor);
  }
  if ((path === 'creative' || path === 'advertiser') && method === 'POST') {
    const orgId = body.org_id || actor.org_id; org(db, orgId, actor);
    const allowed = path === 'creative' ? ['org_id','advertiser_id','name','category','youtube_id','duration_s','aspect']
      : ['org_id', ...ADVERTISER_EDIT];
    rejectUnknown(body, allowed);
    if (path === 'creative') {
      const a = own(db.advertisers, body.advertiser_id, actor);
      if (a.org_id !== orgId) fail(400, 'Advertiser must belong to the creative organisation');
      if (a.status === 'archived') fail(409, 'Restore this advertiser before adding creatives');
    }
    body.org_id = orgId;
  }
  if (entity === 'creative' && id) {
    const creative = own(db.creatives, id, actor);
    if (method === 'POST' && !action) {
      rejectUnknown(body, ['name','category','youtube_id','duration_s']);
      if (creative.assets?.length && ('youtube_id' in body || 'duration_s' in body)) fail(400, 'Uploaded video metadata cannot be edited; upload a new variation instead');
    }
    if (method === 'POST' && db.advertisers.some((a: any) => a.id === creative.advertiser_id && a.status === 'archived')) fail(409, 'Restore this advertiser before changing creatives');
    if (action === 'asset' && method === 'POST') rejectUnknown(body,['proof']);
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
        const participant = db.campaigns.some((c: any) => c.org_id === actor.org_id && c.advertiser_id === aid);
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
    if (id) {
      org(db, id, actor);
      if (!can(actor.role, 'money') && ORG_MONEY.some(k => k in body)) fail(403, 'Billing requires money access');
      if (!admin(actor) && ['platform_fee_pct','type','status','_as'].some(k => k in body)) fail(403, 'Platform-only field');
      rejectUnknown(body, [...ORG_EDIT, ...ORG_MONEY, ...(admin(actor) ? ['platform_fee_pct','type','status','_as'] : [])]);
      delete body._as;
    } else {
      rejectUnknown(body, [...ORG_EDIT, 'platform_fee_pct','type','admin_email','admin_name']);
      if (body.admin_email && db.users.some((u: any) => u.email.toLowerCase() === String(body.admin_email).trim().toLowerCase()))
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
  return body;
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
  if (actor.role === ADVERTISER) return pick(s, ['id','org_id','name','venue_name','venue_type','address','size_in','orientation','aspect','photo_url']);
  const out = { ...s };
  if (!can(actor.role, 'screens')) { delete out.code; delete out._status; delete out.exclusions; delete out.priced_against; }
  if (!can(actor.role, 'money')) delete out.owner_share_pct;
  if (!can(actor.role, 'sales') && !can(actor.role, 'money')) for (const k of SCREEN_MONEY) delete out[k];
  return out;
}
export function bootstrap(db: any, actor: any, screenStatus: (s: any) => any, orgId?: string | null) {
  if (orgId && admin(actor)) {
    const campaignRows = db.campaigns.filter((c: any) => c.org_id === orgId);
    const advIds = new Set(campaignRows.map((c: any) => c.advertiser_id));
    const crIds = new Set(campaignRows.flatMap((c: any) => c.creative_ids || []));
    db = { ...db, campaigns: campaignRows, orgs: db.orgs.filter((o: any) => o.id === orgId || o.id === actor.org_id),
      advertisers: db.advertisers.filter((a: any) => a.org_id === orgId || advIds.has(a.id)),
      creatives: db.creatives.filter((c: any) => c.org_id === orgId || crIds.has(c.id)),
      ...Object.fromEntries(['screens','groups','devices','plays','presence'].map(k => [k, (db[k] || []).filter((r: any) => r.org_id === orgId)])),
      configs: (db.configs || []).filter((c: any) => c.org_id === orgId || c.layer === 'platform') };
  }
  const campaigns = db.campaigns.filter((c: any) => campaignVisible(c, actor));
  const campaignIds = new Set(campaigns.map((c: any) => c.id));
  const plays = db.plays.filter((p: any) => admin(actor) || (p.org_id === actor.org_id &&
    (actor.role !== ADVERTISER || campaignIds.has(p.campaign_id)))).slice(-1500);
  const playIds = new Set(plays.map((p: any) => p.id));
  const screenIds = new Set([...campaigns.flatMap((c: any) => c.screen_ids), ...plays.map((p: any) => p.screen_id)]);
  const advIds = new Set(campaigns.map((c: any) => c.advertiser_id));
  const crIds = new Set(campaigns.flatMap((c: any) => c.creative_ids));
  const advertiser = actor.role === ADVERTISER;
  const sales = can(actor.role, 'sales');
  const screens = db.screens.filter((s: any) => admin(actor) || (s.org_id === actor.org_id && (!advertiser || screenIds.has(s.id))));
  return {
    pagination: db.pagination || {}, scope_org: orgId || null, history: db.history || { complete: true, scope: 'local_demo' }, config_version: db.settings?.config_revision || 1, user: publicUser(actor), org: orgView(db.orgs.find((o: any) => o.id === actor.org_id), actor), isAdmin: admin(actor),
    orgs: db.orgs.filter((o: any) => admin(actor) || o.id === actor.org_id).map((o: any) => orgView(o, actor)),
    screens: screens.map((s: any) => screenView({ ...s, _status: screenStatus(s) }, actor)),
    campaigns, advertisers: db.advertisers.filter((a: any) => admin(actor) || (sales && a.org_id === actor.org_id) || advIds.has(a.id))
      .map((a: any) => advertiserView(a, actor)),
    creatives: db.creatives.filter((c: any) => admin(actor) || (sales && c.org_id === actor.org_id) || crIds.has(c.id)),
    groups: (db.groups || []).filter((g: any) => admin(actor) || (!advertiser && g.org_id === actor.org_id)),
    devices: can(actor.role, 'screens') ? db.devices.filter((d: any) => admin(actor) || d.org_id === actor.org_id) : [],
    plays, presence: db.presence.filter((p: any) => playIds.has(p.play_id) && (admin(actor) || p.org_id === actor.org_id)),
    settings: admin(actor) ? db.settings || {} : {},
    configs: can(actor.role, 'screens') ? (db.configs || []).filter((c: any) => admin(actor) || c.org_id === actor.org_id || c.layer === 'platform') : [],
    caps: capabilities(actor),
  };
}

/** Response defence: no password material, including nested detail and mutation responses. */
export function redact(value: any, actor: any): any {
  if (Array.isArray(value)) return value.map(v => redact(v, actor));
  if (!value || typeof value !== 'object') return value;
  const hidden = new Set(['password_hash','password_salt','auth_version','token_hash','pairing_code_hash','payload_hash','storage_path','frame','frame_url','preview_frame','frameUrl']);
  if (!can(actor?.role, 'money')) for (const k of [...ORG_MONEY, 'owner_share_pct']) hidden.add(k);
  if (!can(actor?.role, 'sales') && !can(actor?.role, 'money'))
    for (const k of [...SCREEN_MONEY, 'committed_budget','accrued_spend','rate_value','platform_fee_pct','invoice_status']) hidden.add(k);
  if (!can(actor?.role, 'money')) for (const k of ['invoice_status','platform_fee_pct','fee_basis']) hidden.add(k);
  if (!can(actor?.role, 'screens')) for (const k of ['code','priced_against','frameUrl','config','configStack','configConflicts','pricingDrift']) hidden.add(k);
  return Object.fromEntries(Object.entries(value).filter(([k]) => !hidden.has(k)).map(([k,v]) => [k, redact(v, actor)]));
}
