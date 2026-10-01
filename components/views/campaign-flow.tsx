'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { inr, cn } from '@/lib/utils';
import { PageHead } from '@/components/ui/app-shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Field, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { NewCreative, SelectableCreativeGrid } from './advertiser-workspace';

/**
 * Guided campaign creation (doc 31 Phase 4): Basics → Screens → Creatives → Budget → Review.
 * Save draft on every step stores the entered fields and the current step on the server (`campaign_drafts`).
 * A draft reserves no screens, authorizes no playback and freezes no economics. Submit and Launch exist only on
 * Review and run the unchanged POST /campaign path on the server. Empty inputs are sent as null (cleared), never 0.
 */
const STEPS = [
  { id: 'basics', label: 'Basics' }, { id: 'screens', label: 'Screens' }, { id: 'creatives', label: 'Creatives' },
  { id: 'budget', label: 'Budget' }, { id: 'review', label: 'Review' },
] as const;
type StepId = typeof STEPS[number]['id'];
const stepLabel = (id: string) => STEPS.find(s => s.id === id)?.label ?? id;

type Form = {
  advId: string; name: string; starts_at: string; ends_at: string; daypart: { enabled: boolean; from: string; to: string };
  campaignType: string; screens: string[]; slots: Record<string, string>; creatives: string[]; rateType: string; rateValue: string; budget: string;
};
const emptyForm = (advId: string): Form => ({
  advId, name: '', starts_at: '', ends_at: '', daypart: { enabled: false, from: '09:00', to: '21:00' }, campaignType: 'operator',
  screens: [], slots: {}, creatives: [], rateType: '', rateValue: '', budget: '',
});
function formFromDraft(d: any): Form {
  const f = d.fields || {}, window = Array.isArray(f.dayparts) && f.dayparts[0];
  return {
    advId: d.advertiser_id ?? '', name: f.name ?? '', starts_at: f.starts_at ?? '', ends_at: f.ends_at ?? '',
    daypart: window ? { enabled: true, from: window.from, to: window.to } : { enabled: false, from: '09:00', to: '21:00' },
    campaignType: d.campaign_type ?? 'operator', screens: f.screen_ids ?? [],
    slots: Object.fromEntries((f.bookings ?? []).map((b: any) => [b.screen_id, String(b.rotation_weight)])),
    creatives: f.creative_ids ?? [], rateType: f.rate_type ?? '',
    rateValue: typeof f.rate_value === 'number' ? String(f.rate_value) : '', budget: typeof f.committed_budget === 'number' ? String(f.committed_budget) : '',
  };
}
/** Draft fields from the form. Blank means unknown and is sent as null, which clears the stored value. */
function fieldsOf(form: Form, network: boolean) {
  const number = (raw: string, label: string) => {
    if (!raw.trim()) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be zero or a positive number.`);
    return n;
  };
  const rateType = network ? 'per_play' : form.rateType;
  return {
    name: form.name.trim() ? form.name : null,
    starts_at: form.starts_at || null, ends_at: form.ends_at || null,
    dayparts: form.daypart.enabled ? [{ from: form.daypart.from, to: form.daypart.to }] : null,
    screen_ids: form.screens.length ? form.screens : null,
    bookings: form.screens.length ? form.screens.map(id => {
      const n = Number(form.slots[id] ?? '1');
      if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error('Turns per round must be a whole number from 1 to 100.');
      return { screen_id: id, rotation_weight: n };
    }) : null,
    creative_ids: form.creatives.length ? form.creatives : null,
    rate_type: rateType || null,
    rate_value: rateType === 'per_play' ? number(form.rateValue, 'Rate per play') : null,
    committed_budget: number(form.budget, 'Committed budget'),
  };
}

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: string } | { kind: 'error'; message: string; conflict: boolean };

export function CampaignFlow({ boot, user, orgId, advertiserId, draftId, onGo, onDone, onChanged }: {
  boot: any; user: any; orgId?: string | null; onGo: (g: string) => void; onDone: (c: any) => void;
  /** Pre-selected advertiser from `new:a:<id>`; invalid or archived routes are blocked explicitly. */
  advertiserId?: string;
  /** Resume this server draft at its saved step. */
  draftId?: string;
  onChanged?: () => unknown;
}) {
  const selectedOrg = orgId ?? (user.role === 'platform_admin' ? '' : user.org_id);
  const isPlatform = user.role === 'platform_admin';
  const originOrg = boot.orgs?.find((o: any) => o.id === selectedOrg) ?? boot.org;
  const routedAdvertiser = advertiserId ? boot.advertisers.find((a: any) => a.id === advertiserId) : undefined;
  const [form, setForm] = useState<Form>(() => emptyForm(advertiserId ?? ''));
  const [step, setStep] = useState<StepId>('basics');
  const [draft, setDraft] = useState<any>(null);
  const [loadState, setLoadState] = useState<'ready' | 'loading' | 'error'>(draftId ? 'loading' : 'ready');
  const [loadError, setLoadError] = useState('');
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [submitting, setSubmitting] = useState<'' | 'submit' | 'launch'>('');
  const [addedAdvertisers, setAddedAdvertisers] = useState<any[]>([]);
  const [localCreatives, setLocalCreatives] = useState<any[]>([]);
  const network = form.campaignType === 'network';
  const set = (patch: Partial<Form>) => setForm(f => ({ ...f, ...patch }));

  const loadDraft = async (id: string) => {
    setLoadState('loading'); setLoadError('');
    try {
      const d = await api(`/campaign-draft/${encodeURIComponent(id)}`);
      const next = formFromDraft(d);
      setDraft(d); setForm(next); setStep((STEPS.some(s => s.id === d.step) ? d.step : 'basics') as StepId);
      setSavedSnapshot(JSON.stringify(next)); setSave({ kind: 'idle' }); setLoadState('ready');
    } catch (e) { setLoadError((e as Error).message); setLoadState('error'); }
  };
  useEffect(() => { if (draftId) loadDraft(draftId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [draftId]);

  // Network screens come from the platform-only inventory read, as in the previous builder.
  const [networkInventory, setNetworkInventory] = useState<any>(null);
  const [inventoryError, setInventoryError] = useState('');
  const [inventoryAttempt, setInventoryAttempt] = useState(0);
  useEffect(() => {
    let current = true; setNetworkInventory(null); setInventoryError('');
    if (network && isPlatform && selectedOrg) api(`/network-inventory?org=${encodeURIComponent(selectedOrg)}`).then(r => { if (current) setNetworkInventory(r); }).catch(e => { if (current) setInventoryError(e.message); });
    return () => { current = false; };
  }, [network, isPlatform, selectedOrg, inventoryAttempt]);

  const advertisers = [...boot.advertisers.filter((a: any) => a.org_id === selectedOrg && a.status !== 'archived'), ...addedAdvertisers.filter(x => !boot.advertisers.some((a: any) => a.id === x.id))];
  const advertiser = advertisers.find((a: any) => a.id === form.advId) ?? null;
  const screenPool: any[] = network
    ? (networkInventory?.screens ?? []).filter((s: any) => s.network_available === true && s.network_slots > 0 && networkInventory.orgs.some((o: any) => o.id === s.org_id && o.status === 'active'))
    : boot.screens.filter((s: any) => s.org_id === selectedOrg);
  const orgName = (id: string) => (networkInventory?.orgs ?? boot.orgs ?? []).find((o: any) => o.id === id)?.name ?? id;
  const creativePool = useMemo(() => {
    const all = [...boot.creatives, ...localCreatives.filter(x => !boot.creatives.some((c: any) => c.id === x.id))];
    return all.filter((c: any) => form.advId && c.advertiser_id === form.advId && c.purpose !== 'filler');
  }, [boot.creatives, localCreatives, form.advId]);
  const chosenScreens = screenPool.filter((s: any) => form.screens.includes(s.id));
  const chosenCreatives = form.creatives.map(id => creativePool.find((c: any) => c.id === id)).filter(Boolean) as any[];
  const unknownPrices = chosenScreens.some((s: any) => typeof s.slot_price_month !== 'number');
  const listPrice = chosenScreens.reduce((sum: number, s: any) => sum + (typeof s.slot_price_month === 'number' ? s.slot_price_month : 0), 0);
  const dirty = savedSnapshot !== JSON.stringify(form);
  const tick = (arr: string[], v: string) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  const problems: { step: StepId; text: string }[] = [
    ...(!advertiser ? [{ step: 'basics' as StepId, text: 'Choose an advertiser.' }] : []),
    ...(!form.name.trim() ? [{ step: 'basics' as StepId, text: 'Enter a campaign name.' }] : []),
    ...(!form.starts_at ? [{ step: 'basics' as StepId, text: 'Choose a start date.' }] : []),
    ...(!form.ends_at ? [{ step: 'basics' as StepId, text: 'Choose an end date.' }] : []),
    ...(form.starts_at && form.ends_at && form.ends_at < form.starts_at ? [{ step: 'basics' as StepId, text: 'The end date is before the start date.' }] : []),
    ...(network && !networkInventory ? [{ step: 'screens' as StepId, text: 'Network screens have not loaded yet.' }] : []),
    ...(!form.screens.length ? [{ step: 'screens' as StepId, text: 'Pick at least one screen.' }] : []),
    ...(form.screens.some(id => !screenPool.some((s: any) => s.id === id)) && (!network || networkInventory) ? [{ step: 'screens' as StepId, text: 'A selected screen is no longer available for this campaign.' }] : []),
    ...(!form.creatives.length ? [{ step: 'creatives' as StepId, text: 'Pick at least one creative.' }] : []),
    ...(!network && !form.rateType ? [{ step: 'budget' as StepId, text: 'Choose a rate type.' }] : []),
    ...((network || form.rateType === 'per_play') && !form.rateValue.trim() ? [{ step: 'budget' as StepId, text: 'Enter the rate per play.' }] : []),
    ...(!form.budget.trim() ? [{ step: 'budget' as StepId, text: 'Enter the committed budget.' }] : []),
  ];
  const pendingCreatives = chosenCreatives.filter((c: any) => c.approval_status !== 'approved');
  const allApproved = chosenCreatives.length > 0 && chosenCreatives.length === form.creatives.length && pendingCreatives.length === 0;
  const warnings = [
    ...(chosenCreatives.some((c: any) => c.approval_status === 'pending') ? ['Some creatives are awaiting review: this campaign waits for review before it plays.'] : []),
    ...(chosenCreatives.some((c: any) => c.approval_status === 'rejected') ? ['A chosen creative was rejected. It will not play until it is changed and approved.'] : []),
  ];

  /** Saves the form at the current step. Shows "Saved" only after the server confirms; failures keep input. */
  const saveDraft = async (atStep: StepId = step): Promise<any | null> => {
    setActionError('');
    if (!selectedOrg) { setSave({ kind: 'error', message: 'Select an organisation first.', conflict: false }); return null; }
    let fields: ReturnType<typeof fieldsOf>;
    try { fields = fieldsOf(form, network); } catch (e) { setSave({ kind: 'error', message: (e as Error).message, conflict: false }); return null; }
    const snapshot = JSON.stringify(form);
    setSave({ kind: 'saving' });
    try {
      const result = draft
        ? await api(`/campaign-draft/${encodeURIComponent(draft.id)}`, { revision: draft.revision, step: atStep, advertiser_id: advertiser ? advertiser.id : null, campaign_type: form.campaignType, fields })
        : await api('/campaign-draft', { org_id: selectedOrg, campaign_type: form.campaignType, advertiser_id: advertiser ? advertiser.id : null, step: atStep,
          fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null)) });
      setDraft(result); setSavedSnapshot(snapshot);
      setSave({ kind: 'saved', at: new Date(result.updated_at ?? Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
      // Keep the address on this draft so a reload resumes it, without remounting the page.
      if (!draft && typeof window !== 'undefined') { const url = new URL(window.location.href); url.hash = 'draft:' + result.id; window.history.replaceState(window.history.state, '', url); }
      return result;
    } catch (e) {
      const message = (e as Error).message;
      setSave({ kind: 'error', message, conflict: /another tab/i.test(message) });
      return null;
    }
  };

  const submit = async (mode: 'submit' | 'launch') => {
    setActionError(''); setSubmitting(mode);
    try {
      const saved = dirty || !draft ? await saveDraft('review') : draft;
      if (!saved) return;
      const result = await api(`/campaign-draft/${encodeURIComponent(saved.id)}/submit`, { mode });
      onDone(result.campaign);
    } catch (e) { setActionError((e as Error).message); } finally { setSubmitting(''); }
  };

  const addAdvertiser = async (name: string, contact: string) => {
    if (!selectedOrg) throw new Error('Select an organisation first.');
    if (!name.trim()) throw new Error('Enter the advertiser name.');
    const a = await api('/advertiser', { org_id: selectedOrg, name: name.trim(), contact, category: 'general' });
    setAddedAdvertisers(x => [...x, a]); set({ advId: a.id, creatives: [] }); await onChanged?.();
  };
  const applyGroup = async (gid: string) => {
    if (gid === '__none') return set({ screens: [] });
    try {
      const r = await api('/group/resolve', { org_id: selectedOrg, group_id: gid });
      set({ screens: Array.from(new Set([...form.screens, ...r.screen_ids])).filter(id => screenPool.some((s: any) => s.id === id)) });
    } catch (e) { setActionError((e as Error).message); }
  };

  // Route guards kept from the previous builder: never silently pick another advertiser.
  const invalidRoutedAdvertiser = !!advertiserId && !draftId && (!routedAdvertiser || routedAdvertiser.org_id !== selectedOrg);
  const back = { label: 'Campaigns', go: 'campaigns', onGo };
  if (invalidRoutedAdvertiser) return <>
    <PageHead title="New campaign" back={back} />
    <Card role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
      <span>This advertiser is not available in the selected organisation. Choose an active advertiser before creating a campaign.</span>
      <Button variant="outline" onClick={() => onGo('advertisers')}>Back to Advertisers</Button>
    </Card>
  </>;
  if (advertiserId && !draftId && routedAdvertiser?.status === 'archived') return <>
    <PageHead title="New campaign" back={back} />
    <Card role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
      <span>This advertiser is archived. Restore it in Settings before creating a campaign.</span>
      <Button variant="outline" onClick={() => onGo('a/' + advertiserId)}>Back to Advertiser</Button>
    </Card>
  </>;
  if (loadState === 'loading') return <><PageHead title="Campaign draft" back={back} /><Card role="status" className="p-4 text-sm">Loading draft…</Card></>;
  if (loadState === 'error') return <>
    <PageHead title="Campaign draft" back={back} />
    <Card role="alert" className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
      <span>This draft could not be opened: {loadError}. Drafts are visible only to the person who started them and expire after 30 days without a save.</span>
      <span className="flex gap-2"><Button variant="outline" onClick={() => draftId && loadDraft(draftId)}>Retry</Button><Button variant="ghost" onClick={() => onGo('campaigns')}>Back to Campaigns</Button></span>
    </Card>
  </>;
  if (draft && draft.org_id !== selectedOrg) return <>
    <PageHead title="Campaign draft" back={back} />
    <Card role="alert" className="p-4 text-sm">This draft belongs to {boot.orgs?.find((o: any) => o.id === draft.org_id)?.name ?? 'another organisation'}. Select that organisation above to resume it.</Card>
  </>;

  const index = STEPS.findIndex(s => s.id === step);
  const go = (id: StepId) => { setStep(id); setActionError(''); };
  const status = save.kind === 'saving' ? 'Saving…' : save.kind === 'saved' && !dirty ? `Saved at ${save.at}` : save.kind === 'error' ? null
    : draft ? (dirty ? 'Unsaved changes' : 'Saved draft') : dirty ? 'Not saved yet' : '';

  return <>
    <PageHead title={draft ? (form.name.trim() || 'Untitled draft') : 'New campaign'} back={back}
      sub="Budget is entered manually — the platform records what was agreed, it does not take payment. Drafts do not reserve screens." />
    {!selectedOrg && <Card className="mb-4 p-4 text-sm">Select an organisation above before creating a campaign.</Card>}
    <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label="Campaign steps" className="min-w-0">
        <ol className="no-sb flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {STEPS.map((s, i) => {
            const current = s.id === step, blocked = problems.some(p => p.step === s.id);
            return <li key={s.id} className="shrink-0">
              <button type="button" aria-current={current ? 'step' : undefined} onClick={() => go(s.id)}
                className={cn('flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  current ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5')}>
                <span aria-hidden="true" className={cn('grid size-5 place-items-center rounded-full border text-[11px] tnum', current ? 'border-primary' : 'border-border')}>{i + 1}</span>
                <span>{s.label}</span>
                {blocked && s.id !== 'review' && <span className="sr-only"> (incomplete)</span>}
              </button>
            </li>;
          })}
        </ol>
      </nav>

      <section aria-labelledby="flow-step-title" className="min-w-0">
        <Card className="p-5">
          <h2 id="flow-step-title" className="mb-4 text-[15px] font-semibold">{index + 1} · {stepLabel(step)}</h2>
          {step === 'basics' && <Basics form={form} set={set} advertisers={advertisers} isPlatform={isPlatform} originOrg={originOrg}
            onType={(t: string) => set({ campaignType: t, screens: [], slots: {}, ...(t === 'network' ? { rateType: 'per_play' } : {}) })}
            onAdvertiser={(id: string) => set({ advId: id, creatives: [] })} addAdvertiser={addAdvertiser} />}
          {step === 'screens' && <Screens form={form} set={set} network={network} screenPool={screenPool} chosen={chosenScreens} groups={(boot.groups ?? []).filter((g: any) => g.org_id === selectedOrg)}
            applyGroup={applyGroup} orgName={orgName} networkInventory={networkInventory} inventoryError={inventoryError} retryInventory={() => setInventoryAttempt(n => n + 1)} />}
          {step === 'creatives' && (advertiser
            ? <Creatives advertiser={advertiser} pool={creativePool} selected={form.creatives} onToggle={(id: string) => set({ creatives: tick(form.creatives, id) })}
              onCreated={(row: any) => { setLocalCreatives(x => [...x, row]); setForm(f => ({ ...f, creatives: f.creatives.includes(row.id) ? f.creatives : [...f.creatives, row.id] })); }}
              onChanged={() => onChanged?.()} />
            : <div role="note" className="flex flex-wrap items-center gap-3 text-sm"><span>Choose an advertiser in Basics first. Creatives belong to an advertiser’s library.</span><Button size="sm" variant="outline" onClick={() => go('basics')}>Go to Basics</Button></div>)}
          {step === 'budget' && <Budget form={form} set={set} network={network} chosen={chosenScreens} listPrice={listPrice} unknownPrices={unknownPrices} />}
          {step === 'review' && <Review form={form} network={network} advertiser={advertiser} chosenScreens={chosenScreens} chosenCreatives={chosenCreatives} orgName={orgName}
            listPrice={listPrice} unknownPrices={unknownPrices} problems={problems} warnings={warnings} onStep={go} />}
        </Card>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={index === 0} onClick={() => go(STEPS[index - 1].id)}>Back</Button>
          {step !== 'review' && <Button variant="outline" onClick={() => go(STEPS[index + 1].id)}>Next</Button>}
          <Button variant={step === 'review' ? 'outline' : 'default'} disabled={!selectedOrg || save.kind === 'saving' || !!submitting} onClick={() => saveDraft()}>
            {save.kind === 'saving' ? 'Saving…' : 'Save draft'}
          </Button>
          {step === 'review' && <>
            <Button disabled={!selectedOrg || problems.length > 0 || !!submitting || save.kind === 'saving'} onClick={() => submit('submit')}>{submitting === 'submit' ? 'Submitting…' : 'Submit for review'}</Button>
            <Button disabled={!selectedOrg || problems.length > 0 || !allApproved || !!submitting || save.kind === 'saving'} onClick={() => submit('launch')}
              title={!allApproved ? 'Launch needs every chosen creative approved' : undefined}>{submitting === 'launch' ? 'Launching…' : 'Launch'}</Button>
          </>}
          <Button variant="ghost" onClick={() => onGo('campaigns')}>Cancel</Button>
          <span role="status" aria-live="polite" className="text-[12.5px] text-muted-foreground">{status}</span>
        </div>
        {save.kind === 'error' && <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-destructive/10 p-3 text-[12.5px] text-destructive">
          <span>Draft not saved: {save.message} Your entries are still here.</span>
          <Button size="sm" variant="outline" onClick={() => saveDraft()}>Retry</Button>
          {save.conflict && draft && <Button size="sm" variant="ghost" onClick={() => loadDraft(draft.id)}>Load the newer version (discards these edits)</Button>}
        </div>}
        {actionError && <p role="alert" className="mt-3 text-[12.5px] text-destructive">{actionError}</p>}
        {step === 'review' && !allApproved && chosenCreatives.length > 0 && <p className="mt-2 text-[12px] text-muted-foreground">Launch is available when every chosen creative is approved. Submit for review keeps the campaign pending until then.</p>}
      </section>
    </div>
  </>;
}

function Basics({ form, set, advertisers, isPlatform, originOrg, onType, onAdvertiser, addAdvertiser }: any) {
  const [creating, setCreating] = useState({ name: '', contact: '' });
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const isNew = form.advId === '__new';
  return <div className="space-y-4">
    {isPlatform && <div>
      <Field label="Campaign type"><Select aria-label="Campaign type" value={form.campaignType} onChange={e => onType(e.target.value)}>
        <option value="operator">Organisation campaign — its own screens</option>
        <option value="network" disabled={originOrg?.type !== 'gridcast'}>Network campaign — screens across organisations</option>
      </Select></Field>
      <p className="mt-2 text-sm text-muted-foreground">{form.campaignType === 'network' ? `Advertisers and creatives stay with ${originOrg?.name ?? 'Gridcast'}. Network campaigns use per-play billing.` : 'For network campaigns, select the Gridcast organisation above. A campaign’s type cannot change after creation.'}</p>
    </div>}
    <div className="flex flex-wrap gap-3">
      <Field label="Advertiser">
        <Select aria-label="Campaign advertiser" value={form.advId} onChange={e => onAdvertiser(e.target.value)}>
          <option value="">No advertiser yet</option>
          {advertisers.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          <option value="__new">+ New advertiser…</option>
        </Select>
      </Field>
      <Field label="Campaign name"><Input aria-label="Campaign name" maxLength={200} value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Fitline — Oct push" /></Field>
    </div>
    {isNew && <div className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
      <Field label="New advertiser name"><Input aria-label="New advertiser name" value={creating.name} onChange={e => setCreating({ ...creating, name: e.target.value })} placeholder="Acme Motors" /></Field>
      <Field label="Contact"><Input aria-label="New advertiser contact" value={creating.contact} onChange={e => setCreating({ ...creating, contact: e.target.value })} /></Field>
      <Button variant="outline" disabled={busy} onClick={async () => { setErr(''); setBusy(true); try { await addAdvertiser(creating.name, creating.contact); setCreating({ name: '', contact: '' }); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }}>{busy ? 'Creating…' : 'Create advertiser'}</Button>
      {err && <p role="alert" className="w-full text-[12.5px] text-destructive">{err}</p>}
    </div>}
    <div className="flex flex-wrap gap-3">
      <Field label="Starts"><Input aria-label="Starts" type="date" value={form.starts_at} onChange={e => set({ starts_at: e.target.value })} /></Field>
      <Field label="Ends"><Input aria-label="Ends" type="date" value={form.ends_at} onChange={e => set({ ends_at: e.target.value })} /></Field>
    </div>
    {form.starts_at && form.ends_at && form.ends_at < form.starts_at && <p role="note" className="text-[12.5px] text-warn">The end date is before the start date.</p>}
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.daypart.enabled} onChange={e => set({ daypart: { ...form.daypart, enabled: e.target.checked } })} />Limit delivery to a daily window (IST)</label>
      {form.daypart.enabled && <>
        <Input aria-label="Daypart starts" type="time" className="w-36" value={form.daypart.from} onChange={e => set({ daypart: { ...form.daypart, from: e.target.value } })} />
        <Input aria-label="Daypart ends" type="time" className="w-36" value={form.daypart.to} onChange={e => set({ daypart: { ...form.daypart, to: e.target.value } })} />
      </>}
    </div>
    <p className="text-[12.5px] text-muted-foreground">Nothing here is required to save a draft. Everything is checked when you submit on Review.</p>
  </div>;
}

function Screens({ form, set, network, screenPool, chosen, groups, applyGroup, orgName, networkInventory, inventoryError, retryInventory }: any) {
  const toggle = (id: string) => set({ screens: form.screens.includes(id) ? form.screens.filter((x: string) => x !== id) : [...form.screens, id] });
  return <div>
    {!network && groups.length > 0 && <>
      <Label>Quick select by group</Label>
      <div className="mb-3 flex flex-wrap gap-2">
        {groups.map((g: any) => <Button key={g.id} variant="outline" size="sm" onClick={() => applyGroup(g.id)}>{g.name}<span className="text-muted-foreground">{g.group_type}</span></Button>)}
        <Button variant="ghost" size="sm" onClick={() => applyGroup('__none')}>Clear</Button>
      </div>
    </>}
    {network && !networkInventory && !inventoryError && <p role="status" className="mb-3 text-sm">Loading released network screens…</p>}
    {inventoryError && <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-sm text-destructive">{inventoryError}<Button variant="outline" size="sm" onClick={retryInventory}>Retry inventory</Button></div>}
    {network && networkInventory && <p className="mb-3 text-sm text-muted-foreground">{screenPool.length} screens released for new network bookings. Existing commitments are checked when you submit.</p>}
    {screenPool.length ? <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60">
      {screenPool.map((s: any) => <label key={s.id} className="flex cursor-pointer items-center gap-3 border-b border-border/50 px-3 py-2.5 text-[13px] last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
        <input type="checkbox" checked={form.screens.includes(s.id)} onChange={() => toggle(s.id)} aria-label={`Use screen ${s.name}`} />
        <span className="min-w-0 flex-1"><span className="font-medium">{s.name}</span><br /><span className="text-[12px] text-muted-foreground">{network ? `${orgName(s.org_id)} · ` : ''}{s.address}</span></span>
        <Badge variant="muted" className="hidden sm:inline-flex">{s.venue_type}</Badge>
        <span className="hidden w-24 text-right font-mono text-[12px] text-muted-foreground sm:block">{s.advertiser_slots} advertisers{network && <><br />{s.network_slots} network limit</>}</span>
        <span className="w-20 text-right font-mono tnum">{typeof s.slot_price_month === 'number' ? inr(s.slot_price_month) : '—'}</span>
      </label>)}
    </div> : (!network || networkInventory) && <p className="text-sm text-muted-foreground">No screens are available to this campaign.</p>}
    <p className="mt-3 text-[12.5px] text-muted-foreground">{form.screens.length ? <><b>{form.screens.length}</b> screen{form.screens.length === 1 ? '' : 's'} selected</> : 'No screens selected'}</p>
    {chosen.map((s: any) => <div key={s.id} className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
      <span className="flex-1 text-sm">{s.name}<br /><span className="text-xs text-muted-foreground">Continuous rotation; longer creatives occupy their actual duration.</span></span>
      <Field label="Turns per round" className="max-w-[180px]"><Input aria-label={`Turns per round for ${s.name}`} type="number" min="1" max={100} step="1" value={form.slots[s.id] ?? '1'} onChange={e => set({ slots: { ...form.slots, [s.id]: e.target.value } })} /></Field>
    </div>)}
    <p className="mt-3 text-xs text-muted-foreground">A draft does not reserve these screens. Availability is checked across the full date range when you submit; pending and active campaigns then hold their booking. Group selection takes a snapshot.</p>
  </div>;
}

function Creatives({ advertiser, pool, selected, onToggle, onCreated, onChanged }: any) {
  const [adding, setAdding] = useState(false);
  return <div>
    {!adding && <div className="mb-3"><Button variant="outline" onClick={() => setAdding(true)}>+ New creative</Button></div>}
    {adding && <NewCreative a={advertiser} onChanged={onChanged} onClose={() => setAdding(false)} onCreated={onCreated} />}
    <p className="mb-3 text-[12.5px] text-muted-foreground">Pick from {advertiser.name}’s library. New creatives start as pending and need platform approval before they play.</p>
    <SelectableCreativeGrid creatives={pool} selected={selected} onToggle={onToggle} />
    <p className="mt-3 text-[12.5px] text-muted-foreground">{selected.length ? `${selected.length} selected` : 'No creatives selected'}</p>
  </div>;
}

function Budget({ form, set, network, chosen, listPrice, unknownPrices }: any) {
  const rateType = network ? 'per_play' : form.rateType;
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Ads repeat continuously. Per-play delivery is capped by the budget, with allowances reserved across screens when the campaign is submitted.</p>
    <div className="flex flex-wrap gap-3">
      <Field label="Rate type">
        <Select aria-label="Campaign rate type" disabled={network} value={rateType} onChange={e => set({ rateType: e.target.value, ...(e.target.value === 'flat' ? { rateValue: '' } : {}) })}>
          <option value="">Choose…</option><option value="per_play">Per play</option>{!network && <option value="flat">Flat fee</option>}
        </Select>
      </Field>
      {rateType === 'per_play' && <Field label="Rate per play (₹)"><Input aria-label="Rate per play" type="number" min="0" step="0.01" value={form.rateValue} onChange={e => set({ rateValue: e.target.value })} placeholder="Not set" /></Field>}
      <Field label="Committed budget (₹)"><Input aria-label="Committed budget" type="number" min="0" value={form.budget} onChange={e => set({ budget: e.target.value })} placeholder="Not set" /></Field>
    </div>
    <p className="text-[12.5px] text-muted-foreground">{rateType === 'flat' ? 'Flat-rate settlement is awaiting a confirmed commercial policy; these campaigns do not accrue verified settlement here.'
      : 'Per play: spend accrues for eligible recorded plays. Budget limits delivery through allowances reserved for screens.'}</p>
    <div className="rounded-md border border-border p-3 text-[13px]">
      <div className="font-medium">List price of chosen screens</div>
      {chosen.length ? <p className="mt-1 text-muted-foreground"><b className="text-foreground tnum">{unknownPrices ? '—' : inr(listPrice)}</b> / month per advertiser allocation across {chosen.length} screen{chosen.length === 1 ? '' : 's'}{unknownPrices ? ' · some screen prices are not visible to you' : ''}. This is the screens’ published monthly price, not an estimate of plays.</p>
        : <p className="mt-1 text-muted-foreground">Choose screens to see their list price.</p>}
    </div>
  </div>;
}

function Review({ form, network, advertiser, chosenScreens, chosenCreatives, orgName, listPrice, unknownPrices, problems, warnings, onStep }: any) {
  const rateType = network ? 'per_play' : form.rateType;
  const row = (label: string, value: React.ReactNode, target: StepId) => <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/60 py-2 last:border-0">
    <dt className="w-40 shrink-0 text-[12.5px] text-muted-foreground">{label}</dt>
    <dd className="min-w-0 flex-1 text-[13px]">{value}</dd>
    <Button size="sm" variant="ghost" aria-label={`Edit ${label}`} onClick={() => onStep(target)}>Edit</Button>
  </div>;
  const missing = <span className="text-muted-foreground">Not set</span>;
  return <div className="space-y-4">
    {problems.length > 0 && <div role="alert" className="rounded-md bg-destructive/10 p-3 text-[13px] text-destructive">
      <div className="mb-1 font-medium">Fix these before submitting</div>
      <ul className="list-disc space-y-0.5 pl-5">{problems.map((p: any) => <li key={p.text}><button type="button" className="underline-offset-2 hover:underline" onClick={() => onStep(p.step)}>{p.text}</button></li>)}</ul>
    </div>}
    {warnings.length > 0 && <div role="note" className="rounded-md bg-warn/12 p-3 text-[13px] text-warn"><ul className="list-disc space-y-0.5 pl-5">{warnings.map((w: string) => <li key={w}>{w}</li>)}</ul></div>}
    <dl>
      {row('Type', network ? 'Network campaign' : 'Organisation campaign', 'basics')}
      {row('Advertiser', advertiser?.name ?? missing, 'basics')}
      {row('Name', form.name.trim() || missing, 'basics')}
      {row('Dates', form.starts_at || form.ends_at ? <span className="font-mono text-[12.5px]">{form.starts_at || '—'} → {form.ends_at || '—'}</span> : missing, 'basics')}
      {row('Daily window', form.daypart.enabled ? `${form.daypart.from}–${form.daypart.to} IST` : 'All day', 'basics')}
      {row('Screens', chosenScreens.length ? <ul>{chosenScreens.map((s: any) => <li key={s.id}>{s.name}{network ? ` · ${orgName(s.org_id)}` : ''} · {form.slots[s.id] ?? '1'} turn{(form.slots[s.id] ?? '1') === '1' ? '' : 's'} per round</li>)}</ul> : form.screens.length ? `${form.screens.length} selected (not currently available)` : missing, 'screens')}
      {row('Creatives', chosenCreatives.length ? <ul>{chosenCreatives.map((c: any) => <li key={c.id} className="flex flex-wrap items-center gap-2">{c.name}<Badge variant={c.approval_status === 'approved' ? 'ok' : c.approval_status === 'rejected' ? 'destructive' : 'warn'}>{c.approval_status}</Badge></li>)}</ul> : missing, 'creatives')}
      {row('Rate', rateType === 'flat' ? 'Flat fee' : rateType === 'per_play' ? (form.rateValue.trim() ? `${inr(Number(form.rateValue))} per play` : <>Per play · {missing}</>) : missing, 'budget')}
      {row('Committed budget', form.budget.trim() ? inr(Number(form.budget)) : missing, 'budget')}
      {row('List price', chosenScreens.length ? (unknownPrices ? '—' : `${inr(listPrice)} / month per advertiser allocation`) : missing, 'budget')}
    </dl>
    <p className="text-[12.5px] text-muted-foreground">Submit for review creates the campaign as pending and holds its screens. Launch starts it now and is available only when every chosen creative is approved. Both run the full checks: dates, capacity and budget.</p>
  </div>;
}

/** The caller's own unsubmitted drafts, newest first, with resume and discard. Hidden when there are none. */
export function DraftsList({ orgId, advertisers, onGo }: { orgId: string | null; advertisers: any[]; onGo: (g: string, owner?: string) => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState('');
  const [busy, setBusy] = useState('');
  const current = useRef(0);
  const load = async () => {
    const n = ++current.current; setError('');
    try { const r = await api(`/campaign-drafts${orgId ? `?org=${encodeURIComponent(orgId)}` : ''}`, undefined, { quiet: true }); if (n === current.current) setItems(r.items ?? []); }
    catch (e) { if (n === current.current) setError((e as Error).message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgId]);
  const discard = async (id: string) => {
    setBusy(id); setError('');
    try { await api(`/campaign-draft/${encodeURIComponent(id)}/discard`, {}); setConfirming(''); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  if (error && !items) return <p role="alert" className="mb-4 text-[12.5px] text-destructive">Drafts could not load: {error} <Button size="sm" variant="ghost" onClick={load}>Retry</Button></p>;
  if (!items?.length) return null;
  return <Card className="mb-4 p-4" aria-labelledby="drafts-title">
    <h2 id="drafts-title" className="mb-2 text-sm font-semibold">Your drafts <span className="font-normal text-muted-foreground">· only you can see these</span></h2>
    <ul className="divide-y divide-border">
      {items.map((d: any) => {
        const name = d.fields?.name?.trim() || 'Untitled draft';
        return <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
          <span className="min-w-0">
            <span className="font-medium">{name}</span>
            <span className="text-muted-foreground"> · {advertisers.find((a: any) => a.id === d.advertiser_id)?.name ?? 'No advertiser yet'} · at {stepLabel(d.step)} · saved {new Date(d.updated_at).toLocaleDateString()}</span>
          </span>
          {confirming === d.id
            ? <span className="flex items-center gap-2"><span>Discard this draft?</span>
              <Button size="sm" variant="destructive" disabled={busy === d.id} onClick={() => discard(d.id)}>{busy === d.id ? 'Discarding…' : 'Discard'}</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming('')}>Keep</Button></span>
            : <span className="flex gap-2">
              <Button size="sm" variant="outline" aria-label={`Resume draft ${name}`} onClick={() => onGo('draft:' + d.id, d.org_id)}>Resume</Button>
              <Button size="sm" variant="ghost" aria-label={`Discard draft ${name}`} onClick={() => setConfirming(d.id)}>Discard</Button>
            </span>}
        </li>;
      })}
    </ul>
    {error && <p role="alert" className="mt-2 text-[12.5px] text-destructive">{error}</p>}
  </Card>;
}
