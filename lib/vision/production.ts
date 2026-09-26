import { ATTENTION_PROFILE, validateAttentionCalibration } from './attention-contracts';
export { ATTENTION_PROFILE, validateAttentionCalibration };
import { createEvaluationWorker } from './engine';
import { EvaluationMetrics, type Observation, type PlaySummary } from './metrics';

export type AttentionCalibration = { schema:string; profile:string; revision:string; device_id:string; screen_id:string; camera_ref:string; width:number; height:number; rotation:0|90|180|270; method:'guided-3s'; yaw_tenths:number; pitch_tenths:number; samples:number; span_ms:number; yaw_spread_tenths:number; pitch_spread_tenths:number; completed_at:string };
type Manifest = { version:string; assets:{name:string;url:string;sha256:string;bytes:number}[] };
export const ATTENTION_CACHE = 'gridcast-vision-lab-assets-1';
let pinnedManifest:Manifest|null=null;
const hex = (bytes:ArrayBuffer) => Array.from(new Uint8Array(bytes)).map(n=>n.toString(16).padStart(2,'0')).join('');
export function localCameraRef(deviceId:string,screenId:string,track:MediaStreamTrack,width:number,height:number,rotation:number){
  const key=`gridcast-attention-camera-ref:${deviceId}:${screenId}`,settings=track.getSettings();
  const fingerprint=JSON.stringify([settings.deviceId||'',settings.facingMode||'',width,height,rotation]);
  let saved:any=null;try{saved=JSON.parse(localStorage.getItem(key)||'null');}catch{}
  if(saved?.fingerprint===fingerprint&&typeof saved.ref==='string')return saved.ref;
  const ref=crypto.randomUUID().replaceAll('-','');
  try{localStorage.setItem(key,JSON.stringify({fingerprint,ref}));}catch{}
  return ref;
}
export const localCalibrationKey=(deviceId:string,screenId:string)=>`gridcast-attention-calibration:${deviceId}:${screenId}`;
export function calibrationBinding(cal:unknown, deviceId:string, screenId:string, profile:string, camera:string, width:number, height:number): cal is AttentionCalibration {
  const v=cal as AttentionCalibration;
  return !!v && v.schema==='calibration-v1/1' && v.profile===profile && v.device_id===deviceId && v.screen_id===screenId && v.camera_ref===camera
    && v.width===width && v.height===height && [0,90,180,270].includes(v.rotation) && v.method==='guided-3s'
    && typeof v.revision==='string' && typeof v.completed_at==='string';
}

/** Download once, hash every pinned file, and persist only in CacheStorage. */
export async function prepareAttentionAssets(onProgress:(progress:{message:string;phase:'checking'|'downloading'|'verifying';downloaded:number;verified:number;total:number;elapsedSeconds:number;etaSeconds:number|null})=>void, signal:AbortSignal) {
  if (!window.isSecureContext || !window.Worker || !window.createImageBitmap || !('caches' in window)) throw Error('This player cannot run the local attention models.');
  onProgress({message:'Checking the pinned attention model profile…',phase:'checking',downloaded:0,verified:0,total:0,elapsedSeconds:0,etaSeconds:null});
  const response=await fetch('/vision-lab/attention-v1-assets.json',{signal,cache:'no-store'});
  if(!response.ok) throw Error('The attention model manifest is unavailable.');
  const manifestBytes=await response.arrayBuffer();
  if(hex(await crypto.subtle.digest('SHA-256',manifestBytes))!==ATTENTION_PROFILE.manifest_sha256) throw Error('The attention model manifest did not match the pinned profile.');
  const manifest:Manifest=JSON.parse(new TextDecoder().decode(manifestBytes));
  if(manifest.version!=='mediapipe-1.0.1-face1-efficientdet-int8-1'||manifest.assets.length!==7) throw Error('The attention model profile is not supported by this player.');
  pinnedManifest=manifest;
  const cache=await caches.open(ATTENTION_CACHE); let done=0,total=manifest.assets.reduce((n,a)=>n+a.bytes,0),downloaded=0,verified=0;
  const started=performance.now(); let sampledBytes=0,sampledAt=started;
  const report=(message:string,phase:'checking'|'downloading'|'verifying'='checking')=>{const now=performance.now(),elapsed=Math.max(1,now-sampledAt);if(downloaded-sampledBytes>=256*1024){sampledBytes=downloaded;sampledAt=now;}const rate=downloaded/Math.max(1,now-started);onProgress({message,phase,downloaded,verified,total,elapsedSeconds:Math.floor((now-started)/1000),etaSeconds:rate>0&&verified<total?Math.ceil((total-verified)/rate/1000):null});};
  for(const asset of manifest.assets){
    signal.throwIfAborted(); report(`Checking attention files ${++done}/${manifest.assets.length} · ${asset.name}`,'checking');
    let saved=await cache.match(asset.url); let bytes=saved?await saved.clone().arrayBuffer():null;
    if(!bytes || bytes.byteLength!==asset.bytes || hex(await crypto.subtle.digest('SHA-256',bytes))!==asset.sha256){
      await cache.delete(asset.url);
      const fetched=await fetch(asset.url,{signal,mode:'cors',credentials:'omit'});
      if(!fetched.ok || fetched.type==='opaque') throw Error(`Could not download ${asset.name}. Connect the player and retry.`);
      if(!fetched.body) throw Error(`Could not read ${asset.name}.`);
      const verifiedReader=fetched.clone().body?.getReader();if(!verifiedReader)throw Error(`Could not read ${asset.name}.`);
      const chunks:Uint8Array[]=[];let length=0;
      while(true){const part=await verifiedReader.read();if(part.done)break;chunks.push(part.value);length+=part.value.byteLength;downloaded+=part.value.byteLength;report(`Downloading ${asset.name}`,'downloading');}
      const joined=new Uint8Array(length);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}bytes=joined.buffer;
      if(bytes.byteLength!==asset.bytes || hex(await crypto.subtle.digest('SHA-256',bytes))!==asset.sha256) throw Error(`Integrity check failed for ${asset.name}.`);
      await cache.put(asset.url,fetched);
    }
    verified+=asset.bytes; report(`Verified ${asset.name}`,'verifying');
  }
  return {version:manifest.version,bytes:total,downloaded,verified,elapsedSeconds:Math.floor((performance.now()-started)/1000)};
}

