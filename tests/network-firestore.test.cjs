const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const load=require('./load-lib.cjs');
const {createFirestoreStore}=load('firestore-store');
const {deviceRoute}=load('devices');
const {settlementKey,settlementPeriod}=load('settlement');
const {reportingKey}=load('reporting');
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
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
          docs = docs.filter(({ row }) => q.filters.every(([k, op, v]) => op === '==' ? row[k] === v : op === 'array-contains' ? row[k]?.includes(v) : op === '>' ? row[k] > v : op === '>=' ? row[k] >= v : op === '<' ? row[k] < v : op === '<=' ? row[k] <= v : false));
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
function rowsFixture() {
 return {
  '_meta/schema':{schema_version:1},'settings/platform':{config_revision:1},
  'orgs/network':{id:'network',type:'gridcast',status:'active'},'orgs/a':{id:'a',status:'active'},'orgs/b':{id:'b',status:'active'},
  'users/admin':{id:'admin',org_id:'network',role:'platform_admin',status:'active'},
  'users/a_owner':{id:'a_owner',org_id:'a',role:'owner',status:'active'},
  'users/viewer':{id:'viewer',org_id:'network',advertiser_id:'ad',role:'advertiser_viewer',status:'active'},
  'screens/sa':{id:'sa',org_id:'a',status:'active'},'screens/sb':{id:'sb',org_id:'b',status:'active'},
  'advertisers/ad':{id:'ad',org_id:'network',status:'active'},
  'creatives/cr':{id:'cr',org_id:'network',advertiser_id:'ad'},
  'campaigns/cn':{id:'cn',committed_budget:1000000,org_id:'network',origin_org_id:'network',campaign_type:'network',participant_org_ids:['a','b'],screen_ids:['sa','sb'],creative_ids:['cr'],advertiser_id:'ad',accrued_spend:999},
  'campaigns/local':{id:'local',org_id:'a',screen_ids:['sa'],creative_ids:[],advertiser_id:'local-ad'},
  'campaigns/unrelated':{id:'unrelated',org_id:'b',screen_ids:['sb'],creative_ids:[],advertiser_id:'other-ad'},
  'plays/pa':{id:'pa',org_id:'a',campaign_id:'cn',screen_id:'sa',advertiser_id:'ad',ended_at:'2026-09-25T00:00:00Z'},
  'plays/pb':{id:'pb',org_id:'b',campaign_id:'cn',screen_id:'sb',advertiser_id:'ad',ended_at:'2026-09-25T00:00:00Z'},
  'plays/private':{id:'private',org_id:'b',campaign_id:'unrelated',screen_id:'sb',advertiser_id:'other-ad',ended_at:'2026-09-25T00:00:00Z'},
  'settlement_buckets/ba':{id:'ba',org_id:'a',campaign_id:'cn',screen_id:'sa',advertiser_id:'ad',gross_paise:100},
  'settlement_buckets/bb':{id:'bb',org_id:'b',campaign_id:'cn',screen_id:'sb',advertiser_id:'ad',gross_paise:200},
  'settlement_buckets/private':{id:'private',org_id:'b',campaign_id:'unrelated',screen_id:'sb',advertiser_id:'other-ad',gross_paise:300},
 };
}
function fixture(extra={}) {const database=new FakeFirestore({...rowsFixture(),...extra});return {database,store:createFirestoreStore(database),context:{method:'GET',path:['bootstrap'],uid:'a_owner'}};}
function deviceFixture() {
 const now=Date.parse('2026-10-01T01:00:00Z'),start=Date.parse('2026-09-30T18:29:55Z');
 const token='gcp_dev_12345678-1234-1234-1234-123456789abc.'+crypto.randomBytes(32).toString('base64url');
 const body={assignment_id:'assignment',play_uid:'network-event-1',seq_no:1,campaign_id:'cn',creative_id:'cr',config_version:1,started_at_device:new Date(start).toISOString(),ended_at_device:new Date(start+10000).toISOString(),playing_duration_ms:10000,media_started_s:0,media_ended_s:10,ended_reason:'ended',measured:false,avg_persons:null,sample_count:0,server_clock_offset_ms:0};
 const device={id:'dev_12345678-1234-1234-1234-123456789abc',org_id:'a',screen_id:'sa',status:'online',token_hash:crypto.createHash('sha256').update(token).digest('hex'),expires_at:new Date(now+86400000).toISOString()};
 const assignment={id:'assignment',device_id:device.id,org_id:'a',screen_id:'sa',campaign_id:'cn',advertiser_id:'ad',creative_id:'cr',duration_s:10,issued_at:new Date(start-20000).toISOString(),valid_until:new Date(start+3600000).toISOString(),accept_until:new Date(start+72*3600000).toISOString(),config_version:1,camera_fail_mode:'unmeasured',model_configured:'coco-ssd',sample_interval_s:2,count_ceiling:50,rate_type:'per_play',rate_value:.07,rate_paise:7,rate_version:'r1',platform_fee_pct:10,owner_share_pct:25,fee_basis:'gross',fee_version:'f1',econ_version:'e1',booked_at:'2026-09-01T00:00:00Z'};
 const f=fixture({'devices/dev_12345678-1234-1234-1234-123456789abc':device,'device_assignments/assignment':assignment});
 const context={method:'POST',path:['play'],deviceId:device.id,playUid:body.play_uid,seqNo:body.seq_no,assignmentId:body.assignment_id,startedAtDevice:body.started_at_device,clockOffset:0};
 const send=async(event=body,hints={})=>f.store.transact({...context,playUid:event.play_uid,seqNo:event.seq_no,assignmentId:event.assignment_id,startedAtDevice:event.started_at_device,...hints},async()=>{
  const d=await f.store.read();const result=deviceRoute(d,'POST',['play'],event,token,{now,playlist:()=>({items:[],config:{},config_version:1})});
  if(result.changed) await f.store.write(d);return result;
 });
 return {...f,now,start,device,assignment,body,context,token,send};
}

