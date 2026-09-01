'use client';
export type SessionUser = { id: string; name: string; role: string; orgName: string; org_id: string; advertiser_id?: string };

export async function api<T = any>(path: string, body?: any): Promise<T> {
  const r = await fetch('/api' + path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { cache: 'no-store' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
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
