'use client';
import React from 'react';
import {api} from '@/lib/client';
import {inr,inrRate} from '@/lib/utils';
import {PageHead} from '@/components/ui/app-shell';
import {DataTable, type BulkAction, type Col} from '@/components/ui/table';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Select} from '@/components/ui/input';
import {InlineSelect} from '@/components/ui/popover';
import {Progress} from '@/components/ui/stat';
import {TabList} from '@/components/ui/tabs';
import {campaignStatus} from '@/lib/campaign-status';
import {periodLabel} from '@/lib/metrics';
import {CampaignStatusBadge,useCampaignEvidence,useNow} from '@/components/views/campaign-status-badge';
import {DraftsList} from '@/components/views/campaign-flow';
import {type AttentionProfile,type DeliveryReportState,useDeliveryReport} from '@/components/views/delivery-report';
import {ReportAlerts,ReportPeriodBar,type ReportView,useReportView} from '@/components/views/report-parts';
import {type MetricCell,type PeriodRowCells,type RowDimension,periodCues,periodRowCells,profileLabel} from '@/components/views/report-metrics';
import {Thumb} from '@/components/views/bits';

// Doc 31 Phase 6: a Meta-style campaign table. Period columns read the merged /metrics report (`byCampaign`,
// `byCreative`, and `attentionProfiles[selected]`); impressions follow the one selected profile and are never summed
// across profiles. Spend is lifetime only — there is no period spend in reporting.
const METRIC_LABEL:Record<keyof PeriodRowCells,string>={plays:'Plays',people:'Avg people',looking:'Avg looking',impressions:'Est. impressions',attentive:'Attentive impressions',coverage:'Attention coverage'};
const sortValue=(cell:MetricCell)=>{const n=Number(cell.value.replace(/[^0-9.]/g,''));return cell.value==='—'||cell.value==='…'||!Number.isFinite(n)?-1:n;};
function MetricValue({cell}:{cell:MetricCell}){return <span className="inline-flex flex-col items-end gap-0.5 whitespace-nowrap tnum">{cell.value}{cell.cue&&<span className="text-[11px] text-muted-foreground">{cell.cue}</span>}</span>;}
/** Period metric columns for one dimension. Loading shows "…"; a report that has not loaded is unmeasured ("—"). */
export function periodMetricCols<T>(report:DeliveryReportState,selected:AttentionProfile|undefined,dimension:RowDimension,id:(r:T)=>string,which:(keyof PeriodRowCells)[]):Col<T>[]{
  const ready=report.data&&!report.loading?report.data:null;
  const cell=(r:T,key:keyof PeriodRowCells):MetricCell=>ready?periodRowCells(ready,dimension,id(r),selected)[key]:{value:report.loading?'…':'—'};
  return which.map(key=>({label:key==='people'&&!selected?'Legacy avg people':METRIC_LABEL[key],num:true,sort:(r:T)=>sortValue(cell(r,key)),render:(r:T)=><MetricValue cell={cell(r,key)}/>}));
}
/** Lifetime accrued spend against the committed budget; never a period figure. A redacted budget is labelled, not guessed. */
export function LifetimeSpend({c}:{c:any}){
  if(typeof c.accrued_spend!=='number')return <span className="text-muted-foreground">—</span>;
  if(c.committed_budget==null)return <span className="whitespace-nowrap">{inr(c.accrued_spend)}<br/><span className="text-xs text-muted-foreground">Your screens only</span></span>;
  const p=c.committed_budget?Math.round(c.accrued_spend/c.committed_budget*100):0;
  return <div className="flex flex-col items-end gap-1 whitespace-nowrap"><span>{inr(c.accrued_spend)}</span><span className="text-[11.5px] text-muted-foreground">of {inr(c.committed_budget)}</span><Progress value={p} hot={p>=80} className="w-20"/></div>;
}
export const LIFETIME_SPEND_LABEL='Lifetime spend / budget';
/** One profile picker shared by every period column; the chosen profile is always named. */
export function ProfileLine({report,view,label='Table measurement profile'}:{report:DeliveryReportState;view:ReportView;label?:string}){
  const {attentionKeys,selectedAttentionKey,setAttentionSeries,selectedAttention}=view;
  return <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
    <span>People and impressions: <b className="font-medium text-foreground">{profileLabel(selectedAttention)}</b>{!selectedAttention&&' · legacy presence only, no impressions'}</span>
    {attentionKeys.length>1&&<Select aria-label={label} className="w-auto" value={selectedAttentionKey} onChange={e=>setAttentionSeries(e.target.value)}>{attentionKeys.map(key=><option key={key} value={key}>{profileLabel(report.data?.attentionProfiles[key])}</option>)}</Select>}
    {attentionKeys.length>1&&<span>{attentionKeys.length} profiles, shown one at a time</span>}
  </div>;
}

