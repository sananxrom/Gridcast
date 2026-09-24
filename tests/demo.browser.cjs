const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const videos=require('../lib/demo-videos.json');
const base=process.env.GC_UI_TEST_URL||'http://127.0.0.1:4012';
const executablePath=[chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(fs.existsSync);
async function harness({role='platform_admin',fail=false,mismatch=false}={}) {
 const browser=await chromium.launch({executablePath,headless:true}),page=await browser.newPage();
 const rows={orgs:[{id:'gridcast',type:'gridcast',status:'active'}],screens:[],advertisers:[],creatives:[],campaigns:[]},posts=[];
 await page.addInitScript(({role,fail,mismatch,videos})=>{
  localStorage.setItem('gc_user',JSON.stringify({role}));localStorage.setItem('gc_token','synthetic-only');
  window.YT={Player:class {
   constructor(host,options){this.video=videos.find(v=>v.youtube_id===options.videoId);this.options=options;this.timer=setTimeout(()=>options.events.onReady({target:this}),5);}
   mute(){} destroy(){clearTimeout(this.timer)}
   getVideoData(){return{video_id:this.video.youtube_id}} getDuration(){return this.video.duration_s+(mismatch?5:0)}
   playVideo(){if(fail){this.options.events.onError({target:this,data:150});return;}this.options.events.onStateChange({target:this,data:1});this.timer=setTimeout(()=>this.options.events.onStateChange({target:this,data:0}),10);}
  }};
 },{role,fail,mismatch,videos});
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname.slice(4);let result;
  if(req.method()==='GET')result={items:rows[url.searchParams.get('entity')]||[],has_more:false};
  else {const body=req.postDataJSON();posts.push({path,body});
   if(path.endsWith('/approve')){result=rows.creatives.find(x=>x.id===path.split('/')[2]);result.approval_status=body.status;}
   else{const entity={'/org':'orgs','/screens':'screens','/advertiser':'advertisers','/creative':'creatives','/campaign':'campaigns'}[path];assert.ok(entity);const row={id:entity+rows[entity].length,...body};rows[entity].push(row);result=entity==='screens'?{screen:row}:row;}
  }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.goto(base+'/admin/demo');return{browser,page,rows,posts};
}
test('demo preview gates import, preserves video metadata, and a second import makes no writes',async()=>{
 const h=await harness();try{
  const button=h.page.getByRole('button',{name:'Create or resume demo'});assert.equal(await button.isEnabled(),false);
  await h.page.getByRole('button',{name:'Check all nine videos'}).click();await h.page.getByText('All nine videos completed embedded playback.',{exact:false}).waitFor();
  assert.equal(h.posts.length,0);await button.click();await h.page.getByRole('heading',{name:'Demo ready',exact:true}).waitFor();
  assert.equal(h.rows.creatives.length,9);assert.equal(h.rows.campaigns.length,7);assert.equal(h.rows.screens.length,12);
  for(const v of videos){const c=h.rows.creatives.find(c=>c.youtube_id===v.youtube_id);assert.equal(c.duration_s,v.duration_s);assert.equal(c.approval_status,'approved');}
  const before=h.posts.length;await button.click();await h.page.getByText('Added this run: 0 operators, 0 screens, 0 advertisers, 0 creatives and 0 campaigns.',{exact:true}).waitFor();assert.equal(h.posts.length,before);
 }finally{await h.browser.close()}
});
for(const opts of [{fail:true},{mismatch:true}])test('failed or mismatched playback cannot enable import '+JSON.stringify(opts),async()=>{
 const h=await harness(opts);try{await h.page.getByRole('button',{name:'Check all nine videos'}).click();await h.page.getByRole('alert').waitFor();assert.equal(await h.page.getByRole('button',{name:'Create or resume demo'}).isEnabled(),false);assert.equal(h.posts.length,0)}finally{await h.browser.close()}
});
test('non-admin demo visitor is redirected without API writes',async()=>{
 const h=await harness({role:'installer'});try{await h.page.waitForURL(base+'/');assert.equal(h.posts.length,0)}finally{await h.browser.close()}
});
