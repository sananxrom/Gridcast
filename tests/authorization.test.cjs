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

test('anonymous reset, entities, frames and settings are denied; unknown routes are closed',async()=>{
 const f=fixture(); const sid=f.data().screens[0].id;
 for(const [m,p] of [['POST','reset'],['GET',`screen/${sid}/frame`],['GET',`screen/${sid}`],['POST','settings'],['POST','org'],['GET','bootstrap']])
   expectStatus(await f.call(m,p),401);
 expectStatus(await f.call('POST','future-route',{},f.token('u_op1')),404);
 expectStatus(await f.call('POST','reset',{},f.token('u_admin')),403);
 assert.equal(f.writes(),0);
});

test('tenant boundaries cover reads and every entity mutation before writes',async()=>{
 const f=fixture(), d=f.data(), t=f.token('u_op2'), sid=d.screens[0].id;
 const requests=[['GET',`screen/${sid}`],['GET',`screen/${sid}/frame`],['GET','campaign/cmp_1'],
 ['POST',`screen/${sid}`,{name:'x'}],['POST',`screen/${sid}/config`,{values:{volume:1}}],
 ['POST',`screen/${sid}/reprice`],['POST',`screen/${sid}/exclusions`,{exclusions:{categories:[],advertisers:[]}}],
 ['POST','campaign/cmp_1',{name:'x'}],['POST','config/cfg_s17',{name:'x'}],['POST','config/cfg_s17/delete'],
 ['POST','group/resolve',{group_id:'grp_s17'}],['POST','org/org_sec17',{name:'x'}],
 ['POST','user/u_op3',{name:'x'}],['POST','user/u_op3/newpassword'],
 ['POST','advertiser',{org_id:'org_sec17',name:'x'}],['POST','creative',{org_id:'org_sec17',advertiser_id:'adv_fitline'}],
 ['POST','invite',{org_id:'org_sec17',role:'sales',email:'test@example.invalid'}]];
 for(const [m,p,b={}] of requests) expectStatus(await f.call(m,p,b,t),404);
 assert.deepEqual(f.data(),d); assert.equal(f.writes(),0);
});

test('advertiser sees only their campaigns and related evidence, without account secrets',async()=>{
 const f=fixture(), t=f.token('u_adv1');
 const b=expectStatus(await f.call('GET','bootstrap',{},t),200);
 assert.deepEqual(b.campaigns.map(c=>c.id),['cmp_1']);
 assert.ok(b.plays.every(p=>p.campaign_id==='cmp_1'));
 assert.ok(b.presence.every(p=>p.org_id==='org_sec17' && b.plays.some(x=>x.id===p.play_id)));
 assert.equal(b.orgs.length,1); assert.equal(b.devices.length,0); assert.equal(b.configs.length,0);
 for(const k of ['password_hash','password_salt','auth_version','code','upi_id','pan','owner_share_pct']) assert.ok(!hasKey(b,k),k);
 expectStatus(await f.call('GET','campaign/cmp_2',{},t),404);
 expectStatus(await f.call('POST','campaign/cmp_1',{name:'x'},t),403);
 expectStatus(await f.call('POST','config',{layer:'platform'},t),403);
 expectStatus(await f.call('POST','settings',{},t),403);
});

test('manager cannot take over owners, assign owner roles, change fees or payouts',async()=>{
 const f=fixture(), t=f.token('u_op3');
 for(const [p,b] of [['invite',{role:'owner',email:'x@example.invalid'}],['user/u_op4/role',{role:'owner'}],
 ['user/u_op1',{email:'x@example.invalid'}],['user/u_op1/newpassword',{}],['user/u_op1/status',{status:'disabled'}],
 ['org/org_sec17',{_as:'platform_admin',platform_fee_pct:0}],['org/org_sec17',{upi_id:'other'}]])
   expectStatus(await f.call('POST',p,b,t),403);
 assert.equal(f.writes(),0);
 const b=expectStatus(await f.call('GET','bootstrap',{},t),200);
 for(const k of ['pan','gstin','upi_id','owner_share_pct','password_hash']) assert.ok(!hasKey(b,k),k);
 expectStatus(await f.call('POST','org/org_sec17',{name:'New name'},t),200);
});

