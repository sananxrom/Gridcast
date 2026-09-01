export const uid = (p: string) => p + '_' + Math.random().toString(36).slice(2, 9);
export const nowISO = () => new Date().toISOString();
export const code6 = () => Math.random().toString(36).slice(2, 8).toUpperCase();

const VENUE_BASE: Record<string, number> = {
  grocery: 3000, cafe: 5000, gym: 6000, salon: 4000, mall: 15000, pharmacy: 3500,
};

function mkScreen(
  org: string, name: string, venue: string, vtype: string, size: string,
  sizeF: number, addr: string, locF: number, expF: number,
  lat: number, lng: number, tags: Record<string, string>, cam = true
) {
  const base = VENUE_BASE[vtype];
  const monthly = Math.round(base * sizeF * locF * expF);
  return {
    id: uid('scr'), org_id: org, name, venue_name: venue, venue_type: vtype, address: addr,
    size_in: size, orientation: 'landscape', aspect: '16:9',
    size_factor: sizeF, location_tier: locF >= 1.4 ? 'prime' : locF >= 1.15 ? 'good' : 'standard',
    location_factor: locF, exposure_factor: expF, exposure_source: 'estimated',
    venue_base: base, monthly_value: monthly, advertiser_slots: 10,
    slot_price_month: Math.round(monthly / 10),
    loop_length_s: 600, slot_duration_s: 10, operating_hours: 12,
    owner_share_pct: 25, has_camera: cam, network_available: false, network_slots: 0,
    geo_lat: lat, geo_lng: lng, tags, code: code6(),
    exclusions: { categories: [] as string[], advertisers: [] as string[] },
    status: 'active', created_at: nowISO(),
  };
}