export async function createProductionAttentionWorker(signal:AbortSignal,observe:(value:Observation,context?:any)=>void,fail:(message:string)=>void){
  const response=await fetch(ATTENTION_PROFILE.worker_url,{signal,cache:'no-store'});
  if(!response.ok)throw Error('The pinned attention worker is unavailable.');
  const bytes=await response.arrayBuffer();
  if(hex(await crypto.subtle.digest('SHA-256',bytes))!==ATTENTION_PROFILE.worker_sha256)throw Error('The attention worker did not match the pinned production pipeline.');
  if(!pinnedManifest)throw Error('Verify the attention models before initializing their worker.');
  const workerSourceUrl=URL.createObjectURL(new Blob([bytes],{type:'text/javascript'}));
  const cache=await caches.open(ATTENTION_CACHE),assetUrls:Record<string,string>={},objectUrls:string[]=[];
  try{
    for(const asset of pinnedManifest.assets){
      signal.throwIfAborted();const saved=await cache.match(asset.url);if(!saved)throw Error(`The verified ${asset.name} is no longer cached.`);
      const body=await saved.arrayBuffer();if(body.byteLength!==asset.bytes||hex(await crypto.subtle.digest('SHA-256',body))!==asset.sha256)throw Error(`The cached ${asset.name} failed integrity verification.`);
      const mime=asset.name.endsWith('.mjs')||asset.name.endsWith('.js')?'text/javascript':asset.name.endsWith('.wasm')?'application/wasm':'application/octet-stream';
      const url=URL.createObjectURL(new Blob([body],{type:mime}));objectUrls.push(url);assetUrls[asset.name]=url;
    }
    const handle=await createEvaluationWorker('CPU',signal,(value,_stats,context)=>observe(value,context),fail,workerSourceUrl,{asset_urls:assetUrls});
    URL.revokeObjectURL(workerSourceUrl);
    let closed=false;
    const close=()=>{if(closed)return;closed=true;handle.close();objectUrls.forEach(url=>URL.revokeObjectURL(url));};
    signal.addEventListener('abort',close,{once:true});
    return {close,get busy(){return handle.busy;},frame:(video:HTMLVideoElement,calibration:{yaw:number;pitch:number},context?:any)=>handle.frame(video,calibration,context)};
  }catch(error){URL.revokeObjectURL(workerSourceUrl);objectUrls.forEach(url=>URL.revokeObjectURL(url));throw error;}
}

const ms=(seconds:number,limit:number)=>Math.min(limit,Math.max(0,Math.round((Number(seconds)||0)*1000)));
export function summaryForReceipt(summary:PlaySummary, playingMs:number, revision:string){
  const duration=Math.max(0,Math.min(3601000,Math.round(playingMs)));
  const coverage=(observed:number,saturated=0):[number,number,number]=>{const seen=ms(observed,duration),sat=Math.min(seen,ms(saturated,duration));return [seen,duration-seen,sat];};
  const body=coverage(summary.body_observed_s,summary.body_saturated_s),face=coverage(summary.face_observed_s,summary.face_saturated_s);
  const attentionCoverage=coverage(summary.attention_observed_s).slice(0,2) as [number,number], expression=coverage(summary.expression_observed_s).slice(0,2) as [number,number];
  const boundedMetric=(value:number|null,cap:number)=>value===null?null:Math.min(cap,Math.max(0,Math.round(value*1000)));
  const presence=boundedMetric(summary.presence_person_s,body[0]*20),looking=boundedMetric(summary.attention_person_s,attentionCoverage[0]*5),smile=boundedMetric(summary.smile_person_s,expression[0]*5);
  const faceAssessable=boundedMetric(summary.face_observable_person_s,attentionCoverage[0]*5),expressionAssessable=boundedMetric(summary.expression_observable_person_s,expression[0]*5);
  const tracked=body[0]===0?null:Math.max(0,Math.min(1000000,Math.round(summary.tracked_visits)));
  const impressions=tracked===null?null:Math.min(tracked,Math.max(0,Math.round(summary.estimated_impressions||0)));
  const attentive=attentionCoverage[0]===0?null:Math.min(impressions??0,Math.max(0,Math.round(summary.attentive_impressions||0)));
  return {schema:'attention-v1/1',profile:ATTENTION_PROFILE.id,calibration_revision:revision,playing_ms:duration,body,face,attention:attentionCoverage,expression,
    presence_person_ms:presence,looking_person_ms:looking,smile_person_ms:smile,face_assessable_person_ms:faceAssessable,expression_assessable_person_ms:expressionAssessable,
    estimated_impressions:impressions,attentive_impressions:attentive,tracked_visits:tracked,right_censored_visits:tracked===null?null:Math.min(tracked,Math.max(0,Math.round(summary.right_censored_visits))),
    longest_look_ms:boundedMetric(summary.longest_look_s,attentionCoverage[0])};
}

export function createAttentionMetrics(){return new EvaluationMetrics();}
