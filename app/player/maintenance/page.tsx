'use client';
import React, {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {BrandLogo} from '@/components/ui/brand-mark';
import {redeemMaintenance,acquireMaintenanceLease,checkMaintenance,closeMaintenance,inspectMaintenance,exportMaintenance,replaceMaintenance,currentPairing,evidenceCounts,assertMaintenance,MaintenanceAccessError,type MaintenanceSession} from '@/lib/player-maintenance';

import type {EvidenceLease} from '@/lib/player-evidence-lock';

type Summary=ReturnType<typeof evidenceCounts>;
export default function PlayerMaintenance(){
 const [code,setCode]=useState(''),[session,setSession]=useState<MaintenanceSession|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [summary,setSummary]=useState<Summary|null>(null),[fingerprint,setFingerprint]=useState(''),[downloaded,setDownloaded]=useState(''),[ack,setAck]=useState(false),[pairCode,setPairCode]=useState(''),[replaceOpen,setReplaceOpen]=useState(false),[current,setCurrent]=useState(false);
 const lease=useRef<EvidenceLease|null>(null);
 const active=useRef<MaintenanceSession|null>(null),operation=useRef(false),mounted=useRef(true);
 const clear=()=>{active.current=null;setSession(null);setSummary(null);setFingerprint('');setDownloaded('');setAck(false);setPairCode('');setReplaceOpen(false);setCurrent(false);};
 const close=(notice='Maintenance closed. Saved records remain on this browser.')=>{const previous=active.current;if(previous)previous.deadline=0;lease.current?.release();lease.current=null;clear();setMessage(notice);if(previous)void closeMaintenance(previous);};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;const previous=active.current;if(previous)previous.deadline=0;active.current=null;lease.current?.release();lease.current=null;if(previous)void closeMaintenance(previous);};},[]);
 useEffect(()=>{
  if(!session)return;
  let checking=false;
  const invalid=()=>close('Online authorization was lost. Tools are closed; records remain saved.');
  const check=async()=>{if(checking)return;checking=true;try{await checkMaintenance(session);}catch{if(active.current===session)invalid();}finally{checking=false;}};
  const tick=setInterval(()=>{try{assertMaintenance(session);}catch{if(active.current===session)close('Maintenance access expired. Obtain a new code.');}},500);
  const timer=setInterval(check,10000);
  const hidden=()=>{if(document.hidden)close('Maintenance closed when this tab was hidden. Obtain a new code to continue.');};
  const changed=(e:StorageEvent)=>{if(e.key==='gc_device'&&active.current===session)close('Pairing changed in another tab. Obtain a new maintenance code for the required identity.');};
  window.addEventListener('offline',invalid);window.addEventListener('storage',changed);document.addEventListener('visibilitychange',hidden);
  return()=>{clearInterval(tick);clearInterval(timer);window.removeEventListener('offline',invalid);window.removeEventListener('storage',changed);document.removeEventListener('visibilitychange',hidden);};
 },[session]);
 const run=async(action:()=>Promise<void>)=>{if(operation.current)return;operation.current=true;setBusy(true);setMessage('');try{await action();}catch(e:any){if(mounted.current){if(e instanceof MaintenanceAccessError)close(e.message);else setMessage(e.message||'Operation failed. Records remain saved.');}}finally{operation.current=false;if(mounted.current)setBusy(false);}};
 const ensure=(s:MaintenanceSession)=>{assertMaintenance(s);if(!mounted.current||active.current!==s)throw new MaintenanceAccessError('Maintenance session closed.');};
 const show=(s:MaintenanceSession,result:Awaited<ReturnType<typeof inspectMaintenance>>)=>{ensure(s);setSummary(evidenceCounts(result.evidence));setFingerprint(result.fingerprint);setDownloaded('');setAck(false);const c=currentPairing();setCurrent(c?.device_id===s.grant.device_id&&c?.screen_id===s.grant.screen_id);};
 const redeem=()=>run(async()=>{const s=await redeemMaintenance(code);if(!mounted.current){void closeMaintenance(s);return;}active.current=s;setSession(s);setCode('');const result=await inspectMaintenance(s);show(s,result);});
 const refresh=(deliver=false)=>run(async()=>{const s=active.current;if(!s)return;if(deliver&&!lease.current){const held=await acquireMaintenanceLease(s);try{ensure(s);lease.current=held;}catch(error){held.release();throw error;}}const result=await inspectMaintenance(s,deliver,lease.current||undefined);show(s,result);if(deliver){setReplaceOpen(true);setMessage('Deliverable records were retried with the original pairing where available. Review what remains before replacement.');}});
 const download=()=>run(async()=>{
  const s=active.current;if(!s)return;const result=await exportMaintenance(s,lease.current||undefined);ensure(s);
  const url=URL.createObjectURL(new Blob([JSON.stringify({...result.evidence,exported_at:new Date().toISOString(),notice:'Local retained evidence only. This export does not establish accepted delivery or billing.'},null,2)],{type:'application/json'}));
  try{const a=document.createElement('a');a.href=url;a.download='gridcast-records-'+s.grant.device_id.replace(/[^A-Za-z0-9_-]/g,'_')+'.json';document.body.appendChild(a);a.click();a.remove();}finally{setTimeout(()=>URL.revokeObjectURL(url),30000);}
  show(s,result);setDownloaded(result.fingerprint);setMessage('Download requested. Check the file in your Downloads folder; this page cannot confirm it was saved. Original records remain on this device.');
 });
 const replace=()=>run(async()=>{const s=active.current;if(!s)return;ensure(s);if(summary?.total&&(!ack||downloaded!==fingerprint))throw new Error('Export the latest saved records and check the file before confirming.');await replaceMaintenance(s,pairCode,fingerprint,ack,lease.current||undefined);if(mounted.current)close('Pairing replaced. Original records are preserved. Reload the player tab to start the new pairing.');});
 return <main className="min-h-screen bg-slate-950 p-5 text-foreground"><section className="mx-auto max-w-xl rounded-xl bg-card p-6">
  <BrandLogo compact suffix=" Maintenance" className="mb-5"/><h1 className="text-xl font-semibold">Authorized player maintenance</h1>
  {!session?<><p className="my-3 text-sm text-muted-foreground">On your own phone or laptop, open this screen’s dashboard and issue a maintenance code for the device identity you need. Open this page in a new tab in the player’s browser. Keep existing player tabs open and reload older tabs when prompted.</p><p className="my-3 text-sm">No dashboard sign-in is needed on this player. Codes are single-use and expire within ten minutes.</p><Input aria-label="Maintenance code" value={code} onChange={e=>setCode(e.target.value)} autoComplete="off" spellCheck={false} maxLength={19}/><Button className="mt-3" disabled={busy||code.replaceAll('-','').trim().length!==16} onClick={redeem}>Open maintenance</Button></>:<>
   <p className="my-3 text-sm">Access is limited to this identity until {new Date(session.grant.expires_at).toLocaleTimeString()}. Reloading, leaving this tab or losing authorization closes the tools.</p>
   <dl className="my-3 break-all text-sm"><dt>Organisation</dt><dd>{session.grant.org_id}</dd><dt className="mt-2">Screen</dt><dd>{session.grant.screen_id}</dd><dt className="mt-2">Device identity</dt><dd>{session.grant.device_id}</dd></dl>
   {summary?<p role="status" className="my-3">{summary.pending} pending deliveries · {summary.blocked} blocked deliveries · {summary.diagnostics} screen-test records</p>:<p role="status" className="my-3">Saved records have not been checked. No count is available.</p>}
   <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={()=>refresh()}>Refresh saved records</Button><Button disabled={busy||!summary} onClick={download}>Export this identity’s records</Button><Button variant="outline" disabled={busy} onClick={()=>close()}>Close maintenance</Button></div>
   <p className="my-3 text-xs text-muted-foreground">Export keeps pending, blocked and diagnostic evidence under its original identity. It does not delete records, free storage, import evidence or guarantee billing.</p>
   {current&&<div className="mt-6 border-t pt-4"><h2 className="font-semibold">Planned pairing replacement</h2><p className="my-2 text-sm">First retry saved deliveries, then review and export what remains. The destination screen requires its own pairing code. Security revocation from the dashboard is independent of this process.</p><Button disabled={busy} onClick={()=>refresh(true)}>Prepare replacement</Button>
    {replaceOpen&&<><p className="my-3 text-sm">Retained records may stop uploading after replacement. They will not be reassigned to the new screen.</p>{!!summary?.total&&<label className="my-3 flex gap-2 text-sm"><input type="checkbox" checked={ack} disabled={busy||downloaded!==fingerprint} onChange={e=>setAck(e.target.checked)}/>I checked the downloaded file and understand that this does not guarantee accepted delivery or durable backup.</label>}<Input className="mt-3" aria-label="Destination pairing code" value={pairCode} onChange={e=>setPairCode(e.target.value)} maxLength={8} autoComplete="off"/><Button className="mt-3" disabled={busy||pairCode.trim().length!==8||!fingerprint||!!summary?.total&&(!ack||downloaded!==fingerprint)} onClick={replace}>Confirm replacement and keep records</Button><Button className="ml-3" variant="outline" disabled={busy} onClick={()=>{lease.current?.release();lease.current=null;setReplaceOpen(false);setPairCode('');setAck(false);}}>Cancel replacement</Button></>}
   </div>}
   {!current&&summary&&<p className="mt-4 text-sm">This is historical evidence. Its grant cannot replace the browser’s current pairing.</p>}
  </>}
  {message&&<p role="alert" className="mt-4 text-sm">{message}</p>}
 </section></main>;
}
