const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const ts = require('typescript');
const {chromium} = require('playwright');
const root=path.resolve(__dirname,'..');
const executablePath=[process.env.GC_TEST_BROWSER_PATH,chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium'].filter(Boolean).find(fs.existsSync);
const ffmpeg=[process.env.GC_TEST_FFMPEG_PATH,'/opt/homebrew/bin/ffmpeg','/usr/bin/ffmpeg'].filter(Boolean).find(fs.existsSync);
const compile = file=>ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const deviceModule={exports:{}};new Function('require','module','exports',compile('lib/devices.ts'))(name=>name.startsWith('.')?require('./load-lib.cjs')(name.slice(2)):require(name),deviceModule,deviceModule.exports);
const {issuePairing,deviceRoute}=deviceModule.exports;
const bundle=()=>`const q={exports:{}};new Function('module','exports',${JSON.stringify(compile('lib/player-queue.ts'))})(q,q.exports);
const cache={exports:{}};new Function('module','exports',${JSON.stringify(compile('lib/player-media-cache.ts'))})(cache,cache.exports);
const diagnostic={exports:{}};new Function('module','exports',${JSON.stringify(compile('lib/player-diagnostics.ts'))})(diagnostic,diagnostic.exports);
const vision={exports:{}};new Function('module','exports',${JSON.stringify(compile('lib/player-vision.ts'))})(vision,vision.exports);
const evidence={exports:{}};new Function('module','exports',${JSON.stringify(compile('lib/player-evidence-lock.ts'))})(evidence,evidence.exports);
const player={exports:{}};const fixtureRequire=name=>{
 if(name==='react')return React;
 if(name==='@/lib/player-evidence-lock')return evidence.exports;
 if(name==='@/lib/player-queue')return q.exports;
 if(name==='@/lib/player-media-cache')return cache.exports;
 if(name==='@/lib/player-diagnostics')return diagnostic.exports;
 if(name==='@/lib/player-vision')return vision.exports;
 if(name==='@/components/ui/brand-mark')return {BrandLogo:()=>React.createElement('span',null,'Gridcast')};
 if(name==='@/components/ui/button')return {Button:props=>React.createElement('button',props)};
 if(name==='@/components/ui/input')return {Input:props=>React.createElement('input',props)};
 if(name==='lucide-react')return {Monitor:()=>React.createElement('span')};
 if(name==='@tensorflow/tfjs')return window.fixtureRealModel ? window.tf : {ready:async()=>{}};
 if(name==='@tensorflow-models/coco-ssd')return {load:async(config)=>{
   window.fixtureLoads=(window.fixtureLoads||0)+1;
   if(window.fixtureLoadWait)await new Promise(resolve=>window.fixtureReleaseLoad=resolve);
   if(!window.fixtureModelWorking)throw new Error('Fixture model unavailable');
   const real=window.fixtureRealModel ? await window.cocoSsd.load(config) : null;
   return {detect:async(v,maxBoxes,minScore)=>{
     window.fixtureFrame=v;window.fixtureDetectCalls??=[];window.fixtureDetectCalls.push({maxBoxes,minScore,width:v.width,height:v.height,at:Date.now(),playing:!document.querySelector('video[data-role="creative"][data-active="true"]').paused});
     if(window.fixtureDetectWait)await new Promise(resolve=>window.fixtureReleaseDetect=resolve);
     return real ? real.detect(v,maxBoxes,minScore) : [{class:'person',score:.46,bbox:[50,50,100,100]}];
   },dispose(){window.fixtureDisposed=(window.fixtureDisposed||0)+1;real?.dispose();}};
 }};
 throw new Error('Unmapped browser test dependency '+name);
};
new Function('require','module','exports',${JSON.stringify(compile('app/player/page.tsx'))})(fixtureRequire,player,player.exports);
window.fixtureEvidence=evidence.exports;window.fixtureQueue=q.exports;window.fixtureCache=cache.exports;window.fixtureDiagnostic=diagnostic.exports;
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(player.exports.default));`;
async function harness(options={}) {
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gridcast-playback-test-'));
 execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=128x72:r=25','-t','2','-an','-c:v','libvpx','-y',path.join(temp,'fixture.webm')]);
 const video=fs.readFileSync(path.join(temp,'fixture.webm'));
 execFileSync(ffmpeg,['-v','error','-i',path.join(temp,'fixture.webm'),'-frames:v','1','-y',path.join(temp,'fixture.png')]);
 const picture=fs.readFileSync(path.join(temp,'fixture.png'));
 const db={orgs:[{id:'org1',status:'active'}],screens:[{id:'screen1',org_id:'org1',status:'active',has_camera:true}],devices:[],device_assignments:[],plays:[],presence:[],campaigns:[{id:'campaign1',org_id:'org1',advertiser_id:'advertiser1',rate_type:'per_play',rate_value:2,accrued_spend:0,committed_budget:10000}]};
 if(options.partialAllowance){db.campaigns[0].committed_budget=2;db.campaigns.push({...db.campaigns[0],id:'campaign2',advertiser_id:'advertiser2',committed_budget:10000});}
 const overrides=new Map();let configVersion=7;
 const requests=[],bodies=[],replies=[];let failedAck=false,base='',stopItems=false,playlistFailed=false;
 const config={diagnostics_overlay:true,audio_enabled:true,model:'coco-ssd',sample_interval_s:options.modelWorking?.5:2,loop_length_s:4,slot_duration_s:2,count_ceiling:50,camera_fail_mode:'continue',heartbeat_s:10,sync_interval_min:1,offline_buffer_plays:5000,telemetry_batch:25,telemetry_retry_h:72,...options.config};
 const callback=()=>{const p={config,config_version:configVersion,items:[],[options.filler?'filler_items':'items']:(stopItems||options.empty)?[]:[{campaign_id:'campaign1',creative_id:'creative1',creative_name:'Browser fixture',duration_s:2,rate_value:2,rate_type:'per_play',asset_url:options.youtube?undefined:base+(options.image?'/fixture.png':'/fixture.webm'),youtube_id:options.youtube?'abcdefghijk':undefined,media_type:options.image?'image':'video',asset_id:'fixture',asset_mime:options.image?'image/png':'video/webm',width:128,height:72,...(options.offline?{asset_bytes:(options.image?picture:video).length,asset_sha256:crypto.createHash('sha256').update(options.image?picture:video).digest('hex')}:{})}]};if(options.twoFillers&&p.filler_items?.length)p.filler_items.push({...p.filler_items[0],creative_id:'creative2'});if(options.partialAllowance&&p.items.length)p.items.push({...p.items[0],campaign_id:'campaign2',creative_id:'creative2'});return p;};
 const code=issuePairing(db,db.screens[0]);const paired=deviceRoute(db,'POST',['pair'],{code:code.code},null,{playlist:callback,playerProtocol:2}).body;
 if(options.diagnostic){db.campaigns=[];require('./load-lib.cjs')('diagnostics').requestDiagnostic(db,db.screens[0],{id:'admin'},{config,config_version:7});}
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/_next/static/'))u.pathname=u.pathname.replace('/_next/static/','/');requests.push({method:req.method,path:u.pathname});
  if(u.pathname==='/player-sw.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(root,'public/player-sw.js')));return;}
  if(u.pathname.startsWith('/api/playlist/')&&options.failFirstPlaylist&&!playlistFailed){playlistFailed=true;res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"Fixture connection failed"}');return;}
  if(u.pathname.startsWith('/models/coco-ssd/')){res.setHeader('Content-Type',u.pathname.endsWith('.json')?'application/json':'application/octet-stream');res.end(fs.readFileSync(path.join(root,'public',u.pathname)));return;}
  if(u.pathname==='/tf.js'||u.pathname==='/coco.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(root,u.pathname==='/tf.js'?'node_modules/@tensorflow/tfjs/dist/tf.min.js':'node_modules/@tensorflow-models/coco-ssd/dist/coco-ssd.min.js')));return;}
  if(overrides.has(u.pathname)){const o=overrides.get(u.pathname);res.writeHead(o.status,{'Content-Type':'application/json'});res.end(JSON.stringify(o.body));return;}
  if(u.pathname.startsWith('/api/')){
   let data='';for await(const part of req)data+=part;
   const body=data?JSON.parse(data):{},token=req.headers.authorization?.replace(/^Bearer /,'');
   const result=deviceRoute(db,req.method,u.pathname.slice(5).split('/'),body,token,{playlist:callback,playerProtocol:2});
   if(u.pathname==='/api/diagnostic/result'&&options.loseFirstDiagnosticAck&&!failedAck){failedAck=true;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Diagnostic accepted; acknowledgement lost'}));return;}
   if(u.pathname==='/api/play'){
    bodies.push(body);replies.push(result);if(options.partialAllowance&&body.campaign_id==='campaign1')db.campaigns[0].committed_budget=100;stopItems=!options.continuous;
    if(options.loseFirstAck&&!failedAck){failedAck=true;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Accepted server-side; response lost in fixture'}));return;}
   }
   res.writeHead(result?.status||200,{'Content-Type':'application/json'});res.end(JSON.stringify(result?.body||{}));return;
  }
  if(u.pathname==='/diagnostics/screen-test.mp4'){const clip=fs.readFileSync(path.join(root,'public/diagnostics/screen-test.mp4'));res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':clip.length});res.end(clip);return;}
  if(u.pathname==='/fixture.png'){res.writeHead(200,{'Content-Type':'image/png','Content-Length':picture.length});res.end(picture);return;}
  if(u.pathname==='/fixture.webm'){res.writeHead(200,{'Content-Type':'video/webm','Content-Length':video.length});res.end(video);return;}
  if(u.pathname==='/react.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(root,'node_modules/react/umd/react.development.js')));return;}
  if(u.pathname==='/react-dom.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(root,'node_modules/react-dom/umd/react-dom.development.js')));return;}
  if(u.pathname==='/player.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle());return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><title>Gridcast player integration fixture</title></head><body><div id="root"></div><script src="/_next/static/react.js"></script><script src="/_next/static/react-dom.js"></script>'+(options.realModel?'<script src="/tf.js"></script><script src="/coco.js"></script>':'')+'<script src="/_next/static/player.js"></script></body></html>');
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${server.address().port}`;
 let browser;
 try{
  browser=await chromium.launch({executablePath,headless:true,args:['--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--enable-unsafe-swiftshader']});
  const context=await browser.newContext();const page=await context.newPage(),pageErrors=[];page.setDefaultTimeout(20000);
  let failStartup;const pageFailure=new Promise((_,reject)=>{failStartup=reject;});
  page.on('pageerror',error=>{pageErrors.push(error.message);failStartup(new Error('Player fixture browser error: '+error.message));});
  await page.addInitScript(({credential,options})=>{
    if(!options.unpaired&&!localStorage.getItem('gc_device'))localStorage.setItem('gc_device',JSON.stringify(credential));window.fixtureModelWorking=!!options.modelWorking;window.fixtureRealModel=!!options.realModel;
    window.fixtureLoadWait=!!options.loadWait;
    if(options.blockUnmutedAudio){const original=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(this.matches?.('video[data-role="creative"]')&&!this.muted&&!window.fixtureUnmutedBlocked){window.fixtureUnmutedBlocked=true;return Promise.reject(new DOMException('Audio autoplay blocked','NotAllowedError'));}return original.call(this);};}
    if(options.youtube){window.YT={Player:function(_host,playerOptions){let videoId='',startedAt=0,endTimer;const player={muted:true,startedAt:0,mute(){this.muted=true;},unMute(){this.muted=false;},setVolume(v){this.volume=v;},loadVideoById({videoId:id}){videoId=id;},getVideoData(){return {video_id:videoId};},getCurrentTime(){return startedAt?Math.max(0,(Date.now()-startedAt)/1000):0;},playVideo(){if(options.blockYouTubeAudio&&!this.muted&&!window.fixtureYouTubeBlocked){window.fixtureYouTubeBlocked=true;playerOptions.events.onAutoplayBlocked();return;}startedAt=Date.now();this.startedAt=startedAt;playerOptions.events.onStateChange({data:1});clearTimeout(endTimer);endTimer=setTimeout(()=>playerOptions.events.onStateChange({data:0}),2000);},stopVideo(){clearTimeout(endTimer);startedAt=0;this.startedAt=0;},destroy(){clearTimeout(endTimer);}};window.fixtureYT=player;setTimeout(()=>playerOptions.events.onReady({target:player}),0);return player;}};}
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{
      window.fixtureCameraStarts=(window.fixtureCameraStarts||0)+1;window.fixtureConstraints=constraints;
      if(options.failFirstCamera&&!window.fixtureCameraFailed){window.fixtureCameraFailed=true;throw new DOMException('Fixture blocked','NotAllowedError');}
      // Capture constraints for assertions; the synthetic camera has no real device ID.
      const result=await original({audio:false,video:{width:640,height:480}});window.fixtureStream=result;return result;
    };
  },{credential:{token:paired.token,device_id:paired.device.id,screen_id:'screen1'},options});
  await Promise.race([pageFailure,(async()=>{await page.goto(base+'/player');if(options.image)await page.waitForFunction(()=>document.querySelector('img')?.naturalWidth>0);else if(options.youtube)await page.waitForFunction(()=>window.fixtureYT?.startedAt>0,{},{timeout:15000});else if(!options.empty&&!options.unpaired)await page.waitForFunction(()=>{const v=document.querySelector('video[data-role="creative"][data-active="true"]');return v&&!v.paused&&v.currentTime>.1;},{},{timeout:15000});})()]);
  return {page,db,requests,bodies,replies,paired,pageErrors,setConfig:values=>{Object.assign(config,values);configVersion++;},setReply:(path,reply)=>reply?overrides.set(path,reply):overrides.delete(path),cleanup:async()=>{await browser.close();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true});assert.deepEqual(pageErrors,[],'Player fixture must not have uncaught browser errors');}};
 }catch(e){await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true});throw e;}
}
const waitFor=async(fn,ms=15000)=>{const until=Date.now()+ms;while(!fn()){if(Date.now()>until)throw new Error('Timed out waiting for playback report');await new Promise(r=>setTimeout(r,25));}};
const waitForBrowser=async(page,read,arg,ms=15000)=>{const until=Date.now()+ms;while(Date.now()<until){const value=await page.evaluate(read,arg);if(value)return value;await new Promise(r=>setTimeout(r,25));}throw new Error('Timed out waiting for durable browser state');};
test('actual native media excludes paused/waiting time, emits one delivery, and camera failure stays null', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness();try{
  assert.ok((await h.page.locator('body').innerText()).includes('Media playback'));
  assert.ok(!(await h.page.locator('body').innerText()).includes('Browser fixture'));
  await h.page.evaluate(()=>{const v=document.querySelector('video[data-role="creative"][data-active="true"]');window.fixtureFirstVideo=v;v.pause();v.dispatchEvent(new Event('waiting'));});
  await new Promise(r=>setTimeout(r,1200));
  await h.page.evaluate(()=>document.querySelector('video[data-role="creative"][data-active="true"]').play());
  await waitFor(()=>h.bodies.length>0);
  // The slot already finalized. Late duplicate browser end notifications cannot append it again.
  await h.page.evaluate(()=>{const v=window.fixtureFirstVideo;v.dispatchEvent(new Event('ended'));v.dispatchEvent(new Event('ended'));});
  await new Promise(r=>setTimeout(r,100));
  assert.equal(h.bodies.length,1);assert.equal(h.db.plays.length,1);
  const body=h.bodies[0];assert.ok(body.playing_duration_ms>=1800&&body.playing_duration_ms<=2200,JSON.stringify(body));
  assert.ok(Date.parse(body.ended_at_device)-Date.parse(body.started_at_device)>=3000);
  assert.equal(body.measured,false);assert.equal(body.avg_persons,null);assert.equal(body.sample_count,0);assert.equal(body.model_ver,null);
  assert.equal(h.db.plays[0].billable,true);assert.equal(h.db.campaigns[0].accrued_spend,2);
  assert.ok(!h.requests.some(r=>r.method==='POST'&&r.path.endsWith('/frame')));
 }finally{await h.cleanup();}
});
test('lost acknowledgement survives player reload and retries same immutable UID without double accrual', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({loseFirstAck:true});try{
  await waitFor(()=>h.bodies.length>0);const first=h.bodies[0];assert.equal(h.db.plays.length,1);
  await h.page.reload();
  await waitFor(()=>h.bodies.length>1,15000);
  assert.deepEqual(h.bodies[1],first);assert.equal(h.replies[1].body.duplicate,true);assert.equal(h.db.plays.length,1);assert.equal(h.db.campaigns[0].accrued_spend,2);
  await waitForBrowser(h.page,async id=>(await window.fixtureQueue.queueStatus(id)).pending===0,h.paired.device.id);
  assert.ok(h.requests.filter(r=>r.path.startsWith('/api/playlist/')).length<=3,'An empty playlist must not cause a fetch loop');
  assert.ok(!h.requests.some(r=>r.path.endsWith('/frame')));
 }finally{await h.cleanup();}
});

test('fake camera and deterministic detector carry the actual model version and valid samples', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({modelWorking:true,continuous:true});try{
  await waitFor(()=>h.bodies.some(p=>p.measured),15000);
  const body=h.bodies.find(p=>p.measured);assert.equal(body.avg_persons,1);assert.ok(body.sample_count>0);assert.equal(body.model_ver,'coco-ssd@2.2.3/lite_mobilenet_v2');
  const calls=await h.page.evaluate(()=>window.fixtureDetectCalls);assert.ok(calls.length);assert.ok(calls.every(c=>c.maxBoxes===50&&c.minScore===.45));
  const at=h.bodies.indexOf(body);assert.equal(h.replies[at].status,undefined);assert.equal(h.replies[at].body.billable,true);
  assert.ok(!h.requests.some(r=>r.path.endsWith('/frame')));
 }finally{await h.cleanup();}
});

test('continuous rotation restarts the two-second ad without waiting for the old four-second loop', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({continuous:true});try{
  await waitFor(()=>h.bodies.length===1);const first=h.bodies[0];
  assert.equal(await h.page.getByText(/Reserved loop time/).count(),0);
  await waitFor(()=>h.bodies.length===2,10000);const second=h.bodies[1];
  assert.ok(Date.parse(second.started_at_device)-Date.parse(first.started_at_device)<2800, 'No fixed loop padding or intentional 300ms pause');
  assert.equal(h.db.plays.length,2);assert.equal(h.db.campaigns[0].accrued_spend,4);
 }finally{await h.cleanup();}
});

test('camera track ending mid-play invalidates earlier samples and following plays remain unmeasured', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({modelWorking:true,continuous:true});try{
  await waitFor(()=>h.bodies.length>=1);
  // Wait for a later play that begins with a healthy camera and captures a sample.
  await h.page.waitForFunction(()=>{const v=document.querySelector('video[data-role="creative"][data-active="true"]');return v&&!v.paused&&v.currentTime>.7&&v.currentTime<1.5;});
  await h.page.evaluate(()=>{const camera=document.querySelector('video[data-role="camera"]');camera.srcObject.getVideoTracks().forEach(t=>{t.stop();t.dispatchEvent(new Event('ended'));});});
  await waitFor(()=>h.bodies.length>=2);
  const failed=h.bodies[1];assert.equal(failed.measured,false);assert.equal(failed.avg_persons,null);assert.equal(failed.sample_count,0);assert.equal(failed.model_ver,null);
  await waitFor(()=>h.bodies.length>=3,15000);assert.equal(h.bodies[2].measured,false);assert.equal(h.bodies[2].avg_persons,null);
 }finally{await h.cleanup();}
});
test('camera recovery does not relabel the interrupted play but restores measurement for a later play', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({modelWorking:true,continuous:true});try{
  await waitFor(()=>h.bodies.length>=1);
  await h.page.waitForFunction(()=>{const v=document.querySelector('video[data-role="creative"][data-active="true"]');return v&&!v.paused&&v.currentTime>.7&&v.currentTime<1.5;});
  await h.page.evaluate(()=>document.querySelector('video[data-role="camera"]').pause());
  await new Promise(r=>setTimeout(r,150));
  await h.page.evaluate(()=>document.querySelector('video[data-role="camera"]').play());
  await waitFor(()=>h.bodies.length>=2);assert.equal(h.bodies[1].measured,false);assert.equal(h.bodies[1].avg_persons,null);
  await waitFor(()=>h.bodies.length>=3,15000);assert.equal(h.bodies[2].measured,true);assert.equal(h.bodies[2].avg_persons,1);
 }finally{await h.cleanup();}
});


test('permission failure is explained and retry recovers without re-pairing', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({modelWorking:true,continuous:true,failFirstCamera:true});try{
  await h.page.getByText(/Camera permission blocked/).waitFor();
  assert.equal(await h.page.evaluate(()=>window.fixtureLoads||0),0,'Do not download the model before camera permission');
  await h.page.getByRole('button',{name:'Retry camera',exact:true}).click();
  await waitFor(()=>h.bodies.some(p=>p.measured));
  assert.equal(h.bodies[0].measured,false,'Retry must not relabel the interrupted play');
  assert.equal(h.bodies.find(p=>p.measured).avg_persons,1);
 }finally{await h.cleanup();}
});
test('model failure is explained and retry loads the detector again', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({continuous:true});try{
  await h.page.getByText(/People detector could not load/).waitFor();
  await h.page.evaluate(()=>{window.fixtureModelWorking=true;});
  await h.page.getByRole('button',{name:'Retry camera',exact:true}).click();
  await waitFor(()=>h.bodies.some(p=>p.measured));
  assert.equal(await h.page.evaluate(()=>window.fixtureLoads),2);
 }finally{await h.cleanup();}
});
test('recovered first playlist initializes camera, applies capture settings and skips idle inference', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({modelWorking:true,empty:true,failFirstPlaylist:true,config:{camera_device_id:'chosen-camera',inference_res:'320x240'}});try{
  await h.page.getByText(/Ready · counts update/).waitFor({timeout:15000});
  const constraints=await h.page.evaluate(()=>window.fixtureConstraints);
  assert.equal(constraints.video.deviceId.exact,'chosen-camera');assert.equal(constraints.video.width.ideal,320);assert.equal(constraints.video.frameRate.ideal,15);
  await new Promise(r=>setTimeout(r,1200));assert.equal(await h.page.evaluate(()=>window.fixtureDetectCalls?.length||0),0);
  assert.equal(h.bodies.length,0);
  await h.page.evaluate(()=>document.querySelector('video[data-role="camera"]').pause());
  await h.page.getByText(/Camera interrupted/).waitFor();
  await h.page.evaluate(()=>document.querySelector('video[data-role="camera"]').play());
  await h.page.getByText(/Ready · counts update/).waitFor();
 }finally{await h.cleanup();}
});
test('inference uses bounded frames and a delayed result cannot cross a pause/resume boundary', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({modelWorking:true,continuous:true,config:{inference_res:'320x240'}});try{
  await waitFor(()=>h.bodies.length>=1);
  await h.page.evaluate(()=>{window.fixtureDetectWait=true;window.fixtureDetectCalls=[];});
  await h.page.waitForFunction(()=>!!window.fixtureReleaseDetect);
  await h.page.evaluate(async()=>{const v=document.querySelector('video[data-role="creative"][data-active="true"]');v.pause();await v.play();window.fixtureReleaseDetect();});
  await h.page.waitForFunction(()=>window.fixtureFrame.getContext('2d').getImageData(0,0,1,1).data[3]===0);
  await h.page.evaluate(()=>document.querySelector('video[data-role="creative"][data-active="true"]').pause());
  await new Promise(r=>setTimeout(r,700));
  assert.equal(await h.page.evaluate(()=>window.fixtureDetectCalls.length),1,'No repeated inference while paused');
  await h.page.evaluate(()=>{window.fixtureDetectWait=false;document.querySelector('video[data-role="creative"][data-active="true"]').dispatchEvent(new Event('ended'));});
  await waitFor(()=>h.bodies.length>=2);
  assert.equal(h.bodies[1].sample_count,0);assert.equal(h.bodies[1].measured,false);
  const calls=await h.page.evaluate(()=>window.fixtureDetectCalls);assert.equal(calls[0].width,320);assert.equal(calls[0].height,240);assert.ok(calls.every(c=>c.playing));
 }finally{await h.cleanup();}
});
test('credential rejection during model loading stops capture and disposes a late model', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({modelWorking:true,empty:true,loadWait:true});try{
  await h.page.waitForFunction(()=>!!window.fixtureReleaseLoad);
  h.db.devices[0].status='revoked';
  await h.page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await h.page.getByRole('button',{name:'Retry existing pairing'}).waitFor();
  await h.page.evaluate(()=>window.fixtureReleaseLoad());
  await h.page.waitForFunction(()=>window.fixtureDisposed===1);
  assert.ok(await h.page.evaluate(()=>window.fixtureStream.getTracks().every(t=>t.readyState==='ended')));
 }finally{await h.cleanup();}
});
test('real pinned TensorFlow model loads and infers in Chromium using self-hosted assets', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({modelWorking:true,realModel:true,continuous:true});try{
  await waitFor(()=>h.bodies.some(p=>p.measured),60000);
  assert.ok(h.requests.some(r=>r.path==='/models/coco-ssd/model.json'));
  assert.equal(h.requests.filter(r=>r.path.includes('group1-shard')).length,5);
  assert.ok(!h.requests.some(r=>r.path.endsWith('/frame')));
  console.log('Real browser detector backend:',await h.page.evaluate(()=>window.tf.getBackend()));
 }finally{await h.cleanup();}
});


test('downscaling preserves minimum subject size in source pixels and clears raw snapshots', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({modelWorking:true,continuous:true,config:{inference_res:'320x240',min_box_px:150}});try{
  await waitFor(()=>h.bodies.some(p=>p.measured));
  assert.equal(h.bodies.find(p=>p.measured).avg_persons,1,'100px snapshot box is 200px in the 640x480 camera frame');
  assert.equal(await h.page.evaluate(()=>window.fixtureFrame.getContext('2d').getImageData(50,50,1,1).data[3]),0,'Do not retain camera pixels');
 }finally{await h.cleanup();}
});


test('diagnostic native playback requires no campaign, keeps commercial storage empty, and reload does not run twice', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({empty:true,diagnostic:true,modelWorking:true,loseFirstDiagnosticAck:true});try{
  try { await waitFor(()=>h.db.diagnostic_results?.length===1,35000); } catch(error) { console.error('Diagnostic fixture failure',h.db.diagnostic_assignments,await h.page.locator('body').innerText(),h.requests.filter(r=>r.path.includes('diagnostic')));throw error; }
  assert.equal(h.db.plays.length,0);assert.equal(h.db.presence.length,0);assert.deepEqual(h.db.campaigns,[]);
  assert.equal(h.requests.filter(r=>r.path==='/api/play').length,0);
  assert.equal(h.db.diagnostic_results[0].diagnostic,true);assert.equal(h.db.diagnostic_results[0].billable,false);
  assert.equal(h.db.diagnostic_results[0].measured,true);assert.equal(h.db.diagnostic_results[0].avg_persons,1);
  assert.equal(h.db.devices[0].assignment_uses,undefined);assert.equal(h.db.devices[0].airtime_buckets,undefined);
  assert.ok(await h.page.evaluate(id=>window.fixtureDiagnostic.pendingDiagnostic(id),h.paired.device.id),'Lost acknowledgement keeps result durable');
  await h.page.reload();
  await waitForBrowser(h.page,async id=>!(await window.fixtureDiagnostic.pendingDiagnostic(id)),h.paired.device.id);
  await new Promise(r=>setTimeout(r,1500));
  assert.equal(h.requests.filter(r=>r.path==='/api/diagnostic/start').length,1);
  assert.equal(h.db.diagnostic_results.length,1);
 }finally{await h.cleanup();}
});


test('uploaded image waits for decode and reports visible duration with no video timeline claim', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({image:true,continuous:true});try{
  await waitFor(()=>h.bodies.length>0);
  const body=h.bodies[0];assert.equal(body.media_evidence,'image_decode');assert.equal(body.decoded_width,128);assert.equal(body.decoded_height,72);
  assert.ok(body.visible_duration_ms>=2000);assert.equal(body.media_ended_s,0);assert.equal(body.ended_reason,'duration_observed');assert.equal(h.replies[0].body.billable,true);
 }finally{await h.cleanup();}
});


test('uploaded media and player shell restart offline with saved allowances and buffered receipts', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({offline:true,continuous:true});try{
  await waitForBrowser(h.page,async()=>!!navigator.serviceWorker.controller && !!(await window.fixtureCache.readySchedule(JSON.parse(localStorage.getItem('gc_device')).device_id)));
  await waitForBrowser(h.page,async()=>{const c=await caches.open('gridcast-player-shell-v1');return !!(await c.match('/_next/static/player.js'))&&!!(await c.match('/_next/static/react.js'))&&!!(await c.match('/_next/static/react-dom.js'))});
  await h.page.context().setOffline(true);await h.page.reload();
  await h.page.waitForFunction(()=>{const v=document.querySelector('video[data-role="creative"][data-active="true"]');return v&&!v.paused&&v.currentTime>.1;});
  await waitForBrowser(h.page,async id=>(await window.fixtureQueue.queueStatus(id)).pending>=1,h.paired.device.id);
  assert.ok(await h.page.evaluate(id=>window.fixtureCache.readySchedule(id),h.paired.device.id));
  await h.page.context().setOffline(false);await waitFor(()=>h.bodies.length>0);
 }finally{await h.cleanup();}
});


test('filler rotates without attributing a campaign or charging an advertiser', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({filler:true,continuous:true});try{
  await waitFor(()=>h.bodies.length>=2);
  assert.ok(h.bodies.every(b=>b.kind==='filler'&&b.campaign_id===null));
  assert.ok(h.db.plays.every(p=>p.kind==='filler'&&!p.billable&&p.campaign_id===null));
  assert.equal(h.db.campaigns[0].accrued_spend,0);
 }finally{await h.cleanup();}
});

test('hiding an image interrupts display evidence and cannot bill its remaining timer', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({image:true,continuous:true});try{
  await h.page.waitForFunction(()=>document.body.innerText.includes('Playing'));
  await h.page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await waitFor(()=>h.bodies.length>0);
  assert.equal(h.bodies[0].ended_reason,'interrupted');assert.ok(h.bodies[0].visible_duration_ms<2000);assert.equal(h.replies[0].body.billable,false);
 }finally{await h.cleanup();}
});


test('two eligible fillers take alternating turns rather than repeatedly selecting the first', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({filler:true,twoFillers:true,continuous:true});try{
  await waitFor(()=>h.bodies.length>=3);
  assert.deepEqual(h.bodies.slice(0,3).map(p=>p.creative_id),['creative1','creative2','creative1']);
  assert.ok(h.db.plays.every(p=>!p.billable&&p.campaign_id===null));
 }finally{await h.cleanup();}
});

test('an exhausted paid allowance refreshes promptly while another campaign keeps playing', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({partialAllowance:true,continuous:true});try{
  await waitFor(()=>h.bodies.filter(p=>p.campaign_id==='campaign1').length>=2,15000);
  const own=h.bodies.filter(p=>p.campaign_id==='campaign1');
  assert.notEqual(own[0].assignment_id,own[1].assignment_id);
  assert.ok(Date.parse(own[1].started_at_device)-Date.parse(own[0].started_at_device)<12000);
  assert.ok(h.bodies.some(p=>p.campaign_id==='campaign2'));
 }finally{await h.cleanup();}
});


test('Release A hides commissioning without interrupting real frames or detector samples across config toggles', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({modelWorking:true,continuous:true,config:{diagnostics_overlay:false}});try{
  await waitFor(()=>h.bodies.some(p=>p.measured));
  assert.equal(await h.page.locator('[data-role="commissioning-preview"]').getAttribute('aria-hidden'),'true');
  assert.equal(await h.page.locator('[data-role="commissioning-stats"]').count(),0);
  assert.equal(await h.page.getByRole('button',{name:/Export|Clear saved|Enter a new/}).count(),0);
  const starts=await h.page.evaluate(()=>window.fixtureCameraStarts);
  await h.page.evaluate(()=>{window.fixtureCameraElement=document.querySelector('[data-role="camera"]');window.fixtureCameraStream=window.fixtureStream;document.body.click();});
  assert.equal(await h.page.locator('[data-role="commissioning-preview"]').getAttribute('aria-hidden'),'true');
  h.setConfig({diagnostics_overlay:true});await h.page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await h.page.locator('[data-role="commissioning-stats"]').waitFor();
  h.setConfig({diagnostics_overlay:false});await h.page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await h.page.waitForFunction(()=>document.querySelector('[data-role="commissioning-preview"]').style.opacity==='0');
  const n=h.bodies.length;await waitFor(()=>h.bodies.length>n&&h.bodies.at(-1).measured);
  assert.ok(await h.page.evaluate(()=>document.querySelector('[data-role="camera"]')===window.fixtureCameraElement&&window.fixtureStream===window.fixtureCameraStream));
  assert.equal(await h.page.evaluate(()=>window.fixtureCameraStarts),starts,'Visibility/config-version alone does not restart capture');
  assert.equal(await h.page.evaluate(()=>window.fixtureLoads),1);
  assert.equal(await h.page.locator('[data-role="commissioning-preview"] button').count(),0);
 }finally{await h.cleanup();}
});

test('Release A rejected pairing is non-destructive on cancel/failure, retries temporary disable, and preserves records on replacement', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({modelWorking:true,continuous:true});try{
  await waitFor(()=>h.bodies.length>0);
  const old=await h.page.evaluate(()=>localStorage.getItem('gc_device'));
  h.db.screens[0].status='disabled';await h.page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await h.page.getByRole('button',{name:'Retry existing pairing'}).waitFor();
  assert.equal(await h.page.locator('[data-role="commissioning-preview"]').getAttribute('aria-hidden'),'true');
  assert.equal(await h.page.getByRole('button',{name:/Export|Clear saved/}).count(),0);
  await h.page.getByRole('button',{name:'Enter a new pairing code'}).click();
  await h.page.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await h.page.evaluate(()=>localStorage.getItem('gc_device')),old);
  await h.page.getByRole('button',{name:'Enter a new pairing code'}).click();
  await h.page.getByRole('textbox',{name:'Pairing code'}).fill('ZZZZZZZZ');
  await h.page.getByRole('button',{name:'Confirm replacement and keep records'}).click();
  await h.page.getByText('Invalid or expired pairing code',{exact:true}).waitFor();
  assert.equal(await h.page.evaluate(()=>localStorage.getItem('gc_device')),old);
  await h.page.getByRole('button',{name:'Cancel',exact:true}).click();h.db.screens[0].status='active';
  await h.page.getByRole('button',{name:'Retry existing pairing'}).click();
  await h.page.waitForFunction(()=>{const v=document.querySelector('[data-role="creative"][data-active="true"]');return v&&!v.paused;});
  assert.equal(await h.page.evaluate(()=>localStorage.getItem('gc_device')),old);
  h.db.devices[0].status='revoked';await h.page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await h.page.getByRole('button',{name:'Enter a new pairing code'}).click();
  await h.page.getByText(/pending and .*blocked delivery records/).waitFor();
  const before=await h.page.evaluate(id=>window.fixtureQueue.queuedPlays(id),h.paired.device.id);assert.ok(before.length);
  const code=issuePairing(h.db,h.db.screens[0]);
  await h.page.getByRole('textbox',{name:'Pairing code'}).fill(code.code);
  await h.page.getByRole('button',{name:'Confirm replacement and keep records'}).click();
  await h.page.waitForFunction(id=>JSON.parse(localStorage.getItem('gc_device')).device_id!==id,h.paired.device.id);
  const after=await h.page.evaluate(id=>window.fixtureQueue.queuedPlays(id),h.paired.device.id);
  assert.deepEqual(after.map(x=>x.event),before.map(x=>x.event));
 }finally{await h.cleanup();}
});

test('Release A report-upload 401 offers recovery but storage failures expose no maintenance', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({continuous:true,config:{diagnostics_overlay:false}});try{
  h.setReply('/api/play',{status:401,body:{error:'Rejected'}});
  await h.page.getByRole('button',{name:'Retry existing pairing'}).waitFor({timeout:15000});
  assert.equal(await h.page.locator('[data-role="commissioning-stats"]').count(),0);
  assert.equal(await h.page.getByRole('button',{name:/Export|Clear saved/}).count(),0);
  assert.ok((await h.page.evaluate(id=>window.fixtureQueue.queuedPlays(id),h.paired.device.id)).length);
 }finally{await h.cleanup();}
 const q=await harness({continuous:true,config:{diagnostics_overlay:false}});try{
  await q.page.evaluate(()=>{window.fixtureQueue.queueCapacity=async()=>false;window.fixtureQueue.queueStatus=async()=>({pending:0,blocked:2,total:2});});
  await q.page.getByText(/Saved delivery records need authorized review/).waitFor({timeout:10000});
  assert.equal(await q.page.getByRole('button',{name:/Export|Clear saved|Enter a new/}).count(),0);
  assert.equal(await q.page.locator('[data-role="commissioning-preview"]').getAttribute('aria-hidden'),'true');
 }finally{await q.cleanup();}
});

test('Release A diagnostic-result 401 closes commissioning and offers retry', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({empty:true,diagnostic:true,modelWorking:true,config:{diagnostics_overlay:false}});try{
  h.setReply('/api/diagnostic/result',{status:401,body:{error:'Rejected'}});
  await h.page.locator('[data-role="commissioning-stats"]').waitFor({timeout:15000});
  await h.page.getByRole('button',{name:'Retry existing pairing'}).waitFor({timeout:35000});
  assert.equal(await h.page.locator('[data-role="commissioning-preview"]').getAttribute('aria-hidden'),'true');
  assert.equal(await h.page.getByRole('button',{name:/Export|Clear saved/}).count(),0);
  const rows=await h.page.evaluate(id=>window.fixtureDiagnostic.diagnosticRecordCounts(id),h.paired.device.id);
  assert.ok(rows.blocked>=1);
 }finally{await h.cleanup();}
});


test('Release A unpaired tab cannot replace credentials stored by another tab', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({unpaired:true});try{
  await h.page.getByRole('textbox',{name:'Pairing code'}).waitFor();
  const other=await h.page.context().newPage();await other.goto(h.page.url());
  const saved={token:h.paired.token,device_id:h.paired.device.id,screen_id:'screen1'};
  await other.evaluate(c=>localStorage.setItem('gc_device',JSON.stringify(c)),saved);
  await h.page.getByRole('textbox',{name:'Pairing code'}).fill('ZZZZZZZZ');
  await h.page.getByRole('button',{name:'Pair and play'}).click();
  await h.page.getByText('Another tab has paired this browser. Reload this player.').waitFor();
  assert.equal(h.requests.filter(r=>r.path==='/api/pair').length,0);
  assert.deepEqual(await h.page.evaluate(()=>JSON.parse(localStorage.getItem('gc_device'))),saved);
  await other.close();
 }finally{await h.cleanup();}
});

test('Release A incomplete pairing reply preserves the old identity and evidence', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({continuous:true});try{
  const old=await h.page.evaluate(()=>localStorage.getItem('gc_device'));
  h.db.devices[0].status='revoked';await h.page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await h.page.getByRole('button',{name:'Enter a new pairing code'}).click();
  h.setReply('/api/pair',{status:200,body:{token:'incomplete'}});
  await h.page.getByRole('textbox',{name:'Pairing code'}).fill('ZZZZZZZZ');
  await h.page.getByRole('button',{name:'Confirm replacement and keep records'}).click();
  await h.page.getByText(/Pairing response was incomplete/).waitFor();
  assert.equal(await h.page.evaluate(()=>localStorage.getItem('gc_device')),old);
  assert.ok((await h.page.evaluate(id=>window.fixtureQueue.queuedPlays(id),h.paired.device.id)).length);
 }finally{await h.cleanup();}
});

test('Release A a failed receipt write is retained in memory and retried with its original identity', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({continuous:true,config:{diagnostics_overlay:false}});try{
  await h.page.evaluate(()=>{window.originalEnqueue=window.fixtureQueue.enqueuePlay;window.fixtureQueue.enqueuePlay=async(id,event)=>{window.fixtureFailedEvent=event;throw new Error('Fixture storage temporarily full');};});
  await h.page.getByText('A delivery record could not be saved. Keep this player open while storage is retried.').waitFor({timeout:12000});
  assert.equal(await h.page.getByRole('button',{name:/Export|Clear saved|Enter a new/}).count(),0);
  await h.page.evaluate(()=>{window.fixtureQueue.enqueuePlay=window.originalEnqueue;});
  const row=await waitForBrowser(h.page,async id=>(await window.fixtureQueue.queuedPlays(id)).find(row=>row.event.play_uid===window.fixtureFailedEvent.play_uid),h.paired.device.id,12000);
  const original=await h.page.evaluate(()=>window.fixtureFailedEvent);
  assert.equal(row.device_id,h.paired.device.id);assert.equal(row.event.play_uid,original.play_uid);assert.equal(row.event.ended_reason,original.ended_reason);
 }finally{await h.cleanup();}
});


test('Release A diagnostic storage failure is visible without exposing tools or consuming a run', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({empty:true,diagnostic:true,modelWorking:true,loadWait:true,config:{diagnostics_overlay:false}});try{
  await h.page.waitForFunction(()=>!!window.fixtureReleaseLoad);
  await h.page.evaluate(()=>{window.fixtureDiagnostic.reserveDiagnostic=async()=>{throw new Error('Fixture diagnostic storage full');};window.fixtureReleaseLoad();});
  await h.page.getByText(/Diagnostic storage is full or unavailable/).waitFor({timeout:12000});
  assert.equal(h.requests.filter(r=>r.path==='/api/diagnostic/start').length,0);
  assert.equal(await h.page.getByRole('button',{name:/Export|Clear saved|Enter a new/}).count(),0);
  assert.equal(await h.page.locator('[data-role="commissioning-preview"]').getAttribute('aria-hidden'),'true');
 }finally{await h.cleanup();}
});


test('Release B maintenance lease waits for active-player evidence, keeps playback paused and resumes after release', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({continuous:true});try{
  await h.page.evaluate(()=>{
   const original=fixtureQueue.enqueuePlay;window.fixtureOriginalWriter=original;
   fixtureQueue.enqueuePlay=async(...args)=>{window.fixtureSaving=true;await new Promise(resolve=>window.fixtureFinishSave=resolve);return original(...args);};
   window.fixtureLeasePromise=fixtureEvidence.holdPlayerEvidence(JSON.parse(localStorage.getItem('gc_device')).device_id).then(lease=>{window.fixtureLease=lease;});
  });
  await h.page.waitForFunction(()=>window.fixtureSaving===true);
  assert.equal(await h.page.evaluate(()=>!!window.fixtureLease),false);
  await h.page.evaluate(()=>{window.fixtureFinishSave();});await h.page.waitForFunction(()=>!!window.fixtureLease);
  await h.page.evaluate(()=>fixtureEvidence.verifyPlayerTabs());
  const saved=await h.page.evaluate(async()=>({rows:(await fixtureQueue.queuedPlays()).length,paused:document.querySelector('video[data-role="creative"][data-active="true"]').paused}));
  assert.ok(saved.rows>=1);assert.equal(saved.paused,true);
  await new Promise(r=>setTimeout(r,2300));
  assert.equal(await h.page.evaluate(async()=>(await fixtureQueue.queuedPlays()).length),saved.rows);
  await h.page.evaluate(()=>{fixtureQueue.enqueuePlay=window.fixtureOriginalWriter;window.fixtureLease.release();});
  await h.page.waitForFunction(()=>{const v=document.querySelector('video[data-role="creative"][data-active="true"]');return v&&!v.paused&&v.currentTime>.1;});
 }finally{await h.cleanup();}
});


test('Release B replacement leaves an old player tab stopped after its maintenance lease releases', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({continuous:true});try{
  await h.page.evaluate(async()=>{window.fixtureLease=await fixtureEvidence.holdPlayerEvidence(JSON.parse(localStorage.getItem('gc_device')).device_id);});
  const requests=h.requests.filter(r=>r.path.startsWith('/api/playlist/')).length;
  await h.page.evaluate(()=>{const previous=localStorage.getItem('gc_device'),next=JSON.stringify({token:'replacement-token',device_id:'replacement',screen_id:'replacement-screen'});localStorage.setItem('gc_device',next);window.dispatchEvent(new StorageEvent('storage',{key:'gc_device',oldValue:previous,newValue:next}));window.fixtureLease.release();});
  await h.page.getByText('Pairing changed in another tab. Reload this player. Saved records remain on this device.',{exact:true}).waitFor();
  await new Promise(r=>setTimeout(r,1200));
  assert.equal(h.requests.filter(r=>r.path.startsWith('/api/playlist/')).length,requests);
  assert.equal(await h.page.evaluate(()=>document.querySelector('video[data-role="creative"][data-active="true"]').paused),true);
 }finally{await h.cleanup();}
});

test('uploaded creatives use the default-on sound setting', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness();try{
  await h.page.waitForFunction(()=>{const v=document.querySelector('video[data-role="creative"][data-active="true"]');return v&&!v.paused&&v.currentTime>.1;});
  assert.equal(await h.page.locator('video[data-role="creative"][data-active="true"]').evaluate(v=>v.muted),false);
  assert.equal(await h.page.getByRole('button',{name:'Enable sound',exact:true}).count(),0);
  h.setConfig({audio_enabled:false});await h.page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await h.page.waitForFunction(()=>document.querySelector('video[data-role="creative"][data-active="true"]')?.muted===true);
 }finally{await h.cleanup();}
});

test('browser sound autoplay rejection retries muted and exposes gesture recovery without a second play', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({blockUnmutedAudio:true});try{
  await h.page.getByRole('button',{name:'Enable sound',exact:true}).waitFor();
  assert.equal(await h.page.locator('video[data-role="creative"][data-active="true"]').evaluate(v=>v.muted),true);
  await h.page.getByRole('button',{name:'Enable sound',exact:true}).click();
  await h.page.waitForFunction(()=>{const v=document.querySelector('video[data-role="creative"][data-active="true"]');return v&&!v.muted;});
  await waitFor(()=>h.bodies.length===1,5000);
  assert.equal(h.bodies.length,1,'Sound recovery must not create another delivery record');
 }finally{await h.cleanup();}
});

test('creative sound can be disabled by inherited playback config', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({config:{audio_enabled:false}});try{
  await h.page.waitForFunction(()=>{const v=document.querySelector('video[data-role="creative"][data-active="true"]');return v&&!v.paused&&v.currentTime>.1;});
  assert.equal(await h.page.locator('video[data-role="creative"][data-active="true"]').evaluate(v=>v.muted),true);
  assert.equal(await h.page.getByRole('button',{name:'Enable sound',exact:true}).count(),0);
 }finally{await h.cleanup();}
});

test('YouTube playback requests sound by default and uses the autoplay-blocked fallback', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({youtube:true,blockYouTubeAudio:true});try{
  await h.page.getByRole('button',{name:'Enable sound',exact:true}).waitFor();
  assert.equal(await h.page.evaluate(()=>window.fixtureYT.muted),true,'blocked YouTube autoplay should retry muted');
  await h.page.getByRole('button',{name:'Enable sound',exact:true}).click();
  await h.page.waitForFunction(()=>window.fixtureYT&&!window.fixtureYT.muted);
  await waitFor(()=>h.bodies.length===1,5000);
  assert.equal(h.bodies.length,1,'YouTube sound recovery must not create another delivery record');
 }finally{await h.cleanup();}
});
