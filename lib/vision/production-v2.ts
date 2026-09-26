import type { Observation } from './metrics';
import { PRESENCE_V2_PROFILE } from './presence-v2-profile';
export { PRESENCE_V2_PROFILE } from './presence-v2-profile';

type Asset = { name: string; url: string; sha256: string; bytes: number };
type Manifest = { version: string; assets: Asset[] };
type Stage = 'body' | 'face';
type StageStatus = { state: 'starting' | 'ready' | 'error'; model: string; message?: string; last_at?: number; observed_fps?:number; result_ms?:number };
export type PresenceV2State = { body: StageStatus; face: StageStatus };
export type PresenceV2AssetProgress = { message:string;phase:'checking'|'downloading'|'verifying';downloaded:number;verified:number;total:number;elapsedSeconds:number;etaSeconds:null };
const CACHE = 'gridcast-presence-v2-assets-1';
const WORKER_HASH: Record<Stage, string> = {
  body: PRESENCE_V2_PROFILE.body_worker_sha256,
  face: PRESENCE_V2_PROFILE.face_worker_sha256,
};
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes)).map(n => n.toString(16).padStart(2, '0')).join('');

/** Verify/cache each model independently so a broken face download cannot block body presence. */
export async function preparePresenceV2Assets(signal: AbortSignal, progress: (value: PresenceV2AssetProgress) => void) {
  const started=performance.now();
  if (!window.isSecureContext || !window.Worker || !window.createImageBitmap || !('caches' in window)) throw Error('This player cannot run local camera measurement.');
  const manifestResponse = await fetch(PRESENCE_V2_PROFILE.manifest_url, { signal, cache: 'no-store' });
  if (!manifestResponse.ok) throw Error('The pinned body/face model manifest is unavailable.');
  const bytes = await manifestResponse.arrayBuffer();
  if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== PRESENCE_V2_PROFILE.manifest_sha256) throw Error('The body/face model manifest did not match its pinned profile.');
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Manifest;
  if (manifest.version !== 'gridcast-presence-v2-mediapipe-1.0.1-independent' || manifest.assets.length !== 7) throw Error('The body/face model manifest is unsupported.');
  const cache = await caches.open(CACHE), ready = new Set<string>(), errors: Partial<Record<Stage | 'common', string>> = {};
  const total=manifest.assets.reduce((sum,asset)=>sum+asset.bytes,0);let downloaded=0,verified=0;
  const report=(message:string,phase:PresenceV2AssetProgress['phase'])=>progress({message,phase,downloaded,verified,total,elapsedSeconds:Math.max(0,Math.floor((performance.now()-started)/1000)),etaSeconds:null});
  for (const asset of manifest.assets) {
    const stage: Stage | 'common' = asset.name === 'person.tflite' ? 'body' : asset.name === 'face.task' ? 'face' : 'common';
    try {
      signal.throwIfAborted(); report(`Checking ${stage === 'common' ? 'shared runtime' : stage + ' model'} · ${asset.name}`,'checking');
      let saved = await cache.match(asset.url), data = saved ? await saved.arrayBuffer() : null;
      if (!data || data.byteLength !== asset.bytes || hex(await crypto.subtle.digest('SHA-256', data)) !== asset.sha256) {
        await cache.delete(asset.url);
        report(`Downloading ${asset.name}`,'downloading');
        const response = await fetch(asset.url, { signal, mode: 'cors', credentials: 'omit' });
        if (!response.ok || response.type === 'opaque') throw Error(`Could not download ${asset.name}`);
        data = await response.arrayBuffer();
        downloaded+=data.byteLength;
        report(`Verifying ${asset.name}`,'verifying');
        if (data.byteLength !== asset.bytes || hex(await crypto.subtle.digest('SHA-256', data)) !== asset.sha256) throw Error(`Integrity check failed for ${asset.name}`);
        await cache.put(asset.url, new Response(data, { headers: { 'Content-Type': asset.name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } }));
      }
      ready.add(asset.name);
      verified+=asset.bytes;report(`Verified ${asset.name}`,'verifying');
    } catch (error: any) {
      if (error?.name === 'AbortError') throw error;
      errors[stage] = String(error?.message || error);
    }
  }
  return { manifest, cache, ready, errors, downloaded, verified, total, elapsedSeconds:Math.max(0,Math.floor((performance.now()-started)/1000)) };
}

