'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, session, type SessionUser } from '@/lib/client';
import { inr, isLive, ytId, daySeries } from '@/lib/utils';
import { operatorNav } from '@/lib/nav';
import { AppShell, PageHead, SectionHead, type Crumb } from '@/components/ui/app-shell';
import { DataTable, type BulkAction } from '@/components/ui/table';
import { InlineSelect } from '@/components/ui/popover';
import { Spark } from '@/components/ui/spark';
import { Stat, Progress } from '@/components/ui/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select, Field, Label } from '@/components/ui/input';
import { StatusBadge, Thumb, Empty, SoonPage, ScreenPhoto } from '@/components/views/bits';
import { BootLoader } from '@/components/ui/loader';
import { useDirtyForm, SaveBar } from '@/components/ui/form';
import { ScreenDetail } from '@/components/views/screen-detail';
import { CampaignDetail } from '@/components/views/campaign-detail';
import { CampaignBuilder } from '@/components/views/campaign-builder';
import type { CmdItem } from '@/components/ui/command-palette';

export default function Operator() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [d, setD] = useState<any>(null);
  const [view, setView] = useState('overview');

  const reload = useCallback(async (u?: SessionUser) => {
    const who = u ?? user; if (!who) return;
    setD(await api(`/bootstrap?user=${who.id}`));
  }, [user]);

  useEffect(() => {
    const u = session.get();
    if (!u || u.role !== 'org_admin') { location.href = '/'; return; }
    setUser(u); api(`/bootstrap?user=${u.id}`).then(setD);
    const sync = () => setView(location.hash.slice(1) || 'overview');
    sync(); window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const go = (g: string) => { location.hash = g; setView(g); };

  const cmdItems: CmdItem[] = useMemo(() => {
    if (!d) return [];
    return [
      ...d.screens.map((s: any) => ({ id: s.id, label: s.name, sub: s.address, kind: 'screen', go: 's/' + s.id })),
      ...d.campaigns.map((c: any) => ({ id: c.id, label: c.name, sub: d.advertisers.find((a: any) => a.id === c.advertiser_id)?.name, kind: 'campaign', go: 'c/' + c.id })),
      ...d.advertisers.map((a: any) => ({ id: a.id, label: a.name, sub: a.category, kind: 'advertiser', go: 'a/' + a.id })),
      ...d.creatives.map((c: any) => ({ id: c.id, label: c.name, sub: `${c.duration_s}s`, kind: 'creative', go: 'creatives' })),
    ];
  }, [d]);

  if (!user || !d) return <BootLoader />;

  const advName = (id: string) => d.advertisers.find((a: any) => a.id === id)?.name ?? '—';
  const liveOn = (sid: string) => d.campaigns.filter((c: any) => c.screen_ids.includes(sid) && isLive(c));
  const bookedOn = (sid: string) => d.campaigns.filter((c: any) => c.screen_ids.includes(sid) && c.status !== 'complete');
  const playsOn = (sid: string, cid: string) => d.plays.filter((p: any) => p.screen_id === sid && p.campaign_id === cid).length;

  const alerts = [
    ...d.screens.filter((s: any) => s._status.state === 'offline' || s._status.state === 'stalled')
      .map((s: any) => ({ kind: 'Screen', tone: 'destructive', text: `${s.name} is ${s._status.label}`, go: 's/' + s.id })),
    ...d.campaigns.filter((c: any) => c.committed_budget && c.accrued_spend / c.committed_budget >= 0.8 && c.status === 'active')
      .map((c: any) => ({ kind: 'Budget', tone: 'warn', text: `${c.name} is at ${Math.round(c.accrued_spend / c.committed_budget * 100)}% of budget`, go: 'c/' + c.id })),
    ...d.creatives.filter((c: any) => c.approval_status === 'pending' && c.org_id === user.org_id)
      .map((c: any) => ({ kind: 'Approval', tone: 'warn', text: `${c.name} is awaiting approval`, go: 'creatives' })),
  ];

  const nav = operatorNav({ inbox: alerts.length });
  const orgs = [{ id: user.org_id, name: user.orgName, type: 'operator' }];
  const titleOf: Record<string, string> = { overview: 'Overview', screens: 'My screens', groups: 'Screen groups', advertisers: 'Advertisers', campaigns: 'Campaigns', creatives: 'Creatives', settlement: 'Settlement', inbox: 'Inbox', analytics: 'Analytics', reports: 'Reports', profile: 'Profile', settings: 'Organisation', 'set-org': 'Organisation', 'set-billing': 'Billing & payouts', 'set-team': 'Team & users', 'set-api': 'API keys', 'set-hooks': 'Webhooks' };
  const presFor = (sid: string) => d.presence.filter((x: any) => x.screen_id === sid && x.measured);
  const trendScreen = (sid: string) => daySeries(presFor(sid).map((x: any) => ({ at: x.at, value: x.avg_persons })));
  const trendCampaign = (cid: string) => {
    const pids = new Set(d.plays.filter((p: any) => p.campaign_id === cid).map((p: any) => p.id));
    return daySeries(d.presence.filter((x: any) => x.measured && pids.has(x.play_id)).map((x: any) => ({ at: x.at, value: x.avg_persons })));
  };
  const setCampaign = async (c: any, patch: any) => { await api(`/campaign/${c.id}`, patch); reload(); };
  const setScreen = async (x: any, patch: any) => { await api(`/screen/${x.id}`, { ...x, ...patch }); reload(); };
  const STATUS_CHOICES = [
    { value: 'active', label: 'Active', dot: 'hsl(var(--ok))' },
    { value: 'paused', label: 'Paused', dot: 'hsl(var(--warn))' },
    { value: 'complete', label: 'Complete', dot: 'hsl(var(--muted-foreground))' },
  ];
  const INVOICE_CHOICES = [
    { value: 'not_invoiced', label: 'Not invoiced', dot: 'hsl(var(--muted-foreground))' },
    { value: 'invoiced', label: 'Invoiced', dot: 'hsl(var(--warn))' },
    { value: 'paid', label: 'Paid', dot: 'hsl(var(--ok))' },
  ];
  const TIER_CHOICES = [
    { value: 'standard', label: 'Standard' }, { value: 'good', label: 'Good' }, { value: 'prime', label: 'Prime' },
  ];
  const restoreC = (k: string) => async (rows: any[]) => { for (const c of rows) await api(`/campaign/${c.id}`, { [k]: c[k] }); };
  const campaignBulk: BulkAction<any>[] = [
    { label: 'Pause', run: async rows => { for (const c of rows) await api(`/campaign/${c.id}`, { status: 'paused' }); }, undo: restoreC('status') },
    { label: 'Resume', run: async rows => { for (const c of rows) await api(`/campaign/${c.id}`, { status: 'active' }); }, undo: restoreC('status') },
    { label: 'Mark invoiced', run: async rows => { for (const c of rows) await api(`/campaign/${c.id}`, { invoice_status: 'invoiced' }); }, undo: restoreC('invoice_status') },
    { label: 'Mark paid', run: async rows => { for (const c of rows) await api(`/campaign/${c.id}`, { invoice_status: 'paid' }); }, undo: restoreC('invoice_status') },
  ];
  const screenBulk: BulkAction<any>[] = [
    { label: 'Activate', run: async rows => { for (const x of rows) await api(`/screen/${x.id}`, { ...x, status: 'active' }); },
      undo: async rows => { for (const x of rows) await api(`/screen/${x.id}`, x); } },
    { label: 'Pause', run: async rows => { for (const x of rows) await api(`/screen/${x.id}`, { ...x, status: 'paused' }); },
      undo: async rows => { for (const x of rows) await api(`/screen/${x.id}`, x); },
      confirm: 'Pause {n} screen(s)? They stop receiving new plays.' },
  ];
  const nameOf = (arr: any[], id: string, fb: string) => arr.find((x: any) => x.id === id)?.name ?? fb;
  const trail: Crumb[] = (() => {
    const root = { label: user.orgName, go: 'overview' };
    if (view.startsWith('s/')) return [root, { label: 'My screens', go: 'screens' }, nameOf(d.screens, view.slice(2), 'Screen')];
    if (view.startsWith('c/')) return [root, { label: 'Campaigns', go: 'campaigns' }, nameOf(d.campaigns, view.slice(2), 'Campaign')];
    if (view.startsWith('a/')) return [root, { label: 'Advertisers', go: 'advertisers' }, nameOf(d.advertisers, view.slice(2), 'Advertiser')];
    if (view === 'new') return [root, { label: 'Campaigns', go: 'campaigns' }, 'New campaign'];
    if (view.startsWith('set-') || view === 'settings') return [root, 'Settings', titleOf[view] ?? 'Settings'];
    if (view === 'overview') return [root];
    return [root, titleOf[view] ?? 'Overview'];
  })();

  return (
    <AppShell groups={nav.groups} bottom={nav.bottom} activeId={view} onSelect={go}
      orgs={orgs} currentOrg={orgs[0]} onOrgSelect={() => {}} breadcrumb={trail}
      cmdItems={cmdItems} onGo={go} user={{ name: user.name, role: user.role }}>

      {view.startsWith('s/') && <ScreenDetail id={view.slice(2)} onGo={go} onChanged={() => reload()} />}
      {view.startsWith('c/') && <CampaignDetail id={view.slice(2)} boot={d} onGo={go} onChanged={() => reload()} />}
      {view === 'new' && <CampaignBuilder boot={d} user={user} onGo={go} onDone={async (c: any) => { await reload(); go('c/' + c.id); }} />}

      {view.startsWith('a/') && (() => {
        const a = d.advertisers.find((x: any) => x.id === view.slice(2));
        if (!a) return <Empty>Advertiser not found</Empty>;
        const cs = d.campaigns.filter((c: any) => c.advertiser_id === a.id);
        const cur = cs.filter(isLive), past = cs.filter((c: any) => !isLive(c));
        const tbl = (rows: any[], empty: string) => (
          <DataTable cols={[
            { label: 'Campaign', render: (c: any) => <button onClick={() => go('c/' + c.id)} className="font-medium text-primary hover:underline">{c.name}</button> },
            { label: 'Dates', render: (c: any) => <span className="font-mono text-[12px] text-muted-foreground">{c.starts_at} → {c.ends_at}</span> },
            { label: 'Type', render: (c: any) => <Badge variant={c.campaign_type === 'network' ? 'default' : 'muted'}>{c.campaign_type === 'network' ? 'network' : 'yours'}</Badge> },
            { label: 'Screens', num: true, render: (c: any) => c.screen_ids.length },
            { label: 'Plays', num: true, render: (c: any) => d.plays.filter((p: any) => p.campaign_id === c.id).length },
            { label: 'Budget', num: true, render: (c: any) => { const p = c.committed_budget ? Math.round(c.accrued_spend / c.committed_budget * 100) : 0;
              return <div className="flex flex-col items-end gap-1">{inr(c.accrued_spend)} / {inr(c.committed_budget)}<Progress value={p} hot={p >= 80} className="w-20" /></div>; } },
            { label: 'Status', render: (c: any) => isLive(c) ? <Badge variant="onair" blip>current</Badge> : <Badge variant="muted">{c.status}</Badge> },
          ]} rows={rows} empty={empty} rowId={(c: any) => c.id} exportName="campaigns" />
        );
        return (<>
          <PageHead title={a.name} back={{ label: 'Advertisers', go: 'advertisers', onGo: go }}
            sub={<>{a.contact} · <span className="font-mono">{a.email}</span> · <span className="font-mono">{a.phone}</span></>}
            actions={<Badge variant={a.org_id === user.org_id ? 'muted' : 'default'}>{a.org_id === user.org_id ? 'your client' : 'brought by Gridcast'}</Badge>} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Live campaigns" value={cur.length} hint={`${cs.length} all time`} />
            <Stat label="Total plays" value={cs.reduce((s: number, c: any) => s + d.plays.filter((p: any) => p.campaign_id === c.id).length, 0)} hint="across all campaigns" />
            <Stat label="Committed" value={inr(cs.reduce((s: number, c: any) => s + c.committed_budget, 0))} hint="total booked" />
            <Stat label="Accrued" value={inr(cs.reduce((s: number, c: any) => s + c.accrued_spend, 0))} hint={a.org_id === user.org_id ? 'you keep 100%' : 'less Gridcast fee'} />
          </div>
          <SectionHead>Current campaigns</SectionHead>{tbl(cur, 'Nothing running right now')}
          <SectionHead>Past campaigns</SectionHead>{tbl(past, 'No past campaigns')}
        </>);
      })()}

      {view === 'overview' && (<>
        <PageHead title={user.orgName} sub={`${d.screens.length} screens · ${d.advertisers.length} advertisers · ${d.campaigns.filter(isLive).length} live campaigns`} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Monthly inventory" value={inr(d.screens.reduce((s: number, x: any) => s + x.monthly_value, 0))} hint="at full sell-through" />
          <Stat label="Accrued this period" value={inr(d.campaigns.reduce((s: number, c: any) => s + c.accrued_spend, 0))} hint="across live campaigns" />
          <Stat label="Screens on air" value={`${d.screens.filter((s: any) => s._status.state === 'live').length}/${d.screens.length}`} hint="paired and playing" />
          <Stat label="Avg people / play" value={(() => { const m = d.presence.filter((p: any) => p.measured); return m.length ? (m.reduce((a: number, b: any) => a + b.avg_persons, 0) / m.length).toFixed(1) : '—'; })()} hint="verified presence" />
        </div>
        <Card className="mt-4 border-primary/25 bg-primary/[0.04] p-4 text-[13px] text-primary">
          <b>You keep 100% of what you sell.</b> Gridcast takes no cut on campaigns you bring to your own screens. A fee applies only if you release slots to the network and Gridcast brings you a client.
        </Card>
        <SectionHead>Your screens</SectionHead>
        <DataTable cols={[
          { label: 'Screen', sort: (s: any) => s.name, render: (s: any) => <><button onClick={() => go('s/' + s.id)} className="font-medium text-primary hover:underline">{s.name}</button><div className="text-[12px] text-muted-foreground">{s.address}</div></> },
          { label: 'State', sort: (s: any) => s._status.state, render: (s: any) => <StatusBadge st={s._status} /> },
          { label: 'People / play', sort: (s: any) => trendScreen(s.id).filter(Boolean).slice(-1)[0] ?? -1, render: (s: any) => <Spark data={trendScreen(s.id)} /> },
          { label: 'Running', num: true, sort: (s: any) => liveOn(s.id).length, render: (s: any) => liveOn(s.id).length ? <><b>{liveOn(s.id).length}</b> <span className="text-muted-foreground">of {s.advertiser_slots}</span></> : <span className="text-muted-foreground">idle</span> },
          { label: 'Per slot / mo', num: true, sort: (s: any) => s.slot_price_month, render: (s: any) => inr(s.slot_price_month) },
        ]} rows={d.screens} rowId={(s: any) => s.id} exportName="screens" bulk={screenBulk} onDone={() => reload()}
          search={(s: any) => `${s.name} ${s.venue_name} ${s.address}`}
          facets={[{ label: 'State', get: (s: any) => s._status.state }, { label: 'Venue', get: (s: any) => s.venue_type }]} />
      </>)}

      {view === 'screens' && (() => {
        const pres = (sid: string) => d.presence.filter((x: any) => x.screen_id === sid && x.measured);
        const avgOn = (sid: string) => { const m = pres(sid); return m.length ? m.reduce((a: number, b: any) => a + b.avg_persons, 0) / m.length : null; };
        const plays7 = (sid: string) => { const cut = Date.now() - 7 * 864e5;
          return d.plays.filter((p: any) => p.screen_id === sid && new Date(p.ended_at || p.started_at).getTime() >= cut).length; };
        return (<>
        <PageHead title="My screens" sub={`${d.screens.length} screens · ${inr(d.screens.reduce((a: number, x: any) => a + x.monthly_value, 0))} of monthly inventory`} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {d.screens.map((s: any) => {
            const booked = bookedOn(s.id).length, pct = Math.round(booked / s.advertiser_slots * 100);
            const avg = avgOn(s.id);
            const tags = [`${s.size_in}"`, s.location_tier, ...Object.entries(s.tags || {}).map(([k, v]) => `${k}:${v}`)];
            return (
              <Card key={s.id} className="group overflow-hidden">
                <button onClick={() => go('s/' + s.id)} className="block w-full text-left">
                  <ScreenPhoto src={s.photo_url} venue={s.venue_type} className="h-[172px] rounded-none border-0 border-b">
                    <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
                      <StatusBadge st={s._status} />
                      {s.network_available && <Badge variant="muted">{s.network_slots} network slots</Badge>}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,rgba(0,0,0,.72),transparent)] px-3 pb-2.5 pt-8">
                      <div className="truncate text-[14.5px] font-semibold text-white">{s.name}</div>
                      <div className="truncate text-[12px] text-white/75">{s.venue_name} · {s.address}</div>
                    </div>
                  </ScreenPhoto>
                </button>

                <div className="grid grid-cols-4 divide-x divide-border/60 border-b border-border/60">
                  {[['Slot price', inr(s.slot_price_month), '/mo'],
                    ['Slots sold', `${booked}/${s.advertiser_slots}`, ''],
                    ['Avg people', avg == null ? '—' : avg.toFixed(1), avg == null ? '' : '/play'],
                    ['Plays 7d', String(plays7(s.id)), '']].map(([k, v, suf]) => (
                    <div key={k} className="px-3 py-2.5">
                      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">{k}</div>
                      <div className="font-mono tnum text-[15px] font-semibold leading-tight">{v}<span className="text-[10.5px] font-normal text-muted-foreground">{suf}</span></div>
                    </div>
                  ))}
                </div>

                <div className="px-3 pb-3 pt-2.5">
                  <Progress value={pct} hot={booked >= s.advertiser_slots} />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap gap-1">
                      <Badge variant="muted">{s.venue_type}</Badge>
                      {tags.slice(0, 2).map(t => (
                        <span key={t} className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">{t}</span>
                      ))}
                      {tags.length > 2 && <span className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">+{tags.length - 2}</span>}
                      {!s.has_camera && <Badge variant="warn">no camera</Badge>}
                    </div>
                    <button onClick={() => go('s/' + s.id)} className="shrink-0 text-[12px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">Manage →</button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
        </>);
      })()}

      {view === 'advertisers' && (() => {
        const mine = d.advertisers.filter((a: any) => a.org_id === user.org_id);
        const bygc = d.advertisers.filter((a: any) => a.org_id !== user.org_id);
        const row = (a: any) => { const cs = d.campaigns.filter((c: any) => c.advertiser_id === a.id);
          return { a, cs, live: cs.filter(isLive), spend: cs.reduce((s: number, c: any) => s + c.accrued_spend, 0),
            fee: cs.reduce((s: number, c: any) => s + c.accrued_spend * (c.platform_fee_pct / 100), 0) }; };
        const cols = (showFee: boolean) => [
          { label: 'Advertiser', render: (r: any) => <><button onClick={() => go('a/' + r.a.id)} className="font-medium text-primary hover:underline">{r.a.name}</button><div className="text-[12px] text-muted-foreground">{r.a.contact}</div></> },
          { label: 'Status', render: (r: any) => r.live.length ? <Badge variant="onair" blip>current</Badge> : <Badge variant="muted">{r.cs.length ? 'past' : 'no campaigns'}</Badge> },
          { label: 'Category', render: (r: any) => <Badge variant="muted">{r.a.category}</Badge> },
          { label: 'Campaigns', num: true, render: (r: any) => <>{r.live.length} <span className="text-muted-foreground">live / {r.cs.length} total</span></> },
          { label: 'Spend', num: true, render: (r: any) => inr(r.spend) },
          ...(showFee ? [{ label: 'Gridcast fee', num: true, render: (r: any) => <>−{inr(r.fee)}</> }] : []),
          { label: 'Contact', render: (r: any) => <span className="font-mono text-[11.5px] text-muted-foreground">{r.a.email}<br />{r.a.phone}</span> },
        ];
        return (<>
          <PageHead title="Advertisers" sub="Your clients, and any that Gridcast has brought to your screens"
            actions={<AddAdvertiser user={user} onAdded={() => reload()} />} />
          <SectionHead hint={`· ${mine.length}`}>Your advertisers</SectionHead>
          <DataTable cols={cols(false)} rows={mine.map(row)} empty="No advertisers yet" rowId={(r: any) => r.a.id} exportName="advertisers"
            search={(r: any) => `${r.a.name} ${r.a.category} ${r.a.contact}`} facets={[{ label: 'Category', get: (r: any) => r.a.category }]} />
          <SectionHead hint="· network campaigns on your released slots">Brought by Gridcast</SectionHead>
          {bygc.length ? (<>
            <DataTable cols={cols(true)} rows={bygc.map(row)} rowId={(r: any) => r.a.id} exportName="advertisers-gridcast" />
            <Card className="mt-3 border-primary/25 bg-primary/[0.04] p-3.5 text-[12.5px] text-primary">
              Gridcast sold these. You keep everything except the platform fee shown. They only run on screens where you released slots to the network.
            </Card>
          </>) : <Empty>None yet. Release slots on a screen to let Gridcast sell into it.</Empty>}
        </>);
      })()}

      {view === 'campaigns' && (<>
        <PageHead title="Campaigns" sub="Budgets are entered manually — the platform is a ledger, not a processor"
          actions={<Button onClick={() => go('new')}>+ New campaign</Button>} />
        <DataTable cols={[
          { label: 'Campaign', sort: (c: any) => c.name, render: (c: any) => <><button onClick={() => go('c/' + c.id)} className="font-medium text-primary hover:underline">{c.name}</button><div className="text-[12px] text-muted-foreground">{advName(c.advertiser_id)}</div></> },
          { label: 'Dates', sort: (c: any) => c.ends_at, render: (c: any) => <span className="font-mono text-[12px] text-muted-foreground">{c.starts_at} → {c.ends_at}</span> },
          { label: 'Type', sort: (c: any) => c.campaign_type, render: (c: any) => <Badge variant={c.campaign_type === 'network' ? 'default' : 'muted'}>{c.campaign_type}</Badge> },
          { label: 'Screens', num: true, sort: (c: any) => c.screen_ids.length, render: (c: any) => c.screen_ids.length },
          { label: 'People / play', sort: (c: any) => trendCampaign(c.id).filter(Boolean).slice(-1)[0] ?? -1, render: (c: any) => <Spark data={trendCampaign(c.id)} /> },
          { label: 'Rate', num: true, render: (c: any) => c.rate_type === 'flat' ? <>{inr(c.committed_budget)} <span className="text-muted-foreground">flat</span></> : <>{inr(c.rate_value)} <span className="text-muted-foreground">/play</span></> },
          { label: 'Budget', num: true, sort: (c: any) => (c.committed_budget ? c.accrued_spend / c.committed_budget : 0), render: (c: any) => { const p = c.committed_budget ? Math.round(c.accrued_spend / c.committed_budget * 100) : 0;
            return <div className="flex flex-col items-end gap-1">{inr(c.accrued_spend)} / {inr(c.committed_budget)}<Progress value={p} hot={p >= 80} className="w-20" /></div>; } },
          { label: 'Invoice', sort: (c: any) => c.invoice_status, render: (c: any) => (
            <InlineSelect value={c.invoice_status} choices={INVOICE_CHOICES} onChange={v => setCampaign(c, { invoice_status: v })}>
              <Badge variant={c.invoice_status === 'paid' ? 'ok' : c.invoice_status === 'invoiced' ? 'warn' : 'muted'}>{c.invoice_status.replace(/_/g, ' ')}</Badge>
            </InlineSelect>) },
          { label: 'Status', sort: (c: any) => c.status, render: (c: any) => (
            <InlineSelect value={c.status} choices={STATUS_CHOICES} onChange={v => setCampaign(c, { status: v })}>
              {isLive(c) ? <Badge variant="onair" blip>live</Badge> : <Badge variant="muted">{c.status}</Badge>}
            </InlineSelect>) },
        ]} rows={d.campaigns} rowId={(c: any) => c.id} exportName="campaigns" bulk={campaignBulk} onDone={() => reload()}
          search={(c: any) => `${c.name} ${advName(c.advertiser_id)}`}
          facets={[{ label: 'Status', get: (c: any) => c.status }, { label: 'Type', get: (c: any) => c.campaign_type },
                   { label: 'Invoice', get: (c: any) => c.invoice_status.replace(/_/g, ' ') }]} />
      </>)}

      {view === 'creatives' && <Creatives d={d} user={user} onChanged={() => reload()} advName={advName} />}

      {view === 'groups' && (<>
        <PageHead title="Screen groups" sub="Static lists and dynamic rules used to target campaigns" />
        <DataTable cols={[
          { label: 'Group', render: (g: any) => <span className="font-medium">{g.name}</span> },
          { label: 'Type', render: (g: any) => <Badge variant={g.group_type === 'dynamic' ? 'default' : 'muted'}>{g.group_type}</Badge> },
          { label: 'Rule', render: (g: any) => <span className="font-mono text-[12px] text-muted-foreground">{g.rule_json ? JSON.stringify(g.rule_json) : `${g.screen_ids.length} screens, hand-picked`}</span> },
        ]} rows={d.groups} rowId={(g: any) => g.id} exportName="screen-groups" />
        <div className="mt-4"><SoonPage title="Creating and editing groups" note="Rules resolve and are usable in the campaign builder today. The editor for creating new groups is not built yet." /></div>
      </>)}

      {view === 'settlement' && (() => {
        const rows = d.campaigns.map((c: any) => {
          const gross = c.accrued_spend, fee = Math.round(gross * (c.platform_fee_pct / 100));
          const opGross = gross - fee;
          const ownerPct = d.screens.find((s: any) => c.screen_ids.includes(s.id))?.owner_share_pct ?? 25;
          const owner = Math.round(opGross * ownerPct / 100);
          return { c, gross, fee, opGross, ownerPct, owner, net: opGross - owner };
        });
        return (<>
          <PageHead title="Settlement" sub="Full decomposition — nothing netted, nothing hidden" />
          <DataTable cols={[
            { label: 'Campaign', render: (r: any) => <><div className="font-medium">{r.c.name}</div><div className="text-[12px] text-muted-foreground">{advName(r.c.advertiser_id)}</div></> },
            { label: 'Gross', num: true, render: (r: any) => inr(r.gross) },
            { label: 'Platform fee', num: true, render: (r: any) => r.fee ? <>−{inr(r.fee)} <span className="text-muted-foreground">({r.c.platform_fee_pct}%)</span></> : <span className="text-muted-foreground">0%</span> },
            { label: 'Operator share', num: true, render: (r: any) => inr(r.opGross) },
            { label: 'Screen owner', num: true, render: (r: any) => <>−{inr(r.owner)} <span className="text-muted-foreground">({r.ownerPct}%)</span></> },
            { label: 'Your net', num: true, render: (r: any) => <b>{inr(r.net)}</b> },
          ]} rows={rows} rowId={(r: any) => r.c.id} exportName="settlement" />
          <Card className="mt-3 border-primary/25 bg-primary/[0.04] p-3.5 text-[12.5px] text-primary">
            Every line is shown gross → fee → share → net. You see exactly what the advertiser paid and exactly what was taken.
          </Card>
        </>);
      })()}

      {view === 'inbox' && (<>
        <PageHead title="Inbox" sub={`${alerts.length} thing${alerts.length === 1 ? '' : 's'} needing attention`} />
        {alerts.length ? (
          <DataTable cols={[
            { label: 'Type', render: (a: any) => <Badge variant={a.tone as any}>{a.kind}</Badge> },
            { label: 'Alert', render: (a: any) => a.text },
            { label: '', render: (a: any) => <Button variant="ghost" size="sm" onClick={() => go(a.go)}>Open →</Button> },
          ]} rows={alerts} />
        ) : <Empty>Nothing needs your attention. Screens are responding, budgets are under 80%, no creatives waiting.</Empty>}
      </>)}

      {view === 'analytics' && (<>
        <PageHead title="Analytics" sub="Delivery and presence across your network" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Plays all time" value={d.plays.length.toLocaleString('en-IN')} />
          <Stat label="Measured plays" value={d.presence.filter((p: any) => p.measured).length} hint="camera working" />
          <Stat label="Screens" value={d.screens.length} hint={`${d.screens.filter((s: any) => s.has_camera).length} with camera`} />
          <Stat label="Inventory value" value={inr(d.screens.reduce((s: number, x: any) => s + x.monthly_value, 0))} hint="per month at full sell-through" />
        </div>
        <SectionHead>By screen</SectionHead>
        <DataTable cols={[
          { label: 'Screen', render: (s: any) => <button onClick={() => go('s/' + s.id)} className="font-medium text-primary hover:underline">{s.name}</button> },
          { label: 'Venue', render: (s: any) => <Badge variant="muted">{s.venue_type}</Badge> },
          { label: 'Plays', num: true, render: (s: any) => d.plays.filter((p: any) => p.screen_id === s.id).length },
          { label: 'Avg people', num: true, sort: (s: any) => { const r = presFor(s.id); return r.length ? r.reduce((a: number, b: any) => a + b.avg_persons, 0) / r.length : -1; },
            render: (s: any) => { const r = presFor(s.id);
              return r.length ? <b>{(r.reduce((a: number, b: any) => a + b.avg_persons, 0) / r.length).toFixed(1)}</b> : <span className="text-muted-foreground">—</span>; } },
          { label: 'Last 7 days', render: (s: any) => <Spark data={trendScreen(s.id)} /> },
          { label: 'Monthly value', num: true, sort: (s: any) => s.monthly_value, render: (s: any) => inr(s.monthly_value) },
        ]} rows={d.screens} rowId={(s: any) => s.id} exportName="screen-performance"
          search={(s: any) => s.name} facets={[{ label: 'Venue', get: (s: any) => s.venue_type }]} />
        <div className="mt-4"><SoonPage title="Trends, dayparting and exports" note="Time-series charts, daypart breakdowns and CSV export are not built yet. The underlying play and presence data is already being collected." /></div>
      </>)}

      {['reports'].includes(view) && <><PageHead title="Reports" /><SoonPage title="Scheduled and exportable reports" note="Per-advertiser PDF and CSV reports on a schedule. Not built yet — campaign pages already carry the same numbers." /></>}
      {view === 'profile' && <ProfileSettings user={user} onSaved={() => { const u = session.get(); if (u) setUser(u); reload(); }} />}
      {(view === 'settings' || view === 'set-org') && <OrgSettings d={d} user={user} onSaved={() => { const u = session.get(); if (u) setUser(u); reload(); }} />}
      {['set-billing','set-team','set-api','set-hooks'].includes(view) && (<>
        <PageHead title={titleOf[view] ?? 'Settings'} />
        <SoonPage title="Not built yet"
          note={view === 'set-billing' ? 'Payouts and invoices. Billing is manual today — the platform records what was agreed, money moves outside it.'
            : view === 'set-team' ? 'Invite colleagues into your organisation with scoped roles.'
            : view === 'set-api' ? 'Programmatic access to your screens and campaigns.'
            : 'Delivery and status callbacks to your own systems.'} />
      </>)}
    </AppShell>
  );
}

function AddAdvertiser({ user, onAdded }: { user: SessionUser; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', contact: '', category: '', phone: '' });
  if (!open) return <Button onClick={() => setOpen(true)}>+ Add advertiser</Button>;
  return (
    <Card className="absolute right-8 z-30 w-[min(560px,90vw)] p-5 shadow-xl">
      <h3 className="mb-3 text-[14px] font-semibold">New advertiser</h3>
      <div className="flex flex-wrap gap-3">
        <Field label="Name"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Acme Motors" /></Field>
        <Field label="Contact"><Input value={f.contact} onChange={e => setF({ ...f, contact: e.target.value })} /></Field>
        <Field label="Category"><Input value={f.category} onChange={e => setF({ ...f, category: e.target.value })} placeholder="automotive" /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={async () => { await api('/advertiser', { org_id: user.org_id, name: f.name || 'Untitled', contact: f.contact, category: f.category || 'general', phone: f.phone, email: '' }); setOpen(false); onAdded(); }}>Save</Button>
        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </Card>
  );
}

function Creatives({ d, user, onChanged, advName }: { d: any; user: SessionUser; onChanged: () => void; advName: (id: string) => string }) {
  const [f, setF] = useState({ adv: d.advertisers.filter((a: any) => a.org_id === user.org_id)[0]?.id ?? '', url: '', name: '', dur: '10' });
  const [err, setErr] = useState('');
  const add = async () => {
    const id = ytId(f.url); if (!id) return setErr('Not a YouTube URL or video ID.');
    setErr('');
    await api('/creative', { org_id: user.org_id, advertiser_id: f.adv, name: f.name || 'Untitled creative', category: 'general', youtube_id: id, duration_s: Number(f.dur) || 10, aspect: '16:9' });
    setF({ ...f, url: '', name: '' }); onChanged();
  };
  return (<>
    <PageHead title="Creatives" sub="Ad variations — paste a YouTube link to add one" />
    <Card className="mb-4 p-5">
      <div className="flex flex-wrap gap-3">
        <Field label="Advertiser"><Select value={f.adv} onChange={e => setF({ ...f, adv: e.target.value })}>
          {d.advertisers.filter((a: any) => a.org_id === user.org_id).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select></Field>
        <Field label="YouTube URL" className="flex-[2]"><Input value={f.url} onChange={e => setF({ ...f, url: e.target.value })} placeholder="https://youtube.com/watch?v=…" /></Field>
        <Field label="Name"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Seconds" className="max-w-[110px]"><Input type="number" value={f.dur} onChange={e => setF({ ...f, dur: e.target.value })} /></Field>
      </div>
      <div className="mt-3 flex items-center gap-3"><Button onClick={add}>Add creative</Button>{err && <span className="text-[12.5px] text-destructive">{err}</span>}</div>
    </Card>
    <DataTable cols={[
      { label: 'Creative', render: (c: any) => <div className="flex items-center gap-3"><Thumb id={c.youtube_id} w={76} /><div><div className="font-medium">{c.name}</div><div className="text-[12px] text-muted-foreground">{advName(c.advertiser_id)}</div></div></div> },
      { label: 'Source', render: (c: any) => <span className="font-mono text-[12px] text-muted-foreground">yt:{c.youtube_id}</span> },
      { label: 'Length', num: true, render: (c: any) => `${c.duration_s}s` },
      { label: 'Approval', render: (c: any) => <Badge variant={c.approval_status === 'approved' ? 'ok' : c.approval_status === 'rejected' ? 'destructive' : 'warn'}>{c.approval_status}</Badge> },
      { label: '', render: (c: any) => c.org_id !== user.org_id ? <span className="text-[12px] text-muted-foreground">Gridcast</span>
        : c.approval_status === 'pending'
          ? <div className="flex gap-1.5"><Button size="sm" onClick={async () => { await api(`/creative/${c.id}/approve`, { status: 'approved' }); onChanged(); }}>Approve</Button>
              <Button size="sm" variant="outline" onClick={async () => { await api(`/creative/${c.id}/approve`, { status: 'rejected' }); onChanged(); }}>Reject</Button></div>
          : <Button size="sm" variant="ghost" onClick={async () => { await api(`/creative/${c.id}/approve`, { status: 'pending' }); onChanged(); }}>Revoke</Button> },
    ]} rows={d.creatives} rowId={(c: any) => c.id} exportName="creatives" onDone={onChanged} bulk={[
      { label: 'Approve', run: async (rows: any[]) => { for (const c of rows) if (c.org_id === user.org_id) await api(`/creative/${c.id}/approve`, { status: 'approved' }); } },
      { label: 'Reject', variant: 'outline' as const, run: async (rows: any[]) => { for (const c of rows) if (c.org_id === user.org_id) await api(`/creative/${c.id}/approve`, { status: 'rejected' }); } },
    ]} />
  </>);
}

function OrgSettings({ d, user, onSaved }: { d: any; user: SessionUser; onSaved: () => void }) {
  const org = d.org || {};
  const fm = useDirtyForm({ name: org.name ?? user.orgName, support_email: org.support_email ?? '', billing_address: org.billing_address ?? '', gstin: org.gstin ?? '' });
  return (<>
    <PageHead title="Organisation" sub="Settings for your operator account" />
    <Card className="p-5">
      <div className="flex flex-wrap gap-3">
        <Field label="Organisation name"><Input value={fm.f.name} onChange={e => fm.set({ name: e.target.value })} /></Field>
        <Field label="Support email"><Input value={fm.f.support_email} onChange={e => fm.set({ support_email: e.target.value })} placeholder="ops@example.in" /></Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <Field label="Billing address" className="flex-[2]"><Input value={fm.f.billing_address} onChange={e => fm.set({ billing_address: e.target.value })} /></Field>
        <Field label="GSTIN"><Input value={fm.f.gstin} onChange={e => fm.set({ gstin: e.target.value })} /></Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <Field label="Platform fee on network campaigns"><Input value={`${d.org?.platform_fee_pct ?? 0}%`} disabled /></Field>
      </div>
      <p className="mt-3 text-[12.5px] text-muted-foreground">Your fee is set by Gridcast and shown here for transparency. It applies only to campaigns Gridcast sells onto your released slots.</p>
    </Card>
    <SaveBar {...fm} onSave={() => fm.save(async v => {
      const o = await api(`/org/${user.org_id}`, v);
      const u = session.get(); if (u) session.set({ ...u, orgName: o.name });
      onSaved();
    })} onDiscard={fm.discard} />
  </>);
}

function ProfileSettings({ user, onSaved }: { user: SessionUser; onSaved: () => void }) {
  const fm = useDirtyForm({ name: user.name, email: (user as any).email ?? '', phone: (user as any).phone ?? '' });
  return (<>
    <PageHead title="Profile & account" />
    <Card className="p-5">
      <div className="flex flex-wrap gap-3">
        <Field label="Name"><Input value={fm.f.name} onChange={e => fm.set({ name: e.target.value })} /></Field>
        <Field label="Email"><Input value={fm.f.email} onChange={e => fm.set({ email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={fm.f.phone} onChange={e => fm.set({ phone: e.target.value })} /></Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <Field label="Organisation"><Input value={user.orgName} disabled /></Field>
        <Field label="Role"><Input value={user.role.replace(/_/g, ' ')} disabled /></Field>
      </div>
    </Card>
    <SaveBar {...fm} onSave={() => fm.save(async v => {
      await api(`/user/${user.id}`, v);
      const u = session.get(); if (u) session.set({ ...u, name: v.name });
      onSaved();
    })} onDiscard={fm.discard} />
  </>);
}
