'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { api, session, type SessionUser } from '@/lib/client';
import { inr, isLive, fmtDate } from '@/lib/utils';
import { advertiserNav } from '@/lib/nav';
import { AppShell, PageHead, SectionHead } from '@/components/ui/app-shell';
import { DataTable } from '@/components/ui/table';
import { Stat, Progress } from '@/components/ui/stat';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input, Field } from '@/components/ui/input';
import { SoonPage } from '@/components/views/bits';
import type { CmdItem } from '@/components/ui/command-palette';
import { BootLoader } from '@/components/ui/loader';
import { useDirtyForm, SaveBar } from '@/components/ui/form';

export default function Advertiser() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [d, setD] = useState<any>(null);
  const [view, setView] = useState('overview');

  useEffect(() => {
    const u = session.get();
    if (!u || u.role !== 'advertiser_viewer') { location.href = '/'; return; }
    setUser(u); api(`/bootstrap?user=${u.id}`).then(setD);
    const sync = () => setView(location.hash.slice(1) || 'overview');
    sync(); window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const go = (g: string) => { location.hash = g; setView(g); };

  const mine = useMemo(() => !d ? [] : d.campaigns.filter((c: any) => c.advertiser_id === user?.advertiser_id), [d, user]);
  const myPlays = useMemo(() => !d ? [] : d.plays.filter((p: any) => mine.some((c: any) => c.id === p.campaign_id)), [d, mine]);
  const pres = useMemo(() => !d ? [] : myPlays.map((p: any) => d.presence.find((x: any) => x.play_id === p.id)).filter(Boolean), [d, myPlays]);
  const measured = pres.filter((p: any) => p.measured);
  const cmdItems: CmdItem[] = useMemo(() => mine.map((c: any) => ({ id: c.id, label: c.name, sub: `${c.starts_at} → ${c.ends_at}`, kind: 'campaign', go: 'overview' })), [mine]);

  if (!user || !d) return <BootLoader />;

  const nav = advertiserNav();
  const orgs = [{ id: 'me', name: user.name, type: 'advertiser' }];
  const screenName = (id: string) => d.screens.find((s: any) => s.id === id)?.name ?? '—';
  const totalPeople = measured.reduce((s: number, x: any) => s + x.avg_persons, 0);
  const crumb = view === 'screens' ? 'Where it ran' : view === 'reports' ? 'Reports' : view === 'profile' ? 'Profile' : 'Delivery';

  return (
    <AppShell groups={nav.groups} bottom={nav.bottom} activeId={view} onSelect={go}
      orgs={orgs} currentOrg={orgs[0]} onOrgSelect={() => {}} breadcrumb={[user.orgName, crumb]}
      cmdItems={cmdItems} onGo={go} user={{ name: user.name, role: user.role }}>

      {view === 'overview' && (<>
        <PageHead title={user.name} sub="Campaign delivery · read-only" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Plays delivered" value={myPlays.length.toLocaleString('en-IN')} hint={`${mine.length} campaign${mine.length === 1 ? '' : 's'}`} />
          <Stat label="Avg people / play" value={measured.length ? (totalPeople / measured.length).toFixed(1) : '—'} hint="while your ad was on screen" />
          <Stat label="Measured" value={<>{measured.length}<span className="text-[15px] text-muted-foreground"> / {myPlays.length}</span></>} hint="plays with a working camera" />
          <Stat label="Spend" value={inr(mine.reduce((s: number, c: any) => s + c.accrued_spend, 0))} hint={`of ${inr(mine.reduce((s: number, c: any) => s + c.committed_budget, 0))} committed`} />
        </div>
        <Card className="mt-4 border-primary/25 bg-primary/[0.04] p-4 text-[13px] text-primary">
          <b>How we count.</b> A camera on each screen samples the scene while your ad plays and averages how many people were in front of it.
          This is <em>average people present</em> — not impressions, and not unique reach.
          {myPlays.length - measured.length > 0 && <><br /><b>{myPlays.length - measured.length}</b> play{myPlays.length - measured.length === 1 ? '' : 's'} ran on screens without a working camera and are shown as not measured. They are never counted as zero, and never estimated.</>}
        </Card>
        <SectionHead>Campaigns</SectionHead>
        <DataTable cols={[
          { label: 'Campaign', render: (c: any) => <span className="font-medium">{c.name}</span> },
          { label: 'Dates', render: (c: any) => <span className="font-mono text-[12px] text-muted-foreground">{c.starts_at} → {c.ends_at}</span> },
          { label: 'Screens', num: true, render: (c: any) => c.screen_ids.length },
          { label: 'Plays', num: true, render: (c: any) => d.plays.filter((p: any) => p.campaign_id === c.id).length },
          { label: 'Budget used', num: true, render: (c: any) => { const p = c.committed_budget ? Math.round(c.accrued_spend / c.committed_budget * 100) : 0;
            return <div className="flex flex-col items-end gap-1">{inr(c.accrued_spend)} / {inr(c.committed_budget)}<Progress value={p} hot={p >= 80} className="w-20" /></div>; } },
          { label: 'Status', render: (c: any) => isLive(c) ? <Badge variant="onair" blip>live</Badge> : <Badge variant="muted">{c.status}</Badge> },
        ]} rows={mine} empty="No campaigns yet" />
        <SectionHead>Recent plays</SectionHead>
        <DataTable cols={[
          { label: 'When', render: (p: any) => <span className="font-mono text-[12px] text-muted-foreground">{fmtDate(p.ended_at)}</span> },
          { label: 'Screen', render: (p: any) => screenName(p.screen_id) },
          { label: 'Creative', render: (p: any) => d.creatives.find((c: any) => c.id === p.creative_id)?.name ?? '—' },
          { label: 'People present', num: true, render: (p: any) => { const x = d.presence.find((z: any) => z.play_id === p.id);
            return x?.measured ? <b>{x.avg_persons.toFixed(1)}</b> : <span className="text-muted-foreground">not measured</span>; } },
        ]} rows={myPlays.slice(-15).reverse()} empty="No delivery recorded yet" />
      </>)}

      {view === 'screens' && (() => {
        const ids = Array.from(new Set(mine.flatMap((c: any) => c.screen_ids))) as string[];
        return (<>
          <PageHead title="Where it ran" sub={`${ids.length} screens`} />
          <DataTable cols={[
            { label: 'Screen', render: (id: string) => { const s = d.screens.find((x: any) => x.id === id);
              return <><div className="font-medium">{s?.name ?? '—'}</div><div className="text-[12px] text-muted-foreground">{s?.address}</div></>; } },
            { label: 'Venue', render: (id: string) => <Badge variant="muted">{d.screens.find((x: any) => x.id === id)?.venue_type ?? '—'}</Badge> },
            { label: 'Plays', num: true, render: (id: string) => myPlays.filter((p: any) => p.screen_id === id).length },
            { label: 'Avg people', num: true, render: (id: string) => { const r = myPlays.filter((p: any) => p.screen_id === id).map((p: any) => d.presence.find((x: any) => x.play_id === p.id)).filter((x: any) => x?.measured);
              return r.length ? <b>{(r.reduce((a: number, b: any) => a + b.avg_persons, 0) / r.length).toFixed(1)}</b> : <span className="text-muted-foreground">—</span>; } },
          ]} rows={ids} empty="No screens yet" />
        </>);
      })()}

      {view === 'reports' && <><PageHead title="Reports" /><SoonPage title="Downloadable campaign reports" note="A PDF and CSV of exactly this data, on a schedule. Not built yet." /></>}
      {view === 'profile' && <AdvProfile user={user} />}
    </AppShell>
  );
}

function AdvProfile({ user }: { user: SessionUser }) {
  const fm = useDirtyForm({ name: user.name, email: (user as any).email ?? '', phone: (user as any).phone ?? '' });
  return (<>
    <PageHead title="Profile & account" />
    <Card className="p-5">
      <div className="flex flex-wrap gap-3">
        <Field label="Name"><Input value={fm.f.name} onChange={e => fm.set({ name: e.target.value })} /></Field>
        <Field label="Email"><Input value={fm.f.email} onChange={e => fm.set({ email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={fm.f.phone} onChange={e => fm.set({ phone: e.target.value })} /></Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-3"><Field label="Agency / operator"><Input value={user.orgName} disabled /></Field></div>
      <p className="mt-3 text-[12.5px] text-muted-foreground">Billing contact changes reach your operator — they raise the invoices.</p>
    </Card>
    <SaveBar {...fm} onSave={() => fm.save(async v => {
      await api(`/user/${user.id}`, v);
      const u = session.get(); if (u) session.set({ ...u, name: v.name });
    })} onDiscard={fm.discard} />
  </>);
}
