const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {execFileSync} = require('node:child_process');
const ts = require('typescript');
const {chromium} = require('playwright');
const root=path.resolve(__dirname,'..');
const executablePath=[process.env.GC_TEST_BROWSER_PATH,chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium'].filter(Boolean).find(fs.existsSync);
const ffmpeg=[process.env.GC_TEST_FFMPEG_PATH,'/opt/homebrew/bin/ffmpeg','/usr/bin/ffmpeg'].filter(Boolean).find(fs.existsSync);
const compile = file=>ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const deviceModule={exports:{}};new Function('require','module','exports',compile('lib/devices.ts'))(require,deviceModule,deviceModule.exports);
const {issuePairing,deviceRoute}=deviceModule.exports;
const bundle=()=>`const q={exports:{}};new Function('module','exports',${JSON.stringify(compile('lib/player-queue.ts'))})(q,q.exports);
const player={exports:{}};const fixtureRequire=name=>{
 if(name==='react')return React;
 if(name==='@/lib/player-queue')return q.exports;
 if(name==='@/components/ui/button')return {Button:props=>React.createElement('button',props)};
 if(name==='@/components/ui/input')return {Input:props=>React.createElement('input',props)};
 if(name==='lucide-react')return {Monitor:()=>React.createElement('span')};
 if(name==='@tensorflow/tfjs')return {};
 if(name==='@tensorflow-models/coco-ssd')return {load:async()=>{if(!window.fixtureModelWorking)throw new Error('Fixture camera/model unavailable');return {detect:async(v,maxBoxes,minScore)=>{window.fixtureDetectCalls??=[];window.fixtureDetectCalls.push({maxBoxes,minScore,at:Date.now()});return [{class:'person',score:.46,bbox:[50,50,100,100]}]},dispose(){}}}};
 throw new Error('Unmapped browser test dependency '+name);
};
new Function('require','module','exports',${JSON.stringify(compile('app/player/page.tsx'))})(fixtureRequire,player,player.exports);
window.fixtureQueue=q.exports;
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(player.exports.default));`;
async function harness(options={}) {
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gridcast-playback-test-'));
 execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=128x72:r=25','-t','2','-an','-c:v','libvpx','-y',path.join(temp,'fixture.webm')]);
 const video=fs.readFileSync(path.join(temp,'fixture.webm'));
 const db={orgs:[{id:'org1',status:'active'}],screens:[{id:'screen1',org_id:'org1',status:'active',has_camera:true}],devices:[],device_assignments:[],plays:[],presence:[],campaigns:[{id:'campaign1',org_id:'org1',advertiser_id:'advertiser1',rate_type:'per_play',rate_value:2,accrued_spend:0}]};
 const requests=[],bodies=[],replies=[];let failedAck=false,base='',stopItems=false;
 const config={model:'coco-ssd',sample_interval_s:options.modelWorking?.5:2,loop_length_s:4,slot_duration_s:2,count_ceiling:50,camera_fail_mode:'continue',heartbeat_s:10,sync_interval_min:1,offline_buffer_plays:5000,telemetry_batch:25,telemetry_retry_h:72};
 const callback=()=>({config,config_version:7,items:stopItems?[]:[{campaign_id:'campaign1',creative_id:'creative1',creative_name:'Browser fixture',duration_s:2,rate_value:2,rate_type:'per_play',asset_url:base+'/fixture.webm',asset_id:'fixture',asset_mime:'video/webm',width:128,height:72}]});
 const code=issuePairing(db,db.screens[0]);const paired=deviceRoute(db,'POST',['pair'],{code:code.code},null,{playlist:callback}).body;
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');requests.push({method:req.method,path:u.pathname});
  if(u.pathname.startsWith('/api/')){
   let data='';for await(const part of req)data+=part;
   const body=data?JSON.parse(data):{},token=req.headers.authorization?.replace(/^Bearer /,'');
   const result=deviceRoute(db,req.method,u.pathname.slice(5).split('/'),body,token,{playlist:callback});
   if(u.pathname==='/api/play'){
    bodies.push(body);replies.push(result);stopItems=!options.continuous;
    if(options.loseFirstAck&&!failedAck){failedAck=true;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Accepted server-side; response lost in fixture'}));return;}
   }
   res.writeHead(result?.status||200,{'Content-Type':'application/json'});res.end(JSON.stringify(result?.body||{}));return;
  }
  if(u.pathname==='/fixture.webm'){res.writeHead(200,{'Content-Type':'video/webm','Content-Length':video.length});res.end(video);return;}
  if(u.pathname==='/react.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(root,'node_modules/react/umd/react.development.js')));return;}
  if(u.pathname==='/react-dom.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(root,'node_modules/react-dom/umd/react-dom.development.js')));return;}
  if(u.pathname==='/player.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle());return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><title>Gridcast player integration fixture</title></head><body><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/player.js"></script></body></html>');
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${server.address().port}`;
 let browser;
 try{
  browser=await chromium.launch({executablePath,headless:true,args:['--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const page=await browser.newPage();
  await page.addInitScript(({credential,modelWorking})=>{localStorage.setItem('gc_device',JSON.stringify(credential));window.fixtureModelWorking=modelWorking;},{credential:{token:paired.token,device_id:paired.device.id,screen_id:'screen1'},modelWorking:!!options.modelWorking});
  await page.goto(base);await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>.1;},{},{timeout:15000});
  return {page,db,requests,bodies,replies,paired,cleanup:async()=>{await browser.close();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true});}};
 }catch(e){await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true});throw e;}
}
const waitFor=async(fn,ms=15000)=>{const until=Date.now()+ms;while(!fn()){if(Date.now()>until)throw new Error('Timed out waiting for playback report');await new Promise(r=>setTimeout(r,25));}};
test('actual native media excludes paused/waiting time, emits one delivery, and camera failure stays null', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness();try{
  await h.page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.dispatchEvent(new Event('waiting'));});
  await new Promise(r=>setTimeout(r,1200));
  await h.page.evaluate(()=>document.querySelector('video').play());
  await waitFor(()=>h.bodies.length>0);
  // The slot already finalized. Late duplicate browser end notifications cannot append it again.
  await h.page.evaluate(()=>{const v=document.querySelector('video');v.dispatchEvent(new Event('ended'));v.dispatchEvent(new Event('ended'));});
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
  await h.page.waitForFunction(async id=>(await window.fixtureQueue.queueStatus(id)).pending===0,h.paired.device.id);
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

test('underfilled four-second loop pads idle time without billing or replaying the two-second ad early', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({continuous:true});try{
  await waitFor(()=>h.bodies.length===1);const first=h.bodies[0];
  await new Promise(r=>setTimeout(r,1000));assert.equal(h.bodies.length,1);
  assert.ok(await h.page.getByText(/Reserved loop time/).count());
  await waitFor(()=>h.bodies.length===2,10000);const second=h.bodies[1];
  assert.ok(Date.parse(second.started_at_device)-Date.parse(first.started_at_device)>=3800);
  assert.equal(h.db.plays.length,2);assert.equal(h.db.campaigns[0].accrued_spend,4);
 }finally{await h.cleanup();}
});

test('camera track ending mid-play invalidates earlier samples and following plays remain unmeasured', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({modelWorking:true,continuous:true});try{
  await waitFor(()=>h.bodies.length>=1);
  // Wait for a later play that begins with a healthy camera and captures a sample.
  await h.page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>.7&&v.currentTime<1.5;});
  await h.page.evaluate(()=>{const camera=document.querySelectorAll('video')[1];camera.srcObject.getVideoTracks().forEach(t=>{t.stop();t.dispatchEvent(new Event('ended'));});});
  await waitFor(()=>h.bodies.length>=2);
  const failed=h.bodies[1];assert.equal(failed.measured,false);assert.equal(failed.avg_persons,null);assert.equal(failed.sample_count,0);assert.equal(failed.model_ver,null);
  await waitFor(()=>h.bodies.length>=3,15000);assert.equal(h.bodies[2].measured,false);assert.equal(h.bodies[2].avg_persons,null);
 }finally{await h.cleanup();}
});
test('camera recovery does not relabel the interrupted play but restores measurement for a later play', {skip:!executablePath||!ffmpeg}, async()=>{
 const h=await harness({modelWorking:true,continuous:true});try{
  await waitFor(()=>h.bodies.length>=1);
  await h.page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>.7&&v.currentTime<1.5;});
  await h.page.evaluate(()=>document.querySelectorAll('video')[1].pause());
  await new Promise(r=>setTimeout(r,150));
  await h.page.evaluate(()=>document.querySelectorAll('video')[1].play());
  await waitFor(()=>h.bodies.length>=2);assert.equal(h.bodies[1].measured,false);assert.equal(h.bodies[1].avg_persons,null);
  await waitFor(()=>h.bodies.length>=3,15000);assert.equal(h.bodies[2].measured,true);assert.equal(h.bodies[2].avg_persons,1);
 }finally{await h.cleanup();}
});
