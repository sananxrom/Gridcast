'use client';

/**
 * The blocks of the full delivery report, moved verbatim out of `DeliveryReport` so the campaign dashboard can reuse
 * them. `DeliveryReport` composes these in the original order; its DOM is unchanged. Headline numbers come from the
 * shared selectors in `report-metrics.ts`.
 */
import { useEffect, useId, useState } from 'react';
import { type MetricId, type Period, periodLabel } from '@/lib/metrics';
import { Explain } from '@/components/ui/explain';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { type AttentionCounters, type AttentionProfile, type DeliveryData, type DeliveryReportState, type ReportCounters, attentionHours, attentionPeopleRate, average, dailyReportCsv, emptyCounters, formatAverage, istDate, number, periodError, rangeDays, reportPreset } from '@/components/views/delivery-report';
import { attentiveImpressionsCard, billableCard, profileLabel, dailyPlayRows, estimatedImpressionsCard, failedCard, fillerCard, lookingCard, paidDeliveredCard, presenceCard, rowPeople, selectAttention, type CardText } from '@/components/views/report-metrics';

export function ProfileHourTable({profile}:{profile:AttentionProfile}) {
  return <Card className="p-4"><h3 className="text-sm font-semibold">Average people present by hour · {profile.profile.startsWith('presence-v2/')?'V2':'selected profile'}</h3>
    <p className="mb-3 text-xs text-muted-foreground">Person-time divided by body-observed time. Hourly values use this profile only; coverage is shown in observed minutes and profile plays.</p>
    <div className="max-h-72 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>Hour · IST</th><th className="text-right">Avg people</th><th className="text-right">Body-observed min</th><th className="text-right">Profile plays</th></tr></thead><tbody>{Array.from({length:24},(_,hour)=>{const c=profile.hourly[String(hour)],value=c?attentionPeopleRate(c.presence_person_ms,c.body_observed_ms):null;return <tr key={hour} className="border-t"><th className="py-2 font-normal">{String(hour).padStart(2,'0')}:00</th><td className="text-right">{value===null?'Unavailable':value.toFixed(2)}</td><td className="text-right">{c?(c.body_observed_ms/60000).toFixed(1):'—'}</td><td className="text-right">{c?number(c.plays):'—'}</td></tr>;})}</tbody></table></div>
  </Card>;
}
function timeLabel(value: string) { return new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST'; }
export function downloadCsv(data: DeliveryData, period: Period, selectedProfileKey?:string) {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + dailyReportCsv(data, period, selectedProfileKey)], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `gridcast-report-${period.from}-${period.to}.csv`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function MetricLabel({ metric, period, data, children }: { metric: MetricId; period: Period; data: DeliveryData; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1">{children}<Explain metric={metric} period={period} completeness={{ measured: data.totals.presence_n, total: data.totals.plays_rendered, truncated: !data.coverage.complete }} /></span>;
}
export function Chart({ points, label, unit, bars = false }: { points: { key: string; value: number | null; detail: string }[]; label: string; unit: string; bars?: boolean }) {
  const [active, setActive] = useState<string | null>(null);
  const titleId = useId(), descriptionId = useId();
  const max = Math.max(1, ...points.map(point => point.value ?? 0));
  const x = (index: number) => 48 + index * 592 / Math.max(1, points.length - 1);
  const y = (value: number) => 164 - value / max * 128;
  const paths: string[] = []; let segment = '';
  points.forEach((point, index) => { if (point.value === null) { if (segment) paths.push(segment); segment = ''; } else { segment += `${segment ? ' L' : 'M'}${x(index)},${y(point.value)}`; } });
  if (segment) paths.push(segment);
  return <div>
    <svg viewBox="0 0 688 200" className="w-full text-primary" role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
      <title id={titleId}>{label}</title><desc id={descriptionId}>Recorded {unit}. Missing measurement has no plotted value. The table below provides every value.</desc>
      {[0, max / 2, max].map((value, i) => <g key={i}><line x1="48" x2="640" y1={y(value)} y2={y(value)} className="stroke-border" /><text x="40" y={y(value) + 4} textAnchor="end" className="fill-muted-foreground" fontSize="11">{value.toFixed(max < 10 ? 1 : 0)}</text></g>)}
      {!bars && paths.map((path, index) => <path key={index} d={path} fill="none" stroke="currentColor" strokeWidth="2" />)}
      {points.map((point, index) => point.value === null ? null : <g key={point.key} tabIndex={0} role="img" aria-label={`${point.key}: ${point.detail}`} onFocus={() => setActive(`${point.key}: ${point.detail}`)} onBlur={() => setActive(null)} onMouseEnter={() => setActive(`${point.key}: ${point.detail}`)} onMouseLeave={() => setActive(null)} className="outline-none focus:opacity-60">
        <title>{point.key}: {point.detail}</title>
        {bars ? <rect x={x(index) - Math.min(8, 230 / points.length)} width={Math.min(16, 460 / points.length)} y={y(point.value)} height={Math.max(1, 164 - y(point.value))} fill="currentColor" rx="2" /> : <circle cx={x(index)} cy={y(point.value)} r={points.length > 35 ? 2 : 3} fill="currentColor" />}
      </g>)}
      <text x="48" y="188" className="fill-muted-foreground" fontSize="11">{points[0]?.key}</text><text x="640" y="188" textAnchor="end" className="fill-muted-foreground" fontSize="11">{points.at(-1)?.key}</text>
    </svg>
    <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">{active || 'Focus or point at a mark for details. All times are IST.'}</p>
  </div>;
}
export function DataTable({ rows, firstHeading, period, data, profileRows }: { rows: { id: string; name: string; counters: ReportCounters }[]; firstHeading: string; period: Period; data: DeliveryData; profileRows?:Record<string,AttentionCounters> }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [firstHeading, period.from, period.to]);
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const currentPage = Math.min(page, pages - 1);
  const visible = rows.slice(currentPage * 50, (currentPage + 1) * 50);
  return <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">{firstHeading} delivery for {periodLabel(period)}, based on available accepted receipts.</caption><thead><tr className="border-b text-muted-foreground"><th className="py-2 pr-3" scope="col">{firstHeading}</th>{(['plays_rendered', 'plays_billable', 'plays_not_rendered'] as const).map((metric, index) => <th key={metric} className="px-2 py-2 text-right whitespace-nowrap" scope="col"><MetricLabel metric={metric} period={period} data={data}>{['Delivered', 'Billable', 'Failed'][index]}</MetricLabel></th>)}<th className="px-2 py-2 text-right" scope="col">{profileRows?'Avg people · selected profile':'Legacy avg people'}</th><th className="px-2 py-2 text-right" scope="col">{profileRows?'Body-observed min · profile plays':'Legacy measured / delivered'}</th></tr></thead><tbody>{visible.map(({ id, name, counters }) => {const p=profileRows?.[id];return <tr key={id} className="border-b last:border-0"><th className="max-w-[16rem] break-words py-3 pr-3 font-medium" scope="row">{name}</th><td className="px-2 text-right tnum">{number(counters.plays_rendered)}</td><td className="px-2 text-right tnum">{number(counters.plays_billable)}</td><td className="px-2 text-right tnum">{number(counters.plays_not_rendered)}</td><td className="px-2 text-right tnum">{rowPeople(counters,p,!!profileRows)}</td><td className="px-2 text-right tnum">{profileRows?(p?`${(p.body_observed_ms/60000).toFixed(1)} min · ${number(p.plays)} plays`:'No profile data'): `${number(counters.presence_n)} / ${number(counters.plays_rendered)}`}</td></tr>;})}</tbody></table>{!rows.length && <p className="py-4 text-sm text-muted-foreground">No paid delivery records in this range.</p>}{pages > 1 && <div className="mt-3 flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{currentPage * 50 + 1}–{Math.min(rows.length, (currentPage + 1) * 50)} of {number(rows.length)}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>Next</Button></div></div>}</div>;
}
export type ReportDimension = 'byScreen' | 'byCampaign' | 'byCreative';
export type ReportMetadata = Record<ReportDimension, { id: string; name: string }[]>;
/** Shared local view state of a report: period preset and draft, breakdown dimension and selected measurement profile. */
export function useReportView(report: DeliveryReportState, metadata: ReportMetadata) {
  const { data, period } = report;
  const [preset, setPreset] = useState(() => ['today', '7d', '30d', 'month'].find(value => {
    const candidate = reportPreset(value);
    return candidate.from === period.from && candidate.to === period.to;
  }) || 'custom');
  const [draft, setDraft] = useState(period);
  const [validation, setValidation] = useState<string | null>(null);
  const [dimension, setDimension] = useState<'byScreen' | 'byCampaign' | 'byCreative'>('byScreen');
  const [attentionSeries,setAttentionSeries]=useState('');
  const inputId = useId();
  const dateRows = dailyPlayRows(data, period);
  const hourRows = data?.coverage.started_at ? Array.from({ length: 24 }, (_, hour) => {
    const row = data.hourly.find(item => Number(item.hour) === hour) || emptyCounters();
    return { key: String(hour).padStart(2, '0') + ':00', value: average(row), detail: `${formatAverage(row)}; ${number(row.presence_n)} measured of ${number(row.plays_rendered)} paid plays`, row };
  }) : [];
  const { keys: attentionKeys, key: selectedAttentionKey, profile: selectedAttention } = selectAttention(data, attentionSeries);
  const provenanceRows=selectedAttention?Object.values(selectedAttention.provenance||{}):[], guidedObserved=provenanceRows.filter(x=>x.mode==='guided').reduce((n,x)=>n+x.totals.attention_observed_ms,0), calibratedShare=selectedAttention?.totals.attention_observed_ms?100*guidedObserved/selectedAttention.totals.attention_observed_ms:null;
  const dimensions = data ? Object.entries(data[dimension]).filter(([, row]) => row.plays_rendered + row.plays_not_rendered > 0).sort(([, a], [, b]) => b.plays_rendered - a.plays_rendered).map(([id, counters]) => ({ id, counters, name: metadata[dimension].find(item => item.id === id)?.name || id })) : [];
  return { preset, setPreset, draft, setDraft, validation, setValidation, dimension, setDimension, attentionSeries, setAttentionSeries, inputId, dateRows, hourRows, metadata, attentionKeys, selectedAttentionKey, selectedAttention, provenanceRows, calibratedShare, dimensions };
}
export type ReportView = ReturnType<typeof useReportView>;

