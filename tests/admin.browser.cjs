const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const base=process.env.GC_UI_TEST_URL||'http://127.0.0.1:4012';
const executablePath=[process.env.GC_TEST_BROWSER_PATH,chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(fs.existsSync);
async function harness(role='platform_admin') {
 const browser=await chromium.launch({executablePath,headless:true}); const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const user={id:'admin',org_id:'gridcast',role,name:'Fixture Admin',orgName:'Gridcast'};
 const orgs=[{id:'gridcast',name:'Gridcast',type:'gridcast',status:'active'},{id:'a',name:'Operator Alpha',type:'operator',status:'active'},{id:'b',name:'Operator Beta',type:'operator',status:'active'}];
 const advertisers=[{id:'archived-a',org_id:'a',name:'Archived client',status:'archived'}],creatives=[],campaigns=[],requests=[];
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
  else if(path==='/creative'&&body){result={id:'cr-'+creatives.length,approval_status:'pending',...body};creatives.push(result);}
  else if(path.startsWith('/creative/')&&body){result=creatives.find(c=>c.id===path.split('/')[2]);if(path.endsWith('/approve'))result.approval_status=body.status;else Object.assign(result,body);}
  else if(path==='/assets/upload'){result={asset:{duration_s:10,width:1280,height:720}};}
  else if(path==='/campaign'&&body){result={id:'campaign-'+campaigns.length,accrued_spend:0,invoice_status:'not_invoiced',...body};campaigns.push(result);}
  else if(path==='/invite')result={user:{email:body.email},temp_password:'local-test-only'};
  else if(path==='/config/schema')result={groups:[],settings:[],locked:[],priced:[]};
  else if(path==='/config')result=[];
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.goto(base+'/admin?org=a#advertisers');await page.getByRole('button',{name:'Add advertiser',exact:true}).waitFor();
 const nav=async hash=>{await page.evaluate(h=>location.hash=h,hash);};
 const field=(label)=>page.locator('label').filter({hasText:new RegExp('^'+label+'$')}).locator('..').locator('input,select').first();
 return {browser,page,requests,advertisers,creatives,campaigns,nav,field,boot,screen,orgs};
}
test('master admin creates client, uploads and approves creative, books campaign in selected org',async()=>{
 const h=await harness(),{page,nav,field,requests}=h;
 try {
  await page.getByRole('button',{name:'Add advertiser',exact:true}).click();await page.getByLabel('Advertiser name',{exact:true}).fill('Alpha Client');await page.getByLabel('Advertiser email',{exact:true}).fill('fixture@example.invalid');await page.getByRole('button',{name:'Save advertiser'}).click();await page.getByRole('heading',{name:'Alpha Client',exact:true}).waitFor();
  assert.equal(requests.find(r=>r.path==='/advertiser').body.org_id,'a');await page.screenshot({path:'/tmp/gridcast-admin-advertiser.png',fullPage:true});
  await nav('creatives');await field('Name').fill('Alpha Video');await page.getByLabel('Creative advertiser').selectOption('adv-1');await page.getByRole('button',{name:'Add creative',exact:true}).click();await page.getByRole('button',{name:'Upload video',exact:true}).click();await page.getByLabel('MP4 or WebM video').setInputFiles({name:'fixture.mp4',mimeType:'video/mp4',buffer:Buffer.from('synthetic mocked upload')});await page.getByRole('button',{name:'Upload selected video'}).click();await page.getByRole('status').waitFor();assert.match(requests.find(r=>r.path==='/assets/upload').body.multipart,/cr-0/);await page.screenshot({path:'/tmp/gridcast-admin-creative.png',fullPage:true});
  assert.equal(requests.find(r=>r.path==='/creative').body.org_id,'a');await page.getByRole('button',{name:'Approve',exact:true}).click();
  await nav('new');await field('Campaign name').fill('Alpha Campaign');await page.getByLabel('Campaign advertiser').selectOption('adv-1');await page.getByText('Alpha screen',{exact:true}).locator('..').locator('..').locator('input[type=checkbox]').check();await page.getByText('Alpha Video',{exact:false}).locator('..').locator('input[type=checkbox]').check();await field('Initial status').selectOption('active');await page.getByRole('button',{name:'Create campaign',exact:true}).click();await page.waitForFunction(()=>location.hash.startsWith('#c/'));
  const payload=requests.find(r=>r.path==='/campaign').body;assert.equal(payload.org_id,'a');assert.equal(payload.advertiser_id,'adv-1');assert.deepEqual(payload.screen_ids,['screen-a']);assert.equal(payload.status,'active');
 } finally {await h.browser.close();}
});
test('organisation switch clears drafts, preserves real admin identity, and advertiser invite is scoped',async()=>{
 const h=await harness(),{page,nav,field,requests}=h;
 try {
  h.advertisers.push({id:'adv-a',org_id:'a',name:'Alpha Client',status:'active'});await page.reload();await page.getByRole('button',{name:'Add advertiser',exact:true}).waitFor();await nav('new');await field('Campaign name').fill('Must clear');
  await page.getByText('Operator Alpha',{exact:true}).first().click();await page.getByText('Operator Beta',{exact:true}).click();await page.waitForURL(/org=b#campaigns/);await nav('new');assert.equal(await field('Campaign name').inputValue(),'');assert.equal(await page.getByLabel('Campaign advertiser').locator('option').count(),1);
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


test('platform network builder keeps Gridcast ownership and books released cross-org screens per play',async()=>{
 const h=await harness();try{
  h.advertisers.push({id:'network-adv',org_id:'gridcast',name:'Network Client',status:'active'});
  h.creatives.push({id:'network-cr',org_id:'gridcast',advertiser_id:'network-adv',name:'Network Video',duration_s:10,approval_status:'approved'});
  const beta={...h.screen,id:'screen-b',org_id:'b',name:'Beta screen',network_available:true,network_slots:6};
  await h.page.route('**/api/network-inventory**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({screens:[{...h.screen,network_available:true,network_slots:6},beta,{...beta,id:'closed',name:'Closed to network',network_available:false}],orgs:h.orgs,campaigns:[],creatives:h.creatives})}));
  await h.page.goto(base+'/admin?org=gridcast#new');await h.page.getByLabel('Campaign type',{exact:true}).selectOption('network');
  await h.page.getByText('Beta screen',{exact:true}).waitFor();assert.equal(await h.page.getByText('Closed to network',{exact:true}).count(),0);
  assert.equal(await h.page.getByLabel('Campaign rate type').isDisabled(),true);assert.equal(await h.page.getByLabel('Campaign rate type').inputValue(),'per_play');
  await h.field('Campaign name').fill('Across the network');await h.page.getByLabel('Campaign advertiser').selectOption('network-adv');
  for(const name of ['Alpha screen','Beta screen'])await h.page.getByText(name,{exact:true}).locator('..').locator('..').locator('input[type=checkbox]').check();
  await h.page.getByText('Network Video',{exact:false}).locator('..').locator('input[type=checkbox]').check();
  await h.page.getByRole('button',{name:'Create campaign',exact:true}).click();await h.page.waitForFunction(()=>location.hash.startsWith('#c/'));
  const payload=h.requests.find(r=>r.path==='/campaign').body;assert.equal(payload.campaign_type,'network');assert.equal(payload.org_id,'gridcast');assert.equal(payload.advertiser_id,'network-adv');assert.equal(payload.rate_type,'per_play');assert.deepEqual(payload.bookings,[{screen_id:'screen-a',slots_per_loop:1},{screen_id:'screen-b',slots_per_loop:1}]);
 }finally{await h.browser.close();}
});

test('advertiser editor preserves and updates venue, screen and tag exclusions',async()=>{
 const h=await harness();try{
  h.advertisers.push({id:'adv-exclusions',org_id:'a',name:'Restricted Client',status:'active',exclusions:{venue_types:['gym'],screens:[],tag_rules:[{chain:'local',floor:'ground'}]}});
  await h.page.reload();await h.page.getByRole('button',{name:'Restricted Client',exact:true}).click();await h.page.getByRole('button',{name:'Edit advertiser',exact:true}).click();
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
  assert.equal(await h.page.getByRole('button',{name:'live',exact:true}).count(),0);assert.equal(await h.page.getByText('Managed by Gridcast',{exact:true}).count(),1);
  await h.page.getByRole('button',{name:campaign.name,exact:true}).click();await h.page.getByRole('heading',{name:campaign.name,exact:true}).waitFor();
  assert.equal(await h.page.getByRole('button',{name:'Edit',exact:true}).count(),0);assert.equal(await h.page.getByRole('button',{name:'Pause',exact:true}).count(),0);await h.page.getByText('₹0.63',{exact:true}).waitFor();
  await h.nav('settlement');await h.page.getByRole('heading',{name:'Settlement',exact:true}).waitFor();await h.page.getByText('₹0.93',{exact:true}).waitFor();await h.page.getByText('₹0.09',{exact:true}).waitFor();await h.page.getByText('₹0.21',{exact:true}).waitFor();await h.page.getByText('₹0.63',{exact:true}).waitFor();
  assert.equal(h.requests.filter(r=>r.path==='/campaign/network'&&r.body).length,0);
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
  await h.page.getByText('Beta available',{exact:false}).first().waitFor();assert.equal(await h.page.getByLabel('Appearances per loop for Alpha screen').inputValue(),'2');
  await h.page.getByText('Beta available',{exact:false}).first().locator('..').locator('input[type=checkbox]').check();
  await h.page.getByRole('button',{name:'Save changes',exact:true}).click();await h.page.getByRole('button',{name:'Edit',exact:true}).waitFor();
  assert.equal(changes.length,1);assert.deepEqual(changes[0].bookings,[{screen_id:'screen-a',slots_per_loop:2},{screen_id:'screen-b',slots_per_loop:1}]);assert.equal(changes[0].rate_type,'per_play');
 }finally{await h.browser.close();}
});
