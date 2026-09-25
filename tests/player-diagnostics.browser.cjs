const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');
const { chromium } = require('playwright');
const executablePath = [process.env.GC_TEST_BROWSER_PATH, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].filter(Boolean).find(fs.existsSync);
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/player-diagnostics.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
let browser, server, base;
test.before(async () => {
  if (!executablePath) return;
  server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Diagnostic storage test</title>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath, headless: true });
});
test.after(async () => { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function fixture(t, pages = 1) {
  const context = await browser.newContext(); t.after(() => context.close());
  const result = [];
  for (let i = 0; i < pages; i++) {
    const page = await context.newPage(); await page.goto(base);
    await page.evaluate(source => { const module = { exports: {} }; new Function('module', 'exports', source)(module, module.exports); window.diag = module.exports; }, source);
    result.push(page);
  }
  return result;
}
const check = (name, fn) => test(name, { skip: !executablePath }, fn);
check('blocked legacy report migrates durably and permits a new reserved run', async t => {
  const [page] = await fixture(t);
  const result = await page.evaluate(async () => {
    const original = { event: { run_uid: 'legacy_001', count: null }, created_at: Date.now() - 100, blocked: true, error: 'Rejected original reason' };
    localStorage.setItem('gc_diagnostic_result:deviceA', JSON.stringify(original));
    const pending = await diag.pendingDiagnostic('deviceA');
    await diag.reserveDiagnostic('deviceA', 'new_run_001');
    await diag.saveDiagnostic('deviceA', { run_uid: 'new_run_001', count: 4 });
    return { pending, retained: await diag.retainedDiagnostics('deviceA'), counts: await diag.diagnosticRecordCounts('deviceA'), old: localStorage.getItem('gc_diagnostic_result:deviceA'), original };
  });
  assert.equal(result.pending, null); assert.equal(result.old, null);
  assert.deepEqual(result.retained.reports, [result.original]);
  assert.deepEqual(result.counts, { pending: 1, blocked: 1, reserved: 0, total: 2 });
});
check('pending legacy report blocks new claims and survives reload', async t => {
  const [page] = await fixture(t);
  await page.evaluate(async () => {
    localStorage.setItem('gc_diagnostic_result:deviceA', JSON.stringify({ event: { run_uid: 'legacy_002' }, created_at: Date.now() }));
    await diag.pendingDiagnostic('deviceA');
  });
  await page.reload();
  await page.evaluate(source => { const module = { exports: {} }; new Function('module', 'exports', source)(module, module.exports); window.diag = module.exports; }, source);
  assert.equal(await page.evaluate(async () => (await diag.pendingDiagnostic('deviceA')).event.run_uid), 'legacy_002');
  await assert.rejects(page.evaluate(() => diag.reserveDiagnostic('deviceA', 'new_run_002')), /still waiting/);
});
check('corrupt legacy and corrupt IndexedDB evidence are preserved and fail closed', async t => {
  const [page] = await fixture(t);
  await page.evaluate(() => localStorage.setItem('gc_diagnostic_result:deviceA', '{broken'));
  await assert.rejects(page.evaluate(() => diag.reserveDiagnostic('deviceA', 'new_run_003')), /could not be read/);
  assert.equal(await page.evaluate(() => localStorage.getItem('gc_diagnostic_result:deviceA')), '{broken');
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('gridcast-diagnostics-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise((resolve, reject) => { const tx = db.transaction('devices', 'readwrite'); tx.objectStore('devices').put({ device: 'deviceB', version: 900 }); tx.oncomplete = resolve; tx.onabort = reject; }); db.close();
  });
  await assert.rejects(page.evaluate(() => diag.reserveDiagnostic('deviceB', 'new_run_003')), /could not be read/);
});
check('storage write failure leaves legacy original intact; retry migrates exactly once', async t => {
  const [page] = await fixture(t);
  await page.evaluate(() => {
    localStorage.setItem('gc_diagnostic_result:deviceA', JSON.stringify({ event: { run_uid: 'legacy_004' }, created_at: Date.now(), blocked: true, error: 'retain me' }));
    window.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = () => { throw new DOMException('Fixture quota exceeded', 'QuotaExceededError'); };
  });
  await assert.rejects(page.evaluate(() => diag.pendingDiagnostic('deviceA')), /quota exceeded/);
  assert.ok(await page.evaluate(() => localStorage.getItem('gc_diagnostic_result:deviceA')));
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalPut; });
  assert.equal(await page.evaluate(async () => { await diag.pendingDiagnostic('deviceA'); await diag.pendingDiagnostic('deviceA'); return (await diag.retainedDiagnostics('deviceA')).reports.length; }), 1);
});
check('legacy removal failure and interrupted migration do not duplicate evidence', async t => {
  const [page] = await fixture(t);
  const result = await page.evaluate(async () => {
    localStorage.setItem('gc_diagnostic_result:deviceA', JSON.stringify({ event: { run_uid: 'legacy_005' }, created_at: Date.now(), blocked: true, error: 'retain' }));
    const original = Storage.prototype.removeItem; Storage.prototype.removeItem = () => { throw new Error('Fixture removal denied'); };
    await diag.pendingDiagnostic('deviceA'); await diag.pendingDiagnostic('deviceA');
    const count = (await diag.retainedDiagnostics('deviceA')).reports.length;
    Storage.prototype.removeItem = original; await diag.pendingDiagnostic('deviceA');
    return { count, old: localStorage.getItem('gc_diagnostic_result:deviceA') };
  });
  assert.equal(result.count, 1); assert.equal(result.old, null);
});
check('two tabs cannot reserve competing screen tests', async t => {
  const [a, b] = await fixture(t, 2);
  const results = await Promise.allSettled([a.evaluate(() => diag.reserveDiagnostic('deviceA', 'tab_run_001')), b.evaluate(() => diag.reserveDiagnostic('deviceA', 'tab_run_002'))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await a.evaluate(() => diag.diagnosticRecordCounts('deviceA'))).reserved, 1);
});
check('stale successful upload cannot delete a replacement diagnostic result', async t => {
  const [a, b] = await fixture(t, 2);
  await a.evaluate(async () => { await diag.reserveDiagnostic('deviceA', 'old_run_001'); await diag.saveDiagnostic('deviceA', { run_uid: 'old_run_001' }); window.slowFlush = diag.flushDiagnostic('deviceA', () => new Promise(resolve => { window.finishUpload = resolve; })); });
  await a.waitForFunction(() => !!window.finishUpload);
  await b.evaluate(async () => { await diag.flushDiagnostic('deviceA', async () => ({ status: 200, value: { ok: true } })); await diag.reserveDiagnostic('deviceA', 'new_run_006'); await diag.saveDiagnostic('deviceA', { run_uid: 'new_run_006' }); });
  await a.evaluate(async () => { window.finishUpload({ status: 200, value: { ok: true } }); await window.slowFlush; });
  assert.equal(await a.evaluate(async () => (await diag.pendingDiagnostic('deviceA')).event.run_uid), 'new_run_006');
});
check('terminal rejection retains full payload and reason; retryable failure keeps pending', async t => {
  const [page] = await fixture(t);
  const result = await page.evaluate(async () => {
    await diag.reserveDiagnostic('deviceA', 'reject_001'); await diag.saveDiagnostic('deviceA', { run_uid: 'reject_001', count: null, measured: false });
    await diag.flushDiagnostic('deviceA', async () => ({ status: 429, value: {} })); const stillPending = !!await diag.pendingDiagnostic('deviceA');
    await diag.flushDiagnostic('deviceA', async () => ({ status: 401, value: { error: 'Device is disabled' } }));
    return { stillPending, pending: await diag.pendingDiagnostic('deviceA'), retained: await diag.retainedDiagnostics('deviceA') };
  });
  assert.equal(result.stillPending, true); assert.equal(result.pending, null);
  assert.deepEqual(result.retained.reports[0].event, { run_uid: 'reject_001', count: null, measured: false });
  assert.equal(result.retained.reports[0].error, 'Device is disabled');
});
check('expired report is retained before next test and never uploaded', async t => {
  const [page] = await fixture(t);
  const result = await page.evaluate(async () => {
    localStorage.setItem('gc_diagnostic_result:deviceA', JSON.stringify({ event: { run_uid: 'expired_001' }, created_at: Date.now() - 86400001 }));
    let sends = 0; await diag.flushDiagnostic('deviceA', async () => { sends++; return { status: 200, value: { ok: true } }; });
    await diag.reserveDiagnostic('deviceA', 'next_run_001');
    return { sends, retained: await diag.retainedDiagnostics('deviceA') };
  });
  assert.equal(result.sends, 0); assert.match(result.retained.reports[0].error, /expired/);
});
check('abandoned claim retains interruption evidence and late result can still persist', async t => {
  const [page] = await fixture(t);
  const result = await page.evaluate(async () => {
    await diag.reserveDiagnostic('deviceA', 'lost_run_001'); const originalNow = Date.now; Date.now = () => originalNow() + 120001;
    await diag.reserveDiagnostic('deviceA', 'next_run_002'); const interrupted = await diag.retainedDiagnostics('deviceA');
    await diag.saveDiagnostic('deviceA', { run_uid: 'lost_run_001', recovered: true }); Date.now = originalNow;
    return { interrupted, counts: await diag.diagnosticRecordCounts('deviceA'), pending: await diag.pendingDiagnostic('deviceA') };
  });
  assert.equal(result.interrupted.interrupted[0].run_uid, 'lost_run_001');
  assert.equal(result.pending.event.recovered, true); assert.equal(result.counts.total, 2);
});
check('count ceiling never evicts old evidence and rejects claim before start', async t => {
  const [page] = await fixture(t);
  await page.evaluate(async () => {
    for (let i = 0; i < diag.DIAGNOSTIC_LIMITS.records; i++) {
      const uid = 'count_run_' + i; await diag.reserveDiagnostic('deviceA', uid); await diag.saveDiagnostic('deviceA', { run_uid: uid });
      await diag.flushDiagnostic('deviceA', async () => ({ status: 409, value: { error: 'retained' } }));
    }
  });
  await assert.rejects(page.evaluate(() => diag.reserveDiagnostic('deviceA', 'overflow_001')), /storage is full/);
  assert.equal((await page.evaluate(() => diag.retainedDiagnostics('deviceA'))).reports.length, 32);
});
check('oversized legacy evidence remains intact and byte ceiling refuses a new claim', async t => {
  const [page] = await fixture(t);
  await page.evaluate(() => localStorage.setItem('gc_diagnostic_result:deviceA', JSON.stringify({ event: { run_uid: 'large_legacy', detail: 'x'.repeat(1100000) }, created_at: Date.now(), blocked: true, error: 'retain' })));
  await page.evaluate(() => diag.pendingDiagnostic('deviceA'));
  await assert.rejects(page.evaluate(() => diag.reserveDiagnostic('deviceA', 'overflow_002')), /storage is full/);
  assert.equal(await page.evaluate(async () => (await diag.retainedDiagnostics('deviceA')).reports[0].event.detail.length), 1100000);
});
check('same-run save is idempotent, mismatched payload and unreserved save fail without overwrite', async t => {
  const [page] = await fixture(t);
  await page.evaluate(async () => { await diag.reserveDiagnostic('deviceA', 'same_run_001'); await diag.saveDiagnostic('deviceA', { run_uid: 'same_run_001', count: 5 }); await diag.saveDiagnostic('deviceA', { run_uid: 'same_run_001', count: 5 }); });
  await assert.rejects(page.evaluate(() => diag.saveDiagnostic('deviceA', { run_uid: 'same_run_001', count: 7 })), /different result/);
  await assert.rejects(page.evaluate(() => diag.saveDiagnostic('deviceB', { run_uid: 'same_run_002' })), /not reserved/);
  assert.equal(await page.evaluate(async () => (await diag.pendingDiagnostic('deviceA')).event.count), 5);
});
check('release affects only matching reservation, never other device evidence', async t => {
  const [page] = await fixture(t);
  const result = await page.evaluate(async () => {
    await diag.reserveDiagnostic('deviceA', 'release_001'); await diag.reserveDiagnostic('deviceB', 'release_001');
    await diag.releaseDiagnosticReservation('deviceA', 'release_001');
    return { a: await diag.diagnosticRecordCounts('deviceA'), b: await diag.diagnosticRecordCounts('deviceB') };
  });
  assert.equal(result.a.total, 0); assert.equal(result.b.total, 1);
  await assert.rejects(page.evaluate(() => diag.retainedDiagnostics('')), /identity is required/);
});
check('stale rejection cannot replace first rejection or contaminate a newer run', async t => {
  const [a, b] = await fixture(t, 2);
  await a.evaluate(async () => { await diag.reserveDiagnostic('deviceA', 'old_run_009'); await diag.saveDiagnostic('deviceA', { run_uid: 'old_run_009' }); window.slowFlush = diag.flushDiagnostic('deviceA', () => new Promise(resolve => { window.finishUpload = resolve; })); });
  await a.waitForFunction(() => !!window.finishUpload);
  await b.evaluate(async () => { await diag.flushDiagnostic('deviceA', async () => ({ status: 409, value: { error: 'First rejection' } })); await diag.reserveDiagnostic('deviceA', 'new_run_009'); await diag.saveDiagnostic('deviceA', { run_uid: 'new_run_009' }); });
  await a.evaluate(async () => { window.finishUpload({ status: 403, value: { error: 'Stale rejection' } }); await window.slowFlush; });
  assert.equal(await a.evaluate(async () => (await diag.pendingDiagnostic('deviceA')).event.run_uid), 'new_run_009');
  assert.equal(await a.evaluate(async () => (await diag.retainedDiagnostics('deviceA')).reports[0].error), 'First rejection');
});
check('two tabs migrating the same legacy report preserve exactly one copy', async t => {
  const [a, b] = await fixture(t, 2);
  await a.evaluate(() => localStorage.setItem('gc_diagnostic_result:deviceA', JSON.stringify({ event: { run_uid: 'legacy_tabs' }, created_at: Date.now(), blocked: true, error: 'Original evidence' })));
  await Promise.all([a.evaluate(() => diag.pendingDiagnostic('deviceA')), b.evaluate(() => diag.pendingDiagnostic('deviceA'))]);
  assert.equal(await a.evaluate(async () => (await diag.retainedDiagnostics('deviceA')).reports.length), 1);
});
check('failed result write retains reservation and can be retried without consuming another slot', async t => {
  const [page] = await fixture(t);
  await page.evaluate(async () => {
    await diag.reserveDiagnostic('deviceA', 'write_fail_01');
    window.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = () => { throw new DOMException('Fixture result write failed', 'QuotaExceededError'); };
  });
  await assert.rejects(page.evaluate(() => diag.saveDiagnostic('deviceA', { run_uid: 'write_fail_01', count: 8 })), /write failed/);
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalPut; });
  assert.equal((await page.evaluate(() => diag.diagnosticRecordCounts('deviceA'))).reserved, 1);
  await page.evaluate(() => diag.saveDiagnostic('deviceA', { run_uid: 'write_fail_01', count: 8 }));
  const counts = await page.evaluate(() => diag.diagnosticRecordCounts('deviceA'));
  assert.equal(counts.pending, 1); assert.equal(counts.reserved, 0);
});
