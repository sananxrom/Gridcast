'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, CornerDownLeft, Monitor, Megaphone, Users, Film, Command } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CmdItem = { id: string; label: string; sub?: string; kind: string; go: string };

const ICONS: Record<string, React.ElementType> = {
  screen: Monitor, campaign: Megaphone, advertiser: Users, creative: Film, page: Command,
};

export function CommandPalette({ open, onClose, items, onGo }: {
  open: boolean; onClose: () => void; items: CmdItem[]; onGo: (go: string) => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? items.filter(i => (i.label + ' ' + (i.sub || '')).toLowerCase().includes(s)) : items;
    return list.slice(0, 24);
  }, [q, items]);

  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 20); } }, [open]);
  useEffect(() => { setSel(0); }, [q]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
      if (e.key === 'Enter' && results[sel]) { e.preventDefault(); onGo(results[sel].go); onClose(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, results, sel, onGo, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/50 px-4 pt-[14vh] backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-border/60 bg-card shadow-2xl">
        <div className="flex items-center border-b border-border/60 px-4">
          <Search className="mr-3 size-[18px] shrink-0 text-muted-foreground/70" strokeWidth={1.5} />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            className="flex-1 bg-transparent py-4 text-[14px] outline-none placeholder:text-muted-foreground/50"
            placeholder="Search screens, campaigns, advertisers…" />
          <kbd onClick={onClose}
            className="ml-2 hidden h-5 cursor-pointer items-center rounded border border-border/60 bg-black/5 px-1.5 font-mono text-[10px] text-muted-foreground/70 hover:text-foreground sm:inline-flex dark:bg-white/10">ESC</kbd>
          <button onClick={onClose} className="ml-3 rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10">
            <X className="size-[18px]" strokeWidth={1.5} />
          </button>
        </div>
        <div className="no-sb max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10">
              <Command className="mb-2 size-6 text-muted-foreground/30" strokeWidth={1.5} />
              <p className="text-[13px] font-medium text-muted-foreground">No matches</p>
            </div>
          ) : results.map((r, i) => {
            const Icon = ICONS[r.kind] || Command;
            return (
              <div key={r.id} onMouseEnter={() => setSel(i)} onClick={() => { onGo(r.go); onClose(); }}
                className={cn('flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 transition-colors',
                  i === sel ? 'bg-black/5 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5')}>
                <Icon className="size-4 shrink-0 text-muted-foreground/70" strokeWidth={1.5} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{r.label}</div>
                  {r.sub && <div className="truncate text-[11.5px] text-muted-foreground">{r.sub}</div>}
                </div>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/50">{r.kind}</span>
                {i === sel && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground/50" strokeWidth={2} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
