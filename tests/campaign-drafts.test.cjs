const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const clone = x => JSON.parse(JSON.stringify(x));

// Same in-memory API fixture as tests/integration-inventory.test.cjs: the real dispatcher, authorization
// and inventory code, with the store replaced by a cloned in-memory snapshot.
function fixture() {
  const env = { NODE_ENV: 'test', GC_DEMO_PASSWORD: crypto.randomBytes(24).toString('hex'), GC_AUTH_SECRET: crypto.randomBytes(32).toString('hex') };
  let saved = null;
  class StoreError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const store = { StoreError, transact: async (_c, fn) => fn(), mode: 'memory', read: async () => saved && clone(saved), write: async v => { saved = clone(v); } };
  const cache = {};
  function load(file) {
    file = path.resolve(file);
    if (cache[file]) return cache[file].exports;
    const mod = { exports: {} }; cache[file] = mod;
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', 'process', code)(name => name === './store' ? store
      : name.startsWith('.') ? load(path.join(path.dirname(file), name + '.ts')) : require(name), mod, mod.exports, { env, cwd: () => root });
    return mod.exports;
  }
  const auth = load(path.join(root, 'lib/auth.ts'));
  saved = load(path.join(root, 'lib/seed.ts')).seed();
  saved.campaigns = []; saved.plays = []; saved.presence = []; saved.configs = [];
  const api = load(path.join(root, 'lib/api.ts'));
  const drafts = load(path.join(root, 'lib/campaign-drafts.ts'));
  const call = async (method, route, body = {}, token) => {
    const [p, q] = route.split('?');
    const r = await api.handle(method, p.split('/'), new URLSearchParams(q || ''), body, token);
    return { ...r, status: r.status || 200 };
  };
  return { call, drafts, data: () => clone(saved), change: fn => fn(saved), token: id => auth.issueToken(saved.users.find(u => u.id === id)) };
}
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const screenInput = (patch = {}) => ({ org_id: 'org_sec17', name: 'Draft test screen', venue_name: 'Cafe', address: 'Chandigarh', venue_type: 'cafe', size_in: '43', orientation: 'landscape', loop_length_s: 600, slot_duration_s: 10, advertiser_slots: 10, operating_hours: { from: '00:00', to: '00:00' }, ...patch });
async function screen(f, patch) { return ok(await f.call('POST', 'screens', screenInput(patch), f.token('u_op1')), 201).screen; }
const complete = (sid, patch = {}) => Object.fromEntries(Object.entries({ name: 'Draft campaign', starts_at: '2026-01-01', ends_at: '2027-12-31', screen_ids: [sid], bookings: [{ screen_id: sid, rotation_weight: 2 }], creative_ids: ['cr_fit_b'], rate_type: 'per_play', rate_value: 2, committed_budget: 1000, ...patch }).filter(([, v]) => v !== undefined));
async function draft(f, body = {}, user = 'u_op1') { return ok(await f.call('POST', 'campaign-draft', { campaign_type: 'operator', ...body }, f.token(user))); }
async function save(f, d, body, user = 'u_op1') { return f.call('POST', `campaign-draft/${d.id}`, { revision: d.revision, ...body }, f.token(user)); }

test('save at Basics with only a name; missing values stay absent, never zero; resume returns the saved step', async () => {
  const f = fixture();
  const d = await draft(f, { fields: { name: 'Only a name' } });
  assert.equal(d.org_id, 'org_sec17'); assert.equal(d.created_by, 'u_op1'); assert.equal(d.step, 'basics'); assert.equal(d.revision, 1);
  assert.equal(d.advertiser_id, null); assert.equal(d.submitted_campaign_id, null);
  assert.deepEqual(d.fields, { name: 'Only a name' });
  for (const key of ['rate_value', 'committed_budget', 'screen_ids', 'creative_ids', 'starts_at']) assert.equal(Object.hasOwn(d.fields, key), false, key);
  assert.ok(Date.parse(d.expires_at) - Date.parse(d.updated_at) === 30 * 86400000);
  const s = await screen(f);
  const saved = ok(await save(f, d, { step: 'screens', advertiser_id: 'adv_fitline', fields: { screen_ids: [s.id] } }));
  assert.equal(saved.revision, 2); assert.equal(saved.step, 'screens'); assert.deepEqual(saved.fields, { name: 'Only a name', screen_ids: [s.id] });
  const resumed = ok(await f.call('GET', `campaign-draft/${d.id}`, {}, f.token('u_op1')));
  assert.equal(resumed.step, 'screens'); assert.equal(Object.hasOwn(resumed.fields, 'committed_budget'), false);
  // Explicit zero is a value; null clears it back to absent.
  const zero = ok(await save(f, resumed, { fields: { committed_budget: 0 } })); assert.equal(zero.fields.committed_budget, 0);
  const cleared = ok(await save(f, zero, { fields: { committed_budget: null, name: null } }));
  assert.equal(Object.hasOwn(cleared.fields, 'committed_budget'), false); assert.equal(Object.hasOwn(cleared.fields, 'name'), false);
  const list = ok(await f.call('GET', 'campaign-drafts', {}, f.token('u_op1'))).items;
  assert.deepEqual(list.map(x => x.id), [d.id]);
  assert.equal(f.data().campaigns.length, 0, 'drafts are never campaigns');
});

