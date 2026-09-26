const test=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-lib.cjs');
const {accrueScreenDay,reportingKey,reportDay,reportRange,emptyCounters,addCounters,summarizeReport,reportingVisible}=load('reporting');
const {accrueSettlement,settlementPeriod}=load('settlement');
const at=Date.parse('2026-09-23T18:29:59.000Z');
function fixture(){return {db:{},play:{org_id:'operator',screen_id:'screen',campaign_id:'campaign',creative_id:'creative',advertiser_id:'advertiser',timestamp_valid:true,rendered:true,billable:true,playing_duration_ms:10000,server_received_at:'2026-09-25T06:00:00.000Z',nonbillable_reasons:[]},assignment:{kind:'paid',advertiser_id:'advertiser'},presence:{measured:true,avg_persons:3}};}
function accrue(f,changes={},when=at,presence=f.presence){accrueScreenDay(f.db,{...f.play,...changes},f.assignment,when,presence);return f.db.screen_day.at(-1);}

test('rollup keeps identity and metadata intact while adding exact counters',()=>{
 const f=fixture(),row=accrue(f);
 assert.equal(row.id,reportingKey('screen','campaign','creative',at));assert.equal(row.org_id,'operator');assert.equal(row.date,'2026-09-23');assert.equal(row.campaign_id,'campaign');
 assert.equal(row.plays_rendered,1);assert.equal(row.plays_billable,1);assert.equal(row.presence_sum,3);assert.equal(row.presence_n,1);assert.equal(row.airtime_ms,10000);
 assert.equal(row.hours['23'].plays_rendered,1);assert.deepEqual(row.nonbillable,{});
 const extra={...emptyCounters(),id:'unaltered',hours:{}};addCounters(extra,{plays_rendered:2});assert.equal(extra.id,'unaltered');assert.deepEqual(extra.hours,{});
});

test('presence uses measured rendered paid plays: unmeasured is excluded and measured zero stays measured',()=>{
 const f=fixture();accrue(f);accrue(f,{},at,{measured:false,avg_persons:null});accrue(f,{},at,{measured:true,avg_persons:0});
 accrue(f,{rendered:false,billable:false,nonbillable_reasons:['error']},at,{measured:true,avg_persons:50});
 const row=f.db.screen_day[0];assert.equal(row.plays_rendered,3);assert.equal(row.plays_not_rendered,1);assert.equal(row.presence_n,2);assert.equal(row.presence_sum,3);assert.equal(row.presence_sum/row.presence_n,1.5);assert.equal(row.nonbillable.error,1);
 assert.ok(row.presence_n<=row.plays_rendered);
});

test('rendered nonbillable plays count as delivered without changing billing and filler stays separate',()=>{
 const f=fixture();accrue(f,{billable:false,nonbillable_reasons:['camera_required']});
 f.assignment.kind='filler';accrue(f,{campaign_id:null,creative_id:'filler',billable:false,nonbillable_reasons:['filler']});
 const [paid,filler]=f.db.screen_day;assert.equal(paid.plays_rendered,1);assert.equal(paid.plays_billable,0);assert.equal(filler.campaign_id,null);
 assert.equal(filler.plays_filler,1);assert.equal(filler.plays_rendered,0);assert.equal(filler.presence_n,0);assert.equal(filler.filler_presence_n,1);assert.equal(filler.filler_airtime_ms,10000);
 accrue(f,{campaign_id:null,creative_id:'filler',billable:false,rendered:false});assert.equal(filler.plays_filler,2);assert.equal(filler.filler_presence_n,1);
});

test('late receipt uses delivery day while invalid time is receive-day evidence only',()=>{
 const f=fixture();const row=accrue(f);assert.equal(row.date,'2026-09-23');assert.equal(row.updated_at,'2026-09-25T06:00:00.000Z');
 const bad=accrue(f,{timestamp_valid:false,nonbillable_reasons:['clock_or_assignment_window']},Date.parse('2000-01-01T00:00:00Z'));
 assert.equal(bad.date,'2026-09-25');assert.equal(bad.plays_time_invalid,1);assert.equal(bad.plays_rendered,0);assert.equal(bad.plays_billable,0);assert.equal(bad.presence_n,0);assert.deepEqual(bad.hours,{});
 assert.equal(f.db.reporting_coverage.started_at,f.play.server_received_at);
});

