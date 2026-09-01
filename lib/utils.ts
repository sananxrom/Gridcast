import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

export const inr = (n: number | null | undefined) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export const ytThumb = (id?: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export const ytId = (u: string) => {
  const s = String(u || '').trim();
  const m = s.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : (/^[A-Za-z0-9_-]{11}$/.test(s) ? s : null);
};

export const today = () => new Date().toISOString().slice(0, 10);

export const isLive = (c: { status: string; starts_at: string; ends_at: string }) =>
  c.status === 'active' && c.starts_at <= today() && c.ends_at >= today();

export const fmtDate = (d: string | number | Date, opts?: Intl.DateTimeFormatOptions) =>
  new Date(d).toLocaleString('en-IN', opts ?? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
