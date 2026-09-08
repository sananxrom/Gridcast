'use client';
export type SessionUser = { id: string; name: string; role: string; orgName: string; org_id: string; advertiser_id?: string };

let inflight = 0;
const subs = new Set<(n: number) => void>();
const emit = () => subs.forEach(f => f(inflight));
export function onLoading(f: (n: number) => void) { subs.add(f); return () => { subs.delete(f); }; }

export const token = {
  get() { try { return localStorage.getItem('gc_token'); } catch { return null; } },
  set(t: string) { try { localStorage.setItem('gc_token', t); } catch {} },
  clear() { try { localStorage.removeItem('gc_token'); } catch {} },
};

export async function api<T = any>(path: string, body?: any, opts?: { quiet?: boolean }): Promise<T> {
  const loud = !opts?.quiet;
  if (loud) { inflight++; emit(); }
  try {
    const t = token.get();
    const headers: Record<string, string> = {};
    if (t) headers.Authorization = `Bearer ${t}`;
    if (body) headers['Content-Type'] = 'application/json';
    const r = await fetch('/api' + path, body
      ? { method: 'POST', headers, body: JSON.stringify(body) }
      : { headers, cache: 'no-store' });
    if (r.status === 401 && !path.startsWith('/login')) {
      // the session is gone; send them back rather than failing silently
      token.clear();
      try { localStorage.removeItem('gc_user'); } catch {}
      if (typeof location !== 'undefined' && !location.pathname.startsWith('/player')) location.href = '/';
    }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return await r.json();
  } finally {
    if (loud) { inflight = Math.max(0, inflight - 1); emit(); }
  }
}

export const session = {
  get(): SessionUser | null { try { return JSON.parse(localStorage.getItem('gc_user') || 'null'); } catch { return null; } },
  set(u: SessionUser) { localStorage.setItem('gc_user', JSON.stringify(u)); },
  clear() { localStorage.removeItem('gc_user'); try { localStorage.removeItem('gc_token'); } catch {} },
};

export function useHash() {
  if (typeof window === 'undefined') return '';
  return window.location.hash.slice(1);
}
