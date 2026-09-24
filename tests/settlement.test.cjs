const test = require('node:test');
const assert = require('node:assert/strict');
const {paise,freezeEconomics,economics,splitSettlement,settlementPeriod,settlementKey,accrueSettlement,appliedOffset} = require('./load-lib.cjs')('settlement');
const basisValues=['gross','net_of_owner_share'];
const delivered=Date.parse('2026-09-24T10:00:00Z');
function fixture(overrides={}) {
  const campaign={id:'campaign1',campaign_type:'network',committed_budget:1000000000,rate_type:'per_play',rate_value:.01};
  const screen={id:'screen1',org_id:'operator1',rate_version:'rate1',owner_share_pct:50};
  const org={id:'operator1',platform_fee_pct:50,fee_basis:'gross',fee_version:'fee1'};
  Object.assign(campaign,overrides.campaign);Object.assign(screen,overrides.screen);Object.assign(org,overrides.org);
  const assignment={advertiser_id:'advertiser1',...freezeEconomics(campaign,screen,org)};
  const db={settlement_buckets:[]};
  const play={id:'play1',billable:true,org_id:'operator1',campaign_id:'campaign1',screen_id:'screen1',server_received_at:'2026-09-24T10:01:00Z'};
  return {campaign,screen,org,assignment,db,play};
}
const assertConserved = s => {assert.equal(s.gross_paise,s.fee_paise+s.owner_paise+s.net_paise);for(const n of Object.values(s))assert.ok(Number.isSafeInteger(n)&&n>=0)};

test('one-paise plays recompute cumulative shares without per-receipt rounding drift',()=>{
  const f=fixture();
  for(let i=1;i<=100;i++) {
    accrueSettlement(f.db,{...f.play,id:'play'+i},f.assignment,delivered+i*1000);
    const b=f.db.settlement_buckets[0];
    assert.equal(b.billable_plays,i);assert.equal(b.gross_paise,i);
    assert.deepEqual({gross_paise:b.gross_paise,fee_paise:b.fee_paise,owner_paise:b.owner_paise,net_paise:b.net_paise},splitSettlement(i,50,50,'gross'));
    assert.equal(b.gross_paise,b.fee_paise+b.owner_paise+b.net_paise);
  }
  assert.equal(f.db.settlement_buckets.length,1);
  assert.equal(f.db.settlement_buckets[0].fee_paise,50);
  assert.equal(f.db.settlement_buckets[0].owner_paise,25);
  assert.equal(f.db.settlement_buckets[0].net_paise,25);
});

test('₹1000 decomposes with explicit owner/fee ordering for both fee bases',()=>{
  assert.deepEqual(splitSettlement(100000,10,20,'gross'),{gross_paise:100000,fee_paise:10000,owner_paise:18000,net_paise:72000});
  assert.deepEqual(splitSettlement(100000,10,20,'net_of_owner_share'),{gross_paise:100000,fee_paise:8000,owner_paise:20000,net_paise:72000});
  assert.deepEqual(splitSettlement(1,50,0,'gross'),{gross_paise:1,fee_paise:1,owner_paise:0,net_paise:0},'half paise rounds up');
});

test('booking economics survive later rates, fees and owner-share changes',()=>{
  const f=fixture({campaign:{rate_value:10},org:{platform_fee_pct:10},screen:{owner_share_pct:20}});
  const original=structuredClone(f.assignment);
  f.org.platform_fee_pct=30;f.org.fee_basis='net_of_owner_share';f.org.fee_version='fee2';
  f.screen.owner_share_pct=60;f.screen.rate_version='rate2';f.campaign.rate_value=99;
  assert.deepEqual(freezeEconomics(f.campaign,f.screen,f.org,original),economics(original));
  accrueSettlement(f.db,f.play,original,delivered);
  assert.deepEqual([f.db.settlement_buckets[0].gross_paise,f.db.settlement_buckets[0].fee_paise,f.db.settlement_buckets[0].owner_paise,f.db.settlement_buckets[0].net_paise],[1000,100,180,720]);
  const next=freezeEconomics(f.campaign,f.screen,f.org);
  assert.notEqual(next.econ_version,original.econ_version);assert.equal(next.rate_paise,9900);
  assert.equal(next.fee_basis,'net_of_owner_share');assert.equal(next.owner_share_pct,60);
});

