const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const base=process.env.GC_TEST_A2_URL;
const executablePath=[process.env.GC_TEST_BROWSER_PATH,chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(fs.existsSync);
const skip=!base?'Set GC_TEST_A2_URL to the local development app':!executablePath?'Chromium unavailable':false;

test('A2 local fake-camera baseline captures legacy sample accounting and bounded export', {skip,timeout:90000},async t=>{
 const browser=await chromium.launch({executablePath,headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 t.after(()=>browser.close());
 const context=await browser.newContext({permissions:['camera'],acceptDownloads:true}),page=await context.newPage();page.setDefaultTimeout(30000);
 const errors=[],api=[];page.on('pageerror',e=>errors.push(e.message));context.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))api.push(r.url());});
 await page.goto(base+'/vision-lab/combined');await page.getByRole('heading',{name:'A2 combined workload lab'}).waitFor();
 await page.getByRole('button',{name:'Prepare legacy-only baseline'}).click();
 await page.getByRole('status').filter({hasText:'Models warmed and one camera stream is ready'}).waitFor({timeout:60000});
 await page.getByRole('button',{name:'Begin scored phase'}).click();await page.waitForTimeout(3300);
 await page.getByRole('button',{name:'Stop and save aggregate'}).click();
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export bounded results'}).click();const file=await pending;const data=JSON.parse(fs.readFileSync(await file.path(),'utf8'));
 assert.equal(data.schema,'gridcast-a2-local-evaluation/1');assert.equal(data.baseline.mode,'legacy_only');assert.ok(data.baseline.legacy.successful_samples>=1);assert.equal(data.baseline.legacy.model,'coco-ssd@2.2.3/lite_mobilenet_v2');
 assert.equal(data.baseline.attention.state,'not_in_trial');assert.equal(data.baseline.camera.same_camera_verified,true);assert.equal(data.current,null);
 assert.equal(/"(?:landmarks|face_geometry|person_ids|track_id|video_filename|camera_device_ids)"\s*:/.test(JSON.stringify(data)),false);assert.deepEqual(errors,[]);assert.deepEqual(api,[]);
});