test('validation kept on drafts: types, unknown keys, organisation, advertiser, screens, creatives and network type', async () => {
  const f = fixture(), s = await screen(f);
  const d = await draft(f);
  const bad = async (body, status, user = 'u_op1') => assert.equal((await save(f, d, body, user)).status, status, JSON.stringify(body));
  await bad({ surprise: 1 }, 400);
  await bad({ fields: { status: 'active' } }, 400);
  await bad({ fields: { name: 'x'.repeat(201) } }, 400);
  await bad({ fields: { starts_at: '2026-02-30' } }, 400);
  await bad({ fields: { starts_at: '2026-99-99' } }, 400);
  await bad({ fields: { ends_at: '2026-13-01' } }, 400);
  await bad({ fields: { ends_at: '01/02/2026' } }, 400);
  await bad({ fields: { committed_budget: -1 } }, 400);
  await bad({ fields: { rate_value: '2' } }, 400);
  await bad({ fields: { screen_ids: [s.id], bookings: [{ screen_id: s.id, rotation_weight: 1.5 }] } }, 400);
  await bad({ fields: { bookings: [{ screen_id: s.id, rotation_weight: 1 }] } }, 400); // booking for an unselected screen
  await bad({ fields: { dayparts: [{ from: '9am', to: '21:00' }] } }, 400);
  await bad({ step: 'launch' }, 400);
  await bad({ advertiser_id: 'adv_mobile' }, 400); // another organisation's advertiser
  await bad({ fields: { creative_ids: ['cr_fit_b'] } }, 400); // creatives need an advertiser first
  await bad({ advertiser_id: 'adv_dental', fields: { creative_ids: ['cr_fit_b'] } }, 400); // creative of another advertiser
  const tricity = f.data().screens.find(x => x.org_id === 'org_tricity');
  await bad({ fields: { screen_ids: [tricity.id] } }, 404); // not visible to this organisation
  await bad({ campaign_type: 'network' }, 403);
  await bad({ revision: 99, fields: { name: 'ok' } }, 409); // wrong revision is 409; missing revision is 400
  assert.equal((await f.call('POST', `campaign-draft/${d.id}`, { fields: { name: 'ok' } }, f.token('u_op1'))).status, 400);
  f.change(db => { db.creatives.push({ id: 'cr_filler', org_id: 'org_sec17', purpose: 'filler', name: 'Filler', approval_status: 'approved' }); db.advertisers.find(a => a.id === 'adv_coach').status = 'archived'; });
  await bad({ advertiser_id: 'adv_fitline', fields: { creative_ids: ['cr_filler'] } }, 400);
  await bad({ advertiser_id: 'adv_coach' }, 409);
  // Creation applies the same rules.
  assert.equal((await f.call('POST', 'campaign-draft', { campaign_type: 'operator', org_id: 'org_tricity' }, f.token('u_op1'))).status, 404);
  assert.equal((await f.call('POST', 'campaign-draft', { campaign_type: 'sideways' }, f.token('u_op1'))).status, 400);
  assert.equal((await f.call('POST', 'campaign-draft', {}, f.token('u_op1'))).status, 400);
  assert.equal((await f.call('POST', 'campaign-draft', { campaign_type: 'operator', status: 'active' }, f.token('u_op1'))).status, 400);
  assert.equal((await f.call('POST', 'campaign-draft', { campaign_type: 'operator', fields: { rate_value: Infinity } }, f.token('u_op1'))).status, 400);
  assert.equal(ok(await f.call('GET', `campaign-draft/${d.id}`, {}, f.token('u_op1'))).revision, 1, 'failed saves change nothing');
  // Network drafts are admin-only and must originate from the Gridcast organisation.
  assert.equal((await f.call('POST', 'campaign-draft', { campaign_type: 'network', org_id: 'org_sec17' }, f.token('u_admin'))).status, 403);
  const net = ok(await f.call('POST', 'campaign-draft', { campaign_type: 'network', org_id: 'org_gridcast', advertiser_id: 'adv_zept', fields: { screen_ids: [tricity.id, s.id], creative_ids: ['cr_zep_a'] } }, f.token('u_admin')));
  assert.equal(net.org_id, 'org_gridcast');
  assert.equal((await save(f, net, { fields: { rate_type: 'flat' } }, 'u_admin')).status, 400);
});

