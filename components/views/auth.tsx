'use client';
import React, { useState } from 'react';
import { Monitor, Lock, AlertCircle, ArrowRight } from 'lucide-react';
import { api, session, token as tok } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const DEST: Record<string, string> = {
  platform_admin: '/admin', org_admin: '/operator', advertiser_viewer: '/advertiser',
};

/**
 * One sign-in form, used by the public page (with tabs) and the unlisted
 * platform route (without). The role is carried so a person who picks the
 * wrong tab is told which one they need, rather than "wrong password".
 */
export function SignIn({ role, tabs, title, sub }: {
  role: 'operator' | 'advertiser' | 'platform';
  tabs?: React.ReactNode;
  title: string;
  sub: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [change, setChange] = useState<null | { next: string; again: string }>(null);

  const go = async () => {
    setErr(''); setBusy(true);
    try {
      const r = await api('/login', { email, password, role });
      tok.set(r.token);
      session.set(r.user);
      if (r.user.must_change) { setChange({ next: '', again: '' }); return; }
      location.href = DEST[r.user.role] ?? '/';
    } catch (e: any) { setErr(e?.message || 'Could not sign in'); }
    finally { setBusy(false); }
  };

  const setNew = async () => {
    if (!change) return;
    if (change.next !== change.again) return setErr('The two passwords do not match.');
    setErr(''); setBusy(true);
    try {
      const r = await api('/password', { next: change.next });
      tok.set(r.token);
      const u = session.get();
      location.href = DEST[u?.role ?? ''] ?? '/';
    } catch (e: any) { setErr(e?.message || 'Could not set the password'); }
    finally { setBusy(false); }
  };

  if (change) {
    return (
      <Card>
        <Head title="Choose a password" sub="This account was created with a temporary one. Set your own to continue." />
        <div className="space-y-3">
          <Field label="New password">
            <Input type="password" value={change.next} autoFocus
              onChange={e => setChange({ ...change, next: e.target.value })} placeholder="At least 8 characters" />
          </Field>
          <Field label="Confirm">
            <Input type="password" value={change.again} onKeyDown={e => e.key === 'Enter' && setNew()}
              onChange={e => setChange({ ...change, again: e.target.value })} />
          </Field>
        </div>
        <Err msg={err} />
        <Button className="mt-2 w-full" disabled={busy || change.next.length < 8} onClick={setNew}>
          {busy ? 'Saving…' : 'Set password and continue'}
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <Head title={title} sub={sub} />
      {tabs}
      <div className="space-y-3">
        <Field label="Email">
          <Input type="email" value={email} autoFocus autoComplete="username"
            onChange={e => setEmail(e.target.value)} placeholder="you@company.in" />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} autoComplete="current-password"
            onKeyDown={e => e.key === 'Enter' && go()}
            onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
        </Field>
      </div>
      <Err msg={err} />
      <Button className="mt-2 w-full" disabled={busy || !email || !password} onClick={go}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="mt-3 text-center text-[12px] text-muted-foreground">
        {role === 'advertiser'
          ? 'Your operator creates advertiser logins. Ask them if you do not have one.'
          : role === 'operator'
            ? 'Gridcast creates operator accounts. Contact us to join the network.'
            : 'Platform access only.'}
      </p>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-[400px] rounded-xl bg-card p-8 shadow-2xl">
      <div className="mb-5 flex items-center gap-2.5">
        <div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
          <Monitor className="size-4" strokeWidth={2} />
        </div>
        <span className="text-[15px] font-semibold tracking-tight">Gridcast</span>
      </div>
      {children}
    </div>
  );
}

function Head({ title, sub }: { title: string; sub: string }) {
  return (<>
    <h1 className="text-[19px] font-semibold tracking-tight">{title}</h1>
    <p className="mb-4 mt-0.5 text-[13px] text-muted-foreground">{sub}</p>
  </>);
}

function Err({ msg }: { msg: string }) {
  return (
    <div className="mt-2 min-h-[18px] text-[12.5px] text-destructive">
      {msg && <span className="inline-flex items-center gap-1.5"><AlertCircle className="size-3.5" />{msg}</span>}
    </div>
  );
}

export function RoleTabs({ value, onChange }: { value: string; onChange: (v: any) => void }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5">
      {(['operator', 'advertiser'] as const).map(r => (
        <button key={r} onClick={() => onChange(r)}
          className={cn('rounded-md py-1.5 text-[12.5px] font-medium capitalize transition-colors',
            value === r ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          {r}
        </button>
      ))}
    </div>
  );
}

export function PlayerLink() {
  return (
    <div className="mt-5 w-full max-w-[400px]">
      <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-wider text-white/35">
        <span className="h-px flex-1 bg-white/15" />or<span className="h-px flex-1 bg-white/15" />
      </div>
      <button onClick={() => (location.href = '/player')}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] py-2.5 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/10">
        <Monitor className="size-4" strokeWidth={1.6} />
        Set up a screen player
        <ArrowRight className="size-3.5" />
      </button>
      <p className="mt-2 text-center text-[11.5px] text-white/35">
        No sign-in needed — pair with the screen code from your dashboard.
      </p>
    </div>
  );
}

export function Shell({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[hsl(215_28%_10%)] p-4">
      <div className="flex w-full flex-col items-center">
        {children}
        {note}
      </div>
    </div>
  );
}

export function PlatformBadge() {
  return (
    <div className="mb-4 inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      <Lock className="size-3" />Platform access
    </div>
  );
}
