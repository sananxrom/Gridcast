const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const clone = x => JSON.parse(JSON.stringify(x));
const { campaignStatus } = require('./load-lib.cjs')('campaign-status');

// Doc 31 Phase 5: submit, review, activate. Same in-memory API fixture as tests/campaign-drafts.test.cjs:
// the real dispatcher, authorization and inventory code with the store replaced by a cloned snapshot.
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
  const call = async (method, route, body = {}, token) => {
    const [p, q] = route.split('?');
    const r = await api.handle(method, p.split('/'), new URLSearchParams(q || ''), body, token);
    return { ...r, status: r.status || 200 };
  };
  const token = id => auth.issueToken(saved.users.find(u => u.id === id));
  return { call, data: () => clone(saved), change: fn => fn(saved), token };
}
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const denied = (r, status) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const screenInput = (patch = {}) => ({ org_id: 'org_sec17', name: 'Review test screen', venue_name: 'Cafe', address: 'Chandigarh', venue_type: 'cafe', size_in: '43', orientation: 'landscape', loop_length_s: 600, slot_duration_s: 10, advertiser_slots: 10, operating_hours: { from: '00:00', to: '00:00' }, ...patch });
async function setup(f) {
  const screen = ok(await f.call('POST', 'screens', screenInput(), f.token('u_op1')), 201).screen;
  return screen.id;
}
async function pendingCreative(f, name = 'Pending spot', user = 'u_op1') {
  return ok(await f.call('POST', 'creative', { org_id: 'org_sec17', advertiser_id: 'adv_fitline', name, category: 'fitness', youtube_id: 'aqz-KE-bpKQ', duration_s: 10, aspect: '16:9' }, f.token(user)));
}
const campaignBody = (sid, patch = {}) => ({ org_id: 'org_sec17', advertiser_id: 'adv_fitline', name: 'Review campaign', starts_at: '2026-01-01', ends_at: '2027-12-31', committed_budget: 1000, rate_type: 'per_play', rate_value: 2, screen_ids: [sid], creative_ids: ['cr_fit_b'], ...patch });
async function campaign(f, sid, patch = {}, user = 'u_op1') { return ok(await f.call('POST', 'campaign', campaignBody(sid, patch), f.token(user))); }
const find = (f, id) => f.data().campaigns.find(c => c.id === id);
const creative = (f, id) => f.data().creatives.find(c => c.id === id);
const statusOf = (f, id) => { const d = f.data(), c = d.campaigns.find(x => x.id === id); return campaignStatus({ campaign: c, creatives: d.creatives, screens: d.screens, advertiser: d.advertisers.find(a => a.id === c.advertiser_id) }); };

test('POST /campaign defaults to pending, never active; explicit active needs every assigned creative approved', async () => {
  const f = fixture(), sid = await setup(f), cr = await pendingCreative(f);
  const defaulted = await campaign(f, sid);
  assert.equal(defaulted.status, 'pending'); assert.equal(defaulted.review, undefined);
  denied(await f.call('POST', 'campaign', campaignBody(sid, { status: 'active', creative_ids: [cr.id] }), f.token('u_op1')), 409);
  denied(await f.call('POST', 'campaign', campaignBody(sid, { status: 'active', creative_ids: ['cr_fit_b', cr.id] }), f.token('u_op4')), 409);
  denied(await f.call('POST', 'campaign', campaignBody(sid, { status: 'active', creative_ids: [] }), f.token('u_op1')), 409);
  denied(await f.call('POST', 'campaign', campaignBody(sid, { status: 'paused' }), f.token('u_op1')), 400);
  denied(await f.call('POST', 'campaign', campaignBody(sid, { review: { state: 'approved_not_started' } }), f.token('u_op1')), 400);
  // Launch path: every creative approved still revalidates (an ended campaign cannot start active).
  denied(await f.call('POST', 'campaign', campaignBody(sid, { status: 'active', starts_at: '2026-01-01', ends_at: '2026-03-31' }), f.token('u_op1')), 409);
  const launched = await campaign(f, sid, { status: 'active' });
  assert.equal(launched.status, 'active');
  assert.equal(f.data().campaigns.filter(c => c.status === 'active').length, 1);
});

