/* Isolated /vision-lab/ scope. Never handles /player, API, receipts or media uploads. */
const CACHE = 'gridcast-vision-lab-shell-1';
const MODELS = 'gridcast-vision-lab-assets-1';
let manifest;
const getManifest = async () => manifest ||= (await fetch('/vision-lab/assets.json', { cache: 'no-store' })).json();
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
async function asset(request, entry) {
  const cache = await caches.open(MODELS), saved = await cache.match(entry.url);
  if (saved) return saved;
  const response = await fetch(request);
  if (!response.ok || response.type === 'opaque') throw Error('Model download unavailable');
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength !== entry.bytes || hex(await crypto.subtle.digest('SHA-256', bytes)) !== entry.sha256) throw Error('Model integrity mismatch');
  await cache.put(entry.url, response.clone()); return response;
}
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(['/vision-lab/evaluate', '/vision-lab/worker.js', '/vision-lab/assets.json']);
  manifest = await (await cache.match('/vision-lab/assets.json')).json();
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
async function loadManifest() {
  if (manifest) return manifest;
  const saved = await (await caches.open(CACHE)).match('/vision-lab/assets.json');
  return manifest = saved ? await saved.json() : await getManifest();
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    const m = await loadManifest(), entry = m.assets.find(a => a.url === url.href);
    if (entry) return asset(event.request, entry);
    const allowed = url.origin === location.origin && (url.pathname.startsWith('/vision-lab/') || url.pathname.startsWith('/_next/static/'));
    if (!allowed) return fetch(event.request);
    const cache = await caches.open(CACHE), saved = await cache.match(event.request);
    // Static chunks are immutable; route/worker/manifest prefer network so a new build can update.
    if (url.pathname.startsWith('/_next/static/') && saved) return saved;
    try { const response = await fetch(event.request); if (response.ok) await cache.put(event.request, response.clone()); return response; }
    catch (error) { if (saved) return saved; throw error; }
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'PLAYER_TABS') event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    event.ports[0]?.postMessage({ open: tabs.some(c => new URL(c.url).pathname === '/player') });
  })());
});
