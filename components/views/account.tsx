'use client';
import React, { useEffect, useState } from 'react';
import { UserPlus, KeyRound, Lock, Copy, Check } from 'lucide-react';
import { api, session, token, type SessionUser } from '@/lib/client';
import { PageHead, SectionHead } from '@/components/ui/app-shell';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select, Field, Label } from '@/components/ui/input';
import { useDirtyForm, SaveBar } from '@/components/ui/form';
import { DataTable } from '@/components/ui/table';
import { InlineSelect } from '@/components/ui/popover';
import { Empty } from './bits';
import { ROLES, roleLabel, assignable, can, type Cap } from '@/lib/roles';
import { fmtDate } from '@/lib/utils';

const isCap = (u: SessionUser, c: Cap) => can(u.role, c);

/** A one-time secret, shown once, with the warning that makes it survivable. */
function OneTime({ email, pw, onDone }: { email: string; pw: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card className="mb-4 border-primary/40 p-5">
      <h3 className="text-[14px] font-semibold">Temporary password</h3>
      <p className="mb-3 mt-1 text-[12.5px] text-muted-foreground">
        Hand this over yourself — it is shown once and cannot be recovered. They will be asked to
        choose their own on first sign-in.
      </p>
      <div className="rounded-lg border border-border bg-muted/60 p-3 font-mono text-[13px]">
        <div>{email}</div>
        <div className="mt-1 text-[18px] font-semibold tracking-wider text-primary">{pw}</div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => { navigator.clipboard?.writeText(`${email} / ${pw}`).catch(() => {}); setCopied(true); }}>
          {copied ? <><Check className="size-3.5" />Copied</> : <><Copy className="size-3.5" />Copy both</>}
        </Button>
        <Button variant="outline" onClick={onDone}>Done</Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------- profile --- */

export function ProfilePage({ user, onSaved }: { user: SessionUser; onSaved: () => void }) {
  const fm = useDirtyForm({ name: user.name, email: (user as any).email ?? '', phone: (user as any).phone ?? '' });
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [pwState, setPwState] = useState<{ busy?: boolean; msg?: string; err?: string }>({});

  const changePw = async () => {
    if (pw.next !== pw.again) return setPwState({ err: 'The two passwords do not match.' });
    setPwState({ busy: true });
    try {
      const result = await api('/password', { current: pw.current, next: pw.next });
      token.set(result.token);
      setPw({ current: '', next: '', again: '' });
      setPwState({ msg: 'Password changed.' });
    } catch (e: any) { setPwState({ err: e?.message || 'Could not change it' }); }
  };

  return (<>
    <PageHead title="Profile & account" sub="How you appear to your team, and how you sign in"
      actions={<Badge variant="muted">{roleLabel(user.role)}</Badge>} />

    <SectionHead>You</SectionHead>
    <Card className="p-5">
      <div className="flex flex-wrap gap-3">
        <Field label="Full name"><Input value={fm.f.name} onChange={e => fm.set({ name: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={fm.f.email} onChange={e => fm.set({ email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={fm.f.phone} onChange={e => fm.set({ phone: e.target.value })} placeholder="+91 …" /></Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <Field label="Organisation"><Input value={user.orgName} disabled /></Field>
        <Field label="Role"><Input value={roleLabel(user.role)} disabled /></Field>
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        Your role is set by an owner or manager. The email here is also your sign-in.
      </p>
    </Card>

    <SectionHead>Password</SectionHead>
    <Card className="p-5">
      <div className="flex flex-wrap gap-3">
        <Field label="Current"><Input type="password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label="New"><Input type="password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} placeholder="At least 8 characters" /></Field>
        <Field label="Confirm"><Input type="password" value={pw.again} onChange={e => setPw({ ...pw, again: e.target.value })} /></Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="outline" size="sm" disabled={!pw.current || pw.next.length < 8 || !!pwState.busy} onClick={changePw}>
          <KeyRound className="size-3.5" />{pwState.busy ? 'Changing…' : 'Change password'}
        </Button>
        {pwState.msg && <span className="text-[12.5px] text-ok">{pwState.msg}</span>}
        {pwState.err && <span className="text-[12.5px] text-destructive">{pwState.err}</span>}
      </div>
      <p className="mt-3 text-[12px] text-muted-foreground">
        Changing your password signs out your other browsers on the next request.
      </p>
    </Card>

    <SaveBar {...fm} onSave={() => fm.save(async v => {
      await api(`/user/${user.id}`, v);
      const u = session.get(); if (u) session.set({ ...u, name: v.name });
      onSaved();
    })} onDiscard={fm.discard} />
  </>);
}

/* -------------------------------------------------------- organisation --- */

export function OrgPage({ d, user, orgId, onSaved }: { d: any; user: SessionUser; orgId?:string; onSaved: () => void }) {
  const org = d.org || {};
  const money = isCap(user, 'money');
  const fm = useDirtyForm({
    name: org.name ?? user.orgName, legal_name: org.legal_name ?? '',
    support_email: org.support_email ?? '', phone: org.phone ?? '', website: org.website ?? '',
    registered_address: org.registered_address ?? '', billing_address: org.billing_address ?? '',
    gstin: org.gstin ?? '', pan: org.pan ?? '', state_code: org.state_code ?? '',
  });

  return (<>
    <PageHead title="Organisation" sub="Who you are on an invoice, and how people reach you" />

    <SectionHead>Identity</SectionHead>
    <Card className="p-5">
      <div className="flex flex-wrap gap-3">
        <Field label="Display name"><Input value={fm.f.name} onChange={e => fm.set({ name: e.target.value })} /></Field>
        <Field label="Legal entity name"><Input value={fm.f.legal_name} onChange={e => fm.set({ legal_name: e.target.value })} placeholder="As registered" /></Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <Field label="Support email"><Input value={fm.f.support_email} onChange={e => fm.set({ support_email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={fm.f.phone} onChange={e => fm.set({ phone: e.target.value })} /></Field>
        <Field label="Website"><Input value={fm.f.website} onChange={e => fm.set({ website: e.target.value })} /></Field>
      </div>
    </Card>

    <SectionHead>Addresses</SectionHead>
    <Card className="p-5">
      <div className="flex flex-wrap gap-3">
        <Field label="Registered address" className="w-full basis-full">
          <Input value={fm.f.registered_address} onChange={e => fm.set({ registered_address: e.target.value })} />
        </Field>
        <Field label="Billing address" className="w-full basis-full">
          <Input value={fm.f.billing_address} onChange={e => fm.set({ billing_address: e.target.value })}
            placeholder="Leave empty to use the registered address" />
        </Field>
      </div>
    </Card>

    <SectionHead hint={money ? undefined : '· owner only'}>Tax</SectionHead>
    <Card className="p-5">
      {money ? (<>
        <div className="flex flex-wrap gap-3">
          <Field label="GSTIN"><Input value={fm.f.gstin} onChange={e => fm.set({ gstin: e.target.value.toUpperCase() })} placeholder="04AABCS1234F1Z5" className="font-mono" /></Field>
          <Field label="PAN"><Input value={fm.f.pan} onChange={e => fm.set({ pan: e.target.value.toUpperCase() })} placeholder="AABCS1234F" className="font-mono" /></Field>
          <Field label="Place of supply"><Input value={fm.f.state_code} onChange={e => fm.set({ state_code: e.target.value })} placeholder="Chandigarh (04)" /></Field>
        </div>
        <p className="mt-3 text-[12px] text-muted-foreground">
          These appear on invoices raised against your campaigns. Place of supply decides whether
          CGST/SGST or IGST applies.
        </p>
      </>) : (
        <p className="text-[13px] text-muted-foreground">
          <Lock className="mr-1.5 inline size-3.5" />
          Tax identity is visible to owners. Ask an owner if it needs changing.
        </p>
      )}
    </Card>

    <Card className="mt-4 border-primary/25 bg-primary/[0.04] p-3.5 text-[12.5px] text-primary">
      <b>Platform fee: {d.org?.platform_fee_pct ?? 0}%.</b> Set by Gridcast, and charged only on
      network campaigns — where Gridcast brings an advertiser onto slots you released. You keep
      100% of what you sell yourself.
    </Card>

    <SaveBar {...fm} onSave={() => fm.save(async v => {
      const { gstin, pan, state_code, ...profile } = v;
      const o = await api(`/org/${orgId??user.org_id}`, money ? v : profile);
      const u = session.get(); if (u && o.id===u.org_id) session.set({ ...u, orgName: o.name });
      onSaved();
    })} onDiscard={fm.discard} />
  </>);
}

/* ------------------------------------------------------------ payouts --- */

export function PayoutPage({ d, user, orgId, onSaved }: { d: any; user: SessionUser; orgId?:string; onSaved: () => void }) {
  const org = d.org || {};
  const fm = useDirtyForm({
    payout_method: org.payout_method ?? 'upi', upi_id: org.upi_id ?? '', payout_note: org.payout_note ?? '',
  });
  if (!isCap(user, 'money')) return (
    <>
      <PageHead title="Billing & payouts" />
      <Empty><Lock className="mr-1.5 inline size-3.5" />Only an owner can see billing and payouts.</Empty>
    </>
  );

  const owed = (d.campaigns || []).reduce((sum: number, c: any) => {
    const fee = c.accrued_spend * ((c.platform_fee_pct || 0) / 100);
    return sum + (c.accrued_spend - fee);
  }, 0);

  return (<>
    <PageHead title="Billing & payouts" sub="How money reaches you. The platform records what was agreed; money moves outside it." />

    <SectionHead>Where payouts go</SectionHead>
    <Card className="p-5">
      <div className="flex flex-wrap gap-3">
        <Field label="Method">
          <Select value={fm.f.payout_method} onChange={e => fm.set({ payout_method: e.target.value })}>
            <option value="upi">UPI</option>
            <option value="bank">Bank transfer (details held offline)</option>
            <option value="cheque">Cheque</option>
          </Select>
        </Field>
        {fm.f.payout_method === 'upi' && (
          <Field label="UPI ID"><Input value={fm.f.upi_id} onChange={e => fm.set({ upi_id: e.target.value })} placeholder="name@bank" className="font-mono" /></Field>
        )}
        <Field label="Reference note" className="flex-[2]">
          <Input value={fm.f.payout_note} onChange={e => fm.set({ payout_note: e.target.value })} placeholder="Anything we should put on the transfer" />
        </Field>
      </div>
      <p className="mt-3 max-w-2xl text-[12px] text-muted-foreground">
        Bank account numbers are deliberately not stored here. Until this runs on encrypted storage
        with access logging, keeping them would be a liability that buys nothing — billing is manual,
        so the transfer is arranged directly.
      </p>
    </Card>

    <SectionHead>Position</SectionHead>
    <div className="grid gap-3 sm:grid-cols-3">
      <Card className="p-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Accrued, net of fee</div>
        <div className="mt-1 font-mono text-[22px] font-semibold tnum">₹{Math.round(owed).toLocaleString('en-IN')}</div>
        <div className="text-[11.5px] text-muted-foreground">across all live campaigns</div>
      </Card>
      <Card className="p-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Invoices raised</div>
        <div className="mt-1 font-mono text-[22px] font-semibold tnum">
          {(d.campaigns || []).filter((c: any) => c.invoice_status !== 'not_invoiced').length}
        </div>
        <div className="text-[11.5px] text-muted-foreground">of {(d.campaigns || []).length} campaigns</div>
      </Card>
      <Card className="p-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Paid</div>
        <div className="mt-1 font-mono text-[22px] font-semibold tnum">
          {(d.campaigns || []).filter((c: any) => c.invoice_status === 'paid').length}
        </div>
        <div className="text-[11.5px] text-muted-foreground">marked paid by you</div>
      </Card>
    </div>
    <p className="mt-3 text-[12.5px] text-muted-foreground">
      Full decomposition per campaign is on the <b>Settlement</b> page.
    </p>

    <SaveBar {...fm} onSave={() => fm.save(async v => { await api(`/org/${orgId??user.org_id}`, v); onSaved(); })} onDiscard={fm.discard} />
  </>);
}

/* --------------------------------------------------------------- team --- */

export function TeamPage({ user, orgId, boot, onChanged }: { user: SessionUser; orgId?:string|null; boot?:any; onChanged: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ email: string; pw: string } | null>(null);
  const [err, setErr] = useState('');
  const mayManage = isCap(user, 'team');
  const mayManageUser = (u: any) => mayManage && u.id !== user.id
    && (user.role === 'platform_admin' || u.role !== 'platform_admin')
    && (user.role !== 'manager' || !['owner', 'org_admin'].includes(u.role));

  const load = () => { if(user.role==='platform_admin'&&!orgId){setRows([]);return Promise.resolve();} return api('/team'+(orgId?'?org='+encodeURIComponent(orgId):'')).then(setRows).catch(e=>setErr(e.message)); };
  useEffect(() => { setRows(null);setAdding(false);setSecret(null);load(); /* eslint-disable-next-line */ }, [orgId]);
  if (!rows) return <Empty>{err||'Loading…'}</Empty>;

  const act = async (fn: () => Promise<any>) => {
    setErr('');
    try { await fn(); await load(); onChanged(); }
    catch (e: any) { setErr(e?.message || 'That did not work'); }
  };

  const choices = assignable(user.role).map(r => ({ value: r.id, label: r.label, hint: r.hint }));

  return (<>
    <PageHead title="Team & users" sub={orgId ? `People in ${boot?.orgs?.find((o:any)=>o.id===orgId)?.name??user.orgName}` : "People across organisations"}
      actions={mayManage ? <Button disabled={user.role==='platform_admin'&&!orgId} onClick={() => setAdding(true)}><UserPlus className="size-3.5" />Add someone</Button> : undefined} />

    {user.role==='platform_admin'&&!orgId&&<p className="mb-4 text-sm text-muted-foreground">Select an organisation above to view and manage its team.</p>}
    {err && <Card className="mb-4 border-destructive/40 bg-destructive/[0.06] p-3.5 text-[12.5px] text-destructive">{err}</Card>}
    {secret && <OneTime email={secret.email} pw={secret.pw} onDone={() => setSecret(null)} />}
    {adding && <AddPerson user={user} orgId={orgId??user.org_id} boot={boot} onDone={(s) => { setAdding(false); if (s) setSecret(s); load(); onChanged(); }} />}

    <DataTable
      cols={[
        { label: 'Person', sort: (u: any) => u.name, className: 'min-w-[190px]', render: (u: any) => (
          <><div className="font-medium">{u.name}{u.id === user.id && <span className="ml-2 text-[11.5px] text-muted-foreground">you</span>}</div>
            <div className="text-[12px] text-muted-foreground">{u.email}</div></>) },
        { label: 'Organisation', render: (u:any) => boot?.orgs?.find((o:any)=>o.id===u.org_id)?.name ?? u.org_id },
        { label: 'Advertiser', render: (u:any) => u.advertiser_id ? boot?.advertisers?.find((a:any)=>a.id===u.advertiser_id)?.name ?? u.advertiser_id : '—' },
        { label: 'Role', sort: (u: any) => u.role, render: (u: any) =>
          mayManageUser(u) && u.role !== 'advertiser_viewer'
            ? <InlineSelect value={u.role} choices={choices}
                onChange={v => act(() => api(`/user/${u.id}/role`, { role: v }))}>
                <Badge variant="muted">{roleLabel(u.role)}</Badge>
              </InlineSelect>
            : <Badge variant="muted">{roleLabel(u.role)}</Badge> },
        { label: 'Can reach', render: (u: any) => {
          const caps = ROLES.find(r => r.id === u.role)?.caps ?? (u.role === 'org_admin' ? ['screens', 'sales', 'money', 'team', 'org'] : []);
          return caps.length
            ? <div className="flex flex-wrap gap-1">{caps.map((c: string) =>
                <span key={c} className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">{c}</span>)}</div>
            : <span className="text-muted-foreground">—</span>; } },
        { label: 'Phone', render: (u: any) => <span className="font-mono text-[12px] text-muted-foreground">{u.phone || '—'}</span> },
        { label: 'Last sign-in', sort: (u: any) => u.last_login_at ?? '', render: (u: any) =>
          u.last_login_at ? <span className="text-[12px]">{fmtDate(u.last_login_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            : <span className="text-[12px] text-muted-foreground">never</span> },
        { label: 'Status', render: (u: any) => u.status === 'disabled'
          ? <Badge variant="destructive">disabled</Badge>
          : u.must_change ? <Badge variant="warn">password not set</Badge> : <Badge variant="ok">active</Badge> },
        { label: '', render: (u: any) => mayManageUser(u) ? (
          <div className="flex gap-2 whitespace-nowrap">
            <button onClick={() => act(async () => { const r = await api(`/user/${u.id}/newpassword`, {}); setSecret({ email: r.email, pw: r.temp_password }); })}
              className="text-[12px] font-medium text-primary hover:underline">Reset password</button>
            <button onClick={() => act(() => api(`/user/${u.id}/status`, { status: u.status === 'disabled' ? 'active' : 'disabled' }))}
              className="text-[12px] font-medium text-muted-foreground hover:text-foreground hover:underline">
              {u.status === 'disabled' ? 'Enable' : 'Disable'}
            </button>
          </div>) : null },
      ]}
      rows={rows} rowId={(u: any) => u.id} exportName="team"
      search={(u: any) => `${u.name} ${u.email} ${u.role}`}
      facets={[{ label: 'Role', get: (u: any) => roleLabel(u.role) }]}
      empty="Nobody else yet." />

    <SectionHead>What each role can reach</SectionHead>
    <Card className="overflow-hidden p-0">
      {ROLES.map(r => (
        <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/50 px-4 py-2.5 last:border-0">
          <span className="w-24 shrink-0 text-[13px] font-medium">{r.label}</span>
          <span className="flex-1 text-[12.5px] text-muted-foreground">{r.hint}</span>
          <div className="flex gap-1">{r.caps.map(c =>
            <span key={c} className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">{c}</span>)}</div>
        </div>
      ))}
    </Card>
    <p className="mt-3 text-[12px] text-muted-foreground">
      An organisation must always keep at least one owner — the last one cannot be demoted or disabled.
    </p>
  </>);
}

function AddPerson({ user, orgId, boot, onDone }: { user: SessionUser; orgId:string; boot?:any; onDone: (s?: { email: string; pw: string }) => void }) {
  const roles = [...assignable(user.role), {id:'advertiser_viewer',label:'Advertiser viewer',hint:'Only this advertiser’s campaign reports',caps:[]}];
  const fm = useDirtyForm({ name: '', email: '', phone: '', role: 'installer', advertiser_id:'' });
  const chosen = ROLES.find(r => r.id === fm.f.role);
  return (
    <Card className="mb-4 border-primary/40 p-5">
      <h3 className="mb-3 text-[14px] font-semibold">Add someone to {boot?.orgs?.find((o:any)=>o.id===orgId)?.name??user.orgName}</h3>
      <div className="flex flex-wrap gap-3">
        <Field label="Name"><Input value={fm.f.name} onChange={e => fm.set({ name: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={fm.f.email} onChange={e => fm.set({ email: e.target.value })} placeholder="them@company.in" /></Field>
        <Field label="Phone"><Input value={fm.f.phone} onChange={e => fm.set({ phone: e.target.value })} /></Field>
        <Field label="Role">
          <Select value={fm.f.role} onChange={e => fm.set({ role: e.target.value })}>
            {roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </Select>
        </Field>
      </div>
      {fm.f.role==='advertiser_viewer'&&<Field label="Advertiser access"><Select aria-label="Advertiser access" value={fm.f.advertiser_id} onChange={e=>fm.set({advertiser_id:e.target.value})}><option value="">Choose advertiser…</option>{(boot?.advertisers??[]).filter((a:any)=>a.org_id===orgId&&a.status!=='archived').map((a:any)=><option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}
      {chosen && <p className="mt-2 text-[12.5px] text-muted-foreground">{chosen.hint}.</p>}
      <SaveBar {...fm} label="Create login" note="You will be given a one-time password to pass on."
        onSave={() => fm.save(async v => {
          if(v.role==='advertiser_viewer'&&!v.advertiser_id)throw new Error('Choose the advertiser this login can view.');
          const {advertiser_id,...person}=v;
          const r = await api('/invite', {...person,org_id:orgId,...(v.role==='advertiser_viewer'?{advertiser_id}:{})});
          onDone({ email: r.user.email, pw: r.temp_password });
        })} onDiscard={() => onDone()} />
    </Card>
  );
}
