import * as React from 'react';
import { cn } from '@/lib/utils';

export function DataTable<T>({ cols, rows, empty = 'Nothing here yet', className }: {
  cols: { label: string; num?: boolean; className?: string; render: (r: T) => React.ReactNode }[];
  rows: T[]; empty?: string; className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-border/60 bg-card shadow-sm overflow-x-auto', className)}>
      {rows.length === 0 ? (
        <div className="py-12 text-center text-[13px] text-muted-foreground">{empty}</div>
      ) : (
        <table className="w-full text-[13px] min-w-[560px]">
          <thead>
            <tr className="bg-muted/60">
              {cols.map((c, i) => (
                <th key={i} className={cn('px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 whitespace-nowrap border-b border-border', c.num && 'text-right', c.className)}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                {cols.map((c, j) => (
                  <td key={j} className={cn('px-4 py-3 align-middle', c.num && 'text-right tnum font-mono')}>{c.render(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
