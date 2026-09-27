'use client';
import React, { useState } from 'react';
import { api } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const when = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not reported';
const camera:Record<string,string>={disabled:'Disabled',starting:'Starting',ready:'Ready',unavailable:'Unavailable'};
const model:Record<string,string>={loading:'Loading',ready:'Ready',error:'Could not load',not_loaded:'Not loaded'};
export function ScreenDiagnostics({screenId,device,assignments,results,history,onChanged}:{screenId:string;device:any;assignments:any[];results:any[];history?:{complete?:boolean};onChanged:()=>Promise<unknown>}) {
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=assignments.find(a=>['pending','running'].includes(a.status)&&Date.parse(a.expires_at)>Date.now());
 const last=assignments[0];
 const vision=device?.vision;
 const stale=!vision?.reported_at || Date.now()-Date.parse(vision.reported_at)>90000;
 const recovery=(row:any,label:string)=>row?`${label}: ${row.status}${row.attempts?` · attempt ${row.attempts}`:''}${row.retry_after_ms?` · retry in ${Math.ceil(row.retry_after_ms/1000)}s`:''}${row.detail?` · ${row.detail}`:''}`:`${label}: not reported`;
 const workerGraphics=(row:any)=>row?`OffscreenCanvas ${row.worker_offscreen_canvas===null?'unknown':row.worker_offscreen_canvas?'yes':'no'} · WebGL ${row.worker_webgl===null?'unknown':row.worker_webgl?'yes':'no'} · WebGL 2 ${row.worker_webgl2===null?'unknown':row.worker_webgl2?'yes':'no'}`:'not reported';
 const runtime=vision?.runtime,cap=runtime?.capabilities;
 const diagnosticHistory=Array.isArray(vision?.diagnostics_history)?vision.diagnostics_history.slice(-12).reverse():[];
 const perf=(stage:any)=>{const count=stage?.latency_count||0,hist=stage?.latency_histogram||[],target=Math.max(1,Math.ceil(count*.95));let n=0,p95='—';for(let i=0;i<hist.length;i++){n+=hist[i]||0;if(n>=target){p95=['≤50','≤100','≤250','≤500','≤750','≤1000','≤2500','>2500'][i]+' ms';break;}}return `attempted ${stage?.attempted||0} · completed ${stage?.completed||0} · accepted ${stage?.accepted||0} · slow ${stage?.slow_rejected||0} · failed ${stage?.failed||0} · timeouts ${stage?.timed_out||0} · mean ${count?(stage.latency_sum_ms/count).toFixed(0)+' ms':'—'} · p95 ${p95}`;};
 async function act(path:string){setBusy(true);setError('');try{await api(path,{});await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <Card className="mb-4 space-y-3 p-4" aria-label="Screen test">
  <h3 className="font-semibold">Camera and screen test</h3>
  <p className="text-sm text-muted-foreground">Play a 12-second test without an advertiser or campaign. Tests do not create paid delivery or spend. The player waits while campaigns reserve this screen.</p>
  <dl className="grid gap-3 text-sm sm:grid-cols-2">
   <div><dt className="text-muted-foreground">Camera reported by player</dt><dd>{camera[vision?.camera_state] || 'Not reported'}</dd></div>
   <div><dt className="text-muted-foreground">People detector reported by player</dt><dd>{model[vision?.model_state] || 'Not reported'}{vision?.model_ver && <span className="block text-xs">{vision.model_ver}</span>}</dd></div>
   <div><dt className="text-muted-foreground">Last status report</dt><dd>{when(vision?.reported_at)}{stale && ' · waiting for a fresh report'}</dd></div>
   <div><dt className="text-muted-foreground">Last presence sample</dt><dd>{when(vision?.last_sample_at)}</dd></div>
  </dl>
  {vision?.recovery&&<p className="text-xs text-muted-foreground">Model recovery · {recovery(vision.recovery.body,'People')} · {recovery(vision.recovery.face,'Face')}</p>}
  {vision?.recovery&&<p className="text-xs text-muted-foreground">Measurement worker graphics · People: {workerGraphics(vision.recovery.body)} · Face: {workerGraphics(vision.recovery.face)}</p>}
  {diagnosticHistory.length>0&&<details className="text-xs"><summary className="cursor-pointer font-medium">Recent camera performance · {diagnosticHistory.length} bounded windows</summary><div className="mt-2 space-y-2">{diagnosticHistory.map((row:any)=><div key={`${row.session_id}-${row.window_id}`} className="rounded border p-2"><p className="font-medium">Session {when(row.session_started_at)} · window {row.window_id} · {when(row.started_at)}</p><p className="mt-1">People · {perf(row.body)}</p><p>Face · {perf(row.face)}</p><p className="text-muted-foreground">Face decisions: {row.reasons?.faces_detected||0} detected · {row.reasons?.faces_assessable||0} assessable · {row.reasons?.faces_unmatched||0} unmatched · {row.reasons?.faces_too_small||0} too small · {row.reasons?.faces_unclear||0} unclear · {row.reasons?.uncertain_associations||0} uncertain associations · {row.reasons?.fresh_empty_scenes||0} fresh empty scenes</p></div>)}</div></details>}
  {runtime&&<p className="text-xs text-muted-foreground">Player environment · {runtime.browser} {runtime.browser_major||''} · {runtime.os} · Worker {cap?.worker?'yes':'no'} · Offscreen canvas {cap?.offscreen_canvas?'yes':'no'} · WebGL {cap?.webgl?'yes':'no'} / WebGL 2 {cap?.webgl2?'yes':'no'} · Image bitmap {cap?.create_image_bitmap?'yes':'no'} · Secure context {cap?.secure_context?'yes':'no'}</p>}
  <p className="text-xs text-muted-foreground">These are software reports from the paired player. Camera images stay on that device. Counts are sampled only during playback.</p>
  {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  {pending ? <div className="space-y-2"><p className="text-sm">{pending.status==='running'?'Test running':'Test requested — waiting for the player and an available playback window.'} Expires {when(pending.expires_at)}.</p><Button size="sm" variant="outline" disabled={busy} onClick={()=>act(`/screen/${screenId}/test/${pending.id}/revoke`)}>Cancel test</Button></div>
   : <Button disabled={busy || !device || device.status==='revoked'} onClick={()=>act(`/screen/${screenId}/test`)}>{busy?'Requesting…':'Run screen test'}</Button>}
  {!pending && last && <p className="text-sm text-muted-foreground">Last request: {last.status==='pending'||last.status==='running'?'expired':last.status}. Requested {when(last.requested_at)}.</p>}
  {history?.complete===false && <p className="text-xs text-muted-foreground">Showing recent test history. Older tests are retained.</p>}
  {(!device || device.status==='revoked') && <p className="text-sm text-muted-foreground">Pair a player before running a test.</p>}
  {results.length>0 && <div className="space-y-2 border-t pt-3"><h4 className="text-sm font-medium">Recent test results</h4>{results.slice(0,5).map((r:any)=><div key={r.id || r.assignment_id} className="text-sm"><p>{when(r.received_at)} · {r.measured && Number.isFinite(r.avg_persons)?`${Number(r.avg_persons).toFixed(1)} average people present`:'Presence not measured'}</p><p className="text-xs text-muted-foreground">{r.sample_count ?? 0} samples · {r.model_ver || 'Model not reported'} · {r.ended_reason || 'Completed'} · Test only, no charge</p></div>)}</div>}
 </Card>;
}
