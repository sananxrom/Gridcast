/**
 * Pure selectors for the report headline values.
 *
 * Each expression here was moved out of the card arrays that `DeliveryReport` rendered inline, so the full report
 * (`DeliveryCards`, `MeasurementCards`) and the campaign dashboard read one source and cannot drift. Rules kept from
 * the original cards: values follow the single selected measurement profile and are never summed across profiles;
 * unmeasured stays "Unavailable"/"Unmeasured", and a period without daily summaries shows "—", never 0.
 */
import type { Period } from '@/lib/metrics';
import { inr } from '@/lib/utils';
import { type AttentionCounters, type AttentionProfile, type DeliveryData, type ReportCounters, attentionPeopleRate, average, formatAverage, number, rangeDays } from '@/components/views/delivery-report';

export type CardText = { value: string; hint: string };
export const NO_SUMMARIES_HINT = 'No daily summaries collected yet';
/** The original card rendering: a period whose daily summaries never started shows "—" and the no-summaries hint. */
function whenCovered(data: DeliveryData, value: string, hint: string): CardText {
  return data.coverage.started_at ? { value, hint } : { value: '—', hint: NO_SUMMARIES_HINT };
}

/** One profile only: the requested key when present, else the first key in sorted order. */
export function selectAttention(data: DeliveryData | null | undefined, requested: string) {
  const keys = Object.keys(data?.attentionProfiles || {}).sort();
  const key = keys.includes(requested) ? requested : keys[0];
  const profile: AttentionProfile | undefined = key ? data?.attentionProfiles[key] : undefined;
  return { keys, key, profile };
}

// Delivery cards.
export const paidDeliveredCard = (data: DeliveryData) => whenCovered(data, number(data.totals.plays_rendered), 'Completed paid play receipts');
export const billableCard = (data: DeliveryData) => whenCovered(data, number(data.totals.plays_billable), 'Passed every billing check');
export const failedCard = (data: DeliveryData) => whenCovered(data, number(data.totals.plays_not_rendered), 'Paid receipts not rendered');
export const fillerCard = (data: DeliveryData) => whenCovered(data, number(data.totals.plays_filler), 'Separate from advertiser delivery');

// Measurement cards; `selected` is the one selected profile from `selectAttention`.
export const presenceCard = (data: DeliveryData, selected?: AttentionProfile) => whenCovered(data,
  selected?.totals.body_observed_ms ? attentionPeopleRate(selected.totals.presence_person_ms, selected.totals.body_observed_ms)!.toFixed(1) : selected ? 'Unavailable' : formatAverage(data.totals),
  selected ? `${(selected.totals.body_observed_ms / 60000).toFixed(1)} body-observed min · ${selected.profile}` : `${number(data.totals.presence_n)} legacy measured / ${number(data.totals.plays_rendered)} paid plays`);
export const lookingCard = (data: DeliveryData, selected?: AttentionProfile) => whenCovered(data,
  selected?.totals.attention_observed_ms ? attentionPeopleRate(selected.totals.looking_person_ms, selected.totals.attention_observed_ms)!.toFixed(1) : 'Unavailable',
  selected ? `${(selected.totals.attention_observed_ms / 60000).toFixed(1)} assessable min / ${(selected.totals.attention_unknown_ms / 60000).toFixed(1)} unknown min` : 'No accepted attention analytics');
export const estimatedImpressionsCard = (data: DeliveryData, selected?: AttentionProfile) => whenCovered(data,
  selected?.totals.body_observed_ms ? number(selected.totals.estimated_impressions) : 'Unavailable',
  selected ? `${(selected.totals.body_observed_ms / 60000).toFixed(1)} body-observed min` : 'No accepted attention analytics');
export const attentiveImpressionsCard = (data: DeliveryData, selected?: AttentionProfile) => whenCovered(data,
  selected?.totals.attention_observed_ms ? number(selected.totals.attentive_impressions) : 'Unavailable',
  selected ? `${(selected.totals.attention_observed_ms / 60000).toFixed(1)} assessable min` : 'No accepted attention analytics');

/** Per-row people value used by the report breakdown table and the dashboard screen table. */
export function rowPeople(counters: ReportCounters, profileRow: AttentionCounters | undefined, profileSelected: boolean) {
  return profileSelected ? (profileRow?.body_observed_ms ? attentionPeopleRate(profileRow.presence_person_ms, profileRow.body_observed_ms)!.toFixed(2) : 'Unavailable') : formatAverage(counters);
}