test('capabilities and field allowlists reject escalation and ownership reassignment',async()=>{
 const f=fixture(), sid=f.data().screens[0].id;
 for(const [id,p,b,status] of [
 ['u_op4',`screen/${sid}`,{name:'x'},403],['u_op5','campaign/cmp_1',{name:'x'},403],
 ['u_op5',`screen/${sid}`,{venue_base:1},403],['u_op3',`screen/${sid}`,{owner_share_pct:100},403],
 ['u_op1',`screen/${sid}`,{org_id:'org_tricity'},400],['u_op1',`screen/${sid}`,{monthly_value:1},400],
 ['u_op1','creative/cr_fit_a/approve',{status:'approved'},403],['u_op1','settings',{},403],
 ['u_op1','org',{name:'x'},403],['u_op4','campaign/cmp_1',{invoice_status:'paid'},403]])
  expectStatus(await f.call('POST',p,b,f.token(id)),status);
 assert.equal(f.writes(),0);
 expectStatus(await f.call('POST','creative/cr_fit_a/approve',{status:'approved'},f.token('u_admin')),200);
});

test('configuration layer privilege, target ownership and bulk atomicity',async()=>{
 const f=fixture(), d=f.data(), t=f.token('u_op1'), sid=d.screens[0].id, foreign=d.screens.find(s=>s.org_id==='org_tricity').id;
 for(const [p,b,status] of [
 ['config',{layer:'platform',values:{confidence_min:0.01}},403],
 ['config/cfg_s17',{layer:'platform'},403],['config/cfg_base/delete',{},404],
 ['config',{layer:'screen',target_id:foreign,values:{}},404],
 [`screen/${sid}/config`,{values:{confidence_min:0.01}},403],
 ['config/assign',{config_id:'cfg_base',screen_ids:[sid]},403],
 ['config/assign',{config_id:'cfg_s17',screen_ids:[sid,foreign]},404]])
  expectStatus(await f.call('POST',p,b,t),status);
 assert.deepEqual(f.data(),d); assert.equal(f.writes(),0);
 expectStatus(await f.call('POST','config/assign',{config_id:'cfg_s17',screen_ids:[sid]},t),200);
 expectStatus(await f.call('POST','config/cfg_base',{values:{confidence_min:0.6}},f.token('u_admin')),200);
});

test('campaign relationships cannot reference unrelated orgs or advertisers; own edits still work',async()=>{
 const f=fixture(), t=f.token('u_op1'), d=f.data(), sid=d.screens[0].id;
 expectStatus(await f.call('POST','campaign/cmp_1',{creative_ids:['cr_den_a']},t),400);
 expectStatus(await f.call('POST','campaign/cmp_1',{screen_ids:[d.screens.find(s=>s.org_id==='org_tricity').id]},t),404);
 expectStatus(await f.call('POST','campaign',{advertiser_id:'adv_mobile',screen_ids:[sid],creative_ids:['cr_mob_a']},t),400);
 expectStatus(await f.call('POST','campaign/cmp_1',{name:'Revised campaign'},t),200);
 expectStatus(await f.call('POST','campaign/cmp_net1',{status:'paused'},t),200);
 expectStatus(await f.call('POST','campaign',{advertiser_id:'adv_fitline',screen_ids:[sid],creative_ids:['cr_fit_a'],name:'New',starts_at:'2027-01-01',ends_at:'2027-01-31',committed_budget:1000,rate_type:'per_play',rate_value:1},t),200);
});

test('network campaign references remain visible without counterparty private contact fields',async()=>{
 const f=fixture(), t=f.token('u_op1');
 const b=expectStatus(await f.call('GET','bootstrap',{},t),200);
 assert.ok(b.creatives.some(c=>c.id==='cr_zep_a'));
 const net=b.campaigns.find(c=>c.id==='cmp_net1'); assert.equal(net.platform_fee_pct,10);
 const detail=expectStatus(await f.call('GET','campaign/cmp_net1',{},t),200);
 assert.equal(detail.advertiser.name,'Zephyr Beverages');
 for(const k of ['email','phone','contact']) assert.equal(detail.advertiser[k],undefined);
});

