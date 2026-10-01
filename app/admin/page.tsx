'use client';
import { DeliveryReport, useDeliveryReport } from '@/components/views/delivery-report';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tabFor } from '@/lib/roles';
import { api, session, type SessionUser } from '@/lib/client';
import { inr, isLive, fmtDate } from '@/lib/utils';
import { adminNav } from '@/lib/nav';
import { AppShell, PageHead, SectionHead, type Crumb } from '@/components/ui/app-shell';
import { DataTable, type BulkAction } from '@/components/ui/table';
import { InlineSelect } from '@/components/ui/popover';
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
import { approvalAlerts, blockedAlerts, campaignStateSummary, campaignStatus } from '@/lib/campaign-status';
import { useCampaignEvidence, useNow, usePeriodicRefresh } from '@/components/views/campaign-status-badge';
import { ReportSummary } from '@/components/views/report-summary';
import { CampaignFlow } from '@/components/views/campaign-flow';
import type { CmdItem } from '@/components/ui/command-palette';
import { BootLoader } from '@/components/ui/loader';
import { ConfigList, ConfigEditor } from '@/components/views/config-views';
import { Advertisers, AdvertiserDetail, Creatives } from '@/components/views/commercial';
import { ProfilePage, OrgPage, PayoutPage, TeamPage } from '@/components/views/account';
import { useDirtyForm, SaveBar } from '@/components/ui/form';
import { TabList, TabPanel } from '@/components/ui/tabs';
import { Thumb } from '@/components/views/bits';
import { campaignInterval } from '@/lib/inventory';

