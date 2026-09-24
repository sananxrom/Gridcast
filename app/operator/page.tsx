'use client';
import { HistoryNotice } from '@/components/views/history-notice';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { tabFor } from '@/lib/roles';
import { campaignInterval } from '@/lib/inventory';
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
import { ConfigList, ConfigEditor } from '@/components/views/config-views';
import { ProfilePage, OrgPage, PayoutPage, TeamPage } from '@/components/views/account';
import { useDirtyForm, SaveBar } from '@/components/ui/form';
import { ScreenDetail } from '@/components/views/screen-detail';
import { ScreenOnboarding } from '@/components/views/screen-onboarding';
import { GroupManager } from '@/components/views/groups';
import { Advertisers, AdvertiserDetail, Creatives } from '@/components/views/commercial';
import { CampaignDetail } from '@/components/views/campaign-detail';
import { CameraReadiness } from '@/components/views/camera-readiness';
import { CampaignList } from '@/components/views/campaign-list';
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
    if (!u || tabFor(u.role) !== 'operator') { location.href = '/'; return; }
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
  const bookedOn = (sid: string) => d.campaigns.filter((c: any) => {if(!c.screen_ids.includes(sid)||!['active','pending','paused'].includes(c.status))return false;try{const [start,end]=campaignInterval(c);return start<=Date.now()&&Date.now()<end;}catch{return false;}});
  const playsOn = (sid: string, cid: string) => d.plays.filter((p: any) => p.screen_id === sid && p.campaign_id === cid).length;

  const alerts = [
    ...d.screens.filter((s: any) => s._status?.state === 'offline' || s._status?.state === 'stalled')
      .map((s: any) => ({ kind: 'Screen', tone: 'destructive', text: `${s.name} is ${s._status?.label}`, go: 's/' + s.id })),
    ...d.campaigns.filter((c: any) => c.committed_budget && c.accrued_spend / c.committed_budget >= 0.8 && c.status === 'active')
      .map((c: any) => ({ kind: 'Budget', tone: 'warn', text: `${c.name} is at ${Math.round(c.accrued_spend / c.committed_budget * 100)}% of budget`, go: 'c/' + c.id })),
    ...d.creatives.filter((c: any) => c.approval_status === 'pending' && c.org_id === user.org_id)
      .map((c: any) => ({ kind: 'Approval', tone: 'warn', text: `${c.name} is awaiting approval`, go: 'creatives' })),
  ];

  const caps: string[] = d.caps ?? [];
  const nav = operatorNav({ inbox: alerts.length }, caps);
  const orgs = [{ id: user.org_id, name: user.orgName, type: 'operator' }];
  const titleOf: Record<string, string> = { overview: 'Overview', screens: 'My screens', groups: 'Screen groups', advertisers: 'Advertisers', campaigns: 'Campaigns', creatives: 'Creatives', settlement: 'Settlement', inbox: 'Inbox', analytics: 'Analytics', reports: 'Reports', profile: 'Profile', configs: 'Device configs', settings: 'Organisation', 'set-org': 'Organisation', 'set-billing': 'Billing & payouts', 'set-team': 'Team & users', 'set-api': 'API keys', 'set-hooks': 'Webhooks' };
  const presFor = (sid: string) => d.presence.filter((x: any) => x.screen_id === sid && x.measured);
  const trendScreen = (sid: string) => daySeries(presFor(sid).map((x: any) => ({ at: x.at, value: x.avg_persons })));
  const trendCampaign = (cid: string) => {
    const pids = new Set(d.plays.filter((p: any) => p.campaign_id === cid).map((p: any) => p.id));
    return daySeries(d.presence.filter((x: any) => x.measured && pids.has(x.play_id)).map((x: any) => ({ at: x.at, value: x.avg_persons })));
  };
  const setCampaign = async (c: any, patch: any) => { await api(`/campaign/${c.id}`, patch); reload(); };
  const setScreen = async (x: any, patch: any) => { await api(`/screen/${x.id}`, patch); reload(); };
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
    ...(caps.includes('money') ? [
    { label: 'Mark invoiced', run: async (rows: any[]) => { for (const c of rows) await api(`/campaign/${c.id}`, { invoice_status: 'invoiced' }); }, undo: restoreC('invoice_status') },
    { label: 'Mark paid', run: async (rows: any[]) => { for (const c of rows) await api(`/campaign/${c.id}`, { invoice_status: 'paid' }); }, undo: restoreC('invoice_status') },
    ] : []),
  ];
  const screenBulk: BulkAction<any>[] = [
    { label: 'Activate', run: async rows => { for (const x of rows) await api(`/screen/${x.id}`, { status: 'active' }); },
      undo: async rows => { for (const x of rows) await api(`/screen/${x.id}`, { status: x.status }); } },
    { label: 'Pause', run: async rows => { for (const x of rows) await api(`/screen/${x.id}`, { status: 'paused' }); },
      undo: async rows => { for (const x of rows) await api(`/screen/${x.id}`, { status: x.status }); },
      confirm: 'Pause {n} screen(s)? They stop receiving new plays.' },
  ];
  const nameOf = (arr: any[], id: string, fb: string) => arr.find((x: any) => x.id === id)?.name ?? fb;
  const trail: Crumb[] = (() => {
    const root = { label: user.orgName, go: 'overview' };
    if (view.startsWith('s/')) return [root, { label: 'My screens', go: 'screens' }, nameOf(d.screens, view.slice(2), 'Screen')];
    if (view.startsWith('c/')) return [root, { label: 'Campaigns', go: 'campaigns' }, nameOf(d.campaigns, view.slice(2), 'Campaign')];
    if (view.startsWith('a/')) return [root, { label: 'Advertisers', go: 'advertisers' }, nameOf(d.advertisers, view.slice(2), 'Advertiser')];
    if (view.startsWith('cfg/')) return [root, { label: 'Device configs', go: 'configs' }, 'Config'];
    if (view === 'new') return [root, { label: 'Campaigns', go: 'campaigns' }, 'New campaign'];
    if (view.startsWith('set-') || view === 'settings') return [root, 'Settings', titleOf[view] ?? 'Settings'];
    if (view === 'overview') return [root];
    return [root, titleOf[view] ?? 'Overview'];
  })();

  return (
    <AppShell groups={nav.groups} bottom={nav.bottom} activeId={view} onSelect={go}
      orgs={orgs} currentOrg={orgs[0]} onOrgSelect={() => {}} breadcrumb={trail}
      cmdItems={cmdItems} onGo={go} user={{ name: user.name, role: user.role }}>

      <HistoryNotice history={d.history} />
      {view === 'configs' && caps.includes('screens') && <ConfigList user={user} onOpen={id => go('cfg/' + id)} onChanged={() => reload()} />}
      {view.startsWith('cfg/') && caps.includes('screens') && <ConfigEditor id={view.slice(4)} user={user} onGo={go} onChanged={() => reload()} />}

      {view === 'new-screen' && caps.includes('screens') && caps.includes('sales') && <ScreenOnboarding boot={d} user={user} onGo={go} onDone={async(s:any)=>{await reload();go('s/'+s.id);}} />}
      {view.startsWith('s/') && <ScreenDetail id={view.slice(2)} onGo={go} onChanged={() => reload()} />}
      {view.startsWith('c/') && <CampaignDetail id={view.slice(2)} boot={d} onGo={go} onChanged={() => reload()} />}
      {view === 'new' && caps.includes('sales') && <CampaignBuilder boot={d} user={user} orgId={user.org_id} onGo={go} onDone={async (c: any) => { await reload(); go('c/' + c.id); }} />}

      {view.startsWith('a/') && caps.includes('sales') && <AdvertiserDetail id={view.slice(2)} d={d} user={user} orgId={user.org_id} onGo={go} onChanged={reload} />}

      {view === 'overview' && (<>
        <PageHead title={user.orgName} sub={`${d.screens.length} screens · ${d.advertisers.length} advertisers · ${d.campaigns.filter(isLive).length} live campaigns`} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {caps.includes('sales') && <Stat label="Monthly inventory" value={inr(d.screens.reduce((s: number, x: any) => s + x.monthly_value, 0))} hint="at full sell-through" />}
          {caps.includes('sales') && <Stat label="Accrued this period" value={inr(d.campaigns.reduce((s: number, c: any) => s + c.accrued_spend, 0))} hint="across live campaigns" />}
          {caps.includes('screens') && <Stat label="Screens on air" value={`${d.screens.filter((s: any) => s._status?.state === 'live').length}/${d.screens.length}`} hint="paired and playing" />}
          <Stat label="Avg people / play" value={(() => { const m = d.presence.filter((p: any) => p.measured); return m.length ? (m.reduce((a: number, b: any) => a + b.avg_persons, 0) / m.length).toFixed(1) : '—'; })()} hint="reported presence" />
        </div>
        <Card className="mt-4 border-primary/25 bg-primary/[0.04] p-4 text-[13px] text-primary">
          <b>You keep 100% of what you sell.</b> Gridcast takes no cut on campaigns you bring to your own screens. A fee applies only if you release slots to the network and Gridcast brings you a client.
        </Card>
        <SectionHead>Your screens</SectionHead>
        <DataTable cols={[
          { className: 'min-w-[168px]', label: 'Screen', sort: (s: any) => s.name, render: (s: any) => <><button onClick={() => go('s/' + s.id)} className="text-left font-medium text-primary hover:underline">{s.name}</button><div className="text-[12px] text-muted-foreground">{s.address}</div></> },
          { label: 'State', sort: (s: any) => s._status?.state, render: (s: any) => s._status ? <StatusBadge st={s._status} /> : <span className="text-muted-foreground">—</span> },
          { label: 'People / play', sort: (s: any) => trendScreen(s.id).filter(Boolean).slice(-1)[0] ?? -1, render: (s: any) => <Spark data={trendScreen(s.id)} /> },
          { label: 'Running', num: true, sort: (s: any) => liveOn(s.id).length, render: (s: any) => liveOn(s.id).length ? <><b>{liveOn(s.id).length}</b> <span className="text-muted-foreground">campaigns</span></> : <span className="text-muted-foreground">idle</span> },
          ...(caps.includes('sales') ? [{ label: 'Per slot / mo', num: true, sort: (s: any) => s.slot_price_month, render: (s: any) => inr(s.slot_price_month) }] : []),
        ]} rows={d.screens} rowId={(s: any) => s.id} exportName="screens" bulk={caps.includes('screens') ? screenBulk : undefined} onDone={() => reload()}
          search={(s: any) => `${s.name} ${s.venue_name} ${s.address}`}
          facets={[{ label: 'State', get: (s: any) => s._status?.state ?? 'unavailable' }, { label: 'Venue', get: (s: any) => s.venue_type }]} />
      </>)}

      {view === 'screens' && (() => {
        const pres = (sid: string) => d.presence.filter((x: any) => x.screen_id === sid && x.measured);
        const avgOn = (sid: string) => { const m = pres(sid); return m.length ? m.reduce((a: number, b: any) => a + b.avg_persons, 0) / m.length : null; };
        const plays7 = (sid: string) => { const cut = Date.now() - 7 * 864e5;
          return d.plays.filter((p: any) => p.screen_id === sid && new Date(p.ended_at || p.started_at).getTime() >= cut).length; };
        return (<>
        <PageHead title="My screens" sub={caps.includes('sales') ? `${d.screens.length} screens · ${inr(d.screens.reduce((a: number, x: any) => a + x.monthly_value, 0))} of monthly inventory` : `${d.screens.length} screens`} actions={caps.includes('screens') && caps.includes('sales') ? <Button onClick={()=>go('new-screen')}>Add screen</Button> : undefined} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {d.screens.map((s: any) => {
            const booked = new Set(bookedOn(s.id).map((c:any)=>c.advertiser_id)).size, pct = Math.round(booked / s.advertiser_slots * 100);
            const avg = avgOn(s.id);
            const tags = [`${s.size_in}"`, s.location_tier, ...Object.entries(s.tags || {}).map(([k, v]) => `${k}:${v}`)];
            return (
              <Card key={s.id} className="group overflow-hidden">
                <button onClick={() => go('s/' + s.id)} className="block w-full text-left">
                  <ScreenPhoto src={s.photo_url} venue={s.venue_type} className="h-[172px] rounded-none border-0 border-b">
                    <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
                      {s._status && <StatusBadge st={s._status} />}
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
                    ['Advertisers today', `${booked}/${s.advertiser_slots}`, ''],
                    ['Avg people', avg == null ? '—' : avg.toFixed(1), avg == null ? '' : '/play'],
                    ['Plays 7d', String(plays7(s.id)), '']].filter(([k]) => k !== 'Slot price' || caps.includes('sales')).map(([k, v, suf]) => (
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
                      <CameraReadiness screen={s} devices={d.devices}/>
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

      {view === 'advertisers' && caps.includes('sales') && <Advertisers d={d} user={user} orgId={user.org_id} onGo={go} onChanged={reload} />}

      {view === 'campaigns' && caps.includes('sales') && <CampaignList d={d} orgId={user.org_id} onGo={go} onChanged={reload}/>}

      {view === 'creatives' && caps.includes('sales') && <Creatives d={d} user={user} orgId={user.org_id} onChanged={() => reload()} />}

      {view === 'groups' && <GroupManager boot={d} user={user} onChanged={()=>reload()} />}

      {view === 'settlement' && caps.includes('money') && (() => {
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
          <Stat label="Play reports loaded" value={d.plays.length.toLocaleString('en-IN')} />
          <Stat label="Measured plays" value={d.presence.filter((p: any) => p.measured).length} hint="camera working" />
          <Stat label="Screens" value={d.screens.length} hint={`${d.screens.filter((s: any) => s.has_camera).length} with camera`} />
          <Stat label="Inventory value" value={inr(d.screens.reduce((s: number, x: any) => s + x.monthly_value, 0))} hint="per month at full sell-through" />
        </div>
        <SectionHead>By screen</SectionHead>
        <DataTable cols={[
          { label: 'Screen', render: (s: any) => <button onClick={() => go('s/' + s.id)} className="text-left font-medium text-primary hover:underline">{s.name}</button> },
          { label: 'Venue', render: (s: any) => <Badge variant="muted">{s.venue_type}</Badge> },
          { label: 'Play reports', num: true, render: (s: any) => d.plays.filter((p: any) => p.screen_id === s.id).length },
          { label: 'Avg people', num: true, sort: (s: any) => { const r = presFor(s.id); return r.length ? r.reduce((a: number, b: any) => a + b.avg_persons, 0) / r.length : -1; },
            render: (s: any) => { const r = presFor(s.id);
              return r.length ? <b>{(r.reduce((a: number, b: any) => a + b.avg_persons, 0) / r.length).toFixed(1)}</b> : <span className="text-muted-foreground">—</span>; } },
          { label: 'Last 7 days', render: (s: any) => <Spark data={trendScreen(s.id)} /> },
          ...(caps.includes('sales') ? [{ label: 'Monthly value', num: true, sort: (s: any) => s.monthly_value, render: (s: any) => inr(s.monthly_value) }] : []),
        ]} rows={d.screens} rowId={(s: any) => s.id} exportName="screen-performance"
          search={(s: any) => s.name} facets={[{ label: 'Venue', get: (s: any) => s.venue_type }]} />
        <div className="mt-4"><SoonPage title="Trends, dayparting and exports" note="Time-series charts, daypart breakdowns and CSV export are not built yet. The underlying play and presence data is already being collected." /></div>
      </>)}

      {['reports'].includes(view) && <><PageHead title="Reports" /><SoonPage title="Scheduled and exportable reports" note="Per-advertiser PDF and CSV reports on a schedule. Not built yet — campaign pages already carry the same numbers." /></>}
      {view === 'profile' && <ProfilePage user={user} onSaved={() => { const u = session.get(); if (u) setUser(u); reload(); }} />}
      {(view === 'settings' || view === 'set-org') && caps.includes('org') && <OrgPage d={d} user={user} onSaved={() => { const u = session.get(); if (u) setUser(u); reload(); }} />}
      {view === 'set-billing' && <PayoutPage d={d} user={user} onSaved={() => reload()} />}
      {view === 'set-team' && caps.includes('team') && <TeamPage user={user} orgId={user.org_id} boot={d} onChanged={() => reload()} />}
      {['set-api','set-hooks'].includes(view) && (<>
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
