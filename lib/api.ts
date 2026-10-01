import { maintenanceRoute, maintenanceCodeId, maintenanceTokenId, maintenanceLimiterIds } from './maintenance';
import { ReportingError, reportRange, reportingVisible, summarizeReport, REPORT_PAGE_SIZE } from './reporting';
import { ensureBudget, validateBudgetEdit, budgetLimit } from './budgets';
import { createHash, randomUUID } from 'node:crypto';
import { draftCampaignBody, draftCampaignId, draftExpiry, draftVisibleTo, missingForSubmit, missingMessage } from './campaign-drafts';
import { creativeRotationIndex } from './rotation';
import { economics, freezeEconomics, paise } from './settlement';
import { DiagnosticError, requestDiagnostic, revokeDiagnostic, assertNoDiagnosticLease } from './diagnostics';
import { auditSnapshot, appendAudit, auditView } from './audit';
import { summarizeReadiness } from './readiness';
import { openMedia, mediaUrl } from './media';
import * as store from './store';
import { AccessError, authorize, authorizeCampaignCreate, campaignRelations, bootstrap, publicUser, orgView, screenView, advertiserView, capabilities, campaignView, settlementView, redact, advertiserPlayView } from './access';
import { seed, uid, nowISO, code6 } from './seed';
import * as cfg from './config';
import { ATTENTION_PROFILE } from './vision/attention-contracts';
import { deviceRoute, deviceIdFromToken, pairingCodeHash, issuePairing, revokeDevices, calibrationForDevice } from './devices';
import { InventoryError, validateScreenInput, reverseCalculate, validateBooking, eligibility, groupMatches, defaultSlotsPerLoop, rotationWeight, authorizationUntil, campaignInterval } from './inventory';
import { can, ROLES, PLATFORM_ADMIN, ADVERTISER, tabFor } from './roles';
import { hashPassword, verifyPassword, issueToken, readToken, tempPassword, throttled, noteFailure, clearFailures, assertAuthConfigured, type Claims } from './auth';

let db: any = null;
async function load() {
  if (db) return db;
  db = await store.read();
  if (!db) {
    if (process.env.NODE_ENV === 'production') throw new AccessError(503, 'Database must be provisioned before serving production');
    db = seed(); await store.write(db);
  }
  return db;
}
let auditContext: { before:any; actor:any; action:string } | null = null;
const save = async () => {
  if (auditContext) { appendAudit(db,auditContext.before,auditContext.actor,auditContext.action); auditContext.before = auditSnapshot(db); }
  await store.write(db);
};
const creationId = (prefix: string, body: any) => body.external_key ? prefix + '_' + createHash('sha256').update(JSON.stringify([prefix,body.org_id || null,body.external_key])).digest('hex').slice(0,32) : uid(prefix);
const bumpConfig = () => { db.settings ||= {}; db.settings.config_revision = (db.settings.config_revision || 0) + 1; };
function freezeBookings(c: any, previousCampaign?: any) {
  const old = previousCampaign?.bookings || [];
  if (previousCampaign) { ensureBudget(db,previousCampaign,Date.now()); if (c.committed_budget !== previousCampaign.committed_budget) validateBudgetEdit(db,c); }
  if (previousCampaign && !previousCampaign.scheduling_mode) c.bookings = (c.screen_ids || []).map((id: string) => { const b = (c.bookings || []).find((x: any)=>x.screen_id === id); const s = db.screens.find((x: any)=>x.id === id); return b || {screen_id:id,rotation_weight:s ? rotationWeight(previousCampaign,s) : 1}; });
  c.scheduling_mode = 'continuous';
  assertNoDiagnosticLease(db, [...(c.screen_ids || []), ...old.map((b: any) => b.screen_id)]);
  if (typeof c.name !== 'string' || !c.name.trim()) throw new AccessError(400, 'Campaign name is required');
  if (!['per_play','flat'].includes(c.rate_type) || typeof c.rate_value !== 'number' || !Number.isFinite(c.rate_value) || c.rate_value < 0 || typeof c.committed_budget !== 'number' || !Number.isFinite(c.committed_budget) || c.committed_budget < 0) throw new AccessError(400, 'Enter a valid campaign price and budget');
  c.bookings = validateBooking(c, db.campaigns, inventoryScreens(), db.creatives, {previous:previousCampaign,orgs:db.orgs}).map((b: any) => {
    const previous = old.find((x: any) => x.screen_id === b.screen_id);
    const screen = db.screens.find((x: any) => x.id === b.screen_id);
    return { ...b, ...freezeEconomics(c,screen,db.orgs.find((o: any) => o.id === screen.org_id),previous) };
  });
  c.participant_org_ids = [...new Set([...(previousCampaign?.participant_org_ids || []), ...c.screen_ids.map((id: string) => db.screens.find((s: any) => s.id === id).org_id)])];
}
/** The one campaign create path. POST /campaign and draft submit both call it with an authorized body.
 * Doc 31 Phase 5: a new campaign is `pending` unless the caller asks otherwise, and it may start `active` only
 * when every assigned creative is already approved (Launch); that path still runs the activation checks. */
function createCampaign(body: any, id?: string) {
  const c = { id: id ?? creationId('cmp',body), created_at: nowISO(), accrued_spend: 0, campaign_type: 'operator', platform_fee_pct: 0, fee_basis: 'gross', invoice_status: 'not_invoiced', ...body, status: body.status ?? 'pending' };
  if (!['draft','pending','active'].includes(c.status)) throw new AccessError(400, 'A new campaign starts as draft, pending or active');
  if (c.status === 'active') {
    const decisions = creativeDecisions(c);
    if (!decisions.approved || decisions.pending || decisions.rejected) throw new AccessError(409, 'A campaign can start active only when every assigned creative is approved. Submit it for review instead.');
    activationGate(c);
  }
  freezeBookings(c); db.campaigns.push(c); return c;
}
/** Writes one creative decision exactly as POST /creative/:id/approve always has. Approval lives on the creative. */
function setCreativeApproval(cr: any, status: string) { cr.approval_status = status; cr.approved_at = nowISO(); }
/** Approval counts for the creatives assigned to a campaign. Anything not approved or rejected counts as pending. */
function creativeDecisions(c: any) {
  const rows = (c.creative_ids || []).map((id: string) => db.creatives.find((x: any) => x.id === id)).filter(Boolean);
  const approved = rows.filter((x: any) => x.approval_status === 'approved').length, rejected = rows.filter((x: any) => x.approval_status === 'rejected').length;
  return { rows, approved, rejected, pending: rows.length - approved - rejected };
}
/** Checks that apply only when a campaign goes live. Capacity, economics and relations run separately. */
function activationGate(c: any) {
  let end: number;
  try { end = campaignInterval(c)[1]; } catch (e) { if (e instanceof InventoryError) throw new AccessError(409, e.message); throw e; }
  if (end <= Date.now()) throw new AccessError(409, 'The campaign end date has passed. Change the dates, then activate again.');
  const organisation = db.orgs.find((o: any) => o.id === c.org_id);
  if (organisation && organisation.status !== 'active') throw new AccessError(409, 'The campaign organisation is not active');
  const screens = (c.screen_ids || []).map((id: string) => db.screens.find((s: any) => s.id === id)).filter(Boolean);
  if (screens.length && screens.every((s: any) => s.status !== 'active')) throw new AccessError(409, 'None of the selected screens is active');
  if (c.rate_type === 'per_play') {
    const ledger = (db.campaign_budgets || []).find((b: any) => b.campaign_id === c.id);
    const spent = ledger ? ledger.spent_paise : paise(Number(c.accrued_spend) || 0);
    if (spent >= budgetLimit(c)) throw new AccessError(409, 'The committed budget is already used up. Increase the budget, then activate again.');
  }
}
/**
 * The activate transition (doc 31 Phase 5). Re-runs relations, the activation gate and freezeBookings with
 * status 'active' (dates, capacity, budget edit rule, diagnostics lease, frozen economics) on a copy. Success
 * makes the campaign active and clears review. Failure leaves the campaign and budgets untouched and returns
 * the human-readable reason; the caller records it.
 */
function attemptActivation(c: any, actor: any): { activated: true } | { activated: false; error: string } {
  const previous = structuredClone(c), budgets = structuredClone(db.campaign_budgets || []);
  const candidate: any = { ...structuredClone(c), status: 'active' };
  delete candidate.review;
  try {
    campaignRelations(db, candidate, actor);
    activationGate(candidate);
    freezeBookings(candidate, previous);
  } catch (e) {
    if (e instanceof AccessError || e instanceof InventoryError || e instanceof DiagnosticError) {
      db.campaign_budgets = budgets;
      return { activated: false, error: e.message };
    }
    throw e;
  }
  for (const key of Object.keys(c)) if (!(key in candidate)) delete c[key];
  Object.assign(c, candidate, { activated_at: nowISO() });
  return { activated: true };
}
/** Other open campaigns that would also be affected by approving this creative. */
function creativeUsage(creativeId: string, campaignId: string) {
  const now = Date.now();
  const others = db.campaigns.filter((x: any) => x.id !== campaignId && (x.creative_ids || []).includes(creativeId) && !['complete','cancelled'].includes(x.status)
    && (() => { try { return campaignInterval(x)[1] > now; } catch { return true; } })());
  return { other_campaigns: others.length, other_active: others.filter((x: any) => x.status === 'active').length };
}
/** Campaign drafts live in `campaign_drafts`, which no playback, inventory, settlement, budget, reporting or
 * bootstrap code reads. Bodies here were already authorized by authorizeDraft in lib/access.ts. */
