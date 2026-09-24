import { paise } from './settlement';
import { AccessError } from './access';
export const budgetId = (campaignId: string) => `budget_${campaignId}`;
export function budgetLimit(c: any): number { return paise(Number(c.committed_budget) || 0); }
export function physicalPlays(a: any): number {
  return Math.max(0, Math.floor((Date.parse(a.valid_until) - Date.parse(a.issued_at)) / Math.max(1000, Number(a.duration_s) * 1000)));
}
function unit(a: any): number { return a.rate_type === 'per_play' ? paise(Number(a.rate_value) || 0) : 0; }
function exact(value: number): number { if (!Number.isSafeInteger(value) || value < 0) throw new AccessError(400,'Campaign budget totals exceed the supported exact range'); return value; }
function trim(ledger: any, now: number) { ledger.reservations = (ledger.reservations || []).filter((r: any) => Date.parse(r.accept_until) >= now); }
export function budgetCommitted(ledger: any, now = Date.now()): number {
  return exact(ledger.spent_paise + (ledger.reservations || []).filter((r: any) => Date.parse(r.accept_until) >= now)
    .reduce((n: number, r: any) => n + r.remaining_plays * r.rate_paise, 0));
}
/** Must run in the same transaction as assignment creation / receipts. Initialization reads
 * all campaign settlement buckets and unexpired old assignments, never a bounded play history. */
export function ensureBudget(db: any, campaign: any, now: number): any {
  db.campaign_budgets ||= [];
  let ledger = db.campaign_budgets.find((r: any) => r.id === budgetId(campaign.id));
  if (!ledger) {
    const baseline = paise(Number(campaign.accrued_spend) || 0) + (db.settlement_buckets || [])
      .filter((b: any) => b.campaign_id === campaign.id).reduce((n: number, b: any) => n + (Number(b.gross_paise) || 0), 0);
    ledger = { id: budgetId(campaign.id), campaign_id: campaign.id, org_id: campaign.org_id,
      spent_paise: exact(baseline), initialized_at: new Date(now).toISOString(), reservations: [], source: 'transactional_play_allowances_v1' };
    // Legacy allowances were not budget-limited. Hold their entire remaining physical
    // exposure until receipts arrive or acceptance expires; never silently cancel evidence.
    for (const a of db.device_assignments || []) if (a.campaign_id === campaign.id && Date.parse(a.accept_until) >= now)
      ledger.reservations.push({assignment_id:a.id,device_id:a.device_id,rate_paise:unit(a),remaining_plays:physicalPlays(a) + 1,accept_until:a.accept_until,legacy:true});
    db.campaign_budgets.push(ledger);
  }
  trim(ledger, now); return ledger;
}
export function reserveBudget(db: any, campaign: any, assignment: any, requested: number, now: number): number {
  const ledger = ensureBudget(db,campaign,now), rate = unit(assignment);
  // One campaign ledger is deliberately bounded. Fail closed rather than evict a live hold.
  if (ledger.reservations.length >= 1200) return 0;
  const available = Math.max(0, budgetLimit(campaign) - budgetCommitted(ledger,now));
  const participants = Math.max(1, new Set(campaign.screen_ids || []).size);
  const affordable = rate ? Math.floor(available / rate) : requested;
  const allocation = rate ? Math.min(affordable, Math.max(1, Math.floor(affordable / participants))) : requested;
  const max = Math.max(0,Math.min(requested,allocation));
  if (max) ledger.reservations.push({assignment_id:assignment.id,device_id:assignment.device_id,rate_paise:rate,remaining_plays:max,accept_until:assignment.accept_until});
  assignment.budget_version = 1; assignment.max_plays = max;
  return max;
}
export function budgetReceipt(db: any, campaign: any, assignment: any, consumeAttempt: boolean, billable: boolean, now: number): boolean {
  if (!campaign || assignment.kind === 'filler') return false;
  const ledger = ensureBudget(db,campaign,now);
  const hold = ledger.reservations.find((r: any) => r.assignment_id === assignment.id && r.device_id === assignment.device_id);
  if (!hold || hold.remaining_plays <= 0) return false;
  const withinBudget = !billable || ledger.spent_paise + hold.rate_paise <= budgetLimit(campaign);
  if (consumeAttempt) {
    hold.remaining_plays--;
    if (billable && withinBudget) ledger.spent_paise += hold.rate_paise;
  }
  return withinBudget;
}
export function validateBudgetEdit(db: any, candidate: any, now = Date.now()) {
  const ledger = (db.campaign_budgets || []).find((b: any) => b.campaign_id === candidate.id);
  if (ledger && budgetLimit(candidate) < budgetCommitted(ledger,now))
    throw new AccessError(409,'Budget cannot be reduced below delivered spend plus outstanding screen allowances. Wait for allowances to expire or increase the budget.');
}
