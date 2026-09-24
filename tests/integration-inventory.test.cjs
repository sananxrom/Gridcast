const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const clone = x => JSON.parse(JSON.stringify(x));
function fixture(options = {}) {
  const env = { NODE_ENV: 'test', GC_DEMO_PASSWORD: crypto.randomBytes(24).toString('hex'), GC_AUTH_SECRET: crypto.randomBytes(32).toString('hex'), ...options.env };
  let saved = null, writes = 0;
  class StoreError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const store = { StoreError, transact: async (_context, fn) => fn(), mode: options.mode || 'memory', read: async () => saved && clone(saved),
    write: async value => { saved = clone(value); writes++; } };
  const cache = {};
  function load(file) {
    file = path.resolve(file);
    if (cache[file]) return cache[file].exports;
    const mod = { exports: {} }; cache[file] = mod;
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    }}).outputText;
    new Function('require','module','exports','process',code)(name => name === './store' ? store
      : name.startsWith('.') ? load(path.join(path.dirname(file), name + '.ts')) : require(name),
      mod, mod.exports, { env, cwd:()=>root });
    return mod.exports;
  }
  const auth = load(path.join(root,'lib/auth.ts'));
  const seed = load(path.join(root,'lib/seed.ts')).seed;
  if (options.seed !== false) saved = seed();
  if(!options.legacy){saved.campaigns=[];saved.plays=[];saved.presence=[];saved.configs=[];}
  const api = load(path.join(root,'lib/api.ts'));
  const media = load(path.join(root,'lib/media.ts'));
  const call = async (method, route, body = {}, token) => {
    const [p,q] = route.split('?');
    const r = await api.handle(method,p.split('/'),new URLSearchParams(q),body,token);
    return {...r,status:r.status || 200};
  };
  return { env, auth, media, call, data:()=>clone(saved), writes:()=>writes,
    token:id=>auth.issueToken(saved.users.find(u=>u.id===id)),
    change: fn=>fn(saved), seed };
}
function expectStatus(r,status) { assert.equal(r.status,status,JSON.stringify(r.body)); return r.body; }
const hasKey = (v,key) => v && typeof v==='object' && (Object.hasOwn(v,key) || Object.values(v).some(x=>hasKey(x,key)));

const screenInput=(patch={})=>({org_id:'org_sec17',name:'New cafe screen',venue_name:'Cafe test',address:'Chandigarh',venue_type:'cafe',size_in:'43',orientation:'landscape',loop_length_s:600,slot_duration_s:10,advertiser_slots:10,operating_hours:{from:'00:00',to:'00:00'},...patch});
const campaignInput=(sid,patch={})=>({org_id:'org_sec17',advertiser_id:'adv_fitline',name:'Integration campaign',starts_at:'2026-01-01',ends_at:'2027-12-31',status:'active',committed_budget:1000,rate_type:'per_play',rate_value:2,screen_ids:[sid],creative_ids:['cr_fit_b'],bookings:[{screen_id:sid,slots_per_loop:6}],...patch});
async function onboard(f,patch={}){return expectStatus(await f.call('POST','screens',screenInput(patch),f.token('u_op1')),201);}
async function book(f,sid,patch={}){return expectStatus(await f.call('POST','campaign',campaignInput(sid,patch),f.token('u_op1')),200);}

test('screen creation enforces org and capabilities; issued pairing code never leaks on later reads',async()=>{
 const f=fixture();const d=await onboard(f);
 assert.match(d.pairing.code,/^[A-Z2-9]{8}$/);assert.ok(Date.parse(d.pairing.expires_at)>Date.now());
 assert.equal(d.screen.code,undefined);assert.equal(d.screen.pairing_code_hash,undefined);
 const b=expectStatus(await f.call('GET','bootstrap',{},f.token('u_op1')),200);
 assert.equal(JSON.stringify(b).includes(d.pairing.code),false);assert.equal(hasKey(b,'pairing_code_hash'),false);
 expectStatus(await f.call('POST','screens',screenInput({org_id:'org_tricity'}),f.token('u_op1')),404);
 expectStatus(await f.call('POST','screens',screenInput(),f.token('u_adv1')),403);
 expectStatus(await f.call('POST',`screens/${d.screen.id}/pairing`,{},f.token('u_op2')),404);
});