test('sales screen detail excludes operations; installer responses exclude money',async()=>{
 const f=fixture(), sid=f.data().screens[0].id;
 const sales=expectStatus(await f.call('GET',`screen/${sid}`,{},f.token('u_op4')),200);
 for(const k of ['config','configStack','frameUrl','code','priced_against']) assert.ok(!hasKey(sales,k),k);
 assert.equal(sales.status.device,undefined);
 const inst=expectStatus(await f.call('GET',`screen/${sid}`,{},f.token('u_op5')),200);
 for(const k of ['committed_budget','accrued_spend','slot_price_month','owner_share_pct','venue_base']) assert.ok(!hasKey(inst,k),k);
 expectStatus(await f.call('POST',`screen/${sid}`,{name:'Installer edit'},f.token('u_op5')),200);
});

test('password changes, disable/re-enable, reset and logout revoke existing tokens',async()=>{
 const f=fixture(), owner=f.token('u_op1'), adv=f.token('u_adv1');
 expectStatus(await f.call('POST','user/u_adv1/status',{status:'disabled'},owner),200);
 expectStatus(await f.call('GET','me',{},adv),401);
 expectStatus(await f.call('POST','user/u_adv1/status',{status:'active'},owner),200);
 expectStatus(await f.call('GET','me',{},adv),401);
 const old=f.token('u_op4');
 const pw=expectStatus(await f.call('POST','password',{current:f.env.GC_DEMO_PASSWORD,next:crypto.randomBytes(16).toString('hex')},old),200);
 expectStatus(await f.call('GET','me',{},old),401); expectStatus(await f.call('GET','me',{},pw.token),200);
 expectStatus(await f.call('POST','logout',{},pw.token),200);
 expectStatus(await f.call('GET','me',{},pw.token),401);
 const oldManager=f.token('u_op3');
 expectStatus(await f.call('POST','user/u_op3/newpassword',{},owner),200);
 expectStatus(await f.call('GET','me',{},oldManager),401);
});

test('temporary credentials require password change; legitimate login and self-profile work',async()=>{
 const f=fixture(), owner=f.token('u_op1');
 const invited=expectStatus(await f.call('POST','invite',{name:'Test',email:'test@example.invalid',role:'sales'},owner),200);
 const login=expectStatus(await f.call('POST','login',{email:'test@example.invalid',password:invited.temp_password}),200);
 expectStatus(await f.call('GET','bootstrap',{},login.token),403);
 expectStatus(await f.call('POST',`user/${invited.user.id}`,{name:'x'},login.token),403);
 const changed=expectStatus(await f.call('POST','password',{next:crypto.randomBytes(16).toString('hex')},login.token),200);
 expectStatus(await f.call('GET','bootstrap',{},changed.token),200);
 const profile=expectStatus(await f.call('POST',`user/${invited.user.id}`,{name:'Updated'},changed.token),200);
 assert.equal(profile.name,'Updated'); assert.ok(!hasKey(profile,'password_hash'));
});

test('device routes require credentials, pairing codes are one-time, and frame routes are removed',async()=>{
 const f=fixture(), sid=f.data().screens[0].id, owner=f.token('u_op1');
 for(const [m,p,b] of [['GET',`playlist/${sid}`,{}],['POST','play',{screen_id:sid}],
 ['POST','nowplaying',{screen_id:sid}],['POST','heartbeat',{screen_id:sid}]])
  expectStatus(await f.call(m,p,b),401);
 expectStatus(await f.call('POST','pair',{code:f.data().screens[0].code}),400);
 expectStatus(await f.call('GET',`screen/${sid}/frame`,{},owner),404);
 expectStatus(await f.call('POST',`screen/${sid}/frame`,{data:'test'},owner),404);
 const pairing=expectStatus(await f.call('POST',`screens/${sid}/pairing`,{},owner),200);
 const paired=expectStatus(await f.call('POST','pair',{code:pairing.code}),200);
 assert.ok(paired.token.startsWith('gcp_')); assert.equal(paired.device.token_hash,undefined);
 expectStatus(await f.call('POST','pair',{code:pairing.code}),400);
 expectStatus(await f.call('POST','heartbeat',{device_now:new Date().toISOString(),config_version:1,app_ver:'test'},paired.token),200);
 assert.equal(f.data().devices.find(d=>d.id===paired.device.id).app_ver,'test');
 expectStatus(await f.call('POST',`screens/${sid}/revoke-device`,{},owner),200);
 expectStatus(await f.call('POST','heartbeat',{device_now:new Date().toISOString()},paired.token),401);
 f.env.NODE_ENV='production'; f.env.GC_AUTH_SECRET=crypto.randomBytes(32).toString('hex');
 expectStatus(await f.call('GET','_health'),503);
 const prod=fixture({mode:'redis'}); prod.env.NODE_ENV='production'; prod.env.GC_AUTH_SECRET=crypto.randomBytes(32).toString('hex');
 expectStatus(await prod.call('GET','_health'),503);
});

