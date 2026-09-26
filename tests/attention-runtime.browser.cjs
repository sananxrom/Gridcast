const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const executablePath=[process.env.GC_TEST_BROWSER_PATH,chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium'].filter(Boolean).find(fs.existsSync);
// Optional preparation: download each assets.json entry.url to <directory>/<entry.name>,
// preserving the wasm/ subdirectory, then set GC_TEST_VISION_ASSETS=<directory>.
// Tests never download assets themselves. Missing files explicitly skip; present
// files must match every pinned byte count and SHA-256 before any browser runs.
const assetRoot=process.env.GC_TEST_VISION_ASSETS||'/tmp/gridcast-vision-spike/assets';
const manifest=JSON.parse(fs.readFileSync(path.join(root,'public/vision-lab/assets.json'),'utf8'));
const assetsAvailable=manifest.assets.every(asset=>fs.existsSync(path.join(assetRoot,asset.name)));
const skip=!executablePath?'Chromium unavailable':!assetsAvailable?'Pinned runtime assets missing; set GC_TEST_VISION_ASSETS to their verified local directory':false;
const check=(name,fn)=>test(name,{skip,timeout:90000},fn);
const contentType=name=>name.endsWith('.mjs')||name.endsWith('.js')?'application/javascript':'application/octet-stream';
function verifiedAssets(){return new Map(manifest.assets.map(asset=>{const bytes=fs.readFileSync(path.join(assetRoot,asset.name));assert.equal(bytes.length,asset.bytes,asset.name+' byte count');assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),asset.sha256,asset.name+' hash');return [asset.url,{...asset,body:bytes}];}));}
async function fixture(t,{localManifest=false}={}){
 const verified=verifiedAssets(),requested=[],settings={corrupt:''};let base;
 const server=http.createServer((req,res)=>{
  requested.push(req.url);
  if(req.url==='/vision-lab/worker.js'||req.url==='/vision-lab/sw.js'){res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});res.end(fs.readFileSync(path.join(root,'public',req.url)));return;}
  if(req.url==='/vision-lab/assets.json'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(localManifest?{...manifest,assets:manifest.assets.map(asset=>({...asset,url:base+'/fixture-assets/'+asset.name}))}:manifest));return;}
  if(req.url.startsWith('/fixture-assets/')){const name=req.url.slice('/fixture-assets/'.length),asset=[...verified.values()].find(value=>value.name===name);if(!asset){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':contentType(name)});res.end(settings.corrupt===name?Buffer.from('intentionally corrupted test asset'):asset.body);return;}
  if(req.url==='/api/private'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"private":true}');return;}
  res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Local attention runtime fixture</title><main>Attention runtime test shell</main>');
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 let browser;try{
  browser=await chromium.launch({executablePath,headless:true,args:['--enable-unsafe-swiftshader']});const context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(30000);
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});return {page,context,base,verified,requested,settings};
 }catch(error){await browser?.close();await new Promise(resolve=>server.close(resolve));throw error;}
}
async function interceptPinnedAssets(h,{failModel=false}={}){
 const routed=[],unexpected=[];
 await h.context.route('**/*',async route=>{const url=route.request().url();if(url.startsWith(h.base+'/'))return route.continue();const asset=h.verified.get(url);if(!asset){unexpected.push(url);return route.abort('blockedbyclient');}routed.push(asset.name);if(failModel&&asset.name==='face.task')return route.abort('failed');await route.fulfill({status:200,headers:{'Content-Type':contentType(asset.name),'Access-Control-Allow-Origin':'*'},body:asset.body});});return {routed,unexpected};
}
async function initializeWorker(page){
 return page.evaluate(()=>new Promise((resolve,reject)=>{
  window.worker=new Worker('/vision-lab/worker.js');window.messages=[];
  const timeout=setTimeout(()=>reject(Error('Real worker initialization timed out')),45000);
  worker.onerror=event=>{clearTimeout(timeout);reject(Error(event.message));};worker.onmessage=event=>{messages.push(event.data);if(['READY','ERROR'].includes(event.data.type)){clearTimeout(timeout);resolve(event.data);}};worker.postMessage({type:'INIT',delegate:'CPU'});
 }));
}
check('classic worker initializes pinned real CPU models and processes a transferred blank frame',async t=>{
 const h=await fixture(t),network=await interceptPinnedAssets(h);await h.page.goto(h.base+'/vision-lab/evaluate');const ready=await initializeWorker(h.page);assert.deepEqual(ready,{type:'READY',delegate:'CPU',personDelegate:'CPU'});
 const result=await h.page.evaluate(async()=>{const canvas=new OffscreenCanvas(320,240);const drawing=canvas.getContext('2d');drawing.fillStyle='black';drawing.fillRect(0,0,320,240);const frame=canvas.transferToImageBitmap();const response=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Real inference timed out')),30000);worker.onmessage=event=>{if(['OBSERVATION','FRAME_ERROR'].includes(event.data.type)){clearTimeout(timeout);resolve(event.data);}};});worker.postMessage({type:'FRAME',frame,at:1000,person:true,face:true,calibration:{yaw:0,pitch:0}},[frame]);const transferredWidth=frame.width;return {response:await response,transferredWidth};});
 assert.equal(result.transferredWidth,0,'Frame ownership transferred to the worker');assert.equal(result.response.type,'OBSERVATION');assert.deepEqual(result.response.observation.bodies,{ok:true,boxes:[],saturated:false});assert.deepEqual(result.response.observation.faces,{ok:true,faces:[],saturated:false});assert.equal(result.response.observation.at,1000);assert.ok(Number.isFinite(result.response.durationMs)&&result.response.durationMs>=0);
 await h.page.evaluate(()=>worker.terminate());const restarted=await initializeWorker(h.page);assert.equal(restarted.type,'READY','Terminated worker can be recreated with real model initialization');await h.page.evaluate(()=>worker.terminate());assert.ok(network.routed.includes('face.task'));assert.ok(network.routed.includes('person.tflite'));assert.ok(network.routed.some(name=>name.endsWith('.wasm')));assert.deepEqual(network.unexpected,[]);
});
check('model download failure returns an explicit initialization error and premature frames stay unavailable',async t=>{
 const h=await fixture(t),network=await interceptPinnedAssets(h,{failModel:true});await h.page.goto(h.base+'/vision-lab/evaluate');const result=await initializeWorker(h.page);assert.equal(result.type,'ERROR');assert.ok(result.error);
 const frameResult=await h.page.evaluate(async()=>{const canvas=new OffscreenCanvas(32,32);canvas.getContext('2d').fillRect(0,0,32,32);const frame=canvas.transferToImageBitmap();return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Missing frame error')),5000);worker.onmessage=event=>{clearTimeout(timeout);resolve(event.data);};worker.postMessage({type:'FRAME',frame,at:1,person:true,face:true,calibration:{yaw:0,pitch:0}},[frame]);});});assert.equal(frameResult.type,'FRAME_ERROR');assert.match(frameResult.error,/not ready/);assert.equal(frameResult.observation,undefined);await h.page.evaluate(()=>worker.terminate());assert.deepEqual(network.unexpected,[]);
});
check('isolated worker cache validates hashes, refuses corruption and preserves shell and warmed assets across offline reload',async t=>{
 // This test uses the actual service worker and exact pinned bytes/hashes. Only
 // manifest URLs point at this local server, because browser routes do not cover
 // requests issued by a service worker. It proves cache semantics, not CDN CORS.
 const h=await fixture(t,{localManifest:true});await h.page.goto(h.base+'/vision-lab/evaluate');
 const scope=await h.page.evaluate(async()=>{const registration=await navigator.serviceWorker.register('/vision-lab/sw.js',{scope:'/vision-lab/'});await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));return registration.scope;});assert.equal(scope,h.base+'/vision-lab/');
 const faceUrl=h.base+'/fixture-assets/face.task',personUrl=h.base+'/fixture-assets/person.tflite';
 const face=await h.page.evaluate(async url=>{const response=await fetch(url);return {ok:response.ok,bytes:(await response.arrayBuffer()).byteLength};},faceUrl);assert.equal(face.ok,true);assert.equal(face.bytes,h.verified.get(manifest.assets.find(asset=>asset.name==='face.task').url).bytes);
 h.settings.corrupt='person.tflite';await assert.rejects(h.page.evaluate(async url=>(await fetch(url)).arrayBuffer(),personUrl),/Failed to fetch|NetworkError/);
 const cachedBefore=await h.page.evaluate(async url=>!!await caches.match(url),personUrl);assert.equal(cachedBefore,false,'Rejected corrupt bytes never enter cache');h.settings.corrupt='';
 await h.page.evaluate(async url=>(await fetch(url)).arrayBuffer(),personUrl);await h.page.evaluate(async()=>{const response=await fetch('/api/private');if(!response.ok)throw Error('Private fixture failed');});assert.equal(await h.page.evaluate(async()=>!!await caches.match('/api/private')),false);
 const player=await h.context.newPage();await player.goto(h.base+'/player');assert.equal(await player.evaluate(()=>navigator.serviceWorker.controller),null,'Vision worker never controls the production-player path');
 const tabs=await h.page.evaluate(()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=event=>resolve(event.data);navigator.serviceWorker.controller.postMessage({type:'PLAYER_TABS'},[channel.port2]);}));assert.equal(tabs.open,true);await player.close();
 const readsBefore=h.requested.filter(url=>url.startsWith('/fixture-assets/')).length;await h.context.setOffline(true);await h.page.reload();assert.match(await h.page.locator('body').innerText(),/Attention runtime test shell/);
 const offline=await h.page.evaluate(async urls=>Promise.all(urls.map(async url=>({url,bytes:(await (await fetch(url)).arrayBuffer()).byteLength}))),[faceUrl,personUrl]);assert.equal(offline[0].bytes,3758596);assert.equal(offline[1].bytes,4602795);assert.equal(h.requested.filter(url=>url.startsWith('/fixture-assets/')).length,readsBefore,'Warm assets served entirely from validated cache');await h.context.setOffline(false);
});