export async function createPresenceV2Runtime(
  assets: Awaited<ReturnType<typeof preparePresenceV2Assets>>,
  signal: AbortSignal,
  observe: (observation: Observation, context?: any) => void,
  onState: (state: PresenceV2State) => void,
) {
  const state: PresenceV2State = {
    body: { state: 'starting', model: PRESENCE_V2_PROFILE.body_model },
    face: { state: 'starting', model: PRESENCE_V2_PROFILE.face_model },
  };
  let closed = false, lastEmitted = -Infinity;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  const workers: Partial<Record<Stage, Worker>> = {}, urls: string[] = [], busy: Record<Stage, boolean> = { body: false, face: false };
  const sentAt: Record<Stage, number> = { body: 0, face: 0 }, lastFrame: Record<Stage, number> = { body: -Infinity, face: -Infinity };
  const lastTime: Record<Stage, number> = { body: -1, face: -1 }, resultTimes:Record<Stage,number[]>={body:[],face:[]};
  const report = () => { if (!closed) onState({ body: { ...state.body }, face: { ...state.face } }); };
  function close() { if (closed) return; closed = true; Object.values(workers).forEach(worker => worker?.terminate()); if (watchdog) clearInterval(watchdog); urls.forEach(URL.revokeObjectURL); signal.removeEventListener('abort', close); }
  signal.addEventListener('abort', close, { once: true });
  async function start(stage: Stage) {
    const modelName = stage === 'body' ? 'person.tflite' : 'face.task';
    if (assets.errors.common || assets.errors[stage] || !assets.ready.has(modelName)) throw Error(assets.errors[stage] || assets.errors.common || `${modelName} was not verified`);
    const workerResponse = await fetch(stage === 'body' ? PRESENCE_V2_PROFILE.body_worker_url : PRESENCE_V2_PROFILE.face_worker_url, { signal, cache: 'no-store' });
    if (!workerResponse.ok) throw Error(`The pinned ${stage} worker is unavailable`);
    const source = await workerResponse.arrayBuffer();
    if (hex(await crypto.subtle.digest('SHA-256', source)) !== WORKER_HASH[stage]) throw Error(`The pinned ${stage} worker did not match the V2 pipeline.`);
    const workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })); urls.push(workerUrl);
    const cache = await caches.open(CACHE), assetUrls: Record<string, string> = {};
    for (const entry of assets.manifest.assets) {
      if (!assets.ready.has(entry.name)) continue;
      const saved = await cache.match(entry.url); if (!saved) throw Error(`The verified ${entry.name} is no longer cached.`);
      const body = await saved.arrayBuffer();
      if (body.byteLength !== entry.bytes || hex(await crypto.subtle.digest('SHA-256', body)) !== entry.sha256) throw Error(`The cached ${entry.name} failed integrity verification.`);
      const mime = entry.name.endsWith('.mjs') ? 'text/javascript' : entry.name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
      assetUrls[entry.name] = URL.createObjectURL(new Blob([body], { type: mime })); urls.push(assetUrls[entry.name]);
    }
    const worker = new Worker(workerUrl); workers[stage] = worker;
    await new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
      const abort = () => { done(); worker.terminate(); reject(new DOMException('Stopped', 'AbortError')); };
      const timer = setTimeout(() => { done(); worker.terminate(); reject(Error(`${stage} model initialization timed out`)); }, 60000);
      worker.onmessage = ({ data }) => {
        if (data.type === 'READY' && data.stage === stage) { done(); state[stage] = { state: 'ready', model: state[stage].model }; report(); resolve(); }
        else if (data.type === 'ERROR' && data.stage === stage) { done(); reject(Error(data.error || `${stage} model initialization failed`)); }
      };
      worker.onerror = event => { done(); reject(Error(event.message || `${stage} worker failed`)); };
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      worker.postMessage({ type: 'INIT', asset_urls: assetUrls });
    });
    worker.onmessage = ({ data }) => {
      if (closed || data.type !== 'OBSERVATION' || data.stage !== stage || !Number.isFinite(data.at)) return;
      busy[stage] = false; state[stage] = { state: data.result?.ok ? 'ready' : 'error', model: state[stage].model,
        ...(data.error ? { message: String(data.error).slice(0, 160) } : {}), last_at: performance.now() };
      const availableAt = performance.now(), maxAge = stage === 'body' ? 750 : 500;
      if (availableAt - data.at > maxAge) {
        state[stage] = { state: 'error', model: state[stage].model, message: 'Stale frame discarded', last_at: availableAt };
        report(); return;
      }
      const times=resultTimes[stage];times.push(availableAt);while(times.length>2&&availableAt-times[0]>5000)times.shift();
      const observedFps=times.length>1?(times.length-1)*1000/(times.at(-1)!-times[0]):0;
      state[stage]={...state[stage],observed_fps:Math.round(observedFps*10)/10,result_ms:Math.round((availableAt-data.at)*10)/10};
      const observation: Observation = { at: availableAt };
      if (stage === 'body') observation.bodies = data.result;
      else { observation.faces = { ok: data.result?.ok === true, faces: data.result?.faces || [], saturated: data.result?.saturated === true }; observation.calibration = data.result?.calibration || null; }
      // V2 metrics use result-available order across independent workers. Preserve the
      // original capture time and play token separately; never merge stages synthetically.
      if (availableAt > lastEmitted) { observe(observation, { ...(data.context || {}), stage, captured_at: data.at, available_at: availableAt }); lastEmitted = availableAt; }
      report();
    };
    worker.onerror = event => failStage(stage, event.message || `${stage} worker failed`);
  }
  function failStage(stage: Stage, message: string) {
    if (closed) return;
    workers[stage]?.terminate(); delete workers[stage]; busy[stage] = false;
    state[stage] = { state: 'error', model: state[stage].model, message: String(message).slice(0, 160) };
    report();
  }
  onState(state);
  const starts = await Promise.allSettled([start('body'), start('face')]);
  starts.forEach((result, index) => { if (result.status === 'rejected') failStage(index === 0 ? 'body' : 'face', String(result.reason?.message || result.reason)); });
  if(closed||signal.aborted)throw new DOMException('Stopped','AbortError');
  const send = async (stage: Stage, video: HTMLVideoElement, calibration: { yaw: number; pitch: number }, context: any, confidence: number) => {
    const worker = workers[stage], now = performance.now(), interval = stage === 'body' ? PRESENCE_V2_PROFILE.body_interval_ms : PRESENCE_V2_PROFILE.face_interval_ms;
    if (!worker || closed || signal.aborted || busy[stage] || now - lastFrame[stage] < interval || video.readyState < 2 || video.paused || video.ended || video.currentTime === lastTime[stage]) return;
    if (video.srcObject instanceof MediaStream && !video.srcObject.getVideoTracks().some(t => t.readyState === 'live' && !t.muted && t.enabled)) return;
    lastFrame[stage] = now; lastTime[stage] = video.currentTime; busy[stage] = true; sentAt[stage] = now;
    try {
      const size = stage === 'body' ? PRESENCE_V2_PROFILE.body_input_px : PRESENCE_V2_PROFILE.face_input_px;
      const frame = await createImageBitmap(video, { resizeWidth: size, resizeHeight: Math.max(1, Math.round(size * video.videoHeight / video.videoWidth)), resizeQuality: 'low' });
      if (closed || signal.aborted || workers[stage] !== worker) { frame.close(); busy[stage] = false; return; }
      worker.postMessage({ type: 'FRAME', frame, at: now, confidence: Math.max(.01, Math.min(1, confidence)), calibration, context }, [frame]);
    } catch (error: any) { busy[stage] = false; failStage(stage, error.message || 'Camera frame could not be read'); }
  };
  if(!closed&&!signal.aborted)watchdog = setInterval(() => { const now = performance.now(); for (const stage of ['body', 'face'] as const) if (busy[stage] && now - sentAt[stage] > 10000) failStage(stage, `${stage} inference stalled`); }, 1000);
  return {
    close,
    get busy() { return busy.body || busy.face; },
    get bodyBusy() { return busy.body; },
    get faceBusy() { return busy.face; },
    frame(video: HTMLVideoElement, calibration: { yaw: number; pitch: number }, context?: any, confidence = PRESENCE_V2_PROFILE.confidence_default) { void send('body', video, calibration, context, confidence); void send('face', video, calibration, context, confidence); },
  };
}