test('production refuses missing secret, non-durable storage and automatic demo seeding',async()=>{
 const f=fixture(); f.env.NODE_ENV='production';
 expectStatus(await f.call('GET','_health'),503);
 f.env.GC_AUTH_SECRET=crypto.randomBytes(32).toString('hex'); expectStatus(await f.call('GET','_health'),503);
 const empty=fixture({seed:false,mode:'firestore',env:{NODE_ENV:'production',GC_AUTH_SECRET:crypto.randomBytes(32).toString('hex')}});
 expectStatus(await empty.call('GET','_health'),503);
 assert.equal(empty.writes(),0); assert.throws(()=>empty.seed());
});

test('malformed and old-format tokens fail cleanly; nonobject input is rejected',async()=>{
 const f=fixture();
 for(const t of ['x.y','a.'.repeat(100), '💥.abc', 'a'.repeat(5000)]) expectStatus(await f.call('GET','me',{},t),401);
 expectStatus(await f.call('POST','settings',[],f.token('u_admin')),400);
 const old=Buffer.from(JSON.stringify({uid:'u_admin',role:'platform_admin',org:'org_gridcast',exp:Date.now()+10000})).toString('base64url');
 assert.equal(f.auth.readToken(old+'.invalid'),null);
});


test('unknown and prototype configuration keys cannot poison screen resolution',async()=>{
 const f=fixture(), t=f.token('u_op1'), sid=f.data().screens[0].id;
 for(const key of ['__proto__','constructor','toString','invented_setting']) {
  const values=JSON.parse(`{"${key}":{"test":true}}`);
  expectStatus(await f.call('POST','config',{layer:'org',values},t),400);
  expectStatus(await f.call('POST',`screen/${sid}/config`,{values},t),400);
 }
 expectStatus(await f.call('GET',`screen/${sid}`,{},t),200);
 assert.equal(f.writes(),0);
});


test('advertiser lifecycle preserves tenant boundaries and blocks archived new relationships', async () => {
 const f=fixture(),admin=f.token('u_admin'),operator=f.token('u_op2');
 const a=expectStatus(await f.call('POST','advertiser',{org_id:'org_sec17',name:'Lifecycle'},admin),200);
 for(const [m,p,b] of [['GET',`advertiser/${a.id}`,{}],['POST',`advertiser/${a.id}`,{name:'no'}],['POST',`advertiser/${a.id}/archive`,{}]]) expectStatus(await f.call(m,p,b,operator),404);
 expectStatus(await f.call('POST',`advertiser/${a.id}`,{org_id:'org_tri'},admin),400);
 expectStatus(await f.call('POST',`advertiser/${a.id}/archive`,{},admin),200);
 expectStatus(await f.call('POST','creative',{org_id:a.org_id,advertiser_id:a.id,name:'No'},admin),409);
 expectStatus(await f.call('POST','invite',{org_id:a.org_id,advertiser_id:a.id,role:'advertiser_viewer',name:'No',email:'archived@example.invalid'},admin),409);
 expectStatus(await f.call('POST','campaign',{org_id:a.org_id,advertiser_id:a.id,name:'No',screen_ids:[],creative_ids:[]},admin),409);
 expectStatus(await f.call('POST',`advertiser/${a.id}/restore`,{},admin),200);
 assert.equal(expectStatus(await f.call('GET',`advertiser/${a.id}`,{},admin),200).status,'active');
});
test('archive refuses paused and cross-organisation network references, audit is safe and scoped', async () => {
 const f=fixture(),admin=f.token('u_admin');
 const a=expectStatus(await f.call('POST','advertiser',{org_id:'org_sec17',name:'Network owner'},admin),200);
 f.change(d=>d.campaigns.push({id:'cross',org_id:'org_other',advertiser_id:a.id,status:'paused'}));
 expectStatus(await f.call('POST',`advertiser/${a.id}/archive`,{},admin),409);
 expectStatus(await f.call('POST',`advertiser/${a.id}`,{notes:'DO_NOT_LOG_SECRET',email:'private@example.invalid'},admin),200);
 const audit=expectStatus(await f.call('GET','audit?org=org_sec17',{},admin),200);
 assert.ok(audit.items.some(x=>x.entity_id===a.id && x.actor_id==='u_admin'));
 assert.ok(!JSON.stringify(audit).includes('DO_NOT_LOG_SECRET'));
 assert.ok(!JSON.stringify(audit).includes('private@example.invalid'));
 const own=expectStatus(await f.call('GET','bootstrap?org=org_sec17',{},admin),200);
 assert.ok(own.screens.every(s=>s.org_id==='org_sec17'));
 assert.ok(own.campaigns.every(c=>c.org_id==='org_sec17'));
 expectStatus(await f.call('GET','bootstrap?org=org_sec17',{},f.token('u_op2')),404);
});


