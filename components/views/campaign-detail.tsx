'use client';
import { DeliveryReport, useDeliveryReport } from '@/components/views/delivery-report';
import React, { useEffect, useRef, useState } from 'react';
import { defaultSlotsPerLoop, physicalCapacity } from '@/lib/inventory';
import { Settlement } from './settlement';
import { api } from '@/lib/client';
import { inr, inrRate, fmtDate } from '@/lib/utils';
import { PageHead, SectionHead } from '@/components/ui/app-shell';
import { DataTable } from '@/components/ui/table';
import { Stat, Progress } from '@/components/ui/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select, Field, Label } from '@/components/ui/input';
import { Thumb, Empty } from './bits';
import { Skeleton } from '@/components/ui/loader';

export function CampaignDetail({ id, boot, onGo, onChanged }: {
  id: string; boot: any; onGo: (g: string) => void; onChanged: () => void;
}) {
  const [d, setD] = useState<any>(null);
  const currentId = useRef(id); currentId.current = id;
  const report = useDeliveryReport({ campaign: id });
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState('');
  const [inventory,setInventory]=useState<any>(null);
  const [inventoryError,setInventoryError]=useState('');
  const platform=(boot.caps??[]).includes('platform');

  const load = () => api(`/campaign/${id}`).then(x => { if (currentId.current !== id) return; setD(x); setF({ ...x.campaign }); });
  useEffect(() => {setD(null);setEdit(false);setErr('');load().catch(e=>{if(currentId.current===id)setErr(e.message);}); /* eslint-disable-next-line */ }, [id]);
  useEffect(()=>{
    let current=true;setInventory(null);setInventoryError('');
    if(edit && platform && d?.campaign?.campaign_type==='network')api(`/network-inventory?org=${encodeURIComponent(d.campaign.org_id)}`).then(x=>{if(current)setInventory(x);}).catch(e=>{if(current)setInventoryError(e.message);});
    return ()=>{current=false;};
  },[edit,platform,d?.campaign?.org_id,d?.campaign?.campaign_type]);

  if(!d && err)return <Card className="p-5"><p role="alert">{err}</p><Button className="mt-3" onClick={()=>{setErr('');load().catch(e=>setErr(e.message));}}>Retry</Button></Card>;

  if (!d || d.campaign.id !== id) return (
    <div className="space-y-3">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-40 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0,1,2,3].map(i => <Skeleton key={i} className="h-24" />)}</div>
    </div>
  );
  const c = d.campaign;
  const network=c.campaign_type==='network';
  const scopedNetwork=network&&!platform;
  const mayEdit = (boot.caps ?? []).includes('sales') && (!network||platform);
  const screenPool=network ? [...(inventory?.screens??[]),...d.byScreen.map((r:any)=>r.screen)].filter((screen:any,i:number,rows:any[])=>rows.findIndex(x=>x.id===screen.id)===i).filter((s:any)=>c.screen_ids.includes(s.id)||(s.network_available===true&&s.network_slots>0&&inventory?.orgs?.some((o:any)=>o.id===s.org_id&&o.status==='active'))) : boot.screens.filter((s:any)=>s.org_id===c.org_id);
  const slotsFor=(screen:any)=>f.bookings?.find((b:any)=>b.screen_id===screen.id)?.rotation_weight??f.bookings?.find((b:any)=>b.screen_id===screen.id)?.slots_per_loop??1;
  const mayMoney = (boot.caps ?? []).includes('money');
  const pct = c.committed_budget ? Math.round((c.accrued_spend / c.committed_budget) * 100) : 0;
  const rate = c.rate_type === 'flat'
    ? `${inr(c.committed_budget)} flat`
    : `${inrRate(c.rate_value)} per play`;

  const save = async () => {
    setErr('');
    if (!f.screen_ids.length) return setErr('Pick at least one screen.');
    if (!f.creative_ids.length) return setErr('Pick at least one creative.');
    if(network && !inventory)return setErr('Wait for network inventory before saving.');
    try { await api(`/campaign/${id}`, {
      name: f.name, starts_at: f.starts_at, ends_at: f.ends_at,
      committed_budget: Number(f.committed_budget) || 0, rate_type: f.rate_type,
      rate_value: f.rate_type === 'per_play' ? Number(f.rate_value) || 0 : 0,
      ...(mayMoney ? { invoice_status: f.invoice_status } : {}), screen_ids: f.screen_ids, creative_ids: f.creative_ids,
      bookings:f.screen_ids.map((screenId:string)=>{const screen=screenPool.find((s:any)=>s.id===screenId);if(!screen)throw new Error('Selected screen is unavailable.');return {screen_id:screenId,rotation_weight:Number(slotsFor(screen))};}),
    });
    setEdit(false); await load(); onChanged(); }catch(e){setErr((e as Error).message);}
  };
  const toggleStatus = async () => {
    setErr('');try { await api(`/campaign/${id}`, { status: c.status === 'active' ? 'paused' : 'active' });
    await load(); onChanged(); }catch(e){setErr((e as Error).message);}
  };
  const tick = (arr: string[], v: string) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
  const mine = [...boot.creatives,...(inventory?.creatives??[])].filter((cr:any,i:number,rows:any[])=>rows.findIndex(x=>x.id===cr.id)===i).filter((x: any) => x.advertiser_id === c.advertiser_id);

  const diagnosticTimes = d.plays.map((p:any)=>Date.parse(p.ended_at || p.started_at)).filter(Number.isFinite).sort((a:number,b:number)=>a-b);
  const diagnosticDate = (at:number) => new Date(at).toLocaleString('en-IN', {timeZone:'Asia/Kolkata'});
  const diagnosticWindow = diagnosticTimes.length ? `${diagnosticDate(diagnosticTimes[0])} – ${diagnosticDate(diagnosticTimes[diagnosticTimes.length-1])} IST` : 'No dated receipts loaded';

  return (
    <>
      <PageHead
        title={c.name}
        sub={<>{d.advertiser?.name} · {d.org?.name} · <span className="font-mono">{c.starts_at} → {c.ends_at}</span></>}
        back={{ label: 'Campaigns', go: 'campaigns', onGo }}
        actions={<>
          <Badge variant={c.status === 'active' ? 'ok' : 'muted'}>{c.status}</Badge>
          {c.campaign_type === 'network' && <Badge variant="default">network</Badge>}
          {mayEdit && <Button variant="outline" size="sm" onClick={() => setEdit(!edit)}>Edit</Button>}
          {mayEdit && <Button variant="outline" size="sm" onClick={toggleStatus}>{c.status === 'active' ? 'Pause' : 'Resume'}</Button>}
        </>}
      />

      {scopedNetwork && <Card className="mb-4 p-4 text-sm text-muted-foreground">Gridcast manages this network campaign. Delivery and amounts below cover your organisation’s screens only.</Card>}
      {!edit && err && <p role="alert" className="mb-3 text-sm text-destructive">{err}</p>}
      {edit && mayEdit && f && (
        <Card className="mb-5 border-primary/40 p-5">
          <h3 className="mb-3 text-[14px] font-semibold">Edit campaign</h3>
          <div className="mb-3 flex flex-wrap gap-3">
            <Field label="Name"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Starts"><Input type="date" value={f.starts_at} onChange={e => setF({ ...f, starts_at: e.target.value })} /></Field>
            <Field label="Ends"><Input type="date" value={f.ends_at} onChange={e => setF({ ...f, ends_at: e.target.value })} /></Field>
          </div>
          <div className="mb-3 flex flex-wrap gap-3">
            <Field label="Rate type">
              <Select disabled={network} value={f.rate_type} onChange={e => setF({ ...f, rate_type: e.target.value })}>
                <option value="per_play">Per play</option>{!network&&<option value="flat">Flat fee</option>}
              </Select>
            </Field>
            {f.rate_type === 'per_play' && (
              <Field label="Rate per play (₹)"><Input type="number" step="0.01" value={f.rate_value} onChange={e => setF({ ...f, rate_value: e.target.value })} /></Field>
            )}
            <Field label="Committed budget (₹)"><Input type="number" value={f.committed_budget} onChange={e => setF({ ...f, committed_budget: e.target.value })} /></Field>
            {mayMoney && <Field label="Invoice status">
              <Select value={f.invoice_status} onChange={e => setF({ ...f, invoice_status: e.target.value })}>
                {['not_invoiced','invoiced','part_paid','paid','written_off'].map(v => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}
              </Select>
            </Field>}
          </div>
          <Label>Screens</Label>
          {network&&!inventory&&!inventoryError&&<p role="status" className="mb-2 text-sm">Loading network inventory…</p>}
          {inventoryError&&<p role="alert" className="mb-2 text-sm text-destructive">{inventoryError}. Close and reopen the editor to retry.</p>}
          <div className="mb-3 max-h-52 overflow-y-auto rounded-lg border border-border/60">
            {screenPool.map((s: any) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-2.5 border-b border-border/50 px-3 py-2 text-[13px] last:border-0 hover:bg-black/[0.02]">
                <input type="checkbox" checked={f.screen_ids.includes(s.id)} onChange={() => setF({ ...f, screen_ids: tick(f.screen_ids, s.id) })} />
                <span className="flex-1 truncate">{s.name} <span className="text-muted-foreground">{s.address}</span></span>
                <span className="font-mono text-[12px] text-muted-foreground">{inr(s.slot_price_month)}/mo</span>
              </label>
            ))}
          </div>
          {screenPool.filter((s:any)=>f.screen_ids.includes(s.id)).map((s:any)=><div key={s.id} className="mb-3 flex items-center gap-3"><span className="flex-1 text-sm">{s.name}</span><Field label="Turns per round"><Input aria-label={`Turns per round for ${s.name}`} type="number" min="1" max={100} value={slotsFor(s)} onChange={e=>setF({...f,bookings:[...(f.bookings??[]).filter((b:any)=>b.screen_id!==s.id),{screen_id:s.id,rotation_weight:e.target.value}]})}/></Field></div>)}
          <Label>Creatives</Label>
          <div className="mb-3 flex flex-col gap-1">
            {mine.map((cr: any) => (
              <label key={cr.id} className="flex cursor-pointer items-center gap-2.5 text-[13px]">
                <input type="checkbox" checked={f.creative_ids.includes(cr.id)} onChange={() => setF({ ...f, creative_ids: tick(f.creative_ids, cr.id) })} />
                <span>{cr.name} <span className="font-mono text-muted-foreground">· {cr.duration_s}s</span></span>
                {cr.approval_status !== 'approved' && <Badge variant="warn">{cr.approval_status}</Badge>}
              </label>
            ))}
          </div>
          <div className="rounded-lg bg-primary/[0.06] p-3 text-[12.5px] text-primary">
            Changing screens or creatives affects delivery from the next schedule pull. Existing screen bookings keep their agreed rate; a changed rate applies to newly added screens. Recorded plays and accrued spend are not altered.
          </div>
          <div className="sticky bottom-0 -mx-5 -mb-5 mt-4 flex items-center gap-2 border-t border-border bg-card/95 px-5 py-3 backdrop-blur">
            <Button disabled={network&&!inventory} onClick={save}>Save changes</Button>
            <Button variant="outline" onClick={() => setEdit(false)}>Cancel</Button>
            {err && <span className="text-[12.5px] text-destructive">{err}</span>}
          </div>
        </Card>
      )}

      {typeof c.accrued_spend==='number'&&<Stat metric="recorded_campaign_accrual" period={{from:'',to:'',label:'Campaign lifetime · visible records'}} label={scopedNetwork?"Lifetime gross on your screens":"Lifetime spend"} value={inr(c.accrued_spend)} hint={scopedNetwork?"Recorded accrual on your screens · independent of report dates":`of ${inr(c.committed_budget)} · independent of report dates · new bookings: ${rate}`} />}
      <DeliveryReport report={report} screens={d.byScreen.map((r:any)=>r.screen)} campaigns={[c]} creatives={d.byCreative.map((r:any)=>r.creative)} />
      {c.committed_budget!=null&&<Progress className="mt-3" value={pct} hot={pct >= 80} />}
      {mayMoney&&<><SectionHead>Verified settlement</SectionHead><Settlement buckets={d.settlement_buckets??[]} campaigns={[c]} screens={d.byScreen.map((r:any)=>r.screen)}/></>}

      <SectionHead>Screen bookings</SectionHead>
      <DataTable
        cols={[
          { label: 'Screen', render: (r: any) => <><div className="font-medium">{r.screen.name}</div><div className="text-[12px] text-muted-foreground">{r.screen.address}</div></> },
          { label: 'Venue', render: (r: any) => <Badge variant="muted">{r.screen.venue_type}</Badge> },
          {label:'Booking',render:(r:any)=>{const b=c.bookings?.find((x:any)=>x.screen_id===r.screen.id);return b?<span className="text-xs">{b.rotation_weight ?? b.slots_per_loop ?? 1} turns / round<br/>{b.rate_type==='per_play'&&typeof b.rate_value==='number'?`${inrRate(b.rate_value)} / play`:b.rate_type==='flat'?'Agreed flat rate':'Rate unavailable'}</span>:<span className="text-xs text-muted-foreground">Legacy booking</span>;}},
        ]}
        rows={d.byScreen.map((r:any)=>({screen:r.screen}))} rowId={(r: any) => r.screen.id} exportName="campaign-screens" empty="No screens on this campaign" />

      <SectionHead>Assigned creatives</SectionHead>
      <p className="mb-3 text-xs text-muted-foreground">Creative delivery is shown in the selected-period report above. Rotation is not a controlled A/B experiment: differences may reflect screen, time and audience.</p>
      <DataTable
        cols={[
          { label: 'Creative', render: (r: any) => <div className="flex items-center gap-3"><Thumb id={r.creative.youtube_id} w={58} /><div><div className="font-medium">{r.creative.name}</div><div className="font-mono text-[11.5px] text-muted-foreground">{r.creative.duration_s}s</div></div></div> },
          { label: 'Approval', render: (r: any) => <Badge variant={r.creative.approval_status === 'approved' ? 'ok' : r.creative.approval_status === 'rejected' ? 'destructive' : 'warn'}>{r.creative.approval_status}</Badge> },
        ]}
        rows={d.byCreative.map((r:any)=>({creative:r.creative}))} rowId={(r: any) => r.creative.id} exportName="campaign-creatives" empty="No creatives on this campaign" />

      <details className="mt-5 rounded-xl border border-border p-4">
      <summary className="cursor-pointer text-sm font-semibold">Play diagnostics · {d.plays.length} newest available receipts</summary>
      <p className="mb-2 mt-3 text-xs text-muted-foreground">Loaded receipt window: {diagnosticWindow}. This limited window is independent of the selected report dates.</p>
      <p className="mb-3 text-xs text-muted-foreground">Recent diagnostic records only. This table is not full delivery history and does not determine the report totals above. Reports can include incomplete or non-billable playback; each row shows its evidence.</p>
      <DataTable
        cols={[
          { label: 'When', render: (p: any) => <span className="font-mono text-[12px] text-muted-foreground">{fmtDate(p.ended_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> },
          { label: 'Screen', render: (p: any) => d.byScreen.find((s: any) => s.screen.id === p.screen_id)?.screen.name ?? '—' },
          { label: 'Creative', render: (p: any) => d.byCreative.find((c2: any) => c2.creative.id === p.creative_id)?.creative.name ?? '—' },
          { label: 'Duration', num: true, render: (p: any) => `${Math.round(p.duration_ms / 1000)}s` },
          {label:'Evidence',render:(p:any)=><span className="text-xs text-muted-foreground">{p.source==='seed'?'synthetic demo':p.source||'unknown source'} · {p.billable===true?'billable':p.billable===false?'non-billable':'billing unverified'}<br/>{p.presence?.measured?p.presence.model_ver||'model unspecified':'not measured'}</span>},
          { label: 'People present', num: true, render: (p: any) => p.presence?.measured
              ? <><b>{p.presence.avg_persons.toFixed(1)}</b> <span className="text-[11.5px] text-muted-foreground">({p.presence.sample_count})</span></>
              : <span className="text-muted-foreground">not measured</span> },
        ]}
        rows={d.plays} rowId={(p: any) => p.id} exportName="limited-recent-diagnostics" empty="No plays recorded yet — pair a player to one of these screens" />
      </details>
    </>
  );
}