test('A2 combined fake-camera trial runs pinned worker beside legacy sampler without claiming a human pass', {skip:skip||(!process.env.GC_TEST_REAL_CDN?'Set GC_TEST_REAL_CDN=1 to permit pinned attention asset initialization':false),timeout:240000},async t=>{
 const browser=await chromium.launch({executablePath,headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 t.after(()=>browser.close());
 const context=await browser.newContext({permissions:['camera'],acceptDownloads:true}),page=await context.newPage();page.setDefaultTimeout(120000);
 const errors=[],api=[];page.on('pageerror',e=>errors.push(e.message));context.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))api.push(r.url());});
 await page.addInitScript(()=>{const native=Worker;window.__a2DelayNextInit=true;window.__a2Workers=[];const media=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.__a2CameraRequests=0;navigator.mediaDevices.getUserMedia=(...args)=>{window.__a2CameraRequests++;return media(...args)};window.Worker=class extends native{constructor(...args){super(...args);const record={terminated:false};window.__a2Workers.push(record);const send=this.postMessage.bind(this),terminate=this.terminate.bind(this);this.postMessage=(message,...rest)=>{if(message?.type==='INIT'&&window.__a2DelayNextInit){record.pendingInit=true;window.__a2ReleaseInit=()=>{record.pendingInit=false;send(message,...rest)}}else send(message,...rest)};this.terminate=()=>{record.terminated=true;terminate()}}}});
 await page.goto(base+'/vision-lab/combined');await page.getByLabel('A2 computer model').fill('A2 fixture computer');await page.getByLabel('A2 camera height').fill('132');await page.getByLabel('A2 lighting').selectOption('bright');await page.getByLabel('A2 local test video').setInputFiles(path.join(__dirname,'../public/diagnostics/screen-test.mp4'));
 await page.getByRole('button',{name:'Prepare legacy-only baseline'}).click();
 await page.getByRole('status').filter({hasText:'Models warmed and one camera stream is ready'}).waitFor({timeout:60000});
 await page.getByRole('button',{name:'Begin scored phase'}).click();await page.waitForTimeout(3300);await page.getByRole('button',{name:'Stop and save aggregate'}).click();
 // Hold the worker's INIT message so stop exercises AbortController cleanup mid-prepare.
 await page.getByRole('button',{name:'Prepare combined trial'}).click();await page.waitForFunction(()=>window.__a2Workers?.some(w=>w.pendingInit),null,{timeout:180000});
 await page.getByRole('button',{name:'Stop and save aggregate'}).click();await page.getByRole('status').filter({hasText:'Trial stopped.'}).waitFor();
 await page.evaluate(()=>{window.__a2DelayNextInit=false;window.__a2ReleaseInit?.()});await page.waitForTimeout(500);
 assert.equal(await page.evaluate(()=>window.__a2CameraRequests),1,'cancelled preparation must not acquire a second camera');assert.equal(await page.evaluate(()=>window.__a2Workers.at(-1)?.terminated),true,'cancelled worker must be terminated');assert.match(await page.getByRole('status').innerText(),/Trial stopped/);
 await page.getByRole('button',{name:'Prepare combined trial'}).click();await page.getByRole('status').filter({hasText:'Models warmed and one camera stream is ready'}).waitFor({timeout:180000});
 await page.getByRole('button',{name:'Auto-calibrate attention (3 s)'}).click();await page.getByText('Look at the centre dot with one face visible.').waitFor();
 await page.getByRole('button',{name:/Cancel calibration/}).click();await page.getByRole('status').filter({hasText:'Calibration cancelled. Previous offsets were kept.'}).waitFor();
 await page.getByRole('button',{name:'Begin scored phase'}).click();await page.waitForTimeout(7000);
 const sampleCounter=()=>page.getByText('Legacy samples',{exact:true}).locator('xpath=..').locator('dd').innerText();const beforeHide=await sampleCounter();
 await page.evaluate(()=>{const video=document.querySelector('video');window.__a2Track=video?.srcObject?.getVideoTracks?.()[0]||null;Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))});
 await page.getByRole('status').filter({hasText:'Stopped because this browser tab was hidden'}).waitFor();await page.waitForTimeout(1200);
 assert.equal(await page.evaluate(()=>window.__a2Track?.readyState),'ended','hidden-tab cleanup must stop the camera track');assert.equal(await page.evaluate(()=>document.querySelector('video')?.srcObject),null,'hidden-tab cleanup must detach the stream');assert.equal(await page.evaluate(()=>window.__a2Workers.at(-1)?.terminated),true,'hidden-tab cleanup must terminate the attention worker');
 assert.equal(await sampleCounter(),beforeHide,'late legacy results after stop must not update the recorded sample counter');
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export bounded results'}).click();const file=await pending;const data=JSON.parse(fs.readFileSync(await file.path(),'utf8'));
 assert.ok(data.baseline.legacy.successful_samples>=1);assert.ok(data.combined.legacy.successful_samples>=1);assert.equal(data.baseline.source.same_source_verified,true);assert.equal(data.combined.source.same_source_verified,true);assert.equal(data.baseline.source.kind,'local_video');assert.equal(data.combined.source.kind,'local_video');assert.equal(data.baseline.playback.source,'local_video');assert.equal(data.combined.playback.source,'local_video');assert.deepEqual(data.baseline.test_context,{computer_model:'A2 fixture computer',camera_height_cm:132,camera_offset_cm:null,person_distance_m:null,lighting:'bright',available_people:'unknown'});assert.deepEqual(data.combined.test_context,data.baseline.test_context);assert.equal(data.baseline.camera.same_camera_verified,true);assert.equal(data.combined.camera.same_camera_verified,true);assert.equal(data.combined.attention.delegate,'CPU');assert.equal(data.combined.attention.profile,'mediapipe-1.0.1-face1-efficientdet-int8-1');assert.ok(['observed','no_observed_attention'].includes(data.combined.attention.state));assert.equal(data.combined.calibration.method,'not-calibrated');assert.equal(data.combined.calibration.yaw,null);assert.equal(data.combined.calibration.pitch,null);assert.ok(data.combined.attention.metrics?.current);
 assert.equal(data.proposed_targets_are_not_user_approved,true);assert.equal(data.combined.camera.same_camera_verified,true);assert.deepEqual(errors,[]);assert.deepEqual(api,[]);
});
