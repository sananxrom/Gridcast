'use client';
import React, { useState } from 'react';
import { api, type SessionUser } from '@/lib/client';
import { can } from '@/lib/roles';
import { inr, ytId } from '@/lib/utils';
import { campaignStatus, type CampaignStatus } from '@/lib/campaign-status';
import { campaignInterval } from '@/lib/inventory';
import { PageHead } from '@/components/ui/app-shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Field } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/table';
import { TabList, TabPanel } from '@/components/ui/tabs';
import { Thumb, Empty } from './bits';
import { CreativeUpload } from './creative-upload';
import { CampaignStatusBadge, useCampaignEvidence, useNow } from './campaign-status-badge';

const DAY = 86_400_000;
/** Same ended rule as campaignStatus(): complete/cancelled, or past the end of its IST date interval. */
const campaignEnded = (c: any, now: number) => {
  if (c?.status === 'complete' || c?.status === 'cancelled') return true;
  try { return now >= campaignInterval(c)[1]; } catch { return false; }
};
const istDay = (at: number) => new Date(at + 330 * 60_000).toISOString().slice(0, 10);
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const approvalVariant = (s: string) => s === 'approved' ? 'ok' : s === 'rejected' ? 'destructive' : 'warn';
/** Order for the Overview status counts; labels come from the Phase 1 derivation. */
const STATE_ORDER = ['live', 'not_delivering', 'scheduled', 'in_review', 'changes_needed', 'draft', 'paused', 'unknown', 'ended'];

type WorkspaceProps = {
  a: any; d: any; user: SessionUser; orgId: string | null; onGo: (g: string) => void; onChanged: () => unknown;
  /** Settings tab content (contact card, exclusions, edit/archive), owned by the commercial view. */
  settings: React.ReactNode;
  /** Renders the existing creative editor for a row. */
  renderEditor: (row: any, close: () => void) => React.ReactNode;
};

/** `#a/<id>`: one advertiser's Overview, Campaigns, Creatives library and Settings. Bootstrap data only. */
export function AdvertiserWorkspace({ a, d, user, orgId, onGo, onChanged, settings, renderEditor }: WorkspaceProps) {
  const [tab, setTab] = useState('overview');
  const caps: string[] = d.caps ?? [];
  const evidence = useCampaignEvidence(orgId && caps.includes('platform') ? orgId : null);
  const now = useNow();
  const archived = a.status === 'archived';
  const canManage = (user.role === 'platform_admin' || a.org_id === user.org_id) && can(user.role, 'sales');
  const mayCreate = canManage && !archived;
  const campaigns: any[] = d.campaigns.filter((c: any) => c.advertiser_id === a.id);
  const creatives: any[] = d.creatives.filter((c: any) => c.advertiser_id === a.id && c.purpose !== 'filler');
  const statuses = new Map<string, CampaignStatus>(campaigns.map((c: any) => [c.id, campaignStatus({
    campaign: c, creatives: d.creatives, screens: d.screens, advertiser: a,
    reportScreens: evidence.loaded ? (evidence.campaignScreens[c.id] ?? {}) : null, reportLoaded: evidence.loaded, now,
  })]));
  const statusOf = (c: any) => statuses.get(c.id)!;
  const tabs = [{ id: 'overview', label: 'Overview' }, { id: 'campaigns', label: 'Campaigns' }, { id: 'creatives', label: 'Creatives' }, { id: 'settings', label: 'Settings' }];
  const newCampaign = () => onGo('new:a:' + a.id);
  return <>
    <PageHead title={a.name} sub={`${d.orgs?.find((o: any) => o.id === a.org_id)?.name ?? a.org_id} · ${a.status ?? 'active'}`} back={{ label: 'Advertisers', go: 'advertisers', onGo }} />
    {archived && <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
      <p>This advertiser is archived. New creatives and campaigns cannot be created until it is restored. History is kept.</p>
      {canManage && <Button size="sm" variant="outline" onClick={() => setTab('settings')}>Open settings to restore</Button>}
    </Card>}
    <TabList tabs={tabs} value={tab} onChange={setTab} label="Advertiser sections" idBase="advertiser" />
    <TabPanel idBase="advertiser" id={tab}>
      {tab === 'overview' && <Overview campaigns={campaigns} creatives={creatives} statusOf={statusOf} evidenceError={evidence.error} now={now} onGo={onGo} onTab={setTab} />}
      {tab === 'campaigns' && <Campaigns campaigns={campaigns} statusOf={statusOf} canManage={canManage} archived={archived} onGo={onGo} onNew={newCampaign} />}
      {tab === 'creatives' && <CreativeLibrary a={a} d={d} now={now} creatives={creatives} canManage={canManage} mayCreate={mayCreate} archived={archived} onChanged={onChanged} renderEditor={renderEditor} />}
      {tab === 'settings' && settings}
    </TabPanel>
  </>;
}