async function draftRoute(method: string, seg: string[], q: URLSearchParams, body: any, actor: any): Promise<Res> {
  db.campaign_drafts ||= [];
  const now = Date.now();
  if (method === 'GET' && seg[0] === 'campaign-drafts') {
    const scope = q.get('org') || q.get('org_id');
    const items = db.campaign_drafts.filter((d: any) => draftVisibleTo(d, actor, now) && !d.submitted_campaign_id && (!scope || d.org_id === scope))
      .sort((a: any, b: any) => String(b.updated_at).localeCompare(String(a.updated_at)));
    return { body: { items } };
  }
  const [, id, action] = seg;
  if (method === 'POST' && !id) {
    const at = nowISO();
    const draft = { id: 'cdr_' + randomUUID().replace(/-/g, ''), ...body, created_by: actor.id, revision: 1, created_at: at, updated_at: at, expires_at: draftExpiry(now), submitted_campaign_id: null };
    db.campaign_drafts.push(draft); await save(); return { body: draft };
  }
  const draft = db.campaign_drafts.find((d: any) => d.id === id);
  if (!draftVisibleTo(draft, actor, now)) return { status: 404, body: { error: 'Not found' } };
  if (method === 'GET') return { body: draft };
  if (action === 'discard') {
    db.campaign_drafts = db.campaign_drafts.filter((d: any) => d.id !== id);
    await save(); return { body: { ok: true } };
  }
  if (action === 'submit') {
    const campaignId = draftCampaignId(draft.id);
    const existing = db.campaigns.find((c: any) => c.id === campaignId);
    if (draft.submitted_campaign_id || existing) {
      // A repeated submit returns the one campaign this draft created; it never creates a second.
      if (!existing) return { status: 409, body: { error: 'This draft was already submitted' } };
      if (!draft.submitted_campaign_id) { draft.submitted_campaign_id = existing.id; draft.updated_at = nowISO(); await save(); }
      return { body: { campaign: existing, draft, reused: true } };
    }
    const missing = missingForSubmit(draft);
    if (missing) throw new AccessError(400, missingMessage(missing));
    if (body.mode === 'launch' && draft.fields.creative_ids.some((cid: string) => db.creatives.find((x: any) => x.id === cid)?.approval_status !== 'approved'))
      throw new AccessError(400, 'Launch needs every creative approved');
    const campaign = createCampaign(authorizeCampaignCreate(db, actor, draftCampaignBody(draft, body.mode === 'launch' ? 'active' : 'pending')), campaignId);
    // Submit for review lands the campaign in the review queue (doc 31 Phase 5); Launch is already active.
    if (body.mode !== 'launch') campaign.review = { state: 'in_review', submitted_at: nowISO(), submitted_by: actor.id, decided_at: null, decided_by: null, note: null, activation_error: null };
    Object.assign(draft, { submitted_campaign_id: campaign.id, submitted_at: nowISO(), updated_at: nowISO(), revision: draft.revision + 1 });
    await save(); return { body: { campaign, draft } };
  }
  if (body.revision !== draft.revision) return { status: 409, body: { error: 'This draft changed in another tab. Reload it before saving again.', revision: draft.revision } };
  const at = nowISO();
  Object.assign(draft, { step: body.step, fields: body.fields, advertiser_id: body.advertiser_id, campaign_type: body.campaign_type, revision: draft.revision + 1, updated_at: at, expires_at: draftExpiry(now) });
  await save(); return { body: draft };
}
const inventoryScreens = () => db.screens.map((s: any) => { const v = cfg.flatten(resolveFor(s)); return { ...s, loop_length_s: v.loop_length_s, slot_duration_s: v.slot_duration_s }; });
function validateInventory() {
  const screens = inventoryScreens(), ids = new Set(screens.map((s: any) => s.id));
  for (const c of db.campaigns) {
    const candidate = {...c,screen_ids:(c.screen_ids || []).filter((id: string) => ids.has(id)),bookings:c.bookings?.filter((b: any) => ids.has(b.screen_id))};
    if (candidate.screen_ids.length) validateBooking({...candidate,scheduling_mode:'continuous'},db.campaigns,screens,db.creatives,{previous:c,orgs:db.orgs});
  }
}
function playlistFor(screen: any, device?: any, rotationIndex = 0) {
  const calibration=calibrationForDevice(screen,device);
  const config:any = { ...cfg.flatten(resolveFor(screen)), attention_enabled: screen.attention_settings?.enabled === true,
    attention_profile: screen.attention_settings?.profile || ATTENTION_PROFILE.id, attention_calibration: calibration,
    presence_profile_id:screen.has_camera&&cfg.flatten(resolveFor(screen)).camera_source!=='ip'? 'presence-v2/efficientdet-lite0-mediapipe-face/1':null };
  const items: any[] = [], decisions: any[] = [], loopAdvertisers: any[] = [], rotationPool: any[] = [];
  for (const campaign of db.campaigns.filter((c: any) => c.screen_ids?.includes(screen.id))) {
    const advertiser = db.advertisers.find((a: any) => a.id === campaign.advertiser_id);
    const eligible: any[] = [];
    for (const id of campaign.creative_ids || []) {
      const creative = db.creatives.find((x: any) => x.id === id);
      const result = eligibility({ screen, screenOrg:db.orgs.find((o: any) => o.id === screen.org_id), campaign:campaign.campaign_type === 'network' ? {...campaign,accrued_spend:undefined} : campaign, creative, advertiser, settings: db.settings, config, loopAdvertisers });
      decisions.push({ campaign_id: campaign.id, creative_id: id, eligible: result.eligible, reason: result.reason, rejected_at_step: result.rejected_at_step, warnings: result.warnings, letterbox: result.letterbox });
      if (result.eligible) eligible.push({ result, creative });
    }
    rotationPool.push([campaign.id,eligible.map(({creative,result}: any) => [creative.id,result.asset.asset_id || result.asset.youtube_id,result.asset.duration_s])]);
    const booking = campaign.bookings?.find((b: any) => b.screen_id === screen.id);
    for (let n = 0; eligible.length && n < rotationWeight(campaign,screen); n++) {
      const { result, creative } = eligible[creativeRotationIndex(screen.id,rotationIndex,n,eligible.length)], asset = result.asset;
      items.push({ ...economics(booking), kind:'paid', media_type:asset.media_type || 'video', authorization_until:authorizationUntil(screen,campaign,config), asset_sha256:asset.sha256, asset_bytes:asset.bytes, asset_mime:asset.mime, campaign_id: campaign.id, campaign_name: campaign.name, creative_id: creative.id, creative_name: creative.name, advertiser: advertiser?.name || '—', youtube_id: asset.youtube_id, duration_s: asset.duration_s, rate_value: booking?.rate_value ?? campaign.rate_value, rate_type: booking?.rate_type ?? campaign.rate_type, letterbox: result.letterbox, asset_id: asset.asset_id, asset_url: asset.storage_path ? mediaUrl(asset) : undefined, width: asset.width, height: asset.height });
    }
    if (eligible.length && advertiser) loopAdvertisers.push(advertiser);
  }
  const filler_items: any[] = [];
  if (screen.status === 'active' && db.orgs.find((o: any)=>o.id === screen.org_id)?.status === 'active') {
    for (const cr of db.creatives.filter((c: any)=>c.org_id === screen.org_id && c.purpose === 'filler' && c.approval_status === 'approved')) {
      if ((db.settings?.blocked_categories || db.settings?.category_blocklist || []).includes(cr.category) || (screen.exclusions?.categories || []).includes(cr.category)) continue;
      const asset = (cr.assets || []).find((a: any)=>a.storage_path && (cr.media_type === 'image' ? cr.duration_s : a.duration_s) >= (screen.min_creative_duration_s ?? 1) && (cr.media_type === 'image' ? cr.duration_s : a.duration_s) <= (screen.max_creative_duration_s ?? 600));
      if (!asset) continue;
      filler_items.push({kind:'filler',campaign_id:null,creative_id:cr.id,creative_name:cr.name,media_type:cr.media_type || 'video',duration_s:cr.media_type === 'image' ? cr.duration_s : asset.duration_s,asset_id:asset.asset_id || asset.id,asset_url:mediaUrl(asset),asset_sha256:asset.sha256,asset_bytes:asset.bytes,asset_mime:asset.mime,width:asset.width,height:asset.height,authorization_until:authorizationUntil(screen,null,config)});
    }
  }
  return { items, filler_items, scheduling_mode:'continuous', rotation_version:createHash('sha256').update(JSON.stringify([rotationPool,screen.operating_hours,config.operating_hours,screen.min_creative_duration_s,screen.max_creative_duration_s,db.campaigns.filter((c:any)=>c.screen_ids?.includes(screen.id)).map((c:any)=>[c.id,c.starts_at,c.ends_at,c.dayparts])])).digest('hex'), config, config_version: db.settings?.config_revision || 1, decisions, readiness: summarizeReadiness(screen, db.campaigns.filter((c: any) => c.screen_ids?.includes(screen.id)), decisions, items.length) };
}
const scope = (rows: any[], orgId: string, isAdmin: boolean) => (isAdmin ? rows : rows.filter(r => r.org_id === orgId));

