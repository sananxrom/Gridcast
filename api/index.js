import express from 'express';
import * as store from '../lib/store.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);
const now = () => new Date().toISOString();
const code6 = () => Math.random().toString(36).slice(2, 8).toUpperCase();

function seed() {
  const orgs = [
    { id: 'org_gridcast', name: 'Gridcast', type: 'gridcast', platform_fee_pct: 0, created_at: now() },
    { id: 'org_sec17',    name: 'Sector 17 Media', type: 'operator', platform_fee_pct: 10, created_at: now() },
    { id: 'org_tricity',  name: 'Tricity Screens', type: 'operator', platform_fee_pct: 12, created_at: now() }
  ];
  const users = [
    { id: 'u_admin', org_id: 'org_gridcast', name: 'Sanan', email: 'sanan@gridcast.in', role: 'platform_admin' },
    { id: 'u_op1',   org_id: 'org_sec17',    name: 'Ravi Mehta', email: 'ravi@sector17media.in', role: 'org_admin' },
    { id: 'u_op2',   org_id: 'org_tricity',  name: 'Priya Anand', email: 'priya@tricityscreens.in', role: 'org_admin' },
    { id: 'u_adv1',  org_id: 'org_sec17',    name: 'Fitline Gym', email: 'billing@fitline.in', role: 'advertiser_viewer', advertiser_id: 'adv_fitline' }
  ];
  const venueBase = { grocery: 3000, cafe: 5000, gym: 6000, salon: 4000, mall: 15000, pharmacy: 3500 };
  const mk = (o, name, venue, vtype, size, sizeF, loc, locF, expF, lat, lng, tags, cam=true) => {
    const base = venueBase[vtype];
    const monthly = Math.round(base * sizeF * locF * expF);
    return { id: uid('scr'), org_id: o, name, venue_name: venue, venue_type: vtype, address: loc,
      size_in: size, orientation: size >= 55 ? 'landscape' : 'landscape', aspect: '16:9',
      size_factor: sizeF, location_tier: locF >= 1.4 ? 'prime' : locF >= 1.15 ? 'good' : 'standard',
      location_factor: locF, exposure_factor: expF, exposure_source: 'estimated',
      venue_base: base, monthly_value: monthly, advertiser_slots: 10,
      slot_price_month: Math.round(monthly / 10),
      loop_length_s: 600, slot_duration_s: 10, operating_hours: 12,
      owner_share_pct: 25, has_camera: cam, network_available: false, network_slots: 0,
      geo_lat: lat, geo_lng: lng, tags, status: 'active', created_at: now() };
  };
  const screens = [
    mk('org_sec17','Cafe Delzo — Main Wall','Cafe Delzo','cafe','43',1.0,'Sector 17-C, Chandigarh',1.5,1.25,30.7411,76.7822,{floor:'ground',daypart:'evening_heavy'}),
    mk('org_sec17','Fitline Gym — Cardio Floor','Fitline Gym','gym','55',1.3,'Sector 35-B, Chandigarh',1.2,1.2,30.7280,76.7600,{floor:'1',daypart:'morning_heavy'}),
    mk('org_sec17','Verma Store — Counter','Verma General Store','grocery','32',1.0,'Sector 22-D, Chandigarh',1.0,1.0,30.7333,76.7794,{near:'market'}),
    mk('org_sec17','Elante Atrium — North','Elante Mall','mall','75',1.8,'Industrial Area Ph-1',1.5,2.0,30.7051,76.8014,{floor:'ground',premium:'yes'}),
    mk('org_tricity','Brew Point — Panchkula','Brew Point','cafe','43',1.0,'Sector 5, Panchkula',1.2,1.1,30.6942,76.8606,{}),
    mk('org_tricity','Mohali Chemist — Queue','LifeCare Pharmacy','pharmacy','32',1.0,'Phase 7, Mohali',1.0,0.9,30.7046,76.7179,{},false),
    mk('org_gridcast','Gridcast Demo — Office','Gridcast HQ','cafe','43',1.0,'Sector 34, Chandigarh',1.0,1.0,30.7200,76.7700,{demo:'yes'})
  ];
  const advertisers = [
    { id:'adv_fitline', org_id:'org_sec17', name:'Fitline Gym', contact:'Ankit Sharma', email:'billing@fitline.in', phone:'+91 98765 43210', category:'fitness', created_at:now() },
    { id:'adv_dental',  org_id:'org_sec17', name:'Smile Dental Clinic', contact:'Dr Neha', email:'front@smiledental.in', phone:'+91 98110 22331', category:'healthcare', created_at:now() },
    { id:'adv_coach',   org_id:'org_sec17', name:'Apex Coaching', contact:'Vikram', email:'info@apexcoaching.in', phone:'+91 99887 66554', category:'education', created_at:now() },
    { id:'adv_mobile',  org_id:'org_tricity', name:'MobileHub', contact:'Sunny', email:'sales@mobilehub.in', phone:'+91 90000 12345', category:'electronics', created_at:now() }
  ];
  const yt = ['M7lc1UVf-VE','aqz-KE-bpKQ','ScMzIvxBSi4','jNQXAC9IVRw'];
  const creatives = [
    { id:'cr_fit_a', org_id:'org_sec17', advertiser_id:'adv_fitline', name:'Fitline — New Year Offer', category:'fitness', youtube_id:yt[0], duration_s:15, aspect:'16:9', approval_status:'approved', content_source:'advertiser', created_at:now() },
    { id:'cr_fit_b', org_id:'org_sec17', advertiser_id:'adv_fitline', name:'Fitline — Personal Training', category:'fitness', youtube_id:yt[1], duration_s:10, aspect:'16:9', approval_status:'approved', content_source:'advertiser', created_at:now() },
    { id:'cr_den_a', org_id:'org_sec17', advertiser_id:'adv_dental', name:'Smile Dental — Checkup', category:'healthcare', youtube_id:yt[2], duration_s:10, aspect:'16:9', approval_status:'approved', content_source:'advertiser', created_at:now() },
    { id:'cr_coach_a',org_id:'org_sec17', advertiser_id:'adv_coach', name:'Apex — Admissions Open', category:'education', youtube_id:yt[3], duration_s:10, aspect:'16:9', approval_status:'pending', content_source:'advertiser', created_at:now() },
    { id:'cr_mob_a', org_id:'org_tricity', advertiser_id:'adv_mobile', name:'MobileHub — Exchange Mela', category:'electronics', youtube_id:yt[1], duration_s:10, aspect:'16:9', approval_status:'approved', content_source:'advertiser', created_at:now() }
  ];
  const s = screens;
  const campaigns = [
    { id:'cmp_1', org_id:'org_sec17', origin_org_id:'org_sec17', advertiser_id:'adv_fitline', name:'Fitline — Jan Push',
      campaign_type:'operator', platform_fee_pct:0, fee_basis:'gross',
      starts_at:'2026-08-15', ends_at:'2026-09-30', committed_budget:24000, accrued_spend:9840,
      rate_type:'per_play', rate_value:0.93, status:'active', invoice_status:'invoiced',
      creative_ids:['cr_fit_a','cr_fit_b'], screen_ids:[s[0].id, s[1].id], created_at:now() },
    { id:'cmp_2', org_id:'org_sec17', origin_org_id:'org_sec17', advertiser_id:'adv_dental', name:'Smile Dental — Sector 22',
      campaign_type:'operator', platform_fee_pct:0, fee_basis:'gross',
      starts_at:'2026-08-20', ends_at:'2026-10-20', committed_budget:9000, accrued_spend:2130,
      rate_type:'per_play', rate_value:0.42, status:'active', invoice_status:'not_invoiced',
      creative_ids:['cr_den_a'], screen_ids:[s[2].id], created_at:now() },
    { id:'cmp_3', org_id:'org_tricity', origin_org_id:'org_tricity', advertiser_id:'adv_mobile', name:'MobileHub — Exchange Mela',
      campaign_type:'operator', platform_fee_pct:0, fee_basis:'gross',
      starts_at:'2026-09-01', ends_at:'2026-09-21', committed_budget:15000, accrued_spend:1200,
      rate_type:'per_play', rate_value:0.80, status:'active', invoice_status:'not_invoiced',
      creative_ids:['cr_mob_a'], screen_ids:[s[4].id], created_at:now() }
  ];
  const pairings = screens.map(sc => ({ id: uid('pr'), org_id: sc.org_id, screen_id: sc.id,
    code: code6(), status: 'unused', created_at: now(), used_at: null, device_id: null }));
  return { orgs, users, screens, advertisers, creatives, campaigns, pairings, devices: [], plays: [], presence: [] };
}

