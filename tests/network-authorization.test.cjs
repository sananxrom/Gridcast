const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const clone = x => JSON.parse(JSON.stringify(x));
function fixture(options = {}) {
  const env = { NODE_ENV: 'test', GC_DEMO_PASSWORD: crypto.randomBytes(24).toString('hex'), ...options.env };
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
      mod, mod.exports, { env });
    return mod.exports;
  }
  const auth = load(path.join(root,'lib/auth.ts'));
  const seed = load(path.join(root,'lib/seed.ts')).seed;
  if (options.seed !== false) saved = seed();
  const api = load(path.join(root,'lib/api.ts'));
  const call = async (method, route, body = {}, token) => {
    const [p,q] = route.split('?');
    const r = await api.handle(method,p.split('/'),new URLSearchParams(q),body,token);
    return {...r,status:r.status || 200};
  };
  return { env, auth, call, data:()=>clone(saved), writes:()=>writes,
    token:id=>auth.issueToken(saved.users.find(u=>u.id===id)),
    change: fn=>fn(saved), seed };
}
function expectStatus(r,status) { assert.equal(r.status,status,JSON.stringify(r.body)); return r.body; }
const hasKey = (v,key) => v && typeof v==='object' && (Object.hasOwn(v,key) || Object.values(v).some(x=>hasKey(x,key)));

function networkFixture() {
 const f=fixture(); let a,b;
 f.change(d=>{
  a=d.screens.find(s=>s.org_id==='org_sec17'); b=d.screens.find(s=>s.org_id==='org_tricity');
  for(const s of [a,b]) Object.assign(s,{network_available:true,network_slots:6,advertiser_slots:10,owner_share_pct:25});
  d.devices=[]; d.plays=[]; d.presence=[]; d.campaigns=[];
  const adv={id:'network-advertiser',org_id:'org_gridcast',name:'Network Brand',category:'beverage',status:'active',contact:'PRIVATE-CONTACT',email:'private@example.invalid',phone:'PRIVATE-PHONE',notes:'PRIVATE-NOTES'};
  d.advertisers.push(adv);
  d.creatives.push({id:'network-creative',org_id:'org_gridcast',advertiser_id:adv.id,name:'Network Video',category:'beverage',youtube_id:'Q5KmA8DHJdA',duration_s:10,aspect:'16:9',approval_status:'approved'});
  d.users.push({...d.users.find(u=>u.id==='u_adv1'),id:'network-viewer',org_id:'org_gridcast',advertiser_id:adv.id,email:'network@example.invalid'});
  d.campaigns.push({id:'network-campaign',org_id:'org_gridcast',origin_org_id:'org_gridcast',participant_org_ids:['org_sec17','org_tricity'],campaign_type:'network',advertiser_id:adv.id,name:'Network Campaign',creative_ids:['network-creative'],screen_ids:[a.id,b.id],starts_at:'2026-09-01',ends_at:'2026-10-31',status:'active',rate_type:'per_play',rate_value:1,committed_budget:999999,accrued_spend:777777,invoice_status:'paid',bookings:[a,b].map(s=>({screen_id:s.id,slots_per_loop:1,reserved_slot_units:1,booked_at:'2026-09-01T00:00:00Z',rate_type:'per_play',rate_value:1,rate_paise:100,rate_version:'rate-v1',econ_version:'econ-v1',fee_version:'fee-v1',platform_fee_pct:10,fee_basis:'gross',owner_share_pct:25}))});
  d.settlement_buckets=[a,b].map((s,i)=>({id:`bucket-${i}`,org_id:s.org_id,screen_id:s.id,campaign_id:'network-campaign',advertiser_id:adv.id,period:'2026-09',gross_paise:(i+1)*11100,billable_plays:(i+1)*111,fee_paise:(i+1)*1110,owner_paise:2500,net_paise:7490,platform_fee_pct:10,owner_share_pct:25,fee_basis:'gross',fee_version:'fee-v1',econ_version:'econ-v1',rate_value:1,rate_version:'rate-v1'}));
  for(const [i,s] of [a,b].entries()) {d.plays.push({id:`network-play-${i}`,org_id:s.org_id,screen_id:s.id,campaign_id:'network-campaign',advertiser_id:adv.id,creative_id:'network-creative',ended_at:'2026-09-25T00:00:00Z',rendered:true,billable:true,rate_value:1,platform_fee_pct:10,owner_share_pct:25,econ_version:'econ-v1'});d.presence.push({id:`network-play-${i}`,play_id:`network-play-${i}`,org_id:s.org_id,measured:false,avg_persons:null});}
 });
 return {...f,a:a.id,b:b.id};
}
function assertOwnCampaign(c,a) {
 assert.ok(c,'network campaign must remain visible to receiving operator');
 assert.deepEqual(c.screen_ids,[a]); assert.deepEqual(c.bookings.map(x=>x.screen_id),[a]);
 assert.equal(c.accrued_spend,111); assert.equal(c.spend_source,'settlement_buckets');
 for(const key of ['committed_budget','rate_value','rate_type','participant_org_ids','invoice_status']) assert.equal(Object.hasOwn(c,key),false,key);
}

