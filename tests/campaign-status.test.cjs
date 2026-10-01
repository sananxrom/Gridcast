const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-lib.cjs');
const { campaignStatus, campaignReason, receiptSuccessAt, approvalAlerts, blockedAlerts, LIVE_EVIDENCE_WINDOW_MS, ONLINE_HEARTBEAT_MS, CLOCK_TOLERANCE_MS } = load('campaign-status');

const now = Date.parse('2026-10-01T06:00:00.000Z');
const iso = at => new Date(at).toISOString();
// Device snapshots carry an explicit heartbeat, as bootstrap `_status` does for screens-capable roles.
const hbAgo = { live: 10, stalled: 300, offline: 3600 };
const dev = (state, secondsAgo = hbAgo[state]) => ({ state, age_s: secondsAgo, device: { last_heartbeat_at: iso(now - secondsAgo * 1000) } });
function base(over = {}) {
  return {
    campaign: { id: 'c1', status: 'active', starts_at: '2026-09-01', ends_at: '2026-10-31', screen_ids: ['s1', 's2', 's3'], creative_ids: ['cr1'], rate_type: 'per_play', committed_budget: 1000, accrued_spend: 10, advertiser_id: 'a1', ...over.campaign },
    creatives: over.creatives || [{ id: 'cr1', approval_status: 'approved' }],
    screens: over.screens || ['s1', 's2', 's3'].map(id => ({ id, status: 'active', _status: dev('live') })),
    advertiser: over.advertiser || { id: 'a1', status: 'active' },
    receipts: over.receipts, reportScreens: over.reportScreens, reportLoaded: over.reportLoaded, decisions: over.decisions, now,
  };
}
const receipt = (screen_id, minutesAgo, over = {}) => ({ campaign_id: 'c1', screen_id, kind: 'paid', rendered: true, timestamp_valid: true, source: 'device_report', billable: true, started_at: iso(now - minutesAgo * 60000), applied_clock_offset_ms: 0, ...over });
const status = over => campaignStatus(base(over));

test('window constant is 30 minutes', () => assert.equal(LIVE_EVIDENCE_WINDOW_MS, 30 * 60 * 1000));

test('rows 1-5: draft, review states, ended, paused and pending need no delivery evidence', () => {
  assert.equal(status({ campaign: { status: 'draft' } }).label, 'Draft');
  assert.equal(status({ campaign: { review: { state: 'in_review' } } }).label, 'In review');
  assert.equal(status({ campaign: { review: { state: 'changes_needed' } } }).label, 'Changes needed');
  for (const s of ['complete', 'cancelled']) assert.equal(status({ campaign: { status: s } }).state, 'ended');
  assert.equal(status({ campaign: { ends_at: '2026-09-30' } }).label, 'Ended');
  // ends_at today (IST) is still running
  assert.notEqual(status({ campaign: { ends_at: '2026-10-01' } }).state, 'ended');
  assert.equal(status({ campaign: { status: 'paused' } }).label, 'Paused');
  const pending = status({ campaign: { status: 'pending' } });
  assert.equal(pending.label, 'Not delivering · Not started'); assert.equal(pending.reason, 'Holding screens, not active');
});

test('row 6: future start is Scheduled; future plus missing or unapproved creatives is Scheduled with a warning', () => {
  const s = status({ campaign: { starts_at: '2026-10-05' } });
  assert.equal(s.label, 'Scheduled'); assert.deepEqual(s.warnings, []);
  const p = status({ campaign: { starts_at: '2026-10-05' }, creatives: [{ id: 'cr1', approval_status: 'pending' }] });
  assert.equal(p.label, 'Scheduled'); assert.equal(p.warnings[0].code, 'creative_not_approved'); assert.match(p.warnings[0].text, /awaiting approval/);
  const none = status({ campaign: { starts_at: '2026-10-05', creative_ids: [] } });
  assert.equal(none.label, 'Scheduled'); assert.equal(none.warnings[0].code, 'no_creative');
});

