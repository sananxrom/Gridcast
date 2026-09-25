const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const ts = require('typescript');
const EXPECTED_HOST = '127.0.0.1:8185';
const PROJECT = 'demo-gridcast-storage';

function guard() {
  if (process.env.FIRESTORE_EMULATOR_HOST !== EXPECTED_HOST)
    throw Error(`Emulator tests require FIRESTORE_EMULATOR_HOST=${EXPECTED_HOST}; cloud access is forbidden`);
}
const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib', `${name}.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(name=>name.startsWith('.')?load(name.slice(2)):require(name), mod, mod.exports);
  return cache[name] = mod.exports;
}
function database(id) {
  guard();
  const { Firestore } = require('@google-cloud/firestore');
  return new Firestore({ projectId: PROJECT, databaseId: id });
}
async function execute(job) {
  const db = database(job.database), { createFirestoreStore } = load('firestore-store'), store = createFirestoreStore(db);
  let attempts = 0;
  try {
    const result = await store.transact(job.context, async () => {
      attempts++; const d = await store.read();
      if (job.action === 'revision') { d.users.find(u => u.id === job.context.uid).auth_version++; await new Promise(r => setTimeout(r, 30)); await store.write(d); return { status: 200 }; }
      if (job.action === 'invite') { d.users.push(job.user); await store.write(d); return { status: 200 }; }
      if (job.action === 'play') {
        const result = load('devices').deviceRoute(d, 'POST', ['play'], job.body, job.token, { playlist: () => ({ items: [], config: {}, config_version: 1 }) });
        if (result.changed) await store.write(d); return result;
      }
      throw Error('Unknown worker action');
    });
    return { result, attempts };
  } catch (error) { return { error: { message: error.message, status: error.status, code: error.code }, attempts }; }
  finally { await db.terminate(); }
}
function worker(job) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, 'worker'], { env: { ...process.env, GCLOUD_PROJECT: PROJECT }, stdio: ['pipe','pipe','pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject); child.on('exit', code => {
      if (code) return reject(Error(`Emulator worker failed (${code}): ${stderr}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(Error(`Invalid worker response: ${stdout}\n${stderr}`)); }
    });
    child.stdin.end(JSON.stringify(job));
  });
}
async function fixture() {
  const id = `gridcast-test-${crypto.randomBytes(6).toString('hex')}`, db = database(id);
  const { createFirestoreStore } = load('firestore-store'), store = createFirestoreStore(db);
  const initial = {
    orgs: [{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }],
    users: [{ id: 'admin', org_id: 'a', role: 'platform_admin', email: 'admin@example.invalid', password_hash: 'synthetic', password_salt: 'synthetic', auth_version: 0 },
      { id: 'a_owner', org_id: 'a', role: 'owner', email: 'a@example.invalid', auth_version: 0 },
      { id: 'b_owner', org_id: 'b', role: 'owner', email: 'b@example.invalid', auth_version: 0 }],
    screens: [{ id: 'sa', org_id: 'a', status: 'active' }, { id: 'sb', org_id: 'b', status: 'active' }],
    advertisers: [{ id: 'ad1', org_id: 'a' }], creatives: [{ id: 'cr1', org_id: 'a', advertiser_id: 'ad1' }],
    campaigns: [{ id: 'c1', org_id: 'a', advertiser_id: 'ad1', screen_ids: ['sa'], creative_ids: ['cr1'], committed_budget:1000000, rate_type: 'per_play', rate_value: 1, accrued_spend: 0 }],
    settings: { config_revision: 1 },
  };
  await store.provision(initial);
  return { id, db, store, initial, context: { method: 'GET', path: ['bootstrap'], uid: 'a_owner' } };
}

if (process.argv[2] === 'worker') {
  let input = ''; process.stdin.on('data', b => { input += b; });
  process.stdin.on('end', async () => {
    try { process.stdout.write(JSON.stringify(await execute(JSON.parse(input)))); }
    catch (e) { process.stderr.write(e.stack); process.exitCode = 1; }
  });
} else if (!process.env.FIRESTORE_EMULATOR_HOST) {
  test('Firestore emulator integration (requires explicitly started local emulator)', { skip: `Set FIRESTORE_EMULATOR_HOST=${EXPECTED_HOST}` }, () => {});
} else {
  guard();
  test('real emulator supports paginated admin scope and atomic audit writes', async()=>{
    const f=await fixture();
    try {
      await f.db.doc('advertisers/ad2').create({id:'ad2',org_id:'a'});
      const context={...f.context,uid:'admin',path:['directory'],entity:'advertisers',orgId:'a',limit:1};
      const first=await f.store.transact(context,()=>f.store.read());
      assert.equal(first.directory.items[0].id,'ad1'); assert.equal(first.directory.has_more,true);
      const next=await f.store.transact({...context,after:first.directory.next_cursor},()=>f.store.read());
      assert.equal(next.directory.items[0].id,'ad2');assert.equal(next.directory.has_more,false);
      await f.store.transact({...f.context,uid:'admin',method:'POST',path:['screen','sb']},async()=>{
        const d=await f.store.read(); assert.ok(d.users.some(u=>u.id==='admin'));d.screens[0].name='Updated B';
        d.audit.push({id:'audit1',org_id:'b',actor_id:'admin',entity:'screens',entity_id:'sb'});await f.store.write(d);
      });
      assert.equal((await f.db.doc('audit/audit1').get()).data().actor_id,'admin');
      assert.equal((await f.db.doc('screens/sb').get()).data().name,'Updated B');
      for (const remove of [false,true]) await assert.rejects(()=>f.store.transact({...f.context,uid:'admin',path:['audit'],orgId:'b'},async()=>{
        const d=await f.store.read(); assert.equal(d.audit[0].id,'audit1');
        if(remove)d.audit=[];else d.audit[0].actor_id='forged';
        await f.store.write(d);
      }),{status:409});
      assert.equal((await f.db.doc('audit/audit1').get()).data().actor_id,'admin');
    } finally { await f.db.terminate(); }
  });
  test('real emulator provisions once and scopes queries to the caller tenant', async () => {
    const f = await fixture();
    try {
      const d = await f.store.transact(f.context, () => f.store.read());
      assert.deepEqual(d.orgs.map(o => o.id), ['a']); assert.deepEqual(d.screens.map(s => s.id), ['sa']);
      assert.ok(d.users.every(u => u.org_id === 'a')); assert.deepEqual(d.plays, []); assert.deepEqual(d.presence, []);
      await assert.rejects(f.store.provision(f.initial), { status: 409 });
      await f.store.transact({ ...f.context, method: 'POST', path: ['screen','sa'] }, async () => {
        const d = await f.store.read(); d.screens[0].name = 'Updated'; await f.store.write(d);
      });
      assert.equal((await f.db.doc('screens/sa').get()).data().name, 'Updated');
      assert.equal((await f.db.doc('screens/sb').get()).data().name, undefined);
    } finally { await f.db.terminate(); }
  });
  test('real emulator serializes cross-process session revocations without lost increments', { timeout: 120000 }, async () => {
    const f = await fixture();
    try {
      const results = await Promise.all(Array.from({ length: 4 }, () => worker({ database: f.id, action: 'revision', context: { method: 'POST', path: ['logout'], uid: 'a_owner' } })));
      for (const result of results) assert.equal(result.error, undefined, JSON.stringify(result));
      assert.equal((await f.db.doc('users/a_owner').get()).data().auth_version, 4);
      assert.ok(results.every(r => r.attempts >= 1));
    } finally { await f.db.terminate(); }
  });
  test('real SDK retries an aborted callback without committing its staged mutation', { timeout: 120000 }, async () => {
    const f = await fixture(); let attempts = 0;
    try {
      await f.store.transact({ ...f.context, method: 'POST', path: ['logout'] }, async () => {
        const d = await f.store.read(); assert.equal(d.users.find(u => u.id === 'a_owner').auth_version, 0);
        d.users.find(u => u.id === 'a_owner').auth_version++; await f.store.write(d);
        if (++attempts === 1) throw Object.assign(new Error('Injected retryable ABORTED'), { code: 10 });
      });
      assert.equal(attempts, 2); assert.equal((await f.db.doc('users/a_owner').get()).data().auth_version, 1);
    } finally { await f.db.terminate(); }
  });
  test('real emulator rejects duplicate emails racing across separate application processes', { timeout: 120000 }, async () => {
    const f = await fixture();
    try {
      const results = await Promise.all(['a', 'b'].map(org => worker({ database: f.id, action: 'invite',
        context: { method: 'POST', path: ['invite'], uid: `${org}_owner` },
        user: { id: `${org}_new`, org_id: org, role: 'sales', email: 'shared@example.invalid' } })));
      assert.equal(results.filter(r => r.result).length, 1, JSON.stringify(results));
      assert.equal(results.find(r => r.error)?.error.status, 409, JSON.stringify(results));
      assert.equal((await f.db.collection('users').where('email','==','shared@example.invalid').get()).size, 1);
    } finally { await f.db.terminate(); }
  });
  test('real emulator accepts one duplicate play and accrues once across application processes', { timeout: 120000 }, async () => {
    const f = await fixture(), now = Date.now(), deviceId = 'dev_' + crypto.randomUUID();
    const token = 'gcp_' + deviceId + '.' + crypto.randomBytes(32).toString('base64url');
    const body = { assignment_id: 'assignment1', play_uid: 'event_0001', seq_no: 1, campaign_id: 'c1', creative_id: 'cr1', config_version: 1,
      started_at_device: new Date(now - 10000).toISOString(), ended_at_device: new Date(now).toISOString(), playing_duration_ms: 10000,
      media_started_s: 0, media_ended_s: 10, ended_reason: 'ended', measured: false, avg_persons: null, sample_count: 0, server_clock_offset_ms: 0 };
    try {
      await f.db.doc(`devices/${deviceId}`).create({ id: deviceId, org_id: 'a', screen_id: 'sa', status: 'online', token_hash: crypto.createHash('sha256').update(token).digest('hex'), expires_at: new Date(now + 86400000).toISOString() });
      await f.db.doc('device_assignments/assignment1').create({ id: 'assignment1', device_id: deviceId, org_id: 'a', screen_id: 'sa', campaign_id: 'c1', advertiser_id: 'ad1', creative_id: 'cr1',
        duration_s: 10, rate_type: 'per_play', rate_value: 1, issued_at: new Date(now-20000).toISOString(), valid_until: new Date(now+600000).toISOString(), accept_until: new Date(now+86400000).toISOString(), config_version: 1, camera_fail_mode: 'unmeasured', model_configured: 'coco-ssd', sample_interval_s: 2, count_ceiling: 50 });
      const job = { database: f.id, action: 'play', token, body, context: { method: 'POST', path: ['play'], deviceId, playUid: body.play_uid, seqNo: 1, assignmentId: 'assignment1', startedAtDevice:body.started_at_device, clockOffset:body.server_clock_offset_ms } };
      const results = await Promise.all([worker(job), worker(job)]);
      for (const r of results) { assert.equal(r.error, undefined, JSON.stringify(r)); assert.equal(r.result.body.ok, true); }
      assert.equal(results.filter(r => r.result.body.duplicate).length, 1);
      assert.equal((await f.db.collection('plays').get()).size, 1); assert.equal((await f.db.collection('presence').get()).size, 1);
      assert.equal((await f.db.doc('campaigns/c1').get()).data().accrued_spend, 1);
      await assert.rejects(f.store.transact({...f.context,path:['screen','sa']}, async () => { const d = await f.store.read(); d.plays[0].billable = false; await f.store.write(d); }), { status: 409 });
    } finally { await f.db.terminate(); }
  });

  test('real emulator atomically settles network receipts across processes with frozen economics and isolated reports', { timeout: 180000 }, async () => {
    const f=await fixture(), now=Date.now(), deviceId='dev_'+crypto.randomUUID();
    const token='gcp_'+deviceId+'.'+crypto.randomBytes(32).toString('base64url');
    const {freezeEconomics,settlementPeriod,settlementKey,accrueSettlement}=load('settlement');
    const {bootstrap,redact}=load('access');
    const campaign={...f.initial.campaigns[0],campaign_type:'network',origin_org_id:'a',participant_org_ids:['a','b'],screen_ids:['sa','sb'],rate_value:1,committed_budget:9999};
    const booking={screen_id:'sb',slots_per_loop:1,...freezeEconomics(campaign,{id:'sb',org_id:'b',owner_share_pct:20,rate_version:'rate1'},{id:'b',platform_fee_pct:10,fee_basis:'gross',fee_version:'fee1'})};
    campaign.bookings=[booking,{...booking,screen_id:'sa'}];
    const issued=new Date(now-120000).toISOString();
    const assignment={...booking,id:'network_assignment',device_id:deviceId,org_id:'b',screen_id:'sb',campaign_id:'c1',advertiser_id:'ad1',creative_id:'cr1',duration_s:10,issued_at:issued,valid_until:new Date(now+600000).toISOString(),accept_until:new Date(now+86400000).toISOString(),config_version:1,camera_fail_mode:'continue',model_configured:'coco-ssd',sample_interval_s:2,count_ceiling:50};
    const body=(seq)=>({assignment_id:assignment.id,play_uid:'network_event_'+seq,seq_no:seq,campaign_id:'c1',creative_id:'cr1',config_version:1,started_at_device:new Date(now-80000+seq*10000).toISOString(),ended_at_device:new Date(now-70000+seq*10000).toISOString(),playing_duration_ms:10000,media_started_s:0,media_ended_s:10,ended_reason:'ended',measured:false,avg_persons:null,sample_count:0,server_clock_offset_ms:0});
    const job=(event)=>({database:f.id,action:'play',token,body:event,context:{method:'POST',path:['play'],deviceId,playUid:event.play_uid,seqNo:event.seq_no,assignmentId:assignment.id,startedAtDevice:event.started_at_device,clockOffset:event.server_clock_offset_ms}});
    try {
      await f.db.doc('campaigns/c1').set(campaign);
      await f.db.doc('users/advertiser').create({id:'advertiser',org_id:'a',role:'advertiser_viewer',advertiser_id:'ad1',email:'viewer@example.invalid',auth_version:0});
      await f.db.doc(`devices/${deviceId}`).create({id:deviceId,org_id:'b',screen_id:'sb',status:'online',token_hash:crypto.createHash('sha256').update(token).digest('hex'),expires_at:new Date(now+86400000).toISOString()});
      await f.db.doc('device_assignments/'+assignment.id).create(assignment);
      const duplicate=await Promise.all([worker(job(body(1))),worker(job(body(1)))]);
      for(const result of duplicate){assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.result.body.billable===true||result.result.body.duplicate===true,true,JSON.stringify(result));}
      assert.equal(duplicate.filter(r=>r.result.body.duplicate).length,1);
      const independent=await Promise.all([worker(job(body(2))),worker(job(body(3)))]);
      for(const result of independent){assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.result.body.billable,true,JSON.stringify(result));}
      const period=settlementPeriod(Date.parse(body(1).started_at_device));
      const bucketId=settlementKey('c1','sb',period,assignment.econ_version);
      let settled=(await f.db.doc('settlement_buckets/'+bucketId).get()).data();
      assert.equal(settled.billable_plays,3);assert.equal(settled.org_id,'b');
      assert.deepEqual([settled.gross_paise,settled.fee_paise,settled.owner_paise,settled.net_paise],[300,30,54,216]);
      assert.equal((await f.db.collection('plays').get()).size,3);assert.equal((await f.db.collection('presence').get()).size,3);
      const reportRows=(await f.db.collection('screen_day').get()).docs.map(d=>d.data());assert.equal(reportRows.reduce((n,r)=>n+r.plays_rendered,0),3);assert.equal(reportRows.reduce((n,r)=>n+r.plays_billable,0),3);assert.ok(reportRows.every(r=>r.org_id==='b'&&r.advertiser_id==='ad1'));
      assert.deepEqual((await f.db.doc('campaigns/c1').get()).data(),campaign,'receiving devices must not mutate the origin-owned campaign');
      for(const row of (await f.db.collection('plays').get()).docs){assert.equal(row.data().org_id,'b');assert.equal(row.data().econ_version,assignment.econ_version);assert.equal(row.data().rate_version,'rate1');}

      // A fixture bucket for another receiving organisation must never enter B's totals.
      const foreign={settlement_buckets:[]};
      accrueSettlement(foreign,{billable:true,org_id:'a',campaign_id:'c1',screen_id:'sa',server_received_at:new Date(now).toISOString()}, {...assignment,rate_paise:1000},Date.parse(body(1).started_at_device));
      await f.db.doc('settlement_buckets/'+foreign.settlement_buckets[0].id).create(foreign.settlement_buckets[0]);
      const view=async(uid)=>f.store.transact({method:'GET',path:['bootstrap'],uid},async()=>{
        const d=await f.store.read(),actor=d.users.find(u=>u.id===uid);return redact(bootstrap(d,actor,()=> 'online'),actor);
      });
      const operator=await view('b_owner');
      assert.deepEqual(operator.screens.map(s=>s.id),['sb']);assert.deepEqual(operator.campaigns[0].screen_ids,['sb']);
      assert.equal(operator.campaigns[0].accrued_spend,3);assert.equal(operator.campaigns[0].committed_budget,undefined);
      assert.equal(operator.settlement_buckets.length,1);assert.equal(operator.settlement_buckets[0].org_id,'b');
      assert.deepEqual(operator.plays,[]);
      const operatorDetail=await f.store.transact({method:'GET',path:['screen','sb'],uid:'b_owner'},()=>f.store.read());assert.equal(operatorDetail.plays.length,3);assert.ok(operatorDetail.plays.every(p=>p.org_id==='b'));
      const advertiser=await view('advertiser');
      assert.deepEqual(advertiser.screens.map(s=>s.id).sort(),['sa','sb']);
      assert.equal(advertiser.campaigns[0].accrued_spend,13);assert.equal(advertiser.settlement_buckets.length,2);
      assert.deepEqual(advertiser.plays,[]);
      const advertiserDetail=await f.store.transact({method:'GET',path:['campaign','c1'],uid:'advertiser'},()=>f.store.read());assert.equal(advertiserDetail.plays.length,3);assert.ok(advertiserDetail.plays.every(p=>p.advertiser_id==='ad1'));
      for(const bucket of advertiser.settlement_buckets)for(const field of ['fee_paise','owner_paise','net_paise','owner_share_pct','platform_fee_pct'])assert.equal(bucket[field],undefined);

      // Snapshot loading may read origin references, but the tenant-write guard stays strict.
      await assert.rejects(()=>f.store.transact(job(body(1)).context,async()=>{
        const d=await f.store.read();d.campaigns.find(c=>c.id==='c1').name='forbidden foreign write';await f.store.write(d);
      }),{status:403});
      assert.equal((await f.db.doc('campaigns/c1').get()).data().name,undefined);

      // Removing current targeting and changing commercial defaults cannot rewrite an offline assignment.
      await f.db.doc('campaigns/c1').update({screen_ids:['sa'],participant_org_ids:['a'],bookings:[],rate_value:999});
      await f.db.doc('screens/sb').update({owner_share_pct:99});
      await f.db.doc('orgs/b').update({platform_fee_pct:99});
      const retained=await worker(job(body(4)));
      assert.equal(retained.error,undefined,JSON.stringify(retained));assert.equal(retained.result.body.billable,true,JSON.stringify(retained));
      settled=(await f.db.doc('settlement_buckets/'+bucketId).get()).data();
      assert.equal(settled.billable_plays,4);assert.deepEqual([settled.gross_paise,settled.fee_paise,settled.owner_paise,settled.net_paise],[400,40,72,288]);
      assert.equal(settled.platform_fee_pct,10);assert.equal(settled.owner_share_pct,20);
      assert.equal((await f.db.doc('campaigns/c1').get()).data().accrued_spend,0);
    } finally {await f.db.terminate();}
  });
}
