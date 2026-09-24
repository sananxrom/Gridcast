const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const mod = { exports:{} };
new Function('module','exports',ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../lib/inventory.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod,mod.exports);
const inv = mod.exports;
const screen = (overrides={}) => ({id:'s1',org_id:'o1',name:'Cafe screen',venue_name:'Cafe',venue_type:'cafe',address:'Sector17',size_in:'43',status:'active',aspect:'16:9',loop_length_s:600,slot_duration_s:10,advertiser_slots:10,operating_hours:{from:'09:00',to:'21:00'},exclusions:{categories:[],advertisers:[]},...overrides});
const campaign = (overrides={})=>({id:'c1',org_id:'o1',origin_org_id:'o1',advertiser_id:'a1',status:'active',screen_ids:['s1'],creative_ids:['cr1'],starts_at:'2026-09-01',ends_at:'2026-09-30',committed_budget:100,accrued_spend:0,...overrides});
const creative = (overrides={})=>({id:'cr1',org_id:'o1',advertiser_id:'a1',category:'coffee',approval_status:'approved',youtube_id:'abc',aspect:'16:9',duration_s:10,...overrides});
const eligible = (overrides={})=>inv.eligibility({screen:screen(),campaign:campaign(),creative:creative(),at:'2026-09-24T10:00:00Z',...overrides});

test('screen onboarding preserves explicit physical, pricing and estimation provenance',()=>{
 const s=inv.validateScreenInput(screen({tags:{chain:'a',floor:'ground'},geo_lat:30,geo_lng:76}));
 assert.equal(s.monthly_value,5000); assert.equal(s.slot_price_month,500); assert.equal(s.exposure_source,'estimated');
 assert.equal(s.timezone,'Asia/Kolkata'); assert.deepEqual(s.tags,{chain:'a',floor:'ground'});
 assert.equal(inv.physicalCapacity(s),60); assert.equal(inv.defaultSlotsPerLoop(s),6);
 for(const patch of [{name:''},{slot_duration_s:0},{advertiser_slots:61},{owner_share_pct:101},{has_camera:'false'},{geo_lat:100},{operating_hours:{from:'25:00',to:'10:00'}},{aspect:'0:9'},{exposure_factor:4}]) assert.throws(()=>inv.validateScreenInput(screen(patch)),inv.InventoryError);
 assert.throws(()=>inv.validateScreenInput(screen({tags:JSON.parse('{"__proto__":"bad"}')})),inv.InventoryError);
});

test('reverse calculator keeps price and discloses repeated entitlement versus spec one-appearance assumption',()=>{
 const r=inv.reverseCalculate({monthly_revenue:12000,client_count:6,fill_rate:0.6,venue_base:5000,size_factor:1,loop_length_s:600,slot_duration_s:10,operating_hours:12});
 assert.equal(r.capacity_value,20000); assert.equal(r.advertiser_slots,10); assert.equal(r.derived_quality_factor,4); assert.equal(r.seed_slot_price_month,2000);
 assert.equal(r.loops_per_day,72); assert.equal(r.entitlement.slots_per_loop,6); assert.equal(r.entitlement.planned_plays_per_month,12960); assert.equal(r.entitlement.per_play,0.1543);
 assert.equal(r.one_appearance_reference.planned_plays_per_month,2160); assert.equal(r.one_appearance_reference.per_play,0.9259); assert.equal(r.one_appearance_reference.per_airtime_minute,5.5556);
 assert.equal(r.revenue_source,'self_reported'); assert.equal(r.presence,null); assert.equal(r.measurement_source,null);
 assert.equal(r.provenance.outputs,'derived'); assert.equal(r.provenance.assumptions.days_per_month,30);
 for(const field of ['client_count','fill_rate','operating_hours','slot_duration_s']) assert.throws(()=>inv.reverseCalculate({monthly_revenue:12000,client_count:6,fill_rate:.6,venue_base:5000,size_factor:1,loop_length_s:600,slot_duration_s:10,operating_hours:12,[field]:0}));
});

test('non-integer inferred clutter cap rounds explicitly without changing existing per-advertiser price',()=>{
 const r=inv.reverseCalculate({monthly_revenue:12000,client_count:6,fill_rate:.65,venue_base:5000,size_factor:1,loop_length_s:600,slot_duration_s:10,operating_hours:12});
 assert.equal(r.advertiser_slots,9); assert.equal(r.seed_slot_price_month,2000); assert.equal(r.seed_monthly_value,18000); assert.equal(r.warnings.length,1);
});