test('network operator bootstrap exposes its own commitment and settlement, without another organisation or private contacts',async()=>{
 const f=networkFixture(), b=expectStatus(await f.call('GET','bootstrap',{},f.token('u_op1')),200);
 assertOwnCampaign(b.campaigns.find(c=>c.id==='network-campaign'),f.a);
 assert.ok(b.screens.every(s=>s.org_id==='org_sec17')); assert.deepEqual(b.plays.map(p=>p.id),['network-play-0']);
 assert.deepEqual(b.settlement_buckets.map(b=>b.id),['bucket-0']);
 const raw=JSON.stringify(b); for(const denied of [f.b,'network-play-1','bucket-1','PRIVATE-CONTACT','PRIVATE-PHONE','PRIVATE-NOTES','private@example.invalid','999999','777777']) assert.equal(raw.includes(denied),false,denied);
});

test('network campaign detail, directory and screen views cannot reveal campaign-wide commitments or foreign delivery',async()=>{
 const f=networkFixture(), token=f.token('u_op1');
 const detail=expectStatus(await f.call('GET','campaign/network-campaign',{},token),200);
 assertOwnCampaign(detail.campaign,f.a); assert.deepEqual(detail.byScreen.map(x=>x.screen.id),[f.a]);assert.equal(detail.totals.plays,1);
 const directory=expectStatus(await f.call('GET','directory?entity=campaigns',{},token),200);
 assertOwnCampaign(directory.items.find(c=>c.id==='network-campaign'),f.a);
 const screen=expectStatus(await f.call('GET',`screen/${f.a}`,{},token),200);
 const card=screen.campaigns.find(c=>c.id==='network-campaign'); assert.ok(card);
 assert.equal(Object.hasOwn(card,'committed_budget'),false);assert.equal(card.accrued_spend,111);
 for(const body of [detail,directory,screen]) {const raw=JSON.stringify(body);for(const denied of [f.b,'network-play-1','bucket-1','999999','777777']) assert.equal(raw.includes(denied),false,denied);}
 expectStatus(await f.call('GET',`screen/${f.b}`,{},token),404);
});

test('network money remains hidden from sales while advertiser sees own cross-org delivery and spend without fee or owner economics',async()=>{
 const f=networkFixture();
 const sales=expectStatus(await f.call('GET','bootstrap',{},f.token('u_op4')),200);
 const c=sales.campaigns.find(c=>c.id==='network-campaign');assert.ok(c);assert.deepEqual(c.screen_ids,[f.a]);
 for(const key of ['accrued_spend','gross_paise','fee_paise','owner_paise','net_paise','platform_fee_pct','owner_share_pct']) assert.equal(hasKey(sales,key),false,key);
 for(const route of ['bootstrap','campaign/network-campaign']) {
  const b=expectStatus(await f.call('GET',route,{},f.token('network-viewer')),200);
  const campaign=b.campaign||b.campaigns.find(c=>c.id==='network-campaign');
  assert.deepEqual(new Set(campaign.screen_ids),new Set([f.a,f.b]));assert.equal(campaign.accrued_spend,333);
  assert.equal(b.plays.length,2);
  for(const key of ['fee_paise','owner_paise','net_paise','platform_fee_pct','owner_share_pct','fee_basis','fee_version','econ_version']) assert.equal(hasKey(b,key),false,key);
 }
});

