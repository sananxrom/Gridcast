const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),ts=require('typescript');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const executablePath=[process.env.GC_TEST_BROWSER_PATH,chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium'].filter(Boolean).find(fs.existsSync);
const modules=Object.fromEntries(['player-maintenance','player-evidence-lock','player-queue','player-diagnostics'].map(name=>[name,ts.transpileModule(fs.readFileSync(path.join(root,'lib',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText]));
const check=(name,fn)=>test(name,{skip:!executablePath},fn);
async function fixture(t){
 const records=[],settings={deny:'',wrongScope:false,incomplete:null,pairStatus:200,pairIncomplete:false},grant={id:'grant-A',device_id:'deviceA',screen_id:'screenA',org_id:'orgA',expires_at:new Date(Date.now()+600000).toISOString()};
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/player-sw.js'){res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store','Service-Worker-Allowed':'/player'});res.end(fs.readFileSync(path.join(root,'public/player-sw.js'),'utf8'));return;}
  if(req.url.startsWith('/api/')){
   let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):{};records.push({path:req.url,body,authorization:req.headers.authorization});res.setHeader('Content-Type','application/json');
   if(req.url==='/api/maintenance/redeem'){const result={grant,token:'test-maintenance-capability',server_time:new Date().toISOString()};res.end(JSON.stringify(settings.incomplete===null?result:settings.incomplete));return;}
   if(req.url.startsWith('/api/maintenance/')){if(settings.deny){res.statusCode=403;res.end(JSON.stringify({error:settings.deny}));return;}res.end(JSON.stringify({grant:settings.wrongScope?{...grant,device_id:'deviceB'}:grant,server_time:new Date().toISOString()}));return;}
   if(req.url==='/api/pair'){res.statusCode=settings.pairStatus;res.end(JSON.stringify(settings.pairStatus!==200?{error:'Pairing code was rejected.'}:settings.pairIncomplete?{token:'test-next-token'}:{token:'test-next-token',device:{id:'deviceNEW',screen_id:'screenNEW'},screen:{id:'screenNEW'}}));return;}
   if(req.url==='/api/play'||req.url==='/api/diagnostic/result'){res.end('{"ok":true}');return;}
   res.statusCode=404;res.end('{"error":"Unknown fixture route"}');return;
  }
  res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Local player maintenance fixture</title>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({executablePath,headless:true});const context=await browser.newContext();
  const base='http://127.0.0.1:'+server.address().port;
  const load=async(p,url='/player/maintenance')=>{await p.goto(base+url);await p.evaluate(modules=>{const cache={};function load(name){name=name.replace(/^\.\//,'');if(cache[name])return cache[name].exports;const module=cache[name]={exports:{}};new Function('require','module','exports',modules[name])(load,module,module.exports);return module.exports;}window.m=load('player-maintenance');window.q=load('player-queue');window.d=load('player-diagnostics');window.l=load('player-evidence-lock');},modules);};
  const page=await context.newPage();await load(page);t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  return {page,context,records,settings,grant,load};
 }catch(error){await browser?.close();await new Promise(resolve=>server.close(resolve));throw error;}
}
async function seed(page){return page.evaluate(async()=>{
 await q.enqueuePlay('deviceA',{play_uid:'a-blocked',measured:false,presence:{avg_persons:null},original:'retain blocked A'});
 await q.flushPlays('deviceA',async()=>({status:409,error:'Original rejection reason'}));
 await q.enqueuePlay('deviceA',{play_uid:'a-pending',measured:true,presence:{avg_persons:2},original:'retain pending A'});
 await q.enqueuePlay('deviceB',{play_uid:'b-private',original:'other organization evidence'});
 await d.reserveDiagnostic('deviceA','diagnostic-blocked-A');await d.saveDiagnostic('deviceA',{run_uid:'diagnostic-blocked-A',avg_persons:null,measured:false,detail:'full blocked diagnostic'});
 await d.flushDiagnostic('deviceA',async()=>({status:409,value:{error:'Original diagnostic rejection'}}));
 await d.reserveDiagnostic('deviceA','diagnostic-pending-A');await d.saveDiagnostic('deviceA',{run_uid:'diagnostic-pending-A',avg_persons:4,measured:true,detail:'full pending diagnostic'});
 await d.reserveDiagnostic('deviceB','diagnostic-private-B');await d.saveDiagnostic('deviceB',{run_uid:'diagnostic-private-B',detail:'other organization diagnostic'});
 localStorage.setItem('gc_device',JSON.stringify({device_id:'deviceA',screen_id:'screenA',token:'test-original-playback-token'}));
 window.session=await m.redeemMaintenance('TEST-MAINTENANCE-CODE');
 return {commercial:await q.queuedPlays('deviceA'),diagnostics:await d.diagnosticEvidence('deviceA'),credential:localStorage.getItem('gc_device')};
});}
check('authorized export contains exactly one identity with unchanged blocked and pending commercial and diagnostic evidence',async t=>{
 const h=await fixture(t),before=await seed(h.page);const exported=await h.page.evaluate(()=>m.exportMaintenance(session));
 assert.deepEqual(exported.evidence.scope,{org_id:'orgA',screen_id:'screenA',device_id:'deviceA'});assert.deepEqual(exported.evidence.commercial,before.commercial);assert.deepEqual(exported.evidence.diagnostics,before.diagnostics);
 assert.equal(exported.evidence.commercial.length,2);assert.equal(exported.evidence.diagnostics.reports.length,2);assert.match(exported.fingerprint,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(exported).includes('other organization'));assert.deepEqual(await h.page.evaluate(()=>q.queuedPlays('deviceA')),before.commercial);
 assert.equal(h.records.filter(r=>r.path==='/api/maintenance/export').length,1);assert.deepEqual(h.records.find(r=>r.path==='/api/maintenance/export').body,{org_id:'orgA',screen_id:'screenA',device_id:'deviceA'});
 const stored=await h.page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage},url:location.href}));assert.ok(!JSON.stringify(stored).includes('test-maintenance-capability'));assert.deepEqual(stored.session,{});
});
check('empty identities and changed authorization scope cannot broaden an export',async t=>{
 const h=await fixture(t);await seed(h.page);
 for(const id of ['', '   '])await assert.rejects(h.page.evaluate(id=>m.scopedEvidence({...session,grant:{...session.grant,device_id:id}}),id),/expired/);
 h.settings.wrongScope=true;await assert.rejects(h.page.evaluate(()=>m.exportMaintenance(session)),/scope changed/);
 assert.equal(h.records.filter(r=>r.path==='/api/maintenance/export').length,0);assert.equal((await h.page.evaluate(()=>q.queuedPlays())).length,3);
});
check('revocation and offline authorization failures deny export while retaining all records',async t=>{
 const h=await fixture(t),before=await seed(h.page);h.settings.deny='Issuer no longer has access.';
 await assert.rejects(h.page.evaluate(()=>m.exportMaintenance(session)),/no longer has access/);h.settings.deny='';await h.context.setOffline(true);
 await assert.rejects(h.page.evaluate(()=>m.exportMaintenance(session)),/Online authorization could not be checked/);await h.context.setOffline(false);
 assert.deepEqual(await h.page.evaluate(()=>q.queuedPlays('deviceA')),before.commercial);assert.deepEqual(await h.page.evaluate(()=>d.diagnosticEvidence('deviceA')),before.diagnostics);
 assert.equal(h.records.filter(r=>r.path==='/api/maintenance/export').length,0);
});
check('expired session is rejected locally and incomplete redeem replies never establish authority',async t=>{
 const h=await fixture(t);await seed(h.page);await assert.rejects(h.page.evaluate(()=>m.exportMaintenance({...session,deadline:performance.now()-1})),/expired/);
 const variants=[{}, {grant:h.grant}, {grant:h.grant,token:'t'}, {grant:{...h.grant,device_id:''},token:'t',server_time:new Date().toISOString()}, {grant:h.grant,token:'',server_time:new Date().toISOString()}, {grant:{...h.grant,expires_at:new Date(Date.now()-1).toISOString()},token:'t',server_time:new Date().toISOString()}, {grant:{...h.grant,expires_at:new Date(Date.now()+700000).toISOString()},token:'t',server_time:new Date().toISOString()}];
 for(const incomplete of variants){h.settings.incomplete=incomplete;await assert.rejects(h.page.evaluate(()=>m.redeemMaintenance('ANOTHER-CODE')),/incomplete/);}
 assert.equal(h.records.filter(r=>r.path==='/api/maintenance/export').length,0);
});
check('historical grant cannot replace the current identity and changed evidence requires renewed review',async t=>{
 const h=await fixture(t);await seed(h.page);await h.page.evaluate(async()=>{window.review=await m.inspectMaintenance(session);localStorage.setItem('gc_device',JSON.stringify({device_id:'deviceB',screen_id:'screenB',token:'test-other-token'}));});
 await assert.rejects(h.page.evaluate(()=>m.replaceMaintenance(session,'ABCD2345',review.fingerprint,true)),/historical records/);
 await h.page.evaluate(async()=>{localStorage.setItem('gc_device',JSON.stringify({device_id:'deviceA',screen_id:'screenA',token:'test-original-playback-token'}));await q.enqueuePlay('deviceA',{play_uid:'a-new',detail:'arrived since review'});});
 await assert.rejects(h.page.evaluate(()=>m.replaceMaintenance(session,'ABCD2345',review.fingerprint,true)),/records changed/);
 assert.equal(h.records.filter(r=>r.path==='/api/pair').length,0);
});
check('cancelled review, absent backup acknowledgement and failed pairing preserve identity and all evidence',async t=>{
 const h=await fixture(t),before=await seed(h.page);await h.page.evaluate(async()=>{window.review=await m.exportMaintenance(session);});
 await assert.rejects(h.page.evaluate(()=>m.replaceMaintenance(session,'ABCD2345',review.fingerprint,false)),/acknowledge/);
 assert.equal(h.records.filter(r=>r.path==='/api/pair').length,0);h.settings.pairStatus=400;
 await assert.rejects(h.page.evaluate(()=>m.replaceMaintenance(session,'ABCD2345',review.fingerprint,true)),/rejected/);h.settings.pairStatus=200;h.settings.pairIncomplete=true;
 await assert.rejects(h.page.evaluate(()=>m.replaceMaintenance(session,'ABCD2345',review.fingerprint,true)),/incomplete/);
 assert.equal(await h.page.evaluate(()=>localStorage.getItem('gc_device')),before.credential);assert.deepEqual(await h.page.evaluate(()=>q.queuedPlays('deviceA')),before.commercial);assert.deepEqual(await h.page.evaluate(()=>d.diagnosticEvidence('deviceA')),before.diagnostics);
});
check('successful separately authorized pairing changes only current credential and retains original evidence identities',async t=>{
 const h=await fixture(t),before=await seed(h.page);await h.page.evaluate(async()=>{window.review=await m.exportMaintenance(session);await m.replaceMaintenance(session,'abcd2345',review.fingerprint,true);});
 assert.deepEqual(JSON.parse(await h.page.evaluate(()=>localStorage.getItem('gc_device'))),{device_id:'deviceNEW',screen_id:'screenNEW',token:'test-next-token'});
 assert.deepEqual(await h.page.evaluate(()=>q.queuedPlays('deviceA')),before.commercial);assert.deepEqual(await h.page.evaluate(()=>d.diagnosticEvidence('deviceA')),before.diagnostics);assert.equal((await h.page.evaluate(()=>q.queuedPlays('deviceNEW'))).length,0);
 const pair=h.records.find(r=>r.path==='/api/pair');assert.deepEqual(pair.body,{code:'ABCD2345'});assert.equal(pair.authorization,undefined);assert.equal(h.records.some(r=>r.path==='/api/play'),false);
});
check('current identity review attempts delivery under its original playback token without relabeling historical records',async t=>{
 const h=await fixture(t);await seed(h.page);const reviewed=await h.page.evaluate(()=>m.inspectMaintenance(session,true));
 assert.equal(reviewed.evidence.commercial.length,1);assert.equal(reviewed.evidence.commercial[0].blocked,true);assert.equal(reviewed.evidence.diagnostics.reports.length,1);assert.equal(reviewed.evidence.diagnostics.reports[0].blocked,true);
 const sent=h.records.filter(r=>r.path==='/api/play'||r.path==='/api/diagnostic/result');assert.equal(sent.length,2);for(const request of sent)assert.equal(request.authorization,'Bearer test-original-playback-token');assert.equal((await h.page.evaluate(()=>q.queuedPlays('deviceB'))).length,1);
});
check('maintenance waits for a running player to finalize its pending write before exporting',async t=>{
 const h=await fixture(t);await seed(h.page);const player=await h.context.newPage();await h.load(player,'/player');
 await player.evaluate(()=>{l.answerEvidenceProtocol();window.started=0;window.owner=l.joinPlayerEvidence('deviceA',()=>{window.started++;},async()=>{window.pauseStarted=true;await new Promise(resolve=>window.finishWrite=resolve);await q.enqueuePlay('deviceA',{play_uid:'a-last-finalized',detail:'saved before maintenance'});},message=>{window.lockError=message;});});await player.waitForFunction(()=>window.started===1);
 await h.page.evaluate(()=>{window.exportDone=false;window.exportWaiting=m.exportMaintenance(session).then(value=>{window.exportDone=true;return value;});});await player.waitForFunction(()=>window.pauseStarted===true);assert.equal(await h.page.evaluate(()=>window.exportDone),false);
 await player.evaluate(()=>window.finishWrite());const exported=await h.page.evaluate(()=>window.exportWaiting);assert.ok(exported.evidence.commercial.some(row=>row.event.play_uid==='a-last-finalized'));assert.equal(await player.evaluate(()=>window.lockError),undefined);await player.evaluate(()=>window.owner.stop());
});
check('a legacy open player tab blocks maintenance until its protocol is updated',async t=>{
 const h=await fixture(t);await seed(h.page);const old=await h.context.newPage();await h.load(old,'/player');
 await assert.rejects(h.page.evaluate(()=>m.exportMaintenance(session)),/older player tab/);assert.equal(h.records.filter(r=>r.path==='/api/maintenance/export').length,0);
 await old.evaluate(()=>l.answerEvidenceProtocol());const exported=await h.page.evaluate(()=>m.exportMaintenance(session));assert.equal(exported.evidence.scope.device_id,'deviceA');
});
check('a held maintenance pause spans review and export, then cancel resumes the cooperating player',async t=>{
 const h=await fixture(t);await seed(h.page);const player=await h.context.newPage();await h.load(player,'/player');
 await player.evaluate(()=>{l.answerEvidenceProtocol();window.starts=0;window.pauses=0;window.owner=l.joinPlayerEvidence('deviceA',()=>window.starts++,async()=>{window.pauses++;},message=>{window.lockError=message;});});await player.waitForFunction(()=>window.starts===1);
 const evidence=await h.page.evaluate(async()=>{window.lease=await m.acquireMaintenanceLease(session);window.review=await m.inspectMaintenance(session,false,lease);window.download=await m.exportMaintenance(session,lease);return {review:review.evidence,download:download.evidence};});
 assert.deepEqual(evidence.review,evidence.download);assert.equal(await player.evaluate(()=>window.starts),1);assert.equal(await player.evaluate(()=>window.pauses),1);
 await h.page.evaluate(()=>window.lease.release());await player.waitForFunction(()=>window.starts===2);assert.equal(await player.evaluate(()=>window.lockError),undefined);await player.evaluate(()=>window.owner.stop());
 await assert.rejects(h.page.evaluate(()=>m.exportMaintenance(session,lease)),/pause has closed/);
});
check('foreign identity leases are rejected and releasing a lease waits for already started work',async t=>{
 const h=await fixture(t);await seed(h.page);
 await h.page.evaluate(async()=>{window.otherLease=await l.holdPlayerEvidence('deviceB');});await assert.rejects(h.page.evaluate(()=>m.exportMaintenance(session,otherLease)),/another identity/);await h.page.evaluate(()=>otherLease.release());
 await h.page.evaluate(async()=>{window.lease=await l.holdPlayerEvidence('deviceA');window.work=lease.run(()=>new Promise(resolve=>window.finishWork=resolve));lease.release();window.sharedEntered=false;window.waitingShared=navigator.locks.request('gridcast-evidence:deviceA',{mode:'shared'},()=>{window.sharedEntered=true;});});
 assert.equal(await h.page.evaluate(()=>window.sharedEntered),false);await h.page.evaluate(async()=>{finishWork();await work;await waitingShared;});assert.equal(await h.page.evaluate(()=>window.sharedEntered),true);
});
check('stopping a player retains its shared lock until outstanding evidence writes settle',async t=>{
 const h=await fixture(t);await seed(h.page);const player=await h.context.newPage();await h.load(player,'/player');
 await player.evaluate(()=>{l.answerEvidenceProtocol();window.ready=false;window.owner=l.joinPlayerEvidence('deviceA',()=>{window.ready=true;},async()=>{},message=>{window.lockError=message;});});await player.waitForFunction(()=>window.ready);
 await player.evaluate(()=>{window.unsaved=new Promise(resolve=>window.finishSave=resolve).then(()=>q.enqueuePlay('deviceA',{play_uid:'a-final-stop-write'}));window.owner.stop(window.unsaved);});
 await h.page.evaluate(()=>{window.finished=false;window.exporting=m.exportMaintenance(session).then(result=>{window.finished=true;return result;});});
 await h.page.waitForTimeout(100);assert.equal(await h.page.evaluate(()=>window.finished),false);await player.evaluate(()=>window.finishSave());const result=await h.page.evaluate(()=>window.exporting);assert.ok(result.evidence.commercial.some(row=>row.event.play_uid==='a-final-stop-write'));assert.equal(await player.evaluate(()=>window.lockError),undefined);
});
