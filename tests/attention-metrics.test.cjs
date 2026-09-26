const test=require('node:test'),assert=require('node:assert/strict');
const {EvaluationMetrics,EVALUATION_LIMITS}=require('./load-lib.cjs')('vision/metrics');
const body=[.2,.1,.6,.9],head=[.32,.16,.48,.34];
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const people=(boxes=[body],saturated=false,ok=true)=>({ok,boxes,saturated});
const faces=(items=[{box:head,looking:true,smiling:true}],saturated=false,ok=true)=>({ok,faces:items,saturated});
function observe(m,at,bodies=people(),face=faces()){m.observe({at,bodies,faces:face});}
function start(id='play-a'){const m=new EvaluationMetrics();m.boundary(id,true,0);return m;}
function stable(m,from,to,step=100){for(let at=from;at<=to;at+=step)observe(m,at);}

test('near/far transition attaches a face to one canonical body, never a retained second person',()=>{
 const m=start();observe(m,0,people(),faces([]));const key=m.liveTracks(0)[0].key;
 observe(m,500);assert.equal(m.snapshot(500).live.people,1);assert.equal(m.liveTracks(500)[0].key,key);
 observe(m,1000);const s=m.snapshot(1000);assert.equal(s.live.people,1);near(s.current.dwell_person_s,1);assert.equal(s.current.estimated_impressions,1);near(s.current.attention_person_s,.5);
});
test('detector error is unknown, never a measured empty scene; body/face errors remain independent',()=>{
 const m=start();observe(m,0);observe(m,200,people([],false,false));observe(m,500,people([],false,false));
 const s=m.snapshot(500);assert.equal(s.live.people,null);assert.equal(s.live.body_status,'error');assert.equal(s.live.face_status,'ok');near(s.current.body_observed_s,.2);near(s.current.body_unknown_s,.3);near(s.current.avg_people,1);
 const unknown=start();observe(unknown,0,people([],false,false),faces([],false,false));unknown.boundary('play-a',false,1000);
 assert.equal(unknown.snapshot(1000).current.presence_person_s,null);assert.equal(unknown.snapshot(1000).current.attention_person_s,null);assert.equal(unknown.snapshot(1000).current.estimated_impressions,null);
});
test('same-second local play boundaries split attribution immediately with fresh per-play thresholds',()=>{
 const m=start();observe(m,0);observe(m,200);m.boundary('play-b',true,400);observe(m,500);m.boundary('play-c',true,700);
 const s=m.snapshot(700);assert.deepEqual(s.completed.map(p=>p.play_id),['play-a','play-b']);near(s.completed[0].playing_s,.4);near(s.completed[0].presence_person_s,.4);near(s.completed[1].playing_s,.3);near(s.completed[1].attention_person_s,.3);assert.equal(s.current.playing_s,0);assert.equal(s.current.presence_person_s,null);
});
test('late inference captured before an ad boundary cannot affect the new local play',()=>{
 const m=start();observe(m,0,people(),faces([{box:head,looking:false,smiling:false}]));m.boundary('next',true,400);
 observe(m,300,people([],false,false),faces());
 const s=m.snapshot(450);assert.equal(s.live.people,1);assert.equal(s.live.looking,0);near(s.current.attention_person_s,0);near(s.completed[0].playing_s,.4);
});
test('only actual playing contributes time; pause/resume does not carry continuous looks',()=>{
 const m=new EvaluationMetrics();m.boundary('play',false,0);stable(m,0,500);m.boundary('play',true,500);observe(m,700);m.boundary('play',false,900);observe(m,1100);m.boundary('play',true,1200);observe(m,1400);m.boundary('play',false,1400);
 const s=m.snapshot(9000).current;near(s.playing_s,.6);near(s.attention_person_s,.6);near(s.longest_look_s,.4);assert.equal(s.estimated_impressions,0);
});
test('large unobserved gaps are unknown, and UI polling does not manufacture observed dwell',()=>{
 const a=start(),b=start();observe(a,0);observe(b,0);
 for(let at=50;at<5000;at+=50)a.snapshot(at);
 a.boundary('play-a',false,5000);b.boundary('play-a',false,5000);
 assert.deepEqual(a.snapshot(5000),b.snapshot(5000));const s=a.snapshot(5000).current;
 assert.equal(s.presence_person_s,null);assert.equal(s.attention_person_s,null);near(s.body_unknown_s,5);near(s.face_unknown_s,5);
});
test('ordinary delayed worker results remain accepted after a newer projected UI snapshot',()=>{
 const m=start();observe(m,0);m.snapshot(1000);observe(m,125);assert.equal(m.snapshot(125).live.body_status,'ok');near(m.snapshot(125).current.presence_person_s,.125);
});
test('body and face freshness expire independently rather than using one camera-health bit',()=>{
 const m=start();observe(m,0);const s=m.snapshot(600);assert.equal(s.live.body_status,'ok');assert.equal(s.live.face_status,'stale');assert.equal(s.live.people,1);assert.equal(s.live.looking,null);near(s.current.body_observed_s,.6);assert.equal(s.current.attention_person_s,null);
 const gone=m.snapshot(751);assert.equal(gone.live.body_status,'stale');assert.equal(gone.live.people,null);
});
test('unresolvable faces are unknown, while a successful empty scene is a valid zero',()=>{
 const m=start();observe(m,0,people(),faces([]));observe(m,300,people(),faces([]));const unknown=m.snapshot(300);
 assert.equal(unknown.live.face_assessable,0);assert.equal(unknown.live.looking,null);assert.equal(unknown.current.attention_person_s,null);assert.equal(unknown.current.visible_smile_rate,null);near(unknown.current.attention_unknown_s,.3);
 const empty=start();observe(empty,0,people([]),faces([]));observe(empty,300,people([]),faces([]));const s=empty.snapshot(300);
 assert.equal(s.live.people,0);assert.equal(s.live.looking,0);assert.equal(s.current.presence_person_s,0);assert.equal(s.current.attention_person_s,0);assert.equal(s.current.estimated_impressions,0);assert.equal(s.current.visible_smile_rate,null);
});
test('faces alone never manufacture body tracks or people counts',()=>{
 const m=start();m.observe({at:0,faces:faces()});m.observe({at:200,faces:faces()});const s=m.snapshot(200);
 assert.equal(s.live.body_status,'unavailable');assert.equal(s.live.people,null);assert.equal(s.live.looking,null);assert.equal(m.liveTracks(200).length,0);assert.equal(s.current.presence_person_s,null);
});
test('body and face saturation flags and observed-time coverage are independent',()=>{
 const m=start();observe(m,0,people(),faces([{box:head,looking:true,smiling:true}],true));observe(m,200,people(),faces([{box:head,looking:true,smiling:true}],true));let s=m.snapshot(200);
 assert.equal(s.live.body_saturated,false);assert.equal(s.live.face_saturated,true);near(s.current.body_saturated_s,0);near(s.current.face_saturated_s,.2);
 const n=start();observe(n,0,people([body],true),faces());observe(n,200,people([body],true),faces());s=n.snapshot(200);assert.equal(s.live.body_saturated,true);assert.equal(s.live.face_saturated,false);near(s.current.body_saturated_s,.2);near(s.current.face_saturated_s,0);
});
test('detector caps bound input work and disclose saturation even when caller forgets flag',()=>{
 const m=start();observe(m,0,people(Array.from({length:1000},()=>body)),faces(Array.from({length:1000},()=>({box:head,looking:true,smiling:true}))));const s=m.snapshot(0);
 assert.equal(s.live.people,20);assert.equal(s.live.body_saturated,true);assert.equal(s.live.face_saturated,true);assert.equal(m.liveTracks(0).length,20);
});
test('crossing ambiguity is disclosed and never adds retained tracks to visible body count',()=>{
 const m=start();observe(m,0,people([[.1,.1,.4,.9],[.6,.1,.9,.9]]),faces([]));observe(m,300,people([[.35,.1,.65,.9],[.35,.1,.65,.9]]),faces([{box:[.43,.16,.57,.34],looking:true,smiling:true}]));
 const s=m.snapshot(300);assert.equal(s.live.people,2);assert.equal(s.live.uncertain_associations,2);assert.equal(s.live.face_assessable,0);assert.equal(s.live.looking,null);
});
test('lost tracks preserve association briefly but never contribute unseen dwell; expiry creates a new visit',()=>{
 const m=start();observe(m,0);const first=m.liveTracks(0)[0].key;observe(m,300,people([]),faces([]));observe(m,500,people([]),faces([]));observe(m,2501);const next=m.liveTracks(2501)[0].key;
 assert.notEqual(first,next);near(m.snapshot(2501).current.dwell_person_s,.3);assert.equal(m.snapshot(2501).live.people,1);
});
test('irregular intervals use measured elapsed time rather than nominal detector rate',()=>{
 const m=start();observe(m,0);observe(m,100);observe(m,400,people([body,[.7,.1,.9,.9]]),faces());m.boundary('play-a',false,600);const s=m.snapshot(600).current;
 near(s.playing_s,.6);near(s.presence_person_s,.8);near(s.avg_people,4/3);near(s.face_observable_person_s,.6);near(s.attention_person_s,.6);
});
test('look continuity breaks on unknown observations while total observed look duration remains additive',()=>{
 const m=start();observe(m,0);observe(m,500,people(),faces([]));observe(m,1000);observe(m,1500);m.boundary('play-a',false,1500);const s=m.snapshot(1500).current;
 near(s.attention_person_s,1);near(s.longest_look_s,.5);near(s.attention_unknown_s,.5);
});
test('each local play counts one exposure and attentive exposure after exact thresholds, not once per visitor lifetime',()=>{
 const m=start();stable(m,0,2000);let s=m.snapshot(2000).current;assert.equal(s.estimated_impressions,1);assert.equal(s.attentive_impressions,1);near(s.visible_smile_rate,1);
 m.boundary('second',true,2000);stable(m,2100,3000);s=m.snapshot(3000).current;assert.equal(s.estimated_impressions,1);assert.equal(s.attentive_impressions,0);near(s.dwell_person_s,1);assert.equal(m.snapshot(3000).completed[0].attentive_impressions,1);
});
test('ended local-play summaries right-censor live visits without claiming complete visit durations',()=>{
 const m=start();stable(m,0,500);m.boundary('second',false,500);const s=m.snapshot(500).completed[0];assert.equal(s.tracked_visits,1);assert.equal(s.right_censored_visits,1);near(s.dwell_person_s,.5);
});
test('state and completed summaries remain bounded; exported aggregates contain no geometry or track identifiers',()=>{
 const m=start();for(let i=0;i<100;i++){observe(m,i*10,people(Array.from({length:20},()=>body)),faces([]));assert.ok(m.tracks.size<=EVALUATION_LIMITS.max_tracks);}
 for(let i=1;i<=40;i++)m.boundary('local-'+i,true,1000+i*100);
 const s=m.snapshot(5000);assert.equal(s.completed.length,20);const json=JSON.stringify(s);assert.ok(json.length<40000);
 const keys=[];function walk(v){if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){keys.push(k);walk(x);}}walk(s);
 for(const key of ['key','box','boxes','track_id','landmarks','faces','visits'])assert.ok(!keys.includes(key),key);
});
test('malformed detections and invalid timestamps cannot become measured zero or rewind attribution',()=>{
 const m=start();observe(m,0,people([[0,0,NaN,1]]),faces([null]));assert.equal(m.snapshot(0).live.body_status,'error');assert.equal(m.snapshot(0).live.face_status,'error');
 observe(m,100);observe(m,-1,people([]),faces([]));m.observe({at:NaN,bodies:people([])});assert.equal(m.snapshot(100).live.people,1);
 assert.throws(()=>m.boundary('',true,100));
});
test('reset removes all temporary association and aggregate history',()=>{
 const m=start();stable(m,0,1000);m.boundary('second',true,1000);m.reset();assert.deepEqual(m.snapshot(0),new EvaluationMetrics().snapshot(0));assert.deepEqual(m.liveTracks(0),[]);
});
test('an unmatched positive face observation is not a known zero-attention empty scene',()=>{
 const m=start();observe(m,0,people([]),faces());observe(m,300,people([]),faces());const s=m.snapshot(300);
 assert.equal(s.live.people,0);assert.equal(s.live.looking,null);assert.equal(s.current.presence_person_s,0);assert.equal(s.current.attention_person_s,null);
});
test('old face samples cannot attach to newly created body tracks',()=>{
 const m=start();observe(m,0,people([]),faces());m.observe({at:200,bodies:people()});assert.equal(m.snapshot(200).live.looking,null);
 m.observe({at:250,faces:faces()});assert.equal(m.snapshot(250).live.looking,1);
});

