'use client';
import React, { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { inr, fmtDate } from '@/lib/utils';
import { PageHead, SectionHead } from '@/components/ui/app-shell';
import { DataTable } from '@/components/ui/table';
import { Stat, Progress } from '@/components/ui/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Field, Label } from '@/components/ui/input';
import { StatusBadge, Thumb, Empty, ScreenPhoto } from './bits';
import { Skeleton } from '@/components/ui/loader';

export function ScreenDetail({ id, onGo, onChanged }: { id: string; onGo: (g: string) => void; onChanged: () => void }) {
  const [d, setD] = useState<any>(null);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState<any>(null);

  const load = () => api(`/screen/${id}`).then(x => {
    setD(x);
    setF({ ...x.screen, tagStr: Object.entries(x.screen.tags || {}).map(([k, v]) => `${k}:${v}`).join(', '),
      excStr: (x.screen.exclusions?.categories || []).join(', ') });
  });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // live ticker
  useEffect(() => {
    const t = setInterval(() => { api(`/screen/${id}`, undefined, { quiet: true }).then(x => setD((prev: any) => prev ? { ...prev, nowPlaying: x.nowPlaying, status: x.status, stats: x.stats } : x)).catch(() => {}); }, 3000);
    return () => clearInterval(t);
  }, [id]);

  if (!d || !f) return (
    <div className="space-y-3">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-40 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0,1,2,3].map(i => <Skeleton key={i} className="h-24" />)}</div>
    </div>
  );
  const s = d.screen, st = d.status, n = d.nowPlaying;
  const preview = Math.round(Number(f.venue_base) * Number(f.size_factor) * Number(f.location_factor) * Number(f.exposure_factor));
  const perSlot = Math.round(preview / Math.max(1, Number(f.advertiser_slots) || 1));

  const save = async () => {
    const tags: Record<string, string> = {};
    String(f.tagStr).split(',').map(x => x.trim()).filter(Boolean).forEach(p => {
      const i = p.indexOf(':'); if (i > 0) tags[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    });
    const net = Number(f.network_slots) || 0;
    await api(`/screen/${id}`, {
      name: f.name, venue_name: f.venue_name, address: f.address, photo_url: f.photo_url || '',
      venue_base: Number(f.venue_base), size_factor: Number(f.size_factor),
      location_factor: Number(f.location_factor), exposure_factor: Number(f.exposure_factor),
      advertiser_slots: Number(f.advertiser_slots) || 10, loop_length_s: Number(f.loop_length_s),
      slot_duration_s: Number(f.slot_duration_s), operating_hours: Number(f.operating_hours),
      owner_share_pct: Number(f.owner_share_pct), network_slots: net, network_available: net > 0, tags,
    });
    await api(`/screen/${id}/exclusions`, { exclusions: { categories: String(f.excStr).split(',').map(x => x.trim()).filter(Boolean), advertisers: [] } });
    setEdit(false); await load(); onChanged();
  };

  return (
    <>
      <PageHead title={s.name}
        sub={<>{s.venue_name} · {s.address}</>}
        back={{ label: 'My screens', go: 'screens', onGo }}
        actions={<><StatusBadge st={st} /><Button variant="outline" size="sm" onClick={() => setEdit(!edit)}>Edit screen</Button></>} />

      {edit && (
        <Card className="mb-5 border-primary/40 p-5">
          <h3 className="mb-3 text-[14px] font-semibold">Edit screen</h3>
          <div className="mb-3 flex flex-wrap gap-3">
            <Field label="Name"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Venue"><Input value={f.venue_name} onChange={e => setF({ ...f, venue_name: e.target.value })} /></Field>
            <Field label="Address"><Input value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
            <Field label="Photo URL (a picture of the screen in place)" className="w-full basis-full"><Input value={f.photo_url || ''} placeholder="https://…" onChange={e => setF({ ...f, photo_url: e.target.value })} /></Field>
          </div>
          <Label className="mt-4">Rate factors — value = base × size × location × exposure</Label>
          <div className="mb-2 flex flex-wrap gap-3">
            {[['venue_base','Venue base ₹','1'],['size_factor','Size','0.1'],['location_factor','Location','0.1'],['exposure_factor','Exposure','0.05'],['advertiser_slots','Slots','1']].map(([k, lbl, step]) => (
              <Field key={k} label={lbl}><Input type="number" step={step} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></Field>
            ))}
          </div>
          <p className="mb-3 font-mono text-[12.5px] text-primary">→ {inr(preview)} / month · {inr(perSlot)} per slot per month</p>
          <Label className="mt-2">Loop &amp; share</Label>
          <div className="mb-3 flex flex-wrap gap-3">
            {[['loop_length_s','Loop (s)'],['slot_duration_s','Slot (s)'],['operating_hours','Hours/day'],['owner_share_pct','Owner share %'],['network_slots','Slots to network']].map(([k, lbl]) => (
              <Field key={k} label={lbl}><Input type="number" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></Field>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap gap-3">
            <Field label="Tags (key:value, comma separated)"><Input value={f.tagStr} onChange={e => setF({ ...f, tagStr: e.target.value })} /></Field>
            <Field label="Blocked categories"><Input value={f.excStr} onChange={e => setF({ ...f, excStr: e.target.value })} /></Field>
          </div>
          <div className="sticky bottom-0 -mx-5 -mb-5 mt-4 flex items-center gap-2 border-t border-border bg-card/95 px-5 py-3 backdrop-blur">
            <Button onClick={save}>Save screen</Button>
            <Button variant="outline" onClick={() => { setEdit(false); load(); }}>Cancel</Button>
          </div>
        </Card>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="overflow-hidden">
        <ScreenPhoto src={s.photo_url} venue={s.venue_type} className="aspect-video rounded-none border-0" />
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70">Pairing code</span>
          <span className="font-mono text-[15px] font-semibold tracking-[0.16em] text-primary">{s.code}</span>
        </div>
      </Card>
      <Card className="p-5">
        {n ? (
          <div className="flex flex-wrap items-start gap-5">
            <Thumb id={n.creative?.youtube_id} w={210} className="rounded-lg" />
            <div className="min-w-[220px] flex-1">
              <Badge variant="onair" blip>now playing</Badge>
              <div className="mt-2 text-[17px] font-semibold tracking-tight">{n.creative?.name ?? '—'}</div>
              <div className="text-[13px] text-muted-foreground">{n.advertiser} · {n.campaign?.name}</div>
              <div className="mt-3 max-w-[340px]">
                <Progress value={Math.min(100, (n.elapsed_s / (n.duration_s || 10)) * 100)} hot />
                <div className="mt-1 font-mono text-[11.5px] text-muted-foreground tnum">
                  {Math.min(n.duration_s, Math.round(n.elapsed_s))}s / {n.duration_s}s
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-[13px] text-muted-foreground">
            {st.state === 'live' ? 'Paired and responding — waiting for the next play.'
              : st.state === 'unpaired' ? <>Nothing paired yet. Enter code <span className="font-mono text-[15px] font-semibold tracking-widest text-primary">{s.code}</span> in the player.</>
              : `Last seen ${st.age_s > 3600 ? Math.round(st.age_s / 3600) + 'h' : Math.round(st.age_s / 60) + 'm'} ago.`}
          </div>
        )}
      </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Live campaigns" value={d.stats.liveCampaigns} hint={`of ${s.advertiser_slots} slots`} />
        <Stat label="Plays today" value={d.stats.playsToday} hint={`${d.stats.plays} all time`} />
        <Stat label="Avg people / play" value={d.stats.avg === null ? '—' : d.stats.avg.toFixed(1)} hint={`${d.stats.measured} measured`} />
        <Stat label="Price" value={inr(s.slot_price_month)} hint="per slot per month" />
      </div>

      <SectionHead hint={`· ${d.campaigns.length} total, ${d.campaigns.filter((c: any) => c.live).length} live`}>Campaigns on this screen</SectionHead>
      <DataTable
        cols={[
          { label: 'Campaign', render: (c: any) => <><button onClick={() => onGo('c/' + c.id)} className="text-left font-medium text-primary hover:underline">{c.name}</button><div className="text-[12px] text-muted-foreground">{c.advertiser}</div></> },
          { label: 'Creatives', render: (c: any) => <div className="flex gap-1.5">{c.creatives.map((cr: any) => <Thumb key={cr.id} id={cr.youtube_id} w={58} />)}</div> },
          { label: 'Dates', render: (c: any) => <span className="font-mono text-[12px] text-muted-foreground">{c.starts_at}<br />→ {c.ends_at}</span> },
          { label: 'Status', render: (c: any) => c.live ? <Badge variant="onair" blip>live</Badge> : <Badge variant="muted">{c.status}</Badge> },
          { label: 'Plays here', num: true, render: (c: any) => <b>{c.plays}</b> },
          { label: 'Avg people', num: true, render: (c: any) => c.avg === null ? <span className="text-muted-foreground">—</span> : <b>{c.avg.toFixed(1)}</b> },
          { label: 'Budget', num: true, render: (c: any) => { const p = c.committed_budget ? Math.round(c.accrued_spend / c.committed_budget * 100) : 0;
            return <div className="flex flex-col items-end gap-1"><span className="whitespace-nowrap">{inr(c.accrued_spend)} / {inr(c.committed_budget)}</span><Progress value={p} hot={p >= 80} className="w-20" /></div>; } },
        ]}
        rows={d.campaigns} rowId={(c: any) => c.id} exportName="screen-campaigns" empty="No campaigns booked on this screen yet" />

      <SectionHead>Recent plays</SectionHead>
      <DataTable
        cols={[
          { label: 'When', render: (p: any) => <span className="font-mono text-[12px] text-muted-foreground">{fmtDate(p.ended_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> },
          { label: 'Creative', render: (p: any) => p.creative ? <div className="flex items-center gap-3"><Thumb id={p.creative.youtube_id} w={52} />{p.creative.name}</div> : '—' },
          { label: 'Duration', num: true, render: (p: any) => `${Math.round(p.duration_ms / 1000)}s` },
          { label: 'People present', num: true, render: (p: any) => p.presence?.measured ? <b>{p.presence.avg_persons.toFixed(1)}</b> : <span className="text-muted-foreground">not measured</span> },
        ]}
        rows={d.recent} rowId={(p: any) => p.id} exportName="screen-plays" empty="No plays on this screen yet" />
    </>
  );
}
