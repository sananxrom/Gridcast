import { queuedPlays, flushPlays } from './player-queue';
import { diagnosticEvidence, flushDiagnostic } from './player-diagnostics';
import { verifyPlayerTabs, withPlayerEvidence, holdPlayerEvidence, type EvidenceLease } from './player-evidence-lock';
export type MaintenanceGrant = { id: string; org_id: string; screen_id: string; device_id: string; expires_at: string };
export type MaintenanceSession = { token: string; grant: MaintenanceGrant; deadline: number };
export type MaintenanceEvidence = { schema_version: 1; scope: {org_id:string;screen_id:string;device_id:string}; commercial: Awaited<ReturnType<typeof queuedPlays>>; diagnostics: Awaited<ReturnType<typeof diagnosticEvidence>> };
export class MaintenanceAccessError extends Error {}
async function request(path: string, body: any, token?: string) {
  let response: Response;
  try { response = await fetch('/api' + path, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) }); }
  catch { throw new MaintenanceAccessError('Online authorization could not be checked. Tools have closed; saved records remain.'); }
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new MaintenanceAccessError(value.error || 'Maintenance is no longer authorized. Saved records remain.');
  return value;
}
const scope = (grant: MaintenanceGrant) => ({org_id:grant.org_id,screen_id:grant.screen_id,device_id:grant.device_id});
function validGrant(g: any): g is MaintenanceGrant {
  return !!g && ['id','org_id','screen_id','device_id'].every(k => typeof g[k] === 'string' && !!g[k].trim()) && Number.isFinite(Date.parse(g.expires_at));
}
export function assertMaintenance(session: MaintenanceSession) {
  if (!session?.token || !validGrant(session.grant) || !Number.isFinite(session.deadline) || performance.now() >= session.deadline) throw new MaintenanceAccessError('Maintenance access expired. Obtain a new code from the dashboard.');
}
export async function redeemMaintenance(code: string): Promise<MaintenanceSession> {
  const began = performance.now(), reply = await request('/maintenance/redeem', {code});
  const remaining = Date.parse(reply.grant?.expires_at) - Date.parse(reply.server_time);
  if (!validGrant(reply.grant) || typeof reply.token !== 'string' || !reply.token || !Number.isFinite(remaining) || remaining <= 0 || remaining > 600000) throw new MaintenanceAccessError('Maintenance response was incomplete. Obtain a new code.');
  const session = {token:reply.token,grant:reply.grant,deadline:began + remaining}; assertMaintenance(session); return session;
}
export async function checkMaintenance(session: MaintenanceSession, action: 'check' | 'export' | 'replace' = 'check') {
  assertMaintenance(session);
  const reply = await request('/maintenance/' + action, scope(session.grant), session.token);
  assertMaintenance(session);
  if (!validGrant(reply.grant) || JSON.stringify(scope(reply.grant)) !== JSON.stringify(scope(session.grant)) || reply.grant.id !== session.grant.id || reply.grant.expires_at !== session.grant.expires_at) throw new MaintenanceAccessError('Maintenance scope changed. Obtain a new code.');
}
export async function closeMaintenance(session: MaintenanceSession) {
  try { await request('/maintenance/close', scope(session.grant), session.token); } catch { /* Authority still expires server-side; never preserve a local session on failure. */ }
}
export function currentPairing() {
  const raw = localStorage.getItem('gc_device');
  if (!raw) return null;
  const c = JSON.parse(raw);
  if (typeof c?.token !== 'string' || !c.token || typeof c.device_id !== 'string' || !c.device_id || typeof c.screen_id !== 'string' || !c.screen_id) throw new Error('Current pairing could not be read. Saved records remain.');
  return c as {token:string;device_id:string;screen_id:string};
}
export async function scopedEvidence(session: MaintenanceSession): Promise<MaintenanceEvidence> {
  assertMaintenance(session);
  const identity = scope(session.grant);
  // Both storage readers require this explicit nonempty identity; there is no all-device export.
  const [commercial, diagnostics] = await Promise.all([queuedPlays(identity.device_id),diagnosticEvidence(identity.device_id)]);
  assertMaintenance(session);
  if (commercial.some(r => r.device_id !== identity.device_id)) throw new Error('Saved record identity mismatch. Export stopped.');
  return {schema_version:1,scope:identity,commercial,diagnostics};
}
export async function evidenceFingerprint(evidence: MaintenanceEvidence) {
  const bytes = new TextEncoder().encode(JSON.stringify(evidence));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
}
export function evidenceCounts(evidence: MaintenanceEvidence) {
  return {pending:evidence.commercial.filter(r=>!r.blocked).length,blocked:evidence.commercial.filter(r=>r.blocked).length,diagnostics:evidence.diagnostics.reports.length+evidence.diagnostics.reservations.length,total:evidence.commercial.length+evidence.diagnostics.reports.length+evidence.diagnostics.reservations.length};
}
async function attemptDelivery(session: MaintenanceSession) {
  const credential = currentPairing();
  if (!credential || credential.device_id !== session.grant.device_id || credential.screen_id !== session.grant.screen_id) return;
  let rejected = false;
  const send = async (path:string,event:any) => {
    assertMaintenance(session);
    if (rejected) return {status:401,value:{error:'Playback identity is no longer authorized'}};
    const response = await fetch('/api'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credential.token},body:JSON.stringify(event),signal:AbortSignal.timeout(10000)});
    const value=await response.json().catch(()=>({}));if(response.status===401)rejected=true;
    return {status:response.ok&&value.ok!==true?502:response.status,value};
  };
  // Bounded best effort using only the original playback identity. Never relabel history.
  await flushPlays(credential.device_id,async event=>{const r=await send('/play',event);return {status:r.status,error:r.value.error};},100);
  await flushDiagnostic(credential.device_id,event=>send('/diagnostic/result',event));
}

