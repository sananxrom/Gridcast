const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),ts=require('typescript');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const executablePath=[process.env.GC_TEST_BROWSER_PATH,chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium'].filter(Boolean).find(fs.existsSync);
const source=ts.transpileModule(fs.readFileSync(path.join(root,'components/views/screen-maintenance.tsx'),'utf8'),{fileName:'screen-maintenance.tsx',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
async function harness(options={}){
 const records=[],grants=[],code='TEST-ONLY-MAINTENANCE-CODE';
 const devices=options.empty?[]:[{id:'current-device',status:'active',paired_at:'2026-09-20T10:00:00Z'},{id:'historical-device',status:'revoked',paired_at:'2026-09-01T10:00:00Z'}];
 const script=`const exports={};const el=tag=>({children,...props})=>React.createElement(tag,props,children);function require(n){if(n==='react')return React;if(n==='@/lib/client')return {api:async(p,b)=>{const r=await fetch('/api'+p,{method:b?'POST':'GET',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}};if(n==='@/components/ui/button')return {Button:({variant,size,...p})=>React.createElement('button',p)};if(n==='@/components/ui/card')return {Card:el('div')};if(n==='@/components/ui/input')return {Select:el('select')};throw Error(n);}${source};const view=ReactDOM.createRoot(document.getElementById('root'));window.changeScreen=id=>view.render(React.createElement(exports.ScreenMaintenance,{key:id,screenId:id}));window.changeScreen('screen1');`;
 const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/api/')){let raw='';for await(const p of req)raw+=p;const body=raw?JSON.parse(raw):undefined;records.push({url:req.url,method:req.method,body});res.setHeader('Content-Type','application/json');
   if(options.denied){res.statusCode=403;res.end(JSON.stringify({error:'You do not have screen management permission.'}));return;}
   if(req.method==='POST'&&req.url.endsWith('/revoke')){if(options.revokeFailure){res.statusCode=503;res.end(JSON.stringify({error:'Connection interrupted.'}));return;}grants.forEach(g=>g.status='revoked');res.end('{"ok":true}');return;}
   if(req.method==='POST'){
    const grant={id:'grant'+(grants.length+1),device_id:body.device_id,screen_id:'screen1',org_id:'org1',status:'pending',expires_at:new Date(Date.now()+(options.ttl||600000)).toISOString()};grants.push(grant);
    if(options.delayIssue)await new Promise(r=>setTimeout(r,options.delayIssue));
    if(options.incomplete){res.end(JSON.stringify({grant}));return;}
    res.end(JSON.stringify({grant,code}));return;
   }
   res.end(JSON.stringify({devices:req.url.includes('/screen2/')?[]:devices,grants:req.url.includes('/screen2/')?[]:grants}));return;
  }
  if(req.url==='/react.js'||req.url==='/react-dom.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(root,req.url==='/react.js'?'node_modules/react/umd/react.development.js':'node_modules/react-dom/umd/react-dom.development.js')));return;}
  if(req.url==='/test.js'){res.setHeader('Content-Type','application/javascript');res.end(script);return;}
  res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/test.js"></script>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await chromium.launch({executablePath,headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('heading',{name:'Saved records and player maintenance'}).waitFor();return {page,records,grants,code,errors,cleanup:async()=>{await browser.close();await new Promise(r=>server.close(r));}};}catch(e){await browser?.close();await new Promise(r=>server.close(r));throw e;}
}
const opts={skip:!executablePath};
test('dashboard requires explicit identity, issues historical recovery code without persisting it, and revokes it',opts,async()=>{
 const h=await harness();try{
  const button=h.page.getByRole('button',{name:'Create maintenance code'});await button.waitFor();assert.equal(await button.isDisabled(),true);
  await h.page.getByLabel('Device identity to authorize').selectOption('historical-device');
  await h.page.getByText(/Historical recovery only/).waitFor();await button.click();
  await h.page.getByLabel('Maintenance code',{exact:true}).waitFor();
  assert.equal(h.records.find(r=>r.method==='POST').body.device_id,'historical-device');
  assert.match(await h.page.getByLabel('Maintenance code',{exact:true}).innerText(),/tools close at this same deadline/);
  const stored=await h.page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage},url:location.href}));
  assert.deepEqual(stored.local,{});assert.deepEqual(stored.session,{});assert.ok(!stored.url.includes(h.code));
  assert.equal(await h.page.getByRole('link',{name:'/player/maintenance'}).getAttribute('href'),'/player/maintenance');
  await h.page.getByRole('button',{name:'Revoke maintenance access for historical-device'}).click();await h.page.getByText(/historical-device · revoked/).waitFor();
  assert.equal(await h.page.getByLabel('Maintenance code',{exact:true}).count(),0);assert.equal(h.grants[0].status,'revoked');assert.deepEqual(h.errors,[]);
 }finally{await h.cleanup();}
});
test('permission failures expose no issuance controls and offer checked retry',opts,async()=>{
 const h=await harness({denied:true});try{await h.page.getByRole('alert').waitFor();assert.match(await h.page.getByRole('alert').innerText(),/permission/);assert.equal(await h.page.getByRole('button',{name:'Create maintenance code'}).count(),0);await h.page.getByRole('button',{name:'Retry maintenance access'}).click();assert.equal(h.records.some(r=>r.method==='POST'),false);assert.deepEqual(h.errors,[]);}finally{await h.cleanup();}
});
test('screen without device identities does not invent a default grant target',opts,async()=>{
 const h=await harness({empty:true});try{await h.page.getByText('No device identities are available for this screen yet.').waitFor();assert.equal(await h.page.getByRole('button',{name:'Create maintenance code'}).count(),0);assert.deepEqual(h.errors,[]);}finally{await h.cleanup();}
});
test('expiry hides code and forbids revocation of already expired grants',opts,async()=>{
 const h=await harness({ttl:1500});try{await h.page.getByLabel('Device identity to authorize').selectOption('current-device');await h.page.getByRole('button',{name:'Create maintenance code'}).click();await h.page.getByLabel('Maintenance code',{exact:true}).waitFor();await h.page.getByText(/current-device · Expired/).waitFor();assert.equal(await h.page.getByLabel('Maintenance code',{exact:true}).count(),0);assert.equal(await h.page.getByRole('button',{name:/Revoke maintenance access/}).count(),0);assert.deepEqual(h.errors,[]);}finally{await h.cleanup();}
});
test('incomplete issuance response reports uncertain grant state without showing an invalid code',opts,async()=>{
 const h=await harness({incomplete:true});try{await h.page.getByLabel('Device identity to authorize').selectOption('current-device');await h.page.getByRole('button',{name:'Create maintenance code'}).click();await h.page.getByRole('alert').waitFor();assert.match(await h.page.getByRole('alert').innerText(),/Access may have been created/);assert.equal(await h.page.getByLabel('Maintenance code',{exact:true}).count(),0);await h.page.getByRole('button',{name:'Retry maintenance access'}).click();await h.page.getByRole('button',{name:'Revoke maintenance access for current-device'}).waitFor();assert.deepEqual(h.errors,[]);}finally{await h.cleanup();}
});
test('late issuance from previous screen cannot expose its code on the new screen',opts,async()=>{
 const h=await harness({delayIssue:500});try{await h.page.getByLabel('Device identity to authorize').selectOption('historical-device');await h.page.getByRole('button',{name:'Create maintenance code'}).click();await h.page.evaluate(()=>window.changeScreen('screen2'));await h.page.getByText('No device identities are available for this screen yet.').waitFor();await h.page.waitForTimeout(650);assert.equal(await h.page.getByLabel('Maintenance code',{exact:true}).count(),0);assert.ok(!(await h.page.locator('body').innerText()).includes(h.code));assert.deepEqual(h.errors,[]);}finally{await h.cleanup();}
});

test('failed revocation hides the secret without claiming that access has closed',opts,async()=>{
 const h=await harness({revokeFailure:true});try{await h.page.getByLabel('Device identity to authorize').selectOption('current-device');await h.page.getByRole('button',{name:'Create maintenance code'}).click();await h.page.getByLabel('Maintenance code',{exact:true}).waitFor();await h.page.getByRole('button',{name:'Revoke maintenance access for current-device'}).click();await h.page.getByRole('alert').waitFor();assert.match(await h.page.getByRole('alert').innerText(),/Revocation could not be confirmed/);assert.equal(await h.page.getByLabel('Maintenance code',{exact:true}).count(),0);assert.equal(h.grants[0].status,'pending');await h.page.getByRole('button',{name:'Retry maintenance access'}).click();await h.page.getByRole('button',{name:'Revoke maintenance access for current-device'}).waitFor();assert.deepEqual(h.errors,[]);}finally{await h.cleanup();}
});
