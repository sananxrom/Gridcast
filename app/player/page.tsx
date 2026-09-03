'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Monitor } from 'lucide-react';

declare global { interface Window { YT: any; onYouTubeIframeAPIReady: () => void; cocoSsd: any; tf: any } }

type Item = { campaign_id: string; creative_id: string; creative_name: string; advertiser: string; youtube_id: string; duration_s: number };

export default function Player() {
  const [screen, setScreen] = useState<any>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [avg, setAvg] = useState<string>('—');
  const [plays, setPlays] = useState(0);
  const [state, setState] = useState('starting');
  const [idle, setIdle] = useState(false);
  const [now, setNow] = useState<Item | null>(null);

  const list = useRef<Item[]>([]);
  const idx = useRef(0);
  const samples = useRef<number[]>([]);
  const yt = useRef<any>(null);
  const ytReady = useRef(false);
  const timer = useRef<any>(null);
  const camOK = useRef(false);
  const playing = useRef(false);
  const model = useRef<any>(null);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scr = useRef<any>(null);
  const cfg = useRef<Record<string, any>>({});
  const lastFrame = useRef(0);

  const loadList = useCallback(async (id: string) => {
    const d = await api(`/playlist/${id}`, undefined, { quiet: true });
    list.current = d.items; scr.current = d.screen; cfg.current = d.config || {}; setScreen(d.screen);
  }, []);

  const report = useCallback(async (item: Item) => {
    const valid = samples.current.filter(x => x !== null);
    const a = valid.length ? valid.reduce((x, y) => x + y, 0) / valid.length : null;
    setPlays(p => p + 1); setAvg(a === null ? '—' : a.toFixed(1));
    const measured = camOK.current && valid.length > 0;
    // a failed camera must never read as an empty room
    if (!measured && cfg.current.camera_fail_mode === 'skip') return;
    try {
      await api('/play', { screen_id: scr.current.id, campaign_id: item.campaign_id, creative_id: item.creative_id,
        duration_ms: (item.duration_s || 10) * 1000, avg_persons: a, sample_count: valid.length, measured });
    } catch {}
  }, []);

  const playCurrent = useCallback(() => {
    if (!ytReady.current || !list.current.length) { setTimeout(playCurrent, 1500); return; }
    const item = list.current[idx.current % list.current.length];
    samples.current = []; playing.current = true; setNow(item);
    yt.current.loadVideoById({ videoId: item.youtube_id, startSeconds: 0 });
    yt.current.playVideo(); setState('on air');
    api('/nowplaying', { screen_id: scr.current.id, campaign_id: item.campaign_id, creative_id: item.creative_id, duration_s: item.duration_s || 10 }, { quiet: true }).catch(() => {});
    clearTimeout(timer.current);
    timer.current = setTimeout(next, (item.duration_s || cfg.current.slot_duration_s || 10) * 1000);
    // eslint-disable-next-line
  }, []);

  const next = useCallback(async () => {
    clearTimeout(timer.current);
    // a restart never truncates a play — it waits for the loop to come around
    if (cfg.current.daily_restart && cfg.current.restart_times) {
      const [h, m] = String(cfg.current.restart_times).split(':').map(Number);
      const d = new Date(); const due = h * 60 + m;
      const mins = d.getHours() * 60 + d.getMinutes();
      if (mins >= due && mins < due + 5) { location.reload(); return; }
    }
    playing.current = false;
    const item = list.current[idx.current % list.current.length];
    if (item) await report(item);
    idx.current++; playCurrent();
  }, [report, playCurrent]);

  const cvLoop = useCallback(async () => {
    const v = video.current, c = canvas.current;
    if (!v || !c || !model.current) return;
    const k = cfg.current;
    const zone = k.detection_zone || { x: 0, y: 0, w: 100, h: 100 };
    const minScore = Number(k.confidence_min ?? 0.45);
    const minPx = Number(k.min_box_px ?? 24);
    const ceiling = Number(k.count_ceiling ?? 50);

    try {
      const all = await model.current.detect(v);
      // a detection counts when it is a person, confident enough, big enough to
      // be near the screen, and standing inside the counted region
      const inZone = (b: number[]) => {
        const cx = ((b[0] + b[2] / 2) / v.videoWidth) * 100;
        const cy = ((b[1] + b[3] / 2) / v.videoHeight) * 100;
        return cx >= zone.x && cx <= zone.x + zone.w && cy >= zone.y && cy <= zone.y + zone.h;
      };
      const preds = all.filter((p: any) => p.class === 'person' && p.score >= minScore
        && p.bbox[3] >= minPx && inZone(p.bbox));
      const n = Math.min(preds.length, ceiling);
      setCount(n);
      if (!k.measure_during_play_only || playing.current) samples.current.push(n);

      const ctx = c.getContext('2d')!;
      const sx = c.width / v.videoWidth, sy = c.height / v.videoHeight;
      ctx.clearRect(0, 0, c.width, c.height);
      // the counted region, so the installer can see what the numbers mean
      ctx.strokeStyle = 'rgba(15,118,110,0.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.strokeRect((100 - zone.x - zone.w) / 100 * c.width, zone.y / 100 * c.height,
        (zone.w / 100) * c.width, (zone.h / 100) * c.height);
      ctx.setLineDash([]);
      ctx.strokeStyle = '#D97706'; ctx.lineWidth = 2;
      preds.forEach((p: any) => { const [x, y, w, h] = p.bbox; ctx.strokeRect(c.width - (x + w) * sx, y * sy, w * sx, h * sy); });

      // setup preview — a still, only while someone is aiming the camera
      if (k.preview_frames && Date.now() - lastFrame.current > 5000) {
        lastFrame.current = Date.now();
        const f = document.createElement('canvas');
        f.width = 480; f.height = Math.round(480 * (v.videoHeight / v.videoWidth));
        const fx = f.getContext('2d')!;
        fx.translate(f.width, 0); fx.scale(-1, 1);
        fx.drawImage(v, 0, 0, f.width, f.height);
        api(`/screen/${scr.current.id}/frame`, { data: f.toDataURL('image/jpeg', 0.5) }, { quiet: true }).catch(() => {});
      }
    } catch {}
    setTimeout(cvLoop, Math.max(500, (Number(cfg.current.sample_interval_s) || 2) * 1000));
  }, []);

  const initCam = useCallback(async () => {
    const v = video.current, c = canvas.current;
    if (!v || !c) return;
    if (!scr.current?.has_camera) { setState('no camera'); return; }
    try {
      const [rw, rh] = String(cfg.current.inference_res || '640x480').split('x').map(Number);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: rw || 640, height: rh || 480 }, audio: false });
      v.srcObject = stream; camOK.current = true;
      await new Promise(r => { v.onloadedmetadata = () => r(null); });
      c.width = v.clientWidth; c.height = v.clientWidth * (v.videoHeight / v.videoWidth);
      v.style.height = c.height + 'px';
      setState('loading model');
      model.current = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
      setState('on air'); cvLoop();
    } catch { camOK.current = false; setState('camera off'); setCount(null); }
  }, [cvLoop]);

  const start = useCallback(async (id: string) => {
    await loadList(id);
    window.onYouTubeIframeAPIReady = () => {
      yt.current = new window.YT.Player('ytframe', {
        height: '100%', width: '100%', videoId: list.current[0]?.youtube_id || 'M7lc1UVf-VE',
        playerVars: { autoplay: 1, controls: 0, modestbranding: 1, rel: 0, disablekb: 1, fs: 0, iv_load_policy: 3, playsinline: 1, mute: 1 },
        events: { onReady: (e: any) => { ytReady.current = true; e.target.mute(); playCurrent(); },
          onStateChange: (e: any) => { if (e.data === window.YT.PlayerState.ENDED) next(); } },
      });
    };
    const t = document.createElement('script'); t.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(t);
    initCam();
    // pull on the configured interval, offset randomly so a fleet never
    // arrives on the same second
    const every = Math.max(30, (Number(cfg.current.sync_interval_min) || 5) * 60) * 1000;
    const jitter = cfg.current.randomise_sync === false ? 0 : Math.random() * every;
    setTimeout(() => { loadList(id); setInterval(() => loadList(id), every); }, jitter);
  }, [loadList, playCurrent, next, initCam]);

  useEffect(() => {
    const saved = localStorage.getItem('gc_screen');
    if (saved) api(`/playlist/${saved}`).then(d => { scr.current = d.screen; setScreen(d.screen); start(d.screen.id); }).catch(() => {});
    let t: any;
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 6000); };
    ['mousemove', 'touchstart', 'keydown'].forEach(e => window.addEventListener(e, wake));
    wake();
    return () => ['mousemove', 'touchstart', 'keydown'].forEach(e => window.removeEventListener(e, wake));
    // eslint-disable-next-line
  }, []);

  const pair = async () => {
    setErr('');
    if (code.trim().length < 4) return setErr('Enter the 6-character code.');
    try {
      const d = await api('/pair', { code: code.trim().toUpperCase() });
      localStorage.setItem('gc_screen', d.screen.id);
      scr.current = d.screen; setScreen(d.screen); start(d.screen.id);
    } catch (e: any) { setErr(e.message); }
  };

  if (!screen) {
    return (
      <div className="grid min-h-screen place-items-center bg-[hsl(215_28%_10%)] p-4">
        <div className="w-full max-w-[400px] rounded-xl bg-card p-8 shadow-2xl">
          <div className="mb-5 flex items-center gap-2.5">
            <div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground"><Monitor className="size-4" strokeWidth={2} /></div>
            <span className="text-[15px] font-semibold tracking-tight">Gridcast Player</span>
          </div>
          <h1 className="text-[19px] font-semibold tracking-tight">Enter screen code</h1>
          <p className="mb-4 mt-0.5 text-[13px] text-muted-foreground">Find it on the screen&apos;s page in your dashboard.</p>
          <Input value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && pair()}
            maxLength={6} placeholder="A1B2C3" autoComplete="off"
            className="h-14 text-center font-mono text-[26px] uppercase tracking-[0.3em]" />
          <p className="mt-2 min-h-4 text-[12.5px] text-destructive">{err}</p>
          <Button className="mt-2 w-full" onClick={pair}>Pair &amp; start playing</Button>
          <p className="mt-4 text-[12px] text-muted-foreground">Camera is used only to count how many people are present. No video is stored or transmitted.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0" style={{ background: cfg.current.screen_color || '#000' }}>
      <Script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js" strategy="afterInteractive" />
      <Script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js" strategy="afterInteractive" />
      <div id="ytframe" className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0 z-[2]" />

      <div className={cn('fixed left-3.5 top-3.5 z-[5] rounded-lg border border-white/10 bg-black/80 px-3 py-1.5 font-mono text-[11.5px] text-white/70 backdrop-blur transition-opacity', idle && 'opacity-0')}>
        <b className="text-white">{cfg.current.device_label || screen.name}</b>
        {now && <> &nbsp;·&nbsp; {now.advertiser} — {now.creative_name} &nbsp;·&nbsp; slot {(idx.current % Math.max(1, list.current.length)) + 1}/{list.current.length}</>}
      </div>

      <video ref={video} autoPlay muted playsInline
        className={cn('fixed bottom-3.5 right-3.5 z-[5] w-[170px] scale-x-[-1] rounded-lg border border-white/15 bg-neutral-900 transition-opacity', idle && 'opacity-0')} />
      <canvas ref={canvas} className={cn('pointer-events-none fixed bottom-3.5 right-3.5 z-[6] w-[170px] transition-opacity', idle && 'opacity-0')} />

      <div className={cn('fixed bottom-3.5 left-3.5 z-[5] flex gap-2 font-mono transition-opacity', idle && 'opacity-0')}>
        {[['People now', count === null ? '—' : String(count), true], ['Avg this play', avg, false], ['Plays today', String(plays), false], ['Status', state, false],
          ...(cfg.current.diagnostics_overlay ? [['Sample', `${cfg.current.sample_interval_s ?? 2}s`, false] as any,
            ['Zone', `${cfg.current.detection_zone?.w ?? 100}×${cfg.current.detection_zone?.h ?? 100}%`, false] as any,
            ['Model', String(cfg.current.model ?? '—'), false] as any] : [])].map(([k, v, hot]) => (
          <div key={k as string} className={cn('rounded-lg border border-white/12 bg-black/80 px-3 py-2 backdrop-blur', hot && 'border-onair/50')}>
            <div className="text-[9px] font-semibold uppercase tracking-[0.13em] text-white/45">{k}</div>
            <div className={cn('mt-0.5 text-[17px] font-semibold text-white/90', hot && 'text-[24px] text-onair')}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