test('draft calendar validation rejects malformed dates without mutation and accepts leap day', async () => {
  const f = fixture();
  const d = await draft(f, { fields: { name: 'Calendar check' } });
  const before = f.data().campaign_drafts.find(x => x.id === d.id);
  assert.equal((await save(f, d, { fields: { starts_at: '2026-99-99' } })).status, 400);
  assert.equal((await f.call('POST', 'campaign-draft', { campaign_type: 'operator', fields: { ends_at: '2026-13-01' } }, f.token('u_op1'))).status, 400);
  assert.deepEqual(f.data().campaign_drafts.find(x => x.id === d.id), before);
  assert.equal(f.data().campaign_drafts.length, 1);
  const saved = ok(await save(f, d, { fields: { starts_at: '2024-02-29' } }));
  assert.equal(saved.fields.starts_at, '2024-02-29');
});

test('roles without sales, other users and other organisations cannot see or touch a draft (404, not 403)', async () => {
  const f = fixture();
  const d = await draft(f, { fields: { name: 'Private draft' } });
  for (const user of ['u_adv1', 'u_op5']) {
    assert.equal((await f.call('POST', 'campaign-draft', { campaign_type: 'operator' }, f.token(user))).status, 403);
    assert.equal((await f.call('GET', `campaign-draft/${d.id}`, {}, f.token(user))).status, 403);
  }
  for (const user of ['u_op3', 'u_op4', 'u_op2', 'u_admin']) {
    assert.equal((await f.call('GET', `campaign-draft/${d.id}`, {}, f.token(user))).status, 404, user);
    assert.equal((await save(f, d, { fields: { name: 'stolen' } }, user)).status, 404, user);
    assert.equal((await f.call('POST', `campaign-draft/${d.id}/submit`, { mode: 'submit' }, f.token(user))).status, 404, user);
    assert.equal((await f.call('POST', `campaign-draft/${d.id}/discard`, {}, f.token(user))).status, 404, user);
    assert.deepEqual(ok(await f.call('GET', 'campaign-drafts', {}, f.token(user))).items, [], user);
  }
  // An admin's draft for an organisation is invisible to that organisation's users.
  const adminDraft = ok(await f.call('POST', 'campaign-draft', { campaign_type: 'operator', org_id: 'org_sec17' }, f.token('u_admin')));
  assert.equal(adminDraft.org_id, 'org_sec17');
  assert.equal((await f.call('GET', `campaign-draft/${adminDraft.id}`, {}, f.token('u_op1'))).status, 404);
  assert.deepEqual(ok(await f.call('GET', 'campaign-drafts?org=org_tricity', {}, f.token('u_admin'))).items, []);
  assert.deepEqual(ok(await f.call('GET', 'campaign-drafts?org=org_sec17', {}, f.token('u_admin'))).items.map(x => x.id), [adminDraft.id]);
  assert.equal((await f.call('GET', 'campaign-drafts?org=org_tricity', {}, f.token('u_op1'))).status, 404);
  assert.equal(ok(await f.call('GET', `campaign-draft/${d.id}`, {}, f.token('u_op1'))).fields.name, 'Private draft');
});

test('a stale tab cannot overwrite a newer save, and an expired draft behaves as not found', async () => {
  const f = fixture();
  const d = await draft(f, { fields: { name: 'First' } });
  const second = ok(await save(f, d, { fields: { name: 'Second' } }));
  const stale = await save(f, d, { fields: { name: 'Stale tab' } });
  assert.equal(stale.status, 409); assert.equal(stale.body.revision, 2);
  assert.equal(ok(await f.call('GET', `campaign-draft/${d.id}`, {}, f.token('u_op1'))).fields.name, 'Second');
  f.change(db => { db.campaign_drafts.find(x => x.id === d.id).expires_at = new Date(Date.now() - 1000).toISOString(); });
  assert.equal((await f.call('GET', `campaign-draft/${d.id}`, {}, f.token('u_op1'))).status, 404);
  assert.equal((await save(f, second, { fields: { name: 'Late' } })).status, 404);
  assert.equal((await f.call('POST', `campaign-draft/${d.id}/submit`, { mode: 'submit' }, f.token('u_op1'))).status, 404);
  assert.deepEqual(ok(await f.call('GET', 'campaign-drafts', {}, f.token('u_op1'))).items, []);
});

