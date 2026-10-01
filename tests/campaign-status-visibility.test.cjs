const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-lib.cjs');
const { screenView } = load('access');
const { deviceStateAt, campaignStatus } = load('campaign-status');
const now = Date.parse('2026-10-01T06:00:00Z');
for (const role of ['sales', 'advertiser_viewer']) {
  test(`${role} sees ageable heartbeat evidence without device or configuration details`, () => {
    const screen = { id: 's', org_id: 'o', name: 'Screen', status: 'active', code: 'pairing-secret', exclusions: { categories: ['private'] }, attention_settings: { private: true },
      _status: { state: 'live', age_s: 20, observed_at: new Date(now).toISOString(), device: { token: 'private-token', last_heartbeat_at: new Date(now-20000).toISOString() } } };
    const visible = screenView(screen, { role, org_id: 'o' });
    assert.deepEqual(visible._status, { state: 'live', age_s: 20, observed_at: new Date(now).toISOString() });
    assert.equal(deviceStateAt(visible._status, now), 'live');
    assert.equal(deviceStateAt(visible._status, now+90000), 'stalled');
    assert.equal(campaignStatus({
      campaign: { id: 'c', status: 'active', starts_at: '2026-09-01', ends_at: '2026-10-31', screen_ids: ['s'], creative_ids: ['cr'] },
      creatives: [{ id: 'cr', approval_status: 'approved' }], screens: [visible],
      reportScreens: { s: new Date(now-60000).toISOString() }, reportLoaded: true, now,
    }).state, 'live');
    assert.equal(visible.code, undefined);
    assert.equal(visible.exclusions, undefined);
    assert.equal(visible.attention_settings, undefined);
    assert.equal(JSON.stringify(visible).includes('private-token'), false);
  });
}
