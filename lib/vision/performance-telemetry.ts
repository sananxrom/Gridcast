export const PRESENCE_DIAGNOSTIC_SCHEMA = 'presence-v2-runtime-diagnostics/1';
export const PRESENCE_DIAGNOSTIC_WINDOWS = 2;
export const PRESENCE_DIAGNOSTIC_HISTORY = 24;
const LATENCY_BOUNDS = [50, 100, 250, 500, 750, 1000, 2500] as const;
const stages = ['body', 'face'] as const;
type Stage = typeof stages[number];
const counters = ['attempted', 'completed', 'accepted', 'slow_rejected', 'failed', 'submission_failed', 'timed_out'] as const;
const reasons = ['faces_detected', 'faces_assessable', 'faces_unmatched', 'faces_too_small', 'faces_unclear', 'uncertain_associations', 'fresh_empty_scenes', 'stale_body_decisions', 'stale_face_decisions', 'error_decisions'] as const;
type StageCounts = Record<typeof counters[number], number> & { latency_count:number; latency_sum_ms:number; latency_min_ms:number|null; latency_max_ms:number|null; latency_histogram:number[] };
type WindowCounts = { body:StageCounts;face:StageCounts;reasons:Record<typeof reasons[number],number> };
export type PresenceDiagnosticWindow = { window_id:string;revision:number;started_at:string;ended_at:string;body:StageCounts;face:StageCounts;reasons:Record<string,number> };
export type PresenceDiagnosticSnapshot = { schema:typeof PRESENCE_DIAGNOSTIC_SCHEMA;session_id:string;session_started_at:string;windows:PresenceDiagnosticWindow[] };
export type FaceCoverageDecision = { body_status:string;face_status:string;faces_detected:number;faces_assessable:number;faces_unmatched:number;faces_too_small:number;faces_unclear:number;uncertain_associations:number;fresh_empty_scene:boolean };
const zeroStage = ():StageCounts => ({attempted:0,completed:0,accepted:0,slow_rejected:0,failed:0,submission_failed:0,timed_out:0,latency_count:0,latency_sum_ms:0,latency_min_ms:null,latency_max_ms:null,latency_histogram:Array(8).fill(0)});
const zeroReasons = ():WindowCounts['reasons'] => Object.fromEntries(reasons.map(k=>[k,0])) as WindowCounts['reasons'];
const freshWindow = ():WindowCounts => ({body:zeroStage(),face:zeroStage(),reasons:zeroReasons()});
const boundedCount = (n:number) => Math.min(1_000_000,Math.max(0,Math.floor(n)));
const validId = (s:unknown) => typeof s==='string'&&/^[0-9a-f-]{36}$/i.test(s);

/** Bounded aggregate performance history for one camera/model runtime session. */
export class PresencePerformanceTelemetry {
  readonly session_id = crypto.randomUUID();
  readonly session_started_at = new Date().toISOString();
  private readonly origin = performance.now();
  private readonly started = Date.now();
  private readonly windows = new Map<number,{counts:WindowCounts;revision:number}>();
  private active(at=performance.now()) {
    const index=Math.max(0,Math.floor((at-this.origin)/300_000));
    let row=this.windows.get(index);if(!row){row={counts:freshWindow(),revision:1};this.windows.set(index,row);}
    for(const key of [...this.windows.keys()].sort((a,b)=>a-b))if(key<index-PRESENCE_DIAGNOSTIC_WINDOWS+1)this.windows.delete(key);
    return {index,row};
  }
  private changed(row:{counts:WindowCounts;revision:number}) { row.revision=Math.min(Number.MAX_SAFE_INTEGER,row.revision+1); }
  attempted(stage:Stage,at=performance.now()) { const {row}=this.active(at);row.counts[stage].attempted=boundedCount(row.counts[stage].attempted+1);this.changed(row); }
  completed(stage:Stage,latencyMs:number,maxAgeMs:number,ok:boolean,at=performance.now()) {
    const {row}=this.active(at),c=row.counts[stage];c.completed=boundedCount(c.completed+1);if(!ok)c.failed=boundedCount(c.failed+1);
    if(Number.isFinite(latencyMs)&&latencyMs>=0&&latencyMs<=60_000){const v=Math.round(latencyMs*10)/10;c.latency_count=boundedCount(c.latency_count+1);c.latency_sum_ms=Math.min(60_000_000,c.latency_sum_ms+v);c.latency_min_ms=c.latency_min_ms===null?v:Math.min(c.latency_min_ms,v);c.latency_max_ms=c.latency_max_ms===null?v:Math.max(c.latency_max_ms,v);const bucket=LATENCY_BOUNDS.findIndex(limit=>v<=limit);c.latency_histogram[bucket<0?7:bucket]=boundedCount(c.latency_histogram[bucket<0?7:bucket]+1);}
    if(latencyMs>maxAgeMs)c.slow_rejected=boundedCount(c.slow_rejected+1);else if(ok)c.accepted=boundedCount(c.accepted+1);
    this.changed(row);
  }
  submissionFailed(stage:Stage,at=performance.now()) { const {row}=this.active(at);row.counts[stage].submission_failed=boundedCount(row.counts[stage].submission_failed+1);this.changed(row); }
  timedOut(stage:Stage,at=performance.now()) { const {row}=this.active(at);row.counts[stage].timed_out=boundedCount(row.counts[stage].timed_out+1);this.changed(row); }
  coverage(decision:FaceCoverageDecision,at=performance.now()) {
    const {row}=this.active(at),r=row.counts.reasons;
    for(const [key,value] of [['faces_detected',decision.faces_detected],['faces_assessable',decision.faces_assessable],['faces_unmatched',decision.faces_unmatched],['faces_too_small',decision.faces_too_small],['faces_unclear',decision.faces_unclear],['uncertain_associations',decision.uncertain_associations]] as const)r[key]=boundedCount(r[key]+boundedCount(value));
    if(decision.fresh_empty_scene)r.fresh_empty_scenes=boundedCount(r.fresh_empty_scenes+1);
    if(decision.body_status==='stale'||decision.body_status==='unavailable')r.stale_body_decisions=boundedCount(r.stale_body_decisions+1);
    if(decision.face_status==='stale'||decision.face_status==='unavailable')r.stale_face_decisions=boundedCount(r.stale_face_decisions+1);
    if(decision.body_status==='error'||decision.face_status==='error')r.error_decisions=boundedCount(r.error_decisions+1);
    this.changed(row);
  }
  snapshot(at=performance.now()):PresenceDiagnosticSnapshot {
    const {index}=this.active(at), windows=[...this.windows.entries()].sort(([a],[b])=>a-b).slice(-PRESENCE_DIAGNOSTIC_WINDOWS).map(([i,row])=>({
      window_id:`w${i}`,revision:row.revision,started_at:new Date(this.started+i*300_000).toISOString(),ended_at:new Date(Math.min(Date.now(),this.started+(i+1)*300_000)).toISOString(),
      body:structuredClone(row.counts.body),face:structuredClone(row.counts.face),reasons:{...row.counts.reasons},
    }));
    void index;return {schema:PRESENCE_DIAGNOSTIC_SCHEMA,session_id:this.session_id,session_started_at:this.session_started_at,windows};
  }
}