test('Firestore operator snapshot loads shared network campaigns but only own screens, receipts and settlement buckets',async()=>{
 const f=fixture(),d=await f.store.transact(f.context,()=>f.store.read());
 assert.deepEqual(new Set(d.campaigns.map(c=>c.id)),new Set(['local','cn']));assert.deepEqual(d.screens.map(s=>s.id),['sa']);
 assert.deepEqual(d.plays,[]);
 const detail=await f.store.transact({...f.context,path:['screen','sa']},()=>f.store.read());assert.deepEqual(detail.plays.map(p=>p.id),['pa']);assert.deepEqual(d.settlement_buckets.map(b=>b.id),['ba']);
 assert.ok(d.advertisers.some(a=>a.id==='ad'));assert.ok(d.creatives.some(c=>c.id==='cr'));
});

test('Firestore advertiser snapshot joins their campaign screens and receipts across receiving organisations',async()=>{
 const f=fixture(),d=await f.store.transact({...f.context,uid:'viewer'},()=>f.store.read());
 assert.deepEqual(d.campaigns.map(c=>c.id),['cn']);assert.deepEqual(new Set(d.screens.map(s=>s.id)),new Set(['sa','sb']));
 assert.deepEqual(d.plays,[]);
 const detail=await f.store.transact({...f.context,uid:'viewer',path:['campaign','cn']},()=>f.store.read());assert.deepEqual(new Set(detail.plays.map(p=>p.id)),new Set(['pa','pb']));assert.deepEqual(new Set(d.settlement_buckets.map(b=>b.id)),new Set(['ba','bb']));
});

test('network campaign directory pagination merges local and participated campaigns without duplicates or omissions',async()=>{
 const f=fixture({'campaigns/aaa':{id:'aaa',org_id:'network',campaign_type:'network',participant_org_ids:['a'],screen_ids:['sa']},'campaigns/zzz':{id:'zzz',org_id:'a',participant_org_ids:['a'],screen_ids:['sa']}});
 let after, ids=[];
 for(let i=0;i<10;i++) {const d=await f.store.transact({...f.context,path:['directory'],entity:'campaigns',limit:1,after},()=>f.store.read());ids.push(...d.directory.items.map(c=>c.id));if(!d.directory.has_more) break;assert.ok(d.directory.next_cursor);after=d.directory.next_cursor;}
 assert.deepEqual(ids,['aaa','cn','local','zzz']);
});

