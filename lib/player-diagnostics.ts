/** Diagnostic evidence is separate from commercial delivery and billing.
 * Per device: at most 32 entries / 2 MiB; every claimed run reserves 64 KiB before start.
 * Nothing is evicted. Expired reservations remain as interrupted-run evidence, with their
 * space reserved for a late completion. IndexedDB serializes mutations across player tabs. */
export const DIAGNOSTIC_LIMITS = { records: 32, bytes: 2 * 1024 * 1024, reportBytes: 64 * 1024, reservationMs: 120000 } as const;
type Report = { event: any; created_at: number; blocked?: boolean; error?: string };
type Reservation = { run_uid: string; created_at: number; expires_at: number; interrupted?: boolean; padding: string };
type Envelope = { device: string; version: 1; reports: Report[]; reservations: Reservation[]; legacy?: string };
const legacyKey = (device: string) => 'gc_diagnostic_result:' + device;
const waiting = 'Diagnostic result saved on this device; waiting for connection.';
const storageError = 'Diagnostic storage is full or unavailable. Saved evidence remains on this device; new screen tests need authorized review.';
let opening: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open('gridcast-diagnostics-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('devices', { keyPath: 'device' });
    request.onerror = () => { opening = undefined; reject(request.error || new Error(storageError)); };
    request.onblocked = () => { opening = undefined; reject(new Error('Diagnostic storage is busy in another player tab.')); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = undefined; };
      resolve(db);
    };
  });
  return opening;
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const validRun = (value: any): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
function validReport(row: any): row is Report {
  return !!row && typeof row === 'object' && !!row.event && typeof row.event === 'object' && validRun(row.event.run_uid)
    && Number.isFinite(row.created_at) && (row.blocked === undefined || typeof row.blocked === 'boolean')
    && (row.error === undefined || typeof row.error === 'string');
}
function validate(value: any, device: string): Envelope {
  if (!value || value.device !== device || value.version !== 1 || !Array.isArray(value.reports) || !Array.isArray(value.reservations)
    || !value.reports.every(validReport) || !value.reservations.every((r: any) => r && validRun(r.run_uid) && Number.isFinite(r.created_at)
      && Number.isFinite(r.expires_at) && typeof r.padding === 'string' && (r.interrupted === undefined || typeof r.interrupted === 'boolean'))
    || (value.legacy !== undefined && typeof value.legacy !== 'string')) throw new Error('Diagnostic storage could not be read. Existing evidence has been preserved.');
  const ids = [...value.reports.map((r: Report) => r.event.run_uid), ...value.reservations.map((r: Reservation) => r.run_uid)];
  if (new Set(ids).size !== ids.length) throw new Error('Diagnostic storage contains conflicting run identities. Existing evidence has been preserved.');
  return value;
}
function sweep(state: Envelope) {
  const now = Date.now();
  for (const row of state.reports) if (!row.blocked && now - row.created_at > 864e5) {
    row.blocked = true; row.error = 'Diagnostic report expired; saved locally for review.';
  }
  for (const reservation of state.reservations) if (reservation.expires_at <= now) reservation.interrupted = true;
}
/** A single transaction imports legacy evidence and applies a mutation. The old key is
 * removed only after commit and only if it still holds the exact imported value. */
