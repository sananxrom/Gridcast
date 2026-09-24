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

const screenInput=(org_id,key)=>({org_id,external_key:key,name:'Seed display',venue_name:'Fixture venue',address:'Fixture address',venue_type:'cafe',size_in:43,has_camera:true,loop_length_s:600,slot_duration_s:10,advertiser_slots:10,network_available:true,network_slots:6});

test('external-key demo creation is additive and retries reuse all entity IDs without mutation',async()=>{
 const f=fixture(),token=f.token('u_admin');f.change(d=>{d.screens[0].name='Test';});
 const before=f.data();
 const orgInput={external_key:'demo.operator.one',name:'Demo operator',type:'operator',platform_fee_pct:10};
 const org=expectStatus(await f.call('POST','org',orgInput,token),200);
 const screenBody=screenInput(org.id,'demo.screen.one');
 const createdScreen=expectStatus(await f.call('POST','screens',screenBody,token),201);
 assert.ok(createdScreen.pairing.code);const sid=createdScreen.screen.id;
 const advertiserBody={external_key:'demo.advertiser.one',org_id:org.id,name:'Demo brand',category:'beverage'};
 const advertiser=expectStatus(await f.call('POST','advertiser',advertiserBody,token),200);
 const creativeBody={external_key:'demo.creative.one',org_id:org.id,advertiser_id:advertiser.id,name:'Demo creative',category:'beverage',youtube_id:'Q5KmA8DHJdA',duration_s:10,aspect:'16:9'};
 const creative=expectStatus(await f.call('POST','creative',creativeBody,token),200);
 const campaignBody={external_key:'demo.campaign.one',org_id:org.id,advertiser_id:advertiser.id,name:'Demo campaign',campaign_type:'operator',screen_ids:[sid],creative_ids:[creative.id],bookings:[{screen_id:sid,slots_per_loop:1}],starts_at:'2026-09-01',ends_at:'2026-10-31',rate_type:'per_play',rate_value:0.93,committed_budget:12000,status:'pending'};
 const campaign=expectStatus(await f.call('POST','campaign',campaignBody,token),200);
 const afterCreate=f.data(),writes=f.writes();
 for(let pass=0;pass<2;pass++)for(const [route,body,id] of [['org',orgInput,org.id],['screens',screenBody,sid],['advertiser',advertiserBody,advertiser.id],['creative',creativeBody,creative.id],['campaign',campaignBody,campaign.id]]){
  const result=expectStatus(await f.call('POST',route,{...body,name:'Must not overwrite existing'},token),200);
  assert.equal(result.reused,true);assert.equal((result.screen??result).id,id);
  if(route==='screens')assert.equal(result.pairing,null,'a retry must never issue a new pairing code');
 }
 assert.equal(f.writes(),writes);assert.deepEqual(f.data(),afterCreate);
 for(const key of ['users','devices'])assert.deepEqual(f.data()[key],before[key],`existing ${key} preserved`);
 for(const key of ['orgs','screens','advertisers','creatives','campaigns']){
  assert.equal(f.data()[key].length,before[key].length+1);
  for(const old of before[key])assert.deepEqual(f.data()[key].find(x=>x.id===old.id),old,`${key}/${old.id} preserved`);
 }
 assert.equal(f.data().screens.find(s=>s.id===before.screens[0].id).name,'Test');
});

test('screen retry after pairing preserves live device credentials and does not reissue code',async()=>{
 const f=fixture(),token=f.token('u_admin'),body=screenInput('org_gridcast','demo.paired.screen');
 const created=expectStatus(await f.call('POST','screens',body,token),201);
 const paired=expectStatus(await f.call('POST','pair',{code:created.pairing.code}),200);
 const snapshot=f.data(),writes=f.writes();
 const reused=expectStatus(await f.call('POST','screens',{...body,name:'Do not rename paired screen'},token),200);
 assert.equal(reused.screen.id,paired.screen.id);assert.equal(reused.pairing,null);assert.equal(reused.reused,true);
 assert.deepEqual(f.data(),snapshot);assert.equal(f.writes(),writes);
 assert.equal(f.data().screens.find(s=>s.id===created.screen.id).pairing_code_hash,undefined);
 expectStatus(await f.call('GET',`playlist/${created.screen.id}`,{},paired.token),200);
 expectStatus(await f.call('POST','pair',{code:created.pairing.code}),400);
});

