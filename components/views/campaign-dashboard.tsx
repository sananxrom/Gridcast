'use client';
/**
 * Ranked campaign dashboard (build plan doc 31, Phase 2): header → four headline cards → one daily chart → tabs.
 * Every number comes from the same selectors and report parts as the full `DeliveryReport`; nothing is recomputed.
 * `report` is owned by `CampaignDetail`, so changing tabs never resets the period.
 */
import React, { useId, useState } from 'react';
import { type Period, periodLabel } from '@/lib/metrics';
import { inrRate, fmtDate } from '@/lib/utils';
import type { CampaignStatus } from '@/lib/campaign-status';
import { Explain } from '@/components/ui/explain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/stat';
import { DataTable } from '@/components/ui/table';
import { TabList, TabPanel } from '@/components/ui/tabs';
import { type DeliveryData, type DeliveryReportState, emptyCounters, number } from '@/components/views/delivery-report';
import { AttentionInsights, AttentionProvenance, Chart, CreativeComparison, DeliveryBreakdown, DeliveryCards, HourlyPresence, MeasurementCards, ProfileHourTable, ReportAlerts, ReportCoverageNote, ReportInvalidTimeNote, ReportPeriodBar, type ReportView, useReportView } from '@/components/views/report-parts';
import { type ChartPoint, type Cue, dailyImpressionRows, dailyPeopleRows, estimatedImpressionsCard, hasValues, paidDeliveredCard, periodBreakdownPlays, playsCues, presenceCard, profileCues, rowPeople, spendCard } from '@/components/views/report-metrics';
import { CampaignStatusBadge } from './campaign-status-badge';
import { Settlement } from './settlement';
import { Thumb } from './bits';

const LIFETIME: Period = { from: '', to: '', label: 'Campaign lifetime · visible records' };
const CUE_VARIANT = { muted: 'muted', warn: 'warn', default: 'default' } as const;

