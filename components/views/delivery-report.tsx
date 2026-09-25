'use client';

import { useEffect, useId, useState } from 'react';
import { api } from '@/lib/client';
import { type MetricId, type Period, periodLabel } from '@/lib/metrics';
import { Explain } from '@/components/ui/explain';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';

export type ReportCounters = {
  plays_rendered: number;
  plays_billable: number;
  plays_not_rendered: number;
  plays_filler: number;
  presence_sum: number;
  presence_n: number;
  airtime_ms: number;
  filler_presence_sum?: number;
  filler_presence_n?: number;
  filler_airtime_ms?: number;
  plays_time_invalid?: number;
};
type CounterMap = Record<string, ReportCounters>;
type ReportPage = {
  totals: ReportCounters;
  byScreen: CounterMap;
  byCampaign: CounterMap;
  byCreative: CounterMap;
  daily: CounterMap;
  hourly: CounterMap;
  coverage: { started_at: string | null; complete: boolean };
  last_at: string | null;
  has_more: boolean;
  next_cursor: string | null;
  rows: number;
};
export type DeliveryData = Omit<ReportPage, 'daily' | 'hourly'> & {
  daily: (ReportCounters & { date: string })[];
  hourly: (ReportCounters & { hour: string })[];
};
const DAY = 86_400_000;
const FIELDS = ['plays_rendered', 'plays_billable', 'plays_not_rendered', 'plays_filler', 'presence_sum', 'presence_n', 'airtime_ms', 'filler_presence_sum', 'filler_presence_n', 'filler_airtime_ms', 'plays_time_invalid'] as const;
const emptyCounters = (): ReportCounters => ({ plays_rendered: 0, plays_billable: 0, plays_not_rendered: 0, plays_filler: 0, presence_sum: 0, presence_n: 0, airtime_ms: 0 });
export function istDate(now = Date.now()) { return new Date(now + 330 * 60_000).toISOString().slice(0, 10); }
export function reportPreset(preset: string, now = Date.now()): Period {
  const to = istDate(now), start = Date.parse(to + 'T00:00:00Z');
  return { from: preset === 'month' ? to.slice(0, 8) + '01' : new Date(start - (preset === '30d' ? 29 : preset === '7d' ? 6 : 0) * DAY).toISOString().slice(0, 10), to };
}
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
export function periodError(period: Period): string | null {
  if (!validDate(period.from) || !validDate(period.to)) return 'Choose a valid start and end date.';
  const days = (Date.parse(period.to) - Date.parse(period.from)) / DAY + 1;
  if (days < 1) return 'The end date must be on or after the start date.';
  if (days > 93) return 'Choose no more than 93 days at a time.';
  if (period.to > istDate()) return 'Reports cannot include future dates.';
  return null;
}
export function mergeCounters(a: ReportCounters, b: ReportCounters) {
  for (const field of FIELDS) a[field] = (a[field] || 0) + (b[field] || 0);
  return a;
}
function mergeCoverage(a: ReportPage['coverage'] | null, b: ReportPage['coverage']): ReportPage['coverage'] {
  if (!a) return b;
  return { started_at: a.started_at && b.started_at ? (a.started_at > b.started_at ? a.started_at : b.started_at) : null, complete: a.complete && b.complete };
}
function mergeMap(a: CounterMap, b: CounterMap) {
  for (const [key, counters] of Object.entries(b)) {
    if (!Object.hasOwn(a, key)) a[key] = emptyCounters();
    mergeCounters(a[key], counters);
  }
}
/** Fetch every aggregate page before exposing numbers. A range change invalidates the old request. */
export function useDeliveryReport({ org, screen, campaign, enabled = true }: { org?: string; screen?: string; campaign?: string; enabled?: boolean } = {}) {
  const [period, setPeriod] = useState<Period>(() => reportPreset('7d'));
  const [data, setData] = useState<DeliveryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const requestKey = JSON.stringify([period.from, period.to, org || '', screen || '', campaign || '', enabled, revision]);
  const [resultKey, setResultKey] = useState('');
  useEffect(() => {
    let cancelled = false;
    setData(null); setError(null); setLoading(enabled); setResultKey(requestKey);
    if (!enabled) return;
    const invalid = periodError(period);
    if (invalid) { setError(invalid); setLoading(false); return; }
    async function read() {
      const merged = { totals: emptyCounters(), byScreen: Object.create(null) as CounterMap, byCampaign: Object.create(null) as CounterMap, byCreative: Object.create(null) as CounterMap, daily: Object.create(null) as CounterMap, hourly: Object.create(null) as CounterMap };
      const cursors = new Set<string>();
      let after: string | null = null, rows = 0, lastAt: string | null = null;
      let coverage: ReportPage['coverage'] | null = null;
      do {
        const query = new URLSearchParams({ from: period.from, to: period.to });
        if (org) query.set('org', org);
        if (screen) query.set('screen', screen);
        if (campaign) query.set('campaign', campaign);
        if (after) query.set('after', after);
        const page = await api<ReportPage>('/metrics?' + query, undefined, { quiet: true });
        if (cancelled) return;
        if (!page.totals || !page.coverage || typeof page.has_more !== 'boolean') throw new Error('The report response was incomplete. Please retry.');
        mergeCounters(merged.totals, page.totals);
        for (const dimension of ['byScreen', 'byCampaign', 'byCreative', 'daily', 'hourly'] as const) mergeMap(merged[dimension], page[dimension] || {});
        rows += page.rows;
        if (page.last_at && (!lastAt || page.last_at > lastAt)) lastAt = page.last_at;
        coverage = mergeCoverage(coverage, page.coverage);
        after = page.has_more ? page.next_cursor : null;
        if (page.has_more && (!after || cursors.has(after))) throw new Error('The report could not finish loading. Please retry.');
        if (after) cursors.add(after);
      } while (after);
      if (cancelled || !coverage) return;
      setData({ ...merged, daily: Object.entries(merged.daily).sort(([a], [b]) => a.localeCompare(b)).map(([date, counters]) => ({ date, ...counters })), hourly: Object.entries(merged.hourly).sort(([a], [b]) => Number(a) - Number(b)).map(([hour, counters]) => ({ hour, ...counters })), coverage, last_at: lastAt, has_more: false, next_cursor: null, rows });
    }
    read().catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the report.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Primitive requestKey includes every request input and invalidates results synchronously during render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);
  const current = resultKey === requestKey;
  return { period, setPeriod, data: current ? data : null, loading: enabled && (!current || loading), error: current ? error : null, reload: () => setRevision(value => value + 1) };
}
export type DeliveryReportState = ReturnType<typeof useDeliveryReport>;
const number = (value: number) => value.toLocaleString('en-IN');
const average = (counters: ReportCounters) => counters.presence_n > 0 ? counters.presence_sum / counters.presence_n : null;
const formatAverage = (counters: ReportCounters) => average(counters)?.toFixed(1) ?? 'Unmeasured';
function rangeDays(period: Period) {
  const dates: string[] = [];
  for (let day = Date.parse(period.from); day <= Date.parse(period.to); day += DAY) dates.push(new Date(day).toISOString().slice(0, 10));
  return dates;
}
function timeLabel(value: string) { return new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST'; }
export function csvCell(value: unknown) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function dailyReportCsv(data: DeliveryData, period: Period) {
  const header = ['date_ist', 'period_from', 'period_to', 'coverage_started_at', 'period_fully_covered', 'source', 'paid_delivered', 'paid_billable', 'paid_failed', 'filler_receipts', 'presence_sum', 'measured_paid_plays', 'mean_people_per_measured_paid_play', 'paid_airtime_ms', 'invalid_clock_receipts'];
  const rows = rangeDays(period).map(date => {
    const recorded = data.daily.find(row => row.date === date);
    const covered = data.coverage.started_at && Date.parse(date + 'T00:00:00+05:30') >= Date.parse(data.coverage.started_at);
    const row = recorded || (covered ? emptyCounters() : null);
    return [date, period.from, period.to, data.coverage.started_at, data.coverage.complete, 'accepted_device_receipts_daily_aggregate', row?.plays_rendered, row?.plays_billable, row?.plays_not_rendered, row?.plays_filler, row?.presence_n ? row.presence_sum : null, row?.presence_n, row ? average(row) : null, row?.airtime_ms, row?.plays_time_invalid ?? (row ? 0 : null)];
  });
  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}
function downloadCsv(data: DeliveryData, period: Period) {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + dailyReportCsv(data, period)], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `gridcast-delivery-${period.from}-${period.to}.csv`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function MetricLabel({ metric, period, data, children }: { metric: MetricId; period: Period; data: DeliveryData; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1">{children}<Explain metric={metric} period={period} completeness={{ measured: data.totals.presence_n, total: data.totals.plays_rendered, truncated: !data.coverage.complete }} /></span>;
}
function Chart({ points, label, unit, bars = false }: { points: { key: string; value: number | null; detail: string }[]; label: string; unit: string; bars?: boolean }) {
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
function DataTable({ rows, firstHeading, period, data }: { rows: { id: string; name: string; counters: ReportCounters }[]; firstHeading: string; period: Period; data: DeliveryData }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [firstHeading, period.from, period.to]);
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const currentPage = Math.min(page, pages - 1);
  const visible = rows.slice(currentPage * 50, (currentPage + 1) * 50);
  return <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">{firstHeading} delivery for {periodLabel(period)}, based on available accepted receipts.</caption><thead><tr className="border-b text-muted-foreground"><th className="py-2 pr-3" scope="col">{firstHeading}</th>{(['plays_rendered', 'plays_billable', 'plays_not_rendered', 'presence_avg'] as const).map((metric, index) => <th key={metric} className="px-2 py-2 text-right whitespace-nowrap" scope="col"><MetricLabel metric={metric} period={period} data={data}>{['Delivered', 'Billable', 'Failed', 'Avg people'][index]}</MetricLabel></th>)}<th className="px-2 py-2 text-right" scope="col"><MetricLabel metric="measured_ratio" period={period} data={data}>Measured</MetricLabel></th></tr></thead><tbody>{visible.map(({ id, name, counters }) => <tr key={id} className="border-b last:border-0"><th className="max-w-[16rem] break-words py-3 pr-3 font-medium" scope="row">{name}</th><td className="px-2 text-right tnum">{number(counters.plays_rendered)}</td><td className="px-2 text-right tnum">{number(counters.plays_billable)}</td><td className="px-2 text-right tnum">{number(counters.plays_not_rendered)}</td><td className="px-2 text-right tnum">{formatAverage(counters)}</td><td className="px-2 text-right tnum">{number(counters.presence_n)} / {number(counters.plays_rendered)}</td></tr>)}</tbody></table>{!rows.length && <p className="py-4 text-sm text-muted-foreground">No paid delivery records in this range.</p>}{pages > 1 && <div className="mt-3 flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{currentPage * 50 + 1}–{Math.min(rows.length, (currentPage + 1) * 50)} of {number(rows.length)}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>Next</Button></div></div>}</div>;
}
export function DeliveryReport({ report, screens = [], campaigns = [], creatives = [] }: { report: DeliveryReportState; screens?: { id: string; name: string }[]; campaigns?: { id: string; name: string }[]; creatives?: { id: string; name: string }[] }) {
  const { data, period, loading, error } = report;
  const [preset, setPreset] = useState('7d');
  const [draft, setDraft] = useState(period);
  const [validation, setValidation] = useState<string | null>(null);
  const [dimension, setDimension] = useState<'byScreen' | 'byCampaign' | 'byCreative'>('byScreen');
  const inputId = useId();
  const dateRows = data ? rangeDays(period).map(date => {
    const row = data.daily.find(item => item.date === date);
    const covered = data.coverage.started_at && Date.parse(date + 'T00:00:00+05:30') >= Date.parse(data.coverage.started_at);
    return { key: date, value: row ? row.plays_rendered : covered ? 0 : null, detail: row ? `${number(row.plays_rendered)} paid plays; ${number(row.presence_n)} measured` : covered ? '0 paid plays recorded' : 'No complete daily coverage' };
  }) : [];
  const hourRows = data?.coverage.started_at ? Array.from({ length: 24 }, (_, hour) => {
    const row = data.hourly.find(item => Number(item.hour) === hour) || emptyCounters();
    return { key: String(hour).padStart(2, '0') + ':00', value: average(row), detail: `${formatAverage(row)}; ${number(row.presence_n)} measured of ${number(row.plays_rendered)} paid plays`, row };
  }) : [];
  const metadata = { byScreen: screens, byCampaign: campaigns, byCreative: creatives };
  const dimensions = data ? Object.entries(data[dimension]).filter(([, row]) => row.plays_rendered + row.plays_not_rendered > 0).sort(([, a], [, b]) => b.plays_rendered - a.plays_rendered).map(([id, counters]) => ({ id, counters, name: metadata[dimension].find(item => item.id === id)?.name || id })) : [];
  return <section className="space-y-4" aria-label="Delivery report" aria-busy={loading}>
    <div className="flex flex-wrap items-end gap-3">
      <div><label htmlFor={inputId} className="mb-1 block text-xs font-medium">Reporting period · IST</label><Select id={inputId} value={preset} onChange={event => { const value = event.target.value; setPreset(value); setValidation(null); if (value !== 'custom') { const next = reportPreset(value); setDraft(next); report.setPeriod(next); } }} className="min-w-[160px]"><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="month">This month</option><option value="custom">Custom dates</option></Select></div>
      {preset === 'custom' && <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); const invalid = periodError(draft); setValidation(invalid); if (!invalid) report.setPeriod(draft); }}><div><label htmlFor={inputId + '-from'} className="mb-1 block text-xs">From</label><Input id={inputId + '-from'} type="date" max={istDate()} value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} required /></div><div><label htmlFor={inputId + '-to'} className="mb-1 block text-xs">To</label><Input id={inputId + '-to'} type="date" max={istDate()} value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} required /></div><Button type="submit" variant="outline">Apply</Button></form>}
      <div className="ml-auto flex gap-2"><Button variant="outline" disabled={loading} onClick={report.reload}>Refresh</Button><Button variant="outline" disabled={!data || loading} onClick={() => data && downloadCsv(data, period)}>Export CSV</Button></div>
    </div>
    {validation && <p role="alert" className="text-sm text-destructive">{validation}</p>}
    {error && <Card className="p-4 text-sm"><p role="alert">{error}</p><Button variant="outline" className="mt-3" onClick={report.reload}>Retry report</Button></Card>}
    {loading && <p role="status" className="py-8 text-sm text-muted-foreground">Loading all daily summaries for {periodLabel(period)}…</p>}
    {data && !loading && <>
      <div className="text-xs leading-relaxed text-muted-foreground"><p><strong className="text-foreground">{periodLabel(period)} · IST.</strong> Based on accepted device receipts with valid clocks, grouped by the play’s start date. Offline devices may report up to 72 hours later.</p><p>{data.coverage.started_at ? `Daily summaries started ${timeLabel(data.coverage.started_at)}. ` : 'Daily summary collection has not started. '}{data.coverage.complete ? 'The selected period is covered from its start.' : 'Partial period: earlier delivery is not included. These are recorded figures, not complete totals for this period.'}{data.last_at && ` Latest included play: ${timeLabel(data.last_at)}.`}</p></div>
      {!!data.totals.plays_time_invalid && <p role="status" className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm text-warn">{number(data.totals.plays_time_invalid)} receipts had invalid device times. Excluded from delivery and presence; counted separately on the server receipt date.</p>}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">{([
        ['plays_rendered', 'Paid delivered', number(data.totals.plays_rendered), 'Completed paid play receipts'],
        ['plays_billable', 'Billable', number(data.totals.plays_billable), 'Passed every billing check'],
        ['plays_not_rendered', 'Failed', number(data.totals.plays_not_rendered), 'Paid receipts not rendered'],
        ['presence_avg', 'Avg people present', formatAverage(data.totals), `${number(data.totals.presence_n)} measured / ${number(data.totals.plays_rendered)} paid plays`],
        ['plays_filler', 'Filler reports', number(data.totals.plays_filler), 'Separate from advertiser delivery'],
      ] as [MetricId, string, string, string][]).map(([metric, title, value, hint]) => <Card key={metric} className="p-4"><div className="text-xs font-medium text-muted-foreground"><MetricLabel metric={metric} period={period} data={data}>{title}</MetricLabel></div><div className="mt-2 text-2xl font-semibold tnum">{data.coverage.started_at ? value : '—'}</div><p className="mt-2 text-xs text-muted-foreground">{data.coverage.started_at ? hint : 'No daily summaries collected yet'}</p></Card>)}</div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4"><h3 className="text-sm font-semibold"><MetricLabel metric="plays_rendered" period={period} data={data}>Daily paid delivery</MetricLabel></h3><p className="mb-3 text-xs text-muted-foreground">Recorded plays. No assumed delivery target.</p>{dateRows.filter(row => row.value !== null).length >= 5 ? <Chart points={dateRows} label="Daily paid delivery" unit="paid plays" /> : <p className="py-3 text-xs text-muted-foreground">Fewer than five days have coverage. Read exact recorded values below.</p>}<details open={dateRows.filter(row => row.value !== null).length < 5} className="mt-3 text-xs"><summary className="cursor-pointer font-medium">View daily values</summary><div className="max-h-72 overflow-auto"><table className="mt-2 w-full text-left"><caption className="sr-only">Daily paid delivery in IST</caption><thead><tr><th scope="col">Date</th><th scope="col" className="text-right">Recorded paid plays</th></tr></thead><tbody>{dateRows.map(row => <tr key={row.key} className="border-t"><th scope="row" className="py-2 font-normal">{row.key}</th><td className="text-right">{row.value === null ? 'Coverage unavailable' : number(row.value)}</td></tr>)}</tbody></table></div></details></Card>
        <Card className="p-4"><h3 className="text-sm font-semibold"><MetricLabel metric="presence_avg" period={period} data={data}>Presence by hour</MetricLabel></h3><p className="mb-3 text-xs text-muted-foreground">Mean people per measured paid play, grouped by start hour. Missing measurement is never zero.</p>{hourRows.filter(row => row.value !== null).length >= 5 ? <Chart points={hourRows} label="Measured presence by hour" unit="mean people per measured paid play" bars /> : <p className="py-3 text-xs text-muted-foreground">Fewer than five hours have measured plays. Read exact measurements below.</p>}<details open={hourRows.filter(row => row.value !== null).length < 5} className="mt-3 text-xs"><summary className="cursor-pointer font-medium">View hourly values and samples</summary><div className="max-h-72 overflow-auto"><table className="mt-2 w-full text-left"><caption className="sr-only">Hourly presence and measured paid play denominators, IST</caption><thead><tr><th scope="col">Hour</th><th scope="col" className="text-right">Avg people</th><th scope="col" className="text-right">Measured / delivered</th></tr></thead><tbody>{hourRows.map(({ key, row }) => <tr key={key} className="border-t"><th scope="row" className="py-2 font-normal">{key}</th><td className="text-right">{formatAverage(row)}</td><td className="text-right">{number(row.presence_n)} / {number(row.plays_rendered)}</td></tr>)}</tbody></table></div></details></Card>
      </div>
      <Card className="p-4"><div className="mb-3 flex flex-wrap items-center gap-3"><h3 className="text-sm font-semibold">Recorded paid delivery</h3><Select aria-label="Group delivery by" value={dimension} onChange={event => setDimension(event.target.value as typeof dimension)} className="ml-auto w-auto"><option value="byScreen">By screen</option><option value="byCampaign">By campaign</option><option value="byCreative">By creative</option></Select></div>{dimension === 'byCreative' && <p className="mb-3 text-xs text-muted-foreground">Exposure differs by screen, time and rotation. This comparison does not establish which creative caused a response.</p>}<DataTable rows={dimensions} firstHeading={dimension === 'byScreen' ? 'Screen' : dimension === 'byCampaign' ? 'Campaign' : 'Creative'} period={period} data={data} /></Card>
    </>}
  </section>;
}
