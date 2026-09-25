const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const zero = () => ({ plays_rendered: 0, plays_billable: 0, plays_not_rendered: 0, plays_filler: 0, presence_sum: 0, presence_n: 0, airtime_ms: 0 });
function page(overrides = {}) {
  return { totals: zero(), byScreen: {}, byCampaign: {}, byCreative: {}, daily: {}, hourly: {}, coverage: { started_at: '2026-01-01T00:00:00Z', complete: true }, last_at: null, rows: 1, has_more: false, next_cursor: null, ...overrides };
}
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


test('no collection coverage exports unknown figures, never measured or delivery zero', () => {
  const { lib } = fixture();
  const csv = lib.dailyReportCsv({ ...page(), coverage: { started_at: null, complete: false }, daily: [], hourly: [] }, { from: '2026-01-01', to: '2026-01-01' });
  const row = csv.split('\r\n')[1].split(',').map(cell => cell.slice(1, -1));
  assert.equal(row[3], '');
  for (let i = 6; i < row.length; i++) assert.equal(row[i], '', `unknown column ${i} was fabricated`);
});
