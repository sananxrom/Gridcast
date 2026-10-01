'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import type { Period } from '@/lib/metrics';
import { AttentionInsights, DailyDeliveryChart, DeliveryBreakdown, DeliveryCards, HourlyPresence, MeasurementCards, ProfileHourTable, ReportAlerts, ReportCoverageNote, ReportInvalidTimeNote, ReportPeriodBar, useReportView } from '@/components/views/report-parts';

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
export type CounterMap = Record<string, ReportCounters>;
type ReportPage = {
  totals: ReportCounters;
  byScreen: CounterMap;
  byCampaign: CounterMap;
  byCreative: CounterMap;
  daily: CounterMap;
  hourly: CounterMap;
  attentionProfiles:Record<string,AttentionProfile>;
  attention_page:{has_more:boolean;next_cursor:string|null};
  coverage: { started_at: string | null; complete: boolean };
  last_at: string | null;
  has_more: boolean;
  next_cursor: string | null;
  rows: number;
};
export type AttentionCounters={plays:number;playing_ms:number;body_observed_ms:number;body_unknown_ms:number;face_observed_ms:number;face_unknown_ms:number;attention_observed_ms:number;attention_unknown_ms:number;expression_observed_ms:number;expression_unknown_ms:number;presence_person_ms:number;looking_person_ms:number;longest_look_ms:number;face_assessable_person_ms:number;smile_person_ms:number;expression_assessable_person_ms:number;estimated_impressions:number;attentive_impressions:number;tracked_visits:number};
export type AttentionProfile={profile:string;manifest_sha256:string;pipeline_sha256:string;totals:AttentionCounters;byScreen:Record<string,AttentionCounters>;byCampaign:Record<string,AttentionCounters>;byCreative:Record<string,AttentionCounters>;byCreativeAsset:Record<string,{creative_id:string;asset_id:string|null;asset_sha256:string|null;totals:AttentionCounters;daily:Record<string,AttentionCounters>}>;daily:Record<string,AttentionCounters>;hourly:Record<string,AttentionCounters>;dayHours:Record<string,AttentionCounters>;provenance:Record<string,{mode:'default'|'guided';calibration_revision:string|null;calibration:any;totals:AttentionCounters;daily:Record<string,AttentionCounters>}>};
export type DeliveryData = Omit<ReportPage, 'daily' | 'hourly'> & {
  daily: (ReportCounters & { date: string })[];
  hourly: (ReportCounters & { hour: string })[];
};
const DAY = 86_400_000;
const FIELDS = ['plays_rendered', 'plays_billable', 'plays_not_rendered', 'plays_filler', 'presence_sum', 'presence_n', 'airtime_ms', 'filler_presence_sum', 'filler_presence_n', 'filler_airtime_ms', 'plays_time_invalid'] as const;
export const emptyCounters = (): ReportCounters => ({ plays_rendered: 0, plays_billable: 0, plays_not_rendered: 0, plays_filler: 0, presence_sum: 0, presence_n: 0, airtime_ms: 0 });
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
function mergeAttention(a:AttentionCounters,b:AttentionCounters){for(const k of Object.keys(b) as (keyof AttentionCounters)[])a[k]=k==='longest_look_ms'?Math.max(a[k]||0,b[k]||0):(a[k]||0)+(b[k]||0);}
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
      const merged = { totals: emptyCounters(), byScreen: Object.create(null) as CounterMap, byCampaign: Object.create(null) as CounterMap, byCreative: Object.create(null) as CounterMap, daily: Object.create(null) as CounterMap, hourly: Object.create(null) as CounterMap,attentionProfiles:{} as Record<string,AttentionProfile> };
      const cursors = new Set<string>();
      let after: string | null = null, attentionAfter:string|null=null, rows = 0, lastAt: string | null = null;
      let coverage: ReportPage['coverage'] | null = null;
      do {
        const query = new URLSearchParams({ from: period.from, to: period.to });
        if (org) query.set('org', org);
        if (screen) query.set('screen', screen);
        if (campaign) query.set('campaign', campaign);
        if (after) query.set('after', after);
        if(attentionAfter)query.set('attention_after',attentionAfter);
        const page = await api<ReportPage>('/metrics?' + query, undefined, { quiet: true });
        if (cancelled) return;
        if (!page.totals || !page.coverage || typeof page.has_more !== 'boolean'||!page.attention_page) throw new Error('The report response was incomplete. Please retry.');
        mergeCounters(merged.totals, page.totals);
        for (const dimension of ['byScreen', 'byCampaign', 'byCreative', 'daily', 'hourly'] as const) mergeMap(merged[dimension], page[dimension] || {});
        for(const [key,p]of Object.entries(page.attentionProfiles||{})){
          let target=merged.attentionProfiles[key];
          if(!target)target=merged.attentionProfiles[key]={...p,totals:Object.fromEntries(Object.keys(p.totals).map(k=>[k,0])) as unknown as AttentionCounters,byScreen:{},byCampaign:{},byCreative:{},byCreativeAsset:{},daily:{},hourly:{},dayHours:{},provenance:{}};
          mergeAttention(target.totals,p.totals);
          for(const dimension of ['byScreen','byCampaign','byCreative','daily','hourly','dayHours'] as const)for(const[id,c]of Object.entries(p[dimension]||{})){target[dimension][id]||=Object.fromEntries(Object.keys(c).map(k=>[k,0])) as AttentionCounters;mergeAttention(target[dimension][id],c);}
          for(const[id,row]of Object.entries(p.byCreativeAsset||{})){target.byCreativeAsset[id]||={...row,totals:Object.fromEntries(Object.keys(row.totals).map(k=>[k,0])) as AttentionCounters,daily:{}};mergeAttention(target.byCreativeAsset[id].totals,row.totals);for(const[date,c]of Object.entries(row.daily||{})){target.byCreativeAsset[id].daily[date]||=Object.fromEntries(Object.keys(c).map(k=>[k,0])) as AttentionCounters;mergeAttention(target.byCreativeAsset[id].daily[date],c);}}
          for(const[id,row]of Object.entries(p.provenance||{})){target.provenance[id]||={...row,totals:Object.fromEntries(Object.keys(row.totals).map(k=>[k,0])) as AttentionCounters,daily:{}};mergeAttention(target.provenance[id].totals,row.totals);for(const[date,c]of Object.entries(row.daily||{})){target.provenance[id].daily[date]||=Object.fromEntries(Object.keys(c).map(k=>[k,0])) as AttentionCounters;mergeAttention(target.provenance[id].daily[date],c);}}
        }
        rows += page.rows;
        if (page.last_at && (!lastAt || page.last_at > lastAt)) lastAt = page.last_at;
        coverage = mergeCoverage(coverage, page.coverage);
        after = page.has_more ? page.next_cursor : '~';
        attentionAfter=page.attention_page.has_more?page.attention_page.next_cursor:'~';
        if ((page.has_more && (!after || cursors.has(after)))||(page.attention_page.has_more&&(!attentionAfter||cursors.has('a:'+attentionAfter)))) throw new Error('The report could not finish loading. Please retry.');
        if (after) cursors.add(after);
        if(attentionAfter)cursors.add('a:'+attentionAfter);
      } while (after!=='~'||attentionAfter!=='~');
      if (cancelled || !coverage) return;
      setData({ ...merged, daily: Object.entries(merged.daily).sort(([a], [b]) => a.localeCompare(b)).map(([date, counters]) => ({ date, ...counters })), hourly: Object.entries(merged.hourly).sort(([a], [b]) => Number(a) - Number(b)).map(([hour, counters]) => ({ hour, ...counters })), coverage, last_at: lastAt, has_more: false, next_cursor: null,attention_page:{has_more:false,next_cursor:null}, rows });
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
export const number = (value: number) => value.toLocaleString('en-IN');
export const attentionHours = (observedMs:number,personMs:number) => observedMs>0 ? `${(personMs/3600000).toFixed(2)} h` : 'Unavailable';
export const attentionPeopleRate = (personMs:number,assessableMs:number) => assessableMs>0 ? personMs/assessableMs : null;
export const average = (counters: ReportCounters) => counters.presence_n > 0 ? counters.presence_sum / counters.presence_n : null;
export const formatAverage = (counters: ReportCounters) => average(counters)?.toFixed(1) ?? 'Unmeasured';
export function rangeDays(period: Period) {
  const dates: string[] = [];
  for (let day = Date.parse(period.from); day <= Date.parse(period.to); day += DAY) dates.push(new Date(day).toISOString().slice(0, 10));
  return dates;
}
export function csvCell(value: unknown) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function dailyReportCsv(data: DeliveryData, period: Period, selectedProfileKey?:string) {
  const header = ['date_ist', 'period_from', 'period_to', 'coverage_started_at', 'period_fully_covered', 'source', 'paid_delivered', 'paid_billable', 'paid_failed', 'filler_receipts', 'legacy_presence_sum', 'legacy_measured_paid_plays', 'mean_people_per_legacy_measured_paid_play', 'paid_airtime_ms', 'invalid_clock_receipts','profile_series_id','profile','manifest_sha256','pipeline_sha256','calibration_provenance','calibrated_attention_observed_share','asset_versions','profile_plays','playing_ms','body_observed_ms','body_unknown_ms','presence_person_ms','mean_people_per_body_observed_ms','face_observed_ms','face_unknown_ms','attention_observed_ms','attention_unknown_ms','looking_person_ms','longest_look_ms','face_assessable_person_ms','estimated_impressions','attentive_impressions','visible_smile_rate'];
  const profileKeys=Object.keys(data.attentionProfiles||{}).sort(),profileKey=selectedProfileKey&&profileKeys.includes(selectedProfileKey)?selectedProfileKey:profileKeys[0],profile=profileKey?data.attentionProfiles[profileKey]:undefined;
  const rows = rangeDays(period).map(date => {
    const recorded = data.daily.find(row => row.date === date);
    const covered = data.coverage.started_at && Date.parse(date + 'T00:00:00+05:30') >= Date.parse(data.coverage.started_at);
    const row = recorded || (covered ? emptyCounters() : null);
    return [date, period.from, period.to, data.coverage.started_at, data.coverage.complete, 'accepted_device_receipts_daily_aggregate', row?.plays_rendered, row?.plays_billable, row?.plays_not_rendered, row?.plays_filler, row?.presence_n ? row.presence_sum : null, row?.presence_n, row ? average(row) : null, row?.airtime_ms, row?.plays_time_invalid ?? (row ? 0 : null),...Array(23).fill(null)];
  });
  if(profileKey&&profile)for(const [date,c]of Object.entries(profile.daily||{})){const prov=Object.values(profile.provenance||{}),dayProv=prov.filter(x=>(x.daily?.[date]?.plays||0)>0),dayGuided=dayProv.filter(x=>x.mode==='guided').reduce((n,x)=>n+(x.daily?.[date]?.attention_observed_ms||0),0),dayObserved=c.attention_observed_ms||0;const provenance=dayProv.map(x=>`${x.mode}${x.calibration_revision?':'+x.calibration_revision:''}`).join('|');const assets=Object.values(profile.byCreativeAsset||{}).filter(x=>(x.daily?.[date]?.plays||0)>0).length;rows.push([date,period.from,period.to,data.coverage.started_at,data.coverage.complete,'attention_profile_series',null,null,null,null,null,null,null,null,null,profileKey,profile.profile,profile.manifest_sha256,profile.pipeline_sha256,provenance,dayObserved?dayGuided/dayObserved:null,assets,c.plays,c.playing_ms,c.body_observed_ms,c.body_unknown_ms,c.body_observed_ms?c.presence_person_ms:null,c.body_observed_ms?c.presence_person_ms/c.body_observed_ms:null,c.face_observed_ms,c.face_unknown_ms,c.attention_observed_ms,c.attention_unknown_ms,c.attention_observed_ms?c.looking_person_ms:null,c.attention_observed_ms?c.longest_look_ms:null,c.attention_observed_ms?c.face_assessable_person_ms:null,c.body_observed_ms?c.estimated_impressions:null,c.attention_observed_ms?c.attentive_impressions:null,c.expression_assessable_person_ms?c.smile_person_ms/c.expression_assessable_person_ms:null]);}
  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}
