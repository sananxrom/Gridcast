'use client';
import React, {useState} from 'react';
import {api, type SessionUser} from '@/lib/client';
import {can} from '@/lib/roles';
import {inr, ytId} from '@/lib/utils';
import {PageHead, SectionHead} from '@/components/ui/app-shell';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input, Select, Field} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {DataTable} from '@/components/ui/table';
import {Thumb, Empty} from './bits';
import {CreativeUpload} from './creative-upload';
function CreativeEditor({row,onClose,onChanged}:{row:any;onClose:()=>void;onChanged:()=>void}) {
  const [f,setF]=useState({name:row.name??'',category:row.category??'general',url:row.youtube_id??'',duration:String(row.duration_s??10)});
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const uploaded=!!row.assets?.length;
  const save=async()=>{setError('');setBusy(true);try{
    const patch:any={};
    if(f.name.trim()!==row.name)patch.name=f.name.trim();
    if(f.category.trim()!==(row.category??'general'))patch.category=f.category.trim();
    if(!uploaded){
      const id=f.url.trim()?ytId(f.url.trim()):'';
      if(f.url.trim()&&!id)throw new Error('Enter a valid YouTube URL or video ID.');
      if(row.youtube_id&&!id)throw new Error('Enter a YouTube video; the existing source cannot be removed here.');
      if(id&&id!==row.youtube_id)patch.youtube_id=id;
      if(id&&Number(f.duration)!==row.duration_s)patch.duration_s=Number(f.duration);
    }
    await api(`/creative/${row.id}`,patch);await onChanged();onClose();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <Card className="mb-4 p-5" aria-label="Edit creative"><h3 className="mb-3 font-semibold">Edit creative</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name"><Input aria-label="Edit creative name" maxLength={200} value={f.name} onChange={e=>setF({...f,name:e.target.value})}/></Field>
      <Field label="Category"><Input aria-label="Edit creative category" maxLength={200} value={f.category} onChange={e=>setF({...f,category:e.target.value})}/></Field>
      {!uploaded&&<><Field label="YouTube URL or video ID"><Input aria-label="Edit creative video" value={f.url} onChange={e=>setF({...f,url:e.target.value})}/></Field><Field label="Expected seconds"><Input aria-label="Edit creative duration" type="number" min="0.001" max="86400" step="any" value={f.duration} onChange={e=>setF({...f,duration:e.target.value})}/></Field></>}
    </div>
    <p className="mt-3 text-sm text-muted-foreground">Category or video changes require platform approval again and pause new delivery of this creative until approved. Renaming keeps its approval.</p>
    {uploaded&&<p className="mt-2 text-sm text-muted-foreground">Video dimensions and duration come from the uploaded file. Use Upload video on the row to add a variation.</p>}
    {error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <div className="mt-3 flex gap-2"><Button disabled={busy||!f.name.trim()||!f.category.trim()} onClick={save}>{busy?'Saving…':'Save creative'}</Button><Button disabled={busy} variant="outline" onClick={onClose}>Cancel</Button></div>
  </Card>;
}
export function Creatives({ d, user, orgId, onChanged }: { d: any; user: SessionUser; orgId: string | null; onChanged: () => void }) {
  const advName = (id:string) => d.advertisers.find((a:any)=>a.id===id)?.name ?? id;
  const organisation = orgId ?? '';
  const [editing,setEditing]=useState<any>(null);
  const advertisers = d.advertisers.filter((a:any)=>a.org_id===organisation && a.status!=='archived');
  const [f, setF] = useState({ adv: advertisers[0]?.id ?? '', url: '', name: '', dur: '10', source: 'upload', category: 'general' });
  const [err, setErr] = useState(''), [busy,setBusy] = useState(false);
  const add = async () => {
    setErr('');setBusy(true);
    try {
      if(!organisation) throw new Error('Select an organisation before creating a creative.');
      if(!advertisers.some((a:any)=>a.id===f.adv)) throw new Error('Create or select an advertiser first.');
      if(!f.name.trim()) throw new Error('Enter a creative name.');
      let media:any={};
      if(f.source==='youtube') {
        const id=ytId(f.url); if(!id)throw new Error('Not a YouTube URL or video ID.');
        const duration=Number(f.dur);if(!Number.isFinite(duration)||duration<=0)throw new Error('Enter a positive duration.');
        media={youtube_id:id,duration_s:duration,aspect:'16:9'};
      }
      await api('/creative', { org_id: organisation, advertiser_id: f.adv, name: f.name.trim(), category: f.category.trim()||'general', ...media });
      setF({ ...f, url: '', name: '' }); onChanged();
    }catch(e){setErr((e as Error).message);}finally{setBusy(false);}
  };
  return (<>
    <PageHead title="Creatives" sub="Upload video variations or add a YouTube source. Each creative requires platform approval." />
    <Card className="mb-4 p-5">
      {!organisation && <p className="mb-3 text-sm">Select an organisation above to create a creative.</p>}
      <div className="flex flex-wrap gap-3">
        <Field label="Advertiser"><Select aria-label="Creative advertiser" value={f.adv} onChange={e => setF({ ...f, adv: e.target.value })}>
          <option value="">Choose advertiser…</option>{advertisers.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select></Field>
        <Field label="Name"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Category"><Input value={f.category} onChange={e=>setF({...f,category:e.target.value})}/></Field>
        <Field label="Video source"><Select value={f.source} onChange={e=>setF({...f,source:e.target.value})}><option value="upload">Upload MP4 / WebM</option><option value="youtube">YouTube</option></Select></Field>
        {f.source==='youtube'&&<><Field label="YouTube URL" className="flex-[2]"><Input value={f.url} onChange={e => setF({ ...f, url: e.target.value })} placeholder="https://youtube.com/watch?v=…" /></Field><Field label="Expected seconds" className="max-w-[140px]"><Input type="number" min="1" value={f.dur} onChange={e => setF({ ...f, dur: e.target.value })} /></Field></>}
      </div>
      {f.source==='upload'&&<p className="mt-3 text-sm text-muted-foreground">Create the creative, then choose “Upload video” on its row below. You can attach landscape and portrait variations to the same creative.</p>}
      {f.source==='youtube'&&<p className="mt-3 text-xs text-muted-foreground">The entered duration is self-reported. Upload a file for server-verified dimensions and duration.</p>}
      <div className="mt-3 flex items-center gap-3"><Button onClick={add} disabled={busy||!organisation}>{busy?'Creating…':'Add creative'}</Button>{err && <span role="alert" className="text-[12.5px] text-destructive">{err}</span>}</div>
    </Card>
    {editing&&<CreativeEditor key={editing.id} row={editing} onClose={()=>setEditing(null)} onChanged={onChanged}/>}
    <DataTable cols={[
      { label: 'Creative', render: (c: any) => <div className="flex items-center gap-3"><Thumb id={c.youtube_id} w={76} /><div><div className="font-medium">{c.name}</div><div className="text-[12px] text-muted-foreground">{advName(c.advertiser_id)}</div></div></div> },
      { label: 'Organisation', render: (c:any) => d.orgs?.find((o:any)=>o.id===c.org_id)?.name ?? c.org_id },
      { label: 'Aspect', render: (c:any) => c.assets?.length ? c.assets.map((a:any)=>`${a.width} × ${a.height}`).join(' / ') : c.aspect ?? '—' },
      { label: 'Source', render: (c: any) => <span className="text-[12px] text-muted-foreground">{c.assets?.length?`${c.assets.length} uploaded variation${c.assets.length===1?'':'s'}`:c.youtube_id?'YouTube':'Awaiting upload'}</span> },
      { label: 'Length', num: true, render: (c: any) => c.assets?.length?<span className="text-xs">{c.assets.map((a:any)=>`${a.duration_s ?? (a.duration_ms/1000)}s`).join(' / ')}</span>:c.duration_s?`${c.duration_s}s (reported)`:'—' },
      { label: 'Approval', render: (c: any) => <Badge variant={c.approval_status === 'approved' ? 'ok' : c.approval_status === 'rejected' ? 'destructive' : 'warn'}>{c.approval_status}</Badge> },
      { label: 'Edit', render: (c:any) => can(user.role,'sales')&&(user.role==='platform_admin'||c.org_id===user.org_id)?<Button size="sm" variant="outline" aria-label={`Edit creative ${c.name}`} onClick={()=>setEditing(c)}>Edit</Button>:null },
      { label: 'Video', render: (c:any) => (user.role==='platform_admin'||c.org_id===user.org_id)?<CreativeUpload creativeId={c.id} onUploaded={()=>onChanged()}/>:<span className="text-xs text-muted-foreground">Managed by originating organisation</span> },
      { label: 'Review', render: (c:any) => user.role==='platform_admin' ? <div className="flex gap-2">{['approved','rejected'].map(status=><Button key={status} size="sm" variant="outline" disabled={busy||c.approval_status===status} onClick={async()=>{setBusy(true);setErr('');try{await api(`/creative/${c.id}/approve`,{status});await onChanged();}catch(e){setErr((e as Error).message);}finally{setBusy(false);}}}>{status==='approved'?'Approve':'Reject'}</Button>)}</div> : <span className="text-[12px] text-muted-foreground">Reviewed by Gridcast</span> },
    ]} rows={d.creatives} rowId={(c: any) => c.id} exportName="creatives" />
  </>);
}

type CommercialProps = {d:any; user:SessionUser; orgId:string|null; onGo:(g:string)=>void; onChanged:()=>void};
function AdvertiserForm({row,orgId,onDone}:{row?:any;orgId:string;onDone:(row?:any)=>void}) {
  const [f,setF]=useState({name:row?.name??'',contact:row?.contact??'',email:row?.email??'',phone:row?.phone??'',category:row?.category??'general',notes:row?.notes??''});
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const save=async()=>{setError('');setBusy(true);try{if(!orgId)throw new Error('Select an organisation first.');if(!f.name.trim())throw new Error('Enter an advertiser name.');const result=await api(row?`/advertiser/${row.id}`:'/advertiser',row?f:{...f,org_id:orgId});onDone(result);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <Card className="mb-4 p-5"><h3 className="mb-3 font-semibold">{row?'Edit advertiser':'New advertiser'}</h3><div className="grid gap-3 sm:grid-cols-2">{Object.entries(f).map(([k,v])=><Field key={k} label={k[0].toUpperCase()+k.slice(1)}><Input aria-label={`Advertiser ${k}`} value={v} onChange={e=>setF({...f,[k]:e.target.value})}/></Field>)}</div><p className="mt-3 text-xs text-muted-foreground">This creates a business record. A sign-in is optional and can be added from Team &amp; users.</p>{error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}<div className="mt-3 flex gap-2"><Button onClick={save} disabled={busy}>{busy?'Saving…':'Save advertiser'}</Button><Button variant="outline" disabled={busy} onClick={()=>onDone()}>Cancel</Button></div></Card>;
}
export function Advertisers({d,user,orgId,onGo,onChanged}:CommercialProps) {
  const [adding,setAdding]=useState(false);
  const orgName=(id:string)=>d.orgs?.find((o:any)=>o.id===id)?.name??id;
  return <><PageHead title="Advertisers" sub="Client records and their campaigns. Archived clients remain in history." actions={<Button disabled={!orgId} onClick={()=>setAdding(true)}>Add advertiser</Button>}/>
    {!orgId&&<p className="mb-4 text-sm text-muted-foreground">Select an organisation above to create an advertiser.</p>}
    {adding&&orgId&&<AdvertiserForm orgId={orgId} onDone={async(a)=>{setAdding(false);await onChanged();if(a)onGo('a/'+a.id);}}/>}
    <DataTable rows={d.advertisers} rowId={(a:any)=>a.id} exportName="advertisers" search={(a:any)=>`${a.name} ${a.contact} ${a.category} ${orgName(a.org_id)}`} facets={[{label:'Status',get:(a:any)=>a.status??'active'}]} cols={[
      {label:'Advertiser',render:(a:any)=><button className="font-medium text-primary hover:underline" onClick={()=>onGo('a/'+a.id)}>{a.name}</button>},
      {label:'Organisation',render:(a:any)=>orgName(a.org_id)},
      {label:'Contact',render:(a:any)=><>{a.contact}<br/>{a.email}<br/>{a.phone}</>},
      {label:'Campaigns',num:true,render:(a:any)=>d.campaigns.filter((c:any)=>c.advertiser_id===a.id).length},
      {label:'Accrued spend',num:true,render:(a:any)=>inr(d.campaigns.filter((c:any)=>c.advertiser_id===a.id).reduce((sum:number,c:any)=>sum+c.accrued_spend,0))},
      {label:'Status',render:(a:any)=><Badge variant={a.status==='archived'?'muted':'ok'}>{a.status??'active'}</Badge>},
    ]} empty="No advertisers yet. Create a client record to begin."/>
    {user.role!=='platform_admin'&&<p className="mt-3 text-xs text-muted-foreground">Network advertisers shown here belong to the originating organisation. You can manage your own clients.</p>}
  </>;
}
export function AdvertiserDetail({id,d,user,onGo,onChanged}:CommercialProps&{id:string}) {
  const a=d.advertisers.find((a:any)=>a.id===id);
  const [editing,setEditing]=useState(false),[confirm,setConfirm]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  if(!a)return <Empty>Advertiser not found in this organisation. Return to the advertiser list.</Empty>;
  const canEdit=user.role==='platform_admin'||a.org_id===user.org_id;
  const campaigns=d.campaigns.filter((c:any)=>c.advertiser_id===id);
  const archive=async()=>{setError('');setBusy(true);try{await api(`/advertiser/${id}/${a.status==='archived'?'restore':'archive'}`,{});setConfirm(false);await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <><PageHead title={a.name} sub={`${d.orgs?.find((o:any)=>o.id===a.org_id)?.name??a.org_id} · ${a.status??'active'}`} back={{label:'Advertisers',go:'advertisers',onGo}} actions={canEdit?<div className="flex gap-2"><Button variant="outline" onClick={()=>setEditing(true)}>Edit advertiser</Button><Button variant="outline" onClick={()=>setConfirm(true)}>{a.status==='archived'?'Restore advertiser':'Archive advertiser'}</Button></div>:undefined}/>
    {editing&&<AdvertiserForm row={a} orgId={a.org_id} onDone={async()=>{setEditing(false);await onChanged();}}/>}
    {confirm&&<Card className="mb-4 p-4"><p className="mb-3 text-sm">{a.status==='archived'?'Restore this advertiser so new campaigns can be created?':'Archive this advertiser? History is retained. Active, pending and paused campaigns must be completed or moved to draft first.'}</p><Button disabled={busy} onClick={archive}>Confirm {a.status==='archived'?'restore':'archive'}</Button><Button variant="ghost" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</Button></Card>}
    {error&&<p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    <Card className="p-4 text-sm"><p>{a.contact||'No contact'} · {a.email||'No email'} · {a.phone||'No phone'}</p><p className="mt-2">{a.category}</p>{a.notes&&<p className="mt-2 whitespace-pre-wrap">{a.notes}</p>}</Card>
    <SectionHead>Campaigns</SectionHead><DataTable rows={campaigns} rowId={(c:any)=>c.id} cols={[
      {label:'Campaign',render:(c:any)=><button className="font-medium text-primary hover:underline" onClick={()=>onGo('c/'+c.id)}>{c.name}</button>},
      {label:'Status',render:(c:any)=><Badge variant="muted">{c.status}</Badge>},
      {label:'Dates',render:(c:any)=>`${c.starts_at} → ${c.ends_at}`},
      {label:'Accrued',num:true,render:(c:any)=>inr(c.accrued_spend)},
      {label:'Budget',num:true,render:(c:any)=>inr(c.committed_budget)},
    ]} empty="No campaigns for this advertiser."/>
  </>;
}