test('late cross-org device receipt and its monthly bucket commit once without changing the network campaign',async()=>{
 const f=deviceFixture(),before=clone(f.database.rows['campaigns/cn']);
 const results=await Promise.all([f.send(),f.send()]);for(const r of results) assert.equal(r.body.ok,true,JSON.stringify(r));
 assert.equal(results.filter(r=>r.body.duplicate).length,1);
 const report=f.database.rows['screen_day/'+reportingKey('sa','cn','cr',f.start)];assert.equal(report.plays_rendered,1);assert.equal(report.plays_billable,1);assert.equal(report.org_id,'a');assert.equal(report.advertiser_id,'ad');
 const id=settlementKey('cn','sa','2026-09','e1'),bucket=f.database.rows[`settlement_buckets/${id}`];
 assert.equal(bucket.org_id,'a');assert.equal(bucket.period,'2026-09');assert.equal(bucket.billable_plays,1);assert.equal(bucket.gross_paise,7);
 assert.equal(bucket.gross_paise,bucket.fee_paise+bucket.owner_paise+bucket.net_paise);assert.deepEqual(f.database.rows['campaigns/cn'],before);
 assert.equal(f.database.commits.filter(ws=>ws.some(w=>w[1]===`settlement_buckets/${id}`)).length,1);
 const commit=f.database.commits.find(ws=>ws.some(w=>w[1]===`settlement_buckets/${id}`));assert.ok(commit.some(w=>w[1].startsWith('plays/')));assert.ok(commit.some(w=>w[1].startsWith('presence/')));
 const play=Object.entries(f.database.rows).find(([k,p])=>k.startsWith('plays/')&&p.play_uid===f.body.play_uid)[1];
 for(const key of ['rate_version','fee_version','econ_version','owner_share_pct','platform_fee_pct']) assert.equal(play[key],f.assignment[key]);
 const queries=f.database.reads.filter(q=>typeof q==='object');assert.ok(!queries.some(q=>['plays','presence'].includes(q.collection)),'device receipt must not scan play history; first budget initialization may scan bounded settlement buckets');
});

test('subsequent receipt reloads existing bucket and derives cumulative rounded totals',async()=>{
 const f=deviceFixture();await f.send();
 const event={...f.body,play_uid:'network-event-2',seq_no:2,started_at_device:new Date(f.start+20000).toISOString(),ended_at_device:new Date(f.start+30000).toISOString()};
 const r=await f.send(event);assert.equal(r.body.billable,true,JSON.stringify(r));
 // The second delivery begins after the IST month boundary, and must accrue separately.
 const sept=f.database.rows[`settlement_buckets/${settlementKey('cn','sa','2026-09','e1')}`];const oct=f.database.rows[`settlement_buckets/${settlementKey('cn','sa','2026-10','e1')}`];
 assert.equal(sept.billable_plays,1);assert.equal(oct.billable_plays,1);
 await f.send({...event,play_uid:'network-event-3',seq_no:3,started_at_device:new Date(f.start+40000).toISOString(),ended_at_device:new Date(f.start+50000).toISOString()});
 const final=f.database.rows[`settlement_buckets/${oct.id}`];assert.equal(final.billable_plays,2);assert.equal(final.gross_paise,14);assert.equal(final.fee_paise,1);assert.equal(final.owner_paise,3);assert.equal(final.net_paise,10);
});

test('offline assignment remains readable after network targeting is removed while foreign write guard stays closed',async()=>{
 const f=deviceFixture();f.database.rows['campaigns/cn'].screen_ids=[];f.database.rows['campaigns/cn'].participant_org_ids=[];
 const result=await f.send();assert.equal(result.body.billable,true,JSON.stringify(result));
 await assert.rejects(f.store.transact(f.context,async()=>{const d=await f.store.read();d.campaigns.find(c=>c.id==='cn').accrued_spend=123;await f.store.write(d);}),{status:403});
 await assert.rejects(f.store.transact(f.context,async()=>{const d=await f.store.read();d.settlement_buckets.push({id:'foreign',org_id:'b',campaign_id:'cn',screen_id:'sb',gross_paise:999});await f.store.write(d);}),{status:403});
 assert.equal(f.database.rows['campaigns/cn'].accrued_spend,999);assert.equal(f.database.rows['settlement_buckets/foreign'],undefined);
});

