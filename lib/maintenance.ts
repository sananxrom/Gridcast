import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { can } from './roles';

/** Human-scoped recovery authority, deliberately independent of playback credentials. */
export const MAINTENANCE_TTL_MS = 10 * 60_000;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const iso = (time: number) => new Date(time).toISOString();
export const maintenanceCodeId = (code: unknown) => typeof code === 'string' && /^[A-Z2-9]{16}$/.test(code.trim().toUpperCase().replaceAll('-', ''))
  ? sha(code.trim().toUpperCase().replaceAll('-', '')) : undefined;
export function maintenanceTokenId(token?: string | null) {
  return typeof token === 'string' && /^gm1\.[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/.test(token) ? token.split('.')[1] : undefined;
}
export const maintenanceLimiterIds = (clientKey?: string | null) => ['maintenance_global', 'maintenance_client_' + sha((clientKey || 'unknown').slice(0,512)).slice(0,3)];
export const isMaintenancePath = (seg: string[]) => seg[0] === 'maintenance' || (seg[0] === 'screens' && seg[2] === 'maintenance');
const safe = (g: any, now: number) => ({id:g.id,org_id:g.org_id,screen_id:g.screen_id,device_id:g.device_id,
  status:g.closed_at ? 'closed' : g.revoked_at ? 'revoked' : Date.parse(g.expires_at) <= now ? 'expired' : g.redeemed_at ? 'active' : 'pending',
  issued_at:g.issued_at,expires_at:g.expires_at});
const bad = (status: number, error: string, changed = false) => ({status,body:{error},changed});
function issuer(db: any, grant: any) {
  const user = db.users.find((u: any) => u.id === grant.issuer_id);
  if (!user || user.status === 'disabled' || user.must_change || (user.auth_version || 0) !== grant.issuer_auth_version || user.role !== grant.issuer_role || user.org_id !== grant.issuer_org_id || !can(user.role,'screens')) return null;
  if (!db.orgs.some((o: any)=>o.id === user.org_id && o.status !== 'disabled')) return null;
  const screen = db.screens.find((s: any)=>s.id === grant.screen_id && s.org_id === grant.org_id);
  const device = db.devices.find((d: any)=>d.id === grant.device_id && d.org_id === grant.org_id && d.screen_id === grant.screen_id);
  if (!screen || !device || !db.orgs.some((o: any)=>o.id === grant.org_id && o.status !== 'disabled')) return null;
  return user.role === 'platform_admin' || user.org_id === grant.org_id ? user : null;
}
function audit(db: any, grant: any, action: string, now: number) {
  const human = action === 'issued' || action === 'revoked';
  (db.audit ||= []).push({id:'audit_'+randomUUID(),org_id:grant.org_id,actor_id:human ? grant.issuer_id : grant.id,actor_role:human ? grant.issuer_role : 'maintenance',actor_kind:human ? 'human' : 'maintenance',actor_org_id:human ? grant.issuer_org_id : grant.org_id,
    entity:'maintenance_grants',entity_id:grant.id,action:'maintenance/'+action,at:iso(now),diff:{scope:{changed:true}}});
}
/** All reads, guessing counters and writes must occur in the caller's retriable transaction. */
export function maintenanceRoute(db: any, method: string, seg: string[], body: any, token: string | null | undefined, actor: any, options: {now?:number;clientKey?:string|null} = {}) {
  if (!isMaintenancePath(seg)) return null;
  const now = options.now ?? Date.now(), path = seg.join('/');
  db.maintenance_grants ||= []; db.maintenance_limits ||= [];
  if (seg[0] === 'screens') {
    if (!actor) return bad(401,'Sign in to authorize maintenance');
    if (!can(actor.role,'screens') || actor.must_change) return bad(403,'Screen maintenance is not permitted for this account');
    const screen = db.screens.find((s: any)=>s.id === seg[1] && (actor.role === 'platform_admin' || s.org_id === actor.org_id));
    if (!screen || !db.orgs.some((o: any)=>o.id === screen.org_id && o.status !== 'disabled')) return bad(404,'Screen not found');
    if (method === 'GET' && seg.length === 3) return {body:{devices:db.devices.filter((d: any)=>d.screen_id === screen.id && d.org_id === screen.org_id).map((d: any)=>({id:d.id,org_id:d.org_id,screen_id:d.screen_id,status:d.status,paired_at:d.paired_at || d.created_at,revoked_at:d.revoked_at})),grants:db.maintenance_grants.filter((g: any)=>g.screen_id === screen.id && g.org_id === screen.org_id && Date.parse(g.expires_at) > now).map((g: any)=>safe(g,now))},changed:false};
    if (method === 'POST' && seg.length === 3) {
      if (Object.keys(body).some(k=>k !== 'device_id') || typeof body.device_id !== 'string' || !body.device_id) return bad(400,'Select exactly one device identity');
      const device = db.devices.find((d: any)=>d.id === body.device_id && d.screen_id === screen.id && d.org_id === screen.org_id);
      if (!device) return bad(404,'Device identity not found on this screen');
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const raw = Array.from({length:16},()=>alphabet[randomInt(alphabet.length)]).join('');
      const grant = {id:maintenanceCodeId(raw)!,org_id:screen.org_id,screen_id:screen.id,device_id:device.id,issuer_id:actor.id,issuer_org_id:actor.org_id,issuer_role:actor.role,issuer_auth_version:actor.auth_version || 0,issued_at:iso(now),expires_at:iso(now+MAINTENANCE_TTL_MS)};
      db.maintenance_grants.push(grant); audit(db,grant,'issued',now);
      return {status:201,body:{grant:safe(grant,now),code:raw.match(/.{4}/g)!.join('-'),server_time:iso(now)},changed:true};
    }
    if (method === 'POST' && seg.length === 5 && seg[4] === 'revoke') {
      const grant = db.maintenance_grants.find((g: any)=>g.id === seg[3] && g.screen_id === screen.id && g.org_id === screen.org_id);
      if (!grant) return bad(404,'Maintenance authorization not found');
      if (!grant.revoked_at) { grant.revoked_at=iso(now); audit(db,{...grant,issuer_id:actor.id,issuer_org_id:actor.org_id,issuer_role:actor.role},'revoked',now); }
      return {body:{ok:true,grant:safe(grant,now)},changed:true};
    }
    return bad(404,'Not found');
  }
  if (method !== 'POST') return bad(404,'Not found');
  if (path === 'maintenance/redeem') {
    // Persist denied attempts too. A client key alone can be spoofed, so a shared global
    // budget also limits guesses across clients and application instances.
    const ids = maintenanceLimiterIds(options.clientKey);
    function count(id: string, maximum: number) {
      let row = db.maintenance_limits.find((r: any)=>r.id === id);
      if (!row) { row={id,count:0,until:now+60_000}; db.maintenance_limits.push(row); }
      if (row.until <= now) { row.count=0; row.until=now+60_000; }
      row.count=Math.min(row.count+1,maximum+1); return row.count;
    }
    // At most 4,096 client buckets plus one global row exist. Hash collisions may
    // conservatively throttle unrelated clients; they never expand authority.
    if (count(ids[0],120) > 120 || count(ids[1],10) > 10) return bad(429,'Too many maintenance attempts. Wait one minute.',true);
    const id = maintenanceCodeId(body.code), grant = id && db.maintenance_grants.find((g: any)=>g.id === id);
    if (!grant || grant.redeemed_at || grant.revoked_at || grant.closed_at || Date.parse(grant.expires_at) <= now || !issuer(db,grant)) return bad(401,'Maintenance code is invalid, expired or no longer authorized',true);
    const secret = randomBytes(32).toString('base64url');
    const session = `gm1.${grant.id}.${secret}`;
    grant.session_hash=sha(session); grant.redeemed_at=iso(now); audit(db,grant,'redeemed',now);
    return {body:{ok:true,token:session,grant:safe(grant,now),server_time:iso(now)},changed:true};
  }
  if (!['maintenance/check','maintenance/export','maintenance/replace','maintenance/close'].includes(path)) return bad(404,'Not found');
  const id = maintenanceTokenId(token), grant = id && db.maintenance_grants.find((g: any)=>g.id === id);
  if (typeof grant?.session_hash !== 'string' || !/^[a-f0-9]{64}$/.test(grant.session_hash) || !timingSafeEqual(Buffer.from(grant.session_hash,'hex'),Buffer.from(sha(token!),'hex'))) return bad(401,'Maintenance authorization is required');
  if (typeof body.org_id !== 'string' || !body.org_id || typeof body.screen_id !== 'string' || !body.screen_id || typeof body.device_id !== 'string' || !body.device_id || body.org_id !== grant.org_id || body.screen_id !== grant.screen_id || body.device_id !== grant.device_id) return bad(403,'Maintenance scope does not match this identity');
  // Closing authority grants no access to records. It can revoke an expired or newly
  // invalidated session, allowing best-effort closure without reopening its tools.
  if (path === 'maintenance/close') {
    if (!grant.closed_at) { grant.closed_at=iso(now); audit(db,grant,'closed',now); }
    return {body:{ok:true},changed:true};
  }
  if (grant.closed_at || grant.revoked_at || Date.parse(grant.expires_at) <= now || !issuer(db,grant)) return bad(401,'Maintenance authorization expired or was withdrawn');
  if (path !== 'maintenance/check') audit(db,grant,path === 'maintenance/export' ? 'export_authorized' : 'replacement_authorized',now);
  return {body:{ok:true,grant:safe(grant,now),server_time:iso(now)},changed:path !== 'maintenance/check'};
}
