'use client';
import React, { useEffect, useRef, useState } from 'react';
import { flushPlays, enqueuePlay, queueStatus, queueCapacity, queuedPlays } from '@/lib/player-queue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BrandLogo } from '@/components/ui/brand-mark';
import { pendingDiagnostic, saveDiagnostic, flushDiagnostic } from '@/lib/player-diagnostics';
import { cacheMedia, cachedMediaUrl, saveReadySchedule, readySchedule, reserveLocalPlay, clearReadySchedule } from '@/lib/player-media-cache';
import { cameraConstraints, cameraError, frameSize } from '@/lib/player-vision';

declare global { interface Window { YT: any; onYouTubeIframeAPIReady: () => void; cocoSsd: any; tf: any } }
const APP_VERSION = 'gridcast-web/0.4.0';
const MODEL_VERSION = 'coco-ssd@2.2.3/lite_mobilenet_v2';
type Credential = { token: string; device_id: string; screen_id: string };
type Item = { kind?: 'diagnostic' | 'paid' | 'filler'; diagnostic_has_camera?: boolean; assignment_id: string; valid_until: string; campaign_id: string | null; creative_id: string;
  max_plays?: number; media_type?: 'video' | 'image'; youtube_id?: string; asset_url?: string; asset_id?: string; asset_sha256?: string; asset_bytes?: number; asset_mime?: string; width?: number; height?: number; duration_s: number };
type Playlist = { screen: any; config: Record<string, any>; config_version: string | number; server_time: string; items: Item[]; filler_items?: Item[]; scheduling_mode?: string; budget_state?: string; readiness?: {message:string}; diagnostic?: {assignment_id:string;status:string;message:string} | null };
type Slot = { item: Item; uid: string; started: number; startedPlaying: boolean; accumulated: number; segmentStart: number | null;
  mediaStart: number; samples: number[]; cameraHealthy: boolean; config: Record<string, any>; version: string | number; offset: number; done: boolean; diagnosticRun?: string; decodedWidth?: number; decodedHeight?: number };
