const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const c=require('./load-lib.cjs')('vision/contracts-draft'),f=require('./attention-contract-fixtures.cjs');
const valid=v=>c.validateDraftAttention(v,v.playing_ms,'r'.repeat(64));
test('draft profile pins evaluated source/assets and is never production approved',()=>{
 const root=path.resolve(__dirname,'..'),digest=b=>crypto.createHash('sha256').update(b).digest('hex');
 assert.equal(c.DRAFT_PROFILE.production_approved,false);
 assert.equal(digest(fs.readFileSync(path.join(root,'public/vision-lab/assets.json'))),c.DRAFT_PROFILE.manifest_sha256);
 assert.equal(digest(Buffer.concat(['public/vision-lab/worker.js','lib/vision/metrics.ts','lib/vision/calibration.ts','lib/vision/engine.ts'].map(p=>fs.readFileSync(path.join(root,p))))),c.DRAFT_PROFILE.pipeline_sha256);
});
test('bounded aggregates support multiple people, empty observations and unavailable values distinctly',()=>{
 assert.equal(valid(f.attention()),true);
 const unknown=f.attention({body:[0,3601000,0],face:[0,3601000,0],attention:[0,3601000],expression:[0,3601000],presence_person_ms:null,looking_person_ms:null,smile_person_ms:null,face_assessable_person_ms:null,expression_assessable_person_ms:null,estimated_impressions:null,attentive_impressions:null,tracked_visits:null,right_censored_visits:null,longest_look_ms:null});
 assert.equal(valid(unknown),true);assert.equal(valid({...unknown,presence_person_ms:0}),false);
 const empty=f.attention();for(const k of ['presence_person_ms','looking_person_ms','smile_person_ms','face_assessable_person_ms','expression_assessable_person_ms','estimated_impressions','attentive_impressions','tracked_visits','right_censored_visits','longest_look_ms'])empty[k]=0;
 assert.equal(valid(empty),true);assert.equal(valid({...empty,presence_person_ms:null}),false);
 assert.equal(valid({...unknown,playing_ms:0,body:[0,0,0],face:[0,0,0],attention:[0,0],expression:[0,0]}),true);
});
test('reject inconsistent coverage, nonfinite values, capacity overflow and forged populations',()=>{
 const bad=[{body:[3601000,1,0]},{face:[1,3600999,2]},{body:[3601000,0,,]},{attention:[3601001,0]},
 {looking_person_ms:NaN},{smile_person_ms:Infinity},{presence_person_ms:72020001},{looking_person_ms:18005001},
 {looking_person_ms:5,face_assessable_person_ms:4},{presence_person_ms:1},{estimated_impressions:72021},
 {attentive_impressions:9003},{tracked_visits:1},{right_censored_visits:1000001},{longest_look_ms:3601001},
 {tracked_visits:1.5},{presence_person_ms:-1},{playing_ms:3601001}];
 for(const patch of bad)assert.equal(valid(f.attention(patch)),false,JSON.stringify(patch));
});
test('privacy allowlist, fixed versions and revision binding reject extra fields instead of silently stripping',()=>{
 for(const extra of [{frames:[]},{track_ids:[]},{landmarks:[]},{curve:[]},{impressions:999},{model:'arbitrary'}])assert.equal(valid(f.attention(extra)),false);
 for(const patch of [{profile:'attention-gpu-draft/1'},{schema:'attention/1'},{calibration_revision:'r'.repeat(65)},{calibration_revision:'\"escape'},{calibration_revision:'हिन्दी'}])assert.equal(valid(f.attention(patch)),false);
 assert.equal(c.validateDraftAttention(f.attention(),3601000,'wrong'),false);
});
test('calibration binds device camera geometry and profile; permits only aggregate quality',()=>{
 const v=f.calibration();assert.equal(c.validateDraftCalibration(v,v),true);
 for(const patch of [{camera_ref:'different'},{device_id:'other'},{screen_id:'other'},{width:1280},{rotation:180},{profile:'unknown'}])assert.equal(c.validateDraftCalibration(v,{...v,...patch}),false);
 for(const patch of [{raw_camera_id:'secret'},{samples:4},{span_ms:999},{yaw_spread_tenths:121},{pitch_spread_tenths:101},{yaw_tenths:451},{pitch_tenths:NaN},{width:0},{rotation:45},{method:'manual'},{completed_at:'2026-02-30T00:00:00.000Z'},{completed_at:'bad'}])assert.equal(c.validateDraftCalibration({...v,...patch},v),false);
});
test('all candidate receipt combinations fit with worst sequence; unchanged legacy values are frozen',t=>{
 for(const media of ['image','video','youtube'])for(const measured of [true,false]){
  const base=f.legacy(media,measured),before=JSON.stringify(base),a=f.attention(),prepared=c.prepareDraftEnvelope(base,a,a.calibration_revision);
  assert.equal(prepared.outcome,'included');const bytes=c.draftQueuedEventBytes(prepared.event);assert.ok(bytes<=3584);t.diagnostic(`${media} measured=${measured}: ${bytes} bytes`);
  const {attention,...rest}=prepared.event;assert.equal(JSON.stringify(rest),before);assert.equal(JSON.stringify(base),before);
  assert.ok(Object.isFrozen(prepared.event));assert.ok(Object.isFrozen(attention.body));a.body[0]=1;assert.equal(attention.body[0],3601000);
 }
});
test('invalid or oversize optional data never modifies delivery evidence; retry preparation is forbidden',()=>{
 const a=f.attention(),base=f.legacy();
 for(const [candidate,outcome] of [[undefined,'absent'],[{...a,frames:['bad']},'invalid']]){
  const result=c.prepareDraftEnvelope(base,candidate,a.calibration_revision);assert.equal(result.outcome,outcome);assert.equal(JSON.stringify(result.event),JSON.stringify(base));
 }
 const escaped={...base,creative_id:'"\\ह'.repeat(350)};assert.ok(c.draftQueuedEventBytes(escaped)<=4096);
 const result=c.prepareDraftEnvelope(escaped,a,a.calibration_revision);assert.equal(result.outcome,'size_limit');assert.equal(JSON.stringify(result.event),JSON.stringify(escaped));
 assert.ok(c.draftJsonBytes(escaped)>JSON.stringify(escaped).length);
 assert.throws(()=>c.prepareDraftEnvelope({...base,seq_no:1},a,a.calibration_revision),/unqueued/);
 assert.throws(()=>c.prepareDraftEnvelope({...base,attention:a},a,a.calibration_revision),/unqueued/);
 assert.throws(()=>c.prepareDraftEnvelope({...base,creative_id:'x'.repeat(5000)},a,a.calibration_revision),/Legacy evidence/);
});