test('invalid-clock receipts never set play-time bounds or hour buckets',()=>{
 const invalid={timestamp_valid:false,nonbillable_reasons:['clock_or_assignment_window']};
 // Invalid only: the row exists for its counter, with no play time at all.
 const a=fixture(),only=accrue(a,invalid,Date.parse('2000-01-01T00:00:00Z'));
 assert.equal(only.plays_time_invalid,1);assert.equal(only.first_at,null);assert.equal(only.last_at,null);assert.deepEqual(only.hours,{});
 assert.equal(summarizeReport([only],{from:only.date,to:only.date},null).last_at,null);
 // Valid then invalid on the same receive-day row: the invalid receipt moves neither bound nor any hour.
 const b=fixture(),when=Date.parse('2026-09-25T05:00:00Z'),valid=accrue(b,{},when);
 const before={first_at:valid.first_at,last_at:valid.last_at,hours:JSON.parse(JSON.stringify(valid.hours))};
 const row=accrue(b,invalid,Date.parse('2000-01-01T00:00:00Z'));
 assert.equal(row,valid,'receive day and play day share one row');
 assert.equal(row.plays_time_invalid,1);assert.equal(row.plays_rendered,1);
 assert.equal(row.first_at,before.first_at);assert.equal(row.last_at,before.last_at);assert.deepEqual(row.hours,before.hours);
});

test('IST midnight, creative, campaign and screen form independent keys and dimensions',()=>{
 const f=fixture();accrue(f);accrue(f,{},at+1000);accrue(f,{creative_id:'creative2'},at);accrue(f,{campaign_id:'campaign2'},at);accrue(f,{screen_id:'screen2',org_id:'other'},at);
 assert.equal(f.db.screen_day.length,5);assert.equal(new Set(f.db.screen_day.map(r=>r.id)).size,5);
 assert.equal(reportDay(at),'2026-09-23');assert.equal(reportDay(at+1000),'2026-09-24');
 const s=summarizeReport(f.db.screen_day,{from:'2026-09-23',to:'2026-09-24'},f.db.reporting_coverage);
 assert.equal(s.totals.plays_rendered,5);assert.equal(s.byScreen.screen.plays_rendered,4);assert.equal(s.byCampaign.campaign.plays_rendered,4);assert.equal(s.byCreative.creative2.plays_rendered,1);
 assert.equal(s.daily['2026-09-23'].plays_rendered,4);assert.equal(s.hourly['23'].plays_rendered,4);assert.equal(s.hourly['0'].plays_rendered,1);
 assert.notEqual(reportingKey('a__b','c','d',at),reportingKey('a','b__c','d',at));
});

test('out-of-order reports preserve first/last and rollup weighting sums plays rather than daily averages',()=>{
 const f=fixture();accrue(f,{},at+1000,{measured:true,avg_persons:10});accrue(f,{},at,{measured:true,avg_persons:2});accrue(f,{},at-1000,{measured:true,avg_persons:2});
 const s=summarizeReport(f.db.screen_day,{from:'2026-09-23',to:'2026-09-24'},f.db.reporting_coverage);
 assert.equal(s.totals.presence_n,3);assert.equal(s.totals.presence_sum,14);assert.equal(s.last_at,new Date(at+1000).toISOString());assert.equal(f.db.screen_day[1].first_at,new Date(at-1000).toISOString());
});

test('coverage never claims first partial day, earlier dates or missing writer coverage complete',()=>{
 const range={from:'2026-09-23',to:'2026-09-25'};
 assert.equal(summarizeReport([],range,null).coverage.complete,false);
 assert.equal(summarizeReport([],range,{started_at:'2026-09-23T01:00:00Z'}).coverage.complete,false);
 assert.equal(summarizeReport([],range,{started_at:'2026-09-22T18:30:00Z'}).coverage.complete,true);
 assert.deepEqual(summarizeReport([],range,null).daily,{});
});

test('report date validation rejects overflow, reversed, oversized and future ranges',()=>{
 for(const [from,to] of [['2026-02-30','2026-03-01'],['2026-09-24','2026-09-23'],['2026-01-01','2026-06-01'],['9999-01-01','9999-01-01'],['bad','2026-09-23']])assert.throws(()=>reportRange(from,to),e=>e.status===400);
 assert.deepEqual(reportRange('2026-09-01','2026-09-23'),{from:'2026-09-01',to:'2026-09-23',lower:'2026-09-01__',upper:'2026-09-24__'});
});

test('report visibility isolates operators horizontally and advertisers by assigned advertiser',()=>{
 const row={org_id:'a',advertiser_id:'ad'};
 assert.equal(reportingVisible(row,{role:'owner',org_id:'a'},'b'),true);
 assert.equal(reportingVisible(row,{role:'owner',org_id:'b'}),false);
 assert.equal(reportingVisible(row,{role:'advertiser_viewer',org_id:'network',advertiser_id:'ad'}),true);
 assert.equal(reportingVisible(row,{role:'advertiser_viewer',org_id:'a',advertiser_id:'other'}),false);
 assert.equal(reportingVisible(row,{role:'advertiser_viewer',org_id:'a'}),false);
 assert.equal(reportingVisible(row,{role:'platform_admin'},'b'),false);
});

