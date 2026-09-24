import { DiagnosticError, requestDiagnostic, revokeDiagnostic, assertNoDiagnosticLease } from './diagnostics';
import { auditSnapshot, appendAudit, auditView } from './audit';
import { summarizeReadiness } from './readiness';
import { openMedia, mediaUrl } from './media';
import * as store from './store';
import { AccessError, authorize, bootstrap, publicUser, orgView, screenView, advertiserView, capabilities, redact } from './access';
import { seed, uid, nowISO, code6 } from './seed';
import * as cfg from './config';
import { deviceRoute, deviceIdFromToken, pairingCodeHash, issuePairing, revokeDevices } from './devices';
import { InventoryError, validateScreenInput, reverseCalculate, validateBooking, eligibility, groupMatches, defaultSlotsPerLoop } from './inventory';
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
const bumpConfig = () => { db.settings ||= {}; db.settings.config_revision = (db.settings.config_revision || 0) + 1; };
function freezeBookings(c: any, old: any[] = []) {
  assertNoDiagnosticLease(db, [...(c.screen_ids || []), ...old.map((b: any) => b.screen_id)]);
  if (typeof c.name !== 'string' || !c.name.trim()) throw new AccessError(400, 'Campaign name is required');
  if (!['per_play','flat'].includes(c.rate_type) || typeof c.rate_value !== 'number' || !Number.isFinite(c.rate_value) || c.rate_value < 0 || typeof c.committed_budget !== 'number' || !Number.isFinite(c.committed_budget) || c.committed_budget < 0) throw new AccessError(400, 'Enter a valid campaign price and budget');
  c.bookings = validateBooking(c, db.campaigns, inventoryScreens(), db.creatives).map((b: any) => {
    const previous = old.find((x: any) => x.screen_id === b.screen_id);
    const screen = db.screens.find((x: any) => x.id === b.screen_id);
    return { ...b, rate_value: previous?.rate_value ?? c.rate_value, rate_type: previous?.rate_type ?? c.rate_type, rate_version: previous?.rate_version ?? screen.rate_version ?? 'legacy', booked_at: previous?.booked_at ?? nowISO(), pricing_source: previous?.pricing_source ?? 'agreed_campaign_rate' };
  });
}
const inventoryScreens = () => db.screens.map((s: any) => { const v = cfg.flatten(resolveFor(s)); return { ...s, loop_length_s: v.loop_length_s, slot_duration_s: v.slot_duration_s }; });
function validateInventory() { for (const c of db.campaigns) validateBooking(c, db.campaigns, inventoryScreens(), db.creatives); }
function playlistFor(screen: any, _device?: any) {
  const config = cfg.flatten(resolveFor(screen));
  const items: any[] = [], decisions: any[] = [], loopAdvertisers: any[] = [];
  for (const campaign of db.campaigns.filter((c: any) => c.screen_ids?.includes(screen.id))) {
    const advertiser = db.advertisers.find((a: any) => a.id === campaign.advertiser_id);
    const eligible: any[] = [];
    for (const id of campaign.creative_ids || []) {
      const creative = db.creatives.find((x: any) => x.id === id);
      const result = eligibility({ screen, campaign, creative, advertiser, settings: db.settings, config, loopAdvertisers });
      decisions.push({ campaign_id: campaign.id, creative_id: id, eligible: result.eligible, reason: result.reason, rejected_at_step: result.rejected_at_step, warnings: result.warnings, letterbox: result.letterbox });
      if (result.eligible) eligible.push({ result, creative });
    }
    const booking = campaign.bookings?.find((b: any) => b.screen_id === screen.id);
    for (let n = 0; eligible.length && n < (booking?.slots_per_loop ?? defaultSlotsPerLoop(screen)); n++) {
      const { result, creative } = eligible[n % eligible.length], asset = result.asset;
      items.push({ campaign_id: campaign.id, campaign_name: campaign.name, creative_id: creative.id, creative_name: creative.name, advertiser: advertiser?.name || '—', youtube_id: asset.youtube_id, duration_s: asset.duration_s, rate_value: booking?.rate_value ?? campaign.rate_value, rate_type: booking?.rate_type ?? campaign.rate_type, letterbox: result.letterbox, asset_id: asset.asset_id, asset_url: asset.storage_path ? mediaUrl(asset) : undefined, width: asset.width, height: asset.height });
    }
    if (eligible.length && advertiser) loopAdvertisers.push(advertiser);
  }
  return { items, config, config_version: db.settings?.config_revision || 1, decisions, readiness: summarizeReadiness(screen, db.campaigns.filter((c: any) => c.screen_ids?.includes(screen.id)), decisions, items.length) };
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
  if (!dev) return { state: 'unpaired', label: 'not paired', device: null, age_s: null };
  const age = (Date.now() - new Date(dev.last_heartbeat_at).getTime()) / 1000;
  const state = age < 90 ? 'live' : age < 900 ? 'stalled' : 'offline';
  return { state, label: state === 'live' ? 'on air' : state === 'stalled' ? 'not responding' : 'offline', device: dev, age_s: Math.round(age) };
}

