const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const moduleObject = { exports: {} };
new Function('require','module','exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/devices.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)(require,moduleObject,moduleObject.exports);
const { issuePairing, pairingCodeHash, deviceIdFromToken, deviceRoute, revokeDevices, playRecordId } = moduleObject.exports;
const MODEL = 'coco-ssd@2.2.3/lite_mobilenet_v2';
function fixture() {
  let now = Date.parse('2026-09-24T00:00:00.000Z');
  const db = { orgs: [{id:'org1',status:'active'},{id:'org2',status:'active'}], screens: [{id:'screen1',org_id:'org1',status:'active',has_camera:true},{id:'screen2',org_id:'org2',status:'active'}], devices: [], device_assignments: [], plays: [], presence: [], campaigns: [{id:'campaign1',org_id:'org1',advertiser_id:'advertiser1',rate_type:'per_play',rate_value:9,accrued_spend:0}] };
  let config = { model:'coco-ssd', sample_interval_s:2, count_ceiling:50, camera_fail_mode:'continue' };
  const options = () => ({ now, clientKey:crypto.randomUUID(), playlist: () => ({ items:[{campaign_id:'campaign1',creative_id:'creative1',duration_s:10,youtube_id:'example',rate_value:2}],config,config_version:3 }) });
  const call = (method, route, body={}, token) => { const r=deviceRoute(db,method,route.split('/'),body,token,options());return {...r,status:r?.status||200}; };
  const pair = (sid='screen1') => { const screen=db.screens.find(s=>s.id===sid);const code=issuePairing(db,screen,now);const r=call('POST','pair',{code:code.code}); assert.equal(r.status,200);return r.body; };
  const paired=pair(), assignment=call('GET','playlist/screen1',{},paired.token).body.items[0];
  const event = (patch={}) => ({play_uid:crypto.randomUUID(),seq_no:1,assignment_id:assignment.assignment_id,campaign_id:'campaign1',creative_id:'creative1',config_version:3,started_at_device:'2026-09-24T00:00:00.000Z',ended_at_device:'2026-09-24T00:00:10.000Z',playing_duration_ms:10000,media_started_s:0,media_ended_s:10,ended_reason:'ended',server_clock_offset_ms:0,measured:true,avg_persons:2,sample_count:5,model_ver:MODEL,...patch});
  now+=11000;
  return {db,call,pair,paired,assignment,event,advance:n=>{now+=n},config};
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
 assert.equal(f.call('POST','heartbeat',{device_now:'2026-09-24T00:00:11Z',config_version:3,app_ver:'test',uptime_s:12},f.paired.token).status,200);
 assert.equal(f.db.plays.length,n);assert.equal(f.db.devices[0].applied_config_version,3);assert.equal(f.db.devices[0].clock_offset_estimate_ms,0);
 assert.equal(f.call('POST','heartbeat',{device_now:'2026-09-24T00:00:11Z',config_version:{}},f.paired.token).status,400);
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