const isCount=(v:any)=>Number.isSafeInteger(v)&&v>=0&&v<=1_000_000;
const isRevision=(v:any)=>Number.isSafeInteger(v)&&v>=1;
function cleanStage(v:any):StageCounts|null {
  if(!v||!counters.every(k=>isCount(v[k]))||!isCount(v.latency_count)||!Number.isFinite(v.latency_sum_ms)||v.latency_sum_ms<0||v.latency_sum_ms>60_000_000
    ||!(v.latency_min_ms===null||Number.isFinite(v.latency_min_ms)&&v.latency_min_ms>=0&&v.latency_min_ms<=60_000)
    ||!(v.latency_max_ms===null||Number.isFinite(v.latency_max_ms)&&v.latency_max_ms>=0&&v.latency_max_ms<=60_000)
    ||!Array.isArray(v.latency_histogram)||v.latency_histogram.length!==8||!v.latency_histogram.every(isCount))return null;
  if(v.accepted+v.slow_rejected>v.completed||v.failed>v.completed||v.latency_count>v.completed||v.latency_histogram.reduce((a:number,b:number)=>a+b,0)!==v.latency_count)return null;
  return {attempted:v.attempted,completed:v.completed,accepted:v.accepted,slow_rejected:v.slow_rejected,failed:v.failed,submission_failed:v.submission_failed,timed_out:v.timed_out,latency_count:v.latency_count,latency_sum_ms:Math.round(v.latency_sum_ms*10)/10,latency_min_ms:v.latency_min_ms,latency_max_ms:v.latency_max_ms,latency_histogram:[...v.latency_histogram]};
}
export function sanitizePresenceDiagnostic(input:any,now=Date.now()):PresenceDiagnosticSnapshot|null {
  if(!input||input.schema!==PRESENCE_DIAGNOSTIC_SCHEMA||!validId(input.session_id)||typeof input.session_started_at!=='string'||!Number.isFinite(Date.parse(input.session_started_at))||Date.parse(input.session_started_at)>now+60_000||!Array.isArray(input.windows)||input.windows.length<1||input.windows.length>PRESENCE_DIAGNOSTIC_WINDOWS)return null;
  const windows:PresenceDiagnosticWindow[]=[];
  for(const w of input.windows){
    if(!w||typeof w.window_id!=='string'||!/^w\d{1,8}$/.test(w.window_id)||!isRevision(w.revision)||typeof w.started_at!=='string'||typeof w.ended_at!=='string'||!Number.isFinite(Date.parse(w.started_at))||!Number.isFinite(Date.parse(w.ended_at))||Date.parse(w.ended_at)<Date.parse(w.started_at)||Date.parse(w.ended_at)>now+60_000||Date.parse(w.started_at)<Date.parse(input.session_started_at))return null;
    const body=cleanStage(w.body),face=cleanStage(w.face);if(!body||!face||!w.reasons||!reasons.every(k=>isCount(w.reasons[k])))return null;
    windows.push({window_id:w.window_id,revision:w.revision,started_at:w.started_at,ended_at:w.ended_at,body,face,reasons:Object.fromEntries(reasons.map(k=>[k,w.reasons[k]]))});
  }
  return {schema:PRESENCE_DIAGNOSTIC_SCHEMA,session_id:input.session_id,session_started_at:input.session_started_at,windows};
}
export function upsertPresenceDiagnosticHistory(history:unknown[],snapshot:PresenceDiagnosticSnapshot):any[] {
  const next:any[]=[...(Array.isArray(history)?history:[])];
  for(const window of snapshot.windows){
    const row={schema:snapshot.schema,session_id:snapshot.session_id,session_started_at:snapshot.session_started_at,...window};
    const key=`${snapshot.session_id}:${window.window_id}`,at=next.findIndex((x:any)=>`${x.session_id}:${x.window_id}`===key);
    if(at<0)next.push(row);else if((next[at]?.revision||0)<window.revision)next[at]=row;
  }
  next.sort((a:any,b:any)=>String(a.started_at).localeCompare(String(b.started_at))||String(a.session_id).localeCompare(String(b.session_id)));
  return next.slice(-PRESENCE_DIAGNOSTIC_HISTORY);
}
