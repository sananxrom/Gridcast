import * as store from './store';
import { seed, uid, nowISO, code6 } from './seed';
import * as cfg from './config';

let db: any = null;
async function load() {
  if (db) return db;
  db = await store.read();
  if (!db) { db = seed(); await store.write(db); }
  return db;
}
const save = () => store.write(db);
const scope = (rows: any[], orgId: string, isAdmin: boolean) => (isAdmin ? rows : rows.filter(r => r.org_id === orgId));

/** Configs visible to a caller: their own, plus the platform baseline they inherit. */
const scopeConfigs = (orgId: string, isAdmin: boolean) =>
  (db.configs || []).filter((c: any) => isAdmin || c.org_id === orgId || c.layer === 'platform');

/** Locked keys may only be set by a platform-layer config. */
function lockedViolations(c: any): string[] {
  if (c.layer === 'platform') return [];
  return Object.keys(c.values || {}).filter(k => cfg.LOCKED_KEYS.includes(k));
}

const resolveFor = (screen: any) => cfg.resolve(screen, db.groups || [], db.configs || []);

export function screenStatus(screen: any) {
  const dev = db.devices.find((d: any) => d.screen_id === screen.id);
  if (!dev) return { state: 'unpaired', label: 'not paired', device: null, age_s: null };
  const age = (Date.now() - new Date(dev.last_heartbeat_at).getTime()) / 1000;
  const state = age < 90 ? 'live' : age < 900 ? 'stalled' : 'offline';
  return { state, label: state === 'live' ? 'on air' : state === 'stalled' ? 'not responding' : 'offline', device: dev, age_s: Math.round(age) };
}

type Res = { status?: number; body: any };