test('foreign assignment hints and device payload ownership fields never grant another organisation a receipt',async()=>{
 const f=deviceFixture();f.database.rows['device_assignments/foreign']={...f.assignment,id:'foreign',org_id:'b',screen_id:'sb',device_id:'other-device'};
 const bad=await f.send({...f.body,assignment_id:'foreign'});assert.equal(bad.status,409);assert.equal(f.database.commits.length,0);
 const forged=await f.send({...f.body,screen_id:'sb',org_id:'b'});assert.equal(forged.status,404);assert.equal(f.database.commits.length,0);
 const r=await f.send(f.body,{orgId:'b',targetOrg:'b'});assert.equal(r.body.billable,true,JSON.stringify(r));
 const bucket=Object.values(f.database.rows).find(x=>x.id===settlementKey('cn','sa','2026-09','e1'));assert.equal(bucket.org_id,'a');
});

test('authoritative settlement buckets remain available when receipt history is truncated',async()=>{
 const extra=Object.fromEntries(Array.from({length:1501},(_,i)=>[`plays/event${i}`,{id:`event${i}`,org_id:'a',campaign_id:'cn',advertiser_id:'ad',screen_id:'sa',ended_at:`2026-09-${String(i).padStart(6,'0')}`}]))
 const f=fixture(extra),d=await f.store.transact({...f.context,path:['screen','sa']},()=>f.store.read());assert.equal(d.history.truncated,true);assert.equal(d.plays.length,1500);assert.deepEqual(d.settlement_buckets.map(b=>b.gross_paise),[100]);
});

const EMULATOR='127.0.0.1:8185';
test('Enterprise emulator commits duplicate network receipts once and enforces operator/advertiser scoping',{skip:process.env.FIRESTORE_EMULATOR_HOST?false:`Set FIRESTORE_EMULATOR_HOST=${EMULATOR}`,timeout:120000},async()=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,EMULATOR,'Cloud access is forbidden in this test');
 const {Firestore}=require('@google-cloud/firestore');
 const db=new Firestore({projectId:'demo-gridcast-storage',databaseId:'gridcast-network-'+crypto.randomBytes(6).toString('hex')});
 const f=deviceFixture(),store=createFirestoreStore(db);
 try {
  const batch=db.batch();for(const [key,row] of Object.entries(f.database.rows)) batch.create(db.doc(key),row);await batch.commit();
  const processReceipt=()=>store.transact(f.context,async()=>{const d=await store.read();const r=deviceRoute(d,'POST',['play'],f.body,f.token,{now:f.now,playlist:()=>({items:[],config:{},config_version:1})});if(r.changed) await store.write(d);return r;});
  const replies=await Promise.all([processReceipt(),processReceipt()]);for(const r of replies) assert.equal(r.body.ok,true,JSON.stringify(r));assert.equal(replies.filter(r=>r.body.duplicate).length,1);
  const bucketId=settlementKey('cn','sa','2026-09','e1');const bucket=(await db.doc('settlement_buckets/'+bucketId).get()).data();assert.equal(bucket.org_id,'a');assert.equal(bucket.billable_plays,1);assert.equal(bucket.gross_paise,7);
  assert.equal((await db.doc('campaigns/cn').get()).data().accrued_spend,999);
  assert.equal((await db.collection('plays').where('play_uid','==',f.body.play_uid).get()).size,1);
  assert.equal((await db.collection('presence').get()).size,1);
  const report=(await db.doc('screen_day/'+reportingKey('sa','cn','cr',f.start)).get()).data();assert.equal(report.plays_rendered,1);assert.equal(report.plays_billable,1);assert.equal(report.org_id,'a');assert.equal(report.advertiser_id,'ad');assert.equal((await db.doc('_meta/reporting').get()).data().started_at,new Date(f.now).toISOString());
  const realNow=Date.now;Date.now=()=>f.now;
  try { for (const uid of ['a_owner','viewer']) {
    const date=require('./load-lib.cjs')('reporting').reportDay(f.start);
    const metrics=await store.transact({method:'GET',path:['metrics'],uid,from:date,to:date,reportScreen:'sa',reportCampaign:'cn'},()=>store.read());
    assert.equal(metrics.screen_day.length,1);assert.equal(metrics.screen_day[0].plays_rendered,1);assert.equal(metrics.report_page.has_more,false);
  } } finally {Date.now=realNow;}
  const owner=await store.transact({method:'GET',path:['bootstrap'],uid:'a_owner'},()=>store.read());
  assert.deepEqual(owner.screens.map(s=>s.id),['sa']);assert.deepEqual(owner.plays,[]);const ownerDetail=await store.transact({method:'GET',path:['screen','sa'],uid:'a_owner'},()=>store.read());assert.ok(ownerDetail.plays.length>0);assert.ok(ownerDetail.plays.every(p=>p.org_id==='a')); assert.ok(owner.settlement_buckets.every(b=>b.org_id==='a'));assert.ok(owner.campaigns.some(c=>c.id==='cn'));
  const adv=await store.transact({method:'GET',path:['bootstrap'],uid:'viewer'},()=>store.read());assert.deepEqual(new Set(adv.screens.map(s=>s.id)),new Set(['sa','sb']));assert.deepEqual(adv.plays,[]);const advertiserDetail=await store.transact({method:'GET',path:['campaign','cn'],uid:'viewer'},()=>store.read());assert.ok(advertiserDetail.plays.length>0);assert.ok(advertiserDetail.plays.every(p=>p.advertiser_id==='ad')); assert.ok(adv.settlement_buckets.every(b=>b.advertiser_id==='ad'));
  await assert.rejects(store.transact(f.context,async()=>{const d=await store.read();d.campaigns.find(c=>c.id==='cn').accrued_spend=0;await store.write(d);}),{status:403});
  await assert.rejects(store.transact(f.context,async()=>{const d=await store.read();d.settlement_buckets.push({id:'forbidden',org_id:'b',campaign_id:'cn',screen_id:'sb'});await store.write(d);}),{status:403});
  assert.equal((await db.doc('settlement_buckets/forbidden').get()).exists,false);
 } finally {await db.terminate();}
});