test('screen diagnostic human request, ownership, readback and revoke follow real API routing',async()=>{
 const f=fixture(),admin=f.token('u_admin'),sid=f.data().screens[0].id;
 const pairing=expectStatus(await f.call('POST',`screens/${sid}/pairing`,{},admin),200);
 const paired=expectStatus(await f.call('POST','pair',{code:pairing.code}),200);
 expectStatus(await f.call('POST',`screen/${sid}/test`,{},f.token('u_op2')),404);
 expectStatus(await f.call('POST',`screen/${sid}/test`,{test:true},admin),400);
 const commercial=JSON.stringify([f.data().plays,f.data().presence,f.data().campaigns]);
 const a=expectStatus(await f.call('POST',`screen/${sid}/test`,{},admin),200);
 assert.equal(a.kind,'diagnostic');assert.equal(a.requested_by,'u_admin');
 const detail=expectStatus(await f.call('GET',`screen/${sid}`,{},admin),200);
 assert.ok(detail.diagnostic_assignments.some(x=>x.id===a.id));
 // Seed campaigns reserve this screen: diagnostic waits instead of stealing a slot.
 const start=expectStatus(await f.call('POST','diagnostic/start',{assignment_id:a.id,run_uid:'integration_run'},paired.token),200);
 assert.equal(start.waiting,true);
 expectStatus(await f.call('POST',`screen/${sid}/test/${a.id}/revoke`,{},admin),200);
 expectStatus(await f.call('POST','diagnostic/start',{assignment_id:a.id,run_uid:'integration_run'},paired.token),409);
 assert.equal(JSON.stringify([f.data().plays,f.data().presence,f.data().campaigns]),commercial);
 assert.ok(f.data().audit.some(x=>x.entity==='diagnostic_assignments' && x.actor_id==='u_admin'));
});

test('audit readback preserves change markers and visibly restricts financial values',async()=>{
 const f=fixture(),admin=f.token('u_admin');
 expectStatus(await f.call('POST','user/u_op4/newpassword',{},admin),200);
 expectStatus(await f.call('POST','org/org_sec17',{platform_fee_pct:17},admin),200);
 const stored=f.data().audit.find(x=>x.entity_id==='u_op4'&&x.action==='user/u_op4/newpassword');
 const adminRows=expectStatus(await f.call('GET','audit?org=org_sec17',{},admin),200).items;
 const output=adminRows.find(x=>x.id===stored.id);
 assert.deepEqual(output.changes.map(c=>c.field).sort(),Object.keys(stored.diff).sort());
 assert.ok(output.changes.some(c=>c.field==='password_hash'&&c.detail==='values_not_recorded'));
 const rows=expectStatus(await f.call('GET','directory?entity=audit&org=org_sec17',{},f.token('u_op3')),200).items;
 const fee=rows.find(x=>x.entity_id==='org_sec17').changes.find(c=>c.field==='platform_fee_pct');
 assert.deepEqual(fee,{field:'platform_fee_pct',changed:true,detail:'restricted'});
 assert.equal(adminRows.find(x=>x.entity_id==='org_sec17').changes.find(c=>c.field==='platform_fee_pct').after,17);
 const secrets=f.data().users.flatMap(u=>[u.password_hash,u.password_salt]).filter(Boolean);
 for(const secret of secrets)assert.ok(!JSON.stringify({adminRows,rows}).includes(secret));
});