test('campaign, screen, delivery month and economic version form independent buckets',()=>{
  const f=fixture();
  const rows=[
    [f.play,f.assignment,delivered],
    [{...f.play,campaign_id:'campaign2'},f.assignment,delivered],
    [{...f.play,screen_id:'screen2',org_id:'operator2'},f.assignment,delivered],
    [f.play,f.assignment,Date.parse('2026-10-02T10:00:00Z')],
    [f.play,{...f.assignment,econ_version:'econ2'},delivered],
  ];
  for(const [play,assignment,at] of rows)accrueSettlement(f.db,play,assignment,at);
  assert.equal(f.db.settlement_buckets.length,5);
  assert.equal(new Set(f.db.settlement_buckets.map(b=>b.id)).size,5);
  assert.ok(f.db.settlement_buckets.every(b=>b.billable_plays===1));
  assert.equal(f.db.settlement_buckets.find(b=>b.screen_id==='screen2').org_id,'operator2');
  assert.equal(settlementKey('a__b','c','2026-09','v'),settlementKey('a__b','c','2026-09','v'));
  assert.notEqual(settlementKey('a__b','c','2026-09','v'),settlementKey('a','b__c','2026-09','v'));
});

test('late receipts use IST delivery month; out-of-order delivery preserves first and last',()=>{
  assert.equal(settlementPeriod(Date.parse('2026-09-30T18:29:59.999Z')),'2026-09');
  assert.equal(settlementPeriod(Date.parse('2026-09-30T18:30:00.000Z')),'2026-10');
  const f=fixture(), received={...f.play,server_received_at:'2026-10-02T06:00:00Z'};
  accrueSettlement(f.db,received,f.assignment,Date.parse('2026-09-30T18:29:59Z'));
  accrueSettlement(f.db,received,f.assignment,Date.parse('2026-09-29T12:00:00Z'));
  const b=f.db.settlement_buckets[0];assert.equal(b.period,'2026-09');
  assert.equal(b.first_play_at,'2026-09-29T12:00:00.000Z');assert.equal(b.last_play_at,'2026-09-30T18:29:59.000Z');
  assert.equal(b.updated_at,received.server_received_at);
  accrueSettlement(f.db,received,f.assignment,Date.parse('2026-09-30T18:30:00Z'));
  assert.equal(f.db.settlement_buckets[1].period,'2026-10');
});

test('nonbillable, flat and legacy assignments do not fabricate settled money',()=>{
  const f=fixture();
  accrueSettlement(f.db,{...f.play,billable:false},f.assignment,delivered);
  accrueSettlement(f.db,f.play,{...f.assignment,rate_type:'flat'},delivered);
  accrueSettlement(f.db,f.play,{...f.assignment,econ_version:undefined},delivered);
  assert.deepEqual(f.db.settlement_buckets,[]);
});

test('paise and percentage validation reject coercion, extra precision and unsafe amounts',()=>{
  assert.equal(paise(.29),29);assert.equal(paise(1e12),1e14);
  for(const value of [-1,NaN,Infinity,.001,Number.MAX_SAFE_INTEGER,'1',null,undefined])assert.throws(()=>paise(value),undefined,'value '+value);
  for(const value of [-1,NaN,Infinity,100.01,1.001,'10',null]) {
    assert.throws(()=>splitSettlement(100,value,10,'gross'));
    assert.throws(()=>splitSettlement(100,10,value,'gross'));
  }
  for(const value of [-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'100',null])assert.throws(()=>splitSettlement(value,10,10,'gross'));
  assert.throws(()=>splitSettlement(100,10,10,'unknown'));
  assert.throws(()=>fixture({org:{fee_basis:'unknown'}}));
});

test('splits retain exact integer conservation across small amounts and boundary shares',()=>{
  for(const basis of basisValues)for(const gross of [0,1,2,3,5,99,100,101,999,100001,Number.MAX_SAFE_INTEGER])for(const fee of [0,.01,12.35,50,99.99,100])for(const owner of [0,.01,12.35,50,99.99,100])assertConserved(splitSettlement(gross,fee,owner,basis));
});

test('accrual refuses gross amounts beyond the safe integer range',()=>{
  const f=fixture();
  f.assignment.rate_paise=Number.MAX_SAFE_INTEGER;
  accrueSettlement(f.db,f.play,f.assignment,delivered);
  assert.throws(()=>accrueSettlement(f.db,{...f.play,id:'play2'},f.assignment,delivered+1000),/supported range/);
});

test('clock normalization prefers server observation and clamps a claimed month shift',()=>{
  assert.equal(appliedOffset({clock_offset_estimate_ms:5000},999999),5000);
  assert.equal(appliedOffset({},999999),300000);
  assert.equal(appliedOffset({},-999999),-300000);
  assert.equal(appliedOffset({},NaN),0);
});