test('advertiser reporting resolves retired targets from authorized receipts and buckets without fetching other advertiser screens',async()=>{
 const rows=rowsFixture();rows['campaigns/cn'].screen_ids=['sa'];
 rows['screens/retired-bucket-only']={id:'retired-bucket-only',org_id:'b',name:'Retired venue',owner_share_pct:25,code:'private-pairing'};
 rows['settlement_buckets/retired']={id:'retired',org_id:'b',screen_id:'retired-bucket-only',campaign_id:'cn',advertiser_id:'ad',gross_paise:500};
 rows['screens/private-screen']={id:'private-screen',org_id:'b',name:'Other advertiser venue'};
 rows['campaigns/unrelated'].screen_ids=['private-screen'];rows['plays/private'].screen_id='private-screen';rows['settlement_buckets/private'].screen_id='private-screen';
 for(const path of [['bootstrap'],['campaign','cn']]) {
  const f=fixture(rows),d=await f.store.transact({...f.context,uid:'viewer',path},()=>f.store.read());
  assert.deepEqual(new Set(d.screens.map(s=>s.id)),new Set(['sa','sb','retired-bucket-only']));
  assert.ok(d.plays.every(p=>p.advertiser_id==='ad'));assert.ok(d.settlement_buckets.every(b=>b.advertiser_id==='ad'));
  assert.equal(f.database.reads.includes('screens/private-screen'),false);
  const publicScreen=load('access').screenView(d.screens.find(s=>s.id==='retired-bucket-only'),{role:'advertiser_viewer',org_id:'network',advertiser_id:'ad'});
  assert.equal(publicScreen.name,'Retired venue');assert.equal(Object.hasOwn(publicScreen,'owner_share_pct'),false);assert.equal(Object.hasOwn(publicScreen,'code'),false);
 }
});

