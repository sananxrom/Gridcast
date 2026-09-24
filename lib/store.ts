import fs from 'fs';
import path from 'path';
import { firestoreStore, type StoreContext } from './firestore-store';
export { StoreError } from './firestore-store';
export type { StoreContext } from './firestore-store';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'gridcast:db';
const FILE = path.join(process.cwd(), 'data', 'db.json');

export const mode: 'firestore' | 'redis' | 'file' | 'memory' =
  process.env.GC_STORE === 'firestore' ? 'firestore' : URL_ && TOK ? 'redis' : process.env.VERCEL ? 'memory' : 'file';

/** Keep the full read/auth/mutate/write path inside this callback. It can retry. */
export async function transact<T>(context: StoreContext, fn: () => Promise<T>): Promise<T> {
  return mode === 'firestore' ? (await firestoreStore()).transact(context, fn) : fn();
}

let mem: any = null;

async function redis(cmd: 'get' | 'set', body?: string) {
  const res = await fetch(`${URL_}/${cmd}/${encodeURIComponent(KEY)}`, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`redis ${cmd} ${res.status}`);
  return res.json();
}

export async function read(): Promise<any | null> {
  if (mode === 'firestore') return (await firestoreStore()).read();
  if (mode === 'redis') { const r = await redis('get'); return r.result ? JSON.parse(r.result) : null; }
  if (mode === 'file') { if (!fs.existsSync(FILE)) return null; return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  return mem;
}

export async function write(db: any) {
  if (mode === 'firestore') return (await firestoreStore()).write(db);
  if (mode === 'redis') { await redis('set', JSON.stringify(db)); return; }
  if (mode === 'file') {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
    return;
  }
  mem = db;
}
