const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const nodePath=require('node:path');
const {chromium}=require('playwright');
const base=process.env.GC_UI_TEST_URL||'http://127.0.0.1:4012';
const executablePath=[process.env.GC_TEST_BROWSER_PATH,chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(fs.existsSync);
const multipartField=(data,name)=>new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r\\n]*)`).exec(data||'')?.[1];
async function harness(role='platform_admin') {
 const browser=await chromium.launch({executablePath,headless:true}); const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const user={id:'admin',org_id:'gridcast',role,name:'Fixture Admin',orgName:'Gridcast'};
 const orgs=[{id:'gridcast',name:'Gridcast',type:'gridcast',status:'active'},{id:'a',name:'Operator Alpha',type:'operator',status:'active'},{id:'b',name:'Operator Beta',type:'operator',status:'active'}];
 const advertisers=[{id:'archived-a',org_id:'a',name:'Archived client',status:'archived'}],creatives=[],campaigns=[],requests=[],drafts=[];
 const screen={id:'screen-a',org_id:'a',name:'Alpha screen',status:'active',venue_type:'cafe',address:'Fixture',slot_price_month:100,monthly_value:100,loop_length_s:600,slot_duration_s:10,advertiser_slots:10,bookings:[],has_camera:true,_status:{state:'live',label:'Live'}};
 const boot=(org)=>({orgs,org:orgs.find(o=>o.id===org),advertisers:advertisers.filter(a=>!org||a.org_id===org),creatives:creatives.filter(c=>!org||c.org_id===org),campaigns:campaigns.filter(c=>!org||c.org_id===org),screens:(!org||org==='a')?[screen]:[],groups:[],devices:[],plays:[],presence:[],users:[],caps:role==='sales'?['sales']:['platform','screens','sales','money','team','org'],settings:{}});
 await page.addInitScript(u=>{localStorage.setItem('gc_user',JSON.stringify(u));localStorage.setItem('gc_token','fixture-not-a-real-credential');},user);
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname.replace('/api',''),body=req.method()==='POST'?(req.headers()['content-type']?.includes('application/json')?req.postDataJSON():{multipart:req.postData()}):null; requests.push({path,body,url:url.search}); let result={};
  if(path==='/bootstrap')result=boot(url.searchParams.get('org'));
  else if(path==='/directory')result={items:orgs,next_cursor:null,has_more:false};
  else if(path==='/team')result=[];
  else if(path==='/advertiser'&&body){result={id:'adv-'+advertisers.length,status:'active',...body};advertisers.push(result);}
  else if(path.startsWith('/advertiser/')&&body){const a=advertisers.find(a=>a.id===path.split('/')[2]);if(path.endsWith('/archive'))a.status='archived';else if(path.endsWith('/restore'))a.status='active';else Object.assign(a,body);result=a;}
  else if(req.method()==='GET'&&/^\/creative\/[^/]+\/preview$/.test(path)){
   const creative=creatives.find(c=>c.id===path.split('/')[2]);
   if(!creative)result={error:'not found'};
   else if(Array.isArray(creative.assets)&&creative.assets.length)result={source:'uploaded',media_type:creative.media_type||creative.assets[0].media_type||'video',variants:creative.assets.map((asset,index)=>({id:String(index),media_type:asset.media_type||creative.media_type||'video',duration_s:asset.duration_s,width:asset.width,height:asset.height,aspect:asset.aspect||(asset.width&&asset.height?`${asset.width}:${asset.height}`:null),mime:asset.mime,url:asset.storage_path&&asset.mime&&Number.isSafeInteger(asset.bytes)&&asset.bytes>0?`/api/media?grant=fixture-${asset.media_type||creative.media_type||'video'}-${index}`:null}))};
   else if(creative.youtube_id&&/^[A-Za-z0-9_-]{11}$/.test(creative.youtube_id))result={source:'youtube',youtube_id:creative.youtube_id,duration_s:creative.duration_s};
   else result={source:'none'};
  }
  else if(req.method()==='GET'&&path==='/media'){
   const grant=url.searchParams.get('grant')||'';
   if(grant.includes('image'))result=null;
   if(grant.includes('image'))await route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO9sAAAAASUVORK5CYII=','base64')});
   else await route.fulfill({status:200,contentType:'video/mp4',body:fs.readFileSync(nodePath.join(__dirname,'../public/diagnostics/screen-test.mp4'))});
   return;
  }
  else if(path==='/creative'&&body){result={id:'cr-'+creatives.length,approval_status:'pending',...body};creatives.push(result);}
  else if(path.startsWith('/creative/')&&body){result=creatives.find(c=>c.id===path.split('/')[2]);if(path.endsWith('/approve'))result.approval_status=body.status;else if(body.source==='youtube'){
    Object.assign(result,{media_type:'video',youtube_id:body.youtube_id, duration_s:body.duration_s,...body,assets:[],approval_status:'pending'});delete result.approved_at;delete result.source;
   }else Object.assign(result,body);}
  else if(path==='/assets/upload'){
   const creativeId=multipartField(body.multipart,'creative_id'),replaceMode=multipartField(body.multipart,'replace_mode');
   const filename=body.multipart.match(/filename="([^"]+)"/)?.[1]??'';
   const asset={id:`asset-${creativeId}-${requests.length}`,duration_s:10,width:1280,height:720,media_type:/\.(png|jpe?g|webp)$/i.test(filename)?'image':'video'};
   result={asset};
   if(replaceMode==='replace_all'){
    const creative=creatives.find(c=>c.id===creativeId);if(creative){for(const key of ['name','category']){const value=multipartField(body.multipart,key);if(value!==undefined)creative[key]=value;}creative.assets=[asset];creative.media_type=asset.media_type;delete creative.youtube_id;creative.duration_s=asset.media_type==='image'?Number(multipartField(body.multipart,'image_duration_s')||20):asset.duration_s;creative.approval_status='pending';delete creative.approved_at;result.creative={...creative};}
   }
  }
  // Review workflow (doc 31 Phase 5): queue, submit, review and activate, mirroring lib/api.ts outcomes.
  else if(path==='/review-queue'){
   const pend=id=>{const c=creatives.find(x=>x.id===id);return !!c&&!['approved','rejected'].includes(c.approval_status);};
   // Re-review needs prior review/activation evidence (lib/api.ts): never-submitted pending/draft stays with its owner.
   const reviewedBefore=c=>['active','paused'].includes(c.status)||!!c.activated_at||c.review?.state==='approved_not_started';
   result={items:campaigns.filter(c=>(['draft','pending'].includes(c.status)&&c.review?.state==='in_review')||(reviewedBefore(c)&&['active','pending','paused'].includes(c.status)&&(c.creative_ids||[]).some(pend))).map(c=>({reason:['draft','pending'].includes(c.status)&&c.review?.state==='in_review'?'submitted':'re_review',
    campaign:{id:c.id,name:c.name,campaign_type:c.campaign_type,advertiser_id:c.advertiser_id,advertiser_name:advertisers.find(a=>a.id===c.advertiser_id)?.name,org_id:c.org_id,org_name:orgs.find(o=>o.id===c.org_id)?.name,starts_at:c.starts_at,ends_at:c.ends_at,screens:c.screen_ids.length,status:c.status,review:c.review||null},
    creatives:c.creative_ids.filter(pend).map(id=>{const cr=creatives.find(x=>x.id===id),others=campaigns.filter(o=>o.id!==c.id&&o.creative_ids.includes(id));return {...cr,media_type:cr.media_type||'video',usage:{other_campaigns:others.length,other_active:others.filter(o=>o.status==='active').length}};}),decided:[]})),
    filler:creatives.filter(c=>c.purpose==='filler'&&c.approval_status==='pending').map(c=>({...c,media_type:c.media_type||'image',org_name:orgs.find(o=>o.id===c.org_id)?.name}))};
  }
  else if(/^\/campaign\/[^/]+\/(submit|review|activate)$/.test(path)&&body){
   const [,,id,action]=path.split('/'),c=campaigns.find(x=>x.id===id);
   if(action==='review')for(const [cid,v] of Object.entries(body.creatives||{}))creatives.find(x=>x.id===cid).approval_status=v;
   const states=c.creative_ids.map(cid=>creatives.find(x=>x.id===cid)?.approval_status);let activation={attempted:false,activated:c.status==='active',error:null};
   if(action==='submit'){c.status='pending';c.review={state:'in_review',submitted_at:new Date().toISOString()};}
   else if(['draft','pending'].includes(c.status)&&(action==='activate'||c.review?.state==='in_review')&&!states.some(v=>!['approved','rejected'].includes(v))&&states.includes('approved')){c.status='active';delete c.review;activation={attempted:true,activated:true,error:null};}
   else if(action==='review'&&c.review?.state==='in_review'&&states.every(v=>v==='rejected'))c.review={...c.review,state:'changes_needed',note:body.note||null};
   result={campaign:c,activation};
  }
  else if(path==='/campaign'&&body){result={id:'campaign-'+campaigns.length,accrued_spend:0,invoice_status:'not_invoiced',...body};campaigns.push(result);}
  // Server drafts (doc 31 Phase 4): create, revisioned save, read, list, discard and submit.
  else if(path==='/campaign-drafts')result={items:drafts.filter(d=>!d.submitted_campaign_id&&(!url.searchParams.get('org')||d.org_id===url.searchParams.get('org')))};
  else if(path==='/campaign-draft'&&body){const at=new Date().toISOString();result={id:'cdr-'+drafts.length,created_by:user.id,revision:1,created_at:at,updated_at:at,expires_at:'2999-01-01T00:00:00.000Z',submitted_campaign_id:null,fields:{},...body};drafts.push(result);}
  else if(path.startsWith('/campaign-draft/')){const id=path.split('/')[2],d=drafts.find(x=>x.id===id),action=path.split('/')[3];
   if(!d){await route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Not found'})});return;}
   if(!body)result=d;
   else if(action==='discard'){drafts.splice(drafts.indexOf(d),1);result={ok:true};}
   else if(action==='submit'){const f=d.fields;const c={id:'campaign-'+campaigns.length,org_id:d.org_id,advertiser_id:d.advertiser_id,campaign_type:d.campaign_type,name:f.name,starts_at:f.starts_at,ends_at:f.ends_at,screen_ids:f.screen_ids,creative_ids:f.creative_ids,bookings:f.bookings,rate_type:f.rate_type,rate_value:f.rate_value,committed_budget:f.committed_budget,status:body.mode==='launch'?'active':'pending',review:body.mode==='launch'?undefined:{state:'in_review',submitted_at:new Date().toISOString()},accrued_spend:0,invoice_status:'not_invoiced'};campaigns.push(c);d.submitted_campaign_id=c.id;result={campaign:c,draft:d};}
   else{if(body.revision!==d.revision){await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'This draft changed in another tab. Reload it before saving again.'})});return;}
    const fields={...d.fields,...body.fields};for(const k of Object.keys(fields))if(fields[k]===null)delete fields[k];Object.assign(d,{step:body.step,advertiser_id:body.advertiser_id,campaign_type:body.campaign_type,fields,revision:d.revision+1,updated_at:new Date().toISOString()});result=d;}}
  else if(path==='/invite')result={user:{email:body.email},temp_password:'local-test-only'};
  else if(path==='/config/schema')result={groups:[],settings:[],locked:[],priced:[]};
  else if(path==='/config')result=[];
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.goto(base+(role==='sales'?'/operator#campaigns':'/admin?org=a#advertisers'));if(role!=='sales')await page.getByRole('button',{name:'Add advertiser',exact:true}).waitFor();else await page.getByRole('heading',{name:'Campaigns',exact:true}).waitFor();
 const nav=async hash=>{await page.evaluate(h=>location.hash=h,hash);};
 const field=(label)=>page.locator('label').filter({hasText:new RegExp('^'+label+'$')}).locator('..').locator('input,select').first();
 const step=async name=>{await page.getByRole('navigation',{name:'Campaign steps'}).getByRole('button',{name:new RegExp('^'+name)}).click();};
 return {browser,page,requests,advertisers,creatives,campaigns,drafts,nav,field,boot,screen,orgs,step};
}
test('master admin creates client, uploads and approves creative, books campaign in selected org',async()=>{
 const h=await harness(),{page,nav,field,requests}=h;
 try {
  await page.getByRole('button',{name:'Add advertiser',exact:true}).click();await page.getByLabel('Advertiser name',{exact:true}).fill('Alpha Client');await page.getByLabel('Advertiser email',{exact:true}).fill('fixture@example.invalid');await page.getByRole('button',{name:'Save advertiser'}).click();await page.getByRole('heading',{name:'Alpha Client',exact:true}).waitFor();
  assert.equal(requests.find(r=>r.path==='/advertiser').body.org_id,'a');await page.screenshot({path:'/tmp/gridcast-admin-advertiser.png',fullPage:true});
  await nav('creatives');await field('Name').fill('Alpha Video');await page.getByLabel('Creative advertiser').selectOption('adv-1');await page.getByRole('button',{name:'Add creative',exact:true}).click();await page.getByRole('button',{name:'Upload video',exact:true}).click();await page.getByLabel('MP4 or WebM video').setInputFiles({name:'fixture.mp4',mimeType:'video/mp4',buffer:Buffer.from('synthetic mocked upload')});await page.getByRole('button',{name:'Upload media',exact:true}).click();await page.getByRole('status').waitFor();assert.match(requests.find(r=>r.path==='/assets/upload').body.multipart,/cr-0/);await page.screenshot({path:'/tmp/gridcast-admin-creative.png',fullPage:true});
  assert.equal(requests.find(r=>r.path==='/creative').body.org_id,'a');
  // Doc 31 Phase 5: the Creatives table no longer approves; review happens in the Review queue. Approve in the fixture.
  assert.equal(await page.getByRole('button',{name:'Approve',exact:true}).count(),0);
  h.creatives.find(c=>c.id==='cr-0').approval_status='approved';await page.reload();await page.getByRole('button',{name:'Add creative',exact:true}).waitFor();
  await nav('new');await field('Campaign name').fill('Alpha Campaign');await page.getByLabel('Campaign advertiser').selectOption('adv-1');await page.getByLabel('Starts',{exact:true}).fill('2026-10-01');await page.getByLabel('Ends',{exact:true}).fill('2026-10-31');
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByLabel('Use screen Alpha screen').check();
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByLabel('Use creative Alpha Video').check();
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByLabel('Campaign rate type').selectOption('per_play');await page.getByLabel('Rate per play',{exact:true}).fill('0.93');await page.getByLabel('Committed budget',{exact:true}).fill('12000');
  await page.getByRole('button',{name:'Next',exact:true}).click();assert.equal(await page.getByLabel('Initial status').count(),0);
  await page.getByRole('button',{name:'Launch',exact:true}).click();await page.waitForFunction(()=>location.hash.startsWith('#c/'));
  const created=requests.find(r=>r.path==='/campaign-draft').body;assert.equal(created.org_id,'a');assert.equal(created.advertiser_id,'adv-1');assert.deepEqual(created.fields.screen_ids,['screen-a']);assert.equal(created.fields.committed_budget,12000);
  assert.equal(requests.find(r=>r.path.endsWith('/submit')).body.mode,'launch');assert.equal(h.campaigns[0].status,'active');assert.equal(requests.filter(r=>r.path==='/campaign').length,0);
 } finally {await h.browser.close();}
});
test('organisation switch clears drafts, preserves real admin identity, and advertiser invite is scoped',async()=>{
 const h=await harness(),{page,nav,field,requests}=h;
 try {
  h.advertisers.push({id:'adv-a',org_id:'a',name:'Alpha Client',status:'active'});await page.reload();await page.getByRole('button',{name:'Add advertiser',exact:true}).waitFor();await nav('new');await field('Campaign name').fill('Must clear');
  await page.getByText('Operator Alpha',{exact:true}).first().click();await page.getByText('Operator Beta',{exact:true}).click();await page.waitForURL(/org=b#campaigns/);await nav('new');assert.equal(await field('Campaign name').inputValue(),'');assert.equal(await page.getByLabel('Campaign advertiser').locator('option').count(),2);
  await page.goto(base+'/admin?org=a#set-team');await page.getByRole('button',{name:'Add someone'}).click();await field('Name').fill('Client reader');await field('Email').fill('reader@example.invalid');await field('Role').selectOption('advertiser_viewer');await page.getByLabel('Advertiser access').selectOption('adv-a');await page.screenshot({path:'/tmp/gridcast-admin-team.png',fullPage:true});await page.getByRole('button',{name:'Create login'}).click();await page.waitForFunction(()=>document.body.textContent.includes('local-test-only'));
  const invite=requests.find(r=>r.path==='/invite').body;assert.equal(invite.org_id,'a');assert.equal(invite.advertiser_id,'adv-a');assert.equal(invite.role,'advertiser_viewer');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('gc_user')).role),'platform_admin');
 } finally {await h.browser.close();}
});

test('cross-org detail links are blocked and all-org creation requires explicit scope',async()=>{
 const h=await harness();try{
  await h.page.goto(base+'/admin?org=b#s/screen-a');await h.page.getByText('This screen is outside the selected organisation.',{exact:false}).waitFor();
  assert.equal(h.requests.filter(r=>r.path==='/screen/screen-a').length,0);
  await h.page.goto(base+'/admin#advertisers');await h.page.getByRole('button',{name:'Add advertiser',exact:true}).waitFor();assert.equal(await h.page.getByRole('button',{name:'Add advertiser',exact:true}).isDisabled(),true);
 }finally{await h.browser.close();}
});
test('sales operator can read campaign list without redacted invoice data',async()=>{
 const h=await harness();try{
  h.campaigns.push({id:'c',org_id:'a',advertiser_id:'none',name:'Sales campaign',campaign_type:'own',screen_ids:[],creative_ids:[],rate_type:'per_play',rate_value:1,accrued_spend:0,committed_budget:10,status:'draft',starts_at:'2026-09-25',ends_at:'2026-10-25'});
  await h.page.route('**/api/bootstrap**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...h.boot('a'),caps:['sales']})}));
  await h.page.addInitScript(()=>localStorage.setItem('gc_user',JSON.stringify({id:'sales',org_id:'a',role:'sales',name:'Sales user',orgName:'Operator Alpha'})));
  await h.page.goto(base+'/operator#campaigns');await h.page.getByRole('button',{name:'Sales campaign',exact:true}).waitFor();assert.equal(await h.page.getByRole('columnheader',{name:'Invoice',exact:true}).count(),0);
  assert.equal(await h.page.getByRole('columnheader',{name:'People / play',exact:true}).count(),0);
  await h.page.getByRole('button',{name:'Campaign status: Draft',exact:true}).waitFor();
  // Phase 6 Delivery preset; the fixture /metrics answer is incomplete, so every period cell is "—", never 0.
  for(const name of ['Status','Dates','Screens','Plays','Legacy avg people','Est. impressions','Lifetime spend / budget'])await h.page.getByRole('columnheader',{name,exact:true}).waitFor();
  const presets=h.page.getByRole('group',{name:'Column preset',exact:true});
  assert.deepEqual(await presets.getByRole('button').allInnerTexts(),['Delivery','Audience']);
  const row=h.page.getByRole('row').filter({hasText:'Sales campaign'});
  assert.ok((await row.innerText()).split('—').length>=4,'plays, people and impressions are unmeasured');
  await presets.getByRole('button',{name:'Audience',exact:true}).click();
  for(const name of ['Avg looking','Attentive impressions','Attention coverage'])await h.page.getByRole('columnheader',{name,exact:true}).waitFor();
 }finally{await h.browser.close();}
});

test('campaign status popover explains partial delivery and re-ages a stale live heartbeat',async()=>{
 const h=await harness();try{
  const now=Date.now(),day=86400000;
  const today=new Date(now+330*60000).toISOString().slice(0,10),end=new Date(now+8*day+330*60000).toISOString().slice(0,10);
  h.screen._status={state:'live',label:'Live',device:{last_heartbeat_at:new Date(now-10_000).toISOString()}};
  h.advertisers.push({id:'status-adv',org_id:'a',name:'Status client',status:'active'});
  h.creatives.push({id:'status-cr',org_id:'a',advertiser_id:'status-adv',name:'Status creative',duration_s:10,approval_status:'approved'});
  h.campaigns.push({id:'status-campaign',org_id:'a',advertiser_id:'status-adv',name:'Status campaign',campaign_type:'own',screen_ids:['screen-a','screen-b'],creative_ids:['status-cr'],rate_type:'per_play',rate_value:1,accrued_spend:0,committed_budget:100,status:'active',starts_at:today,ends_at:end});
  const successAt=new Date(now-10*60000).toISOString();
  await h.page.route('**/api/metrics**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({campaignScreens:{'status-campaign':{'screen-a':successAt}},has_more:false,next_cursor:null})}));
  // This only changes the hash of the harness's existing admin URL; reload to fetch the seeded campaign.
  await h.page.goto(base+'/admin?org=a#campaigns');await h.page.reload();
  const live=h.page.getByRole('button',{name:'Campaign status: Live · 1 of 2 screens',exact:true});await live.waitFor({timeout:8000}).catch(async error=>{throw new Error(`${error.message}\nFixture campaigns:\n${JSON.stringify(h.campaigns)}\nRendered:\n${(await h.page.locator('body').innerText()).slice(-2200)}\nRequests:\n${JSON.stringify(h.requests.slice(-8))}`);});await live.click();
  let detail=await h.page.locator('[data-radix-popper-content-wrapper]').innerText();
  assert.match(detail,/Last successful paid play/);assert.match(detail,/Delivered in last 30 min\s+1 of 2 screens/);assert.match(detail,/Online now\s+1 of 2 screens/);assert.match(detail,/delivery report summary \(yesterday and today\)/);
  await h.page.screenshot({path:'/tmp/gridcast-phase1-status-partial.png',fullPage:true});

  // A stale `_status.state=live` must not outlive its heartbeat timestamp.
  h.screen._status.device.last_heartbeat_at=new Date(Date.now()-91_000).toISOString();
  await h.page.reload();
  const stale=h.page.getByRole('button',{name:'Campaign status: Unknown · delivered recently, but no screen is online now',exact:true});await stale.waitFor();await stale.click();
  detail=await h.page.locator('[data-radix-popper-content-wrapper]').innerText();
  assert.match(detail,/Delivered in last 30 min\s+1 of 2 screens/);assert.match(detail,/Online now\s+0 of 2 screens/);assert.match(detail,/Last successful paid play/);
  await h.page.screenshot({path:'/tmp/gridcast-phase1-status-aged.png',fullPage:true});
 }finally{await h.browser.close();}
});

test('sales and advertiser campaign status accepts sanitized heartbeat age without exposing raw device time',async()=>{
 const h=await harness(),errors=[];h.page.on('pageerror',e=>errors.push(e.message));try{
  const now=Date.now(),today=new Date(now+330*60000).toISOString().slice(0,10),end=new Date(now+8*86400000+330*60000).toISOString().slice(0,10);
  const observedAt=new Date(now).toISOString(),successAt=new Date(now-5*60000).toISOString();
  h.screen._status={state:'live',label:'Live',observed_at:observedAt,age_s:10};
  h.advertisers.push({id:'status-adv',org_id:'a',name:'Status client',status:'active'});
  h.creatives.push({id:'status-cr',org_id:'a',advertiser_id:'status-adv',name:'Status creative',duration_s:10,approval_status:'approved'});
  h.campaigns.push({id:'status-campaign',org_id:'a',advertiser_id:'status-adv',name:'Status campaign',campaign_type:'own',screen_ids:['screen-a'],creative_ids:['status-cr'],rate_type:'per_play',rate_value:1,accrued_spend:0,committed_budget:100,status:'active',starts_at:today,ends_at:end});
  await h.page.route('**/api/bootstrap**',route=>{
   const userId=new URL(route.request().url()).searchParams.get('user'),data=h.boot(userId==='sales'?'a':null);
   data.caps=userId==='sales'?['sales']:[];
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await h.page.route('**/api/metrics**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({totals:{plays_rendered:0,plays_billable:0,plays_not_rendered:0,plays_filler:0,presence_sum:0,presence_n:0,airtime_ms:0},byScreen:{},byCampaign:{},byCreative:{},daily:{},hourly:{},attentionProfiles:{},attention_page:{has_more:false,next_cursor:null},coverage:{started_at:null,complete:false},last_at:null,rows:0,has_more:false,next_cursor:null,campaignScreens:{'status-campaign':{'screen-a':successAt}}})}));

  await h.page.addInitScript(()=>localStorage.setItem('gc_user',JSON.stringify({id:'sales',org_id:'a',role:'sales',name:'Sales user',orgName:'Operator Alpha'})));
  await h.page.goto(base+'/operator#campaigns');
  let status=h.page.getByRole('button',{name:'Campaign status: Live · 1 of 1 screens',exact:true});await status.waitFor();await status.click();
  let popover=await h.page.locator('[data-radix-popper-content-wrapper]').innerText();
  assert.match(popover,/Online now\s+1 of 1 screens/);assert.match(popover,/delivery report summary \(yesterday and today\)/);assert.ok(!popover.includes(observedAt));

  await h.page.addInitScript(()=>localStorage.setItem('gc_user',JSON.stringify({id:'advertiser-user',org_id:'a',role:'advertiser_viewer',name:'Advertiser user',orgName:'Status client',advertiser_id:'status-adv'})));
  await h.page.goto(base+'/advertiser#overview');
  status=h.page.getByRole('button',{name:'Campaign status: Live · 1 of 1 screens',exact:true});await status.waitFor();await status.click();
  popover=await h.page.locator('[data-radix-popper-content-wrapper]').innerText();
  assert.match(popover,/Online now\s+1 of 1 screens/);assert.match(popover,/delivery report summary \(yesterday and today\)/);assert.ok(!popover.includes(observedAt));
  assert.deepEqual(errors,[]);
 }finally{await h.browser.close();}
});

test('creative editor previews the saved uploaded video and variants while source edits remain unsaved',async()=>{
 const h=await harness();try{
  const advertiser={id:'preview-adv',org_id:'a',name:'Preview client',status:'active'};
  h.advertisers.push(advertiser);h.creatives.push({id:'preview-video',org_id:'a',advertiser_id:advertiser.id,purpose:'paid',name:'Saved video',category:'general',media_type:'video',duration_s:12,assets:[
   {id:'wide-video',media_type:'video',mime:'video/mp4',storage_path:'fixture/wide.mp4',bytes:80000,duration_s:12,width:1280,height:720,aspect:'16:9'},
   {id:'portrait-video',media_type:'video',mime:'video/mp4',storage_path:'fixture/portrait.mp4',bytes:80000,duration_s:9,width:720,height:1280,aspect:'9:16'},
  ],approval_status:'approved'});
  await h.page.goto(base+'/admin?org=a#creatives');await h.page.reload();await h.page.getByRole('button',{name:'Edit creative Saved video',exact:true}).click();
  const preview=h.page.getByRole('region',{name:'Current saved creative'}),video=preview.getByLabel('Preview saved video for Saved video');await video.waitFor();
  const initial=await video.evaluate(el=>({controls:el.controls,autoplay:el.autoplay,paused:el.paused,preload:el.preload,src:el.getAttribute('src')}));
  assert.equal(initial.controls,true);assert.equal(initial.autoplay,false);assert.equal(initial.paused,true);assert.equal(initial.preload,'metadata');assert.match(initial.src,/grant=fixture-video-0/);
  const variation=h.page.getByLabel('Preview active variation');await variation.selectOption('1');await video.waitFor();await h.page.waitForFunction(()=>document.querySelector('[aria-label="Preview saved video for Saved video"]')?.getAttribute('src')?.includes('grant=fixture-video-1'));
  await h.page.getByLabel('Edit creative source',{exact:true}).selectOption('image');
  assert.equal(await variation.inputValue(),'1');assert.equal(await video.getAttribute('src'),'/api/media?grant=fixture-video-1');
  assert.equal(await preview.locator('img').count(),0);assert.equal(await h.page.getByText('The current source stays active until the file verifies.',{exact:false}).count(),1);
  const previewRequest=h.requests.find(r=>r.path==='/creative/preview-video/preview');assert.ok(previewRequest);assert.equal(previewRequest.body,null);
 }finally{await h.browser.close();}
});

test('creative editor displays saved images and loads YouTube only after a user action',async()=>{
 const h=await harness();try{
  const advertiser={id:'preview-adv',org_id:'a',name:'Preview client',status:'active'};h.advertisers.push(advertiser);
  h.creatives.push({id:'preview-image',org_id:'a',advertiser_id:advertiser.id,purpose:'paid',name:'Saved image',category:'general',media_type:'image',duration_s:20,assets:[{id:'saved-image',media_type:'image',mime:'image/png',storage_path:'fixture/saved.png',bytes:68,duration_s:20,width:640,height:640,aspect:'1:1'}],approval_status:'approved'});
  h.creatives.push({id:'preview-youtube',org_id:'a',advertiser_id:advertiser.id,purpose:'paid',name:'Saved YouTube',category:'general',media_type:'video',youtube_id:'dQw4w9WgXcQ',duration_s:13,approval_status:'approved'});
  await h.page.goto(base+'/admin?org=a#creatives');await h.page.reload();await h.page.getByRole('button',{name:'Edit creative Saved image',exact:true}).click();
  const imagePreview=h.page.getByRole('region',{name:'Current saved creative'}),image=imagePreview.getByAltText('Saved image for Saved image');await image.waitFor();assert.match(await image.getAttribute('src'),/grant=fixture-image-0/);assert.equal(await image.evaluate(el=>el.naturalWidth),1);assert.equal(await imagePreview.locator('video').count(),0);
  await h.page.getByRole('button',{name:'Cancel',exact:true}).click();await h.page.getByRole('button',{name:'Edit creative Saved YouTube',exact:true}).click();
  const youtubePreview=h.page.getByRole('region',{name:'Current saved creative'});assert.equal(await youtubePreview.locator('iframe').count(),0);
  await youtubePreview.getByRole('button',{name:'Load YouTube preview',exact:true}).click();const frame=youtubePreview.getByTitle('YouTube preview: Saved YouTube');await frame.waitFor();assert.match(await frame.getAttribute('src'),/youtube-nocookie.com\/embed\/dQw4w9WgXcQ\?autoplay=0/);
  const fallback=youtubePreview.getByRole('link',{name:'Watch on YouTube',exact:true});assert.equal(await fallback.getAttribute('href'),'https://www.youtube.com/watch?v=dQw4w9WgXcQ');assert.equal(await fallback.getAttribute('target'),'_blank');
 }finally{await h.browser.close();}
});

test('creative editor saves existing row and cancel leaves it unchanged',async()=>{
 const h=await harness();try{
  h.advertisers.push({id:'active-a',org_id:'a',name:'Active client',status:'active'});await h.page.reload();await h.page.getByRole('button',{name:'Add advertiser',exact:true}).waitFor();
  await h.nav('creatives');await h.field('Name').fill('Editable video');await h.page.getByLabel('Creative advertiser').selectOption('active-a');await h.page.getByRole('button',{name:'Add creative',exact:true}).click();
  await h.page.getByRole('button',{name:'Edit creative Editable video',exact:true}).click();await h.page.getByLabel('Edit creative name',{exact:true}).fill('Updated video');await h.page.getByRole('button',{name:'Save creative',exact:true}).click();
  await h.page.getByRole('button',{name:'Edit creative Updated video',exact:true}).waitFor();assert.equal(h.requests.filter(r=>r.path==='/creative/cr-0').at(-1).body.name,'Updated video');
  await h.page.getByRole('button',{name:'Edit creative Updated video',exact:true}).click();await h.page.getByLabel('Edit creative name',{exact:true}).fill('Discard me');await h.page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(h.requests.filter(r=>r.path==='/creative/cr-0').length,1);
 }finally{await h.browser.close();}
});


test('global creative editor replaces an approved uploaded source with YouTube and resets approval',async()=>{
 const h=await harness();try{
  const advertiser={id:'source-adv',org_id:'a',name:'Source client',status:'active'};
  const creative={id:'source-cr',org_id:'a',advertiser_id:advertiser.id,purpose:'paid',name:'Uploaded source',category:'general',media_type:'video',duration_s:10,assets:[{id:'asset-old',media_type:'video',width:1280,height:720,duration_s:10}],approval_status:'approved',approved_at:'2026-09-30T10:00:00.000Z'};
  h.advertisers.push(advertiser);h.creatives.push(creative);
  await h.page.goto(base+'/admin?org=a#creatives');await h.page.reload();
  await h.page.getByRole('button',{name:'Edit creative Uploaded source',exact:true}).click();
  await h.page.getByLabel('Edit creative source',{exact:true}).selectOption('youtube');
  await h.page.getByLabel('Edit creative video',{exact:true}).fill('dQw4w9WgXcQ');
  await h.page.getByLabel('Edit creative duration',{exact:true}).fill('13.5');
  await h.page.getByRole('button',{name:'Save creative',exact:true}).click();
  await h.page.getByRole('button',{name:'Edit creative Uploaded source',exact:true}).waitFor();
  const request=h.requests.find(r=>r.path==='/creative/source-cr');assert.equal(request.body.source,'youtube');assert.equal(request.body.youtube_id,'dQw4w9WgXcQ');assert.equal(request.body.duration_s,13.5);
  const saved=h.creatives.find(c=>c.id==='source-cr');assert.equal(saved.id,creative.id);assert.equal(saved.org_id,advertiser.org_id);assert.equal(saved.advertiser_id,advertiser.id);assert.equal(saved.youtube_id,'dQw4w9WgXcQ');assert.deepEqual(saved.assets,[]);assert.equal(saved.approval_status,'pending');assert.equal(saved.approved_at,undefined);
 }finally{await h.browser.close();}
});

test('advertiser library replaces uploaded media in place and saves edited metadata',async()=>{
 const h=await harness();try{
  const advertiser={id:'replace-adv',org_id:'a',name:'Replace client',status:'active'};
  const creative={id:'replace-cr',org_id:'a',advertiser_id:advertiser.id,purpose:'paid',name:'Library replacement',category:'general',media_type:'video',duration_s:10,assets:[{id:'asset-before',media_type:'video',width:1280,height:720,duration_s:10}],approval_status:'approved',approved_at:'2026-09-30T10:00:00.000Z'};
  h.advertisers.push(advertiser);h.creatives.push(creative);
  await h.page.goto(base+`/admin?org=a#a/${advertiser.id}`);await h.page.reload();await h.page.getByRole('tab',{name:'Creatives',exact:true}).click();
  const card=h.page.getByRole('group',{name:/Creative (Library replacement|Replacement keeps name)/});await card.getByRole('button',{name:'Edit creative Library replacement',exact:true}).click();
  await h.page.getByLabel('Edit creative name',{exact:true}).fill('Replacement keeps name');await h.page.getByLabel('Edit creative category',{exact:true}).fill('seasonal');
  await h.page.getByLabel('MP4 or WebM video',{exact:true}).setInputFiles({name:'replacement.mp4',mimeType:'video/mp4',buffer:Buffer.from('synthetic replacement upload')});
  await h.page.getByRole('button',{name:'Save changes & replace active media',exact:true}).click();
  await card.getByText('pending',{exact:true}).waitFor();
  const upload=h.requests.find(r=>r.path==='/assets/upload');assert.equal(multipartField(upload.body.multipart,'creative_id'),'replace-cr');assert.equal(multipartField(upload.body.multipart,'replace_mode'),'replace_all');assert.equal(multipartField(upload.body.multipart,'name'),'Replacement keeps name');assert.equal(multipartField(upload.body.multipart,'category'),'seasonal');
  const saved=h.creatives.find(c=>c.id==='replace-cr');assert.equal(saved.id,creative.id);assert.equal(saved.org_id,advertiser.org_id);assert.equal(saved.advertiser_id,advertiser.id);assert.equal(saved.name,'Replacement keeps name');assert.equal(saved.category,'seasonal');assert.equal(saved.media_type,'video');assert.equal(saved.youtube_id,undefined);assert.equal(saved.assets.length,1);assert.notEqual(saved.assets[0].id,'asset-before');assert.equal(saved.approval_status,'pending');assert.equal(saved.approved_at,undefined);
 }finally{await h.browser.close();}
});