test('row 7: each campaign-wide blocker gives Not delivering with its reason', () => {
  const cases = [
    [{ campaign: { creative_ids: [] } }, 'no_creative', 'Not delivering · No creatives assigned'],
    [{ creatives: [{ id: 'cr1', approval_status: 'pending' }] }, 'creative_not_approved', 'Not delivering · 1 creative awaiting approval'],
    [{ campaign: { creative_ids: ['cr1', 'cr2'] }, creatives: [{ id: 'cr1', approval_status: 'rejected' }, { id: 'cr2', approval_status: 'rejected' }] }, 'creative_not_approved', 'Not delivering · 2 creatives rejected'],
    [{ campaign: { accrued_spend: 1000 } }, 'budget_exhausted', 'Not delivering · Budget reached'],
    [{ campaign: { starts_at: '2026-10-31', ends_at: '2026-10-01' } }, 'campaign_dates_invalid', 'Not delivering · Campaign dates need correcting'],
    [{ advertiser: { id: 'a1', status: 'archived' } }, 'advertiser_archived', 'Not delivering · The advertiser is archived'],
    [{ screens: ['s1', 's2', 's3'].map(id => ({ id, status: 'paused', _status: dev('live') })) }, 'screen_not_active', 'Not delivering · All screens paused or inactive'],
    [{ screens: ['s1', 's2', 's3'].map(id => ({ id, status: 'active', _status: dev('offline') })) }, 'all_screens_offline', 'Not delivering · All screens offline'],
  ];
  for (const [over, code, label] of cases) {
    const s = status({ ...over, receipts: [receipt('s1', 1)] });
    assert.equal(s.state, 'not_delivering', code); assert.equal(s.reason_code, code); assert.equal(s.label, label);
  }
});

test('flat-rate campaigns do not block on budget; redacted budget is skipped, not guessed', () => {
  assert.equal(status({ campaign: { rate_type: 'flat', accrued_spend: 5000 }, receipts: [receipt('s1', 1)] }).state, 'live');
  const redacted = base({ receipts: [receipt('s1', 1)] }); delete redacted.campaign.committed_budget; redacted.campaign.accrued_spend = 1e9;
  const s = campaignStatus(redacted);
  assert.equal(s.state, 'live'); assert.equal(s.evidence.budget_checked, false);
});

test('row 8: Live counts screens with a recent successful paid play AND an online device', () => {
  const s = status({ receipts: [receipt('s1', 5), receipt('s2', 29), receipt('s3', 31)] });
  assert.equal(s.label, 'Live · 2 of 3 screens'); assert.equal(s.tone, 'onair');
  assert.equal(s.evidence.source, 'receipts'); assert.equal(s.evidence.last_success_at, iso(now - 5 * 60000));
  // Delivered recently but that screen's player is offline now: not counted.
  const screens = [{ id: 's1', status: 'active', _status: dev('offline') }, { id: 's2', status: 'active', _status: dev('live') }, { id: 's3', status: 'active', _status: dev('live') }];
  assert.equal(status({ screens, receipts: [receipt('s1', 5), receipt('s2', 5)] }).label, 'Live · 1 of 3 screens');
});

test('row 9: Unknown with an honest reason', () => {
  assert.equal(status({ receipts: [] }).label, 'Unknown · no delivery in the last 30 min');
  assert.equal(status({}).label, 'Unknown · delivery evidence not loaded');
  const old = status({ receipts: [receipt('s1', 45)] });
  assert.equal(old.state, 'unknown'); assert.equal(old.evidence.last_success_at, iso(now - 45 * 60000));
  const stalled = ['s1', 's2', 's3'].map(id => ({ id, status: 'active', _status: dev('stalled') }));
  assert.equal(status({ screens: stalled, receipts: [receipt('s1', 2)] }).reason_code, 'screens_not_online');
  const noDevice = ['s1', 's2', 's3'].map(id => ({ id, status: 'active' }));
  assert.equal(status({ screens: noDevice, receipts: [receipt('s1', 2)] }).reason_code, 'device_status_unknown');
});

test('seed, failed, invalid-time, filler and other-campaign receipts never make Live', () => {
  const bad = [
    receipt('s1', 1, { source: 'seed' }),
    receipt('s1', 1, { source: 'synthetic_demo' }),
    receipt('s1', 1, { rendered: false, billable: true }),
    receipt('s1', 1, { rendered: undefined, billable: undefined }),
    receipt('s1', 1, { timestamp_valid: false }),
    receipt('s1', 1, { kind: 'filler' }),
    receipt('s1', 1, { campaign_id: 'other' }),
    receipt('s9', 1),
  ];
  for (const r of bad) assert.equal(status({ receipts: [r] }).state, 'unknown', JSON.stringify(r));
  // A failed recent play after an older success: still no recent success.
  const s = status({ receipts: [receipt('s1', 120), receipt('s1', 1, { rendered: false })] });
  assert.equal(s.state, 'unknown'); assert.equal(s.evidence.last_success_at, iso(now - 120 * 60000));
  assert.equal(receiptSuccessAt(receipt('s1', 0, { applied_clock_offset_ms: 60000 })), now + 60000);
});

