const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const load = require('./load-lib.cjs');
const { deviceRoute, issuePairing } = load('devices');
const { creativeRotationIndex } = load('rotation');

function fixture({ screenId = 'screen1', slots = 1 } = {}) {
  let now = Date.parse('2026-09-24T00:17:00Z'), version = 1, poolVersion = 'pool1';
  const db = { orgs:[{id:'org1',status:'active'}], screens:[{id:screenId,org_id:'org1',status:'active',has_camera:true}], campaigns:[{id:'campaign1',org_id:'org1',advertiser_id:'advertiser1',committed_budget:1000000000,rate_type:'per_play',rate_value:2}], devices:[], device_assignments:[], plays:[], presence:[] };
  const creatives = [{id:'creativeA',youtube:'videoA'}, {id:'creativeB',youtube:'videoB'}];
  const config = {model:'coco-ssd',sample_interval_s:2,count_ceiling:50,camera_fail_mode:'continue'};
  const playlist = (screen, _device, rotationIndex = 0) => ({
    items:Array.from({length:slots}, (_, slot) => {
      const creative = creatives[creativeRotationIndex(screen.id,rotationIndex,slot,creatives.length)];
      return {campaign_id:'campaign1',creative_id:creative.id,youtube_id:creative.youtube,duration_s:10,committed_budget:1000000000,rate_type:'per_play',rate_value:2};
    }), config, config_version:version, rotation_version:poolVersion,
  });
  const call = (method, path, body={}, token) => deviceRoute(db,method,path.split('/'),body,token,{playlist,now,playerProtocol:2,clientKey:crypto.randomUUID()});
  const paired = call('POST','pair',{code:issuePairing(db,db.screens[0],now).code}).body;
  const poll = () => call('GET','playlist/'+screenId,{},paired.token).body;
  return {db,poll,creatives,advance:n=>{now+=n},setVersion:n=>{version=n},setPoolVersion:v=>{poolVersion=v}};
}
function assertEvidence(f, result) {
  for (const item of result.items) {
    const row = f.db.device_assignments.find(a=>a.id===item.assignment_id);
    for (const key of ['campaign_id','creative_id','youtube_id','duration_s','valid_until']) assert.equal(item[key],row[key],key);
  }
}

test('one slot gives each creative six of twelve lifecycles without adding assignments on retries',()=>{
  const f=fixture(), counts={creativeA:0,creativeB:0};
  for(let phase=0;phase<12;phase++) {
    const result=f.poll(); counts[result.items[0].creative_id]++;
    assert.equal(f.db.devices[0].assignment_set.rotation_index,phase);
    for(let retry=0;retry<5;retry++) assert.equal(f.poll().items[0].assignment_id,result.items[0].assignment_id);
    assertEvidence(f,result); assert.equal(f.db.device_assignments.length,phase+1);
    f.advance(3600e3);
  }
  assert.deepEqual(counts,{creativeA:6,creativeB:6});
});

test('two slots include both creatives and retain frozen evidence across renewal',()=>{
  const f=fixture({slots:2});
  for(let phase=0;phase<3;phase++) {
    const result=f.poll();
    assert.deepEqual(result.items.map(i=>i.creative_id).sort(),['creativeA','creativeB']);
    assertEvidence(f,result); assert.equal(f.db.device_assignments.length,(phase+1)*2);
    f.advance(3600e3);
  }
});

test('calendar boundary and final-minute renewal mint exactly one replacement including retry',()=>{
  const f=fixture(), first=f.poll();
  f.advance(43*60e3); // Wall clock crosses 01:00, but this assignment expires at 01:17.
  assert.equal(f.poll().items[0].assignment_id,first.items[0].assignment_id);
  f.advance(16*60e3-1);
  assert.equal(f.poll().items[0].assignment_id,first.items[0].assignment_id);
  f.advance(1); // Exactly one minute remains: existing lifecycle renews early.
  const renewed=f.poll();
  assert.notEqual(renewed.items[0].assignment_id,first.items[0].assignment_id);
  assert.notEqual(renewed.items[0].creative_id,first.items[0].creative_id);
  for(let i=0;i<10;i++) assert.equal(f.poll().items[0].assignment_id,renewed.items[0].assignment_id);
  assert.equal(f.db.device_assignments.length,2);
  f.advance(60e3); // Expiration of the old set cannot renew the replacement.
  assert.equal(f.poll().items[0].assignment_id,renewed.items[0].assignment_id);
  assert.equal(f.db.devices[0].assignment_set.rotation_index,1);
});

test('configuration or eligible pool changes mint once and retries hold the new phase',()=>{
  const f=fixture(), first=f.poll();
  f.setVersion(2);
  const second=f.poll();
  assert.notEqual(second.items[0].assignment_id,first.items[0].assignment_id);
  assert.equal(f.db.devices[0].assignment_set.rotation_index,1);
  assert.equal(f.poll().items[0].assignment_id,second.items[0].assignment_id);
  f.creatives.push({id:'creativeC',youtube:'videoC'});f.setPoolVersion('pool2');
  const third=f.poll();
  assert.equal(f.db.devices[0].assignment_set.rotation_index,2);
  assert.equal(f.poll().items[0].assignment_id,third.items[0].assignment_id);
  assertEvidence(f,third);assert.equal(f.db.device_assignments.length,3);
});

test('a selected media change is detected even without a pool revision',()=>{
  const f=fixture(), first=f.poll();
  f.creatives.find(c=>c.id===first.items[0].creative_id).youtube='changed-video';
  const second=f.poll();
  assert.notEqual(second.items[0].assignment_id,first.items[0].assignment_id);
  assert.equal(f.poll().items[0].assignment_id,second.items[0].assignment_id);
  assertEvidence(f,second);assert.equal(f.db.device_assignments.length,2);
});

test('stable screen salt distributes fleet phases without requiring equal totals',()=>{
  const choices=Array.from({length:24},(_,i)=>creativeRotationIndex('screen'+i,0,0,2));
  assert.deepEqual([...new Set(choices)].sort(),[0,1]);
  assert.deepEqual(choices,Array.from({length:24},(_,i)=>creativeRotationIndex('screen'+i,0,0,2)));
  assert.equal(creativeRotationIndex('screen0',Number.MAX_SAFE_INTEGER,0,2),creativeRotationIndex('screen0',1,0,2));
});

test('legacy sets without phase migrate once and then reuse the persisted phase',()=>{
  const f=fixture(), first=f.poll();delete f.db.devices[0].assignment_set.rotation_index;
  assert.equal(f.poll().items[0].assignment_id,first.items[0].assignment_id);
  f.advance(3600e3);const next=f.poll();
  assert.equal(f.db.devices[0].assignment_set.rotation_index,1);
  assert.equal(f.poll().items[0].assignment_id,next.items[0].assignment_id);
  assert.equal(f.db.device_assignments.length,2);
});
