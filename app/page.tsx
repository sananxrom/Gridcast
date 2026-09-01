'use client';
import { useEffect, useState } from 'react';
import { api, session } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Monitor } from 'lucide-react';

const DEST: Record<string, string> = {
  platform_admin: '/admin', org_admin: '/operator', advertiser_viewer: '/advertiser',
};
const ROLE: Record<string, string> = {
  platform_admin: 'Platform admin', org_admin: 'Operator', advertiser_viewer: 'Advertiser',
};

export default function Login() {
  const [users, setUsers] = useState<any[]>([]);
  useEffect(() => { api('/users').then(setUsers).catch(() => {}); }, []);

  return (
    <div className="grid min-h-screen place-items-center bg-[hsl(215_28%_10%)] p-4">
      <div className="w-full max-w-[420px] rounded-xl bg-card p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <Monitor className="size-4" strokeWidth={2} />
          </div>
          <span className="text-[15px] font-semibold tracking-tight">Gridcast</span>
        </div>
        <h1 className="text-[20px] font-semibold tracking-tight">Sign in</h1>
        <p className="mb-5 mt-0.5 text-[13px] text-muted-foreground">Prototype — pick an account to continue.</p>
        <div className="flex flex-col gap-2">
          {users.map(u => (
            <button key={u.id}
              onClick={() => { session.set({ id: u.id, name: u.name, role: u.role, orgName: u.org, org_id: u.org_id, advertiser_id: u.advertiser_id }); location.href = DEST[u.role]; }}
              className="flex items-center gap-3 rounded-lg border border-border/70 bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.04]">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-[12px] font-semibold text-primary-foreground">
                {u.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('')}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-medium">{u.name}</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">{ROLE[u.role]} · {u.org}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground/60">
          <span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" />
        </div>
        <Button variant="outline" className="w-full" onClick={() => (location.href = '/player')}>
          Open a screen player →
        </Button>
      </div>
    </div>
  );
}