test('only platform admin creates or edits network campaigns; participant orgs are derived and campaign type is immutable',async()=>{
 const f=networkFixture(), body={org_id:'org_gridcast',advertiser_id:'network-advertiser',campaign_type:'network',creative_ids:['network-creative'],screen_ids:[f.a,f.b],name:'Created Network',starts_at:'2026-11-01',ends_at:'2026-11-30',committed_budget:100,rate_type:'per_play',rate_value:1,bookings:[{screen_id:f.a,slots_per_loop:1},{screen_id:f.b,slots_per_loop:1}]};
 for(const id of ['u_op1','u_op2']) {
  const result=await f.call('POST','campaign',body,f.token(id));assert.ok([403,404].includes(result.status));
  expectStatus(await f.call('POST','campaign/network-campaign',{name:'Hijacked'},f.token(id)),403);
 }
 const admin=f.token('u_admin');
 expectStatus(await f.call('POST','campaign',{...body,participant_org_ids:['org_sec17']},admin),400);
 expectStatus(await f.call('POST','campaign/network-campaign',{campaign_type:'operator'},admin),400);
 const created=expectStatus(await f.call('POST','campaign',body,admin),200);
 assert.deepEqual(new Set(created.participant_org_ids),new Set(['org_sec17','org_tricity']));assert.equal(created.org_id,'org_gridcast');assert.equal(created.origin_org_id,'org_gridcast');
 assert.ok(created.bookings.every(b=>b.econ_version&&b.fee_version&&b.booked_at&&b.reserved_slot_units===1));
 expectStatus(await f.call('POST','campaign',{...body,rate_type:'flat'},admin),400);
});

test('installers cannot release or change sellable network inventory',async()=>{
 const f=networkFixture(),before=f.data();
 for(const patch of [{network_available:false},{network_slots:10}]) expectStatus(await f.call('POST',`screen/${f.a}`,patch,f.token('u_op5')),403);
 assert.deepEqual(f.data(),before);
});

test('editing an existing operator campaign preserves legacy charged spend alongside new verified settlement',async()=>{
 const f=fixture();let screen;
 f.change(d=>{
  screen=d.screens.find(s=>s.org_id==='org_sec17').id;
  d.campaigns=d.campaigns.filter(c=>c.id==='cmp_1');const c=d.campaigns[0];
  Object.assign(c,{accrued_spend:9,screen_ids:[screen],bookings:[{screen_id:screen,slots_per_loop:1,rate_type:'per_play',rate_value:1,rate_version:'legacy',booked_at:'2026-09-01T00:00:00Z'}]});
  d.settlement_buckets=[{id:'new-bucket',org_id:'org_sec17',screen_id:screen,campaign_id:'cmp_1',advertiser_id:c.advertiser_id,period:'2026-09',billable_plays:3,gross_paise:300,fee_paise:0,owner_paise:0,net_paise:300}];
 });
 expectStatus(await f.call('POST','campaign/cmp_1',{name:'Preserve balance'},f.token('u_op1')),200);
 const detail=expectStatus(await f.call('GET','campaign/cmp_1',{},f.token('u_op1')),200);
 assert.equal(detail.campaign.accrued_spend,12);assert.equal(detail.campaign.spend_source,'legacy_accrual_and_verified_settlement');
});


test('advertiser keeps historical venues backed by settlement even when targeting and recent receipts no longer include them',async()=>{
 const f=networkFixture();f.change(d=>{d.campaigns[0].screen_ids=[f.a];d.plays=[];d.presence=[];});
 const viewer=f.token('network-viewer');
 const boot=expectStatus(await f.call('GET','bootstrap',{},viewer),200);
 assert.deepEqual(boot.screens.map(s=>s.id).sort(),[f.a,f.b].sort());
 const detail=expectStatus(await f.call('GET','campaign/network-campaign',{},viewer),200);
 assert.deepEqual(detail.byScreen.map(r=>r.screen.id).sort(),[f.a,f.b].sort());
 assert.equal(detail.campaign.accrued_spend,333);assert.equal(hasKey(boot,'owner_share_pct'),false);
});
