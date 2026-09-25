'use client';
import { DeliveryReport, useDeliveryReport } from '@/components/views/delivery-report';
import React, { useEffect, useMemo, useState } from 'react';
import { tabFor } from '@/lib/roles';
import { api, session, type SessionUser } from '@/lib/client';
import { inr, isLive, fmtDate } from '@/lib/utils';
import { advertiserNav } from '@/lib/nav';
import { AppShell, PageHead, SectionHead, type Crumb } from '@/components/ui/app-shell';
import { DataTable } from '@/components/ui/table';
import { Stat, Progress } from '@/components/ui/stat';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input, Field } from '@/components/ui/input';
import { SoonPage } from '@/components/views/bits';
import type { CmdItem } from '@/components/ui/command-palette';
import { BootLoader } from '@/components/ui/loader';
import { ProfilePage } from '@/components/views/account';
import { useDirtyForm, SaveBar } from '@/components/ui/form';

export default function Advertiser() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [d, setD] = useState<any>(null);
  const [view, setView] = useState('overview');
  const report = useDeliveryReport({ enabled: !!user && view !== 'profile' });

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
  const cmdItems: CmdItem[] = useMemo(() => mine.map((c: any) => ({ id: c.id, label: c.name, sub: `${c.starts_at} → ${c.ends_at}`, kind: 'campaign', go: 'overview' })), [mine]);

  if (!user || !d) return <BootLoader />;

  const nav = advertiserNav();
  const orgs = [{ id: 'me', name: user.name, type: 'advertiser' }];
  const screenName = (id: string) => d.screens.find((s: any) => s.id === id)?.name ?? '—';
  const advTitle: Record<string, string> = { overview: 'Delivery', screens: 'Where it ran', reports: 'Reports', profile: 'Profile & account' };
  const trail: Crumb[] = view === 'overview'
    ? [{ label: user.orgName, go: 'overview' }]
    : [{ label: user.orgName, go: 'overview' }, advTitle[view] ?? 'Delivery'];

  return (
    <AppShell groups={nav.groups} bottom={nav.bottom} activeId={view} onSelect={go}
      orgs={orgs} currentOrg={orgs[0]} onOrgSelect={() => {}} breadcrumb={trail}
      cmdItems={cmdItems} onGo={go} user={{ name: user.name, role: user.role }}>

      {view === 'overview' && (<>
        <PageHead title={user.name} sub="Campaign delivery · read-only" />
        <Stat metric="recorded_campaign_accrual" period={{from:'',to:'',label:'Campaign lifetime · visible records'}} label="Lifetime spend" value={mine.some((c:any)=>typeof c.accrued_spend!=='number')?'—':inr(mine.reduce((sum: number, c: any) => sum + c.accrued_spend, 0))} hint="Recorded campaign accrual · independent of report dates" />
        <Card className="mt-4 border-primary/25 bg-primary/[0.04] p-4 text-[13px] text-primary">
          <b>How we count.</b> A camera samples the scene while your ad plays. Presence is the average number of people present during a measured play, not impressions or unique reach. Missing measurements stay unknown, never zero or estimated.
        </Card>
        <DeliveryReport report={report} screens={d.screens} campaigns={mine} creatives={d.creatives} />
        <SectionHead>Campaigns</SectionHead>
        <DataTable cols={[
          { label: 'Campaign', render: (c: any) => <span className="font-medium">{c.name}</span> },
          { label: 'Dates', render: (c: any) => <span className="block whitespace-nowrap font-mono text-[12px] leading-snug text-muted-foreground">{c.starts_at}<br />→ {c.ends_at}</span> },
          { label: 'Screens', num: true, render: (c: any) => c.screen_ids.length },
          { label: 'Paid plays · selected dates', num: true, render: (c: any) => report.data?.byCampaign[c.id]?.plays_rendered ?? (report.data?.coverage.complete ? 0 : '—') },
          { label: 'Lifetime budget used', num: true, render: (c: any) => { const p = c.committed_budget ? Math.round(c.accrued_spend / c.committed_budget * 100) : 0;
            return <div className="flex flex-col items-end gap-1"><span className="whitespace-nowrap">{inr(c.accrued_spend)} / {inr(c.committed_budget)}</span><Progress value={p} hot={p >= 80} className="w-20" /></div>; } },
          { label: 'Status', render: (c: any) => isLive(c) ? <Badge variant="onair" blip>live</Badge> : <Badge variant="muted">{c.status}</Badge> },
        ]} rows={mine} rowId={(c: any) => c.id} exportName="my-campaigns" empty="No campaigns yet" />
      </>)}

      {view === 'screens' && (() => {
        const ids = Array.from(new Set(mine.flatMap((c: any) => c.screen_ids))) as string[];
        return (<>
          <PageHead title="Where it ran" sub={`${ids.length} assigned screens · delivery during selected dates`} />
          <DeliveryReport report={report} screens={d.screens} campaigns={mine} creatives={d.creatives} />
          <DataTable cols={[
            { label: 'Screen', render: (id: string) => { const s = d.screens.find((x: any) => x.id === id);
              return <><div className="font-medium">{s?.name ?? '—'}</div><div className="text-[12px] text-muted-foreground">{s?.address}</div></>; } },
            { label: 'Venue', render: (id: string) => <Badge variant="muted">{d.screens.find((x: any) => x.id === id)?.venue_type ?? '—'}</Badge> },
            { label: 'Paid plays', num: true, render: (id: string) => report.data?.byScreen[id]?.plays_rendered ?? (report.data?.coverage.complete ? 0 : '—') },
            { label: 'People / measured paid play', num: true, render: (id: string) => { const r = report.data?.byScreen[id]; return r?.presence_n ? (r.presence_sum / r.presence_n).toFixed(1) : '—'; } },
          ]} rows={ids} rowId={(id: string) => id} exportName="screens" empty="No screens yet" />
        </>);
      })()}

      {view === 'reports' && <><PageHead title="Reports" sub="Select dates, inspect the data and download daily summaries" /><DeliveryReport report={report} screens={d.screens} campaigns={mine} creatives={d.creatives} /></>}
      {view === 'profile' && <ProfilePage user={user} onSaved={() => {}} />}
    </AppShell>
  );
}

