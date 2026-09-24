import { createHash } from 'node:crypto';
import { AccessError } from './access';

export const ECONOMICS_FIELDS = ['rate_type','rate_value','rate_paise','rate_version','platform_fee_pct','fee_basis','owner_share_pct','fee_version','econ_version','booked_at','pricing_source'] as const;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
export function paise(value: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new AccessError(400, 'Money must be a finite number');
  const n = Math.round(value * 100);
  if (!Number.isSafeInteger(n) || n < 0 || Math.abs(value * 100 - n) > .000001) throw new AccessError(400, 'Money must be non-negative with at most two decimal places');
  return n;
}
const percent = (n: any) => {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100) throw new AccessError(400, 'Shares must be between 0 and 100');
  paise(n); return n;
};
export function economics(row: any) { return Object.fromEntries(ECONOMICS_FIELDS.filter(k => row?.[k] !== undefined).map(k => [k,row[k]])); }
export function freezeEconomics(c: any, screen: any, org: any, previous?: any) {
  if (previous?.econ_version) return economics(previous);
  const row: any = {rate_type:previous?.rate_type ?? c.rate_type, rate_value:previous?.rate_value ?? c.rate_value,
    rate_version:previous?.rate_version ?? screen.rate_version ?? 'legacy',
    platform_fee_pct:percent(c.campaign_type === 'network' ? (org.platform_fee_pct ?? 0) : 0),
    fee_basis:c.campaign_type === 'network' ? (org.fee_basis || 'gross') : 'gross', owner_share_pct:percent(screen.owner_share_pct ?? 0),
    booked_at:previous?.booked_at ?? new Date().toISOString(), pricing_source:previous?.pricing_source ?? 'agreed_campaign_rate'};
  if (!['gross','net_of_owner_share'].includes(row.fee_basis)) throw new AccessError(400, 'Unknown fee basis');
  row.rate_paise = paise(row.rate_value);
  row.fee_version = org.fee_version || 'fee_' + digest([org.id,row.platform_fee_pct,row.fee_basis]);
  row.econ_version = 'econ_' + digest([row.rate_type,row.rate_paise,row.rate_version,row.platform_fee_pct,row.fee_basis,row.owner_share_pct,row.fee_version]);
  return row;
}
/** Reporting periods follow the venue's India calendar, irrespective of receipt time. */
export function settlementPeriod(at: number) {
  const date = new Date(at + 330 * 60e3);
  if (!Number.isFinite(date.getTime())) throw new AccessError(400,'Invalid delivery time');
  return date.toISOString().slice(0,7);
}
export const settlementKey = (campaign: string, screen: string, period: string, version: string) =>
  `settlement_${digest([campaign,screen,period,version])}`;
export function appliedOffset(device: any, claim: any) {
  const value = Number.isFinite(device.clock_offset_estimate_ms) ? device.clock_offset_estimate_ms : Number.isFinite(claim) ? claim : 0;
  return Math.max(-300e3, Math.min(300e3, value));
}
function safe(n: bigint) { const value = Number(n); if (!Number.isSafeInteger(value)) throw new AccessError(400,'Settlement amount exceeds the supported range'); return value; }
function share(total: bigint, pct: number) { return (total * BigInt(paise(pct)) + 5000n) / 10000n; }
export function splitSettlement(grossPaise: number, fee: number, owner: number, basis: string) {
  if (!Number.isSafeInteger(grossPaise) || grossPaise < 0) throw new AccessError(400,'Invalid settlement amount');
  percent(fee); percent(owner);
  const gross = BigInt(grossPaise);
  let feePart: bigint, ownerPart: bigint;
  if (basis === 'gross') { feePart = share(gross,fee); ownerPart = share(gross-feePart,owner); }
  else if (basis === 'net_of_owner_share') { ownerPart = share(gross,owner); feePart = share(gross-ownerPart,fee); }
  else throw new AccessError(400,'Unknown fee basis');
  return {gross_paise:grossPaise,fee_paise:safe(feePart),owner_paise:safe(ownerPart),net_paise:safe(gross-feePart-ownerPart)};
}
/** Called only after duplicate/assignment checks, within the receipt's transaction. */
export function accrueSettlement(db: any, play: any, assignment: any, deliveredAt: number) {
  if (!play.billable || assignment.rate_type !== 'per_play' || !assignment.econ_version) return;
  const period = settlementPeriod(deliveredAt), id = settlementKey(play.campaign_id,play.screen_id,period,assignment.econ_version);
  db.settlement_buckets ||= [];
  let bucket = db.settlement_buckets.find((b: any) => b.id === id);
  const delivered = new Date(deliveredAt).toISOString();
  if (!bucket) {
    bucket = {id,org_id:play.org_id,campaign_id:play.campaign_id,screen_id:play.screen_id,advertiser_id:assignment.advertiser_id,
      period,...economics(assignment),billable_plays:0,first_play_at:delivered,last_play_at:delivered,source:'verified_play_receipts'};
    db.settlement_buckets.push(bucket);
  }
  bucket.billable_plays++;
  const gross = safe(BigInt(assignment.rate_paise) * BigInt(bucket.billable_plays));
  Object.assign(bucket,splitSettlement(gross,assignment.platform_fee_pct,assignment.owner_share_pct,assignment.fee_basis),{
    first_play_at:bucket.first_play_at < delivered ? bucket.first_play_at : delivered,
    last_play_at:bucket.last_play_at > delivered ? bucket.last_play_at : delivered,updated_at:play.server_received_at});
}
