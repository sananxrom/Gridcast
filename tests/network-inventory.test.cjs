const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const mod = {exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../lib/inventory.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod,mod.exports);
const inv=mod.exports;
const orgs=[{id:'gridcast',status:'active'},{id:'operator',status:'active'},{id:'other',status:'active'}];
const screen=(patch={})=>({id:'screen',org_id:'operator',name:'Cafe',status:'active',aspect:'16:9',venue_type:'cafe',tags:{chain:'local'},loop_length_s:600,slot_duration_s:10,advertiser_slots:10,network_available:true,network_slots:6,operating_hours:{from:'00:00',to:'00:00'},...patch});
const campaign=(patch={})=>({id:'network',org_id:'gridcast',origin_org_id:'gridcast',campaign_type:'network',advertiser_id:'ad',status:'active',screen_ids:['screen'],creative_ids:['creative'],starts_at:'2026-09-01',ends_at:'2026-09-30',bookings:[{screen_id:'screen',slots_per_loop:1}],...patch});
const creative=(patch={})=>({id:'creative',org_id:'gridcast',advertiser_id:'ad',approval_status:'approved',category:'coffee',youtube_id:'test',aspect:'16:9',duration_s:15,...patch});
const booked=(patch={})=>campaign({bookings:[{screen_id:'screen',slots_per_loop:1,reserved_slot_units:2,booked_at:'2026-08-31T10:00:00Z'}],...patch});
const validate=(c=campaign(),cs=[],s=screen(),cr=[creative()],options={})=>inv.validateBooking(c,cs,[s],cr,{orgs,...options});
const eligible=(patch={})=>inv.eligibility({screen:screen(),screenOrg:orgs[1],campaign:booked(),creative:creative(),advertiser:{id:'ad',status:'active'},at:'2026-09-25T10:00:00Z',...patch});

test('only origin-owned network campaigns can book a receiving organisation screen',()=>{
 assert.equal(validate()[0].reserved_slot_units,2);
 assert.throws(()=>validate(campaign({campaign_type:'operator'})),{status:404});
 assert.throws(()=>validate(campaign({org_id:'operator'})),/origin organisation/);
 for(const options of [{orgs:[]},{orgs:[{id:'operator',status:'inactive'}]}]) assert.throws(()=>validate(campaign(),[],screen(),[creative()],options),/organisation is not active/);
 assert.throws(()=>inv.validateBooking(campaign(),[],[screen()],[creative()]),/organisation is not active/);
});

test('new network reservations need enabled release; nonholding drafts cannot grandfather on activation',()=>{
 for(const s of [screen({network_available:false}),screen({network_slots:0})]) {
  assert.throws(()=>validate(campaign(),[],s),/not accepting new network bookings/);
  const draft=booked({status:'draft'});
  assert.equal(validate(draft,[],s).length,1);
  assert.throws(()=>validate({...draft,status:'active'},[],s,[creative()],{previous:draft}),/not accepting new network bookings/);
 }
});

test('network release counts distinct advertisers, sharing the total with operator reservations',()=>{
 const s=screen({advertiser_slots:3,network_slots:1});
 const held=booked({id:'n1'});
 assert.equal(validate(campaign({id:'n2'}),[held],s).length,1); // same advertiser, another appearance
 assert.throws(()=>validate(campaign({advertiser_id:'second'}),[held],s),/Network advertiser capacity/);
 const op=campaign({id:'o1',org_id:'operator',origin_org_id:'operator',campaign_type:'operator',advertiser_id:'local'});
 const op2={...op,id:'o2',advertiser_id:'local2'};
 assert.equal(validate(op,[held],s).length,1);
 assert.equal(validate(op2,[held,op],s).length,1);
 assert.throws(()=>validate({...op2,id:'o3',advertiser_id:'local3'},[held,op,op2],s),/Advertiser capacity/);
 assert.throws(()=>validate(campaign({advertiser_id:'otherNetwork'}),[op,op2],screen({advertiser_slots:2,network_slots:2})),/Advertiser capacity/);
});

test('six retained network advertisers leave four operator entitlements after release shrinks to two',()=>{
 const s=screen({network_slots:2});
 const commitments=Array.from({length:6},(_,i)=>booked({id:`n${i}`,advertiser_id:`network${i}`}));
 for(const c of commitments) assert.equal(validate(c,commitments,s,[creative()],{previous:c}).length,1);
 assert.throws(()=>validate(campaign({id:'new'}),commitments,s),/Network advertiser capacity/);
 for(let i=0;i<4;i++) {
  const op=campaign({id:`op${i}`,org_id:'operator',origin_org_id:'operator',campaign_type:'operator',advertiser_id:`local${i}`});
  assert.equal(validate(op,commitments,s).length,1); commitments.push(op);
 }
 assert.throws(()=>validate(campaign({id:'overflow',org_id:'operator',origin_org_id:'operator',campaign_type:'operator',advertiser_id:'last'}),commitments,s),/Advertiser capacity/);
});