async function mutate<T>(device: string, change: (state: Envelope) => T): Promise<T> {
  if (typeof device !== 'string' || !device.trim()) throw new Error('A diagnostic device identity is required.');
  const db = await open();
  const tx = db.transaction('devices', 'readwrite'), store = tx.objectStore('devices');
  let result: T, failure: unknown, imported: string | null = null;
  const completion = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error(storageError));
  });
  const request = store.get(device);
  request.onsuccess = () => {
    try {
      const state: Envelope = request.result === undefined ? { device, version: 1, reports: [], reservations: [] } : validate(request.result, device);
      imported = localStorage.getItem(legacyKey(device));
      if (imported !== null && imported !== state.legacy) {
        let row: Report;
        try { row = JSON.parse(imported); } catch { throw new Error('The saved diagnostic report could not be read. It has been preserved.'); }
        if (!validReport(row)) throw new Error('The saved diagnostic report is invalid. It has been preserved.');
        const existing = state.reports.find(r => r.event.run_uid === row.event.run_uid);
        if (existing && (JSON.stringify(existing.event) !== JSON.stringify(row.event) || existing.created_at !== row.created_at))
          throw new Error('Saved diagnostic reports conflict. Both stores have been preserved.');
        if (!existing) {
          state.reservations = state.reservations.filter(r => r.run_uid !== row.event.run_uid);
          state.reports.push(row);
        }
        // Retain the exact import marker until legacy removal succeeds, including crash/reload.
        state.legacy = imported;
      }
      sweep(state);
      result = change(state);
      store.put(state);
    } catch (error) { failure = error; tx.abort(); }
  };
  await completion;
  // A failed remove is harmless: the persisted import marker prevents duplicate import.
  if (imported !== null) try { if (localStorage.getItem(legacyKey(device)) === imported) localStorage.removeItem(legacyKey(device)); } catch {}
  return result!;
}
function occupied(state: Envelope) { return state.reports.some(r => !r.blocked) || state.reservations.some(r => !r.interrupted); }
function checkCapacity(state: Envelope) {
  if (state.reports.length + state.reservations.length > DIAGNOSTIC_LIMITS.records || bytes(state) > DIAGNOSTIC_LIMITS.bytes) throw new Error(storageError);
}
export async function pendingDiagnostic(device: string): Promise<Report | null> {
  return mutate(device, state => state.reports.find(r => !r.blocked) || null);
}
export async function reserveDiagnostic(device: string, runUid: string): Promise<void> {
  if (!validRun(runUid)) throw new Error('Invalid diagnostic run identity.');
  await mutate(device, state => {
    if (state.reservations.some(r => r.run_uid === runUid && !r.interrupted)) return;
    if (state.reports.some(r => r.event.run_uid === runUid) || state.reservations.some(r => r.run_uid === runUid)) throw new Error('This diagnostic run identity was already used.');
    if (occupied(state)) throw new Error('A previous screen test is running or still waiting to deliver its report.');
    // Actual persisted padding makes capacity reservation more than an in-memory estimate.
    state.reservations.push({ run_uid: runUid, created_at: Date.now(), expires_at: Date.now() + DIAGNOSTIC_LIMITS.reservationMs, padding: ' '.repeat(DIAGNOSTIC_LIMITS.reportBytes) });
    checkCapacity(state);
  });
}
/** Release only when the server definitely did not start this run, never after an uncertain response. */
export async function releaseDiagnosticReservation(device: string, runUid: string): Promise<void> {
  await mutate(device, state => { state.reservations = state.reservations.filter(r => r.run_uid !== runUid); });
}
export async function saveDiagnostic(device: string, event: any): Promise<void> {
  if (!event || !validRun(event.run_uid)) throw new Error('Invalid diagnostic run identity.');
  await mutate(device, state => {
    const old = state.reports.find(r => r.event.run_uid === event.run_uid);
    if (old) {
      if (JSON.stringify(old.event) !== JSON.stringify(event)) throw new Error('A different result is already saved for this diagnostic run.');
      return;
    }
    const reservation = state.reservations.find(r => r.run_uid === event.run_uid);
    if (!reservation) throw new Error('Diagnostic storage was not reserved before this screen test.');
    const row: Report = { event, created_at: Date.now() };
    if (bytes(row) > DIAGNOSTIC_LIMITS.reportBytes) throw new Error('Diagnostic result exceeds its reserved storage. The run reservation has been preserved.');
    state.reservations = state.reservations.filter(r => r.run_uid !== event.run_uid);
    state.reports.push(row);
    checkCapacity(state);
  });
}
export async function diagnosticRecordCounts(device: string) {
  return mutate(device, state => ({ pending: state.reports.filter(r => !r.blocked).length, blocked: state.reports.filter(r => r.blocked).length,
    reserved: state.reservations.length, total: state.reports.length + state.reservations.length }));
}
/** Internal scoped accessor for future authorized maintenance; no public export is exposed here. */
export async function retainedDiagnostics(device: string) {
  return mutate(device, state => ({ reports: state.reports.filter(r => r.blocked), interrupted: state.reservations.filter(r => r.interrupted)
    .map(({ padding: _padding, ...record }) => record) }));
}
export async function flushDiagnostic(device: string, send: (body: any) => Promise<{ status: number; value: any }>): Promise<string | null> {
  const row = await pendingDiagnostic(device);
  if (!row) return null;
  let response: { status: number; value: any };
  try { response = await send(row.event); } catch { return waiting; }
  const accepted = response.status >= 200 && response.status < 300 && response.value?.ok === true;
  const rejected = response.status >= 400 && response.status < 500 && response.status !== 429;
  if (!accepted && !rejected) return waiting;
  const error = typeof response.value?.error === 'string' ? response.value.error : 'Diagnostic result rejected; saved locally for review.';
  const changed = await mutate(device, state => {
    // A concurrent acknowledgement/rejection may already have finished this run. Compare
    // the complete snapshot; an old callback must never touch a newly saved result.
    const index = state.reports.findIndex(r => JSON.stringify(r) === JSON.stringify(row));
    if (index === -1) return false;
    if (accepted) state.reports.splice(index, 1);
    else { state.reports[index] = { ...row, blocked: true, error }; checkCapacity(state); }
    return true;
  });
  return changed ? accepted ? 'Diagnostic result saved. Counts are excluded from commercial reports.' : error : null;
}