test('bypass closed: a pending campaign cannot go active through the generic edit, a paused detour or activate with a pending creative', async () => {
  const f = fixture(), sid = await setup(f), cr = await pendingCreative(f);
  const c = await campaign(f, sid, { creative_ids: ['cr_fit_b', cr.id] }, 'u_op4');
  for (const user of ['u_op4', 'u_op1', 'u_admin']) {
    denied(await f.call('POST', `campaign/${c.id}`, { status: 'active' }, f.token(user)), 409);
    denied(await f.call('POST', `campaign/${c.id}`, { status: 'paused' }, f.token(user)), 409);
    denied(await f.call('POST', `campaign/${c.id}/activate`, {}, f.token(user)), 409);
  }
  const after = find(f, c.id);
  assert.equal(after.status, 'pending'); assert.equal(after.review, undefined);
  assert.equal(creative(f, cr.id).approval_status, 'pending');
  // A draft cannot be pushed to active either, and a closed campaign cannot be reopened.
  const draft = await campaign(f, sid, { status: 'draft', name: 'Draft' });
  denied(await f.call('POST', `campaign/${draft.id}`, { status: 'active' }, f.token('u_op1')), 409);
  // Launch from a draft with a pending creative is refused (UI Launch path).
  const d = ok(await f.call('POST', 'campaign-draft', { campaign_type: 'operator', advertiser_id: 'adv_fitline', step: 'review', fields: { name: 'Draft launch', starts_at: '2026-01-01', ends_at: '2027-12-31', screen_ids: [sid], creative_ids: [cr.id], rate_type: 'per_play', rate_value: 2, committed_budget: 1000 } }, f.token('u_op1')));
  denied(await f.call('POST', `campaign-draft/${d.id}/submit`, { mode: 'launch' }, f.token('u_op1')), 400);
  // active ↔ paused, → complete and → cancelled stay allowed under current rules.
  const live = await campaign(f, sid, { status: 'active', name: 'Live' });
  assert.equal(ok(await f.call('POST', `campaign/${live.id}`, { status: 'paused' }, f.token('u_op4'))).status, 'paused');
  assert.equal(ok(await f.call('POST', `campaign/${live.id}`, { status: 'active' }, f.token('u_op4'))).status, 'active');
  assert.equal(ok(await f.call('POST', `campaign/${live.id}`, { status: 'complete' }, f.token('u_op4'))).status, 'complete');
  denied(await f.call('POST', `campaign/${live.id}`, { status: 'active' }, f.token('u_op4')), 409);
  assert.equal(ok(await f.call('POST', `campaign/${draft.id}`, { status: 'cancelled' }, f.token('u_op1'))).status, 'cancelled');
});

