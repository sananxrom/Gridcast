const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),ts=require('typescript');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const executablePath=[process.env.GC_TEST_BROWSER_PATH,chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium'].filter(Boolean).find(fs.existsSync);
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const scripts=Object.fromEntries(['lib/readiness.ts','components/views/screen-diagnostics.tsx','components/views/screen-detail.tsx'].map(f=>[f,compile(f)]));
const fixture=()=>({screen:{id:'screen1',name:'Test screen',status:'active',has_camera:false,advertiser_slots:10,slot_duration_s:10,loop_length_s:120,tags:{}},status:{state:'live'},device:{id:'dev1',status:'active',vision:{camera_state:'unavailable',model_state:'not_loaded',last_sample_at:null,reported_at:new Date().toISOString()}},config:{},stats:{liveCampaigns:0,playsToday:0,plays:0,avg:null,measured:0},campaigns:[],recent:[],caps:['screens','sales'],readiness:{ready:false,code:'no_campaign',message:'No campaign is assigned to this screen.',warnings:[]},diagnostic_assignments:[],diagnostic_results:[]});
async function harness(){
 const records=[],data=fixture();
 const code=`const scripts=${JSON.stringify(scripts)},cache={};
 const el=tag=>({children,...props})=>React.createElement(tag,props,children);
 const plain=el('div');
 function load(file){if(cache[file])return cache[file].exports;const m=cache[file]={exports:{}};new Function('require','module','exports',scripts[file])(req,m,m.exports);return m.exports;}
 function req(n){if(n==='react')return React;if(n==='@/lib/readiness')return load('lib/readiness.ts');if(n==='./screen-diagnostics')return load('components/views/screen-diagnostics.tsx');
 if(n==='@/lib/client')return {api:async(p,b)=>{const r=await fetch('/api'+p,{method:b?'POST':'GET',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});if(!r.ok)throw Error('Request failed');return r.json();}};
 if(n==='@/lib/utils')return {inr:v=>'INR '+v,fmtDate:v=>v,cn:(...v)=>v.join(' ')};
 if(n==='@/components/ui/button')return {Button:({variant,size,...p})=>React.createElement('button',p)};
 if(n==='@/components/ui/input')return {Input:el('input'),Label:el('label'),Field:({label,children})=>React.createElement('label',null,label,children)};
 if(n==='@/components/ui/app-shell')return {PageHead:({title,sub,actions})=>React.createElement('header',null,title,sub,actions),SectionHead:plain};
 if(n==='@/components/ui/card')return {Card:plain};if(n==='@/components/ui/table')return {DataTable:()=>null};
 if(n==='@/components/ui/stat')return {Stat:()=>null,Progress:()=>null};if(n==='@/components/ui/badge')return {Badge:plain};if(n==='@/components/ui/loader')return {Skeleton:plain};
 if(n==='./bits')return {StatusBadge:()=>null,Thumb:()=>null,Empty:plain,ScreenPhoto:()=>null};
 if(n==='./config-views')return {ScreenConfig:()=>null};if(n==='./screen-onboarding')return {PairingCode:()=>null};if(n==='@/components/views/history-notice')return {HistoryNotice:()=>null};throw Error(n);}
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(load('components/views/screen-detail.tsx').ScreenDetail,{id:'screen1',onGo:()=>{},onChanged:()=>{}}));`;
 const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/api/')){let body='';for await(const part of req)body+=part;const b=body?JSON.parse(body):undefined;records.push({path:req.url,body:b});if(req.method==='POST'&&req.url==='/api/screen/screen1')Object.assign(data.screen,b);if(req.method==='POST'&&req.url==='/api/screen/screen1/test')data.diagnostic_assignments=[{id:'test1',status:'pending',expires_at:new Date(Date.now()+600000).toISOString()}];res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;}
  if(req.url==='/react.js'||req.url==='/react-dom.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(root,req.url==='/react.js'?'node_modules/react/umd/react.development.js':'node_modules/react-dom/umd/react-dom.development.js')));return;}
  if(req.url==='/test.js'){res.setHeader('Content-Type','application/javascript');res.end(code);return;}
  res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/test.js"></script>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await chromium.launch({executablePath,headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.getByText('Screen readiness',{exact:true}).waitFor();return {page,data,records,errors,cleanup:async()=>{await browser.close();await new Promise(r=>server.close(r));}};}catch(e){await browser?.close();await new Promise(r=>server.close(r));throw e;}
}
test('screen renders empty readiness and unreported samples, saves camera and requests independent test',{skip:!executablePath},async()=>{
 const h=await harness();try{
  assert.equal(await h.page.getByText('No campaign is assigned to this screen.',{exact:true}).count(),1);
  assert.match(await h.page.locator('[aria-label="Screen test"]').innerText(),/Unavailable/);
  assert.match(await h.page.locator('[aria-label="Screen test"]').innerText(),/Not reported/);
  await h.page.getByRole('button',{name:'Edit screen',exact:true}).click();
  await h.page.getByLabel('Camera available for presence measurement').check();
  await h.page.getByRole('button',{name:'Save screen',exact:true}).click();
  await h.page.getByText('Camera: enabled for this screen',{exact:true}).waitFor();
  assert.equal(h.records.find(r=>r.path==='/api/screen/screen1'&&r.body)?.body.has_camera,true);
  await h.page.getByRole('button',{name:'Run screen test',exact:true}).click();
  await h.page.getByRole('button',{name:'Cancel test',exact:true}).waitFor();
  assert.ok(h.records.some(r=>r.path==='/api/screen/screen1/test'));
  assert.ok(!h.records.some(r=>/advertiser|campaign|\/play$/.test(r.path)));
  assert.deepEqual(h.errors,[]);
 }finally{await h.cleanup();}
});
