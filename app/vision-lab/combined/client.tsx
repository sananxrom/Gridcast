'use client';

import { useEffect, useRef, useState } from 'react';
import { BrandLogo } from '@/components/ui/brand-mark';
import { EvaluationMetrics, type EvaluationSnapshot } from '@/lib/vision/metrics';
import { acquireEvaluationLock, assertIsolated, createEvaluationWorker, EVALUATION_PROFILE, prepareEvaluation, type EngineStatus } from '@/lib/vision/engine';
import { cameraConstraints, frameSize } from '@/lib/player-vision';
import { LEGACY_CV_PROFILE, loadLegacyDetector, sampleLegacyFrame, type LegacyDetector, type LegacySettings } from '@/lib/vision/legacy-sampler';
import { acceptsA2CaptureResult, boundedPush, ensureA2IsolationScope, LegacyPriorityScheduler, playbackStallTotal, summarize } from '@/lib/vision/a2-scheduler';
import { GazeCalibration } from '@/lib/vision/calibration';

type TrialMode = 'legacy_only' | 'legacy_plus_attention';
type Phase = 'idle' | 'preparing' | 'ready' | 'calibrating' | 'running';
type VisionEngine = Awaited<ReturnType<typeof createEvaluationWorker>>;
type TestContext = { computer_model: string; camera_height_cm: number | null; camera_offset_cm: number | null; person_distance_m: number | null; lighting: 'not_recorded' | 'dim' | 'normal' | 'bright'; available_people: 'unknown' | 'one' | 'two' };
type TrialResult = {
  mode: TrialMode; profile: string; started_at: string; elapsed_ms: number; settings: LegacySettings;
  source: { kind: 'test_card' | 'local_video'; duration_s: number | null; width: number | null; height: number | null; same_source_verified: boolean };
  camera: { label: string; width: number; height: number; frame_rate: number | null; same_camera_verified: boolean };
  calibration: { method: 'guided-3s' | 'not-calibrated' | 'not_used'; yaw: number | null; pitch: number | null };
  test_context: TestContext;
  legacy: { model: string; successful_samples: number; errors: number; skipped_no_fresh_frame: number; skipped_busy: number; skipped_paused: number; mean_person_count: number | null; last_person_count: number | null; sample_interval_ms: { count: number; median: number | null; p95: number | null }; inference_latency_ms: { count: number; median: number | null; p95: number | null }; intervals_retained: number };
  attention: { profile: string | null; delegate: 'CPU' | null; state: 'not_in_trial' | 'observed' | 'no_observed_attention'; metrics: EvaluationSnapshot | null; inference_latency_ms: { count: number; median: number | null; p95: number | null }; face_fps: number | null; person_fps: number | null; dropped_frames: number | null; stale_observations: null | number; stale_observation_unavailable_reason: string | null };
  playback: { source: 'local_video' | 'test_card'; stalls: number | null; stall_ms: number | null; dropped_video_frames: number | null; total_video_frames: number | null; unavailable_reason: string | null };
  memory: { measurement: 'javascript_heap_only' | 'unavailable'; samples: number; first_used_bytes: number | null; last_used_bytes: number | null; trend_bytes: number | null; unavailable_reason: string | null };
  warnings: string[];
};

const medianLabel = (value: number | null | undefined, digits = 0) => value == null ? 'Unavailable' : `${value.toFixed(digits)}`;
const metric = (snapshot: EvaluationSnapshot | null, key: 'body_status' | 'face_status') => snapshot?.live?.[key] || 'unknown';
const allowedSettings: LegacySettings = { ...LEGACY_CV_PROFILE.defaults, detection_zone: { ...LEGACY_CV_PROFILE.defaults.detection_zone } };
const currentHeap = () => {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return memory && Number.isFinite(memory.usedJSHeapSize) ? memory.usedJSHeapSize! : null;
};

