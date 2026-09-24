const test=require('node:test');
const assert=require('node:assert/strict');
const {seedDemo,DEMO_CAMPAIGNS,DEMO_ADVERTISERS,DEMO_MEDIA_KEYS}=require('./load-lib.cjs')('demo-network');
function manifest(){const today=new Date(Date.now()+330*60000).toISOString().slice(0,10);return{starts_at:today,ends_at:today,media:Object.fromEntries(DEMO_MEDIA_KEYS.map((k,i)=>[k,{youtube_id:'testvideo'+String(i).padStart(2,'0'),duration_s:10+i%11,verification:{reference:'Synthetic unit-test duration evidence '+i,verified_at:new Date().toISOString()},approved_for_demo:true}]))}}
function fixture(){
 const records={orgs:[{id:'gridcast-real',name:'Gridcast',type:'gridcast',status:'active'}],screens:[{id:'test-real',org_id:'gridcast-real',name:'Test',pairing_code_hash:'existing-preserved'}],advertisers:[],creatives:[],campaigns:[]};
 const users=[{id:'real-admin',role:'platform_admin'}],devices=[{id:'real-device',screen_id:'test-real'}],calls=[];
 const request=async(method,path,body)=>{
  calls.push({method,path,body:structuredClone(body)});
  if(method==='GET'){
   const query=new URL('http://unit.invalid'+path).searchParams;
   const list=[...records[query.get('entity')]].sort((a,b)=>a.id.localeCompare(b.id)),after=query.get('after');
   const filtered=list.filter(r=>!after||r.id>after),items=filtered.slice(0,2); // Force pagination in every nontrivial directory.
   return{items:structuredClone(items),has_more:filtered.length>2,next_cursor:filtered.length>2?items.at(-1).id:null};
  }
  if(/^\/creative\/[^/]+\/approve$/.test(path)){
   const id=path.split('/')[2],creative=records.creatives.find(c=>c.id===id);creative.approval_status=body.status;return structuredClone(creative);
  }
  const entity={'/org':'orgs','/screens':'screens','/advertiser':'advertisers','/creative':'creatives','/campaign':'campaigns'}[path];
  assert.ok(entity,'only ordinary creation/approval routes allowed: '+path);
  assert.equal(body.admin_email,undefined,'seed may not create an admin');
  let row=records[entity].find(r=>r.external_key===body.external_key&&(!body.org_id||r.org_id===body.org_id));const reused=!!row;
  if(!row){row={id:entity+'-'+String(records[entity].length).padStart(3,'0'),...(entity==='creatives'?{approval_status:'pending',metadata_source:'operator_declared'}:{}),...structuredClone(body)};records[entity].push(row)}
  return entity==='screens'?{screen:structuredClone(row),pairing:reused?null:{code:'synthetic-secret'},reused}:{...structuredClone(row),reused};
 };
 return{records,users,devices,calls,request};
}
test('missing media and unverified duration fail before any API calls or mutations',async()=>{
 for(const mutate of [m=>{delete m.media[DEMO_MEDIA_KEYS[0]]},m=>{m.media[DEMO_MEDIA_KEYS[0]].duration_s=21},m=>{delete m.media[DEMO_MEDIA_KEYS[0]].verification},m=>{m.media[DEMO_MEDIA_KEYS[0]].approved_for_demo=false},m=>{m.starts_at='2000-01-01';m.ends_at='2000-01-02'}]){
  const f=fixture(),m=manifest();mutate(m);await assert.rejects(seedDemo(f.request,m));assert.equal(f.calls.length,0);
 }
});
test('seed adds exact demo cohort while retaining original Gridcast/Test/player and emits no secrets',async()=>{
 const f=fixture(),original=structuredClone({org:f.records.orgs[0],screen:f.records.screens[0],users:f.users,devices:f.devices});
 const result=await seedDemo(f.request,manifest());
 assert.deepEqual(result.created,{orgs:3,screens:12,advertisers:6,creatives:11,campaigns:9});
 assert.deepEqual(Object.fromEntries(Object.entries(result.cohort).map(([k,v])=>[k,v.length])),{orgs:4,screens:12,advertisers:6,creatives:11,campaigns:9});
 assert.equal(result.before.screens,1);assert.equal(result.existing_non_demo.screens,1);assert.equal(f.records.screens.length,13);
 assert.deepEqual({org:f.records.orgs[0],screen:f.records.screens[0],users:f.users,devices:f.devices},original);
 assert.equal(JSON.stringify(result).includes('synthetic-secret'),false);assert.equal(JSON.stringify(result).includes('existing-preserved'),false);
 assert.equal(f.records.orgs.filter(o=>o.type==='gridcast').length,1);
 assert.deepEqual(f.records.orgs.slice(1).map(o=>o.platform_fee_pct),[10,12,10]);
 assert.ok(f.records.creatives.every(c=>c.approval_status==='approved'));
 assert.equal(f.records.campaigns.filter(c=>c.creative_ids.length===2).length,2);
 for(const c of f.records.campaigns){assert.equal(c.campaign_type,'network');assert.equal(c.rate_type,'per_play');assert.equal(c.screen_ids.length,12);assert.ok(c.bookings.every(b=>b.slots_per_loop===1));}
 for(const s of f.records.screens.slice(1)){assert.equal(s.network_slots,6);assert.equal(s.advertiser_slots,10);assert.equal(s.loop_length_s,600);assert.equal(s.slot_duration_s,10);assert.equal(s.has_camera,true);assert.deepEqual(s.operating_hours,{from:'09:00',to:'21:00'});}
 assert.ok(result.media_provenance.every(m=>m.source==='operator_declared_youtube'));
});
test('second run paginates and creates or changes nothing, even existing user-edited demo screens',async()=>{
 const f=fixture(),m=manifest();await seedDemo(f.request,m);f.records.screens[1].name='User edited demo name';
 const before=structuredClone(f.records);f.calls.length=0;
 const result=await seedDemo(f.request,m);
 assert.deepEqual(result.created,{orgs:0,screens:0,advertisers:0,creatives:0,campaigns:0});assert.deepEqual(f.records,before);
 assert.ok(f.calls.some(c=>c.path.includes('&after=')));assert.ok(f.calls.every(c=>c.method==='GET'));
});
test('existing pending or different creative fails before creating anything else',async()=>{
 for(const change of [c=>{c.approval_status='rejected'},c=>{c.duration_s=19.5}]){
  const f=fixture(),m=manifest();await seedDemo(f.request,m);change(f.records.creatives[0]);f.calls.length=0;
  await assert.rejects(seedDemo(f.request,m));assert.ok(f.calls.every(c=>c.method==='GET'));
 }
});
test('server-verified approved uploads can be reused without creating or approving creatives',async()=>{
 const f=fixture(),m=manifest();
 for(const spec of DEMO_ADVERTISERS)f.records.advertisers.push({id:spec.slug,org_id:'gridcast-real',name:spec.name,category:spec.category,status:'active'});
 for(const c of DEMO_CAMPAIGNS)for(const slot of c.media){
  f.records.creatives.push({id:slot,org_id:'gridcast-real',advertiser_id:c.advertiser,approval_status:'approved',metadata_source:'server_ffprobe',duration_s:15,assets:[{asset_id:'asset-'+slot,duration_s:15,metadata_source:'server_ffprobe'}]});m.media[slot]={creative_id:slot};
 }
 const result=await seedDemo(f.request,m);
 assert.equal(result.created.creatives,0);assert.equal(result.created.advertisers,0);assert.equal(result.cohort.creatives.length,11);
 assert.ok(result.media_provenance.every(m=>m.source==='server_ffprobe_existing_upload'));
 assert.ok(f.calls.every(c=>!c.path.startsWith('/creative')));
});
test('existing uploaded media must be approved, measured by server and owned by Gridcast',async()=>{
 const f=fixture(),m=manifest();m.media[DEMO_MEDIA_KEYS[0]]={creative_id:'foreign'};
 f.records.creatives.push({id:'foreign',org_id:'another-org',advertiser_id:'foreign-ad',metadata_source:'server_ffprobe',approval_status:'approved',duration_s:15});
 f.records.advertisers.push({id:'foreign-ad',org_id:'another-org',name:'Coca-Cola India',category:'beverage'});
 await assert.rejects(seedDemo(f.request,m));assert.ok(f.calls.every(c=>c.method==='GET'));
});
test('missing or ambiguous Gridcast organisation aborts without creating replacement',async()=>{
 for(const ambiguous of [false,true]){const f=fixture();if(ambiguous)f.records.orgs.push({id:'other-gridcast',type:'gridcast'});else f.records.orgs=[];await assert.rejects(seedDemo(f.request,manifest()),/exactly one/);assert.ok(f.calls.every(c=>c.method==='GET'));}
});

