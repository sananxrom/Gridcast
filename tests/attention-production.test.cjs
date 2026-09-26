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
