import crypto from 'crypto';
const PAIR_TTL = 10 * 60e3, BACKLOG_TTL = 72 * 3600e3, ASSIGNMENT_TTL = 3600e3;
const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const iso = (n: number) => new Date(n).toISOString();
const safeScreen = (s: any) => ({ id: s.id, name: s.name, has_camera: !!s.has_camera, loop_length_s: s.loop_length_s });
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
type Playlist = { items: any[]; config: Record<string, any>; config_version: string | number };
type Options = { playlist: (screen: any, device: any) => Playlist; now?: number; clientKey?: string };
type Result = { status?: number; body: any; changed: boolean };
const fail = (status: number, error: string): Result => ({ status, body: { error }, changed: false });
const attempts = new Map<string, { at: number; count: number }>();
/** All reads and changes run inside the caller's persistence transaction. */
export function deviceRoute(db: any, method: string, seg: string[], body: any, token: string | null | undefined, options: Options): Result | null {
  const path = seg.join('/'), now = options.now ?? Date.now();
  if (!((method === 'POST' && ['pair','heartbeat','play','nowplaying'].includes(path)) || (method === 'GET' && /^playlist\/[^/]+$/.test(path)))) return null;
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
  if (path === 'heartbeat') {
    if (!((typeof body.config_version === 'string' && body.config_version.length <= 128) || (Number.isSafeInteger(body.config_version) && body.config_version >= 0))) return fail(400, 'Invalid configuration version');
    const at = Date.parse(body.device_now); if (!Number.isFinite(at)) return fail(400, 'device_now is required');
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
    const p = options.playlist(screen, device), until = now + ASSIGNMENT_TTL;
    db.device_assignments ||= [];
    // Re-issuing identical assignments on every poll is what made the usage ledger unbounded, and an
    // unbounded ledger is one that has to evict — which hands back allowances that were already spent.
    // The same playlist under the same config keeps the same assignments until they expire.
    // The signature must cover everything the assignment row freezes — media identity, the rate it will be
    // billed at, and the measurement settings it was issued under — not just which campaign and creative.
    // Anything omitted here is a field where the playlist we serve and the evidence we keep can disagree.
    const frozen = p.items.map((item: any) => {
      const c = db.campaigns.find((x: any) => x.id === item.campaign_id);
      return [item.campaign_id, c?.advertiser_id || null, item.creative_id, item.youtube_id || null, item.asset_id || null,
        item.duration_s, item.rate_type ?? c?.rate_type ?? 'flat', Number(item.rate_value ?? c?.rate_value) || 0,
        p.config_version, p.config.camera_fail_mode || 'continue', p.config.model || null,
        Number(p.config.sample_interval_s) || 2, Number(p.config.count_ceiling) || 50];
    });
    const signature = hash(JSON.stringify(frozen));
    const held = device.assignment_set;
    if (held && held.signature === signature && Date.parse(held.valid_until) > now + 60e3
      && Array.isArray(held.ids) && held.ids.length === p.items.length) {
      const items = p.items.map((item: any, i: number) => ({ ...item, assignment_id: held.ids[i], valid_until: held.valid_until }));
      return { changed: true, body: { screen: safeScreen(screen), items, config: p.config, config_version: p.config_version, server_time: iso(now), valid_until: held.valid_until } };
    }
    const items = p.items.map((item: any) => {
      const c = db.campaigns.find((c: any) => c.id === item.campaign_id);
      const a = { id: 'assignment_' + crypto.randomUUID(), device_id: device.id, org_id: screen.org_id, screen_id: screen.id,
        campaign_id: item.campaign_id, advertiser_id: c?.advertiser_id || null, creative_id: item.creative_id, youtube_id: item.youtube_id || null, asset_id: item.asset_id || null,
        duration_s: item.duration_s, rate_type: item.rate_type ?? c?.rate_type ?? 'flat', rate_value: Number(item.rate_value ?? c?.rate_value) || 0,
        issued_at: iso(now), valid_until: iso(until), accept_until: iso(now + BACKLOG_TTL), config_version: p.config_version,
        camera_fail_mode: p.config.camera_fail_mode || 'continue', model_configured: p.config.model || null, sample_interval_s: Number(p.config.sample_interval_s) || 2, count_ceiling: Number(p.config.count_ceiling) || 50 };
      db.device_assignments.push(a); return { ...item, assignment_id: a.id, valid_until: a.valid_until };
    });
    device.assignment_set = { signature, valid_until: iso(until), ids: items.map((i: any) => i.assignment_id) };
    return { changed: true, body: { screen: safeScreen(screen), items, config: p.config, config_version: p.config_version, server_time: iso(now), valid_until: iso(until) } };
  }
  const assignment = (db.device_assignments || []).find((a: any) => a.id === body.assignment_id && a.device_id === device.id && a.screen_id === screen.id);
  if (path === 'nowplaying') {
    if (!assignment || Date.parse(assignment.valid_until) < now) return fail(409, 'Playlist assignment expired');
    device.now_playing = { campaign_id: assignment.campaign_id, creative_id: assignment.creative_id, duration_s: assignment.duration_s, started_at: iso(now) };
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
  const offset = clamp(Number.isFinite(device.clock_offset_estimate_ms) ? device.clock_offset_estimate_ms : claimedOffset);
  const timestampValid = start + offset >= Date.parse(assignment.issued_at) - 60e3 && start + offset <= Date.parse(assignment.valid_until) && end + offset <= now + 60e3;
  const expected = Number(assignment.duration_s) * 1000, mediaStart = body.media_started_s, mediaEnd = body.media_ended_s;
  if (!Number.isFinite(mediaStart) || !Number.isFinite(mediaEnd) || mediaStart < 0 || mediaEnd < 0) return fail(400, 'Invalid media progress');
  const mediaValid = mediaStart <= 1 && mediaEnd >= mediaStart && (mediaEnd - mediaStart) * 1000 >= expected - Math.min(1000, expected * .05);
  const durationValid = expected > 0 && played > 0 && played >= expected - Math.min(1000, expected * .05) && played <= expected + 5000;
  const completed = ['ended','duration_observed'].includes(body.ended_reason), cameraAllowed = body.measured || assignment.camera_fail_mode !== 'skip';
  // An assignment is a slot in a loop, not a licence to bill: it can back only as many plays as its own
  // validity window physically has room for, and a device can never claim more airtime than wall-clock time.
  //
  // Both counters live on the DEVICE document, not on scanned play history and not on the assignment row.
  // The production snapshot deliberately hands device requests no play history (see firestore-store.ts),
  // so a counter derived from `db.plays` reads as zero in production; and `device_assignments` is
  // append-only evidence, so it cannot carry a mutable tally. The device row is loaded, mutable, and
  // written in the same transaction as the play, which is exactly what this needs.
  const slotMs = Math.max(1000, Number(assignment.duration_s) * 1000);
  const assignmentWindow = Math.max(slotMs, Date.parse(assignment.valid_until) - Date.parse(assignment.issued_at));
  const assignmentCap = Math.floor(assignmentWindow / slotMs) + 1;
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
  const billable = rendered && timestampValid && cameraAllowed && withinAssignment && withinThroughput;
  const reasons = [!timestampValid && 'clock_or_assignment_window', !durationValid && 'incomplete_playing_duration', !mediaValid && 'incomplete_media_progress', !completed && body.ended_reason, !cameraAllowed && 'camera_required', !withinAssignment && 'assignment_replay_cap', !withinThroughput && 'device_throughput_exceeded'].filter(Boolean);
  const play = { id, play_uid: body.play_uid, seq_no: body.seq_no, device_id: device.id, org_id: screen.org_id, screen_id: screen.id,
    assignment_id: assignment.id, campaign_id: assignment.campaign_id, advertiser_id: assignment.advertiser_id, creative_id: assignment.creative_id, config_version: assignment.config_version,
    started_at: body.started_at_device, ended_at: body.ended_at_device, started_at_device: body.started_at_device, ended_at_device: body.ended_at_device,
    duration_ms: played, playing_duration_ms: played, media_started_s: mediaStart, media_ended_s: mediaEnd, ended_reason: body.ended_reason,
    server_received_at: iso(now), delivery_lag_ms: now - (end + offset), server_clock_offset_ms: claimedOffset, applied_clock_offset_ms: offset,
    timestamp_valid: timestampValid, rendered, clock_offset_difference_ms: Number.isFinite(device.clock_offset_estimate_ms) ? claimedOffset - device.clock_offset_estimate_ms : null, billable, nonbillable_reasons: reasons, payload_hash: payloadHash, source: 'device_report', rate_type: assignment.rate_type, rate_value: assignment.rate_value };
  db.plays ||= []; db.presence ||= []; db.plays.push(play);
  db.presence.push({ id, play_id: id, advertiser_id: assignment.advertiser_id, device_id: device.id, org_id: screen.org_id, screen_id: screen.id,
    measured: body.measured, avg_persons: body.measured ? body.avg_persons : null, sample_count: body.sample_count,
    model_ver: body.measured ? body.model_ver : null, model_configured: assignment.model_configured, config_version: assignment.config_version,
    at: body.ended_at_device, server_received_at: iso(now), source: 'device_report' });
  // Only playback that actually rendered consumes quota, so a flood of malformed reports cannot burn
  // through a screen's own legitimate allowance.
  if (rendered) {
    device.assignment_uses = [{ id: assignment.id, n: used + 1, exp: Date.parse(assignment.accept_until) || now + BACKLOG_TTL },
      ...uses.filter((u: any) => u.id !== assignment.id)];
    device.airtime_buckets = [{ h: bucketKey, ms: spent + played }, ...buckets.filter((b: any) => b.h !== bucketKey)];
  }
  device.last_seq_no = Math.max(device.last_seq_no || 0, body.seq_no);
  if (device.now_playing?.campaign_id === assignment.campaign_id && device.now_playing?.creative_id === assignment.creative_id) delete device.now_playing;
  if (billable && assignment.rate_type === 'per_play') {
    const c = db.campaigns.find((c: any) => c.id === assignment.campaign_id);
    if (c) c.accrued_spend = Math.round(((c.accrued_spend || 0) + assignment.rate_value) * 100) / 100;
  }
  return { changed: true, body: { ok: true, play_id: id, billable, nonbillable_reasons: reasons } };
}