export function CampaignList({d,orgId,onGo:go,onChanged:reload}:{d:any;orgId:string|null;onGo:(g:string,owner?:string)=>void;onChanged:()=>void}) {
const caps:string[]=d.caps??[];
const mayEdit=(c:any)=>caps.includes('sales') && (c.campaign_type!=='network'||caps.includes('platform'));
const money=(value:any)=>typeof value==='number'?inr(value):'—';
const advName=(id:string)=>d.advertisers.find((a:any)=>a.id===id)?.name??id;
const evidence=useCampaignEvidence(orgId&&caps.includes('platform')?orgId:null);
const now=useNow();
const report=useDeliveryReport({org:orgId??undefined});
const view=useReportView(report,{byScreen:d.screens,byCampaign:d.campaigns,byCreative:d.creatives});
const selected=view.selectedAttention;
const [preset,setPreset]=React.useState<'delivery'|'money'|'audience'>('delivery');
const [tab,setTab]=React.useState('campaigns');
const [pickedCampaigns,setPickedCampaigns]=React.useState<string[]>([]);
const [pickedCreatives,setPickedCreatives]=React.useState<string[]>([]);
const tabBase=React.useId();
const statusOf=(c:any)=>campaignStatus({campaign:c,creatives:d.creatives,screens:d.screens,advertiser:d.advertisers.find((a:any)=>a.id===c.advertiser_id),reportScreens:evidence.loaded?(evidence.campaignScreens[c.id]??{}):null,reportLoaded:evidence.loaded,now});
const setCampaign=async(c:any,patch:any)=>{if(!mayEdit(c))throw new Error('Network campaigns are managed by the platform.');await api(`/campaign/${c.id}`,patch);await reload();};
// Doc 31 Phase 5: the generic edit only pauses, resumes, completes or cancels. Draft and pending campaigns go live
// through review (Submit for review / Launch on the campaign page), never from this list.
const NEXT_STATUS:Record<string,string[]>={active:['active','paused','complete'],paused:['paused','active','complete'],draft:['draft','cancelled'],pending:['pending','cancelled']};
const statusChoices=(c:any)=>(NEXT_STATUS[c.status]??[]).map(value=>({value,label:value}));
const INVOICE_CHOICES=['not_invoiced','invoiced','paid'].map(value=>({value,label:value.replace(/_/g,' ')}));
// Pause applies to active campaigns and Resume to paused ones only; there is no bulk activate.
const campaignBulk:BulkAction<any>[]=[{label:'Pause',from:'active',status:'paused'},{label:'Resume',from:'paused',status:'active'}].map(({label,from,status})=>({label,run:async rows=>{
  if(rows.some(c=>!mayEdit(c)))throw new Error('Network campaigns are managed by the platform. Select only your own campaigns.');
  if(rows.some(c=>c.status!==from))throw new Error(label==='Resume'?'Resume applies to paused campaigns only. Draft and pending campaigns start through review on the campaign page.':'Pause applies to active campaigns only.');
  for(const c of rows)await api(`/campaign/${c.id}`,{status});}}));
// Money preset needs the `money` capability, mirroring the Invoice column and the dashboard Money tab.
type Preset='delivery'|'money'|'audience';
const presets:{id:Preset;label:string}[]=[{id:'delivery',label:'Delivery'},...(caps.includes('money')?[{id:'money' as const,label:'Money'}]:[]),{id:'audience',label:'Audience'}];
const activePreset=presets.some(p=>p.id===preset)?preset:'delivery';
// Lifetime verified settlement per campaign from the buckets this viewer may see; flat-rate campaigns have none.
const settlementOf=(id:string)=>(d.settlement_buckets??[]).filter((b:any)=>b.campaign_id===id);

const nameCol:Col<any>={ className: 'min-w-[168px]', label: 'Campaign', sort: (c: any) => c.name, render: (c: any) => <><button onClick={() => go('c/' + c.id)} className="text-left font-medium text-primary hover:underline">{c.name}</button><div className="text-[12px] text-muted-foreground">{advName(c.advertiser_id)}{c.campaign_type==='network'&&<> · <Badge variant="default">network</Badge></>}</div></> };
const orgCol:Col<any>[]=caps.includes('platform')?[{ label: 'Organisation', render:(c:any)=>d.orgs?.find((o:any)=>o.id===c.org_id)?.name??c.org_id }]:[];
const statusCol:Col<any>={ label: 'Status', sort: (c: any) => statusOf(c).label, render: (c: any) => (
  <div className="flex flex-col items-start gap-1">
    <CampaignStatusBadge status={statusOf(c)} />
    {mayEdit(c) && statusChoices(c).length > 0 && <InlineSelect value={c.status} choices={statusChoices(c)} onChange={v => setCampaign(c, { status: v })}>
      <span aria-label={`Set campaign status, currently ${c.status}`} className="text-[11.5px] text-muted-foreground">Set: {c.status}</span>
    </InlineSelect>}
  </div>) };
const metric=(which:(keyof PeriodRowCells)[])=>periodMetricCols<any>(report,selected,'byCampaign',c=>c.id,which);
const presetCols:Record<string,Col<any>[]>={
  delivery:[
    { label: 'Dates', sort: (c: any) => c.ends_at, render: (c: any) => <span className="block whitespace-nowrap font-mono text-[12px] leading-snug text-muted-foreground">{c.starts_at}<br />→ {c.ends_at}</span> },
    { label: 'Screens', num: true, sort: (c: any) => c.screen_ids.length, render: (c: any) => c.screen_ids.length },
    ...metric(['plays','people','impressions']),
    { label: LIFETIME_SPEND_LABEL, num: true, sort: (c: any) => (typeof c.accrued_spend==='number'&&c.committed_budget ? c.accrued_spend / c.committed_budget : -1), render: (c: any) => <LifetimeSpend c={c} /> },
  ],
  money:[
    { label: 'Rate', num: true, render: (c: any) => <span className="whitespace-nowrap">{c.rate_type === 'flat' ? <>{money(c.committed_budget)} <span className="text-muted-foreground">flat</span></> : typeof c.rate_value==='number' ? <>{inrRate(c.rate_value)} <span className="text-muted-foreground">/play</span></> : '—'}</span> },
    { label: 'Invoice', sort: (c: any) => c.invoice_status, render: (c: any) => (
      <InlineSelect disabled={!mayEdit(c)||c.invoice_status==null} value={c.invoice_status??''} choices={INVOICE_CHOICES} onChange={(v:string) => setCampaign(c, { invoice_status: v })}>
        <Badge variant={c.invoice_status === 'paid' ? 'ok' : c.invoice_status === 'invoiced' ? 'warn' : 'muted'}>{c.invoice_status?.replace(/_/g, ' ') ?? 'Managed by Gridcast'}</Badge>
      </InlineSelect>) },
    { label: 'Lifetime verified settlement', num: true, render: (c: any) => { const rows=settlementOf(c.id); if(!rows.length)return <span className="text-muted-foreground">—</span>;
      const gross=rows.reduce((n:number,b:any)=>n+(b.gross_paise||0),0),plays=rows.reduce((n:number,b:any)=>n+(b.billable_plays||0),0);
      return <span className="whitespace-nowrap">{inrRate(gross/100)}<br/><span className="text-[11.5px] text-muted-foreground">{plays.toLocaleString('en-IN')} billable plays · {rows.length} bucket{rows.length===1?'':'s'}</span></span>; } },
  ],
  audience:metric(['people','looking','attentive','coverage']),
};

// Selection filters the next tab: campaigns → creatives → bookings.
const campaignScope=pickedCampaigns.length?d.campaigns.filter((c:any)=>pickedCampaigns.includes(c.id)):d.campaigns;
const creativeRows=d.creatives.filter((cr:any)=>campaignScope.some((c:any)=>c.creative_ids?.includes(cr.id)));
const bookingCampaigns=pickedCreatives.length?campaignScope.filter((c:any)=>c.creative_ids?.some((id:string)=>pickedCreatives.includes(id))):campaignScope;
const bookingRows=bookingCampaigns.flatMap((c:any)=>(c.screen_ids??[]).map((sid:string)=>({id:c.id+':'+sid,campaign:c,screen_id:sid,booking:c.bookings?.find((b:any)=>b.screen_id===sid)})));
const screenOf=(id:string)=>d.screens.find((s:any)=>s.id===id);
const filterNote=(n:number,what:string,clear:()=>void)=>n?<p className="mb-3 text-xs text-muted-foreground">Showing {what} for {n} selected · <button className="text-primary hover:underline" onClick={clear}>Show all</button></p>:null;
const coverageCue=report.data&&!report.loading?periodCues(report.data):[];
return (
<>
        <PageHead title="Campaigns" sub="Budgets are entered manually — the platform is a ledger, not a processor"
          actions={<Button disabled={!orgId} onClick={() => go('new')}>+ New campaign</Button>} />
        {caps.includes('sales') && <DraftsList orgId={orgId} advertisers={d.advertisers} onGo={go} />}
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <TabList tabs={[{id:'campaigns',label:`Campaigns${pickedCampaigns.length?` · ${pickedCampaigns.length}`:''}`},{id:'creatives',label:`Creatives${pickedCreatives.length?` · ${pickedCreatives.length}`:''}`},{id:'bookings',label:'Bookings'}]} value={tab} onChange={setTab} label="Campaign table" idBase={tabBase} />
          <ReportPeriodBar report={report} view={view} className="flex flex-wrap items-end gap-2" />
        </div>
        <div className="mb-3 space-y-2 empty:hidden"><ReportAlerts report={report} view={view} showLoading={false} /></div>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          {tab==='campaigns'&&<div role="group" aria-label="Column preset" className="flex gap-1.5">{presets.map(p=><Button key={p.id} type="button" size="sm" variant={activePreset===p.id?'default':'outline'} aria-pressed={activePreset===p.id} onClick={()=>setPreset(p.id)}>{p.label}</Button>)}</div>}
          <span className="text-xs text-muted-foreground">Period columns: {periodLabel(report.period)} · IST{coverageCue.map(c=><Badge key={c.text} variant="warn" className="ml-1.5">{c.text}</Badge>)}{tab==='campaigns'&&activePreset==='delivery'&&' · spend is lifetime'}</span>
        </div>
        <div className="mb-3"><ProfileLine report={report} view={view} /></div>

        <div role="tabpanel" id={`${tabBase}-panel-campaigns`} aria-labelledby={`${tabBase}-tab-campaigns`} hidden={tab!=='campaigns'}>
        <DataTable cols={[nameCol,...orgCol,statusCol,...presetCols[activePreset]]} rows={d.campaigns} rowId={(c: any) => c.id} exportName="campaigns" bulk={caps.includes('sales') ? campaignBulk : undefined} onDone={() => reload()}
          selected={pickedCampaigns} onSelectionChange={setPickedCampaigns}
          search={(c: any) => `${c.name} ${advName(c.advertiser_id)}`}
          facets={[{ label: 'Status', get: (c: any) => statusOf(c).label.split(' · ')[0] }, { label: 'Type', get: (c: any) => c.campaign_type },
                   ...(caps.includes('money') ? [{ label: 'Invoice', get: (c: any) => (c.invoice_status??'managed_by_gridcast').replace(/_/g, ' ') }] : [])]} />
        </div>

        <div role="tabpanel" id={`${tabBase}-panel-creatives`} aria-labelledby={`${tabBase}-tab-creatives`} hidden={tab!=='creatives'}>
        {filterNote(pickedCampaigns.length,'creatives of the campaigns',()=>setPickedCampaigns([]))}
        <p className="mb-3 text-xs text-muted-foreground">Plays and impressions cover every campaign the creative ran in during the period. Select creatives to filter Bookings.</p>
        <DataTable cols={[
          { label: 'Creative', sort: (cr: any) => cr.name, render: (cr: any) => <div className="flex items-center gap-3"><Thumb id={cr.youtube_id} w={58} /><div><div className="font-medium">{cr.name}</div><div className="font-mono text-[11.5px] text-muted-foreground">{cr.duration_s}s</div></div></div> },
          { label: 'Advertiser', render: (cr: any) => advName(cr.advertiser_id) },
          { label: 'Approval', sort: (cr: any) => cr.approval_status, render: (cr: any) => <Badge variant={cr.approval_status === 'approved' ? 'ok' : cr.approval_status === 'rejected' ? 'destructive' : 'warn'}>{cr.approval_status}</Badge> },
          { label: 'Campaigns', num: true, render: (cr: any) => campaignScope.filter((c:any)=>c.creative_ids?.includes(cr.id)).length },
          ...periodMetricCols<any>(report,selected,'byCreative',cr=>cr.id,['plays','impressions']),
        ]} rows={creativeRows} rowId={(cr: any) => cr.id} exportName="campaign-creatives" empty="No creatives on these campaigns" selected={pickedCreatives} onSelectionChange={setPickedCreatives}
          search={(cr: any) => `${cr.name} ${advName(cr.advertiser_id)}`} />
        </div>

        <div role="tabpanel" id={`${tabBase}-panel-bookings`} aria-labelledby={`${tabBase}-tab-bookings`} hidden={tab!=='bookings'}>
        {filterNote(pickedCampaigns.length,'bookings of the campaigns',()=>setPickedCampaigns([]))}
        {filterNote(pickedCreatives.length,'campaigns using the creatives',()=>setPickedCreatives([]))}
        <p className="mb-3 text-xs text-muted-foreground">Current bookings. Rates are frozen per screen when booked.</p>
        <DataTable cols={[
          { label: 'Campaign', sort: (r: any) => r.campaign.name, render: (r: any) => <button onClick={() => go('c/' + r.campaign.id)} className="text-left font-medium text-primary hover:underline">{r.campaign.name}</button> },
          { label: 'Screen', sort: (r: any) => screenOf(r.screen_id)?.name ?? r.screen_id, render: (r: any) => <><div className="font-medium">{screenOf(r.screen_id)?.name ?? r.screen_id}</div><div className="text-[12px] text-muted-foreground">{screenOf(r.screen_id)?.address}</div></> },
          { label: 'Turns / round', num: true, render: (r: any) => r.booking ? (r.booking.rotation_weight ?? r.booking.slots_per_loop ?? 1) : <span className="text-xs text-muted-foreground">Legacy booking</span> },
          { label: 'Rate', num: true, render: (r: any) => r.booking?.rate_type==='per_play'&&typeof r.booking.rate_value==='number'?`${inrRate(r.booking.rate_value)} / play`:r.booking?.rate_type==='flat'?'Agreed flat rate':<span className="text-muted-foreground">—</span> },
          { label: 'Booked', render: (r: any) => <span className="font-mono text-[12px] text-muted-foreground">{r.booking?.booked_at?.slice(0,10) ?? '—'}</span> },
        ]} rows={bookingRows} rowId={(r: any) => r.id} exportName="campaign-bookings" empty="No bookings on these campaigns" />
        </div>
      </>
);
}
