import type { Observation } from './metrics';
export const EVALUATION_PROFILE = 'mediapipe-1.0.1-face1-efficientdet-int8-1';
type Asset = { name: string; url: string; sha256: string; bytes: number };
const assetCache = 'gridcast-vision-lab-assets-1';
export async function prepareEvaluation(onProgress: (message: string) => void, signal: AbortSignal) {
  if (!window.isSecureContext || !navigator.serviceWorker || !window.Worker || !window.createImageBitmap) throw Error('This browser needs HTTPS, service workers and transferable camera frames.');
  onProgress('Preparing the isolated offline workspace…');
  const registration = await navigator.serviceWorker.register('/vision-lab/sw.js', { scope: '/vision-lab/' });
  const deadline = Date.now() + 30000;
  while (!registration.active || !navigator.serviceWorker.controller?.scriptURL.endsWith('/vision-lab/sw.js')) {
    signal.throwIfAborted();
    if (Date.now() > deadline) throw Error('Offline workspace did not activate. Reload this page and try again.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const response = await fetch('/vision-lab/assets.json', { signal });
  if (!response.ok) throw Error('Model manifest is unavailable');
  const manifest: { version: string; assets: Asset[] } = await response.json();
  if (manifest.version !== EVALUATION_PROFILE || manifest.assets.length !== 7) throw Error('Unexpected model manifest version. Reload before testing.');
  const cache = await caches.open(assetCache);
  let finished = 0;
  for (const entry of manifest.assets) {
    signal.throwIfAborted();
    onProgress(`Checking model files ${++finished}/${manifest.assets.length} · ${entry.name}`);
    const existing = await cache.match(entry.url);
    let r = existing || await fetch(entry.url, { signal, mode: 'cors' });
    if (!r.ok || r.type === 'opaque') throw Error(`Could not download ${entry.name}`);
    let bytes = await r.clone().arrayBuffer();
    const digest = async (b: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b))).map(n => n.toString(16).padStart(2, '0')).join('');
    if (bytes.byteLength !== entry.bytes || await digest(bytes) !== entry.sha256) {
      await cache.delete(entry.url);
      throw Error(`Integrity check failed for ${entry.name}. Retry online to download a verified copy.`);
    }
    if (!existing) await cache.put(entry.url, r);
  }
  // Initial page scripts may have arrived before this scope took control. Cache those exact build URLs.
  const shell = await caches.open('gridcast-vision-lab-shell-1');
  const resources = performance.getEntriesByType('resource').map(e => e.name).filter(value => {
    const url = new URL(value); return url.origin === location.origin && url.pathname.startsWith('/_next/static/');
  });
  await Promise.all([...new Set(resources)].map(async url => {
    if (!await shell.match(url)) { const r = await fetch(url, { signal }); if (!r.ok) throw Error('A page asset is unavailable'); await shell.put(url, r); }
  }));
  signal.throwIfAborted();
  onProgress('Model files verified and cached. Ready to initialize.');
  return { bytes: manifest.assets.reduce((n, a) => n + a.bytes, 0), version: manifest.version };
}
export async function assertIsolated() {
  const registration = await navigator.serviceWorker.getRegistration('/vision-lab/evaluate');
  if (!registration?.active?.scriptURL.endsWith('/vision-lab/sw.js')) throw Error('Evaluation coordination is unavailable.');
  const open = await new Promise<boolean>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(Error('Could not check for other player tabs.')); }, 4000);
    channel.port1.onmessage = e => { clearTimeout(timer); channel.port1.close(); resolve(e.data?.open !== false); };
    registration.active!.postMessage({ type: 'PLAYER_TABS' }, [channel.port2]);
  });
  if (open) throw Error('A Gridcast player is open in this browser. Finish or pause that session safely and close its player tab before benchmarking. Do not clear its saved records.');
}
export type EngineStatus = { delegate: 'CPU' | 'GPU'; latencyMs: number; faceFps: number; personFps: number; dropped: number };
export async function createEvaluationWorker(delegate: 'CPU' | 'GPU', signal: AbortSignal, observe: (value: Observation, stats: EngineStatus, context?:any) => void, fail: (message: string) => void, workerUrl = '/vision-lab/worker.js', initData:Record<string,unknown>={}) {
  const worker = new Worker(workerUrl); // classic, deliberately: module-worker WASM loading failed the real probe.
  let lastVideoTime = -1;
  let busy = false, closed = false, sentAt = 0, lastFace = -Infinity, lastPerson = -Infinity, dropped = 0;
  const faceTimes: number[] = [], personTimes: number[] = [];
  let watch: ReturnType<typeof setInterval> | undefined;
  const close = () => { if (closed) return; closed = true; worker.terminate(); if (watch) clearInterval(watch); signal.removeEventListener('abort', close); };
  signal.addEventListener('abort', close, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(Error('Model initialization timed out. Try the CPU backend.')); }, 60000);
      const abort = () => { cleanup(); reject(new DOMException('Stopped', 'AbortError')); };
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
      signal.addEventListener('abort', abort, { once: true });
      worker.onerror = e => { cleanup(); reject(Error(e.message || 'Worker initialization failed')); };
      worker.onmessage = ({ data }) => { if (data.type === 'READY') { cleanup(); resolve(); } else if (data.type === 'ERROR') { cleanup(); reject(Error(data.error)); } };
      worker.postMessage({ type: 'INIT', delegate, ...initData });
    });
    signal.throwIfAborted();
    worker.onerror = e => { close(); fail(e.message || 'Vision worker stopped'); };
    worker.onmessage = ({ data }) => {
      if (closed) return;
      busy = false;
      if (data.type !== 'OBSERVATION') { fail(data.error || 'Vision worker failed'); close(); return; }
      const now = performance.now(), value: Observation = data.observation;
      const stale = now - value.at > 1000;
      if (stale) {
        value.calibration = null;
        value.at = now;
        if (value.bodies) value.bodies = { ok: false, boxes: [], saturated: false };
        if (value.faces) value.faces = { ok: false, faces: [], saturated: false };
      }
      if (value.faces) faceTimes.push(now);
      if (value.bodies) personTimes.push(now);
      while (faceTimes.length && faceTimes[0] < now - 5000) faceTimes.shift();
      while (personTimes.length && personTimes[0] < now - 5000) personTimes.shift();
      observe(value, { delegate, latencyMs: data.durationMs, faceFps: faceTimes.length / 5, personFps: personTimes.length / 5, dropped },data.context);
    };
    watch = setInterval(() => { if (busy && performance.now() - sentAt > 10000) { close(); fail('Inference stalled. Stopped the camera; try the CPU backend.'); } }, 1000);
    return {
      close,
      get busy() { return busy; },
      async frame(video: HTMLVideoElement, calibration: { yaw: number; pitch: number }, context?:any) {
        if (closed || signal.aborted || video.readyState < 2 || video.paused || video.ended || video.currentTime === lastVideoTime || (video.srcObject instanceof MediaStream && !video.srcObject.getVideoTracks().some(t => t.readyState === 'live' && !t.muted && t.enabled))) return;
        const at = performance.now(), face = at - lastFace >= 125, person = at - lastPerson >= 1000 / 3;
        if (!face && !person) return;
        if (busy) { dropped++; return; }
        busy = true; sentAt = at; lastVideoTime = video.currentTime;
        try {
          const frame = await createImageBitmap(video, { resizeWidth: 640, resizeHeight: Math.max(1, Math.round(640 * video.videoHeight / video.videoWidth)), resizeQuality: 'low' });
          if (closed || signal.aborted) { frame.close(); busy = false; return; }
          if (face) lastFace = at; if (person) lastPerson = at;
          worker.postMessage({ type: 'FRAME', frame, at, face, person, calibration, context }, [frame]);
        } catch (error: any) { busy = false; close(); fail(error.message || 'Camera frame could not be read'); }
      },
    };
  } catch (error) { close(); throw error; }
}

/** One benchmark per origin/browser profile; release on every stop or failed start. */
export async function acquireEvaluationLock(signal: AbortSignal): Promise<() => void> {
  if (!navigator.locks) throw Error('This browser cannot coordinate isolated camera tests.');
  return new Promise((resolve, reject) => {
    void navigator.locks.request('gridcast-attention-evaluation', { ifAvailable: true }, async lock => {
      if (!lock) { reject(Error('Another attention test is running in this browser. Stop that test first.')); return; }
      if (signal.aborted) { reject(new DOMException('Stopped', 'AbortError')); return; }
      await new Promise<void>(release => {
        const done = () => { signal.removeEventListener('abort', done); release(); };
        signal.addEventListener('abort', done, { once: true });
        resolve(done);
      });
    }).catch(reject);
  });
}
