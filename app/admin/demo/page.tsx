'use client';
import React, { useEffect, useRef, useState } from 'react';
import { api, session } from '@/lib/client';
import { seedDemo, type DemoManifest } from '@/lib/demo-network';
import videos from '@/lib/demo-videos.json';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';

type Check = { duration_s: number; checked_at: string };
const indiaDate = (days = 0) => new Date(Date.now() + (330 + days * 1440) * 60000).toISOString().slice(0, 10);

export default function DemoSetup() {
  const [allowed, setAllowed] = useState(false);
  const [index, setIndex] = useState<number | null>(null);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [status, setStatus] = useState('Check the videos before creating the demo.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const mount = useRef<HTMLDivElement>(null);
  const importing = useRef(false);
  useEffect(() => {
    if (session.get()?.role !== 'platform_admin') { location.href = '/'; return; }
    setAllowed(true); setStart(indiaDate()); setEnd(indiaDate(30));
  }, []);
  useEffect(() => {
    if (index === null) return;
    const video = videos[index];
    let disposed = false, player: any, played = false, ended = false;
    setError(''); setStatus(`Checking ${video.title}`);
    const fail = (message: string) => { if (!disposed) { setError(message); setIndex(null); } };
    const deadline = window.setTimeout(() => fail('Playback timed out. Check the connection and retry the videos.'), 90000);
    const poll = window.setInterval(() => {
      if (!window.YT?.Player || disposed || player) return;
      window.clearInterval(poll);
      const host = document.createElement('div'); mount.current?.replaceChildren(host);
      player = new window.YT.Player(host, {
        width: '100%', height: '100%', videoId: video.youtube_id,
        playerVars: { autoplay: 1, mute: 1, controls: 1, playsinline: 1, rel: 0, origin: location.origin },
        events: {
          onReady: (event: any) => { if (!disposed) { event.target.mute(); event.target.playVideo(); } },
          onError: (event: any) => fail(`YouTube could not play ${video.title} (error ${event.data}).`),
          onStateChange: (event: any) => {
            if (disposed || ended || event.target.getVideoData?.().video_id !== video.youtube_id) return;
            if (event.data === 1) played = true;
            if (event.data !== 0 || !played) return;
            const duration = Number(event.target.getDuration());
            if (!Number.isFinite(duration) || duration <= 0 || Math.abs(duration - video.duration_s) > 1) {
              fail(`The length of ${video.title} differs from its saved metadata. Review it before importing.`); return;
            }
            ended = true;
            setChecks(old => ({ ...old, [video.slot]: { duration_s: duration, checked_at: new Date().toISOString() } }));
            if (index + 1 < videos.length) setIndex(index + 1);
            else { setIndex(null); setStatus('All nine videos completed embedded playback. Ready to create the demo.'); }
          },
        },
      });
    }, 200);
    if (!window.YT?.Player && !document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => fail('YouTube could not load. Check the connection or browser blocking.'); document.head.appendChild(script);
    }
    return () => { disposed = true; window.clearInterval(poll); window.clearTimeout(deadline); player?.destroy(); };
  }, [index]);
  const ready = videos.every(v => checks[v.slot]);
  async function createDemo() {
    if (!ready || importing.current) return;
    importing.current = true; setBusy(true); setError(''); setResult(null);
    try {
      const manifest: DemoManifest = { starts_at: start, ends_at: end, media: Object.fromEntries(videos.map(v => [v.slot, {
        youtube_id: v.youtube_id, duration_s: v.duration_s, approved_for_demo: true,
        verification: { reference: `${v.reference}; public metadata ${v.metadata_checked_at}; embedded playback completed (${checks[v.slot].duration_s}s)`, verified_at: checks[v.slot].checked_at },
      }])) };
      const report = await seedDemo((method, path, body) => api(path, method === 'POST' ? body : undefined), manifest);
      setResult(report); setStatus('Demo setup complete. Existing records were reused without changing them.');
    } catch (e) { setError((e as Error).message + ' Earlier successful additions are retained. Retry safely; existing pending creatives need normal approval first.'); }
    finally { importing.current = false; setBusy(false); }
  }
  if (!allowed) return <main className="p-8">Checking admin access…</main>;
  return <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10">
    <a className="text-sm text-primary" href="/admin#campaigns">← Campaigns</a>
    <div><h1 className="text-2xl font-semibold">Set up the brand demo</h1><p className="mt-2 text-sm text-muted-foreground">Your nine selected videos, seven advertisers and seven network campaigns. Coke and Lay’s rotate two creatives each.</p></div>
    <Card className="space-y-3 p-5">
      <h2 className="font-semibold">1. Check playback</h2>
      <p className="text-sm text-muted-foreground">Each video plays once, muted. This preview records no campaign delivery, spend or camera counts. YouTube needs an internet connection.</p>
      <div ref={mount} className={index === null ? 'hidden' : 'aspect-video overflow-hidden rounded-lg bg-black'} />
      <p role="status" className="text-sm">{status}</p>
      <div className="flex gap-3"><Button disabled={index !== null || busy} onClick={() => { setChecks({}); setResult(null); setIndex(0); }}>Check all nine videos</Button>{index !== null && <Button variant="outline" onClick={() => { setIndex(null); setStatus('Playback check stopped.'); }}>Stop check</Button>}</div>
      <ul className="divide-y">{videos.map(v => <li key={v.slot} className="flex items-start justify-between gap-4 py-2 text-sm"><a className="text-primary" href={v.reference} target="_blank" rel="noreferrer">{v.title}</a><span className="shrink-0">{v.duration_s}s · {checks[v.slot] ? 'Playback passed' : 'Not checked'}</span></li>)}</ul>
      <p className="text-xs text-muted-foreground">Lengths come from YouTube metadata; the check also compares the embedded player’s reported length. Creative records retain YouTube’s declared-source label.</p>
    </Card>
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold">2. Create the demo</h2>
      <p className="text-sm">Adds three demo operators and twelve new demo screens across four organisations. Each new screen reserves room for seven network advertisers. Your existing screens, pairings, users and campaigns remain unchanged.</p>
      <p className="text-sm text-muted-foreground">Campaigns are active during the chosen dates and the demo screens’ 09:00–21:00 India window. Rates and budgets are illustrative demo values; this does not take payment. New screens need pairing before they can deliver ads.</p>
      <div className="flex gap-4"><Field label="Starts"><Input aria-label="Demo starts" type="date" value={start} disabled={busy} onChange={e => setStart(e.target.value)} /></Field><Field label="Ends"><Input aria-label="Demo ends" type="date" value={end} disabled={busy} onChange={e => setEnd(e.target.value)} /></Field></div>
      <Button disabled={!ready || busy || index !== null} onClick={createDemo}>{busy ? 'Creating demo…' : 'Create or resume demo'}</Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {result && <div className="space-y-2 text-sm"><h3 className="font-semibold">Demo ready</h3><p>Added this run: {result.created.orgs} operators, {result.created.screens} screens, {result.created.advertisers} advertisers, {result.created.creatives} creatives and {result.created.campaigns} campaigns.</p><p>Demo totals: {result.cohort.screens.length} screens, {result.cohort.advertisers.length} advertisers, {result.cohort.creatives.length} creatives and {result.cohort.campaigns.length} campaigns.</p><a className="text-primary" href="/admin#campaigns">Open campaigns →</a><details><summary>Setup evidence</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(result, null, 2)}</pre></details></div>}
    </Card>
  </main>;
}
