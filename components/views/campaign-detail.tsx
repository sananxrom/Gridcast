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
import { Input, Select, Field, Label } from '@/components/ui/input';
import { Thumb, Empty } from './bits';

export function CampaignDetail({ id, boot, onGo, onChanged }: {
  id: string; boot: any; onGo: (g: string) => void; onChanged: () => void;
}) {
  const [d, setD] = useState<any>(null);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState('');

  const load = () => api(`/campaign/${id}`).then(x => { setD(x); setF({ ...x.campaign }); });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!d) return <Empty>Loading…</Empty>;
  const c = d.campaign;
  const pct = c.committed_budget ? Math.round((c.accrued_spend / c.committed_budget) * 100) : 0;
  const rate = c.rate_type === 'flat'
    ? `${inr(c.committed_budget)} flat`
    : `${inr(c.rate_value)} per play`;

  const save = async () => {
    setErr('');
    if (!f.screen_ids.length) return setErr('Pick at least one screen.');
    if (!f.creative_ids.length) return setErr('Pick at least one creative.');
    await api(`/campaign/${id}`, {
      name: f.name, starts_at: f.starts_at, ends_at: f.ends_at,
      committed_budget: Number(f.committed_budget) || 0, rate_type: f.rate_type,
      rate_value: f.rate_type === 'per_play' ? Number(f.rate_value) || 0 : 0,
      invoice_status: f.invoice_status, screen_ids: f.screen_ids, creative_ids: f.creative_ids,
    });
    setEdit(false); await load(); onChanged();
  };
  const toggleStatus = async () => {
    await api(`/campaign/${id}`, { status: c.status === 'active' ? 'paused' : 'active' });
    await load(); onChanged();
  };
  const tick = (arr: string[], v: string) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
  const mine = boot.creatives.filter((x: any) => x.advertiser_id === c.advertiser_id);

  return (
    <>
      <PageHead
        title={c.name}
        sub={<>{d.advertiser?.name} · {d.org?.name} · <span className="font-mono">{c.starts_at} → {c.ends_at}</span></>}
        back={{ label: 'Campaigns', go: 'campaigns', onGo }}
        actions={<>
          <Badge variant={c.status === 'active' ? 'ok' : 'muted'}>{c.status}</Badge>
          {c.campaign_type === 'network' && <Badge variant="default">network</Badge>}
          <Button variant="outline" size="sm" onClick={() => setEdit(!edit)}>Edit</Button>
          <Button variant="outline" size="sm" onClick={toggleStatus}>{c.status === 'active' ? 'Pause' : 'Resume'}</Button>
        </>}
      />

      {edit && f && (
        <Card className="mb-5 border-primary/40 p-5">
          <h3 className="mb-3 text-[14px] font-semibold">Edit campaign</h3>
          <div className="mb-3 flex flex-wrap gap-3">
            <Field label="Name"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Starts"><Input type="date" value={f.starts_at} onChange={e => setF({ ...f, starts_at: e.target.value })} /></Field>
            <Field label="Ends"><Input type="date" value={f.ends_at} onChange={e => setF({ ...f, ends_at: e.target.value })} /></Field>
          </div>
          <div className="mb-3 flex flex-wrap gap-3">
            <Field label="Rate type">
              <Select value={f.rate_type} onChange={e => setF({ ...f, rate_type: e.target.value })}>
                <option value="per_play">Per play</option><option value="flat">Flat fee</option>
              </Select>
            </Field>
            {f.rate_type === 'per_play' && (
              <Field label="Rate per play (₹)"><Input type="number" step="0.01" value={f.rate_value} onChange={e => setF({ ...f, rate_value: e.target.value })} /></Field>
            )}
            <Field label="Committed budget (₹)"><Input type="number" value={f.committed_budget} onChange={e => setF({ ...f, committed_budget: e.target.value })} /></Field>
            <Field label="Invoice status">
              <Select value={f.invoice_status} onChange={e => setF({ ...f, invoice_status: e.target.value })}>
                {['not_invoiced','invoiced','part_paid','paid','written_off'].map(v => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}
              </Select>
            </Field>
          </div>
          <Label>Screens</Label>
          <div className="mb-3 max-h-52 overflow-y-auto rounded-lg border border-border/60">
            {boot.screens.map((s: any) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-2.5 border-b border-border/50 px-3 py-2 text-[13px] last:border-0 hover:bg-black/[0.02]">
                <input type="checkbox" checked={f.screen_ids.includes(s.id)} onChange={() => setF({ ...f, screen_ids: tick(f.screen_ids, s.id) })} />
                <span className="flex-1 truncate">{s.name} <span className="text-muted-foreground">{s.address}</span></span>
                <span className="font-mono text-[12px] text-muted-foreground">{inr(s.slot_price_month)}/mo</span>
              </label>
            ))}
          </div>
          <Label>Creatives</Label>
          <div className="mb-3 flex flex-col gap-1">
            {mine.map((cr: any) => (
              <label key={cr.id} className="flex cursor-pointer items-center gap-2.5 text-[13px]">
                <input type="checkbox" checked={f.creative_ids.includes(cr.id)} onChange={() => setF({ ...f, creative_ids: tick(f.creative_ids, cr.id) })} />
                <span>{cr.name} <span className="font-mono text-muted-foreground">· {cr.duration_s}s</span></span>
                {cr.approval_status !== 'approved' && <Badge variant="warn">{cr.approval_status}</Badge>}
              </label>
            ))}
          </div>
          <div className="rounded-lg bg-primary/[0.06] p-3 text-[12.5px] text-primary">
            Changing screens or creatives affects delivery from the next schedule pull. Plays already recorded and spend already accrued are not altered.
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button onClick={save}>Save changes</Button>
            <Button variant="outline" onClick={() => setEdit(false)}>Cancel</Button>
            {err && <span className="text-[12.5px] text-destructive">{err}</span>}
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Plays delivered" value={d.totals.plays.toLocaleString('en-IN')} hint={`across ${d.byScreen.length} screen${d.byScreen.length === 1 ? '' : 's'}`} />
        <Stat label="Avg people / play" value={d.totals.avg === null ? '—' : d.totals.avg.toFixed(1)} hint="while the ad was on screen" />
        <Stat label="Measured" value={<>{d.totals.measured}<span className="text-[15px] text-muted-foreground"> / {d.totals.plays}</span></>} hint="plays with a working camera" />
        <Stat label="Spend" value={inr(c.accrued_spend)} hint={`of ${inr(c.committed_budget)} · ${rate}`} />
      </div>
      <Progress className="mt-3" value={pct} hot={pct >= 80} />

      <SectionHead>Per-screen delivery</SectionHead>
      <DataTable
        cols={[
          { label: 'Screen', render: (r: any) => <><div className="font-medium">{r.screen.name}</div><div className="text-[12px] text-muted-foreground">{r.screen.address}</div></> },
          { label: 'Venue', render: (r: any) => <Badge variant="muted">{r.screen.venue_type}</Badge> },
          { label: 'Plays', num: true, render: (r: any) => r.plays },
          { label: 'Share', num: true, render: (r: any) => { const p = d.totals.plays ? Math.round(r.plays / d.totals.plays * 100) : 0; return <div className="flex items-center justify-end gap-2">{p}%<Progress value={p} className="w-16" /></div>; } },
          { label: 'Avg people', num: true, render: (r: any) => r.avg === null ? <span className="text-muted-foreground">—</span> : <b>{r.avg.toFixed(1)}</b> },
        ]}
        rows={d.byScreen} empty="No screens on this campaign" />

      <SectionHead>Per-creative performance</SectionHead>
      <DataTable
        cols={[
          { label: 'Creative', render: (r: any) => <div className="flex items-center gap-3"><Thumb id={r.creative.youtube_id} w={58} /><div><div className="font-medium">{r.creative.name}</div><div className="font-mono text-[11.5px] text-muted-foreground">{r.creative.duration_s}s</div></div></div> },
          { label: 'Approval', render: (r: any) => <Badge variant={r.creative.approval_status === 'approved' ? 'ok' : r.creative.approval_status === 'rejected' ? 'destructive' : 'warn'}>{r.creative.approval_status}</Badge> },
          { label: 'Plays', num: true, render: (r: any) => r.plays },
          { label: 'Avg people', num: true, render: (r: any) => r.avg === null ? <span className="text-muted-foreground">—</span> : <b>{r.avg.toFixed(1)}</b> },
        ]}
        rows={d.byCreative} empty="No creatives on this campaign" />

      <SectionHead hint="· every play, auditable">Play log</SectionHead>
      <DataTable
        cols={[
          { label: 'When', render: (p: any) => <span className="font-mono text-[12px] text-muted-foreground">{fmtDate(p.ended_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> },
          { label: 'Screen', render: (p: any) => d.byScreen.find((s: any) => s.screen.id === p.screen_id)?.screen.name ?? '—' },
          { label: 'Creative', render: (p: any) => d.byCreative.find((c2: any) => c2.creative.id === p.creative_id)?.creative.name ?? '—' },
          { label: 'Duration', num: true, render: (p: any) => `${Math.round(p.duration_ms / 1000)}s` },
          { label: 'People present', num: true, render: (p: any) => p.presence?.measured
              ? <><b>{p.presence.avg_persons.toFixed(1)}</b> <span className="text-[11.5px] text-muted-foreground">({p.presence.sample_count})</span></>
              : <span className="text-muted-foreground">not measured</span> },
        ]}
        rows={d.plays} empty="No plays recorded yet — pair a player to one of these screens" />
    </>
  );
}