function Tile({ title, children, caption }: { title: string; children: React.ReactNode; caption?: React.ReactNode }) {
  return <Card role="group" aria-label={title} className="p-4">
    <div className="text-[12px] font-medium text-muted-foreground">{title}</div>
    <div className="mt-1 text-[22px] font-semibold tracking-tight tnum">{children}</div>
    {caption && <div className="mt-1 text-[11.5px] text-muted-foreground">{caption}</div>}
  </Card>;
}

function Overview({ campaigns, creatives, statusOf, evidenceError, now, onGo, onTab }: {
  campaigns: any[]; creatives: any[]; statusOf: (c: any) => CampaignStatus; evidenceError: string | null; now: number; onGo: (g: string) => void; onTab: (t: string) => void;
}) {
  const counts = new Map<string, { label: string; tone: CampaignStatus['tone']; n: number }>();
  for (const c of campaigns) {
    const s = statusOf(c), cur = counts.get(s.state);
    if (cur) cur.n++; else counts.set(s.state, { label: s.label.split(' · ')[0], tone: s.tone, n: 1 });
  }
  const ordered = [...counts.entries()].sort((x, y) => STATE_ORDER.indexOf(x[0]) - STATE_ORDER.indexOf(y[0]));
  const spendHidden = campaigns.some((c: any) => typeof c.accrued_spend !== 'number');
  const spend = spendHidden ? '—' : inr(campaigns.reduce((sum: number, c: any) => sum + c.accrued_spend, 0));
  const today = istDay(now), weekOut = istDay(now + 7 * DAY);
  const pending = creatives.filter((c: any) => c.approval_status === 'pending');
  const rejected = creatives.filter((c: any) => c.approval_status === 'rejected');
  const noMedia = creatives.filter((c: any) => !c.assets?.length && !c.youtube_id);
  const notDelivering = campaigns.filter((c: any) => statusOf(c).state === 'not_delivering');
  const endingSoon = campaigns.filter((c: any) => !['ended', 'draft'].includes(statusOf(c).state) && typeof c.ends_at === 'string' && c.ends_at >= today && c.ends_at <= weekOut);
  const items: { key: string; tone: 'warn' | 'destructive' | 'muted'; text: string; act: () => void; actLabel: string }[] = [
    ...(pending.length ? [{ key: 'pending', tone: 'warn' as const, text: `${plural(pending.length, 'creative')} awaiting platform approval`, act: () => onTab('creatives'), actLabel: 'View creatives' }] : []),
    ...(rejected.length ? [{ key: 'rejected', tone: 'destructive' as const, text: `${plural(rejected.length, 'creative')} rejected`, act: () => onTab('creatives'), actLabel: 'View creatives' }] : []),
    ...(noMedia.length ? [{ key: 'nomedia', tone: 'warn' as const, text: `${plural(noMedia.length, 'creative has', 'creatives have')} no media yet`, act: () => onTab('creatives'), actLabel: 'Upload' }] : []),
    ...notDelivering.map((c: any) => ({ key: 'nd-' + c.id, tone: 'destructive' as const, text: `${c.name}: ${statusOf(c).label}`, act: () => onGo('c/' + c.id), actLabel: 'Open campaign' })),
    ...endingSoon.map((c: any) => ({ key: 'end-' + c.id, tone: 'muted' as const, text: `${c.name} ends ${c.ends_at === today ? 'today' : 'on ' + c.ends_at}`, act: () => onGo('c/' + c.id), actLabel: 'Open campaign' })),
  ];
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Tile title="Campaigns" caption="Visible to you">{campaigns.length}</Tile>
      <Tile title="Accrued spend" caption={<><span>Lifetime</span>{spendHidden && <span> · some amounts are not visible to you</span>}</>}>{spend}</Tile>
      <Tile title="Creatives" caption={pending.length ? `${pending.length} awaiting approval` : 'In this advertiser’s library'}>{creatives.length}</Tile>
    </div>
    <Card className="p-4">
      <h2 className="mb-2 text-sm font-semibold">Campaigns by status</h2>
      {ordered.length ? <ul aria-label="Campaigns by status" className="flex flex-wrap gap-2">
        {ordered.map(([state, x]) => <li key={state}><Badge variant={x.tone}>{x.label} · {x.n}</Badge></li>)}
      </ul> : <p className="text-sm text-muted-foreground">No campaigns yet.</p>}
      {evidenceError && <p className="mt-2 text-xs text-muted-foreground">Delivery evidence could not load, so some states may read Unknown.</p>}
    </Card>
    <Card className="p-4">
      <h2 className="mb-2 text-sm font-semibold">Needs attention</h2>
      {items.length ? <ul className="divide-y divide-border">
        {items.map(item => <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
          <span className="flex items-center gap-2"><Badge variant={item.tone}>{item.tone === 'muted' ? 'Ending soon' : item.tone === 'destructive' ? 'Action' : 'Check'}</Badge>{item.text}</span>
          <Button size="sm" variant="ghost" onClick={item.act}>{item.actLabel}</Button>
        </li>)}
      </ul> : <p className="text-sm text-muted-foreground">Nothing needs attention.</p>}
    </Card>
  </div>;
}

