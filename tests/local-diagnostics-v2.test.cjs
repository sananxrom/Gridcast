const test=require('node:test'),assert=require('node:assert/strict');
const {PresenceV2LocalDiagnostics}=require('./load-lib.cjs')('vision/local-diagnostics-v2');
const track=(key,box)=>({key,box,looking:null,smiling:null,uncertain:false,dwell_s:0,looking_s:0,smiling_s:0,longest_look_s:0});

test('local distance bands use one body-led track set and remain approximate',()=>{
 const d=new PresenceV2LocalDiagnostics();
 d.observeBodies(100,[track(1,[.2,.1,.4,.8]),track(2,[.4,.2,.6,.6]),track(3,[.6,.3,.8,.5])],320,240);
 const values=d.snapshot(100,[track(1,[.2,.1,.4,.8]),track(2,[.4,.2,.6,.6]),track(3,[.6,.3,.8,.5])]);
 assert.deepEqual(values.map(x=>x.distance_band),['near','mid','far']);
 assert.equal(values.length,3);
});

test('stopped estimate appears only after the source threshold and clears on movement',()=>{
 const d=new PresenceV2LocalDiagnostics(),still=track(4,[.2,.1,.4,.8]);
 for(let at=100;at<=2600;at+=100)d.observeBodies(at,[still],320,240);
 assert.equal(d.snapshot(2600,[still])[0].stopped,true,'stationary estimate backdates to first slow observation');
 for(let at=2700;at<=5000;at+=100)d.observeBodies(at,[track(4,[.2+((at-2700)/2300)*.5,.1,.4+((at-2700)/2300)*.5,.8])],320,240);
 assert.equal(d.snapshot(5000,[still])[0].stopped,false);
});

test('a fresh matched face estimate takes precedence and expires locally',()=>{
 const d=new PresenceV2LocalDiagnostics(),body=track(8,[.2,.1,.4,.8]);
 d.observeBodies(100,[body],320,240);
 const view={box:[.2,.2,.3,.3],track_key:8,looking:true,reason:null};
 d.observeFaces(120,[{box:view.box,distance_cm:450}],[view]);
 assert.equal(d.snapshot(130,[body])[0].distance_band,'mid');
 assert.equal(d.snapshot(700,[body])[0].distance_band,'near','expired face estimate falls back to fresh body estimate');
 assert.equal(d.snapshot(1000,[body]).length,0,'stale body diagnostics disappear');
});