/** Period picker, Refresh and Export CSV. */
export function ReportPeriodBar({ report, view, className = 'flex flex-wrap items-end gap-3' }: { report: DeliveryReportState; view: ReportView; className?: string }) {
  const { data, period, loading } = report;
  const { inputId, preset, setPreset, setValidation, draft, setDraft, selectedAttentionKey } = view;
  return <div className={className}>
      <div><label htmlFor={inputId} className="mb-1 block text-xs font-medium">Reporting period · IST</label><Select id={inputId} value={preset} onChange={event => { const value = event.target.value; setPreset(value); setValidation(null); if (value !== 'custom') { const next = reportPreset(value); setDraft(next); report.setPeriod(next); } }} className="min-w-[160px]"><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="month">This month</option><option value="custom">Custom dates</option></Select></div>
      {preset === 'custom' && <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); const invalid = periodError(draft); setValidation(invalid); if (!invalid) report.setPeriod(draft); }}><div><label htmlFor={inputId + '-from'} className="mb-1 block text-xs">From</label><Input id={inputId + '-from'} type="date" max={istDate()} value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} required /></div><div><label htmlFor={inputId + '-to'} className="mb-1 block text-xs">To</label><Input id={inputId + '-to'} type="date" max={istDate()} value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} required /></div><Button type="submit" variant="outline">Apply</Button></form>}
      <div className="ml-auto flex gap-2"><Button variant="outline" disabled={loading} onClick={report.reload}>Refresh</Button><Button variant="outline" disabled={!data || loading} onClick={() => data && downloadCsv(data, period, selectedAttentionKey)}>Export CSV</Button></div>
  </div>;
}
/** Period validation, load error and loading state. */
export function ReportAlerts({ report, view, showLoading = true }: { report: DeliveryReportState; view: ReportView; showLoading?: boolean }) {
  const { period, loading, error } = report;
  const { validation } = view;
  return <>
    {validation && <p role="alert" className="text-sm text-destructive">{validation}</p>}
    {error && <Card className="p-4 text-sm"><p role="alert">{error}</p><Button variant="outline" className="mt-3" onClick={report.reload}>Retry report</Button></Card>}
    {showLoading && loading && <p role="status" className="py-8 text-sm text-muted-foreground">Loading all daily summaries for {periodLabel(period)}…</p>}
  </>;
}
/** Coverage prose: period, data source, collection start and partial-period note. */
export function ReportCoverageNote({ data, period }: { data: DeliveryData; period: Period }) {
  return <div className="text-xs leading-relaxed text-muted-foreground"><p><strong className="text-foreground">{periodLabel(period)} · IST.</strong> Based on accepted device receipts with valid clocks, grouped by the play’s start date. Offline devices may report up to 72 hours later.</p><p>{data.coverage.started_at ? `Daily summaries started ${timeLabel(data.coverage.started_at)}. ` : 'Daily summary collection has not started. '}{data.coverage.complete ? 'The selected period is covered from its start.' : 'Partial period: earlier delivery is not included. These are recorded figures, not complete totals for this period.'}{data.last_at && ` Latest included play: ${timeLabel(data.last_at)}.`}</p></div>;
}
export function ReportInvalidTimeNote({ data }: { data: DeliveryData }) {
  return data.totals.plays_time_invalid ? <p role="status" className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm text-warn">{number(data.totals.plays_time_invalid)} receipts had invalid device times. Excluded from delivery and presence; counted separately on the server receipt date.</p> : null;
}