type Res = { status?: number; body: any };

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
        loginEmail: seg.join('/') === 'login' ? String(body.email || '').trim().toLowerCase() : undefined,
        pairingCodeHash: seg.join('/') === 'pair' ? pairingCodeHash(String(body.code || '')) : undefined,
        playUid: typeof body.play_uid === 'string' ? body.play_uid : undefined,
        seqNo: body.seq_no, assignmentId: body.assignment_id, orgId: q.get('org') || q.get('org_id') || undefined,
        targetOrg: typeof body.org_id === 'string' ? body.org_id : undefined, entity:q.get('entity') || undefined,
        after:q.get('after') || undefined,limit:Number(q.get('limit')) || 100 }, async () => {
        db = null; auditContext = null;
        const result = await dispatch(method, seg, q, body, token, clientKey);
        const actor = claims ? db?.users.find((u: any) => u.id === claims.uid) : null;
        if (actor) result.body = redact(result.body, actor);
        return result;
      });
    } catch (e) {
      if (e instanceof DiagnosticError || e instanceof AccessError || e instanceof InventoryError || e instanceof store.StoreError) return { status: e.status, body: { error: e.message } };
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
  const pairingAudit = method === 'POST' && p === 'pair' ? auditSnapshot(db) : null;
  const transport = deviceRoute(db, method, seg, body, token, { playlist: playlistFor, clientKey: clientKey || undefined });
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

  if (method === 'GET' && ['directory','audit'].includes(p)) {
    const entity = p === 'audit' ? 'audit' : q.get('entity') || '';
    if (!['orgs','advertisers','creatives','campaigns','screens','users','configs','groups','devices','assets','audit'].includes(entity)) throw new AccessError(400,'Unknown directory');
    const selected = q.get('org') || q.get('org_id') || (isAdmin ? null : actor.org_id);
    const limit = Math.min(100,Math.max(1,Number(q.get('limit')) || 100));
    const rows = (db[entity] || []).filter((r: any) => !selected || (entity === 'orgs' ? r.id : r.org_id) === selected)
      .filter((r: any) => !q.get('after') || r.id > q.get('after')!).sort((a: any,b: any) => a.id.localeCompare(b.id));
    const page = db.directory || {items:rows.slice(0,limit),has_more:rows.length > limit,next_cursor:rows.length > limit ? rows[limit-1].id : null};
    return {body:{...page,items:page.items.map((r: any) => entity === 'audit' ? auditView(r,actor) : entity === 'users' ? publicUser(r) : entity === 'orgs' ? orgView(r,actor) : entity === 'advertisers' ? advertiserView(r,actor) : entity === 'screens' ? screenView({...r,_status:screenStatus(r)},actor) : r)}};
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

  if (method === 'GET' && p === 'bootstrap') return { body: redact(bootstrap(db, actor, screenStatus, q.get('org') || q.get('org_id')), actor) };
  if (method === 'POST' && p === 'logout') {
    actor.auth_version = (actor.auth_version || 0) + 1;
    await save(); return { body: { ok: true } };
  }

  if (method === 'GET' && seg[0] === 'campaign' && seg[1] && !seg[2]) {
    const c = db.campaigns.find((x: any) => x.id === seg[1]);
    if (!c) return { status: 404, body: { error: 'not found' } };
    const plays = db.plays.filter((x: any) => x.campaign_id === c.id);
    const byPlay = Object.fromEntries(db.presence.map((x: any) => [x.play_id, x]));
    // Rendered, measured and billable are three separate questions and are reported as three numbers.
    // A slot that played in full but failed a billing check is delivery that happened and was not charged;
    // collapsing it into either "plays" or "not rendered" alone would misstate one side or the other.
    const agg = (all: any[]) => { const shown = all.filter((r: any) => r.rendered !== false);
      const m = shown.map(r => byPlay[r.id]).filter((x: any) => x?.measured);
      return { plays: shown.length, not_rendered: all.length - shown.length,
        billable: all.filter((r: any) => r.billable !== false).length, measured: m.length,
        avg: m.length ? m.reduce((a: number, b: any) => a + b.avg_persons, 0) / m.length : null }; };
    return { body: {
      history: db.history || { complete: true, scope: 'local_demo' }, campaign: c, advertiser: advertiserView(db.advertisers.find((a: any) => a.id === c.advertiser_id), actor),
      org: orgView(db.orgs.find((o: any) => o.id === c.org_id), actor), totals: agg(plays),
      byScreen: c.screen_ids.map((id: string) => db.screens.find((s: any) => s.id === id)).filter(Boolean)
        .map((s: any) => ({ screen: screenView(s, actor), ...agg(plays.filter((p: any) => p.screen_id === s.id)) })),
      byCreative: c.creative_ids.map((id: string) => db.creatives.find((x: any) => x.id === id)).filter(Boolean)
        .map((cr: any) => ({ creative: cr, ...agg(plays.filter((p: any) => p.creative_id === cr.id)) })),
      plays: plays.slice(-300).reverse().map((p: any) => ({ ...p, presence: byPlay[p.id] || null })),
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
      const cp = plays.filter((p: any) => p.campaign_id === c.id);
      const cm = cp.map((p: any) => byPlay[p.id]).filter((x: any) => x?.measured);
      return { id: c.id, name: c.name, status: c.status, campaign_type: c.campaign_type,
        live: c.status === 'active' && c.starts_at <= t && c.ends_at >= t,
        advertiser: advOf(c.advertiser_id)?.name || '—', starts_at: c.starts_at, ends_at: c.ends_at,
        committed_budget: c.committed_budget, accrued_spend: c.accrued_spend,
        creatives: c.creative_ids.map((id: string) => db.creatives.find((x: any) => x.id === id)).filter(Boolean),
        plays: cp.length, avg: cm.length ? cm.reduce((a: number, b: any) => a + b.avg_persons, 0) / cm.length : null };
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
      nowPlaying: np, campaigns: camps, advertisers: db.advertisers.filter((a: any) => a.org_id === screen.org_id || db.campaigns.some((c: any) => c.org_id === screen.org_id && c.advertiser_id === a.id)).map((a: any) => ({ id: a.id, name: a.name })),
      config: resolved,

      configStack: cfg.applicable(screen, db.groups || [], db.configs || []).map((c: any) => ({ id: c.id, name: c.name, layer: c.layer, keys: Object.keys(c.values || {}).length })),
      configConflicts: cfg.conflicts(screen, db.groups || [], db.configs || []),
      pricingDrift: cfg.pricingDrift(screen, resolved),
      stats: { plays: plays.length, playsToday: plays.filter((p: any) => (p.ended_at || '').slice(0, 10) === t).length,
        measured: measured.length, avg: measured.length ? measured.reduce((a: number, b: any) => a + b.avg_persons, 0) / measured.length : null,
        liveCampaigns: camps.filter((c: any) => c.live).length },
      recent: plays.slice(-40).reverse().map((p: any) => ({ ...p, creative: db.creatives.find((x: any) => x.id === p.creative_id), presence: byPlay[p.id] || null })) } };
  }

  if (method === 'POST' && seg[0] === 'campaign' && seg[1] && !seg[2]) {
    const c = db.campaigns.find((x: any) => x.id === seg[1]);
    if (!c) return { status: 404, body: { error: 'not found' } };
    const previousBookings = c.bookings || [];
    for (const k of ['name','starts_at','ends_at','committed_budget','rate_type','rate_value','status','invoice_status','screen_ids','creative_ids','bookings','dayparts']) if (k in body) c[k] = body[k];
    freezeBookings(c, previousBookings); await save(); return { body: c };
  }
  if (method === 'POST' && p === 'campaign') {
    const c = { id: uid('cmp'), created_at: nowISO(), accrued_spend: 0, status: 'active', campaign_type: 'operator', platform_fee_pct: 0, fee_basis: 'gross', invoice_status: 'not_invoiced', ...body };
    freezeBookings(c); db.campaigns.push(c); await save(); return { body: c };
  }
  if (method === 'POST' && seg[0] === 'creative' && seg[2] === 'approve') {
    const cr = db.creatives.find((x: any) => x.id === seg[1]);
    if (!cr) return { status: 404, body: { error: 'not found' } };
    cr.approval_status = body.status || 'approved'; cr.approved_at = nowISO();
    await save(); return { body: cr };
  }
  if (seg[0] === 'creative' && seg[2] === 'asset') {
    const creative = db.creatives.find((c: any) => c.id === seg[1]);
    if (method === 'GET') return { body: { org_id: creative.org_id } };
    const asset = openMedia(body.proof || '', 'upload');
    if (!asset || asset.creative_id !== creative.id || asset.org_id !== creative.org_id) throw new AccessError(400, 'Invalid verified asset');
    if ((creative.assets || []).length >= 8) throw new AccessError(400,'A creative may have up to eight video variants');
    db.assets ||= []; db.assets.push(asset);
    creative.assets ||= []; creative.assets.push({ ...asset, uri: 'gridcast:' + asset.id });
    creative.duration_s = Math.max(...creative.assets.map((a: any) => a.duration_s));
    creative.aspect = asset.aspect; creative.approval_status = 'pending'; creative.metadata_source = 'server_ffprobe';
    validateInventory(); await save(); return { status: 201, body: { creative, asset } };
  }
  if (method === 'POST' && seg[0] === 'creative' && seg[1] && !seg[2]) {
    const c = db.creatives.find((x: any) => x.id === seg[1]);
    const patch: Record<string, any> = {};
    for (const key of ['name','category']) if (key in body) {
      if (typeof body[key] !== 'string' || !body[key].trim() || body[key].trim().length > 200) throw new AccessError(400, `Enter a ${key} of 1–200 characters`);
      patch[key] = body[key].trim();
    }
    if ('youtube_id' in body) {
      if (typeof body.youtube_id !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(body.youtube_id)) throw new AccessError(400, 'Enter a valid YouTube video ID');
      patch.youtube_id = body.youtube_id;
    }
    if ('duration_s' in body) {
      if (typeof body.duration_s !== 'number' || !Number.isFinite(body.duration_s) || body.duration_s <= 0 || body.duration_s > 86400) throw new AccessError(400, 'Duration must be between 0 and 86400 seconds');
      if (!(patch.youtube_id || c.youtube_id)) throw new AccessError(400, 'Duration can only be edited for YouTube videos');
      patch.duration_s = body.duration_s;
    }
    if (patch.youtube_id && !(patch.duration_s || c.duration_s)) throw new AccessError(400, 'Enter the expected video duration');
    const changed = Object.keys(patch).filter(key => patch[key] !== c[key]);
    if (!changed.length) return {body:c};
    for (const key of changed) c[key] = patch[key];
    if (changed.some(key => key !== 'name')) { c.approval_status = 'pending'; delete c.approved_at; }
    if ('youtube_id' in patch || 'duration_s' in patch) { c.metadata_source = 'operator_declared'; c.aspect ||= '16:9'; }
    c.updated_at = nowISO();
    validateInventory(); await save(); return {body:c};
  }
  if (method === 'POST' && p === 'creative') {
    const c = { metadata_source: 'operator_declared', id: uid('cr'), created_at: nowISO(), approval_status: 'pending', content_source: 'advertiser', ...body };
    db.creatives.push(c); await save(); return { body: c };
  }
  if (method === 'POST' && p === 'advertiser') {
    if (typeof body.name !== 'string' || !body.name.trim()) throw new AccessError(400,'Advertiser name is required');
    const a = { id: uid('adv'), created_at: nowISO(), status:'active', ...body };
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
    const screen: any = { ...validateScreenInput(body), id: uid('scr'), org_id: body.org_id, created_at: nowISO(), rate_version: uid('rate') };
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
    const o = { id: uid('org'), type: 'operator', platform_fee_pct: 10, status: 'active', created_at: nowISO(), ...body };
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
    if ('platform_fee_pct' in body && isAdmin) o.platform_fee_pct = Number(body.platform_fee_pct) || 0;
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
