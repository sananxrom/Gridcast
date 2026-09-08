'use client';
import React, { useState } from 'react';
import { AtSign, KeyRound, AlertCircle, ChevronLeft, Monitor, Lock, ArrowRight } from 'lucide-react';
import { api, session, token as tok } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AuthLayout, AuthSeparator, AuthTabs } from '@/components/ui/auth-page';
import { homeFor } from '@/lib/roles';



/** An input with a leading icon, as the reference layout uses. */
function IconInput({ icon: Icon, ...props }: any) {
  return (
    <div className="relative h-max">
      <Input {...props} className="peer h-10 ps-9" />
      <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 text-muted-foreground peer-disabled:opacity-50">
        <Icon className="size-4" aria-hidden />
      </div>
    </div>
  );
}

function Err({ msg }: { msg: string }) {
  return (
    <div className="min-h-[18px] text-[12.5px] text-destructive">
      {msg && <span className="inline-flex items-center gap-1.5"><AlertCircle className="size-3.5" />{msg}</span>}
    </div>
  );
}

/**
 * One form, two entrances: the public page passes tabs, the platform route
 * passes a badge. The role travels with the request so a person on the wrong
 * tab is told which one they need.
 */
export function SignInForm({ role, onRole, platform }: {
  role: 'operator' | 'advertiser' | 'platform';
  onRole?: (r: any) => void;
  platform?: boolean;
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
      tok.set(r.token); session.set(r.user);
      if (r.user.must_change) { setChange({ next: '', again: '' }); return; }
      location.href = homeFor(r.user.role);
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
      location.href = homeFor(session.get()?.role ?? '');
    } catch (e: any) { setErr(e?.message || 'Could not set the password'); }
    finally { setBusy(false); }
  };

  if (change) return (
    <>
      <div className="flex flex-col space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Choose a password</h1>
        <p className="text-base text-muted-foreground">This account was created with a temporary one.</p>
      </div>
      <div className="space-y-2">
        <IconInput icon={KeyRound} type="password" autoFocus placeholder="New password, at least 8 characters"
          value={change.next} onChange={(e: any) => setChange({ ...change, next: e.target.value })} />
        <IconInput icon={KeyRound} type="password" placeholder="Confirm it"
          value={change.again} onKeyDown={(e: any) => e.key === 'Enter' && setNew()}
          onChange={(e: any) => setChange({ ...change, again: e.target.value })} />
      </div>
      <Err msg={err} />
      <Button size="lg" className="w-full" disabled={busy || change.next.length < 8} onClick={setNew}>
        {busy ? 'Saving…' : 'Set password and continue'}
      </Button>
    </>
  );

  return (
    <>
      <div className="flex flex-col space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {platform ? 'Platform console' : 'Sign in to Gridcast'}
        </h1>
        <p className="text-base text-muted-foreground">
          {platform ? 'Gridcast network administration.'
            : role === 'operator' ? 'Manage your screens, advertisers and campaigns.'
            : 'See where your campaigns ran and how they performed.'}
        </p>
      </div>

      {platform ? (
        <div className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Lock className="size-3" />Platform access
        </div>
      ) : (
        <AuthTabs value={role} onChange={onRole!}
          options={[{ value: 'operator', label: 'Operator' }, { value: 'advertiser', label: 'Advertiser' }]} />
      )}

      <form className="space-y-2" onSubmit={e => { e.preventDefault(); go(); }}>
        <p className="text-start text-xs text-muted-foreground">
          {platform ? 'Sign in with your platform account.'
            : `Enter the email your ${role === 'operator' ? 'Gridcast' : 'operator'} account was created with.`}
        </p>
        <IconInput icon={AtSign} type="email" autoFocus autoComplete="username"
          placeholder="your.email@example.com" value={email} onChange={(e: any) => setEmail(e.target.value)} />
        <IconInput icon={KeyRound} type="password" autoComplete="current-password"
          placeholder="Password" value={password} onChange={(e: any) => setPassword(e.target.value)} />
        <Err msg={err} />
        <Button type="submit" size="lg" className="w-full" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </>
  );
}

export function PlayerEntry() {
  return (
    <>
      <AuthSeparator />
      <Button type="button" size="lg" variant="outline" className="w-full"
        onClick={() => (location.href = '/player')}>
        <Monitor className="me-2 size-4" strokeWidth={1.6} />
        Set up a screen player
        <ArrowRight className="ms-1 size-3.5" />
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        No sign-in needed — pair with the screen code from your dashboard.
      </p>
    </>
  );
}

/**
 * Sits in the flow rather than pinned to the corner — absolute positioning put
 * it on top of the logo once the layout collapsed to one column.
 */
export function BackHome() {
  return (
    <Button variant="ghost" size="sm" className="-ms-2 w-fit" asChild>
      <a href="/"><ChevronLeft className="me-1 size-4" />Home</a>
    </Button>
  );
}

export { AuthLayout };
