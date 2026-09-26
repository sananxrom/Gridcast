const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),ts=require('typescript');
const {chromium}=require('playwright'),c=require('./load-lib.cjs')('vision/contracts-draft'),f=require('./attention-contract-fixtures.cjs');
const executablePath=[process.env.GC_TEST_BROWSER_PATH,chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(fs.existsSync);
test('draft envelopes fit real queue reservations, persist maximum sequence and retry byte-identically',{skip:!executablePath},async()=>{
 const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/player-queue.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>A1 isolated queue test</title>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath,headless:true});const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
  const init=()=>page.evaluate(source=>{const m={exports:{}};new Function('module','exports',source)(m,m.exports);window.q=m.exports;},source);await init();
  const events=[];for(const media of ['image','video','youtube'])for(const measured of [true,false]){const a=f.attention(),base={...f.legacy(media,measured),play_uid:String(events.length).repeat(128)};events.push(c.prepareDraftEnvelope(base,a,a.calibration_revision).event);}
  // Open through the real helper first, then seed only the sequence counter near its supported upper bound.
  await page.evaluate(()=>window.q.queueStatus('draft-device'));
  await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('gridcast-player-v1',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const tx=db.transaction('meta','readwrite');tx.objectStore('meta').put({key:'sequence:draft-device',value:Number.MAX_SAFE_INTEGER-6});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();});
  await page.evaluate(async events=>{for(const event of events){if(!await window.q.reservePlay('draft-device',event.play_uid))throw Error('reservation denied');await window.q.enqueuePlay('draft-device',event);}},events);
  const first=await page.evaluate(()=>window.q.queuedPlays('draft-device'));assert.equal(first.length,6);assert.equal(first[5].event.seq_no,Number.MAX_SAFE_INTEGER);
  for(let i=0;i<6;i++){const {seq_no,...rest}=first[i].event;assert.deepEqual(rest,events[i]);assert.ok(c.draftJsonBytes(first[i].event)<=3584);assert.ok(first[i].capacity_padding.length>0);}
  await page.evaluate(()=>window.q.flushPlays('draft-device',async()=>({status:503,error:'offline fixture'})));
  await page.reload();await init();const saved=await page.evaluate(()=>window.q.queuedPlays('draft-device'));
  assert.deepEqual(saved.map(r=>r.event),first.map(r=>r.event));assert.deepEqual(saved.map(r=>r.attempts),[1,0,0,0,0,0]);
  const sent=await page.evaluate(async()=>{const now=Date.now;Date.now=()=>now()+600000;const sent=[];await window.q.flushPlays('draft-device',async event=>{sent.push(JSON.stringify(event));return {status:200};});Date.now=now;return sent;});
  assert.deepEqual(sent,first.map(r=>JSON.stringify(r.event)));assert.equal((await page.evaluate(()=>window.q.queuedPlays('draft-device'))).length,0);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