let db = null;
async function load() {
  if (db) return db;
  db = await store.read();
  if (!db) { db = seed(); await store.write(db); }
  return db;
}
async function save() { await store.write(db); }
app.use(async (req, res, next) => { try { await load(); next(); } catch (e) { next(e); } });

const scope = (rows, orgId, isAdmin) => isAdmin ? rows : rows.filter(r => r.org_id === orgId);

app.get('/api/bootstrap', async (req, res) => {
  const u = db.users.find(x => x.id === req.query.user) || db.users[0];
  const isAdmin = u.role === 'platform_admin';
  const org = db.orgs.find(o => o.id === u.org_id);
  res.json({
    user: u, org, isAdmin,
    orgs: db.orgs,
    screens: scope(db.screens, u.org_id, isAdmin),
    advertisers: scope(db.advertisers, u.org_id, isAdmin),
    creatives: scope(db.creatives, u.org_id, isAdmin),
    campaigns: scope(db.campaigns, u.org_id, isAdmin),
    pairings: scope(db.pairings, u.org_id, isAdmin),
    devices: scope(db.devices, u.org_id, isAdmin),
    plays: scope(db.plays, u.org_id, isAdmin).slice(-400),
    presence: db.presence.slice(-400)
  });
});

app.get('/api/users', async (req, res) => res.json(db.users.map(u => ({ ...u, org: db.orgs.find(o => o.id === u.org_id).name }))));