test('booking boundaries use inclusive IST date-only ends; timestamp end is exclusive',()=>{
 const a=campaign({id:'old',ends_at:'2026-09-10',bookings:[{screen_id:'s1',slots_per_loop:60}]}), s=screen({advertiser_slots:10});
 assert.throws(()=>inv.validateBooking(campaign({starts_at:'2026-09-10'}),[a],[s]),{status:409});
 assert.equal(inv.validateBooking(campaign({starts_at:'2026-09-11'}),[a],[s]).length,1);
 const b={...a,starts_at:'2026-09-10T00:00:00+05:30',ends_at:'2026-09-11T00:00:00+05:30'};
 assert.equal(inv.validateBooking(campaign({starts_at:'2026-09-11'}),[b],[s]).length,1);
 const [start,end]=inv.campaignInterval(campaign({starts_at:'2026-09-10',ends_at:'2026-09-10'}));
 assert.equal(new Date(start).toISOString(),'2026-09-09T18:30:00.000Z'); assert.equal(end-start,86400000);
 for(const dates of [{starts_at:'2026-02-30'},{ends_at:'2026-08-01'},{starts_at:'2026-09-01T00:00:00'}]) assert.throws(()=>inv.campaignInterval(campaign(dates)));
});

test('clutter counts distinct advertisers while same-advertiser campaigns consume separate physical capacity',()=>{
 const s=screen({advertiser_slots:1});
 const old=campaign({id:'old',bookings:[{screen_id:'s1',slots_per_loop:30}]});
 const c=campaign({bookings:[{screen_id:'s1',slots_per_loop:30}]});
 assert.equal(inv.validateBooking(c,[old],[s])[0].slots_per_loop,30);
 assert.throws(()=>inv.validateBooking({...c,advertiser_id:'a2'},[old],[s]),{status:409});
 assert.throws(()=>inv.validateBooking({...c,bookings:[{screen_id:'s1',slots_per_loop:31}]},[old],[s]),{status:409});
});

test('overlap validation sweeps time boundaries, never sums disjoint holds',()=>{
 const s=screen({advertiser_slots:2});
 const a=campaign({id:'a',starts_at:'2026-09-01',ends_at:'2026-09-10',bookings:[{screen_id:'s1',slots_per_loop:30}]}), b=campaign({id:'b',starts_at:'2026-09-11',ends_at:'2026-09-30',bookings:[{screen_id:'s1',slots_per_loop:30}]});
 assert.equal(inv.validateBooking(campaign({advertiser_id:'a2',bookings:[{screen_id:'s1',slots_per_loop:30}]}),[a,b],[s]).length,1);
});

test('paused and pending reserve capacity, drafts and complete do not; activation rechecks',()=>{
 const c=campaign({bookings:[{screen_id:'s1',slots_per_loop:60}]});
 for(const status of ['paused','pending','active']) assert.throws(()=>inv.validateBooking(c,[campaign({id:'hold',status})],[screen()]),{status:409});
 for(const status of ['draft','complete','cancelled']) assert.equal(inv.validateBooking(c,[campaign({id:'released',status})],[screen()]).length,1);
 assert.equal(inv.validateBooking({...c,status:'draft'},[campaign({id:'hold'})],[screen()]).length,1);
 assert.throws(()=>inv.validateBooking(c,[campaign({id:'hold'})],[screen()]),{status:409});
});

test('long creatives reserve rounded-up duration and all variations are considered',()=>{
 const s=screen({loop_length_s:60,advertiser_slots:2});
 const c=campaign({bookings:[{screen_id:'s1',slots_per_loop:3}],creative_ids:['cr1','long']});
 assert.equal(inv.validateBooking(c,[],[s],[creative(),creative({id:'long',duration_s:15})])[0].slots_per_loop,3);
 assert.throws(()=>inv.validateBooking({...c,bookings:[{screen_id:'s1',slots_per_loop:4}]},[],[s],[creative({duration_s:15})]),{status:409});
 assert.throws(()=>inv.validateBooking({...c,creative_ids:['cr1']},[],[s],[creative({duration_s:30})]),{status:409});
});

test('booking updates replace their old reservation; validation is pure and scoped',()=>{
 const c=campaign(), s=screen(), before=JSON.stringify({c,s});
 assert.equal(inv.validateBooking(c,[c],[s]).length,1); assert.equal(JSON.stringify({c,s}),before);
 assert.throws(()=>inv.validateBooking({...c,org_id:'o2'},[],[s]),{status:404});
 assert.throws(()=>inv.validateBooking({...c,screen_ids:['s1','s1']},[],[s]));
 assert.throws(()=>inv.validateBooking({...c,bookings:[{screen_id:'s2',slots_per_loop:1}]},[],[s]));
});

