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
