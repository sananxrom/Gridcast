import crypto from 'crypto';

const iso = (n: number) => new Date(n).toISOString();
const MODEL = 'coco-ssd@2.2.3/lite_mobilenet_v2';
export class DiagnosticError extends Error { constructor(message: string, public status = 409) { super(message); } }
const fail = (message: string, status = 409): never => { throw new DiagnosticError(message, status); };
export function assertNoDiagnosticLease(db: any, screenIds: string[], now = Date.now()) {
  if ((db.screens || []).some((s: any) => screenIds.includes(s.id) && Date.parse(s.diagnostic_hold_until) > now)) fail('A screen diagnostic is running. Try this change again in a few seconds.');
}
export function requestDiagnostic(db: any, screen: any, actor: any, settings: { config: any; config_version: any }, now = Date.now()) {
  const device = (db.devices || []).find((d: any) => d.screen_id === screen.id && d.status !== 'revoked' && Date.parse(d.expires_at) > now);
  if (!device) fail('Pair a device before requesting a screen test.');
  db.diagnostic_assignments ||= [];
  const existing = db.diagnostic_assignments.find((a: any) => a.id === device.current_diagnostic_id && ['pending','running'].includes(a.status) && Date.parse(a.expires_at) > now);
  if (existing) return existing;
  const a = { id: 'diagnostic_' + crypto.randomUUID(), kind: 'diagnostic', org_id: screen.org_id, screen_id: screen.id, device_id: device.id,
    requested_by: actor.id, requested_at: iso(now), expires_at: iso(now + 600e3), status: 'pending',
    duration_s: 12, asset_url: '/diagnostics/screen-test.mp4', width: 640, height: 360, rate_value: 0,
    has_camera: !!screen.has_camera, config: settings.config, config_version: settings.config_version };
  db.diagnostic_assignments.push(a); device.current_diagnostic_id = a.id; return a;
}
export function revokeDiagnostic(db: any, screen: any, id: string, actor: any, now = Date.now()) {
  const a = (db.diagnostic_assignments || []).find((a: any) => a.id === id && a.screen_id === screen.id);
  if (!a) fail('Screen test not found', 404);
  if (a.status === 'completed') fail('This screen test is already complete.');
  a.status = 'revoked'; a.revoked_at = iso(now); a.revoked_by = actor.id;
  // Keep a running lease until its deadline: a disconnected player may still finish the clip.
  return a;
}
/** Conservative gap: no pending, active or paused reservation can target this screen.
 * Never infer free time from an ineligible playlist (paused/blocked campaigns still own inventory).
 */