test('richer candidate shape size experiment leaves headroom but is not accepted as collected core evidence',t=>{
 const shape={position_bins:Array.from({length:10},()=>[72020000,18005000,18005000,3601000,3601000]),look_histogram:{complete:Array(6).fill(1000000),censored:Array(6).fill(1000000)}};
 const a=f.attention(),envelope={...f.legacy(),attention:{...a,...shape}};
 const bytes=c.draftQueuedEventBytes(envelope);assert.ok(bytes<=3584);assert.equal(valid(envelope.attention),false);t.diagnostic(`Core plus speculative 10-bin curve / 6-bin complete+censored histograms: ${bytes} bytes (size only; not supported measurements)`);
});

test('conservative numeric-width bound includes all coverage combinations within the draft budget',t=>{
 const upper=v=>typeof v==='number'?99999999:Array.isArray(v)?v.map(upper):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,upper(x)])):v;
 // This is a byte upper bound, intentionally not physically valid evidence. All allowed core integers use <=8 digits.
 const a=upper(f.attention()),event={...f.legacy(),attention:a};
 const bytes=c.draftQueuedEventBytes(event);assert.ok(bytes<=3584);assert.equal(valid(a),false);t.diagnostic(`Conservative numeric-width core envelope: ${bytes} bytes`);
});

test('default and guided receipts reuse the pinned metric calculation and differ only in truthful provenance',()=>{
 const p=require('./load-lib.cjs')('vision/production'),mode=require('./load-lib.cjs')('vision/attention-summary');
 const sample={body_observed_s:8,body_saturated_s:1,face_observed_s:7,face_saturated_s:0,attention_observed_s:5,expression_observed_s:4,presence_person_s:3,attention_person_s:2,smile_person_s:1,face_observable_person_s:2.5,expression_observable_person_s:1.5,estimated_impressions:1,attentive_impressions:1,tracked_visits:1,right_censored_visits:0,longest_look_s:1};
 const old=p.summaryForReceipt(sample,10000,'realGuidedRevision');
 assert.deepEqual(mode.summaryForAttentionMode(sample,10000,'guided','realGuidedRevision'),{...old,attention_mode:'guided'});
 assert.deepEqual(mode.summaryForAttentionMode(sample,10000,'default',null),{...old,attention_mode:'default',calibration_revision:null});
});
