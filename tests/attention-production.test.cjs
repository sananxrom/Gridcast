const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),profile=require('./load-lib.cjs')('vision/attention-contracts').ATTENTION_PROFILE;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

test('standalone evaluation route is development-only at the server boundary',()=>{
 const source=fs.readFileSync(path.join(root,'app/vision-lab/evaluate/page.tsx'),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const load=environment=>{const mod={exports:{}},run=new Function('require','module','exports','process',compiled);run(name=>name==='next/navigation'?{notFound:()=>{throw Error('NOT_FOUND');}}:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props})}:{default:()=>null},mod,mod.exports,{env:{NODE_ENV:environment}});return mod.exports.default;};
 assert.throws(()=>load('production')(),/NOT_FOUND/);assert.doesNotThrow(()=>load('development')());
});

test('production model manifest and executed worker are immutable and pipeline pinned',()=>{
 const manifest=fs.readFileSync(path.join(root,'public/vision-lab/attention-v1-assets.json'));
 const worker=fs.readFileSync(path.join(root,`public${profile.worker_url}`));
 assert.equal(profile.worker_url,'/vision-lab/worker-attention-v1.js');
 assert.equal(digest(manifest),profile.manifest_sha256);
 assert.equal(digest(worker),profile.worker_sha256);
 const pipeline=Buffer.concat(['public/vision-lab/worker-attention-v1.js','lib/vision/production.ts','lib/vision/engine.ts','lib/vision/metrics.ts','lib/vision/calibration.ts'].map(p=>fs.readFileSync(path.join(root,p))));
 assert.equal(digest(pipeline),profile.pipeline_sha256);
});

test('V2 person and face workers, asset manifest, and runtime pipeline match the independent pin',()=>{
 const v2=require('./load-lib.cjs')('vision/presence-v2-profile').PRESENCE_V2_PROFILE;
 const manifest=fs.readFileSync(path.join(root,'public/vision-lab/presence-v2-assets.json'));
 assert.equal(digest(manifest),v2.manifest_sha256);
 assert.equal(digest(fs.readFileSync(path.join(root,'public/vision-lab/worker-presence-body-v2.js'))),v2.body_worker_sha256);
 assert.equal(digest(fs.readFileSync(path.join(root,'public/vision-lab/worker-presence-face-v2.js'))),v2.face_worker_sha256);
 const pipeline=Buffer.concat(['public/vision-lab/worker-presence-body-v2.js','public/vision-lab/worker-presence-face-v2.js','lib/vision/production-v2.ts','lib/vision/metrics.ts','lib/vision/calibration.ts','lib/vision/attention-v2-contracts.ts','lib/vision/local-diagnostics-v2.ts'].map(p=>fs.readFileSync(path.join(root,p))));
 assert.equal(digest(pipeline),v2.pipeline_sha256);
});

test('V2 workers identify missing worker WebGL before MediaPipe initialization',async()=>{
 for(const [file,stage] of [['worker-presence-body-v2.js','body'],['worker-presence-face-v2.js','face']]){
  const reports=[],context={self:{},postMessage:value=>reports.push(value),OffscreenCanvas:class{getContext(){return null;}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'public/vision-lab',file),'utf8'),context);
  await context.self.onmessage({data:{type:'INIT',stage,asset_urls:{}}});
  assert.equal(reports[0]?.type,'UNSUPPORTED');assert.equal(reports[0]?.stage,stage);assert.equal(reports[0]?.capabilities.webgl2,false);assert.match(reports[0]?.error,/needs worker WebGL 2/);
  const webgl1Reports=[],webgl1Context={self:{},postMessage:value=>webgl1Reports.push(value),OffscreenCanvas:class{getContext(kind){return kind==='webgl'?{getExtension:()=>null}:null;}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'public/vision-lab',file),'utf8'),webgl1Context);
  await webgl1Context.self.onmessage({data:{type:'INIT',stage,asset_urls:{}}});
  assert.equal(webgl1Reports[0]?.type,'UNSUPPORTED','WebGL 1 alone is insufficient for the pinned MediaPipe path');assert.equal(webgl1Reports[0]?.capabilities.webgl,true);assert.equal(webgl1Reports[0]?.capabilities.webgl2,false);
 }
});