test('reduced or disabled release preserves frozen bookings without trusting submitted grandfather claims',()=>{
 const old=booked(), s=screen({network_available:false,network_slots:0});
 assert.equal(validate({...old,name:'renamed'},[old],s,[creative()],{previous:old}).length,1);
 assert.throws(()=>validate({...old,name:'renamed'},[old],s),/not accepting new network bookings/);
 assert.throws(()=>validate(old,[],s,[creative()],{previous:{...old,bookings:[{screen_id:'screen',slots_per_loop:1}]}}),/not accepting new network bookings/);
 assert.equal(eligible({screen:s}).eligible,true);
 assert.equal(eligible({screen:s,campaign:{...old,status:'paused'}}).reason,'campaign_not_active');
 assert.equal(validate({...old,status:'cancelled'},[old],s,[creative()],{previous:old,orgs:[]}).length,1);
});

test('slot growth, airtime growth, flight extension and reactivation must acquire new released capacity',()=>{
 const old=booked(), s=screen({network_available:false,network_slots:0});
 const changes=[
  {bookings:[{...old.bookings[0],slots_per_loop:2}]},
  {starts_at:'2026-08-31'}, {ends_at:'2026-10-01'}, {advertiser_id:'different'},
 ];
 for(const patch of changes) assert.throws(()=>validate({...old,...patch},[old],s,[creative()],{previous:old}),/not accepting new network bookings/);
 assert.throws(()=>validate(old,[old],s,[creative({duration_s:21})],{previous:old}),/not accepting new network bookings/);
 for(const status of ['draft','complete','cancelled']) assert.throws(()=>validate(old,[old],s,[creative()],{previous:{...old,status}}),/not accepting new network bookings/);
 assert.equal(validate({...old,status:'active'},[old],s,[creative()],{previous:{...old,status:'paused'}}).length,1);
 assert.equal(validate({...old,starts_at:'2026-09-10',ends_at:'2026-09-20'},[old],s,[creative()],{previous:old}).length,1);
});

test('retained entitlement does not bypass rounded airtime or shared total limits',()=>{
 const old=booked(), s=screen({network_available:false,network_slots:0,loop_length_s:20,advertiser_slots:2});
 const other=campaign({id:'local',org_id:'operator',origin_org_id:'operator',campaign_type:'operator',advertiser_id:'local'});
 assert.throws(()=>validate(old,[old,other],s,[creative()],{previous:old}),/Physical loop capacity/);
 assert.throws(()=>validate(old,[old,other],screen({network_slots:0,advertiser_slots:1}),[creative()],{previous:old}),/Advertiser capacity/);
});

test('airtime uses the longest creative variation and cross-organisation holds',()=>{
 const s=screen({loop_length_s:60,advertiser_slots:3});
 const local=campaign({id:'local',org_id:'operator',origin_org_id:'operator',campaign_type:'operator',advertiser_id:'local',bookings:[{screen_id:'screen',slots_per_loop:2}]});
 const vars=creative({assets:[{duration_s:10},{duration_s:21}]});
 assert.equal(validate(campaign(),[local],s,[creative()])[0].reserved_slot_units,2);
 assert.throws(()=>validate(campaign(),[local],s,[vars]),/Physical loop capacity/);
});

test('network capacity sweep respects disjoint calendar holds and paused or pending commitments',()=>{
 const s=screen({network_slots:1});
 const old=booked({id:'old',ends_at:'2026-09-10'});
 for(const status of ['active','paused','pending']) {
  assert.throws(()=>validate(campaign({advertiser_id:'different',starts_at:'2026-09-10'}),[{...old,status}],s),/Network advertiser capacity/);
  assert.equal(validate(campaign({advertiser_id:'different',starts_at:'2026-09-11'}),[{...old,status}],s).length,1);
 }
 for(const status of ['draft','complete','cancelled']) assert.equal(validate(campaign({advertiser_id:'different'}),[{...old,status}],s).length,1);
});

test('network eligibility requires a real booking and an active receiving org',()=>{
 assert.equal(eligible().eligible,true);
 assert.equal(eligible({campaign:campaign()}).reason,'network_booking_missing');
 assert.equal(eligible({campaign:booked({bookings:[]})}).reason,'network_booking_missing');
 assert.equal(eligible({screenOrg:undefined}).reason,'screen_org_not_active');
 assert.equal(eligible({screenOrg:{id:'other',status:'active'}}).reason,'screen_org_not_active');
 assert.equal(eligible({screenOrg:{id:'operator',status:'inactive'}}).reason,'screen_org_not_active');
 assert.equal(eligible({campaign:booked({org_id:'operator'})}).reason,'screen_not_targeted');
});

test('archived advertiser cannot play and network targeting never overrides either exclusion direction',()=>{
 assert.equal(eligible({advertiser:{status:'archived'}}).reason,'advertiser_archived');
 assert.equal(eligible({screen:screen({exclusions:{categories:['coffee']}})}).reason,'screen_category_block');
 assert.equal(eligible({screen:screen({exclusions:{advertisers:['ad']}})}).reason,'screen_advertiser_block');
 for(const exclusions of [{venue_types:['cafe']},{screens:['screen']},{tag_rules:[{chain:'local'}]}]) assert.equal(eligible({advertiser:{status:'active',exclusions}}).reason,'advertiser_venue_block');
});

test('network booking validation does not mutate the persisted commitment',()=>{
 const c=booked(),s=screen(),cr=creative(),options={orgs,previous:c};
 const before=JSON.stringify({c,s,cr,options}); validate(c,[c],s,[cr],options);
 assert.equal(JSON.stringify({c,s,cr,options}),before);
});
