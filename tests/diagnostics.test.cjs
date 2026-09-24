const test = require('node:test'), assert = require('node:assert/strict');
const {requestDiagnostic,revokeDiagnostic,deviceDiagnosticRoute,diagnosticOffer,assertNoDiagnosticLease} = require('./load-lib.cjs')('diagnostics');
const now = Date.parse('2026-09-25T00:00:00Z');
function fixture() {
 const screen={id:'s1',org_id:'o1',status:'active',has_camera:true}, device={id:'d1',screen_id:'s1',org_id:'o1',expires_at:new Date(now+864e5).toISOString()};
 const db={screens:[screen],devices:[device],campaigns:[],plays:[],presence:[]};
 const assignment=requestDiagnostic(db,screen,{id:'admin'},{config:{model:'coco-ssd',sample_interval_s:2,count_ceiling:50},config_version:2},now);
 const call=(path,body={},at=now)=>deviceDiagnosticRoute(db,'diagnostic/'+path,{assignment_id:assignment.id,run_uid:'run_123456',...body},screen,device,at);
 const event=()=>({started_at_device:new Date(now).toISOString(),ended_at_device:new Date(now+12000).toISOString(),playing_duration_ms:12000,ended_reason:'ended',measured:true,avg_persons:2,sample_count:6,model_ver:'coco-ssd@2.2.3/lite_mobilenet_v2',camera_state:'ready',model_state:'ready'});
 return {db,screen,device,assignment,call,event};
}
test('atomic single claim and idempotent result stay completely outside commercial telemetry',()=>{
 const f=fixture(), before=JSON.stringify([f.db.plays,f.db.presence,f.db.campaigns]);
 assert.equal(f.call('start').body.ok,true);assert.throws(()=>f.call('start'),/already been claimed/);
 assert.throws(()=>assertNoDiagnosticLease(f.db,['s1'],now),/diagnostic is running/);
 assert.equal(f.call('result',f.event(),now+13000).body.ok,true);assert.equal(f.call('result',f.event(),now+14000).body.duplicate,true);
 assert.throws(()=>f.call('result',{...f.event(),avg_persons:3},now+14000),/different payload/);
 assert.equal(JSON.stringify([f.db.plays,f.db.presence,f.db.campaigns]),before);
 assert.equal(f.device.assignment_uses,undefined);assert.equal(f.device.airtime_buckets,undefined);
 assert.equal(f.db.diagnostic_results.length,1);assert.equal(f.db.diagnostic_results[0].billable,false);
});
test('pending, paused and active reservations prevent diagnostic slot displacement even with no playable creative',()=>{
 for(const status of ['pending','paused','active']) {const f=fixture();f.db.campaigns.push({org_id:'o1',screen_ids:['s1'],status});assert.equal(f.call('start').body.waiting,true);assert.equal(f.assignment.status,'pending');assert.match(diagnosticOffer(f.db,f.screen,f.device,now).message,/reserved/);}
});
test('expired, revoked and other-device assignments cannot start or submit results',()=>{
 const f=fixture();assert.throws(()=>f.call('start',{},now+601e3),/expired/);
 assert.throws(()=>deviceDiagnosticRoute(f.db,'diagnostic/start',{assignment_id:f.assignment.id,run_uid:'run_123456'},f.screen,{id:'another'},now),/Unknown/);
 f.call('start');revokeDiagnostic(f.db,f.screen,f.assignment.id,{id:'admin'},now+1000);
 assert.throws(()=>f.call('result',f.event(),now+13000),/revoked/);
 assert.throws(()=>assertNoDiagnosticLease(f.db,['s1'],now+1000),/running/);
});
test('unknown measurement remains null and diagnostics reject invented model provenance',()=>{
 const f=fixture();f.call('start');assert.throws(()=>f.call('result',{...f.event(),model_ver:'fake'},now+13000),/provenance/);
 assert.throws(()=>f.call('result',{...f.event(),measured:false,avg_persons:0,sample_count:0,model_ver:null},now+13000),/must be null/);
 assert.equal(f.call('result',{...f.event(),measured:false,avg_persons:null,sample_count:0,model_ver:null},now+13000).body.ok,true);
});

test('camera-disabled diagnostic cannot claim measured presence',()=>{const f=fixture();f.assignment.has_camera=false;f.call('start');assert.throws(()=>f.call('result',f.event(),now+13000),/provenance/);});

test('changed configuration revokes a stale request before it can measure with misleading provenance',()=>{const f=fixture();const r=deviceDiagnosticRoute(f.db,'diagnostic/start',{assignment_id:f.assignment.id,run_uid:'run_123456'},f.screen,f.device,now,3);assert.equal(r.body.cancelled,true);assert.equal(f.assignment.status,'revoked');assert.equal(f.screen.diagnostic_hold_until,undefined);});
