const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const load=require('./load-lib.cjs'),PROJECT='demo-gridcast-storage',HOST='127.0.0.1:8185';
function database(id){assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST,'Only the explicitly configured local emulator may be used');return new(require('@google-cloud/firestore').Firestore)({projectId:PROJECT,databaseId:id});}
async function action(databaseId,method,path,body={},token,uid,client='shared-client'){
 const db=database(databaseId),store=load('firestore-store').createFirestoreStore(db),m=load('maintenance');
 const context={method,path:path.split('/'),uid,maintenanceId:path==='maintenance/redeem'?m.maintenanceCodeId(body.code):m.maintenanceTokenId(token),maintenanceLimiterIds:path==='maintenance/redeem'?m.maintenanceLimiterIds(client):undefined};
 try{return await store.transact(context,async()=>{const d=await store.read(),actor=uid?d.users.find(u=>u.id===uid):null;const result=m.maintenanceRoute(d,method,context.path,body,token,actor,{clientKey:client});if(result.changed)await store.write(d);return {...result,status:result.status||200};});}finally{await db.terminate();}
}
function worker(job){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[__filename,'worker'],{env:{...process.env,GCLOUD_PROJECT:PROJECT},stdio:['pipe','pipe','pipe']});let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);child.on('error',reject);child.on('exit',code=>{if(code)return reject(Error(error));try{resolve(JSON.parse(output));}catch(e){reject(e);}});child.stdin.end(JSON.stringify(job));});}
async function fixture(){
 const id='maintenance-'+crypto.randomBytes(6).toString('hex'),db=database(id),store=load('firestore-store').createFirestoreStore(db);
 await store.provision({orgs:[{id:'a',status:'active'},{id:'b',status:'active'}],users:[{id:'admin',org_id:'a',role:'platform_admin',email:'admin@example.invalid',password_hash:'synthetic',password_salt:'synthetic',auth_version:0},{id:'owner',org_id:'a',role:'owner',email:'owner@example.invalid',status:'active',auth_version:0},{id:'other',org_id:'b',role:'owner',email:'other@example.invalid',auth_version:0}],screens:[{id:'screen',org_id:'a',status:'disabled'}],devices:[{id:'old',org_id:'a',screen_id:'screen',status:'revoked',created_at:'2026-09-01T00:00:00Z'}],settings:{config_revision:1}});
 return{id,db,scope:{org_id:'a',screen_id:'screen',device_id:'old'}};
}
if(process.argv[2]==='worker'){let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',async()=>{try{const j=JSON.parse(input);process.stdout.write(JSON.stringify(await action(j.id,j.method,j.path,j.body,j.token,j.uid,j.client)));}catch(e){process.stderr.write(e.stack);process.exitCode=1;}});}
else if(!process.env.FIRESTORE_EMULATOR_HOST)test('maintenance Firestore concurrency (explicit local emulator required)',{skip:'Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8185'},()=>{});
else{
 test('maintenance grants redeem exactly once across processes and recheck historical scope in each transaction',{timeout:120000},async()=>{
  const f=await fixture();try{
   assert.equal((await action(f.id,'POST','screens/screen/maintenance',{device_id:'old'},undefined,'other')).status,404);
   const issued=await action(f.id,'POST','screens/screen/maintenance',{device_id:'old'},undefined,'owner');assert.equal(issued.status,201);
   const results=await Promise.all(Array.from({length:4},()=>worker({id:f.id,method:'POST',path:'maintenance/redeem',body:{code:issued.body.code}})));
   assert.deepEqual(results.map(r=>r.status).sort(),[200,401,401,401]);const successful=results.find(r=>r.status===200);
   const check=await action(f.id,'POST','maintenance/export',f.scope,successful.body.token);assert.equal(check.status,200);
   assert.equal(check.body.grant.expires_at,issued.body.grant.expires_at);
   const grant=(await f.db.collection('maintenance_grants').get()).docs[0].data();assert.ok(grant.session_hash);assert.ok(!JSON.stringify(grant).includes(successful.body.token));assert.ok(!JSON.stringify(grant).includes(issued.body.code));
   assert.equal((await f.db.collection('audit').where('action','==','maintenance/redeemed').get()).size,1);
   assert.equal((await f.db.doc('maintenance_limits/maintenance_global').get()).data().count,4);
   await f.db.doc('users/owner').update({auth_version:1});
   assert.equal((await action(f.id,'POST','maintenance/export',f.scope,successful.body.token)).status,401);
   assert.equal((await action(f.id,'POST','maintenance/close',f.scope,successful.body.token)).status,200);
   assert.equal((await f.db.collection('audit').where('action','==','maintenance/closed').get()).size,1);
  }finally{await f.db.terminate();}
 });
 test('denied maintenance guesses persist across instances without committing staged domain writes',{timeout:120000},async()=>{
  const f=await fixture();try{
   const results=[];for(let round=0;round<4;round++)results.push(...await Promise.all(Array.from({length:3},()=>worker({id:f.id,method:'POST',path:'maintenance/redeem',body:{code:'AAAAAAAAAAAAAAAA'}}))));
   assert.equal(results.filter(r=>r.status===401).length,10);assert.equal(results.filter(r=>r.status===429).length,2);
   const m=load('maintenance'),store=load('firestore-store').createFirestoreStore(f.db),ids=m.maintenanceLimiterIds('shared-client');
   assert.equal((await f.db.doc('maintenance_limits/'+ids[1]).get()).data().count,11);
   await store.transact({method:'POST',path:['maintenance','redeem'],maintenanceLimiterIds:ids},async()=>{const d=await store.read();d.maintenance_limits[0].count=99;d.screens.push({id:'forged',org_id:'a'});d.audit.push({id:'forged',org_id:'a'});await store.write(d);return{status:401};});
   assert.equal((await f.db.doc('screens/forged').get()).exists,false);assert.equal((await f.db.doc('audit/forged').get()).exists,false);
   assert.equal((await f.db.doc('maintenance_limits/'+ids[0]).get()).data().count,99);
   assert.equal((await f.db.collection('maintenance_grants').get()).size,0);
  }finally{await f.db.terminate();}
 });
 test('expired grant history does not block new authorizations or current grant listing',{timeout:120000},async()=>{
  const f=await fixture();try{
   for(let start=0;start<2001;start+=400){const batch=f.db.batch();for(let n=start;n<Math.min(2001,start+400);n++)batch.create(f.db.doc('maintenance_grants/expired-'+n),{id:'expired-'+n,screen_id:'screen',org_id:'a',device_id:'old',expires_at:'2020-01-01T00:00:00.000Z'});await batch.commit();}
   const issued=await action(f.id,'POST','screens/screen/maintenance',{device_id:'old'},undefined,'owner');assert.equal(issued.status,201);
   const listing=await action(f.id,'GET','screens/screen/maintenance',{},undefined,'owner');assert.equal(listing.status,200);assert.deepEqual(listing.body.grants.map(g=>g.id),[issued.body.grant.id]);
   assert.equal((await f.db.collection('maintenance_grants').get()).size,2002);
  }finally{await f.db.terminate();}
 });

}