test('failed advertiser library replacement preserves the approved active creative',async()=>{
 const h=await harness();try{
  const advertiser={id:'failed-replace-adv',org_id:'a',name:'Keep client',status:'active'};
  const creative={id:'failed-replace-cr',org_id:'a',advertiser_id:advertiser.id,purpose:'paid',name:'Keep approved source',category:'general',media_type:'video',duration_s:10,assets:[{id:'keep-asset',media_type:'video',width:1280,height:720,duration_s:10}],approval_status:'approved',approved_at:'2026-09-30T10:00:00.000Z'};
  const original=JSON.parse(JSON.stringify(creative)),failedUploads=[];
  h.advertisers.push(advertiser);h.creatives.push(creative);
  await h.page.route('**/api/assets/upload',route=>{failedUploads.push(route.request().postData());return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Fixture replacement failure'})});});
  await h.page.goto(base+`/admin?org=a#a/${advertiser.id}`);await h.page.reload();await h.page.getByRole('tab',{name:'Creatives',exact:true}).click();
  const card=h.page.getByRole('group',{name:'Creative Keep approved source',exact:true});await card.getByRole('button',{name:'Edit creative Keep approved source',exact:true}).click();
  await h.page.getByLabel('MP4 or WebM video',{exact:true}).setInputFiles({name:'failed-replacement.mp4',mimeType:'video/mp4',buffer:Buffer.from('synthetic failed replacement')});
  await h.page.getByRole('button',{name:'Save changes & replace active media',exact:true}).click();
  await h.page.getByRole('alert').filter({hasText:'Fixture replacement failure'}).waitFor();
  assert.deepEqual(h.creatives.find(c=>c.id==='failed-replace-cr'),original);assert.equal(h.requests.filter(r=>r.path==='/creative').length,0);
  assert.equal(multipartField(failedUploads.at(-1),'creative_id'),'failed-replace-cr');assert.equal(multipartField(failedUploads.at(-1),'replace_mode'),'replace_all');
 }finally{await h.browser.close();}
});

test('platform network builder keeps Gridcast ownership and books released cross-org screens per play',async()=>{
 const h=await harness();try{
  h.advertisers.push({id:'network-adv',org_id:'gridcast',name:'Network Client',status:'active'});
  h.creatives.push({id:'network-cr',org_id:'gridcast',advertiser_id:'network-adv',name:'Network Video',duration_s:10,approval_status:'approved'});
  const beta={...h.screen,id:'screen-b',org_id:'b',name:'Beta screen',network_available:true,network_slots:6};
  await h.page.route('**/api/network-inventory**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({screens:[{...h.screen,network_available:true,network_slots:6},beta,{...beta,id:'closed',name:'Closed to network',network_available:false}],orgs:h.orgs,campaigns:[],creatives:h.creatives})}));
  await h.page.goto(base+'/admin?org=gridcast#new');await h.page.getByLabel('Campaign type',{exact:true}).selectOption('network');
  await h.field('Campaign name').fill('Across the network');await h.page.getByLabel('Campaign advertiser').selectOption('network-adv');await h.page.getByLabel('Starts',{exact:true}).fill('2026-10-01');await h.page.getByLabel('Ends',{exact:true}).fill('2026-10-31');
  await h.step('Screens');await h.page.getByText('Beta screen',{exact:true}).waitFor();assert.equal(await h.page.getByText('Closed to network',{exact:true}).count(),0);
  for(const name of ['Alpha screen','Beta screen'])await h.page.getByLabel('Use screen '+name).check();
  await h.step('Creatives');await h.page.getByLabel('Use creative Network Video').check();
  await h.step('Budget');assert.equal(await h.page.getByLabel('Campaign rate type').isDisabled(),true);assert.equal(await h.page.getByLabel('Campaign rate type').inputValue(),'per_play');
  await h.page.getByLabel('Rate per play',{exact:true}).fill('1.1');await h.page.getByLabel('Committed budget',{exact:true}).fill('5000');
  await h.step('Review');await h.page.getByRole('button',{name:'Launch',exact:true}).click();await h.page.waitForFunction(()=>location.hash.startsWith('#c/'));
  const payload=h.requests.find(r=>r.path==='/campaign-draft').body;assert.equal(payload.campaign_type,'network');assert.equal(payload.org_id,'gridcast');assert.equal(payload.advertiser_id,'network-adv');assert.equal(payload.fields.rate_type,'per_play');assert.deepEqual(payload.fields.bookings,[{screen_id:'screen-a',rotation_weight:1},{screen_id:'screen-b',rotation_weight:1}]);assert.equal(payload.scheduling_mode,undefined); // Scheduling mode is derived by the server.
  assert.equal(h.requests.filter(r=>r.path==='/campaign').length,0);
 }finally{await h.browser.close();}
});

test('advertiser editor preserves and updates venue, screen and tag exclusions',async()=>{
 const h=await harness();try{
  h.advertisers.push({id:'adv-exclusions',org_id:'a',name:'Restricted Client',status:'active',exclusions:{venue_types:['gym'],screens:[],tag_rules:[{chain:'local',floor:'ground'}]}});
  await h.page.reload();await h.page.getByRole('button',{name:'Restricted Client',exact:true}).click();await h.page.getByRole('tab',{name:'Settings',exact:true}).click();await h.page.getByRole('button',{name:'Edit advertiser',exact:true}).click();
  assert.equal(await h.page.getByLabel('Excluded venue types').inputValue(),'gym');assert.equal(await h.page.getByLabel('Excluded tag combinations').inputValue(),'chain:local, floor:ground');
  await h.page.getByLabel('Excluded venue types').fill('gym, cafe, gym');await h.page.getByLabel('Exclude screen Alpha screen',{exact:true}).check();await h.page.getByLabel('Excluded tag combinations').fill('chain:local, floor:ground\narea:restricted');
  await h.page.getByRole('button',{name:'Save advertiser',exact:true}).click();await h.page.getByRole('button',{name:'Edit advertiser',exact:true}).waitFor();
  const payload=h.requests.filter(r=>r.path==='/advertiser/adv-exclusions').at(-1).body;assert.deepEqual(payload.exclusions,{venue_types:['gym','cafe'],screens:['screen-a'],tag_rules:[{chain:'local',floor:'ground'},{area:'restricted'}]});
 }finally{await h.browser.close();}
});

test('operator network campaign is readonly with scoped money and exact verified settlement',async()=>{
 const h=await harness();try{
  const campaign={id:'network',org_id:'gridcast',advertiser_id:'none',name:'Network on Alpha',campaign_type:'network',screen_ids:['screen-a'],creative_ids:[],rate_type:'per_play',accrued_spend:0.93,status:'active',starts_at:'2026-09-25',ends_at:'2026-10-25'};
  const bucket={id:'verified',campaign_id:'network',screen_id:'screen-a',org_id:'a',period:'2026-09',billable_plays:1,gross_paise:93,fee_paise:9,owner_paise:21,net_paise:63,platform_fee_pct:10,owner_share_pct:25,fee_basis:'gross',rate_version:'rate-1',fee_version:'fee-1',econ_version:'econ-1'};
  const boot={...h.boot('a'),caps:['sales','money','screens'],campaigns:[campaign],settlement_buckets:[bucket]};
  await h.page.route('**/api/bootstrap**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(boot)}));
  await h.page.route('**/api/campaign/network',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({campaign,byScreen:[{screen:h.screen,plays:1,avg:null}],byCreative:[],totals:{plays:1,measured:0,avg:null},plays:[],settlement_buckets:[bucket]})}));
  await h.page.addInitScript(()=>localStorage.setItem('gc_user',JSON.stringify({id:'owner',org_id:'a',role:'owner',name:'Owner',orgName:'Operator Alpha'})));
  await h.page.goto(base+'/operator#campaigns');await h.page.getByRole('button',{name:campaign.name,exact:true}).waitFor();
  assert.equal(await h.page.getByRole('button',{name:'live',exact:true}).count(),0);
  // Phase 6: invoice and settlement live in the Money preset (money capability only); the default preset is Delivery.
  assert.equal(await h.page.getByText('Managed by Gridcast',{exact:true}).count(),0);
  await h.page.getByRole('group',{name:'Column preset',exact:true}).getByRole('button',{name:'Money',exact:true}).click();
  assert.equal(await h.page.getByText('Managed by Gridcast',{exact:true}).count(),1);
  await h.page.getByRole('columnheader',{name:'Lifetime verified settlement',exact:true}).waitFor();await h.page.getByRole('tabpanel').getByRole('cell').filter({hasText:/^₹0\.93/}).waitFor();
  await h.page.getByRole('button',{name:campaign.name,exact:true}).click();await h.page.getByRole('heading',{name:campaign.name,exact:true}).waitFor();
  assert.equal(await h.page.getByRole('button',{name:'Edit',exact:true}).count(),0);assert.equal(await h.page.getByRole('button',{name:'Pause',exact:true}).count(),0);
  // Phase 2: settlement moved into the Money tab; the spend card labels the redacted budget.
  await h.page.getByRole('group',{name:'Lifetime gross on your screens',exact:true}).getByText('your screens only',{exact:true}).waitFor();
  await h.page.getByRole('tab',{name:'Money',exact:true}).click();await h.page.getByText('₹0.63',{exact:true}).waitFor();
  await h.nav('settlement');await h.page.getByRole('heading',{name:'Settlement',exact:true}).waitFor();await h.page.getByText('₹0.93',{exact:true}).waitFor();await h.page.getByText('₹0.09',{exact:true}).waitFor();await h.page.getByText('₹0.21',{exact:true}).waitFor();await h.page.getByText('₹0.63',{exact:true}).waitFor();
  assert.equal(h.requests.filter(r=>r.path==='/campaign/network'&&r.body).length,0);
 }finally{await h.browser.close();}
});

test('campaign dashboard shows four headline cards with coverage cues, switches tabs and shows Money only with the capability',async()=>{
 const h=await harness(),errors=[];h.page.on('pageerror',e=>errors.push(e.message));try{
  const now=Date.now(),today=new Date(now+330*60000).toISOString().slice(0,10),end=new Date(now+8*86400000+330*60000).toISOString().slice(0,10);
  const advertiser={id:'dash-adv',org_id:'a',name:'Dashboard client',status:'active'};
  const creative={id:'dash-cr',org_id:'a',advertiser_id:'dash-adv',name:'Dashboard creative',duration_s:10,approval_status:'approved'};
  const campaign={id:'dash',org_id:'a',advertiser_id:'dash-adv',name:'Dashboard campaign',campaign_type:'own',screen_ids:['screen-a'],creative_ids:['dash-cr'],bookings:[{screen_id:'screen-a',rotation_weight:1,rate_type:'per_play',rate_value:1}],rate_type:'per_play',rate_value:1,committed_budget:1000,accrued_spend:850,invoice_status:'not_invoiced',status:'active',starts_at:today,ends_at:end};
  let caps=['sales'];
  await h.page.route('**/api/bootstrap**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...h.boot('a'),caps,advertisers:[advertiser],creatives:[creative],campaigns:[campaign]})}));
  await h.page.route('**/api/campaign/dash',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({campaign,advertiser,byScreen:[{screen:h.screen,plays:0,avg:null}],byCreative:[{creative,plays:0,avg:null}],totals:{plays:0,measured:0,avg:null},plays:[],settlement_buckets:[],eligibility:[{screen_id:'screen-a',creative_id:'dash-cr',eligible:true,reason:'eligible'}]})}));
  const counters={plays_rendered:42,plays_billable:40,plays_not_rendered:1,plays_filler:0,presence_sum:10,presence_n:4,airtime_ms:420000};
  await h.page.route('**/api/metrics**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({totals:counters,byScreen:{'screen-a':counters},byCampaign:{dash:counters},byCreative:{'dash-cr':counters},daily:{[today]:counters},hourly:{},attentionProfiles:{},attention_page:{has_more:false,next_cursor:null},coverage:{started_at:today+'T00:00:00Z',complete:false},last_at:null,rows:1,has_more:false,next_cursor:null,campaignScreens:{}})}));
  await h.page.addInitScript(()=>localStorage.setItem('gc_user',JSON.stringify({id:'sales',org_id:'a',role:'sales',name:'Sales user',orgName:'Operator Alpha'})));
  await h.page.goto(base+'/operator#campaigns');await h.page.getByRole('button',{name:campaign.name,exact:true}).click();await h.page.getByRole('heading',{name:campaign.name,exact:true}).waitFor();
  const headline=h.page.getByRole('region',{name:'Campaign headline',exact:true});
  for(const name of ['Spend vs budget','Plays','Est. impressions','Avg people present'])await headline.getByRole('group',{name,exact:true}).waitFor();
  const plays=headline.getByRole('group',{name:'Plays',exact:true});await plays.getByText('42',{exact:true}).waitFor();await plays.getByText('partial',{exact:true}).waitFor();
  await headline.getByRole('group',{name:'Spend vs budget',exact:true}).getByText('Lifetime',{exact:true}).waitFor();
  await headline.getByRole('group',{name:'Est. impressions',exact:true}).getByText('Unavailable',{exact:true}).waitFor();
  await headline.getByRole('group',{name:'Avg people present',exact:true}).getByText('2.5',{exact:true}).waitFor();
  assert.equal(await h.page.getByRole('group',{name:'Chart metric',exact:true}).getByRole('button',{name:/Est\. impressions/}).isDisabled(),true);
  assert.equal(await h.page.getByRole('group',{name:'Chart metric',exact:true}).getByRole('button',{name:/Est\. impressions/}).getAttribute('aria-pressed'),'false');
  await h.page.getByRole('button',{name:'Pause',exact:true}).waitFor();assert.equal(await h.page.getByRole('button',{name:'Resume',exact:true}).count(),0);
  assert.deepEqual(await h.page.getByRole('tab').allInnerTexts(),['Screens','Creatives','Audience','Diagnostics']);
  assert.equal(await h.page.getByRole('tab',{name:'Money',exact:true}).count(),0);
  await h.page.getByRole('tabpanel').getByText('Eligible',{exact:true}).waitFor();
  await h.page.getByRole('tab',{name:'Creatives',exact:true}).click();assert.equal(await h.page.getByRole('tab',{name:'Creatives',exact:true}).getAttribute('aria-selected'),'true');
  await h.page.getByRole('tabpanel').getByText('Dashboard creative',{exact:true}).waitFor();
  await h.page.keyboard.press('ArrowRight');assert.equal(await h.page.getByRole('tab',{name:'Audience',exact:true}).getAttribute('aria-selected'),'true');
  await h.page.getByRole('tabpanel').getByText('Measurement profile',{exact:true}).waitFor();
  await h.page.getByRole('tab',{name:'Diagnostics',exact:true}).click();await h.page.getByRole('tabpanel').getByText(/Play diagnostics/).waitFor();
  await h.page.setViewportSize({width:390,height:844});assert.ok(await headline.getByRole('group',{name:'Plays',exact:true}).isVisible());
  await h.page.setViewportSize({width:1440,height:1000});
  caps=['platform','screens','sales','money','team','org'];
  await h.page.addInitScript(()=>localStorage.setItem('gc_user',JSON.stringify({id:'admin',org_id:'gridcast',role:'platform_admin',name:'Fixture Admin',orgName:'Gridcast'})));
  await h.page.goto(base+'/admin?org=a#campaigns');await h.page.reload();await h.page.getByRole('button',{name:campaign.name,exact:true}).click();await h.page.getByRole('heading',{name:campaign.name,exact:true}).waitFor();
  await h.page.getByRole('tab',{name:'Money',exact:true}).click();await h.page.getByRole('tabpanel').getByText('Verified settlement',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
 }finally{await h.browser.close();}
});

test('admin opens a network campaign from an operator scope and retains withdrawn screen bookings on edit',async()=>{
 const h=await harness();try{
  const campaign={id:'network-edit',org_id:'gridcast',advertiser_id:'network-adv',name:'Network edit',campaign_type:'network',screen_ids:['screen-a'],creative_ids:['network-cr'],bookings:[{screen_id:'screen-a',slots_per_loop:2}],rate_type:'per_play',rate_value:0.93,committed_budget:500,accrued_spend:0,invoice_status:'not_invoiced',status:'active',starts_at:'2026-09-25',ends_at:'2026-10-25'};
  const creative={id:'network-cr',org_id:'gridcast',advertiser_id:'network-adv',name:'Network creative',duration_s:10,approval_status:'approved'};
  const alpha={...h.screen,network_available:false,network_slots:0},beta={...h.screen,id:'screen-b',org_id:'b',name:'Beta available',network_available:true,network_slots:6};
  const changes=[];
  await h.page.route('**/api/bootstrap**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...h.boot('a'),campaigns:[campaign]})}));
  await h.page.route('**/api/network-inventory**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({screens:[alpha,beta],orgs:h.orgs,campaigns:[campaign],creatives:[creative]})}));
  await h.page.route('**/api/campaign/network-edit',route=>{if(route.request().method()==='POST')changes.push(route.request().postDataJSON());return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({campaign,byScreen:[{screen:alpha,plays:0,avg:null}],byCreative:[{creative,plays:0,avg:null}],totals:{plays:0,measured:0,avg:null},plays:[],settlement_buckets:[]})});});
  await h.page.goto(base+'/admin?org=a#campaigns');await h.page.reload();await h.page.getByRole('button',{name:'Network edit',exact:true}).click();await h.page.getByRole('button',{name:'Edit',exact:true}).click();
  await h.page.getByText('Beta available',{exact:false}).first().waitFor();assert.equal(await h.page.getByLabel('Turns per round for Alpha screen').inputValue(),'2');
  await h.page.getByText('Beta available',{exact:false}).first().locator('..').locator('input[type=checkbox]').check();
  await h.page.getByRole('button',{name:'Save changes',exact:true}).click();await h.page.getByRole('button',{name:'Edit',exact:true}).waitFor();
  assert.equal(changes.length,1);assert.deepEqual(changes[0].bookings,[{screen_id:'screen-a',rotation_weight:2},{screen_id:'screen-b',rotation_weight:1}]);assert.equal(changes[0].rate_type,'per_play');
 }finally{await h.browser.close();}
});


test('image filler creation defaults to 20 seconds without an advertiser and supports upload',async()=>{
 const h=await harness();try{
  await h.nav('creatives');await h.page.getByLabel('Creative purpose',{exact:true}).selectOption('filler');
  await h.page.getByLabel('Creative media source',{exact:true}).selectOption('image');
  assert.equal(await h.page.getByLabel('Image display seconds',{exact:true}).inputValue(),'20');
  assert.equal(await h.page.getByLabel('Creative advertiser',{exact:true}).count(),0);
  await h.field('Name').fill('Venue welcome');await h.page.getByRole('button',{name:'Add creative',exact:true}).click();
  await h.page.getByRole('button',{name:'Upload image',exact:true}).waitFor();
  const request=h.requests.find(r=>r.path==='/creative');assert.equal(request.body.purpose,'filler');assert.equal(request.body.media_type,'image');assert.equal(request.body.duration_s,20);assert.equal(request.body.advertiser_id,undefined);
  await h.page.getByRole('button',{name:'Upload image',exact:true}).click();
  await h.page.getByLabel('PNG, JPEG or WebP image',{exact:true}).setInputFiles({name:'still.png',mimeType:'image/png',buffer:Buffer.from('mock image upload; real decoding covered separately')});
  await h.page.getByRole('button',{name:'Upload media',exact:true}).click();await h.page.getByRole('status').waitFor();assert.ok(h.requests.some(r=>r.path==='/assets/upload'));
 }finally{await h.browser.close();}
});
test('uploaded image display time stays editable and sends a timing change',async()=>{
 const h=await harness();try{
  h.creatives.push({id:'image-1',org_id:'a',name:'Still image',category:'general',purpose:'filler',media_type:'image',duration_s:20,approval_status:'approved',assets:[{width:32,height:24,media_type:'image'}]});
  await h.page.goto(base+'/admin?org=a#creatives');await h.page.reload();await h.page.getByRole('heading',{name:'Creatives',exact:true}).waitFor();await h.page.getByRole('button',{name:'Edit creative Still image',exact:true}).click();
  await h.page.getByLabel('Edit creative duration',{exact:true}).fill('12.5');await h.page.getByRole('button',{name:'Save creative',exact:true}).click();
  await h.page.getByRole('button',{name:'Edit creative Still image',exact:true}).waitFor();assert.equal(h.requests.find(r=>r.path==='/creative/image-1').body.duration_s,12.5);
 }finally{await h.browser.close();}
});

test('advertiser workspace shows tabs, library usage, one-step create with upload failure, pre-filled campaign and archived block',async()=>{
 const h=await harness(),errors=[];h.page.on('pageerror',e=>errors.push(e.message));try{
  h.advertisers.push({id:'ws-adv',org_id:'a',name:'Workspace client',status:'active',category:'retail'});
  h.creatives.push({id:'archived-cr',org_id:'a',advertiser_id:'archived-a',purpose:'paid',name:'Archived library item',category:'general',media_type:'video',youtube_id:'dQw4w9WgXcQ',duration_s:10,approval_status:'approved'});
  h.creatives.push({id:'ws-cr',org_id:'a',advertiser_id:'ws-adv',purpose:'paid',name:'Library spot',category:'retail',media_type:'video',youtube_id:'dQw4w9WgXcQ',duration_s:15,approval_status:'approved'});
  h.campaigns.push({id:'ws-c',org_id:'a',advertiser_id:'ws-adv',name:'Workspace campaign',campaign_type:'own',screen_ids:['screen-a'],creative_ids:['ws-cr'],rate_type:'per_play',rate_value:1,committed_budget:100,accrued_spend:12,invoice_status:'not_invoiced',status:'paused',starts_at:'2026-09-01',ends_at:'2099-12-31'});
  h.campaigns.push({id:'ws-old',org_id:'a',advertiser_id:'ws-adv',name:'Ended campaign',campaign_type:'own',screen_ids:['screen-a'],creative_ids:['ws-cr'],rate_type:'per_play',rate_value:1,committed_budget:100,accrued_spend:0,invoice_status:'not_invoiced',status:'active',starts_at:'2020-01-01',ends_at:'2020-01-31'});
  await h.page.goto(base+'/admin?org=a#a/ws-adv');await h.page.reload();await h.page.getByRole('heading',{name:'Workspace client',exact:true}).waitFor();
  assert.deepEqual(await h.page.getByRole('tab').allInnerTexts(),['Overview','Campaigns','Creatives','Settings']);
  await h.page.getByRole('tabpanel').getByText('Lifetime',{exact:true}).waitFor();await h.page.getByRole('tabpanel').getByText('₹12',{exact:true}).waitFor();
  await h.page.getByRole('tab',{name:'Campaigns',exact:true}).click();await h.page.getByRole('button',{name:'Campaign status: Paused',exact:true}).waitFor();
  await h.page.getByRole('tab',{name:'Settings',exact:true}).click();await h.page.getByRole('button',{name:'Archive advertiser',exact:true}).waitFor();
  await h.page.getByRole('tab',{name:'Creatives',exact:true}).click();
  const card=h.page.getByRole('group',{name:'Creative Library spot',exact:true});
  await card.getByText('approved',{exact:true}).waitFor();await card.getByText(/^Used in 1 visible campaign · \+1 ended$/).waitFor();
  await card.getByRole('button',{name:'Replace active media for Library spot',exact:true}).click();
  await card.getByText(/Uploading a new file sends this creative back to review\. It needs approval before it can play in any of its 1 unended visible campaign\./).waitFor();
  await card.getByRole('button',{name:'Cancel',exact:true}).click();
  await h.page.getByRole('button',{name:'+ New creative',exact:true}).click();await h.page.getByLabel('New creative name',{exact:true}).fill('Fresh spot');await h.page.getByRole('button',{name:'Create creative',exact:true}).click();
  await h.page.getByLabel('MP4 or WebM video',{exact:true}).setInputFiles({name:'fresh.mp4',mimeType:'video/mp4',buffer:Buffer.from('synthetic mocked upload')});await h.page.getByRole('button',{name:'Upload media',exact:true}).click();
  await h.page.getByText(/now has its video/).waitFor();
  const created=h.requests.find(r=>r.path==='/creative').body;assert.equal(created.advertiser_id,'ws-adv');assert.equal(created.org_id,'a');assert.equal(created.purpose,'paid');
  assert.match(h.requests.find(r=>r.path==='/assets/upload').body.multipart,new RegExp(h.creatives.find(c=>c.name==='Fresh spot').id));
  await h.page.getByRole('group',{name:'Creative Fresh spot',exact:true}).getByText('pending',{exact:true}).waitFor();
  await h.page.route('**/api/assets/upload',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Fixture upload failure'})}));
  await h.page.getByRole('button',{name:'Add another',exact:true}).click();await h.page.getByLabel('New creative name',{exact:true}).fill('Broken spot');await h.page.getByRole('button',{name:'Create creative',exact:true}).click();
  await h.page.getByLabel('MP4 or WebM video',{exact:true}).setInputFiles({name:'broken.mp4',mimeType:'video/mp4',buffer:Buffer.from('synthetic mocked upload')});await h.page.getByRole('button',{name:'Upload media',exact:true}).click();
  await h.page.getByText(/was kept and shows as “No media yet”/).waitFor();assert.equal(await h.page.getByText(/Fixture upload failure/).count(),1);
  await h.page.getByRole('group',{name:'Creative Broken spot',exact:true}).getByText('No media yet',{exact:true}).first().waitFor();
  await h.page.getByRole('tab',{name:'Campaigns',exact:true}).click();await h.page.getByRole('button',{name:'+ New campaign',exact:true}).click();
  await h.page.waitForFunction(()=>location.hash==='#new:a:ws-adv');assert.equal(await h.page.getByLabel('Campaign advertiser').inputValue(),'ws-adv');
  await h.page.goto(base+'/admin#new:a:ws-adv');await h.page.reload();await h.page.waitForURL(/org=a#new:a:ws-adv/);await h.page.getByLabel('Campaign advertiser').waitFor();assert.equal(await h.page.getByLabel('Campaign advertiser').inputValue(),'ws-adv');
  await h.page.goto(base+'/admin?org=a#a/archived-a');await h.page.reload();await h.page.getByRole('heading',{name:'Archived client',exact:true}).waitFor();
  await h.page.getByRole('tab',{name:'Creatives',exact:true}).click();assert.equal(await h.page.getByRole('button',{name:'+ New creative',exact:true}).isDisabled(),true);
  const archivedCard=h.page.getByRole('group',{name:'Creative Archived library item',exact:true});await archivedCard.waitFor();
  assert.equal(await archivedCard.getByRole('button',{name:'Edit creative Archived library item',exact:true}).count(),0);
  assert.equal(await archivedCard.getByRole('button',{name:'Replace active media for Archived library item',exact:true}).count(),0);
  await h.page.getByRole('tab',{name:'Campaigns',exact:true}).click();assert.equal(await h.page.getByRole('button',{name:'+ New campaign',exact:true}).isDisabled(),true);
  await h.page.getByRole('tab',{name:'Settings',exact:true}).click();await h.page.getByRole('button',{name:'Restore advertiser',exact:true}).waitFor();
  await h.nav('creatives');await h.page.getByLabel('Creative advertiser',{exact:true}).waitFor();assert.equal(await h.page.getByLabel('Creative advertiser',{exact:true}).locator('option[value="archived-a"]').count(),0);
  assert.deepEqual(errors,[]);
 }finally{await h.browser.close();}
});

test('direct campaign links for missing or archived advertisers never select another client',async()=>{
 const h=await harness();try{
  h.advertisers.push({id:'fallback-adv',org_id:'a',name:'Fallback client',status:'active'});
  for(const id of ['missing-adv','archived-a']){
   await h.page.goto(base+`/admin?org=a#new:a:${id}`);await h.page.reload();
   const alert=h.page.getByRole('alert').filter({hasText:id==='archived-a'?'This advertiser is archived':'This advertiser is not available in the selected organisation'});await alert.waitFor();
   await alert.getByText(id==='archived-a'?/This advertiser is archived\./:/This advertiser is not available in the selected organisation\./).waitFor();
   assert.equal(await h.page.getByLabel('Campaign advertiser',{exact:true}).count(),0,`admin route exposed the campaign form for ${id}`);
  }
  await h.browser.close();
  const operator=await harness('sales');try{
   operator.advertisers.find(a=>a.id==='archived-a').org_id='gridcast';
   operator.advertisers.push({id:'fallback-adv',org_id:'gridcast',name:'Fallback client',status:'active'});
   for(const id of ['missing-adv','archived-a']){
    await operator.page.goto(base+`/operator#new:a:${id}`);await operator.page.reload();
    const alert=operator.page.getByRole('alert').filter({hasText:id==='archived-a'?'This advertiser is archived':'This advertiser is not available in the selected organisation'});
    await alert.waitFor();await alert.getByText(id==='archived-a'?/This advertiser is archived\./:/This advertiser is not available in the selected organisation\./).waitFor();
    assert.equal(await operator.page.getByLabel('Campaign advertiser',{exact:true}).count(),0,`operator route exposed the campaign form for ${id}`);
   }
  }finally{await operator.browser.close();}
 }finally{if(h.browser.isConnected())await h.browser.close();}
});

test('guided flow saves a Basics-only server draft, resumes at its step, keeps input on a failed save, and submits with Launch disabled for a pending creative',async()=>{
 const h=await harness(),errors=[];h.page.on('pageerror',e=>errors.push(e.message));try{
  h.advertisers.push({id:'flow-adv',org_id:'a',name:'Flow client',status:'active'});
  h.creatives.push({id:'flow-cr',org_id:'a',advertiser_id:'flow-adv',purpose:'paid',name:'Pending spot',media_type:'video',youtube_id:'dQw4w9WgXcQ',duration_s:10,approval_status:'pending'});
  await h.page.goto(base+'/admin?org=a#new');await h.page.reload();await h.page.getByLabel('Campaign name',{exact:true}).fill('Draft only');
  assert.equal(await h.page.getByRole('navigation',{name:'Campaign steps'}).getByRole('button',{name:/^Basics/}).getAttribute('aria-current'),'step');
  await h.page.getByRole('button',{name:'Save draft',exact:true}).click();await h.page.getByRole('status').filter({hasText:/Saved at/}).waitFor();
  const created=h.requests.find(r=>r.path==='/campaign-draft').body;
  assert.deepEqual(created.fields,{name:'Draft only'});assert.equal(created.advertiser_id,null);assert.equal(created.step,'basics');assert.equal(created.org_id,'a');
  assert.equal(await h.page.evaluate(()=>location.hash),'#draft:cdr-0');
  await h.page.reload();await h.page.getByRole('heading',{name:'Draft only',exact:true}).waitFor();
  assert.equal(await h.page.getByLabel('Campaign name',{exact:true}).inputValue(),'Draft only');
  assert.equal(await h.page.getByRole('navigation',{name:'Campaign steps'}).getByRole('button',{name:/^Basics/}).getAttribute('aria-current'),'step');
  await h.page.getByLabel('Campaign advertiser').selectOption('flow-adv');await h.page.getByLabel('Starts',{exact:true}).fill('2026-10-01');await h.page.getByLabel('Ends',{exact:true}).fill('2026-10-31');
  await h.step('Screens');await h.page.getByLabel('Use screen Alpha screen').check();
  // A failed save keeps every entry and offers Retry; "Saved" never appears for it.
  await h.page.route('**/api/campaign-draft/cdr-0',route=>route.request().method()==='POST'?route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Fixture save failure'})}):route.fallback(),{times:1});
  await h.page.getByRole('button',{name:'Save draft',exact:true}).click();
  const failed=h.page.getByRole('alert').filter({hasText:'Draft not saved: Fixture save failure'});await failed.waitFor();
  assert.equal(await h.page.getByRole('status').filter({hasText:/Saved at/}).count(),0);assert.equal(await h.page.getByLabel('Use screen Alpha screen').isChecked(),true);
  await failed.getByRole('button',{name:'Retry',exact:true}).click();await h.page.getByRole('status').filter({hasText:/Saved at/}).waitFor();
  assert.equal(h.drafts[0].step,'screens');assert.deepEqual(h.drafts[0].fields.screen_ids,['screen-a']);assert.equal(Object.hasOwn(h.drafts[0].fields,'committed_budget'),false);
  await h.step('Creatives');await h.page.getByLabel('Use creative Pending spot').check();
  await h.step('Budget');await h.page.getByLabel('Campaign rate type').selectOption('per_play');await h.page.getByLabel('Rate per play',{exact:true}).fill('1');await h.page.getByLabel('Committed budget',{exact:true}).fill('100');
  await h.step('Review');await h.page.getByText(/this campaign waits for review before it plays/).waitFor();
  assert.equal(await h.page.getByRole('button',{name:'Launch',exact:true}).isDisabled(),true);
  await h.page.route('**/api/campaign/campaign-0',route=>{const submittedCampaign=h.campaigns.find(c=>c.id==='campaign-0');return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({campaign:submittedCampaign,advertiser:h.advertisers.find(a=>a.id===submittedCampaign.advertiser_id),byScreen:[{screen:h.screen,plays:0,avg:null}],byCreative:[{creative:h.creatives.find(c=>c.id==='flow-cr'),plays:0,avg:null}],totals:{plays:0,measured:0,avg:null},plays:[],settlement_buckets:[],eligibility:[]})});});
  await h.page.getByRole('button',{name:'Submit for review',exact:true}).click();await h.page.waitForFunction(()=>location.hash.startsWith('#c/'));
  assert.equal(h.requests.find(r=>r.path==='/campaign-draft/cdr-0/submit').body.mode,'submit');assert.equal(h.campaigns.at(-1).status,'pending');
  // The Campaigns page lists only unsubmitted drafts; discard needs a confirmation.
  h.drafts.push({id:'cdr-x',org_id:'a',created_by:'admin',step:'budget',fields:{name:'Keep or toss'},advertiser_id:null,revision:3,updated_at:new Date().toISOString(),submitted_campaign_id:null});
  await h.page.goto(base+'/admin?org=a#campaigns');await h.page.reload();
  await h.page.getByRole('button',{name:'Resume draft Keep or toss',exact:true}).waitFor();
  assert.equal(await h.page.getByRole('button',{name:'Resume draft Draft only',exact:true}).count(),0);
  await h.page.getByRole('button',{name:'Discard draft Keep or toss',exact:true}).click();await h.page.getByRole('button',{name:'Discard',exact:true}).click();
  await h.page.getByRole('button',{name:'Resume draft Keep or toss',exact:true}).waitFor({state:'detached'});
  assert.deepEqual(errors,[]);
 }finally{await h.browser.close();}
});

test('review queue approves a submitted campaign in one action with reuse counts; changed creatives are labelled; filler keeps creative approval',async()=>{
 const h=await harness();try{
  const advertiser={id:'rq-adv',org_id:'a',name:'Queue client',status:'active'};h.advertisers.push(advertiser);
  h.creatives.push({id:'rq-cr',org_id:'a',advertiser_id:advertiser.id,purpose:'paid',name:'Queue spot',category:'general',youtube_id:'dQw4w9WgXcQ',duration_s:15,approval_status:'pending'});
  h.creatives.push({id:'rq-fill',org_id:'a',purpose:'filler',name:'House filler',category:'house',media_type:'image',approval_status:'pending'});
  const base={org_id:'a',advertiser_id:advertiser.id,campaign_type:'operator',screen_ids:['screen-a'],creative_ids:['rq-cr'],rate_type:'per_play',rate_value:1,committed_budget:100,accrued_spend:0,starts_at:'2026-01-01',ends_at:'2027-12-31'};
  h.campaigns.push({...base,id:'rq-sub',name:'Submitted campaign',status:'pending',review:{state:'in_review',submitted_at:'2026-10-01T05:00:00.000Z'}});
  h.campaigns.push({...base,id:'rq-live',name:'Live campaign',status:'active'});
  h.campaigns.push({...base,id:'rq-new',name:'Never submitted campaign',status:'pending'});
  await h.nav('approvals');await h.page.getByRole('heading',{name:'Review queue',exact:true}).waitFor();
  const card=h.page.getByRole('group',{name:'Review Submitted campaign',exact:true});await card.waitFor();
  await card.getByText('Also used in 2 other campaigns (1 active). Approval applies there too.',{exact:true}).waitFor();
  assert.equal(await h.page.getByRole('group',{name:'Review Never submitted campaign',exact:true}).count(),0,'never-submitted pending is not shown as a changed creative');
  const liveCard=h.page.getByRole('group',{name:'Review Live campaign',exact:true});await liveCard.getByText('Changed creative',{exact:true}).waitFor();
  await liveCard.getByRole('button',{name:'Approve creative',exact:true}).waitFor();await liveCard.getByText(/Decisions apply to the creatives only; the campaign stays active/).waitFor();
  assert.equal(await card.getByRole('button',{name:'Reject',exact:true}).isDisabled(),true,'reject needs a note');
  await card.getByRole('button',{name:'Approve campaign',exact:true}).click();
  await h.page.getByRole('status').filter({hasText:'Submitted campaign: approved and now active.'}).waitFor();
  assert.deepEqual(h.requests.find(r=>r.path==='/campaign/rq-sub/review').body,{creatives:{'rq-cr':'approved'}});
  assert.equal(h.campaigns.find(c=>c.id==='rq-sub').status,'active');
  assert.equal(h.requests.filter(r=>/\/creative\/[^/]+\/approve$/.test(r.path)).length,0,'campaign review is one call, not a loop over creatives');
  await h.page.getByText('No campaigns are waiting for review.',{exact:true}).waitFor();
  await h.page.getByRole('tab',{name:'Filler (1)',exact:true}).click();await h.page.getByRole('button',{name:'Approve filler House filler',exact:true}).click();
  await h.page.getByRole('status').filter({hasText:'House filler: approved.'}).waitFor();assert.deepEqual(h.requests.find(r=>r.path==='/creative/rq-fill/approve').body,{status:'approved'});
  await h.nav('creatives');await h.page.getByRole('button',{name:'Edit creative Queue spot',exact:true}).waitFor();
  assert.equal(await h.page.getByRole('button',{name:'Approve',exact:true}).count(),0);assert.equal(await h.page.getByRole('button',{name:'Reject',exact:true}).count(),0);
 }finally{await h.browser.close();}
});

test('campaign header actions follow review state: Submit, In review, Resubmit, Activate with the error, Launch; list Resume never activates pending',async()=>{
 const h=await harness();try{
  const advertiser={id:'hd-adv',org_id:'a',name:'Header client',status:'active'};h.advertisers.push(advertiser);
  const creative={id:'hd-cr',org_id:'a',advertiser_id:advertiser.id,purpose:'paid',name:'Header spot',category:'general',youtube_id:'dQw4w9WgXcQ',duration_s:15,approval_status:'pending'};h.creatives.push(creative);
  const campaign={id:'hd',org_id:'a',advertiser_id:advertiser.id,name:'Header campaign',campaign_type:'operator',screen_ids:['screen-a'],creative_ids:['hd-cr'],rate_type:'per_play',rate_value:1,committed_budget:100,accrued_spend:0,status:'pending',starts_at:'2026-01-01',ends_at:'2027-12-31'};h.campaigns.push(campaign);
  await h.page.route('**/api/campaign/hd',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({campaign,advertiser,byScreen:[{screen:h.screen,plays:0,avg:null}],byCreative:[{creative,plays:0,avg:null}],totals:{plays:0,measured:0,avg:null},plays:[],settlement_buckets:[],eligibility:[]})}));
  const open=async()=>{await h.page.reload();await h.nav('campaigns');await h.page.getByRole('heading',{name:'Campaigns',exact:true}).waitFor();await h.nav('c/hd');await h.page.getByRole('heading',{name:campaign.name,exact:true}).waitFor();};
  await open();
  await h.page.getByRole('button',{name:'Submit for review',exact:true}).click();
  await h.page.getByRole('button',{name:'In review',exact:true}).waitFor();assert.equal(await h.page.getByRole('button',{name:'In review',exact:true}).isDisabled(),true);
  await h.page.getByText(/Submitted for review.*the campaign starts when they are approved/).waitFor();
  assert.equal(h.requests.filter(r=>r.path==='/campaign/hd'&&r.body).length,0,'no generic status edit');
  creative.approval_status='rejected';campaign.review={state:'changes_needed',note:'Logo unreadable'};await open();
  await h.page.getByRole('button',{name:'Resubmit',exact:true}).waitFor();await h.page.getByRole('button',{name:'Edit',exact:true}).waitFor();await h.page.getByText(/Logo unreadable/).first().waitFor();
  creative.approval_status='approved';campaign.review={state:'approved_not_started',activation_error:'The campaign end date has passed. Change the dates, then activate again.'};await open();
  await h.page.getByText(/Approved, cannot start/).first().waitFor();
  await h.page.getByRole('button',{name:'Activate',exact:true}).click();await h.page.getByRole('button',{name:'Pause',exact:true}).waitFor();
  assert.ok(h.requests.some(r=>r.path==='/campaign/hd/activate'));
  campaign.status='pending';delete campaign.review;await open();
  await h.page.getByRole('button',{name:'Launch',exact:true}).waitFor();assert.equal(await h.page.getByRole('button',{name:'Submit for review',exact:true}).count(),0);
  // Campaign list: no 'active' choice for a pending campaign; bulk Resume refuses non-paused rows.
  await h.nav('campaigns');await h.page.getByRole('button',{name:campaign.name,exact:true}).waitFor();
  assert.equal(h.requests.filter(r=>r.path==='/campaign/hd'&&r.body?.status==='active').length,0);
 }finally{await h.browser.close();}
});

test('advertiser portal: campaigns home summary, read-only campaign dashboard, screens with period bar only, one full report',async()=>{
 const h=await harness(),errors=[];h.page.on('pageerror',e=>errors.push(e.message));try{
  const now=Date.now(),today=new Date(now+330*60000).toISOString().slice(0,10),end=new Date(now+8*86400000+330*60000).toISOString().slice(0,10);
  const advertiser={id:'portal-adv',org_id:'a',name:'Portal client',status:'active'};
  const creative={id:'portal-cr',org_id:'a',advertiser_id:'portal-adv',name:'Portal creative',duration_s:10,approval_status:'approved'};
  const campaign={id:'portal',org_id:'a',advertiser_id:'portal-adv',name:'Portal campaign',campaign_type:'operator',screen_ids:['screen-a'],creative_ids:['portal-cr'],bookings:[{screen_id:'screen-a',rotation_weight:1,rate_type:'per_play',rate_value:1}],rate_type:'per_play',rate_value:1,committed_budget:1000,accrued_spend:120,status:'active',starts_at:today,ends_at:end};
  await h.page.route('**/api/bootstrap**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...h.boot('a'),caps:[],advertisers:[advertiser],creatives:[creative],campaigns:[campaign]})}));
  // GET /campaign/:id for an advertiser carries no eligibility decisions (lib/api.ts); the dashboard must not invent them.
  await h.page.route('**/api/campaign/portal',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({campaign,advertiser,org:{id:'a',name:'Operator Alpha'},byScreen:[{screen:h.screen}],byCreative:[{creative}],plays:[],settlement_buckets:[],eligibility:null})}));
  const counters={plays_rendered:42,plays_billable:40,plays_not_rendered:1,plays_filler:0,presence_sum:10,presence_n:4,airtime_ms:420000};
  await h.page.route('**/api/metrics**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({totals:counters,byScreen:{'screen-a':counters},byCampaign:{portal:counters},byCreative:{'portal-cr':counters},daily:{[today]:counters},hourly:{},attentionProfiles:{},attention_page:{has_more:false,next_cursor:null},coverage:{started_at:'2026-01-01T00:00:00Z',complete:true},last_at:null,rows:1,has_more:false,next_cursor:null,campaignScreens:{}})}));
  await h.page.addInitScript(()=>localStorage.setItem('gc_user',JSON.stringify({id:'advertiser-user',org_id:'a',role:'advertiser_viewer',name:'Portal client',orgName:'Portal client',advertiser_id:'portal-adv'})));
  await h.page.goto(base+'/advertiser#overview');
  const summary=h.page.getByRole('region',{name:'Delivery summary',exact:true});await summary.getByRole('group',{name:'Paid plays',exact:true}).getByText('42',{exact:true}).waitFor();
  assert.equal(await h.page.getByRole('region',{name:'Delivery report',exact:true}).count(),0,'no full report on the campaigns home');
  await h.page.getByRole('columnheader',{name:'Lifetime spend / budget',exact:true}).waitFor();
  const row=h.page.getByRole('row').filter({hasText:'Portal campaign'});await row.getByText('42',{exact:true}).waitFor();await row.getByText('2.5',{exact:true}).waitFor();
  await h.page.getByRole('button',{name:'Portal campaign',exact:true}).click();await h.page.getByRole('heading',{name:'Portal campaign',exact:true}).waitFor();
  assert.deepEqual(await h.page.getByRole('tab').allInnerTexts(),['Screens','Creatives','Audience'],'no Money or Diagnostics');
  for(const name of ['Edit','Pause','Resume','Submit for review','Launch'])assert.equal(await h.page.getByRole('button',{name,exact:true}).count(),0,name);
  assert.equal(await h.page.getByRole('columnheader',{name:'Eligibility',exact:true}).count(),0);
  await h.page.getByRole('region',{name:'Campaign headline',exact:true}).getByRole('group',{name:'Plays',exact:true}).getByText('42',{exact:true}).waitFor();
  await h.page.getByRole('button',{name:'← Delivery',exact:true}).click();await h.page.waitForFunction(()=>location.hash==='#overview');
  await h.nav('screens');await h.page.getByRole('heading',{name:'Where it ran',exact:true}).waitFor();
  await h.page.getByLabel('Reporting period · IST').waitFor();assert.equal(await h.page.getByRole('region',{name:'Delivery report',exact:true}).count(),0,'period bar only');
  await h.page.getByRole('row').filter({hasText:'Alpha screen'}).getByText('42',{exact:true}).waitFor();
  await h.nav('reports');assert.equal(await h.page.getByRole('region',{name:'Delivery report',exact:true}).count(),1);
  assert.deepEqual(errors,[]);
 }finally{await h.browser.close();}
});

test('campaign table selection: Show all clears the checked campaign rows and creatives, so a new pick filters only that campaign',async()=>{
 const h=await harness();try{
  const advertiser={id:'sel-adv',org_id:'a',name:'Selection client',status:'active'};h.advertisers.push(advertiser);
  for(const k of ['A','B'])h.creatives.push({id:'sel-cr-'+k,org_id:'a',advertiser_id:advertiser.id,purpose:'paid',name:'Spot '+k,category:'general',youtube_id:'dQw4w9WgXcQ',duration_s:15,approval_status:'approved'});
  const base={org_id:'a',advertiser_id:advertiser.id,campaign_type:'operator',screen_ids:['screen-a'],rate_type:'per_play',rate_value:1,committed_budget:100,accrued_spend:0,status:'active',starts_at:'2026-01-01',ends_at:'2027-12-31',invoice_status:'not_invoiced'};
  h.campaigns.push({...base,id:'sel-a',name:'Campaign A',creative_ids:['sel-cr-A']},{...base,id:'sel-b',name:'Campaign B',creative_ids:['sel-cr-B']});
  await h.page.reload();
  await h.nav('campaigns');await h.page.getByRole('heading',{name:'Campaigns',exact:true}).waitFor();
  const panel=()=>h.page.getByRole('tabpanel');
  const box=name=>panel().getByRole('row').filter({hasText:name}).getByRole('checkbox',{name:'Select row'});
  const tab=name=>h.page.getByRole('tab',{name:new RegExp('^'+name)});
  await box('Campaign A').check();assert.equal(await tab('Campaigns').innerText(),'Campaigns · 1');
  await tab('Creatives').click();await panel().getByText('Spot A',{exact:true}).waitFor();assert.equal(await panel().getByText('Spot B',{exact:true}).count(),0);
  await box('Spot A').check();assert.equal(await tab('Creatives').innerText(),'Creatives · 1');
  await panel().getByRole('button',{name:'Show all',exact:true}).click();
  await panel().getByText('Spot B',{exact:true}).waitFor();
  assert.equal(await box('Spot A').isChecked(),true,'creative selection is independent of the campaign filter');
  await tab('Campaigns').click();
  assert.equal(await box('Campaign A').isChecked(),false,'Show all cleared the original campaign checkbox');
  assert.equal(await tab('Campaigns').innerText(),'Campaigns');
  await box('Campaign B').check();
  assert.equal(await box('Campaign A').isChecked(),false,'selecting B does not reintroduce A');
  await tab('Creatives').click();await panel().getByText('Spot B',{exact:true}).waitFor();
  assert.equal(await panel().getByText('Spot A',{exact:true}).count(),0,'the filter is B only');
  assert.equal(await tab('Creatives').innerText(),'Creatives','the creative pick outside B was dropped with its row');
  // Creative Show all clears the creative checkboxes too.
  await box('Spot B').check();await tab('Bookings').click();
  await panel().getByRole('button',{name:'Show all',exact:true}).last().click();
  await tab('Creatives').click();assert.equal(await box('Spot B').isChecked(),false,'creative Show all cleared the creative checkbox');
 }finally{await h.browser.close();}
});

test('advertiser overview: one measurement-profile picker drives both the summary and the campaigns table, never a sum',async()=>{
 const h=await harness(),errors=[];h.page.on('pageerror',e=>errors.push(e.message));try{
  const now=Date.now(),today=new Date(now+330*60000).toISOString().slice(0,10),end=new Date(now+8*86400000+330*60000).toISOString().slice(0,10);
  const advertiser={id:'portal-adv',org_id:'a',name:'Portal client',status:'active'};
  const creative={id:'portal-cr',org_id:'a',advertiser_id:'portal-adv',name:'Portal creative',duration_s:10,approval_status:'approved'};
  const campaign={id:'portal',org_id:'a',advertiser_id:'portal-adv',name:'Portal campaign',campaign_type:'operator',screen_ids:['screen-a'],creative_ids:['portal-cr'],rate_type:'per_play',rate_value:1,committed_budget:1000,accrued_spend:120,status:'active',starts_at:today,ends_at:end};
  await h.page.route('**/api/bootstrap**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...h.boot('a'),caps:[],advertisers:[advertiser],creatives:[creative],campaigns:[campaign]})}));
  const counters={plays_rendered:42,plays_billable:40,plays_not_rendered:1,plays_filler:0,presence_sum:10,presence_n:4,airtime_ms:420000};
  const att=n=>({plays:10,playing_ms:100000,body_observed_ms:80000,body_unknown_ms:20000,face_observed_ms:70000,face_unknown_ms:30000,attention_observed_ms:50000,attention_unknown_ms:50000,expression_observed_ms:40000,expression_unknown_ms:60000,presence_person_ms:30000,looking_person_ms:20000,longest_look_ms:15000,face_assessable_person_ms:25000,smile_person_ms:10000,expression_assessable_person_ms:15000,estimated_impressions:n,attentive_impressions:n,tracked_visits:n});
  const series=(profile,n)=>({profile,manifest_sha256:'m',pipeline_sha256:'p',calibration_revision:'c',asset_id:'asset',asset_sha256:'sha',config_version:1,totals:att(n),byScreen:{'screen-a':att(n)},byCampaign:{portal:att(n)},byCreative:{'portal-cr':att(n)},daily:{[today]:att(n)},hourly:{},dayHours:{}});
  await h.page.route('**/api/metrics**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({totals:counters,byScreen:{'screen-a':counters},byCampaign:{portal:counters},byCreative:{'portal-cr':counters},daily:{[today]:counters},hourly:{},attentionProfiles:{a:series('attention-v1/a',300),b:series('presence-v2/b',700)},attention_page:{has_more:false,next_cursor:null},coverage:{started_at:'2026-01-01T00:00:00Z',complete:true},last_at:null,rows:1,has_more:false,next_cursor:null,campaignScreens:{}})}));
  await h.page.addInitScript(()=>localStorage.setItem('gc_user',JSON.stringify({id:'advertiser-user',org_id:'a',role:'advertiser_viewer',name:'Portal client',orgName:'Portal client',advertiser_id:'portal-adv'})));
  await h.page.goto(base+'/advertiser#overview');
  const summary=h.page.getByRole('region',{name:'Delivery summary',exact:true}),impressions=summary.getByRole('group',{name:'Est. impressions',exact:true});
  const row=h.page.getByRole('row').filter({hasText:'Portal campaign'});
  await impressions.getByText('300',{exact:true}).waitFor();await row.getByText('300',{exact:true}).waitFor();
  const pickers=h.page.getByRole('combobox',{name:/measurement profile/i});
  assert.equal(await pickers.count(),1,'one picker for summary and table');
  await pickers.selectOption('b');
  await impressions.getByText('700',{exact:true}).waitFor();await row.getByText('700',{exact:true}).waitFor();
  assert.equal(await row.getByText('300',{exact:true}).count(),0,'the table follows the same profile');
  assert.equal(await h.page.getByText('1,000',{exact:true}).count(),0,'profiles are never summed');
  assert.deepEqual(errors,[]);
 }finally{await h.browser.close();}
});
