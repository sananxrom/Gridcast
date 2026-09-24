import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';

/** Lookups are hints only. Authentication and authorization still run inside fn. */
export type StoreContext = {
  method: string; path: string[]; uid?: string; deviceId?: string; loginEmail?: string;
  pairingCodeHash?: string; playUid?: string; seqNo?: number; assignmentId?: string;
};
export class StoreError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const DOMAIN = ['orgs', 'users', 'screens', 'advertisers', 'creatives', 'campaigns', 'groups', 'devices', 'configs', 'assets'] as const;
const EVENTS = ['plays', 'presence', 'device_assignments'] as const;
const COLLECTIONS = [...DOMAIN, ...EVENTS];
const DOMAIN_LIMIT = 2000;
export const HISTORY_LIMIT = 1500;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const emailKey = (email: string) => hash(email.trim().toLowerCase());
export const sequenceKey = (deviceId: string, seq: number) => hash(`${deviceId}\0${seq}`);
export const playKey = (deviceId: string, playUid: string) => `play_${hash(`${deviceId}\0${playUid}`)}`;
const clone = (value: any) => JSON.parse(JSON.stringify(value));
const keyFor = (collection: string, row: any): string => collection === 'presence' ? row.play_id : row.id;
function validId(id: any): id is string { return typeof id === 'string' && id.length > 0 && id.length <= 500 && !id.includes('/'); }
function blank() {
  return Object.fromEntries([...COLLECTIONS.map(c => [c, []]), ['frames', []], ['settings', {}]]);
}
function clean(value: any): any {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && !Number.isFinite(value)) throw new StoreError(400, 'Numbers must be finite');
  if (Array.isArray(value)) return value.map(v => v === undefined ? null : clean(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([,v]) => v !== undefined).map(([k,v]) => [k, clean(v)]));
  return value;
}
function rowsByKey(collection: string, rows: any[]) {
  const map = new Map<string, any>();
  for (const row of rows) {
    const key = keyFor(collection, row);
    if (!validId(key) || map.has(key)) throw new StoreError(400, `Invalid or duplicate ${collection} ID`);
    map.set(key, clean(row));
  }
  return map;
}
type Session = {
  tx: Transaction; snapshot: any; original: any; dirty: boolean; provisioned: boolean;
  allowedOrg?: string; admin: boolean; readOnly: boolean;
};

/**
 * Core queries are deliberately used here: every authorization read and its writes
 * must share a retriable server transaction. Pipeline reads cannot be mixed into
 * that transaction as an independent nontransactional prefetch.
 * This bounded compatibility layer is not an all-history analytics repository.
 */
