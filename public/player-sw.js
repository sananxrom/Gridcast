/* Only the public player shell/static assets. Never cache API responses or YouTube. */
const CACHE = 'gridcast-player-shell-v2';
const ATTENTION_WORKER = '/vision-lab/worker-attention-v1.js';
const ATTENTION_MANIFEST = '/vision-lab/attention-v1-assets.json';
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/player', ATTENTION_WORKER, ATTENTION_MANIFEST])).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
const attentionExternal = url => url.origin === 'https://cdn.jsdelivr.net' && url.pathname.startsWith('/npm/@mediapipe/tasks-vision@1.0.1/')
  || url.origin === 'https://storage.googleapis.com' && url.pathname.startsWith('/mediapipe-models/');
const safe = url => url.origin === self.location.origin && (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/models/coco-ssd/')) || attentionExternal(url);
self.addEventListener('message', event => {
  if (event.data?.type !== 'PREPARE_PLAYER' || !Array.isArray(event.data.urls)) return;
  event.waitUntil(caches.open(CACHE).then(cache => Promise.allSettled(event.data.urls.filter(value => { try { return safe(new URL(value)); } catch { return false; } }).map(url => cache.add(url)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate' && url.origin === self.location.origin && url.pathname === '/player') {
    event.respondWith(fetch(event.request).then(response => { if (response.ok) { const copy = response.clone(); void caches.open(CACHE).then(cache => cache.put('/player', copy)); } return response; }).catch(async () => (await caches.open(CACHE).then(cache => cache.match('/player'))) || Response.error()));
  } else if (attentionExternal(url)) event.respondWith(caches.open('gridcast-vision-lab-assets-1').then(cache => cache.match(event.request).then(saved => saved || fetch(event.request).then(response => { if(response.ok)void cache.put(event.request,response.clone());return response; }))));
  else if (url.origin === self.location.origin && [ATTENTION_WORKER, ATTENTION_MANIFEST].includes(url.pathname)) event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request).then(saved => saved || fetch(event.request).then(response => { if(response.ok)void cache.put(event.request,response.clone());return response; }))));
  else if (safe(url)) event.respondWith(caches.match(event.request).then(saved => saved || fetch(event.request).then(response => { if (response.ok) { const copy = response.clone(); void caches.open(CACHE).then(cache => cache.put(event.request, copy)); } return response; })));
});

// Maintenance cannot assume older open player tabs participate in evidence locks.
self.addEventListener('message', event => {
  if (event.data?.type !== 'GRIDCAST_CHECK_PLAYER_TABS' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .filter(client => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname === '/player');
    const supported = await Promise.all(clients.map(client => new Promise(resolve => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 1500);
      channel.port1.onmessage = reply => { clearTimeout(timer); channel.port1.close(); resolve(reply.data?.protocol === 1); };
      client.postMessage({ type: 'GRIDCAST_EVIDENCE_PROTOCOL' }, [channel.port2]);
    })));
    event.ports[0].postMessage({ protocol: 1, allSupported: supported.every(Boolean) });
  })());
});
