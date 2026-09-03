'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { Lock, Info, Plus, RotateCcw } from 'lucide-react';
import { api, session, type SessionUser } from '@/lib/client';
import { PageHead, SectionHead } from '@/components/ui/app-shell';
import { DataTable } from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select, Field, Label } from '@/components/ui/input';
import { useDirtyForm, SaveBar } from '@/components/ui/form';
import { Empty } from './bits';
import { cn } from '@/lib/utils';

type Setting = {
  key: string; label: string; group: string; ctl: string; unit?: string;
  options?: (string | [string, string])[]; def: any; info?: string;
  locked?: boolean; lockReason?: string; soon?: boolean; platforms?: string[]; priced?: boolean;
};
type Schema = { groups: { id: string; title: string; hint: string }[]; settings: Setting[]; locked: string[]; priced: string[] };

const LAYERS: Record<string, { label: string; hint: string }> = {
  platform: { label: 'Platform', hint: 'Every screen on the Gridcast network' },
  org: { label: 'Organisation', hint: 'Every screen you own' },
  group: { label: 'Screen group', hint: 'One group of screens' },
  screen: { label: 'Screen', hint: 'One screen only' },
};

/** ⓘ — shown only where a label cannot carry the explanation on its own. */
function Hint({ text }: { text: string }) {
  return (
    <span className="group/h relative inline-flex">
      <Info className="size-3.5 cursor-help text-muted-foreground/50 transition-colors hover:text-muted-foreground" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-64 -translate-x-1/2 rounded-lg border border-border bg-card px-2.5 py-2 text-[12px] font-normal leading-snug text-foreground shadow-lg group-hover/h:block">
        {text}
      </span>
    </span>
  );
}

function opt(o: string | [string, string]) {
  return Array.isArray(o) ? { v: o[0], l: o[1] } : { v: o, l: o };
}

/**
 * One setting, rendered the same way everywhere: label, control, why it exists,
 * where its value came from, and how to give it back.
 */