test('actual API pairing exchanges code once, scopes token and revokes replacement devices',async()=>{
 const f=fixture(), {screen,pairing}=await onboard(f);
 const d=expectStatus(await f.call('POST','pair',{code:pairing.code}),200);assert.match(d.token,/^gcp_dev_/);
 expectStatus(await f.call('POST','pair',{code:pairing.code}),400);
 expectStatus(await f.call('GET',`playlist/${screen.id}`,{},f.token('u_op1')),401);
 expectStatus(await f.call('GET',`playlist/${f.data().screens[0].id}`,{},d.token),404);
 const list=expectStatus(await f.call('GET',`playlist/${screen.id}`,{},d.token),200);assert.deepEqual(list.items,[]);
 expectStatus(await f.call('POST','heartbeat',{device_now:new Date().toISOString(),config_version:list.config_version},d.token),200);
 const detail=expectStatus(await f.call('GET',`screen/${screen.id}`,{},f.token('u_op1')),200);assert.equal(detail.device.status,'online');assert.equal(detail.device.applied_config_version,list.config_version);
 expectStatus(await f.call('POST',`screens/${screen.id}/revoke-device`,{},f.token('u_op1')),200);
 expectStatus(await f.call('GET',`playlist/${screen.id}`,{},d.token),401);
});

test('booking prevents physical oversell and persists frozen agreed rate',async()=>{
 const f=fixture(),{screen}=await onboard(f),c=await book(f,screen.id,{bookings:[{screen_id:screen.id,slots_per_loop:40}]});
 assert.equal(c.bookings[0].rate_value,2);assert.ok(c.bookings[0].rate_version);assert.equal(c.bookings[0].slots_per_loop,40);
 expectStatus(await f.call('POST','campaign',campaignInput(screen.id,{name:'Overbook',bookings:[{screen_id:screen.id,slots_per_loop:21}]}),f.token('u_op1')),409);
 assert.equal(f.data().campaigns.length,1);
 const updated=expectStatus(await f.call('POST',`campaign/${c.id}`,{rate_value:99},f.token('u_op1')),200);assert.equal(updated.bookings[0].rate_value,2);
});

test('caller cannot inject a frozen booking rate or rewrite it while changing appearances',async()=>{
 const f=fixture(),{screen}=await onboard(f),c=await book(f,screen.id);
 const r=await f.call('POST',`campaign/${c.id}`,{rate_value:99,bookings:[{screen_id:screen.id,slots_per_loop:5,rate_value:-50,rate_version:'forged'}]},f.token('u_op1'));
 if(r.status===200){assert.equal(r.body.bookings[0].rate_value,2);assert.notEqual(r.body.bookings[0].rate_version,'forged');}else assert.equal(r.status,400);
 const u=expectStatus(await f.call('POST',`campaign/${c.id}`,{rate_value:99,bookings:[{screen_id:screen.id,slots_per_loop:5}]},f.token('u_op1')),200);assert.equal(u.bookings[0].rate_value,2);
});

test('effective screen config reductions cannot oversell a frozen booking',async()=>{
 const f=fixture(),{screen}=await onboard(f);await book(f,screen.id,{bookings:[{screen_id:screen.id,slots_per_loop:20}]});
 const snapshot=f.data();assert.ok([400,409].includes((await f.call('POST',`screen/${screen.id}/config`,{values:{loop_length_s:60}},f.token('u_op1'))).status));assert.deepEqual(f.data(),snapshot);
 assert.ok([400,409].includes((await f.call('POST',`screen/${screen.id}`,{loop_length_s:60},f.token('u_op1'))).status));assert.deepEqual(f.data(),snapshot);
});