/** Configs visible to a caller: their own, plus the platform baseline they inherit. */
const scopeConfigs = (orgId: string, isAdmin: boolean) =>
  (db.configs || []).filter((c: any) => isAdmin || c.org_id === orgId || c.layer === 'platform');

/** Locked keys may only be set by a platform-layer config. */
function lockedViolations(c: any): string[] {
  if (c.layer === 'platform') return [];
  return Object.keys(c.values || {}).filter(k => cfg.LOCKED_KEYS.includes(k));
}

const resolveFor = (screen: any) => cfg.resolve(screen, db.groups || [], db.configs || []);

export function screenStatus(screen: any) {
  const dev = db.devices.find((d: any) => d.screen_id === screen.id && d.status !== 'revoked');
  if (!dev) return { state: 'unpaired', label: 'not paired', device: null, age_s: null, observed_at: new Date().toISOString() };
  const age = (Date.now() - new Date(dev.last_heartbeat_at).getTime()) / 1000;
  const state = age < 90 ? 'live' : age < 900 ? 'stalled' : 'offline';
  return { state, label: state === 'live' ? 'on air' : state === 'stalled' ? 'not responding' : 'offline', device: dev, age_s: Math.round(age), observed_at: new Date().toISOString() };
}

/** `commit` lets a recorded failure (activation that could not start) persist even though status >= 400. */
type Res = { status?: number; body: any; commit?: boolean };

const OPEN = new Set(['GET _health', 'POST login']);

// Serialize this process's mutations and refresh from the shared store each time.
// This reduces stale reads; it is NOT a replacement for cross-instance transactions (WP4).
let queue: Promise<unknown> = Promise.resolve();
export function handle(method: string, seg: string[], q: URLSearchParams, body: any, token?: string | null, clientKey?: string | null): Promise<Res> {
  const run = async (): Promise<Res> => {
    try {
      assertAuthConfigured();
      if (process.env.NODE_ENV === 'production' && store.mode !== 'firestore')
        return { status: 503, body: { error: 'Durable storage must be configured' } };
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return { status: 400, body: { error: 'Expected a JSON object' } };
      const claims = readToken(token);
      return await store.transact({ method, path: seg, uid: claims?.uid,
        deviceId: deviceIdFromToken(token) || undefined,
        maintenanceId: seg.join('/') === 'maintenance/redeem' ? maintenanceCodeId(body.code) : maintenanceTokenId(token),
        maintenanceLimiterIds: seg.join('/') === 'maintenance/redeem' ? maintenanceLimiterIds(clientKey) : undefined,
        loginEmail: seg.join('/') === 'login' ? String(body.email || '').trim().toLowerCase() : undefined,
        pairingCodeHash: seg.join('/') === 'pair' ? pairingCodeHash(String(body.code || '')) : undefined,
        playUid: typeof body.play_uid === 'string' ? body.play_uid : undefined, measurementBindingId: typeof body.measurement_binding_id === 'string' ? body.measurement_binding_id : undefined,
        attentionRevision:typeof body.calibration?.revision==='string'?body.calibration.revision:undefined,
        startedAtDevice:body.started_at_device,clockOffset:body.server_clock_offset_ms,seqNo: body.seq_no, assignmentId: body.assignment_id, orgId: q.get('org') || q.get('org_id') || undefined,
        targetOrg: typeof body.org_id === 'string' ? body.org_id : undefined, entity:q.get('entity') || undefined,
        from:q.get('from') || undefined,to:q.get('to') || undefined,reportScreen:q.get('screen') || undefined,reportCampaign:q.get('campaign') || undefined,
        after:q.get('after') || undefined,attentionAfter:q.get('attention_after')||undefined,limit:Number(q.get('limit')) || 100 }, async () => {
        db = null; auditContext = null;
        const result = await dispatch(method, seg, q, body, token, clientKey);
        const actor = claims ? db?.users.find((u: any) => u.id === claims.uid) : null;
        if (actor) result.body = redact(result.body, actor);
        return result;
      });
    } catch (e) {
      if (e instanceof ReportingError || e instanceof DiagnosticError || e instanceof AccessError || e instanceof InventoryError || e instanceof store.StoreError) return { status: e.status, body: { error: e.message } };
      if (e instanceof Error && e.message.startsWith('Set GC_DEMO_PASSWORD'))
        return { status: 503, body: { error: e.message } };
      if (e instanceof Error && e.message.startsWith('GC_AUTH_SECRET'))
        return { status: 503, body: { error: 'Authentication is not configured' } };
      throw e;
    }
  };
  const result = queue.then(run, run);
  queue = result.then(() => undefined, () => undefined);
  return result;
}