test('V2 runtime retries only a worker that failed initialization and preserves its healthy peer',async()=>{
 const v2=require('./load-lib.cjs')('vision/presence-v2-profile').PRESENCE_V2_PROFILE;
 const source=ts.transpileModule(fs.readFileSync(path.join(root,'lib/vision/production-v2.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const fakeWorkers=[],createdUrls=[],revokedUrls=[],createdBlobs=[],assetBytesByName=new Map(['person.tflite','face.task','vision_wasm_internal.js','vision_wasm_internal.wasm'].map(name=>[name,Buffer.from(`verified ${name}`)]));let bodyAttempts=0,faceAttempts=0,bodyFailureLimit=4;
 const assets=[...assetBytesByName].map(([name,bytes])=>({name,url:`/${name}`,bytes:bytes.length,sha256:digest(bytes)}));
 const cache={match:async url=>{const assetBytes=assetBytesByName.get(String(url).replace(/^\//,''));return{arrayBuffer:async()=>assetBytes.buffer.slice(assetBytes.byteOffset,assetBytes.byteOffset+assetBytes.byteLength)};}};
 let activeCache=cache;const cacheApi={open:async()=>activeCache};
 class WorkerFixture{
  constructor(url){this.url=url;this.terminated=false;fakeWorkers.push(this);if(url.includes('body'))bodyAttempts++;else faceAttempts++;}
  postMessage(message){if(message.type!=='INIT')return;setTimeout(()=>{if(this.terminated)return;const stage=this.url.includes('body')?'body':'face';if(stage==='body'&&bodyAttempts===1)this.onmessage?.({data:{type:'ERROR',stage,error:'fixture worker initialization failed'}});else this.onmessage?.({data:{type:'READY',stage}});},0);}
  terminate(){this.terminated=true;}
 }
 class BlobFixture{constructor(parts,options){this.source=parts.map(part=>Buffer.from(part).toString()).join('');this.type=options?.type||'';createdBlobs.push(this);}}
 const URLFixture={createObjectURL:blob=>{const stage=blob.type==='text/javascript'&&blob.source.includes('person.tflite')?'body':blob.type==='text/javascript'&&blob.source.includes('face.task')?'face':'asset',url=`fixture-${stage}:${createdUrls.length+1}`;createdUrls.push(url);return url;},revokeObjectURL:url=>revokedUrls.push(url)};
 const cryptoApi={subtle:crypto.webcrypto.subtle};
 const fetchFixture=async url=>{const isBody=String(url).includes('worker-presence-body'),workerFile=isBody?'worker-presence-body-v2.js':'worker-presence-face-v2.js';return{ok:true,arrayBuffer:async()=>{const bytes=fs.readFileSync(path.join(root,'public/vision-lab',workerFile));return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}};};
 const module={exports:{}};
 new Function('require','module','exports','fetch','crypto','caches','URL','Blob','Worker','performance','setInterval','clearInterval',source)(name=>name==='./presence-v2-profile'?{PRESENCE_V2_PROFILE:v2}:require(name),module,module.exports,fetchFixture,cryptoApi,cacheApi,URLFixture,BlobFixture,WorkerFixture,performance,()=>1,()=>{});
 const events=[],controller=new AbortController();
 const runtime=await module.exports.createPresenceV2Runtime({manifest:{assets},cache,ready:new Set(assetBytesByName.keys()),errors:{},downloaded:0,verified:[...assetBytesByName.values()].reduce((n,bytes)=>n+bytes.length,0),total:[...assetBytesByName.values()].reduce((n,bytes)=>n+bytes.length,0),elapsedSeconds:0},controller.signal,()=>{},state=>events.push({...state}));
 const deadline=Date.now()+3000;while(Date.now()<deadline&&events.at(-1)?.body.state!=='ready')await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(events.at(-1)?.body.state,'ready','The failed body worker recovers automatically after bounded backoff');
 assert.equal(bodyAttempts,2,'Only the failed body worker is restarted');assert.equal(faceAttempts,1,'The healthy face worker remains alive');
 assert.equal(fakeWorkers.filter(worker=>worker.url.includes('face')&&!worker.terminated).length,1);
 assert.equal(createdBlobs.find(blob=>blob.source.includes('vision_wasm_internal.js'))?.type,'text/javascript','Cached WASM JavaScript loaders keep an executable MIME type for Safari');
 assert.equal(createdBlobs.find(blob=>blob.source.includes('vision_wasm_internal.wasm'))?.type,'application/wasm');
 assert.equal(revokedUrls.length,4,'The failed stage releases only its worker and required verified asset URLs before restarting');
 assert.ok(createdUrls.length<=15,'Worker and verified asset URLs remain bounded to the finite retry budget');
 runtime.close();assert.equal(revokedUrls.length,createdUrls.length,'Closing releases every worker and asset URL');
});

test('V2 stage recovery retries beyond three failures with capped backoff, manual bypass, and disposal',async()=>{
 const v2=require('./load-lib.cjs')('vision/presence-v2-profile').PRESENCE_V2_PROFILE;
 const source=ts.transpileModule(fs.readFileSync(path.join(root,'lib/vision/production-v2.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let now=0,nextId=0;const timers=new Map();
 const setTimer=(fn,delay)=>{const id=++nextId;timers.set(id,{fn,due:now+delay});return id;},clearTimer=id=>timers.delete(id);
 const clock={now:()=>now,async advance(ms){const target=now+ms;while(true){let matchId=null,task=null;for(const [id,value] of timers)if(value.due<=target&&(!task||value.due<task.due)){matchId=id;task=value;}if(!task)break;timers.delete(matchId);now=task.due;task.fn();await flush();}now=target;await flush();}};
 async function flush(){for(let i=0;i<5;i++){await new Promise(resolve=>setImmediate(resolve));await Promise.resolve();}}
 const fakeWorkers=[],createdUrls=[],revokedUrls=[],createdBlobs=[],assetBytesByName=new Map(['person.tflite','face.task','vision_wasm_internal.js','vision_wasm_internal.wasm'].map(name=>[name,Buffer.from(`verified ${name}`)]));let bodyAttempts=0,faceAttempts=0,bodyFailureLimit=4;
 const assets=[...assetBytesByName].map(([name,bytes])=>({name,url:`/${name}`,bytes:bytes.length,sha256:digest(bytes)}));
 const cachedAssets=new Map(assetBytesByName);cachedAssets.delete('person.tflite');let failPersonDownload=true,personFetches=0;
 const cache={match:async url=>{const b=cachedAssets.get(String(url).replace(/^\//,''));return b?{arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}:null;},put:async(url,response)=>{const b=Buffer.from(await response.arrayBuffer());cachedAssets.set(String(url).replace(/^\//,''),b);},delete:async url=>cachedAssets.delete(String(url).replace(/^\//,''))};
 let activeCache=cache;const cacheApi={open:async()=>activeCache};
 class WorkerFixture{
  constructor(url){this.url=url;this.terminated=false;this.stage=url.includes('body')?'body':'face';fakeWorkers.push(this);if(this.stage==='body')bodyAttempts++;else faceAttempts++;}
  postMessage(message){if(message.type!=='INIT')return;queueMicrotask(()=>{if(this.terminated)return;if(this.stage==='body'&&bodyAttempts<=bodyFailureLimit)this.onmessage?.({data:{type:'ERROR',stage:this.stage,error:'fixture model load failed'}});else this.onmessage?.({data:{type:'READY',stage:this.stage}});});}
  terminate(){this.terminated=true;}
 }
 class BlobFixture{constructor(parts,options){this.source=parts.map(part=>Buffer.from(part).toString()).join('');this.type=options?.type||'';createdBlobs.push(this);}}
 const URLFixture={createObjectURL:blob=>{const stage=blob.type==='text/javascript'&&blob.source.includes('person.tflite')?'body':blob.type==='text/javascript'&&blob.source.includes('face.task')?'face':'asset',url=`fixture-${stage}:${createdUrls.length+1}`;createdUrls.push(url);return url;},revokeObjectURL:url=>revokedUrls.push(url)};
 const fetchFixture=async url=>{if(String(url)==='/person.tflite'){personFetches++;if(failPersonDownload){failPersonDownload=false;return{ok:false};}const b=assetBytesByName.get('person.tflite');return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}const file=String(url).includes('body')?'worker-presence-body-v2.js':'worker-presence-face-v2.js',bytes=fs.readFileSync(path.join(root,'public/vision-lab',file));return{ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};};
 const module={exports:{}};
 new Function('require','module','exports','fetch','crypto','caches','URL','Blob','Worker','performance','setInterval','clearInterval','setTimeout','clearTimeout',source)(name=>name==='./presence-v2-profile'?{PRESENCE_V2_PROFILE:v2}:require(name),module,module.exports,fetchFixture,{subtle:crypto.webcrypto.subtle},cacheApi,URLFixture,BlobFixture,WorkerFixture,{now:clock.now},()=>-1,()=>{},setTimer,clearTimer);
 const events=[],controller=new AbortController();
 const runtime=await module.exports.createPresenceV2Runtime({manifest:{assets},cache,ready:new Set(assetBytesByName.keys()),errors:{body:'initial download failed'},downloaded:0,verified:0,total:0,elapsedSeconds:0},controller.signal,()=>{},state=>events.push({body:{...state.body},face:{...state.face}}));
 assert.equal(personFetches,1,'An initial immutable preparation error is retried from the network by the runtime');assert.equal(bodyAttempts,0);assert.equal(events.at(-1).body.retry_delay_ms,250);
 for(const [delay,attempts,expectedWait] of [[250,1,500],[500,2,1000],[1000,3,2000],[2000,4,4000]]){await clock.advance(delay);assert.equal(bodyAttempts,attempts,JSON.stringify({delay,attempts,personFetches,last:events.at(-1).body}));assert.equal(events.at(-1).body.retry_delay_ms,expectedWait);}
 await clock.advance(4000);assert.equal(bodyAttempts,5,'Recovery succeeds after four failed worker starts');assert.equal(events.at(-1).body.state,'ready');assert.equal(personFetches,2,'A retry re-downloads and verifies the previously missing model');
 assert.equal(faceAttempts,1,'The healthy peer was untouched during body recovery');assert.equal(fakeWorkers.find(w=>w.stage==='face'&&!w.terminated)?.stage,'face');
 const tooSlow={type:'OBSERVATION',stage:'body',at:0,result:{ok:true,boxes:[],saturated:false}};fakeWorkers.filter(w=>w.stage==='body').at(-1).onmessage({data:tooSlow});
 assert.equal(events.at(-1).body.state,'ready','Slow observations do not mark a live worker as a load failure');assert.equal(events.at(-1).body.last_issue,'slow_result');assert.match(events.at(-1).body.last_failure,/Slow frame discarded/);
 bodyFailureLimit=100;fakeWorkers.filter(w=>w.stage==='body'&&!w.terminated).at(-1).onerror({message:'fixture persistent failure'});
 let capChecks=0;while(events.at(-1).body.retry_delay_ms!==300000&&capChecks++<12){const delay=events.at(-1).body.retry_delay_ms;assert.ok(delay>0);await clock.advance(delay);assert.equal(events.at(-1).body.state,'error');}
 assert.equal(events.at(-1).body.retry_delay_ms,300000,'Repeated failures settle at the five-minute retry cap');
 await clock.advance(300000);assert.equal(events.at(-1).body.retry_delay_ms,300000,'Subsequent failures stay at the five-minute cap');
 bodyFailureLimit=bodyAttempts;assert.equal(await runtime.retryFailed(),true,'Manual retry bypasses the full five-minute delay');assert.equal(bodyAttempts>5,true);assert.equal(events.at(-1).body.state,'ready');
 const faceWorker=fakeWorkers.find(w=>w.stage==='face'&&!w.terminated);faceWorker.onerror({message:'fixture transient failure'});assert.equal(events.at(-1).face.retry_delay_ms,250);
 assert.equal(await runtime.retryFailed(),true,'Manual retry starts a failed stage immediately despite queued backoff');await flush();assert.equal(faceAttempts,2);assert.equal(events.at(-1).face.state,'ready');
 const bodyWorker=fakeWorkers.filter(w=>w.stage==='body'&&!w.terminated).at(-1);bodyWorker.onerror({message:'fixture dispose failure'});assert.equal(events.at(-1).body.state,'error');const attemptsAtClose=bodyAttempts;
 runtime.close();await clock.advance(300000);assert.equal(bodyAttempts,attemptsAtClose,'close cancels pending stage retry timers');assert.equal(revokedUrls.length,createdUrls.length,'close revokes each worker and asset URL once');
 const pendingMatches=[],cachePending={match:()=>new Promise(resolve=>pendingMatches.push(resolve)),put:async()=>{},delete:async()=>true},controller2=new AbortController(),urlsBefore=createdUrls.length;activeCache=cachePending;
 const pendingRuntime=module.exports.createPresenceV2Runtime({manifest:{assets},cache:cachePending,ready:new Set(assetBytesByName.keys()),errors:{},downloaded:0,verified:0,total:0,elapsedSeconds:0},controller2.signal,()=>{},()=>{});
 await flush();assert.ok(pendingMatches.length>0,'Second setup is held in asynchronous cache reads');controller2.abort();pendingMatches.forEach(resolve=>resolve(null));await assert.rejects(pendingRuntime,/Stopped/);await flush();assert.equal(createdUrls.length,urlsBefore,'Aborting setup while cache reads are pending cannot allocate worker or asset URLs');
});

test('player upgrade ignores stale lab shell entries and serves only its dedicated production cache',async()=>{
 const listeners={},cacheHits=[],globalHits=[];let networkCalls=0;
 const currentWorker=fs.readFileSync(path.join(root,`public${profile.worker_url}`),'utf8'),currentManifest=fs.readFileSync(path.join(root,'public/vision-lab/attention-v1-assets.json'),'utf8');
 const cache={match:async request=>{const pathname=typeof request==='string'?request:new URL(request.url).pathname;cacheHits.push(pathname);return pathname==='/player'?new Response('current v2 player') : undefined;},put:async()=>{}};
 const caches={open:async name=>{assert.equal(name,'gridcast-player-shell-v2');return cache;},match:async request=>{globalHits.push(new URL(request.url).pathname);return new Response('stale lab cache body');}};
 const self={location:new URL('https://gridcast.example/'),addEventListener:(name,fn)=>listeners[name]=fn};
 const context={self,caches,URL,Response,Promise,fetch:async request=>{networkCalls++;const pathname=new URL(request.url).pathname;if(pathname==='/player')throw Error('offline');return new Response(pathname===profile.worker_url?currentWorker:currentManifest);}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'public/player-sw.js'),'utf8'),context);
 for(const pathname of [profile.worker_url,'/vision-lab/attention-v1-assets.json']){
  let responsePromise;listeners.fetch({request:new Request(`https://gridcast.example${pathname}`),respondWith:value=>responsePromise=value});
  const response=await responsePromise;assert.equal(await response.text(),pathname===profile.worker_url?currentWorker:currentManifest);
 }
 assert.deepEqual(cacheHits,[profile.worker_url,'/vision-lab/attention-v1-assets.json']);
 assert.deepEqual(globalHits,[],'Never search across old lab and unrelated origin caches');
 assert.equal(networkCalls,2);
 let navigation;listeners.fetch({request:{method:'GET',mode:'navigate',url:'https://gridcast.example/player'},respondWith:value=>navigation=value});
 const playerResponse=await navigation;assert.equal(await playerResponse.text(),'current v2 player');assert.deepEqual(globalHits,[],'Offline navigation must not fall back to an older v1 player shell');
});