test('submit → review → active in one reviewer call, with permissions, idempotent repeats and audit entries', async () => {
  const f = fixture(), sid = await setup(f), cr = await pendingCreative(f);
  const other = await campaign(f, sid, { name: 'Other pending use', creative_ids: [cr.id] });
  const c = await campaign(f, sid, { creative_ids: [cr.id], status: 'draft' }, 'u_op4');
  denied(await f.call('POST', `campaign/${c.id}/submit`, { note: 'x' }, f.token('u_op4')), 400);
  denied(await f.call('POST', `campaign/${c.id}/submit`, {}, f.token('u_adv1')), 403);
  denied(await f.call('POST', `campaign/${c.id}/submit`, {}, f.token('u_op5')), 403);
  denied(await f.call('POST', `campaign/${c.id}/submit`, {}, f.token('u_op2')), 404);
  const submitted = ok(await f.call('POST', `campaign/${c.id}/submit`, {}, f.token('u_op4'))).campaign;
  assert.equal(submitted.status, 'pending'); assert.equal(submitted.review.state, 'in_review'); assert.equal(submitted.review.submitted_by, 'u_op4');
  assert.ok(find(f, c.id).bookings.every(b => b.econ_version && b.booked_at), 'submit froze bookings like create/update');
  const again = ok(await f.call('POST', `campaign/${c.id}/submit`, {}, f.token('u_op4')));
  assert.equal(again.unchanged, true); assert.equal(again.campaign.review.submitted_at, submitted.review.submitted_at);
  assert.equal(statusOf(f, c.id).label, 'In review');

  // Queue: platform only; the submitted campaign with its pending creative and reuse counts.
  denied(await f.call('GET', 'review-queue', {}, f.token('u_op1')), 403);
  denied(await f.call('GET', 'review-queue', {}, f.token('u_op4')), 403);
  const queue = ok(await f.call('GET', 'review-queue', {}, f.token('u_admin')));
  const item = queue.items.find(i => i.campaign.id === c.id);
  assert.equal(item.reason, 'submitted'); assert.equal(item.campaign.screens, 1); assert.equal(item.campaign.advertiser_name, 'Fitline Gym');
  assert.deepEqual(item.creatives.map(x => x.id), [cr.id]);
  assert.deepEqual(item.creatives[0].usage, { other_campaigns: 1, other_active: 0 });
  // The other campaign is pending with a pending creative but was never submitted: its owner must submit it, so it is
  // not in the queue (and is not presented as a changed creative).
  assert.equal(queue.items.some(i => i.campaign.id === other.id), false);

  // Operators (including the campaign's own owner) cannot review.
  for (const user of ['u_op1', 'u_op4', 'u_op2']) denied(await f.call('POST', `campaign/${c.id}/review`, { creatives: { [cr.id]: 'approved' } }, f.token(user)), 403);
  denied(await f.call('POST', `campaign/${c.id}/review`, { creatives: { cr_fit_a: 'approved' } }, f.token('u_admin')), 400);
  denied(await f.call('POST', `campaign/${c.id}/review`, { creatives: { [cr.id]: 'pending' } }, f.token('u_admin')), 400);
  denied(await f.call('POST', `campaign/${c.id}/review`, { creatives: { [cr.id]: 'approved' }, status: 'active' }, f.token('u_admin')), 400);
  denied(await f.call('POST', `campaign/${c.id}/review`, { creatives: { [cr.id]: 'approved' }, note: 'x'.repeat(1001) }, f.token('u_admin')), 400);
  assert.equal(creative(f, cr.id).approval_status, 'pending');

  const reviewed = ok(await f.call('POST', `campaign/${c.id}/review`, { creatives: { [cr.id]: 'approved' } }, f.token('u_admin')));
  assert.deepEqual(reviewed.activation, { attempted: true, activated: true, error: null });
  assert.equal(reviewed.creatives[0].approval_status, 'approved'); assert.equal(reviewed.creatives[0].changed, true);
  const live = find(f, c.id);
  assert.equal(live.status, 'active'); assert.equal(live.review, undefined);
  const approved = creative(f, cr.id);
  assert.equal(approved.approval_status, 'approved'); assert.ok(Date.parse(approved.approved_at));
  // Approval is stored on the creative only: the reused creative is now approved for the other campaign too,
  // which stays pending (no stored campaign-level approval, no automatic start).
  assert.equal(find(f, other.id).status, 'pending');
  assert.equal(ok(await f.call('GET', 'review-queue', {}, f.token('u_admin'))).items.some(i => i.campaign.id === c.id), false);

  // Idempotent repeats: no second write of approved_at, campaign stays active; activate on active is a no-op.
  const repeat = ok(await f.call('POST', `campaign/${c.id}/review`, { creatives: { [cr.id]: 'approved' } }, f.token('u_admin')));
  assert.equal(repeat.creatives[0].changed, false); assert.equal(repeat.activation.attempted, false); assert.equal(repeat.activation.activated, true);
  assert.equal(creative(f, cr.id).approved_at, approved.approved_at);
  const noop = ok(await f.call('POST', `campaign/${c.id}/activate`, {}, f.token('u_op4')));
  assert.equal(noop.unchanged, true); assert.equal(find(f, c.id).status, 'active');
  denied(await f.call('POST', `campaign/${c.id}/submit`, {}, f.token('u_op4')), 409);

  // Every transition left audit entries through the existing ledger.
  const audit = f.data().audit;
  const submitEntry = audit.find(a => a.action === `campaign/${c.id}/submit` && a.entity === 'campaigns');
  assert.equal(submitEntry.actor_id, 'u_op4'); assert.deepEqual(submitEntry.diff.status, { before: 'draft', after: 'pending' }); assert.deepEqual(submitEntry.diff.review, { changed: true });
  const reviewCampaign = audit.find(a => a.action === `campaign/${c.id}/review` && a.entity === 'campaigns' && a.entity_id === c.id);
  assert.equal(reviewCampaign.actor_id, 'u_admin'); assert.deepEqual(reviewCampaign.diff.status, { before: 'pending', after: 'active' });
  const reviewCreative = audit.find(a => a.action === `campaign/${c.id}/review` && a.entity === 'creatives' && a.entity_id === cr.id);
  assert.deepEqual(reviewCreative.diff.approval_status, { before: 'pending', after: 'approved' });
});

