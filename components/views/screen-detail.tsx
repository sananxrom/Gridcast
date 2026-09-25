'use client';
import { DeliveryReport, useDeliveryReport } from '@/components/views/delivery-report';
import React, { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { inr, fmtDate, cn } from '@/lib/utils';
import { PageHead, SectionHead } from '@/components/ui/app-shell';
import { DataTable } from '@/components/ui/table';
import { Stat, Progress } from '@/components/ui/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Field, Label } from '@/components/ui/input';
import { StatusBadge, Thumb, Empty, ScreenPhoto } from './bits';
import { ScreenConfig } from './config-views';
import { Skeleton } from '@/components/ui/loader';
import { PairingCode } from './screen-onboarding';
import { reasonLabel } from '@/lib/readiness';
import { ScreenDiagnostics } from './screen-diagnostics';
import { ScreenMaintenance } from './screen-maintenance';

export function ScreenDetail({ id, onGo, onChanged }: { id: string; onGo: (g: string) => void; onChanged: () => void }) {
  const [d, setD] = useState<any>(null);
  const currentId = useRef(id); currentId.current = id;
  const report = useDeliveryReport({ screen: id });
  const [edit, setEdit] = useState(false);
  const [tab, setTab] = useState<'live' | 'config'>('live');
  const [f, setF] = useState<any>(null);
  const [error,setError] = useState(''), [busy,setBusy] = useState(false), [pairing,setPairing] = useState<any>(null);

  const load = () => api(`/screen/${id}`).then(x => {
    if (currentId.current !== id) return;
    setD(x);
    setF({ min_creative_duration_s:1, max_creative_duration_s:600, ...x.screen, tagStr: Object.entries(x.screen.tags || {}).map(([k, v]) => `${k}:${v}`).join(', '),
      excStr: (x.screen.exclusions?.categories || []).join(', '), advExcStr:(x.screen.exclusions?.advertisers||[]).join(', '), from:x.screen.operating_hours?.from ?? x.config?.operating_hours?.value?.from ?? '09:00', to:x.screen.operating_hours?.to ?? x.config?.operating_hours?.value?.to ?? '21:00' });
  });
  useEffect(() => { setD(null); setF(null); setError(''); setEdit(false); setPairing(null); load().catch(e=>{if(currentId.current===id)setError(e.message);}); /* eslint-disable-next-line */ }, [id]);

  // live ticker
  useEffect(() => {
    const t = setInterval(() => { api(`/screen/${id}`, undefined, { quiet: true }).then(x => { if(currentId.current!==id)return; setD((prev: any) => prev ? { ...prev, nowPlaying: x.nowPlaying, status: x.status, stats: x.stats, device:x.device, config_version:x.config_version, readiness:x.readiness, eligibility:x.eligibility, campaigns:x.campaigns, diagnostic_assignments:x.diagnostic_assignments, diagnostic_results:x.diagnostic_results, diagnostic_history:x.diagnostic_history } : x); }).catch(() => {}); }, 3000);
    return () => clearInterval(t);
  }, [id]);

  if (!d || d.screen.id !== id || !f) return error ? <p role="alert" className="text-destructive">{error}</p> : (
    <div className="space-y-3">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-40 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0,1,2,3].map(i => <Skeleton key={i} className="h-24" />)}</div>
    </div>
  );
  const s = d.screen, st = d.status, n = d.nowPlaying;
  const caps: string[] = d.caps ?? [];
  const mayEdit = caps.includes('screens'), mayPrice = caps.includes('sales'), mayMoney = caps.includes('money');
  const preview = Math.round(Number(f.venue_base) * Number(f.size_factor) * Number(f.location_factor) * Number(f.exposure_factor));
  const perSlot = Math.round(preview / Math.max(1, Number(f.advertiser_slots) || 1));

  const pair=async()=>{setError('');setBusy(true);try{setPairing(await api(`/screens/${id}/pairing`,{}));await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const revoke=async()=>{setError('');setBusy(true);try{await api(`/screens/${id}/revoke-device`,{});await load();onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const save = async () => {
    setError(''); setBusy(true);
    try { const tags: Record<string, string> = {};
    String(f.tagStr).split(',').map(x => x.trim()).filter(Boolean).forEach(p => {
      const i = p.indexOf(':'); if (i > 0) tags[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    });
    const net = Number(f.network_slots) || 0;
    await api(`/screen/${id}`, {
      name: f.name, venue_name: f.venue_name, address: f.address, photo_url: f.photo_url || '', has_camera: !!f.has_camera,
      ...(mayPrice ? { venue_base: Number(f.venue_base), size_factor: Number(f.size_factor),
        location_factor: Number(f.location_factor), exposure_factor: Number(f.exposure_factor) } : {}),
      ...(mayPrice ? {advertiser_slots:Number(f.advertiser_slots) || 10, loop_length_s:Number(f.loop_length_s),slot_duration_s:Number(f.slot_duration_s),network_slots:net,network_available:net > 0} : {}),
      min_creative_duration_s:Number(f.min_creative_duration_s),max_creative_duration_s:Number(f.max_creative_duration_s),
      operating_hours:{from:f.from,to:f.to},
      ...(mayMoney ? { owner_share_pct: Number(f.owner_share_pct) } : {}), tags,
    });
    await api(`/screen/${id}/exclusions`, { exclusions: { categories: String(f.excStr).split(',').map(x => x.trim()).filter(Boolean), advertisers: String(f.advExcStr).split(',').map(x=>x.trim()).filter(Boolean), competitive_separation:!!f.exclusions?.competitive_separation } });
    setEdit(false); await load(); onChanged(); }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };

  const diagnosticTimes = d.recent.map((p:any)=>Date.parse(p.ended_at || p.started_at)).filter(Number.isFinite).sort((a:number,b:number)=>a-b);
  const diagnosticDate = (at:number) => new Date(at).toLocaleString('en-IN', {timeZone:'Asia/Kolkata'});
  const diagnosticWindow = diagnosticTimes.length ? `${diagnosticDate(diagnosticTimes[0])} – ${diagnosticDate(diagnosticTimes[diagnosticTimes.length-1])} IST` : 'No dated receipts loaded';

  return (
    <>
      <PageHead title={s.name}
        sub={<>{d.organisation?.name || s.org_id} · {s.venue_name} · {s.address}</>}
        back={{ label: 'My screens', go: 'screens', onGo }}
        actions={<><StatusBadge st={st} />{mayEdit && <Button variant="outline" size="sm" onClick={() => setEdit(!edit)}>Edit screen</Button>}</>} />

      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
      {pairing && <PairingCode pairing={pairing} onClose={()=>setPairing(null)} />}
      <div className="mb-4 inline-flex rounded-lg border border-border bg-card p-0.5">
        {([['live', 'Live & performance'], ['config', 'Config']] as const).filter(([k]) => k !== 'config' || mayEdit).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn('rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {label}{k === 'config' && (d.pricingDrift || []).length > 0 && <span className="ml-1.5 text-warn">•</span>}
          </button>
        ))}
      </div>

      {tab === 'config' && mayEdit && <ScreenConfig screenId={id} d={d} onChanged={load} />}
      {tab === 'live' && (<>

      {edit && mayEdit && (
        <Card className="mb-5 border-primary/40 p-5">
          <h3 className="mb-3 text-[14px] font-semibold">Edit screen</h3>
          <div className="mb-3 flex flex-wrap gap-3">
            <Field label="Name"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Venue"><Input value={f.venue_name} onChange={e => setF({ ...f, venue_name: e.target.value })} /></Field>
            <Field label="Address"><Input value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
            <Field label="Photo URL (a picture of the screen in place)" className="w-full basis-full"><Input value={f.photo_url || ''} placeholder="https://…" onChange={e => setF({ ...f, photo_url: e.target.value })} /></Field>
          </div>
          <div className="mb-3 flex flex-wrap gap-3">{[['min_creative_duration_s','Minimum creative seconds'],['max_creative_duration_s','Maximum creative seconds']].map(([key,label])=><Field key={key} label={label}><Input aria-label={label} type="number" min="1" max="600" step="0.1" value={f[key]} onChange={e=>setF({...f,[key]:e.target.value})}/></Field>)}</div>
          <p className="mb-3 text-xs text-muted-foreground">Videos and image display times must fit these limits. Playback uses the creative’s duration with no slot padding. Eligible paid campaigns rotate continuously; faster rotation uses per-play budgets faster, within their reserved allowance.</p>
          <label className="my-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.has_camera} onChange={e=>setF({...f,has_camera:e.target.checked})}/>Camera available for presence measurement</label>
          <p className="mb-3 text-xs text-muted-foreground">The player will apply camera changes when it next refreshes its settings. Failed or missing measurements stay unmeasured.</p>
          {mayPrice && <><Label className="mt-4">Rate factors — value = base × size × location × exposure</Label>
          <div className="mb-2 flex flex-wrap gap-3">
            {[['venue_base','Venue base ₹','1'],['size_factor','Size','0.1'],['location_factor','Location','0.1'],['exposure_factor','Exposure','0.05'],['advertiser_slots','Advertiser limit','1']].map(([k, lbl, step]) => (
              <Field key={k} label={lbl}><Input type="number" step={step} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></Field>
            ))}
          </div>
          <p className="mb-3 font-mono text-[12.5px] text-primary">→ {inr(preview)} / month · {inr(perSlot)} per advertiser per month</p></>}
          {(mayPrice || mayMoney) && <Label className="mt-2">Inventory &amp; share</Label>}
          <div className="mb-3 flex flex-wrap gap-3">
            {[['owner_share_pct','Owner share %'],['network_slots','Network advertiser limit']].filter(([k]) => k === 'owner_share_pct' ? mayMoney : mayPrice).map(([k, lbl]) => (
              <Field key={k} label={lbl}><Input type="number" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></Field>
            ))}
          </div>
          {mayPrice && <p className="mb-3 text-xs text-muted-foreground">The network limit counts distinct advertisers within the shared advertiser limit. Reducing it stops new bookings; existing commitments keep their reserved space.</p>}
          <div className="mb-3 flex flex-wrap gap-3">
            <Field label="Opens (IST)"><Input type="time" value={f.from} onChange={e=>setF({...f,from:e.target.value})}/></Field><Field label="Closes (IST)"><Input type="time" value={f.to} onChange={e=>setF({...f,to:e.target.value})}/></Field>
            <Field label="Tags (key:value, comma separated)"><Input value={f.tagStr} onChange={e => setF({ ...f, tagStr: e.target.value })} /></Field>
            <Field label="Blocked categories"><Input value={f.excStr} onChange={e => setF({ ...f, excStr: e.target.value })} /></Field>
          </div>
          <div className="mt-3"><Label>Blocked advertisers</Label>{(d.advertisers||[]).length ? <div className="flex flex-wrap gap-3">{d.advertisers.map((a:any)=>{const selected=String(f.advExcStr).split(',').map(x=>x.trim()).filter(Boolean);return <label className="flex items-center gap-2 text-sm" key={a.id}><input type="checkbox" checked={selected.includes(a.id)} onChange={e=>setF({...f,advExcStr:(e.target.checked?[...selected,a.id]:selected.filter(x=>x!==a.id)).join(', ')})}/>{a.name}</label>;})}</div>:<p className="text-sm text-muted-foreground">No advertisers available to block. Existing exclusions are preserved.</p>}</div>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.exclusions?.competitive_separation} onChange={e=>setF({...f,exclusions:{...f.exclusions,competitive_separation:e.target.checked}})}/>Keep competing advertisers in the same category out of a rotation</label>
          <div className="sticky bottom-0 -mx-5 -mb-5 mt-4 flex items-center gap-2 border-t border-border bg-card/95 px-5 py-3 backdrop-blur">
            <Button onClick={save} disabled={busy}>{busy?'Saving…':'Save screen'}</Button>
            <Button variant="outline" onClick={() => { setEdit(false); load(); }}>Cancel</Button>
          </div>
        </Card>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="overflow-hidden">
        <ScreenPhoto src={s.photo_url} venue={s.venue_type} className="aspect-video rounded-none border-0" />
        {mayEdit && <div className="space-y-2 p-3 text-xs">
          <p className="text-muted-foreground">Device: {d.device && d.device.status!=='revoked'?'paired':d.device?.status||'not paired'}</p>
          {d.device?.last_heartbeat_at && <p>Last heartbeat: {fmtDate(d.device.last_heartbeat_at,{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</p>}
          {d.config_version && <p className="break-all text-muted-foreground">Config version: <span className="font-mono">{d.config_version}</span></p>}
          {d.device && d.device.applied_config_version!==d.config_version && <p className="text-warn">Device has not acknowledged the current configuration.</p>}
          <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={pair} disabled={busy}>Generate pairing code</Button>{d.device && d.device.status!=='revoked' && <Button variant="destructive" size="sm" onClick={revoke} disabled={busy}>Unpair device</Button>}</div>
          <p className="text-muted-foreground">Pairing a replacement revokes the old device. Codes expire and are single-use.</p>
        </div>}

      </Card>
      <Card className="p-5">
        {n ? (
          <div className="flex flex-wrap items-start gap-5">
            <Thumb id={n.creative?.youtube_id} w={210} className="rounded-lg" />
            <div className="min-w-[220px] flex-1">
              <Badge variant="onair" blip>now playing</Badge>
              <div className="mt-2 text-[17px] font-semibold tracking-tight">{n.creative?.name ?? '—'}</div>
              <div className="text-[13px] text-muted-foreground">{n.advertiser} · {n.campaign?.name}</div>
              <div className="mt-3 max-w-[340px]">
                <Progress value={Math.min(100, (n.elapsed_s / (n.duration_s || 10)) * 100)} hot />
                <div className="mt-1 font-mono text-[11.5px] text-muted-foreground tnum">
                  {Math.min(n.duration_s, Math.round(n.elapsed_s))}s / {n.duration_s}s
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-[13px] text-muted-foreground">
            {st.state === 'live' ? 'Paired and responding — waiting for the next play.'
              : st.state === 'unpaired' ? mayEdit ? <>Nothing paired yet. Generate a pairing code and enter it in the player.</> : 'Nothing paired yet.'
              : `Last seen ${st.age_s > 3600 ? Math.round(st.age_s / 3600) + 'h' : Math.round(st.age_s / 60) + 'm'} ago.`}
          </div>
        )}
      </Card>
      </div>

      <Card className="mb-4 p-4" aria-label="Screen readiness">
        <h3 className="font-semibold">Screen readiness</h3>
        <p className="mt-2 text-sm">{d.readiness?.message || (d.campaigns?.length ? 'Checking delivery eligibility…' : 'No campaign is assigned to this screen.')}</p>
        <p className="mt-2 text-sm">Camera: {s.has_camera ? 'enabled for this screen' : 'disabled in screen settings'}</p>
        {mayEdit && <p className="mt-1 text-xs text-muted-foreground">{d.device && d.device.status !== 'revoked' ? 'Player paired' : 'No active paired player'} · Camera and detector observations below are reported by the device.</p>}
        {(d.readiness?.warnings || []).map((code:string)=><p key={code} className="mt-2 text-xs text-amber-700">{reasonLabel(code)}</p>)}
        {d.campaigns.filter((c:any)=>!c.creatives?.length).map((c:any)=><p className="mt-2 text-sm" key={c.id}>{c.name}: no creative attached.</p>)}
        {(d.eligibility || []).length > 0 && <ul className="mt-3 space-y-2 text-sm">{d.eligibility.map((e:any,i:number)=><li key={`${e.campaign_id}-${e.creative_id}-${i}`}>
          <b>{d.campaigns.find((c:any)=>c.id===e.campaign_id)?.name || 'Assigned campaign'}</b> · {d.campaigns.flatMap((c:any)=>c.creatives || []).find((c:any)=>c.id===e.creative_id)?.name || 'Creative'}: {reasonLabel(e.reason)}{e.rejected_at_step != null && <span className="text-muted-foreground"> · eligibility step {e.rejected_at_step}</span>}
          {e.letterbox && <span className="text-muted-foreground"> · fits with borders</span>}
          {(e.warnings || []).map((code:string)=><span key={code} className="block text-xs text-amber-700">{reasonLabel(code)}</span>)}
        </li>)}</ul>}
      </Card>

      {mayEdit && <ScreenDiagnostics screenId={id} device={d.device} assignments={d.diagnostic_assignments || []} results={d.diagnostic_results || []} history={d.diagnostic_history} onChanged={load} />}

      {mayEdit && <ScreenMaintenance key={id} screenId={id} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat metric="live_campaign_count" period={{from:'',to:'',label:'Current loaded records'}} label="Live campaigns" value={d.stats.liveCampaigns} hint={`${s.advertiser_slots} distinct-advertiser limit`} />
        {mayPrice && <Stat metric="advertiser_monthly_price" period={{from:'',to:'',label:'Current loaded records'}} label="Price" value={inr(s.slot_price_month)} hint="per advertiser per month" />}
      </div>

      <DeliveryReport report={report} screens={[s]} campaigns={d.campaigns} creatives={d.campaigns.flatMap((c:any)=>c.creatives??[])} />

      <SectionHead hint={`· ${d.campaigns.length} total, ${d.campaigns.filter((c: any) => c.live).length} live`}>Campaigns on this screen</SectionHead>
      <DataTable
        cols={[
          { label: 'Campaign', render: (c: any) => <><button onClick={() => onGo('c/' + c.id)} className="text-left font-medium text-primary hover:underline">{c.name}</button><div className="text-[12px] text-muted-foreground">{c.advertiser}</div></> },
          { label: 'Creatives', render: (c: any) => <div className="flex gap-1.5">{c.creatives.map((cr: any) => <Thumb key={cr.id} id={cr.youtube_id} w={58} />)}</div> },
          { label: 'Dates', render: (c: any) => <span className="font-mono text-[12px] text-muted-foreground">{c.starts_at}<br />→ {c.ends_at}</span> },
          { label: 'Status', render: (c: any) => c.live ? <Badge variant="onair" blip>live</Badge> : <Badge variant="muted">{c.status}</Badge> },
          { label: 'Paid plays · selected dates', num: true, render: (c: any) => report.data?.byCampaign[c.id]?.plays_rendered ?? (report.data?.coverage.complete ? 0 : '—') },
          { label: 'People / measured paid play', num: true, render: (c: any) => { const r = report.data?.byCampaign[c.id]; return r?.presence_n ? (r.presence_sum / r.presence_n).toFixed(1) : '—'; } },
          ...(mayPrice ? [{ label: 'Lifetime budget used', num: true, render: (c: any) => { const p = c.committed_budget ? Math.round(c.accrued_spend / c.committed_budget * 100) : 0;
            return <div className="flex flex-col items-end gap-1"><span className="whitespace-nowrap">{inr(c.accrued_spend)} / {inr(c.committed_budget)}</span><Progress value={p} hot={p >= 80} className="w-20" /></div>; } }] : []),
        ]}
        rows={d.campaigns.map(({plays,avg,...campaign}:any)=>campaign)} rowId={(c: any) => c.id} exportName="screen-campaigns" empty="No campaigns booked on this screen yet" />

      <details className="mt-5 rounded-xl border border-border p-4">
      <summary className="cursor-pointer text-sm font-semibold">Play diagnostics · {d.recent.length} newest available receipts</summary>
      <p className="mb-2 mt-3 text-xs text-muted-foreground">Loaded receipt window: {diagnosticWindow}. This limited window is independent of the selected report dates.</p>
      <p className="mb-3 text-xs text-muted-foreground">Recent diagnostic records only. This table is not full delivery history and does not determine the report totals above. Reports can include incomplete or non-billable playback; each row shows its evidence.</p>
      <DataTable
        cols={[
          { label: 'When', render: (p: any) => <span className="font-mono text-[12px] text-muted-foreground">{fmtDate(p.ended_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> },
          { label: 'Creative', render: (p: any) => p.creative ? <div className="flex items-center gap-3"><Thumb id={p.creative.youtube_id} w={52} />{p.creative.name}</div> : '—' },
          { label: 'Duration', num: true, render: (p: any) => `${Math.round(p.duration_ms / 1000)}s` },
          {label:'Evidence',render:(p:any)=><span className="text-xs text-muted-foreground">{p.source==='seed'?'synthetic demo':p.source||'unknown source'} · {p.billable===true?'billable':p.billable===false?'non-billable':'billing unverified'}<br/>{p.presence?.measured? p.presence.model_ver||'model unspecified':'not measured'}</span>},
          { label: 'People present', num: true, render: (p: any) => p.presence?.measured ? <b>{p.presence.avg_persons.toFixed(1)}</b> : <span className="text-muted-foreground">not measured</span> },
        ]}
        rows={d.recent} rowId={(p: any) => p.id} exportName="limited-recent-diagnostics" empty="No plays on this screen yet" />
      </details>
      </>)}
    </>
  );
}