test('two device transactions cannot reserve the same last paid play, and retry reuses the winning allowance',async()=>{
 const f=deviceFixture();
 delete f.database.rows['device_assignments/assignment'];
 Object.assign(f.database.rows['campaigns/cn'],{committed_budget:1,accrued_spend:0});
 for(const key of Object.keys(f.database.rows)) if(key.startsWith('settlement_buckets/')) delete f.database.rows[key];
 const second={...f.device,id:'dev_22345678-1234-1234-1234-123456789abc',org_id:'b',screen_id:'sb'};
 const token2=`gcp_${second.id}.`+crypto.randomBytes(32).toString('base64url');second.token_hash=crypto.createHash('sha256').update(token2).digest('hex');
 f.database.rows[`devices/${second.id}`]=second;
 const grant=(device,token)=>f.store.transact({method:'GET',path:['playlist',device.screen_id],deviceId:device.id},async()=>{
  const d=await f.store.read(); const result=deviceRoute(d,'GET',['playlist',device.screen_id],{},token,{now:f.now,playerProtocol:2,playlist:()=>({items:[{campaign_id:'cn',creative_id:'cr',duration_s:10,youtube_id:'abcdefghijk',rate_type:'per_play',rate_value:1}],config:{},config_version:1})});
  if(result.changed)await f.store.write(d); return result;
 });
 const [a,b]=await Promise.all([grant(f.device,f.token),grant(second,token2)]);
 const all=[...a.body.items,...b.body.items];assert.equal(all.reduce((n,i)=>n+i.max_plays,0),1);
 const winner=a.body.items.length?[f.device,f.token,a]:[second,token2,b];
 assert.equal((await grant(winner[0],winner[1])).body.items[0].assignment_id,winner[2].body.items[0].assignment_id);
 const ledger=f.database.rows['campaign_budgets/budget_cn'];assert.equal(ledger.reservations.length,1);assert.equal(ledger.spent_paise,0);
 assert.equal(JSON.stringify(f.database.rows['campaigns/cn']),JSON.stringify({...rowsFixture()['campaigns/cn'],committed_budget:1,accrued_spend:0}));
});

test('Enterprise emulator loads approved own-org filler and records image evidence without advertiser money',{skip:process.env.FIRESTORE_EMULATOR_HOST?false:`Set FIRESTORE_EMULATOR_HOST=${EMULATOR}`,timeout:120000},async()=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,EMULATOR);
 const {Firestore}=require('@google-cloud/firestore');const database=new Firestore({projectId:'demo-gridcast-storage',databaseId:'gridcast-filler-'+crypto.randomBytes(6).toString('hex')});
 const f=deviceFixture(),store=createFirestoreStore(database);let now=f.now;
 f.database.rows['creatives/house']={id:'house',org_id:'a',purpose:'filler',approval_status:'approved',media_type:'image',duration_s:20,assets:[{asset_id:'house-asset'}]};
 f.database.rows['assets/house-asset']={id:'house-asset',org_id:'a',sha256:'a'.repeat(64),bytes:100};
 f.database.rows['creatives/foreign-house']={id:'foreign-house',org_id:'b',purpose:'filler',approval_status:'approved'};
 try {
  const batch=database.batch();for(const [key,row] of Object.entries(f.database.rows))batch.create(database.doc(key),row);await batch.commit();
  const response=await store.transact({method:'GET',path:['playlist','sa'],deviceId:f.device.id},async()=>{
   const d=await store.read();assert.ok(d.creatives.some(c=>c.id==='house'));assert.ok(!d.creatives.some(c=>c.id==='foreign-house'));assert.ok(d.assets.some(a=>a.id==='house-asset'));
   const r=deviceRoute(d,'GET',['playlist','sa'],{},f.token,{now,playerProtocol:2,playlist:()=>({items:[],filler_items:[{campaign_id:null,kind:'filler',creative_id:'house',media_type:'image',width:1920,height:1080,duration_s:20,asset_id:'house-asset'}],config:{},config_version:1})});if(r.changed)await store.write(d);return r;
  });
  assert.equal(response.body.items.length,0);assert.equal(response.body.filler_items.length,1);const item=response.body.filler_items[0];assert.ok(item.max_plays>0);
  const body={...f.body,play_uid:'filler-image-0001',seq_no:100,assignment_id:item.assignment_id,campaign_id:null,creative_id:'house',started_at_device:new Date(now).toISOString(),ended_at_device:new Date(now+20000).toISOString(),playing_duration_ms:20000,media_evidence:'image_decode',decoded_width:1920,decoded_height:1080,visible_duration_ms:20000};now+=21000;
  const result=await store.transact({...f.context,assignmentId:body.assignment_id,playUid:body.play_uid,seqNo:body.seq_no,startedAtDevice:body.started_at_device},async()=>{const d=await store.read();const r=deviceRoute(d,'POST',['play'],body,f.token,{now,playlist:()=>({items:[],config:{},config_version:1})});if(r.changed)await store.write(d);return r;});
  assert.equal(result.body.billable,false);assert.ok(result.body.nonbillable_reasons.includes('filler'));
  const p=(await database.doc('plays/'+result.body.play_id).get()).data();assert.equal(p.rendered,true);assert.equal(p.campaign_id,null);assert.equal(p.advertiser_id,null);
  assert.equal((await database.doc('presence/'+result.body.play_id).get()).data().source,'filler_device_report');
  assert.equal((await database.collection('campaign_budgets').get()).size,0);assert.equal((await database.collection('settlement_buckets').get()).size,3);
 }finally{await database.terminate();}
});