export function createFirestoreStore(database: Firestore) {
  const storage = new AsyncLocalStorage<Session>();
  const doc = (collection: string, id: string) => database.collection(collection).doc(id);
  async function readDoc(tx: Transaction, collection: string, id?: string) {
    if (!validId(id)) return null;
    const snap = await tx.get(doc(collection, id));
    return snap.exists ? snap.data()! : null;
  }
  async function query(tx: Transaction, collection: string, filters: [string, any, any][] = [], limit = DOMAIN_LIMIT) {
    let q: any = database.collection(collection);
    for (const [key, op, value] of filters) q = q.where(key, op, value);
    const result: any = await tx.get(q.limit(limit + 1));
    if (result.docs.length > limit) throw new StoreError(503, `${collection} requires pagination before it can be changed safely`);
    return result.docs.map((d: any) => d.data());
  }
  async function referenced(tx: Transaction, collection: string, ids: any[], into: any[]) {
    const seen = new Set(into.map(row => keyFor(collection, row)));
    const missing = [...new Set(ids)].filter(id => validId(id) && !seen.has(id));
    if (missing.length > DOMAIN_LIMIT) throw new StoreError(503, 'Too many related records');
    // Avoid giant getAll requests and respect transaction read-before-write ordering.
    for (let i = 0; i < missing.length; i += 100) {
      const snapshots = await tx.getAll(...missing.slice(i, i + 100).map(id => doc(collection, id as string)));
      for (const snapshot of snapshots) if (snapshot.exists) into.push(snapshot.data());
    }
  }
  async function load(tx: Transaction, context: StoreContext): Promise<Session> {
    const snapshot: any = blank();
    const marker = await readDoc(tx, '_meta', 'schema');
    const state: Session = { tx, snapshot, original: null, dirty: false, provisioned: !!marker,
      admin: false, readOnly: false };
    if (!marker) { state.original = clone(snapshot); return state; }
    if (marker.schema_version !== 1) throw new StoreError(503, 'Unsupported database schema');
    let actor: any = null, device: any = null, pairedScreen: any = null;
    if (context.uid && context.path[0] !== 'login') actor = await readDoc(tx, 'users', context.uid);
    if (!actor && context.loginEmail) {
      const email = context.loginEmail.trim().toLowerCase();
      const reservation = await readDoc(tx, '_unique_emails', emailKey(email));
      if (reservation?.user_id) actor = await readDoc(tx, 'users', reservation.user_id);
      // Supports explicitly imported accounts while the unique reservation is backfilled.
      if (!actor) {
        const users = await query(tx, 'users', [['email', '==', email]], 1);
        actor = users[0] || null;
      }
      if (actor && actor.email?.trim().toLowerCase() !== email) actor = null;
    }
    if (context.deviceId) device = await readDoc(tx, 'devices', context.deviceId);
    if (context.pairingCodeHash) {
      const matches = await query(tx, 'screens', [['pairing_code_hash', '==', context.pairingCodeHash]], 1);
      pairedScreen = matches[0] || null;
    }
    state.allowedOrg = actor?.org_id || device?.org_id || pairedScreen?.org_id;
    state.admin = actor?.role === 'platform_admin';
    const orgId = state.allowedOrg;
    const authOnly = ['login', 'me', 'password', 'logout'].includes(context.path[0]);
    const health = context.path.join('/') === '_health';
    if (actor) snapshot.users.push(actor);
    if (orgId) {
      const organisation = await readDoc(tx, 'orgs', orgId);
      if (organisation) snapshot.orgs.push(organisation);
    }
    if (health || (!orgId && !state.admin)) {
      state.readOnly = true;
    } else if (!authOnly) {
      const deviceRequest = !!device || !!pairedScreen;
      for (const collection of DOMAIN) {
        if (collection === 'orgs') {
          if (state.admin) snapshot.orgs = await query(tx, 'orgs');
          continue;
        }
        if (deviceRequest && collection === 'users') continue;
        if (collection === 'configs') {
          snapshot.configs = state.admin ? await query(tx, 'configs') : [
            ...await query(tx, 'configs', [['org_id', '==', orgId]]),
            ...await query(tx, 'configs', [['layer', '==', 'platform']]),
          ];
          snapshot.configs = [...new Map(snapshot.configs.map((c: any) => [c.id, c])).values()];
          continue;
        }
        const filters: [string, any, any][] = state.admin ? [] : [['org_id', '==', orgId]];
        if (deviceRequest && collection === 'screens') {
          const screen = pairedScreen || await readDoc(tx, 'screens', device.screen_id);
          snapshot.screens = screen && screen.org_id === orgId ? [screen] : [];
          continue;
        }
        if (deviceRequest && collection === 'campaigns') filters.push(['screen_ids', 'array-contains', pairedScreen?.id || device.screen_id]);
        if (deviceRequest && collection === 'devices') filters.push(['screen_id', '==', pairedScreen?.id || device.screen_id]);
        if (deviceRequest && ['advertisers', 'creatives', 'assets'].includes(collection)) continue;
        if (actor?.role === 'advertiser_viewer' && collection === 'campaigns') filters.push(['advertiser_id', '==', actor.advertiser_id || '__none__']);
        snapshot[collection] = await query(tx, collection, filters);
      }
      if (context.assignmentId) {
        await referenced(tx, 'device_assignments', [context.assignmentId], snapshot.device_assignments);
        const assignment = snapshot.device_assignments.find((a: any) => a.device_id === device?.id && a.org_id === orgId);
        // Offline events retain the issued campaign even if targeting changed later.
        if (assignment && !snapshot.campaigns.some((c: any) => c.id === assignment.campaign_id)) {
          const campaign = await readDoc(tx, 'campaigns', assignment.campaign_id);
          if (campaign?.org_id === orgId) snapshot.campaigns.push(campaign);
        }
      }
      await referenced(tx, 'advertisers', snapshot.campaigns.map((c: any) => c.advertiser_id), snapshot.advertisers);
      await referenced(tx, 'creatives', snapshot.campaigns.flatMap((c: any) => c.creative_ids || []), snapshot.creatives);
      await referenced(tx, 'assets', snapshot.creatives.flatMap((c: any) =>
        [...(c.assets || []), ...(c.variants || [])].map((a: any) => a.asset_id).filter(Boolean)), snapshot.assets);
      if (state.admin) snapshot.settings = await readDoc(tx, 'settings', 'platform') || {};
      else {
        // Config revision is operational metadata; other platform settings remain private.
        const settings = await readDoc(tx, 'settings', 'platform');
        for (const key of ['config_revision', 'blocked_categories', 'category_blocklist'])
          if (settings?.[key] !== undefined) snapshot.settings[key] = settings[key];
      }
      if (device && context.playUid) await referenced(tx, 'plays', [playKey(device.id, context.playUid)], snapshot.plays);
      if (device && Number.isSafeInteger(context.seqNo)) {
        const sequence = await readDoc(tx, '_device_sequences', sequenceKey(device.id, context.seqNo!));
        if (sequence?.play_id) await referenced(tx, 'plays', [sequence.play_id], snapshot.plays);
      }
      // Device writes do not reread growing event history. Human reporting is bounded.
      if (!deviceRequest && context.method === 'GET' && ['bootstrap', 'screen', 'campaign'].includes(context.path[0])) {
        let q: any = database.collection('plays');
        let scope = state.admin ? 'platform' : 'organisation';
        if (!state.admin) q = q.where('org_id', '==', orgId);
        if (context.path[0] === 'screen' && context.path[1]) { q = q.where('screen_id', '==', context.path[1]); scope = 'screen'; }
        if (context.path[0] === 'campaign' && context.path[1]) { q = q.where('campaign_id', '==', context.path[1]); scope = 'campaign'; }
        if (actor?.role === 'advertiser_viewer') q = q.where('advertiser_id', '==', actor.advertiser_id || '__none__');
        const result: any = await tx.get(q.orderBy('ended_at', 'desc').limit(HISTORY_LIMIT + 1));
        const rows: any[] = result.docs.map((d: any) => d.data());
        rows.sort((a, b) => String(b.ended_at).localeCompare(String(a.ended_at)));
        const truncated = rows.length > HISTORY_LIMIT;
        snapshot.plays = rows.slice(0, HISTORY_LIMIT).reverse();
        snapshot.history = { limit: HISTORY_LIMIT, returned: snapshot.plays.length, truncated,
          scope, oldest_at: snapshot.plays[0]?.ended_at || null, complete: !truncated };
        await referenced(tx, 'presence', snapshot.plays.map((p: any) => p.id), snapshot.presence);
      }
    }
    state.original = clone(snapshot);
    return state;
  }

  async function flush(state: Session) {
    if (!state.dirty) return;
    if (!state.provisioned || state.readOnly) throw new StoreError(403, 'This database context cannot write');
    const { snapshot, original, tx } = state;
    if ((snapshot.frames || []).length) throw new StoreError(400, 'Camera frames are not stored in Firestore');
    const changes: { collection: string; key: string; before?: any; after?: any }[] = [];
    for (const collection of COLLECTIONS) {
      const before = rowsByKey(collection, original[collection] || []);
      const after = rowsByKey(collection, snapshot[collection] || []);
      if (collection === 'plays') for (const [key, row] of after) if (!before.has(key)) {
        const campaign = snapshot.campaigns.find((c: any) => c.id === row.campaign_id);
        if (campaign) row.advertiser_id = campaign.advertiser_id;
      }
      for (const key of new Set([...before.keys(), ...after.keys()])) {
        const a = before.get(key), b = after.get(key);
        if (JSON.stringify(a) === JSON.stringify(b)) continue;
        if ((EVENTS as readonly string[]).includes(collection) && a) throw new StoreError(409, 'Recorded evidence is append-only');
        const rowOrg = collection === 'orgs' ? (b || a).id : (b || a).org_id;
        if (!state.admin && rowOrg !== state.allowedOrg) throw new StoreError(403, 'Cross-organisation write rejected');
        if (!state.admin && a?.org_id && b?.org_id !== undefined && a.org_id !== b.org_id)
          throw new StoreError(403, 'Organisation reassignment rejected');
        if (collection === 'configs' && !state.admin && (a?.layer === 'platform' || b?.layer === 'platform'))
          throw new StoreError(403, 'Platform configuration requires a platform administrator');
        changes.push({ collection, key, before: a, after: b });
      }
    }
    const changedSettings = JSON.stringify(snapshot.settings) !== JSON.stringify(original.settings);
    if (changes.length > 400) throw new StoreError(413, 'Split this operation into smaller batches');
    // Complete every additional uniqueness read before the first write.
    const emailChanges = changes.filter(c => c.collection === 'users' && c.after?.email !== c.before?.email);
    const emailReservations = new Map<string, any>();
    const localEmails = new Map<string, string>();
    for (const change of emailChanges) {
      for (const email of [change.before?.email, change.after?.email].filter(Boolean)) {
        const key = emailKey(email);
        if (!emailReservations.has(key)) emailReservations.set(key, await readDoc(tx, '_unique_emails', key));
      }
      if (change.after) {
        const email = String(change.after.email || '').trim().toLowerCase();
        if (!email.includes('@') || change.after.email !== email) throw new StoreError(400, 'Use a normalized email address');
        const key = emailKey(email), reservation = emailReservations.get(key);
        if (reservation && reservation.user_id !== change.key) throw new StoreError(409, 'That email already has a login');
        if (localEmails.has(key) && localEmails.get(key) !== change.key) throw new StoreError(409, 'That email already has a login');
        localEmails.set(key, change.key);
        const duplicates = await query(tx, 'users', [['email', '==', email]], 2);
        if (duplicates.some((u: any) => u.id !== change.key)) throw new StoreError(409, 'That email already has a login');
      }
    }
    const sequences = new Map<string, string>();
    const newRows = changes.filter(c => !c.before && c.after);
    for (const change of newRows) {
      // create() also guards against unseen documents outside this request's snapshot.
      if (change.collection !== 'plays') continue;
      const play = change.after;
      if (play.device_id && play.play_uid && change.key !== playKey(play.device_id, play.play_uid))
        throw new StoreError(400, 'Play ID does not match its device event');
      if (play.device_id && Number.isSafeInteger(play.seq_no)) {
        const key = sequenceKey(play.device_id, play.seq_no);
        const existing = await readDoc(tx, '_device_sequences', key);
        if ((existing && existing.play_id !== change.key) || (sequences.has(key) && sequences.get(key) !== change.key))
          throw new StoreError(409, 'Device sequence has already been recorded');
        sequences.set(key, change.key);
      }
    }
    let settings: any;
    if (changedSettings) {
      settings = await readDoc(tx, 'settings', 'platform') || {};
      const oldRevision = original.settings?.config_revision;
      const nextRevision = snapshot.settings?.config_revision;
      if (!state.admin && [...new Set([...Object.keys(snapshot.settings || {}), ...Object.keys(original.settings || {})])]
        .some(k => k !== 'config_revision' && JSON.stringify(snapshot.settings?.[k]) !== JSON.stringify(original.settings?.[k])))
        throw new StoreError(403, 'Platform settings require a platform administrator');
      settings = state.admin ? clean(snapshot.settings) : { ...settings, config_revision: nextRevision };
      if (nextRevision !== oldRevision && (!Number.isSafeInteger(nextRevision) || nextRevision !== (oldRevision || 0) + 1))
        throw new StoreError(400, 'Config revision must increase by one');
    }
    if (changes.length + emailChanges.length * 2 + sequences.size + Number(changedSettings) > 450)
      throw new StoreError(413, 'Split this operation into smaller batches');
    for (const change of changes) {
      const ref = doc(change.collection, change.key);
      if (!change.after) tx.delete(ref);
      else if (!change.before) tx.create(ref, change.after);
      else tx.set(ref, change.after);
    }
    for (const change of emailChanges) {
      if (change.before?.email && change.before.email !== change.after?.email) {
        const key = emailKey(change.before.email);
        if (emailReservations.get(key)?.user_id === change.key && !localEmails.has(key)) tx.delete(doc('_unique_emails', key));
      }
      if (change.after) tx.set(doc('_unique_emails', emailKey(change.after.email)), { user_id: change.key });
    }
    for (const [key, play_id] of sequences) tx.set(doc('_device_sequences', key), { play_id });
    if (changedSettings) tx.set(doc('settings', 'platform'), settings);
  }
  return {
    async transact<T>(context: StoreContext, fn: () => Promise<T>): Promise<T> {
      return database.runTransaction(async tx => {
        const state = await load(tx, context);
        return storage.run(state, async () => {
          const result = await fn();
          // Failed API requests can never commit partially staged mutations.
          if (!result || typeof result !== 'object' || !('status' in result) || Number((result as any).status || 200) < 400)
            await flush(state);
          return result;
        });
      });
    },
    async read() {
      const state = storage.getStore();
      if (!state) throw new StoreError(503, 'Firestore access requires a request transaction');
      return state.provisioned ? state.snapshot : null;
    },
    async write(snapshot: any) {
      const state = storage.getStore();
      if (!state) throw new StoreError(503, 'Firestore access requires a request transaction');
      state.snapshot = snapshot; state.dirty = true;
    },
    /** Explicit initial provisioning; never called by a request or automatic seed. */
    async provision(initial: any) {
      const data = clean(initial);
      if (!data.users?.some((u: any) => u.role === 'platform_admin' && u.password_hash && u.password_salt))
        throw new StoreError(400, 'A provisioned platform administrator is required');
      if (EVENTS.some(c => (data[c] || []).length) || (data.frames || []).length)
        throw new StoreError(400, 'Initial provisioning cannot import synthetic events or camera frames');
      await database.runTransaction(async tx => {
        if (await readDoc(tx, '_meta', 'schema')) throw new StoreError(409, 'Database is already provisioned');
        for (const collection of [...COLLECTIONS, 'settings', '_unique_emails', '_device_sequences']) {
          if ((await query(tx, collection, [], 1)).length) throw new StoreError(409, 'Provisioning requires an empty database');
        }
        const entries: [string, string, any][] = [];
        const emails = new Set<string>();
        for (const collection of DOMAIN) for (const [key, value] of rowsByKey(collection, data[collection] || [])) {
          if (await readDoc(tx, collection, key)) throw new StoreError(409, 'Initial records already exist');
          entries.push([collection, key, value]);
          if (collection === 'users') {
            if (value.email !== value.email?.trim().toLowerCase() || !value.email.includes('@')) throw new StoreError(400, 'Invalid email');
            const email = emailKey(value.email);
            if (emails.has(email) || await readDoc(tx, '_unique_emails', email)) throw new StoreError(409, 'Email already reserved');
            emails.add(email); entries.push(['_unique_emails', email, { user_id: key }]);
          }
        }
        if (entries.length > 400) throw new StoreError(413, 'Initial provisioning is too large');
        for (const [collection, key, value] of entries) tx.create(doc(collection, key), value);
        tx.create(doc('settings', 'platform'), { config_revision: 0, ...(data.settings || {}) });
        tx.create(doc('_meta', 'schema'), { schema_version: 1, provisioned_at: new Date().toISOString() });
      });
    },
  };
}

let runtime: ReturnType<typeof createFirestoreStore> | undefined;
export async function firestoreStore() {
  if (!runtime) {
    const { getApps, initializeApp, applicationDefault } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const app = getApps().find(a => a.name === 'gridcast-storage') || initializeApp({
      credential: applicationDefault(), projectId: process.env.GC_FIREBASE_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'gridcast-508011',
    }, 'gridcast-storage');
    runtime = createFirestoreStore(getFirestore(app, process.env.GC_FIRESTORE_DATABASE || 'gridcast'));
  }
  return runtime;
}
