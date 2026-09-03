'use client';
import * as React from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Undo2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export type Col<T> = {
  label: string;
  num?: boolean;
  className?: string;
  render: (r: T) => React.ReactNode;
  /** Supplying this makes the column sortable. */
  sort?: (r: T) => string | number;
};

export type BulkAction<T> = {
  label: string;
  run: (rows: T[]) => Promise<void> | void;
  /** Called with the pre-action rows, so the change can be put back. */
  undo?: (rows: T[]) => Promise<void> | void;
  variant?: 'default' | 'outline' | 'destructive' | 'ghost' | 'subtle';
  confirm?: string;
};

export type Facet<T> = { label: string; get: (r: T) => string | null | undefined };

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

function toCSV(input: any[]): string {
  if (input.length && typeof input[0] !== 'object') return ['value', ...input.map(v => String(v))].join('\n');
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
  rowId, bulk, exportName, onDone, search, facets, toolbar,
}: {
  cols: Col<T>[];
  rows: T[]; empty?: string; className?: string;
  rowId?: (r: T) => string;
  bulk?: BulkAction<T>[];
  exportName?: string;
  onDone?: () => void;
  /** Text pulled from a row for the search box. Supplying it shows the box. */
  search?: (r: T) => string;
  /** Dropdown filters built from the data itself. */
  facets?: Facet<T>[];
  toolbar?: React.ReactNode;
}) {
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState('');
  const [undo, setUndo] = React.useState<{ label: string; rows: T[]; fn: (r: T[]) => any } | null>(null);
  const [sort, setSort] = React.useState<{ i: number; dir: 1 | -1 } | null>(null);
  const [q, setQ] = React.useState('');
  const [picked, setPicked] = React.useState<Record<string, string>>({});
  const lastIdx = React.useRef<number | null>(null);
  const selectable = !!rowId;

  // filter, then sort — selection and actions always run on what is on screen
  const view = React.useMemo(() => {
    let out = rows;
    if (q && search) { const n = q.toLowerCase(); out = out.filter(r => search(r).toLowerCase().includes(n)); }
    for (const f of facets ?? []) {
      const want = picked[f.label];
      if (want) out = out.filter(r => String(f.get(r) ?? '') === want);
    }
    if (sort) {
      const get = cols[sort.i]?.sort;
      if (get) out = [...out].sort((a, b) => {
        const x = get(a), y = get(b);
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
      });
    }
    return out;
  }, [rows, q, search, facets, picked, sort, cols]);

  const ids = React.useMemo(() => (rowId ? view.map(rowId) : []), [view, rowId]);

  React.useEffect(() => {
    setSel(prev => {
      const live = new Set(ids);
      const next = new Set(Array.from(prev).filter(id => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [ids]);

  const allOn = ids.length > 0 && ids.every(id => sel.has(id));
  const someOn = sel.size > 0;
  const chosen = view.filter((r, i) => sel.has(ids[i]));

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
    const before = chosen;
    setBusy(a.label);
    try {
      await a.run(before);
      setSel(new Set());
      onDone?.();
      if (a.undo) {
        setUndo({ label: `${a.label} · ${before.length} row${before.length === 1 ? "" : "s"}`, rows: before, fn: a.undo });
        setTimeout(() => setUndo(u => (u && u.rows === before ? null : u)), 9000);
      }
    } finally { setBusy(''); }
  };

  const doUndo = async () => {
    if (!undo) return;
    setBusy('undo');
    try { await undo.fn(undo.rows); setUndo(null); onDone?.(); } finally { setBusy(''); }
  };

  const filtered = view.length !== rows.length;
  const showTools = !!search || !!(facets ?? []).length || !!toolbar;

  return (
    <>
      <div className={cn('rounded-xl border border-border/60 bg-card shadow-sm', className)}>
        {showTools && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2.5">
            {search && (
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter…"
                className="h-8 w-48 rounded-md border border-input bg-background px-2.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            )}
            {(facets ?? []).map(f => {
              const opts = Array.from(new Set(rows.map(r => f.get(r)).filter(Boolean) as string[])).sort();
              if (opts.length < 2) return null;
              return (
                <select key={f.label} value={picked[f.label] ?? ''}
                  onChange={e => setPicked(p => ({ ...p, [f.label]: e.target.value }))}
                  className="h-8 rounded-md border border-input bg-background px-2 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="">{f.label}: all</option>
                  {opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              );
            })}
            {filtered && (
              <button onClick={() => { setQ(''); setPicked({}); }}
                className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
                <X className="size-3" />{view.length} of {rows.length}
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">{toolbar}</div>
          </div>
        )}
        <div className="overflow-x-auto">
          {view.length === 0 ? (
            <div className="py-12 text-center text-[13px] text-muted-foreground">{filtered ? 'Nothing matches those filters.' : empty}</div>
          ) : (
            <table className="w-full min-w-[560px] text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-muted">
                  {selectable && (
                    <th className="w-9 border-b border-border px-3 py-2.5">
                      <Check checked={allOn} mixed={someOn} onToggle={toggleAll} label="Select all" />
                    </th>
                  )}
                  {cols.map((c, i) => {
                    const on = sort?.i === i;
                    return (
                      <th key={i} className={cn('whitespace-nowrap border-b border-border px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70', c.num && 'text-right', c.className)}>
                        {c.sort ? (
                          <button onClick={() => setSort(s => (s?.i === i ? (s.dir === 1 ? { i, dir: -1 } : null) : { i, dir: 1 }))}
                            className={cn('inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground', on && 'text-foreground', c.num && 'flex-row-reverse')}>
                            {c.label}
                            {on ? (sort!.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)
                              : <ArrowUpDown className="size-3 opacity-0 transition-opacity group-hover/th:opacity-40" />}
                          </button>
                        ) : c.label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {view.map((r, i) => {
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

      {/* one floating bar, so it stays put on a long list */}
      {selectable && (someOn || undo) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/95 px-3.5 py-2 shadow-2xl backdrop-blur">
            {someOn ? (<>
              <span className="text-[12.5px] font-medium">{sel.size} selected</span>
              <button onClick={() => setSel(new Set())} className="text-[12px] text-muted-foreground hover:text-foreground hover:underline">Clear</button>
              <span className="h-4 w-px bg-border" />
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
            </>) : (<>
              <span className="text-[12.5px]">{undo!.label}</span>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={doUndo}>
                <Undo2 className="size-3.5" />{busy === 'undo' ? 'Undoing…' : 'Undo'}
              </Button>
            </>)}
          </div>
        </div>
      )}
    </>
  );
}
