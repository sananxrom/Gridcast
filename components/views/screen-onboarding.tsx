'use client';
import React, { useState } from 'react';
import { api } from '@/lib/client';
import { reverseCalculate, validateScreenInput, physicalCapacity, defaultSlotsPerLoop } from '@/lib/inventory';
import { inr } from '@/lib/utils';
import { PageHead } from '@/components/ui/app-shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Field } from '@/components/ui/input';

export function PairingCode({ pairing, onClose }: { pairing: {code:string;expires_at:string}; onClose:()=>void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" role="dialog" aria-modal="true" aria-labelledby="pairing-heading">
    <Card className="w-full max-w-md p-6">
      <h2 id="pairing-heading" className="text-lg font-semibold">Pair this screen</h2>
      <p className="mt-2 text-sm text-muted-foreground">Open the player on the screen’s device and enter this single-use code.</p>
      <p className="my-6 select-all text-center font-mono text-3xl font-semibold tracking-[.25em] text-primary">{pairing.code}</p>
      <p className="mb-4 text-sm text-muted-foreground">Expires {new Date(pairing.expires_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST. This code is shown only now. You can generate a replacement from the screen page.</p>
      <Button onClick={onClose} className="w-full" autoFocus>Done</Button>
    </Card>
  </div>;
}

export function ScreenOnboarding({ user, boot, onGo, onDone }: { user:any; boot:any; onGo:(g:string)=>void; onDone:(s:any)=>void }) {
  const mayPrice = boot.caps?.includes('sales'), mayMoney = boot.caps?.includes('money');
  const [f,setF] = useState<any>({org_id:user.org_id,name:'',venue_name:'',address:'',venue_type:'cafe',size_in:'43',orientation:'landscape',location_tier:'standard',loop_length_s:'600',slot_duration_s:'10',advertiser_slots:'10',from:'09:00',to:'21:00',owner_share_pct:'0',has_camera:false,tags:'',city:'Chandigarh',area:''});
  const [seed,setSeed] = useState(false), [r,setR] = useState({monthly_revenue:'12000',client_count:'6',fill_percent:'60'});
  const [error,setError] = useState(''), [busy,setBusy] = useState(false), [created,setCreated] = useState<any>(null), [pairing,setPairing] = useState<any>(null);
  const change = (k:string,v:any)=>setF({...f,[k]:v});
  let normalized:any=null, quote:any=null, previewError='';
  const tags=Object.fromEntries(String(f.tags).split(',').map((p:string)=>p.trim()).filter(Boolean).map((p:string)=>{const i=p.indexOf(':');return [i<0?p:p.slice(0,i).trim(),i<0?'':p.slice(i+1).trim()];}));
  try {
    // Placeholder names only permit a live price preview; submission validates actual required identity.
    normalized=validateScreenInput({...f,name:f.name||'Preview',venue_name:f.venue_name||'Preview',address:f.address||'Preview',tags,loop_length_s:Number(f.loop_length_s),slot_duration_s:Number(f.slot_duration_s),advertiser_slots:Number(f.advertiser_slots),owner_share_pct:Number(f.owner_share_pct),operating_hours:{from:f.from,to:f.to}});
    if(seed) {
      const [fh,fm]=f.from.split(':').map(Number),[th,tm]=f.to.split(':').map(Number);
      const minutes=(th*60+tm-fh*60-fm+1440)%1440||1440;
      quote=reverseCalculate({monthly_revenue:Number(r.monthly_revenue),client_count:Number(r.client_count),fill_rate:Number(r.fill_percent)/100,venue_base:normalized.venue_base,size_factor:normalized.size_factor,loop_length_s:normalized.loop_length_s,slot_duration_s:normalized.slot_duration_s,operating_hours:minutes/60});
    }
  } catch(e) { previewError=(e as Error).message; }
  const save=async()=>{
    setError(''); setBusy(true);
    try {
      const s=validateScreenInput({...normalized,name:f.name,venue_name:f.venue_name,address:f.address});
      const body:any={org_id:f.org_id,name:s.name,venue_name:s.venue_name,address:s.address,venue_type:s.venue_type,size_in:s.size_in,orientation:s.orientation,aspect:s.aspect,location_tier:s.location_tier,city:f.city,area:f.area,tags:s.tags,loop_length_s:s.loop_length_s,slot_duration_s:s.slot_duration_s,advertiser_slots:quote?.advertiser_slots??s.advertiser_slots,operating_hours:s.operating_hours,has_camera:s.has_camera};
      if(mayMoney) body.owner_share_pct=s.owner_share_pct;
      if(seed && mayPrice) {
        if(!quote) throw new Error(previewError||'Check the existing-price inputs.');
        body.rate_seed={monthly_revenue:Number(r.monthly_revenue),client_count:Number(r.client_count),fill_rate:Number(r.fill_percent)/100,operating_hours:quote.provenance.assumptions.operating_hours_per_day};
      }
      const response=await api('/screens',body), screen=response.screen??response;
      setCreated(screen);
      if(response.pairing?.code || response.code) setPairing(response.pairing??response);
      else onDone(screen);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  return <>
    <PageHead title="Add screen" back={{label:'Screens',go:'screens',onGo}} sub="Register the location and its inventory, then pair a device." />
    <Card className="mb-4 p-5"><h3 className="mb-3 font-semibold">Screen and venue</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {user.role==='platform_admin' && <Field label="Organisation"><Select value={f.org_id} onChange={e=>change('org_id',e.target.value)}>{boot.orgs.map((o:any)=><option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>}
      {[['name','Screen name'],['venue_name','Venue name'],['address','Address'],['city','City'],['area','Area / sector'],['size_in','Diagonal (inches)']].map(([k,label])=><Field key={k} label={label}><Input aria-label={label} value={f[k]} onChange={e=>change(k,e.target.value)} /></Field>)}
      <Field label="Venue type"><Select value={f.venue_type} onChange={e=>change('venue_type',e.target.value)}>{['cafe','gym','grocery','salon','mall','pharmacy'].map(v=><option key={v}>{v}</option>)}</Select></Field>
      <Field label="Orientation"><Select value={f.orientation} onChange={e=>change('orientation',e.target.value)}><option>landscape</option><option>portrait</option></Select></Field>
      <Field label="Location tier"><Select value={f.location_tier} onChange={e=>change('location_tier',e.target.value)}>{['prime','good','standard','peripheral'].map(v=><option key={v}>{v}</option>)}</Select></Field>
      <Field label="Custom tags (key:value, comma separated)"><Input value={f.tags} onChange={e=>change('tags',e.target.value)} placeholder="chain:local, floor:ground" /></Field>
    </div><label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.has_camera} onChange={e=>change('has_camera',e.target.checked)} />Camera available for presence measurement</label><p className="mt-2 text-xs text-muted-foreground">Presence stays unmeasured until the device actually reports valid samples.</p></Card>
    <Card className="mb-4 p-5"><h3 className="mb-3 font-semibold">Loop and trading hours</h3><div className="grid gap-3 sm:grid-cols-3">
      {[['loop_length_s','Loop length (seconds)'],['slot_duration_s','Base slot (seconds)'],['advertiser_slots','Distinct advertiser limit'],...(mayMoney?[['owner_share_pct','Owner share (%)']]:[])].map(([k,label])=><Field key={k} label={label}><Input type="number" value={f[k]} onChange={e=>change(k,e.target.value)} /></Field>)}
      <Field label="Opens (IST)"><Input type="time" value={f.from} onChange={e=>change('from',e.target.value)} /></Field><Field label="Closes (IST)"><Input type="time" value={f.to} onChange={e=>change('to',e.target.value)} /></Field>
    </div>{normalized && <p className="mt-3 text-sm text-muted-foreground">{physicalCapacity(normalized)} physical base slots per loop · suggested {defaultSlotsPerLoop(normalized)} appearances per advertiser. Longer creative durations consume more capacity. Matching open/close times means 24 hours.</p>}</Card>
    {mayPrice && <Card className="mb-4 p-5"><h3 className="mb-3 font-semibold">Starting price</h3><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={seed} onChange={e=>setSeed(e.target.checked)} />This screen already earns revenue — preserve its current price</label>
      {seed ? <><div className="mt-4 grid gap-3 sm:grid-cols-3">{[['monthly_revenue','Monthly revenue (₹)'],['client_count','Current clients'],['fill_percent','Current fill (%)']].map(([k,label])=><Field key={k} label={label}><Input type="number" value={(r as any)[k]} onChange={e=>setR({...r,[k]:e.target.value})} /></Field>)}</div>{quote && <div className="mt-3 text-sm"><p><b>{inr(quote.seed_slot_price_month)}</b> per advertiser / month · {quote.advertiser_slots} advertisers at full capacity.</p><p className="mt-1 text-muted-foreground">{quote.entitlement.slots_per_loop} planned appearances per loop; derived quote {inr(quote.entitlement.per_play)} per play. Uses a 30-day month and your trading hours. Revenue is self-reported; delivery is not measured or guaranteed.</p>{quote.warnings.map((w:string)=><p className="mt-2 text-warn" key={w}>{w}</p>)}</div>}</> : normalized && <p className="mt-3 text-sm">Illustrative suggested price: <b>{inr(normalized.slot_price_month)}</b> per advertiser / month. Derived from venue, screen size and estimated location/exposure factors.</p>}
    </Card>}
    {previewError && <p className="mb-3 text-sm text-destructive" role="alert">{previewError}</p>}{error && <p className="mb-3 text-sm text-destructive" role="alert">{error}</p>}
    <div className="flex gap-2"><Button onClick={save} disabled={busy||!!previewError||!!created}>{busy?'Creating…':'Create screen'}</Button><Button variant="outline" onClick={()=>onGo('screens')}>Cancel</Button></div>
    {pairing && <PairingCode pairing={pairing} onClose={()=>{setPairing(null);onDone(created);}} />}
  </>;
}