test('password, logout and pairing redemption audit the actual actor without credentials',async()=>{
 const f=fixture(),admin=f.token('u_admin');
 const pw=expectStatus(await f.call('POST','password',{current:f.env.GC_DEMO_PASSWORD,next:crypto.randomBytes(20).toString('hex')},f.token('u_op4')),200);
 expectStatus(await f.call('POST','logout',{},pw.token),200);
 const sid=f.data().screens[0].id;
 const code=expectStatus(await f.call('POST',`screens/${sid}/pairing`,{},admin),200);
 const paired=expectStatus(await f.call('POST','pair',{code:code.code},null),200);
 const rows=f.data().audit;
 assert.ok(rows.some(x=>x.action==='password'&&x.actor_id==='u_op4'&&x.actor_kind==='human'));
 assert.ok(rows.some(x=>x.action==='logout'&&x.actor_id==='u_op4'&&x.diff.auth_version.changed));
 const event=rows.find(x=>x.action==='pair'&&x.entity_id===paired.device.id);
 assert.equal(event.actor_kind,'device');assert.equal(event.actor_id,paired.device.id);assert.equal(event.actor_role,'device');
 assert.ok(!JSON.stringify(rows).includes(paired.token));assert.ok(!JSON.stringify(rows).includes(code.code));
 assert.ok(event.diff.token_hash.changed);
});

test('explicit nonproduction reset preserves earlier audit evidence; production remains blocked',async()=>{
 const f=fixture({env:{GC_ALLOW_RESET:'1'}}),admin=f.token('u_admin');
 expectStatus(await f.call('POST','org/org_sec17',{name:'Before reset'},admin),200);
 const previous=f.data().audit;
 expectStatus(await f.call('POST','reset',{},admin),200);
 for(const row of previous)assert.deepEqual(f.data().audit.find(x=>x.id===row.id),row);
 assert.ok(f.data().audit.some(x=>x.action==='reset'));
 f.env.NODE_ENV='production';f.env.GC_AUTH_SECRET=crypto.randomBytes(32).toString('hex');
 // Production storage guard blocks this memory fixture before reset; direct authorization has a separate existing test.
 assert.notEqual((await f.call('POST','reset',{},f.token('u_admin'))).status,200);
});


test('creative editing protects ownership, media provenance and approval while retaining campaign links',async()=>{
 const f=fixture(),id='cr_fit_a',admin=f.token('u_admin'),owner=f.token('u_op1');
 const original=f.data().creatives.find(c=>c.id===id);
 expectStatus(await f.call('POST',`creative/${id}`,{name:'Renamed'},f.token('u_op2')),404);
 for(const patch of [{org_id:'org_tricity'},{advertiser_id:'adv_mobile'},{approval_status:'approved'},{assets:[]},{name:''},{youtube_id:'bad'},{duration_s:-1}]) expectStatus(await f.call('POST',`creative/${id}`,patch,owner),400);
 const renamed=expectStatus(await f.call('POST',`creative/${id}`,{name:'Renamed'},owner),200);
 assert.equal(renamed.approval_status,original.approval_status);
 const edited=expectStatus(await f.call('POST',`creative/${id}`,{category:'new-category',youtube_id:'abcdefghijk',duration_s:12},admin),200);
 assert.equal(edited.approval_status,'pending');assert.equal(edited.youtube_id,'abcdefghijk');assert.equal(edited.metadata_source,'operator_declared');assert.equal(edited.approved_at,undefined);
 assert.ok(f.data().campaigns.find(c=>c.id==='cmp_1').creative_ids.includes(id));
 assert.ok(f.data().audit.some(a=>a.action===`creative/${id}`));
 f.change(d=>{d.creatives.find(c=>c.id===id).assets=[{id:'asset',duration_s:12}];});
 expectStatus(await f.call('POST',`creative/${id}`,{duration_s:20},admin),400);
 expectStatus(await f.call('POST',`creative/${id}`,{youtube_id:'lmnopqrstuv'},admin),400);
 expectStatus(await f.call('POST',`creative/${id}`,{name:'Uploaded renamed'},admin),200);
 f.change(d=>{d.advertisers.find(a=>a.id===original.advertiser_id).status='archived';});
 expectStatus(await f.call('POST',`creative/${id}`,{name:'Blocked'},admin),409);
});