test('monthly settlement and valid-time per-play rollup agree without merging flat-rate settlement',()=>{
 const f=fixture();Object.assign(f.assignment,{rate_type:'per_play',econ_version:'v',rate_paise:10,platform_fee_pct:0,owner_share_pct:0,fee_basis:'gross'});
 for(const when of [Date.parse('2026-08-31T18:29:59Z'),Date.parse('2026-08-31T18:30:00Z')]){accrue(f,{},when);accrueSettlement(f.db,f.play,f.assignment,when);}
 for(const b of f.db.settlement_buckets){const sum=f.db.screen_day.filter(r=>r.date.slice(0,7)===b.period).reduce((n,r)=>n+r.plays_billable,0);assert.equal(sum,b.billable_plays);}
 assert.equal(settlementPeriod(Date.parse('2026-08-31T18:29:59Z')),'2026-08');
});

test('attention rollups combine compatible calibration modes while retaining bounded provenance and asset versions',()=>{
 const f=fixture();
 const attention={profile:'attention-v1/mediapipe-1.0.1',manifest_sha256:'manifest1',pipeline_sha256:'pipe1',attention:{playing_ms:10000,body:[9000,1000,0],face:[8000,2000,0],attention:[6000,4000],expression:[5000,5000],presence_person_ms:10000,looking_person_ms:5000,face_assessable_person_ms:7000,smile_person_ms:1000,expression_assessable_person_ms:5000,estimated_impressions:1,attentive_impressions:1,tracked_visits:1}};
 const assignment={...f.assignment,screen_id:'screen',asset_id:'asset1',asset_sha256:'asset-hash-1',config_version:1,attention_profile:attention.profile,attention_manifest_sha256:'manifest1',attention_pipeline_sha256:'pipe1',attention_calibration_revision:'calA'};
 const add=(mode,cal,asset,config,when=at)=>{const a={...assignment,asset_id:asset,asset_sha256:`hash-${asset}`,config_version:config,attention_calibration_revision:mode==='guided'?cal:null};const sample={...attention.attention,attention_mode:mode,calibration_revision:mode==='guided'?cal:null};const play={...f.play,attention_status:'accepted',attention_mode:mode,attention_profile:attention.profile,attention_manifest_sha256:'manifest1',attention_pipeline_sha256:'pipe1',attention:sample,attention_calibration:mode==='guided'?{yaw_tenths:12,pitch_tenths:-5,samples:10,span_ms:2700}:null};accrueScreenDay(f.db,play,a,when,f.presence);};
 add('guided','calA','asset1',1);add('guided','calA','asset1',1,at-1000);add('guided','calB','asset1',2);add('default',null,'asset2',3);
 assert.equal(f.db.screen_day.length,1,'commercial daily row stays compact and calibration-independent');
 assert.equal(f.db.attention_day.length,3,'bounded stored buckets preserve calibration mode/revision and asset/config provenance');
 const profiles=summarizeReport(f.db.screen_day,{from:'2026-09-23',to:'2026-09-24'},f.db.reporting_coverage,f.db.attention_day).attentionProfiles;
 assert.equal(Object.keys(profiles).length,1,'normal report combines compatible guided/default metrics');const report=Object.values(profiles)[0];
 assert.equal(report.totals.plays,4);assert.equal(report.totals.attention_observed_ms,24000);assert.equal(report.byCreative.creative.plays,4);assert.equal(Object.keys(report.byCreativeAsset).length,2);
 assert.equal(Object.keys(report.provenance).length,3);assert.equal(report.provenance['["default",null]'].totals.plays,1);assert.equal(report.provenance['["guided","calA"]'].totals.plays,2);
});

test('metrics authorization rejects foreign organisation, foreign campaign, foreign screen, and forced-password users',()=>{
 const {authorize}=load('access');const actor={id:'owner',role:'owner',org_id:'a'},db={orgs:[{id:'a'},{id:'b'}],screens:[{id:'sa',org_id:'a'},{id:'sb',org_id:'b'}],campaigns:[{id:'ca',org_id:'a',advertiser_id:'ad'},{id:'cb',org_id:'b',advertiser_id:'other'}]};
 for(const query of ['org=b','screen=sb','campaign=cb'])assert.throws(()=>authorize(db,actor,'GET',['metrics'],{},new URLSearchParams(query)),e=>e.status===404);
 assert.doesNotThrow(()=>authorize(db,actor,'GET',['metrics'],{},new URLSearchParams('org=a&screen=sa&campaign=ca')));
 assert.throws(()=>authorize(db,{...actor,must_change:true},'GET',['metrics'],{},new URLSearchParams()),e=>e.status===403);
 assert.throws(()=>authorize(db,{...actor,role:'advertiser_viewer',advertiser_id:'ad'},'GET',['metrics'],{},new URLSearchParams('campaign=cb')),e=>e.status===404);
});
