/**
 * Device configuration — the settings that describe how a player and its screen
 * behave, resolved by layering rather than stored on the screen itself.
 *
 * A config stores ONLY the keys it sets. A screen resolves its settings by
 * stacking configs, most specific winning:
 *
 *   platform  →  org  →  group  →  screen
 *
 * so a group config that changes one field carries one field, and configs
 * compose instead of colliding.
 */

export type Layer = 'platform' | 'org' | 'group' | 'screen';
export const LAYER_ORDER: Layer[] = ['platform', 'org', 'group', 'screen'];

export type Ctl = 'text' | 'textarea' | 'number' | 'toggle' | 'select' | 'time' | 'timerange' | 'color' | 'wh' | 'rect' | 'tags' | 'derived';

export type Setting = {
  key: string;
  label: string;
  group: string;
  ctl: Ctl;
  unit?: string;
  /** Options for a select, as value or [value, label]. */
  options?: (string | [string, string])[];
  def: any;
  /** Explanation shown behind an ⓘ. Present only where the label is not enough. */
  info?: string;
  /** Resolvable only from the platform layer. Enforced in the API, not the UI. */
  locked?: boolean;
  /** Why it is locked — always shown next to the lock. */
  lockReason?: string;
  /** Listed so the schema is stable, not yet implemented. */
  soon?: boolean;
  /** Platforms this reaches; absent means all. */
  platforms?: ('android' | 'windows' | 'web')[];
  /** Feeds the rate card — changing it triggers reconciliation. */
  priced?: boolean;
};

export const GROUPS = [
  { id: 'identity', title: 'Identity', hint: 'What this config is and where it applies' },
  { id: 'screen', title: 'Screen', hint: 'The physical panel and how the picture fills it' },
  { id: 'playback', title: 'Playback', hint: 'The loop, and what happens when something fails to load' },
  { id: 'measurement', title: 'Measurement', hint: 'Camera, detection and what counts as a measured play' },
  { id: 'privacy', title: 'Privacy', hint: 'Fixed guarantees you can show a venue owner' },
  { id: 'connectivity', title: 'Connectivity', hint: 'Pulling content and sending back proof of play' },
  { id: 'cache', title: 'Storage', hint: 'Local media cache' },
  { id: 'reliability', title: 'Reliability', hint: 'Keeping the screen alive without a site visit' },
  { id: 'interaction', title: 'Interaction & external', hint: 'Touch, and systems outside Gridcast' },
  { id: 'sync', title: 'Multi-player sync', hint: 'One surface driven by more than one box' },
  { id: 'diagnostics', title: 'Diagnostics', hint: 'Logs and commissioning aids' },
] as const;

const T = (k: string, label: string, group: string, ctl: Ctl, def: any, extra: Partial<Setting> = {}): Setting =>
  ({ key: k, label, group, ctl, def, ...extra });