test('approval with an expired end date: creatives stay approved, campaign is Approved cannot start, no capacity or budget change', async () => {
  const f = fixture(), sid = await setup(f), cr = await pendingCreative(f);
  const c = await campaign(f, sid, { creative_ids: [cr.id], starts_at: '2026-01-01', ends_at: '2026-06-30' });
  ok(await f.call('POST', `campaign/${c.id}/submit`, {}, f.token('u_op1')));
  const before = f.data(), heldBookings = clone(before.campaigns.find(x => x.id === c.id).bookings), budgets = clone(before.campaign_budgets || []);
  const reviewed = ok(await f.call('POST', `campaign/${c.id}/review`, { creatives: { [cr.id]: 'approved' }, note: 'Content fine' }, f.token('u_admin')));
  assert.equal(reviewed.activation.attempted, true); assert.equal(reviewed.activation.activated, false);
  assert.match(reviewed.activation.error, /end date has passed/);
  const after = find(f, c.id);
  assert.equal(after.status, 'pending'); assert.equal(after.review.state, 'approved_not_started');
  assert.match(after.review.activation_error, /end date has passed/); assert.equal(after.review.decided_by, 'u_admin'); assert.equal(after.review.note, 'Content fine');
  assert.equal(creative(f, cr.id).approval_status, 'approved');
  assert.deepEqual(after.bookings, heldBookings, 'the pending hold is unchanged');
  assert.deepEqual(f.data().campaign_budgets || [], budgets, 'no budget ledger change');
  assert.match(statusOf(f, c.id).label, /^Not delivering · Approved, cannot start: The campaign end date has passed/);

  // Direct activate also fails, returns 409 with the reason and keeps (commits) the recorded state.
  const failed = await f.call('POST', `campaign/${c.id}/activate`, {}, f.token('u_op1'));
  denied(failed, 409); assert.equal(failed.commit, true); assert.match(failed.body.error, /end date has passed/);
  assert.equal(find(f, c.id).review.state, 'approved_not_started'); assert.equal(creative(f, cr.id).approval_status, 'approved');
  const audit = f.data().audit.filter(a => a.action === `campaign/${c.id}/activate`);
  assert.ok(audit.some(a => a.entity === 'campaigns'), 'failed activation is audited');

  // The seller fixes the dates (status unchanged) and activates again.
  ok(await f.call('POST', `campaign/${c.id}`, { ends_at: '2027-12-31' }, f.token('u_op1')));
  const activated = ok(await f.call('POST', `campaign/${c.id}/activate`, {}, f.token('u_op4')));
  assert.equal(activated.activation.activated, true);
  const live = find(f, c.id);
  assert.equal(live.status, 'active'); assert.equal(live.review, undefined);
  assert.ok(f.data().audit.some(a => a.action === `campaign/${c.id}/activate` && a.entity === 'campaigns' && a.diff.status?.after === 'active'));
});

test('activation revalidates capacity: a screen filled since submission leaves the campaign approved but not started', async () => {
  const f = fixture(), sid = await setup(f), cr = await pendingCreative(f);
  f.change(d => { d.screens.find(s => s.id === sid).advertiser_slots = 1; });
  const c = await campaign(f, sid, { creative_ids: [cr.id], status: 'draft' });
  ok(await f.call('POST', `campaign/${c.id}/submit`, {}, f.token('u_op1')));
  // Another advertiser's live booking now holds the only slot (as if capacity changed after submission).
  f.change(d => { d.campaigns.push({ ...clone(d.campaigns.find(x => x.id === c.id)), id: 'cmp_competitor', advertiser_id: 'adv_dental', creative_ids: ['cr_den_a'], status: 'active', review: undefined }); });
  const reviewed = ok(await f.call('POST', `campaign/${c.id}/review`, { creatives: { [cr.id]: 'approved' } }, f.token('u_admin')));
  assert.equal(reviewed.activation.activated, false); assert.match(reviewed.activation.error, /capacity/i);
  assert.equal(find(f, c.id).review.state, 'approved_not_started'); assert.equal(creative(f, cr.id).approval_status, 'approved');
});