test('operating windows use IST including weekday overnight ownership and exclusive close',()=>{
 const w={from:'22:00',to:'02:00',days:[4]}; // Thursday 24 September.
 assert.equal(inv.withinWindow('2026-09-24T16:30:00Z',w),true);
 assert.equal(inv.withinWindow('2026-09-24T20:29:59Z',w),true);
 assert.equal(inv.withinWindow('2026-09-24T20:30:00Z',w),false);
 assert.equal(inv.withinWindow('2026-09-25T17:00:00Z',w),false);
 assert.equal(inv.withinWindow('2026-09-24T10:00:00Z',{from:'00:00',to:'00:00'}),true);
 assert.equal(eligible({at:'2026-09-24T15:30:00Z'}).reason,'outside_operating_hours');
 assert.equal(eligible({at:'2026-09-24T03:30:00Z'}).eligible,true);
});

test('date eligibility includes final local day; dayparts and explicit status are enforced',()=>{
 const s=screen({operating_hours:{from:'00:00',to:'00:00'}}), c=campaign({ends_at:'2026-09-24'});
 assert.equal(eligible({screen:s,campaign:c,at:'2026-09-24T18:29:59Z'}).eligible,true);
 assert.equal(eligible({screen:s,campaign:c,at:'2026-09-24T18:30:00Z'}).reason,'outside_campaign_dates');
 assert.equal(eligible({campaign:campaign({dayparts:[{from:'10:00',to:'11:00'}]})}).reason,'outside_campaign_daypart');
 assert.equal(eligible({campaign:campaign({status:'paused'})}).reason,'campaign_not_active');
 assert.equal(eligible({screen:screen({status:'maintenance'})}).reason,'screen_not_active');
});

test('eligibility chain logs first rejection, respects both block directions and manual budget policy',()=>{
 assert.equal(eligible({campaign:campaign({screen_ids:[]}),creative:undefined}).rejected_at_step,1);
 assert.equal(eligible({creative:creative({approval_status:'pending'}),settings:{blocked_categories:['coffee']}}).rejected_at_step,3);
 assert.equal(eligible({settings:{blocked_categories:['coffee']},screen:screen({exclusions:{categories:['coffee']}})}).rejected_at_step,4);
 assert.equal(eligible({screen:screen({exclusions:{categories:['coffee'],advertisers:['a1']}})}).rejected_at_step,5);
 assert.equal(eligible({screen:screen({exclusions:{advertisers:['a1']}})}).rejected_at_step,6);
 for(const exclusions of [{venue_types:['cafe']},{screens:['s1']}]) assert.equal(eligible({advertiser:{exclusions}}).rejected_at_step,7);
 const r=eligible({campaign:campaign({accrued_spend:120})}); assert.equal(r.eligible,true); assert.ok(r.warnings.includes('budget_exhausted_manual_action'));
 assert.equal(eligible({campaign:campaign({accrued_spend:80})}).warnings[0],'budget_80_percent');
});

test('aspect selects nearest playable variation with letterboxing and competitive separation',()=>{
 const cr=creative({assets:[{id:'vertical',uri:'/uploads/a.mp4',aspect:'9:16',duration_s:10},{id:'square',uri:'/uploads/b.mp4',aspect:'1:1',duration_s:10}]});
 const r=eligible({creative:cr}); assert.equal(r.asset.id,'square'); assert.equal(r.letterbox,true);
 assert.equal(eligible({creative:creative({youtube_id:'',uri:''})}).reason,'no_playable_asset');
 assert.equal(eligible({screen:screen({exclusions:{competitive_separation:true}}),loopAdvertisers:[{id:'a2',category:'coffee'}]}).rejected_at_step,8);
 assert.equal(eligible({screen:screen({exclusions:{competitive_separation:true}}),loopAdvertisers:[{id:'a1',category:'coffee'}]}).eligible,true);
});

test('dynamic groups use conjunction and preserve arbitrary tag keys without implicit expansion',()=>{
 const s=screen({city:'Chandigarh',tags:{chain:'a'}});
 assert.equal(inv.groupMatches(s,{venue_types:['cafe'],min_size:43,city:'Chandigarh',tags:{chain:'a'}}),true);
 assert.equal(inv.groupMatches(s,{venue_types:['cafe'],tags:{chain:'b'}}),false);
 assert.equal(eligible({screen:s,campaign:campaign({screen_ids:[],auto_expand:true})}).reason,'screen_not_targeted');
});
