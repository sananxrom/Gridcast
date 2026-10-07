const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), ts = require('typescript');

function loadRobots() {
  const file = path.resolve(__dirname, '../app/robots.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', code)(mod, mod.exports);
  return mod.exports.default;
}

test('robots.txt allows crawling (so noindex is seen), no disallow, no sitemap', () => {
  const out = loadRobots()();
  const rules = [].concat(out.rules);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].userAgent, '*');
  assert.deepEqual([].concat(rules[0].allow), ['/']);
  assert.equal(rules[0].disallow, undefined);
  assert.equal(out.sitemap, undefined);
});

test('next.config sends X-Robots-Tag noindex on every path, including api and assets', async () => {
  const config = (await import('../next.config.mjs')).default;
  const entries = await config.headers();
  const match = entries.find(e => e.source === '/:path*');
  assert.ok(match, 'catch-all header rule present');
  const tag = match.headers.find(h => h.key === 'X-Robots-Tag');
  assert.equal(tag.value, 'noindex, nofollow');
});

test('root layout metadata sets robots index/follow false', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../app/layout.tsx'), 'utf8');
  assert.match(src, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
});
