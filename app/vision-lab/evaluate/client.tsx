'use client';

import { useEffect, useRef, useState } from 'react';
import { GazeCalibration } from '@/lib/vision/calibration';
import { BrandLogo } from '@/components/ui/brand-mark';
import { EvaluationMetrics, type EvaluationSnapshot, type TrackView, type FaceView } from '@/lib/vision/metrics';
import { acquireEvaluationLock, assertIsolated, createEvaluationWorker, EVALUATION_PROFILE, prepareEvaluation, type EngineStatus } from '@/lib/vision/engine';

const number = (value: number | null | undefined, digits = 1) => value == null ? '—' : value.toFixed(digits);
export default function AttentionEvaluation() {
  const camera = useRef<HTMLVideoElement>(null), creative = useRef<HTMLVideoElement>(null);
  const metrics = useRef(new EvaluationMetrics());
  const cleanup = useRef<() => void>(() => {}), sequence = useRef(0), play = useRef<string | null>(null);
  const run = useRef(0);
  const runMetadata = useRef<{ mode: 'camera'|'simulation'; delegate: 'CPU'|'GPU'; calibration: {yaw:number;pitch:number}; calibration_method:string; started_at:string; warnings:string[] } | null>(null);
  const alive = useRef(true), mediaURL = useRef<string | null>(null), prepareAbort = useRef<AbortController | null>(null);
  const [faceDetails, setFaceDetails] = useState<FaceView[]>([]);
  const [showFaces, setShowFaces] = useState(true);
  const [tracks, setTracks] = useState<TrackView[]>([]);
  const [showOverlay, setShowOverlay] = useState(true), [cameraRatio, setCameraRatio] = useState(4 / 3);
  const [snapshot, setSnapshot] = useState<EvaluationSnapshot | null>(null);
  const [status, setStatus] = useState('Prepare the files, then start a camera test or try a simulation.');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'idle' | 'camera' | 'simulation' | 'calibration'>('idle');
  const [delegate, setDelegate] = useState<'CPU' | 'GPU'>('CPU'), [stats, setStats] = useState<EngineStatus | null>(null);
  const [online, setOnline] = useState(true), [media, setMedia] = useState<string | null>(null), [playing, setPlaying] = useState(false);
  const [calibration, setCalibration] = useState({ yaw: 0, pitch: 0 }), [label, setLabel] = useState('Test creative');
  const [calibrationSeconds, setCalibrationSeconds] = useState(3);
  const [calibrationMethod, setCalibrationMethod] = useState('default');
  const [filesBytes, setFilesBytes] = useState<number | null>(null);
  const calibrationRef = useRef(calibration); calibrationRef.current = calibration;
  const stop = (message = 'Stopped. Results stay here until the next test or page reload.') => {
    run.current++;
    cleanup.current(); cleanup.current = () => {};
    prepareAbort.current?.abort(); prepareAbort.current = null;
    metrics.current.boundary(null, false, performance.now());
    play.current = null;
    creative.current?.pause();
    if (camera.current) camera.current.srcObject = null;
    if (alive.current) { setSnapshot(metrics.current.snapshot(performance.now())); setMode('idle'); setTracks([]); setFaceDetails([]); setBusy(false); setPlaying(false); setStatus(message); }
  };
  useEffect(() => {
    alive.current = true; setOnline(navigator.onLine);
    const net = () => setOnline(navigator.onLine);
    const hidden = () => { if (document.hidden) stop('Stopped because this tab was hidden. Hidden time is not measured.'); };
    window.addEventListener('online', net); window.addEventListener('offline', net); document.addEventListener('visibilitychange', hidden);
    return () => { alive.current = false; run.current++; cleanup.current(); prepareAbort.current?.abort(); if (mediaURL.current) URL.revokeObjectURL(mediaURL.current); window.removeEventListener('online', net); window.removeEventListener('offline', net); document.removeEventListener('visibilitychange', hidden); };
    // The lifecycle callbacks operate on refs; do not restart a camera on UI renders.
  }, []);
  const prepare = async (generation = run.current) => {
    const controller = new AbortController(); prepareAbort.current = controller;
    try { const r = await prepareEvaluation(message => { if (alive.current && generation === run.current) setStatus(message); }, controller.signal); if (!controller.signal.aborted && alive.current && generation === run.current) { setReady(true); setFilesBytes(r.bytes); } }
    finally { if (prepareAbort.current === controller) prepareAbort.current = null; }
  };
  const nextPlay = () => {
    if (mode !== 'camera' && mode !== 'simulation') return;
    const id = `local-play-${++sequence.current}`; play.current = id; setLabel(`Test creative ${sequence.current}`);
    if (creative.current && media) { creative.current.currentTime = 0; metrics.current.boundary(id, false, performance.now()); void creative.current.play().catch(() => { setPlaying(false); setStatus('Press play on the test video to measure it.'); }); }
    else { metrics.current.boundary(id, true, performance.now()); setPlaying(true); }
  };
  const mediaState = (value: boolean) => {
    if (!play.current) return;
    metrics.current.boundary(play.current, value, performance.now()); setPlaying(value);
  };
  const begin = async (simulation: boolean, calibrating = false) => {
    const generation = ++run.current;
    const current = () => alive.current && generation === run.current;
    setError(''); setBusy(true); if (!calibrating) setStats(null); setTracks([]); setFaceDetails([]);
    if (simulation) setCameraRatio(4 / 3);
    const controller = new AbortController(); let stream: MediaStream | undefined, engine: Awaited<ReturnType<typeof createEvaluationWorker>> | undefined;
    let releaseLock: (() => void) | undefined;
    let sampler: GazeCalibration | undefined;
    let raf = 0, ui: ReturnType<typeof setInterval> | undefined, check: ReturnType<typeof setInterval> | undefined, checking = false;
    const end = () => { controller.abort(); releaseLock?.(); engine?.close(); stream?.getTracks().forEach(t => t.stop()); cancelAnimationFrame(raf); if (ui) clearInterval(ui); if (check) clearInterval(check); };
    cleanup.current = end;
    try {
      if (!simulation) {
        await prepare(generation); controller.signal.throwIfAborted(); releaseLock = await acquireEvaluationLock(controller.signal); await assertIsolated(); controller.signal.throwIfAborted();
        setStatus(`Initializing real models in a ${delegate} worker…`);
        engine = await createEvaluationWorker(delegate, controller.signal, (observation, nextStats) => {
          if (current()) { if (calibrating) sampler?.observe(observation); else { metrics.current.observe(observation); setStats(nextStats); } }
        }, message => { if (current()) { stop('Vision stopped; unavailable frames were not counted.'); setError(message); } });
        controller.signal.throwIfAborted();
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } } });
        if (controller.signal.aborted) { stream.getTracks().forEach(t => t.stop()); return; }
        stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => { if (!controller.signal.aborted) stop('Camera disconnected. Measurement stopped.'); }));
        camera.current!.srcObject = stream; await camera.current!.play();
        controller.signal.throwIfAborted();
        check = setInterval(async () => {
          if (checking || controller.signal.aborted) return; checking = true;
          try { await assertIsolated(); } catch (e: any) { if (!controller.signal.aborted) { if (!calibrating) runMetadata.current?.warnings.push('Another player tab was detected; isolation was interrupted.'); stop('Stopped to keep this benchmark isolated.'); setError(e.message); } } finally { checking = false; }
        }, 2500);
      }
      if (calibrating) {
        const startedAt=performance.now(); sampler=new GazeCalibration(startedAt);
        setMode('calibration'); setBusy(false); setCalibrationSeconds(3);
        setStatus('Look at the centre dot. Stay still with one face visible.');
        const sample=()=>{
          if (controller.signal.aborted) return;
          if (camera.current) void engine?.frame(camera.current, calibrationRef.current);
          raf=requestAnimationFrame(sample);
        };
        sample();
        ui=setInterval(()=>{
          if (!current()) return;
          const remaining=3000-(performance.now()-startedAt);
          setCalibrationSeconds(Math.max(0,Math.ceil(remaining/1000)));
          if (remaining<=0) {
            try { const result=sampler!.finish(); calibrationRef.current=result;setCalibration(result);setCalibrationMethod('guided-3s');stop('Calibration complete. Start a camera test when ready. Recalibrate if you move the camera.'); }
            catch(e:any) { stop('Calibration unchanged.');setError(e.message); }
          }
        },100);
        return;
      }
      runMetadata.current = { mode: simulation ? 'simulation' : 'camera', delegate, calibration: {...calibration}, calibration_method:calibrationMethod, started_at: new Date().toISOString(), warnings: [] };
      metrics.current.reset(); sequence.current = 1; play.current = 'local-play-1'; setLabel('Test creative 1');
      metrics.current.boundary(play.current, !media, performance.now()); setPlaying(!media);
      setMode(simulation ? 'simulation' : 'camera'); setBusy(false);
      setStatus(simulation ? 'Simulation · synthetic observations, not camera measurements.' : 'Camera test running locally. No frames or results are uploaded.');
      const began = performance.now(); let lastSynthetic = 0;
      const tick = () => {
        if (controller.signal.aborted) return;
        const now = performance.now();
        if (simulation && now - lastSynthetic >= 125) {
          const seconds = (now - began) / 1000, present = seconds % 16 < 12; lastSynthetic = now;
          metrics.current.observe({ at: now, bodies: { ok: true, boxes: present ? [[.3,.15,.65,.95]] : [], saturated: false }, faces: { ok: true, saturated: false, faces: present ? [{ box: [.4,.18,.55,.38], looking: seconds % 8 < 5, smiling: seconds % 8 > 2 && seconds % 8 < 4 }] : [] } });
        } else if (!simulation && camera.current) void engine?.frame(camera.current, calibrationRef.current);
        raf = requestAnimationFrame(tick);
      };
      tick(); ui = setInterval(() => { const now = performance.now(); setSnapshot(metrics.current.snapshot(now)); setTracks(metrics.current.liveTracks(now)); setFaceDetails(metrics.current.liveFaces(now)); }, 125);
      if (media && creative.current) void creative.current.play().catch(() => { if(current()) setStatus('Press play on the test video to begin timing.'); });
    } catch (e: any) { const active = current(); end(); if (active) { if (e.name !== 'AbortError') { setError(e.message || 'Could not start the evaluation'); setStatus('No measurements are running.'); } setBusy(false); setMode('idle'); } }
  };
  const download = () => {
    const data = { schema: 'gridcast-attention-evaluation/1', evaluation_only: true, ...runMetadata.current, profile: EVALUATION_PROFILE, models: { face: 'face_landmarker/float16/1', person: 'efficientdet_lite0/int8/1', face_delegate: runMetadata.current?.mode === 'camera' ? runMetadata.current.delegate : null, person_delegate: runMetadata.current?.mode === 'camera' ? 'CPU' : null }, captured_at: new Date().toISOString(), performance: stats, results: metrics.current.snapshot(performance.now()) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'gridcast-attention-evaluation.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const summary = snapshot?.current || snapshot?.completed.at(-1), live = mode === 'idle' || mode === 'calibration' ? undefined : snapshot?.live;
  const card = (title: string, value: string, description: string) => <div className="rounded-xl border bg-white p-4"><dt className="text-sm text-slate-500">{title}</dt><dd className="mt-1 text-3xl font-semibold tabular-nums">{value}</dd><p className="mt-2 text-xs text-slate-500">{description}</p></div>;
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-6xl space-y-6">
    {mode === 'calibration' && <div role="dialog" aria-modal="true" aria-label="Automatic gaze calibration" className="fixed inset-0 z-50 bg-slate-950/95 text-white">
      <div className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400 ring-8 ring-amber-400/20"/>
      <div className="absolute left-0 top-[58%] w-full space-y-3 px-5 text-center"><h2 className="text-xl font-semibold">Look at the centre dot</h2><p>Stay at your normal viewing position with one face visible.</p><p className="text-3xl tabular-nums">{calibrationSeconds}</p><button className="rounded border border-slate-500 px-4 py-2" onClick={()=>stop('Calibration cancelled. Previous offsets kept.')}>Cancel calibration</button></div>
    </div>}
    <header className="flex flex-wrap items-start justify-between gap-4"><div><BrandLogo compact className="mb-4"/><h1 className="text-3xl font-semibold tracking-tight">Attention lab</h1><p className="mt-2 max-w-2xl text-sm text-slate-600">Test presence, looking and visit duration on this computer. Evaluation results stay in this tab and do not affect campaigns, delivery or billing.</p></div><span className="rounded-full border bg-white px-3 py-1 text-xs">{online ? 'Online' : 'Offline'} · {mode === 'simulation' ? 'Simulation' : 'Local evaluation'}</span></header>
    <section className="rounded-xl border bg-white p-5"><div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Face backend<select aria-label="Face backend" value={delegate} disabled={mode !== 'idle' || busy} onChange={e => setDelegate(e.target.value as 'CPU'|'GPU')} className="ml-2 rounded border p-2"><option>CPU</option><option>GPU</option></select></label>
      <button className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40" disabled={busy || mode !== 'idle'} onClick={async()=>{ const generation=++run.current; setBusy(true); setError(''); try { await prepare(generation); } catch(e:any) { if(generation===run.current && e.name!=='AbortError')setError(e.message); } finally { if(generation===run.current)setBusy(false); } }}>Prepare offline files</button>
      <button className="rounded-lg bg-[#A16207] px-4 py-2 text-sm text-white disabled:opacity-40" disabled={busy || mode !== 'idle'} onClick={()=>void begin(false)}>Start camera test</button>
      <button className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40" disabled={busy || mode !== 'idle'} onClick={()=>void begin(false,true)}>Auto-calibrate (3 s)</button>
      <button className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40" disabled={busy || mode !== 'idle'} onClick={()=>void begin(true)}>Try simulation</button>
      <button className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40" disabled={!busy && mode === 'idle'} onClick={()=>stop()}>Stop</button>
      <button className="ml-auto rounded-lg border px-4 py-2 text-sm disabled:opacity-40" disabled={!summary || busy || mode==='calibration'} onClick={download}>Download aggregate results</button>
    </div><p className="mt-4 text-sm" role="status">{status}</p>{error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
      <p className="mt-2 text-xs text-slate-500">{ready ? `Verified cache · ${number((filesBytes || 0)/1e6)} MB including both WASM variants. Test an offline reload separately.` : 'Initial preparation downloads models and their runtime. Starting asks for camera access; audio is never captured.'}</p>
    </section>
    <div className="grid gap-5 lg:grid-cols-2"><section className="overflow-hidden rounded-xl border bg-slate-950"><div className="flex items-center justify-between p-4 text-sm text-white"><h2>Local camera preview</h2><span>{mode === 'simulation' ? 'Synthetic inputs' : 'Never uploaded'}</span></div><div className="relative w-full overflow-hidden" style={{ aspectRatio: cameraRatio }} data-testid="camera-preview">
      <video ref={camera} autoPlay muted playsInline style={{ transform: 'scaleX(-1)' }} className="absolute inset-0 h-full w-full object-contain" onLoadedMetadata={()=>{const v=camera.current;if(v?.videoWidth&&v.videoHeight)setCameraRatio(v.videoWidth/v.videoHeight);}} onResize={()=>{const v=camera.current;if(v?.videoWidth&&v.videoHeight)setCameraRatio(v.videoWidth/v.videoHeight);}}/>
      {mode === 'simulation' && <span className="absolute left-3 top-3 rounded bg-slate-900/90 px-2 py-1 text-xs text-slate-300">Synthetic scene</span>}
      {showOverlay && mode !== 'idle' && <div className="pointer-events-none absolute inset-0" aria-label="Local tracking overlay">
        {tracks.map(track => {
          const color = track.uncertain || track.looking === null ? '#fbbf24' : track.looking ? '#34d399' : '#60a5fa';
          const state = track.uncertain ? 'Uncertain match' : track.looking === null ? 'Looking unknown' : track.looking ? 'Looking' : 'Not looking';
          return <div key={track.key} data-testid="tracking-box" className="absolute border-2" style={{left:`${(1-track.box[2])*100}%`,top:`${track.box[1]*100}%`,width:`${(track.box[2]-track.box[0])*100}%`,height:`${(track.box[3]-track.box[1])*100}%`,borderColor:color,borderStyle:track.uncertain?'dashed':'solid'}}>
            <span className="absolute left-0 top-0 max-w-full rounded-br bg-slate-950/90 px-1.5 py-1 text-[11px] font-medium leading-tight" style={{color}}>#{track.key} · {state}</span>
          </div>;
        })}
      </div>}
      {showFaces && mode !== 'idle' && <div className="pointer-events-none absolute inset-0" aria-label="Local face overlay">{faceDetails.map((face,index)=>{
        const color=face.looking===null?'#fbbf24':face.looking?'#34d399':'#60a5fa';
        const description=face.reason==='too_small'?'Face too small':face.reason==='unmatched'?'No confident body match':face.reason==='unclear'?'Face direction unclear':face.looking?'Looking':'Not looking';
        return <div key={index} data-testid="face-box" className="absolute rounded border-2" style={{left:`${(1-face.box[2])*100}%`,top:`${face.box[1]*100}%`,width:`${(face.box[2]-face.box[0])*100}%`,height:`${(face.box[3]-face.box[1])*100}%`,borderColor:color,borderStyle:face.reason?'dashed':'solid'}}>
          <span className="absolute left-0 top-full mt-1 rounded bg-slate-950/90 px-1.5 py-1 text-[10px] font-medium leading-tight" style={{color,width:140,maxWidth:'40vw'}}>Face{face.track_key===null?'':` #${face.track_key}`} · {description}</span>
        </div>;
      })}</div>}
    </div>
    <div className="space-y-3 p-4 text-xs text-slate-300">
      <label className="flex items-center gap-2"><input type="checkbox" checked={showOverlay} onChange={e=>setShowOverlay(e.target.checked)}/>Show tracking boxes</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={showFaces} onChange={e=>setShowFaces(e.target.checked)}/>Show face details</label>
      <p>Green: looking · Blue: not looking · Amber: unknown or uncertain</p>
      {mode !== 'idle' && !tracks.length && <p>{snapshot?.live.body_status === 'ok' ? 'No people detected in the current frame.' : 'Waiting for fresh person observations…'}</p>}
      {mode !== 'idle' && tracks.length > 0 && <ul aria-label="Live track details" className="grid gap-2 sm:grid-cols-2">{tracks.map(track=><li key={track.key} className="rounded border border-slate-700 bg-slate-900 p-2"><span className="font-semibold text-white">Track #{track.key}</span> · {track.uncertain ? 'Association uncertain' : track.looking === null ? 'Looking unknown' : track.looking ? 'Looking toward screen' : 'Not looking toward screen'}<br/>{track.smiling === null ? 'Smile unknown' : track.smiling ? 'Visible smile' : 'No visible smile'} · This ad: {number(track.dwell_s)} s present / {number(track.looking_s)} s looking</li>)}</ul>}
      <p className="text-slate-400">IDs are temporary for this test, not recognised identities. Boxes and per-person details stay in this preview and are excluded from downloads.</p>
    </div><p className="px-4 pb-4 text-xs text-slate-400">Face direction is an estimate, not precise eye tracking. An unresolvable face means unknown attention.</p></section>
    <section className="rounded-xl border bg-white p-4"><div className="flex items-center justify-between"><h2 className="font-medium">{label}</h2><span className="text-xs text-slate-500">{playing ? 'Timing active' : 'Timing paused'}</span></div>
      {media ? <video ref={creative} src={media} controls muted playsInline className="my-4 aspect-video w-full bg-black" onPlaying={()=>mediaState(true)} onPause={()=>mediaState(false)} onWaiting={()=>mediaState(false)} onEnded={()=>mediaState(false)} onError={()=>{mediaState(false);setError('The local test video could not play.');}}/> : <div className="my-4 grid aspect-video place-items-center rounded-lg bg-[#A16207] text-white"><div className="text-center"><p className="text-xs uppercase tracking-widest">Gridcast evaluation</p><p className="mt-3 text-3xl font-semibold">{label}</p></div></div>}
      <div className="flex flex-wrap gap-3"><button disabled={mode==='idle'} className="rounded border px-3 py-2 text-sm disabled:opacity-40" onClick={nextPlay}>Next test ad</button><button disabled={mode==='idle'||!!media} className="rounded border px-3 py-2 text-sm disabled:opacity-40" onClick={()=>mediaState(!playing)}>{playing?'Pause timing':'Resume timing'}</button></div>
      <label className="mt-4 block text-sm">Optional local test video<input aria-label="Local test video" type="file" accept="video/*" disabled={mode !== 'idle'||busy} className="mt-2 block w-full text-xs" onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(mediaURL.current)URL.revokeObjectURL(mediaURL.current);const url=URL.createObjectURL(file);mediaURL.current=url;setMedia(url);}}/></label>
      {media && <button disabled={mode!=='idle'||busy} className="mt-2 text-xs underline" onClick={()=>{if(mediaURL.current)URL.revokeObjectURL(mediaURL.current);mediaURL.current=null;setMedia(null);}}>Use test card instead</button>}
      <p className="mt-3 text-xs text-slate-500">Local video is not uploaded. Pausing or buffering does not earn attention time. Test-ad changes split measurements immediately.</p>
    </section></div>
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{card('People now',number(live?.people,0),'Body observations; — means unavailable.')}{card('Faces assessable',number(live?.face_assessable,0),'People with usable face-direction evidence.')}{card('Looking now',number(live?.looking,0),'Estimated looking toward the screen.')}{card('Smiling now',number(live?.smiling,0),'Visible expression, not happiness or ad preference.')}</dl>
    <section className="rounded-xl border bg-white p-5"><h2 className="font-medium">Current / last test ad</h2><dl className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">{[['Observed dwell',`${number(summary?.dwell_person_s)} person-s`],['Attention time',`${number(summary?.attention_person_s)} person-s`],['Longest look',`${number(summary?.longest_look_s)} s`],['Estimated impressions',number(summary?.estimated_impressions,0)],['Attentive impressions',number(summary?.attentive_impressions,0)],['Visible-smile rate',summary?.visible_smile_rate==null?'—':`${number(summary.visible_smile_rate*100)}%`]].map(([name,value])=><div key={name}><dt className="text-xs text-slate-500">{name}</dt><dd className="mt-1 font-semibold tabular-nums">{value}</dd></div>)}</dl>
      <p className="mt-4 text-xs text-slate-500">Impression: temporary visit observed for at least 1 second of this ad. Attentive impression: at least 2 seconds of estimated looking. These are evaluation definitions, not unique people or certified delivery. Unfinished visits are marked as censored in the export.</p>
      <p className="mt-3 text-sm">Measured attention: {number(summary?.attention_observed_s)} s · Unknown: {number(summary?.attention_unknown_s)} s · Playback: {number(summary?.playing_s)} s</p>
      {(live?.body_saturated || live?.face_saturated) && <p className="mt-2 text-sm text-amber-800" role="status">Detector limit reached. Counts and coverage may be incomplete.</p>}
    </section>
    <details className="rounded-xl border bg-white p-5"><summary className="cursor-pointer text-sm font-medium">Calibration and performance</summary><p className="my-3 text-xs text-slate-500">Use Auto-calibrate while stopped, then look at the centre dot for 3 seconds. Offsets apply to this tab; recalibrate if the camera or your viewing position changes. Manual offsets below are optional. Calibration method: {calibrationMethod}.</p><div className="flex gap-5">{(['yaw','pitch'] as const).map(key=><label key={key} className="text-sm">{key === 'yaw' ? 'Horizontal offset' : 'Vertical offset'}<input aria-label={`${key} offset`} type="number" min={-45} max={45} value={calibration[key]} disabled={mode!=='idle'||busy} className="ml-2 w-20 rounded border p-1" onChange={e=>{setCalibration({...calibration,[key]:Math.max(-45,Math.min(45,Number(e.target.value)||0))});setCalibrationMethod('manual');}}/></label>)}</div><p className="mt-4 text-sm">{stats ? `${stats.delegate} face / CPU person · ${number(stats.latencyMs,0)} ms per job · ${number(stats.faceFps)} face fps / ${number(stats.personFps)} person fps over the last 5 s · ${stats.dropped} excess frames dropped` : 'No runtime measurements yet.'}</p><p className="mt-2 text-xs text-slate-500">Targets: 8 face / 3 person fps; achieved rates depend on this computer. Body freshness 750 ms; face freshness 500 ms. Weak evidence stays unknown. Only the most recent 20 completed test ads are retained in memory.</p></details>
  </div></main>;
}