function Campaigns({ campaigns, statusOf, canManage, archived, onGo, onNew }: {
  campaigns: any[]; statusOf: (c: any) => CampaignStatus; canManage: boolean; archived: boolean; onGo: (g: string) => void; onNew: () => void;
}) {
  return <>
    {canManage && <div className="mb-3 flex flex-wrap items-center gap-3">
      <Button disabled={archived} onClick={onNew}>+ New campaign</Button>
      {archived && <span className="text-xs text-muted-foreground">Restore this advertiser to create campaigns.</span>}
    </div>}
    <DataTable rows={campaigns} rowId={(c: any) => c.id} cols={[
      { label: 'Campaign', render: (c: any) => <button className="text-left font-medium text-primary hover:underline" onClick={() => onGo('c/' + c.id)}>{c.name}</button> },
      { label: 'Status', render: (c: any) => <CampaignStatusBadge status={statusOf(c)} /> },
      { label: 'Dates', render: (c: any) => <span className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">{c.starts_at} → {c.ends_at}</span> },
      { label: 'Accrued', num: true, render: (c: any) => typeof c.accrued_spend === 'number' ? inr(c.accrued_spend) : '—' },
      { label: 'Budget', num: true, render: (c: any) => c.committed_budget == null ? 'Managed by Gridcast' : inr(c.committed_budget) },
    ]} empty="No campaigns for this advertiser." />
  </>;
}

function mediaOf(c: any) {
  const image = c.media_type === 'image', assets: any[] = c.assets ?? [];
  const kind = image ? 'Image' : assets.length ? 'Video' : c.youtube_id ? 'YouTube video' : 'Video';
  const length = image ? `${c.duration_s ?? 20}s display`
    : assets.length ? assets.map((x: any) => `${x.duration_s ?? x.duration_ms / 1000}s`).join(' / ')
    : c.youtube_id && c.duration_s ? `${c.duration_s}s (reported)` : null;
  return { kind, length, hasMedia: assets.length > 0 || !!c.youtube_id, variations: assets.length };
}

function MediaPlaceholder({ image, label }: { image: boolean; label: string }) {
  return <div className="grid aspect-video w-full place-items-center rounded border border-border/70 bg-muted text-muted-foreground">
    <div className="text-center">
      <svg viewBox="0 0 24 24" aria-hidden="true" className="mx-auto h-6 w-6 opacity-60" fill="none" stroke="currentColor" strokeWidth="1.5">
        {image ? <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m4 18 5-5 4 4 3-3 4 4" /></>
          : <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="m10 9 5 3-5 3V9Z" /></>}
      </svg>
      <div className="mt-1 text-[10.5px] uppercase tracking-wider">{label}</div>
    </div>
  </div>;
}

function CreativeCard({ c, used, ended, canManage, onEdit, onChanged }: { c: any; used: number; ended: number; canManage: boolean; onEdit: () => void; onChanged: () => unknown }) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'upload'>('idle');
  const m = mediaOf(c), image = c.media_type === 'image';
  const warning = `Uploading a new file sends this creative back to review. It needs approval before it can play in any of its ${plural(used, 'unended visible campaign')}.`;
  return <Card role="group" aria-label={`Creative ${c.name}`} className="flex h-full flex-col gap-2 p-3">
    {c.youtube_id && !m.variations ? <Thumb id={c.youtube_id} className="!w-full" />
      : <MediaPlaceholder image={image} label={m.hasMedia ? `${m.kind}${m.variations > 1 ? ` · ${m.variations} variations` : ''}` : 'No media yet'} />}
    <div className="min-w-0">
      <div className="truncate font-medium" title={c.name}>{c.name}</div>
      <div className="text-[12px] text-muted-foreground">{m.kind}{m.length ? ` · ${m.length}` : ''}{c.category ? ` · ${c.category}` : ''}</div>
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant={approvalVariant(c.approval_status)}>{c.approval_status}</Badge>
      {!m.hasMedia && <Badge variant="outline">No media yet</Badge>}
    </div>
    <div className="text-[12px] text-muted-foreground">Used in {plural(used, 'visible campaign')}{ended > 0 && <span> · +{ended} ended</span>}</div>
    {canManage && step === 'idle' && <div className="mt-auto flex flex-wrap gap-2 pt-1">
      <Button size="sm" variant="outline" aria-label={`Edit creative ${c.name}`} onClick={onEdit}>Edit</Button>
      <Button size="sm" variant="outline" aria-label={`Upload file for ${c.name}`} onClick={() => setStep(used > 0 ? 'confirm' : 'upload')}>Upload file</Button>
    </div>}
    {canManage && step !== 'idle' && used > 0 && <p role="note" className="rounded-md bg-warn/12 p-2 text-[12px] text-warn">{warning}</p>}
    {canManage && step === 'confirm' && <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => setStep('upload')}>Continue to upload</Button>
      <Button size="sm" variant="ghost" onClick={() => setStep('idle')}>Cancel</Button>
    </div>}
    {canManage && step === 'upload' && <CreativeUpload creativeId={c.id} mediaType={image ? 'image' : 'video'} defaultOpen className="min-w-0 max-w-none"
      onClose={() => setStep('idle')} onUploaded={() => onChanged()} />}
  </Card>;
}

