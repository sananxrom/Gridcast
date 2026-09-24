'use client';
import React from 'react';
import {api} from '@/lib/client';
import {inr,isLive,daySeries} from '@/lib/utils';
import {PageHead} from '@/components/ui/app-shell';
import {DataTable, type BulkAction} from '@/components/ui/table';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {InlineSelect} from '@/components/ui/popover';
import {Progress} from '@/components/ui/stat';
import {Spark} from '@/components/ui/spark';
export function CampaignList({d,orgId,onGo:go,onChanged:reload}:{d:any;orgId:string|null;onGo:(g:string)=>void;onChanged:()=>void}) {
const caps:string[]=d.caps??[];
const mayEdit=(c:any)=>caps.includes('sales') && (c.campaign_type!=='network'||caps.includes('platform'));
const money=(value:any)=>typeof value==='number'?inr(value):'—';
const advName=(id:string)=>d.advertisers.find((a:any)=>a.id===id)?.name??id;
const trendCampaign=(id:string)=>{const ids=new Set(d.plays.filter((p:any)=>p.campaign_id===id).map((p:any)=>p.id));return daySeries(d.presence.filter((p:any)=>p.measured&&ids.has(p.play_id)).map((p:any)=>({at:p.at,value:p.avg_persons})));};
const setCampaign=async(c:any,patch:any)=>{if(!mayEdit(c))throw new Error('Network campaigns are managed by the platform.');await api(`/campaign/${c.id}`,patch);await reload();};
const STATUS_CHOICES=['active','paused','complete'].map(value=>({value,label:value}));
const INVOICE_CHOICES=['not_invoiced','invoiced','paid'].map(value=>({value,label:value.replace(/_/g,' ')}));
const campaignBulk:BulkAction<any>[]=['paused','active'].map(status=>({label:status==='active'?'Resume':'Pause',run:async rows=>{if(rows.some(c=>!mayEdit(c)))throw new Error('Network campaigns are managed by the platform. Select only your own campaigns.');for(const c of rows)await api(`/campaign/${c.id}`,{status});}}));
return (
<>
        <PageHead title="Campaigns" sub="Budgets are entered manually — the platform is a ledger, not a processor"
          actions={<Button disabled={!orgId} onClick={() => go('new')}>+ New campaign</Button>} />
        <DataTable cols={[
          { className: 'min-w-[168px]', label: 'Campaign', sort: (c: any) => c.name, render: (c: any) => <><button onClick={() => go('c/' + c.id)} className="text-left font-medium text-primary hover:underline">{c.name}</button><div className="text-[12px] text-muted-foreground">{advName(c.advertiser_id)}</div></> },
          { label: 'Organisation', render:(c:any)=>d.orgs?.find((o:any)=>o.id===c.org_id)?.name??c.org_id },
          { label: 'Dates', sort: (c: any) => c.ends_at, render: (c: any) => <span className="block whitespace-nowrap font-mono text-[12px] leading-snug text-muted-foreground">{c.starts_at}<br />→ {c.ends_at}</span> },
          { label: 'Type', sort: (c: any) => c.campaign_type, render: (c: any) => <Badge variant={c.campaign_type === 'network' ? 'default' : 'muted'}>{c.campaign_type}</Badge> },
          { label: 'Screens', num: true, sort: (c: any) => c.screen_ids.length, render: (c: any) => c.screen_ids.length },
          { label: 'People / play', sort: (c: any) => trendCampaign(c.id).filter(Boolean).slice(-1)[0] ?? -1, render: (c: any) => <Spark data={trendCampaign(c.id)} /> },
          { label: 'Rate', num: true, render: (c: any) => <span className="whitespace-nowrap">{c.rate_type === 'flat' ? <>{money(c.committed_budget)} <span className="text-muted-foreground">flat</span></> : <>{money(c.rate_value)} <span className="text-muted-foreground">/play</span></>}</span> },
          { label: 'Budget', num: true, sort: (c: any) => (c.committed_budget ? c.accrued_spend / c.committed_budget : 0), render: (c: any) => { if(c.committed_budget==null)return <span>{money(c.accrued_spend)}<br/><span className="text-xs text-muted-foreground">Your screens only</span></span>;const p = c.committed_budget ? Math.round(c.accrued_spend / c.committed_budget * 100) : 0;
            return <div className="flex flex-col items-end gap-1 whitespace-nowrap"><span>{inr(c.accrued_spend)}</span><span className="text-[11.5px] text-muted-foreground">of {inr(c.committed_budget)}</span><Progress value={p} hot={p >= 80} className="w-20" /></div>; } },
          ...(caps.includes('money') ? [{ label: 'Invoice', sort: (c: any) => c.invoice_status, render: (c: any) => (
            <InlineSelect disabled={!mayEdit(c)||!caps.includes('money')||c.invoice_status==null} value={c.invoice_status??''} choices={INVOICE_CHOICES} onChange={(v:string) => setCampaign(c, { invoice_status: v })}>
              <Badge variant={c.invoice_status === 'paid' ? 'ok' : c.invoice_status === 'invoiced' ? 'warn' : 'muted'}>{c.invoice_status?.replace(/_/g, ' ') ?? 'Managed by Gridcast'}</Badge>
            </InlineSelect>) }] : []),
          { label: 'Status', sort: (c: any) => c.status, render: (c: any) => (
            <InlineSelect disabled={!mayEdit(c)} value={c.status} choices={STATUS_CHOICES} onChange={v => setCampaign(c, { status: v })}>
              {isLive(c) ? <Badge variant="onair" blip>live</Badge> : <Badge variant="muted">{c.status}</Badge>}
            </InlineSelect>) },
        ]} rows={d.campaigns} rowId={(c: any) => c.id} exportName="campaigns" bulk={caps.includes('sales') ? campaignBulk : undefined} onDone={() => reload()}
          search={(c: any) => `${c.name} ${advName(c.advertiser_id)}`}
          facets={[{ label: 'Status', get: (c: any) => c.status }, { label: 'Type', get: (c: any) => c.campaign_type },
                   ...(caps.includes('money') ? [{ label: 'Invoice', get: (c: any) => (c.invoice_status??'managed_by_gridcast').replace(/_/g, ' ') }] : [])]} />
      </>
);
}