test('submit with a missing field names it and creates nothing; double submit creates exactly one pending campaign', async () => {
  const f = fixture(), s = await screen(f);
  const d = await draft(f, { advertiser_id: 'adv_fitline', fields: complete(s.id, { committed_budget: undefined }) });
  assert.equal(Object.hasOwn(d.fields, 'committed_budget'), false);
  const missing = await f.call('POST', `campaign-draft/${d.id}/submit`, { mode: 'submit' }, f.token('u_op1'));
  assert.equal(missing.status, 400); assert.match(missing.body.error, /committed budget.*committed_budget/);
  assert.equal(f.data().campaigns.length, 0);
  assert.deepEqual(f.data().campaign_drafts.find(x => x.id === d.id), d, 'a failed submit leaves the draft unchanged');
  for (const [field, pattern] of [['name', /name/], ['starts_at', /start date/], ['screen_ids', /screens/], ['creative_ids', /creatives/], ['rate_value', /rate per play/]]) {
    const other = await draft(f, { advertiser_id: 'adv_fitline', fields: complete(s.id, { [field]: undefined, ...(field === 'screen_ids' ? { bookings: undefined } : {}) }) });
    const r = await f.call('POST', `campaign-draft/${other.id}/submit`, { mode: 'submit' }, f.token('u_op1'));
    assert.equal(r.status, 400, field); assert.match(r.body.error, pattern);
  }
  const noAdvertiser = await draft(f, { fields: complete(s.id, { creative_ids: undefined }) });
  assert.match((await f.call('POST', `campaign-draft/${noAdvertiser.id}/submit`, { mode: 'submit' }, f.token('u_op1'))).body.error, /advertiser/);
  const endBeforeStart = await draft(f, { advertiser_id: 'adv_fitline', fields: complete(s.id, { starts_at: '2027-01-02', ends_at: '2027-01-01' }) });
  assert.equal((await f.call('POST', `campaign-draft/${endBeforeStart.id}/submit`, { mode: 'submit' }, f.token('u_op1'))).status, 400);
  assert.equal(f.data().campaigns.length, 0);

  const ready = ok(await save(f, d, { step: 'review', fields: { committed_budget: 1000 } }));
  const first = ok(await f.call('POST', `campaign-draft/${d.id}/submit`, { mode: 'submit' }, f.token('u_op1')));
  assert.equal(first.campaign.id, f.drafts.draftCampaignId(d.id)); assert.equal(first.campaign.status, 'pending');
  assert.equal(first.campaign.name, 'Draft campaign'); assert.equal(first.campaign.committed_budget, 1000); assert.equal(first.campaign.org_id, 'org_sec17');
  assert.deepEqual(first.campaign.bookings.map(b => [b.screen_id, b.rotation_weight]), [[s.id, 2]]);
  assert.ok(first.campaign.bookings[0].rate_version, 'economics frozen by the existing create path');
  assert.equal(first.draft.submitted_campaign_id, first.campaign.id);
  const again = ok(await f.call('POST', `campaign-draft/${d.id}/submit`, { mode: 'submit' }, f.token('u_op1')));
  assert.equal(again.campaign.id, first.campaign.id); assert.equal(again.reused, true);
  assert.equal(f.data().campaigns.length, 1);
  assert.equal((await save(f, { ...ready, revision: first.draft.revision }, { fields: { name: 'after submit' } })).status, 409);
  assert.equal((await f.call('POST', `campaign-draft/${d.id}/discard`, {}, f.token('u_op1'))).status, 409);
  assert.deepEqual(ok(await f.call('GET', 'campaign-drafts', {}, f.token('u_op1'))).items.map(x => x.id).includes(d.id), false);
  assert.equal((await f.call('POST', `campaign-draft/${d.id}/submit`, { mode: 'sideways' }, f.token('u_op1'))).status, 400);
});

