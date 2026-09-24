'use client';
import React,{useState} from 'react';
import {token} from '@/lib/client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

export function CreativeUpload({creativeId,mediaType='video',onUploaded}:{creativeId:string;mediaType?:'image'|'video';onUploaded:(result:any)=>void}) {
  const [open,setOpen]=useState(false),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[verified,setVerified]=useState<any>(null);
  const isImage=mediaType==='image', label=isImage?'image':'video';
  const choose=(f:File|null)=>{setError('');setVerified(null);if(f&&(!(isImage?/\.(png|jpe?g|webp)$/i:/\.(mp4|webm)$/i).test(f.name)||f.size>(isImage?10:25)*1024*1024||f.size===0)){setFile(null);setError(isImage?'Choose a static PNG, JPEG or WebP image up to 10 MB.':'Choose a non-empty MP4 or WebM video up to 25 MB.');return;}setFile(f);};
  const upload=async()=>{if(!file)return;setBusy(true);setError('');try{const credential=token.get();if(!credential)throw new Error('Sign in before uploading.');const form=new FormData();form.append('file',file);form.append('creative_id',creativeId);const response=await fetch('/api/assets/upload',{method:'POST',headers:{Authorization:`Bearer ${credential}`},body:form});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'The upload could not be completed.');setVerified(result.asset);setFile(null);onUploaded(result);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  if(!open)return <Button size="sm" variant="outline" onClick={()=>setOpen(true)}>Upload {label}</Button>;
  return <div className="min-w-[230px] max-w-md space-y-2 rounded-md border border-border p-3 text-sm">
    <Input type="file" accept={isImage?"image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp":"video/mp4,video/webm,.mp4,.webm"} aria-label={isImage?"PNG, JPEG or WebP image":"MP4 or WebM video"} disabled={busy} onChange={e=>choose(e.target.files?.[0]??null)}/>
    <p className="text-xs text-muted-foreground">{isImage?"Static PNG, JPEG or WebP, up to 10 MB. Animated images are not supported. Display time is set on the creative.":"MP4 or WebM, up to 25 MB. Duration comes from the video file."} Files stay on this computer until uploaded. The server checks each file; a new upload requires approval.</p>
    {file&&<p className="break-all text-xs">{file.name} · {(file.size/1024/1024).toFixed(1)} MB · metadata not yet verified</p>}
    {verified&&<p className="text-xs text-primary" role="status">Upload checked: {typeof verified.duration_s==='number'?`${verified.duration_s.toFixed(2)} seconds`:typeof verified.duration_ms==='number'?`${(verified.duration_ms/1000).toFixed(2)} seconds`:isImage?'still image verified':'metadata received'}{verified.width&&verified.height?` · ${verified.width} × ${verified.height}`:''}. Awaiting platform approval.</p>}
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
    <div className="flex gap-2"><Button size="sm" disabled={!file||busy} onClick={upload}>{busy?'Uploading and checking…':`Upload selected ${label}`}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={()=>{setOpen(false);setFile(null);setError('');}}>Close</Button></div>
  </div>;
}