const {deviceRoute,issuePairing}=require('./load-lib.cjs')('devices');
const crypto=require('node:crypto');
function receiptFixture() {
  const f=fixture({campaign:{org_id:'origin1',rate_value:.01,accrued_spend:0}});
  let now=Date.parse('2026-09-30T18:29:00Z');
  const db={...f.db,orgs:[{...f.org,status:'active'},{id:'origin1',status:'active'}],screens:[{...f.screen,status:'active',has_camera:true}],campaigns:[f.campaign],devices:[],device_assignments:[],plays:[],presence:[]};
  const item={...f.assignment,campaign_id:f.campaign.id,creative_id:'creative1',duration_s:10,youtube_id:'video1'};
  const call=(method,path,body={},token)=>deviceRoute(db,method,path.split('/'),body,token,{now,playerProtocol:2,clientKey:crypto.randomUUID(),playlist:()=>({items:[item],config:{model:'coco-ssd',sample_interval_s:2,count_ceiling:50,camera_fail_mode:'continue'},config_version:1})});
  const paired=call('POST','pair',{code:issuePairing(db,db.screens[0],now).code}).body;
  const offered=call('GET','playlist/screen1',{},paired.token).body.items[0];
  const event=(overrides={})=>({play_uid:crypto.randomUUID(),seq_no:1,assignment_id:offered.assignment_id,campaign_id:f.campaign.id,creative_id:'creative1',config_version:1,started_at_device:'2026-09-30T18:29:00Z',ended_at_device:'2026-09-30T18:29:10Z',playing_duration_ms:10000,media_started_s:0,media_ended_s:10,ended_reason:'ended',server_clock_offset_ms:0,measured:false,avg_persons:null,sample_count:0,model_ver:null,...overrides});
  now+=11000;
  return {...f,db,offered,item,event,receive:body=>call('POST','play',body,paired.token),advance:n=>{now+=n}};
}

test('device receipt freezes provenance, settles once on retry and leaves origin campaign untouched',()=>{
  const f=receiptFixture(), originBefore=structuredClone(f.db.campaigns[0]);
  const assignment=f.db.device_assignments[0];
  assert.deepEqual(economics(assignment),economics(f.assignment));
  assert.equal(f.offered.rate_value,undefined,'financial inputs stay off player payload');
  const body=f.event({rate_paise:999999,platform_fee_pct:0,owner_share_pct:0,econ_version:'forged'});
  const first=f.receive(body);assert.equal(first.body.billable,true);
  assert.equal(f.db.settlement_buckets[0].gross_paise,1);
  assert.equal(f.db.settlement_buckets[0].fee_paise,1);
  assert.deepEqual(economics(f.db.plays[0]),economics(assignment));
  const retry=f.receive(body);assert.equal(retry.body.duplicate,true);
  assert.equal(f.db.plays.length,1);assert.equal(f.db.settlement_buckets[0].billable_plays,1);
  assert.equal(f.receive({...body,avg_persons:5}).status,409);
  assert.deepEqual(f.db.campaigns[0],originBefore,'operator device must never mutate origin-owned campaign');
});

test('offline receipt settles old assignment economics into delivery month after live edits',()=>{
  const f=receiptFixture(), old=f.event();
  f.db.orgs[0].platform_fee_pct=99;f.db.screens[0].owner_share_pct=99;f.db.campaigns[0].rate_value=999;
  Object.assign(f.item,freezeEconomics(f.db.campaigns[0],f.db.screens[0],f.db.orgs[0]));
  f.advance(36*3600e3);
  assert.equal(f.receive(old).body.billable,true);
  const bucket=f.db.settlement_buckets[0];assert.equal(bucket.period,'2026-09');assert.equal(bucket.gross_paise,1);
  assert.equal(bucket.platform_fee_pct,50);assert.equal(bucket.owner_share_pct,50);
  assert.equal(bucket.org_id,'operator1');assert.equal(bucket.econ_version,f.assignment.econ_version);
  assert.equal(f.db.plays[0].rate_value,.01);
});

test('incomplete device playback writes evidence without growing financial buckets',()=>{
  const f=receiptFixture();
  const response=f.receive(f.event({ended_reason:'error'}));
  assert.equal(response.body.billable,false);assert.equal(f.db.plays.length,1);
  assert.deepEqual(f.db.settlement_buckets,[]);
});
