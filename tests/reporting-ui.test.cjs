const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const zero = () => ({ plays_rendered: 0, plays_billable: 0, plays_not_rendered: 0, plays_filler: 0, presence_sum: 0, presence_n: 0, airtime_ms: 0 });
function page(overrides = {}) {
  return { totals: zero(), byScreen: {}, byCampaign: {}, byCreative: {}, daily: {}, hourly: {},attentionProfiles:{},attention_page:{has_more:false,next_cursor:null}, coverage: { started_at: '2026-01-01T00:00:00Z', complete: true }, last_at: null, rows: 1, has_more: false, next_cursor: null, ...overrides };
}
const attentionCounters=n=>({plays:n,playing_ms:n*10000,body_observed_ms:n*8000,body_unknown_ms:n*2000,face_observed_ms:n*7000,face_unknown_ms:n*3000,attention_observed_ms:n*5000,attention_unknown_ms:n*5000,expression_observed_ms:n*4000,expression_unknown_ms:n*6000,presence_person_ms:n*3000,looking_person_ms:n*2000,longest_look_ms:n*1500,face_assessable_person_ms:n*2500,smile_person_ms:n*1000,expression_assessable_person_ms:n*1500,estimated_impressions:n,attentive_impressions:n,tracked_visits:n});
function profilePage(n){const c=attentionCounters(n),series={profile:'v1',manifest_sha256:'m',pipeline_sha256:'p',calibration_revision:'c',asset_id:'asset',asset_sha256:'sha',config_version:1,totals:c,byScreen:{screen:c},byCampaign:{campaign:c},byCreative:{creative:c},daily:{'2026-01-02':c},hourly:{'12':c},dayHours:{'2026-01-02T12':c}};return {attentionProfiles:{series},};}
// Exercise the hook state machine without a DOM. Requests are controlled promises;
// effects run after render and clean up exactly when their dependency key changes.
function fixture() {
  let cursor = 0, state = [], effectDeps = [], cleanup = [], effects = [];
  const requests = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!effectDeps[index] || deps.some((value, i) => value !== effectDeps[index][i])) {
        effectDeps[index] = deps;
        effects.push(() => { cleanup[index]?.(); cleanup[index] = effect(); });
      }
    },
    useId() { return 'test'; },
  };
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'components/views/delivery-report.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react') return react;
    if (name === '@/lib/client') return { api: url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })) };
    if (name.startsWith('@/')) return {};
    return require(name);
  }, mod, mod.exports);
  return { lib: mod.exports, requests, render(options = {}) { cursor = 0; const result = mod.exports.useDeliveryReport(options); const pending = effects; effects = []; pending.forEach(effect => effect()); return result; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('attention person-hours remain unavailable without coverage while measured zero stays zero',()=>{
 const {lib}=fixture();assert.equal(lib.attentionHours(0,0),'Unavailable');assert.equal(lib.attentionHours(0,1234),'Unavailable');assert.equal(lib.attentionHours(1000,0),'0.00 h');assert.equal(lib.attentionHours(1000,3600000),'1.00 h');assert.equal(lib.attentionPeopleRate(1000,0),null);assert.equal(lib.attentionPeopleRate(2000,1000),2);
});

test('report periods use IST and reject reversed, invalid, overlong and future ranges', () => {
  const { lib } = fixture();
  assert.deepEqual(lib.reportPreset('today', Date.parse('2026-01-01T18:45:00Z')), { from: '2026-01-02', to: '2026-01-02' });
  assert.deepEqual(lib.reportPreset('7d', Date.parse('2026-01-01T18:45:00Z')), { from: '2025-12-27', to: '2026-01-02' });
  assert.ok(lib.periodError({ from: '2026-02-30', to: '2026-03-01' }));
  assert.ok(lib.periodError({ from: '2026-03-02', to: '2026-03-01' }));
  assert.ok(lib.periodError({ from: '2025-01-01', to: '2025-04-04' }));
  assert.ok(lib.periodError({ from: '2100-01-01', to: '2100-01-02' }));
  assert.equal(lib.periodError({ from: '2025-01-01', to: '2025-04-03' }), null);
});

test('the report publishes only after every page and combines measured numerators, not means', async () => {
  const f = fixture(); f.render();
  f.requests[0].resolve(page({ totals: { ...zero(), plays_rendered: 2, presence_sum: 10, presence_n: 2 }, has_more: true, next_cursor: 'second' }));
  await settle();
  assert.equal(f.render().data, null);
  assert.equal(f.render().loading, true);
  assert.match(f.requests[1].url, /after=second/);
  f.requests[1].resolve(page({ totals: { ...zero(), plays_rendered: 100, presence_sum: 900, presence_n: 100 } }));
  await settle();
  const result = f.render();
  assert.equal(result.loading, false);
  assert.equal(result.data.totals.plays_rendered, 102);
  assert.equal(result.data.totals.presence_sum / result.data.totals.presence_n, 910 / 102);
});

test('multi-page profile totals and dimensions do not double the first page with unequal attention cursors',async()=>{
 const f=fixture();f.render();
 f.requests[0].resolve(page({...profilePage(2),has_more:true,next_cursor:'screen-2',attention_page:{has_more:true,next_cursor:'attention-2'}}));await settle();
 assert.match(f.requests[1].url,/after=screen-2/);assert.match(f.requests[1].url,/attention_after=attention-2/);
 f.requests[1].resolve(page({...profilePage(3),totals:{...zero(),plays_rendered:1},attention_page:{has_more:true,next_cursor:'attention-3'}}));await settle();
 assert.match(f.requests[2].url,/after=%7E/);assert.match(f.requests[2].url,/attention_after=attention-3/);
 f.requests[2].resolve(page(profilePage(5)));await settle();
 const result=f.render().data,p=result.attentionProfiles.series;
 assert.equal(p.totals.plays,10);assert.equal(p.totals.playing_ms,100000);assert.equal(p.totals.longest_look_ms,7500,'longest-look aggregation is MAX across pages');assert.equal(p.byCreative.creative.plays,10);assert.equal(p.daily['2026-01-02'].attention_observed_ms,50000);
 assert.equal(result.totals.plays_rendered,1);
});

test('scope changes hide previous results before effects and discard late prior requests', async () => {
  const f = fixture(); f.render({ org: 'org-a' });
  f.requests[0].resolve(page({ totals: { ...zero(), plays_rendered: 9 } })); await settle();
  assert.equal(f.render({ org: 'org-a' }).data.totals.plays_rendered, 9);
  const switched = f.render({ org: 'org-b' });
  assert.equal(switched.data, null);
  assert.equal(switched.loading, true);
  f.render({ org: 'org-c' });
  f.requests[1].resolve(page({ totals: { ...zero(), plays_rendered: 500 }, has_more: true, next_cursor: 'must-not-request' })); await settle();
  assert.equal(f.requests.length, 3);
  assert.equal(f.render({ org: 'org-c' }).data, null);
  f.requests[2].resolve(page({ totals: { ...zero(), plays_rendered: 7 } })); await settle();
  assert.equal(f.render({ org: 'org-c' }).data.totals.plays_rendered, 7);
});

test('a failed later page and a repeating cursor never expose partial totals', async () => {
  const f = fixture(); f.render();
  f.requests[0].resolve(page({ has_more: true, next_cursor: 'same' })); await settle();
  f.requests[1].resolve(page({ has_more: true, next_cursor: 'same' })); await settle();
  assert.equal(f.render().data, null);
  assert.match(f.render().error, /could not finish/);
  const g = fixture(); g.render();
  g.requests[0].resolve(page({ has_more: true, next_cursor: 'next' })); await settle();
  g.requests[1].reject(new Error('Network interrupted')); await settle();
  assert.equal(g.render().data, null);
  assert.match(g.render().error, /Network interrupted/);
});

test('CSV distinguishes unknown days, known zero delivery and measured zero people', () => {
  const { lib } = fixture();
  const data = { ...page(), coverage: { started_at: '2026-01-02T03:00:00Z', complete: false }, hourly: [], daily: [{ date: '2026-01-02', ...zero(), plays_rendered: 1, presence_n: 1, presence_sum: 0 }] };
  const csv = lib.dailyReportCsv(data, { from: '2026-01-01', to: '2026-01-03' });
  const rows = csv.split('\r\n').map(row => row.split(',').map(cell => cell.slice(1, -1)));
  assert.equal(rows[1][6], '', 'pre-coverage delivery is unknown');
  assert.equal(rows[1][11], '', 'pre-coverage denominator is unknown');
  assert.equal(rows[2][12], '0', 'measured zero people is a real zero');
  assert.equal(rows[3][6], '0', 'covered day without receipts has zero recorded delivery');
  assert.equal(rows[3][12], '', 'no measurement is not zero people');
  assert.equal(rows[2][4], 'false');
  assert.equal(lib.csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
});

test('attention pagination does not double first-page totals and keeps unavailable metrics blank in export',async()=>{
 const {lib}=fixture(),p={profile:'v1',manifest_sha256:'m',pipeline_sha256:'p',calibration_revision:'c',asset_id:'asset',asset_sha256:'sha',config_version:2};
 const c=n=>({plays:n,playing_ms:n*10000,body_observed_ms:n*8000,body_unknown_ms:n*2000,face_observed_ms:n*7000,face_unknown_ms:n*3000,attention_observed_ms:n*5000,attention_unknown_ms:n*5000,expression_observed_ms:n*4000,expression_unknown_ms:n*6000,presence_person_ms:n*3000,looking_person_ms:n*2000,longest_look_ms:n*1500,face_assessable_person_ms:n*2500,smile_person_ms:n*1000,expression_assessable_person_ms:n*1500,estimated_impressions:n,attentive_impressions:n,tracked_visits:n});
 const group=(n,mode)=>({ ...p,totals:c(n),byCreative:{creative:c(n)},byScreen:{screen:c(n)},byCampaign:{campaign:c(n)},daily:{'2026-01-02':c(n)},hourly:{},dayHours:{},byCreativeAsset:{asset:{creative_id:'creative',asset_id:'asset',asset_sha256:'sha',totals:c(n),daily:{'2026-01-02':c(n)}}},provenance:{[mode==='guided'?'[\"guided\",\"calA\"]':'[\"default\",null]']:{mode,calibration_revision:mode==='guided'?'calA':null,calibration:mode==='guided'?{yaw_tenths:12,pitch_tenths:-5,samples:10,span_ms:2700}:null,totals:c(n),daily:{'2026-01-02':c(n)}}}});
 const f=fixture();f.render();
 f.requests[0].resolve(page({attentionProfiles:{series:group(2,'default')},has_more:true,next_cursor:'screen-2',attention_page:{has_more:true,next_cursor:'attention-2'}}));await settle();
 f.requests[1].resolve(page({attentionProfiles:{series:group(3,'guided')},attention_page:{has_more:true,next_cursor:'attention-3'}}));await settle();
 f.requests[2].resolve(page({attentionProfiles:{series:group(5,'guided')}}));await settle();
 const result=f.render().data;assert.equal(result.attentionProfiles.series.totals.plays,10);assert.equal(result.attentionProfiles.series.byCreative.creative.plays,10);assert.equal(Object.keys(result.attentionProfiles.series.provenance).length,2);assert.equal(result.attentionProfiles.series.provenance['[\"default\",null]'].totals.plays,2);assert.equal(result.attentionProfiles.series.provenance['[\"guided\",\"calA\"]'].totals.plays,8);
 const csv=lib.dailyReportCsv({...result,daily:[],hourly:[],coverage:{started_at:'2026-01-01T00:00:00Z',complete:true}},{from:'2026-01-02',to:'2026-01-02'}).split('\r\n');
 const header=csv[0].split(',').map(x=>x.slice(1,-1)),row=csv.at(-1).split(',').map(x=>x.slice(1,-1));assert.equal(row[header.indexOf('asset_versions')],'1');assert.equal(row[header.indexOf('calibration_provenance')],'default|guided:calA');assert.equal(row[header.indexOf('calibrated_attention_observed_share')],'0.8');
 assert.equal(row[header.indexOf('looking_person_ms')],'20000');assert.equal(row[header.indexOf('estimated_impressions')],'10');assert.equal(row[header.indexOf('attentive_impressions')],'10');assert.equal(row.length,header.length);assert.equal(csv[1].split(',').length,header.length,'paid-delivery CSV row has the same width as the header');
 assert.equal(row[header.indexOf('presence_person_ms')],'30000');assert.equal(row[header.indexOf('mean_people_per_body_observed_ms')],'0.375','selected-profile body average is reproducible from the exported profile numerator and observed-time denominator');
});

test('attention export follows one selected compatible profile and keeps known zero distinct from no coverage',()=>{
 const {lib}=fixture(),first=profilePage(1).attentionProfiles.series,second=profilePage(2).attentionProfiles.series;
 first.profile='older';second.profile='selected-newer';second.totals={...second.totals,estimated_impressions:0,attentive_impressions:0,body_observed_ms:1000,attention_observed_ms:1000,looking_person_ms:0};second.daily['2026-01-02']={...second.daily['2026-01-02'],estimated_impressions:0,attentive_impressions:0,body_observed_ms:1000,attention_observed_ms:1000,looking_person_ms:0};
 const data={...page({attentionProfiles:{older:first,newer:second},daily:[],hourly:[]}),coverage:{started_at:'2026-01-01T00:00:00Z',complete:true}};
 const csv=lib.dailyReportCsv(data,{from:'2026-01-02',to:'2026-01-02'},'newer').split('\r\n'),header=csv[0].split(',').map(x=>x.slice(1,-1));
 const profileRows=csv.slice(1).filter(row=>row.includes('attention_profile_series'));
 assert.equal(profileRows.length,1,'CSV must not combine profile series');
 const values=profileRows[0].split(',').map(x=>x.slice(1,-1));assert.equal(values[header.indexOf('profile_series_id')],'newer');
 assert.equal(values[header.indexOf('estimated_impressions')],'0');assert.equal(values[header.indexOf('attentive_impressions')],'0');
 assert.equal(lib.attentionPeopleRate(0,0),null,'zero people-time with zero assessable duration is unavailable');
 assert.equal(lib.attentionPeopleRate(0,5000),0,'zero looking with positive assessable duration is measured zero');
});


test('no collection coverage exports unknown figures, never measured or delivery zero', () => {
  const { lib } = fixture();
  const csv = lib.dailyReportCsv({ ...page(), coverage: { started_at: null, complete: false }, daily: [], hourly: [] }, { from: '2026-01-01', to: '2026-01-01' });
  const row = csv.split('\r\n')[1].split(',').map(cell => cell.slice(1, -1));
  assert.equal(row[3], '');
  for (let i = 6; i < row.length; i++) assert.equal(row[i], '', `unknown column ${i} was fabricated`);
});

// Phase 2: headline selectors shared by the full report cards and the campaign dashboard.
function metrics() {
  const { lib } = fixture(), loadLib = require('./load-lib.cjs');
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'components/views/report-metrics.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', code)(name => name === '@/components/views/delivery-report' ? lib : name === '@/lib/utils' ? loadLib('utils') : require(name), mod, mod.exports);
  return { lib, m: mod.exports };
}
// The card expressions exactly as DeliveryReport rendered them before the split (value, then hint), for comparison.
function oldCards(lib, data, selectedAttention) {
  const number = value => value.toLocaleString('en-IN'), formatAverage = c => (c.presence_n > 0 ? c.presence_sum / c.presence_n : null)?.toFixed(1) ?? 'Unmeasured';
  const rows = [
    ['plays_rendered', number(data.totals.plays_rendered), 'Completed paid play receipts'],
    ['plays_billable', number(data.totals.plays_billable), 'Passed every billing check'],
    ['plays_not_rendered', number(data.totals.plays_not_rendered), 'Paid receipts not rendered'],
    ['plays_filler', number(data.totals.plays_filler), 'Separate from advertiser delivery'],
    ['presence_avg', selectedAttention?.totals.body_observed_ms?lib.attentionPeopleRate(selectedAttention.totals.presence_person_ms,selectedAttention.totals.body_observed_ms).toFixed(1):selectedAttention?'Unavailable':formatAverage(data.totals), selectedAttention?`${(selectedAttention.totals.body_observed_ms/60000).toFixed(1)} body-observed min · ${selectedAttention.profile}`:`${number(data.totals.presence_n)} legacy measured / ${number(data.totals.plays_rendered)} paid plays`],
    ['attention_avg_people', selectedAttention?.totals.attention_observed_ms?lib.attentionPeopleRate(selectedAttention.totals.looking_person_ms,selectedAttention.totals.attention_observed_ms).toFixed(1):'Unavailable', selectedAttention?`${(selectedAttention.totals.attention_observed_ms/60000).toFixed(1)} assessable min / ${(selectedAttention.totals.attention_unknown_ms/60000).toFixed(1)} unknown min`:'No accepted attention analytics'],
    ['estimated_impressions', selectedAttention?.totals.body_observed_ms?number(selectedAttention.totals.estimated_impressions):'Unavailable', selectedAttention?`${(selectedAttention.totals.body_observed_ms/60000).toFixed(1)} body-observed min`:'No accepted attention analytics'],
    ['attentive_impressions', selectedAttention?.totals.attention_observed_ms?number(selectedAttention.totals.attentive_impressions):'Unavailable', selectedAttention?`${(selectedAttention.totals.attention_observed_ms/60000).toFixed(1)} assessable min`:'No accepted attention analytics'],
  ];
  return Object.fromEntries(rows.map(([metric, value, hint]) => [metric, { value: data.coverage.started_at ? value : '—', hint: data.coverage.started_at ? hint : 'No daily summaries collected yet' }]));
}
function newCards(m, data, selected) {
  return { plays_rendered: m.paidDeliveredCard(data), plays_billable: m.billableCard(data), plays_not_rendered: m.failedCard(data), plays_filler: m.fillerCard(data), presence_avg: m.presenceCard(data, selected), attention_avg_people: m.lookingCard(data, selected), estimated_impressions: m.estimatedImpressionsCard(data, selected), attentive_impressions: m.attentiveImpressionsCard(data, selected) };
}

test('headline selectors produce exactly the strings the old report cards showed', () => {
  const { lib, m } = metrics();
  const counted = { ...zero(), plays_rendered: 12345, plays_billable: 12000, plays_not_rendered: 3, plays_filler: 7, presence_sum: 25, presence_n: 10 };
  const noBody = { ...attentionCounters(3), body_observed_ms: 0, attention_observed_ms: 0 };
  const series = (name, counters) => ({ ...profilePage(1).attentionProfiles.series, profile: name, totals: counters });
  const cases = {
    legacyMeasured: page({ totals: counted }),
    legacyUnmeasured: page({ totals: { ...counted, presence_n: 0, presence_sum: 0 } }),
    notStarted: page({ totals: zero(), coverage: { started_at: null, complete: false } }),
    profile: page({ totals: counted, attentionProfiles: { one: series('presence-v2/x', attentionCounters(4)) } }),
    profileWithoutObservation: page({ totals: counted, attentionProfiles: { one: series('attention-v1/y', noBody) } }),
    profileNotStarted: page({ totals: zero(), coverage: { started_at: null, complete: false }, attentionProfiles: { one: series('v1', attentionCounters(2)) } }),
  };
  for (const [name, data] of Object.entries(cases)) {
    const { profile } = m.selectAttention(data, '');
    assert.deepEqual(newCards(m, data, profile), oldCards(lib, data, profile), name);
  }
  assert.equal(m.presenceCard(cases.legacyUnmeasured).value, 'Unmeasured', 'legacy without measurement is not 0');
  assert.equal(m.estimatedImpressionsCard(cases.legacyMeasured).value, 'Unavailable', 'no profile means unavailable impressions');
  assert.equal(m.estimatedImpressionsCard(cases.profileWithoutObservation, m.selectAttention(cases.profileWithoutObservation, '').profile).value, 'Unavailable');
  assert.equal(m.paidDeliveredCard(cases.notStarted).value, '—');
  assert.equal(m.estimatedImpressionsCard(cases.profileNotStarted, m.selectAttention(cases.profileNotStarted, '').profile).value, '—');
  assert.equal(m.paidDeliveredCard(cases.legacyMeasured).value, (12345).toLocaleString('en-IN'));
  assert.equal(m.rowPeople(counted, undefined, false), '2.5');
  assert.equal(m.rowPeople(counted, undefined, true), 'Unavailable', 'selected profile without a row is unavailable, not legacy');
  assert.equal(m.rowPeople(counted, attentionCounters(4), true), (12000 / 32000).toFixed(2));
});

test('multiple profiles are selected one at a time and never summed', () => {
  const { lib, m } = metrics();
  const a = { ...profilePage(1).attentionProfiles.series, profile: 'attention-v1/a', totals: attentionCounters(3) };
  const b = { ...profilePage(1).attentionProfiles.series, profile: 'presence-v2/b', totals: attentionCounters(7) };
  const data = page({ attentionProfiles: { b, a } });
  const first = m.selectAttention(data, '');
  assert.deepEqual(first.keys, ['a', 'b']); assert.equal(first.key, 'a', 'default is the first sorted key, as before');
  assert.equal(m.estimatedImpressionsCard(data, first.profile).value, '3');
  const chosen = m.selectAttention(data, 'b');
  assert.equal(m.estimatedImpressionsCard(data, chosen.profile).value, '7', 'selected profile only, not 3 + 7');
  assert.deepEqual(newCards(m, data, chosen.profile), oldCards(lib, data, chosen.profile));
  assert.equal(m.selectAttention(data, 'missing').key, 'a');
  assert.deepEqual(m.profileCues(data, chosen.keys, chosen.profile).map(c => c.text), ['profile: presence-v2/b · 2 profiles']);
  assert.deepEqual(m.profileCues(page({ attentionProfiles: { a } }), ['a'], a), [], 'one measured profile, complete coverage: no cue');
});

test('period breakdown plays distinguish partial rows, unknown rows, and complete zero', () => {
  const { m } = metrics();
  const partial = page({ coverage: { started_at: '2026-01-01T00:00:00Z', complete: false },
    byScreen: { screen: { ...zero(), plays_rendered: 4 } }, byCreative: { creative: { ...zero(), plays_rendered: 7 } } });
  assert.deepEqual(m.periodBreakdownPlays(partial, partial.byScreen.screen), { value: '4', cue: 'recorded · partial' });
  assert.deepEqual(m.periodBreakdownPlays(partial, partial.byCreative.creative), { value: '7', cue: 'recorded · partial' });
  assert.deepEqual(m.periodBreakdownPlays(partial), { value: '—', cue: 'unknown · partial' }, 'missing rows stay unknown before full period coverage');
  const complete = page({ coverage: { started_at: '2026-01-01T00:00:00Z', complete: true } });
  assert.deepEqual(m.periodBreakdownPlays(complete), { value: '0' }, 'a complete period proves a missing row means zero');
  assert.deepEqual(m.periodBreakdownPlays(page({ coverage: { started_at: null, complete: false } })), { value: '—' });
});

test('profile cues explain unavailable impression and people headlines with one or no profile', () => {
  const { m } = metrics();
  const noBody = { ...profilePage(0).attentionProfiles.series, profile: 'presence-v2/no-observations', totals: attentionCounters(0) };
  const oneProfile = page({ attentionProfiles: { one: noBody } });
  assert.deepEqual(m.profileCues(oneProfile, ['one'], noBody, 'impressions').map(c => c.text), ['no body observations']);
  assert.deepEqual(m.profileCues(oneProfile, ['one'], noBody, 'people').map(c => c.text), ['no body observations']);
  const noMeasurements = page();
  assert.deepEqual(m.profileCues(noMeasurements, [], undefined, 'impressions').map(c => c.text), ['no accepted profile data']);
  assert.deepEqual(m.profileCues(noMeasurements, [], undefined, 'people').map(c => c.text), ['no presence measurements']);
  const legacyMeasured = page({ totals: { ...zero(), presence_n: 2, presence_sum: 3 } });
  assert.deepEqual(m.profileCues(legacyMeasured, [], undefined, 'impressions').map(c => c.text), ['no accepted profile data']);
  assert.deepEqual(m.profileCues(legacyMeasured, [], undefined, 'people'), [], 'available legacy people averages need no unavailable cue');
});

test('dashboard cues show partial, unstarted and invalid-time coverage next to the value', () => {
  const { m } = metrics();
  assert.deepEqual(m.playsCues(page()), []);
  assert.deepEqual(m.playsCues(page({ coverage: { started_at: '2026-01-01T00:00:00Z', complete: false } })).map(c => c.text), ['partial']);
  assert.deepEqual(m.playsCues(page({ coverage: { started_at: null, complete: false } })).map(c => c.text), ['no daily summaries yet']);
  assert.deepEqual(m.playsCues(page({ totals: { ...zero(), plays_time_invalid: 1200 } })).map(c => c.text), [`${(1200).toLocaleString('en-IN')} receipts had invalid times`]);
});

test('spend card keeps lifetime spend, labels a redacted budget and never invents spend', () => {
  const { m } = metrics();
  const own = m.spendCard({ accrued_spend: 850, committed_budget: 1000 }, false, '₹1.00 per play');
  assert.equal(own.value, '₹850'); assert.equal(own.pct, 85); assert.equal(own.bar, true); assert.equal(own.hot, true);
  assert.equal(own.hint, 'of ₹1,000 · independent of report dates · new bookings: ₹1.00 per play');
  assert.deepEqual(own.cues.map(c => c.text), ['Lifetime']);
  const scoped = m.spendCard({ accrued_spend: 0.93, reporting_scope: 'organisation' }, true, '—');
  assert.equal(scoped.label, 'Lifetime gross on your screens'); assert.equal(scoped.bar, false, 'no budget bar without a visible budget');
  assert.deepEqual(scoped.cues.map(c => c.text), ['Lifetime', 'your screens only']);
  const hidden = m.spendCard({ committed_budget: 1000 }, false, '—');
  assert.equal(hidden.value, 'Unavailable'); assert.equal(hidden.bar, false); assert.deepEqual(hidden.cues.map(c => c.text), ['Lifetime', 'not visible to you']);
});

test('dashboard daily series keep missing days as gaps and use one profile', () => {
  const { m } = metrics();
  const period = { from: '2026-01-01', to: '2026-01-03' };
  const legacy = { ...page({ coverage: { started_at: '2026-01-01T18:30:00Z', complete: false } }), daily: [{ date: '2026-01-02', ...zero(), plays_rendered: 4, presence_n: 2, presence_sum: 3 }, { date: '2026-01-03', ...zero(), plays_rendered: 5 }], hourly: [] };
  assert.deepEqual(m.dailyPlayRows(legacy, period).map(r => r.value), [null, 4, 5], 'before coverage is a gap, recorded plays as-is');
  assert.deepEqual(m.dailyPeopleRows(legacy, period).map(r => r.value), [null, 1.5, null], 'unmeasured day is a gap, not zero');
  assert.deepEqual(m.dailyImpressionRows(legacy, period).map(r => r.value), [null, null, null]);
  assert.equal(m.hasValues(m.dailyImpressionRows(legacy, period)), false, 'switcher disables impressions without a profile');
  const profile = profilePage(2).attentionProfiles.series;
  assert.deepEqual(m.dailyPeopleRows(legacy, period, profile).map(r => r.value), [null, 6000 / 16000, null]);
  assert.deepEqual(m.dailyImpressionRows(legacy, period, profile).map(r => r.value), [null, 2, null]);
});