export default function CombinedAttentionEvaluation() {
  const camera = useRef<HTMLVideoElement>(null), creative = useRef<HTMLVideoElement>(null), capture = useRef<HTMLCanvasElement>(null);
  const metrics = useRef(new EvaluationMetrics()), activeTrial = useRef<TrialMode | null>(null), phaseRef = useRef<Phase>('idle');
  const calibrationSampler = useRef<GazeCalibration | null>(null), calibrationValue = useRef({ yaw: 0, pitch: 0 }), calibrationMethod = useRef<'guided-3s'|'not-calibrated'>('not-calibrated');
  const abortRef = useRef<AbortController | null>(null), engineRef = useRef<VisionEngine | null>(null), detectorRef = useRef<LegacyDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null), releaseLockRef = useRef<(() => void) | null>(null), cleanupRef = useRef<() => void>(() => {}), stopRef = useRef<(message?: string) => void>(() => {});
  const schedulerRef = useRef<LegacyPriorityScheduler | null>(null), rafRef = useRef(0), legacyTickerRef = useRef<ReturnType<typeof setInterval> | null>(null), uiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null), isolationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alive = useRef(true), generation = useRef(0), legacyInFlight = useRef(false), legacyBroken = useRef(false), playingRef = useRef(false), previousCameraTime = useRef(-1);
  const startedPerf = useRef(0), startedIso = useRef(''), lastLegacyAttempt = useRef<number | null>(null), lastUiTick = useRef(0), lastMemoryAt = useRef(0), playStart = useRef<number | null>(null);
  const legacyCounts = useRef<number[]>([]), legacyIntervals = useRef<number[]>([]), legacyLatencies = useRef<number[]>([]), attentionLatencies = useRef<number[]>([]), memorySamples = useRef<number[]>([]);
  const legacyErrors = useRef(0), skippedFresh = useRef(0), skippedBusy = useRef(0), skippedPaused = useRef(0), warnings = useRef<string[]>([]);
  const cameraInfo = useRef<{ deviceId: string; label: string; width: number; height: number; frameRate: number | null } | null>(null);
  const frozenSettings = useRef<LegacySettings | null>(null), frozenSource = useRef<string | null>(null), frozenCamera = useRef<string | null>(null), frozenContext = useRef<TestContext | null>(null), frozenVideoFile = useRef<File | null | undefined>(undefined);
  const pendingMedia = useRef<File | null>(null), mediaUrl = useRef<string | null>(null), activeWorkerStats = useRef<EngineStatus | null>(null), playbackStats = useRef({ stalls: 0, stallStarted: null as number | null, stallMs: 0, droppedStart: null as number | null, totalStart: null as number | null, droppedEnd: null as number | null, totalEnd: null as number | null });
  const [phase, setPhase] = useState<Phase>('idle'), [mode, setMode] = useState<TrialMode | null>(null), [status, setStatus] = useState('Choose a local source, then explicitly start a legacy-only or combined trial.'), [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0), [playing, setPlaying] = useState(false), [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]), [cameraId, setCameraId] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null), [sourceRatio, setSourceRatio] = useState(16 / 9), [snapshot, setSnapshot] = useState<EvaluationSnapshot | null>(null), [workerStats, setWorkerStats] = useState<EngineStatus | null>(null);
  const [currentLegacy, setCurrentLegacy] = useState<number | null>(null), [sampleCount, setSampleCount] = useState(0), [errorCount, setErrorCount] = useState(0), [combinedStats, setCombinedStats] = useState<{ baseline: TrialResult | null; combined: TrialResult | null }>({ baseline: null, combined: null });
  const [settings, setSettings] = useState<LegacySettings>(allowedSettings), [memoryAvailable, setMemoryAvailable] = useState(false);
  const [calibrationLabel, setCalibrationLabel] = useState('Not calibrated');
  const [calibrationSeconds, setCalibrationSeconds] = useState(3);
  const [contextInput, setContextInput] = useState({ computer_model: '', camera_height_cm: '', camera_offset_cm: '', person_distance_m: '', lighting: 'not_recorded' as TestContext['lighting'], available_people: 'unknown' as TestContext['available_people'] });
  const [sameProfileLocked, setSameProfileLocked] = useState(false);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const sourceKey = (file: File | null) => file ? `${file.size}:${file.lastModified}:${file.type}` : 'test_card';
  const testContext = (): TestContext => ({ computer_model: contextInput.computer_model.trim().slice(0,80), camera_height_cm: contextInput.camera_height_cm===''?null:Number(contextInput.camera_height_cm), camera_offset_cm: contextInput.camera_offset_cm===''?null:Number(contextInput.camera_offset_cm), person_distance_m: contextInput.person_distance_m===''?null:Number(contextInput.person_distance_m), lighting: contextInput.lighting, available_people: contextInput.available_people });
  const selectedVideoFile = () => frozenVideoFile.current === undefined ? videoFile : frozenVideoFile.current;
  const sourceForExport = (): Omit<TrialResult['source'], 'same_source_verified'> => {
    const file = selectedVideoFile(), v = creative.current;
    return { kind: file ? 'local_video' : 'test_card', duration_s: file && v && Number.isFinite(v.duration) ? v.duration : null, width: file && v ? v.videoWidth || null : null, height: file && v ? v.videoHeight || null : null };
  };
  const transition = (next: Phase) => { phaseRef.current = next; if (alive.current) setPhase(next); };

  const clearRunResources = () => {
    generation.current++;
    abortRef.current?.abort(); abortRef.current = null;
    engineRef.current?.close(); engineRef.current = null;
    detectorRef.current?.dispose?.(); detectorRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null;
    if (camera.current) camera.current.srcObject = null;
    releaseLockRef.current?.(); releaseLockRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = 0;
    if (legacyTickerRef.current) clearInterval(legacyTickerRef.current); legacyTickerRef.current = null;
    if (uiTimerRef.current) clearInterval(uiTimerRef.current); uiTimerRef.current = null;
    if (isolationTimerRef.current) clearInterval(isolationTimerRef.current); isolationTimerRef.current = null;
    schedulerRef.current = null; legacyInFlight.current = false; playingRef.current = false;
  };

  const makeResult = (trialMode: TrialMode): TrialResult => {
    const now = performance.now(), metricsSnapshot = trialMode === 'legacy_plus_attention' ? metrics.current.snapshot(now) : null;
    const file = selectedVideoFile(), currentQuality = creative.current?.getVideoPlaybackQuality?.();
    const droppedStart = playbackStats.current.droppedStart ?? currentQuality?.droppedVideoFrames ?? null;
    const droppedEnd = currentQuality?.droppedVideoFrames ?? playbackStats.current.droppedEnd;
    const totalStart = playbackStats.current.totalStart ?? currentQuality?.totalVideoFrames ?? null;
    const totalEnd = currentQuality?.totalVideoFrames ?? playbackStats.current.totalEnd;
    const memoryFirst = memorySamples.current[0] ?? null, memoryLast = memorySamples.current.at(-1) ?? null;
    const legacyMean = legacyCounts.current.length ? legacyCounts.current.reduce((n, v) => n + v, 0) / legacyCounts.current.length : null;
    return {
      mode: trialMode, profile: 'gridcast-a2-combined-workload/1', started_at: startedIso.current, elapsed_ms: Math.max(0, now - startedPerf.current), settings: { ...frozenSettings.current!, detection_zone: { ...frozenSettings.current!.detection_zone } },
      source: { ...sourceForExport(), same_source_verified: frozenSource.current === sourceKey(file) }, camera: { label: cameraInfo.current?.label || 'Camera label unavailable', width: cameraInfo.current?.width || 0, height: cameraInfo.current?.height || 0, frame_rate: cameraInfo.current?.frameRate ?? null, same_camera_verified: !!cameraInfo.current && frozenCamera.current === cameraInfo.current.deviceId },
      calibration: trialMode === 'legacy_plus_attention' ? { method: calibrationMethod.current, yaw: calibrationMethod.current === 'guided-3s' ? calibrationValue.current.yaw : null, pitch: calibrationMethod.current === 'guided-3s' ? calibrationValue.current.pitch : null } : { method: 'not_used', yaw: null, pitch: null },
      test_context: frozenContext.current || testContext(),
      legacy: { model: LEGACY_CV_PROFILE.model, successful_samples: legacyCounts.current.length, errors: legacyErrors.current, skipped_no_fresh_frame: skippedFresh.current, skipped_busy: skippedBusy.current, skipped_paused: skippedPaused.current, mean_person_count: legacyMean, last_person_count: legacyCounts.current.at(-1) ?? null, sample_interval_ms: summarize(legacyIntervals.current), inference_latency_ms: summarize(legacyLatencies.current), intervals_retained: legacyIntervals.current.length },
      attention: { profile: trialMode === 'legacy_plus_attention' ? EVALUATION_PROFILE : null, delegate: trialMode === 'legacy_plus_attention' ? 'CPU' : null, state: trialMode !== 'legacy_plus_attention' ? 'not_in_trial' : metricsSnapshot?.current && metricsSnapshot.current.attention_observed_s > 0 ? 'observed' : 'no_observed_attention', metrics: metricsSnapshot, inference_latency_ms: summarize(attentionLatencies.current), face_fps: activeWorkerStats.current?.faceFps ?? null, person_fps: activeWorkerStats.current?.personFps ?? null, dropped_frames: activeWorkerStats.current?.dropped ?? null, stale_observations: trialMode === 'legacy_plus_attention' ? null : null, stale_observation_unavailable_reason: trialMode === 'legacy_plus_attention' ? 'The shared evaluation engine invalidates stale output as unknown but exposes no separate stale counter.' : null },
      playback: { source: file ? 'local_video' : 'test_card', stalls: file ? playbackStats.current.stalls : null, stall_ms: file ? Math.round(playbackStallTotal(playbackStats.current.stallMs, playbackStats.current.stallStarted, now)) : null, dropped_video_frames: file && droppedStart !== null && droppedEnd !== null ? Math.max(0, droppedEnd - droppedStart) : null, total_video_frames: file && totalStart !== null && totalEnd !== null ? Math.max(0, totalEnd - totalStart) : null, unavailable_reason: file ? (droppedStart === null ? 'getVideoPlaybackQuality unavailable' : null) : 'No local video was selected; playback quality does not apply to the test card' },
      memory: { measurement: memoryFirst === null || memoryLast === null ? 'unavailable' : 'javascript_heap_only', samples: memorySamples.current.length, first_used_bytes: memoryFirst, last_used_bytes: memoryLast, trend_bytes: memoryFirst === null || memoryLast === null ? null : memoryLast - memoryFirst, unavailable_reason: memoryFirst === null ? 'performance.memory is unavailable; no device-RAM estimate was made' : null }, warnings: [...warnings.current],
    };
  };

  const stop = (message = 'Trial stopped. Export contains aggregate results only.') => {
    const modeAtStop = activeTrial.current, wasRunning = phaseRef.current === 'running';
    if (wasRunning && modeAtStop) {
      playingRef.current = false; if (playStart.current !== null) metrics.current.boundary('a2-trial-1', false, performance.now());
      const result = makeResult(modeAtStop);
      setCombinedStats(previous => ({ ...previous, [modeAtStop === 'legacy_only' ? 'baseline' : 'combined']: result }));
      if (cameraInfo.current && !frozenCamera.current) frozenCamera.current = cameraInfo.current.deviceId;
    }
    cleanupRef.current(); cleanupRef.current = () => {};
    creative.current?.pause();
    activeTrial.current = null; playStart.current = null; transition('idle'); setMode(null); setPlaying(false); setSnapshot(modeAtStop === 'legacy_plus_attention' ? metrics.current.snapshot(performance.now()) : null); setStatus(message); setCurrentLegacy(null);
  };
  stopRef.current = stop;

  useEffect(() => {
    alive.current = true;
    setMemoryAvailable(currentHeap() !== null);
    const hidden = () => { if (document.hidden && phaseRef.current !== 'idle') stopRef.current('Stopped because this browser tab was hidden; hidden time is not measured.'); };
    document.addEventListener('visibilitychange', hidden);
    const baseline = currentHeap(); setMemoryAvailable(baseline !== null);
    return () => { alive.current = false; cleanupRef.current(); clearRunResources(); document.removeEventListener('visibilitychange', hidden); if (mediaUrl.current) URL.revokeObjectURL(mediaUrl.current); };
  }, []);

  const onPlaying = () => {
    if (phaseRef.current !== 'running') return;
    const now = performance.now(); playingRef.current = true; setPlaying(true); playStart.current = now; metrics.current.boundary('a2-trial-1', true, now);
    if (playbackStats.current.stallStarted !== null) { playbackStats.current.stallMs += now - playbackStats.current.stallStarted; playbackStats.current.stallStarted = null; }
    const quality = creative.current?.getVideoPlaybackQuality?.();
    if (quality) { if (playbackStats.current.droppedStart === null) playbackStats.current.droppedStart = quality.droppedVideoFrames; playbackStats.current.droppedEnd = quality.droppedVideoFrames; playbackStats.current.totalStart ??= quality.totalVideoFrames; playbackStats.current.totalEnd = quality.totalVideoFrames; }
  };
  const onPaused = () => {
    if (phaseRef.current !== 'running' || !playingRef.current) return;
    const now = performance.now(); playingRef.current = false; setPlaying(false); playStart.current = null; metrics.current.boundary('a2-trial-1', false, now);
    const quality = creative.current?.getVideoPlaybackQuality?.(); if (quality) { playbackStats.current.droppedEnd = quality.droppedVideoFrames; playbackStats.current.totalEnd = quality.totalVideoFrames; }
    if (playbackStats.current.stallStarted !== null) { playbackStats.current.stallMs += now - playbackStats.current.stallStarted; playbackStats.current.stallStarted = null; }
  };
  const onWaiting = () => {
    if (phaseRef.current !== 'running' || !playingRef.current) return;
    const now = performance.now(); onPaused(); playbackStats.current.stalls++; playbackStats.current.stallStarted = now;
  };

  const startTrial = async (trialMode: TrialMode) => {
    if (phaseRef.current !== 'idle') return;
    const chosenSettings = { ...settingsRef.current, detection_zone: { ...settingsRef.current.detection_zone } };
    const selectedSource = sourceKey(videoFile), selectedCamera = cameraId || 'default';
    const selectedContext = testContext();
    const proposed = JSON.stringify({ settings: chosenSettings, source: selectedSource, camera: selectedCamera, test_context: selectedContext });
    const locked = (window as Window & { __a2PairProfile?: string }).__a2PairProfile;
    if (locked && locked !== proposed) { setError('Clear the comparison pair before changing settings, camera or local video.'); return; }
    setError(''); setStatus('Preparing local models and camera. Camera access starts only after this button.'); transition('preparing'); setMode(trialMode); activeTrial.current = trialMode;
    const myGeneration = ++generation.current, controller = new AbortController(); abortRef.current = controller;
    let localStream: MediaStream | null = null, localDetector: LegacyDetector | null = null, localEngine: VisionEngine | null = null, release: (() => void) | null = null, cleaned = false;
    const failStart = (e: unknown) => { const message = e instanceof Error ? e.message : 'The local trial could not start.'; if (!controller.signal.aborted && alive.current && myGeneration === generation.current) { setError(message); stop(message); } };
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true; controller.abort();
      if (engineRef.current === localEngine) engineRef.current = null;
      localEngine?.close(); localEngine = null;
      if (detectorRef.current === localDetector) detectorRef.current = null;
      localDetector?.dispose?.(); localDetector = null;
      if (streamRef.current === localStream) streamRef.current = null;
      localStream?.getTracks().forEach(track => track.stop()); localStream = null;
      if (camera.current) camera.current.srcObject = null;
      if (releaseLockRef.current === release) releaseLockRef.current = null;
      release?.(); release = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current); if (legacyTickerRef.current) clearInterval(legacyTickerRef.current); if (uiTimerRef.current) clearInterval(uiTimerRef.current); if (isolationTimerRef.current) clearInterval(isolationTimerRef.current);
      rafRef.current = 0; legacyTickerRef.current = null; uiTimerRef.current = null; isolationTimerRef.current = null;
      calibrationSampler.current = null;
      if (abortRef.current === controller) abortRef.current = null;
    };
    cleanupRef.current = cleanup;
    try {
      await ensureA2IsolationScope(controller.signal); release = await acquireEvaluationLock(controller.signal); releaseLockRef.current = release; await assertIsolated(); controller.signal.throwIfAborted();
      localDetector = await loadLegacyDetector(controller.signal, setStatus); detectorRef.current = localDetector;
      if (trialMode === 'legacy_plus_attention') {
        await prepareEvaluation(setStatus, controller.signal); controller.signal.throwIfAborted();
        setStatus('Initializing the pinned CPU attention worker…');
        localEngine = await createEvaluationWorker('CPU', controller.signal, (observation, nextStats) => {
          if (alive.current && myGeneration === generation.current && phaseRef.current === 'calibrating') { calibrationSampler.current?.observe(observation); return; }
          if (!alive.current || myGeneration !== generation.current || phaseRef.current !== 'running' || !playingRef.current || playStart.current === null || observation.at < playStart.current) return;
          metrics.current.observe(observation); activeWorkerStats.current = nextStats; boundedPush(attentionLatencies.current, nextStats.latencyMs, 1200);
        }, message => { if (alive.current && myGeneration === generation.current) { warnings.current.push('Attention worker stopped; all subsequent attention measurements are unavailable.'); setError(message); setStatus(message); engineRef.current?.close(); engineRef.current = null; } });
        engineRef.current = localEngine; controller.signal.throwIfAborted();
      }
      setStatus('Requesting the camera selected for this local trial…');
      const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints({ ...chosenSettings, ...(selectedCamera !== 'default' ? { camera_device_id: selectedCamera } : {}) }));
      if (controller.signal.aborted || myGeneration !== generation.current) { stream.getTracks().forEach(t => t.stop()); return; }
      localStream = stream; streamRef.current = stream;
      const track = stream.getVideoTracks()[0]; if (!track) throw Error('The selected camera did not provide a video track.');
      const actual = track.getSettings(), deviceId = actual.deviceId || selectedCamera;
      if (cameraInfo.current && cameraInfo.current.deviceId !== deviceId) { stream.getTracks().forEach(t => t.stop()); throw Error('This trial opened a different camera. Clear the comparison pair or reselect the original camera.'); }
      const label = track.label || 'Camera label unavailable';
      cameraInfo.current = { deviceId, label, width: actual.width || 0, height: actual.height || 0, frameRate: actual.frameRate || null };
      if (!frozenCamera.current) frozenCamera.current = deviceId;
      // Keep the comparison context in the same frozen profile checked at trial start.
      const lockProfile = JSON.stringify({ settings: chosenSettings, source: selectedSource, camera: selectedCamera, test_context: selectedContext });
      (window as Window & { __a2PairProfile?: string }).__a2PairProfile ??= lockProfile;
      frozenSettings.current = chosenSettings; frozenSource.current ??= selectedSource; frozenCamera.current = deviceId; frozenContext.current ??= selectedContext; if (frozenVideoFile.current === undefined) frozenVideoFile.current = videoFile; setSameProfileLocked(true);
      if (camera.current) { camera.current.srcObject = stream; await camera.current.play(); }
      if (controller.signal.aborted || myGeneration !== generation.current) { cleanup(); return; }
      detectorRef.current = localDetector; engineRef.current = localEngine; releaseLockRef.current = release;
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []); if (alive.current) setCameraDevices(devices.filter(d => d.kind === 'videoinput'));
      isolationTimerRef.current = setInterval(() => { void assertIsolated().catch(e => { if (!controller.signal.aborted) { warnings.current.push('Same-origin player isolation changed during the trial.'); setError(e.message); stop('Stopped because another Gridcast player opened in this browser.'); } }); }, 2500);
      stream.getVideoTracks().forEach(t => t.addEventListener('ended', () => { if (!controller.signal.aborted) stop('Camera disconnected; trial stopped.'); }, { once: true }));
      activeWorkerStats.current = null; transition('ready'); setStatus('Models warmed and one camera stream is ready. Start the scored phase when ready.');
      setError('');
    } catch (e) {
      cleanup(); if (alive.current && myGeneration === generation.current && (e as Error)?.name !== 'AbortError') { activeTrial.current = null; transition('idle'); setMode(null); setError((e as Error)?.message || 'The local trial could not start.'); setStatus('No scored measurements were recorded.'); }
    }
  };

  const beginScored = () => {
    if (phaseRef.current !== 'ready' || !activeTrial.current) return;
    const trialMode = activeTrial.current, now = performance.now();
    const runGeneration = generation.current;
    legacyInFlight.current = false;
    legacyCounts.current = []; legacyIntervals.current = []; legacyLatencies.current = []; attentionLatencies.current = []; memorySamples.current = [];
    legacyErrors.current = skippedFresh.current = skippedBusy.current = skippedPaused.current = 0; legacyBroken.current = false; previousCameraTime.current = -1; lastLegacyAttempt.current = null;
    playbackStats.current = { stalls: 0, stallStarted: null, stallMs: 0, droppedStart: null, totalStart: null, droppedEnd: null, totalEnd: null };
    warnings.current = []; metrics.current.reset(); activeWorkerStats.current = null; setSnapshot(null); setWorkerStats(null); setCurrentLegacy(null); setSampleCount(0); setErrorCount(0);
    startedPerf.current = now; startedIso.current = new Date().toISOString(); lastUiTick.current = now; lastMemoryAt.current = 0; playStart.current = null;
    schedulerRef.current = new LegacyPriorityScheduler(chosenInterval(settingsRef.current), 0, Math.max(300, (settingsRef.current.sample_interval_s * 1000) / 4));
    transition('running'); setElapsed(0); setStatus('Scored phase is running locally. Actual legacy samples and optional attention remain separate.');
    const video = camera.current;
    const sampleLegacy = (at: number) => {
      const settingsNow = frozenSettings.current!;
      if (!video || !detectorRef.current || legacyBroken.current) return;
      const camTime = video.currentTime;
      if (camTime === previousCameraTime.current) { skippedFresh.current++; return; }
      previousCameraTime.current = camTime; legacyInFlight.current = true;
      if (lastLegacyAttempt.current !== null) boundedPush(legacyIntervals.current, at - lastLegacyAttempt.current, 512);
      lastLegacyAttempt.current = at;
      const started = performance.now(), currentDetector = detectorRef.current, currentVideo = video;
      const capturedStream = streamRef.current;
      const captured = { generation: runGeneration, segment: playStart.current, stream: capturedStream, cameraLive: !!capturedStream?.getVideoTracks().some(track => track.readyState === 'live' && track.enabled && !track.muted), mode: trialMode };
      void sampleLegacyFrame(currentVideo, currentDetector, capture.current!, settingsNow).then(value => {
        const stream = streamRef.current;
        const current = { generation: generation.current, segment: playStart.current, stream, cameraLive: !!stream?.getVideoTracks().some(track => track.readyState === 'live' && track.enabled && !track.muted), playing: playingRef.current, visible: !document.hidden, phase: phaseRef.current, mode: activeTrial.current };
        if (!acceptsA2CaptureResult({ ...captured, playing: true, visible: true, phase: 'running' }, current)) return;
        legacyCounts.current.push(value.count); if (legacyCounts.current.length > 4096) legacyCounts.current.shift();
        boundedPush(legacyLatencies.current, performance.now() - started, 512); setCurrentLegacy(value.count); setSampleCount(legacyCounts.current.length);
      }).catch(() => {
        const stream = streamRef.current;
        const current = { generation: generation.current, segment: playStart.current, stream, cameraLive: !!stream?.getVideoTracks().some(track => track.readyState === 'live' && track.enabled && !track.muted), playing: playingRef.current, visible: !document.hidden, phase: phaseRef.current, mode: activeTrial.current };
        if (acceptsA2CaptureResult({ ...captured, playing: true, visible: true, phase: 'running' }, current)) { legacyErrors.current++; setErrorCount(legacyErrors.current); setError('Legacy COCO-SSD detector failed. Further legacy samples stopped; successful prior samples remain intact.'); legacyBroken.current = true; }
      }).finally(() => { if (generation.current === runGeneration) legacyInFlight.current = false; });
    };
    legacyTickerRef.current = setInterval(() => {
      if (phaseRef.current !== 'running') return;
      const decision = schedulerRef.current?.pollLegacy(Date.now(), playingRef.current && !document.hidden, legacyInFlight.current);
      if (decision?.legacySkipped === 'paused') skippedPaused.current++;
      if (decision?.legacySkipped === 'in_flight') skippedBusy.current++;
      if (decision?.legacy) sampleLegacy(performance.now());
    }, 250);
    const tick = () => {
      if (phaseRef.current !== 'running') return;
      const at = performance.now(), scheduler = schedulerRef.current;
      const playingNow = playingRef.current && !document.hidden;
      if (scheduler?.attentionAllowed(Date.now(), playingNow, legacyInFlight.current) && video && engineRef.current && trialMode === 'legacy_plus_attention') void engineRef.current.frame(video, calibrationValue.current);
      if (at - lastUiTick.current >= 125) {
        lastUiTick.current = at; setElapsed(at - startedPerf.current);
        if (trialMode === 'legacy_plus_attention') { const next = metrics.current.snapshot(at); setSnapshot(next); setWorkerStats(activeWorkerStats.current); }
      }
      if (at - lastMemoryAt.current >= 5000) { lastMemoryAt.current = at; const used = currentHeap(); setMemoryAvailable(used !== null); if (used !== null) boundedPush(memorySamples.current, used, 180); }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    uiTimerRef.current = setInterval(() => { void assertIsolated().catch(e => { if (phaseRef.current === 'running') { warnings.current.push('Same-origin player isolation changed during the trial.'); setError(e.message); stop('Stopped because another Gridcast player opened in this browser.'); } }); }, 2500);
    if (videoFile && creative.current) { creative.current.currentTime = 0; void creative.current.play().catch(() => setStatus('Click play on the local test video to begin scored measurements.')); }
    else onPlaying();
  };

  const runCalibration = () => {
    if (phaseRef.current !== 'ready' || activeTrial.current !== 'legacy_plus_attention' || !engineRef.current || !camera.current) return;
    const began = performance.now(); calibrationSampler.current = new GazeCalibration(began); setCalibrationSeconds(3); setError(''); transition('calibrating'); setStatus('Look at the centre dot with one face visible. Calibration data stays in memory and is not exported as a face record.');
    const frame = () => { if (phaseRef.current !== 'calibrating') return; void engineRef.current?.frame(camera.current!, calibrationValue.current); rafRef.current = requestAnimationFrame(frame); };
    rafRef.current = requestAnimationFrame(frame);
    uiTimerRef.current = setInterval(() => {
      if (phaseRef.current !== 'calibrating') return;
      const remaining = 3000 - (performance.now() - began); setCalibrationSeconds(Math.max(0, Math.ceil(remaining / 1000)));
      if (remaining <= 0) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = 0; if (uiTimerRef.current) clearInterval(uiTimerRef.current); uiTimerRef.current = null;
        try { const result = calibrationSampler.current!.finish(); calibrationValue.current = result; calibrationMethod.current = 'guided-3s'; setCalibrationLabel(`Guided · yaw ${result.yaw}° / pitch ${result.pitch}°`); setStatus('Calibration complete. Begin the scored combined trial when ready.'); }
        catch (e) { setError((e as Error).message); setStatus('Calibration was not accepted; the previous calibration remains.'); }
        calibrationSampler.current = null; transition('ready');
      }
    }, 100);
  };
  const cancelCalibration = () => {
    if (phaseRef.current !== 'calibrating') return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = 0; if (uiTimerRef.current) clearInterval(uiTimerRef.current); uiTimerRef.current = null;
    calibrationSampler.current = null; transition('ready'); setStatus('Calibration cancelled. Previous offsets were kept.');
  };

  const chosenInterval = (value: LegacySettings) => Math.max(500, Number(value.sample_interval_s || 2) * 1000);
  const updateZone = (key: keyof LegacySettings['detection_zone'], value: number) => setSettings(previous => ({ ...previous, detection_zone: { ...previous.detection_zone, [key]: Math.max(0, Math.min(100, value)) } }));
  const clearComparison = () => {
    if (phaseRef.current !== 'idle') return;
    setCombinedStats({ baseline: null, combined: null }); setSameProfileLocked(false); setError(''); setSnapshot(null); setElapsed(0); cameraInfo.current = null; frozenCamera.current = null; frozenSettings.current = null; frozenSource.current = null; frozenContext.current = null; frozenVideoFile.current = undefined;
    calibrationValue.current = { yaw: 0, pitch: 0 }; calibrationMethod.current = 'not-calibrated'; setCalibrationLabel('Not calibrated');
    delete (window as Window & { __a2PairProfile?: string }).__a2PairProfile;
    setStatus('Comparison cleared. Choose a camera, source and profile for a new pair.');
  };
  const download = () => {
    const file = selectedVideoFile();
    const data = { schema: 'gridcast-a2-local-evaluation/1', evaluation_only: true, analytics_only: true, production_approved: false, proposed_targets_are_not_user_approved: true, generated_at: new Date().toISOString(), browser: { user_agent: navigator.userAgent, platform: navigator.platform }, cross_browser_isolation: 'Web Locks and the scoped service-worker player check cover this origin/browser profile only; close other profiles, browsers and camera applications manually.', comparison_profile: { settings: frozenSettings.current || settingsRef.current, source: file ? 'local_video' : 'test_card', camera_label: cameraInfo.current?.label || null, camera_id_exported: false, test_context: frozenContext.current || testContext() }, baseline: combinedStats.baseline, combined: combinedStats.combined, current: phaseRef.current === 'running' && activeTrial.current ? makeResult(activeTrial.current) : null, export_limits: { max_intervals_per_trial: 512, max_latency_samples_per_trial: 512, max_memory_samples_per_trial: 180, max_attention_plays: 20, excluded: ['raw_frames','face_geometry','landmarks','person_ids','camera_device_ids','video_filename'] } };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' }); const href = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = href; link.download = 'gridcast-a2-local-evaluation.json'; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  const legacyMean = legacyCounts.current.length ? legacyCounts.current.reduce((n, v) => n + v, 0) / legacyCounts.current.length : null;
  const active = phase !== 'idle'; const combinedLive = mode === 'legacy_plus_attention' && phase === 'running';
  const card = (title: string, value: string, detail: string) => <div className="rounded-lg border bg-white p-4"><dt className="text-xs text-slate-500">{title}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd><p className="mt-1 text-xs text-slate-500">{detail}</p></div>;
  const showLegacy = (trial: TrialResult | null) => trial ? `${trial.legacy.successful_samples} samples · mean ${medianLabel(trial.legacy.mean_person_count, 2)} · median interval ${medianLabel(trial.legacy.sample_interval_ms.median)} ms · ${trial.legacy.errors} errors` : 'Not run';
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-6xl space-y-6">
    <header><BrandLogo compact className="mb-4"/><h1 className="text-3xl font-semibold tracking-tight">A2 combined workload lab</h1><p className="mt-2 max-w-3xl text-sm text-slate-600">Compare the existing COCO-SSD measurement alone with the same sampler plus optional attention on one camera stream. Local evaluation only. Nothing here connects to delivery, reporting, campaigns or billing.</p></header>
    <section className="rounded-xl border bg-white p-5"><h2 className="font-medium">Comparison setup</h2><p className="mt-2 text-xs text-slate-600">Settings, source and test context lock after the first trial so the baseline and combined run use the same profile. Clear comparison to start a new pair. The camera starts only after you choose a trial and grant permission.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <label className="text-sm">Camera<select aria-label="A2 camera" value={cameraId} disabled={active||sameProfileLocked} onChange={e=>setCameraId(e.target.value)} className="mt-1 block w-full rounded border p-2"><option value="">Default camera</option>{cameraDevices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}</select></label>
        <label className="text-sm">Sample interval (seconds)<input aria-label="Legacy sample interval" type="number" min="0.5" max="30" step="0.5" value={settings.sample_interval_s} disabled={active||sameProfileLocked} onChange={e=>setSettings({...settings,sample_interval_s:Number(e.target.value)||2})} className="mt-1 block w-full rounded border p-2"/></label>
        <label className="text-sm">Minimum confidence<input aria-label="Legacy confidence" type="number" min="0" max="1" step="0.01" value={settings.confidence_min} disabled={active||sameProfileLocked} onChange={e=>setSettings({...settings,confidence_min:Number(e.target.value)})} className="mt-1 block w-full rounded border p-2"/></label>
        <label className="text-sm">Count ceiling<input aria-label="Legacy count ceiling" type="number" min="1" max="500" value={settings.count_ceiling} disabled={active||sameProfileLocked} onChange={e=>setSettings({...settings,count_ceiling:Number(e.target.value)})} className="mt-1 block w-full rounded border p-2"/></label>
        <label className="text-sm">Minimum person-box height (source pixels)<input aria-label="Legacy minimum box" type="number" min="1" max="1000" value={settings.min_box_px} disabled={active||sameProfileLocked} onChange={e=>setSettings({...settings,min_box_px:Number(e.target.value)})} className="mt-1 block w-full rounded border p-2"/></label>
        <label className="text-sm">Inference frame size<select aria-label="Legacy frame size" value={settings.inference_res} disabled={active||sameProfileLocked} onChange={e=>setSettings({...settings,inference_res:e.target.value})} className="mt-1 block w-full rounded border p-2"><option>320x240</option><option>640x480</option><option>1280x720</option></select></label>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">{(['x','y','w','h'] as const).map(key=><label className="text-sm" key={key}>Detection zone {key}<input aria-label={`Detection zone ${key}`} type="number" min="0" max="100" value={settings.detection_zone[key]} disabled={active||sameProfileLocked} onChange={e=>updateZone(key,Number(e.target.value)||0)} className="mt-1 block w-full rounded border p-2"/></label>)}</div>
      <fieldset className="mt-5 rounded-lg border p-4"><legend className="px-2 text-sm font-medium">Optional A2 test context</legend><p className="text-xs text-slate-500">Context is included in the local aggregate export only. Do not enter participant names or identifying details.</p><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">Computer make/model<input aria-label="A2 computer model" maxLength={80} value={contextInput.computer_model} disabled={active||sameProfileLocked} onChange={e=>setContextInput({...contextInput,computer_model:e.target.value.slice(0,80)})} className="mt-1 block w-full rounded border p-2"/></label>
        <label className="text-sm">Camera height (cm)<input aria-label="A2 camera height" type="number" min="0" max="500" value={contextInput.camera_height_cm} disabled={active||sameProfileLocked} onChange={e=>setContextInput({...contextInput,camera_height_cm:e.target.value})} className="mt-1 block w-full rounded border p-2"/></label>
        <label className="text-sm">Camera offset from screen centre (cm)<input aria-label="A2 camera offset" type="number" min="-500" max="500" value={contextInput.camera_offset_cm} disabled={active||sameProfileLocked} onChange={e=>setContextInput({...contextInput,camera_offset_cm:e.target.value})} className="mt-1 block w-full rounded border p-2"/></label>
        <label className="text-sm">Approximate person distance (m)<input aria-label="A2 person distance" type="number" min="0" max="50" step="0.1" value={contextInput.person_distance_m} disabled={active||sameProfileLocked} onChange={e=>setContextInput({...contextInput,person_distance_m:e.target.value})} className="mt-1 block w-full rounded border p-2"/></label>
        <label className="text-sm">Lighting<select aria-label="A2 lighting" value={contextInput.lighting} disabled={active||sameProfileLocked} onChange={e=>setContextInput({...contextInput,lighting:e.target.value as TestContext['lighting']})} className="mt-1 block w-full rounded border p-2"><option value="not_recorded">Not recorded</option><option value="dim">Dim</option><option value="normal">Normal</option><option value="bright">Bright</option></select></label>
        <label className="text-sm">People available for test<select aria-label="A2 available people" value={contextInput.available_people} disabled={active||sameProfileLocked} onChange={e=>setContextInput({...contextInput,available_people:e.target.value as TestContext['available_people']})} className="mt-1 block w-full rounded border p-2"><option value="unknown">Not recorded</option><option value="one">One</option><option value="two">Two</option></select></label>
      </div></fieldset>
      <label className="mt-4 block text-sm">Optional local test video<input aria-label="A2 local test video" type="file" accept="video/*" disabled={active||sameProfileLocked} className="mt-1 block w-full text-xs" onChange={e=>{const file=e.target.files?.[0]||null;if(mediaUrl.current)URL.revokeObjectURL(mediaUrl.current);mediaUrl.current=file?URL.createObjectURL(file):null;pendingMedia.current=file;setVideoFile(file);}}/></label>
      <p className="mt-2 text-xs text-slate-500">Legacy profile is the same pinned COCO-SSD 2.2.3 `lite_mobilenet_v2` source and mean-of-samples behavior as the player. Confidence, detection zone, minimum box height, frame size and count ceiling use the legacy settings shown above. The selected video remains local; its filename and pixels are never exported.</p>
    </section>
    <section className="rounded-xl border bg-white p-5"><div className="flex flex-wrap gap-3">
      <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40" disabled={active} onClick={()=>void startTrial('legacy_only')}>Prepare legacy-only baseline</button>
      <button className="rounded-lg bg-amber-700 px-4 py-2 text-sm text-white disabled:opacity-40" disabled={active} onClick={()=>void startTrial('legacy_plus_attention')}>Prepare combined trial</button>
      <button className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40" disabled={phase!=='ready'} onClick={beginScored}>Begin scored phase</button>
      <button className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40" disabled={phase!=='ready'||mode!=='legacy_plus_attention'} onClick={runCalibration}>Auto-calibrate attention (3 s)</button>
      {phase==='calibrating'&&<button className="rounded-lg border px-4 py-2 text-sm" onClick={cancelCalibration}>Cancel calibration · {calibrationSeconds}</button>}
      <button className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40" disabled={!active} onClick={()=>stop()}>Stop and save aggregate</button>
      <button className="ml-auto rounded-lg border px-4 py-2 text-sm disabled:opacity-40" disabled={!combinedStats.baseline&&!combinedStats.combined&&phase!=='running'} onClick={download}>Export bounded results</button>
      <button className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40" disabled={active||(!sameProfileLocked&&!combinedStats.baseline&&!combinedStats.combined)} onClick={clearComparison}>Clear comparison</button>
    </div><p className="mt-4 text-sm" role="status">{status}{phase==='running'?` · ${Math.floor(elapsed/1000)}s elapsed · ${playing?'playing':'paused'}`:''}</p>{error&&<p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
      <p className="mt-2 text-xs text-slate-500">Phase: {phase==='idle'?'stopped':phase==='preparing'?'model / camera setup':phase==='ready'?'warmed, waiting for scored start':phase==='calibrating'?'guided calibration':'scored trial'} · Same-origin Web Locks and the lab service-worker player check do not cover other browsers, profiles or camera applications.</p>{mode==='legacy_plus_attention'&&<p className="mt-2 text-xs text-slate-600">Attention calibration: {calibrationLabel}. Human look/away scoring should use a successful guided calibration; an uncalibrated runtime trial is not accuracy evidence.</p>}</section>
    <div className="grid gap-5 lg:grid-cols-2"><section className="overflow-hidden rounded-xl border bg-slate-950"><h2 className="p-4 text-sm text-white">Single camera stream · {cameraInfo.current?.label||'not started'}</h2><div className="relative w-full" style={{aspectRatio:cameraInfo.current?.width&&cameraInfo.current?.height?cameraInfo.current.width/cameraInfo.current.height:4/3}}><video ref={camera} autoPlay muted playsInline className="absolute inset-0 h-full w-full object-contain"/>{phase==='calibrating'&&<div className="pointer-events-none absolute inset-0 grid place-items-center"><span className="h-7 w-7 rounded-full bg-amber-400 ring-8 ring-amber-400/30" aria-label="Calibration target"/></div>}</div><canvas ref={capture} className="hidden" aria-hidden="true"/><p className="p-4 text-xs text-white">Camera frames stay in this tab and are cleared after legacy inference. The attention worker receives bounded transferred frame copies; no camera data is downloaded or uploaded.</p></section>
      <section className="rounded-xl border bg-white p-4"><h2 className="font-medium">Test content</h2>{videoFile? <video ref={creative} src={mediaUrl.current||undefined} controls muted playsInline className="my-3 aspect-video w-full bg-black" onLoadedMetadata={e=>{const v=e.currentTarget;if(v.videoWidth&&v.videoHeight)setSourceRatio(v.videoWidth/v.videoHeight);}} onPlaying={onPlaying} onPause={onPaused} onWaiting={onWaiting} onStalled={onWaiting} onEnded={onPaused} onError={()=>setError('The local video could not play; no playback time is attributed while unavailable.')}/> : <div className="my-3 grid aspect-video place-items-center rounded-lg bg-amber-700 text-white" style={{aspectRatio:sourceRatio}}><p>Local test card · press Begin scored phase to start timing</p></div>}
        {!videoFile&&<button className="rounded border px-3 py-2 text-sm" disabled={phase!=='running'} onClick={()=>playing?onPaused():onPlaying()}>{playing?'Pause timing':'Resume timing'}</button>}
        <p className="mt-3 text-xs text-slate-500">Pauses and buffering do not earn attention time. Start both trials with this same local source from its beginning. No video name or content is added to the export.</p></section></div>
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{card('Legacy samples',`${sampleCount}`,`Errors ${errorCount}; mean count ${medianLabel(legacyMean,2)}; last count ${medianLabel(currentLegacy,0)}.`)}{card('Legacy interval median',`${medianLabel(summarize(legacyIntervals.current).median)} ms`,`p95 ${medianLabel(summarize(legacyIntervals.current).p95)} ms; intervals measured between actual sample starts.`)}{card('Attention coverage',combinedLive?`${number(snapshot?.current?.attention_observed_s)}s observed / ${number(snapshot?.current?.attention_unknown_s)}s unknown`:'Unavailable for this trial',`Body ${metric(snapshot,'body_status')} · face ${metric(snapshot,'face_status')}; no zero imputation.`)}{card('Worker latency',combinedLive?`${medianLabel(summarize(attentionLatencies.current).median)} ms median`:'Unavailable for this trial',`Face ${medianLabel(workerStats?.faceFps,1)} fps · body ${medianLabel(workerStats?.personFps,1)} fps · dropped ${workerStats?.dropped??'—'}.`)}{card('Memory trend',memorySamples.current.length>1?`${number((memorySamples.current.at(-1)!-memorySamples.current[0])/1e6,1)} MB`:'Unavailable',memoryAvailable?'JavaScript heap only; not total device RAM.':'This browser does not expose performance.memory.')}{card('Video quality',videoFile?`${playbackStats.current.stalls} stalls`:'Unavailable',videoFile?'Dropped-frame counters are read only when the browser exposes them.':'No local video selected; test-card playback quality does not apply.')}</dl>
    <section className="rounded-xl border bg-white p-5"><h2 className="font-medium">Paired trial results</h2><dl className="mt-3 grid gap-4 md:grid-cols-2"><div><dt className="text-xs text-slate-500">Legacy-only baseline</dt><dd className="mt-1 text-sm">{showLegacy(combinedStats.baseline)}</dd></div><div><dt className="text-xs text-slate-500">Legacy + attention</dt><dd className="mt-1 text-sm">{showLegacy(combinedStats.combined)}{combinedStats.combined?` · attention observed ${medianLabel(combinedStats.combined.attention.metrics?.current?.attention_observed_s,2)} s / unknown ${medianLabel(combinedStats.combined.attention.metrics?.current?.attention_unknown_s,2)} s`:''}</dd></div></dl><p className="mt-3 text-xs text-slate-500">These are observations, not a pass/fail decision. Document 26’s quantitative A2 targets remain proposed and need agreement before a scored human session. Synthetic cameras/model fixtures do not establish person-count or looking accuracy.</p></section>
    <section className="rounded-xl border bg-white p-5"><h2 className="font-medium">Measurement notes</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600"><li>COCO samples retain the player’s mean-of-samples interpretation; attention body counts are never substituted.</li><li>Optional worker frames are only requested away from the next due legacy window. Its own one-frame in-flight bound drops excess work; legacy detector opportunities keep priority.</li><li>Actual legacy sample intervals and errors, attention rates/coverage, video stall/frame counters when exposed, and labelled JavaScript heap trend when exposed are exported. Device RAM is never estimated.</li><li>Close other browsers/profiles and camera apps manually. Browser APIs here can check only same-origin tabs in the current browser profile.</li><li>One camera owner supplies both detectors. Stop, hidden tabs, camera disconnect, isolation change and worker failure stop or mark the appropriate stream unavailable. No human accuracy or A2 pass is inferred.</li></ul></section>
  </div></main>;
}

function chosenInterval(settings: LegacySettings) { return Math.max(500, Number(settings.sample_interval_s || 2) * 1000); }
function number(value: number | null | undefined, digits = 1) { return value == null ? '—' : value.toFixed(digits); }