test('local face details reuse body association and never enter aggregate exports',()=>{
 const m=start();observe(m,0);const detail=m.liveFaces(0)[0];assert.deepEqual(detail.box,head);assert.equal(detail.track_key,m.liveTracks(0)[0].key);assert.equal(detail.looking,true);assert.equal(detail.reason,null);
 assert.equal(/"(?:box|track_key|unavailable_reason)"/.test(JSON.stringify(m.snapshot(0))),false);
 assert.deepEqual(m.liveFaces(501),[],'Stale faces disappear rather than retain a current label');
 observe(m,600,people(),faces([],false,false));assert.deepEqual(m.liveFaces(600),[],'Failed face observations clear geometry');
});
test('local face details distinguish quality failure from missing body association',()=>{
 const m=start();observe(m,0,people(),faces([{box:head,looking:null,smiling:null,unavailable_reason:'too_small'}]));assert.equal(m.liveFaces(0)[0].reason,'too_small');
 observe(m,100,people(),faces([{box:head,looking:null,smiling:null}]));assert.equal(m.liveFaces(100)[0].reason,'unclear');
 observe(m,200,people([]));const unmatched=m.liveFaces(200)[0];assert.equal(unmatched.reason,'unmatched');assert.equal(unmatched.looking,null);assert.equal(unmatched.track_key,null);
});
test('two faces competing for one body do not display a confident face-to-person assignment',()=>{
 const m=start();observe(m,0,people(),faces([{box:head,looking:true,smiling:true},{box:[.33,.16,.49,.34],looking:false,smiling:false}]));
 assert.equal(m.liveFaces(0).length,2);for(const face of m.liveFaces(0)){assert.equal(face.track_key,null);assert.equal(face.looking,null);assert.equal(face.reason,'unmatched');}
});