export default function Admin() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [d, setD] = useState<any>(null);
  const [view, setView] = useState('overview');
  const [editOrg, setEditOrg] = useState('');
  const [orgFilter, setOrgFilter] = useState('all');
  const report = useDeliveryReport({ org: orgFilter === 'all' ? undefined : orgFilter, enabled: !!user && ['overview', 'screens', 'devices', 'analytics'].includes(view) });
  // Overview campaign counts use Phase 1 status, which needs the recent delivery-evidence summary for Live.
  const evidence = useCampaignEvidence(orgFilter === 'all' ? null : orgFilter, !!user && view === 'overview');
  const now = useNow();
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
  // Screen _status is a bootstrap snapshot; refresh it while campaign status is on screen.
  usePeriodicRefresh(() => load(scopeRef.current), !!user && (view === 'campaigns' || view.startsWith('c/')));
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
    // `new:a:<id>` opens the builder for an advertiser; switch scope to its organisation like `a/` links do.
    const rows=g.startsWith('s/')?d?.screens:g.startsWith('c/')?d?.campaigns:g.startsWith('a/')||g.startsWith('new:a:')?d?.advertisers:g.startsWith('cfg/')?d?.configs:null;
    const owner=ownerOverride??rows?.find((r:any)=>r.id===g.slice(g.startsWith('cfg/')?4:g.startsWith('new:a:')?6:2))?.org_id;
    if(owner&&owner!==scopeRef.current){switchScope(owner,g);return;}
    location.hash = g; setView(g);
  };
  function switchScope(owner:string,g:string){const url=new URL(location.href);url.searchParams.set('org',owner);url.hash=g;history.pushState(null,'',url);scopeRef.current=owner;setOrgFilter(owner);setView(g);setD(null);load(owner);}
  // Direct links to `#new:a:<id>` under "All organisations": move to the advertiser's organisation so the builder can pre-fill.
  useEffect(()=>{
    if(!d||!view.startsWith('new:a:')||scopeRef.current!=='all')return;
    const owner=d.advertisers?.find((a:any)=>a.id===view.slice(6))?.org_id;
    if(owner)switchScope(owner,view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[d,view]);
  const selectOrg=(id:string)=>{
    const url=new URL(location.href); if(id==='all')url.searchParams.delete('org');else url.searchParams.set('org',id);
    const current=location.hash.slice(1)||'overview';
    const next=current.startsWith('s/')?'screens':current.startsWith('c/')||current==='new'||current.startsWith('new:a:')||current.startsWith('draft:')?'campaigns':current.startsWith('a/')?'advertisers':current.startsWith('cfg/')?'configs':current==='new-screen'?'screens':current;
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
  const queueCount = reviewQueueCount(d);
  const offline = d.screens.filter((s: any) => s._status?.state === 'offline' || s._status?.state === 'stalled');
  const measurementAlerts = d.screens.flatMap((screen:any) => {
    const device = d.devices?.find((v:any)=>v.screen_id===screen.id && v.status!=='revoked');
    const vision = device?.vision;
    if (!screen.has_camera || !vision || !Number.isFinite(Date.parse(vision.reported_at)) || Date.now()-Date.parse(vision.reported_at)>300000) return [];
    if (vision.camera_state!=='unavailable' && vision.model_state!=='error') return [];
    return [{ kind:'Measurement', tone:'warn', text:`${screen.name}: device reports ${vision.camera_state==='unavailable'?'camera unavailable':'detector error'}`, go:'s/'+screen.id }];
  });
  const alerts = [
    ...measurementAlerts,
    ...offline.map((s: any) => ({ kind: 'Screen', tone: 'destructive', text: `${s.name} (${orgName(s.org_id)}) is ${s._status?.label}`, go: 's/' + s.id })),
    ...approvalAlerts(d, pending, 'approvals', (c: any) => `${c.name} awaiting platform review`).map(a => ({ ...a, go: 'approvals' })),
    ...blockedAlerts(d),
  ];
  const nav = adminNav({ inbox: alerts.length, approvals: queueCount });
  const orgs = [{ id: 'all', name: 'All organisations', type: 'gridcast' }, ...orgDirectory.map((o: any) => ({ id: o.id, name: o.name, type: o.type }))];
  const currentOrg = orgs.find(o => o.id === orgFilter) ?? orgs[0];
  const titleOf: Record<string, string> = { overview: 'Overview', advertisers:'Advertisers', creatives:'Creatives', groups:'Screen groups', orgs: 'Organisations', screens: 'All screens', devices: 'Device health', campaigns: 'Campaigns', approvals: 'Review queue', inbox: 'Inbox', analytics: 'Analytics', profile: 'Profile', configs: 'Device configs', settings: 'Organisation', 'set-org': 'Organisation', 'set-api': 'API keys', 'set-hooks': 'Webhooks', 'set-billing': 'Billing & payouts', 'set-team': 'Team & users' };
  const screenPeople = (id: string) => { const r = report.data?.byScreen[id]; return r?.presence_n ? (r.presence_sum / r.presence_n).toFixed(1) : '—'; };
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
    if (view.startsWith('new:a:')) return [root, { label: 'Advertisers', go: 'advertisers' }, { label: nameOf(d.advertisers, view.slice(6), 'Advertiser'), go: 'a/' + view.slice(6) }, 'New campaign'];
    if (view === 'new') return [root, { label: 'Campaigns', go: 'campaigns' }, 'New campaign'];
    if (view.startsWith('draft:')) return [root, { label: 'Campaigns', go: 'campaigns' }, 'Campaign draft'];
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
      {d.pagination?.partial&&<Card className="mb-4 p-4 text-sm">Showing a limited directory page. Directory counts and lifetime spend cover loaded entities only. The dated delivery report separately loads all summaries in scope. Select an organisation for its operational view.</Card>}
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
      {(view === 'new' || view.startsWith('new:a:') || view.startsWith('draft:')) && <CampaignFlow key={view} boot={d} user={user} orgId={orgFilter==='all'?null:orgFilter} advertiserId={view.startsWith('new:a:') ? view.slice(6) : undefined} draftId={view.startsWith('draft:') ? view.slice(6) : undefined} onGo={go} onChanged={reload} onDone={async (c: any) => { await reload(); go('c/' + c.id); }} />}

      {view === 'overview' && (<>
        <PageHead title="Platform overview" sub={`${d.screens.length} loaded screens · ${campaignStateSummary(d.campaigns.map((c: any) => campaignStatus({ campaign: c, creatives: d.creatives, screens: d.screens, advertiser: d.advertisers.find((a: any) => a.id === c.advertiser_id), reportScreens: evidence.loaded ? (evidence.campaignScreens[c.id] ?? {}) : null, reportLoaded: evidence.loaded, now })), evidence).text}`} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat metric="live_screen_count" period={{from:'',to:'',label:'Current loaded records'}} label="Screens on air now" value={`${d.screens.filter((s: any) => s._status?.state === 'live').length}/${d.screens.length}`} hint="Current device status · loaded inventory" />
          <Stat metric="current_exceptions" period={{from:'',to:'',label:'Current loaded records'}} label="Needs attention" value={alerts.length} hint="Screen, measurement and approval exceptions" />
          <Stat metric="recorded_campaign_accrual" period={{from:'',to:'',label:'Campaign lifetime · visible records'}} label="Lifetime accrued" value={d.campaigns.some((c:any)=>typeof c.accrued_spend!=='number')?'—':inr(d.campaigns.reduce((sum: number, c: any) => sum + c.accrued_spend, 0))} hint="Loaded campaigns · independent of report dates" />
        </div>
        <SectionHead>Needs attention</SectionHead>
        <DataTable cols={[
          { label: 'Type', render: (a: any) => <Badge variant={a.tone as any}>{a.kind}</Badge> },
          { label: 'Issue', render: (a: any) => a.text },
          { label: '', render: (a: any) => <Button variant="ghost" size="sm" onClick={() => go(a.go)}>Open →</Button> },
        ]} rows={alerts} empty="No screen, measurement or approval exceptions in the loaded inventory." />
        <ReportSummary report={report} metadata={{ byScreen: d.screens, byCampaign: d.campaigns, byCreative: d.creatives }} onOpen={() => go('analytics')} />
      </>)}

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
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field label="From (IST)"><Input aria-label="Screen delivery from" type="date" value={report.period.from} onChange={e=>report.setPeriod({...report.period,from:e.target.value})}/></Field>
          <Field label="To (IST)"><Input aria-label="Screen delivery to" type="date" value={report.period.to} onChange={e=>report.setPeriod({...report.period,to:e.target.value})}/></Field>
          <Button variant="outline" onClick={report.reload} disabled={report.loading}>{report.loading?'Loading…':'Refresh delivery'}</Button>
        </div>
        {report.error && <p role="alert" className="mb-3 text-sm text-destructive">{report.error}</p>}
        <p className="mb-3 text-xs text-muted-foreground">Presence: {report.period.from} to {report.period.to} (IST). {report.data?.coverage.complete ? 'Daily summary coverage is complete.' : 'Coverage is partial or unavailable; — means no measured summary.'}</p>
        <DataTable cols={[
          { className: 'min-w-[168px]', label: 'Screen', sort: (s: any) => s.name, render: (s: any) => <><button onClick={() => go('s/' + s.id)} className="text-left font-medium text-primary hover:underline">{s.name}</button><div className="text-[12px] text-muted-foreground">{s.address}</div></> },
          { label: 'Org', render: (s: any) => <span className="text-muted-foreground">{orgName(s.org_id)}</span> },
          { label: 'Type', render: (s: any) => <><Badge variant="muted">{s.venue_type}</Badge> <span className="text-[12px] text-muted-foreground">{s.size_in}&quot;</span></> },
          { label: 'State', sort: (s: any) => s._status?.state, render: (s: any) => <StatusBadge st={s._status??{state:'unknown',label:'Not loaded — open organisation'}} /> },
          { label: 'Camera readiness', render: (s:any) => <CameraReadiness screen={s} devices={d.devices}/> },
          { label: 'Running', num: true, render: (s: any) => { const n = d.campaigns.filter((c: any) => c.screen_ids.includes(s.id) && isLive(c)).length;
            return n ? <><b>{n}</b> <span className="text-muted-foreground">campaigns</span></> : <span className="text-muted-foreground">idle</span>; } },
          { label: 'People / measured paid play', render: (s: any) => screenPeople(s.id) },
          { label: 'Monthly', num: true, sort: (s: any) => s.monthly_value, render: (s: any) => inr(s.monthly_value) },
        ]} rows={byOrg(d.screens)} rowId={(s: any) => s.id} exportName="all-screens" onDone={reload} bulk={screenBulk}
          search={(s: any) => `${s.name} ${s.venue_name} ${s.address}`}
          facets={[{ label: 'State', get: (s: any) => s._status?.state }, { label: 'Venue', get: (s: any) => s.venue_type },
                   { label: 'Org', get: (s: any) => orgName(s.org_id) }]} />
      </>)}

      {view==='campaigns'&&<div className="mb-3 text-right"><a className="text-sm text-primary" href="/admin/demo">Set up the brand demo →</a></div>}
      {view==='campaigns'&&<CampaignList d={{...d,orgs:orgDirectory}} orgId={orgFilter==='all'?null:orgFilter} onGo={go} onChanged={reload}/>}

      {view === 'approvals' && <ReviewQueue orgName={orgName} onGo={go} onChanged={reload} />}

      {view === 'devices' && (<>
        <PageHead title="Device health" sub="Paired players across the fleet" />
        <DataTable cols={[
          { label: 'Screen', render: (v: any) => { const s = d.screens.find((x: any) => x.id === v.screen_id);
            return <><button onClick={() => go('s/' + v.screen_id)} className="text-left font-medium text-primary hover:underline">{s?.name ?? '—'}</button><div className="font-mono text-[11.5px] text-muted-foreground">{v.id}</div></>; } },
          { label: 'Org', render: (v: any) => <span className="text-muted-foreground">{orgName(v.org_id)}</span> },
          { label: 'Status', render: (v: any) => { const s = d.screens.find((x: any) => x.id === v.screen_id); return <StatusBadge st={s?._status??{state:'unknown',label:'Not loaded'}} />; } },
          { label: 'Last heartbeat', render: (v: any) => <span className="font-mono text-[12px] text-muted-foreground">{fmtDate(v.last_heartbeat_at)}</span> },
          { label: 'Camera readiness', render: (v: any) => { const screen=d.screens.find((s:any)=>s.id===v.screen_id); return screen?<CameraReadiness screen={screen} devices={[v]}/>: '—'; } },
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
        <PageHead title="Analytics" sub="Recorded delivery and presence · daily summaries" />
        <DeliveryReport report={report} screens={d.screens} campaigns={d.campaigns} creatives={d.creatives} />
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

/** Client-side count for the nav badge, mirroring GET /review-queue over the loaded bootstrap records. */
function reviewQueueCount(d: any) {
  const now = Date.now();
  const byId = new Map((d.creatives || []).map((c: any) => [c.id, c]));
  const ended = (c: any) => { try { return campaignInterval(c)[1] <= now; } catch { return false; } };
  const campaigns = (d.campaigns || []).filter((c: any) => {
    const submitted = ['draft', 'pending'].includes(c.status) && c.review?.state === 'in_review';
    const waiting = (c.creative_ids || []).some((id: string) => { const cr: any = byId.get(id); return cr && !['approved', 'rejected'].includes(cr.approval_status); });
    return submitted || (['active', 'pending', 'paused'].includes(c.status) && waiting && !ended(c));
  }).length;
  return campaigns + (d.creatives || []).filter((c: any) => c.purpose === 'filler' && c.approval_status === 'pending').length;
}

/** Doc 31 Phase 5: the reviewer decides per campaign; approval is stored on each creative and the campaign activates. */
function ReviewQueue({ orgName, onGo, onChanged }: { orgName: (id: string) => string; onGo: (g: string, owner?: string) => void; onChanged: () => void }) {
  const [q, setQ] = useState<any>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('campaigns');
  const idBase = React.useId();
  const load = useCallback(async () => { setErr(''); try { setQ(await api('/review-queue')); } catch (e) { setErr((e as Error).message); } }, []);
  useEffect(() => { load(); }, [load]);
  const [flash, setFlash] = useState('');
  const done = async (message = '') => { setFlash(message); await load(); onChanged(); };
  if (!q) return <><PageHead title="Review queue" />{err ? <Card className="p-4"><p role="alert" className="text-sm">{err}</p><Button className="mt-3" onClick={load}>Retry</Button></Card> : <Card role="status" className="p-4 text-sm">Loading the review queue…</Card>}</>;
  return (<>
    <PageHead title="Review queue" sub={`${q.items.length} campaign${q.items.length === 1 ? '' : 's'} · ${q.filler.length} filler · content review only`} />
    <TabList idBase={idBase} label="Review queue" value={tab} onChange={setTab} tabs={[{ id: 'campaigns', label: `Campaigns (${q.items.length})` }, { id: 'filler', label: `Filler (${q.filler.length})` }]} />
    {err && <p role="alert" className="mt-3 text-sm text-destructive">{err}</p>}
    {flash && <p role="status" className="mt-3 rounded-md bg-primary/[0.06] p-3 text-sm">{flash}</p>}
    {tab === 'campaigns' && <TabPanel idBase={idBase} id="campaigns">
      {q.items.length ? <div className="space-y-3">{q.items.map((item: any) => <ReviewCard key={item.campaign.id + ':' + item.creatives.map((c: any) => c.id).join(',')} item={item} onGo={onGo} onDone={done} />)}</div>
        : <Empty>No campaigns are waiting for review.</Empty>}
    </TabPanel>}
    {tab === 'filler' && <TabPanel idBase={idBase} id="filler">
      <DataTable cols={[
        { label: 'Filler creative', render: (c: any) => <><div className="font-medium">{c.name}</div><div className="text-[12px] text-muted-foreground">{c.org_name ?? orgName(c.org_id)} · {c.media_type}{c.has_upload ? ' · uploaded' : ' · awaiting upload'}</div></> },
        { label: 'Category', render: (c: any) => <Badge variant="muted">{c.category}</Badge> },
        { label: '', render: (c: any) => <FillerDecision c={c} onDone={done} /> },
      ]} rows={q.filler} rowId={(c: any) => c.id} empty="No filler creatives are waiting for approval." />
      <p className="mt-2 text-xs text-muted-foreground">Filler belongs to no campaign, so it is approved per creative.</p>
    </TabPanel>}
  </>);
}

function FillerDecision({ c, onDone }: { c: any; onDone: (message?: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const decide = async (status: string) => { setBusy(true); setErr(''); try { await api(`/creative/${c.id}/approve`, { status }); await onDone(`${c.name}: ${status}.`); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return <div className="flex items-center gap-1.5"><Button size="sm" disabled={busy} aria-label={`Approve filler ${c.name}`} onClick={() => decide('approved')}>Approve</Button>
    <Button size="sm" variant="outline" disabled={busy} aria-label={`Reject filler ${c.name}`} onClick={() => decide('rejected')}>Reject</Button>{err && <span role="alert" className="text-xs text-destructive">{err}</span>}</div>;
}

function CreativePreview({ c }: { c: any }) {
  const [open, setOpen] = useState(false), [media, setMedia] = useState<any>(null), [err, setErr] = useState('');
  const show = async () => { setOpen(!open); if (media || open) return; try { setMedia(await api(`/creative/${c.id}/preview`)); } catch (e) { setErr((e as Error).message); } };
  const variant = media?.variants?.find((v: any) => v.url);
  return <div className="min-w-0">
    <div className="flex items-center gap-2">{c.youtube_id && <Thumb id={c.youtube_id} w={88} />}
      {(c.has_upload || c.youtube_id) && <Button size="sm" variant="ghost" aria-expanded={open} aria-label={`Preview ${c.name}`} onClick={show}>{open ? 'Hide preview' : 'Preview'}</Button>}</div>
    {open && <div className="mt-2">
      {err && <p role="alert" className="text-xs text-destructive">{err}</p>}
      {!media && !err && <p role="status" className="text-xs text-muted-foreground">Loading preview…</p>}
      {media?.source === 'youtube' && <a className="text-xs text-primary hover:underline" target="_blank" rel="noreferrer" href={`https://www.youtube.com/watch?v=${media.youtube_id}`}>Watch on YouTube</a>}
      {media?.source === 'uploaded' && variant && (variant.media_type === 'image'
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={variant.url} alt={`Preview of ${c.name}`} className="max-h-48 rounded border border-border" />
        : <video src={variant.url} controls preload="metadata" aria-label={`Preview video for ${c.name}`} className="max-h-48 rounded border border-border" />)}
      {media && !variant && media.source !== 'youtube' && <p className="text-xs text-muted-foreground">No playable media is attached yet.</p>}
    </div>}
  </div>;
}

function ReviewCard({ item, onGo, onDone }: { item: any; onGo: (g: string, owner?: string) => void; onDone: (message?: string) => Promise<void> }) {
  const c = item.campaign;
  const [choice, setChoice] = useState<Record<string, 'approved' | 'rejected'>>(() => Object.fromEntries(item.creatives.map((cr: any) => [cr.id, 'approved'])));
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const mixed = Object.values(choice).some(v => v === 'rejected');
  const reReview = item.reason === 're_review';
  const approveLabel = mixed ? 'Submit decisions' : reReview ? (item.creatives.length === 1 ? 'Approve creative' : 'Approve creatives') : 'Approve campaign';
  const send = async (decisions: Record<string, string>) => {
    setBusy(true); setErr('');
    try {
      const r = await api(`/campaign/${c.id}/review`, { creatives: decisions, ...(note.trim() ? { note: note.trim() } : {}) });
      await onDone(`${c.name}: ` + (r.activation?.attempted ? (r.activation.activated ? 'approved and now active.' : `approved, but it cannot start: ${r.activation.error}`)
        : r.campaign?.review?.state === 'changes_needed' ? 'sent back to the seller, changes needed.' : 'decisions saved.'));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const ended = c.ends_at && c.ends_at < new Date().toISOString().slice(0, 10);
  return <Card role="group" aria-label={`Review ${c.name}`} className="p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <button className="text-left text-[15px] font-semibold text-primary hover:underline" onClick={() => onGo('c/' + c.id, c.org_id)}>{c.name}</button>
          {item.reason === 're_review' ? <Badge variant="warn">Changed creative</Badge> : <Badge variant="default">Submitted</Badge>}
          {c.campaign_type === 'network' && <Badge variant="default">network</Badge>}
          <Badge variant="muted">{c.status}</Badge>
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{c.advertiser_name ?? '—'} · {c.org_name ?? c.org_id} · <span className="font-mono">{c.starts_at} → {c.ends_at}</span> · {c.screens} screen{c.screens === 1 ? '' : 's'}{ended ? ' · end date passed' : ''}</p>
        {c.review?.submitted_at && <p className="text-xs text-muted-foreground">Submitted {new Date(c.review.submitted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>}
      </div>
    </div>
    <ul className="mt-3 divide-y divide-border/60 rounded-lg border border-border/60">
      {item.creatives.map((cr: any) => <li key={cr.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
        <div className="min-w-0 space-y-1">
          <div className="font-medium">{cr.name} <span className="text-xs font-normal text-muted-foreground">· {cr.media_type}{cr.duration_s ? ` · ${cr.duration_s}s` : ''} · {cr.category}</span></div>
          <p className="text-xs text-muted-foreground">{cr.usage.other_campaigns ? `Also used in ${cr.usage.other_campaigns} other campaign${cr.usage.other_campaigns === 1 ? '' : 's'} (${cr.usage.other_active} active). Approval applies there too.` : 'Not used in other open campaigns.'}</p>
          <CreativePreview c={cr} />
        </div>
        <div role="radiogroup" aria-label={`Decision for ${cr.name}`} className="flex gap-1.5">
          {(['approved', 'rejected'] as const).map(v => <Button key={v} size="sm" role="radio" aria-checked={choice[cr.id] === v} variant={choice[cr.id] === v ? (v === 'approved' ? 'default' : 'destructive') : 'outline'}
            onClick={() => setChoice({ ...choice, [cr.id]: v })}>{v === 'approved' ? 'Approve' : 'Reject'}</Button>)}
        </div>
      </li>)}
      {!item.creatives.length && <li className="p-3 text-sm text-muted-foreground">Every creative already has a decision. Approving re-runs activation.</li>}
    </ul>
    {reReview && <p className="mt-2 text-xs text-muted-foreground">A creative changed after this campaign was reviewed{c.review?.state === 'approved_not_started' ? ' (approved, not started)' : ''}. Decisions apply to the creatives only; the campaign stays {c.status}{c.status === 'active' ? ' and delivers these creatives once approved' : ''}.</p>}
    {item.decided?.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Already decided: {item.decided.map((x: any) => `${x.name} (${x.approval_status})`).join(', ')}</p>}
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <Field label="Note to the seller" className="min-w-[240px] flex-1"><Input aria-label={`Review note for ${c.name}`} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="Required when rejecting" /></Field>
      <Button disabled={busy} onClick={() => send(choice)}>{busy ? 'Saving…' : approveLabel}</Button>
      <Button variant="outline" disabled={busy || !note.trim() || !item.creatives.length} title={!note.trim() ? 'Add a note explaining what to change' : undefined}
        onClick={() => send(Object.fromEntries(item.creatives.map((cr: any) => [cr.id, 'rejected'])))}>Reject</Button>
    </div>
    {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
  </Card>;
}