test('launch creates an active campaign only when every chosen creative is approved', async () => {
  const f = fixture(), s = await screen(f);
  const pending = await draft(f, { advertiser_id: 'adv_coach', fields: complete(s.id, { creative_ids: ['cr_coach_a'] }) });
  const blocked = await f.call('POST', `campaign-draft/${pending.id}/submit`, { mode: 'launch' }, f.token('u_op1'));
  assert.equal(blocked.status, 400); assert.match(blocked.body.error, /Launch needs every creative approved/);
  assert.equal(f.data().campaigns.length, 0);
  const waits = ok(await f.call('POST', `campaign-draft/${pending.id}/submit`, { mode: 'submit' }, f.token('u_op1')));
  assert.equal(waits.campaign.status, 'pending');
  const approved = await draft(f, { advertiser_id: 'adv_fitline', fields: complete(s.id, { name: 'Launch now' }) });
  const live = ok(await f.call('POST', `campaign-draft/${approved.id}/submit`, { mode: 'launch' }, f.token('u_op1')));
  assert.equal(live.campaign.status, 'active');
  // Flat fee: the per-play rate is not applicable and the existing create path still requires a number.
  const flat = await draft(f, { advertiser_id: 'adv_dental', fields: complete(s.id, { name: 'Flat fee', creative_ids: ['cr_den_a'], rate_type: 'flat', rate_value: undefined }) });
  assert.equal(Object.hasOwn(flat.fields, 'rate_value'), false);
  assert.equal(ok(await f.call('POST', `campaign-draft/${flat.id}/submit`, { mode: 'submit' }, f.token('u_op1'))).campaign.rate_type, 'flat');
});

test('drafts hold no inventory and are invisible to playlist, eligibility, bootstrap, network inventory and inventory revalidation', async () => {
  const f = fixture(), full = await screen(f, { name: 'One advertiser screen', advertiser_slots: 1 });
  // A complete draft for one advertiser on a one-advertiser screen...
  const d = await draft(f, { advertiser_id: 'adv_dental', fields: complete(full.id, { creative_ids: ['cr_den_a'] }) });
  // ...does not block another advertiser's booking.
  const booked = ok(await f.call('POST', 'campaign', { org_id: 'org_sec17', advertiser_id: 'adv_fitline', name: 'Real booking', starts_at: '2026-01-01', ends_at: '2027-12-31', status: 'active', committed_budget: 1000, rate_type: 'per_play', rate_value: 2, screen_ids: [full.id], creative_ids: ['cr_fit_b'] }, f.token('u_op1')));
  assert.equal(booked.status, 'active');
  // The draft itself is checked for capacity only at submit, where it now fails and creates nothing.
  const rejected = await f.call('POST', `campaign-draft/${d.id}/submit`, { mode: 'submit' }, f.token('u_op1'));
  assert.equal(rejected.status, 409, JSON.stringify(rejected.body)); assert.equal(f.data().campaigns.length, 1);
  assert.equal(f.data().campaign_drafts.find(x => x.id === d.id).submitted_campaign_id, null);
  // An incomplete draft (no dates) never reaches validateInventory, which runs on every creative edit.
  await draft(f, { advertiser_id: 'adv_fitline', fields: { screen_ids: [full.id], creative_ids: ['cr_fit_a'] } });
  ok(await f.call('POST', 'creative/cr_fit_a', { name: 'Renamed while a draft exists' }, f.token('u_op1')));
  const detail = ok(await f.call('GET', `screen/${full.id}`, {}, f.token('u_op1')));
  assert.deepEqual([...new Set(detail.eligibility.map(x => x.campaign_id))], [booked.id]);
  assert.deepEqual(detail.campaigns.map(c => c.id), [booked.id]);
  for (const [user, route] of [['u_op1', 'bootstrap'], ['u_admin', 'bootstrap'], ['u_admin', 'bootstrap?org=org_sec17'], ['u_admin', 'network-inventory'], ['u_adv1', 'bootstrap']]) {
    const body = JSON.stringify(ok(await f.call('GET', route, {}, f.token(user))));
    assert.equal(body.includes('cdr_'), false, `${route} leaked a draft for ${user}`);
    assert.equal(body.includes(f.drafts.draftCampaignId(d.id)), false);
  }
  const directory = JSON.stringify(ok(await f.call('GET', 'directory?entity=campaigns', {}, f.token('u_admin'))));
  assert.equal(directory.includes('cdr_'), false);
  // Discard removes the draft for good.
  ok(await f.call('POST', `campaign-draft/${d.id}/discard`, {}, f.token('u_op1')));
  assert.equal((await f.call('GET', `campaign-draft/${d.id}`, {}, f.token('u_op1'))).status, 404);
});
