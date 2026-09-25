import { createHash } from 'node:crypto';

// Reporting is independent of settlement and never changes billing decisions.
export const REPORT_VERSION = 1;
export const REPORT_PAGE_SIZE = 500;
const DAY = 86400000;
export class ReportingError extends Error { constructor(public status: number, message: string) { super(message); } }
export const reportDay = (at: number) => new Date(at + 330 * 60000).toISOString().slice(0, 10);
export function reportingKey(screen: string, campaign: string | null, creative: string, at: number) {
  return reportDay(at) + '__' + createHash('sha256').update(JSON.stringify([screen,campaign || null,creative])).digest('hex');
}
export function reportRange(from?: string, to?: string) {
  const valid = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
  if (!valid(from) || !valid(to)) throw new ReportingError(400,'Choose valid reporting dates');
  const days = (Date.parse(to!) - Date.parse(from!)) / DAY;
  if (days < 0 || days > 92) throw new ReportingError(400,'Choose a range of 1 to 93 days');
  if (to! > reportDay(Date.now())) throw new ReportingError(400,'Reporting dates cannot be in the future');
  return {from:from!,to:to!,lower:from!+'__',upper:new Date(Date.parse(to!)+DAY).toISOString().slice(0,10)+'__'};
}
export const emptyCounters = () => ({plays_rendered:0,plays_billable:0,plays_not_rendered:0,plays_filler:0,
  presence_sum:0,presence_n:0,airtime_ms:0,filler_presence_sum:0,filler_presence_n:0,filler_airtime_ms:0,plays_time_invalid:0});
export type ReportCounters = ReturnType<typeof emptyCounters>;
export function addCounters(target: ReportCounters, source: Partial<ReportCounters>) {
  for (const key of Object.keys(emptyCounters()) as (keyof ReportCounters)[]) target[key] += Number(source[key]) || 0;
  return target;
}
/** Called once, after receipt duplicate checks, in the same storage transaction. */
export function accrueScreenDay(db: any, play: any, assignment: any, playedAt: number, presence: any) {
  // Invalid clocks remain evidence but cannot assign delivery to a claimed historical date.
  const validTime = play.timestamp_valid === true;
  const at = validTime ? playedAt : Date.parse(play.server_received_at);
  const id = reportingKey(play.screen_id,play.campaign_id,play.creative_id,at);
  db.screen_day ||= [];
  let row = db.screen_day.find((x: any) => x.id === id);
  if (!row) {
    row = {id,version:REPORT_VERSION,org_id:play.org_id,screen_id:play.screen_id,campaign_id:play.campaign_id || null,
      advertiser_id:assignment.advertiser_id || play.advertiser_id || null,creative_id:play.creative_id,date:reportDay(at),
      ...emptyCounters(),hours:{},nonbillable:{},first_at:null,last_at:null};
    db.screen_day.push(row);
  }
  const delta = emptyCounters(), filler = assignment.kind === 'filler';
  if (!validTime) delta.plays_time_invalid = 1;
  else if (filler) {
    delta.plays_filler = 1;
    if (play.rendered) {
      delta.filler_airtime_ms = play.playing_duration_ms;
      if (presence.measured) { delta.filler_presence_n = 1; delta.filler_presence_sum = presence.avg_persons; }
    }
  } else if (play.rendered) {
    delta.plays_rendered = 1; delta.plays_billable = Number(play.billable === true);
    delta.airtime_ms = play.playing_duration_ms;
    if (presence.measured) { delta.presence_n = 1; delta.presence_sum = presence.avg_persons; }
  } else delta.plays_not_rendered = 1;
  addCounters(row,delta);
  const hour = String(new Date(at + 330 * 60000).getUTCHours());
  row.hours[hour] ||= emptyCounters(); addCounters(row.hours[hour],delta);
  for (const reason of play.nonbillable_reasons || []) row.nonbillable[reason] = (row.nonbillable[reason] || 0) + 1;
  const time = new Date(at).toISOString();
  row.first_at = !row.first_at || time < row.first_at ? time : row.first_at;
  row.last_at = !row.last_at || time > row.last_at ? time : row.last_at;
  row.updated_at = play.server_received_at;
  db.reporting_coverage ||= {version:REPORT_VERSION,started_at:play.server_received_at};
}
export function reportingVisible(row: any, actor: any, org?: string) {
  if (actor.role === 'platform_admin') return !org || row.org_id === org;
  if (actor.role === 'advertiser_viewer') return !!actor.advertiser_id && row.advertiser_id === actor.advertiser_id;
  return row.org_id === actor.org_id;
}
export function summarizeReport(rows: any[], range: {from:string,to:string}, coverage: any) {
  const totals = emptyCounters();
  const byScreen: Record<string,ReportCounters> = {}, byCampaign: Record<string,ReportCounters> = {}, byCreative: Record<string,ReportCounters> = {};
  const daily: Record<string,ReportCounters> = {}, hourly: Record<string,ReportCounters> = {};
  let last_at: string | null = null;
  const add = (map: Record<string,ReportCounters>,key: string, row: any) => { map[key] ||= emptyCounters(); addCounters(map[key],row); };
  for (const row of rows) {
    addCounters(totals,row); add(byScreen,row.screen_id,row); add(daily,row.date,row);
    if (row.campaign_id) {add(byCampaign,row.campaign_id,row);add(byCreative,row.creative_id,row);}
    for (const [hour,value] of Object.entries(row.hours || {})) add(hourly,hour,value);
    if (row.last_at && (!last_at || row.last_at > last_at)) last_at = row.last_at;
  }
  // Complete describes writer coverage, not receipt finality: devices can report 72h late.
  const started = coverage?.started_at || null;
  const complete = !!started && Date.parse(range.from+'T00:00:00+05:30') >= Date.parse(started);
  return {totals,byScreen,byCampaign,byCreative,daily,hourly,last_at,coverage:{started_at:started,complete},rows:rows.length};
}
