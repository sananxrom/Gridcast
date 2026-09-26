const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const load=require('./load-lib.cjs');
const {filterLegacyPredictions,sampleLegacyFrame,LEGACY_CV_PROFILE}=load('vision/legacy-sampler');
const {LegacyPriorityScheduler,summarize,boundedPush,acceptsA2CaptureResult,playbackStallTotal}=load('vision/a2-scheduler');

const config={...LEGACY_CV_PROFILE.defaults,detection_zone:{x:25,y:0,w:50,h:100}};
const prediction=(patch={})=>({class:'person',score:.45,bbox:[280,20,80,120],...patch});

test('A2 legacy filter keeps the player confidence, zone, source-pixel minimum and count ceiling',()=>{
 const values=[prediction(),prediction({score:.449}),prediction({class:'cat'}),prediction({bbox:[20,20,40,120]}),prediction({bbox:[280,20,80,23]})];
 assert.deepEqual(filterLegacyPredictions(values,640,480,480,{...config,count_ceiling:1}),{count:1,accepted:1,ceiling:1});
 assert.equal(LEGACY_CV_PROFILE.model,'coco-ssd@2.2.3/lite_mobilenet_v2');
});

test('A2 legacy minimum person height scales the model box back to source pixels',()=>{
 const values=[prediction({bbox:[280,20,80,12]})];
 assert.deepEqual(filterLegacyPredictions(values,640,360,720,{...config,min_box_px:24}),{count:1,accepted:1,ceiling:50});
});

test('A2 legacy sample calls the pinned detector arguments and clears camera pixels',async()=>{
 let drew=0,cleared=0,called=null;
 const canvas={width:0,height:0,getContext(){return {drawImage(){drew++},clearRect(){cleared++}}}};
 const video={readyState:2,paused:false,ended:false,videoWidth:640,videoHeight:480};
 const detector={async detect(_canvas,maxBoxes,minScore){called={maxBoxes,minScore};return [prediction()]}};
 const result=await sampleLegacyFrame(video,detector,canvas,config);
 assert.equal(drew,1);assert.equal(cleared,1);assert.deepEqual(called,{maxBoxes:50,minScore:.45});assert.equal(result.count,1);
});

test('A2 legacy sample clears pixels after a detector error',async()=>{
 let cleared=0;const canvas={width:0,height:0,getContext(){return {drawImage(){},clearRect(){cleared++}}}};
 await assert.rejects(sampleLegacyFrame({readyState:2,paused:false,ended:false,videoWidth:640,videoHeight:480},{async detect(){throw Error('failed')}},canvas,config),/failed/);
 assert.equal(cleared,1);
});

test('A2 legacy opportunities match the production 250ms ticker strict wall-clock predicate',()=>{
 const production=fs.readFileSync(path.join(__dirname,'../app/player/page.tsx'),'utf8');
 assert.match(production,/Date\.now\(\)\s*-\s*lastDetect\s*>\s*Math\.max\(500,/,'keep parity anchored to the unchanged player predicate');
 const playerDue=(now,lastDetect,interval)=>now-lastDetect>Math.max(500,interval);
 const s=new LegacyPriorityScheduler(2000,10000,300);
 assert.equal(s.pollLegacy(12000,true,false).legacy,playerDue(12000,10000,2000));
 assert.deepEqual(s.pollLegacy(12001,true,false),{legacy:true,legacySkipped:null});
 assert.equal(s.attentionAllowed(13701,true,false),false,'attention yields before the strict next due window');
 assert.equal(s.pollLegacy(14001,true,false).legacy,playerDue(14001,12001,2000),'exact boundary is not due');
 assert.equal(s.pollLegacy(14002,true,false).legacy,playerDue(14002,12001,2000),'a delayed ticker consumes one due opportunity');
 const paused=new LegacyPriorityScheduler(2000,0);
 assert.deepEqual(paused.pollLegacy(2001,false,false),{legacy:false,legacySkipped:'paused'});
 assert.equal(paused.pollLegacy(4001,true,false).legacy,false,'paused opportunity updates lastDetect; exact boundary remains not due');
 assert.deepEqual(paused.pollLegacy(4002,true,false),{legacy:true,legacySkipped:null});
 const busy=new LegacyPriorityScheduler(2000,0);
 assert.deepEqual(busy.pollLegacy(2001,true,true),{legacy:false,legacySkipped:'in_flight'});
 assert.equal(busy.pollLegacy(4001,true,false).legacy,false,'in-flight opportunity is consumed without catch-up');
 assert.equal(busy.pollLegacy(4002,true,false).legacy,true);
 assert.equal(busy.nextLegacyDeadline,6002);
});

test('A2 result export computes an open stall repeatedly without accumulating it',()=>{
 const accumulated=300,started=1000;
 const first=playbackStallTotal(accumulated,started,1500);
 const second=playbackStallTotal(accumulated,started,1500);
 assert.equal(first,800);assert.equal(second,first);assert.equal(accumulated,300);
 const closed=accumulated+(1800-started);
 assert.equal(playbackStallTotal(closed,null,1900),1100);
});

test('A2 delayed COCO inference is rejected across pause/resume and accepted in its captured segment',async()=>{
 const stream={id:'camera-A'};
 const captured={generation:8,segment:100,stream,cameraLive:true,mode:'legacy_plus_attention',playing:true,visible:true,phase:'running'};
 let resolveOld;const delayed=new Promise(resolve=>{resolveOld=resolve});
 const oldCompletion=delayed.then(()=>acceptsA2CaptureResult(captured,{...captured,segment:250}));
 resolveOld({count:1});assert.equal(await oldCompletion,false,'resumed playback has a different segment start');
 let resolveFresh;const freshPromise=new Promise(resolve=>{resolveFresh=resolve});
 const freshCompletion=freshPromise.then(()=>acceptsA2CaptureResult({...captured,segment:250},{...captured,segment:250}));
 resolveFresh({count:1});assert.equal(await freshCompletion,true,'current segment inference remains accepted');
 assert.equal(acceptsA2CaptureResult(captured,{...captured,stream:{id:'camera-B'}}),false,'replacement camera stream rejects stale output');
 assert.equal(acceptsA2CaptureResult({...captured,cameraLive:false},captured),false,'a capture made from an inactive track is never accepted');
 assert.equal(acceptsA2CaptureResult(captured,{...captured,cameraLive:false}),false,'ended, muted or disabled capture track rejects output');
});

test('A2 ignores a late legacy result after a trial has been stopped and restarted',()=>{
 const captured={generation:17,segment:100,stream:{},cameraLive:true,mode:'legacy_only',playing:true,visible:true,phase:'running'};
 assert.equal(acceptsA2CaptureResult(captured,captured),true);
 assert.equal(acceptsA2CaptureResult(captured,{...captured,generation:18}),false);
 assert.equal(acceptsA2CaptureResult(captured,{...captured,visible:false}),false);
});

test('A2 exported timing summaries stay finite and bounded',()=>{
 assert.deepEqual(summarize([4,1,3,2]),{count:4,median:2,p95:4});
 assert.deepEqual(summarize([NaN,Infinity]),{count:0,median:null,p95:null});
 const samples=[];for(let i=0;i<600;i++)boundedPush(samples,i,512);
 assert.equal(samples.length,512);assert.equal(samples[0],88);assert.equal(samples.at(-1),599);
});