test('changes needed: all rejected → changes_needed with note and hold kept; resubmit; mixed decisions activate', async () => {
  const f = fixture(), sid = await setup(f), a = await pendingCreative(f, 'Spot A'), b = await pendingCreative(f, 'Spot B');
  const c = await campaign(f, sid, { creative_ids: [a.id, b.id] });
  ok(await f.call('POST', `campaign/${c.id}/submit`, {}, f.token('u_op1')));
  // A partial decision keeps the campaign in review.
  const partial = ok(await f.call('POST', `campaign/${c.id}/review`, { creatives: { [a.id]: 'rejected' } }, f.token('u_admin')));
  assert.equal(partial.activation.attempted, false); assert.equal(find(f, c.id).review.state, 'in_review');
  ok(await f.call('POST', `campaign/${c.id}/review`, { creatives: { [b.id]: 'rejected' }, note: 'Logo is unreadable' }, f.token('u_admin')));
  const rejected = find(f, c.id);
  assert.equal(rejected.status, 'pending', 'changes_needed keeps its capacity hold'); assert.equal(rejected.review.state, 'changes_needed'); assert.equal(rejected.review.note, 'Logo is unreadable');
  assert.equal(statusOf(f, c.id).label, 'Changes needed');
  denied(await f.call('POST', `campaign/${c.id}/activate`, {}, f.token('u_op1')), 409);
  assert.equal(ok(await f.call('GET', 'review-queue', {}, f.token('u_admin'))).items.some(i => i.campaign.id === c.id), false);
  // The seller changes a creative (metadata change sends it back to pending) and resubmits.
  ok(await f.call('POST', `creative/${b.id}`, { category: 'gym' }, f.token('u_op1')));
  assert.equal(creative(f, b.id).approval_status, 'pending');
  assert.equal(ok(await f.call('POST', `campaign/${c.id}/submit`, {}, f.token('u_op1'))).campaign.review.state, 'in_review');
  // Mixed: one approved, one still rejected → activates; the rejected one is listed as a change needed.
  const mixed = ok(await f.call('POST', `campaign/${c.id}/review`, { creatives: { [b.id]: 'approved' } }, f.token('u_admin')));
  assert.equal(mixed.activation.activated, true); assert.deepEqual(mixed.rejected, [a.id]);
  assert.equal(find(f, c.id).status, 'active');
});

test('changed media on an approved creative puts its live campaigns into the queue as re-review; filler is listed separately', async () => {
  const f = fixture(), sid = await setup(f), sid2 = ok(await f.call('POST', 'screens', screenInput({ name: 'Second screen' }), f.token('u_op1')), 201).screen.id;
  const live = await campaign(f, sid, { status: 'active', name: 'Live A' });
  const live2 = await campaign(f, sid2, { status: 'active', name: 'Live B' });
  assert.equal(ok(await f.call('GET', 'review-queue', {}, f.token('u_admin'))).items.length, 0);
  // Re-upload/replacement and source edits reset approval (behaviour unchanged); now the campaigns show up.
  ok(await f.call('POST', 'creative/cr_fit_b', { source: 'youtube', youtube_id: 'M7lc1UVf-VE', duration_s: 12 }, f.token('u_op1')));
  assert.equal(creative(f, 'cr_fit_b').approval_status, 'pending');
  const queue = ok(await f.call('GET', 'review-queue', {}, f.token('u_admin')));
  const item = queue.items.find(i => i.campaign.id === live.id);
  assert.equal(item.reason, 're_review'); assert.equal(item.campaign.status, 'active');
  assert.deepEqual(item.creatives[0].usage, { other_campaigns: 1, other_active: 1 });
  assert.match(statusOf(f, live.id).label, /awaiting approval/);
  // Approving from the queue makes it eligible again; the active campaign needs no activation.
  const reviewed = ok(await f.call('POST', `campaign/${live.id}/review`, { creatives: { cr_fit_b: 'approved' } }, f.token('u_admin')));
  assert.equal(reviewed.activation.attempted, false); assert.equal(find(f, live.id).status, 'active'); assert.equal(find(f, live2.id).status, 'active');
  assert.equal(ok(await f.call('GET', 'review-queue', {}, f.token('u_admin'))).items.length, 0);
  // Filler creatives keep creative-only approval in their own list.
  const filler = ok(await f.call('POST', 'creative', { org_id: 'org_sec17', purpose: 'filler', name: 'House filler', category: 'house', media_type: 'image', duration_s: 20 }, f.token('u_op1')));
  const withFiller = ok(await f.call('GET', 'review-queue', {}, f.token('u_admin')));
  assert.deepEqual(withFiller.filler.map(x => x.id), [filler.id]); assert.equal(withFiller.items.length, 0);
  ok(await f.call('POST', `creative/${filler.id}/approve`, { status: 'approved' }, f.token('u_admin')));
  assert.equal(ok(await f.call('GET', 'review-queue', {}, f.token('u_admin'))).filler.length, 0);
});