export function seed() {
  const orgs = [
    { id: 'org_gridcast', name: 'Gridcast', type: 'gridcast', platform_fee_pct: 0, status: 'active', created_at: nowISO() },
    { id: 'org_sec17', name: 'Sector 17 Media', type: 'operator', platform_fee_pct: 10, status: 'active', created_at: nowISO() },
    { id: 'org_tricity', name: 'Tricity Screens', type: 'operator', platform_fee_pct: 12, status: 'active', created_at: nowISO() },
  ];
  const users = [
    { id: 'u_admin', org_id: 'org_gridcast', name: 'Sanan', email: 'sanan@xrom.in', role: 'platform_admin' },
    { id: 'u_op1', org_id: 'org_sec17', name: 'Ravi Mehta', email: 'ravi@sector17media.in', role: 'org_admin' },
    { id: 'u_op2', org_id: 'org_tricity', name: 'Priya Anand', email: 'priya@tricityscreens.in', role: 'org_admin' },
    { id: 'u_adv1', org_id: 'org_sec17', name: 'Fitline Gym', email: 'billing@fitline.in', role: 'advertiser_viewer', advertiser_id: 'adv_fitline' },
  ];
  const screens = [
    mkScreen('org_sec17', 'Cafe Delzo — Main Wall', 'Cafe Delzo', 'cafe', '43', 1.0, 'Sector 17-C, Chandigarh', 1.5, 1.25, 30.7411, 76.7822, { floor: 'ground', daypart: 'evening_heavy' }),
    mkScreen('org_sec17', 'Fitline Gym — Cardio Floor', 'Fitline Gym', 'gym', '55', 1.3, 'Sector 35-B, Chandigarh', 1.2, 1.2, 30.728, 76.76, { floor: '1', daypart: 'morning_heavy' }),
    mkScreen('org_sec17', 'Verma Store — Counter', 'Verma General Store', 'grocery', '32', 1.0, 'Sector 22-D, Chandigarh', 1.0, 1.0, 30.7333, 76.7794, { near: 'market' }),
    mkScreen('org_sec17', 'Elante Atrium — North', 'Elante Mall', 'mall', '75', 1.8, 'Industrial Area Ph-1', 1.5, 2.0, 30.7051, 76.8014, { floor: 'ground', premium: 'yes' }),
    mkScreen('org_tricity', 'Brew Point — Panchkula', 'Brew Point', 'cafe', '43', 1.0, 'Sector 5, Panchkula', 1.2, 1.1, 30.6942, 76.8606, {}),
    mkScreen('org_tricity', 'Mohali Chemist — Queue', 'LifeCare Pharmacy', 'pharmacy', '32', 1.0, 'Phase 7, Mohali', 1.0, 0.9, 30.7046, 76.7179, {}, false),
    mkScreen('org_gridcast', 'Gridcast Demo — Office', 'Gridcast HQ', 'cafe', '43', 1.0, 'Sector 34, Chandigarh', 1.0, 1.0, 30.72, 76.77, { demo: 'yes' }),
  ];
  screens[0].network_available = true; screens[0].network_slots = 3;
  screens[3].network_available = true; screens[3].network_slots = 4;

  const advertisers = [
    { id: 'adv_fitline', org_id: 'org_sec17', name: 'Fitline Gym', contact: 'Ankit Sharma', email: 'billing@fitline.in', phone: '+91 98765 43210', category: 'fitness', created_at: nowISO() },
    { id: 'adv_dental', org_id: 'org_sec17', name: 'Smile Dental Clinic', contact: 'Dr Neha', email: 'front@smiledental.in', phone: '+91 98110 22331', category: 'healthcare', created_at: nowISO() },
    { id: 'adv_coach', org_id: 'org_sec17', name: 'Apex Coaching', contact: 'Vikram', email: 'info@apexcoaching.in', phone: '+91 99887 66554', category: 'education', created_at: nowISO() },
    { id: 'adv_mobile', org_id: 'org_tricity', name: 'MobileHub', contact: 'Sunny', email: 'sales@mobilehub.in', phone: '+91 90000 12345', category: 'electronics', created_at: nowISO() },
    { id: 'adv_zept', org_id: 'org_gridcast', name: 'Zephyr Beverages', contact: 'Meera Iyer', email: 'brand@zephyr.in', phone: '+91 98200 55443', category: 'fmcg', created_at: nowISO() },
  ];
  const yt = ['M7lc1UVf-VE', 'aqz-KE-bpKQ', 'ScMzIvxBSi4', 'jNQXAC9IVRw'];
  const cr = (id: string, org: string, adv: string, name: string, cat: string, y: string, dur: number, ap = 'approved') =>
    ({ id, org_id: org, advertiser_id: adv, name, category: cat, youtube_id: y, duration_s: dur, aspect: '16:9', approval_status: ap, content_source: 'advertiser', created_at: nowISO() });
  const creatives = [
    cr('cr_fit_a', 'org_sec17', 'adv_fitline', 'Fitline — New Year Offer', 'fitness', yt[0], 15),
    cr('cr_fit_b', 'org_sec17', 'adv_fitline', 'Fitline — Personal Training', 'fitness', yt[1], 10),
    cr('cr_den_a', 'org_sec17', 'adv_dental', 'Smile Dental — Checkup', 'healthcare', yt[2], 10),
    cr('cr_coach_a', 'org_sec17', 'adv_coach', 'Apex — Admissions Open', 'education', yt[3], 10, 'pending'),
    cr('cr_mob_a', 'org_tricity', 'adv_mobile', 'MobileHub — Exchange Mela', 'electronics', yt[1], 10),
    cr('cr_zep_a', 'org_gridcast', 'adv_zept', 'Zephyr — Summer Cooler', 'fmcg', yt[2], 10),
  ];
  const s = screens;
  const campaigns = [
    { id: 'cmp_1', org_id: 'org_sec17', origin_org_id: 'org_sec17', advertiser_id: 'adv_fitline', name: 'Fitline — Jan Push', campaign_type: 'operator', platform_fee_pct: 0, fee_basis: 'gross', starts_at: '2026-08-15', ends_at: '2026-09-30', committed_budget: 24000, accrued_spend: 9840, rate_type: 'per_play', rate_value: 0.93, status: 'active', invoice_status: 'invoiced', creative_ids: ['cr_fit_a', 'cr_fit_b'], screen_ids: [s[0].id, s[1].id], created_at: nowISO() },
    { id: 'cmp_2', org_id: 'org_sec17', origin_org_id: 'org_sec17', advertiser_id: 'adv_dental', name: 'Smile Dental — Sector 22', campaign_type: 'operator', platform_fee_pct: 0, fee_basis: 'gross', starts_at: '2026-08-20', ends_at: '2026-10-20', committed_budget: 9000, accrued_spend: 2130, rate_type: 'per_play', rate_value: 0.42, status: 'active', invoice_status: 'not_invoiced', creative_ids: ['cr_den_a'], screen_ids: [s[2].id], created_at: nowISO() },
    { id: 'cmp_3', org_id: 'org_tricity', origin_org_id: 'org_tricity', advertiser_id: 'adv_mobile', name: 'MobileHub — Exchange Mela', campaign_type: 'operator', platform_fee_pct: 0, fee_basis: 'gross', starts_at: '2026-09-01', ends_at: '2026-09-21', committed_budget: 15000, accrued_spend: 1200, rate_type: 'per_play', rate_value: 0.8, status: 'active', invoice_status: 'not_invoiced', creative_ids: ['cr_mob_a'], screen_ids: [s[4].id], created_at: nowISO() },
    { id: 'cmp_net1', org_id: 'org_sec17', origin_org_id: 'org_gridcast', advertiser_id: 'adv_zept', name: 'Zephyr — Tricity Summer', campaign_type: 'network', platform_fee_pct: 10, fee_basis: 'gross', starts_at: '2026-08-10', ends_at: '2026-10-10', committed_budget: 40000, accrued_spend: 14200, rate_type: 'per_play', rate_value: 1.1, status: 'active', invoice_status: 'invoiced', creative_ids: ['cr_zep_a'], screen_ids: [s[0].id, s[3].id], created_at: nowISO() },
    { id: 'cmp_past1', org_id: 'org_sec17', origin_org_id: 'org_sec17', advertiser_id: 'adv_coach', name: 'Apex — Summer Admissions', campaign_type: 'operator', platform_fee_pct: 0, fee_basis: 'gross', starts_at: '2026-05-01', ends_at: '2026-06-30', committed_budget: 8000, accrued_spend: 8000, rate_type: 'flat', rate_value: 0, status: 'complete', invoice_status: 'paid', creative_ids: ['cr_coach_a'], screen_ids: [s[2].id], created_at: nowISO() },
  ];
  const groups = [
    { id: 'grp_s17', org_id: 'org_sec17', name: 'Sector 17 cluster', group_type: 'static', rule_json: null, screen_ids: [s[0].id], created_at: nowISO() },
    { id: 'grp_hi', org_id: 'org_sec17', name: 'High-footfall (43" and up)', group_type: 'dynamic', rule_json: { min_size: 43 }, screen_ids: [], created_at: nowISO() },
    { id: 'grp_food', org_id: 'org_sec17', name: 'Food & drink venues', group_type: 'dynamic', rule_json: { venue_types: ['cafe'] }, screen_ids: [], created_at: nowISO() },
  ];
  return { orgs, users, screens, advertisers, creatives, campaigns, groups, devices: [] as any[], plays: [] as any[], presence: [] as any[] };
}
