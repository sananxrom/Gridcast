const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');
const {chromium} = require('playwright');
const candidates = [process.env.GC_TEST_BROWSER_PATH,chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium'].filter(Boolean);
const executablePath = candidates.find(p=>fs.existsSync(p));
test('IndexedDB queue persists reload, assigns atomic sequences, retries, and retains rejected records', {skip:!executablePath}, async()=>{
 const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/player-queue.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Queue integration test</title>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try {
  browser=await chromium.launch({executablePath,headless:true});
  const page=await browser.newPage(),url=`http://127.0.0.1:${server.address().port}`;
  const init=()=>page.evaluate(source=>{const m={exports:{}};new Function('module','exports',source)(m,m.exports);window.testQueue=m.exports;},source);
  await page.goto(url);await init();
  await page.evaluate(async()=>{await Promise.all([window.testQueue.enqueuePlay('device-a',{play_uid:'one'}),window.testQueue.enqueuePlay('device-a',{play_uid:'two'})]);});
  await page.reload();await init();
  const first=await page.evaluate(()=>window.testQueue.queuedPlays('device-a'));
  assert.deepEqual(first.map(p=>p.event.seq_no),[1,2]);
  await page.evaluate(()=>window.testQueue.flushPlays('device-a',async()=>({status:503,error:'test offline'})));
  const retry=await page.evaluate(()=>window.testQueue.queuedPlays('device-a'));assert.equal(retry[0].attempts,1);assert.equal(retry.length,2);
  await page.evaluate(()=>{const original=Date.now;Date.now=()=>original()+600000;});
  await page.evaluate(()=>window.testQueue.flushPlays('device-a',async event=>event.seq_no===1?{status:200}:{status:409,error:'conflicting payload'}));
  const after=await page.evaluate(()=>window.testQueue.queuedPlays('device-a'));assert.equal(after.length,1);assert.equal(after[0].blocked,true);assert.equal(after[0].event.seq_no,2);
  await page.reload();await init();const status=await page.evaluate(()=>window.testQueue.queueStatus('device-a'));assert.deepEqual(status,{pending:0,blocked:1,total:1});
  const full=await page.evaluate(async()=>{try{await window.testQueue.enqueuePlay('device-a',{play_uid:'three'},1);return false;}catch{return true;}});assert.equal(full,true);
  assert.equal(await page.evaluate(()=>window.testQueue.queueCapacity('device-a', 1)),false);
 } finally {await browser?.close();await new Promise(r=>server.close(r));}
});
