'use client';
export type SessionUser = { id: string; name: string; role: string; orgName: string; org_id: string; advertiser_id?: string };

let inflight = 0;
const subs = new Set<(n: number) => void>();
const emit = () => subs.forEach(f => f(inflight));
export function onLoading(f: (n: number) => void) { subs.add(f); return () => { subs.delete(f); }; }

export async function api<T = any>(path: string, body?: any, opts?: { quiet?: boolean }): Promise<T> {
  const loud = !opts?.quiet;
  if (loud) { inflight++; emit(); }
  try {
    const r = await fetch('/api' + path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { cache: 'no-store' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return await r.json();
  } finally {
    if (loud) { inflight = Math.max(0, inflight - 1); emit(); }
  }
}

export const session = {
  get(): SessionUser | null { try { return JSON.parse(localStorage.getItem('gc_user') || 'null'); } catch { return null; } },
  set(u: SessionUser) { localStorage.setItem('gc_user', JSON.stringify(u)); },
  clear() { localStorage.removeItem('gc_user'); },
};

export function useHash() {
  if (typeof window === 'undefined') return '';
  return window.location.hash.slice(1);
}