test('existing self-reported price survives unrelated screen editing',async()=>{
 const f=fixture(),{screen}=await onboard(f,{rate_seed:{monthly_revenue:12000,client_count:6,fill_rate:.6,operating_hours:12}});assert.equal(screen.slot_price_month,2000);
 const updated=expectStatus(await f.call('POST',`screen/${screen.id}`,{name:'Renamed screen'},f.token('u_op1')),200);assert.equal(updated.slot_price_month,2000);assert.equal(updated.monthly_value,20000);
});

test('dynamic group resolution is scoped, available to sales, and campaign selection stays a snapshot',async()=>{
 const f=fixture(),{screen}=await onboard(f,{city:'Chandigarh',tags:{chain:'local'}});
 const g=expectStatus(await f.call('POST','group',{org_id:'org_sec17',name:'Local cafes',group_type:'dynamic',screen_ids:[],rule_json:{venue_types:['cafe'],city:'Chandigarh',tags:{chain:'local'}}},f.token('u_op1')),200);
 const resolved=expectStatus(await f.call('POST','group/resolve',{group_id:g.id},f.token('u_op4')),200);assert.deepEqual(resolved.screen_ids,[screen.id]);
 const c=await book(f,screen.id);const other=await onboard(f,{name:'Second cafe',city:'Chandigarh',tags:{chain:'local'}});
 const next=expectStatus(await f.call('POST','group/resolve',{group_id:g.id},f.token('u_op1')),200);assert.ok(next.screen_ids.includes(other.screen.id));assert.deepEqual(f.data().campaigns.find(x=>x.id===c.id).screen_ids,[screen.id]);
 expectStatus(await f.call('POST','group/resolve',{group_id:g.id},f.token('u_op2')),404);
});

test('changing group membership rechecks the effective capacity of attached configs',async()=>{
 const f=fixture(),{screen}=await onboard(f);await book(f,screen.id,{bookings:[{screen_id:screen.id,slots_per_loop:20}]});
 const g=expectStatus(await f.call('POST','group',{org_id:'org_sec17',name:'Empty group',group_type:'dynamic',screen_ids:[],rule_json:{min_size:1000}},f.token('u_op1')),200);
 expectStatus(await f.call('POST','config',{org_id:'org_sec17',name:'Short loops',layer:'group',target_id:g.id,values:{loop_length_s:60},status:'active'},f.token('u_op1')),200);
 const before=f.data();assert.ok([400,409].includes((await f.call('POST',`group/${g.id}`,{rule_json:{min_size:1}},f.token('u_op1'))).status));assert.deepEqual(f.data(),before);
});

test('asset metadata cannot be forged through creative body, unsigned proof, wrong purpose or different org',async()=>{
 const f=fixture(),t=f.token('u_op1');
 expectStatus(await f.call('POST','creative',{org_id:'org_sec17',advertiser_id:'adv_fitline',name:'Fake',assets:[{duration_s:1}],metadata_source:'server_ffprobe'},t),400);
 const cr=expectStatus(await f.call('POST','creative',{org_id:'org_sec17',advertiser_id:'adv_fitline',name:'Upload placeholder',category:'fitness'},t),200);
 const asset={id:'asset_test',asset_id:'asset_test',creative_id:cr.id,org_id:'org_sec17',duration_s:10,width:1920,height:1080,aspect:'1920:1080',storage_path:'media/org_sec17/asset_test.mp4',mime:'video/mp4',bytes:100,metadata_source:'server_ffprobe'};
 for(const proof of ['forged',f.media.sealMedia(asset,'read'),f.media.sealMedia({...asset,org_id:'org_tricity'},'upload')])expectStatus(await f.call('POST',`creative/${cr.id}/asset`,{proof},t),400);
 const proof=f.media.sealMedia(asset,'upload');expectStatus(await f.call('POST',`creative/${cr.id}/asset`,{proof},f.token('u_op2')),404);
 const saved=expectStatus(await f.call('POST',`creative/${cr.id}/asset`,{proof},t),201);assert.equal(saved.creative.approval_status,'pending');assert.equal(saved.creative.metadata_source,'server_ffprobe');assert.equal(saved.asset.duration_s,10);
 const assetAudit=f.data().audit.find(a=>a.entity==='assets'&&a.entity_id==='asset_test');assert.ok(assetAudit);assert.equal(assetAudit.actor_id,'u_op1');assert.ok(assetAudit.diff.storage_path.changed);assert.ok(!JSON.stringify(assetAudit).includes(asset.storage_path));
});