export function DeliveryReport({ report, screens = [], campaigns = [], creatives = [] }: { report: DeliveryReportState; screens?: { id: string; name: string }[]; campaigns?: { id: string; name: string }[]; creatives?: { id: string; name: string }[] }) {
  const { data, period, loading } = report;
  const view = useReportView(report, { byScreen: screens, byCampaign: campaigns, byCreative: creatives });
  const { selectedAttention } = view;
  return <section className="space-y-4" aria-label="Delivery report" aria-busy={loading}>
    <ReportPeriodBar report={report} view={view} />
    <ReportAlerts report={report} view={view} />
    {data && !loading && <>
      <ReportCoverageNote data={data} period={period} />
      <ReportInvalidTimeNote data={data} />
      <DeliveryCards data={data} period={period} />
      <MeasurementCards data={data} period={period} view={view} />
      {selectedAttention && <ProfileHourTable profile={selectedAttention} />}
      <div className="grid gap-4 xl:grid-cols-2">
        <DailyDeliveryChart data={data} period={period} view={view} />
        {!selectedAttention && <HourlyPresence data={data} period={period} view={view} />}
      </div>
      <DeliveryBreakdown data={data} period={period} view={view} />
      <AttentionInsights view={view} period={period} />
    </>}
  </section>;
}