test('report summary evidence: missing last_success_at gives Unknown; a recent one gives Live', () => {
  assert.equal(status({ reportLoaded: true, reportScreens: {} }).label, 'Unknown · no delivery in the last 30 min');
  assert.equal(status({ reportLoaded: true, reportScreens: { s1: undefined } }).state, 'unknown');
  const s = status({ reportLoaded: true, reportScreens: { s2: iso(now - 60000), s9: iso(now) } });
  assert.equal(s.label, 'Live · 1 of 3 screens'); assert.equal(s.evidence.source, 'report_summary');
});

test('mixed approvals keep the normal state with a warning; only no approved creative is Not delivering', () => {
  const creatives = [{ id: 'cr1', approval_status: 'approved' }, { id: 'cr2', approval_status: 'pending' }];
  const s = status({ campaign: { creative_ids: ['cr1', 'cr2'] }, creatives, receipts: [receipt('s1', 1)] });
  assert.equal(s.state, 'live'); assert.equal(s.warnings[0].code, 'some_creatives_not_approved'); assert.match(s.warnings[0].text, /awaiting approval/);
  // Re-upload resets the only creative to pending: now Not delivering.
  assert.equal(status({ creatives: [{ id: 'cr1', approval_status: 'pending' }], receipts: [receipt('s1', 1)] }).state, 'not_delivering');
});

test('server decisions: all screens ineligible shows the most common reason; some ineligible is a warning', () => {
  const d = (screen_id, eligible, reason) => ({ screen_id, creative_id: 'cr1', eligible, reason, warnings: [] });
  const all = status({ receipts: [], decisions: [d('s1', false, 'screen_category_block'), d('s2', false, 'screen_category_block'), d('s3', false, 'competitive_separation')] });
  assert.equal(all.label, 'Not delivering · Content category is blocked on this screen and 1 other reason');
  const hours = status({ receipts: [], decisions: ['s1', 's2', 's3'].map(s => d(s, false, 'outside_operating_hours')) });
  assert.equal(hours.label, 'Not delivering · Outside delivery hours (normal)'); assert.equal(hours.tone, 'muted');
  const some = status({ receipts: [receipt('s1', 1)], decisions: [d('s1', true, 'eligible'), d('s2', false, 'screen_advertiser_block')] });
  assert.equal(some.state, 'live'); assert.ok(some.warnings.some(w => w.code === 'some_screens_ineligible'));
  assert.equal(some.evidence.ineligible_screens[0].screen_id, 's2');
});

test('campaign wording and fallback', () => {
  assert.equal(campaignReason('campaign_not_active'), 'Campaign is not active');
  assert.equal(campaignReason('creative_not_approved', { pending: 2 }), '2 creatives awaiting approval');
  assert.equal(campaignReason('budget_exhausted'), 'Budget reached');
  assert.equal(campaignReason('totally_new_code'), 'Delivery is not ready. Check the screen’s readiness details');
});

test('inbox approval items point at the blocked campaign; orphan creatives keep their item', () => {
  const d = { campaigns: [
    { id: 'c1', name: 'One', status: 'active', starts_at: '2026-09-01', ends_at: '2026-10-31', creative_ids: ['p1', 'p2', 'ok'] },
    { id: 'c2', name: 'Two', status: 'paused', starts_at: '2026-09-01', ends_at: '2026-10-31', creative_ids: ['p1'] },
    { id: 'c3', name: 'Old', status: 'active', starts_at: '2026-01-01', ends_at: '2026-02-01', creative_ids: ['p3'] },
  ] };
  const items = approvalAlerts(d, [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }, { id: 'p3', name: 'P3' }], 'approvals', c => `${c.name} awaiting`, now);
  assert.deepEqual(items.map(i => i.go), ['c/c1', 'c/c2', 'approvals']);
  assert.equal(items[0].text, 'One is waiting on 2 creatives for approval'); assert.equal(items[2].text, 'P3 awaiting');
});

test('blocked inbox items skip pure approval waits and non-active campaigns', () => {
  const d = { creatives: [{ id: 'p', approval_status: 'pending' }, { id: 'a', approval_status: 'approved' }], screens: [], advertisers: [],
    campaigns: [
      { id: 'wait', name: 'Wait', status: 'active', starts_at: '2026-09-01', ends_at: '2026-10-31', screen_ids: ['s'], creative_ids: ['p'] },
      { id: 'budget', name: 'Budget', status: 'active', starts_at: '2026-09-01', ends_at: '2026-10-31', screen_ids: ['s'], creative_ids: ['a'], rate_type: 'per_play', committed_budget: 1, accrued_spend: 1 },
      { id: 'paused', name: 'Paused', status: 'paused', starts_at: '2026-09-01', ends_at: '2026-10-31', screen_ids: ['s'], creative_ids: [] },
    ] };
  assert.deepEqual(blockedAlerts(d, now).map(i => [i.go, i.text]), [['c/budget', 'Budget: Not delivering · Budget reached']]);
});

