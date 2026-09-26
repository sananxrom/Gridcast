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
  presence_sum:0,presence_n:0,airtime_ms:0,filler_presence_sum:0,filler_presence_n:0,filler_airtime_ms:0,plays_time_invalid:0,
  attention_person_ms:0,attention_assessable_person_ms:0,attention_n:0,attention_playing_ms:0,attention_observed_ms:0,attention_unknown_ms:0});
export type ReportCounters = ReturnType<typeof emptyCounters>;
export function addCounters(target: ReportCounters, source: Partial<ReportCounters>) {
  for (const key of Object.keys(emptyCounters()) as (keyof ReportCounters)[]) target[key] = (Number(target[key]) || 0) + (Number(source[key]) || 0);
  return target;
}
const attentionCounters = () => ({plays:0,playing_ms:0,body_observed_ms:0,body_unknown_ms:0,face_observed_ms:0,face_unknown_ms:0,
  attention_observed_ms:0,attention_unknown_ms:0,expression_observed_ms:0,expression_unknown_ms:0,presence_person_ms:0,
  looking_person_ms:0,face_assessable_person_ms:0,smile_person_ms:0,expression_assessable_person_ms:0,estimated_impressions:0,attentive_impressions:0,tracked_visits:0});
function addAttention(target:any,source:any){for(const k of Object.keys(attentionCounters()))target[k]=(Number(target[k])||0)+(Number(source?.[k])||0);return target;}
const attentionIdentity=(play:any,assignment:any)=>[play.attention_profile||assignment.attention_profile,play.attention_manifest_sha256||assignment.attention_manifest_sha256,play.attention_pipeline_sha256||assignment.attention_pipeline_sha256,play.attention?.calibration_revision||assignment.attention_calibration_revision,assignment.asset_id||null,assignment.asset_sha256||null,assignment.config_version];
export function attentionDayKey(play:any,assignment:any,at:number){return reportDay(at)+'__'+createHash('sha256').update(JSON.stringify([play.screen_id||assignment.screen_id,play.campaign_id??assignment.campaign_id??null,play.creative_id||assignment.creative_id,...attentionIdentity(play,assignment)])).digest('hex');}
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
  const delta = emptyCounters(), filler = assignment.kind === 'filler'; let acceptedAttention:any=null;
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
    const a = play.attention;
    if (a && play.attention_status === 'accepted') {
      acceptedAttention=a;
    }
  } else delta.plays_not_rendered = 1;
  addCounters(row,delta);
  if(acceptedAttention){
    db.attention_day ||= [];
    const key=attentionDayKey(play,assignment,at);
    let series=db.attention_day.find((x:any)=>x.id===key);
    if(!series){series={id:key,date:reportDay(at),org_id:play.org_id,advertiser_id:assignment.advertiser_id||play.advertiser_id||null,screen_id:play.screen_id,campaign_id:play.campaign_id||null,creative_id:play.creative_id,asset_id:assignment.asset_id||null,asset_sha256:assignment.asset_sha256||null,config_version:assignment.config_version,profile:acceptedAttention.profile,manifest_sha256:play.attention_manifest_sha256,pipeline_sha256:play.attention_pipeline_sha256,calibration_revision:acceptedAttention.calibration_revision,calibration:play.attention_calibration||assignment.attention_calibration||null,totals:attentionCounters(),hours:{}};db.attention_day.push(series);}
    const c=attentionCounters(); c.plays=1;c.playing_ms=acceptedAttention.playing_ms;
    c.body_observed_ms=acceptedAttention.body[0];c.body_unknown_ms=acceptedAttention.body[1];c.face_observed_ms=acceptedAttention.face[0];c.face_unknown_ms=acceptedAttention.face[1];
    c.attention_observed_ms=acceptedAttention.attention[0];c.attention_unknown_ms=acceptedAttention.attention[1];c.expression_observed_ms=acceptedAttention.expression[0];c.expression_unknown_ms=acceptedAttention.expression[1];
    c.presence_person_ms=acceptedAttention.presence_person_ms||0;c.looking_person_ms=acceptedAttention.looking_person_ms||0;c.face_assessable_person_ms=acceptedAttention.face_assessable_person_ms||0;
    c.smile_person_ms=acceptedAttention.smile_person_ms||0;c.expression_assessable_person_ms=acceptedAttention.expression_assessable_person_ms||0;c.estimated_impressions=acceptedAttention.estimated_impressions||0;c.attentive_impressions=acceptedAttention.attentive_impressions||0;c.tracked_visits=acceptedAttention.tracked_visits||0;
    addAttention(series.totals,c);
    if(validTime){const hour=String(new Date(at+330*60000).getUTCHours());series.hours[hour]||=attentionCounters();addAttention(series.hours[hour],c);}
  }
  for (const reason of play.nonbillable_reasons || []) row.nonbillable[reason] = (row.nonbillable[reason] || 0) + 1;
  // Hour buckets and first/last are play times. A receive time must not stand in for one.
  if (validTime) {
    const hour = String(new Date(at + 330 * 60000).getUTCHours());
    row.hours[hour] ||= emptyCounters(); addCounters(row.hours[hour],delta);
    row.day_hours ||= {}; const dayHour=reportDay(at)+'T'+hour.padStart(2,'0'); row.day_hours[dayHour] ||= emptyCounters(); addCounters(row.day_hours[dayHour],delta);
    const time = new Date(at).toISOString();
    row.first_at = !row.first_at || time < row.first_at ? time : row.first_at;
    row.last_at = !row.last_at || time > row.last_at ? time : row.last_at;
  }
  row.updated_at = play.server_received_at;
  db.reporting_coverage ||= {version:REPORT_VERSION,started_at:play.server_received_at};
}
export function reportingVisible(row: any, actor: any, org?: string) {
  if (actor.role === 'platform_admin') return !org || row.org_id === org;
  if (actor.role === 'advertiser_viewer') return !!actor.advertiser_id && row.advertiser_id === actor.advertiser_id;
  return row.org_id === actor.org_id;
}
export function summarizeReport(rows: any[], range: {from:string,to:string}, coverage: any, attentionRows:any[] = []) {
  const totals = emptyCounters();
  const byScreen: Record<string,ReportCounters> = {}, byCampaign: Record<string,ReportCounters> = {}, byCreative: Record<string,ReportCounters> = {};
  const daily: Record<string,ReportCounters> = {}, hourly: Record<string,ReportCounters> = {}, dayHours: Record<string,ReportCounters> = {};
  let last_at: string | null = null;
  const attentionProfiles:Record<string,any>={};
  const add = (map: Record<string,ReportCounters>,key: string, row: any) => { map[key] ||= emptyCounters(); addCounters(map[key],row); };
  for (const row of rows) {
    addCounters(totals,row); add(byScreen,row.screen_id,row); add(daily,row.date,row);
    if (row.campaign_id) {add(byCampaign,row.campaign_id,row);add(byCreative,row.creative_id,row);}
    for (const [hour,value] of Object.entries(row.hours || {})) add(hourly,hour,value);
    for (const [hour,value] of Object.entries(row.day_hours || {})) add(dayHours,hour,value);
    if (row.last_at && (!last_at || row.last_at > last_at)) last_at = row.last_at;
  }
  for(const value of attentionRows){const key=createHash('sha256').update(JSON.stringify([value.profile,value.manifest_sha256,value.pipeline_sha256,value.calibration_revision,value.asset_id||null,value.asset_sha256||null,value.config_version])).digest('hex');
    const profile=attentionProfiles[key] ||= {profile:value.profile,manifest_sha256:value.manifest_sha256,pipeline_sha256:value.pipeline_sha256,calibration_revision:value.calibration_revision,calibration:value.calibration||null,asset_id:value.asset_id||null,asset_sha256:value.asset_sha256||null,config_version:value.config_version,totals:attentionCounters(),byScreen:{},byCampaign:{},byCreative:{},daily:{},hourly:{},dayHours:{}};
    addAttention(profile.totals,value.totals);const addA=(map:any,id:string,c:any)=>{map[id]||=attentionCounters();addAttention(map[id],c);};
    addA(profile.byScreen,value.screen_id,value.totals);if(value.campaign_id){addA(profile.byCampaign,value.campaign_id,value.totals);addA(profile.byCreative,value.creative_id,value.totals);}addA(profile.daily,value.date,value.totals);
    for(const [hour,c]of Object.entries<any>(value.hours||{})){addA(profile.hourly,hour,c);addA(profile.dayHours,value.date+'T'+String(hour).padStart(2,'0'),c);}
  }
  // Complete describes writer coverage, not receipt finality: devices can report 72h late.
  const started = coverage?.started_at || null;
  const complete = !!started && Date.parse(range.from+'T00:00:00+05:30') >= Date.parse(started);
  return {totals,byScreen,byCampaign,byCreative,daily,hourly,dayHours,attentionProfiles,last_at,coverage:{started_at:started,complete},rows:rows.length};
}
