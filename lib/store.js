// Storage adapter: Upstash Redis on Vercel, JSON file locally, memory as fallback.
import fs from 'fs';
import path from 'path';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK  = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY  = 'gridcast:db';
const FILE = path.join(process.cwd(), 'data', 'db.json');

export const mode = URL_ && TOK ? 'redis' : (process.env.VERCEL ? 'memory' : 'file');
let mem = null;

async function redis(cmd, ...args) {
  const res = await fetch(`${URL_}/${cmd}/${encodeURIComponent(KEY)}${args.length ? '' : ''}`, {
    method: args.length ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: args.length ? JSON.stringify(args[0]) : undefined
  });
  if (!res.ok) throw new Error(`redis ${cmd} ${res.status}`);
  return res.json();
}

export async function read() {
  if (mode === 'redis') {
    const r = await redis('get');
    return r.result ? JSON.parse(r.result) : null;
  }
  if (mode === 'file') {
    if (!fs.existsSync(FILE)) return null;
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  }
  return mem;
}

export async function write(db) {
  if (mode === 'redis') { await redis('set', JSON.stringify(db)); return; }
  if (mode === 'file') {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
    return;
  }
  mem = db;
}