test('constants match lib/api.ts screenStatus freshness and the clock tolerance', () => {
  assert.equal(ONLINE_HEARTBEAT_MS, 90_000); assert.equal(CLOCK_TOLERANCE_MS, 120_000);
});

test('regression: a stale live snapshot is re-aged from its heartbeat, never online by state alone', () => {
  // Bootstrap said live (age 5 s) but the heartbeat is 2 min old at evaluation time.
  const aged = ['s1', 's2', 's3'].map(id => ({ id, status: 'active', _status: { state: 'live', label: 'on air', age_s: 5, device: { last_heartbeat_at: iso(now - 120_000) } } }));
  const s = status({ screens: aged, receipts: [receipt('s1', 1)] });
  assert.equal(s.state, 'unknown'); assert.equal(s.reason_code, 'screens_not_online'); assert.equal(s.evidence.screens_online, 0);
  // Same unchanged snapshot evaluated 10 minutes after a fresh heartbeat: no longer Live.
  const fresh = base({ receipts: [receipt('s1', 1)] });
  assert.equal(campaignStatus(fresh).state, 'live');
  const later = campaignStatus({ ...fresh, now: now + 10 * 60_000, receipts: [receipt('s1', -9)] });
  assert.equal(later.state, 'unknown'); assert.equal(later.reason_code, 'screens_not_online');
  // A 'live' state with no heartbeat timestamp is unknown device status, not online.
  const bare = ['s1', 's2', 's3'].map(id => ({ id, status: 'active', _status: { state: 'live' } }));
  const u = status({ screens: bare, receipts: [receipt('s1', 1)] });
  assert.equal(u.state, 'unknown'); assert.equal(u.reason_code, 'device_status_unknown'); assert.equal(u.evidence.screens_online, null);
  // age_s plus a known snapshot time is an acceptable heartbeat source.
  const observed = ['s1', 's2', 's3'].map(id => ({ id, status: 'active', _status: { state: 'live', age_s: 5, observed_at: iso(now - 30_000) } }));
  assert.equal(status({ screens: observed, receipts: [receipt('s1', 1)] }).state, 'live');
  assert.equal(campaignStatus({ ...base({ screens: observed, receipts: [receipt('s1', 1)] }), now: now + 2 * 60_000 }).state, 'unknown');
});

test('regression: partial decision coverage never asserts a campaign-wide blocker', () => {
  const d = (screen_id, eligible, reason) => ({ screen_id, creative_id: 'cr1', eligible, reason, warnings: [] });
  const two = ['s1', 's2'].map(id => ({ id, status: 'active', _status: dev('live') }));
  const s = status({ campaign: { screen_ids: ['s1', 's2'] }, screens: two, receipts: [receipt('s2', 1)], decisions: [d('s1', false, 'screen_not_active')] });
  assert.notEqual(s.state, 'not_delivering'); assert.equal(s.state, 'live'); assert.equal(s.label, 'Live · 1 of 2 screens');
  assert.equal(s.evidence.ineligible_screens[0].screen_id, 's1');
  const none = status({ campaign: { screen_ids: ['s1', 's2'] }, screens: two, receipts: [], decisions: [d('s1', false, 'screen_not_active')] });
  assert.equal(none.state, 'unknown'); assert.equal(none.reason_code, 'no_recent_delivery');
  // Full coverage, all ineligible: campaign-wide.
  const full = status({ campaign: { screen_ids: ['s1', 's2'] }, screens: two, receipts: [], decisions: [d('s1', false, 'screen_not_active'), d('s2', false, 'screen_not_active')] });
  assert.equal(full.state, 'not_delivering');
});

test('regression: future evidence beyond the clock tolerance is ignored on receipt and summary paths', () => {
  const tomorrow = now + 86_400_000;
  const r = status({ receipts: [receipt('s1', -24 * 60)] });
  assert.equal(r.state, 'unknown'); assert.equal(r.reason_code, 'no_recent_delivery'); assert.equal(r.evidence.last_success_at, null);
  const m = status({ reportLoaded: true, reportScreens: { s1: iso(tomorrow) } });
  assert.equal(m.state, 'unknown'); assert.equal(m.evidence.last_success_at, null);
  // Within tolerance (device clock 1 min ahead) still counts.
  assert.equal(status({ receipts: [receipt('s1', -1)] }).state, 'live');
  assert.equal(status({ reportLoaded: true, reportScreens: { s1: iso(now + 60_000) } }).state, 'live');
});