async function dispatch(method: string, seg: string[], q: URLSearchParams, body: any, token?: string | null, clientKey?: string | null): Promise<Res> {
  await load();
  const p = seg.join('/');
  const claims = readToken(token);
  const candidate = claims ? db.users.find((u: any) => u.id === claims.uid) : null;
  const me = candidate && candidate.status !== 'disabled' &&
    claims!.ver === (candidate.auth_version || 0) &&
    db.orgs.some((o: any) => o.id === candidate.org_id && o.status !== 'disabled') ? candidate : null;
  const maintenance = maintenanceRoute(db,method,seg,body,token,me,{clientKey});
  if (maintenance) { if (maintenance.changed) await save(); return {status:maintenance.status,body:maintenance.body}; }
  const pairingAudit = method === 'POST' && p === 'pair' ? auditSnapshot(db) : null;
  const transport = deviceRoute(db, method, seg, body, token, { playlist: playlistFor, playerProtocol: Number(q.get('protocol') || body.player_protocol || 0), clientKey: clientKey || undefined });
  if (transport) {
    if (transport.changed) {
      if (pairingAudit && transport.body.device?.id) {
        const paired = db.devices.find((d: any) => d.id === transport.body.device.id);
        // The pairing-code holder is a device actor; never attribute redemption to an invented human.
        appendAudit(db,pairingAudit,{id:paired.id,role:'device',org_id:paired.org_id},'pair');
      }
      await save();
    }
    return { status: transport.status, body: transport.body };
  }
  if (!OPEN.has(`${method} ${p}`) && !me)
    return { status: 401, body: { error: 'Sign in to continue' } };
  const actor = me;
  const isAdmin = actor?.role === 'platform_admin';
  if (!OPEN.has(`${method} ${p}`)) body = authorize(db, actor, method, seg, body, q);
  if (body.external_key) {
    const collection = ({org:'orgs',screens:'screens',advertiser:'advertisers',creative:'creatives',campaign:'campaigns'} as any)[p];
    const existing = db[collection]?.find((r: any) => r.external_key === body.external_key && (p === 'org' || r.org_id === body.org_id));
    if (existing) return {body:p === 'screens' ? {screen:existing,pairing:null,reused:true} : {...existing,reused:true}};
  }
  if (actor && method === 'POST' && p !== 'login') auditContext = {before:auditSnapshot(db),actor:{...actor},action:p};

  if (method === 'GET' && p === '_health') return { body: { ok: true, store: store.mode, database: process.env.GC_FIRESTORE_DATABASE || null, schema_version: 1 } };
  if (method === 'POST' && p === 'login') {
    const email = String(body.email || '').trim().toLowerCase();
    const wait = throttled(email);
    if (wait) return { status: 429, body: { error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).` } };

    const u = db.users.find((x: any) => String(x.email || '').toLowerCase() === email);
    const ok = u && u.status !== 'disabled' && db.orgs.some((o: any) => o.id === u.org_id && o.status !== 'disabled') && verifyPassword(String(body.password || ''), u.password_salt, u.password_hash);
    if (!ok) { noteFailure(email); return { status: 401, body: { error: 'Email or password is not right.' } }; }

    // the tab the person chose must match the account, so a mistyped address
    // fails with something they can act on
    const want = String(body.role || '');
    if (want && tabFor(u.role) !== want) {
      noteFailure(email);
      return { status: 403, body: { error: `That account is not ${want === 'operator' ? 'an operator' : want === 'advertiser' ? 'an advertiser' : 'a platform'} login.` } };
    }

    clearFailures(email);
    u.last_login_at = nowISO(); await save();
    const org = db.orgs.find((o: any) => o.id === u.org_id);
    return { body: { token: issueToken(u), user: {
      id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, org_id: u.org_id,
      orgName: org?.name ?? '—', advertiser_id: u.advertiser_id, must_change: !!u.must_change,
    } } };
  }

  if (method === 'GET' && p === 'network-inventory') return {body:{
    orgs:db.orgs.map((o: any) => orgView(o,actor)),screens:inventoryScreens().map((s: any) => screenView(s,actor)),
    campaigns:db.campaigns,creatives:db.creatives}};

  if (method === 'GET' && ['directory','audit'].includes(p)) {
    const entity = p === 'audit' ? 'audit' : q.get('entity') || '';
    if (!['orgs','advertisers','creatives','campaigns','screens','users','configs','groups','devices','assets','audit'].includes(entity)) throw new AccessError(400,'Unknown directory');
    const selected = q.get('org') || q.get('org_id') || (isAdmin ? null : actor.org_id);
    const limit = Math.min(100,Math.max(1,Number(q.get('limit')) || 100));
    const rows = (db[entity] || []).filter((r: any) => !selected || (entity === 'orgs' ? r.id : r.org_id) === selected || (entity === 'campaigns' && r.participant_org_ids?.includes(selected)))
      .filter((r: any) => !q.get('after') || r.id > q.get('after')!).sort((a: any,b: any) => a.id.localeCompare(b.id));
    const page = db.directory || {items:rows.slice(0,limit),has_more:rows.length > limit,next_cursor:rows.length > limit ? rows[limit-1].id : null};
    return {body:{...page,items:page.items.map((r: any) => entity === 'audit' ? auditView(r,actor) : entity === 'users' ? publicUser(r) : entity === 'orgs' ? orgView(r,actor) : entity === 'advertisers' ? advertiserView(r,actor) : entity === 'screens' ? screenView({...r,_status:screenStatus(r)},actor) : entity === 'campaigns' ? campaignView(db,r,actor,selected) : r)}};
  }

  if (method === 'GET' && p === 'team') {
    if (!actor) return { status: 401, body: { error: 'Not signed in' } };
    const rows = db.users.filter((u: any) => isAdmin ? u.org_id === (q.get('org') || q.get('org_id') || actor.org_id) : u.org_id === actor.org_id);
    return { body: rows.map((u: any) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone,
      role: u.role, status: u.status ?? 'active', must_change: !!u.must_change,
      last_login_at: u.last_login_at, created_at: u.created_at, advertiser_id: u.advertiser_id })) };
  }

  if (method === 'POST' && seg[0] === 'user' && seg[1] && seg[2] === 'role') {
    if (!can(actor?.role, 'team')) return { status: 403, body: { error: 'You cannot change roles.' } };
    const u = db.users.find((x: any) => x.id === seg[1]);
    if (!u) return { status: 404, body: { error: 'not found' } };
    if (!isAdmin && u.org_id !== actor!.org_id) return { status: 403, body: { error: 'Not your organisation.' } };
    if (u.id === actor!.id) return { status: 400, body: { error: 'You cannot change your own role.' } };
    const role = String(body.role || '');
    if (!ROLES.some(r => r.id === role)) return { status: 400, body: { error: 'Unknown role.' } };
    // an organisation must keep at least one owner, or nobody can reach settlement
    const owners = db.users.filter((x: any) => x.org_id === u.org_id && ['owner', 'org_admin'].includes(x.role) && x.status !== 'disabled');
    if (owners.length === 1 && owners[0].id === u.id && role !== 'owner')
      return { status: 400, body: { error: 'This is the only owner. Promote someone else first.' } };
    u.role = role; u.auth_version = (u.auth_version || 0) + 1; await save(); return { body: { ok: true, role } };
  }

  if (method === 'POST' && seg[0] === 'user' && seg[1] && seg[2] === 'status') {
    if (!can(actor?.role, 'team')) return { status: 403, body: { error: 'You cannot change access.' } };
    const u = db.users.find((x: any) => x.id === seg[1]);
    if (!u) return { status: 404, body: { error: 'not found' } };
    if (!isAdmin && u.org_id !== actor!.org_id) return { status: 403, body: { error: 'Not your organisation.' } };
    if (u.id === actor!.id) return { status: 400, body: { error: 'You cannot disable yourself.' } };
    u.status = body.status === 'disabled' ? 'disabled' : 'active';
    u.auth_version = (u.auth_version || 0) + 1;
    await save(); return { body: { ok: true, status: u.status } };
  }

  /** A new one-time password, shown once to whoever asked for it. */
  if (method === 'POST' && seg[0] === 'user' && seg[1] && seg[2] === 'newpassword') {
    if (!can(actor?.role, 'team')) return { status: 403, body: { error: 'You cannot reset passwords.' } };
    const u = db.users.find((x: any) => x.id === seg[1]);
    if (!u) return { status: 404, body: { error: 'not found' } };
    if (!isAdmin && u.org_id !== actor!.org_id) return { status: 403, body: { error: 'Not your organisation.' } };
    const pw = tempPassword();
    const { salt, hash } = hashPassword(pw);
    u.password_salt = salt; u.password_hash = hash; u.must_change = true;
    u.auth_version = (u.auth_version || 0) + 1;
    await save(); return { body: { temp_password: pw, email: u.email } };
  }

  if (method === 'GET' && p === 'me') {
    if (!actor) return { status: 401, body: { error: 'Not signed in' } };
    const org = db.orgs.find((o: any) => o.id === actor.org_id);
    return { body: { id: actor.id, name: actor.name, email: actor.email, role: actor.role,
      org_id: actor.org_id, orgName: org?.name ?? '—', advertiser_id: actor.advertiser_id, must_change: !!actor.must_change } };
  }

  if (method === 'POST' && p === 'password') {
    if (!actor) return { status: 401, body: { error: 'Not signed in' } };
    const current = String(body.current || ''), next = String(body.next || '');
    // a forced first change is the one case where there is no current password
    // worth checking — the temp one was handed over in the open
    if (!actor.must_change && !verifyPassword(current, actor.password_salt, actor.password_hash))
      return { status: 403, body: { error: 'Current password is not right.' } };
    if (next.length < 8) return { status: 400, body: { error: 'Use at least 8 characters.' } };
    const { salt, hash } = hashPassword(next);
    actor.password_salt = salt; actor.password_hash = hash; actor.must_change = false;
    actor.auth_version = (actor.auth_version || 0) + 1;
    await save();
    return { body: { ok: true, token: issueToken(actor) } };
  }

  /** Create a login for someone. The password is shown once, to the creator. */
  if (method === 'POST' && p === 'invite') {
    if (!actor) return { status: 401, body: { error: 'Not signed in' } };
    const email = String(body.email || '').trim().toLowerCase();
    if (!email.includes('@')) return { status: 400, body: { error: 'Enter a valid email.' } };
    if (db.users.some((u: any) => String(u.email || '').toLowerCase() === email))
      return { status: 409, body: { error: 'That email already has a login.' } };

    if (!can(actor.role, 'team')) return { status: 403, body: { error: 'You cannot add people.' } };
    const role = body.role === ADVERTISER ? ADVERTISER
      : ROLES.some(r => r.id === body.role) ? String(body.role) : null;
    if (!role) return { status: 400, body: { error: 'Unknown role.' } };
    // an operator may only create logins inside their own organisation
    const org_id = isAdmin ? (body.org_id || actor.org_id) : actor.org_id;
    if (!isAdmin && body.org_id && body.org_id !== actor.org_id)
      return { status: 403, body: { error: 'You can only add people to your own organisation.' } };

    const pw = tempPassword();
    const { salt, hash } = hashPassword(pw);
    const u = { id: uid('u'), org_id, name: body.name || email.split('@')[0], email, role,
      advertiser_id: body.advertiser_id || undefined, password_salt: salt, password_hash: hash,
      must_change: true, status: 'active', created_at: nowISO() };
    db.users.push(u); await save();
    return { body: { user: { id: u.id, name: u.name, email: u.email, role: u.role }, temp_password: pw } };
  }

  if (method === 'GET' && p === 'users') {
    if (!isAdmin) return { status: 403, body: { error: 'Not allowed' } };
    return { body: db.users.map((u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role,
      org_id: u.org_id, org: db.orgs.find((o: any) => o.id === u.org_id)?.name, last_login_at: u.last_login_at })) };
  }

  if (method === 'GET' && p === 'metrics') {
    const range = reportRange(q.get('from') || undefined,q.get('to') || undefined);
    const rows = (db.screen_day || []).filter((r: any) => reportingVisible(r,actor,q.get('org') || q.get('org_id') || undefined)
      && r.id >= range.lower && r.id < range.upper && (!q.get('after') || r.id > q.get('after')!)
      && (!q.get('screen') || r.screen_id === q.get('screen')) && (!q.get('campaign') || r.campaign_id === q.get('campaign')))
      .sort((a: any,b: any) => a.id.localeCompare(b.id));
    const items = rows.slice(0,REPORT_PAGE_SIZE);
    const page = db.report_page || {has_more:rows.length > REPORT_PAGE_SIZE,next_cursor:rows.length > REPORT_PAGE_SIZE ? items.at(-1)?.id : null};
    const attentionRows=(db.attention_day||[]).filter((r:any)=>reportingVisible(r,actor,q.get('org')||q.get('org_id')||undefined)&&r.id>=range.lower&&r.id<range.upper&&(!q.get('attention_after')||r.id>q.get('attention_after')!)&&(!q.get('screen')||r.screen_id===q.get('screen'))&&(!q.get('campaign')||r.campaign_id===q.get('campaign'))).sort((a:any,b:any)=>a.id.localeCompare(b.id));
    const attentionItems=attentionRows.slice(0,REPORT_PAGE_SIZE),attentionPage=db.attention_page||{has_more:attentionRows.length>REPORT_PAGE_SIZE,next_cursor:attentionRows.length>REPORT_PAGE_SIZE?attentionItems.at(-1)?.id:null};
    return {body:{...summarizeReport(items,range,db.reporting_coverage,attentionItems),...page,attention_page:attentionPage}};
  }

  if (method === 'GET' && p === 'bootstrap') return { body: redact(bootstrap(db, actor, screenStatus, q.get('org') || q.get('org_id')), actor) };
  if (method === 'POST' && p === 'logout') {
    actor.auth_version = (actor.auth_version || 0) + 1;
    await save(); return { body: { ok: true } };
  }

  if (method === 'GET' && seg[0] === 'campaign' && seg[1] && !seg[2]) {
    const original = db.campaigns.find((x: any) => x.id === seg[1]);
    if (!original) return { status: 404, body: { error: 'not found' } };
    const c = campaignView(db,original,actor);
    const plays = db.plays.filter((x: any) => x.campaign_id === c.id && (isAdmin || actor.role === ADVERTISER || x.org_id === actor.org_id));
    const byPlay = Object.fromEntries(db.presence.map((x: any) => [x.play_id, x]));
    // Read-only delivery explanation for targeted screens the viewer may see. campaignView already scopes a
    // network campaign to the viewer's screens; non-admins are further limited to their own organisation's
    // screens. Advertisers get none: their snapshot lacks the other campaigns and configs a decision needs.
    let eligibility: any[] | null = null;
    if (actor.role !== ADVERTISER) {
      try {
        eligibility = c.screen_ids.map((id: string) => db.screens.find((s: any) => s.id === id))
          .filter((s: any) => s && (isAdmin || s.org_id === actor.org_id))
          .flatMap((s: any) => playlistFor(s).decisions.filter((x: any) => x.campaign_id === c.id)
            .map((x: any) => ({ screen_id: s.id, creative_id: x.creative_id, eligible: x.eligible, reason: x.reason, warnings: x.warnings })));
      } catch { eligibility = null; }
    }
    return { body: {
      eligibility,
      settlement_buckets:settlementView(db,actor,c.id), history: db.history || { complete: true, scope: 'local_demo' }, campaign: c, advertiser: advertiserView(db.advertisers.find((a: any) => a.id === c.advertiser_id), actor),
      org: orgView(db.orgs.find((o: any) => o.id === c.org_id), actor), totals: null, totals_source: '/api/metrics',
      byScreen: [...new Set([...c.screen_ids,...plays.map((p: any) => p.screen_id),...settlementView(db,actor,c.id).map((b: any) => b.screen_id)])].map((id: string) => db.screens.find((s: any) => s.id === id)).filter(Boolean)
        .map((s: any) => ({ screen: screenView({ ...s, _status: screenStatus(s) }, actor) })),
      byCreative: c.creative_ids.map((id: string) => db.creatives.find((x: any) => x.id === id)).filter(Boolean)
        .map((cr: any) => ({ creative: cr })),
      plays: plays.slice(-300).reverse().map((p: any) => actor.role === ADVERTISER ? advertiserPlayView(p, byPlay[p.id]) : ({ ...p, presence: byPlay[p.id] || null })),
    } };
  }

  if (method === 'GET' && seg[0] === 'screen' && seg[1] && !seg[2]) {
    const screen = db.screens.find((s: any) => s.id === seg[1]);
    if (!screen) return { status: 404, body: { error: 'not found' } };
    const st = screenStatus(screen);
    const plays = db.plays.filter((p: any) => p.screen_id === screen.id);
    const byPlay = Object.fromEntries(db.presence.map((x: any) => [x.play_id, x]));
    const t = new Date().toISOString().slice(0, 10);
    const measured = plays.map((p: any) => byPlay[p.id]).filter((x: any) => x?.measured);
    const advOf = (id: string) => db.advertisers.find((a: any) => a.id === id);
    const camps = db.campaigns.filter((c: any) => c.screen_ids.includes(screen.id)).map((c: any) => {
      return { id: c.id, name: c.name, status: c.status, campaign_type: c.campaign_type,
        live: c.status === 'active' && c.starts_at <= t && c.ends_at >= t,
        advertiser: advOf(c.advertiser_id)?.name || '—', starts_at: c.starts_at, ends_at: c.ends_at,
        ...((c.campaign_type === 'network' || c.bookings?.some((b: any) => b.econ_version)) ? {accrued_spend:settlementView(db,actor,c.id,screen.org_id).filter((b: any) => b.screen_id === screen.id).reduce((n: number,b: any) => n + (b.gross_paise || 0),0) / 100} : {committed_budget:c.committed_budget,accrued_spend:c.accrued_spend}),
        creatives: c.creative_ids.map((id: string) => db.creatives.find((x: any) => x.id === id)).filter(Boolean),
        totals_source: '/api/metrics' };
    });
    let np: any = null;
    if (st.device?.now_playing && st.state === 'live') {
      const n = st.device.now_playing;
      const cr = db.creatives.find((x: any) => x.id === n.creative_id);
      const c = db.campaigns.find((x: any) => x.id === n.campaign_id);
      np = { creative: cr, campaign: c ? { id: c.id, name: c.name } : null, advertiser: c ? advOf(c.advertiser_id)?.name || '—' : '—',
        started_at: n.started_at, duration_s: n.duration_s, elapsed_s: (Date.now() - new Date(n.started_at).getTime()) / 1000 };
    }
    const resolved = resolveFor(screen), playlist = playlistFor(screen);
    const diagnosticAssignments = can(actor.role,'screens') ? (db.diagnostic_assignments || []).filter((a: any) => a.screen_id === screen.id).sort((a: any,b: any) => String(b.requested_at).localeCompare(String(a.requested_at))) : [];
    const diagnosticResults = can(actor.role,'screens') ? (db.diagnostic_results || []).filter((r: any) => r.screen_id === screen.id).sort((a: any,b: any) => String(b.received_at).localeCompare(String(a.received_at))) : [];
    return { body: { organisation:{id:screen.org_id,name:db.orgs.find((o: any) => o.id === screen.org_id)?.name || screen.org_id}, diagnostic_assignments:diagnosticAssignments, diagnostic_results:diagnosticResults, diagnostic_history:can(actor.role,'screens') ? db.diagnostic_history || {complete:true} : null, history: db.history || { complete: true, scope: 'local_demo' }, config_version: db.settings?.config_revision || 1, device: can(actor.role, 'screens') ? st.device : null, eligibility: playlist.decisions, readiness: playlist.readiness, screen: screenView(screen, actor), caps: capabilities(actor),
      status: can(actor.role, 'screens') ? st : { state: st.state, label: st.label, age_s: st.age_s },
      nowPlaying: np, campaigns: camps, advertisers: db.advertisers.filter((a: any) => a.org_id === screen.org_id || db.campaigns.some((c: any) => c.screen_ids?.includes(screen.id) && c.advertiser_id === a.id)).map((a: any) => ({ id: a.id, name: a.name })),
      config: resolved,

      configStack: cfg.applicable(screen, db.groups || [], db.configs || []).map((c: any) => ({ id: c.id, name: c.name, layer: c.layer, keys: Object.keys(c.values || {}).length })),
      configConflicts: cfg.conflicts(screen, db.groups || [], db.configs || []),
      pricingDrift: cfg.pricingDrift(screen, resolved),
      stats: { liveCampaigns: camps.filter((c: any) => c.live).length }, totals_source: '/api/metrics',
      recent: plays.slice(-40).reverse().map((p: any) => ({ ...p, creative: db.creatives.find((x: any) => x.id === p.creative_id), presence: byPlay[p.id] || null })) } };
  }

  if (method === 'POST' && seg[0] === 'campaign' && seg[1] && !seg[2]) {
    const c = db.campaigns.find((x: any) => x.id === seg[1]);
    if (!c) return { status: 404, body: { error: 'not found' } };
    const previousCampaign = structuredClone(c);
    for (const k of ['name','starts_at','ends_at','committed_budget','rate_type','rate_value','status','invoice_status','screen_ids','creative_ids','bookings','dayparts']) if (k in body) c[k] = body[k];
    // authorize() already rejected draft/pending → active (campaignStatusChange); a closed campaign leaves review.
    if (['complete','cancelled'].includes(c.status)) delete c.review;
    freezeBookings(c, previousCampaign); await save(); return { body: c };
  }
  if (method === 'POST' && seg[0] === 'campaign' && seg[1] && seg[2] === 'submit') {
    const c = db.campaigns.find((x: any) => x.id === seg[1]);
    if (!c) return { status: 404, body: { error: 'not found' } };
    if (c.status === 'pending' && c.review?.state === 'in_review') return { body: { campaign: c, unchanged: true } };
    if (!['draft','pending'].includes(c.status)) throw new AccessError(409, 'Only a draft or pending campaign can be submitted for review');
    if (!(c.creative_ids || []).length) throw new AccessError(400, 'Add at least one creative before submitting for review');
    // Same validation as create/update: freezeBookings with status 'pending' holds capacity as pending does today.
    const previousCampaign = structuredClone(c);
    c.status = 'pending';
    freezeBookings(c, previousCampaign);
    c.review = { state: 'in_review', submitted_at: nowISO(), submitted_by: actor.id, decided_at: null, decided_by: null, note: null, activation_error: null };
    await save(); return { body: { campaign: c } };
  }
  if (method === 'POST' && seg[0] === 'campaign' && seg[1] && seg[2] === 'review') {
    const c = db.campaigns.find((x: any) => x.id === seg[1]);
    if (!c) return { status: 404, body: { error: 'not found' } };
    if (['complete','cancelled'].includes(c.status)) throw new AccessError(409, 'This campaign is closed');
    const results: any[] = [];
    for (const [id, decision] of Object.entries(body.creatives || {}) as [string, string][]) {
      const cr = db.creatives.find((x: any) => x.id === id);
      if (!cr) throw new AccessError(400, 'Creative not found');
      const changed = cr.approval_status !== decision;
      if (changed) setCreativeApproval(cr, decision);
      results.push({ id, approval_status: cr.approval_status, approved_at: cr.approved_at ?? null, changed });
    }
    const decisions = creativeDecisions(c), decided = { decided_at: nowISO(), decided_by: actor.id, note: body.note ?? null };
    let activation: any = { attempted: false, activated: c.status === 'active', error: null };
    // Only a campaign the seller submitted (review.state in_review) is activated or sent back here. For re-review
    // items the decisions apply to the creatives alone and the campaign status is left as it is.
    if (['draft','pending'].includes(c.status) && c.review?.state === 'in_review' && !decisions.pending) {
      if (decisions.approved) {
        const outcome = attemptActivation(c, actor);
        activation = { attempted: true, activated: outcome.activated, error: outcome.activated ? null : outcome.error };
        if (!outcome.activated) c.review = { ...(c.review || {}), state: 'approved_not_started', ...decided, activation_error: outcome.error, attempted_at: nowISO(), attempted_by: actor.id };
      } else if (decisions.rejected) c.review = { ...(c.review || {}), state: 'changes_needed', ...decided, activation_error: null };
    }
    await save();
    return { body: { campaign: c, creatives: results, activation, rejected: decisions.rows.filter((x: any) => x.approval_status === 'rejected').map((x: any) => x.id) } };
  }
  if (method === 'POST' && seg[0] === 'campaign' && seg[1] && seg[2] === 'activate') {
    const c = db.campaigns.find((x: any) => x.id === seg[1]);
    if (!c) return { status: 404, body: { error: 'not found' } };
    if (c.status === 'active') return { body: { campaign: c, activation: { attempted: false, activated: true, error: null }, unchanged: true } };
    if (!['draft','pending'].includes(c.status)) throw new AccessError(409, 'Only a draft or pending campaign can be activated. Resume a paused campaign instead.');
    const decisions = creativeDecisions(c);
    if (decisions.pending) throw new AccessError(409, 'Every assigned creative needs a review decision before the campaign can start');
    if (!decisions.approved) throw new AccessError(409, 'At least one assigned creative must be approved before the campaign can start');
    const outcome = attemptActivation(c, actor);
    if (outcome.activated) { await save(); return { body: { campaign: c, activation: { attempted: true, activated: true, error: null } } }; }
    // Creative decisions stand; the campaign keeps its status and hold, and the reason is recorded for the seller.
    c.review = { ...(c.review || {}), state: 'approved_not_started', activation_error: outcome.error, attempted_at: nowISO(), attempted_by: actor.id };
    await save();
    return { status: 409, commit: true, body: { error: outcome.error, campaign: c, activation: { attempted: true, activated: false, error: outcome.error } } };
  }
  if (method === 'GET' && p === 'review-queue') {
    const now = Date.now();
    const ended = (c: any) => { try { return campaignInterval(c)[1] <= now; } catch { return false; } };
    const nameOf = (rows: any[], id: string) => rows.find((x: any) => x.id === id)?.name ?? null;
    const creativeItem = (cr: any, campaignId: string) => ({ id: cr.id, name: cr.name, org_id: cr.org_id, category: cr.category, media_type: cr.media_type || 'video', approval_status: cr.approval_status,
      youtube_id: cr.youtube_id || null, has_upload: Array.isArray(cr.assets) && cr.assets.length > 0, duration_s: cr.duration_s, updated_at: cr.updated_at ?? null, usage: creativeUsage(cr.id, campaignId) });
    const items = db.campaigns.flatMap((c: any) => {
      const decisions = creativeDecisions(c), pending = decisions.rows.filter((x: any) => !['approved','rejected'].includes(x.approval_status));
      const submitted = ['draft','pending'].includes(c.status) && c.review?.state === 'in_review';
      // Re-review needs evidence the campaign was already reviewed or ran: it is live/paused, was activated before, or
      // every creative was approved and only activation failed (approved_not_started). A never-submitted draft/pending
      // campaign (including legacy pending rows) and one sent back as changes_needed are the owner's to (re)submit.
      const reviewedBefore = ['active','paused'].includes(c.status) || !!c.activated_at || c.review?.state === 'approved_not_started';
      const reReview = !submitted && reviewedBefore && ['active','pending','paused'].includes(c.status) && pending.length > 0 && !ended(c);
      if (!submitted && !reReview) return [];
      return [{ reason: submitted ? 'submitted' : 're_review',
        campaign: { id: c.id, name: c.name, campaign_type: c.campaign_type, advertiser_id: c.advertiser_id, advertiser_name: nameOf(db.advertisers, c.advertiser_id), org_id: c.org_id, org_name: nameOf(db.orgs, c.org_id),
          starts_at: c.starts_at, ends_at: c.ends_at, screens: (c.screen_ids || []).length, status: c.status, review: c.review ?? null },
        creatives: pending.map((cr: any) => creativeItem(cr, c.id)),
        decided: decisions.rows.filter((x: any) => ['approved','rejected'].includes(x.approval_status)).map((x: any) => ({ id: x.id, name: x.name, approval_status: x.approval_status })) }];
    }).sort((a: any, b: any) => String(a.campaign.review?.submitted_at ?? a.creatives[0]?.updated_at ?? '').localeCompare(String(b.campaign.review?.submitted_at ?? b.creatives[0]?.updated_at ?? '')));
    const filler = db.creatives.filter((cr: any) => cr.purpose === 'filler' && cr.approval_status === 'pending')
      .map((cr: any) => ({ id: cr.id, name: cr.name, org_id: cr.org_id, org_name: nameOf(db.orgs, cr.org_id), category: cr.category, media_type: cr.media_type || 'video', has_upload: Array.isArray(cr.assets) && cr.assets.length > 0, approval_status: cr.approval_status }));
    return { body: { items, filler } };
  }
  if (method === 'POST' && p === 'campaign') {
    const c = createCampaign(body); await save(); return { body: c };
  }
  if (seg[0] === 'campaign-draft' || p === 'campaign-drafts') return draftRoute(method, seg, q, body, actor);
  if (method === 'POST' && seg[0] === 'creative' && seg[2] === 'approve') {
    const cr = db.creatives.find((x: any) => x.id === seg[1]);
    if (!cr) return { status: 404, body: { error: 'not found' } };
    setCreativeApproval(cr, body.status || 'approved');
    await save(); return { body: cr };
  }
  if (method === 'GET' && seg[0] === 'creative' && seg[2] === 'preview') {
    const creative = db.creatives.find((c: any) => c.id === seg[1]);
    if (!creative) return { status: 404, body: { error: 'not found' } };
    const activeAssets = Array.isArray(creative.assets) ? creative.assets : [];
    if (activeAssets.length) return { body: { source: 'uploaded', media_type: creative.media_type || activeAssets[0].media_type || 'video', variants: activeAssets.map((asset: any, index: number) => ({
      id: String(index), media_type: asset.media_type || creative.media_type || 'video', duration_s: asset.duration_s,
      width: asset.width, height: asset.height, aspect: asset.aspect || (asset.width && asset.height ? `${asset.width}:${asset.height}` : null),
      mime: asset.mime, url: asset.storage_path && asset.mime && Number.isSafeInteger(asset.bytes) && asset.bytes > 0 ? mediaUrl(asset) : null,
    })) } };
    if (creative.youtube_id && /^[A-Za-z0-9_-]{11}$/.test(creative.youtube_id)) return { body: { source: 'youtube', youtube_id: creative.youtube_id, duration_s: creative.duration_s } };
    return { body: { source: 'none' } };
  }
  if (seg[0] === 'creative' && seg[2] === 'asset') {
    const creative = db.creatives.find((c: any) => c.id === seg[1]);
    if (method === 'GET') return { body: { org_id: creative.org_id, media_type: creative.media_type || 'video', duration_s: creative.duration_s,
      has_assets: Array.isArray(creative.assets) && creative.assets.length > 0, has_youtube: !!creative.youtube_id } };
    const asset = openMedia(body.proof || '', 'upload');
    if (!asset || asset.creative_id !== creative.id || asset.org_id !== creative.org_id) throw new AccessError(400, 'Invalid verified asset');
    const mediaType = asset.media_type || 'video', replaceMode = body.replace_mode || 'append';
    if (!['video','image'].includes(mediaType)) throw new AccessError(400,'Upload a verified video or still image');
    if (mediaType === 'image' && (!Number.isFinite(asset.duration_s) || asset.duration_s < 1 || asset.duration_s > 600)) throw new AccessError(400,'Enter an image display time between 1 and 600 seconds');
    if (mediaType === 'video' && (!Number.isFinite(asset.duration_s) || asset.duration_s < 1 || asset.duration_s > 600)) throw new AccessError(400,'Upload a video with verified duration between 1 and 600 seconds');
    const metadata: Record<string,string> = {};
    for (const key of ['name','category']) if (key in body) {
      if (typeof body[key] !== 'string' || !body[key].trim() || body[key].trim().length > 200) throw new AccessError(400,`Enter a ${key} of 1–200 characters`);
      metadata[key] = body[key].trim();
    }
    const existingAssets = Array.isArray(creative.assets) ? creative.assets : [];
    if (replaceMode === 'append' && (mediaType !== (creative.media_type || 'video') || (!existingAssets.length && creative.youtube_id)))
      throw new AccessError(409,'This upload changes the media source. Choose Replace active media in Edit creative.');
    if (replaceMode === 'append' && existingAssets.length >= 8) throw new AccessError(400,'A creative may have up to eight media variations');
    if ((db.assets || []).some((a: any) => (a.asset_id || a.id) === (asset.asset_id || asset.id))) throw new AccessError(409,'This uploaded asset was already attached');
    const activeAssets = replaceMode === 'replace_all' ? [] : existingAssets;
    db.assets ||= []; db.assets.push(asset);
    Object.assign(creative,metadata);
    creative.assets = [...activeAssets, { ...asset, uri: 'gridcast:' + (asset.asset_id || asset.id) }];
    creative.media_type = mediaType;
    delete creative.youtube_id;
    creative.duration_s = mediaType === 'image' ? asset.duration_s : Math.max(...creative.assets.map((a: any) => a.duration_s));
    creative.aspect = asset.aspect; creative.approval_status = 'pending'; delete creative.approved_at;
    creative.metadata_source = mediaType === 'image' ? 'server_image' : 'server_ffprobe'; creative.updated_at = nowISO();
    validateInventory(); await save(); return { status: 201, body: { creative, asset } };
  }
  if (method === 'POST' && seg[0] === 'creative' && seg[1] && !seg[2]) {
    const c = db.creatives.find((x: any) => x.id === seg[1]);
    const patch: Record<string, any> = {};
    for (const key of ['name','category']) if (key in body) {
      if (typeof body[key] !== 'string' || !body[key].trim() || body[key].trim().length > 200) throw new AccessError(400, `Enter a ${key} of 1–200 characters`);
      patch[key] = body[key].trim();
    }
    const existingYoutubeEdit = body.source === undefined && c.media_type !== 'image' && !c.assets?.length && !!c.youtube_id
      && ('youtube_id' in body || 'duration_s' in body);
    if ('youtube_id' in body && body.source !== 'youtube' && !existingYoutubeEdit) throw new AccessError(400,'Choose YouTube as the creative source before setting a video ID');
    if (body.source === 'youtube' || existingYoutubeEdit) {
      if (c.purpose === 'filler') throw new AccessError(400,'Filler must use uploaded media');
      const mayReuseYoutube = !c.assets?.length && !!c.youtube_id;
      const youtubeId = body.youtube_id ?? (mayReuseYoutube ? c.youtube_id : undefined);
      const duration = body.duration_s ?? (mayReuseYoutube ? c.duration_s : undefined);
      if (typeof youtubeId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(youtubeId)) throw new AccessError(400, 'Enter a valid YouTube video ID');
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 86400) throw new AccessError(400, 'Enter the expected video duration');
      patch.media_type = 'video'; patch.youtube_id = youtubeId; patch.duration_s = duration;
      patch.assets = []; patch.aspect = '16:9'; patch.metadata_source = 'operator_declared';
    } else if ('duration_s' in body) {
      if (typeof body.duration_s !== 'number' || !Number.isFinite(body.duration_s) || body.duration_s < 1 || body.duration_s > 600) throw new AccessError(400, 'Image display time must be between 1 and 600 seconds');
      if (c.media_type !== 'image') throw new AccessError(400, 'Uploaded video duration comes from the verified file');
      patch.duration_s = body.duration_s;
    }
    const changed = Object.keys(patch).filter(key => key === 'assets'
      ? (Array.isArray(c.assets) && c.assets.length > 0)
      : patch[key] !== c[key]);
    if (!changed.length) return {body:c};
    for (const key of changed) c[key] = patch[key];
    if (changed.some(key => key !== 'name')) { c.approval_status = 'pending'; delete c.approved_at; }
    c.updated_at = nowISO();
    validateInventory(); await save(); return {body:c};
  }
  if (method === 'POST' && p === 'creative') {
    if (!['paid','filler'].includes(body.purpose || 'paid') || !['video','image'].includes(body.media_type || 'video')) throw new AccessError(400,'Choose a valid creative type and purpose');
    if (body.purpose === 'filler' && (body.advertiser_id || body.youtube_id)) throw new AccessError(400,'Filler must use uploaded media and has no advertiser');
    if (body.media_type === 'image') { body.duration_s ??= 20; if (body.youtube_id || typeof body.duration_s !== 'number' || !Number.isFinite(body.duration_s) || body.duration_s < 1 || body.duration_s > 600) throw new AccessError(400,'Enter an image duration between 1 and 600 seconds'); }
    const c = { purpose:'paid',media_type:'video', metadata_source: 'operator_declared', id: creationId('cr',body), created_at: nowISO(), approval_status: 'pending', content_source: 'advertiser', ...body };
    db.creatives.push(c); await save(); return { body: c };
  }
  if (method === 'POST' && p === 'advertiser') {
    if (typeof body.name !== 'string' || !body.name.trim()) throw new AccessError(400,'Advertiser name is required');
    const a = { id: creationId('adv',body), created_at: nowISO(), status:'active', ...body };
    db.advertisers.push(a); await save(); return { body: a };
  }
  if (seg[0] === 'advertiser' && seg[1]) {
    const a = db.advertisers.find((x: any) => x.id === seg[1]);
    if (method === 'GET') return {body:advertiserView(a,actor)};
    if (seg[2] === 'archive' || seg[2] === 'restore') { a.status = seg[2] === 'archive' ? 'archived' : 'active'; a.updated_at=nowISO(); }
    else { if ('name' in body && (typeof body.name !== 'string' || !body.name.trim())) throw new AccessError(400,'Advertiser name is required'); Object.assign(a,body,{updated_at:nowISO()}); }
    await save(); return {body:advertiserView(a,actor)};
  }
  if (method === 'POST' && seg[0] === 'screen' && seg[1] && seg[2] === 'test') {
    const screen = db.screens.find((s: any) => s.id === seg[1]);
    const assignment = seg[4] === 'revoke' ? revokeDiagnostic(db,screen,seg[3],actor) : requestDiagnostic(db,screen,actor,{config:cfg.flatten(resolveFor(screen)),config_version:db.settings?.config_revision || 1});
    await save(); return {body:assignment};
  }
  if (method === 'POST' && seg[0] === 'screen' && seg[1] && seg[2] === 'exclusions') {
    const s = db.screens.find((x: any) => x.id === seg[1]);
    if (!s) return { status: 404, body: { error: 'not found' } };
    s.exclusions = body.exclusions || { categories: [], advertisers: [] };
    await save(); return { body: s };
  }
  if (method === 'POST' && seg[0] === 'screen' && seg[1] && !seg[2]) {
    const s = db.screens.find((x: any) => x.id === seg[1]);
    if (!s) return { status: 404, body: { error: 'not found' } };
    if ('exposure_source' in body && body.exposure_source !== 'estimated') throw new AccessError(400, 'Exposure estimates cannot be marked measured by a manual edit');
    assertNoDiagnosticLease(db,[s.id]);
    const merged = { ...s, ...body };
    const legacyHours = typeof merged.operating_hours === 'number' && !('operating_hours' in body);
    validateScreenInput({ ...merged, status: merged.status === 'paused' ? 'inactive' : merged.status, operating_hours: legacyHours ? { from: '00:00', to: '00:00' } : merged.operating_hours });
    for (const [key, value] of Object.entries(body)) s[key] = value;
    const reprice = ['venue_base','size_factor','location_factor','exposure_factor','advertiser_slots'].some(k => k in body);
    if (reprice) {
      s.monthly_value = Math.round(s.venue_base * s.size_factor * s.location_factor * s.exposure_factor);
      s.slot_price_month = Math.round(s.monthly_value / (s.advertiser_slots || 10));
      s.rate_version = uid('rate'); s.pricing_source = 'derived';
    }
    validateInventory(); bumpConfig();
    await save(); return { body: s };
  }
  if (method === 'POST' && p === 'screens') {
    const screen: any = { ...validateScreenInput(body), ...(body.external_key ? {external_key:body.external_key} : {}), id: creationId('scr',body), org_id: body.org_id, created_at: nowISO(), rate_version: uid('rate') };
    if (body.rate_seed) {
      const rate = reverseCalculate({ ...body.rate_seed, venue_base: screen.venue_base, size_factor: screen.size_factor, loop_length_s: screen.loop_length_s, slot_duration_s: screen.slot_duration_s });
      Object.assign(screen, { rate_seed: rate, advertiser_slots: rate.advertiser_slots, monthly_value: rate.seed_monthly_value, slot_price_month: rate.seed_slot_price_month, pricing_source: 'derived_from_self_reported_revenue' });
    }
    db.screens.push(screen); const pairing = issuePairing(db, screen); bumpConfig(); await save();
    return { status: 201, body: { screen, pairing } };
  }
  if (method === 'POST' && seg[0] === 'screens' && seg[1]) {
    const screen = db.screens.find((s: any) => s.id === seg[1]);
    if (seg[2] === 'pairing') { const pairing = issuePairing(db, screen); await save(); return { body: pairing }; }
    revokeDevices(db, screen.id); await save(); return { body: { ok: true } };
  }
  if (method === 'POST' && p === 'group/resolve') {
    const g = db.groups.find((x: any) => x.id === body.group_id);
    return { body: { screen_ids: db.screens.filter((s: any) => s.org_id === g.org_id && (g.group_type === 'static' ? g.screen_ids.includes(s.id) : groupMatches(s, g.rule_json))).map((s: any) => s.id) } };
  }
  if (method === 'POST' && seg[0] === 'group') {
    const g = seg[1] ? db.groups.find((x: any) => x.id === seg[1]) : { id: uid('grp'), created_at: nowISO(), ...body };
    if (seg[1]) Object.assign(g, body); else db.groups.push(g);
    validateInventory(); bumpConfig(); await save(); return { body: g };
  }
  if (method === 'POST' && p === 'org') {
    const o = { id: creationId('org',body), type: 'operator', platform_fee_pct: 10, status: 'active', created_at: nowISO(), ...body };
    db.orgs.push(o);
    let temp: string | null = null;
    if (body.admin_email) {
      temp = tempPassword();
      const { salt, hash } = hashPassword(temp);
      db.users.push({ id: uid('u'), org_id: o.id, name: body.admin_name || o.name + ' admin',
        email: String(body.admin_email).toLowerCase(), role: 'org_admin',
        password_salt: salt, password_hash: hash, must_change: true, status: 'active', created_at: nowISO() });
    }
    await save(); return { body: { ...o, temp_password: temp } };
  }
  if (method === 'POST' && seg[0] === 'org' && seg[1]) {
    const o = db.orgs.find((x: any) => x.id === seg[1]);
    if (!o) return { status: 404, body: { error: 'not found' } };
    if (!isAdmin && o.id !== actor!.org_id) return { status: 403, body: { error: 'Not your organisation.' } };
    if (!can(actor?.role, 'org')) return { status: 403, body: { error: 'You cannot change organisation settings.' } };
    for (const k of ['name', 'type', 'status', 'legal_name', 'support_email', 'phone', 'website',
                     'registered_address', 'billing_address']) if (k in body) o[k] = body[k];
    // tax identity and payouts sit behind the money capability
    if (can(actor?.role, 'money'))
      for (const k of ['gstin', 'pan', 'state_code', 'payout_method', 'upi_id', 'payout_note']) if (k in body) o[k] = body[k];
    // only the platform may move an operator's fee
    if (isAdmin && ('platform_fee_pct' in body || 'fee_basis' in body)) {
      if ('platform_fee_pct' in body) o.platform_fee_pct = body.platform_fee_pct;
      if ('fee_basis' in body) o.fee_basis = body.fee_basis;
      o.fee_version = uid('fee');
    }
    await save(); return { body: orgView(o, actor) };
  }
  if (method === 'POST' && seg[0] === 'user' && seg[1]) {
    const u = db.users.find((x: any) => x.id === seg[1]);
    if (!u) return { status: 404, body: { error: 'not found' } };
    if (!isAdmin && u.id !== actor!.id && u.org_id !== actor!.org_id)
      return { status: 403, body: { error: 'Not your organisation.' } };
    if (u.id !== actor!.id && !can(actor?.role, 'team'))
      return { status: 403, body: { error: 'You can only edit your own profile.' } };
    for (const k of ['name', 'email', 'phone']) if (k in body) u[k] = body[k];
    await save(); return { body: publicUser(u) };
  }
  if (method === 'GET' && p === 'settings') return { body: db.settings || {} };
  if (method === 'POST' && p === 'settings') {
    db.settings = { ...(db.settings || {}), ...body };
    await save(); return { body: db.settings };
  }
  if (method === 'GET' && p === 'config')
    return { body: scopeConfigs(q.get('org') || q.get('org_id') || actor!.org_id, isAdmin && !q.get('org') && !q.get('org_id')) };
  if (method === 'GET' && p === 'config/schema')
    return { body: { groups: cfg.GROUPS, settings: cfg.SETTINGS, locked: cfg.LOCKED_KEYS, priced: cfg.PRICED_KEYS } };

  if (method === 'POST' && p === 'config') {
    const c = { id: uid('cfg'), layer: 'group', target_id: null, priority: 0, tags: [] as string[],
      target_platform: ['android'], status: 'active', values: {}, created_at: nowISO(), ...body };
    const bad = lockedViolations(c);
    if (bad.length) return { status: 403, body: { error: `Locked settings cannot be set below the platform layer: ${bad.join(', ')}` } };
    db.configs.push(c); bumpConfig(); validateInventory(); await save(); return { body: c };
  }
  /** Assign one config to many screens by creating or moving screen-layer overrides. */
  if (method === 'POST' && p === 'config/assign') {
    const src = db.configs.find((x: any) => x.id === body.config_id);
    if (!src) return { status: 404, body: { error: 'not found' } };
    for (const sid of body.screen_ids || []) {
      const screen = db.screens.find((x: any) => x.id === sid);
      if (!screen) continue;
      let own = db.configs.find((x: any) => x.layer === 'screen' && x.target_id === sid);
      if (!own) {
        own = { id: uid('cfg'), org_id: screen.org_id, layer: 'screen', target_id: sid, priority: 0,
          name: `${screen.name} — override`, description: '', tags: [], target_platform: ['android'],
          status: 'active', values: {}, created_at: nowISO() };
        db.configs.push(own);
      }
      own.values = { ...own.values, ...src.values };
      own.updated_at = nowISO();
    }
    bumpConfig(); validateInventory(); await save(); return { body: { ok: true, screens: (body.screen_ids || []).length } };
  }
  if (method === 'POST' && seg[0] === 'config' && seg[1] && !seg[2]) {
    const c = db.configs.find((x: any) => x.id === seg[1]);
    if (!c) return { status: 404, body: { error: 'not found' } };
    const next = { ...c, ...body };
    const bad = lockedViolations(next);
    if (bad.length) return { status: 403, body: { error: `Locked settings cannot be set below the platform layer: ${bad.join(', ')}` } };
    for (const k of ['name', 'description', 'tags', 'layer', 'target_id', 'priority', 'target_platform', 'values', 'status'])
      if (k in body) c[k] = body[k];
    c.updated_at = nowISO();
    bumpConfig(); validateInventory(); await save(); return { body: c };
  }
  if (method === 'POST' && seg[0] === 'config' && seg[1] && seg[2] === 'delete') {
    db.configs = db.configs.filter((x: any) => x.id !== seg[1]);
    bumpConfig(); validateInventory(); await save(); return { body: { ok: true } };
  }
  /** Set or clear keys on a screen's own override config, creating it on demand. */
  if (method === 'POST' && seg[0] === 'screen' && seg[1] && seg[2] === 'config') {
    const screen = db.screens.find((x: any) => x.id === seg[1]);
    if (!screen) return { status: 404, body: { error: 'not found' } };
    const bad = Object.keys(body.values || {}).filter((k: string) => cfg.LOCKED_KEYS.includes(k));
    if (bad.length) return { status: 403, body: { error: `Locked settings cannot be set on a screen: ${bad.join(', ')}` } };

    let own = db.configs.find((x: any) => x.layer === 'screen' && x.target_id === screen.id);
    if (!own) {
      own = { id: uid('cfg'), org_id: screen.org_id, layer: 'screen', target_id: screen.id, priority: 0,
        name: `${screen.name} — override`, description: 'Set on this screen only', tags: [],
        target_platform: ['android'], status: 'active', values: {}, created_at: nowISO() };
      db.configs.push(own);
    }
    own.values = { ...own.values, ...(body.values || {}) };
    for (const k of body.unset || []) delete own.values[k];
    own.updated_at = nowISO();
    bumpConfig(); validateInventory();
    if (!Object.keys(own.values).length) db.configs = db.configs.filter((x: any) => x.id !== own.id);
    await save();
    return { body: { config: resolveFor(screen), stack: cfg.applicable(screen, db.groups || [], db.configs || []).map((c: any) => ({ id: c.id, name: c.name, layer: c.layer })) } };
  }

  if (method === 'POST' && seg[0] === 'screen' && seg[1] && seg[2] === 'reprice') {
    const screen = db.screens.find((x: any) => x.id === seg[1]);
    if (!screen) return { status: 404, body: { error: 'not found' } };
    const r = resolveFor(screen);
    screen.priced_against = Object.fromEntries(cfg.PRICED_KEYS.map(k => [k, r[k]?.value]));
    await save(); return { body: screen };
  }

  if (method === 'POST' && p === 'reset') { const ledger = db.audit || []; db = seed(); db.audit = ledger; await save(); return { body: { ok: true } }; }

  return { status: 404, body: { error: 'no route: ' + method + ' /' + p } };
}
