'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export type BulkAction<T> = {
  label: string;
  run: (rows: T[]) => Promise<void> | void;
  variant?: 'default' | 'outline' | 'destructive' | 'ghost' | 'subtle';
  confirm?: string;
};

function Check({ checked, mixed, onToggle, label }: {
  checked: boolean; mixed?: boolean; onToggle: (shift: boolean) => void; label: string;
}) {
  return (
    <input type="checkbox" aria-label={label} checked={checked} onChange={() => {}}
      ref={el => { if (el) el.indeterminate = !!mixed && !checked; }}
      onClick={e => { e.stopPropagation(); onToggle((e as React.MouseEvent).shiftKey); }}
      className="size-[15px] cursor-pointer rounded border-border accent-[hsl(var(--primary))]" />
  );
}

/** Flattens the primitive fields of the selected rows into CSV. */
function toCSV(input: any[]): string {
  if (input.length && typeof input[0] !== 'object') return ['value', ...input.map(v => String(v))].join('\n');
  // one level of nesting is flattened, so wrapper rows like { screen, plays } still export
  const rows = input.map(r => {
    const out: any = {};
    for (const [k, v] of Object.entries(r ?? {})) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v)) out[`${k}_${k2}`] = v2;
      } else out[k] = v;
    }
    return out;
  });
  const keys = Array.from(new Set(rows.flatMap(r =>
    Object.keys(r).filter(k => !k.startsWith('_') && ['string', 'number', 'boolean'].includes(typeof r[k])))));
  const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [keys.join(','), ...rows.map(r => keys.map(k => esc(r[k])).join(','))].join('\n');
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DataTable<T>({
  cols, rows, empty = 'Nothing here yet', className,
  rowId, bulk, exportName, onDone,
}: {
  cols: { label: string; num?: boolean; className?: string; render: (r: T) => React.ReactNode }[];
  rows: T[]; empty?: string; className?: string;
  /** Supplying this turns on multi-select. */
  rowId?: (r: T) => string;
  /** Extra actions offered when rows are selected. CSV export is always offered. */
  bulk?: BulkAction<T>[];
  exportName?: string;
  /** Called after a bulk action finishes, so the page can refetch. */
  onDone?: () => void;
}) {
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState('');
  const lastIdx = React.useRef<number | null>(null);
  const selectable = !!rowId;

  const ids = React.useMemo(() => (rowId ? rows.map(rowId) : []), [rows, rowId]);

  // drop selections whose rows are gone
  React.useEffect(() => {
    setSel(prev => {
      const live = new Set(ids);
      const next = new Set(Array.from(prev).filter(id => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [ids]);

  const allOn = ids.length > 0 && ids.every(id => sel.has(id));
  const someOn = sel.size > 0;
  const chosen = rows.filter((r, i) => sel.has(ids[i]));

  const toggleAll = () => setSel(allOn ? new Set() : new Set(ids));
  const toggleRow = (i: number, shift: boolean) => {
    setSel(prev => {
      const next = new Set(prev);
      const range = shift && lastIdx.current !== null
        ? Array.from({ length: Math.abs(i - lastIdx.current) + 1 }, (_, k) => Math.min(i, lastIdx.current!) + k)
        : [i];
      const turnOn = !next.has(ids[i]);
      range.forEach(k => (turnOn ? next.add(ids[k]) : next.delete(ids[k])));
      return next;
    });
    lastIdx.current = i;
  };

  const run = async (a: BulkAction<T>) => {
    if (a.confirm && !window.confirm(a.confirm.replace('{n}', String(chosen.length)))) return;
    setBusy(a.label);
    try { await a.run(chosen); setSel(new Set()); onDone?.(); }
    finally { setBusy(''); }
  };

  return (
    <div className={cn('rounded-xl border border-border/60 bg-card shadow-sm', className)}>
      {selectable && someOn && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-primary/[0.05] px-4 py-2.5">
          <div className="text-[12.5px] font-medium">
            {sel.size} selected
            <button onClick={() => setSel(new Set())} className="ml-3 font-normal text-muted-foreground hover:text-foreground hover:underline">Clear</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(bulk ?? []).map(a => (
              <Button key={a.label} size="sm" variant={a.variant ?? 'outline'} disabled={!!busy} onClick={() => run(a)}>
                {busy === a.label ? 'Working…' : a.label}
              </Button>
            ))}
            <Button size="sm" variant="outline" disabled={!!busy}
              onClick={() => download(`${exportName || 'export'}-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(chosen as any[]))}>
              Export CSV
            </Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        {rows.length === 0 ? (
          <div className="py-12 text-center text-[13px] text-muted-foreground">{empty}</div>
        ) : (
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="bg-muted/60">
                {selectable && (
                  <th className="w-9 border-b border-border px-3 py-2.5">
                    <Check checked={allOn} mixed={someOn} onToggle={toggleAll} label="Select all" />
                  </th>
                )}
                {cols.map((c, i) => (
                  <th key={i} className={cn('whitespace-nowrap border-b border-border px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70', c.num && 'text-right', c.className)}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const on = selectable && sel.has(ids[i]);
                return (
                  <tr key={selectable ? ids[i] : i}
                    className={cn('border-b border-border/60 transition-colors last:border-0',
                      on ? 'bg-primary/[0.06]' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.02]')}>
                    {selectable && (
                      <td className="px-3 py-3 align-middle">
                        <Check checked={!!on} onToggle={shift => toggleRow(i, shift)} label="Select row" />
                      </td>
                    )}
                    {cols.map((c, j) => (
                      <td key={j} className={cn('px-4 py-3 align-middle', c.num && 'tnum text-right font-mono')}>{c.render(r)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
