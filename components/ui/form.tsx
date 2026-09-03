'use client';
import React, { useCallback, useMemo, useState } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils';

/**
 * Tracks a form against its initial values so a save affordance can appear
 * only when something actually changed.
 */
export function useDirtyForm<T extends Record<string, any>>(initial: T) {
  const [base, setBase] = useState<T>(initial);
  const [f, setF] = useState<T>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const set = useCallback((patch: Partial<T>) => { setF(p => ({ ...p, ...patch })); setSaved(false); setErr(''); }, []);
  const reset = useCallback((next?: T) => { const n = next ?? base; setBase(n); setF(n); setSaved(false); setErr(''); }, [base]);
  const discard = useCallback(() => { setF(base); setErr(''); }, [base]);

  const dirty = useMemo(
    () => Object.keys(f).some(k => String(f[k] ?? '') !== String(base[k] ?? '')),
    [f, base]
  );

  const save = useCallback(async (fn: (values: T) => Promise<void> | void) => {
    setSaving(true); setErr('');
    try { await fn(f); setBase(f); setSaved(true); setTimeout(() => setSaved(false), 2400); }
    catch (e: any) { setErr(e?.message || 'Could not save'); }
    finally { setSaving(false); }
  }, [f]);

  return { f, set, setF, dirty, saving, saved, err, save, reset, discard };
}

/**
 * Sticky bar that rises from the bottom of the content area whenever a form
 * is dirty. One save affordance, same behaviour on every page.
 */
export function SaveBar({
  dirty, saving, saved, err, onSave, onDiscard, label = 'Save changes', note,
}: {
  dirty: boolean; saving?: boolean; saved?: boolean; err?: string;
  onSave: () => void; onDiscard?: () => void; label?: string; note?: string;
}) {
  const show = dirty || saving || saved || !!err;
  return (
    <div className={cn(
      'sticky bottom-0 z-30 -mx-8 mt-6 border-t border-border bg-card/95 px-8 py-3 backdrop-blur transition-all duration-200',
      show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
    )}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[12.5px]">
          {err ? <span className="inline-flex items-center gap-1.5 text-destructive"><AlertCircle className="h-3.5 w-3.5" />{err}</span>
            : saved ? <span className="inline-flex items-center gap-1.5 text-ok"><Check className="h-3.5 w-3.5" />Saved</span>
            : <span className="text-muted-foreground">{note || 'You have unsaved changes.'}</span>}
        </div>
        <div className="flex gap-2">
          {onDiscard && <Button variant="outline" size="sm" onClick={onDiscard} disabled={saving || !dirty}>Discard</Button>}
          <Button size="sm" onClick={onSave} disabled={saving || !dirty}>{saving ? 'Saving…' : label}</Button>
        </div>
      </div>
    </div>
  );
}
