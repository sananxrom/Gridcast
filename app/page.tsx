'use client';
import { useEffect, useState } from 'react';
import { session } from '@/lib/client';
import { SignIn, RoleTabs, PlayerLink, Shell } from '@/components/views/auth';
import { TopProgress } from '@/components/ui/loader';

export default function Login() {
  const [role, setRole] = useState<'operator' | 'advertiser'>('operator');

  // a live session skips the form
  useEffect(() => {
    const u = session.get();
    if (u && localStorage.getItem('gc_token')) {
      location.href = u.role === 'platform_admin' ? '/admin' : u.role === 'org_admin' ? '/operator' : '/advertiser';
    }
  }, []);

  return (<>
    <TopProgress />
    <Shell note={<PlayerLink />}>
      <SignIn
        role={role}
        tabs={<RoleTabs value={role} onChange={setRole} />}
        title="Sign in"
        sub={role === 'operator'
          ? 'Manage your screens, advertisers and campaigns.'
          : 'See where your campaigns ran and how they performed.'} />
    </Shell>
  </>);
}
