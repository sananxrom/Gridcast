const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/firestore-store.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const mod = { exports: {} }; new Function('require', 'module', 'exports', source)(require, mod, mod.exports);
const { createFirestoreStore, emailKey, playKey, sequenceKey } = mod.exports;

// In-memory Firestore protocol fake: atomic commit, create preconditions and retry
// on a concurrent committed transaction. No project credentials or network calls.
class Query {
  constructor(db, collection, filters = [], order = null, max = Infinity, fields = null) { Object.assign(this, { db, collection, filters, order, max, fields }); }
  where(k, op, v) { return new Query(this.db, this.collection, [...this.filters, [k, op, v]], this.order, this.max, this.fields); }
  orderBy(k, direction) { return new Query(this.db, this.collection, this.filters, [k, direction], this.max, this.fields); }
  limit(max) { return new Query(this.db, this.collection, this.filters, this.order, max, this.fields); }
  select(...fields) { return new Query(this.db,this.collection,this.filters,this.order,this.max,fields); }
  doc(id) { return { collection: this.collection, id, path: `${this.collection}/${id}` }; }
}
class FakeFirestore {
  constructor(rows = {}) { this.rows = clone(rows); this.version = 0; this.commits = []; this.reads = []; }
  collection(name) { return new Query(this, name); }
  async runTransaction(fn) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const version = this.version, writes = [], base = clone(this.rows);
      const snap = ref => ({ exists: Object.hasOwn(base, ref.path), data: () => clone(base[ref.path]), id: ref.id });
      const tx = {
        get: async q => {
          if (writes.length) throw Error('Firestore reads must precede writes');
          if (q.path) { this.reads.push(q.path); return snap(q); }
          this.reads.push({ collection: q.collection, filters: q.filters, limit: q.max });
          let docs = Object.entries(base).filter(([k]) => k.split('/')[0] === q.collection).map(([k, row]) => ({ k, row }));
          docs = docs.filter(({ row }) => q.filters.every(([k, op, v]) => op === '==' ? row[k] === v : op === 'array-contains' ? row[k]?.includes(v) : op === '>' ? row[k] > v : false));
          if (q.order) {
            const [key, direction] = q.order;
            docs = docs.filter(({ row }) => row[key] !== undefined).sort((a, b) => String(a.row[key]).localeCompare(String(b.row[key])) * (direction === 'desc' ? -1 : 1));
          }
          return { docs: docs.slice(0, q.max).map(({ row, k }) => ({ data: () => clone(q.fields ? Object.fromEntries(q.fields.filter(k=>row[k]!==undefined).map(k=>[k,row[k]])) : row), id: k.split('/')[1] })) };
        },
        getAll: async (...refs) => { if (writes.length) throw Error('read after write'); return refs.map(snap); },
        create: (ref, data) => writes.push(['create', ref.path, clone(data)]),
        set: (ref, data) => writes.push(['set', ref.path, clone(data)]),
        delete: ref => writes.push(['delete', ref.path]),
      };
      const result = await fn(tx);
      if (version !== this.version) continue;
      const next = clone(this.rows);
      for (const [op, key, value] of writes) {
        if (op === 'create' && Object.hasOwn(next, key)) throw Error(`Already exists: ${key}`);
        if (op === 'delete') delete next[key]; else next[key] = value;
      }
      if (writes.length) { this.rows = next; this.version++; this.commits.push(writes); }
      return result;
    }
    throw Error('Retry limit');
  }
}
function fixture(extra = {}) {
  const database = new FakeFirestore({
    '_meta/schema': { schema_version: 1 }, 'settings/platform': { config_revision: 2, platform_name: 'private setting' },
    'orgs/a': { id: 'a', status: 'active' }, 'orgs/b': { id: 'b', status: 'active' },
    'users/a_owner': { id: 'a_owner', org_id: 'a', role: 'owner', email: 'a@example.invalid', auth_version: 0 },
    'users/b_owner': { id: 'b_owner', org_id: 'b', role: 'owner', email: 'b@example.invalid', auth_version: 0 },
    'screens/sa': { id: 'sa', org_id: 'a' }, 'screens/sb': { id: 'sb', org_id: 'b' },
    ...extra,
  });
  return { database, store: createFirestoreStore(database), context: { method: 'GET', path: ['bootstrap'], uid: 'a_owner' } };
}

