const test=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-lib.cjs');
const {deviceRoute,issuePairing}=load('devices');
const {freezeEconomics}=load('settlement');
const {creativeRotationIndex}=load('rotation');

// Accelerated in-memory protocol simulation, not a physical player/CV or wall-clock burn-in.
test('simulated 72h: assignment rotation, 48h report backlog, ACK loss and monthly settlement reconcile',()=>{
 const HOUR=3600e3, start=Date.parse('2026-09-29T00:00:00Z');let now=start,seq=0,lastRequestAt=start;
 const org={id:'operator',status:'active',platform_fee_pct:10,fee_basis:'gross'};
 const screen={id:'screen-endurance',org_id:org.id,status:'active',has_camera:true,owner_share_pct:25,rate_version:'rate-v1'};
 const campaign={id:'network-endurance',org_id:'gridcast',advertiser_id:'brand',campaign_type:'network',committed_budget:1000000000,rate_type:'per_play',rate_value:0.93,accrued_spend:0};
 const terms=freezeEconomics(campaign,screen,org);
 const db={orgs:[org,{id:'gridcast',status:'active'}],screens:[screen],campaigns:[campaign],devices:[],device_assignments:[],plays:[],presence:[],settlement_buckets:[]};
 const creatives=['creative-a','creative-b'];
 const playlist=(s,_device,index=0)=>({items:[{...terms,campaign_id:campaign.id,creative_id:creatives[creativeRotationIndex(s.id,index,0,2)],youtube_id:'synthetic-fixture',duration_s:10}],config:{model:'coco-ssd',sample_interval_s:2,count_ceiling:50,camera_fail_mode:'continue'},config_version:1,rotation_version:'stable-content-v1'});
 const call=(method,path,body={},token)=>{assert.ok(now>=lastRequestAt,'server time never rewinds');lastRequestAt=now;const r=deviceRoute(db,method,path.split('/'),body,token,{now,playerProtocol:2,playlist,clientKey:'endurance-fixture'});assert.ok(r);return {...r,status:r.status??200};};
 const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
 const paired=ok(call('POST','pair',issuePairing(db,screen,now)));
 const pending=[],issued=[],accepted=[];let duplicateCount=0;
 const flush=()=>{
  const through=now;
  pending.sort((a,b)=>a.due-b.due);
  while(pending.length&&pending[0].due<=through){
   const event=pending.shift(),before=JSON.stringify(db.settlement_buckets);now=event.due;
   const result=ok(call('POST','play',event.body,paired.token));assert.equal(result.billable,event.expectedBillable);
   if(!event.expectedBillable)assert.equal(JSON.stringify(db.settlement_buckets),before,'failed playback cannot change money');
   const persisted=JSON.stringify(db);const retry=ok(call('POST','play',event.body,paired.token));
   assert.equal(retry.duplicate,true);assert.equal(retry.play_id,result.play_id);assert.equal(retry.billable,result.billable);assert.equal(JSON.stringify(db),persisted,'lost ACK retry cannot append or accrue');
   duplicateCount++;accepted.push(event);
   assert.ok((db.devices[0].assignment_uses??[]).length<=72);assert.ok((db.devices[0].airtime_buckets??[]).length<=73);
  }
  now=through;
 };
 for(let hour=0;hour<72;hour++){
  now=start+hour*HOUR;flush();
  ok(call('POST','heartbeat',{device_now:new Date(now).toISOString(),config_version:1,uptime_s:hour*3600},paired.token));
  const item=ok(call('GET',`playlist/${screen.id}`,{},paired.token)).items[0];issued.push(item);
  assert.equal(db.devices[0].assignment_set.rotation_index,hour);assert.equal(db.device_assignments.length,hour+1);
  for(let poll=0;poll<4;poll++)assert.equal(ok(call('GET',`playlist/${screen.id}`,{},paired.token)).items[0].assignment_id,item.assignment_id);
  assert.equal(db.device_assignments.length,hour+1,'poll retries must not mint assignments');
  const frozen=db.device_assignments.find(a=>a.id===item.assignment_id);assert.equal(frozen.creative_id,item.creative_id);assert.equal(frozen.econ_version,terms.econ_version);
  if(hour===36){org.platform_fee_pct=99;screen.owner_share_pct=90;campaign.rate_value=900;}
  for(let slot=0;slot<5;slot++){
   const at=now+slot*10*60e3,failed=slot===4,duration=failed?0:10000;
   const body={play_uid:`endurance_${++seq}`,seq_no:seq,assignment_id:item.assignment_id,campaign_id:campaign.id,creative_id:item.creative_id,config_version:1,started_at_device:new Date(at).toISOString(),ended_at_device:new Date(at+duration).toISOString(),playing_duration_ms:duration,media_started_s:0,media_ended_s:failed?0:10,ended_reason:failed?'error':'ended',server_clock_offset_ms:0,measured:false,avg_persons:null,sample_count:0,model_ver:null};
   // Reporting can lag while playlist pulls continue; this exercises the server backlog protocol,
   // not a claim that an expired cached playlist remains billable during total network loss.
   const delay=[0,HOUR,48*HOUR][(hour+slot)%3];pending.push({body,due:at+duration+delay,expectedBillable:!failed});
  }
  now=start+hour*HOUR+59*60e3-1;flush();
  assert.equal(ok(call('GET',`playlist/${screen.id}`,{},paired.token)).items[0].assignment_id,item.assignment_id,'poll before renewal window stays cached');
 }
 // Drain delayed uploads in due-time order without rewinding the simulated server clock.
 while(pending.length){now=Math.max(now,Math.min(...pending.map(e=>e.due)));flush();}
 assert.equal(db.plays.length,360);assert.equal(db.presence.length,360);assert.equal(duplicateCount,360);assert.equal(db.plays.filter(p=>p.billable).length,288);
 assert.equal(db.device_assignments.length,72);assert.equal(issued.filter(i=>i.creative_id==='creative-a').length,36);assert.equal(issued.filter(i=>i.creative_id==='creative-b').length,36);
 assert.ok(db.plays.some(p=>p.delivery_lag_ms===48*HOUR));assert.ok(db.plays.every(p=>p.delivery_lag_ms<=48*HOUR));assert.ok(db.presence.every(p=>p.measured===false&&p.avg_persons===null&&p.model_ver===null));
 assert.equal(campaign.accrued_spend,0,'operator device never mutates source organisation campaign');
 const expected={'2026-09':171,'2026-10':117};assert.equal(db.settlement_buckets.length,2);
 for(const bucket of db.settlement_buckets){
  assert.equal(bucket.org_id,org.id);assert.equal(bucket.billable_plays,expected[bucket.period]);
  const gross=expected[bucket.period]*93,fee=Math.floor((gross*10+50)/100),owner=Math.floor(((gross-fee)*25+50)/100);
  assert.equal(bucket.gross_paise,gross);assert.equal(bucket.fee_paise,fee);assert.equal(bucket.owner_paise,owner);assert.equal(bucket.net_paise,gross-fee-owner);
  assert.equal(bucket.gross_paise,bucket.fee_paise+bucket.owner_paise+bucket.net_paise);
  assert.equal(bucket.platform_fee_pct,10);assert.equal(bucket.owner_share_pct,25);assert.equal(bucket.rate_value,0.93);assert.equal(bucket.econ_version,terms.econ_version);
 }
 assert.ok(db.plays.some(p=>p.started_at.slice(0,7)!==p.server_received_at.slice(0,7)),'late receipts cross delivery month');
 const earliest=accepted.find(e=>e.body.seq_no===1).body;now=start+150*HOUR;
 const snapshot=JSON.stringify(db);assert.equal(ok(call('POST','play',earliest,paired.token)).duplicate,true);
 assert.equal(call('POST','play',{...earliest,play_uid:'expired_new_report',seq_no:999},paired.token).status,409);
 assert.equal(call('POST','play',{...earliest,ended_reason:'timeout'},paired.token).status,409);
 assert.equal(JSON.stringify(db),snapshot,'expired and conflicting reports cannot change ledger');
});