function actualApiFixture(){
 const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),crypto=require('node:crypto');
 const env={NODE_ENV:'test',GC_DEMO_PASSWORD:crypto.randomBytes(24).toString('hex'),GC_AUTH_SECRET:crypto.randomBytes(40).toString('hex')};
 let saved,writes=0;const cache={};
 class StoreError extends Error{constructor(status,message){super(message);this.status=status}}
 const store={StoreError,mode:'memory',transact:async(_context,fn)=>fn(),read:async()=>structuredClone(saved),write:async value=>{saved=structuredClone(value);writes++}};
 function load(file){file=path.resolve(file);if(cache[file])return cache[file].exports;const mod={exports:{}};cache[file]=mod;const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','module','exports','process',code)(name=>name==='./store'?store:name.startsWith('.')?load(path.join(path.dirname(file),name+'.ts')):require(name),mod,mod.exports,{env});return mod.exports}
 const root=path.join(__dirname,'../lib');saved=load(path.join(root,'seed.ts')).seed();
 const existingTest={...saved.screens[0],id:'preserved-test',org_id:'org_gridcast',name:'Test'};
 saved.orgs=saved.orgs.filter(o=>o.type==='gridcast');saved.users=saved.users.filter(u=>u.id==='u_admin');saved.screens=[existingTest];
 saved.devices=[{id:'existing-paired-device',org_id:'org_gridcast',screen_id:existingTest.id,status:'online',token_hash:'synthetic-preserved-hash'}];
 for(const collection of ['advertisers','creatives','campaigns','plays','presence','configs','groups','assets','device_assignments','settlement_buckets','audit'])saved[collection]=[];
 const api=load(path.join(root,'api.ts')),auth=load(path.join(root,'auth.ts')),token=auth.issueToken(saved.users[0]);
 const request=async(method,route,body={})=>{
  const [p,q]=route.replace(/^\//,'').split('?');const result=await api.handle(method,p.split('/'),new URLSearchParams(q),body,token);
  assert.ok(!result.status||result.status<400,`${method} ${route}: ${result.status} ${JSON.stringify(result.body)}`);return result.body;
 };
 return {request,data:()=>structuredClone(saved),writes:()=>writes};
}
test('complete demo seed succeeds through actual authorization/inventory/API routes and reruns without writes',async()=>{
 const f=actualApiFixture(),m=manifest(),before=f.data();
 const first=await seedDemo(f.request,m),after=f.data();
 assert.deepEqual(first.created,{orgs:3,screens:12,advertisers:6,creatives:11,campaigns:9});
 assert.deepEqual(after.users,before.users);assert.deepEqual(after.devices,before.devices);assert.deepEqual(after.screens.find(s=>s.id==='preserved-test'),before.screens[0]);
 assert.equal(after.screens.length,13);assert.equal(after.orgs.length,4);assert.equal(after.creatives.length,11);
 for(const c of after.campaigns){assert.equal(c.origin_org_id,'org_gridcast');assert.equal(c.participant_org_ids.length,4);assert.equal(c.bookings.length,12);assert.ok(c.bookings.every(b=>b.slots_per_loop===1&&b.econ_version&&b.rate_paise>=10));}
 const writes=f.writes(),second=await seedDemo(f.request,m);
 assert.deepEqual(second.created,{orgs:0,screens:0,advertisers:0,creatives:0,campaigns:0});assert.equal(f.writes(),writes);assert.deepEqual(f.data(),after);
});