test('tenant-scoped snapshot loads no unrelated tenant records or event history', async () => {
  const f = fixture({ 'plays/a_play': { id: 'a_play', org_id: 'a', ended_at: '2026-01-01' },
    'plays/b_play': { id: 'b_play', org_id: 'b', ended_at: '2026-01-02' },
    'presence/a_play': { id: 'presence1', play_id: 'a_play', org_id: 'a', measured: false, avg_persons: null } });
  const data = await f.store.transact(f.context, () => f.store.read());
  assert.deepEqual(data.orgs.map(x => x.id), ['a']); assert.deepEqual(data.users.map(x => x.id), ['a_owner']);
  assert.deepEqual(data.plays.map(x => x.id), ['a_play']); assert.equal(data.presence[0].avg_persons, null);
  assert.deepEqual(data.settings, { config_revision: 2 });
  const queries = f.database.reads.filter(x => typeof x === 'object' && x.collection !== 'configs');
  assert.ok(queries.every(q => q.filters.some(f => f[0] === 'org_id' && f[2] === 'a')));
});

test('only changed entity documents are written; stale unseen history is not deleted', async () => {
  const f = fixture({ 'plays/old': { id: 'old', org_id: 'a', ended_at: '2000-01-01' } });
  await f.store.transact({ ...f.context, method: 'POST', path: ['screen', 'sa'] }, async () => {
    const data = await f.store.read(); data.screens[0].name = 'Changed'; await f.store.write(data);
  });
  assert.deepEqual(f.database.commits[0].map(x => x[1]), ['screens/sa']);
  assert.ok(f.database.rows['plays/old']);
});

test('failed responses never commit partially staged changes', async () => {
  const f = fixture();
  await f.store.transact(f.context, async () => { const d = await f.store.read(); d.screens[0].name = 'bad'; await f.store.write(d); return { status: 400 }; });
  assert.equal(f.database.commits.length, 0);
});

test('concurrent session revisions retry with fresh snapshots rather than lose revocation', async () => {
  const f = fixture(); let arrivals = 0, release; const barrier = new Promise(r => { release = r; });
  const fn = () => f.store.transact({ ...f.context, method: 'POST', path: ['logout'] }, async () => {
    const d = await f.store.read(); d.users[0].auth_version++;
    if (++arrivals <= 2) { if (arrivals === 2) release(); await barrier; }
    await f.store.write(d);
  });
  await Promise.all([fn(), fn()]);
  assert.equal(f.database.rows['users/a_owner'].auth_version, 2); assert.equal(arrivals, 3);
});