function NewCreative({ a, onChanged, onClose }: { a: any; onChanged: () => unknown; onClose: () => void }) {
  const [f, setF] = useState({ name: '', category: a.category || 'general', source: 'upload', url: '', dur: '10' });
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<any>(null);
  const [upload, setUpload] = useState<'choosing' | 'done' | 'failed' | 'skipped'>('choosing');
  const [uploadError, setUploadError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (!f.name.trim()) throw new Error('Enter a creative name.');
      let media: any = { media_type: f.source === 'image' ? 'image' : 'video' };
      if (f.source === 'image') {
        const duration = Number(f.dur); if (!Number.isFinite(duration) || duration < 1 || duration > 600) throw new Error('Image display time must be between 1 and 600 seconds.');
        media.duration_s = duration;
      }
      if (f.source === 'youtube') {
        const id = ytId(f.url); if (!id) throw new Error('Not a YouTube URL or video ID.');
        const duration = Number(f.dur); if (!Number.isFinite(duration) || duration <= 0) throw new Error('Enter a positive duration.');
        media = { media_type: 'video', youtube_id: id, duration_s: duration, aspect: '16:9' };
      }
      const row = await api('/creative', { org_id: a.org_id, purpose: 'paid', advertiser_id: a.id, name: f.name.trim(), category: f.category.trim() || 'general', ...media });
      setCreated({ ...row, name: row?.name ?? f.name.trim(), media_type: row?.media_type ?? media.media_type, source: f.source });
      setUpload('choosing'); setUploadError('');
      await onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  if (created) {
    const youtube = created.source === 'youtube', label = created.media_type === 'image' ? 'image' : 'video';
    return <Card className="mb-4 p-5" aria-label="New creative">
      <h3 className="mb-2 font-semibold">New creative</h3>
      {youtube ? <p role="status" className="text-sm">Created “{created.name}”. It is in the library below and awaits platform approval.</p>
        : <>
          {upload === 'choosing' && <p className="mb-3 text-sm">Created “{created.name}”. Choose the {label} file to upload now.</p>}
          {upload === 'done' && <p className="mb-3 text-sm">“{created.name}” now has its {label}. It awaits platform approval before it can play.</p>}
          {upload === 'failed' && <p role="alert" className="mb-3 text-sm text-destructive">The upload did not complete{uploadError ? `: ${uploadError}` : ''}. “{created.name}” was kept and shows as “No media yet” in the library. Try again here or from its card.</p>}
          {upload === 'skipped' && <p className="mb-3 text-sm">No file was uploaded. “{created.name}” is in the library as “No media yet”. Use Upload file on its card when the file is ready.</p>}
          {upload !== 'skipped' && <CreativeUpload creativeId={created.id} mediaType={label} defaultOpen hideUploadError
            onUploaded={async () => { setUpload('done'); setUploadError(''); await onChanged(); }}
            onError={message => { setUpload('failed'); setUploadError(message); }}
            onClose={() => setUpload(u => u === 'done' ? u : 'skipped')} />}
        </>}
      <div className="mt-3 flex gap-2">
        <Button variant="outline" onClick={() => { setCreated(null); setF({ ...f, name: '', url: '' }); }}>Add another</Button>
        <Button variant="ghost" onClick={onClose}>Done</Button>
      </div>
    </Card>;
  }
  return <Card className="mb-4 p-5" aria-label="New creative">
    <form onSubmit={submit}>
      <h3 className="mb-3 font-semibold">New creative for {a.name}</h3>
      <div className="flex flex-wrap gap-3">
        <Field label="Name"><Input aria-label="New creative name" maxLength={200} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Category"><Input aria-label="New creative category" maxLength={200} value={f.category} onChange={e => setF({ ...f, category: e.target.value })} /></Field>
        <Field label="Media source"><Select aria-label="New creative media source" value={f.source} onChange={e => setF({ ...f, source: e.target.value, dur: e.target.value === 'image' ? '20' : '10' })}>
          <option value="upload">Upload video · MP4 / WebM</option><option value="image">Upload image · PNG / JPEG / WebP</option><option value="youtube">YouTube · online only</option>
        </Select></Field>
        {f.source === 'image' && <Field label="Display seconds"><Input aria-label="New creative display seconds" type="number" min="1" max="600" step="0.1" value={f.dur} onChange={e => setF({ ...f, dur: e.target.value })} /></Field>}
        {f.source === 'youtube' && <>
          <Field label="YouTube URL" className="flex-[2]"><Input aria-label="New creative YouTube URL" value={f.url} onChange={e => setF({ ...f, url: e.target.value })} placeholder="https://youtube.com/watch?v=…" /></Field>
          <Field label="Expected seconds" className="max-w-[140px]"><Input aria-label="New creative expected seconds" type="number" min="1" value={f.dur} onChange={e => setF({ ...f, dur: e.target.value })} /></Field>
        </>}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{f.source === 'youtube' ? 'The entered duration is self-reported. Upload a file for server-verified dimensions and duration.' : `After the creative is created you choose the ${f.source === 'image' ? 'image' : 'video'} here. New creatives need platform approval before they play.`}</p>
      {err && <p role="alert" className="mt-3 text-sm text-destructive">{err}</p>}
      <div className="mt-3 flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create creative'}</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
      </div>
    </form>
  </Card>;
}

function CreativeLibrary({ a, d, now, creatives, canManage, mayCreate, archived, onChanged, renderEditor }: {
  a: any; d: any; now: number; creatives: any[]; canManage: boolean; mayCreate: boolean; archived: boolean; onChanged: () => unknown; renderEditor: (row: any, close: () => void) => React.ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  // Count only campaigns that can still play; ended usage is shown separately.
  const usage = (id: string) => {
    const rows = d.campaigns.filter((c: any) => Array.isArray(c.creative_ids) && c.creative_ids.includes(id));
    const ended = rows.filter((c: any) => campaignEnded(c, now)).length;
    return { used: rows.length - ended, ended };
  };
  const editRow = editing && creatives.find((c: any) => c.id === editing);
  return <>
    {canManage && !adding && <div className="mb-3 flex flex-wrap items-center gap-3">
      <Button disabled={!mayCreate} onClick={() => setAdding(true)}>+ New creative</Button>
      {archived && <span className="text-xs text-muted-foreground">Archived advertisers cannot receive new creatives. Restore it in Settings first.</span>}
    </div>}
    {adding && mayCreate && <NewCreative a={a} onChanged={onChanged} onClose={() => setAdding(false)} />}
    {editRow && !archived && renderEditor(editRow, () => setEditing(null))}
    <p className="mb-3 text-xs text-muted-foreground">Campaign counts cover campaigns visible to you that have not ended; network campaigns run by other organisations may not be included.</p>
    {creatives.length ? <ul aria-label="Creative library" className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
      {creatives.map((c: any) => <li key={c.id} className="min-w-0"><CreativeCard c={c} {...usage(c.id)} canManage={canManage && !archived} onEdit={() => setEditing(c.id)} onChanged={onChanged} /></li>)}
    </ul> : <Empty>No creatives for this advertiser yet.</Empty>}
  </>;
}