test('draft submit lands in review; Launch with approved creatives is unchanged', async () => {
  const f = fixture(), sid = await setup(f), cr = await pendingCreative(f);
  const fields = (creatives) => ({ name: 'Flow campaign', starts_at: '2026-01-01', ends_at: '2027-12-31', screen_ids: [sid], bookings: [{ screen_id: sid, rotation_weight: 1 }], creative_ids: creatives, rate_type: 'per_play', rate_value: 2, committed_budget: 1000 });
  const d1 = ok(await f.call('POST', 'campaign-draft', { campaign_type: 'operator', advertiser_id: 'adv_fitline', step: 'review', fields: fields([cr.id]) }, f.token('u_op4')));
  const submitted = ok(await f.call('POST', `campaign-draft/${d1.id}/submit`, { mode: 'submit' }, f.token('u_op4'))).campaign;
  assert.equal(submitted.status, 'pending'); assert.equal(submitted.review.state, 'in_review'); assert.equal(submitted.review.submitted_by, 'u_op4');
  assert.equal(ok(await f.call('GET', 'review-queue', {}, f.token('u_admin'))).items.find(i => i.campaign.id === submitted.id).reason, 'submitted');
  const d2 = ok(await f.call('POST', 'campaign-draft', { campaign_type: 'operator', advertiser_id: 'adv_fitline', step: 'review', fields: fields(['cr_fit_b']) }, f.token('u_op4')));
  const launched = ok(await f.call('POST', `campaign-draft/${d2.id}/submit`, { mode: 'launch' }, f.token('u_op4'))).campaign;
  assert.equal(launched.status, 'active'); assert.equal(launched.review, undefined);
});

test('network campaigns: only platform admins submit, review and activate; participant operators cannot', async () => {
  const f = fixture();
  const net = ok(await f.call('POST', 'creative', { org_id: 'org_gridcast', advertiser_id: 'adv_zept', name: 'Network spot', category: 'fmcg', youtube_id: 'ScMzIvxBSi4', duration_s: 10, aspect: '16:9' }, f.token('u_admin')));
  const screens = f.data().screens.filter(s => s.network_available === true).map(s => s.id);
  const c = ok(await f.call('POST', 'campaign', { org_id: 'org_gridcast', advertiser_id: 'adv_zept', campaign_type: 'network', name: 'Network review', starts_at: '2026-01-01', ends_at: '2027-12-31', committed_budget: 1000, rate_type: 'per_play', rate_value: 1, screen_ids: screens, creative_ids: [net.id], bookings: screens.map(id => ({ screen_id: id, rotation_weight: 1 })) }, f.token('u_admin')));
  assert.equal(c.status, 'pending');
  for (const user of ['u_op1', 'u_op4']) {
    denied(await f.call('POST', `campaign/${c.id}/submit`, {}, f.token(user)), 403);
    denied(await f.call('POST', `campaign/${c.id}/activate`, {}, f.token(user)), 403);
    denied(await f.call('POST', `campaign/${c.id}/review`, { creatives: { [net.id]: 'approved' } }, f.token(user)), 403);
  }
  denied(await f.call('POST', `campaign/${c.id}/submit`, {}, f.token('u_op2')), 404);
  assert.equal(ok(await f.call('POST', `campaign/${c.id}/submit`, {}, f.token('u_admin'))).campaign.review.state, 'in_review');
  const reviewed = ok(await f.call('POST', `campaign/${c.id}/review`, { creatives: { [net.id]: 'approved' } }, f.token('u_admin')));
  assert.equal(reviewed.activation.activated, true);
  const live = find(f, c.id);
  assert.equal(live.status, 'active'); assert.ok(live.bookings.every(b => b.booked_at && b.econ_version));
});

