/** Regressions for the defects found in the through-WP5 review (2026-09-24).
 *  Each test here failed before its fix and would have caught the defect earlier. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const clone = x => JSON.parse(JSON.stringify(x));

// ---- API-level harness (same shape as tests/authorization.test.cjs) ----
function apiFixture(options = {}) {
  const env = { NODE_ENV: 'test', GC_DEMO_PASSWORD: crypto.randomBytes(24).toString('hex'), ...options.env };
  let saved = null;
  class StoreError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const store = { StoreError, transact: async (_c, fn) => fn(), mode: 'memory',
    read: async () => saved && clone(saved), write: async v => { saved = clone(v); } };
  const cache = {};
  function load(file) {
    file = path.resolve(file);
    if (cache[file]) return cache[file].exports;
    const mod = { exports: {} }; cache[file] = mod;
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    new Function('require','module','exports','process',code)(name => name === './store' ? store
      : name.startsWith('.') ? load(path.join(path.dirname(file), name + '.ts')) : require(name),
      mod, mod.exports, { env });
    return mod.exports;
  }
  const auth = load(path.join(root,'lib/auth.ts'));
  saved = load(path.join(root,'lib/seed.ts')).seed();
  const api = load(path.join(root,'lib/api.ts'));
  const call = async (method, route, body = {}, token) => {
    const [p,q] = route.split('?');
    const r = await api.handle(method, p.split('/'), new URLSearchParams(q), body, token);
    return { ...r, status: r.status || 200 };
  };
  return { call, data: () => clone(saved), change: fn => fn(saved),
    token: id => auth.issueToken(saved.users.find(u => u.id === id)),
    userBy: role => clone(saved.users.find(u => u.role === role)) };
}

test('an installer cannot reprice a screen through its pricing inputs', async () => {
  const f = apiFixture();
  const installer = f.userBy('installer');
  const screen = f.data().screens.find(s => s.org_id === installer.org_id);
  const before = screen.slot_price_month;
  const token = f.token(installer.id);
  for (const body of [{ advertiser_slots: 60 }, { loop_length_s: 60 }, { slot_duration_s: 60 }, { venue_base: 1 }]) {
    const r = await f.call('POST', 'screen/' + screen.id, body, token);
    assert.equal(r.status, 403, 'expected 403 for ' + JSON.stringify(body) + ' got ' + JSON.stringify(r.body));
  }
  assert.equal(f.data().screens.find(s => s.id === screen.id).slot_price_month, before);
  // A name change is still allowed: the block is on pricing, not on the role.
  assert.equal((await f.call('POST', 'screen/' + screen.id, { name: 'Renamed' }, token)).status, 200);
});

test('platform settings take only known fields and never the config revision', async () => {
  const f = apiFixture();
  const admin = f.userBy('platform_admin'), token = f.token(admin.id);
  const protoBody = JSON.parse('{"__proto__":{"pwn":1}}'); // an own "__proto__" key, as a real request carries it
  for (const body of [{ config_revision: 99999 }, protoBody, { anything: 'goes' }, { default_fee_pct: 400 }])
    assert.equal((await f.call('POST', 'settings', body, token)).status, 400, JSON.stringify(body));
  assert.equal((await f.call('POST', 'settings', { platform_name: 'Gridcast' }, token)).status, 200);
  assert.equal(f.data().settings.config_revision === 99999, false);
});

test('a role without money access never reads billing state it cannot write', async () => {
  const f = apiFixture();
  const sales = f.userBy('sales'), token = f.token(sales.id);
  const boot = (await f.call('GET', 'bootstrap', {}, token)).body;
  for (const c of boot.campaigns || []) {
    assert.equal('invoice_status' in c, false, 'sales saw invoice_status');
    assert.equal('platform_fee_pct' in c, false, 'sales saw platform_fee_pct');
  }
});

test('reports separate rendered, billable and measured', async () => {
  const f = apiFixture();
  const campaign = f.data().campaigns[0];
  f.change(db => {
    const rows = db.plays.filter(x => x.campaign_id === campaign.id);
    rows[0].rendered = false; rows[0].billable = false;   // never reached the screen
    rows[1].rendered = true;  rows[1].billable = false;   // played in full, failed a billing check
  });
  const owner = f.userBy('owner'), token = f.token(owner.id);
  const t = (await f.call('GET', 'campaign/' + campaign.id, {}, token)).body.totals;
  const all = f.data().plays.filter(p => p.campaign_id === campaign.id).length;
  assert.equal(t.not_rendered, 1, 'only the slot that never played counts as not rendered');
  assert.equal(t.plays, all - 1, 'the unbilled-but-played slot is still delivery');
  assert.equal(t.billable, all - 2, 'and it is not counted as billable');
});

// ---- device-transport harness (same shape as tests/devices.test.cjs) ----
const deviceModule = { exports: {} };
new Function('require','module','exports', ts.transpileModule(
  fs.readFileSync(path.join(root, 'lib/devices.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }
).outputText)(require, deviceModule, deviceModule.exports);
const { issuePairing, deviceRoute } = deviceModule.exports;
const MODEL = 'coco-ssd@2.2.3/lite_mobilenet_v2';

function deviceFixture() {
  let now = Date.parse('2026-09-24T00:00:00.000Z');
  const db = { orgs: [{ id:'org1', status:'active' }],
    screens: [{ id:'screen1', org_id:'org1', status:'active', has_camera:true }],
    devices: [], device_assignments: [], plays: [], presence: [],
    campaigns: [{ id:'campaign1', org_id:'org1', advertiser_id:'adv1', rate_type:'per_play', rate_value:9, accrued_spend:0 }] };
  const config = { model:'coco-ssd', sample_interval_s:2, count_ceiling:50, camera_fail_mode:'continue' };
  let plan = { items:[{ campaign_id:'campaign1', creative_id:'creative1', duration_s:10, youtube_id:'x', rate_value:9 }], config, config_version:3 };
  const options = () => ({ now, clientKey: crypto.randomUUID(), playlist: () => JSON.parse(JSON.stringify(plan)) });
  const call = (method, route, body={}, token) => { const r = deviceRoute(db, method, route.split('/'), body, token, options()); return { ...r, status: r?.status || 200 }; };
  const code = issuePairing(db, db.screens[0], now);
  const paired = call('POST','pair',{ code: code.code }).body;
  const assignment = call('GET','playlist/screen1',{},paired.token).body.items[0];
  now += 11000;
  const event = (patch={}) => ({ play_uid: crypto.randomUUID(), seq_no: 1, assignment_id: assignment.assignment_id,
    campaign_id:'campaign1', creative_id:'creative1', config_version:3,
    started_at_device:'2026-09-24T00:00:00.000Z', ended_at_device:'2026-09-24T00:00:10.000Z',
    playing_duration_ms:10000, media_started_s:0, media_ended_s:10, ended_reason:'ended',
    server_clock_offset_ms:0, measured:true, avg_persons:2, sample_count:5, model_ver: MODEL, ...patch });
  return { db, call, paired, assignment, event, advance: n => { now += n }, mutatePlaylist: fn => fn(plan) };
}

test('a device cannot bill more airtime than wall-clock time allows', () => {
  const f = deviceFixture();
  let billed = 0, blocked = 0;
  for (let i = 1; i <= 400; i++) {
    const r = f.call('POST','play', f.event({ seq_no: i }), f.paired.token);
    assert.equal(r.status, 200);
    if (r.body.billable) billed++;
    else if ((r.body.nonbillable_reasons || []).includes('device_throughput_exceeded')) blocked++;
  }
  assert.ok(blocked > 0, 'replaying one assignment should stop being billable');
  assert.ok(billed * 10 <= 3600 * 1.1 + 10, `billed airtime ${billed * 10}s exceeds the hour it claims to fill`);
  assert.equal(f.db.campaigns[0].accrued_spend, billed * 9);
});

test('the replay limit holds on the production snapshot, which carries no play history', () => {
  // Firestore hands a device request only the idempotency lookups, never the growing event history
  // (lib/firestore-store.ts). Anything counted by scanning db.plays reads as zero in production, so this
  // fixture reproduces that contract exactly: history is dropped after every call.
  const f = deviceFixture();
  let billed = 0, blocked = 0;
  for (let i = 1; i <= 400; i++) {
    const r = f.call('POST','play', f.event({ seq_no: i }), f.paired.token);
    assert.equal(r.status, 200);
    if (r.body.billable) billed++;
    else if ((r.body.nonbillable_reasons || []).includes('device_throughput_exceeded')) blocked++;
    f.db.plays = []; f.db.presence = [];   // the snapshot the adapter would have handed us
  }
  assert.ok(blocked > 0, 'the limit must not depend on reading play history');
  assert.ok(billed * 10 <= 3600 * 1.1 + 10, `billed airtime ${billed * 10}s exceeds the hour it claims to fill`);
  assert.equal(f.db.campaigns[0].accrued_spend, billed * 9);
  const device = f.db.devices[0];
  assert.ok(Array.isArray(device.airtime_buckets) && device.airtime_buckets[0].ms > 0,
    'airtime accounting is persisted on the device row, per playback hour');
  assert.ok(Array.isArray(device.assignment_uses) && device.assignment_uses.length <= 512);
});

test('a heartbeat cannot backdate a device into a billable window', () => {
  const f = deviceFixture();
  // The heartbeat estimate is derived from device_now, which the device also supplies.
  f.call('POST','heartbeat', { device_now: '2026-09-23T18:00:00.000Z', app_ver: 'test' }, f.paired.token);
  const r = f.call('POST','play', f.event({
    started_at_device: '2026-09-23T18:00:00.000Z', ended_at_device: '2026-09-23T18:00:10.000Z',
    server_clock_offset_ms: 6 * 3600e3, seq_no: 7,
  }), f.paired.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.billable, false, 'a six-hour claimed skew must not buy a billing window');
  assert.ok((r.body.nonbillable_reasons || []).includes('clock_or_assignment_window'));
  assert.equal(f.db.campaigns[0].accrued_spend, 0);
});

test('a play that rendered in full but failed a billing check is reported as rendered, not as a failure', () => {
  const f = deviceFixture();
  const first = f.call('POST','play', f.event({ seq_no: 1 }), f.paired.token);
  assert.equal(first.body.billable, true);
  // Same complete playback, but outside the assignment window: rendered, not billable.
  const late = f.call('POST','play', f.event({
    seq_no: 2, started_at_device: '2026-09-23T18:00:00.000Z', ended_at_device: '2026-09-23T18:00:10.000Z',
  }), f.paired.token);
  assert.equal(late.body.billable, false);
  assert.equal(f.db.plays.find(p => p.seq_no === 2).rendered, true);
  assert.equal(f.db.plays.find(p => p.seq_no === 1).rendered, true);
});

test('a device-claimed clock offset cannot buy a billing window', () => {
  const f = deviceFixture();
  // Six hours in the "past" by the device's own clock, with a matching offset claimed to cover it.
  const r = f.call('POST','play', f.event({
    started_at_device: '2026-09-23T18:00:00.000Z', ended_at_device: '2026-09-23T18:00:10.000Z',
    server_clock_offset_ms: 6 * 3600e3,
  }), f.paired.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.billable, false);
  assert.ok((r.body.nonbillable_reasons || []).includes('clock_or_assignment_window'));
  assert.equal(f.db.campaigns[0].accrued_spend, 0);
});


test('an exhausted assignment stays exhausted however many others follow it', () => {
  // Codex's counterexample: exhaust one assignment, push many others through the device, then resubmit the
  // original playback with a fresh id. The ledger must still refuse it — and the hourly quota must not be
  // what refuses it, so the churn is deliberately placed in later playback hours.
  const f = deviceFixture();
  let seq = 0, blocked = false;
  for (let i = 0; i < 400 && !blocked; i++) {
    const r = f.call('POST','play', f.event({ seq_no: ++seq }), f.paired.token);
    blocked = !r.body.billable && (r.body.nonbillable_reasons || []).includes('assignment_replay_cap');
  }
  assert.ok(blocked, 'the assignment should run out of its own allowance');
  for (let hour = 1; hour <= 60; hour++) {           // 60 fresh assignment sets, each in its own hour
    f.advance(3600e3 + 1000);
    const other = f.call('GET','playlist/screen1', {}, f.paired.token).body.items[0];
    assert.notEqual(other.assignment_id, f.assignment.assignment_id);
    const at = Date.parse('2026-09-24T00:00:00.000Z') + hour * 3600e3;
    f.call('POST','play', f.event({ seq_no: ++seq, assignment_id: other.assignment_id,
      started_at_device: new Date(at).toISOString(), ended_at_device: new Date(at + 10e3).toISOString() }), f.paired.token);
  }
  const again = f.call('POST','play', f.event({ seq_no: ++seq }), f.paired.token);
  assert.equal(again.body.billable, false, 'the exhausted assignment must stay exhausted');
  assert.ok((again.body.nonbillable_reasons || []).includes('assignment_replay_cap'),
    'and it must be the assignment ledger that refuses it: ' + JSON.stringify(again.body.nonbillable_reasons));
});

test('polling the playlist does not mint new assignments', () => {
  // Unbounded assignment rows are what forced the ledger to evict in the first place.
  const f = deviceFixture();
  const first = f.call('GET','playlist/screen1', {}, f.paired.token).body.items[0].assignment_id;
  f.advance(60e3);
  const second = f.call('GET','playlist/screen1', {}, f.paired.token).body.items[0].assignment_id;
  assert.equal(second, first, 'the same playlist under the same config keeps its assignments');
  f.advance(3600e3 + 1000);
  const third = f.call('GET','playlist/screen1', {}, f.paired.token).body.items[0].assignment_id;
  assert.notEqual(third, first, 'and a new one is issued once the old set expires');
});

test('a backlog uploaded hours later is still billable', () => {
  // A box offline all morning flushes real plays long afterwards. Airtime is charged to the hour the
  // playback happened in, so a genuine backlog bills in full.
  const f = deviceFixture();
  let clock = Date.parse('2026-09-24T00:00:00.000Z') + 11000;   // deviceFixture advances 11s at creation
  const pending = [];
  for (let block = 0; block < 10; block++) {
    f.advance(600e3); clock += 600e3;
    const assignment = f.call('GET','playlist/screen1', {}, f.paired.token).body.items[0].assignment_id;
    for (let i = 0; i < 40; i++) {
      const at = clock + i * 10e3;                               // ten-second plays, none overlapping
      pending.push({ assignment, at });
    }
  }
  f.advance(3 * 3600e3);                                          // ... and only now does the box get online
  let seq = 0, billed = 0, quotaRefusals = 0;
  for (const item of pending) {
    const r = f.call('POST','play', f.event({
      seq_no: ++seq, assignment_id: item.assignment,
      started_at_device: new Date(item.at).toISOString(),
      ended_at_device: new Date(item.at + 10e3).toISOString(),
    }), f.paired.token);
    assert.equal(r.status, 200);
    if (r.body.billable) billed++;
    if ((r.body.nonbillable_reasons || []).includes('device_throughput_exceeded')) quotaRefusals++;
  }
  assert.equal(quotaRefusals, 0, 'non-overlapping real playback must never hit the airtime quota');
  assert.equal(billed, 400, 'every valid report in a real backlog must bill');
});

test('an assignment is reused only while everything it freezes is unchanged', () => {
  // The served playlist and the evidence the play is checked against must never disagree. Each field the
  // assignment row freezes gets its own invalidation check.
  const changes = [
    ['a different video', p => { p.items[0].youtube_id = 'replacement-video'; }],
    ['a different rate', p => { p.items[0].rate_value = 99; }],
    ['a different duration', p => { p.items[0].duration_s = 20; }],
    ['a different creative', p => { p.items[0].creative_id = 'creative2'; }],
    ['a changed config version', p => { p.config_version = 4; }],
    ['changed measurement settings', p => { p.config.count_ceiling = 12; }],
  ];
  for (const [what, mutate] of changes) {
    const f = deviceFixture();
    const before = f.call('GET','playlist/screen1', {}, f.paired.token).body.items[0];
    f.mutatePlaylist(mutate);
    const after = f.call('GET','playlist/screen1', {}, f.paired.token).body.items[0];
    assert.notEqual(after.assignment_id, before.assignment_id, what + ' must issue a new assignment');
    const row = f.db.device_assignments.find(a => a.id === after.assignment_id);
    assert.equal(row.youtube_id, after.youtube_id ?? null, 'evidence must match what was served: ' + what);
    assert.equal(row.rate_value, after.rate_value ?? 0);
    assert.equal(row.duration_s, after.duration_s);
    assert.equal(row.creative_id, after.creative_id);
  }
});
