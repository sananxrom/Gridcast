'use client';
import { useDeliveryReport } from '@/components/views/delivery-report';
import React, { useEffect, useRef, useState } from 'react';
import { defaultSlotsPerLoop, physicalCapacity } from '@/lib/inventory';
import { api } from '@/lib/client';
import { inr, inrRate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select, Field, Label } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/loader';
import { campaignStatus } from '@/lib/campaign-status';
import { useNow, usePeriodicRefresh } from './campaign-status-badge';
import { CampaignDashboard } from './campaign-dashboard';

export function CampaignDetail({ id, boot, onGo, onChanged }: {
  id: string; boot: any; onGo: (g: string) => void; onChanged: () => void;
}) {
  const [d, setD] = useState<any>(null);
  const currentId = useRef(id); currentId.current = id;
  const report = useDeliveryReport({ campaign: id });
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [inventory,setInventory]=useState<any>(null);
  const [inventoryError,setInventoryError]=useState('');
  const platform=(boot.caps??[]).includes('platform');

  const load = () => api(`/campaign/${id}`).then(x => { if (currentId.current !== id) return; setD(x); setF({ ...x.campaign }); });
  const now = useNow();
  // Refresh receipts/eligibility while viewing (not editing, so the form is never clobbered).
  usePeriodicRefresh(() => api(`/campaign/${id}`, undefined, { quiet: true }).then(x => { if (currentId.current === id) setD(x); }), !!d && !edit);
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
  // Pause/Resume use the generic edit; Submit, Resubmit, Launch and Activate use the review transitions
  // (doc 31 Phase 5). A failed activation is recorded on the campaign, so reload after errors too.
  const runLifecycle = async () => {
    if (!lifecycle || lifecycle.disabled) return;
    setErr(''); setBusy(true);
    try {
      if (lifecycle.transition) await api(`/campaign/${id}/${lifecycle.transition}`, {});
      else await api(`/campaign/${id}`, { status: lifecycle.next });
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); await load().catch(() => undefined); onChanged(); }
  };
  const tick = (arr: string[], v: string) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
  const mine = [...boot.creatives,...(inventory?.creatives??[])].filter((cr:any,i:number,rows:any[])=>rows.findIndex(x=>x.id===cr.id)===i).filter((x: any) => x.advertiser_id === c.advertiser_id);

  // Device status comes from bootstrap screens (heartbeat _status); detail screen views do not carry it for every role.
  const statusScreens = d.byScreen.map((r:any)=>({...r.screen,_status:r.screen?._status??boot.screens?.find((s:any)=>s.id===r.screen?.id)?._status}));
  const status = campaignStatus({ campaign: c, creatives: d.byCreative.map((r:any)=>r.creative), screens: statusScreens, advertiser: d.advertiser, receipts: d.plays, decisions: Array.isArray(d.eligibility) ? d.eligibility : null, now });
  // Header lifecycle action follows the campaign's state (doc 31 Phase 5): ended → none, active → Pause,
  // paused → Resume; draft/pending → Submit for review (or Launch when every creative is approved), In review
  // (disabled), Resubmit after changes, or Activate (retry) when approval could not start the campaign.
  const assigned = d.byCreative.map((r: any) => r.creative);
  const allApproved = assigned.length > 0 && c.creative_ids.length === assigned.length && assigned.every((x: any) => x.approval_status === 'approved');
  const review = c.review?.state;
  type Lifecycle = { label: string; next?: string; transition?: 'submit' | 'activate'; disabled?: boolean };
  const lifecycle: Lifecycle | null = ['complete', 'cancelled'].includes(c.status) || (status.state === 'ended' && review !== 'approved_not_started') ? null
    : c.status === 'active' ? { label: 'Pause', next: 'paused' }
    : c.status === 'paused' ? { label: 'Resume', next: 'active' }
    : review === 'in_review' ? { label: 'In review', disabled: true }
    : review === 'changes_needed' ? { label: 'Resubmit', transition: 'submit' }
    : review === 'approved_not_started' ? { label: 'Activate', transition: 'activate' }
    : allApproved ? { label: 'Launch', transition: 'activate' }
    : { label: 'Submit for review', transition: 'submit' };
  const rejectedCreatives = assigned.filter((x: any) => x.approval_status === 'rejected');

  return (
    <>
      <CampaignDashboard d={d} report={report} status={status} mayMoney={mayMoney} scopedNetwork={scopedNetwork} rate={rate} onGo={onGo}
        actions={<>
          {c.campaign_type === 'network' && <Badge variant="default">network</Badge>}
          {mayEdit && <Button variant="outline" size="sm" onClick={() => setEdit(!edit)}>Edit</Button>}
          {mayEdit && lifecycle && <Button variant={lifecycle.transition ? 'default' : 'outline'} size="sm" disabled={busy || lifecycle.disabled} onClick={runLifecycle}
            title={lifecycle.disabled ? 'Gridcast is reviewing this campaign’s creatives' : undefined}>{lifecycle.label}</Button>}
        </>}>
      {review === 'in_review' && <Card role="status" className="mb-4 p-4 text-sm">Submitted for review{c.review.submitted_at ? ` on ${new Date(c.review.submitted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST` : ''}. Gridcast reviews the creatives; the campaign starts when they are approved. Its screens are held meanwhile.</Card>}
      {review === 'changes_needed' && <Card role="alert" className="mb-4 border-warn/40 p-4 text-sm"><b>Changes needed.</b> {c.review.note ? <>Reviewer note: “{c.review.note}”. </> : null}Change or replace the rejected creatives with Edit, then Resubmit. Its screens stay held.</Card>}
      {review === 'approved_not_started' && <Card role="alert" className="mb-4 border-destructive/40 p-4 text-sm"><b>Approved, cannot start:</b> {c.review.activation_error || 'activation failed'}. Fix this with Edit, then Activate again.</Card>}
      {c.status !== 'draft' && review !== 'changes_needed' && rejectedCreatives.length > 0 && <Card className="mb-4 p-4 text-sm"><b>Changes needed:</b> {rejectedCreatives.map((x: any) => x.name).join(', ')} {rejectedCreatives.length === 1 ? 'was' : 'were'} rejected and will not play. Replace {rejectedCreatives.length === 1 ? 'it' : 'them'} to send for review again.</Card>}

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
              <label key={s.id} className="flex cursor-pointer items-center gap-2.5 border-b border-border/50 px-3 py-2 text-[13px] last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
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

      </CampaignDashboard>
    </>
  );
}
