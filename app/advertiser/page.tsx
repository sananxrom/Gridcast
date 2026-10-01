'use client';
import { DeliveryReport, useDeliveryReport, type DeliveryReportState } from '@/components/views/delivery-report';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { tabFor } from '@/lib/roles';
import { api, session, type SessionUser } from '@/lib/client';
import { inr, inrRate } from '@/lib/utils';
import { advertiserNav } from '@/lib/nav';
import { AppShell, PageHead, SectionHead, type Crumb } from '@/components/ui/app-shell';
import { DataTable } from '@/components/ui/table';
import { Stat } from '@/components/ui/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/loader';
import type { CmdItem } from '@/components/ui/command-palette';
import { BootLoader } from '@/components/ui/loader';
import { ProfilePage } from '@/components/views/account';
import { campaignStatus } from '@/lib/campaign-status';
import { CampaignStatusBadge, useCampaignEvidence, useNow, usePeriodicRefresh } from '@/components/views/campaign-status-badge';
import { CampaignDashboard } from '@/components/views/campaign-dashboard';
import { ReportSummary } from '@/components/views/report-summary';
import { ReportAlerts, ReportPeriodBar, type ReportMetadata, type ReportView, useReportView } from '@/components/views/report-parts';
import { LIFETIME_SPEND_LABEL, LifetimeSpend, ProfileLine, periodMetricCols } from '@/components/views/campaign-list';