export function SettingRow({
  s, value, source, onChange, onReset, editable = true, isSet,
}: {
  s: Setting; value: any; source?: { name: string; layer: string } | null;
  onChange?: (v: any) => void; onReset?: () => void; editable?: boolean;
  /** In an editor: does THIS config carry the key, or is it inherited? */
  isSet?: boolean;
}) {
  const locked = !!s.locked;
  const ro = locked || !editable || s.ctl === 'derived' || s.soon;
  const set = (v: any) => onChange?.(v);

  const ctl = (() => {
    if (s.ctl === 'toggle') return (
      <button type="button" disabled={ro} onClick={() => set(!value)}
        className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
          value ? 'bg-primary' : 'bg-muted-foreground/25')}>
        <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', value ? 'left-[18px]' : 'left-0.5')} />
      </button>
    );
    if (s.ctl === 'select') return (
      <Select disabled={ro} value={String(value ?? '')} onChange={e => set(e.target.value)} className="max-w-[220px]">
        {(s.options ?? []).map(o => { const { v, l } = opt(o); return <option key={v} value={v}>{l}</option>; })}
      </Select>
    );
    if (s.ctl === 'number') return (
      <div className="flex items-center gap-1.5">
        <Input type="number" disabled={ro} value={value ?? ''} onChange={e => set(e.target.value === '' ? '' : Number(e.target.value))} className="max-w-[110px]" />
        {s.unit && <span className="text-[12px] text-muted-foreground">{s.unit}</span>}
      </div>
    );
    if (s.ctl === 'time') return <Input type="time" disabled={ro} value={value ?? ''} onChange={e => set(e.target.value)} className="max-w-[130px]" />;
    if (s.ctl === 'timerange') { const v = value || { from: '', to: '' };
      return (
        <div className="flex items-center gap-1.5">
          <Input type="time" disabled={ro} value={v.from ?? ''} onChange={e => set({ ...v, from: e.target.value })} className="max-w-[120px]" />
          <span className="text-[12px] text-muted-foreground">to</span>
          <Input type="time" disabled={ro} value={v.to ?? ''} onChange={e => set({ ...v, to: e.target.value })} className="max-w-[120px]" />
        </div>
      ); }
    if (s.ctl === 'wh') { const v = value || { w: 0, h: 0 };
      return (
        <div className="flex items-center gap-1.5">
          <Input type="number" disabled={ro} value={v.w} onChange={e => set({ ...v, w: Number(e.target.value) })} className="max-w-[92px]" />
          <span className="text-[12px] text-muted-foreground">×</span>
          <Input type="number" disabled={ro} value={v.h} onChange={e => set({ ...v, h: Number(e.target.value) })} className="max-w-[92px]" />
          <span className="text-[12px] text-muted-foreground">px</span>
        </div>
      ); }
    if (s.ctl === 'color') return (
      <div className="flex items-center gap-2">
        <input type="color" disabled={ro} value={value ?? '#000000'} onChange={e => set(e.target.value)}
          className="size-8 cursor-pointer rounded border border-input bg-card p-0.5 disabled:opacity-50" />
        <span className="font-mono text-[12px] text-muted-foreground">{value}</span>
      </div>
    );
    if (s.ctl === 'rect') { const v = value || { x: 0, y: 0, w: 100, h: 100 };
      return <span className="font-mono text-[12px] text-muted-foreground">{v.x},{v.y} · {v.w}×{v.h}%</span>; }
    if (s.ctl === 'derived') return <span className="font-mono text-[12.5px] text-muted-foreground">{String(value)}</span>;
    return <Input disabled={ro} value={value ?? ''} onChange={e => set(e.target.value)} className="max-w-[260px]" />;
  })();

  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-l-2 border-border/50 px-4 py-3 last:border-b-0 transition-colors',
      isSet === true ? 'border-l-primary bg-primary/[0.035]' : 'border-l-transparent hover:bg-black/[0.015] dark:hover:bg-white/[0.015]',
      isSet === false && 'text-muted-foreground')}>
      <div className="min-w-[220px] flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
          {s.label}
          {s.info && <Hint text={s.info} />}
          {locked && <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground"><Lock className="size-2.5" />locked</span>}
          {s.priced && <Badge variant="warn">priced input</Badge>}
          {s.soon && <Badge variant="muted">soon</Badge>}
          {s.platforms && <span className="font-mono text-[10.5px] text-muted-foreground/70">[{s.platforms.join(' · ')}]</span>}
        </div>
        {locked && s.lockReason && <div className="mt-0.5 text-[11.5px] text-muted-foreground">{s.lockReason}</div>}
        {isSet === true && <div className="mt-0.5 text-[11.5px] font-medium text-primary">set by this config</div>}
        {source && <div className="mt-0.5 text-[11.5px] text-muted-foreground">⤷ {source.name}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {ctl}
        {onReset && !locked && (
          <button onClick={onReset} title="Reset to inherited"
            className="rounded p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground">
            <RotateCcw className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ list -- */

export function ConfigList({ user, onOpen, onChanged }: {
  user: SessionUser; onOpen: (id: string) => void; onChanged: () => void;
}) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [adding, setAdding] = useState(false);
  const load = () => api(`/config?user=${user.id}`).then(setRows);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user.id]);

  if (!rows) return <Empty>Loading…</Empty>;
  const mine = rows.filter(c => c.layer !== 'screen');

  return (<>
    <PageHead title="Device configs"
      sub="Settings a screen inherits. Each config carries only what it changes."
      actions={<Button onClick={() => setAdding(true)}><Plus className="size-3.5" />New config</Button>} />

    <Card className="mb-4 border-primary/25 bg-primary/[0.04] p-3.5 text-[12.5px] text-primary">
      <b>Most specific wins.</b> A screen resolves its settings by stacking platform → organisation →
      group → screen. Every value shows which config it came from.
    </Card>

    {adding && <NewConfig user={user} onDone={() => { setAdding(false); load(); onChanged(); }} />}

    <DataTable
      cols={[
        { label: 'Config', sort: (c: any) => c.name, className: 'min-w-[190px]', render: (c: any) => (
          <><button onClick={() => onOpen(c.id)} className="text-left font-medium text-primary hover:underline">{c.name}</button>
            {c.description && <div className="text-[12px] text-muted-foreground">{c.description}</div>}</> ) },
        { label: 'Layer', sort: (c: any) => c.layer, render: (c: any) => (
          <><Badge variant={c.layer === 'platform' ? 'default' : 'muted'}>{LAYERS[c.layer]?.label ?? c.layer}</Badge>
            <div className="text-[11.5px] text-muted-foreground">{LAYERS[c.layer]?.hint}</div></> ) },
        { label: 'Sets', num: true, sort: (c: any) => Object.keys(c.values || {}).length,
          render: (c: any) => <>{Object.keys(c.values || {}).length} <span className="text-muted-foreground">of 116</span></> },
        { label: 'Platforms', render: (c: any) => <span className="font-mono text-[11.5px] text-muted-foreground">{(c.target_platform || []).join(' · ')}</span> },
        { label: 'Priority', num: true, sort: (c: any) => c.priority ?? 0, render: (c: any) => c.priority ?? 0 },
        { label: 'Tags', render: (c: any) => (c.tags || []).length
          ? <div className="flex flex-wrap gap-1">{c.tags.map((t: string) => <span key={t} className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">{t}</span>)}</div>
          : <span className="text-muted-foreground">—</span> },
      ]}
      rows={mine} rowId={(c: any) => c.id} exportName="device-configs" onDone={() => { load(); onChanged(); }}
      search={(c: any) => `${c.name} ${c.description} ${(c.tags || []).join(' ')}`}
      facets={[{ label: 'Layer', get: (c: any) => LAYERS[c.layer]?.label ?? c.layer }]}
      empty="No configs yet — every screen is running on defaults." />

    <p className="mt-3 text-[12px] text-muted-foreground">
      Per-screen overrides are not listed here. They live on the screen itself, under its Config tab.
    </p>
  </>);
}

function NewConfig({ user, onDone }: { user: SessionUser; onDone: () => void }) {
  const [groups, setGroups] = useState<any[]>([]);
  const fm = useDirtyForm({ name: '', description: '', layer: 'org', target_id: '', priority: '0' });
  useEffect(() => { api(`/bootstrap?user=${user.id}`).then(d => setGroups(d.groups || [])); }, [user.id]);
  const isAdmin = user.role === 'platform_admin';

  return (
    <Card className="mb-4 border-primary/40 p-5">
      <h3 className="mb-3 text-[14px] font-semibold">New config</h3>
      <div className="flex flex-wrap gap-3">
        <Field label="Name"><Input value={fm.f.name} onChange={e => fm.set({ name: e.target.value })} placeholder="Late-night venues" /></Field>
        <Field label="Layer">
          <Select value={fm.f.layer} onChange={e => fm.set({ layer: e.target.value, target_id: '' })}>
            {isAdmin && <option value="platform">Platform — every screen on the network</option>}
            <option value="org">Organisation — every screen you own</option>
            <option value="group">Screen group</option>
          </Select>
        </Field>
        {fm.f.layer === 'group' && (
          <Field label="Group">
            <Select value={fm.f.target_id} onChange={e => fm.set({ target_id: e.target.value })}>
              <option value="">Choose a group…</option>
              {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Priority" className="max-w-[110px]"><Input type="number" value={fm.f.priority} onChange={e => fm.set({ priority: e.target.value })} /></Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <Field label="Description" className="w-full basis-full">
          <Input value={fm.f.description} onChange={e => fm.set({ description: e.target.value })} placeholder="Why this config exists — one line beats a support call" />
        </Field>
      </div>
      <SaveBar {...fm} label="Create config" note="A new config starts empty and changes nothing until you set a value."
        onSave={() => fm.save(async v => {
          await api('/config', { org_id: user.org_id, name: v.name || 'Untitled config', description: v.description,
            layer: v.layer, target_id: v.target_id || null, priority: Number(v.priority) || 0, values: {} });
          onDone();
        })} onDiscard={onDone} />
    </Card>
  );
}

/* ---------------------------------------------------------------- editor -- */

export function ConfigEditor({ id, user, onGo, onChanged }: {
  id: string; user: SessionUser; onGo: (g: string) => void; onChanged: () => void;
}) {
  const [schema, setSchema] = useState<Schema | null>(null);
  const [conf, setConf] = useState<any>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/config/schema').then(setSchema);
    api(`/config?user=${user.id}`).then((all: any[]) => {
      const c = all.find(x => x.id === id);
      setConf(c); setValues({ ...(c?.values || {}) });
    });
  }, [id, user.id]);

  if (!schema || !conf) return <Empty>Loading…</Empty>;

  const dirty = JSON.stringify(values) !== JSON.stringify(conf.values || {});
  const isPlatform = conf.layer === 'platform';
  const canEdit = (s: Setting) => !s.locked || (isPlatform && user.role === 'platform_admin');

  const setKey = (k: string, v: any) => { setValues(p => ({ ...p, [k]: v })); setSaved(false); setErr(''); };
  const unset = (k: string) => setValues(p => { const n = { ...p }; delete n[k]; return n; });

  const needle = q.trim().toLowerCase();
  const shown = schema.settings.filter(s =>
    !needle || s.label.toLowerCase().includes(needle) || s.key.includes(needle) || (s.info || '').toLowerCase().includes(needle));

  const save = async () => {
    setSaving(true); setErr('');
    try {
      await api(`/config/${id}`, { values });
      setConf({ ...conf, values }); setSaved(true); setTimeout(() => setSaved(false), 2400); onChanged();
    } catch (e: any) { setErr(e?.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  const count = Object.keys(values).length;

  return (<>
    <PageHead title={conf.name} sub={conf.description || LAYERS[conf.layer]?.hint}
      back={{ label: 'Device configs', go: 'configs', onGo }}
      actions={<><Badge variant={isPlatform ? 'default' : 'muted'}>{LAYERS[conf.layer]?.label}</Badge>
        <Badge variant="muted">{count} set</Badge></>} />

    <Card className="mb-4 p-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search settings…"
          className="h-8 w-64 rounded-md border border-input bg-background px-2.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <span className="text-[12px] text-muted-foreground">
          A setting you have not touched is not carried by this config — the screen inherits it from above.
        </span>
      </div>
    </Card>

    {schema.groups.map(g => {
      const items = shown.filter(s => s.group === g.id);
      if (!items.length) return null;
      return (
        <div key={g.id} className="mb-5">
          <SectionHead hint={`· ${g.hint}`}>{g.title}</SectionHead>
          <Card className="overflow-hidden p-0">
            {items.map(s => {
              const isSet = s.key in values;
              return (
                <SettingRow key={s.key} s={s} isSet={isSet}
                  value={isSet ? values[s.key] : s.def}
                  editable={canEdit(s)}
                  onChange={v => setKey(s.key, v)}
                  onReset={isSet ? () => unset(s.key) : undefined} />
              );
            })}
          </Card>
        </div>
      );
    })}

    <SaveBar dirty={dirty} saving={saving} saved={saved} err={err}
      note={`${count} setting${count === 1 ? '' : 's'} carried by this config.`}
      onSave={save} onDiscard={() => setValues({ ...(conf.values || {}) })} />
  </>);
}
