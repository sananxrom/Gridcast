import { can } from './roles';
import { randomUUID } from 'node:crypto';
// Values are deliberately limited: no passwords, tokens, contact details, notes,
// payout identifiers, media grants or arbitrary config/body values enter this ledger.
const VALUES = new Set(['status','role','org_id','advertiser_id','approval_status','has_camera','rate_type','rate_value','committed_budget','invoice_status','screen_ids','creative_ids','starts_at','ends_at','network_available','platform_fee_pct']);
const COLLECTIONS = ['orgs','users','screens','advertisers','creatives','campaigns','groups','configs','diagnostic_assignments','devices','assets'];
export function auditSnapshot(db: any) {
  return {settings:JSON.parse(JSON.stringify(db.settings || {})),...Object.fromEntries(COLLECTIONS.map(k => [k, JSON.parse(JSON.stringify(db[k] || []))]))};
}
export function appendAudit(db: any, before: any, actor: any, action: string) {
  db.audit ||= [];
  if (JSON.stringify(before.settings) !== JSON.stringify(db.settings || {})) {
    const fields = [...new Set([...Object.keys(before.settings || {}), ...Object.keys(db.settings || {})])].filter(k => JSON.stringify(before.settings?.[k]) !== JSON.stringify(db.settings?.[k]));
    db.audit.push({id:'audit_'+randomUUID(),actor_id:actor.id,actor_role:actor.role,actor_kind:actor.role === 'device' ? 'device' : 'human',actor_org_id:actor.org_id,org_id:actor.org_id,entity:'settings',entity_id:'platform',action,at:new Date().toISOString(),diff:Object.fromEntries(fields.map(k => [k,{changed:true}]))});
  }
  for (const collection of COLLECTIONS) {
    const previous = new Map((before[collection] || []).map((r: any) => [r.id,r]));
    const current = new Map((db[collection] || []).map((r: any) => [r.id,r]));
    for (const id of new Set([...previous.keys(),...current.keys()])) {
      const a: any = previous.get(id), b: any = current.get(id);
      const fields = [...new Set([...Object.keys(a || {}),...Object.keys(b || {})])].filter(k => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]));
      if (!fields.length) continue;
      const diff = Object.fromEntries(fields.map(k => [k, VALUES.has(k) ? { before:a?.[k] ?? null,after:b?.[k] ?? null } : { changed:true }]));
      db.audit.push({id:'audit_'+randomUUID(),actor_id:actor.id,actor_role:actor.role,actor_kind:actor.role === 'device' ? 'device' : 'human',actor_org_id:actor.org_id,
        org_id: collection === 'orgs' ? id : ((b || a).org_id || actor.org_id),entity:collection,entity_id:id,action,at:new Date().toISOString(),diff});
    }
  }
}

/** Audit output is its own schema. Field names are data, so generic entity redaction
 * cannot silently erase an event's safe change markers. Values are re-allowlisted.
 */
export function auditView(row: any, actor: any) {
  const metadata = ['id','actor_id','actor_role','actor_kind','actor_org_id','org_id','entity','entity_id','action','at'];
  const money = new Set(['invoice_status','platform_fee_pct','owner_share_pct','fee_basis']);
  const sales = new Set(['rate_type','rate_value','committed_budget']);
  const changes = Object.entries(row.diff || {}).map(([field, delta]: [string, any]) => {
    const restricted = (money.has(field) && !can(actor.role,'money')) || (sales.has(field) && !can(actor.role,'sales') && !can(actor.role,'money'));
    if (restricted) return {field,changed:true,detail:'restricted'};
    if (VALUES.has(field) && delta && Object.hasOwn(delta,'before') && Object.hasOwn(delta,'after'))
      return {field,changed:true,detail:'recorded',before:delta.before,after:delta.after};
    return {field,changed:true,detail:'values_not_recorded'};
  });
  return {...Object.fromEntries(metadata.filter(k=>row[k]!==undefined).map(k=>[k,row[k]])),changes};
}
