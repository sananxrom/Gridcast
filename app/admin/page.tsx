'use client';
import { HistoryNotice } from '@/components/views/history-notice';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tabFor } from '@/lib/roles';
import { api, session, type SessionUser } from '@/lib/client';
import { inr, isLive, fmtDate, daySeries } from '@/lib/utils';
import { adminNav } from '@/lib/nav';
import { AppShell, PageHead, SectionHead, type Crumb } from '@/components/ui/app-shell';
import { DataTable, type BulkAction } from '@/components/ui/table';
import { InlineSelect } from '@/components/ui/popover';
import { Spark } from '@/components/ui/spark';
import { Stat, Progress } from '@/components/ui/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Field, Select } from '@/components/ui/input';
import { StatusBadge, Empty, SoonPage } from '@/components/views/bits';
import { ScreenDetail } from '@/components/views/screen-detail';
import { ScreenOnboarding } from '@/components/views/screen-onboarding';
import { GroupManager } from '@/components/views/groups';
import { CampaignDetail } from '@/components/views/campaign-detail';
import { CameraReadiness } from '@/components/views/camera-readiness';
import { CampaignList } from '@/components/views/campaign-list';
import { CampaignBuilder } from '@/components/views/campaign-builder';
import type { CmdItem } from '@/components/ui/command-palette';
import { BootLoader } from '@/components/ui/loader';
import { ConfigList, ConfigEditor } from '@/components/views/config-views';
import { Advertisers, AdvertiserDetail, Creatives } from '@/components/views/commercial';
import { ProfilePage, OrgPage, PayoutPage, TeamPage } from '@/components/views/account';
import { useDirtyForm, SaveBar } from '@/components/ui/form';