async function evidenceAccess<T>(session: MaintenanceSession, action: () => Promise<T>, lease?: EvidenceLease) {
  assertMaintenance(session);
  if (lease) {
    if (lease.device !== session.grant.device_id) throw new MaintenanceAccessError('Maintenance pause belongs to another identity.');
    return lease.run(action);
  }
  return withPlayerEvidence(session.grant.device_id,action);
}
export async function acquireMaintenanceLease(session: MaintenanceSession) {
  await checkMaintenance(session);
  const lease=await holdPlayerEvidence(session.grant.device_id);
  try {await verifyPlayerTabs();await checkMaintenance(session);return lease;}catch(error){lease.release();throw error;}
}
export async function inspectMaintenance(session: MaintenanceSession, deliver = false, lease?: EvidenceLease) {
  await checkMaintenance(session);
  return evidenceAccess(session, async()=>{
    await verifyPlayerTabs(); await checkMaintenance(session);
    if (deliver) await attemptDelivery(session);
    const evidence = await scopedEvidence(session); await checkMaintenance(session);
    return {evidence,fingerprint:await evidenceFingerprint(evidence)};
  },lease);
}
export async function exportMaintenance(session: MaintenanceSession, lease?: EvidenceLease) {
  await checkMaintenance(session);
  return evidenceAccess(session,async()=>{
    await verifyPlayerTabs(); const evidence=await scopedEvidence(session);
    await checkMaintenance(session,'export');
    return {evidence,fingerprint:await evidenceFingerprint(evidence)};
  },lease);
}
export async function replaceMaintenance(session: MaintenanceSession, code: string, expectedFingerprint: string, acknowledged: boolean, lease?: EvidenceLease) {
  await checkMaintenance(session);
  return evidenceAccess(session,async()=>{
    await verifyPlayerTabs();
    return navigator.locks.request('gridcast-pairing',async()=>{
      await checkMaintenance(session,'replace');
      const original=localStorage.getItem('gc_device'),credential=currentPairing();
      if (!credential || credential.device_id!==session.grant.device_id || credential.screen_id!==session.grant.screen_id) throw new Error('This grant covers historical records, not the browser’s current pairing.');
      const evidence=await scopedEvidence(session),fingerprint=await evidenceFingerprint(evidence);
      if (fingerprint!==expectedFingerprint) throw new Error('Saved records changed. Review and export the latest records before confirming replacement.');
      if (evidenceCounts(evidence).total>0 && !acknowledged) throw new Error('Check your downloaded file and acknowledge the retained records before replacing this pairing.');
      if (!/^[A-Z2-9]{8}$/.test(code.trim().toUpperCase())) throw new Error('Enter the destination screen’s eight-character pairing code.');
      assertMaintenance(session);
      let response:Response;
      try { response=await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code.trim().toUpperCase()}),signal:AbortSignal.timeout(10000)}); }
      catch { throw new Error('Pairing outcome is uncertain. Records remain under the old identity; obtain a fresh pairing code or retry the existing pairing.'); }
      const value=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(response.status>=500?'Pairing outcome is uncertain. Obtain a fresh pairing code.':value.error||'Pairing failed. Existing records remain.');
      if(typeof value.token!=='string'||!value.token||typeof value.device?.id!=='string'||!value.device.id||typeof value.screen?.id!=='string'||!value.screen.id||value.device.screen_id!==value.screen.id)throw new Error('Pairing response was incomplete. Records remain; obtain a fresh pairing code.');
      if(localStorage.getItem('gc_device')!==original)throw new Error('Pairing changed in another tab while the server responded. Reload the player; records remain.');
      // Once the separately authorized pairing succeeds, persist its complete response even if
      // the maintenance window just elapsed. This stores no maintenance capability or evidence.
      try {localStorage.setItem('gc_device',JSON.stringify({token:value.token,device_id:value.device.id,screen_id:value.screen.id}));}
      catch {throw new Error('Pairing succeeded on the server but could not be saved here. Keep this browser open and obtain a fresh pairing code.');}
    });
  },lease);
}