// ---- player pairing + playlist
app.post('/api/pair', async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const p = db.pairings.find(x => x.code === code);
  if (!p) return res.status(404).json({ error: 'Invalid screen code' });
  const screen = db.screens.find(s => s.id === p.screen_id);
  let device = db.devices.find(d => d.screen_id === screen.id);
  if (!device) {
    device = { id: uid('dev'), org_id: screen.org_id, screen_id: screen.id, app_ver: '0.1.0',
      last_heartbeat_at: now(), status: 'online', created_at: now() };
    db.devices.push(device);
  }
  p.status = 'used'; p.used_at = now(); p.device_id = device.id;
  await save();
  res.json({ device, screen, token: device.id });
});

app.get('/api/playlist/:screenId', async (req, res) => {
  const screen = db.screens.find(s => s.id === req.params.screenId);
  if (!screen) return res.status(404).json({ error: 'no screen' });
  const today = new Date().toISOString().slice(0, 10);
  const items = [];
  for (const c of db.campaigns) {
    if (!c.screen_ids.includes(screen.id)) continue;
    if (c.status !== 'active') continue;
    if (c.starts_at > today || c.ends_at < today) continue;
    for (const crid of c.creative_ids) {
      const cr = db.creatives.find(x => x.id === crid);
      if (!cr || cr.approval_status !== 'approved') continue;
      const adv = db.advertisers.find(a => a.id === cr.advertiser_id);
      items.push({ campaign_id: c.id, campaign_name: c.name, creative_id: cr.id,
        creative_name: cr.name, advertiser: adv ? adv.name : '—',
        youtube_id: cr.youtube_id, duration_s: cr.duration_s, rate_value: c.rate_value });
    }
  }
  res.json({ screen, items, loop_length_s: screen.loop_length_s });
});