test('privacy removes every old frame route and never returns retained frame payloads',async()=>{
 const f=fixture(),{screen}=await onboard(f);f.change(db=>db.devices.push({id:'legacy',org_id:'org_sec17',screen_id:screen.id,status:'online',last_heartbeat_at:new Date().toISOString(),frame:'data:image/jpeg;base64,private',frame_url:'private',preview_frame:'private'}));
 expectStatus(await f.call('POST',`screen/${screen.id}/frame`,{frame:'bad'},f.token('u_op1')),404);
 expectStatus(await f.call('GET',`screen/${screen.id}/frame`,{},f.token('u_op1')),404);
 const d=expectStatus(await f.call('GET',`screen/${screen.id}`,{},f.token('u_op1')),200);assert.equal(JSON.stringify(d).includes('data:image/jpeg'),false);
});


test('legacy seeded campaigns can be explicitly frozen during normal editing without whole-tree conflicts',async()=>{
 const f=fixture({legacy:true});
 const result=expectStatus(await f.call('POST','campaign/cmp_1',{name:'Legacy renamed'},f.token('u_op1')),200);
 assert.ok(result.bookings.length===result.screen_ids.length);assert.ok(result.bookings.every(b=>b.rate_value===0.93));
 const d=f.data();const id=d.screens.find(s=>s.org_id==='org_sec17').id;expectStatus(await f.call('POST',`screen/${id}`,{name:'Legacy screen renamed'},f.token('u_op1')),200);
});

test('editing an empty screen validates physical fields and cannot claim measured rate provenance',async()=>{
 const f=fixture(),{screen}=await onboard(f),t=f.token('u_op1');
 for(const patch of [{advertiser_slots:0},{slot_duration_s:0},{has_camera:'yes'},{operating_hours:{from:'99:00',to:'10:00'}},{exposure_source:'measured'}]) {
   const before=f.data(),r=await f.call('POST',`screen/${screen.id}`,patch,t);assert.ok([400,403].includes(r.status),`Invalid patch accepted: ${JSON.stringify(patch)}`);assert.deepEqual(f.data(),before);
 }
});

test('malformed dynamic rules cannot be saved and break future schedule reads',async()=>{
 const f=fixture(),t=f.token('u_op1');
 for(const rule_json of [{venue_types:{}},{venue_types:[12]},{min_size:'not-a-number'},{tags:[]},{tags:{chain:{bad:true}}}]) {
  const before=f.data();const r=await f.call('POST','group',{org_id:'org_sec17',name:'Invalid rule',group_type:'dynamic',screen_ids:[],rule_json},t);assert.equal(r.status,400,JSON.stringify(rule_json));assert.deepEqual(f.data(),before);
 }
});