export function diagnosticWaitReason(db: any, screen: any, now = Date.now()) {
  if ((db.campaigns || []).some((c: any) => ['pending','active','paused'].includes(c.status) && c.screen_ids?.includes(screen.id))) return 'Screen test is waiting: commercial inventory is reserved on this screen.';
  if (screen.status !== 'active') return 'Screen test is waiting for the screen to be active.';
  return null;
}
export function diagnosticOffer(db: any, screen: any, device: any, now = Date.now()) {
  const a = (db.diagnostic_assignments || []).find((a: any) => a.id === device.current_diagnostic_id && a.device_id === device.id);
  if (!a) return null;
  const status = Date.parse(a.expires_at) <= now && a.status === 'pending' ? 'expired' : a.status;
  return { assignment_id: a.id, status, expires_at: a.expires_at, message: status === 'pending' ? diagnosticWaitReason(db, screen, now) || 'Screen test is ready; waiting for a free playback boundary.' : `Screen test ${status}.` };
}
const canonical = (v: any): string => v && typeof v === 'object' ? Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v);
export function deviceDiagnosticRoute(db: any, path: string, body: any, screen: any, device: any, now = Date.now(), currentConfigVersion?: string | number) {
  const a = (db.diagnostic_assignments || []).find((a: any) => a.id === body.assignment_id && a.device_id === device.id && a.screen_id === screen.id);
  if (!a) fail('Unknown screen test', 404);
  if (a.status === 'revoked') fail('Screen test was revoked');
  if (typeof body.run_uid !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.run_uid)) fail('Invalid diagnostic run identity', 400);
  if (path === 'diagnostic/start') {
    if (Date.parse(a.expires_at) <= now) fail('Screen test expired');
    if (currentConfigVersion !== undefined && a.config_version !== currentConfigVersion) { a.status = 'revoked'; a.revoked_at = iso(now); a.revocation_reason = 'configuration_changed'; return { changed: true, body: { ok: false, cancelled: true, message: 'Screen settings changed. Request a new screen test.' } }; }
    if (a.status !== 'pending') fail('Screen test has already been claimed; it cannot run twice.');
    const wait = diagnosticWaitReason(db, screen, now); if (wait) return { changed: false, body: { ok: false, waiting: true, message: wait } };
    if (device.now_playing && Date.parse(device.now_playing.started_at) + Number(device.now_playing.duration_s) * 1000 > now) return { changed: false, body: { ok: false, waiting: true, message: 'Waiting for current playback to finish.' } };
    a.status = 'running'; a.run_uid = body.run_uid; a.started_at = iso(now); a.run_until = iso(now + 20e3); a.accept_until = iso(now + 864e5);
    screen.diagnostic_hold_until = a.run_until;
    return { changed: true, body: { ok: true, assignment: { assignment_id: a.id, kind: 'diagnostic', diagnostic_has_camera: a.has_camera, valid_until: a.run_until, duration_s: a.duration_s,
      asset_url: a.asset_url, width: a.width, height: a.height, creative_name: 'Screen diagnostic', campaign_id: '', creative_id: '', advertiser: '', rate_value: 0 }, config: a.config, config_version: a.config_version } };
  }
  if (a.run_uid !== body.run_uid) fail('Diagnostic run does not match its claim');
  const hash = crypto.createHash('sha256').update(canonical(body)).digest('hex');
  const old = (db.diagnostic_results || []).find((r: any) => r.id === a.id);
  if (old) { if (old.payload_hash !== hash) fail('Diagnostic result already has a different payload'); return { changed: false, body: { ok: true, duplicate: true } }; }
  if (a.status !== 'running' || Date.parse(a.accept_until) <= now) fail('Diagnostic result window expired');
  const start = Date.parse(body.started_at_device), end = Date.parse(body.ended_at_device), played = body.playing_duration_ms;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 20e3 || !Number.isFinite(played) || played < 0 || played > 20e3 || played > end - start + 1000) fail('Invalid diagnostic playback times', 400);
  if (!['ended','duration_observed','interrupted','error','timeout'].includes(body.ended_reason)) fail('Invalid diagnostic end reason', 400);
  if (typeof body.measured !== 'boolean' || !Number.isSafeInteger(body.sample_count) || body.sample_count < 0) fail('Invalid diagnostic sample', 400);
  if (body.measured && (!a.has_camera || body.camera_state !== 'ready' || body.model_state !== 'ready' || !Number.isFinite(body.avg_persons) || body.avg_persons < 0 || body.avg_persons > (Number(a.config.count_ceiling) || 50) || body.sample_count < 1 || body.sample_count > Math.ceil(played / (Math.max(.5, Number(a.config.sample_interval_s) || 2) * 1000)) + 1 || body.model_ver !== MODEL || a.config.model !== 'coco-ssd')) fail('Invalid diagnostic measurement provenance', 400);
  if (!body.measured && (body.avg_persons !== null || body.sample_count !== 0 || body.model_ver !== null)) fail('Unmeasured diagnostic must be null', 400);
  if (!['disabled','starting','ready','unavailable'].includes(body.camera_state) || !['loading','ready','error','not_loaded'].includes(body.model_state)) fail('Invalid reported detector state', 400);
  const result = { id: a.id, assignment_id: a.id, run_uid: a.run_uid, device_id: device.id, screen_id: screen.id, org_id: screen.org_id,
    diagnostic: true, billable: false, source: 'device_report', config_version: a.config_version, model_configured: a.config.model || null,
    received_at: iso(now), requested_by: a.requested_by, started_at_device: body.started_at_device, ended_at_device: body.ended_at_device,
    playing_duration_ms: played, ended_reason: body.ended_reason, measured: body.measured, avg_persons: body.avg_persons, sample_count: body.sample_count, model_ver: body.model_ver,
    camera_state: body.camera_state, model_state: body.model_state, payload_hash: hash };
  db.diagnostic_results ||= []; db.diagnostic_results.push(result); a.status = 'completed'; a.completed_at = iso(now);
  return { changed: true, body: { ok: true, result_id: result.id } };
}