app.post('/api/play', async (req, res) => {
  const { screen_id, campaign_id, creative_id, duration_ms, avg_persons, sample_count, measured } = req.body;
  const screen = db.screens.find(s => s.id === screen_id);
  if (!screen) return res.status(404).json({ error: 'no screen' });
  const play = { id: uid('ply'), org_id: screen.org_id, screen_id, campaign_id, creative_id,
    started_at: new Date(Date.now() - (duration_ms || 10000)).toISOString(), ended_at: now(),
    duration_ms: duration_ms || 10000, billable: true, server_received_at: now() };
  db.plays.push(play);
  db.presence.push({ id: uid('prs'), play_id: play.id, org_id: screen.org_id, screen_id,
    measured: !!measured, avg_persons: measured ? avg_persons : null,
    sample_count: sample_count || 0, model_ver: 'coco-ssd@2.2.3', at: now() });
  const c = db.campaigns.find(x => x.id === campaign_id);
  if (c) c.accrued_spend = Math.round((c.accrued_spend + (c.rate_value || 0)) * 100) / 100;
  const d = db.devices.find(x => x.screen_id === screen_id);
  if (d) { d.last_heartbeat_at = now(); d.status = 'online'; }
  await save();
  res.json({ ok: true, play_id: play.id });
});

// ---- mutations
app.post('/api/creative/:id/approve', async (req, res) => {
  const cr = db.creatives.find(c => c.id === req.params.id);
  if (!cr) return res.sendStatus(404);
  cr.approval_status = req.body.status || 'approved';
  cr.approved_at = now(); await save(); res.json(cr);
});
app.post('/api/screen/:id', async (req, res) => {
  const s = db.screens.find(x => x.id === req.params.id);
  if (!s) return res.sendStatus(404);
  Object.assign(s, req.body);
  s.monthly_value = Math.round(s.venue_base * s.size_factor * s.location_factor * s.exposure_factor);
  s.slot_price_month = Math.round(s.monthly_value / (s.advertiser_slots || 10));
  await save(); res.json(s);
});
app.post('/api/advertiser', async (req, res) => {
  const a = { id: uid('adv'), created_at: now(), ...req.body };
  db.advertisers.push(a); await save(); res.json(a);
});
app.post('/api/campaign', async (req, res) => {
  const c = { id: uid('cmp'), created_at: now(), accrued_spend: 0, status: 'active',
    campaign_type: 'operator', platform_fee_pct: 0, fee_basis: 'gross', invoice_status: 'not_invoiced', ...req.body };
  db.campaigns.push(c); await save(); res.json(c);
});
app.post('/api/creative', async (req, res) => {
  const c = { id: uid('cr'), created_at: now(), approval_status: 'pending', content_source: 'advertiser', ...req.body };
  db.creatives.push(c); await save(); res.json(c);
});
app.post('/api/pairing/:screenId/regen', async (req, res) => {
  const s = db.screens.find(x => x.id === req.params.screenId);
  const p = db.pairings.find(x => x.screen_id === req.params.screenId);
  if (p) { p.code = code6(); p.status = 'unused'; p.used_at = null; await save(); return res.json(p); }
  const np = { id: uid('pr'), org_id: s.org_id, screen_id: s.id, code: code6(), status: 'unused', created_at: now() };
  db.pairings.push(np); await save(); res.json(np);
});
app.post('/api/reset', async (req, res) => { db = seed(); await save(); res.json({ ok: true }); });

app.get('/api/_health', async (req, res) => res.json({ ok: true, store: store.mode, plays: db.plays.length }));

export default app;

if (!process.env.VERCEL) {
  const express2 = (await import('express')).default;
  const path = (await import('path')).default;
  const wrap = express2();
  wrap.use(express2.static(path.join(process.cwd(), 'public')));
  wrap.use(app);
  const PORT = process.env.PORT || 4000;
  wrap.listen(PORT, () => console.log(`\n  Gridcast prototype → http://localhost:${PORT}\n`));
}