function script(src: string, ready: () => boolean) {
  return new Promise<void>((resolve, reject) => {
    if (ready()) { resolve(); return; }
    if (!document.querySelector(`script[src="${src}"]`)) { const el = document.createElement('script'); el.src = src; el.onerror = () => reject(new Error('Player library could not load')); document.head.appendChild(el); }
    const began = Date.now(), timer = setInterval(() => {
      if (ready()) { clearInterval(timer); resolve(); }
      else if (Date.now() - began > 20000) { clearInterval(timer); reject(new Error('Player library timed out')); }
    }, 100);
  });
}
async function request(path: string, token?: string, body?: any) {
  const res = await fetch('/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? { cache: 'no-store' as const } : { body: JSON.stringify(body) }) });
  const value = await res.json().catch(() => ({}));
  return { status: res.status, value };
}

export default function Player() {
  const [credential, setCredential] = useState<Credential | null>(null), [code, setCode] = useState(''), [err, setErr] = useState('');
  const [screen, setScreen] = useState<any>(null), [current, setCurrent] = useState<Item | null>(null), [status, setStatus] = useState('Starting');
  const [count, setCount] = useState<number | null>(null), [average, setAverage] = useState<string>('—'), [recorded, setRecorded] = useState(0);
  const [queue, setQueue] = useState({ pending: 0, blocked: 0, total: 0 });
  const [visionStatus, setVisionStatus] = useState('Waiting for screen settings'), [visionRetry, setVisionRetry] = useState(false);
  const [diagnosticStatus, setDiagnosticStatus] = useState('');
  const [surface, setSurface] = useState(0), [imageSource, setImageSource] = useState(''), [offlineStatus, setOfflineStatus] = useState('');
  const retryCamera = useRef<() => void>(() => {});
  const camera = useRef<HTMLVideoElement>(null), canvas = useRef<HTMLCanvasElement>(null), media = useRef<HTMLVideoElement>(null), standbyMedia = useRef<HTMLVideoElement>(null), imageSurface = useRef<HTMLImageElement>(null), youtubeMount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try { const c = JSON.parse(localStorage.getItem('gc_device') || 'null'); if (c?.token && c?.device_id && c?.screen_id) setCredential(c); }
    catch { setErr('Saved pairing could not be read. Pair this player again.'); }
  }, []);

  useEffect(() => {
    if (!credential) return;
    const paired = credential;
    let disposed = false, currentSlot: Slot | null = null, playlist: Playlist | null = null, pending: Playlist | null = null;
    let cycleItems: Item[] = [], cycleIndex = 0, fillerIndex = 0, waitingEmpty = false;
    let activeMedia = media.current, activeSurface = 0, prepared: { id: string; video: HTMLVideoElement; url: string } | null = null;
    const urlByAsset = new Map<string, string>(), objectUrls = new Set<string>(), exhausted = new Set<string>(), failedUntil = new Map<string, number>();
    let preparing = false, retiring = false, needsAllowanceRefresh = false;
    const preparedImages = new Map<string, Promise<{ image: HTMLImageElement; url: string }>>();
    const prepareImage = (item: Item) => {
      if (!preparedImages.has(item.assignment_id)) preparedImages.set(item.assignment_id, (async () => { const url = await mediaUrl(item), image = new Image(); image.src = url; await image.decode(); return { image, url }; })().catch(error => { preparedImages.delete(item.assignment_id); throw error; }));
      return preparedImages.get(item.assignment_id)!;
    };
    let yt: any = null, ytReady = false, detector: any = null, stream: MediaStream | null = null, cameraOK = false;
    let startup = false, pulling = false, flushing = false, heartbeatBusy = false, fatal = false, actualOffset = 0;
    let diagnosticFlushing = false, lastSampleAt: string | null = null;
    const attemptedDiagnostics = new Set<string>();
    let lastPull = 0, lastHeartbeat = 0, lastDetect = 0, detecting = false;
    let cameraStarting = false, cameraKey = '', lastCameraFrame = -1, detectorBroken = false;
    const inferenceFrame = document.createElement('canvas');
    const cameraSurface = camera.current, overlay = canvas.current;
    setVisionStatus('Waiting for screen settings'); setVisionRetry(false); setCount(null);
    const booted = performance.now(), timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (f: () => void, delay: number) => { const t = setTimeout(() => { timers.delete(t); if (!disposed) f(); }, delay); timers.add(t); };
    const state = (value: string) => { if (!disposed) setStatus(value); };
    const authRequest = async (path: string, body?: any) => {
      const reply = await request(path, paired.token, body);
      if (reply.status === 401 && !disposed) {
        fatal = true; void clearReadySchedule(paired.device_id); stopMedia(); state('Pairing revoked or expired. Pair this player again.');
        setErr('This device needs a fresh pairing code. Buffered records remain on this browser.');
      }
      if (reply.status >= 400) throw new Error(reply.value.error || `Request failed (${reply.status})`);
      return reply.value;
    };
    function mediaTime() { try { if (currentSlot?.item.media_type === 'image') return 0; return currentSlot?.item.asset_url ? activeMedia?.currentTime || 0 : Number(yt?.getCurrentTime?.()) || 0; } catch { return 0; } }
    function segment(playing: boolean) {
      const s = currentSlot; if (!s || s.done) return;
      if (playing && s.segmentStart === null) {
        if (!s.startedPlaying) { s.started = Date.now(); s.mediaStart = mediaTime(); s.startedPlaying = true; }
        s.segmentStart = performance.now(); state(s.diagnosticRun ? 'Running screen diagnostic · no commercial delivery' : 'Playing');
        if (!s.diagnosticRun) void authRequest('/nowplaying', { assignment_id: s.item.assignment_id }).catch(() => {});
      } else if (!playing && s.segmentStart !== null) {
        s.accumulated += performance.now() - s.segmentStart; s.segmentStart = null; clearDetection();
        if (!disposed && cameraHealthyNow() && detector && !detectorBroken && !cameraStarting) setVisionStatus('Ready · counts resume with playback');
      }
    }
    function cameraHealthyNow() {
      const v = cameraSurface, tracks = stream?.getVideoTracks() || [];
      return !!v && v.readyState >= 2 && !v.paused && !v.ended && v.videoWidth > 0 && v.videoHeight > 0
        && tracks.length > 0 && tracks.every(t => t.readyState === 'live' && t.enabled && !t.muted);
    }
    function clearDetection() {
      if (!disposed) setCount(null);
      const c = overlay; c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    }
    function cameraLost() {
      if (disposed || !stream) return;
      cameraOK = false; if (currentSlot) currentSlot.cameraHealthy = false; clearDetection();
      if (!disposed && !cameraStarting) { setVisionStatus('Camera interrupted. Check the camera, then retry.'); setVisionRetry(true); }
    }
    function cameraRecovered() {
      cameraOK = cameraHealthyNow();
      if (!disposed && cameraOK && detector && !detectorBroken && !cameraStarting) {
        setVisionStatus('Ready · counts update during playback'); setVisionRetry(false);
      }
    }
    function stopMedia() { try { activeMedia?.pause(); yt?.stopVideo?.(); } catch {} }
    function vision() { return { camera_state: !playlist?.screen.has_camera ? 'disabled' : cameraStarting ? 'starting' : cameraHealthyNow() ? 'ready' : 'unavailable', model_state: detectorBroken ? 'error' : detector ? 'ready' : cameraStarting ? 'loading' : 'not_loaded', model_ver: detector && !detectorBroken ? MODEL_VERSION : null, last_sample_at: lastSampleAt }; }
    async function flushTest() {
      if (diagnosticFlushing || disposed || fatal) return;
      diagnosticFlushing = true;
      try { const message = await flushDiagnostic(paired.device_id, event => request('/diagnostic/result', paired.token, event)); if (message && !disposed) setDiagnosticStatus(message); }
      catch { if (!disposed) setDiagnosticStatus('Diagnostic report storage is unavailable.'); }
      finally { diagnosticFlushing = false; }
    }
    async function flush() {
      if (flushing || fatal || disposed) return;
      flushing = true;
      try {
        await flushPlays(paired.device_id, async event => {
          const r = await request('/play', paired.token, event);
          if (r.status === 401) { fatal = true; void clearReadySchedule(paired.device_id); state('Device authorization expired. Pair again.'); stopMedia(); }
          return { status: r.status >= 200 && r.status < 300 && r.value.ok !== true ? 502 : r.status, error: r.value.error || (r.value.ok !== true ? 'Server did not acknowledge delivery' : undefined) };
        }, Number(playlist?.config.telemetry_batch) || 25, Number(playlist?.config.telemetry_retry_h) || 72);
        if (!disposed) setQueue(await queueStatus(paired.device_id));
      } catch { state('Delivery queue is unavailable. Playback stopped.'); fatal = true; stopMedia(); }
      finally { flushing = false; }
    }
    async function finish(reason: 'ended' | 'duration_observed' | 'error' | 'timeout' | 'interrupted') {
      const s = currentSlot; if (!s || s.done) return;
      segment(false); const mediaEnd = mediaTime(); s.done = true; currentSlot = null; retiring = true; stopMedia(); clearDetection();
      if (reason === 'error' || reason === 'timeout') failedUntil.set(s.item.assignment_id, Date.now() + 30000);
      const measured = s.cameraHealthy && cameraHealthyNow() && s.samples.length > 0;
      const avg = measured ? s.samples.reduce((a, b) => a + b, 0) / s.samples.length : null;
      const event = { play_uid: s.uid, assignment_id: s.item.assignment_id, campaign_id: s.item.campaign_id, creative_id: s.item.creative_id,
        config_version: s.version, started_at_device: new Date(s.started).toISOString(), ended_at_device: new Date().toISOString(),
        kind: s.item.kind === 'filler' ? 'filler' : 'paid',
        media_evidence: s.item.media_type === 'image' ? 'image_decode' : 'media_timeline',
        ...(s.item.media_type === 'image' ? { decoded_width: s.decodedWidth || 0, decoded_height: s.decodedHeight || 0, visible_duration_ms: Math.round(s.accumulated) } : {}),
        playing_duration_ms: Math.round(s.accumulated), media_started_s: s.mediaStart, media_ended_s: mediaEnd, ended_reason: reason,
        server_clock_offset_ms: s.offset, measured, avg_persons: avg, sample_count: measured ? s.samples.length : 0, model_ver: measured ? MODEL_VERSION : null };
      if (s.diagnosticRun) {
        try { saveDiagnostic(paired.device_id, { ...event, run_uid: s.diagnosticRun, camera_state: vision().camera_state, model_state: vision().model_state }); void flushTest(); }
        catch (e: any) { if (!disposed) setDiagnosticStatus(e.message || 'Could not save diagnostic result'); }
        retiring = false; if (!disposed && !fatal) void startNext();
        return;
      }
      try {
        await enqueuePlay(paired.device_id, event, Number(s.config.offline_buffer_plays) || 5000);
        if (!disposed) { setRecorded(v => v + 1); setAverage(avg === null ? '—' : avg.toFixed(1)); setQueue(await queueStatus(paired.device_id)); }
        void flush();
      } catch (e: any) { fatal = true; state(e.message || 'Could not preserve delivery record. Playback stopped.'); }
      retiring = false; if (!disposed && !fatal) void startNext();
    }
    async function pull() {
      if (pulling || fatal || disposed) return;
      pulling = true; lastPull = Date.now();
      try {
        const started = Date.now(), d: Playlist = await authRequest('/playlist/' + paired.screen_id + '?protocol=2');
        if (disposed || fatal) return;
        if (!d.config || !Array.isArray(d.items)) throw new Error('Player update required. Reload this page.');
        const received = Date.now(); actualOffset = Date.parse(d.server_time) - ((started + received) / 2);
        if (!Number.isFinite(actualOffset)) actualOffset = 0;
        pending = d; needsAllowanceRefresh = d.items.some(i => exhausted.has(i.assignment_id)); void initCamera();
        void saveReadySchedule(paired.device_id, d, actualOffset).then(ready => { if (!disposed) setOfflineStatus(ready ? d.items.some(i => i.youtube_id) ? 'Uploaded media ready offline · YouTube requires internet' : 'Schedule and uploaded media ready offline' : d.items.some(i => i.youtube_id) ? 'YouTube playback requires internet' : 'Preparing uploaded media for offline playback'); }).catch(() => { if (!disposed) setOfflineStatus('Offline media unavailable; online playback only'); });
        if (currentSlot?.diagnosticRun && d.diagnostic?.assignment_id === currentSlot.item.assignment_id && d.diagnostic.status === 'revoked') void finish('interrupted');
        lastPull = Date.now(); if (!disposed) setScreen(d.screen);
        if (d.diagnostic && !currentSlot) setDiagnosticStatus(d.diagnostic.message);
        if (!currentSlot) void startNext();
      } catch (e: any) { if (!playlist) waitingEmpty = true; if (!currentSlot) state(e.message || 'Waiting for connection'); }
      finally { pulling = false; }
    }
    async function ensureYouTube() {
      if (ytReady) return;
      await script('https://www.youtube.com/iframe_api', () => !!window.YT?.Player);
      if (disposed) return;
      await new Promise<void>((resolve, reject) => {
        const host = document.createElement('div'); youtubeMount.current?.replaceChildren(host);
        yt = new window.YT.Player(host, {
          width: '100%', height: '100%', playerVars: { autoplay: 1, controls: 0, rel: 0, disablekb: 1, fs: 0, playsinline: 1, mute: 1 },
          events: {
            onReady: (e: any) => { ytReady = true; e.target.mute(); resolve(); },
            onStateChange: (e: any) => {
              if (!currentSlot || currentSlot.item.asset_url || currentSlot.done) return;
              if (yt?.getVideoData?.().video_id !== currentSlot.item.youtube_id) return;
              if (e.data === 1) segment(true); else { segment(false); if (e.data === 0 && currentSlot.startedPlaying) void finish('ended'); }
            },
            onError: () => { if (currentSlot && !currentSlot.item.asset_url) void finish('error'); },
          },
        });
        later(() => { if (!ytReady) reject(new Error('Video player did not initialize')); }, 20000);
      });
    }
    async function startDiagnostic() {
      const offer = playlist?.diagnostic;
      if (cameraStarting) return false;
      if (!playlist || !offer || offer.status !== 'pending' || attemptedDiagnostics.has(offer.assignment_id)) return false;
      if (pendingDiagnostic(paired.device_id)) { setDiagnosticStatus('The previous diagnostic report is still saved. Deliver it or export it for review before clearing it.'); return false; }
      const uid = crypto.randomUUID();
      // Mark before requesting: an acknowledgement can be lost after the server consumes the run.
      attemptedDiagnostics.add(offer.assignment_id);
      const reply = await authRequest('/diagnostic/start', { assignment_id: offer.assignment_id, run_uid: uid });
      if (reply.waiting) { attemptedDiagnostics.delete(offer.assignment_id); setDiagnosticStatus(reply.message); return false; }
      if (reply.cancelled) { setDiagnosticStatus(reply.message); return false; }
      if (!reply.ok || !reply.assignment) return false;
      if (disposed || fatal) return false;
      const item: Item = reply.assignment;
      currentSlot = { item, uid, diagnosticRun: uid, started: Date.now(), startedPlaying: false, accumulated: 0, segmentStart: null,
        mediaStart: 0, samples: [], cameraHealthy: !!item.diagnostic_has_camera && cameraHealthyNow() && !!detector && reply.config.model === 'coco-ssd', config: reply.config, version: reply.config_version, offset: actualOffset, done: false };
      setCurrent(item); setDiagnosticStatus('Diagnostic sample · excluded from campaign presence and billing'); state('Loading diagnostic clip');
      activeMedia = media.current; activeSurface = 0; setSurface(0);
      if (!activeMedia) { void finish('error'); return true; }
      activeMedia.src = item.asset_url!; activeMedia.load();
      try { await activeMedia.play(); } catch { void finish('error'); }
      return true;
    }
    const eligible = (item: Item) => !exhausted.has(item.assignment_id) && (failedUntil.get(item.assignment_id) || 0) <= Date.now()
      && Date.parse(item.valid_until) >= Date.now() + actualOffset + item.duration_s * 1000;
    async function mediaUrl(item: Item) {
      const key = item.asset_id + ':' + item.asset_sha256;
      if (urlByAsset.has(key)) return urlByAsset.get(key)!;
      const url = await cachedMediaUrl(item).catch(() => null);
      if (url) { objectUrls.add(url); urlByAsset.set(key, url); return url; }
      return item.asset_url!;
    }
    async function prepareNext() {
      if (preparing || disposed || !playlist) return;
      const candidate = [...cycleItems.slice(cycleIndex), ...cycleItems.slice(0, cycleIndex)].find(eligible)
        || playlist.filler_items?.find(eligible);
      if (!candidate?.asset_url) return;
      if (candidate.media_type === 'image') { void cacheMedia(candidate).catch(() => false); void prepareImage(candidate).catch(() => {}); return; }
      if (prepared?.id === candidate.assignment_id) return;
      preparing = true;
      try {
        void cacheMedia(candidate).catch(() => false);
        const target = activeMedia === media.current ? standbyMedia.current : media.current;
        if (!target) return;
        const url = await mediaUrl(candidate);
        if (disposed || target === activeMedia) return;
        target.src = url; target.load(); prepared = { id: candidate.assignment_id, video: target, url };
      } finally { preparing = false; }
    }
    async function startNext() {
      if (startup || retiring || currentSlot || fatal || disposed || document.hidden) return;
      startup = true;
      try {
        // Apply refreshed authorizations at a creative boundary, preserving round order.
        if (pending) {
          const nextId = cycleItems[cycleIndex % Math.max(1, cycleItems.length)]?.assignment_id;
          playlist = pending; pending = null; cycleItems = playlist.items;
          const at = cycleItems.findIndex(i => i.assignment_id === nextId); cycleIndex = at >= 0 ? at : 0;
          void initCamera();
        }
        if (!playlist) { state('Waiting for an authorised playlist'); return; }
        if (!(await queueCapacity(paired.device_id, Number(playlist.config.offline_buffer_plays) || 5000))) { state('Delivery queue full. Reconnect or export saved records for review.'); return; }
        let item: Item | undefined;
        // Entries repeated by the server represent explicit relative turns/weights.
        for (let attempt = 0; attempt < cycleItems.length; attempt++) {
          const candidate = cycleItems[cycleIndex++ % cycleItems.length]; cycleIndex %= cycleItems.length;
          if (eligible(candidate) && await reserveLocalPlay(paired.device_id, candidate, Date.now() + actualOffset)) { item = candidate; break; }
          if (eligible(candidate)) { exhausted.add(candidate.assignment_id); needsAllowanceRefresh = true; }
        }
        if (!item) for (let attempt = 0; attempt < (playlist.filler_items || []).length; attempt++) {
          const candidate = playlist.filler_items![fillerIndex++ % playlist.filler_items!.length];
          if (eligible(candidate) && await reserveLocalPlay(paired.device_id, candidate, Date.now() + actualOffset)) { item = candidate; break; }
          if (eligible(candidate)) exhausted.add(candidate.assignment_id);
        }
        waitingEmpty = !item;
        if (!item) { setCurrent(null); if (await startDiagnostic()) return; state(playlist.budget_state === 'reserved_elsewhere_or_exhausted' ? 'Waiting for paid playback allowance' : playlist.readiness?.message || 'No authorised playable content. Waiting for a refreshed schedule.'); return; }
        if (!item.asset_url) await ensureYouTube();
        if (disposed || fatal) return;
        currentSlot = { item, uid: crypto.randomUUID(), started: Date.now(), startedPlaying: false, accumulated: 0, segmentStart: null,
          mediaStart: 0, samples: [], cameraHealthy: cameraHealthyNow() && !!detector && playlist.config.model === 'coco-ssd', config: { ...playlist.config }, version: playlist.config_version, offset: actualOffset, done: false };
        state('Preparing media');
        if (item.asset_url && item.media_type === 'image') {
          const { url, image: decoded } = await prepareImage(item);
          if (!currentSlot || currentSlot.item !== item || disposed || document.hidden) { if (currentSlot) void finish('interrupted'); return; }
          if (!decoded.naturalWidth || !decoded.naturalHeight || item.width && item.width !== decoded.naturalWidth || item.height && item.height !== decoded.naturalHeight) throw new Error('Image dimensions do not match');
          currentSlot.decodedWidth = decoded.naturalWidth; currentSlot.decodedHeight = decoded.naturalHeight;
          setImageSource(url); setCurrent(item);
          // Start evidence only after React commits the decoded image to the visible surface.
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (currentSlot?.item === item && !document.hidden && imageSurface.current?.complete && imageSurface.current.naturalWidth > 0) segment(true);
          }));
        } else if (item.asset_url) {
          if (prepared?.id === item.assignment_id) { activeMedia = prepared.video; prepared = null; }
          else { activeMedia = activeMedia === media.current ? standbyMedia.current : media.current; if (!activeMedia) throw new Error('Video surface unavailable'); activeMedia.src = await mediaUrl(item); activeMedia.load(); }
          if (activeMedia.readyState >= 1 && (!Number.isFinite(activeMedia.duration) || Math.abs(activeMedia.duration - item.duration_s) > 1 || item.width && item.width !== activeMedia.videoWidth || item.height && item.height !== activeMedia.videoHeight)) throw new Error('Video metadata does not match');
          activeSurface = activeMedia === media.current ? 0 : 1; setSurface(activeSurface); setCurrent(item);
          try { await activeMedia.play(); } catch { void finish('error'); }
        } else { setCurrent(item); yt.loadVideoById({ videoId: item.youtube_id, startSeconds: 0 }); yt.playVideo(); }
        void prepareNext();
      } catch (e: any) { state(e.message || 'Playback could not start'); if (currentSlot) void finish('error'); }
      finally { startup = false; }
    }
    async function heartbeat() {
      if (!playlist || heartbeatBusy || fatal || disposed) return;
      heartbeatBusy = true;
      try {
        await authRequest('/heartbeat', { device_now: new Date().toISOString(), app_ver: APP_VERSION, agent_ver: detector ? MODEL_VERSION : 'camera-unavailable',
          config_version: playlist.config_version, uptime_s: Math.round((performance.now() - booted) / 1000), free_disk_bytes: null, vision: vision() });
        lastHeartbeat = Date.now();
      } catch {} finally { heartbeatBusy = false; }
    }
    function stopCamera() {
      stream?.getTracks().forEach(t => { t.removeEventListener('ended', cameraLost); t.removeEventListener('mute', cameraLost); t.removeEventListener('unmute', cameraRecovered); t.stop(); });
      stream = null; cameraOK = false; lastCameraFrame = -1;
      if (cameraSurface) cameraSurface.srcObject = null;
      clearDetection();
    }
    async function initCamera(force = false) {
      const settings = pending || playlist;
      if (disposed || fatal || cameraStarting || detecting || !settings) return;
      const k = settings.config;
      const key = JSON.stringify([settings.screen.has_camera, settings.config_version, k.camera_source, k.camera_device_id, k.inference_res]);
      if (!force && key === cameraKey) return;
      cameraKey = key; cameraStarting = true;
      if (currentSlot) currentSlot.cameraHealthy = false;
      stopCamera(); setVisionRetry(false);
      let stage: 'camera' | 'model' = 'camera';
      try {
        if (!settings.screen.has_camera) { setVisionStatus('Camera is disabled for this screen'); return; }
        if (k.camera_source === 'ip') { setVisionStatus('This web player needs a built-in or USB camera. Change the screen’s camera source.'); return; }
        if (!navigator.mediaDevices?.getUserMedia) { setVisionStatus('Camera access requires HTTPS and a browser with camera support.'); return; }
        setVisionStatus('Waiting for camera permission');
        const acquired = await navigator.mediaDevices.getUserMedia(cameraConstraints(k));
        if (disposed) { acquired.getTracks().forEach(t => t.stop()); return; }
        stream = acquired;
        for (const t of stream.getVideoTracks()) { t.addEventListener('ended', cameraLost); t.addEventListener('mute', cameraLost); t.addEventListener('unmute', cameraRecovered); }
        if (!cameraSurface) { stopCamera(); return; }
        cameraSurface.srcObject = stream; await cameraSurface.play();
        if (disposed) return;
        stage = 'model'; setVisionStatus('Loading people detector');
        if (detectorBroken) { detector?.dispose?.(); detector = null; detectorBroken = false; }
        if (!detector) {
          const tf = await import('@tensorflow/tfjs');
          await tf.ready();
          if (disposed) return;
          const coco = await import('@tensorflow-models/coco-ssd');
          if (disposed) return;
          // COCO-SSD load includes warm-up. Keep the same pinned, self-hosted model.
          const loaded = await coco.load({ base: 'lite_mobilenet_v2', modelUrl: '/models/coco-ssd/model.json' });
          if (disposed) { loaded.dispose(); return; }
          detector = loaded;
        }
        cameraRecovered(); setVisionStatus('Ready · counts update during playback');
      } catch (error) {
        stopCamera();
        if (!disposed) { setVisionStatus(cameraError(error, stage)); setVisionRetry(true); }
      } finally { cameraStarting = false; }
    }
    retryCamera.current = () => { void initCamera(true); };
    async function detect() {
      const v = cameraSurface, c = overlay, target = currentSlot;
      // Never sample an idle, paused or background player. Only one inference may run at once.
      if (disposed || fatal || document.hidden || detecting || detectorBroken || !detector || cameraStarting || !target || target.segmentStart === null || target.done) return;
      if (target.diagnosticRun && !target.item.diagnostic_has_camera) return;
      cameraOK = cameraHealthyNow();
      if (!v || !c || !cameraOK) { cameraLost(); return; }
      if (v.currentTime === lastCameraFrame) { cameraLost(); return; }
      const segmentAtCapture = target.segmentStart, activeStream = stream, activeDetector = detector;
      detecting = true;
      try {
        const k = target.config;
        const confidence = Math.max(0, Math.min(1, Number(k.confidence_min ?? .45)));
        const ceiling = Math.max(1, Math.min(500, Math.floor(Number(k.count_ceiling) || 50)));
        const sourceWidth = v.videoWidth, sourceHeight = v.videoHeight;
        const [width, height] = frameSize(sourceWidth, sourceHeight, k.inference_res);
        if (inferenceFrame.width !== width || inferenceFrame.height !== height) { inferenceFrame.width = width; inferenceFrame.height = height; }
        const frameContext = inferenceFrame.getContext('2d');
        if (!frameContext) throw new Error('Camera frame unavailable');
        frameContext.drawImage(v, 0, 0, width, height); lastCameraFrame = v.currentTime;
        const all = await activeDetector.detect(inferenceFrame, ceiling, confidence);
        if (disposed || fatal || document.hidden || stream !== activeStream || currentSlot !== target || target.done || target.segmentStart !== segmentAtCapture) return;
        if (!cameraHealthyNow()) { cameraLost(); return; }
        const zone = k.detection_zone || { x: 0, y: 0, w: 100, h: 100 };
        const persons = all.filter((p: any) => {
          const [x, y, w, h] = p.bbox, cx = (x + w / 2) / width * 100, cy = (y + h / 2) / height * 100;
          return p.class === 'person' && p.score >= confidence && h * sourceHeight / height >= Number(k.min_box_px ?? 24) && cx >= zone.x && cx <= zone.x + zone.w && cy >= zone.y && cy <= zone.y + zone.h;
        });
        const n = Math.min(persons.length, ceiling);
        setCount(n); setVisionRetry(false); setVisionStatus(`${n ? 'Counting' : 'No people detected'} · updates every ${Number(k.sample_interval_s) || 2}s`);
        target.samples.push(n); lastSampleAt = new Date().toISOString();
        if (c.width !== width || c.height !== height) { c.width = width; c.height = height; }
        const ctx = c.getContext('2d'); if (ctx) { ctx.clearRect(0, 0, width, height); ctx.strokeStyle = '#F59E0B'; ctx.lineWidth = 3; for (const p of persons) ctx.strokeRect(...p.bbox as [number, number, number, number]); }
      } catch {
        target.cameraHealthy = false; detectorBroken = true; clearDetection();
        if (!disposed) { setVisionStatus('People detection failed. Retry the camera and detector.'); setVisionRetry(true); }
      } finally {
        // Raw camera pixels are never retained after an inference, including failures.
        inferenceFrame.getContext('2d')?.clearRect(0, 0, inferenceFrame.width, inferenceFrame.height);
        detecting = false; if (disposed) activeDetector.dispose?.();
      }
    }
    const cameraVideo = camera.current;
    const cameraFailures = ['waiting', 'stalled', 'pause', 'emptied', 'error'] as const;
    const cameraRecoveries = ['loadeddata', 'playing'] as const;
    cameraFailures.forEach(event => cameraVideo?.addEventListener(event, cameraLost));
    cameraRecoveries.forEach(event => cameraVideo?.addEventListener(event, cameraRecovered));
    const natives = [media.current, standbyMedia.current];
    const nativePlaying = (e: Event) => { if (e.target === activeMedia && currentSlot?.item.asset_url && currentSlot.item.media_type !== 'image') segment(true); };
    const nativePause = (e: Event) => { if (e.target === activeMedia && currentSlot?.item.asset_url && currentSlot.item.media_type !== 'image') segment(false); };
    const nativeEnd = (e: Event) => { if (e.target === activeMedia && currentSlot?.item.asset_url && currentSlot.startedPlaying) void finish('ended'); };
    const nativeError = (e: Event) => { if (e.target === activeMedia && currentSlot?.item.asset_url && currentSlot.item.media_type !== 'image') void finish('error'); };
    const metadata = (e: Event) => {
      const native = e.target as HTMLVideoElement, item = currentSlot?.item; if (native !== activeMedia || !item?.asset_url || item.media_type === 'image') return;
      if (!Number.isFinite(native.duration) || Math.abs(native.duration - item.duration_s) > 1 || (item.width && item.width !== native.videoWidth) || (item.height && item.height !== native.videoHeight)) void finish('error');
    };
    for (const native of natives) {
      native?.addEventListener('playing', nativePlaying); native?.addEventListener('pause', nativePause); native?.addEventListener('waiting', nativePause);
      native?.addEventListener('ended', nativeEnd); native?.addEventListener('error', nativeError); native?.addEventListener('loadedmetadata', metadata);
    }
    const visibility = () => { if (document.hidden) { clearDetection(); void finish('interrupted'); } else void startNext(); };
    const online = () => { void flush(); void pull(); };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('online', online);
    const ticker = setInterval(() => {
      if (disposed || fatal) return;
      const s = currentSlot;
      if (s) {
        const played = s.accumulated + (s.segmentStart === null ? 0 : performance.now() - s.segmentStart), elapsed = Date.now() - s.started;
        if (s.segmentStart !== null && (s.item.media_type === 'image' ? played >= s.item.duration_s * 1000 : mediaTime() - s.mediaStart >= s.item.duration_s && played >= s.item.duration_s * 1000 - 500)) void finish('duration_observed');
        else if (Date.now() + actualOffset >= Date.parse(s.item.valid_until) || s.diagnosticRun && elapsed > 15000) void finish('timeout');
        else if (elapsed > Math.max(30000, s.item.duration_s * 3000 + 10000)) void finish('timeout');
      } else void startNext();
      void initCamera();
      if (Date.now() - lastPull > (needsAllowanceRefresh ? 5000 : waitingEmpty ? 10000 : Math.min(300, Math.max(30, (Number(playlist?.config.sync_interval_min) || 5) * 60)) * 1000)) { lastPull = Date.now(); void pull(); }
      if (Date.now() - lastHeartbeat > Math.max(10, Number(playlist?.config.heartbeat_s) || 30) * 1000) { lastHeartbeat = Date.now(); void heartbeat(); }
      if (Date.now() - lastDetect > Math.max(500, (Number(currentSlot?.config.sample_interval_s ?? playlist?.config.sample_interval_s) || 2) * 1000)) { lastDetect = Date.now(); void detect(); }
    }, 250);
    const flusher = setInterval(() => { void flush(); void flushTest(); }, 5000);
    void flushTest();
    void queueStatus(paired.device_id).then(s => { if (!disposed) setQueue(s); }).catch(() => { fatal = true; state('This browser cannot persist delivery records. Playback stopped.'); });
    void readySchedule(paired.device_id).then(saved => { if (!disposed && !playlist && !pending && saved) { actualOffset = saved.offset; pending = saved.playlist; setScreen(saved.playlist.screen); setOfflineStatus('Using verified offline media and saved authorisations'); void startNext(); } }).catch(() => {});
    void pull();
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/player-sw.js', { scope: '/player' }).then(reg => { const worker = reg.active || reg.installing || reg.waiting; worker?.postMessage({ type: 'PREPARE_PLAYER', urls: performance.getEntriesByType('resource').map(r => r.name).filter(u => u.startsWith(location.origin + '/_next/static/')) }); }).catch(() => {});
    return () => {
      disposed = true; if (currentSlot) void finish('interrupted'); clearInterval(ticker); clearInterval(flusher); timers.forEach(clearTimeout);
      for (const native of natives) { native?.removeEventListener('playing', nativePlaying); native?.removeEventListener('pause', nativePause); native?.removeEventListener('waiting', nativePause);
      native?.removeEventListener('ended', nativeEnd); native?.removeEventListener('error', nativeError); native?.removeEventListener('loadedmetadata', metadata); }
      objectUrls.forEach(url => URL.revokeObjectURL(url));
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('online', online);
      cameraFailures.forEach(event => cameraVideo?.removeEventListener(event, cameraLost));
      cameraRecoveries.forEach(event => cameraVideo?.removeEventListener(event, cameraRecovered));
      stopCamera(); retryCamera.current = () => {}; if (!detecting) detector?.dispose?.(); yt?.destroy?.();
    };
  }, [credential]);

  const exportQueue = async () => {
    try {
      const records = { commercial: await queuedPlays(), diagnostic: credential ? pendingDiagnostic(credential.device_id) : null };
      const url = URL.createObjectURL(new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'gridcast-pending-delivery.json'; a.click(); URL.revokeObjectURL(url);
    } catch { setErr('Saved records could not be read from this browser.'); }
  };
  const pair = async () => {
    setErr('');
    try {
      const r = await request('/pair', undefined, { code: code.trim().toUpperCase() });
      if (r.status >= 400) throw new Error(r.value.error || 'Pairing failed');
      if (!r.value.token || !r.value.device?.id || !r.value.screen?.id) throw new Error('Pairing response was incomplete');
      const c = { token: r.value.token, device_id: r.value.device.id, screen_id: r.value.screen.id };
      localStorage.setItem('gc_device', JSON.stringify(c)); localStorage.removeItem('gc_screen'); setScreen(r.value.screen); setCredential(c);
    } catch (e: any) { setErr(e.message || 'Pairing failed'); }
  };
  if (!credential) return <div className="grid min-h-screen place-items-center bg-slate-950 p-4"><div className="w-full max-w-[420px] rounded-xl bg-card p-8">
    <BrandLogo compact suffix=" Player" className="mb-5" />
    <h1 className="text-xl font-semibold">Pair this player</h1><p className="my-3 text-sm text-muted-foreground">Generate a one-time code from the screen’s dashboard. Codes expire after 10 minutes.</p>
    <Input value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && pair()} maxLength={8} placeholder="ABCDEFGH" autoComplete="off" className="h-14 text-center font-mono text-2xl uppercase tracking-widest" />
    <p className="my-2 text-sm text-destructive">{err}</p><Button className="w-full" onClick={pair}>Pair and play</Button>
    <p className="mt-4 text-xs text-muted-foreground">Camera starts after pairing to a camera-enabled screen. Counts appear while an ad plays. Camera processing and the setup preview stay on this device. Only presence counts and delivery records are sent. Playback reports are buffered during connection failures; YouTube videos still require internet.</p>
  </div></div>;
  return <div className="fixed inset-0 bg-black text-white">
    <div ref={youtubeMount} className={`absolute inset-0 h-full w-full ${!current || current.asset_url ? 'hidden' : ''}`} />
    <video data-role="creative" data-active={surface === 0} ref={media} muted playsInline preload="auto" className={`absolute inset-0 h-full w-full object-contain ${current?.asset_url && current.media_type !== 'image' && surface === 0 ? '' : 'hidden'}`} />
    <video data-role="creative" data-active={surface === 1} ref={standbyMedia} muted playsInline preload="auto" className={`absolute inset-0 h-full w-full object-contain ${current?.asset_url && current.media_type !== 'image' && surface === 1 ? '' : 'hidden'}`} />
    <img ref={imageSurface} src={imageSource || undefined} alt="" className={`absolute inset-0 h-full w-full object-contain ${current?.media_type === 'image' ? '' : 'hidden'}`} />
    <div className="pointer-events-none absolute inset-0 z-[2]" />
    <div className="fixed left-3 top-3 z-10 rounded bg-black/80 p-3 text-xs"><b>{screen?.name || 'Gridcast'}</b> · {current ? current.kind === 'diagnostic' ? 'Screen test' : 'Media playback' : 'Waiting'}<br />{status}{offlineStatus && <p className="mt-1">{offlineStatus}</p>}
      {err && <p className="mt-1 text-amber-300">{err}</p>}
      <button className="mt-2 underline" onClick={() => { localStorage.removeItem('gc_device'); setCredential(null); }}>Enter a new pairing code</button>
    </div>
    <div className="fixed bottom-3 right-3 z-10 w-[170px]"><div className="relative"><video data-role="camera" ref={camera} autoPlay muted playsInline className="w-full rounded bg-neutral-900" /><canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" /></div><p className="mt-1 text-[10px] text-white/60">Local camera preview · never uploaded</p><p className="mt-1 text-xs" role="status">{visionStatus}</p>{visionRetry && <button className="mt-2 text-xs underline" onClick={() => retryCamera.current()}>Retry camera</button>}</div>
    <div className="fixed bottom-3 left-3 z-10 rounded bg-black/80 p-3 text-xs">{current?.kind === 'diagnostic' ? 'Diagnostic sample' : 'People now'}: {count ?? '—'} · Last play average: {average}<br />Recorded this session: {recorded} · Pending delivery: {queue.pending}
      {diagnosticStatus && <p className="mt-1 text-amber-200">{diagnosticStatus}</p>}
      {diagnosticStatus && <button className="mt-2 block underline" onClick={() => { localStorage.removeItem('gc_diagnostic_result:' + credential.device_id); setDiagnosticStatus('Saved diagnostic report cleared on this device.'); }}>Clear saved diagnostic report</button>}
      {queue.blocked > 0 && <p className="mt-1 text-amber-300">{queue.blocked} delivery records need review and remain saved on this device.</p>}
      <button className="mt-2 block underline" onClick={exportQueue}>Export saved delivery records</button>
    </div>
  </div>;
}