export const SETTINGS: Setting[] = [
  // ---------------------------------------------------------------- identity
  T('device_label', 'Device label', 'identity', 'text', '', {
    info: 'Name shown on the player’s own start screen, for whoever is standing in front of it.' }),
  T('show_pairing_code', 'Show pairing code on device', 'identity', 'toggle', true, {
    info: 'Whether the permanent screen code can be read off the device screen. Turn off for public-facing installs.' }),

  // ------------------------------------------------------------------ screen
  T('size_in', 'Diagonal size', 'screen', 'number', 43, { unit: 'in' }),
  T('resolution', 'Resolution', 'screen', 'wh', { w: 1920, h: 1080 }),
  T('aspect', 'Aspect ratio', 'screen', 'derived', '16:9'),
  T('orientation', 'Orientation', 'screen', 'select', 'landscape', { options: ['landscape', 'portrait', 'auto'] }),
  T('rotation_method', 'Rotation method', 'screen', 'select', 'hardware', { options: ['hardware', 'software'],
    info: 'Software rotation costs performance. Use it only where the panel cannot rotate itself.' }),
  T('screen_color', 'Screen colour', 'screen', 'color', '#000000', {
    info: 'Shown behind slides and during transitions.' }),
  T('hide_system_bars', 'Fullscreen', 'screen', 'toggle', true, {
    info: 'Hide the Android status and navigation bars, or the Windows taskbar.' }),
  T('keep_screen_on', 'Keep screen awake', 'screen', 'toggle', true, {
    info: 'Prevents the panel sleeping, and relaunches the player if someone presses the power button.' }),
  T('limit_resolution', 'Limit content resolution', 'screen', 'select', 'off', { options: ['off', '720p', '1080p'],
    info: 'Downscale content to panel size. Only for devices whose own scaler is broken.' }),
  T('overscan_pct', 'Overscan compensation', 'screen', 'number', 0, { unit: '%',
    info: 'Some TVs crop the edges of their input. Raise this until the whole slide is visible.' }),
  T('display_notifications', 'Show errors on screen', 'screen', 'toggle', false, {
    info: 'Draws errors over the content. Useful during install, embarrassing in a shop window.' }),
  T('control_bar', 'Control bar', 'screen', 'toggle', false, { platforms: ['windows'] }),
  T('disable_mouse', 'Disable mouse control', 'screen', 'toggle', true, { platforms: ['windows'],
    info: 'Stops a passer-by exiting fullscreen.' }),
  T('panel_power_schedule', 'Panel power schedule', 'screen', 'timerange', null, { soon: true,
    info: 'Turns the panel itself off outside trading hours, over IP. Requires TV control.' }),

  // ---------------------------------------------------------------- playback
  T('loop_length_s', 'Loop length', 'playback', 'number', 600, { unit: 's', priced: true }),
  T('slot_duration_s', 'Slot duration', 'playback', 'number', 10, { unit: 's', priced: true,
    info: 'Also the unit of a billable play.' }),
  T('operating_hours', 'Trading hours', 'playback', 'timerange', { from: '08:00', to: '20:00' }, { priced: true,
    info: 'When the venue is open. The player sleeps outside this window, and it prices the screen.' }),
  T('start_automatically', 'Start automatically', 'playback', 'toggle', true),
  T('resume_playlist', 'Resume playlist', 'playback', 'toggle', true, {
    info: 'Continue from the last played slide after a restart.' }),
  T('start_from_cache', 'Start from cache', 'playback', 'toggle', true, {
    info: 'Show cached content immediately and fetch updates in the background. A large win on slow venue Wi-Fi.' }),
  T('start_on_slide_ready', 'Start on first ready', 'playback', 'toggle', true, {
    info: 'Do not wait for the whole playlist to download before playing.' }),
  T('skip_incomplete', 'Skip broken creatives', 'playback', 'toggle', true, {
    info: 'A creative that will not load is skipped rather than freezing the loop.' }),
  T('log_skips', 'Record skipped creatives', 'playback', 'toggle', true, {
    info: 'Stored as a play with status “skipped”. Never billed.' }),
  T('transitions_enabled', 'Transitions', 'playback', 'toggle', true),
  T('video_transition_mode', 'Video-to-video transition', 'playback', 'select', 'auto', { options: ['auto', 'cut', 'fade'],
    info: 'Cross-fading two videos is expensive. Auto picks by device capability.' }),
  T('video_loop_mode', 'Video loop mode', 'playback', 'select', 'auto', { options: ['auto', 'native', 'restart'], platforms: ['android'] }),
  T('accelerate_text', 'GPU text acceleration', 'playback', 'toggle', true, {
    info: 'For scrolling or animated text.' }),
  T('filler_behaviour', 'When the loop is not sold out', 'playback', 'select', 'house',
    { options: [['house', 'Play house content'], ['operator', 'Operator filler'], ['black', 'Black screen'], ['compress', 'Compress the loop']],
      info: 'Compressing the loop makes sold slots recur faster, which changes what an advertiser receives. House content keeps timing honest.' }),

  // ------------------------------------------------------------- measurement
  T('camera_source', 'Camera source', 'measurement', 'select', 'usb', { options: ['builtin', 'usb', 'ip'] }),
  T('camera_device_id', 'Camera device', 'measurement', 'text', '', {
    info: 'Populated by the paired player. Leave empty to use the first camera found.' }),
  T('camera_url', 'IP camera URL', 'measurement', 'text', '', { info: 'RTSP or HTTP, when the source is an IP camera.' }),
  T('inference_res', 'Inference resolution', 'measurement', 'select', '640x480', { options: ['320x240', '640x480', '1280x720'],
    info: 'Frames are downscaled before detection. Higher is not better — it is slower, and people far from the screen are not the audience.' }),
  T('sample_interval_s', 'Sample interval', 'measurement', 'number', 2, { unit: 's', locked: true,
    lockReason: 'Measurement consistency — screens must be comparable',
    info: 'How often a frame is sampled during a play. Every presence figure on the platform assumes this value.' }),
  T('model', 'Detection model', 'measurement', 'select', 'yolox-tiny', { options: ['yolox-tiny', 'yolox-s', 'coco-ssd'], locked: true,
    lockReason: 'Recorded against every measurement as model_ver',
    info: 'Apache-2.0 licensed. Stamped on each presence record so a number can always be traced to the model that produced it.' }),
  T('confidence_min', 'Confidence floor', 'measurement', 'number', 0.45, { locked: true,
    lockReason: 'Moves every number on the platform',
    info: 'Detections below this confidence are discarded.' }),
  T('min_box_px', 'Minimum subject size', 'measurement', 'number', 24, { unit: 'px',
    info: 'Ignores people far in the background who could not read the screen.' }),
  T('detection_zone', 'Detection zone', 'measurement', 'rect', { x: 0, y: 0, w: 100, h: 100 }, {
    info: 'The part of the frame that counts as in front of the screen. The gap between this and the whole frame is the adjustment factor.' }),
  T('count_ceiling', 'Count ceiling', 'measurement', 'number', 50, {
    info: 'Caps absurd readings from a crowd surge or a mirror facing the camera.' }),
  T('measure_during_play_only', 'Measure only during a play', 'measurement', 'toggle', true, { locked: true,
    lockReason: 'Presence exists only against a play',
    info: 'There is no measurement outside a play. Nothing is counted while the screen is idle.' }),
  T('camera_fail_mode', 'On camera failure', 'measurement', 'select', 'unmeasured',
    { options: [['unmeasured', 'Record the play as unmeasured'], ['skip', 'Do not record the play']], locked: true,
      lockReason: 'A failed camera must never read as an empty room',
      info: 'The play still records, flagged measured:false. It is never silently counted as zero people.' }),
  T('presence_metric', 'Metric', 'measurement', 'derived', 'avg_persons', { locked: true,
    lockReason: 'Phase 1 metric',
    info: 'Mean of per-sample counts across one play. Not reach, not impressions, not unique people.' }),

  // ----------------------------------------------------------------- privacy
  T('upload_frames', 'Frames leave the device', 'privacy', 'derived', 'never', { locked: true,
    lockReason: 'Cannot be enabled by anyone, including Gridcast',
    info: 'Only counts are transmitted. No image ever leaves the player.' }),
  T('retain_frames', 'Frame retention', 'privacy', 'derived', false, { locked: true,
    lockReason: 'Cannot be enabled',
    info: 'Frames are discarded after inference. They exist in memory only.' }),
  T('face_recognition', 'Face recognition', 'privacy', 'derived', false, { locked: true,
    lockReason: 'Not implemented',
    info: 'The model detects person-shaped objects. It has no concept of identity.' }),
  T('reidentify', 'Re-identification across plays', 'privacy', 'derived', false, { locked: true,
    lockReason: 'Not implemented',
    info: 'A person seen twice is counted twice. That is a deliberate honesty choice, not a limitation.' }),
  T('demographics', 'Demographic inference', 'privacy', 'derived', false, { locked: true, lockReason: 'Not implemented' }),
  T('preview_frames', 'Setup preview', 'privacy', 'toggle', false, {
    info: 'Streams frames to the dashboard while aiming the camera. Expires automatically after 30 minutes.' }),

  // ------------------------------------------------------------ connectivity
  T('sync_interval_min', 'Sync interval', 'connectivity', 'number', 5, { unit: 'min',
    info: 'How often the player pulls its playlist.' }),
  T('randomise_sync', 'Randomise sync time', 'connectivity', 'toggle', true, {
    info: 'Offsets each player randomly inside the interval. Without it the whole fleet hits the server on the same second.' }),
  T('sync_window', 'Sync window', 'connectivity', 'timerange', { from: '00:00', to: '00:00' }, {
    info: 'Restrict updates to a time window. Venue Wi-Fi is often shared with the till.' }),
  T('bandwidth_kbps', 'Bandwidth cap', 'connectivity', 'number', 0, { unit: 'kbps',
    info: 'Throttle downloads so the venue’s own connection stays usable. 0 is unlimited.' }),
  T('max_parallel_downloads', 'Parallel downloads', 'connectivity', 'number', 2),
  T('retry_downloads', 'Retry failed downloads', 'connectivity', 'toggle', true),
  T('work_offline', 'Work offline', 'connectivity', 'toggle', false, {
    info: 'Stop contacting the server entirely and play from cache. For a screen on a dead connection.' }),
  T('offline_buffer_plays', 'Offline play buffer', 'connectivity', 'number', 5000, {
    info: 'Plays stored locally while offline and sent when the link returns. Nothing is lost.' }),
  T('heartbeat_s', 'Heartbeat interval', 'connectivity', 'number', 30, { unit: 's', locked: true,
    lockReason: 'Drives live / not responding / offline across the platform',
    info: 'A screen is “not responding” after 90s without a heartbeat, and offline after 900s.' }),
  T('content_url', 'Content endpoint', 'connectivity', 'text', '', { locked: true, lockReason: 'Platform infrastructure' }),
  T('telemetry_url', 'Telemetry endpoint', 'connectivity', 'text', '', { locked: true, lockReason: 'Platform infrastructure',
    info: 'A separate host from content, so proof-of-play volume can never take down playback.' }),
  T('telemetry_batch', 'Telemetry batch size', 'connectivity', 'number', 50, { unit: 'plays' }),
  T('telemetry_retry_h', 'Telemetry retry window', 'connectivity', 'number', 72, { unit: 'h' }),
  T('enable_ssl', 'TLS', 'connectivity', 'toggle', true, { locked: true, lockReason: 'Platform security' }),

  // ------------------------------------------------------------------- cache
  T('cache_cleanup', 'Automatic cleanup', 'cache', 'toggle', true),
  T('cache_min_free_mb', 'Clean below', 'cache', 'number', 500, { unit: 'MB', info: 'Free space that starts cleanup.' }),
  T('cache_max_free_mb', 'Stop at', 'cache', 'number', 2000, { unit: 'MB',
    info: 'Free space that stops it. The gap between the two prevents cleanup running constantly at the threshold.' }),
  T('cache_max_age_days', 'Drop unused after', 'cache', 'number', 30, { unit: 'days' }),
  T('cache_signatures', 'Verify cached files', 'cache', 'toggle', true, {
    info: 'Turn off only for debugging — it allows cached files to be edited on the device.' }),

  // ------------------------------------------------------------- reliability
  T('daily_restart', 'Daily restart', 'reliability', 'toggle', true, {
    info: 'Restarting nightly is prevention, not a fix. Inexpensive Android boxes leak memory.' }),
  T('restart_times', 'Restart at', 'reliability', 'time', '03:00'),
  T('restart_timing', 'Restart timing', 'reliability', 'select', 'playlist_end',
    { options: [['playlist_end', 'At playlist end'], ['slide_end', 'At slide end'], ['immediate', 'Immediately']],
      info: 'Never mid-creative — a restart during a play would truncate its measurement.' }),
  T('restart_force_delay_min', 'Force restart after', 'reliability', 'number', 60, { unit: 'min',
    info: 'Restart anyway if the playlist never reaches its end.' }),
  T('keep_alive', 'Watchdog', 'reliability', 'toggle', true, { info: 'Restart the player if it stops responding.' }),
  T('keep_alive_s', 'Watchdog interval', 'reliability', 'number', 120, { unit: 's' }),
  T('restart_on_inactivity', 'Restart on inactivity', 'reliability', 'toggle', false, { info: 'For interactive installs only.' }),
  T('inactivity_s', 'Inactivity interval', 'reliability', 'number', 60, { unit: 's' }),
  T('auto_recover', 'Recover from crash', 'reliability', 'toggle', true, { info: 'Relaunch on crash and on device boot.' }),
  T('fail_alert_count', 'Alert after', 'reliability', 'number', 3, { unit: 'failures',
    info: 'Consecutive failures before this screen raises an inbox alert.' }),

  // ------------------------------------------------------------- interaction
  T('touch_enabled', 'Touch enabled', 'interaction', 'toggle', false, { info: 'Master switch for everything below.' }),
  T('navigate_on_touch', 'Navigate on touch', 'interaction', 'toggle', false, {
    info: 'Touching the left or right edge skips backward or forward.' }),
  T('disable_web_interaction', 'Lock embedded web pages', 'interaction', 'toggle', true, {
    info: 'Stops a passer-by browsing from an embedded page.' }),
  T('launch_on_touch', 'Launch app on touch', 'interaction', 'toggle', false, { soon: true }),
  T('launch_on_touch_app', 'Application', 'interaction', 'text', '', { soon: true }),
  T('launch_on_swipe', 'Launch on swipe', 'interaction', 'toggle', false, { soon: true, platforms: ['android'] }),
  T('exe_path', 'Executable path', 'interaction', 'text', '', { soon: true, platforms: ['windows'] }),
  T('tv_control', 'TV control', 'interaction', 'toggle', false, { soon: true,
    info: 'Panel power, input and volume over IP. Pairs with the panel power schedule.' }),
  T('tv_vendor', 'TV vendor', 'interaction', 'select', 'samsung', { options: ['samsung', 'lg', 'philips'], soon: true }),
  T('tv_ip', 'TV IP address', 'interaction', 'text', '', { soon: true }),
  T('rfid_enabled', 'RFID reader', 'interaction', 'toggle', false, { soon: true }),
  T('remote_events', 'Remote events', 'interaction', 'toggle', false, { soon: true,
    info: 'Lets an external system push a trigger to a screen.' }),
  T('web_server_enabled', 'On-device HTTP control', 'interaction', 'toggle', false, { soon: true }),
  T('web_server_port', 'Port', 'interaction', 'number', 55554, { soon: true }),

  // -------------------------------------------------------------------- sync
  T('sync_group_id', 'Sync group', 'sync', 'text', '', {
    info: 'All players sharing a group play as one surface. Assign the same group to every box driving the screen.' }),
  T('sync_role', 'Role', 'sync', 'select', 'leader', { options: ['leader', 'follower'], info: 'One leader per group.' }),
  T('tile_rect', 'Tile geometry', 'sync', 'rect', { x: 0, y: 0, w: 100, h: 100 }, {
    info: 'Which part of the logical screen this player renders. Two boxes splitting a wall are 0,0,50,100 and 50,0,50,100.' }),
  T('playback_clock', 'Playback clock', 'sync', 'toggle', false, { info: 'Switched on automatically when a sync group is set.' }),
  T('reference_time', 'Reference time', 'sync', 'time', '06:00', { info: 'Origin for slide-timing arithmetic.' }),
  T('clock_server', 'Clock server', 'sync', 'text', 'pool.ntp.org'),
  T('clock_update_min', 'Clock update interval', 'sync', 'number', 5, { unit: 'min' }),
  T('wait_for_clock', 'Wait for clock', 'sync', 'toggle', true, { info: 'Do not start until the first clock sync lands.' }),
  T('video_accommodation_ms', 'Video delay compensation', 'sync', 'number', 0, { unit: 'ms',
    info: 'Forced delay that lets slower boxes catch up. Raise it until the tiles start together.' }),
  T('accommodation_adaptive', 'Adaptive compensation', 'sync', 'toggle', true, {
    info: 'Learn each device’s latency instead of using one fixed figure.' }),
  T('spread_ntp', 'Spread clock load', 'sync', 'toggle', true),
  T('timing_debug', 'Timing overlay', 'sync', 'toggle', false, { info: 'On-screen sync indicator, for commissioning.' }),
  T('sync_measure_leader_only', 'Count once per surface', 'sync', 'toggle', true, { locked: true,
    lockReason: 'Prevents multi-counting one audience',
    info: 'Four boxes driving one wall are one audience. Only the leader’s camera measures — otherwise the wall counts everyone four times.' }),

  // ------------------------------------------------------------- diagnostics
  T('debug_log', 'Debug logging', 'diagnostics', 'toggle', false),
  T('log_files', 'Log file count', 'diagnostics', 'number', 5),
  T('log_size_mb', 'Log total size', 'diagnostics', 'number', 100, { unit: 'MB' }),
  T('upload_logs', 'Upload logs', 'diagnostics', 'toggle', false, {
    info: 'Send logs to Gridcast when a fault is reported. Off by default.' }),
  T('diagnostics_overlay', 'On-screen diagnostics', 'diagnostics', 'toggle', false, {
    info: 'Frame rate, sync state, last pull and live presence count. For commissioning.' }),
  T('allow_screenshot', 'Remote screenshot', 'diagnostics', 'toggle', true, {
    info: 'Lets the dashboard show what the screen is displaying right now.' }),
  T('force_notifications', 'Force notifications', 'diagnostics', 'toggle', false, {
    info: 'Treat every notification setting as on, for fault-finding.' }),
];