test('external keys are platform-only, validated and never accepted on updates',async()=>{
 const f=fixture(),admin=f.token('u_admin'),snapshot=f.data();
 for(const id of ['u_op1','u_op4','u_op5'])expectStatus(await f.call('POST','screens',screenInput('org_sec17','demo.denied.screen'),f.token(id)),403);
 for(const key of ['', 'x', 'UPPER', '../escape', 'with space', 'x'.repeat(121),42,null])expectStatus(await f.call('POST','advertiser',{org_id:'org_gridcast',name:'Denied',external_key:key},admin),400);
 expectStatus(await f.call('POST','advertiser/adv_fitline',{external_key:'demo.forbidden.update',name:'Denied'},admin),400);
 expectStatus(await f.call('POST','screens',{...screenInput('org_gridcast','demo.invalid.field'),token_hash:'must-not-set'},admin),400);
 expectStatus(await f.call('POST','screens',{...screenInput('org_gridcast','demo.invalid.size'),size_in:-1},admin),400);
 expectStatus(await f.call('POST','screens',screenInput('does-not-exist','demo.invalid.scope'),admin),404);
 expectStatus(await f.call('POST','creative',{org_id:'org_gridcast',external_key:'demo.foreign.advertiser',advertiser_id:'adv_fitline',name:'Wrong scope',youtube_id:'Q5KmA8DHJdA',duration_s:10},admin),400);
 assert.deepEqual(f.data(),snapshot);assert.equal(f.writes(),0);
});

test('external key uniqueness is entity-and-organisation scoped and retries cannot bypass field authorization',async()=>{
 const f=fixture(),token=f.token('u_admin'),key='demo.shared.key';
 const a=expectStatus(await f.call('POST','advertiser',{org_id:'org_gridcast',external_key:key,name:'Gridcast advertiser'},token),200);
 const b=expectStatus(await f.call('POST','advertiser',{org_id:'org_sec17',external_key:key,name:'Operator advertiser'},token),200);
 assert.notEqual(a.id,b.id);assert.equal(a.org_id,'org_gridcast');assert.equal(b.org_id,'org_sec17');
 const snapshot=f.data(),writes=f.writes();
 expectStatus(await f.call('POST','advertiser',{org_id:'org_gridcast',external_key:key,name:'Escalate',role:'platform_admin'},token),400);
 expectStatus(await f.call('POST','advertiser',{org_id:'org_gridcast',external_key:key,name:'Override'},f.token('u_op1')),403);
 expectStatus(await f.call('POST','advertiser',{org_id:'missing',external_key:key,name:'Wrong organisation'},token),404);
 assert.deepEqual(f.data(),snapshot);assert.equal(f.writes(),writes);
});

test('organisation external-key retry preserves its first owner login and never rediscloses a temporary credential',async()=>{
 const f=fixture(),admin=f.token('u_admin'),before=f.data();
 const input={external_key:'demo.operator.with-owner',name:'Demo operator with owner',type:'operator',admin_name:'Demo owner',admin_email:' Demo.Owner@Example.Invalid '};
 const created=expectStatus(await f.call('POST','org',input,admin),200);
 assert.equal(typeof created.temp_password,'string');assert.ok(created.temp_password.length>0);
 const after=f.data(),writes=f.writes();
 assert.equal(after.orgs.length,before.orgs.length+1);assert.equal(after.users.length,before.users.length+1);
 const owner=after.users.find(u=>u.org_id===created.id);
 assert.equal(owner.email,'demo.owner@example.invalid');assert.equal(owner.must_change,true);assert.ok(owner.password_hash);
 for(const patch of [{},{name:'Must not rename',admin_name:'Must not replace owner'}, {admin_email:'another.owner@example.invalid'}]) {
  const reused=expectStatus(await f.call('POST','org',{...input,...patch},admin),200);
  assert.equal(reused.id,created.id);assert.equal(reused.reused,true);assert.equal(reused.name,input.name);
  for(const key of ['temp_password','password_hash','password_salt','token','code'])assert.equal(hasKey(reused,key),false,key);
  assert.deepEqual(f.data(),after,'retry must not write credentials, users, pairing data or audit entries');assert.equal(f.writes(),writes);
 }
 expectStatus(await f.call('POST','org',{...input,external_key:'demo.operator.another-key'},admin),409);
 expectStatus(await f.call('POST','org',input,f.token('u_op1')),403);
 assert.deepEqual(f.data(),after);assert.equal(f.writes(),writes);
});