export async function handle(method: string, seg: string[], q: URLSearchParams, body: any): Promise<Res> {
  await load();
  const p = seg.join('/');

  if (method === 'GET' && p === '_health') return { body: { ok: true, store: store.mode, plays: db.plays.length } };
  if (method === 'GET' && p === 'users')
    return { body: db.users.map((u: any) => ({ ...u, org: db.orgs.find((o: any) => o.id === u.org_id).name })) };

  if (method === 'GET' && p === 'bootstrap') {
    const u = db.users.find((x: any) => x.id === q.get('user')) || db.users[0];
    const isAdmin = u.role === 'platform_admin';
    const camps = scope(db.campaigns, u.org_id, isAdmin);
    const refAdv = new Set(camps.map((c: any) => c.advertiser_id));
    const refCr = new Set(camps.flatMap((c: any) => c.creative_ids));
    const ownAdv = scope(db.advertisers, u.org_id, isAdmin);
    const ownCr = scope(db.creatives, u.org_id, isAdmin);
    return { body: {
      user: u, org: db.orgs.find((o: any) => o.id === u.org_id), isAdmin, orgs: db.orgs,
      screens: scope(db.screens, u.org_id, isAdmin).map((s: any) => ({ ...s, _status: screenStatus(s) })),
      advertisers: isAdmin ? ownAdv : [...ownAdv, ...db.advertisers.filter((a: any) => refAdv.has(a.id) && !ownAdv.some((o: any) => o.id === a.id))],
      creatives: isAdmin ? ownCr : [...ownCr, ...db.creatives.filter((c: any) => refCr.has(c.id) && !ownCr.some((o: any) => o.id === c.id))],
      campaigns: camps, groups: scope(db.groups || [], u.org_id, isAdmin),
      devices: scope(db.devices, u.org_id, isAdmin),
      plays: scope(db.plays, u.org_id, isAdmin).slice(-1500),
      presence: db.presence.slice(-1500),
      settings: db.settings || {},
      configs: scopeConfigs(u.org_id, isAdmin),
    } };
  }

  if (method === 'POST' && p === 'pair') {
    const code = String(body.code || '').trim().toUpperCase();
    const screen = db.screens.find((s: any) => s.code === code);
    if (!screen) return { status: 404, body: { error: 'Invalid screen code' } };
    let device = db.devices.find((d: any) => d.screen_id === screen.id);
    if (!device) { device = { id: uid('dev'), org_id: screen.org_id, screen_id: screen.id, app_ver: '0.2.0', last_heartbeat_at: nowISO(), status: 'online', created_at: nowISO() }; db.devices.push(device); }
    device.last_heartbeat_at = nowISO(); device.status = 'online';
    await save(); return { body: { device, screen, token: device.id } };
  }

  if (method === 'GET' && seg[0] === 'playlist') {
    const screen = db.screens.find((s: any) => s.id === seg[1]);
    if (!screen) return { status: 404, body: { error: 'no screen' } };
    const t = new Date().toISOString().slice(0, 10);
    const items: any[] = [];
    for (const c of db.campaigns) {
      if (!c.screen_ids.includes(screen.id) || c.status !== 'active' || c.starts_at > t || c.ends_at < t) continue;
      for (const crid of c.creative_ids) {
        const cr = db.creatives.find((x: any) => x.id === crid);
        if (!cr || cr.approval_status !== 'approved') continue;
        if ((screen.exclusions?.categories || []).includes(cr.category)) continue;
        const adv = db.advertisers.find((a: any) => a.id === cr.advertiser_id);
        items.push({ campaign_id: c.id, campaign_name: c.name, creative_id: cr.id, creative_name: cr.name, advertiser: adv?.name || '—', youtube_id: cr.youtube_id, duration_s: cr.duration_s, rate_value: c.rate_value });
      }
    }
    return { body: { config: cfg.flatten(resolveFor(screen)), screen, items, loop_length_s: screen.loop_length_s } };
  }

  if (method === 'POST' && p === 'nowplaying') {
    const dev = db.devices.find((d: any) => d.screen_id === body.screen_id);
    if (!dev) return { status: 404, body: { error: 'no device' } };
    dev.now_playing = { campaign_id: body.campaign_id, creative_id: body.creative_id, duration_s: body.duration_s, started_at: nowISO() };
    dev.last_heartbeat_at = nowISO(); dev.status = 'online';
    return { body: { ok: true } };
  }

  if (method === 'POST' && p === 'play') {
    const screen = db.screens.find((s: any) => s.id === body.screen_id);
    if (!screen) return { status: 404, body: { error: 'no screen' } };
    const play = { id: uid('ply'), org_id: screen.org_id, screen_id: body.screen_id, campaign_id: body.campaign_id, creative_id: body.creative_id, started_at: new Date(Date.now() - (body.duration_ms || 10000)).toISOString(), ended_at: nowISO(), duration_ms: body.duration_ms || 10000, billable: true, server_received_at: nowISO() };
    db.plays.push(play);
    db.presence.push({ id: uid('prs'), play_id: play.id, org_id: screen.org_id, screen_id: body.screen_id, measured: !!body.measured, avg_persons: body.measured ? body.avg_persons : null, sample_count: body.sample_count || 0, model_ver: 'coco-ssd@2.2.3', at: nowISO() });
    const c = db.campaigns.find((x: any) => x.id === body.campaign_id);
    if (c && c.rate_type === 'per_play') c.accrued_spend = Math.round((c.accrued_spend + (c.rate_value || 0)) * 100) / 100;
    else if (c && c.rate_type === 'flat') {
      const st = new Date(c.starts_at).getTime(), en = new Date(c.ends_at).getTime();
      const total = Math.max(1, (en - st) / 86400000);
      const gone = Math.min(total, Math.max(0, (Date.now() - st) / 86400000));
      c.accrued_spend = Math.round(c.committed_budget * (gone / total));
    }
    const dev = db.devices.find((x: any) => x.screen_id === body.screen_id);
    if (dev) { dev.last_heartbeat_at = nowISO(); dev.status = 'online'; }
    await save(); return { body: { ok: true, play_id: play.id } };
  }

  if (method === 'GET' && seg[0] === 'campaign' && seg[1]) {
    const c = db.campaigns.find((x: any) => x.id === seg[1]);
    if (!c) return { status: 404, body: { error: 'not found' } };
    const plays = db.plays.filter((x: any) => x.campaign_id === c.id);
    const byPlay = Object.fromEntries(db.presence.map((x: any) => [x.play_id, x]));
    const agg = (rows: any[]) => { const m = rows.map(r => byPlay[r.id]).filter((x: any) => x?.measured);
      return { plays: rows.length, measured: m.length, avg: m.length ? m.reduce((a: number, b: any) => a + b.avg_persons, 0) / m.length : null }; };
    return { body: {
      campaign: c, advertiser: db.advertisers.find((a: any) => a.id === c.advertiser_id) || null,
      org: db.orgs.find((o: any) => o.id === c.org_id) || null, totals: agg(plays),
      byScreen: c.screen_ids.map((id: string) => db.screens.find((s: any) => s.id === id)).filter(Boolean)
        .map((s: any) => ({ screen: s, ...agg(plays.filter((p: any) => p.screen_id === s.id)) })),
      byCreative: c.creative_ids.map((id: string) => db.creatives.find((x: any) => x.id === id)).filter(Boolean)
        .map((cr: any) => ({ creative: cr, ...agg(plays.filter((p: any) => p.creative_id === cr.id)) })),
      plays: plays.slice(-300).reverse().map((p: any) => ({ ...p, presence: byPlay[p.id] || null })),
    } };
  }

  if (method === 'GET' && seg[0] === 'screen' && seg[1]) {
    const screen = db.screens.find((s: any) => s.id === seg[1]);
    if (!screen) return { status: 404, body: { error: 'not found' } };
    const st = screenStatus(screen);
    const plays = db.plays.filter((p: any) => p.screen_id === screen.id);
    const byPlay = Object.fromEntries(db.presence.map((x: any) => [x.play_id, x]));
    const t = new Date().toISOString().slice(0, 10);
    const measured = plays.map((p: any) => byPlay[p.id]).filter((x: any) => x?.measured);
    const advOf = (id: string) => db.advertisers.find((a: any) => a.id === id);
    const camps = db.campaigns.filter((c: any) => c.screen_ids.includes(screen.id)).map((c: any) => {
      const cp = plays.filter((p: any) => p.campaign_id === c.id);
      const cm = cp.map((p: any) => byPlay[p.id]).filter((x: any) => x?.measured);
      return { id: c.id, name: c.name, status: c.status, campaign_type: c.campaign_type,
        live: c.status === 'active' && c.starts_at <= t && c.ends_at >= t,
        advertiser: advOf(c.advertiser_id)?.name || '—', starts_at: c.starts_at, ends_at: c.ends_at,
        committed_budget: c.committed_budget, accrued_spend: c.accrued_spend,
        creatives: c.creative_ids.map((id: string) => db.creatives.find((x: any) => x.id === id)).filter(Boolean),
        plays: cp.length, avg: cm.length ? cm.reduce((a: number, b: any) => a + b.avg_persons, 0) / cm.length : null };
    });
    let np: any = null;
    if (st.device?.now_playing && st.state === 'live') {
      const n = st.device.now_playing;
      const cr = db.creatives.find((x: any) => x.id === n.creative_id);
      const c = db.campaigns.find((x: any) => x.id === n.campaign_id);
      np = { creative: cr, campaign: c ? { id: c.id, name: c.name } : null, advertiser: c ? advOf(c.advertiser_id)?.name || '—' : '—',
        started_at: n.started_at, duration_s: n.duration_s, elapsed_s: (Date.now() - new Date(n.started_at).getTime()) / 1000 };
    }
    const resolved = resolveFor(screen);
    return { body: { screen, status: st, nowPlaying: np, campaigns: camps,
      config: resolved,
      configStack: cfg.applicable(screen, db.groups || [], db.configs || []).map((c: any) => ({ id: c.id, name: c.name, layer: c.layer, keys: Object.keys(c.values || {}).length })),
      configConflicts: cfg.conflicts(screen, db.groups || [], db.configs || []),
      pricingDrift: cfg.pricingDrift(screen, resolved),
      stats: { plays: plays.length, playsToday: plays.filter((p: any) => (p.ended_at || '').slice(0, 10) === t).length,
        measured: measured.length, avg: measured.length ? measured.reduce((a: number, b: any) => a + b.avg_persons, 0) / measured.length : null,
        liveCampaigns: camps.filter((c: any) => c.live).length },
      recent: plays.slice(-40).reverse().map((p: any) => ({ ...p, creative: db.creatives.find((x: any) => x.id === p.creative_id), presence: byPlay[p.id] || null })) } };
  }

  if (method === 'POST' && seg[0] === 'campaign' && seg[1] && !seg[2]) {
    const c = db.campaigns.find((x: any) => x.id === seg[1]);
    if (!c) return { status: 404, body: { error: 'not found' } };
    for (const k of ['name','starts_at','ends_at','committed_budget','rate_type','rate_value','status','invoice_status','screen_ids','creative_ids']) if (k in body) c[k] = body[k];
    await save(); return { body: c };
  }
  if (method === 'POST' && p === 'campaign') {
    const c = { id: uid('cmp'), created_at: nowISO(), accrued_spend: 0, status: 'active', campaign_type: 'operator', platform_fee_pct: 0, fee_basis: 'gross', invoice_status: 'not_invoiced', ...body };
    db.campaigns.push(c); await save(); return { body: c };
  }
  if (method === 'POST' && seg[0] === 'creative' && seg[2] === 'approve') {
    const cr = db.creatives.find((x: any) => x.id === seg[1]);
    if (!cr) return { status: 404, body: { error: 'not found' } };
    cr.approval_status = body.status || 'approved'; cr.approved_at = nowISO();
    await save(); return { body: cr };
  }
  if (method === 'POST' && p === 'creative') {
    const c = { id: uid('cr'), created_at: nowISO(), approval_status: 'pending', content_source: 'advertiser', ...body };
    db.creatives.push(c); await save(); return { body: c };
  }
  if (method === 'POST' && p === 'advertiser') {
    const a = { id: uid('adv'), created_at: nowISO(), ...body };
    db.advertisers.push(a); await save(); return { body: a };
  }
  if (method === 'POST' && seg[0] === 'screen' && seg[1] && seg[2] === 'exclusions') {
    const s = db.screens.find((x: any) => x.id === seg[1]);
    if (!s) return { status: 404, body: { error: 'not found' } };
    s.exclusions = body.exclusions || { categories: [], advertisers: [] };
    await save(); return { body: s };
  }
  if (method === 'POST' && seg[0] === 'screen' && seg[1] && !seg[2]) {
    const s = db.screens.find((x: any) => x.id === seg[1]);
    if (!s) return { status: 404, body: { error: 'not found' } };
    Object.assign(s, body);
    s.monthly_value = Math.round(s.venue_base * s.size_factor * s.location_factor * s.exposure_factor);
    s.slot_price_month = Math.round(s.monthly_value / (s.advertiser_slots || 10));
    await save(); return { body: s };
  }
  if (method === 'POST' && p === 'group/resolve') {
    const g = (db.groups || []).find((x: any) => x.id === body.group_id);
    if (!g) return { body: { screen_ids: [] } };
    if (g.group_type === 'static') return { body: { screen_ids: g.screen_ids } };
    const r = g.rule_json || {};
    return { body: { screen_ids: db.screens.filter((s: any) => s.org_id === (body.org_id || g.org_id)
      && (!r.venue_types || r.venue_types.includes(s.venue_type))
      && (!r.min_size || Number(s.size_in) >= r.min_size)
      && (!r.location_tier || s.location_tier === r.location_tier)).map((s: any) => s.id) } };
  }
  if (method === 'POST' && p === 'org') {
    const o = { id: uid('org'), type: 'operator', platform_fee_pct: 10, status: 'active', created_at: nowISO(), ...body };
    db.orgs.push(o);
    db.users.push({ id: uid('u'), org_id: o.id, name: body.admin_name || o.name + ' admin', email: body.admin_email || '', role: 'org_admin' });
    await save(); return { body: o };
  }
  if (method === 'POST' && seg[0] === 'org' && seg[1]) {
    const o = db.orgs.find((x: any) => x.id === seg[1]);
    if (!o) return { status: 404, body: { error: 'not found' } };
    for (const k of ['name', 'type', 'status']) if (k in body) o[k] = body[k];
    // only the platform may move an operator's fee
    if ('platform_fee_pct' in body && body._as === 'platform_admin') o.platform_fee_pct = Number(body.platform_fee_pct) || 0;
    await save(); return { body: o };
  }
  if (method === 'POST' && seg[0] === 'user' && seg[1]) {
    const u = db.users.find((x: any) => x.id === seg[1]);
    if (!u) return { status: 404, body: { error: 'not found' } };
    for (const k of ['name', 'email', 'phone']) if (k in body) u[k] = body[k];
    await save(); return { body: u };
  }
  if (method === 'GET' && p === 'settings') return { body: db.settings || {} };
  if (method === 'POST' && p === 'settings') {
    db.settings = { ...(db.settings || {}), ...body };
    await save(); return { body: db.settings };
  }
  if (method === 'GET' && p === 'config') {
    const u = db.users.find((x: any) => x.id === q.get('user')) || db.users[0];
    return { body: scopeConfigs(u.org_id, u.role === 'platform_admin') };
  }
  if (method === 'GET' && p === 'config/schema')
    return { body: { groups: cfg.GROUPS, settings: cfg.SETTINGS, locked: cfg.LOCKED_KEYS, priced: cfg.PRICED_KEYS } };

  if (method === 'POST' && p === 'config') {
    const c = { id: uid('cfg'), layer: 'group', target_id: null, priority: 0, tags: [] as string[],
      target_platform: ['android'], status: 'active', values: {}, created_at: nowISO(), ...body };
    const bad = lockedViolations(c);
    if (bad.length) return { status: 403, body: { error: `Locked settings cannot be set below the platform layer: ${bad.join(', ')}` } };
    db.configs.push(c); await save(); return { body: c };
  }
  /** Assign one config to many screens by creating or moving screen-layer overrides. */
  if (method === 'POST' && p === 'config/assign') {
    const src = db.configs.find((x: any) => x.id === body.config_id);
    if (!src) return { status: 404, body: { error: 'not found' } };
    for (const sid of body.screen_ids || []) {
      const screen = db.screens.find((x: any) => x.id === sid);
      if (!screen) continue;
      let own = db.configs.find((x: any) => x.layer === 'screen' && x.target_id === sid);
      if (!own) {
        own = { id: uid('cfg'), org_id: screen.org_id, layer: 'screen', target_id: sid, priority: 0,
          name: `${screen.name} — override`, description: '', tags: [], target_platform: ['android'],
          status: 'active', values: {}, created_at: nowISO() };
        db.configs.push(own);
      }
      own.values = { ...own.values, ...src.values };
      own.updated_at = nowISO();
    }
    await save(); return { body: { ok: true, screens: (body.screen_ids || []).length } };
  }
  if (method === 'POST' && seg[0] === 'config' && seg[1] && !seg[2]) {
    const c = db.configs.find((x: any) => x.id === seg[1]);
    if (!c) return { status: 404, body: { error: 'not found' } };
    const next = { ...c, ...body };
    const bad = lockedViolations(next);
    if (bad.length) return { status: 403, body: { error: `Locked settings cannot be set below the platform layer: ${bad.join(', ')}` } };
    for (const k of ['name', 'description', 'tags', 'layer', 'target_id', 'priority', 'target_platform', 'values', 'status'])
      if (k in body) c[k] = body[k];
    c.updated_at = nowISO();
    await save(); return { body: c };
  }
  if (method === 'POST' && seg[0] === 'config' && seg[1] && seg[2] === 'delete') {
    db.configs = db.configs.filter((x: any) => x.id !== seg[1]);
    await save(); return { body: { ok: true } };
  }
  /** Set or clear keys on a screen's own override config, creating it on demand. */
  if (method === 'POST' && seg[0] === 'screen' && seg[1] && seg[2] === 'config') {
    const screen = db.screens.find((x: any) => x.id === seg[1]);
    if (!screen) return { status: 404, body: { error: 'not found' } };
    const bad = Object.keys(body.values || {}).filter((k: string) => cfg.LOCKED_KEYS.includes(k));
    if (bad.length) return { status: 403, body: { error: `Locked settings cannot be set on a screen: ${bad.join(', ')}` } };

    let own = db.configs.find((x: any) => x.layer === 'screen' && x.target_id === screen.id);
    if (!own) {
      own = { id: uid('cfg'), org_id: screen.org_id, layer: 'screen', target_id: screen.id, priority: 0,
        name: `${screen.name} — override`, description: 'Set on this screen only', tags: [],
        target_platform: ['android'], status: 'active', values: {}, created_at: nowISO() };
      db.configs.push(own);
    }
    own.values = { ...own.values, ...(body.values || {}) };
    for (const k of body.unset || []) delete own.values[k];
    own.updated_at = nowISO();
    if (!Object.keys(own.values).length) db.configs = db.configs.filter((x: any) => x.id !== own.id);
    await save();
    return { body: { config: resolveFor(screen), stack: cfg.applicable(screen, db.groups || [], db.configs || []).map((c: any) => ({ id: c.id, name: c.name, layer: c.layer })) } };
  }

  if (method === 'POST' && seg[0] === 'screen' && seg[1] && seg[2] === 'reprice') {
    const screen = db.screens.find((x: any) => x.id === seg[1]);
    if (!screen) return { status: 404, body: { error: 'not found' } };
    const r = resolveFor(screen);
    screen.priced_against = Object.fromEntries(cfg.PRICED_KEYS.map(k => [k, r[k]?.value]));
    await save(); return { body: screen };
  }

  if (method === 'POST' && p === 'reset') { db = seed(); await save(); return { body: { ok: true } }; }

  return { status: 404, body: { error: 'no route: ' + method + ' /' + p } };
}
