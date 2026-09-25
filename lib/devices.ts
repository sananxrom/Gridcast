import { accrueScreenDay } from './reporting';
import { reserveBudget, budgetReceipt, physicalPlays } from './budgets';
import { accrueSettlement, appliedOffset, economics } from './settlement';
import crypto from 'crypto';
import { playerReadiness } from './readiness';
import { deviceDiagnosticRoute, diagnosticOffer, DiagnosticError } from './diagnostics';
const PAIR_TTL = 10 * 60e3, BACKLOG_TTL = 72 * 3600e3, ASSIGNMENT_TTL = 3600e3;
const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const iso = (n: number) => new Date(n).toISOString();
const safeScreen = (s: any) => ({ id: s.id, name: s.name, has_camera: !!s.has_camera, loop_length_s: s.loop_length_s });
// Only playback inputs cross the device boundary. Pricing, client labels and future internal
// item fields stay server-side; assignment signatures and frozen billing rows use the original item.
function playbackItem(item: any, assignment: any) {
  return { campaign_id: item.campaign_id, creative_id: item.creative_id, youtube_id: item.youtube_id,
    duration_s: item.duration_s, asset_id: item.asset_id, asset_url: item.asset_url,
    width: item.width, height: item.height, letterbox: item.letterbox,
    kind: item.kind === 'filler' ? 'filler' : 'paid', media_type: item.media_type || 'video',
    asset_sha256: item.asset_sha256, asset_bytes: item.asset_bytes, asset_mime: item.asset_mime,
    assignment_id: assignment.id, valid_until: assignment.valid_until, accept_until: assignment.accept_until, max_plays: assignment.max_plays };
}
export const pairingCodeHash = (code: string) => hash(code.trim().toUpperCase());
export const playRecordId = (deviceId: string, playUid: string) => 'play_' + hash(deviceId + '\0' + playUid);
export function deviceIdFromToken(token?: string | null): string | null {
  return /^gcp_(dev_[a-f0-9-]{36})\.[A-Za-z0-9_-]{43}$/.exec(token || '')?.[1] ?? null;
}
function equal(a: string, b: string) { return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
export function revokeDevices(db: any, screenId: string, now = Date.now()) {
  for (const d of db.devices || []) if (d.screen_id === screenId) { d.status = 'revoked'; d.revoked_at = iso(now); delete d.now_playing; }
  const s = db.screens.find((s: any) => s.id === screenId);
  if (s) { delete s.pairing_code_hash; delete s.pairing_expires_at; delete s.code; }
}
export function issuePairing(db: any, screen: any, now = Date.now()) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from({ length: 8 }, () => chars[crypto.randomInt(chars.length)]).join('');
  screen.pairing_code_hash = pairingCodeHash(code); screen.pairing_expires_at = iso(now + PAIR_TTL);
  delete screen.pairing_used_at; delete screen.code;
  return { code, expires_at: screen.pairing_expires_at };
}
export function authenticateDevice(db: any, token?: string | null, now = Date.now()) {
  const id = deviceIdFromToken(token), device = id && (db.devices || []).find((d: any) => d.id === id);
  if (!device || device.status === 'revoked' || typeof device.token_hash !== 'string' || !equal(device.token_hash, hash(token!)) || !(Date.parse(device.expires_at) > now)) return null;
  const screen = db.screens.find((s: any) => s.id === device.screen_id && s.org_id === device.org_id);
  const org = db.orgs.find((o: any) => o.id === device.org_id);
  if (!screen || !org || org.status === 'disabled' || ['disabled','archived'].includes(screen.status)) return null;
  return { device, screen };
}
function canonical(v: any): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
type Playlist = { items: any[]; filler_items?: any[]; config: Record<string, any>; config_version: string | number; rotation_version?: string; readiness?: { ready: boolean; code: string; message: string; warnings: string[] } };
type Options = { playlist: (screen: any, device: any, rotationIndex?: number) => Playlist; now?: number; clientKey?: string; playerProtocol?: number };
type Result = { status?: number; body: any; changed: boolean };
const fail = (status: number, error: string): Result => ({ status, body: { error }, changed: false });
const attempts = new Map<string, { at: number; count: number }>();
/** All reads and changes run inside the caller's persistence transaction. */
export function deviceRoute(db: any, method: string, seg: string[], body: any, token: string | null | undefined, options: Options): Result | null {
  const path = seg.join('/'), now = options.now ?? Date.now();
  if (!((method === 'POST' && ['pair','heartbeat','play','nowplaying','diagnostic/start','diagnostic/result'].includes(path)) || (method === 'GET' && /^playlist\/[^/]+$/.test(path)))) return null;
  if (path === 'pair') {
    const k = options.clientKey || 'pair', attempt = attempts.get(k);
    if (!attempt || now - attempt.at > 60e3) attempts.set(k, { at: now, count: 1 });
    else if (++attempt.count > 20) return fail(429, 'Too many pairing attempts. Wait a minute.');
    if (attempts.size > 10000) for (const [key, a] of attempts) if (now - a.at > 60e3) attempts.delete(key);
    if (typeof body.code !== 'string' || !/^[A-Z2-9]{8}$/.test(body.code.trim().toUpperCase())) return fail(400, 'Invalid or expired pairing code');
    const screen = db.screens.find((s: any) => s.pairing_code_hash === pairingCodeHash(body.code) && !s.pairing_used_at && Date.parse(s.pairing_expires_at) > now);
    const org = screen && db.orgs.find((o: any) => o.id === screen.org_id);
    if (!screen || !org || org.status === 'disabled' || ['disabled','archived'].includes(screen.status)) return fail(400, 'Invalid or expired pairing code');
    revokeDevices(db, screen.id, now); screen.pairing_used_at = iso(now);
    const id = 'dev_' + crypto.randomUUID(), credential = 'gcp_' + id + '.' + crypto.randomBytes(32).toString('base64url');
    const device = { id, org_id: screen.org_id, screen_id: screen.id, token_hash: hash(credential), status: 'online', created_at: iso(now), expires_at: iso(now + 365 * 864e5), last_heartbeat_at: iso(now), last_seq_no: 0 };
    db.devices ||= []; db.devices.push(device);
    return { changed: true, body: { token: credential, device: { id, screen_id: screen.id, expires_at: device.expires_at }, screen: safeScreen(screen), server_time: iso(now) } };
  }
  const auth = authenticateDevice(db, token, now);
  if (!auth) return fail(401, 'Device must be paired again');
  const { screen, device } = auth;
  if ((body.screen_id && body.screen_id !== screen.id) || (body.org_id && body.org_id !== screen.org_id) || (seg[0] === 'playlist' && seg[1] !== screen.id)) return fail(404, 'Not found');
  if (path.startsWith('diagnostic/')) {
    try { return deviceDiagnosticRoute(db, path, body, screen, device, now, path === 'diagnostic/start' ? options.playlist(screen, device).config_version : undefined); }
    catch (e) { if (e instanceof DiagnosticError) return fail(e.status, e.message); throw e; }
  }
  if (path === 'heartbeat') {
    if (!((typeof body.config_version === 'string' && body.config_version.length <= 128) || (Number.isSafeInteger(body.config_version) && body.config_version >= 0))) return fail(400, 'Invalid configuration version');
    const at = Date.parse(body.device_now); if (!Number.isFinite(at)) return fail(400, 'device_now is required');
    if (body.vision !== undefined) {
      const v = body.vision;
      if (!v || !['disabled','starting','ready','unavailable'].includes(v.camera_state) || !['loading','ready','error','not_loaded'].includes(v.model_state) || (v.model_ver !== null && v.model_ver !== 'coco-ssd@2.2.3/lite_mobilenet_v2') || (v.last_sample_at !== null && (typeof v.last_sample_at !== 'string' || !Number.isFinite(Date.parse(v.last_sample_at))))) return fail(400, 'Invalid detector status');
      device.vision = { camera_state: v.camera_state, model_state: v.model_state, model_ver: v.model_ver, last_sample_at: v.last_sample_at, reported_at: iso(now), source: 'device_report' };
    }
    device.last_heartbeat_at = iso(now); device.status = 'online';
    device.app_ver = String(body.app_ver || '').slice(0, 80); device.agent_ver = String(body.agent_ver || '').slice(0, 100);
    device.applied_config_version = body.config_version ?? null;
    device.uptime_s = Number.isFinite(body.uptime_s) && body.uptime_s >= 0 ? body.uptime_s : null;
    device.free_disk_bytes = Number.isFinite(body.free_disk_bytes) && body.free_disk_bytes >= 0 ? body.free_disk_bytes : null;
    device.clock_offset_estimate_ms = now - at; // Includes transit; not a synchronized-clock guarantee.
    device.clock_offset_observed_at = iso(now);
    return { changed: true, body: { ok: true, server_time: iso(now), config_version: options.playlist(screen, device).config_version } };
  }
  if (seg[0] === 'playlist') {
    if ((options.playerProtocol || 0) < 2) return {changed:false,body:{screen:safeScreen(screen),items:[],filler_items:[],reload_required:true,server_time:iso(now)}};
    const held = device.assignment_set;
    const heldIndex = Number.isSafeInteger(held?.rotation_index) && held.rotation_index >= 0 ? held.rotation_index : 0;
    let rotationIndex = heldIndex;
    const playlistAt = (index: number) => { const p = options.playlist(screen,device,index); return {...p,items:[...p.items,...(p.filler_items || []).map((i: any) => ({...i,kind:'filler',campaign_id:null}))]}; };
    let p = playlistAt(rotationIndex);
    const assignmentUntil = () => Math.min(now + (p.items.every((i: any) => i.asset_id) ? 24 * 3600e3 : ASSIGNMENT_TTL),
      ...p.items.map((i: any) => Number.isFinite(Date.parse(i.authorization_until)) ? Date.parse(i.authorization_until) : Infinity));
    let until = assignmentUntil();
    db.device_assignments ||= [];
    // Re-issuing identical assignments on every poll is what made the usage ledger unbounded, and an
    // unbounded ledger is one that has to evict — which hands back allowances that were already spent.
    // The same playlist under the same config keeps the same assignments until they expire.
    // The signature must cover everything the assignment row freezes — media identity, the rate it will be
    // billed at, and the measurement settings it was issued under — not just which campaign and creative.
    // Anything omitted here is a field where the playlist we serve and the evidence we keep can disagree.
    const playlistSignature = (playlist: Playlist) => {
      const p = playlist;
      const frozen = p.items.map((item: any) => {
      const c = db.campaigns.find((x: any) => x.id === item.campaign_id);
      return [item.campaign_id, c?.advertiser_id || null, item.creative_id, item.youtube_id || null, item.asset_id || null,
        economics(item), item.duration_s, item.media_type || 'video', item.width || null, item.height || null, item.kind || 'paid', item.asset_sha256 || null, item.rate_type ?? c?.rate_type ?? 'flat', Number(item.rate_value ?? c?.rate_value) || 0, c?.committed_budget ?? null,
        p.config_version, p.config.camera_fail_mode || 'continue', p.config.model || null,
        Number(p.config.sample_interval_s) || 2, Number(p.config.count_ceiling) || 50];
    });
      return hash(JSON.stringify({ frozen, config_version: p.config_version, rotation_version: p.rotation_version ?? null }));
    };
    const grantItem = (item: any, validUntil: number) => {
      const c = db.campaigns.find((c: any) => c.id === item.campaign_id);
      const a = { ...economics(item), id: 'assignment_' + crypto.randomUUID(), device_id: device.id, org_id: screen.org_id, screen_id: screen.id,
        kind: item.kind === 'filler' ? 'filler' : 'paid', media_type: item.media_type || 'video', width:item.width ?? null, height:item.height ?? null, max_plays: 0,
        campaign_id: item.campaign_id, advertiser_id: c?.advertiser_id || null, creative_id: item.creative_id, youtube_id: item.youtube_id || null, asset_id: item.asset_id || null,
        duration_s: item.duration_s, rate_type: item.rate_type ?? c?.rate_type ?? 'flat', rate_value: Number(item.rate_value ?? c?.rate_value) || 0,
        issued_at: iso(now), valid_until: iso(validUntil), accept_until: iso(now + BACKLOG_TTL), config_version: p.config_version,
        camera_fail_mode: p.config.camera_fail_mode || 'continue', model_configured: p.config.model || null, sample_interval_s: Number(p.config.sample_interval_s) || 2, count_ceiling: Number(p.config.count_ceiling) || 50 };
      const max = a.kind === 'filler' ? physicalPlays(a) : c ? reserveBudget(db,c,a,physicalPlays(a),now) : 0;
      if (!max) return []; a.max_plays = max;
      db.device_assignments.push(a); return [playbackItem(item, a)];
    };
    let signature = playlistSignature(p);
    if (held && held.signature === signature && Date.parse(held.valid_until) > now + 60e3
      && Array.isArray(held.ids)
      && (!held.ids.some((id: string) => db.device_assignments.find((a: any) => a.id === id)?.kind !== 'filler')
        || held.ids.some((id: string) => { const a = db.device_assignments.find((a: any) => a.id === id); return a && a.kind !== 'filler' && (Number(device.assignment_uses?.find((u: any) => u.id === id)?.n) || 0) < a.max_plays; }))
      && held.ids.every((id: string) => db.device_assignments.some((a: any) => a.id === id && Number.isSafeInteger(a.max_plays)))) {
      // Replenish only acknowledged exhausted or previously unfunded entries. Keep each
      // still-live allowance intact so renewing one campaign never locks another's money twice.
      const remaining = held.ids.map((id: string) => db.device_assignments.find((a: any) => a.id === id));
      const items = p.items.flatMap((item: any) => {
        const index = remaining.findIndex((a: any) => a && a.campaign_id === item.campaign_id && a.creative_id === item.creative_id);
        const a = index >= 0 ? remaining.splice(index,1)[0] : null;
        const used = a ? Number(device.assignment_uses?.find((u: any) => u.id === a.id)?.n) || 0 : 0;
        return a && used < a.max_plays ? [playbackItem(item,a)] : grantItem(item,Date.parse(held.valid_until));
      });
      held.ids = items.map((i: any) => i.assignment_id);
      return { changed: true, body: { screen: safeScreen(screen), scheduling_mode:'continuous', budget_state: items.filter((i: any) => i.kind !== 'filler').length < p.items.filter((i: any) => i.kind !== 'filler').length ? 'reserved_elsewhere_or_exhausted' : 'available', items: items.filter((i: any) => i.kind !== 'filler'), filler_items: items.filter((i: any) => i.kind === 'filler'), config: p.config, config_version: p.config_version, server_time: iso(now), readiness: playerReadiness(p.readiness), diagnostic: diagnosticOffer(db, screen, device, now), valid_until: held.valid_until } };
    }
    // Advance only when this transaction actually mints a replacement set. Retries and calendar
    // boundaries use the persisted phase above; final-minute renewal advances exactly once.
    if (held) {
      rotationIndex = heldIndex < Number.MAX_SAFE_INTEGER ? heldIndex + 1 : 0;
      p = playlistAt(rotationIndex);
      until = assignmentUntil();
      signature = playlistSignature(p);
    }
    const items = p.items.flatMap((item: any) => grantItem(item,until));
    device.assignment_set = { signature, rotation_index: rotationIndex, valid_until: iso(until), ids: items.map((i: any) => i.assignment_id) };
    return { changed: true, body: { screen: safeScreen(screen), scheduling_mode:'continuous', budget_state: items.filter((i: any) => i.kind !== 'filler').length < p.items.filter((i: any) => i.kind !== 'filler').length ? 'reserved_elsewhere_or_exhausted' : 'available', items: items.filter((i: any) => i.kind !== 'filler'), filler_items: items.filter((i: any) => i.kind === 'filler'), config: p.config, config_version: p.config_version, server_time: iso(now), readiness: playerReadiness(p.readiness), diagnostic: diagnosticOffer(db, screen, device, now), valid_until: iso(until) } };
  }
  const assignment = (db.device_assignments || []).find((a: any) => a.id === body.assignment_id && a.device_id === device.id && a.screen_id === screen.id);
  if (path === 'nowplaying') {
    if (!assignment || Date.parse(assignment.valid_until) < now) return fail(409, 'Playlist assignment expired');
    device.now_playing = { kind:assignment.kind || 'paid', media_type:assignment.media_type || 'video', campaign_id: assignment.campaign_id, creative_id: assignment.creative_id, duration_s: assignment.duration_s, started_at: iso(now) };
    return { changed: true, body: { ok: true } };
  }
  if (typeof body.play_uid !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.play_uid) || !Number.isSafeInteger(body.seq_no) || body.seq_no < 1) return fail(400, 'Invalid play identity');
  const id = playRecordId(device.id, body.play_uid), payloadHash = hash(canonical(body));
  const existing = (db.plays || []).find((p: any) => p.id === id);
  if (existing) return existing.payload_hash === payloadHash ? { changed: false, body: { ok: true, duplicate: true, play_id: id, billable: existing.billable } } : fail(409, 'Play UID already has a different payload');
  if ((db.plays || []).some((p: any) => p.device_id === device.id && p.seq_no === body.seq_no)) return fail(409, 'Sequence number already used');
  if (!assignment || Date.parse(assignment.accept_until) < now) return fail(409, 'Unknown or expired playlist assignment');
  if (body.campaign_id !== assignment.campaign_id || body.creative_id !== assignment.creative_id || body.config_version !== assignment.config_version) return fail(409, 'Play does not match its playlist assignment');
  const start = Date.parse(body.started_at_device), end = Date.parse(body.ended_at_device), played = body.playing_duration_ms;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 3600e3 || !Number.isFinite(played) || played < 0 || played > end - start + 1000) return fail(400, 'Invalid observed playback duration');
  if (!['ended','duration_observed','error','timeout','interrupted'].includes(body.ended_reason)) return fail(400, 'Invalid playback end reason');
  if (typeof body.measured !== 'boolean' || !Number.isSafeInteger(body.sample_count) || body.sample_count < 0 || body.sample_count > 100000) return fail(400, 'Invalid measurement');
  if (body.measured && (!Number.isFinite(body.avg_persons) || body.avg_persons < 0 || body.avg_persons > 10000 || !body.sample_count || typeof body.model_ver !== 'string' || !body.model_ver.trim())) return fail(400, 'Measured presence needs samples and actual model provenance');
  if (body.measured && (assignment.model_configured !== 'coco-ssd' || body.model_ver !== 'coco-ssd@2.2.3/lite_mobilenet_v2' || body.sample_count > Math.ceil(played / (Math.max(.5, assignment.sample_interval_s) * 1000)) + 1 || body.avg_persons > assignment.count_ceiling)) return fail(400, 'Presence does not match the applied measurement configuration');
  if (!body.measured && (body.avg_persons !== null || body.sample_count !== 0)) return fail(400, 'Unmeasured presence must be null with zero samples');
  const claimedOffset = Number.isFinite(body.server_clock_offset_ms) ? body.server_clock_offset_ms : 0;
  if (Math.abs(claimedOffset) > 864e5) return fail(400, 'Clock offset exceeds one day');
  // A device may state its own clock offset, but it never decides its own billing window with it.
  // Prefer the server's own heartbeat-derived estimate; without one, allow only a small claim.
  // The heartbeat estimate is derived from device_now, which is also device-supplied, so it is bounded the
  // same way. Real skew beyond a few minutes is a fault to surface, not a billing window to grant.
  const OFFSET_LIMIT = 300e3, clamp = (v: number) => Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, v));
  const offset = appliedOffset(device,claimedOffset);
  const timestampValid = start + offset >= Date.parse(assignment.issued_at) - 60e3 && start + offset <= Date.parse(assignment.valid_until) && end + offset <= now + 60e3
    && (!assignment.budget_version || end + offset <= Date.parse(assignment.valid_until) + 1000);
  const expected = Number(assignment.duration_s) * 1000, mediaStart = body.media_started_s, mediaEnd = body.media_ended_s;
  if (assignment.media_type !== 'image' && (!Number.isFinite(mediaStart) || !Number.isFinite(mediaEnd) || mediaStart < 0 || mediaEnd < 0)) return fail(400, 'Invalid media progress');
  const image = assignment.media_type === 'image';
  const imageValid = body.media_evidence === 'image_decode' && Number.isSafeInteger(body.decoded_width) && body.decoded_width > 0
    && Number.isSafeInteger(body.decoded_height) && body.decoded_height > 0
    && Number.isSafeInteger(assignment.width) && Number.isSafeInteger(assignment.height)
    && body.decoded_width === assignment.width && body.decoded_height === assignment.height && Number.isFinite(body.visible_duration_ms)
    && body.visible_duration_ms >= expected - Math.min(1000, expected * .05) && body.visible_duration_ms <= played + 1000;
  const mediaValid = image ? imageValid : (body.media_evidence === undefined || body.media_evidence === 'media_timeline')
    && mediaStart <= 1 && mediaEnd >= mediaStart && (mediaEnd - mediaStart) * 1000 >= expected - Math.min(1000, expected * .05);
  const durationValid = expected > 0 && played > 0 && played >= expected - Math.min(1000, expected * .05) && played <= expected + 5000;
  const completed = ['ended','duration_observed'].includes(body.ended_reason), cameraAllowed = body.measured || assignment.camera_fail_mode !== 'skip';
  // An assignment grants a finite number of attempts within its validity window.
  // Budget reservations cap paid attempts; physical throughput independently bounds claimed airtime.
  //
  // Both counters live on the DEVICE document, not on scanned play history and not on the assignment row.
  // The production snapshot deliberately hands device requests no play history (see firestore-store.ts),
  // so a counter derived from `db.plays` reads as zero in production; and `device_assignments` is
  // append-only evidence, so it cannot carry a mutable tally. The device row is loaded, mutable, and
  // written in the same transaction as the play, which is exactly what this needs.
  const slotMs = Math.max(1000, Number(assignment.duration_s) * 1000);
  const assignmentWindow = Math.max(slotMs, Date.parse(assignment.valid_until) - Date.parse(assignment.issued_at));
  const assignmentCap = Number.isSafeInteger(assignment.max_plays) ? assignment.max_plays : Math.floor(assignmentWindow / slotMs) + 1;
  // Kept only while the assignment can still be played into; entries are dropped by expiry, never by age,
  // so evicting one can never hand back an allowance that was already spent.
  const uses: any[] = (Array.isArray(device.assignment_uses) ? device.assignment_uses : [])
    .filter((u: any) => u && Number(u.exp) > now);
  const used = Number(uses.find((u: any) => u.id === assignment.id)?.n) || 0;
  const withinAssignment = used < assignmentCap;
  // Airtime is charged to the hour the playback happened in, not the hour it was uploaded in: a box that
  // was offline for a day and flushes its backlog is delivering real plays, not inflating anything. Each
  // playback hour holds at most an hour of airtime, and buckets are kept for the whole acceptance window,
  // so a replay of old timestamps lands in a bucket that is already spent.
  const HOUR = 3600e3;
  const playedAt = start + offset;
  const bucketKey = Math.floor(playedAt / HOUR);
  const buckets: any[] = (Array.isArray(device.airtime_buckets) ? device.airtime_buckets : [])
    .filter((b: any) => b && Number.isFinite(b.h) && b.h * HOUR > now - BACKLOG_TTL - HOUR);
  const spent = Number(buckets.find((b: any) => b.h === bucketKey)?.ms) || 0;
  const withinThroughput = spent + played <= HOUR * 1.1;
  // Rendered, measured and billable are three different questions. A slot can play in full and still be
  // unbillable on clock, quota or camera policy; that is not the same as never having reached the screen.
  const rendered = completed && durationValid && mediaValid;
  const paid = assignment.kind !== 'filler';
  const candidateBillable = rendered && timestampValid && cameraAllowed && withinAssignment && withinThroughput && paid;
  const campaign = db.campaigns.find((c: any) => c.id === assignment.campaign_id);
  const budgetAllowed = paid ? budgetReceipt(db,campaign,assignment,true,candidateBillable,now) : true;
  const billable = candidateBillable && budgetAllowed;
  const reasons = [!paid && 'filler', !budgetAllowed && 'budget_allowance_exhausted', !timestampValid && 'clock_or_assignment_window', !durationValid && 'incomplete_playing_duration', !mediaValid && 'incomplete_media_progress', !completed && body.ended_reason, !cameraAllowed && 'camera_required', !withinAssignment && 'assignment_replay_cap', !withinThroughput && 'device_throughput_exceeded'].filter(Boolean);
  const play = { ...economics(assignment), id, play_uid: body.play_uid, seq_no: body.seq_no, device_id: device.id, org_id: screen.org_id, screen_id: screen.id,
    assignment_id: assignment.id, campaign_id: assignment.campaign_id, advertiser_id: assignment.advertiser_id, creative_id: assignment.creative_id, config_version: assignment.config_version,
    started_at: body.started_at_device, ended_at: body.ended_at_device, started_at_device: body.started_at_device, ended_at_device: body.ended_at_device,
    kind: assignment.kind || 'paid', media_type: assignment.media_type || 'video',
    duration_ms: played, playing_duration_ms: played, media_started_s: image ? null : mediaStart, media_ended_s: image ? null : mediaEnd,
    media_evidence: image ? 'image_decode' : 'media_timeline', decoded_width: image ? body.decoded_width ?? null : null,
    decoded_height: image ? body.decoded_height ?? null : null, visible_duration_ms: image ? body.visible_duration_ms ?? null : null, ended_reason: body.ended_reason,
    server_received_at: iso(now), delivery_lag_ms: now - (end + offset), server_clock_offset_ms: claimedOffset, applied_clock_offset_ms: offset,
    timestamp_valid: timestampValid, rendered, clock_offset_difference_ms: Number.isFinite(device.clock_offset_estimate_ms) ? claimedOffset - device.clock_offset_estimate_ms : null, billable, nonbillable_reasons: reasons, payload_hash: payloadHash, source: 'device_report', rate_type: assignment.rate_type, rate_value: assignment.rate_value };
  db.plays ||= []; db.presence ||= []; db.plays.push(play);
  db.presence.push({ id, play_id: id, advertiser_id: assignment.advertiser_id, device_id: device.id, org_id: screen.org_id, screen_id: screen.id,
    measured: body.measured, avg_persons: body.measured ? body.avg_persons : null, sample_count: body.sample_count,
    model_ver: body.measured ? body.model_ver : null, model_configured: assignment.model_configured, config_version: assignment.config_version,
    at: body.ended_at_device, server_received_at: iso(now), source: paid ? 'device_report' : 'filler_device_report' });
  // Every accepted attempt consumes its local allowance, including an acknowledged load failure.
  // Malformed reports returned above consume nothing; airtime still requires actual rendering.
  device.assignment_uses = [{ id: assignment.id, n: used + 1, exp: Date.parse(assignment.accept_until) || now + BACKLOG_TTL },
      ...uses.filter((u: any) => u.id !== assignment.id)];
  if (rendered) {
    device.airtime_buckets = [{ h: bucketKey, ms: spent + played }, ...buckets.filter((b: any) => b.h !== bucketKey)];
  }
  device.last_seq_no = Math.max(device.last_seq_no || 0, body.seq_no);
  if (device.now_playing?.campaign_id === assignment.campaign_id && device.now_playing?.creative_id === assignment.creative_id) delete device.now_playing;
  accrueScreenDay(db,play,assignment,playedAt,db.presence[db.presence.length - 1]);
  accrueSettlement(db,play,assignment,playedAt);
  if (billable && assignment.rate_type === 'per_play' && !assignment.econ_version) {
    const c = db.campaigns.find((c: any) => c.id === assignment.campaign_id);
    if (c && c.org_id === screen.org_id && c.campaign_type !== 'network') c.accrued_spend = Math.round(((c.accrued_spend || 0) + assignment.rate_value) * 100) / 100;
  }
  return { changed: true, body: { ok: true, play_id: id, billable, nonbillable_reasons: reasons } };
}
