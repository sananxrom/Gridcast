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

test('V2 runtime retries only a worker that failed initialization and preserves its healthy peer',async()=>{
 const v2=require('./load-lib.cjs')('vision/presence-v2-profile').PRESENCE_V2_PROFILE;
 const source=ts.transpileModule(fs.readFileSync(path.join(root,'lib/vision/production-v2.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const fakeWorkers=[],createdUrls=[],revokedUrls=[],createdBlobs=[],assetBytesByName=new Map(['person.tflite','face.task','vision_wasm_internal.js','vision_wasm_internal.wasm'].map(name=>[name,Buffer.from(`verified ${name}`)]));let bodyAttempts=0,faceAttempts=0;
 const assets=[...assetBytesByName].map(([name,bytes])=>({name,url:`/${name}`,bytes:bytes.length,sha256:digest(bytes)}));
 const cache={match:async url=>{const assetBytes=assetBytesByName.get(String(url).replace(/^\//,''));return{arrayBuffer:async()=>assetBytes.buffer.slice(assetBytes.byteOffset,assetBytes.byteOffset+assetBytes.byteLength)};}};
 const cacheApi={open:async()=>cache};
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
 assert.equal(revokedUrls.length,5,'The failed stage releases its worker and verified asset URLs before restarting');
 assert.ok(createdUrls.length<=15,'Worker and verified asset URLs remain bounded to the finite retry budget');
 runtime.close();assert.equal(revokedUrls.length,createdUrls.length,'Closing releases every worker and asset URL');
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