/** Paid delivered, Billable, Failed, Filler. */
export function DeliveryCards({ data, period }: { data: DeliveryData; period: Period }) {
  return <div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Delivery</h3><div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{([
    ['plays_rendered', 'Paid delivered', paidDeliveredCard(data)],
    ['plays_billable', 'Billable', billableCard(data)],
    ['plays_not_rendered', 'Failed', failedCard(data)],
    ['plays_filler', 'Filler reports', fillerCard(data)],
  ] as [MetricId, string, CardText][]).map(([metric, title, { value, hint }]) => <Card key={metric} className="p-4"><div className="text-xs font-medium text-muted-foreground"><MetricLabel metric={metric} period={period} data={data}>{title}</MetricLabel></div><div className="mt-2 text-2xl font-semibold tnum">{value}</div><p className="mt-2 text-xs text-muted-foreground">{hint}</p></Card>)}</div></div>;
}

/** Measurement profile selector plus presence, looking and impression cards for the selected profile only. */
export function MeasurementCards({ data, period, view }: { data: DeliveryData; period: Period; view: ReportView }) {
  const { attentionKeys, selectedAttentionKey, setAttentionSeries, selectedAttention } = view;
  return <div><div className="mb-2 flex flex-wrap items-center gap-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Measurement profile</h3>{attentionKeys.length>1&&<Select aria-label="Measurement model profile" className="ml-auto w-auto" value={selectedAttentionKey} onChange={e=>setAttentionSeries(e.target.value)}>{attentionKeys.map(key=>{const p=data.attentionProfiles[key];return <option key={key} value={key}>{profileLabel(p)}</option>;})}</Select>}</div><div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{([
    ['presence_avg', 'Avg people present', presenceCard(data, selectedAttention)],
    ['attention_avg_people', 'Avg people looking', lookingCard(data, selectedAttention)],
    ['estimated_impressions', 'Estimated impressions', estimatedImpressionsCard(data, selectedAttention)],
    ['attentive_impressions', 'Attentive impressions', attentiveImpressionsCard(data, selectedAttention)],
  ] as [MetricId, string, CardText][]).map(([metric,title,{value,hint}])=><Card key={metric} className="p-4"><div className="text-xs font-medium text-muted-foreground"><MetricLabel metric={metric} period={period} data={data}>{title}</MetricLabel></div><div className="mt-2 text-2xl font-semibold tnum">{value}</div><p className="mt-2 text-xs text-muted-foreground">{hint}</p></Card>)}</div>{selectedAttention&&<p className="mt-2 text-xs text-muted-foreground">Impressions are analytics estimates only; they are not unique reach, causal attribution, or billing evidence.</p>}</div>;
}
/** Daily paid delivery chart with its values table. */
export function DailyDeliveryChart({ data, period, view }: { data: DeliveryData; period: Period; view: ReportView }) {
  const { dateRows } = view;
  return <Card className="p-4"><h3 className="text-sm font-semibold"><MetricLabel metric="plays_rendered" period={period} data={data}>Daily paid delivery</MetricLabel></h3><p className="mb-3 text-xs text-muted-foreground">Recorded plays. No assumed delivery target.</p>{dateRows.filter(row => row.value !== null).length >= 5 ? <Chart points={dateRows} label="Daily paid delivery" unit="paid plays" /> : <p className="py-3 text-xs text-muted-foreground">Fewer than five days have coverage. Read exact recorded values below.</p>}<details open={dateRows.filter(row => row.value !== null).length < 5} className="mt-3 text-xs"><summary className="cursor-pointer font-medium">View daily values</summary><div className="max-h-72 overflow-auto"><table className="mt-2 w-full text-left"><caption className="sr-only">Daily paid delivery in IST</caption><thead><tr><th scope="col">Date</th><th scope="col" className="text-right">Recorded paid plays</th></tr></thead><tbody>{dateRows.map(row => <tr key={row.key} className="border-t"><th scope="row" className="py-2 font-normal">{row.key}</th><td className="text-right">{row.value === null ? 'Coverage unavailable' : number(row.value)}</td></tr>)}</tbody></table></div></details></Card>;
}
/** Legacy presence by hour (shown when no measurement profile exists). */
export function HourlyPresence({ data, period, view }: { data: DeliveryData; period: Period; view: ReportView }) {
  const { hourRows } = view;
  return <Card className="p-4"><h3 className="text-sm font-semibold"><MetricLabel metric="presence_avg" period={period} data={data}>Legacy presence by hour</MetricLabel></h3><p className="mb-3 text-xs text-muted-foreground">Older COCO presence records only, per measured paid play and start hour. Missing measurement is never zero.</p>{hourRows.filter(row => row.value !== null).length >= 5 ? <Chart points={hourRows} label="Measured presence by hour" unit="mean people per measured paid play" bars /> : <p className="py-3 text-xs text-muted-foreground">Fewer than five hours have measured plays. Read exact measurements below.</p>}<details open={hourRows.filter(row => row.value !== null).length < 5} className="mt-3 text-xs"><summary className="cursor-pointer font-medium">View hourly values and samples</summary><div className="max-h-72 overflow-auto"><table className="mt-2 w-full text-left"><caption className="sr-only">Hourly presence and measured paid play denominators, IST</caption><thead><tr><th scope="col">Hour</th><th scope="col" className="text-right">Avg people</th><th scope="col" className="text-right">Measured / delivered</th></tr></thead><tbody>{hourRows.map(({ key, row }) => <tr key={key} className="border-t"><th scope="row" className="py-2 font-normal">{key}</th><td className="text-right">{formatAverage(row)}</td><td className="text-right">{number(row.presence_n)} / {number(row.plays_rendered)}</td></tr>)}</tbody></table></div></details></Card>;
}
/** Recorded paid delivery grouped by screen, campaign or creative. */
export function DeliveryBreakdown({ data, period, view }: { data: DeliveryData; period: Period; view: ReportView }) {
  const { dimension, setDimension, dimensions, selectedAttention } = view;
  return <Card className="p-4"><div className="mb-3 flex flex-wrap items-center gap-3"><h3 className="text-sm font-semibold">Recorded paid delivery</h3><Select aria-label="Group delivery by" value={dimension} onChange={event => setDimension(event.target.value as typeof dimension)} className="ml-auto w-auto"><option value="byScreen">By screen</option><option value="byCampaign">By campaign</option><option value="byCreative">By creative</option></Select></div>{dimension === 'byCreative' && <p className="mb-3 text-xs text-muted-foreground">Exposure differs by screen, time and rotation. This comparison does not establish which creative caused a response.</p>}<DataTable rows={dimensions} firstHeading={dimension === 'byScreen' ? 'Screen' : dimension === 'byCampaign' ? 'Campaign' : 'Creative'} period={period} data={data} profileRows={selectedAttention?.[dimension]} /></Card>;
}

