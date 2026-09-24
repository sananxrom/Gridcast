'use client';
import React, { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { defaultSlotsPerLoop, physicalCapacity } from '@/lib/inventory';
import { inr, ytId } from '@/lib/utils';
import { PageHead } from '@/components/ui/app-shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Field, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export function CampaignBuilder({ boot, user, orgId, onGo, onDone }: {
  boot: any; user: any; orgId?: string | null; onGo: (g: string) => void; onDone: (c: any) => void;
}) {
  const localDay=(time:number)=>new Date(time+330*60000).toISOString().slice(0,10);
  const end = localDay(Date.now() + 30 * 86400000);
  const selectedOrg = orgId ?? (user.role==='platform_admin' ? '' : user.org_id);
  const isPlatform = user.role === 'platform_admin';
  const originOrg = boot.orgs?.find((o:any)=>o.id===selectedOrg) ?? boot.org;
  const [campaignType,setCampaignType] = useState('operator');
  const network = campaignType === 'network';
  const [networkInventory,setNetworkInventory] = useState<any>(null);
  const [inventoryError,setInventoryError] = useState('');
  const [inventoryAttempt,setInventoryAttempt] = useState(0);
  useEffect(()=>{
    let current=true;setNetworkInventory(null);setInventoryError('');
    if(network && isPlatform && selectedOrg) api(`/network-inventory?org=${encodeURIComponent(selectedOrg)}`).then(result=>{if(current)setNetworkInventory(result);}).catch(e=>{if(current)setInventoryError(e.message);});
    return ()=>{current=false;};
  },[network,isPlatform,selectedOrg,inventoryAttempt]);
  const availableAdvertisers=boot.advertisers.filter((a:any)=>a.org_id===selectedOrg && a.status!=='archived');
  const [advId, setAdvId] = useState(availableAdvertisers[0]?.id ?? '__new');
  const [addedAdvertisers,setAddedAdvertisers] = useState<any[]>([]);
  const [newAdv, setNewAdv] = useState({ name: '', contact: '' });
  const [f, setF] = useState({ name: '', starts_at: localDay(Date.now()), ends_at: end, rate_type: 'per_play', rate_value: '0.93', budget: '12000' });
  const [screens, setScreens] = useState<string[]>([]);
  const [creatives, setCreatives] = useState<string[]>([]);
  const [local, setLocal] = useState<any[]>([]);
  const [yt, setYt] = useState({ url: '', name: '', dur: '10' });
  const [ytErr, setYtErr] = useState('');
  const [err, setErr] = useState('');
  const [bookingSlots,setBookingSlots] = useState<Record<string,string>>({});
  const [saving,setSaving] = useState(false);
  const [status,setStatus] = useState('pending');
  const advertisers=[...availableAdvertisers,...addedAdvertisers];
  const [daypart,setDaypart]=useState({enabled:false,from:'09:00',to:'21:00'});
  const ownScreens = network ? (networkInventory?.screens ?? []).filter((s:any)=>s.network_available===true && s.network_slots>0 && networkInventory.orgs.some((o:any)=>o.id===s.org_id && o.status==='active')) : boot.screens.filter((s:any)=>s.org_id===selectedOrg);
  const slotsFor=(s:any)=>bookingSlots[s.id] ?? '1';
  const orgName=(id:string)=>(networkInventory?.orgs ?? boot.orgs ?? []).find((o:any)=>o.id===id)?.name ?? id;

  const pool = [...boot.creatives, ...local].filter((c: any) => c.advertiser_id === advId && c.purpose !== 'filler');
  const total = ownScreens.filter((s: any) => screens.includes(s.id)).reduce((a: number, b: any) => a + b.slot_price_month, 0);
  const tick = (arr: string[], v: string, set: (x: string[]) => void) => set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  const addAdvertiser=async()=>{setErr('');try{if(!selectedOrg) throw new Error('Select an organisation first.');if(!newAdv.name.trim()) throw new Error('Enter the advertiser name.');const a=await api('/advertiser',{org_id:selectedOrg,...newAdv,category:'general'});setAddedAdvertisers([...addedAdvertisers,a]);setAdvId(a.id);}catch(e){setErr((e as Error).message);}};

  const addCreative = async () => {
    const id = ytId(yt.url);
    if (!id) return setYtErr('Not a YouTube URL or video ID.');
    if (advId === '__new') return setYtErr('Create or select the advertiser in step 1 first.');
    setYtErr('');
    try { const cr = await api('/creative', { org_id: selectedOrg, advertiser_id: advId, name: yt.name || 'Untitled creative', category: 'general', youtube_id: id, duration_s: Number(yt.dur) || 10, aspect: '16:9' });
    setLocal([...local, cr]); setCreatives([...creatives, cr.id]); setYt({ url: '', name: '', dur: '10' }); } catch(e) {setYtErr((e as Error).message);}
  };

  const applyGroup = async (gid: string) => {
    if (gid === '__none') return setScreens([]);
    try { const r = await api('/group/resolve', { org_id: selectedOrg, group_id: gid });
    setScreens(Array.from(new Set([...screens, ...r.screen_ids])).filter(id=>ownScreens.some((s:any)=>s.id===id))); } catch(e) {setErr((e as Error).message);}
  };

  const save = async () => {
    setErr(''); setSaving(true);
    try {
      if (!selectedOrg) throw new Error('Select an organisation first.');
      if (advId !== '__new' && !advertisers.some((a:any)=>a.id===advId)) throw new Error('Select an active advertiser in this organisation.');
      if (network && (!isPlatform || originOrg?.type!=='gridcast')) throw new Error('Select the Gridcast organisation to create a network campaign.');
      if (network && !networkInventory) throw new Error('Wait for network screens to load.');
      if (!screens.length) throw new Error('Pick at least one screen.');
      if (!creatives.length) throw new Error('Pick or add at least one creative.');
      if (!f.name.trim()) throw new Error('Enter a campaign name.');
      const budget=Number(f.budget), rate=Number(f.rate_value);
      if(!Number.isFinite(budget)||budget<0||!Number.isFinite(rate)||rate<0) throw new Error('Rate and budget must be zero or positive numbers.');
      let adv = advId;
      if (adv === '__new') {
        if (!newAdv.name.trim()) throw new Error('Enter the new advertiser name.');
        const a = await api('/advertiser', { org_id: selectedOrg, name: newAdv.name, contact: newAdv.contact, category: 'general' });
        adv = a.id; setAdvId(adv);
      }
      const bookings=screens.map(id=>{const s=ownScreens.find((x:any)=>x.id===id);if(!s) throw new Error('Selected screen is no longer available for this campaign.');const n=Number(slotsFor(s));if(!Number.isInteger(n)||n<1) throw new Error('Turns per round must be a positive whole number.');return {screen_id:id,rotation_weight:n};});
      const c = await api('/campaign', {
        org_id: selectedOrg, advertiser_id: adv, name: f.name, campaign_type: campaignType,
        starts_at: f.starts_at, ends_at: f.ends_at, committed_budget: budget,
        rate_type: network ? 'per_play' : f.rate_type, rate_value: network || f.rate_type === 'per_play' ? rate : 0,
        screen_ids: screens, creative_ids: creatives, bookings, status, ...(daypart.enabled?{dayparts:[{from:daypart.from,to:daypart.to}]}:{}),
      });
      onDone(c);
    } catch(e) {setErr((e as Error).message);} finally {setSaving(false);}
  };

  return (
    <>
      <PageHead title="New campaign" back={{ label: 'Campaigns', go: 'campaigns', onGo }}
        sub="Budget is entered manually — the platform records what was agreed, it does not take payment." />

      {!selectedOrg && <Card className="mb-4 p-4">Select an organisation above before creating a campaign.</Card>}
      {isPlatform && <Card className="mb-4 p-5">
        <Field label="Campaign type"><Select aria-label="Campaign type" value={campaignType} onChange={e=>{setCampaignType(e.target.value);setScreens([]);setBookingSlots({});setErr('');if(e.target.value==='network')setF({...f,rate_type:'per_play'});}}>
          <option value="operator">Organisation campaign — its own screens</option>
          <option value="network" disabled={originOrg?.type!=='gridcast'}>Network campaign — screens across organisations</option>
        </Select></Field>
        <p className="mt-2 text-sm text-muted-foreground">{network ? `Advertisers and creatives stay with ${originOrg?.name ?? 'Gridcast'}. Choose released screens across the network below. Network campaigns use per-play billing.` : 'For network campaigns, select the Gridcast organisation above. A campaign’s type cannot change after creation.'}</p>
      </Card>}
      <Card className="mb-4 p-5">
        <h3 className="mb-3 text-[14px] font-semibold">1 · Client &amp; dates</h3>
        <div className="flex flex-wrap gap-3">
          <Field label="Advertiser">
            <Select aria-label="Campaign advertiser" value={advId} onChange={e => {setAdvId(e.target.value);setCreatives([]);setScreens([]);}}>
              {advertisers.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              <option value="__new">+ New advertiser…</option>
            </Select>
          </Field>
          <Field label="Campaign name"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Fitline — Oct push" /></Field>
          <Field label="Starts"><Input type="date" value={f.starts_at} onChange={e => setF({ ...f, starts_at: e.target.value })} /></Field>
          <Field label="Ends"><Input type="date" value={f.ends_at} onChange={e => setF({ ...f, ends_at: e.target.value })} /></Field>
        </div>
        {advId === '__new' && (
          <div className="mt-3 flex flex-wrap gap-3">
            <Field label="New advertiser name"><Input value={newAdv.name} onChange={e => setNewAdv({ ...newAdv, name: e.target.value })} placeholder="Acme Motors" /></Field>
            <Field label="Contact"><Input value={newAdv.contact} onChange={e => setNewAdv({ ...newAdv, contact: e.target.value })} /></Field><Button variant="outline" onClick={addAdvertiser}>Create advertiser</Button>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={daypart.enabled} onChange={e=>setDaypart({...daypart,enabled:e.target.checked})}/>Limit delivery to a daily window (IST)</label>{daypart.enabled && <><Input aria-label="Daypart starts" type="time" className="w-36" value={daypart.from} onChange={e=>setDaypart({...daypart,from:e.target.value})}/><Input aria-label="Daypart ends" type="time" className="w-36" value={daypart.to} onChange={e=>setDaypart({...daypart,to:e.target.value})}/></>}</div>
      </Card>

      <Card className="mb-4 p-5">
        <h3 className="mb-3 text-[14px] font-semibold">2 · Rate &amp; budget</h3><p className="mb-3 text-sm text-muted-foreground">Ads repeat continuously. Fewer competing ads mean more plays and faster spending. Per-play delivery is capped by the budget, with allowances reserved across screens. Turns are relative frequency, not a guaranteed hourly count.</p>
        <div className="flex flex-wrap gap-3">
          <Field label="Rate type">
            <Select aria-label="Campaign rate type" disabled={network} value={f.rate_type} onChange={e => setF({ ...f, rate_type: e.target.value })}>
              <option value="per_play">Per play</option>{!network && <option value="flat">Flat fee</option>}
            </Select>
          </Field>
          {f.rate_type === 'per_play' && <Field label="Rate per play (₹)"><Input type="number" step="0.01" value={f.rate_value} onChange={e => setF({ ...f, rate_value: e.target.value })} /></Field>}
          <Field label="Committed budget (₹)"><Input type="number" value={f.budget} onChange={e => setF({ ...f, budget: e.target.value })} /></Field>
        </div>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          {f.rate_type === 'flat' ? 'Flat-rate settlement is awaiting a confirmed commercial policy; these campaigns do not accrue verified settlement here.'
            : 'Per play: spend accrues each time a creative plays. Budget is a cap you are alerted at, not an automatic stop.'}
        </p>
      </Card>

      <Card className="mb-4 p-5">
        <h3 className="mb-3 text-[14px] font-semibold">3 · Screens</h3>
        {!network && boot.groups?.length > 0 && (
          <>
            <Label>Quick select by group</Label>
            <div className="mb-3 flex flex-wrap gap-2">
              {boot.groups.filter((g:any)=>g.org_id===selectedOrg).map((g: any) => (
                <Button key={g.id} variant="outline" size="sm" onClick={() => applyGroup(g.id)}>
                  {g.name}<span className="text-muted-foreground">{g.group_type}</span>
                </Button>
              ))}
              <Button variant="ghost" size="sm" onClick={() => applyGroup('__none')}>Clear</Button>
            </div>
          </>
        )}
        {network && !networkInventory && !inventoryError && <p role="status" className="mb-3 text-sm">Loading released network screens…</p>}
        {inventoryError && <div role="alert" className="mb-3 text-sm text-destructive">{inventoryError}<Button variant="outline" size="sm" onClick={()=>setInventoryAttempt(n=>n+1)}>Retry inventory</Button></div>}
        {network && networkInventory && <p className="mb-3 text-sm text-muted-foreground">{ownScreens.length} screens released for new network bookings. Network limits count distinct advertisers; relative turns control rotation frequency. Existing commitments are checked when you save.</p>}
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border/60">
          {ownScreens.map((s: any) => (
            <label key={s.id} className="flex cursor-pointer items-center gap-3 border-b border-border/50 px-3 py-2.5 text-[13px] last:border-0 hover:bg-black/[0.02]">
              <input type="checkbox" checked={screens.includes(s.id)} onChange={() => tick(screens, s.id, setScreens)} />
              <span className="min-w-0 flex-1"><span className="font-medium">{s.name}</span><br /><span className="text-[12px] text-muted-foreground">{network ? `${orgName(s.org_id)} · ` : ''}{s.address}</span></span>
              <Badge variant="muted">{s.venue_type}</Badge>
              <span className="w-14 text-right font-mono text-[12px] text-muted-foreground">{s.advertiser_slots} advertisers{network && <><br/>{s.network_slots} network limit</>}</span>
              <span className="w-24 text-right font-mono tnum">{inr(s.slot_price_month)}</span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          {screens.length ? <><b>{screens.length}</b> screen{screens.length === 1 ? '' : 's'} selected · combined list price <b>{inr(total)}</b> / month per advertiser allocation</> : 'No screens selected'}
        </p>
        {ownScreens.filter((s:any)=>screens.includes(s.id)).map((s:any)=><div key={s.id} className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-border p-3"><span className="flex-1 text-sm">{s.name}<br/><span className="text-xs text-muted-foreground">Continuous rotation; longer creatives occupy their actual duration.</span></span><Field label="Turns per round" className="max-w-[180px]"><Input aria-label={`Turns per round for ${s.name}`} type="number" min="1" max={100} step="1" value={slotsFor(s)} onChange={e=>setBookingSlots({...bookingSlots,[s.id]:e.target.value})}/></Field></div>)}
        <p className="mt-3 text-xs text-muted-foreground">Availability is checked across the full date range when saved. Paused and pending campaigns retain their booking; drafts do not reserve inventory. Group selection takes a snapshot and does not add future screens automatically.</p>

      </Card>

      <Card className="mb-4 p-5">
        <h3 className="mb-3 text-[14px] font-semibold">4 · Creatives</h3>
        <Label>Add a new one — paste a YouTube URL</Label>
        <div className="mb-1 flex flex-wrap gap-2">
          <Input className="min-w-[220px] flex-[3]" placeholder="https://youtube.com/watch?v=…" value={yt.url} onChange={e => setYt({ ...yt, url: e.target.value })} />
          <Input className="min-w-[140px] flex-[2]" placeholder="Creative name" value={yt.name} onChange={e => setYt({ ...yt, name: e.target.value })} />
          <Input className="w-[90px] flex-none" type="number" value={yt.dur} onChange={e => setYt({ ...yt, dur: e.target.value })} />
          <Button variant="outline" onClick={addCreative}>Add</Button>
        </div>
        {ytErr && <p className="mb-2 text-[12.5px] text-destructive">{ytErr}</p>}
        <Label className="mt-4">Use existing</Label>
        {pool.length ? (
          <div className="flex flex-col gap-1.5">
            {pool.map((c: any) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2.5 text-[13px]">
                <input type="checkbox" checked={creatives.includes(c.id)} onChange={() => tick(creatives, c.id, setCreatives)} />
                <span>{c.name} <span className="font-mono text-[11.5px] text-muted-foreground">· {c.duration_s}s</span></span>
                {c.approval_status !== 'approved' && <Badge variant="warn">{c.approval_status}</Badge>}
              </label>
            ))}
          </div>
        ) : <p className="text-[13px] text-muted-foreground">No creatives yet for this advertiser — add one above.</p>}
        <p className="mt-3 text-[12.5px] text-muted-foreground">New creatives start as <em>pending</em> and must be approved before they play.</p>
      </Card>

      <div className="flex items-center gap-3">
        <Field label="Initial status" className="max-w-[220px]"><Select value={status} onChange={e=>setStatus(e.target.value)}><option value="pending">Pending — reserve capacity</option><option value="draft">Draft — no reservation</option><option value="active">Active — approved creatives play</option></Select></Field><Button onClick={save} disabled={saving||!selectedOrg||(network&&!networkInventory)}>{saving?'Creating…':'Create campaign'}</Button>
        <Button variant="outline" onClick={() => onGo('campaigns')}>Cancel</Button>
        {err && <span className="text-[12.5px] text-destructive">{err}</span>}
      </div>
    </>
  );
}