test('re-review decisions change creatives only: never-submitted pending stays pending, active stays active; in_review still activates', async () => {
  const f = fixture(), sid = await setup(f), a = await pendingCreative(f, 'Never submitted spot'), b = await pendingCreative(f, 'Live spot'), c2 = await pendingCreative(f, 'Submitted spot');
  const pending = await campaign(f, sid, { creative_ids: [a.id], name: 'Never submitted' });
  const live = await campaign(f, sid, { status: 'active', name: 'Live' });
  ok(await f.call('POST', `campaign/${live.id}`, { creative_ids: ['cr_fit_b', b.id] }, f.token('u_op1')));
  const queue = ok(await f.call('GET', 'review-queue', {}, f.token('u_admin'))).items;
  assert.equal(queue.some(i => i.campaign.id === pending.id), false, 'never-submitted pending is not a re-review'); assert.equal(queue.find(i => i.campaign.id === live.id).reason, 're_review');
  // The creative-only review endpoint still accepts decisions for it; the queue just does not list it.
  const r1 = ok(await f.call('POST', `campaign/${pending.id}/review`, { creatives: { [a.id]: 'approved' } }, f.token('u_admin')));
  assert.equal(r1.activation.attempted, false); assert.equal(find(f, pending.id).status, 'pending'); assert.equal(find(f, pending.id).review, undefined);
  assert.equal(creative(f, a.id).approval_status, 'approved');
  // Rejecting everything on a never-submitted campaign does not mark it changes_needed either.
  const d = await campaign(f, sid, { creative_ids: [c2.id], status: 'draft', name: 'Draft rejected' });
  ok(await f.call('POST', `campaign/${d.id}/review`, { creatives: { [c2.id]: 'rejected' } }, f.token('u_admin')));
  assert.equal(find(f, d.id).status, 'draft'); assert.equal(find(f, d.id).review, undefined);
  const r2 = ok(await f.call('POST', `campaign/${live.id}/review`, { creatives: { [b.id]: 'approved' } }, f.token('u_admin')));
  assert.equal(r2.activation.attempted, false); assert.equal(find(f, live.id).status, 'active'); assert.equal(find(f, live.id).review, undefined);
  ok(await f.call('POST', `campaign/${live.id}`, { status: 'paused' }, f.token('u_op1')));
  ok(await f.call('POST', `creative/${b.id}`, { category: 'changed' }, f.token('u_op1')));
  ok(await f.call('POST', `campaign/${live.id}/review`, { creatives: { [b.id]: 'approved' } }, f.token('u_admin')));
  assert.equal(find(f, live.id).status, 'paused');
  // The owner of the never-submitted campaign still launches it themselves.
  assert.equal(ok(await f.call('POST', `campaign/${pending.id}/activate`, {}, f.token('u_op1'))).activation.activated, true);
  // in_review still activates in the reviewer's call.
  ok(await f.call('POST', `creative/${c2.id}`, { category: 'fixed' }, f.token('u_op1')));
  ok(await f.call('POST', `campaign/${d.id}/submit`, {}, f.token('u_op1')));
  const r3 = ok(await f.call('POST', `campaign/${d.id}/review`, { creatives: { [c2.id]: 'approved' } }, f.token('u_admin')));
  assert.equal(r3.activation.activated, true); assert.equal(find(f, d.id).status, 'active');
});