/** Calibration and model provenance for the selected profile. */
export function AttentionProvenance({ view }: { view: ReportView }) {
  const { calibratedShare, provenanceRows, selectedAttention } = view;
  if (!selectedAttention) return null;
  return <details className="mt-2 text-xs"><summary className="cursor-pointer font-medium">Technical provenance</summary><p className="mt-2 text-muted-foreground">{calibratedShare===null?'No assessable attention time yet.':`${calibratedShare.toFixed(1)}% of assessable attention time used guided calibration.`} Default-mode plays use standard default settings (zero yaw/pitch offsets). Calibration changes are retained per play and combined in this compatible report.</p><ul className="mt-2 space-y-1 text-muted-foreground">{provenanceRows.map(x=><li key={`${x.mode}-${x.calibration_revision||'none'}`} className="break-all">{x.mode==='guided'?`Guided ${x.calibration_revision||'legacy'} · ${x.calibration?`yaw ${x.calibration.yaw_tenths/10}°, pitch ${x.calibration.pitch_tenths/10}°, ${x.calibration.samples} samples`: 'calibration details unavailable'}`:'Default offsets · yaw 0°, pitch 0°'} · {number(x.totals.plays)} plays</li>)}</ul><p className="mt-2 break-all text-muted-foreground">Profile {selectedAttention.profile} · manifest {selectedAttention.manifest_sha256} · pipeline {selectedAttention.pipeline_sha256}</p></details>;
}
export function AttentionSummary({ view }: { view: ReportView }) {
  const { selectedAttention } = view;
  if (!selectedAttention) return null;
  return <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-6"><div><b>{number(selectedAttention.totals.plays)}</b><p className="text-xs text-muted-foreground">plays with accepted analytics</p></div><div><b>{selectedAttention.totals.attention_observed_ms?(selectedAttention.totals.attention_observed_ms/60000).toFixed(1)+' min':'Unavailable'}</b><p className="text-xs text-muted-foreground">assessable attention time</p></div><div><b>{attentionHours(selectedAttention.totals.attention_observed_ms,selectedAttention.totals.looking_person_ms)}</b><p className="text-xs text-muted-foreground">looking person time</p></div><div><b>{attentionHours(selectedAttention.totals.attention_observed_ms,selectedAttention.totals.face_assessable_person_ms)}</b><p className="text-xs text-muted-foreground">face-assessable time</p></div><div><b>{selectedAttention.totals.attention_observed_ms?(selectedAttention.totals.longest_look_ms/1000).toFixed(1)+'s':'Unavailable'}</b><p className="text-xs text-muted-foreground">longest continuous look · maximum across plays</p></div><div><b>{selectedAttention.totals.expression_assessable_person_ms?(100*selectedAttention.totals.smile_person_ms/selectedAttention.totals.expression_assessable_person_ms).toFixed(1)+'%':'Unavailable'}</b><p className="text-xs text-muted-foreground">visible-smile rate · {number(Math.round(selectedAttention.totals.expression_assessable_person_ms/60000))} assessable min</p></div></div>;
}
export function AttentionByDimension({ view }: { view: ReportView }) {
  const { dimension, metadata, selectedAttention } = view;
  if (!selectedAttention) return null;
  return <div className="mt-4 overflow-auto"><h4 className="mb-2 text-xs font-semibold">Selected profile by {dimension==='byScreen'?'screen':dimension==='byCampaign'?'campaign':'creative'}</h4><table className="w-full text-left text-xs"><thead><tr className="border-b"><th>{dimension==='byScreen'?'Screen':dimension==='byCampaign'?'Campaign':'Creative'}</th><th className="text-right">Accepted plays</th><th className="text-right">Avg people</th><th className="text-right">Avg looking</th><th className="text-right">Dwell person-hours</th><th className="text-right">Looking person-hours</th><th className="text-right">Visible-smile rate</th><th className="text-right">Est. / attentive impressions</th><th className="text-right">Longest look</th></tr></thead><tbody>{Object.entries(selectedAttention[dimension]||{}).map(([id,c])=>{const label=metadata[dimension].find(x=>x.id===id)?.name||id;const present=attentionPeopleRate(c.presence_person_ms,c.body_observed_ms),looking=attentionPeopleRate(c.looking_person_ms,c.attention_observed_ms);return <tr key={id} className="border-b"><th className="py-2">{label}</th><td className="text-right">{number(c.plays)}</td><td className="text-right">{c.body_observed_ms?present!.toFixed(2):'Unavailable'}<span className="block text-[10px] text-muted-foreground">{(c.body_observed_ms/60000).toFixed(1)} body-observed min</span></td><td className="text-right">{c.attention_observed_ms?looking!.toFixed(2):'Unavailable'}<span className="block text-[10px] text-muted-foreground">{(c.attention_observed_ms/60000).toFixed(1)} assessable min</span></td><td className="text-right">{c.body_observed_ms?(c.presence_person_ms/3600000).toFixed(2):'Unavailable'}</td><td className="text-right">{c.attention_observed_ms?(c.looking_person_ms/3600000).toFixed(2):'Unavailable'}</td><td className="text-right">{c.expression_assessable_person_ms?(100*c.smile_person_ms/c.expression_assessable_person_ms).toFixed(1)+'%':'Unavailable'}<span className="block text-[10px] text-muted-foreground">{(c.expression_assessable_person_ms/60000).toFixed(1)} assessable min</span></td><td className="text-right">{c.body_observed_ms?number(c.estimated_impressions):'Unavailable'} / {c.attention_observed_ms?number(c.attentive_impressions):'Unavailable'}</td><td className="text-right">{c.attention_observed_ms?(c.longest_look_ms/1000).toFixed(1)+'s':'Unavailable'}</td></tr>;})}</tbody></table><p className="mt-2 text-[11px] text-muted-foreground">Every row uses the selected model profile. Missing model coverage is unavailable, not zero. Impressions are analytics estimates, not billing evidence.</p></div>;
}
/** Hourly attention coverage, people present and looking charts, and the date × hour heatmap. */
export function AttentionHourly({ period, view }: { period: Period; view: ReportView }) {
  const { selectedAttention } = view;
  if (!selectedAttention) return null;
  return <div className="mt-4 grid gap-4 xl:grid-cols-3"><div><h4 className="text-xs font-semibold">Attention coverage by hour · IST</h4><Chart points={Array.from({length:24},(_,h)=>{const c=selectedAttention.hourly[String(h)]||null,total=(c?.attention_observed_ms||0)+(c?.attention_unknown_ms||0);return{key:String(h).padStart(2,'0')+':00',value:total?100*(c!.attention_observed_ms/total):null,detail:total?`${(100*c!.attention_observed_ms/total).toFixed(1)}% observed; ${(c!.attention_unknown_ms/60000).toFixed(1)} min unknown`:'No accepted attention plays'};})} label="Attention coverage by hour" unit="observed share of accepted attention play time" bars /></div>
    <div><h4 className="text-xs font-semibold">Average people present · IST</h4><p className="mb-2 text-[11px] text-muted-foreground">People-time divided by body-observed time; unknown time is excluded.</p><Chart points={Array.from({length:24},(_,h)=>{const c=selectedAttention.hourly[String(h)]||null,value=attentionPeopleRate(c?.presence_person_ms||0,c?.body_observed_ms||0);return{key:String(h).padStart(2,'0')+':00',value,detail:c?.body_observed_ms?`${value!.toFixed(2)} average people · ${(c!.presence_person_ms/3600000).toFixed(2)} person-hours / ${(c!.body_observed_ms/60000).toFixed(1)} observed min`:'No body observations'};})} label="Average people present by hour" unit="people per body-observed time" bars /></div>
    <div><h4 className="text-xs font-semibold">Average people looking · IST</h4><p className="mb-2 text-[11px] text-muted-foreground">Looking person-time divided by attention-assessable time.</p><Chart points={Array.from({length:24},(_,h)=>{const c=selectedAttention.hourly[String(h)]||null,value=attentionPeopleRate(c?.looking_person_ms||0,c?.attention_observed_ms||0);return{key:String(h).padStart(2,'0')+':00',value,detail:c?.attention_observed_ms?`${value!.toFixed(2)} average people · ${(c!.looking_person_ms/3600000).toFixed(2)} person-hours / ${(c!.attention_observed_ms/60000).toFixed(1)} assessable min`:'No assessable attention time'};})} label="Average people looking by hour" unit="people per attention-assessable time" bars /></div>
    <div className="overflow-auto"><h4 className="mb-2 text-xs font-semibold">Attention coverage heatmap · IST date × hour</h4><table className="w-full text-xs"><caption className="sr-only">Observed attention percentage by date and hour</caption><thead><tr><th>Date</th>{Array.from({length:24},(_,h)=><th key={h} className="px-1">{String(h).padStart(2,'0')}</th>)}</tr></thead><tbody>{rangeDays(period).map(date=><tr key={date} className="border-t"><th className="pr-2 text-left">{date}</th>{Array.from({length:24},(_,h)=>{const c=selectedAttention.dayHours[date+'T'+String(h).padStart(2,'0')],den=(c?.attention_observed_ms||0)+(c?.attention_unknown_ms||0),pct=den?Math.round(c!.attention_observed_ms*100/den):null;return <td key={h} title={pct===null?'No accepted attention plays':`${pct}% observed`} className="px-1 text-center" style={{backgroundColor:pct===null?'transparent':`hsl(var(--primary) / ${0.06+0.44*pct/100})`}}>{pct===null?'·':pct}</td>;})}</tr>)}</tbody></table></div></div>;
}
/** Creative comparison by asset version for the selected profile. */
export function CreativeComparison({ view }: { view: ReportView }) {
  const { selectedAttention, metadata: { byCreative: creatives } } = view;
  if (!selectedAttention) return null;
  return <div className="mt-4 overflow-auto"><h4 className="mb-2 text-xs font-semibold">Creative comparison · compatible model metrics; asset versions stay separate</h4><table className="w-full text-left text-xs"><thead><tr className="border-b"><th>Creative / asset version</th><th className="text-right">Plays</th><th className="text-right">Observed / unknown</th><th className="text-right">Looking person-hours</th><th className="text-right">Longest look</th><th className="text-right">Estimated / attentive impressions</th></tr></thead><tbody>{Object.entries(selectedAttention.byCreativeAsset||{}).map(([key,row])=>{const c=row.totals,id=row.creative_id;return <tr key={key} className="border-b"><th className="py-2">{creatives.find(x=>x.id===id)?.name||id} · {row.asset_id||'unknown asset'} · {row.asset_sha256?.slice(0,12)||'no hash'}</th><td className="text-right">{number(c.plays)}</td><td className="text-right">{(c.attention_observed_ms/60000).toFixed(1)} / {(c.attention_unknown_ms/60000).toFixed(1)} min</td><td className="text-right">{c.attention_observed_ms?(c.looking_person_ms/3600000).toFixed(2):'Unavailable'}</td><td className="text-right">{c.attention_observed_ms?(c.longest_look_ms/1000).toFixed(1)+'s':'Unavailable'}</td><td className="text-right">{c.body_observed_ms?number(c.estimated_impressions):'Unavailable'} / {c.attention_observed_ms?number(c.attentive_impressions):'Unavailable'}</td></tr>;})}</tbody></table><p className="mt-2 text-[11px] text-muted-foreground">Plays with no accepted analytics are omitted. Where body or attention coverage is absent, impression and looking values are unavailable. Estimates are not unique reach, causal effect, or billing evidence.</p></div>;
}
/** The attention insights card. The campaign dashboard leaves provenance and creative comparison to other tabs. */
export function AttentionInsights({ view, period, provenance = true, creativeComparison = true }: { view: ReportView; period: Period; provenance?: boolean; creativeComparison?: boolean }) {
  const { selectedAttention } = view;
  return <Card className="p-4" aria-label="Attention analytics"><div className="flex flex-wrap items-center gap-3"><h3 className="text-sm font-semibold">Attention insights</h3></div>
    {!selectedAttention?<p className="mt-3 text-sm text-muted-foreground">No accepted attention analytics in this period. Plays without analytics are unknown, not zero.</p>:<>
      <p className="mt-2 text-xs text-muted-foreground">Combined summaries across default settings and guided calibration for compatible model metrics. Video is processed on the player; only aggregate measurements are stored.</p>
      {provenance && <AttentionProvenance view={view} />}
      <AttentionSummary view={view} />
      <AttentionByDimension view={view} />
      <AttentionHourly period={period} view={view} />
      {creativeComparison && <CreativeComparison view={view} />}
    </>}
  </Card>;
}
