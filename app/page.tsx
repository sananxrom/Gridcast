'use client';
import { useEffect, useState } from 'react';
import { session } from '@/lib/client';
import { homeFor } from '@/lib/roles';
import { AuthLayout, SignInForm, PlayerEntry } from '@/components/views/auth';
import { TopProgress } from '@/components/ui/loader';

export default function Login() {
  const [role, setRole] = useState<'operator' | 'advertiser'>('operator');

  useEffect(() => {
    const u = session.get();
    if (u && localStorage.getItem('gc_token')) location.href = homeFor(u.role);
  }, []);

  return (<>
    <TopProgress />
    <AuthLayout
      quote="Every number on this platform can be traced back to the play that produced it."
      by="Gridcast measurement principle">
      <SignInForm role={role} onRole={setRole} />
      <PlayerEntry />
      <p className="pt-2 text-sm text-muted-foreground">
        Accounts are created for you — operators by Gridcast, advertisers by their operator.
        No public sign-up.
      </p>
    </AuthLayout>
  </>);
}
