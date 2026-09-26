const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const base=process.env.GC_TEST_EVALUATION_URL;
const executablePath=[process.env.GC_TEST_BROWSER_PATH,chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(fs.existsSync);
async function setup(t){
 const browser=await chromium.launch({executablePath,headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const context=await browser.newContext({permissions:['camera'],acceptDownloads:true});const page=await context.newPage();page.setDefaultTimeout(30000);
 t.after(()=>browser.close()); const errors=[],api=[];page.on('pageerror',e=>errors.push(e.message));context.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))api.push(r.url());});
 await page.goto(base+'/vision-lab/evaluate');return {context,page,errors,api};
}
async function exportData(page){const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download aggregate results'}).click();const download=await pending;return JSON.parse(fs.readFileSync(await download.path(),'utf8'));}
const skip=!base?'Set GC_TEST_EVALUATION_URL to the compiled local app':!executablePath?'Chromium unavailable':false;
test('compiled attention UI splits ads, excludes pauses, clears stopped counts and freezes export provenance',{skip,timeout:60000},async t=>{
 const h=await setup(t),p=h.page;await p.getByRole('button',{name:'Try simulation'}).click();await p.waitForTimeout(1400);
 await p.getByRole('button',{name:'Pause timing'}).click();let first=await exportData(p);assert.equal(first.mode,'simulation');assert.equal(first.models.face_delegate,null);
 const paused=first.results.current.playing_s;await p.waitForTimeout(500);let second=await exportData(p);assert.equal(second.results.current.playing_s,paused);
 await p.getByRole('button',{name:'Next test ad'}).click();await p.waitForTimeout(400);await p.getByRole('button',{name:'Stop',exact:true}).click();
 await p.getByLabel('Face backend').selectOption('GPU');await p.locator('summary').click();await p.getByLabel('yaw offset').fill('30');
 const stopped=await exportData(p);assert.equal(stopped.mode,'simulation');assert.equal(stopped.delegate,'CPU');assert.equal(stopped.calibration.yaw,0);assert.equal(stopped.results.current,null);assert.equal(stopped.results.completed.length,2);
 assert.equal(await p.locator('dt').filter({hasText:/^People now$/}).locator('..').locator('dd').innerText(),'—');
 assert.equal(/"(?:box|landmarks|key|track_id)"/.test(JSON.stringify(stopped)),false);
 await p.getByRole('button',{name:'Try simulation'}).click();await p.waitForTimeout(300);await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 await p.getByRole('status').filter({hasText:'tab was hidden'}).waitFor();assert.deepEqual(h.errors,[]);assert.deepEqual(h.api,[]);
});
test('compiled page verifies real CDN files then reloads and runs CPU models completely offline',{skip:skip||(!process.env.GC_TEST_REAL_CDN?'Set GC_TEST_REAL_CDN=1 for network integration':false),timeout:180000},async t=>{
 const h=await setup(t),p=h.page;await p.getByRole('button',{name:'Prepare offline files'}).click();await p.getByRole('status').filter({hasText:'Model files verified and cached'}).waitFor({timeout:120000});
 const cached=await p.evaluate(async()=>{const c=await caches.open('gridcast-vision-lab-assets-1');return (await c.keys()).map(r=>r.url);});assert.equal(cached.length,7);
 await h.context.setOffline(true);await p.reload();await p.getByRole('button',{name:'Start camera test'}).click();await p.getByRole('status').filter({hasText:'Camera test running locally'}).waitFor({timeout:70000});
 await p.locator('summary').click();await p.getByText(/ms per job/).waitFor({timeout:30000});await p.waitForTimeout(1700);
 const other=await h.context.newPage();await other.goto(base+'/vision-lab/evaluate');await other.getByRole('button',{name:'Start camera test'}).click();await other.getByRole('alert').filter({hasText:'Another attention test is running'}).waitFor();await other.close();
 // A production player appearing during a benchmark must stop it without clearing that player's state.
 await h.context.setOffline(false);await h.context.route('**/player',route=>route.fulfill({contentType:'text/html',body:'<title>Isolated player-tab fixture</title>'}));const player=await h.context.newPage();await player.goto(base+'/player');await p.getByRole('alert').filter({hasText:'Gridcast player is open'}).waitFor();await player.close();
 const result=await exportData(p);assert.equal(result.warnings.length,1);
 assert.equal(result.mode,'camera');assert.equal(result.models.face_delegate,'CPU');assert.ok(result.results.completed[0].playing_s>0);assert.deepEqual(h.errors,[]);assert.deepEqual(h.api,[]);
});