test('review queue lists re-review only with prior review or activation evidence; never-submitted and changes_needed stay with the owner', async () => {
  const f = fixture(), sid = await setup(f), sid2 = ok(await f.call('POST', 'screens', screenInput({ name: 'Second screen' }), f.token('u_op1')), 201).screen.id;
  const queue = async () => ok(await f.call('GET', 'review-queue', {}, f.token('u_admin'))).items;
  const reasonOf = async id => (await queue()).find(i => i.campaign.id === id)?.reason ?? null;
  // 1. Never-submitted draft and pending campaigns with a pending creative: not listed.
  const n1 = await pendingCreative(f, 'New draft spot'), n2 = await pendingCreative(f, 'New pending spot');
  const draft = await campaign(f, sid, { creative_ids: [n1.id], status: 'draft', name: 'New draft' });
  const fresh = await campaign(f, sid, { creative_ids: [n2.id], name: 'New pending' });
  assert.equal(await reasonOf(draft.id), null); assert.equal(await reasonOf(fresh.id), null);
  // 2. Submitting it is what puts it in the queue, as "submitted".
  ok(await f.call('POST', `campaign/${fresh.id}/submit`, {}, f.token('u_op1')));
  assert.equal(await reasonOf(fresh.id), 'submitted');
  // 3. Active campaign whose creative changes: re-review.
  const live = await campaign(f, sid2, { status: 'active', name: 'Live' });
  const changed = await pendingCreative(f, 'Changed live spot');
  ok(await f.call('POST', `campaign/${live.id}`, { creative_ids: ['cr_fit_b', changed.id] }, f.token('u_op1')));
  assert.equal(await reasonOf(live.id), 're_review');
  // 4. Paused campaign with a pending creative: re-review.
  ok(await f.call('POST', `campaign/${live.id}`, { status: 'paused' }, f.token('u_op1')));
  assert.equal(await reasonOf(live.id), 're_review');
  // 5. Pending campaign that was activated before (activated_at) with a pending creative: re-review.
  const was = await campaign(f, sid, { creative_ids: [n1.id], name: 'Previously activated' });
  f.change(d => { d.campaigns.find(c => c.id === was.id).activated_at = '2026-02-01T00:00:00.000Z'; });
  assert.equal(await reasonOf(was.id), 're_review');
  // 6. Approved but not started (all creatives approved, activation failed), then a creative changes: re-review.
  const late = await pendingCreative(f, 'Approved-not-started spot');
  const held = await campaign(f, sid, { creative_ids: [late.id], starts_at: '2026-01-01', ends_at: '2026-06-30', name: 'Held' });
  ok(await f.call('POST', `campaign/${held.id}/submit`, {}, f.token('u_op1')));
  ok(await f.call('POST', `campaign/${held.id}/review`, { creatives: { [late.id]: 'approved' } }, f.token('u_admin')));
  assert.equal(find(f, held.id).review.state, 'approved_not_started'); assert.equal(await reasonOf(held.id), null, 'nothing pending yet');
  ok(await f.call('POST', `campaign/${held.id}`, { ends_at: '2027-12-31' }, f.token('u_op1')));
  ok(await f.call('POST', `creative/${late.id}`, { category: 'changed' }, f.token('u_op1')));
  assert.equal(creative(f, late.id).approval_status, 'pending');
  assert.equal(await reasonOf(held.id), 're_review');
  // 7. changes_needed with a replaced (pending) creative: the seller resubmits; it is not listed meanwhile.
  const sent = await pendingCreative(f, 'Sent back spot');
  const back = await campaign(f, sid, { creative_ids: [sent.id], name: 'Sent back' });
  ok(await f.call('POST', `campaign/${back.id}/submit`, {}, f.token('u_op1')));
  ok(await f.call('POST', `campaign/${back.id}/review`, { creatives: { [sent.id]: 'rejected' }, note: 'Fix the logo' }, f.token('u_admin')));
  ok(await f.call('POST', `creative/${sent.id}`, { category: 'fixed' }, f.token('u_op1')));
  assert.equal(find(f, back.id).review.state, 'changes_needed'); assert.equal(creative(f, sent.id).approval_status, 'pending');
  assert.equal(await reasonOf(back.id), null);
  ok(await f.call('POST', `campaign/${back.id}/submit`, {}, f.token('u_op1')));
  assert.equal(await reasonOf(back.id), 'submitted');
  // 8. An ended active campaign is not listed even with a pending creative.
  f.change(d => { const c = d.campaigns.find(x => x.id === live.id); c.status = 'active'; c.starts_at = '2025-01-01'; c.ends_at = '2025-02-01'; });
  assert.equal(await reasonOf(live.id), null);
});
