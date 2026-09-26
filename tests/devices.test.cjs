const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const moduleObject = { exports: {} };
new Function('require','module','exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/devices.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)(name=>name.startsWith('.')?require('./load-lib.cjs')(name.slice(2)):require(name),moduleObject,moduleObject.exports);
const { issuePairing, pairingCodeHash, deviceIdFromToken, deviceRoute, revokeDevices, playRecordId } = moduleObject.exports;
const MODEL = 'coco-ssd@2.2.3/lite_mobilenet_v2';
function fixture() {
  let now = Date.parse('2026-09-24T00:00:00.000Z');
  const db = { orgs: [{id:'org1',status:'active'},{id:'org2',status:'active'}], screens: [{id:'screen1',org_id:'org1',status:'active',has_camera:true},{id:'screen2',org_id:'org2',status:'active'}], devices: [], device_assignments: [], plays: [], presence: [], campaigns: [{id:'campaign1',org_id:'org1',advertiser_id:'advertiser1',rate_type:'per_play',rate_value:9,committed_budget:100000,accrued_spend:0}] };
  let config = { model:'coco-ssd', sample_interval_s:2, count_ceiling:50, camera_fail_mode:'continue' };
  const item = {campaign_id:'campaign1',creative_id:'creative1',duration_s:10,youtube_id:'example',rate_value:2};
  const options = () => ({ now, playerProtocol:2, clientKey:crypto.randomUUID(), playlist: () => ({ items:[item],config,config_version:3 }) });
  const call = (method, route, body={}, token) => { const r=deviceRoute(db,method,route.split('/'),body,token,options());return {...r,status:r?.status||200}; };
  const pair = (sid='screen1') => { const screen=db.screens.find(s=>s.id===sid);const code=issuePairing(db,screen,now);const r=call('POST','pair',{code:code.code}); assert.equal(r.status,200);return r.body; };
  const paired=pair(), assignment=call('GET','playlist/screen1',{},paired.token).body.items[0];
  const event = (patch={}) => ({play_uid:crypto.randomUUID(),seq_no:1,assignment_id:assignment.assignment_id,campaign_id:'campaign1',creative_id:'creative1',config_version:3,started_at_device:'2026-09-24T00:00:00.000Z',ended_at_device:'2026-09-24T00:00:10.000Z',playing_duration_ms:10000,media_started_s:0,media_ended_s:10,ended_reason:'ended',server_clock_offset_ms:0,measured:true,avg_persons:2,sample_count:5,model_ver:MODEL,...patch});
  now+=11000;
  return {db,call,pair,paired,assignment,event,item,advance:n=>{now+=n},config};
}
test('one-time pairing uses only stored hash, rotates credential, rejects re-use and legacy code',()=>{
 const f=fixture(),s=f.db.screens[0],old=f.paired.token;
 const code=issuePairing(f.db,s);assert.equal(s.pairing_code_hash,pairingCodeHash(code.code));assert.equal(s.code,undefined);
 // fixture clock uses the same day and remains earlier than this fresh expiry.
 const result=f.call('POST','pair',{code:code.code});assert.equal(result.status,200);assert.equal(f.call('POST','pair',{code:code.code}).status,400);
 assert.equal(f.call('GET','playlist/screen1',{},old).status,401);
 assert.equal(JSON.stringify(f.db).includes(result.body.token),false);
 assert.equal(deviceIdFromToken(result.body.token),result.body.device.id);
 assert.equal(f.call('POST','pair',{code:'SEED01'}).status,400);
});
test('expired pairing code and token, missing org, revoked device, and foreign screen are denied',()=>{
 const f=fixture();assert.equal(f.call('GET','playlist/screen2',{},f.paired.token).status,404);
 assert.equal(f.call('POST','play',{...f.event(),screen_id:'screen2'},f.paired.token).status,404);
 assert.equal(f.call('GET','playlist/screen1').status,401);
 const code=issuePairing(f.db,f.db.screens[0],0);assert.equal(f.call('POST','pair',{code:code.code}).status,400);
 f.db.orgs=f.db.orgs.filter(o=>o.id!=='org1');assert.equal(f.call('GET','playlist/screen1',{},f.paired.token).status,401);
 f.db.orgs.push({id:'org1',status:'active'});revokeDevices(f.db,'screen1');assert.equal(f.call('GET','playlist/screen1',{},f.paired.token).status,401);
});
test('play uid gives deterministic id, one append and one accrual; conflicting payload or sequence is409',()=>{
 const f=fixture(),body=f.event(),r=f.call('POST','play',body,f.paired.token);
 assert.equal(r.status,200);assert.equal(r.body.billable,true);assert.equal(r.body.play_id,playRecordId(f.paired.device.id,body.play_uid));
 assert.equal(f.db.plays.length,1);assert.equal(f.db.presence.length,1);assert.equal(f.db.presence[0].id,r.body.play_id);assert.equal(f.db.campaigns[0].accrued_spend,2);
 assert.equal(f.db.plays[0].advertiser_id,'advertiser1');
 assert.equal(f.call('POST','play',body,f.paired.token).body.duplicate,true);
 assert.equal(f.call('POST','play',{...body,avg_persons:3},f.paired.token).status,409);
 assert.equal(f.call('POST','play',{...body,play_uid:crypto.randomUUID()},f.paired.token).status,409);
 assert.equal(f.db.plays.length,1);assert.equal(f.db.campaigns[0].accrued_spend,2);
});
test('delayed immutable assignment remains valid after campaign paused or rate changed',()=>{
 const f=fixture();f.db.campaigns[0].status='paused';f.db.campaigns[0].rate_value=200;f.advance(3*3600e3);
 const r=f.call('POST','play',f.event(),f.paired.token);assert.equal(r.body.billable,true);assert.equal(f.db.campaigns[0].accrued_spend,2);assert.ok(f.db.plays[0].delivery_lag_ms>3600e3);
});
test('late new playback beyond assignment window is retained as nonbillable',()=>{
 const f=fixture();f.advance(3*3600e3);const r=f.call('POST','play',f.event({started_at_device:'2026-09-24T02:30:00Z',ended_at_device:'2026-09-24T02:30:10Z'}),f.paired.token);
 assert.equal(r.status,200);assert.equal(r.body.billable,false);assert.ok(r.body.nonbillable_reasons.includes('clock_or_assignment_window'));assert.equal(f.db.campaigns[0].accrued_spend,0);
});
test('timeout,error,incomplete media and insufficient PLAYING time are never billable',()=>{
 for(const patch of [{ended_reason:'timeout'},{ended_reason:'error'},{playing_duration_ms:100,measured:false,avg_persons:null,sample_count:0,model_ver:null},{media_ended_s:2},{playing_duration_ms:0,media_ended_s:0,measured:false,avg_persons:null,sample_count:0,model_ver:null}]){const f=fixture();const r=f.call('POST','play',f.event(patch),f.paired.token);assert.equal(r.status,200);assert.equal(r.body.billable,false);assert.equal(f.db.campaigns[0].accrued_spend,0);}
});
test('measurement is null when unmeasured and requires exact actual model and bounded samples',()=>{
 const f=fixture();assert.equal(f.call('POST','play',f.event({measured:false,avg_persons:0,sample_count:0}),f.paired.token).status,400);
 assert.equal(f.call('POST','play',f.event({model_ver:'yolox-tiny'}),f.paired.token).status,400);
 assert.equal(f.call('POST','play',f.event({sample_count:1000}),f.paired.token).status,400);
 assert.equal(f.call('POST','play',f.event({avg_persons:51}),f.paired.token).status,400);
 assert.equal(f.call('POST','play',f.event({measured:false,avg_persons:null,sample_count:0,model_ver:null}),f.paired.token).status,200);
 assert.equal(f.db.presence[0].avg_persons,null);assert.equal(f.db.presence[0].model_ver,null);
});
test('heartbeat works without a playlist item and records applied version independently of plays',()=>{
 const f=fixture(),n=f.db.plays.length;
 assert.equal(f.call('POST','heartbeat',{device_now:'2026-09-24T00:00:11Z',config_version:3,app_ver:'test',uptime_s:12,delivery_queue:{pending:4,blocked:2}},f.paired.token).status,200);
 assert.equal(f.db.plays.length,n);assert.equal(f.db.devices[0].applied_config_version,3);assert.equal(f.db.devices[0].clock_offset_estimate_ms,0);
 assert.deepEqual(f.db.devices[0].delivery_queue,{pending:4,blocked:2,reported_at:'2026-09-24T00:00:11.000Z',source:'device_report'});
 assert.equal(f.call('POST','heartbeat',{device_now:'2026-09-24T00:00:11Z',config_version:{}},f.paired.token).status,400);
 for(const q of [{pending:-1,blocked:0},{pending:0,blocked:5001},{pending:1.5,blocked:0},null])
  assert.equal(f.call('POST','heartbeat',{device_now:'2026-09-24T00:00:11Z',config_version:3,delivery_queue:q},f.paired.token).status,400);
});
test('wrong assignment/device/config cannot report or announce a play',()=>{
 const f=fixture();const other=f.pair('screen2');
 assert.equal(f.call('POST','play',f.event(),other.token).status,409);
 assert.equal(f.call('POST','play',f.event({config_version:99}),f.paired.token).status,409);
 assert.equal(f.call('POST','nowplaying',{assignment_id:'missing'},f.paired.token).status,409);
 assert.equal(f.call('POST','nowplaying',{assignment_id:f.assignment.assignment_id},f.paired.token).status,200);
});
test('closed org and expired device token fail even when credential hash is valid',()=>{
 const f=fixture();f.db.orgs[0].status='disabled';assert.equal(f.call('GET','playlist/screen1',{},f.paired.token).status,401);
 f.db.orgs[0].status='active';f.db.devices[0].expires_at='2000-01-01';assert.equal(f.call('GET','playlist/screen1',{},f.paired.token).status,401);
});
test('delivery after72hours rejected but accepted play stays idempotent beyondwindow',()=>{
 const f=fixture(),body=f.event();assert.equal(f.call('POST','play',body,f.paired.token).status,200);f.advance(73*3600e3);
 assert.equal(f.call('POST','play',body,f.paired.token).body.duplicate,true);
 assert.equal(f.call('POST','play',f.event({seq_no:2}),f.paired.token).status,409);
});

// Exercise both branches against arbitrary internal fields, not a denylist that grows after each leak.
test('fresh and cached device playlists expose only playback fields while rates stay frozen server-side',()=>{
 const f=fixture();
 Object.assign(f.item,{advertiser:'Private client',campaign_name:'Private campaign',creative_name:'Private creative',rate_type:'per_play',rate_value:7,internal_future_secret:{value:'must never leave server'},org_id:'private-org',asset_id:'asset1',asset_url:'/api/media/signed-playback',width:1920,height:1080,letterbox:true,kind:'diagnostic'});
 const fresh=f.call('GET','playlist/screen1',{},f.paired.token).body.items[0];
 assert.notEqual(fresh.assignment_id,f.assignment.assignment_id,'rate changes must invalidate the prior assignment');
 const cached=f.call('GET','playlist/screen1',{},f.paired.token).body.items[0];
 assert.equal(cached.assignment_id,fresh.assignment_id,'second response exercises cached assignments');
 const allowed=['campaign_id','creative_id','youtube_id','duration_s','asset_id','asset_url','width','height','letterbox','assignment_id','valid_until','accept_until','max_plays','media_type','kind','asset_sha256','asset_bytes','asset_mime'].sort();
 for(const served of [fresh,cached]){
  assert.deepEqual(Object.keys(served).sort(),allowed);
  assert.equal(served.asset_url,f.item.asset_url);assert.equal(served.youtube_id,'example');
  assert.equal(served.width,1920);assert.equal(served.height,1080);assert.equal(served.letterbox,true);
 }
 const stored=f.db.device_assignments.find(a=>a.id===fresh.assignment_id);
 assert.equal(stored.rate_value,7);assert.equal(stored.rate_type,'per_play');assert.equal(stored.advertiser_id,'advertiser1');
 // A playback-only response can still be submitted, and later campaign edits do not rewrite its price.
 f.db.campaigns[0].rate_value=999;
 const result=f.call('POST','play',f.event({assignment_id:cached.assignment_id}),f.paired.token);
 assert.equal(result.body.billable,true);assert.equal(f.db.campaigns[0].accrued_spend,7);
 assert.equal(f.db.plays[0].rate_value,7);
});

test('old clients receive explicit reload requirement and no new paid permissions',()=>{
 const f=fixture();const result=deviceRoute(f.db,'GET',['playlist','screen1'],{},f.paired.token,{now:Date.parse('2026-09-24T00:00:11Z'),playlist:()=>({items:[f.item],config:f.config,config_version:3})});
 assert.equal(result.body.reload_required,true);assert.deepEqual(result.body.items,[]);
});
test('image completion requires decode evidence and visible display time, not a synthetic media timeline',()=>{
 for(const patch of [{},{media_evidence:'image_decode',decoded_width:1,decoded_height:1,visible_duration_ms:10000},{media_evidence:'image_decode',decoded_width:1920,decoded_height:1080,visible_duration_ms:100},{media_evidence:'image_decode',decoded_width:0,decoded_height:1080,visible_duration_ms:10000}]){
  const f=fixture();Object.assign(f.item,{media_type:'image',width:1920,height:1080});const item=f.call('GET','playlist/screen1',{},f.paired.token).body.items[0];
  const r=f.call('POST','play',f.event({assignment_id:item.assignment_id,...patch}),f.paired.token);assert.equal(r.body.billable,false);assert.equal(f.db.plays[0].rendered,false);
 }
 const f=fixture();Object.assign(f.item,{media_type:'image',width:1920,height:1080});const item=f.call('GET','playlist/screen1',{},f.paired.token).body.items[0];
 const body=f.event({assignment_id:item.assignment_id,media_started_s:undefined,media_ended_s:undefined,media_evidence:'image_decode',decoded_width:1920,decoded_height:1080,visible_duration_ms:10000});
 assert.equal(f.call('POST','play',body,f.paired.token).body.billable,true);assert.equal(f.db.plays[0].media_started_s,null);
});

test('sliding 24-hour preparation horizon does not mint replacement assignments on every poll',()=>{
 const f=fixture();Object.assign(f.item,{asset_id:'uploaded',asset_sha256:'a'.repeat(64),authorization_until:'2026-09-25T00:00:11Z'});
 const first=f.call('GET','playlist/screen1',{},f.paired.token).body.items[0];
 f.item.authorization_until='2026-09-25T00:00:21Z';f.advance(10000);
 const second=f.call('GET','playlist/screen1',{},f.paired.token).body.items[0];assert.equal(second.assignment_id,first.assignment_id);assert.equal(second.valid_until,first.valid_until);
});
test('all acknowledged paid attempts exhausted renews an allowance without waiting for the former hour to expire',()=>{
 const f=fixture();f.db.campaigns[0].screen_ids=Array.from({length:40000},(_,i)=>'screen'+i);f.item.rate_value=3;
 const first=f.call('GET','playlist/screen1',{},f.paired.token).body.items[0];assert.equal(first.max_plays,1);
 const receipt=f.call('POST','play',f.event({assignment_id:first.assignment_id,ended_reason:'error'}),f.paired.token);assert.equal(receipt.body.billable,false);
 const next=f.call('GET','playlist/screen1',{},f.paired.token).body.items[0];assert.notEqual(next.assignment_id,first.assignment_id);assert.equal(next.max_plays,1);
});

test('a partially exhausted paid set replenishes only that campaign and preserves other reservations',()=>{
 const f=fixture();f.db.campaigns[0].screen_ids=Array.from({length:40000},(_,i)=>'s'+i);
 f.db.campaigns.push({id:'campaign2',org_id:'org1',advertiser_id:'advertiser2',rate_type:'per_play',rate_value:1,committed_budget:100,accrued_spend:0});
 const items=[{...f.item,rate_value:3},{campaign_id:'campaign2',creative_id:'creative2',duration_s:10,youtube_id:'abcdefghijk',rate_value:1}];
 const get=()=>deviceRoute(f.db,'GET',['playlist','screen1'],{},f.paired.token,{now:Date.parse('2026-09-24T00:00:11Z'),playerProtocol:2,playlist:()=>({items,config:f.config,config_version:3})}).body;
 const before=get();assert.equal(before.items[0].max_plays,1);assert.ok(before.items[1].max_plays>1);
 assert.equal(f.call('POST','play',f.event({assignment_id:before.items[0].assignment_id}),f.paired.token).body.billable,true);
 const after=get();assert.notEqual(after.items[0].assignment_id,before.items[0].assignment_id);assert.equal(after.items[1].assignment_id,before.items[1].assignment_id);
 assert.equal(f.db.campaign_budgets.find(b=>b.campaign_id==='campaign2').reservations.length,1);
 assert.deepEqual(get().items.map(i=>i.assignment_id),after.items.map(i=>i.assignment_id));
});

test('a cached empty set retries funding immediately when another screen releases a failed attempt',()=>{
 const {reserveBudget,budgetReceipt}=require('./load-lib.cjs')('budgets'),f=fixture(),now=Date.parse('2026-09-24T00:00:11Z');
 const campaign={id:'campaign2',org_id:'org1',advertiser_id:'advertiser2',rate_type:'per_play',rate_value:1,committed_budget:1,accrued_spend:0};f.db.campaigns.push(campaign);
 const other={id:'other-assignment',device_id:'other-device',campaign_id:campaign.id,duration_s:10,rate_type:'per_play',rate_value:1,issued_at:new Date(now).toISOString(),valid_until:new Date(now+3600000).toISOString(),accept_until:new Date(now+72*3600000).toISOString()};
 assert.equal(reserveBudget(f.db,campaign,other,1,now),1);
 const get=()=>deviceRoute(f.db,'GET',['playlist','screen1'],{},f.paired.token,{now,playerProtocol:2,playlist:()=>({items:[{campaign_id:campaign.id,creative_id:'creative2',duration_s:10,youtube_id:'abcdefghijk',rate_value:1}],config:f.config,config_version:3})}).body;
 assert.equal(get().items.length,0);const phase=f.db.devices[0].assignment_set.rotation_index;
 budgetReceipt(f.db,campaign,other,true,false,now);
 const after=get();assert.equal(after.items.length,1);assert.equal(after.items[0].max_plays,1);assert.equal(f.db.devices[0].assignment_set.rotation_index,phase);
 assert.equal(get().items[0].assignment_id,after.items[0].assignment_id);
});

test('a changed filler media identity invalidates its old evidence while unchanged media reuses it',()=>{
 const f=fixture(),filler={creative_id:'house',duration_s:20,media_type:'image',width:1920,height:1080,asset_id:'house-asset',asset_sha256:'a'.repeat(64)};
 const get=()=>deviceRoute(f.db,'GET',['playlist','screen1'],{},f.paired.token,{now:Date.parse('2026-09-24T00:00:11Z'),playerProtocol:2,playlist:()=>({items:[],filler_items:[filler],config:f.config,config_version:3})}).body.filler_items[0];
 const before=get();assert.equal(get().assignment_id,before.assignment_id);
 filler.asset_sha256='b'.repeat(64);assert.notEqual(get().assignment_id,before.assignment_id);
});

test('renewal chooses the authorization horizon from the newly rotated media source',()=>{
 const f=fixture(),now=Date.parse('2026-09-24T00:00:11Z');
 const result=deviceRoute(f.db,'GET',['playlist','screen1'],{},f.paired.token,{now,playerProtocol:2,playlist:(_s,_d,index=0)=>({items:[{...f.item,asset_id:index%2?undefined:'uploaded',youtube_id:index%2?'abcdefghijk':undefined,creative_id:index%2?'online':'offline'}],config:f.config,config_version:3})});
 assert.equal(result.body.items[0].creative_id,'online');assert.equal(Date.parse(result.body.valid_until)-now,3600000);
});

// A1 compatibility baseline only: current ingestion ignores optional attention; no new acceptance is installed.
test('draft attention preparation preserves legacy camera policy billing and receipt retries',()=>{
 const {prepareDraftEnvelope}=require('./load-lib.cjs')('vision/contracts-draft');
 const {attention}=require('./attention-contract-fixtures.cjs');
 for(const policy of ['continue','skip'])for(const measured of [true,false]){
  let baseline;
  for(const candidate of ['absent','valid','invalid']){
   const f=fixture();f.db.device_assignments[0].camera_fail_mode=policy;
   const original=f.event(measured?{}:{measured:false,avg_persons:null,sample_count:0,model_ver:null});delete original.seq_no;
   const a=attention({playing_ms:10000,body:[10000,0,0],face:[10000,0,0],attention:[10000,0],expression:[10000,0],presence_person_ms:20000,looking_person_ms:10000,smile_person_ms:0,face_assessable_person_ms:10000,expression_assessable_person_ms:10000,estimated_impressions:2,attentive_impressions:1,tracked_visits:2,right_censored_visits:2,longest_look_ms:10000});
   const prepared=prepareDraftEnvelope(original,candidate==='absent'?undefined:candidate==='valid'?a:{...a,frames:[]},a.calibration_revision);
   assert.equal(prepared.outcome,candidate==='valid'?'included':candidate);
   const body={...prepared.event,seq_no:1},reply=f.call('POST','play',body,f.paired.token);assert.equal(reply.status,200);
   const snapshot={billable:reply.body.billable,spend:f.db.campaigns[0].accrued_spend,measured:f.db.presence[0].measured,avg_persons:f.db.presence[0].avg_persons,model_ver:f.db.presence[0].model_ver};
   if(!baseline)baseline=snapshot;else assert.deepEqual(snapshot,baseline);
   assert.equal(reply.body.billable,measured||policy!=='skip');
   assert.equal(f.call('POST','play',body,f.paired.token).body.duplicate,true);
   assert.equal(f.db.plays.length,1);assert.equal(f.db.campaigns[0].accrued_spend,snapshot.spend);
   if(candidate==='valid'){const changed={...body};delete changed.attention;assert.equal(f.call('POST','play',changed,f.paired.token).status,409);}
  }
 }
});