test('Enterprise SDK serializes two screens reserving the final campaign rupee',{skip:process.env.FIRESTORE_EMULATOR_HOST?false:`Set FIRESTORE_EMULATOR_HOST=${EMULATOR}`,timeout:120000},async()=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,EMULATOR);const {Firestore}=require('@google-cloud/firestore');
 const database=new Firestore({projectId:'demo-gridcast-storage',databaseId:'gridcast-budget-'+crypto.randomBytes(6).toString('hex')});
 const f=deviceFixture(),store=createFirestoreStore(database);delete f.database.rows['device_assignments/assignment'];
 for(const k of Object.keys(f.database.rows))if(k.startsWith('settlement_buckets/'))delete f.database.rows[k];
 Object.assign(f.database.rows['campaigns/cn'],{committed_budget:1,accrued_spend:0});
 const second={...f.device,id:'dev_32345678-1234-1234-1234-123456789abc',org_id:'b',screen_id:'sb'};
 const token2=`gcp_${second.id}.`+crypto.randomBytes(32).toString('base64url');second.token_hash=crypto.createHash('sha256').update(token2).digest('hex');f.database.rows[`devices/${second.id}`]=second;
 try{
  const batch=database.batch();for(const [key,row] of Object.entries(f.database.rows))batch.create(database.doc(key),row);await batch.commit();
  const grant=(device,token)=>store.transact({method:'GET',path:['playlist',device.screen_id],deviceId:device.id},async()=>{
   const d=await store.read();const result=deviceRoute(d,'GET',['playlist',device.screen_id],{},token,{now:f.now,playerProtocol:2,playlist:()=>({items:[{campaign_id:'cn',creative_id:'cr',duration_s:10,youtube_id:'abcdefghijk',rate_type:'per_play',rate_value:1}],config:{},config_version:1})});if(result.changed)await store.write(d);return result;
  });
  const results=await Promise.all([grant(f.device,f.token),grant(second,token2)]);
  assert.equal(results.flatMap(r=>r.body.items).reduce((n,i)=>n+i.max_plays,0),1);
  const ledger=(await database.doc('campaign_budgets/budget_cn').get()).data();assert.equal(ledger.reservations.length,1);assert.equal(ledger.reservations[0].remaining_plays,1);assert.equal(ledger.spent_paise,0);
  assert.equal((await database.collection('device_assignments').get()).size,1);
  // The losing screen has persisted an empty assignment set. A failed acknowledged
  // attempt returns the winning hold; the losing screen must be funded on its next poll.
  const winningIndex=results[0].body.items.length?0:1, winner=winningIndex===0?f.device:second, losing=winningIndex===0?second:f.device;
  const winnerToken=winningIndex===0?f.token:token2, losingToken=winningIndex===0?token2:f.token;
  const assigned=results[winningIndex].body.items[0];
  const failed={...f.body,assignment_id:assigned.assignment_id,play_uid:'failed-reservation-0001',seq_no:200,started_at_device:new Date(f.now).toISOString(),ended_at_device:new Date(f.now+1000).toISOString(),playing_duration_ms:0,media_started_s:0,media_ended_s:0,ended_reason:'error'};
  await store.transact({method:'POST',path:['play'],deviceId:winner.id,assignmentId:failed.assignment_id,playUid:failed.play_uid,seqNo:failed.seq_no,startedAtDevice:failed.started_at_device},async()=>{
   const d=await store.read();const r=deviceRoute(d,'POST',['play'],failed,winnerToken,{now:f.now+1000,playlist:()=>({items:[],config:{},config_version:1})});assert.equal(r.body.billable,false);if(r.changed)await store.write(d);return r;
  });
  f.now+=1000;
  const funded=await grant(losing,losingToken);assert.equal(funded.body.items.length,1);assert.equal(funded.body.items[0].max_plays,1);
  const after=(await database.doc('campaign_budgets/budget_cn').get()).data();assert.equal(after.spent_paise,0);assert.equal(after.reservations.reduce((n,r)=>n+r.remaining_plays*r.rate_paise,0),100);
 }finally{await database.terminate();}
});
