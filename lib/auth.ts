import crypto from 'crypto';

/**
 * Password and session handling.
 *
 * Passwords are stored as PBKDF2-SHA256 hashes with a per-user salt. Sessions
 * are HMAC-signed tokens carrying the user id, role and an expiry — the server
 * never trusts a client-supplied role, only what it can verify in the signature.
 */

const SECRET = process.env.GC_AUTH_SECRET
  // a deployment without a secret still works, but every restart invalidates
  // sessions and the value is not private — set GC_AUTH_SECRET in production
  || 'gridcast-dev-secret-set-GC_AUTH_SECRET-in-production';

const ITERATIONS = 60_000;
const DAYS = 7;

export function hashPassword(password: string, salt?: string) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, s, ITERATIONS, 32, 'sha256').toString('hex');
  return { salt: s, hash };
}

export function verifyPassword(password: string, salt: string, hash: string) {
  if (!salt || !hash) return false;
  const test = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256').toString('hex');
  // constant-time, so a wrong password cannot be found byte by byte
  const a = Buffer.from(test, 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString();
const sign = (payload: string) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

export type Claims = { uid: string; role: string; org: string; exp: number };

export function issueToken(user: any): string {
  const claims: Claims = {
    uid: user.id, role: user.role, org: user.org_id,
    exp: Date.now() + DAYS * 864e5,
  };
  const payload = b64(JSON.stringify(claims));
  return `${payload}.${sign(payload)}`;
}

export function readToken(token?: string | null): Claims | null {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expect = sign(payload);
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const claims = JSON.parse(unb64(payload)) as Claims;
    return claims.exp > Date.now() ? claims : null;
  } catch { return null; }
}

/** Readable enough to say down a phone, random enough to be a one-time secret. */
export function tempPassword(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ', n = '23456789';
  const pick = (s: string, k: number) => Array.from({ length: k }, () => s[crypto.randomInt(s.length)]).join('');
  return `${pick(a, 4)}-${pick(n, 4)}`;
}

/**
 * Failed attempts, per email, in memory. Resets when the instance recycles,
 * which is acceptable: it blunts guessing without pretending to be a real
 * distributed rate limiter.
 */
const attempts = new Map<string, { n: number; until: number }>();

export function throttled(email: string): number {
  const a = attempts.get(email.toLowerCase());
  if (!a) return 0;
  if (Date.now() > a.until) { attempts.delete(email.toLowerCase()); return 0; }
  return a.n >= 5 ? Math.ceil((a.until - Date.now()) / 1000) : 0;
}

export function noteFailure(email: string) {
  const k = email.toLowerCase();
  const a = attempts.get(k) ?? { n: 0, until: 0 };
  a.n += 1;
  a.until = Date.now() + (a.n >= 5 ? 15 * 60_000 : 10 * 60_000);
  attempts.set(k, a);
}

export function clearFailures(email: string) { attempts.delete(email.toLowerCase()); }