test('global normalized email reservations prevent concurrent cross-tenant duplicates', async () => {
  const f = fixture(); let arrivals = 0, release; const barrier = new Promise(r => { release = r; });
  async function add(uid, org) {
    return f.store.transact({ ...f.context, uid, method: 'POST', path: ['invite'] }, async () => {
      const d = await f.store.read(); d.users.push({ id: `${org}_new`, org_id: org, role: 'sales', email: 'same@example.invalid' });
      if (++arrivals <= 2) { if (arrivals === 2) release(); await barrier; }
      await f.store.write(d);
    });
  }
  const results = await Promise.allSettled([add('a_owner', 'a'), add('b_owner', 'b')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  assert.ok(f.database.rows[`_unique_emails/${emailKey('same@example.invalid')}`]);
});

test('old device play, sequence conflict and assignment are direct-read outside history window', async () => {
  const id = playKey('dev1', 'event1');
  const f = fixture({ 'devices/dev1': { id: 'dev1', org_id: 'a', screen_id: 'sa' },
    [`plays/${id}`]: { id, org_id: 'a', device_id: 'dev1', play_uid: 'event1', seq_no: 10, ended_at: '2000-01-01' },
    [`_device_sequences/${sequenceKey('dev1', 10)}`]: { play_id: id },
    'device_assignments/as1': { id: 'as1', org_id: 'a', device_id: 'dev1' } });
  const d = await f.store.transact({ method: 'POST', path: ['play'], deviceId: 'dev1', playUid: 'different', seqNo: 10, assignmentId: 'as1' }, () => f.store.read());
  assert.deepEqual(d.plays.map(p => p.id), [id]); assert.equal(d.device_assignments[0].id, 'as1');
  assert.ok(!f.database.reads.some(x => typeof x === 'object' && x.collection === 'plays'));
});

test('event append is atomic with device sequence reservation, and evidence cannot be modified', async () => {
  const f = fixture({ 'devices/dev1': { id: 'dev1', org_id: 'a', screen_id: 'sa' } });
  const id = playKey('dev1', 'event1');
  await f.store.transact({ method: 'POST', path: ['play'], deviceId: 'dev1', playUid: 'event1', seqNo: 1 }, async () => {
    const d = await f.store.read();
    d.plays.push({ id, org_id: 'a', device_id: 'dev1', play_uid: 'event1', seq_no: 1, ended_at: '2026-01-01' });
    d.presence.push({ id: 'presence1', play_id: id, org_id: 'a', measured: false, avg_persons: null }); await f.store.write(d);
  });
  assert.ok(f.database.rows[`plays/${id}`]); assert.ok(f.database.rows[`presence/${id}`]);
  assert.equal(f.database.rows[`_device_sequences/${sequenceKey('dev1', 1)}`].play_id, id);
  await assert.rejects(f.store.transact(f.context, async () => { const d = await f.store.read(); d.plays[0].billable = true; await f.store.write(d); }), { status: 409 });
});

test('bounded reports explicitly disclose truncation', async () => {
  const rows = Object.fromEntries(Array.from({ length: 1501 }, (_, i) => [`plays/p${i}`, { id: `p${i}`, org_id: 'a', ended_at: `2026-${String(i).padStart(6,'0')}` }]));
  const f = fixture(rows); const d = await f.store.transact(f.context, () => f.store.read());
  assert.equal(d.plays.length, 1500); assert.equal(d.history.truncated, true); assert.equal(d.history.complete, false);
});

test('camera frames and cross-tenant writes fail before committing', async () => {
  const f = fixture();
  await assert.rejects(f.store.transact(f.context, async () => { const d = await f.store.read(); d.frames.push({ data: 'frame' }); await f.store.write(d); }), { status: 400 });
  await assert.rejects(f.store.transact(f.context, async () => { const d = await f.store.read(); d.screens.push({ id: 'new', org_id: 'b' }); await f.store.write(d); }), { status: 403 });
  assert.equal(f.database.commits.length, 0);
});

test('provisioning is explicit, one-time and refuses synthetic event data', async () => {
  const database = new FakeFirestore(), store = createFirestoreStore(database);
  assert.equal(await store.transact({ method: 'GET', path: ['_health'] }, () => store.read()), null);
  const initial = { orgs: [{ id: 'a' }], users: [{ id: 'admin', org_id: 'a', role: 'platform_admin', email: 'admin@example.invalid', password_hash: 'hash', password_salt: 'salt' }] };
  await assert.rejects(store.provision({ ...initial, plays: [{ id: 'synthetic' }] }), { status: 400 });
  await store.provision(initial); assert.equal(database.rows['_meta/schema'].schema_version, 1);
  assert.equal(database.rows[`_unique_emails/${emailKey(initial.users[0].email)}`].user_id, 'admin');
  await assert.rejects(store.provision(initial), { status: 409 });
});

test('offline assignment campaign is loaded after current screen targeting changes', async () => {
  const f = fixture({ 'devices/dev1': { id: 'dev1', org_id: 'a', screen_id: 'sa' },
    'campaigns/c1': { id: 'c1', org_id: 'a', screen_ids: [], creative_ids: [], accrued_spend: 0 },
    'device_assignments/as1': { id: 'as1', org_id: 'a', device_id: 'dev1', campaign_id: 'c1' } });
  await f.store.transact({ method: 'POST', path: ['play'], deviceId: 'dev1', assignmentId: 'as1' }, async () => {
    const d = await f.store.read(); assert.equal(d.campaigns[0].id, 'c1'); d.campaigns[0].accrued_spend = 2; await f.store.write(d);
  });
  assert.equal(f.database.rows['campaigns/c1'].accrued_spend, 2);
});

test('signing in to another account looks up login email, not the previous session UID', async () => {
  const f = fixture(); const d = await f.store.transact({ method: 'POST', path: ['login'], uid: 'a_owner', loginEmail: 'b@example.invalid' }, () => f.store.read());
  assert.equal(d.users[0].id, 'b_owner'); assert.equal(d.orgs[0].id, 'b');
});

test('central eligibility policy is available internally but only revision may change for an operator', async () => {
  const f = fixture({ 'settings/platform': { config_revision: 2, blocked_categories: ['prohibited'], category_blocklist: ['other'], private: 'platform-only' } });
  await f.store.transact({ ...f.context, method: 'POST', path: ['config'] }, async () => {
    const d = await f.store.read(); assert.deepEqual(d.settings.blocked_categories, ['prohibited']); assert.equal(d.settings.private, undefined);
    d.settings.config_revision++; await f.store.write(d);
  });
  assert.equal(f.database.rows['settings/platform'].config_revision, 3);
  assert.equal(f.database.rows['settings/platform'].private, 'platform-only');
  await assert.rejects(f.store.transact(f.context, async () => { const d = await f.store.read(); d.settings.blocked_categories = []; await f.store.write(d); }), { status: 403 });
  assert.deepEqual(f.database.rows['settings/platform'].blocked_categories, ['prohibited']);
});


test('admin scoped bootstrap retains true actor while avoiding other tenants and loading network references', async () => {
 const f=fixture({'users/admin':{id:'admin',org_id:'a',role:'platform_admin'},'advertisers/foreign':{id:'foreign',org_id:'a'},'campaigns/bnetwork':{id:'bnetwork',org_id:'b',advertiser_id:'foreign',creative_ids:[]}});
 const d=await f.store.transact({...f.context,uid:'admin',orgId:'b'},()=>f.store.read());
 assert.deepEqual(d.screens.map(s=>s.id),['sb']);
 assert.ok(d.users.some(u=>u.id==='admin')); assert.ok(d.orgs.some(o=>o.id==='a'));
 assert.ok(d.advertisers.some(a=>a.id==='foreign'));
 const reads=f.database.reads.filter(x=>typeof x==='object' && x.collection==='screens');
 assert.ok(reads.every(q=>q.filters.some(x=>x[0]==='org_id' && x[2]==='b')));
});
test('admin global lists paginate beyond domain cap; mutations still reject unsafe oversized snapshots', async () => {
 const many=Object.fromEntries(Array.from({length:2010},(_,i)=>[`advertisers/adv${String(i).padStart(4,'0')}`,{id:`adv${String(i).padStart(4,'0')}`,org_id:'b'}]));
 const f=fixture({...many,'users/admin':{id:'admin',org_id:'a',role:'platform_admin'}});
 const first=await f.store.transact({...f.context,uid:'admin',path:['directory'],entity:'advertisers',limit:100},()=>f.store.read());
 assert.equal(first.directory.items.length,100); assert.equal(first.directory.has_more,true);
 const second=await f.store.transact({...f.context,uid:'admin',path:['directory'],entity:'advertisers',after:first.directory.next_cursor,limit:100},()=>f.store.read());
 assert.equal(second.directory.items[0].id,'adv0100');
 const global=await f.store.transact({...f.context,uid:'admin'},()=>f.store.read());
 assert.equal(global.advertisers.length,100); assert.equal(global.pagination.advertisers.has_more,true);
 await assert.rejects(f.store.transact({...f.context,uid:'admin',method:'POST',path:['advertiser','adv0000']},()=>f.store.read()),e=>e.status===503);
});
test('advertiser archive loads reservations across receiving organisations',async()=>{
 const f=fixture({'advertisers/a1':{id:'a1',org_id:'a'},'campaigns/network':{id:'network',org_id:'b',advertiser_id:'a1',creative_ids:[],status:'paused'}});
 const d=await f.store.transact({...f.context,method:'POST',path:['advertiser','a1','archive']},()=>f.store.read());
 assert.ok(d.campaigns.some(c=>c.id==='network'));
});


test('admin scoped human mutation commits audit atomically with target and retains original identity',async()=>{
 const f=fixture({'users/admin':{id:'admin',org_id:'a',role:'platform_admin'}});
 await f.store.transact({...f.context,uid:'admin',method:'POST',path:['screen','sb']},async()=>{
  const d=await f.store.read(); d.screens.find(s=>s.id==='sb').name='B changed';
  d.audit.push({id:'audit1',org_id:'b',actor_id:'admin',entity:'screens',entity_id:'sb'});await f.store.write(d);
 });
 assert.equal(f.database.commits.length,1);
 assert.ok(f.database.commits[0].some(x=>x[1]==='screens/sb'));
 assert.ok(f.database.commits[0].some(x=>x[1]==='audit/audit1'));
 assert.equal(f.database.rows['users/admin'].org_id,'a');
});


test('Firestore adapter atomically claims diagnostic, deduplicates concurrent results, and preserves commercial data',async()=>{
 const load=require('./load-lib.cjs'),diagnostics=load('diagnostics'),devices=load('devices');
 const crypto=require('node:crypto'),now=Date.now(),deviceId='dev_'+crypto.randomUUID();
 const token='gcp_'+deviceId+'.'+crypto.randomBytes(32).toString('base64url');
 const f=fixture({['devices/'+deviceId]:{id:deviceId,org_id:'a',screen_id:'sa',status:'online',expires_at:new Date(now+864e5).toISOString(),token_hash:crypto.createHash('sha256').update(token).digest('hex')},'screens/sa':{id:'sa',org_id:'a',status:'active'}});
 let assignment;
 await f.store.transact({...f.context,method:'POST',path:['screen','sa','test']},async()=>{
   const d=await f.store.read(); assignment=diagnostics.requestDiagnostic(d,d.screens[0],d.users[0],{config:{model:'coco-ssd',sample_interval_s:2,count_ceiling:50},config_version:1},now);await f.store.write(d);
 });
 const commercial=JSON.stringify(Object.entries(f.database.rows).filter(([k])=>/^(plays|presence|campaigns)\//.test(k)));
 const context={method:'POST',path:['diagnostic','start'],deviceId,assignmentId:assignment.id};
 const call=async(path,body,at)=>f.store.transact({...context,path:['diagnostic',path]},async()=>{
   const d=await f.store.read(),result=devices.deviceRoute(d,'POST',['diagnostic',path],body,token,{playlist:()=>({items:[],config:{},config_version:1}),now:at});
   if(result.changed)await f.store.write(d);return result;
 });
 const startBody={assignment_id:assignment.id,run_uid:'atomic_integration'};
 const started=await call('start',startBody,now);assert.equal(started.body.ok,true);
 assert.ok(f.database.rows['screens/sa'].diagnostic_hold_until);
 const duplicateStart=await call('start',startBody,now);assert.equal(duplicateStart.status,409);
 const body={...startBody,started_at_device:new Date(now).toISOString(),ended_at_device:new Date(now+12000).toISOString(),playing_duration_ms:12000,ended_reason:'ended',measured:false,avg_persons:null,sample_count:0,model_ver:null,camera_state:'unavailable',model_state:'not_loaded'};
 const results=await Promise.all([call('result',body,now+12000),call('result',body,now+12000)]);
 assert.ok(results.every(r=>r.body.ok));assert.equal(results.filter(r=>r.body.duplicate).length,1);
 assert.equal(Object.keys(f.database.rows).filter(k=>k.startsWith('diagnostic_results/')).length,1);
 assert.equal(f.database.rows['diagnostic_assignments/'+assignment.id].status,'completed');
 assert.equal(JSON.stringify(Object.entries(f.database.rows).filter(([k])=>/^(plays|presence|campaigns)\//.test(k))),commercial);
});


test('paginated screen status reads only public device fields',async()=>{
 const f=fixture({'users/admin':{id:'admin',org_id:'a',role:'platform_admin'},'devices/d1':{id:'d1',org_id:'a',screen_id:'sa',status:'online',last_heartbeat_at:'2026-09-25T00:00:00Z',token_hash:'private'}});
 const d=await f.store.transact({...f.context,uid:'admin',path:['directory'],entity:'screens'},()=>f.store.read());
 assert.equal(d.devices[0].id,'d1');assert.equal(d.devices[0].token_hash,undefined);
});

test('audit evidence cannot be changed or deleted after an authorized directory read',async()=>{
 for(const remove of [false,true]){
  const original={id:'audit1',org_id:'a',actor_id:'a_owner',entity:'screens',entity_id:'sa',action:'screen/sa',at:'2026-01-01',diff:{name:{changed:true}}};
  const f=fixture({'audit/audit1':original});
  await assert.rejects(()=>f.store.transact({...f.context,path:['audit']},async()=>{
   const d=await f.store.read();assert.equal(d.audit.length,1);
   if(remove)d.audit=[];else d.audit[0].action='forged';
   await f.store.write(d);
  }),e=>e.status===409&&/append-only/.test(e.message));
  assert.deepEqual(f.database.rows['audit/audit1'],original);assert.equal(f.database.commits.length,0);
 }
});
