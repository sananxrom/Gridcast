'use client';
import * as React from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { METRICS, periodLabel, completenessLabel, type Definition, type MetricId, type Period, type Completeness } from '@/lib/metrics';
import { cn } from '@/lib/utils';

/**
 * The (i) beside a number.
 *
 * For this product the explain affordance is not help text — it is the thesis made
 * clickable. "Every number carries its provenance" currently lives in the code and in
 * the research documents and nowhere in the UI.
 *
 * Five fields, same order, every time: what it counts, what it excludes, where it came
 * from, over what period, how complete it is. The last one matters most and is the one
 * nobody builds: it is the per-number expression of `history.truncated`, which today
 * surfaces only as one page-level banner.
 *
 * Click, not hover — hover tooltips are unreachable on a tablet, and an operator on a
 * shop floor is often on one.
 *
 */
export function Explain({ metric, period, completeness, className }: {
  metric: MetricId;
  period?: Period;
  completeness?: Completeness;
  className?: string;
}) {
  const d: Definition = METRICS[metric];
  const when = periodLabel(period);
  const how = completenessLabel(completeness);
  const labelId = React.useId();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`What "${d.title}" means`}
          className={cn(
            'inline-flex size-6 shrink-0 items-center justify-center rounded-full align-middle',
            'text-muted-foreground transition-colors hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            className,
          )}
        >
          <Info className="size-[13px]" aria-hidden />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-3.5 text-[12.5px] leading-relaxed" aria-labelledby={labelId}>
        <div id={labelId} className="text-[13px] font-semibold tracking-tight">{d.title}</div>

        <p className="mt-1.5 text-muted-foreground">{d.counts}</p>

        {d.excludes && (
          <p className="mt-2 text-muted-foreground">
            <span className="font-medium text-foreground">Not counted. </span>
            {d.excludes}
          </p>
        )}

        <p className="mt-2 text-muted-foreground">
          <span className="font-medium text-foreground">Where it comes from. </span>
          {d.source}
        </p>

        {(when || how || d.unit) && (
          <dl className="mt-2.5 space-y-1 border-t border-border/60 pt-2.5 text-[11.5px]">
            {when && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground/70">Period</dt>
                <dd className="tnum">{when}</dd>
              </div>
            )}
            {d.unit && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground/70">Unit</dt>
                <dd>{d.unit}</dd>
              </div>
            )}
            {how && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground/70">Coverage</dt>
                <dd className={cn(completeness?.truncated && 'text-warn')}>{how}</dd>
              </div>
            )}
          </dl>
        )}

        {d.seeAlso && (
          <a href={d.seeAlso} className="mt-2.5 inline-block text-[11.5px] font-medium text-primary hover:underline">
            How this is measured →
          </a>
        )}
      </PopoverContent>
    </Popover>
  );
}