export const BY_KEY: Record<string, Setting> = Object.fromEntries(SETTINGS.map(s => [s.key, s]));
export const LOCKED_KEYS = SETTINGS.filter(s => s.locked).map(s => s.key);
export const PRICED_KEYS = SETTINGS.filter(s => s.priced).map(s => s.key);

/** Every setting at its shipped default. */
export function defaults(): Record<string, any> {
  return Object.fromEntries(SETTINGS.map(s => [s.key, s.def]));
}

export type Resolved = Record<string, {
  value: any;
  source: { config_id: string; name: string; layer: Layer } | null;
}>;

/**
 * Which configs apply to a screen, in the order they should be merged.
 * Within a layer, higher priority wins; equal priority falls back to age, so
 * resolution is deterministic even when two group configs touch one key.
 */
export function applicable(screen: any, groups: any[], configs: any[]): any[] {
  const memberOf = (g: any) => {
    if (g.org_id !== screen.org_id) return false;
    if (g.group_type === 'static') return (g.screen_ids || []).includes(screen.id);
    const r = g.rule_json || {};
    return (!r.venue_types || r.venue_types.includes(screen.venue_type))
      && (!r.min_size || Number(screen.size_in) >= r.min_size)
      && (!r.location_tier || screen.location_tier === r.location_tier);
  };
  const myGroups = new Set(groups.filter(memberOf).map((g: any) => g.id));

  const inLayer = (layer: Layer) => configs
    .filter((c: any) => c.layer === layer && c.status !== 'archived')
    .filter((c: any) => {
      if (layer === 'platform') return true;
      if (layer === 'org') return c.org_id === screen.org_id;
      if (layer === 'group') return myGroups.has(c.target_id);
      return c.target_id === screen.id;
    })
    .sort((a: any, b: any) => (a.priority ?? 0) - (b.priority ?? 0)
      || String(a.created_at).localeCompare(String(b.created_at)));

  return LAYER_ORDER.flatMap(inLayer);
}