export default function Admin() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [d, setD] = useState<any>(null);
  const [view, setView] = useState('overview');
  const [editOrg, setEditOrg] = useState('');
  const [orgFilter, setOrgFilter] = useState('all');
  const [orgDirectory,setOrgDirectory]=useState<any[]>([]);
  const [loadError,setLoadError]=useState('');
  const request = useRef(0);
  const scopeRef = useRef('all');
  const load = useCallback(async (scope:string) => {
    const n=++request.current; setLoadError('');
    try { const data=await api('/bootstrap'+(scope==='all'?'':`?org=${encodeURIComponent(scope)}`));
      if(n===request.current)setD(data);
    } catch(e) { if(n===request.current)setLoadError((e as Error).message); }
  },[]);
  const loadOrgs = useCallback(async()=>{
    const items:any[]=[]; let after='';
    do { const page=await api('/directory?entity=orgs&limit=100'+(after?'&after='+encodeURIComponent(after):'')); items.push(...page.items); after=page.has_more?page.next_cursor:''; } while(after);
    setOrgDirectory(items);
  },[]);

  const reload = useCallback(async () => { if (user) await Promise.all([load(scopeRef.current),loadOrgs()]); }, [user,load,loadOrgs]);
  useEffect(() => {
    const u = session.get();
    if (!u || tabFor(u.role) !== 'platform') { location.href = '/'; return; }
    setUser(u); loadOrgs().catch(e=>setLoadError(e.message));
    const sync = () => {
      const next=new URLSearchParams(location.search).get('org')||'all';
      if(scopeRef.current!==next) {scopeRef.current=next;setOrgFilter(next);setD(null);load(next);}
      setView(location.hash.slice(1) || 'overview');
    };
    const initial=new URLSearchParams(location.search).get('org')||'all';scopeRef.current=initial;setOrgFilter(initial);load(initial);
    sync(); window.addEventListener('hashchange', sync); window.addEventListener('popstate',sync);
    return () => {window.removeEventListener('hashchange', sync);window.removeEventListener('popstate',sync);};
  }, []);
  const go = (g: string, ownerOverride?:string) => {
    const rows=g.startsWith('s/')?d?.screens:g.startsWith('c/')?d?.campaigns:g.startsWith('a/')?d?.advertisers:g.startsWith('cfg/')?d?.configs:null;
    const owner=ownerOverride??rows?.find((r:any)=>r.id===g.slice(g.startsWith('cfg/')?4:2))?.org_id;
    if(owner&&owner!==scopeRef.current){const url=new URL(location.href);url.searchParams.set('org',owner);url.hash=g;history.pushState(null,'',url);scopeRef.current=owner;setOrgFilter(owner);setView(g);setD(null);load(owner);return;}
    location.hash = g; setView(g);
  };
  const selectOrg=(id:string)=>{
    const url=new URL(location.href); if(id==='all')url.searchParams.delete('org');else url.searchParams.set('org',id);
    const current=location.hash.slice(1)||'overview';
    const next=current.startsWith('s/')?'screens':current.startsWith('c/')||current==='new'?'campaigns':current.startsWith('a/')?'advertisers':current.startsWith('cfg/')?'configs':current==='new-screen'?'screens':current;
    url.hash=next;history.pushState(null,'',url);scopeRef.current=id;setOrgFilter(id);setView(next);setEditOrg('');setD(null);load(id);
  };

  const cmdItems: CmdItem[] = useMemo(() => !d ? [] : [
    ...d.screens.map((s: any) => ({ id: s.id, label: s.name, sub: s.address, kind: 'screen', go: 's/' + s.id })),
    ...d.campaigns.map((c: any) => ({ id: c.id, label: c.name, sub: d.orgs.find((o: any) => o.id === c.org_id)?.name, kind: 'campaign', go: 'c/' + c.id })),
    ...d.advertisers.map((a: any) => ({ id: a.id, label: a.name, sub: a.category, kind: 'advertiser', go: 'a/' + a.id })),
  ], [d]);

  if (!user || !d) return loadError ? <Card className="m-6 p-5"><p role="alert">{loadError}</p><Button onClick={()=>load(scopeRef.current)}>Retry</Button><Button variant="outline" onClick={()=>selectOrg('all')}>All organisations</Button></Card> : <BootLoader />;

  const orgName = (id: string) => orgDirectory.find((o: any) => o.id === id)?.name ?? '—';
  const advName = (id: string) => d.advertisers.find((a: any) => a.id === id)?.name ?? '—';
  const byOrg = <T extends { org_id: string }>(rows: T[]) => orgFilter === 'all' ? rows : rows.filter(r => r.org_id === orgFilter);
  const pending = d.creatives.filter((c: any) => c.approval_status === 'pending');
  const offline = d.screens.filter((s: any) => s._status?.state === 'offline' || s._status?.state === 'stalled');
  const alerts = [
    ...offline.map((s: any) => ({ kind: 'Screen', tone: 'destructive', text: `${s.name} (${orgName(s.org_id)}) is ${s._status?.label}`, go: 's/' + s.id })),
    ...pending.map((c: any) => ({ kind: 'Approval', tone: 'warn', text: `${c.name} awaiting platform approval`, go: 'approvals' })),
  ];
  const nav = adminNav({ inbox: alerts.length, approvals: pending.length });
  const orgs = [{ id: 'all', name: 'All organisations', type: 'gridcast' }, ...orgDirectory.map((o: any) => ({ id: o.id, name: o.name, type: o.type }))];
  const currentOrg = orgs.find(o => o.id === orgFilter) ?? orgs[0];
  const titleOf: Record<string, string> = { overview: 'Overview', advertisers:'Advertisers', creatives:'Creatives', groups:'Screen groups', orgs: 'Organisations', screens: 'All screens', devices: 'Device health', campaigns: 'Campaigns', approvals: 'Approvals', inbox: 'Inbox', analytics: 'Analytics', profile: 'Profile', configs: 'Device configs', settings: 'Organisation', 'set-org': 'Organisation', 'set-api': 'API keys', 'set-hooks': 'Webhooks', 'set-billing': 'Billing & payouts', 'set-team': 'Team & users' };
  const trendScreen = (sid: string) => daySeries(
    d.presence.filter((x: any) => x.screen_id === sid && x.measured).map((x: any) => ({ at: x.at, value: x.avg_persons })));
  const setCampaign = async (c: any, patch: any) => { await api(`/campaign/${c.id}`, patch); reload(); };
  const STATUS_CHOICES = [
    { value: 'active', label: 'Active', dot: 'hsl(var(--ok))' },
    { value: 'paused', label: 'Paused', dot: 'hsl(var(--warn))' },
    { value: 'complete', label: 'Complete', dot: 'hsl(var(--muted-foreground))' },
  ];
  const restoreStatus = async (rows: any[]) => { for (const c of rows) await api(`/campaign/${c.id}`, { status: c.status }); };
  const campaignBulk: BulkAction<any>[] = [
    { label: 'Pause', run: async rows => { for (const c of rows) await api(`/campaign/${c.id}`, { status: 'paused' }); }, undo: restoreStatus },
    { label: 'Resume', run: async rows => { for (const c of rows) await api(`/campaign/${c.id}`, { status: 'active' }); }, undo: restoreStatus },
  ];
  const screenBulk: BulkAction<any>[] = [
    { label: 'Activate', run: async rows => { for (const x of rows) await api(`/screen/${x.id}`, { status: 'active' }); },
      undo: async rows => { for (const x of rows) await api(`/screen/${x.id}`, { status: x.status }); } },
    { label: 'Pause', run: async rows => { for (const x of rows) await api(`/screen/${x.id}`, { status: 'paused' }); },
      undo: async rows => { for (const x of rows) await api(`/screen/${x.id}`, { status: x.status }); },
      confirm: 'Pause {n} screen(s) across the fleet?' },
  ];
  const nameOf = (arr: any[], id: string, fb: string) => arr.find((x: any) => x.id === id)?.name ?? fb;
  const trail: Crumb[] = (() => {
    const root = { label: currentOrg.name, go: 'overview' };
    if (view.startsWith('s/')) return [root, { label: 'All screens', go: 'screens' }, nameOf(d.screens, view.slice(2), 'Screen')];
    if (view.startsWith('c/')) return [root, { label: 'Campaigns', go: 'campaigns' }, nameOf(d.campaigns, view.slice(2), 'Campaign')];
    if (view.startsWith('a/')) return [root, { label: 'Advertisers', go: 'advertisers' }, nameOf(d.advertisers, view.slice(2), 'Advertiser')];
    if (view.startsWith('cfg/')) return [root, { label: 'Device configs', go: 'configs' }, 'Config'];
    if (view.startsWith('set-') || view === 'settings') return [root, 'Settings', titleOf[view] ?? 'Settings'];
    if (view === 'overview') return [root];
    return [root, titleOf[view] ?? 'Overview'];
  })();

  return (
    <AppShell groups={nav.groups} bottom={nav.bottom} activeId={view} onSelect={go}
      orgs={orgs} currentOrg={currentOrg} onOrgSelect={selectOrg}
      breadcrumb={trail} cmdItems={cmdItems} onGo={go}
      user={{ name: user.name, role: user.role }}>

      <div key={orgFilter}>
      {loadError&&<p role="alert" className="mb-4 text-sm text-destructive">{loadError}</p>}
      <p className="mb-4 text-xs text-muted-foreground">Working in: <b>{currentOrg.name}</b> · Signed in as {user.name}, platform administrator</p>
      {d.pagination?.partial&&<Card className="mb-4 p-4 text-sm">Showing a limited directory page. Counts and spend below cover loaded records only. Select an organisation for its operational view.</Card>}
      <HistoryNotice history={d.history} />
      {view==='advertisers'&&<Advertisers d={{...d,orgs:orgDirectory}} user={user} orgId={orgFilter==='all'?null:orgFilter} onGo={go} onChanged={reload}/>}
      {view.startsWith('a/')&&<AdvertiserDetail key={view} id={view.slice(2)} d={{...d,orgs:orgDirectory}} user={user} orgId={orgFilter==='all'?null:orgFilter} onGo={go} onChanged={reload}/>}
      {view==='creatives'&&<Creatives d={{...d,orgs:orgDirectory}} user={user} orgId={orgFilter==='all'?null:orgFilter} onChanged={reload}/>}
      {view === 'configs' && <ConfigList user={user} orgId={orgFilter==='all'?null:orgFilter} onOpen={(id,owner) => go('cfg/' + id,owner)} onChanged={() => reload()} />}
      {view.startsWith('cfg/') && orgFilter==='all' && <Empty>Select an organisation to open its configuration.</Empty>}
      {view.startsWith('cfg/') && orgFilter!=='all' && <ConfigEditor id={view.slice(4)} user={user} orgId={orgFilter==='all'?null:orgFilter} onGo={go} onChanged={() => reload()} />}

      {view === 'groups' && orgFilter==='all' && <Empty>Select an organisation above to manage its screen groups.</Empty>}
      {view === 'groups' && orgFilter!=='all' && <GroupManager boot={{...d,orgs:orgDirectory}} user={user} orgId={orgFilter==='all'?null:orgFilter} onChanged={reload} />}
      {view === 'new-screen' && orgFilter==='all' && <Empty>Select an organisation above to register a screen.</Empty>}
      {view === 'new-screen' && orgFilter!=='all' && <ScreenOnboarding boot={{...d,orgs:orgDirectory}} user={user} orgId={orgFilter==='all'?null:orgFilter} onGo={go} onDone={async(s:any)=>{await reload();go('s/'+s.id);}} />}
      {view.startsWith('s/') && orgFilter!=='all' && !d.screens.some((s:any)=>s.id===view.slice(2)&&s.org_id===orgFilter) && <Empty>This screen is outside the selected organisation. Select its organisation before opening it.</Empty>}
      {view.startsWith('s/') && (orgFilter==='all'||d.screens.some((s:any)=>s.id===view.slice(2)&&s.org_id===orgFilter)) && <ScreenDetail id={view.slice(2)} onGo={go} onChanged={reload} />}
      {view.startsWith('c/') && orgFilter!=='all' && !d.campaigns.some((c:any)=>c.id===view.slice(2)) && <Empty>This campaign is outside the selected organisation. Select its organisation before opening it.</Empty>}
      {view.startsWith('c/') && (orgFilter==='all'||d.campaigns.some((c:any)=>c.id===view.slice(2))) && <CampaignDetail id={view.slice(2)} boot={d} onGo={go} onChanged={reload} />}
      {view === 'new' && <CampaignBuilder boot={d} user={user} orgId={orgFilter==='all'?null:orgFilter} onGo={go} onDone={async (c: any) => { await reload(); go('c/' + c.id); }} />}

      {view === 'overview' && (() => {
        const measured = d.presence.filter((p: any) => p.measured);
        return (<>
          <PageHead title="Platform overview" sub={`${d.screens.length} screens · ${d.orgs.length - 1} operators · ${d.campaigns.filter(isLive).length} live campaigns`} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Screens" value={d.screens.length} hint={`${d.screens.filter((s: any) => s._status?.state === 'live').length} on air`} />
            <Stat label="Play reports" value={d.plays.length.toLocaleString('en-IN')} hint="across network" />
            <Stat label="Avg people / play" value={measured.length ? (measured.reduce((a: number, b: any) => a + b.avg_persons, 0) / measured.length).toFixed(1) : '—'} hint={`${measured.length} measured`} />
            <Stat label="Spend accrued" value={inr(d.campaigns.reduce((s: number, c: any) => s + c.accrued_spend, 0))} hint={`of ${inr(d.campaigns.reduce((s: number, c: any) => s + c.committed_budget, 0))} committed`} />
          </div>
          <SectionHead>Recent plays</SectionHead>
          <DataTable cols={[
            { label: 'When', render: (r: any) => <span className="font-mono text-[12px] text-muted-foreground">{fmtDate(r.ended_at, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> },
            { label: 'Screen', render: (r: any) => d.screens.find((s: any) => s.id === r.screen_id)?.name ?? '—' },
            { label: 'Creative', render: (r: any) => d.creatives.find((c: any) => c.id === r.creative_id)?.name ?? '—' },
            { label: 'People', num: true, render: (r: any) => { const p = d.presence.find((x: any) => x.play_id === r.id);
              return p?.measured ? <b>{p.avg_persons.toFixed(1)}</b> : <span className="text-muted-foreground">not measured</span>; } },
            { label: 'Org', render: (r: any) => <span className="text-muted-foreground">{orgName(r.org_id)}</span> },
          ]} rows={d.plays.slice(-12).reverse()} rowId={(r: any) => r.id} exportName="recent-plays" empty="No plays yet — open a player and pair a screen." />
        </>);
      })()}

      {view === 'orgs' && (<>
        <PageHead title="Organisations" sub={`Gridcast plus ${d.orgs.length - 1} operators`} actions={<AddOrg onAdded={reload} />} />
        <DataTable cols={[
          { label: 'Organisation', render: (o: any) => <><div className="font-medium">{o.name}</div><div className="font-mono text-[11.5px] text-muted-foreground">{o.id}</div></> },
          { label: 'Type', render: (o: any) => <Badge variant={o.type === 'gridcast' ? 'default' : 'muted'}>{o.type}</Badge> },
          { label: 'Screens', num: true, render: (o: any) => d.screens.filter((s: any) => s.org_id === o.id).length },
          { label: 'Advertisers', num: true, render: (o: any) => d.advertisers.filter((a: any) => a.org_id === o.id).length },
          { label: 'Platform fee', num: true, render: (o: any) => o.type === 'gridcast' ? <span className="text-muted-foreground">—</span> : `${o.platform_fee_pct}%` },
          { label: 'Own inventory', render: (o: any) => o.type === 'gridcast' ? <span className="text-muted-foreground">—</span> : <Badge variant="ok">0% — free tier</Badge> },
          { label: '', render: (o: any) => o.type === 'gridcast' ? null : <button onClick={() => setEditOrg(o.id)} className="text-[12px] font-medium text-primary hover:underline">Edit</button> },
        ]} rows={d.orgs} rowId={(o: any) => o.id} exportName="organisations" />
        {editOrg && <EditOrg org={d.orgs.find((o: any) => o.id === editOrg)} onDone={() => { setEditOrg(''); reload(); }} />}
        <Card className="mt-3 border-primary/25 bg-primary/[0.04] p-3.5 text-[12.5px] text-primary">
          <b>Zero cut on operator-sold campaigns.</b> The platform fee applies only to network campaigns — where Gridcast brings the advertiser onto an operator&apos;s released slots.
        </Card>
      </>)}

      {view === 'screens' && (<>
        <PageHead title="All screens" sub={orgFilter === 'all' ? 'Every screen across every organisation' : `Filtered to ${currentOrg.name}`} actions={<><Button variant="outline" onClick={()=>go('groups')}>Screen groups</Button><Button onClick={()=>go('new-screen')}>Add screen</Button></>} />
        <DataTable cols={[
          { className: 'min-w-[168px]', label: 'Screen', sort: (s: any) => s.name, render: (s: any) => <><button onClick={() => go('s/' + s.id)} className="text-left font-medium text-primary hover:underline">{s.name}</button><div className="text-[12px] text-muted-foreground">{s.address}</div></> },
          { label: 'Org', render: (s: any) => <span className="text-muted-foreground">{orgName(s.org_id)}</span> },
          { label: 'Type', render: (s: any) => <><Badge variant="muted">{s.venue_type}</Badge> <span className="text-[12px] text-muted-foreground">{s.size_in}&quot;</span></> },
          { label: 'State', sort: (s: any) => s._status?.state, render: (s: any) => <StatusBadge st={s._status??{state:'unknown',label:'Not loaded — open organisation'}} /> },
          { label: 'Camera readiness', render: (s:any) => <CameraReadiness screen={s} devices={d.devices}/> },
          { label: 'Running', num: true, render: (s: any) => { const n = d.campaigns.filter((c: any) => c.screen_ids.includes(s.id) && isLive(c)).length;
            return n ? <><b>{n}</b> <span className="text-muted-foreground">campaigns</span></> : <span className="text-muted-foreground">idle</span>; } },
          { label: 'People / play', render: (s: any) => <Spark data={trendScreen(s.id)} /> },
          { label: 'Monthly', num: true, sort: (s: any) => s.monthly_value, render: (s: any) => inr(s.monthly_value) },
        ]} rows={byOrg(d.screens)} rowId={(s: any) => s.id} exportName="all-screens" onDone={reload} bulk={screenBulk}
          search={(s: any) => `${s.name} ${s.venue_name} ${s.address}`}
          facets={[{ label: 'State', get: (s: any) => s._status?.state }, { label: 'Venue', get: (s: any) => s.venue_type },
                   { label: 'Org', get: (s: any) => orgName(s.org_id) }]} />
      </>)}

      {view==='campaigns'&&<div className="mb-3 text-right"><a className="text-sm text-primary" href="/admin/demo">Set up the brand demo →</a></div>}
      {view==='campaigns'&&<CampaignList d={{...d,orgs:orgDirectory}} orgId={orgFilter==='all'?null:orgFilter} onGo={go} onChanged={reload}/>}

      {view === 'approvals' && (<>
        <PageHead title="Creative approvals" sub={`${pending.length} awaiting review · platform policy gate`} />
        <DataTable cols={[
          { label: 'Creative', render: (c: any) => <><div className="font-medium">{c.name}</div><div className="text-[12px] text-muted-foreground">{advName(c.advertiser_id)} · {orgName(c.org_id)}</div></> },
          { label: 'Category', render: (c: any) => <Badge variant="muted">{c.category}</Badge> },
          { label: 'Source', render: (c: any) => <span className="text-[12px] text-muted-foreground">{c.content_source}</span> },
          { label: 'Status', render: (c: any) => <Badge variant={c.approval_status === 'approved' ? 'ok' : c.approval_status === 'rejected' ? 'destructive' : 'warn'}>{c.approval_status}</Badge> },
          { label: '', render: (c: any) => c.approval_status === 'pending'
            ? <div className="flex gap-1.5"><Button size="sm" onClick={async () => { await api(`/creative/${c.id}/approve`, { status: 'approved' }); reload(); }}>Approve</Button>
                <Button size="sm" variant="outline" onClick={async () => { await api(`/creative/${c.id}/approve`, { status: 'rejected' }); reload(); }}>Reject</Button></div>
            : <span className="text-muted-foreground">—</span> },
        ]} rows={byOrg(d.creatives)} rowId={(c: any) => c.id} exportName="approvals" onDone={reload}
          search={(c: any) => c.name}
          facets={[{ label: 'Status', get: (c: any) => c.approval_status }, { label: 'Org', get: (c: any) => orgName(c.org_id) }]}
          bulk={[
          { label: 'Approve', run: async (rows: any[]) => { for (const c of rows) await api(`/creative/${c.id}/approve`, { status: 'approved' }); } },
          { label: 'Reject', variant: 'outline' as const, run: async (rows: any[]) => { for (const c of rows) await api(`/creative/${c.id}/approve`, { status: 'rejected' }); },
            confirm: 'Reject {n} creative(s)?' },
        ]} />
      </>)}

      {view === 'devices' && (<>
        <PageHead title="Device health" sub="Paired players across the fleet" />
        <DataTable cols={[
          { label: 'Screen', render: (v: any) => { const s = d.screens.find((x: any) => x.id === v.screen_id);
            return <><button onClick={() => go('s/' + v.screen_id)} className="text-left font-medium text-primary hover:underline">{s?.name ?? '—'}</button><div className="font-mono text-[11.5px] text-muted-foreground">{v.id}</div></>; } },
          { label: 'Org', render: (v: any) => <span className="text-muted-foreground">{orgName(v.org_id)}</span> },
          { label: 'Status', render: (v: any) => { const s = d.screens.find((x: any) => x.id === v.screen_id); return <StatusBadge st={s?._status??{state:'unknown',label:'Not loaded'}} />; } },
          { label: 'Last heartbeat', render: (v: any) => <span className="font-mono text-[12px] text-muted-foreground">{fmtDate(v.last_heartbeat_at)}</span> },
          { label: 'Play reports', num: true, render: (v: any) => d.plays.filter((p: any) => p.screen_id === v.screen_id).length },
          { label: 'App', render: (v: any) => <span className="font-mono text-[12px] text-muted-foreground">v{v.app_ver}</span> },
        ]} rows={byOrg(d.devices)} rowId={(x: any) => x.id} exportName="devices" empty="No devices paired yet. Open /player and enter a screen code."
          facets={[{ label: 'Status', get: (x: any) => x.status }]} />
      </>)}

      {view === 'inbox' && (<>
        <PageHead title="Inbox" sub={`${alerts.length} thing${alerts.length === 1 ? '' : 's'} needing attention`} />
        {alerts.length ? <DataTable cols={[
          { label: 'Type', render: (a: any) => <Badge variant={a.tone as any}>{a.kind}</Badge> },
          { label: 'Alert', render: (a: any) => a.text },
          { label: '', render: (a: any) => <Button variant="ghost" size="sm" onClick={() => go(a.go)}>Open →</Button> },
        ]} rows={alerts} /> : <Empty>Nothing needs attention across the platform.</Empty>}
      </>)}

      {view === 'analytics' && (<>
        <PageHead title="Analytics" sub="Network-wide delivery and presence" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Organisations" value={d.orgs.length} />
          <Stat label="Screens" value={d.screens.length} hint={`${d.screens.filter((s: any) => s.has_camera).length} with camera`} />
          <Stat label="Play reports" value={d.plays.length.toLocaleString('en-IN')} />
          <Stat label="Network inventory" value={inr(d.screens.reduce((s: number, x: any) => s + x.monthly_value, 0))} hint="per month at full sell-through" />
        </div>
        <SectionHead>By organisation</SectionHead>
        <DataTable cols={[
          { label: 'Organisation', render: (o: any) => <span className="font-medium">{o.name}</span> },
          { label: 'Screens', num: true, render: (o: any) => d.screens.filter((s: any) => s.org_id === o.id).length },
          { label: 'Live campaigns', num: true, render: (o: any) => d.campaigns.filter((c: any) => c.org_id === o.id && isLive(c)).length },
          { label: 'Accrued', num: true, render: (o: any) => inr(d.campaigns.filter((c: any) => c.org_id === o.id).reduce((s: number, c: any) => s + c.accrued_spend, 0)) },
          { label: 'Inventory', num: true, render: (o: any) => inr(d.screens.filter((s: any) => s.org_id === o.id).reduce((s: number, x: any) => s + x.monthly_value, 0)) },
        ]} rows={d.orgs} rowId={(o: any) => o.id} exportName="org-performance" />
        <div className="mt-4"><SoonPage title="Trends and cohorts" note="Time-series, venue-type benchmarks and exports are not built yet." /></div>
      </>)}

      {view === 'profile' && <ProfilePage user={user} onSaved={() => { const u = session.get(); if (u) setUser(u); reload(); }} />}
      {view === 'set-team' && <TeamPage user={user} boot={{...d,orgs:orgDirectory}} orgId={orgFilter==='all'?null:orgFilter} onChanged={reload} />}
      {(view === 'settings' || view === 'set-org') && orgFilter!=='all' && <OrgPage d={{...d,org:orgDirectory.find(o=>o.id===orgFilter)}} user={user} orgId={orgFilter} onSaved={reload}/> }
      {view==='set-billing' && (orgFilter==='all'?<Empty>Select an organisation to manage its payouts.</Empty>:<PayoutPage d={{...d,org:orgDirectory.find(o=>o.id===orgFilter)}} user={user} orgId={orgFilter} onSaved={reload}/>)}
      {(view === 'settings' || view === 'set-org') && orgFilter==='all' && <PlatformSettings d={d} onSaved={() => { const u = session.get(); if (u) setUser(u); reload(); }} />}
      {['set-api','set-hooks'].includes(view) && <><PageHead title="Settings" /><SoonPage title="Not built yet" note="API keys and webhooks are planned but not implemented." /></>}
      {['screens','advertisers','creatives','campaigns','orgs','devices'].includes(view)&&d.pagination?.[view]?.has_more&&<Button className="mt-4" variant="outline" onClick={async()=>{const generation=request.current,scope=scopeRef.current,entity=view;try{const page=await api(`/directory?entity=${view}&limit=100&after=${encodeURIComponent(d.pagination[view].next_cursor)}`+(orgFilter==='all'?'':`&org=${encodeURIComponent(orgFilter)}`));if(generation!==request.current||scope!==scopeRef.current)return;setD((old:any)=>({...old,[entity]:[...old[entity],...page.items.filter((x:any)=>!old[entity].some((r:any)=>r.id===x.id))],pagination:{...old.pagination,[entity]:page}}));}catch(e){setLoadError((e as Error).message);}}}>Load more {view}</Button>}
      </div>
    </AppShell>
  );
}

function AddOrg({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', admin_name: '', admin_email: '', platform_fee_pct: '10' });
  const [temp, setTemp] = useState<{ email: string; pw: string } | null>(null);
  if (!open) return <Button onClick={() => setOpen(true)}>+ Add operator</Button>;
  if (temp) return (
    <Card className="absolute right-8 z-30 w-[min(560px,90vw)] p-5 shadow-xl">
      <h3 className="text-[14px] font-semibold">Operator created</h3>
      <p className="mb-3 mt-1 text-[12.5px] text-muted-foreground">
        Hand these over yourself — the password is shown once and cannot be recovered.
        They will be asked to choose their own on first sign-in.
      </p>
      <div className="rounded-lg border border-border bg-muted/60 p-3 font-mono text-[13px]">
        <div>{temp.email}</div>
        <div className="mt-1 text-[17px] font-semibold tracking-wider text-primary">{temp.pw}</div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => { navigator.clipboard?.writeText(`${temp.email} / ${temp.pw}`).catch(() => {}); }}>Copy</Button>
        <Button variant="outline" onClick={() => { setTemp(null); setOpen(false); onAdded(); }}>Done</Button>
      </div>
    </Card>
  );
  return (
    <Card className="absolute right-8 z-30 w-[min(560px,90vw)] p-5 shadow-xl">
      <h3 className="mb-3 text-[14px] font-semibold">New operator organisation</h3>
      <div className="flex flex-wrap gap-3">
        <Field label="Organisation name"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Mohali Media" /></Field>
        <Field label="Admin name"><Input value={f.admin_name} onChange={e => setF({ ...f, admin_name: e.target.value })} /></Field>
        <Field label="Admin email"><Input value={f.admin_email} onChange={e => setF({ ...f, admin_email: e.target.value })} /></Field>
        <Field label="Platform fee %"><Input type="number" value={f.platform_fee_pct} onChange={e => setF({ ...f, platform_fee_pct: e.target.value })} /></Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={async () => {
          const r = await api('/org', { name: f.name || 'Untitled operator', admin_name: f.admin_name, admin_email: f.admin_email, platform_fee_pct: Number(f.platform_fee_pct) || 10 });
          if (r?.temp_password) setTemp({ email: f.admin_email, pw: r.temp_password });
          else { setOpen(false); onAdded(); }
        }}>Create</Button>
        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </Card>
  );
}

function PlatformSettings({ d, onSaved }: { d: any; onSaved: () => void }) {
  const st = d.settings || {};
  const fm = useDirtyForm({
    platform_name: st.platform_name ?? 'Gridcast',
    default_fee_pct: String(st.default_fee_pct ?? 10),
    support_email: st.support_email ?? '',
  });
  return (<>
    <PageHead title="Organisation" sub="Gridcast platform settings" />
    <Card className="p-5">
      <div className="flex flex-wrap gap-3">
        <Field label="Platform name"><Input value={fm.f.platform_name} onChange={e => fm.set({ platform_name: e.target.value })} /></Field>
        <Field label="Default operator fee %"><Input type="number" value={fm.f.default_fee_pct} onChange={e => fm.set({ default_fee_pct: e.target.value })} /></Field>
        <Field label="Support email"><Input value={fm.f.support_email} onChange={e => fm.set({ support_email: e.target.value })} /></Field>
      </div>
      <p className="mt-3 text-[12.5px] text-muted-foreground">The default fee applies to new organisations. Existing operators keep the rate on their own record.</p>
    </Card>
    <SaveBar {...fm} onSave={() => fm.save(async v => {
      await api('/settings', { ...v, default_fee_pct: Number(v.default_fee_pct) || 0 });
      onSaved();
    })} onDiscard={fm.discard} />
  </>);
}


function EditOrg({ org, onDone }: { org: any; onDone: () => void }) {
  const fm = useDirtyForm({ name: org?.name ?? '', platform_fee_pct: String(org?.platform_fee_pct ?? 0), status: org?.status ?? 'active' });
  if (!org) return null;
  return (
    <Card className="mt-3 border-primary/40 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[14px] font-semibold">Edit {org.name}</h3>
        <Button variant="ghost" size="sm" onClick={onDone}>Close</Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Field label="Organisation name"><Input value={fm.f.name} onChange={e => fm.set({ name: e.target.value })} /></Field>
        <Field label="Platform fee % (network campaigns only)"><Input type="number" value={fm.f.platform_fee_pct} onChange={e => fm.set({ platform_fee_pct: e.target.value })} /></Field>
        <Field label="Status"><Select value={fm.f.status} onChange={e => fm.set({ status: e.target.value })}>
          <option value="active">active</option><option value="paused">paused</option>
        </Select></Field>
      </div>
      <SaveBar {...fm} note="The operator sees this fee on their own settings page." onSave={() => fm.save(async v => {
        await api(`/org/${org.id}`, { name: v.name, status: v.status, platform_fee_pct: Number(v.platform_fee_pct) || 0 });
        onDone();
      })} onDiscard={fm.discard} />
    </Card>
  );
}
