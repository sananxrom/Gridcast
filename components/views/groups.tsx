'use client';
import React,{useState} from 'react';
import {api} from '@/lib/client';
import {groupMatches} from '@/lib/inventory';
import {PageHead} from '@/components/ui/app-shell';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input,Select,Field} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';

export function GroupManager({boot,user,onChanged}:{boot:any;user:any;onChanged:()=>void}) {
  const mayEdit=boot.caps?.includes('screens');
  const [draft,setDraft]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const open=(g?:any)=>{setError('');setDraft({id:g?.id,org_id:g?.org_id??user.org_id,name:g?.name??'',group_type:g?.group_type??'static',screen_ids:[...(g?.screen_ids??[])],venue_types:(g?.rule_json?.venue_types??[]).join(', '),min_size:g?.rule_json?.min_size??'',location_tier:g?.rule_json?.location_tier??'',city:g?.rule_json?.city??'',area:g?.rule_json?.area??'',tags:Object.entries(g?.rule_json?.tags??{}).map(([k,v])=>`${k}:${v}`).join(', ')});};
  const rule=():any=>{
    const tags:Record<string,string>={};
    for(const entry of String(draft.tags).split(',').map(x=>x.trim()).filter(Boolean)){const colon=entry.indexOf(':');if(colon<1||!entry.slice(colon+1).trim())throw new Error('Tags must use key:value pairs.');const key=entry.slice(0,colon).trim();if(['__proto__','constructor','prototype'].includes(key))throw new Error('Invalid tag key.');tags[key]=entry.slice(colon+1).trim();}
    const r:any={};const venues=String(draft.venue_types).split(',').map(x=>x.trim()).filter(Boolean);if(venues.length)r.venue_types=venues;
    if(draft.min_size!==''){const n=Number(draft.min_size);if(!Number.isFinite(n)||n<1)throw new Error('Minimum diagonal must be a positive number.');r.min_size=n;}
    for(const k of ['location_tier','city','area'])if(String(draft[k]).trim())r[k]=String(draft[k]).trim();
    if(Object.keys(tags).length)r.tags=tags;return r;
  };
  const local=boot.screens.filter((s:any)=>s.org_id===draft?.org_id);
  let matches:any[]=[],previewError='';
  if(draft)try{matches=local.filter((s:any)=>draft.group_type==='static'?draft.screen_ids.includes(s.id):groupMatches(s,rule()));}catch(e){previewError=(e as Error).message;}
  const save=async()=>{setError('');setBusy(true);try{if(!draft.name.trim())throw new Error('Enter a group name.');await api(draft.id?`/group/${draft.id}`:'/group',{org_id:draft.org_id,name:draft.name.trim(),group_type:draft.group_type,screen_ids:draft.group_type==='static'?draft.screen_ids:[],rule_json:draft.group_type==='dynamic'?rule():null});setDraft(null);await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const change=(k:string,v:any)=>setDraft({...draft,[k]:v});
  return <><PageHead title="Screen groups" sub="Reusable screen selections. Campaigns keep the screens selected when you book them." actions={mayEdit?<Button onClick={()=>open()}>Create group</Button>:undefined}/>
    {draft&&<Card className="mb-4 p-5"><h3 className="mb-3 font-semibold">{draft.id?'Edit':'Create'} group</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Name"><Input aria-label="Group name" value={draft.name} onChange={e=>change('name',e.target.value)}/></Field>
      {user.role==='platform_admin'&&<Field label="Organisation"><Select disabled={!!draft.id} value={draft.org_id} onChange={e=>setDraft({...draft,org_id:e.target.value,screen_ids:[]})}>{boot.orgs.map((o:any)=><option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>}
      <Field label="Membership"><Select value={draft.group_type} onChange={e=>change('group_type',e.target.value)}><option value="static">Hand-picked screens</option><option value="dynamic">Matching rules</option></Select></Field>
    </div>{draft.group_type==='static'?<div className="mt-4 grid gap-2 sm:grid-cols-2">{local.length?local.map((s:any)=><label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.screen_ids.includes(s.id)} onChange={e=>change('screen_ids',e.target.checked?[...draft.screen_ids,s.id]:draft.screen_ids.filter((id:string)=>id!==s.id))}/>{s.name}</label>):<p className="text-sm text-muted-foreground">Create a screen in this organisation first.</p>}</div>:<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[['venue_types','Venue types (comma separated)'],['min_size','Minimum diagonal (inches)'],['city','City'],['area','Area / sector'],['tags','Tags that must all match (key:value)']].map(([k,label])=><Field label={label} key={k}><Input value={draft[k]} onChange={e=>change(k,e.target.value)} placeholder={k==='venue_types'?'cafe, gym':k==='tags'?'chain:local, floor:ground':''}/></Field>)}
      <Field label="Location tier"><Select value={draft.location_tier} onChange={e=>change('location_tier',e.target.value)}><option value="">Any</option>{['prime','good','standard','peripheral'].map(x=><option key={x}>{x}</option>)}</Select></Field>
    </div>}
    <p className="mt-4 text-sm"><b>{matches.length}</b> screens currently match{matches.length?`: ${matches.map(s=>s.name).join(', ')}`:'.'}</p>
    <p className="mt-2 text-xs text-muted-foreground">All filled rules must match. Empty rules match every screen in this organisation. Updating a group changes future selections; existing campaign bookings do not expand automatically.</p>
    {(error||previewError)&&<p role="alert" className="mt-3 text-sm text-destructive">{error||previewError}</p>}
    <div className="mt-4 flex gap-2"><Button onClick={save} disabled={busy||!!previewError}>{busy?'Saving…':'Save group'}</Button><Button variant="outline" onClick={()=>setDraft(null)} disabled={busy}>Cancel</Button></div></Card>}
    <div className="space-y-3">{boot.groups.map((g:any)=>{const count=boot.screens.filter((s:any)=>s.org_id===g.org_id&&(g.group_type==='static'?g.screen_ids?.includes(s.id):groupMatches(s,g.rule_json||{}))).length;return <Card key={g.id} className="flex flex-wrap items-center justify-between gap-4 p-4"><div><h3 className="font-medium">{g.name}</h3><p className="mt-1 text-sm text-muted-foreground">{count} screens · {g.group_type==='dynamic'?'Matching rules':'Hand-picked'}{user.role==='platform_admin'?` · ${boot.orgs.find((o:any)=>o.id===g.org_id)?.name??''}`:''}</p></div><div className="flex items-center gap-3"><Badge variant="muted">{g.group_type}</Badge>{mayEdit&&<Button variant="outline" size="sm" onClick={()=>open(g)}>Edit group</Button>}</div></Card>;})}{!boot.groups.length&&<Card className="p-8 text-center text-sm text-muted-foreground">No screen groups yet.</Card>}</div>
  </>;
}