/** Read-only campaign dashboard for an advertiser (doc 31 Phase 6): no Edit, no Money tab, no Diagnostics. */
function AdvertiserCampaign({ id, boot, onGo }: { id: string; boot: any; onGo: (g: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const currentId = useRef(id); currentId.current = id;
  const report = useDeliveryReport({ campaign: id });
  const now = useNow();
  const load = () => api(`/campaign/${id}`).then(x => { if (currentId.current === id) setD(x); });
  usePeriodicRefresh(() => api(`/campaign/${id}`, undefined, { quiet: true }).then(x => { if (currentId.current === id) setD(x); }), !!d);
  useEffect(() => { setD(null); setErr(''); load().catch(e => { if (currentId.current === id) setErr(e.message); }); /* eslint-disable-next-line */ }, [id]);
  if (!d && err) return <Card className="p-5"><p role="alert">{err}</p><Button className="mt-3" onClick={() => { setErr(''); load().catch(e => setErr(e.message)); }}>Retry</Button></Card>;
  if (!d || d.campaign.id !== id) return <div className="space-y-3"><Skeleton className="h-9 w-64" /><Skeleton className="h-40 w-full" /></div>;
  const c = d.campaign;
  const screens = d.byScreen.map((r: any) => ({ ...r.screen, _status: r.screen?._status ?? boot.screens?.find((s: any) => s.id === r.screen?.id)?._status }));
  // The server sends advertisers no eligibility decisions (`eligibility: null`), so status uses receipts and device evidence only.
  const status = campaignStatus({ campaign: c, creatives: d.byCreative.map((r: any) => r.creative), screens, advertiser: d.advertiser, receipts: d.plays, decisions: null, now });
  const rate = c.rate_type === 'flat' ? `${inr(c.committed_budget)} flat` : `${inrRate(c.rate_value)} per play`;
  return <CampaignDashboard d={d} report={report} status={status} mayMoney={false} scopedNetwork={false} rate={rate} onGo={onGo} diagnostics={false} back={{ label: 'Delivery', go: 'overview' }} />;
}

/** Where it ran: the screens table with the period bar only (the full report lives on Reports). */
function WhereItRan({ report, d, ids }: { report: DeliveryReportState; d: any; ids: string[] }) {
  const view = useReportView(report, { byScreen: d.screens, byCampaign: d.campaigns, byCreative: d.creatives });
  return <>
    <div className="mb-3 flex flex-wrap items-end gap-3"><ReportPeriodBar report={report} view={view} className="flex flex-wrap items-end gap-2" /></div>
    <div className="mb-3 space-y-2 empty:hidden"><ReportAlerts report={report} view={view} showLoading={false} /></div>
    <div className="mb-3"><ProfileLine report={report} view={view} /></div>
    <DataTable cols={[
      { label: 'Screen', render: (id: string) => { const s = d.screens.find((x: any) => x.id === id);
        return <><div className="font-medium">{s?.name ?? '—'}</div><div className="text-[12px] text-muted-foreground">{s?.address}</div></>; } },
      { label: 'Venue', render: (id: string) => <Badge variant="muted">{d.screens.find((x: any) => x.id === id)?.venue_type ?? '—'}</Badge> },
      ...periodMetricCols<string>(report, view.selectedAttention, 'byScreen', id => id, ['plays', 'people', 'impressions']),
    ]} rows={ids} rowId={(id: string) => id} exportName="screens" empty="No screens yet" />
  </>;
}

/** Campaigns home table: period columns from the same report and the same view (period + profile) as the summary above it. */
function CampaignsTable({ report, view, mine, statusOf, onGo }: { report: DeliveryReportState; view: ReportView; mine: any[]; statusOf: (c: any) => any; onGo: (g: string) => void }) {
  return <>
    <DataTable cols={[
      { label: 'Campaign', sort: (c: any) => c.name, render: (c: any) => <button onClick={() => onGo('c/' + c.id)} className="text-left font-medium text-primary hover:underline">{c.name}</button> },
      { label: 'Status', sort: (c: any) => statusOf(c).label, render: (c: any) => <CampaignStatusBadge status={statusOf(c)} /> },
      { label: 'Dates', sort: (c: any) => c.ends_at, render: (c: any) => <span className="block whitespace-nowrap font-mono text-[12px] leading-snug text-muted-foreground">{c.starts_at}<br />→ {c.ends_at}</span> },
      { label: 'Screens', num: true, render: (c: any) => c.screen_ids.length },
      ...periodMetricCols<any>(report, view.selectedAttention, 'byCampaign', c => c.id, ['plays', 'people', 'impressions']),
      { label: LIFETIME_SPEND_LABEL, num: true, render: (c: any) => <LifetimeSpend c={c} /> },
    ]} rows={mine} rowId={(c: any) => c.id} exportName="my-campaigns" empty="No campaigns yet" />
  </>;
}

/** Delivery summary and campaigns table share one view: one period and one measurement-profile picker for both. */
function Overview({ report, metadata, mine, statusOf, onGo }: { report: DeliveryReportState; metadata: ReportMetadata; mine: any[]; statusOf: (c: any) => any; onGo: (g: string) => void }) {
  const view = useReportView(report, metadata);
  return <>
    <ReportSummary report={report} metadata={metadata} view={view} profileControl={<ProfileLine report={report} view={view} label="Measurement profile for summary and campaigns" />} onOpen={() => onGo('reports')} openLabel="Open full report →" />
    <SectionHead>Campaigns</SectionHead>
    <CampaignsTable report={report} view={view} mine={mine} statusOf={statusOf} onGo={onGo} />
  </>;
}

export default function Advertiser() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [d, setD] = useState<any>(null);
  const [view, setView] = useState('overview');
  // One page-level report for Delivery, Where it ran and Reports, so the period carries across them.
  const report = useDeliveryReport({ enabled: !!user && ['overview', 'screens', 'reports'].includes(view) });
  const evidence = useCampaignEvidence(null, !!user && view === 'overview');
  const now = useNow();
  usePeriodicRefresh(() => api(`/bootstrap?user=${user?.id}`, undefined, { quiet: true }).then(setD), !!user && view === 'overview');

  useEffect(() => {
    const u = session.get();
    if (!u || tabFor(u.role) !== 'advertiser') { location.href = '/'; return; }
    setUser(u); api(`/bootstrap?user=${u.id}`).then(setD);
    const sync = () => setView(location.hash.slice(1) || 'overview');
    sync(); window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const go = (g: string) => { location.hash = g; setView(g); };

  const mine = useMemo(() => !d ? [] : d.campaigns.filter((c: any) => c.advertiser_id === user?.advertiser_id), [d, user]);
  const cmdItems: CmdItem[] = useMemo(() => mine.map((c: any) => ({ id: c.id, label: c.name, sub: `${c.starts_at} → ${c.ends_at}`, kind: 'campaign', go: 'c/' + c.id })), [mine]);

  if (!user || !d) return <BootLoader />;

  const nav = advertiserNav();
  const orgs = [{ id: 'me', name: user.name, type: 'advertiser' }];
  const advTitle: Record<string, string> = { overview: 'Delivery', screens: 'Where it ran', reports: 'Reports', profile: 'Profile & account' };
  const campaignId = view.startsWith('c/') ? view.slice(2) : null;
  const trail: Crumb[] = view === 'overview'
    ? [{ label: user.orgName, go: 'overview' }]
    : campaignId ? [{ label: user.orgName, go: 'overview' }, { label: 'Delivery', go: 'overview' }, mine.find((c: any) => c.id === campaignId)?.name ?? 'Campaign']
    : [{ label: user.orgName, go: 'overview' }, advTitle[view] ?? 'Delivery'];
  const statusOf = (c: any) => campaignStatus({ campaign: c, creatives: d.creatives, screens: d.screens, advertiser: d.advertisers.find((a: any) => a.id === c.advertiser_id), reportScreens: evidence.loaded ? (evidence.campaignScreens[c.id] ?? {}) : null, reportLoaded: evidence.loaded, now });
  const metadata = { byScreen: d.screens, byCampaign: mine, byCreative: d.creatives };

  return (
    <AppShell groups={nav.groups} bottom={nav.bottom} activeId={campaignId ? 'overview' : view} onSelect={go}
      orgs={orgs} currentOrg={orgs[0]} onOrgSelect={() => {}} breadcrumb={trail}
      cmdItems={cmdItems} onGo={go} user={{ name: user.name, role: user.role }}>

      {view === 'overview' && (<>
        <PageHead title={user.name} sub="Your campaigns · read-only" />
        <Stat metric="recorded_campaign_accrual" period={{from:'',to:'',label:'Campaign lifetime · visible records'}} label="Lifetime spend" value={mine.some((c:any)=>typeof c.accrued_spend!=='number')?'—':inr(mine.reduce((sum: number, c: any) => sum + c.accrued_spend, 0))} hint="Recorded campaign accrual · independent of report dates" />
        <Card className="mt-4 border-primary/25 bg-primary/[0.04] p-4 text-[13px] text-primary">
          <b>How we count.</b> Camera measurements use the profile assigned to each player, and reports keep incompatible model profiles separate. Missing readings stay unknown, never zero. Impressions and attention are analytics estimates, not unique reach or billing evidence.
        </Card>
        <Overview report={report} metadata={metadata} mine={mine} statusOf={statusOf} onGo={go} />
      </>)}

      {campaignId && (mine.some((c: any) => c.id === campaignId)
        ? <AdvertiserCampaign key={campaignId} id={campaignId} boot={d} onGo={go} />
        : <Card className="p-5 text-sm">This campaign is not available to you. <Button variant="ghost" size="sm" onClick={() => go('overview')}>Back to Delivery</Button></Card>)}

      {view === 'screens' && (() => {
        const ids = Array.from(new Set(mine.flatMap((c: any) => c.screen_ids))) as string[];
        return (<>
          <PageHead title="Where it ran" sub={`${ids.length} assigned screens · delivery during selected dates`} />
          <WhereItRan report={report} d={d} ids={ids} />
        </>);
      })()}

      {view === 'reports' && <><PageHead title="Reports" sub="Select dates, inspect the data and download daily summaries" /><DeliveryReport report={report} screens={d.screens} campaigns={mine} creatives={d.creatives} /></>}
      {view === 'profile' && <ProfilePage user={user} onSaved={() => {}} />}
    </AppShell>
  );
}
