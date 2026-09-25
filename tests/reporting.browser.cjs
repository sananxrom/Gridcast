const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const base=process.env.GC_UI_TEST_URL||'http://127.0.0.1:4012';
const executablePath=[process.env.GC_TEST_BROWSER_PATH,chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(fs.existsSync);
const zero=()=>({plays_rendered:0,plays_billable:0,plays_not_rendered:0,plays_filler:0,presence_sum:0,presence_n:0,airtime_ms:0});
async function fixture(role='platform_admin',withCoverage=true){
 const browser=await chromium.launch({executablePath,headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const user={id:'tester',org_id:'org1',role,name:'Reporting test',orgName:'Test org',advertiser_id:'ad1'};
 const screen={id:'screen1',org_id:'org1',name:'Test screen',status:'active',venue_type:'cafe',has_camera:true,advertiser_slots:5,slot_price_month:10,monthly_value:50,_status:{state:'live',label:'Live'}};
 const org={id:'org1',name:'Test org',type:'gridcast'};
 const date=new Date(Date.now()+330*60000).toISOString().slice(0,10),errors=[],calls=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(user=>{localStorage.setItem('gc_user',JSON.stringify(user));localStorage.setItem('gc_token','local-report-test');},user);
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let result={};
  if(url.pathname==='/api/bootstrap') result={org,orgs:[org],screens:[screen],campaigns:[],advertisers:[],creatives:[],groups:[],devices:[],plays:[],presence:[],settings:{},configs:[],settlement_buckets:[],caps:role==='platform_admin'?['platform','sales','money','screens','team','org']:[]};
  else if(url.pathname==='/api/directory')result={items:[org],has_more:false,next_cursor:null};
  else if(url.pathname==='/api/metrics'){
   calls.push(url);const second=!!url.searchParams.get('after');
   const counters=withCoverage?{...zero(),plays_rendered:second?100:20,plays_billable:second?80:20,presence_n:second?40:10,presence_sum:second?120:20}:zero();
   result={totals:counters,byScreen:withCoverage?{screen1:counters}:{},byCampaign:{},byCreative:{},daily:withCoverage?{[date]:counters}:{},hourly:withCoverage?{'12':counters}:{},coverage:{started_at:withCoverage?date+'T01:00:00Z':null,complete:false},last_at:withCoverage?date+'T06:30:00Z':null,rows:withCoverage?1:0,has_more:withCoverage&&!second,next_cursor:withCoverage&&!second?'page2':null};
  }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.goto(base+(role==='advertiser_viewer'?'/advertiser':'/admin'));
 const report=page.getByRole('region',{name:'Delivery report',exact:true});await report.getByRole('button',{name:'Export CSV',exact:true}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('[aria-label="Delivery report"]').getAttribute('aria-busy')||document.querySelector('[aria-label="Delivery report"]').getAttribute('aria-busy')==='false');
 return{browser,page,report,date,errors,calls};
}
test('report renders all pages, weighted presence, keyboard explanation and honest full-range CSV',async()=>{
 const f=await fixture();try{
  assert.equal(f.calls.length,2);assert.match(await f.report.innerText(),/120/);assert.match(await f.report.innerText(),/2\.8/);assert.match(await f.report.innerText(),/Partial period/);
  const info=f.report.getByRole('button',{name:'What "Average people present" means'}).first();await info.focus();await info.press('Enter');
  await f.page.getByText('Where it comes from.',{exact:true}).waitFor();assert.match(await f.page.getByRole('dialog').innerText(),/never treated as zero/);await f.page.keyboard.press('Escape');
  const downloadPromise=f.page.waitForEvent('download');await f.report.getByRole('button',{name:'Export CSV',exact:true}).click();const download=await downloadPromise;
  const content=fs.readFileSync(await download.path(),'utf8');assert.match(content,/measured_paid_plays/);assert.match(content,/"120","100"/);assert.match(content,/"50","2.8"/);assert.match(content,/"false"/);
  await f.report.getByLabel('Reporting period · IST').selectOption('today');await f.page.waitForTimeout(150);assert.ok(f.calls.at(-1).searchParams.get('from')===f.date);
  await f.page.getByText('All organisations',{exact:true}).first().click();
  await f.page.getByText('Test org',{exact:true}).click();
  await f.report.getByRole('button',{name:'Export CSV',exact:true}).waitFor();
  await f.page.waitForFunction(()=>document.querySelector('[aria-label="Delivery report"]')?.getAttribute('aria-busy')==='false');
  assert.equal(await f.report.getByLabel('Reporting period · IST').inputValue(),'today');
  assert.ok(f.calls.at(-1).searchParams.get('from')===f.date);
  assert.equal(f.calls.at(-1).searchParams.get('org'),'org1');
  await f.page.screenshot({path:'/tmp/gridcast-reporting-desktop.png',fullPage:true});
  await f.page.setViewportSize({width:390,height:844});assert.ok(await f.report.getByRole('button',{name:'Export CSV',exact:true}).isVisible());assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});
test('advertiser has no invented zero totals before summary collection starts',async()=>{
 const f=await fixture('advertiser_viewer',false);try{
  assert.match(await f.report.innerText(),/collection has not started/);
  const card=f.report.getByText('Paid delivered',{exact:true}).locator('..').locator('..');assert.match(await card.innerText(),/—/);
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});
