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
const attentionCounters=n=>({plays:n,playing_ms:n*10000,body_observed_ms:n*8000,body_unknown_ms:n*2000,face_observed_ms:n*7000,face_unknown_ms:n*3000,attention_observed_ms:n*5000,attention_unknown_ms:n*5000,expression_observed_ms:n*4000,expression_unknown_ms:n*6000,presence_person_ms:n*3000,looking_person_ms:n*2000,face_assessable_person_ms:n*2500,smile_person_ms:n*1000,expression_assessable_person_ms:n*1500,estimated_impressions:n,attentive_impressions:n,tracked_visits:n});
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
 assert.equal(p.totals.plays,10);assert.equal(p.totals.playing_ms,100000);assert.equal(p.byCreative.creative.plays,10);assert.equal(p.daily['2026-01-02'].attention_observed_ms,50000);
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
 const c=n=>({plays:n,playing_ms:n*10000,body_observed_ms:n*8000,body_unknown_ms:n*2000,face_observed_ms:n*7000,face_unknown_ms:n*3000,attention_observed_ms:n*5000,attention_unknown_ms:n*5000,expression_observed_ms:n*4000,expression_unknown_ms:n*6000,presence_person_ms:n*3000,looking_person_ms:n*2000,face_assessable_person_ms:n*2500,smile_person_ms:n*1000,expression_assessable_person_ms:n*1500,estimated_impressions:n,attentive_impressions:n,tracked_visits:n});
 const group=(n,mode)=>({ ...p,totals:c(n),byCreative:{creative:c(n)},byScreen:{screen:c(n)},byCampaign:{campaign:c(n)},daily:{'2026-01-02':c(n)},hourly:{},dayHours:{},byCreativeAsset:{asset:{creative_id:'creative',asset_id:'asset',asset_sha256:'sha',totals:c(n),daily:{'2026-01-02':c(n)}}},provenance:{[mode==='guided'?'[\"guided\",\"calA\"]':'[\"default\",null]']:{mode,calibration_revision:mode==='guided'?'calA':null,calibration:mode==='guided'?{yaw_tenths:12,pitch_tenths:-5,samples:10,span_ms:2700}:null,totals:c(n),daily:{'2026-01-02':c(n)}}}});
 const f=fixture();f.render();
 f.requests[0].resolve(page({attentionProfiles:{series:group(2,'default')},has_more:true,next_cursor:'screen-2',attention_page:{has_more:true,next_cursor:'attention-2'}}));await settle();
 f.requests[1].resolve(page({attentionProfiles:{series:group(3,'guided')},attention_page:{has_more:true,next_cursor:'attention-3'}}));await settle();
 f.requests[2].resolve(page({attentionProfiles:{series:group(5,'guided')}}));await settle();
 const result=f.render().data;assert.equal(result.attentionProfiles.series.totals.plays,10);assert.equal(result.attentionProfiles.series.byCreative.creative.plays,10);assert.equal(Object.keys(result.attentionProfiles.series.provenance).length,2);assert.equal(result.attentionProfiles.series.provenance['[\"default\",null]'].totals.plays,2);assert.equal(result.attentionProfiles.series.provenance['[\"guided\",\"calA\"]'].totals.plays,8);
 const csv=lib.dailyReportCsv({...result,daily:[],hourly:[],coverage:{started_at:'2026-01-01T00:00:00Z',complete:true}},{from:'2026-01-02',to:'2026-01-02'}).split('\r\n');
 const header=csv[0].split(',').map(x=>x.slice(1,-1)),row=csv.at(-1).split(',').map(x=>x.slice(1,-1));assert.equal(row[header.indexOf('asset_versions')],'1');assert.equal(row[header.indexOf('calibration_provenance')],'default|guided:calA');assert.equal(row[header.indexOf('calibrated_attention_observed_share')],'0.8');
 assert.equal(row[header.indexOf('looking_person_ms')],'20000');assert.equal(row[header.indexOf('estimated_impressions')],'10');assert.equal(row[header.indexOf('attentive_impressions')],'10');assert.equal(row.length,header.length);assert.equal(csv[1].split(',').length,header.length,'paid-delivery CSV row has the same width as the header');
});


test('no collection coverage exports unknown figures, never measured or delivery zero', () => {
  const { lib } = fixture();
  const csv = lib.dailyReportCsv({ ...page(), coverage: { started_at: null, complete: false }, daily: [], hourly: [] }, { from: '2026-01-01', to: '2026-01-01' });
  const row = csv.split('\r\n')[1].split(',').map(cell => cell.slice(1, -1));
  assert.equal(row[3], '');
  for (let i = 6; i < row.length; i++) assert.equal(row[i], '', `unknown column ${i} was fabricated`);
});
