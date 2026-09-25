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
    const r = await api.handle(method,p.split('/'),new URLSearchParams(q),body,token,'fixture-client');
    return {...r,status:r.status || 200};
  };
  return { env, auth, call, data:()=>clone(saved), writes:()=>writes,
    token:id=>auth.issueToken(saved.users.find(u=>u.id===id)),
    change: fn=>fn(saved), seed };
}
function expectStatus(r,status) { assert.equal(r.status,status,JSON.stringify(r.body)); return r.body; }
const hasKey = (v,key) => v && typeof v==='object' && (Object.hasOwn(v,key) || Object.values(v).some(x=>hasKey(x,key)));

function pairedFixture() {
 const f=fixture(); const screen=f.data().screens[0];
 f.change(d=>d.devices.push({id:'historical',org_id:screen.org_id,screen_id:screen.id,status:'revoked',token_hash:'not-a-real-token',revoked_at:new Date().toISOString()}));
 return {...f,screen,scope:{org_id:screen.org_id,screen_id:screen.id,device_id:'historical'},human:f.token('u_op1')};
}
async function issued(f) { return expectStatus(await f.call('POST',`screens/${f.screen.id}/maintenance`,{device_id:'historical'},f.human),201); }
async function redeemed(f) { const grant=await issued(f);return {...expectStatus(await f.call('POST','maintenance/redeem',{code:grant.code}),200),code:grant.code}; }
test('maintenance issue/list are capability and tenant checked, including explicit historical identity',async()=>{
 const f=pairedFixture(),route=`screens/${f.screen.id}/maintenance`;
 expectStatus(await f.call('GET',route),401);
 expectStatus(await f.call('GET',route,{},f.token('u_adv1')),403);
 expectStatus(await f.call('GET',route,{},f.token('u_op2')),404);
 expectStatus(await f.call('POST',route,{device_id:''},f.human),400);
 expectStatus(await f.call('POST',route,{device_id:'other'},f.human),404);
 expectStatus(await f.call('POST',route,{device_id:'historical',org_id:'other'},f.human),400);
 const g=await issued(f); assert.equal(g.grant.device_id,'historical');assert.equal(g.grant.status,'pending');
 assert.equal(Date.parse(g.grant.expires_at)-Date.parse(g.server_time),600000);
 const list=expectStatus(await f.call('GET',route,{},f.human),200);
 assert.equal(list.devices.find(d=>d.id==='historical').status,'revoked');
 assert.ok(!hasKey(list,'token_hash'));assert.ok(!hasKey(list,'session_hash'));assert.ok(!hasKey(list,'code'));
});
test('revoked playback identity can redeem human grant, but session cannot act as playback or dashboard authority',async()=>{
 const f=pairedFixture(),g=await redeemed(f);
 for(const operation of ['check','export','replace']) { const r=expectStatus(await f.call('POST','maintenance/'+operation,f.scope,g.token),200); assert.equal(r.grant.device_id,'historical');assert.ok(r.server_time); }
 expectStatus(await f.call('GET','bootstrap',{},g.token),401);
 expectStatus(await f.call('POST','heartbeat',{},g.token),401);
 assert.equal(f.data().devices.find(d=>d.id==='historical').status,'revoked');
 const ledger=JSON.stringify(f.data().audit);assert.ok(!ledger.includes(g.token));assert.ok(!ledger.includes(g.code));
 const saved=JSON.stringify(f.data());assert.ok(!saved.includes(g.token));assert.ok(!saved.includes(g.code));
 assert.ok(f.data().audit.some(e=>e.action==='maintenance/export_authorized'));
 assert.ok(f.data().audit.some(e=>e.action==='maintenance/replacement_authorized'));
});
test('scope is mandatory and exact for every session operation; wrong secrets do not work',async()=>{
 const f=pairedFixture(),g=await redeemed(f);
 for(const op of ['check','export','replace','close']) {
  for(const scope of [{},{...f.scope,device_id:''},{...f.scope,device_id:'other'},{...f.scope,screen_id:'other'},{...f.scope,org_id:'other'}]) expectStatus(await f.call('POST','maintenance/'+op,scope,g.token),403);
  expectStatus(await f.call('POST','maintenance/'+op,f.scope,g.token.slice(0,-1)+(g.token.endsWith('A')?'B':'A')),401);
 }
 expectStatus(await f.call('POST','maintenance/export',f.scope,g.token),200);
});
test('code is single use even with concurrent redemptions and lost acknowledgement',async()=>{
 const f=pairedFixture(),g=await issued(f);
 const results=await Promise.all([f.call('POST','maintenance/redeem',{code:g.code}),f.call('POST','maintenance/redeem',{code:g.code})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);
 assert.equal(f.data().audit.filter(e=>e.action==='maintenance/redeemed').length,1);
 expectStatus(await f.call('POST','maintenance/redeem',{code:g.code}),401);
});
test('issuer auth version, role, tenant, account and organization changes invalidate issued codes and sessions',async()=>{
 for(const mutation of [u=>u.auth_version=(u.auth_version||0)+1,u=>u.role='sales',u=>u.role='manager',u=>u.org_id='org_tricity',u=>u.status='disabled',u=>u.must_change=true]) {
  for(const redeemFirst of [false,true]) {
   const f=pairedFixture(),g=redeemFirst?await redeemed(f):await issued(f);
   f.change(d=>mutation(d.users.find(u=>u.id==='u_op1')));
   expectStatus(await f.call('POST',redeemFirst?'maintenance/export':'maintenance/redeem',redeemFirst?f.scope:{code:g.code},g.token),401);
  }
 }
 const f=pairedFixture(),g=await redeemed(f);f.change(d=>d.orgs.find(o=>o.id===f.scope.org_id).status='disabled');
 expectStatus(await f.call('POST','maintenance/check',f.scope,g.token),401);
 expectStatus(await f.call('POST','maintenance/close',f.scope,g.token),200);
 assert.ok(f.data().audit.some(e=>e.action==='maintenance/closed'));
});
test('expiry never extends at redemption; dashboard revocation closes capability immediately',async()=>{
 const f=pairedFixture(),g=await redeemed(f),route=`screens/${f.screen.id}/maintenance/${g.grant.id}/revoke`;
 const expires=g.grant.expires_at;
 assert.equal(expectStatus(await f.call('POST','maintenance/check',f.scope,g.token),200).grant.expires_at,expires);
 expectStatus(await f.call('POST',route,{},f.token('u_op2')),404);
 expectStatus(await f.call('POST',route,{},f.human),200);
 expectStatus(await f.call('POST','maintenance/export',f.scope,g.token),401);
 const f2=pairedFixture(),g2=await redeemed(f2);f2.change(d=>d.maintenance_grants[0].expires_at=new Date(Date.now()-1).toISOString());
 expectStatus(await f2.call('POST','maintenance/check',f2.scope,g2.token),401);
 expectStatus(await f2.call('POST','maintenance/close',f2.scope,g2.token),200);
});
test('invalid redemption counts persist, block further guesses and do not leak codes into audit',async()=>{
 const f=pairedFixture();
 for(let i=0;i<10;i++)expectStatus(await f.call('POST','maintenance/redeem',{code:'AAAAAAAAAAAAAAAA'}),401);
 expectStatus(await f.call('POST','maintenance/redeem',{code:'AAAAAAAAAAAAAAAA'}),429);
 assert.equal(f.data().maintenance_limits.find(r=>r.id.startsWith('maintenance_client_')).count,11);
 assert.equal(f.data().maintenance_grants.length,0);
 assert.equal((f.data().audit || []).length,0);
});
test('closing is idempotent, audited once and cannot erase device or evidence',async()=>{
 const f=pairedFixture(),g=await redeemed(f),before=f.data();
 for(let n=0;n<2;n++)expectStatus(await f.call('POST','maintenance/close',f.scope,g.token),200);
 expectStatus(await f.call('POST','maintenance/check',f.scope,g.token),401);
 assert.equal(f.data().audit.filter(e=>e.action==='maintenance/closed').length,1);
 assert.deepEqual(f.data().devices,before.devices);assert.deepEqual(f.data().plays,before.plays);
});
test('public guessing storage is bounded and global exhaustion does not create client rows',()=>{
 const m=require('./load-lib.cjs')('maintenance'),db={orgs:[],users:[],screens:[],devices:[]},now=Date.now();
 for(let i=0;i<120;i++)assert.equal(m.maintenanceRoute(db,'POST',['maintenance','redeem'],{code:'wrong'},null,null,{now,clientKey:'unique-'+i}).status,401);
 const count=db.maintenance_limits.length;
 for(let i=120;i<500;i++)assert.equal(m.maintenanceRoute(db,'POST',['maintenance','redeem'],{code:'wrong'},null,null,{now,clientKey:'unique-'+i}).status,429);
 assert.equal(db.maintenance_limits.length,count);
 const ids=new Set(Array.from({length:10000},(_,i)=>m.maintenanceLimiterIds('client-'+i)[1]));assert.ok(ids.size<=4096);
 assert.equal(m.maintenanceRoute(db,'POST',['maintenance','redeem'],{code:'wrong'},null,null,{now:now+60001,clientKey:'unique-fresh'}).status,401);
});
test('expired unredeemed codes and reassigned server device identities fail closed',async()=>{
 const f=pairedFixture(),g=await issued(f);f.change(d=>d.maintenance_grants[0].expires_at=new Date(Date.now()-1).toISOString());
 expectStatus(await f.call('POST','maintenance/redeem',{code:g.code}),401);
 const f2=pairedFixture(),g2=await redeemed(f2);f2.change(d=>d.devices.find(x=>x.id==='historical').screen_id='other-screen');
 expectStatus(await f2.call('POST','maintenance/export',f2.scope,g2.token),401);
});
