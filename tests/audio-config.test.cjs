const test = require('node:test');
const assert = require('node:assert/strict');
const { defaults, resolve, LOCKED_KEYS } = require('./load-lib.cjs')('config');

test('creative sound defaults on and inherits through platform, organisation, group and screen layers', () => {
  const screen = { id: 'screen-audio', org_id: 'org-audio' };
  const group = { id: 'group-audio', org_id: 'org-audio', group_type: 'static', screen_ids: [screen.id] };
  const config = (id, layer, values, extra = {}) => ({
    id, layer, values, status: 'active', created_at: '2026-09-25T00:00:00.000Z', ...extra,
  });

  assert.equal(defaults().audio_enabled, true);
  assert.equal(LOCKED_KEYS.includes('audio_enabled'), false);
  assert.equal(resolve(screen, [group], []).audio_enabled.value, true);
  assert.equal(resolve(screen, [group], [
    config('platform', 'platform', { audio_enabled: false }),
  ]).audio_enabled.value, false);
  assert.equal(resolve(screen, [group], [
    config('platform', 'platform', { audio_enabled: false }),
    config('org', 'org', { audio_enabled: true }, { org_id: screen.org_id }),
  ]).audio_enabled.value, true);
  assert.equal(resolve(screen, [group], [
    config('org', 'org', { audio_enabled: true }, { org_id: screen.org_id }),
    config('group', 'group', { audio_enabled: false }, { target_id: group.id }),
  ]).audio_enabled.value, false);
  assert.equal(resolve(screen, [group], [
    config('group', 'group', { audio_enabled: false }, { target_id: group.id }),
    config('screen', 'screen', { audio_enabled: true }, { target_id: screen.id }),
  ]).audio_enabled.value, true);
});