/** Merge the stack into a value-plus-provenance map. */
export function resolve(screen: any, groups: any[], configs: any[]): Resolved {
  const out: Resolved = {};
  for (const s of SETTINGS) out[s.key] = { value: s.def, source: null };

  for (const c of applicable(screen, groups, configs)) {
    for (const [k, v] of Object.entries(c.values || {})) {
      if (!BY_KEY[k]) continue;                                   // unknown key, ignore
      if (BY_KEY[k].locked && c.layer !== 'platform') continue;    // locks are absolute
      out[k] = { value: v, source: { config_id: c.id, name: c.name, layer: c.layer } };
    }
  }
  return out;
}

/** Flat values only — what the player asks for. */
export function flatten(r: Resolved): Record<string, any> {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.value]));
}

/**
 * Two configs in the same layer both setting the same key. Not an error —
 * priority decides — but the editor should say so out loud.
 */
export function conflicts(screen: any, groups: any[], configs: any[]) {
  const seen: Record<string, any[]> = {};
  const out: { key: string; configs: { id: string; name: string }[] }[] = [];
  for (const c of applicable(screen, groups, configs)) {
    for (const k of Object.keys(c.values || {})) {
      (seen[k] ||= []).push(c);
    }
  }
  for (const [k, cs] of Object.entries(seen)) {
    const sameLayer = cs.filter(c => c.layer === cs[cs.length - 1].layer);
    if (sameLayer.length > 1) out.push({ key: k, configs: sameLayer.map(c => ({ id: c.id, name: c.name })) });
  }
  return out;
}

/** Priced inputs that have moved away from what a screen's rate assumed. */
export function pricingDrift(screen: any, resolved: Resolved) {
  const snap = screen.priced_against;
  if (!snap) return [];
  return PRICED_KEYS
    .filter(k => k in snap)
    .map(k => ({ key: k, label: BY_KEY[k].label, was: snap[k], now: resolved[k]?.value }))
    .filter(d => JSON.stringify(d.was) !== JSON.stringify(d.now));
}