function HeadlineCard({ title, explain, value, cues, hint, children }: { title: string; explain: React.ReactNode; value: string; cues: Cue[]; hint?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Card role="group" aria-label={title} className="flex min-w-0 flex-col p-4">
      <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><span className="min-w-0 truncate">{title}</span>{explain}</div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xl font-semibold tracking-tight tnum sm:text-2xl">{value}</span>
        {cues.map(cue => <Badge key={cue.text} variant={CUE_VARIANT[cue.tone]} className="whitespace-normal">{cue.text}</Badge>)}
      </div>
      {children}
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

/** Report-backed card text while the report is loading or failed: never a number. */
function pendingCard(report: DeliveryReportState) {
  return report.loading ? { value: '…', cues: [{ text: 'loading', tone: 'muted' } as Cue] } : { value: 'Unavailable', cues: [{ text: 'report not loaded', tone: 'warn' } as Cue] };
}

function HeadlineCards({ c, report, view, scopedNetwork, rate }: { c: any; report: DeliveryReportState; view: ReportView; scopedNetwork: boolean; rate: string }) {
  const { data, period } = report;
  const selected = view.selectedAttention;
  const completeness = data ? { measured: data.totals.presence_n, total: data.totals.plays_rendered, truncated: !data.coverage.complete } : undefined;
  const spend = spendCard(c, scopedNetwork, rate);
  const plays = data && paidDeliveredCard(data), impressions = data && estimatedImpressionsCard(data, selected), people = data && presenceCard(data, selected);
  const pending = pendingCard(report);
  return (
    <section aria-label="Campaign headline" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <HeadlineCard title={spend.label} explain={<Explain metric="recorded_campaign_accrual" period={LIFETIME} />} value={spend.value} cues={spend.cues} hint={spend.hint}>
        {spend.bar && <div className="mt-3 flex items-center gap-2"><Progress value={spend.pct} hot={spend.hot} /><span className="shrink-0 text-[11px] text-muted-foreground tnum">{spend.pct}%</span></div>}
      </HeadlineCard>
      <HeadlineCard title="Plays" explain={<Explain metric="plays_rendered" period={period} completeness={completeness} />}
        value={data && plays ? plays.value : pending.value} cues={data ? playsCues(data) : pending.cues} hint={data && plays ? `${plays.hint} · ${periodLabel(period)}` : periodLabel(period)} />
      <HeadlineCard title="Est. impressions" explain={<Explain metric="estimated_impressions" period={period} completeness={completeness} />}
        value={data && impressions ? impressions.value : pending.value} cues={data ? profileCues(data, view.attentionKeys, selected, 'impressions') : pending.cues} hint={impressions?.hint} />
      <HeadlineCard title="Avg people present" explain={<Explain metric="presence_avg" period={period} completeness={completeness} />}
        value={data && people ? people.value : pending.value} cues={data ? profileCues(data, view.attentionKeys, selected, 'people') : pending.cues} hint={people?.hint} />
    </section>
  );
}

type SeriesId = 'plays' | 'people' | 'impressions';
function DailyTrend({ data, period, view }: { data: DeliveryData | null; period: Period; view: ReportView }) {
  const [metric, setMetric] = useState<SeriesId>('plays');
  const selected = view.selectedAttention;
  const series: Record<SeriesId, ChartPoint[]> = { plays: view.dateRows, people: dailyPeopleRows(data, period, selected), impressions: dailyImpressionRows(data, period, selected) };
  const options: { id: SeriesId; label: string; unit: string; note: string; format: (v: number) => string }[] = [
    { id: 'plays', label: 'Plays', unit: 'paid plays', note: 'Recorded paid plays per IST day. Days before daily summaries started are gaps, not zero.', format: number },
    { id: 'people', label: 'Avg people', unit: selected ? 'people per body-observed time' : 'mean people per measured paid play', note: selected ? `Selected profile only (${selected.profile}). Days without body observations are gaps.` : 'Legacy presence per measured paid play. Unmeasured days are gaps, not zero.', format: v => v.toFixed(selected ? 2 : 1) },
    { id: 'impressions', label: 'Est. impressions', unit: 'estimated impressions', note: 'Selected profile only. Analytics estimate; not unique reach or billing evidence.', format: number },
  ];
  // Fall back to the first option with data; an option without data never renders as the selected one.
  const active = hasValues(series[metric]) ? metric : options.find(o => hasValues(series[o.id]))?.id ?? metric;
  const option = options.find(o => o.id === active)!, rows = series[active], plotted = rows.filter(row => row.value !== null).length;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">Daily trend <span className="font-normal text-muted-foreground">· {periodLabel(period)}</span></h2>
        <div role="group" aria-label="Chart metric" className="flex flex-wrap gap-1.5 sm:ml-auto">
          {options.map(o => {
            const available = hasValues(series[o.id]), selected = available && o.id === active;
            return <Button key={o.id} type="button" size="sm" variant={selected ? 'default' : 'outline'} aria-pressed={selected} disabled={!available} onClick={() => setMetric(o.id)}>
              {o.label}{!available && <span className="text-[10px] font-normal">· Unavailable</span>}
            </Button>;
          })}
        </div>
      </div>
      <p className="mb-3 mt-1 text-xs text-muted-foreground">{option.note}</p>
      {plotted >= 2 ? <Chart key={active} points={rows} label={`Daily ${option.label.toLowerCase()}`} unit={option.unit} />
        : <p className="py-3 text-xs text-muted-foreground">{plotted ? 'Only one day has data. Read the exact value below.' : 'No daily data in this period yet.'}</p>}
      {rows.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer font-medium">View daily values</summary><div className="max-h-72 overflow-auto"><table className="mt-2 w-full text-left"><caption className="sr-only">Daily {option.label.toLowerCase()} in IST</caption><thead><tr><th scope="col">Date</th><th scope="col" className="text-right">{option.label}</th></tr></thead><tbody>{rows.map(row => <tr key={row.key} className="border-t"><th scope="row" className="py-2 font-normal">{row.key}</th><td className="text-right">{row.value === null ? 'Unavailable' : option.format(row.value)}</td></tr>)}</tbody></table></div></details>}
    </Card>
  );
}

function ReportPending({ report }: { report: DeliveryReportState }) {
  return <p role="status" className="py-6 text-sm text-muted-foreground">{report.loading ? `Loading the report for ${periodLabel(report.period)}…` : 'The report for this period is not available.'}</p>;
}

/**
 * `diagnostics={false}` is the read-only advertiser view (doc 31 Phase 6): no Diagnostics tab and no eligibility column.
 * Edit and Money are absent there because the advertiser page passes no actions and `mayMoney={false}`.
 */
export function CampaignDashboard({ d, report, status, actions, mayMoney, scopedNetwork, rate, onGo, children, diagnostics = true, back = { label: 'Campaigns', go: 'campaigns' } }: {
  d: any; report: DeliveryReportState; status: CampaignStatus; actions?: React.ReactNode; mayMoney: boolean; scopedNetwork: boolean; rate: string; onGo: (g: string) => void; children?: React.ReactNode;
  diagnostics?: boolean; back?: { label: string; go: string };
}) {
  const c = d.campaign;
  const screens = d.byScreen.map((r: any) => r.screen), creatives = d.byCreative.map((r: any) => r.creative);
  const view = useReportView(report, { byScreen: screens, byCampaign: [c], byCreative: creatives });
  const { data, period, loading } = report;
  const selected = view.selectedAttention;
  const [tab, setTab] = useState('screens');
  const idBase = useId();
  const tabs = [{ id: 'screens', label: 'Screens' }, { id: 'creatives', label: 'Creatives' }, { id: 'audience', label: 'Audience' }, ...(mayMoney ? [{ id: 'money', label: 'Money' }] : []), ...(diagnostics ? [{ id: 'diagnostics', label: 'Diagnostics' }] : [])];
  const activeTab = tabs.some(t => t.id === tab) ? tab : 'screens';
  const ready = data && !loading ? data : null;

  // Period values per screen / creative from the campaign-filtered report; "—" before summaries start.
  const periodPlays = (row: any) => !ready ? { value: loading ? '…' : 'Unavailable' } : periodBreakdownPlays(ready, row);
  const playsCell = (row: any) => { const cell = periodPlays(row); return <span className="inline-flex items-center justify-end gap-1.5">{cell.value}{cell.cue && <Badge variant="warn">{cell.cue}</Badge>}</span>; };
  const screenPeople = (id: string) => !ready ? (loading ? '…' : 'Unavailable') : ready.coverage.started_at ? rowPeople(ready.byScreen[id] || emptyCounters(), selected?.byScreen?.[id], !!selected) : '—';
  const ineligible = new Map(status.evidence.ineligible_screens.map(s => [s.screen_id, s.text]));
  const decisions: any[] | null = Array.isArray(d.eligibility) ? d.eligibility : null;

  const diagnosticTimes = d.plays.map((p:any)=>Date.parse(p.ended_at || p.started_at)).filter(Number.isFinite).sort((a:number,b:number)=>a-b);
  const diagnosticDate = (at:number) => new Date(at).toLocaleString('en-IN', {timeZone:'Asia/Kolkata'});
  const diagnosticWindow = diagnosticTimes.length ? `${diagnosticDate(diagnosticTimes[0])} – ${diagnosticDate(diagnosticTimes[diagnosticTimes.length-1])} IST` : 'No dated receipts loaded';

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <button onClick={() => onGo(back.go)} className="mb-1 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground">← {back.label}</button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight">{c.name}</h1>
            <CampaignStatusBadge status={status} />
          </div>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{d.advertiser?.name} · {d.org?.name} · <span className="font-mono">{c.starts_at} → {c.ends_at}</span></p>
          {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        <ReportPeriodBar report={report} view={view} className="flex flex-wrap items-end gap-2" />
      </div>
      <div className="mb-4 space-y-3 empty:hidden"><ReportAlerts report={report} view={view} showLoading={false} /></div>
      {children}

      <HeadlineCards c={c} report={report} view={view} scopedNetwork={scopedNetwork} rate={rate} />
      <div className="mt-4"><DailyTrend data={ready} period={period} view={view} /></div>

      <div className="mt-6">
        <TabList tabs={tabs} value={activeTab} onChange={setTab} label="Campaign sections" idBase={idBase} />
        <TabPanel idBase={idBase} id={activeTab}>
          {activeTab === 'screens' && <>
            <p className="mb-3 text-xs text-muted-foreground">Bookings are current. Plays and people cover {periodLabel(period)} for this campaign.{diagnostics && ' Eligibility is the server’s latest schedule decision.'}</p>
            <DataTable
              cols={[
                { label: 'Screen', render: (r: any) => <><div className="font-medium">{r.screen.name}</div><div className="text-[12px] text-muted-foreground">{r.screen.address}</div></> },
                { label: 'Venue', render: (r: any) => <Badge variant="muted">{r.screen.venue_type}</Badge> },
                {label:'Booking',render:(r:any)=>{const b=c.bookings?.find((x:any)=>x.screen_id===r.screen.id);return b?<span className="text-xs">{b.rotation_weight ?? b.slots_per_loop ?? 1} turns / round<br/>{b.rate_type==='per_play'&&typeof b.rate_value==='number'?`${inrRate(b.rate_value)} / play`:b.rate_type==='flat'?'Agreed flat rate':'Rate unavailable'}</span>:<span className="text-xs text-muted-foreground">Legacy booking</span>;}},
                { label: 'Plays', num: true, render: (r: any) => playsCell(ready?.byScreen[r.screen.id]) },
                { label: selected ? 'Avg people · selected profile' : 'Legacy avg people', num: true, render: (r: any) => screenPeople(r.screen.id) },
                ...(!diagnostics ? [] : [{ label: 'Eligibility', render: (r: any) => { const text = ineligible.get(r.screen.id); if (text) return <Badge variant="warn" className="whitespace-normal">{text}</Badge>; if (decisions?.some(x => x.screen_id === r.screen.id && x.eligible)) return <Badge variant="ok">Eligible</Badge>; return <span className="text-xs text-muted-foreground">{decisions ? 'No decision' : 'Not checked'}</span>; } }]),
              ]}
              rows={d.byScreen.map((r:any)=>({screen:r.screen}))} rowId={(r: any) => r.screen.id} exportName="campaign-screens" empty="No screens on this campaign" />
          </>}

          {activeTab === 'creatives' && <>
            <p className="mb-3 text-xs text-muted-foreground">Plays cover {periodLabel(period)}. Exposure differs by screen, time and rotation; differences do not show which creative caused a response.</p>
            <DataTable
              cols={[
                { label: 'Creative', render: (r: any) => <div className="flex items-center gap-3"><Thumb id={r.creative.youtube_id} w={58} /><div><div className="font-medium">{r.creative.name}</div><div className="font-mono text-[11.5px] text-muted-foreground">{r.creative.duration_s}s</div></div></div> },
                { label: 'Approval', render: (r: any) => <Badge variant={r.creative.approval_status === 'approved' ? 'ok' : r.creative.approval_status === 'rejected' ? 'destructive' : 'warn'}>{r.creative.approval_status}</Badge> },
                { label: 'Plays', num: true, render: (r: any) => playsCell(ready?.byCreative[r.creative.id]) },
              ]}
              rows={d.byCreative.map((r:any)=>({creative:r.creative}))} rowId={(r: any) => r.creative.id} exportName="campaign-creatives" empty="No creatives on this campaign" />
            {ready && selected && <Card className="mt-4 p-4"><CreativeComparison view={view} /></Card>}
            {ready && !selected && <p className="mt-3 text-xs text-muted-foreground">No accepted attention analytics in this period, so there is no creative comparison. Plays without analytics are unknown, not zero.</p>}
          </>}

          {activeTab === 'audience' && (ready ? <div className="space-y-4">
            <MeasurementCards data={ready} period={period} view={view} />
            {selected ? <ProfileHourTable profile={selected} /> : <HourlyPresence data={ready} period={period} view={view} />}
            <AttentionInsights view={view} period={period} provenance={false} creativeComparison={false} />
          </div> : <ReportPending report={report} />)}

          {activeTab === 'money' && mayMoney && <>
            <h2 className="mb-3 text-[15px] font-semibold tracking-tight">Verified settlement</h2>
            <Settlement buckets={d.settlement_buckets??[]} campaigns={[c]} screens={screens}/>
          </>}

          {activeTab === 'diagnostics' && diagnostics && <div className="space-y-4">
            {ready ? <>
              <Card className="space-y-3 p-4"><h2 className="text-sm font-semibold">Report coverage</h2><ReportCoverageNote data={ready} period={period} /><ReportInvalidTimeNote data={ready} /></Card>
              <DeliveryCards data={ready} period={period} />
              <DeliveryBreakdown data={ready} period={period} view={view} />
              {selected && <Card className="p-4"><h2 className="text-sm font-semibold">Measurement provenance</h2><AttentionProvenance view={view} /></Card>}
            </> : <ReportPending report={report} />}
            <p className="text-xs text-muted-foreground">Rotation is not a controlled A/B experiment: differences may reflect screen, time and audience.</p>
            <details className="rounded-xl border border-border p-4">
            <summary className="cursor-pointer text-sm font-semibold">Play diagnostics · {d.plays.length} newest available receipts</summary>
            <p className="mb-2 mt-3 text-xs text-muted-foreground">Loaded receipt window: {diagnosticWindow}. This limited window is independent of the selected report dates.</p>
            <p className="mb-3 text-xs text-muted-foreground">Recent diagnostic records only. This table is not full delivery history and does not determine the report totals above. Reports can include incomplete or non-billable playback; each row shows its evidence.</p>
            <DataTable
              cols={[
                { label: 'When', render: (p: any) => <span className="font-mono text-[12px] text-muted-foreground">{fmtDate(p.ended_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> },
                { label: 'Screen', render: (p: any) => d.byScreen.find((s: any) => s.screen.id === p.screen_id)?.screen.name ?? '—' },
                { label: 'Creative', render: (p: any) => d.byCreative.find((c2: any) => c2.creative.id === p.creative_id)?.creative.name ?? '—' },
                { label: 'Duration', num: true, render: (p: any) => `${Math.round(p.duration_ms / 1000)}s` },
                {label:'Evidence',render:(p:any)=><span className="text-xs text-muted-foreground">{p.source==='seed'?'synthetic demo':p.source||'unknown source'} · {p.billable===true?'billable':p.billable===false?'non-billable':'billing unverified'}<br/>{p.presence?.measured?p.presence.model_ver||'model unspecified':'not measured'}</span>},
                { label: 'People present', num: true, render: (p: any) => p.presence?.measured
                    ? <><b>{p.presence.avg_persons.toFixed(1)}</b> <span className="text-[11.5px] text-muted-foreground">({p.presence.sample_count})</span></>
                    : <span className="text-muted-foreground">not measured</span> },
              ]}
              rows={d.plays} rowId={(p: any) => p.id} exportName="limited-recent-diagnostics" empty="No plays recorded yet — pair a player to one of these screens" />
            </details>
          </div>}
        </TabPanel>
      </div>
    </>
  );
}