test('one real admin identity completes an empty-org commercial journey through API boundaries',async()=>{
 const nativeProbe=[process.env.GC_FFPROBE_PATH,'/opt/homebrew/bin/ffprobe','/usr/bin/ffprobe'].filter(Boolean).find(fs.existsSync);
 const f=fixture({env:nativeProbe?{GC_FFPROBE_PATH:nativeProbe}:{}}),admin=f.token('u_admin');
 const org=expectStatus(await f.call('POST','org',{name:'Empty journey org',support_email:'journey@example.invalid'},admin),200);
 const advertiser=expectStatus(await f.call('POST','advertiser',{org_id:org.id,name:'Journey advertiser',category:'general'},admin),200);
 const creative=expectStatus(await f.call('POST','creative',{org_id:org.id,advertiser_id:advertiser.id,name:'Journey uploaded clip',category:'general'},admin),200);
 const bytes=fs.readFileSync(path.join(root,'public/diagnostics/screen-test.mp4'));
 const metadata=await f.media.inspectVideo(bytes,'mp4');
 const asset={...metadata,id:'asset_journey',asset_id:'asset_journey',creative_id:creative.id,org_id:org.id,storage_path:`media/${org.id}/asset_journey.mp4`,mime:'video/mp4',bytes:bytes.length};
 // Exercises the upload handler's signed, inspected metadata handoff; no cloud/file storage fixture is created.
 expectStatus(await f.call('POST',`creative/${creative.id}/asset`,{proof:f.media.sealMedia(asset,'upload')},admin),201);
 expectStatus(await f.call('POST',`creative/${creative.id}/approve`,{status:'approved'},admin),200);
 const {screen,pairing}=expectStatus(await f.call('POST','screens',screenInput({org_id:org.id,has_camera:true}),admin),201);
 const empty=expectStatus(await f.call('GET',`screen/${screen.id}`,{},admin),200);assert.equal(empty.readiness.code,'no_campaign');
 const campaign=expectStatus(await f.call('POST','campaign',campaignInput(screen.id,{org_id:org.id,advertiser_id:advertiser.id,creative_ids:[creative.id],bookings:[{screen_id:screen.id,slots_per_loop:1}]}),admin),200);
 const paired=expectStatus(await f.call('POST','pair',{code:pairing.code}),200);
 const playlist=expectStatus(await f.call('GET',`playlist/${screen.id}`,{},paired.token),200);
 assert.equal(playlist.readiness.code,'eligible');const item=playlist.items[0];assert.equal(item.campaign_id,campaign.id);assert.equal(item.creative_id,creative.id);assert.ok(item.asset_url.startsWith('/api/media?grant='));
 const ended=Date.now(),duration=item.duration_s*1000;
 const report={assignment_id:item.assignment_id,play_uid:'journey_play_0001',seq_no:1,campaign_id:campaign.id,creative_id:creative.id,config_version:playlist.config_version,started_at_device:new Date(ended-duration).toISOString(),ended_at_device:new Date(ended).toISOString(),playing_duration_ms:duration,media_started_s:0,media_ended_s:item.duration_s,ended_reason:'ended',server_clock_offset_ms:0,measured:true,avg_persons:2,sample_count:5,model_ver:'coco-ssd@2.2.3/lite_mobilenet_v2'};
 expectStatus(await f.call('POST','play',report,paired.token),200);
 const detail=expectStatus(await f.call('GET',`screen/${screen.id}`,{},admin),200);
 assert.equal(detail.recent.length,1);assert.equal(detail.recent[0].presence.avg_persons,2);assert.equal(detail.recent[0].presence.model_ver,report.model_ver);
 assert.equal(detail.campaigns[0].accrued_spend,2);
 const boot=expectStatus(await f.call('GET',`bootstrap?org=${org.id}`,{},admin),200);assert.equal(boot.user.role,'platform_admin');assert.equal(boot.user.id,'u_admin');assert.equal(boot.advertisers[0].org_id,org.id);
 assert.ok(f.data().audit.filter(x=>x.org_id===org.id&&x.actor_kind==='human').every(x=>x.actor_id==='u_admin'));
 assert.ok(f.data().audit.some(x=>x.action==='pair'&&x.actor_kind==='device'&&x.actor_id===paired.device.id));
});
