'use client';
/**
 * Compact delivery summary (doc 31 Phase 6): four period cards and one daily chart, for overviews and the advertiser
 * campaigns home. The full `DeliveryReport` lives on Analytics / Reports only, so no page shows it twice. Values come
 * from the same selectors as the report cards; the profile is one selected profile, never a sum. Pass `view` to share the
 * period and profile selection with a table on the same page, so headline and rows always use the same profile.
 */
import React from 'react';
import { periodLabel } from '@/lib/metrics';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { DeliveryReportState } from '@/components/views/delivery-report';
import { Chart, ReportAlerts, ReportPeriodBar, type ReportMetadata, type ReportView, useReportView } from '@/components/views/report-parts';
import { type Cue, billableCard, estimatedImpressionsCard, paidDeliveredCard, playsCues, presenceCard, profileCues } from '@/components/views/report-metrics';

const CUE_VARIANT = { muted: 'muted', warn: 'warn', default: 'default' } as const;

export function ReportSummary({ report, metadata, onOpen, openLabel = 'Open analytics →', title = 'Delivery summary', view: shared, profileControl }: {
  report: DeliveryReportState; metadata: ReportMetadata; onOpen?: () => void; openLabel?: string; title?: string;
  /** Page-owned view state; when given, the summary uses its period and selected profile instead of its own. */
  view?: ReportView;
  /** Rendered under the period bar, e.g. the page's single measurement-profile picker. */
  profileControl?: React.ReactNode;
}) {
  const own = useReportView(report, metadata);
  const view = shared ?? own;
  const { data, period, loading } = report;
  const ready = data && !loading ? data : null;
  const selected = view.selectedAttention;
  // Never a number while the report is loading or failed.
  const pending = { value: loading ? '…' : 'Unavailable', cues: [{ text: loading ? 'loading' : 'report not loaded', tone: loading ? 'muted' : 'warn' } as Cue] };
  const cards: { title: string; value: string; cues: Cue[] }[] = ready ? [
    { title: 'Paid plays', value: paidDeliveredCard(ready).value, cues: playsCues(ready) },
    { title: 'Billable plays', value: billableCard(ready).value, cues: [] },
    { title: 'Avg people present', value: presenceCard(ready, selected).value, cues: profileCues(ready, view.attentionKeys, selected, 'people') },
    { title: 'Est. impressions', value: estimatedImpressionsCard(ready, selected).value, cues: profileCues(ready, view.attentionKeys, selected, 'impressions') },
  ] : ['Paid plays', 'Billable plays', 'Avg people present', 'Est. impressions'].map(t => ({ title: t, ...pending }));
  const plotted = view.dateRows.filter(row => row.value !== null).length;
  return (
    <section aria-label={title} aria-busy={loading} className="mt-6 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">{title} <span className="font-normal text-muted-foreground">· {periodLabel(period)}</span></h2>
        <ReportPeriodBar report={report} view={view} className="flex flex-wrap items-end gap-2" />
      </div>
      <ReportAlerts report={report} view={view} showLoading={false} />
      {profileControl}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map(card => (
          <Card key={card.title} role="group" aria-label={card.title} className="p-4">
            <div className="text-xs font-medium text-muted-foreground">{card.title}</div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-xl font-semibold tracking-tight tnum">{card.value}</span>
              {card.cues.map(cue => <Badge key={cue.text} variant={CUE_VARIANT[cue.tone]} className="whitespace-normal">{cue.text}</Badge>)}
            </div>
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <h3 className="text-sm font-semibold">Daily paid plays</h3>
        <p className="mb-3 text-xs text-muted-foreground">Recorded paid plays per IST day. Days before daily summaries started are gaps, not zero.</p>
        {ready && plotted >= 2 ? <Chart points={view.dateRows} label="Daily paid plays" unit="paid plays" />
          : <p className="py-3 text-xs text-muted-foreground">{!ready ? (loading ? 'Loading…' : 'The report for this period is not available.') : plotted ? 'Only one day has data.' : 'No daily data in this period yet.'}</p>}
      </Card>
      {onOpen && <div><Button variant="outline" size="sm" onClick={onOpen}>{openLabel}</Button></div>}
    </section>
  );
}