export type ChartPoint = { key: string; value: number | null; detail: string };
/** Daily paid plays; covered days without rows are a recorded 0, uncovered days are gaps (null). */
export function dailyPlayRows(data: DeliveryData | null | undefined, period: Period): ChartPoint[] {
  return data ? rangeDays(period).map(date => {
    const row = data.daily.find(item => item.date === date);
    const covered = data.coverage.started_at && Date.parse(date + 'T00:00:00+05:30') >= Date.parse(data.coverage.started_at);
    return { key: date, value: row ? row.plays_rendered : covered ? 0 : null, detail: row ? `${number(row.plays_rendered)} paid plays; ${number(row.presence_n)} measured` : covered ? '0 paid plays recorded' : 'No complete daily coverage' };
  }) : [];
}
/** Daily average people: the selected profile's daily series when a profile exists, else legacy presence. Unmeasured days are gaps. */
export function dailyPeopleRows(data: DeliveryData | null | undefined, period: Period, selected?: AttentionProfile): ChartPoint[] {
  if (!data) return [];
  return rangeDays(period).map(date => {
    if (selected) {
      const c = selected.daily?.[date], value = c?.body_observed_ms ? attentionPeopleRate(c.presence_person_ms, c.body_observed_ms) : null;
      return { key: date, value, detail: value === null ? 'No body observations' : `${value.toFixed(2)} average people · ${(c!.body_observed_ms / 60000).toFixed(1)} body-observed min` };
    }
    const row = data.daily.find(item => item.date === date), value = row ? average(row) : null;
    return { key: date, value, detail: value === null ? 'Unmeasured' : `${value.toFixed(1)} average people; ${number(row!.presence_n)} measured of ${number(row!.plays_rendered)} paid plays` };
  });
}
/** Daily estimated impressions from the selected profile only; no profile or no body observation is a gap. */
export function dailyImpressionRows(data: DeliveryData | null | undefined, period: Period, selected?: AttentionProfile): ChartPoint[] {
  if (!data) return [];
  return rangeDays(period).map(date => {
    const c = selected?.daily?.[date], value = c?.body_observed_ms ? c.estimated_impressions : null;
    return { key: date, value, detail: value === null ? 'Unavailable' : `${number(value)} estimated impressions · ${(c!.body_observed_ms / 60000).toFixed(1)} body-observed min` };
  });
}
export const hasValues = (rows: ChartPoint[]) => rows.some(row => row.value !== null);

export type Cue = { text: string; tone: 'muted' | 'warn' | 'default' };
/** Visible coverage cue for period cards (doc 30 §6.6). */
export function periodCues(data: DeliveryData): Cue[] {
  if (!data.coverage.started_at) return [{ text: 'no daily summaries yet', tone: 'warn' }];
  return data.coverage.complete ? [] : [{ text: 'partial', tone: 'warn' }];
}
export function playsCues(data: DeliveryData): Cue[] {
  const cues = periodCues(data);
  if (data.totals.plays_time_invalid) cues.push({ text: `${number(data.totals.plays_time_invalid)} receipts had invalid times`, tone: 'warn' });
  return cues;
}

export type PeriodPlayCell = { value: string; cue?: string };
/** A missing row is zero only after complete period coverage; an incomplete row is recorded-so-far. */
export function periodBreakdownPlays(data: DeliveryData, row?: ReportCounters): PeriodPlayCell {
  if (!data.coverage.started_at) return { value: '—' };
  if (row) return { value: number(row.plays_rendered), ...(data.coverage.complete ? {} : { cue: 'recorded · partial' }) };
  return data.coverage.complete ? { value: '0' } : { value: '—', cue: 'unknown · partial' };
}

export function profileCues(data: DeliveryData, keys: string[], selected?: AttentionProfile, metric: 'people' | 'impressions' = 'people'): Cue[] {
  const cues = periodCues(data);
  if (selected && keys.length > 1) cues.push({ text: `profile: ${selected.profile} · ${keys.length} profiles`, tone: 'muted' });
  const available = selected ? selected.totals.body_observed_ms > 0
    : metric === 'impressions' ? false : data.totals.presence_n > 0;
  if (!available) {
    const text = selected ? 'no body observations' : metric === 'impressions' ? 'no accepted profile data' : 'no presence measurements';
    cues.push({ text, tone: 'warn' });
  }
  return cues;
}

/** Lifetime spend against the committed budget. Budget redaction (operator view of a network campaign) is labelled, never guessed. */
export function spendCard(campaign: { accrued_spend?: number | null; committed_budget?: number | null; rate_type?: string; rate_value?: number | null; reporting_scope?: string }, scoped: boolean, rate: string) {
  const known = typeof campaign.accrued_spend === 'number';
  const budget = typeof campaign.committed_budget === 'number' ? campaign.committed_budget : null;
  const pct = campaign.committed_budget ? Math.round(((campaign.accrued_spend as number) / campaign.committed_budget) * 100) : 0;
  const redacted = scoped || campaign.reporting_scope === 'organisation' || budget === null;
  const cues: Cue[] = [{ text: 'Lifetime', tone: 'muted' }];
  if (!known) cues.push({ text: 'not visible to you', tone: 'warn' });
  else if (redacted) cues.push({ text: 'your screens only', tone: 'default' });
  return {
    label: scoped ? 'Lifetime gross on your screens' : 'Spend vs budget',
    value: known ? inr(campaign.accrued_spend) : 'Unavailable',
    hint: !known ? 'Spend is not shown for your role' : scoped ? 'Recorded accrual on your screens · independent of report dates' : budget === null ? 'Budget not visible · independent of report dates' : `of ${inr(budget)} · independent of report dates · new bookings: ${rate}`,
    pct, bar: known && budget !== null, hot: pct >= 80, cues,
  };
}
