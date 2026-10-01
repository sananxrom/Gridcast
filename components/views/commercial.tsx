'use client';
import React, {useEffect, useState} from 'react';
import {api, type SessionUser} from '@/lib/client';
import {can} from '@/lib/roles';
import {inr, ytId} from '@/lib/utils';
import {PageHead} from '@/components/ui/app-shell';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input, Select, Field} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {DataTable} from '@/components/ui/table';
import {Thumb, Empty} from './bits';
import {CreativeUpload} from './creative-upload';
import {AdvertiserWorkspace} from './advertiser-workspace';
function CreativeEditor({row,onClose,onChanged}:{row:any;onClose:()=>void;onChanged:()=>void}) {
  type Source = 'youtube'|'video'|'image';
  const hasAssets=Array.isArray(row.assets)&&row.assets.length>0;
  const currentSource:Source=row.media_type==='image'?'image':hasAssets?'video':row.youtube_id&&row.purpose!=='filler'?'youtube':'video';
  const [f,setF]=useState<{name:string;category:string;source:Source;url:string;youtubeDuration:string;imageDuration:string}>({
    name:row.name??'',category:row.category??'general',source:currentSource,url:currentSource==='youtube'?row.youtube_id??'':'',
    youtubeDuration:String(currentSource==='youtube'?row.duration_s??10:10),imageDuration:String(row.media_type==='image'?row.duration_s??20:20),
  });
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[fileSelected,setFileSelected]=useState(false);
  const hasCurrentMedia=hasAssets||!!row.youtube_id;
  const pendingUploadSwitch=f.source!=='youtube'&&f.source!==currentSource;
  const uploadMetadata={...(f.name.trim()!==row.name?{name:f.name.trim()}:{}),...(f.category.trim()!==(row.category??'general')?{category:f.category.trim()}:{})};
  const save=async()=>{setError('');setBusy(true);try{
    const patch:any={};
    if(f.name.trim()!==row.name)patch.name=f.name.trim();
    if(f.category.trim()!==(row.category??'general'))patch.category=f.category.trim();
    if(f.source==='youtube') {
      if(row.purpose==='filler')throw new Error('Filler must use uploaded media.');
      const id=f.url.trim()?ytId(f.url.trim()):'';
      const duration=Number(f.youtubeDuration);
      const youtubeChanged=currentSource!=='youtube'||id!==row.youtube_id||duration!==Number(row.duration_s??10);
      if(youtubeChanged) {
        if(!id)throw new Error('Enter a valid YouTube URL or video ID.');
        if(!Number.isFinite(duration)||duration<=0||duration>86400)throw new Error('Enter an expected video duration greater than zero.');
        patch.source='youtube';patch.youtube_id=id;patch.duration_s=duration;
      }
    } else if(currentSource==='image'&&f.source==='image'&&Number(f.imageDuration)!==row.duration_s) {
      const duration=Number(f.imageDuration);
      if(!Number.isFinite(duration)||duration<1||duration>600)throw new Error('Image display time must be between 1 and 600 seconds.');
      patch.duration_s=duration;
    }
    await api(`/creative/${row.id}`,patch);await onChanged();onClose();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const image=f.source==='image';
  return <Card className="mb-4 p-5" aria-label="Edit creative"><h3 className="mb-3 font-semibold">Edit creative</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name"><Input disabled={uploading||busy} aria-label="Edit creative name" maxLength={200} value={f.name} onChange={e=>setF({...f,name:e.target.value})}/></Field>
      <Field label="Category"><Input disabled={uploading||busy} aria-label="Edit creative category" maxLength={200} value={f.category} onChange={e=>setF({...f,category:e.target.value})}/></Field>
      <Field label="Media source"><Select disabled={uploading||busy} aria-label="Edit creative source" value={f.source} onChange={e=>{setFileSelected(false);setF({...f,source:e.target.value as Source});}}>
        <option value="video">Upload video · MP4 / WebM</option><option value="image">Upload image · PNG / JPEG / WebP</option>
        {row.purpose!=='filler'&&<option value="youtube">YouTube · online only</option>}
      </Select></Field>
      {f.source==='youtube'&&<>
        <Field label="YouTube URL or video ID"><Input disabled={uploading||busy} aria-label="Edit creative video" value={f.url} onChange={e=>setF({...f,url:e.target.value})}/></Field>
        <Field label="Expected seconds"><Input disabled={uploading||busy} aria-label="Edit creative duration" type="number" min="0.001" max="86400" step="any" value={f.youtubeDuration} onChange={e=>setF({...f,youtubeDuration:e.target.value})}/></Field>
      </>}
      {image&&<Field label="Display seconds"><Input disabled={uploading||busy} aria-label="Edit creative duration" type="number" min="1" max="600" step="0.1" value={f.imageDuration} onChange={e=>setF({...f,imageDuration:e.target.value})}/></Field>}
    </div>
    {f.source==='youtube'
      ? <p className="mt-3 text-sm text-muted-foreground">YouTube duration is self-reported. Saving this source replaces active uploaded media; the new source returns to platform review.</p>
      : <div className="mt-3 space-y-2">
        {pendingUploadSwitch&&<p role="note" className="text-sm text-muted-foreground">Upload a {image?'still image':'video'} to finish switching sources. The current source stays active until the file verifies.</p>}
        {image&&<p className="text-sm text-muted-foreground">Image dimensions are verified from the file. Display time is set above (default 20 seconds).</p>}
        {f.source==='video'&&hasAssets&&<p className="text-sm text-muted-foreground">Uploaded video dimensions and duration are verified from the file and cannot be edited here.</p>}
        <p className="text-sm text-muted-foreground">{hasCurrentMedia?'The current source remains active unless a replacement upload verifies successfully. A successful upload replaces all active media versions.':'Upload a verified media file. It will need platform approval before it can play.'}</p>
        <CreativeUpload key={`${row.id}:${f.source}`} creativeId={row.id} mediaType={image?'image':'video'} defaultOpen replaceMode="replace_all"
          imageDuration={Number(f.imageDuration)} metadata={uploadMetadata} operationLabel={hasCurrentMedia?'Save changes & replace active media':'Save changes & upload media'}
          disabled={busy} onFileSelected={setFileSelected} onBusyChange={setUploading} onUploaded={()=>{onClose();void Promise.resolve(onChanged()).catch(()=>undefined);}} onClose={onClose}/>
      </div>}
    <p className="mt-3 text-sm text-muted-foreground">Category, source and display-time changes require platform approval again. Renaming alone keeps approval. Uploads are checked before replacing the active source.</p>
    {error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <div className="mt-3 flex gap-2"><Button disabled={busy||uploading||fileSelected||pendingUploadSwitch||!f.name.trim()||!f.category.trim()} onClick={save}>{busy?'Saving…':'Save creative'}</Button><Button disabled={busy||uploading} variant="outline" onClick={onClose}>Cancel</Button></div>
  </Card>;
}
export function Creatives({ d, user, orgId, onChanged }: { d: any; user: SessionUser; orgId: string | null; onChanged: () => void }) {
  const advName = (id:string) => d.advertisers.find((a:any)=>a.id===id)?.name ?? id;
  const organisation = orgId ?? '';
  const [editing,setEditing]=useState<any>(null);
  const advertisers = d.advertisers.filter((a:any)=>a.org_id===organisation && a.status!=='archived');
  const [f, setF] = useState({ adv: advertisers[0]?.id ?? '', url: '', name: '', dur: '10', source: 'upload', category: 'general', purpose:'paid' });
  const [err, setErr] = useState(''), [busy,setBusy] = useState(false);
  const add = async () => {
    setErr('');setBusy(true);
    try {
      if(!organisation) throw new Error('Select an organisation before creating a creative.');
      if(f.purpose==='paid'&&!advertisers.some((a:any)=>a.id===f.adv)) throw new Error('Create or select an advertiser first.');
      if(!f.name.trim()) throw new Error('Enter a creative name.');
      let media:any={media_type:f.source==='image'?'image':'video'};
      if(f.source==='image') {
        const duration=Number(f.dur);if(!Number.isFinite(duration)||duration<1||duration>600)throw new Error('Image display time must be between 1 and 600 seconds.');
        media.duration_s=duration;
      }
      if(f.source==='youtube') {
        const id=ytId(f.url); if(!id)throw new Error('Not a YouTube URL or video ID.');
        const duration=Number(f.dur);if(!Number.isFinite(duration)||duration<=0)throw new Error('Enter a positive duration.');
        media={media_type:'video',youtube_id:id,duration_s:duration,aspect:'16:9'};
      }
      await api('/creative', { org_id: organisation, purpose:f.purpose, ...(f.purpose==='paid'?{advertiser_id:f.adv}:{}), name: f.name.trim(), category: f.category.trim()||'general', ...media });
      setF({ ...f, url: '', name: '' }); onChanged();
    }catch(e){setErr((e as Error).message);}finally{setBusy(false);}
  };
  return (<>
    <PageHead title="Creatives" sub="Upload videos or still images, or add a YouTube source. Paid ads and fallback content require platform approval." />
    <Card className="mb-4 p-5">
      {!organisation && <p className="mb-3 text-sm">Select an organisation above to create a creative.</p>}
      <div className="flex flex-wrap gap-3">
        <Field label="Purpose"><Select aria-label="Creative purpose" value={f.purpose} onChange={e=>setF({...f,purpose:e.target.value,...(e.target.value==='filler'&&f.source==='youtube'?{source:'upload'}:{})})}><option value="paid">Paid advertisement</option><option value="filler">Filler — no advertiser charge</option></Select></Field>
        {f.purpose==='paid'&&<Field label="Advertiser"><Select aria-label="Creative advertiser" value={f.adv} onChange={e => setF({ ...f, adv: e.target.value })}>
          <option value="">Choose advertiser…</option>{advertisers.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select></Field>}
        <Field label="Name"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Category"><Input value={f.category} onChange={e=>setF({...f,category:e.target.value})}/></Field>
        <Field label="Media source"><Select aria-label="Creative media source" value={f.source} onChange={e=>setF({...f,source:e.target.value,dur:e.target.value==='image'?'20':'10'})}><option value="upload">Upload video · MP4 / WebM</option><option value="image">Upload image · PNG / JPEG / WebP</option>{f.purpose!=='filler'&&<option value="youtube">YouTube · online only</option>}</Select></Field>
        {f.source==='image'&&<Field label="Display seconds"><Input aria-label="Image display seconds" type="number" min="1" max="600" step="0.1" value={f.dur} onChange={e=>setF({...f,dur:e.target.value})}/></Field>}
        {f.source==='youtube'&&<><Field label="YouTube URL" className="flex-[2]"><Input value={f.url} onChange={e => setF({ ...f, url: e.target.value })} placeholder="https://youtube.com/watch?v=…" /></Field><Field label="Expected seconds" className="max-w-[140px]"><Input type="number" min="1" value={f.dur} onChange={e => setF({ ...f, dur: e.target.value })} /></Field></>}
      </div>
      {f.purpose==='filler'&&<p className="mt-3 text-sm text-muted-foreground">Filler plays on this organisation’s screens when no eligible paid ad is available. It creates no advertiser charges.</p>}
      {f.source==='image'&&<p className="mt-3 text-sm text-muted-foreground">Create the creative, then choose “Upload image” on its row. Default display time is 20 seconds and starts after the image becomes visible.</p>}
      {f.source==='upload'&&<p className="mt-3 text-sm text-muted-foreground">Create the creative, then choose “Upload video” on its row below. You can attach landscape and portrait variations to the same creative.</p>}
      {f.source==='youtube'&&<p className="mt-3 text-xs text-muted-foreground">The entered duration is self-reported. Upload a file for server-verified dimensions and duration.</p>}
      <div className="mt-3 flex items-center gap-3"><Button onClick={add} disabled={busy||!organisation}>{busy?'Creating…':'Add creative'}</Button>{err && <span role="alert" className="text-[12.5px] text-destructive">{err}</span>}</div>
    </Card>
    {editing&&<CreativeEditor key={editing.id} row={editing} onClose={()=>setEditing(null)} onChanged={onChanged}/>}
    <DataTable cols={[
      { label: 'Creative', render: (c: any) => <div className="flex items-center gap-3"><Thumb id={c.youtube_id} w={76} /><div><div className="font-medium">{c.name}</div><div className="text-[12px] text-muted-foreground">{c.purpose==='filler'?'Filler · no advertiser':advName(c.advertiser_id)}</div></div></div> },
      { label: 'Organisation', render: (c:any) => d.orgs?.find((o:any)=>o.id===c.org_id)?.name ?? c.org_id },
      { label: 'Purpose', render: (c:any) => <Badge variant="muted">{c.purpose==='filler'?'Filler':'Paid ad'}</Badge> },
      { label: 'Aspect', render: (c:any) => c.assets?.length ? c.assets.map((a:any)=>`${a.width} × ${a.height}`).join(' / ') : c.aspect ?? '—' },
      { label: 'Source', render: (c: any) => <span className="text-[12px] text-muted-foreground">{c.assets?.length?`${c.media_type==='image'?'Image':'Video'} · ${c.assets.length} uploaded variation${c.assets.length===1?'':'s'}`:c.youtube_id?'YouTube':'Awaiting upload'}</span> },
      { label: 'Length', num: true, render: (c: any) => c.media_type==='image'?`${c.duration_s??20}s display`:c.assets?.length?<span className="text-xs">{c.assets.map((a:any)=>`${a.duration_s ?? (a.duration_ms/1000)}s`).join(' / ')}</span>:c.duration_s?`${c.duration_s}s (reported)`:'—' },
      { label: 'Approval', render: (c: any) => <Badge variant={c.approval_status === 'approved' ? 'ok' : c.approval_status === 'rejected' ? 'destructive' : 'warn'}>{c.approval_status}</Badge> },
      { label: 'Edit', render: (c:any) => can(user.role,'sales')&&(user.role==='platform_admin'||c.org_id===user.org_id)?<Button size="sm" variant="outline" aria-label={`Edit creative ${c.name}`} onClick={()=>setEditing(c)}>Edit</Button>:null },
      { label: 'Media', render: (c:any) => (user.role==='platform_admin'||c.org_id===user.org_id)?<CreativeUpload creativeId={c.id} mediaType={c.media_type==='image'?'image':'video'} imageDuration={c.duration_s} replaceMode={c.youtube_id&&!c.assets?.length?'replace_all':'append'} operationLabel={c.youtube_id&&!c.assets?.length?'Replace active media':c.assets?.length?'Add variation':'Upload media'} onUploaded={()=>onChanged()}/>:<span className="text-xs text-muted-foreground">Managed by originating organisation</span> },
      { label: 'Review', render: (c:any) => user.role==='platform_admin' ? <div className="flex gap-2">{['approved','rejected'].map(status=><Button key={status} size="sm" variant="outline" disabled={busy||c.approval_status===status} onClick={async()=>{setBusy(true);setErr('');try{await api(`/creative/${c.id}/approve`,{status});await onChanged();}catch(e){setErr((e as Error).message);}finally{setBusy(false);}}}>{status==='approved'?'Approve':'Reject'}</Button>)}</div> : <span className="text-[12px] text-muted-foreground">Reviewed by Gridcast</span> },
    ]} rows={d.creatives} facets={[{label:'Purpose',get:(c:any)=>c.purpose==='filler'?'Filler':'Paid ad'},{label:'Media',get:(c:any)=>c.media_type==='image'?'Image':'Video'}]} rowId={(c: any) => c.id} exportName="creatives" />
  </>);
}

type CommercialProps = {d:any; user:SessionUser; orgId:string|null; onGo:(g:string)=>void; onChanged:()=>void};
function AdvertiserForm({row,orgId,d,user,onDone}:{row?:any;orgId:string;d:any;user:SessionUser;onDone:(row?:any)=>void}) {
  const [f,setF]=useState({name:row?.name??'',contact:row?.contact??'',email:row?.email??'',phone:row?.phone??'',category:row?.category??'general',notes:row?.notes??''});
  const [venues,setVenues]=useState((row?.exclusions?.venue_types??[]).join(', '));
  const [excludedScreens,setExcludedScreens]=useState<string[]>(row?.exclusions?.screens??[]);
  const [tagRules,setTagRules]=useState((row?.exclusions?.tag_rules??[]).map((rule:any)=>Object.entries(rule).map(([k,v])=>`${k}:${v}`).join(', ')).join('\n'));
  const [screenOptions,setScreenOptions]=useState<any[]>(d.screens??[]);
  const [inventoryError,setInventoryError]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const networkOrigin=user.role==='platform_admin'&&d.orgs?.some((o:any)=>o.id===orgId&&o.type==='gridcast');
  useEffect(()=>{
    let current=true;
    if(networkOrigin)api(`/network-inventory?org=${encodeURIComponent(orgId)}`).then(x=>{if(current)setScreenOptions(x.screens??[]);}).catch(e=>{if(current)setInventoryError(e.message);});
    return ()=>{current=false;};
  },[networkOrigin,orgId]);
  const save=async()=>{setError('');setBusy(true);try{
    if(!orgId)throw new Error('Select an organisation first.');if(!f.name.trim())throw new Error('Enter an advertiser name.');
    const rules=tagRules.split('\n').map((line:string)=>line.trim()).filter(Boolean).map((line:string)=>{
      const rule:Record<string,string>=Object.create(null);
      for(const pair of line.split(',')){const at=pair.indexOf(':');const key=pair.slice(0,at).trim(),value=pair.slice(at+1).trim();if(at<1||!key||!value||['__proto__','prototype','constructor'].includes(key)||Object.hasOwn(rule,key))throw new Error('Use key:value for each tag, with no repeated keys on a line.');rule[key]=value;}
      return rule;
    });
    const payload={...f,exclusions:{venue_types:Array.from(new Set(venues.split(',').map((v:string)=>v.trim()).filter(Boolean))),screens:excludedScreens,tag_rules:rules}};
    const result=await api(row?`/advertiser/${row.id}`:'/advertiser',row?payload:{...payload,org_id:orgId});onDone(result);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const visibleScreens=[...screenOptions,...excludedScreens.filter(id=>!screenOptions.some((s:any)=>s.id===id)).map(id=>({id,name:`Previously excluded screen (${id})`}))];
  return <Card className="mb-4 p-5"><h3 className="mb-3 font-semibold">{row?'Edit advertiser':'New advertiser'}</h3>
    <div className="grid gap-3 sm:grid-cols-2">{Object.entries(f).map(([k,v])=><Field key={k} label={k[0].toUpperCase()+k.slice(1)}><Input aria-label={`Advertiser ${k}`} value={v} onChange={e=>setF({...f,[k]:e.target.value})}/></Field>)}</div>
    <h4 className="mb-2 mt-5 text-sm font-semibold">Where this advertiser must not play</h4>
    <p className="mb-3 text-xs text-muted-foreground">Any matching exclusion prevents delivery, including campaigns already scheduled. A screen’s own restrictions always apply too.</p>
    <Field label="Excluded venue types"><Input aria-label="Excluded venue types" value={venues} onChange={e=>setVenues(e.target.value)} placeholder="cafe, gym"/></Field>
    <p className="mb-3 mt-1 text-xs text-muted-foreground">Separate venue types with commas. Leave blank to allow all venue types.</p>
    <Field label="Excluded screens"><div className="max-h-44 overflow-y-auto rounded-md border border-border p-3">{visibleScreens.length?visibleScreens.map((screen:any)=><label key={screen.id} className="mb-2 flex items-center gap-2 text-sm last:mb-0"><input type="checkbox" aria-label={`Exclude screen ${screen.name}`} checked={excludedScreens.includes(screen.id)} onChange={e=>setExcludedScreens(e.target.checked?[...excludedScreens,screen.id]:excludedScreens.filter(id=>id!==screen.id))}/>{screen.name}<span className="text-xs text-muted-foreground">{screen.venue_type}</span></label>):<span className="text-sm text-muted-foreground">No screens available.</span>}</div></Field>
    {inventoryError&&<p className="mt-2 text-xs text-destructive">Could not load network screens: {inventoryError}. Existing exclusions are preserved.</p>}
    <div className="mt-3"><Field label="Excluded tag combinations"><textarea aria-label="Excluded tag combinations" rows={3} className="w-full rounded-md border border-input bg-card p-2 text-sm" value={tagRules} onChange={e=>setTagRules(e.target.value)} placeholder={'chain:example, floor:ground\narea:restricted'}/></Field><p className="mt-1 text-xs text-muted-foreground">One rule per line. All key:value pairs on a line must match; any matching line excludes the screen.</p></div>
    <p className="mt-3 text-xs text-muted-foreground">This is a business record. A sign-in is optional and can be added from Team &amp; users.</p>{error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}<div className="mt-3 flex gap-2"><Button onClick={save} disabled={busy}>{busy?'Saving…':'Save advertiser'}</Button><Button variant="outline" disabled={busy} onClick={()=>onDone()}>Cancel</Button></div>
  </Card>;
}
export function Advertisers({d,user,orgId,onGo,onChanged}:CommercialProps) {
  const [adding,setAdding]=useState(false);
  const orgName=(id:string)=>d.orgs?.find((o:any)=>o.id===id)?.name??id;
  return <><PageHead title="Advertisers" sub="Client records and their campaigns. Archived clients remain in history." actions={<Button disabled={!orgId} onClick={()=>setAdding(true)}>Add advertiser</Button>}/>
    {!orgId&&<p className="mb-4 text-sm text-muted-foreground">Select an organisation above to create an advertiser.</p>}
    {adding&&orgId&&<AdvertiserForm d={d} user={user} orgId={orgId} onDone={async(a)=>{setAdding(false);await onChanged();if(a)onGo('a/'+a.id);}}/>}
    <DataTable rows={d.advertisers} rowId={(a:any)=>a.id} exportName="advertisers" search={(a:any)=>`${a.name} ${a.contact} ${a.category} ${orgName(a.org_id)}`} facets={[{label:'Status',get:(a:any)=>a.status??'active'}]} cols={[
      {label:'Advertiser',render:(a:any)=><button className="font-medium text-primary hover:underline" onClick={()=>onGo('a/'+a.id)}>{a.name}</button>},
      {label:'Organisation',render:(a:any)=>orgName(a.org_id)},
      {label:'Contact',render:(a:any)=><>{a.contact}<br/>{a.email}<br/>{a.phone}</>},
      {label:'Campaigns',num:true,render:(a:any)=>d.campaigns.filter((c:any)=>c.advertiser_id===a.id).length},
      {label:'Accrued spend',num:true,render:(a:any)=>{const rows=d.campaigns.filter((c:any)=>c.advertiser_id===a.id);return rows.some((c:any)=>typeof c.accrued_spend!=='number')?'—':inr(rows.reduce((sum:number,c:any)=>sum+c.accrued_spend,0));}},
      {label:'Status',render:(a:any)=><Badge variant={a.status==='archived'?'muted':'ok'}>{a.status??'active'}</Badge>},
    ]} empty="No advertisers yet. Create a client record to begin."/>
    {user.role!=='platform_admin'&&<p className="mt-3 text-xs text-muted-foreground">Network advertisers shown here belong to the originating organisation. You can manage your own clients.</p>}
  </>;
}
/** `#a/<id>` shell: the workspace tabs live in advertiser-workspace.tsx; Settings (record, exclusions, edit/archive) stays here. */
export function AdvertiserDetail({id,d,user,orgId,onGo,onChanged}:CommercialProps&{id:string}) {
  const a=d.advertisers.find((a:any)=>a.id===id);
  const [editing,setEditing]=useState(false),[confirm,setConfirm]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  if(!a)return <Empty>Advertiser not found in this organisation. Return to the advertiser list.</Empty>;
  const canEdit=user.role==='platform_admin'||a.org_id===user.org_id;
  const archive=async()=>{setError('');setBusy(true);try{await api(`/advertiser/${id}/${a.status==='archived'?'restore':'archive'}`,{});setConfirm(false);await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const settings=<>
    {canEdit&&<div className="mb-4 flex flex-wrap gap-2"><Button variant="outline" onClick={()=>setEditing(true)}>Edit advertiser</Button><Button variant="outline" onClick={()=>setConfirm(true)}>{a.status==='archived'?'Restore advertiser':'Archive advertiser'}</Button></div>}
    {editing&&<AdvertiserForm d={d} user={user} row={a} orgId={a.org_id} onDone={async()=>{setEditing(false);await onChanged();}}/>}
    {confirm&&<Card className="mb-4 p-4"><p className="mb-3 text-sm">{a.status==='archived'?'Restore this advertiser so new campaigns can be created?':'Archive this advertiser? History is retained. Active, pending and paused campaigns must be completed or moved to draft first.'}</p><Button disabled={busy} onClick={archive}>Confirm {a.status==='archived'?'restore':'archive'}</Button><Button variant="ghost" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</Button></Card>}
    {error&&<p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    <Card className="p-4 text-sm"><p>{a.contact||'No contact'} · {a.email||'No email'} · {a.phone||'No phone'}</p><p className="mt-2">{a.category}</p>{a.notes&&<p className="mt-2 whitespace-pre-wrap">{a.notes}</p>}{canEdit&&<div className="mt-3 border-t border-border pt-3"><b>Delivery exclusions</b><p className="mt-1">Venues: {a.exclusions?.venue_types?.join(', ')||'None'}</p><p>Screens: {a.exclusions?.screens?.map((id:string)=>d.screens.find((s:any)=>s.id===id)?.name??id).join(', ')||'None'}</p><p>Tag rules: {a.exclusions?.tag_rules?.map((r:any)=>Object.entries(r).map(([k,v])=>`${k}:${v}`).join(' + ')).join(' or ')||'None'}</p></div>}</Card>
  </>;
  return <AdvertiserWorkspace a={a} d={d} user={user} orgId={orgId} onGo={onGo} onChanged={onChanged} settings={settings}
    renderEditor={(row,close)=><CreativeEditor key={row.id} row={row} onClose={close} onChanged={onChanged}/>}/>;
}
