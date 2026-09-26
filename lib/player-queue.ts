/** Durable telemetry only. This does not cache or promise offline YouTube playback. */
export type QueuedPlay = { key: string; device_id: string; event: Record<string, any>; created_at: number; attempts: number; next_attempt: number; error?: string; blocked?: boolean; capacity_padding?: string };
type PlayReservation = { key: string; device_id: string; play_uid: string; created_at: number; expires_at: number; capacity_padding: string };
const MAX_QUEUE = 5000;
export const RETAINED_RECORD_LIMIT = MAX_QUEUE;
const RESERVATION_MS = 120_000;
const RESERVATION_PADDING = 8192;
const MAX_EVENT_BYTES = 4096;
const storageFull = 'Delivery storage is full. Saved records remain on this device; new playback is paused until capacity is available.';
let opening: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise((resolve, reject) => {
    const r = indexedDB.open('gridcast-player-v1', 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('plays')) r.result.createObjectStore('plays', { keyPath: 'key' });
      if (!r.result.objectStoreNames.contains('meta')) r.result.createObjectStore('meta', { keyPath: 'key' });
      if (!r.result.objectStoreNames.contains('reservations')) r.result.createObjectStore('reservations', { keyPath: 'key' });
    };
    r.onerror = () => { opening = undefined; reject(r.error); };
    r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); opening = undefined; }; resolve(r.result); };
  });
  return opening;
}
function done(tx: IDBTransaction) { return new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error || new Error('Queue transaction aborted')); }); }
function result<T>(r: IDBRequest<T>) { return new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
export async function queuedPlays(deviceId?: string): Promise<QueuedPlay[]> {
  await recoverExpiredReservations(deviceId);
  const db = await open(), tx = db.transaction('plays', 'readonly');
  const rows = await result<QueuedPlay[]>(tx.objectStore('plays').getAll());
  return rows.filter(p => !deviceId || p.device_id === deviceId).sort((a, b) => a.event.seq_no - b.event.seq_no);
}
function boundedLimit(limit: number) { return Math.max(1, Math.min(MAX_QUEUE, Math.floor(Number(limit) || MAX_QUEUE))); }
function jsonBytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function fitReservation<T extends Record<string, any>>(record: T, reservedBytes: number) {
  const empty = { ...record, capacity_padding: '' }, paddingBytes = reservedBytes - jsonBytes(empty);
  if (paddingBytes < 0) throw new Error('Delivery record exceeded its reserved storage.');
  return { ...record, capacity_padding: ' '.repeat(paddingBytes) };
}
function placeholder(reservation: PlayReservation): QueuedPlay {
  const row = { key: reservation.key, device_id: reservation.device_id, event: { play_uid: reservation.play_uid, ended_reason: 'interrupted', reservation_interrupted: true },
    created_at: reservation.created_at, attempts: 0, next_attempt: 0, error: 'Playback was interrupted before its delivery record was completed.', blocked: true };
  return fitReservation(row, jsonBytes(reservation));
}
async function recoverExpiredReservations(deviceId?: string) {
  const db = await open(), tx = db.transaction(['plays', 'reservations'], 'readwrite'), completion = done(tx);
  const plays = tx.objectStore('plays'), reservations = tx.objectStore('reservations');
  let rows: QueuedPlay[] | undefined, holds: PlayReservation[] | undefined;
  const recover = () => {
    if (!rows || !holds) return;
    const now = Date.now();
    for (const hold of holds) if ((!deviceId || hold.device_id === deviceId) && hold.expires_at <= now) {
      if (!rows.some(row => row.key === hold.key)) plays.put(placeholder(hold));
      reservations.delete(hold.key);
    }
  };
  const readRows = plays.getAll(), readHolds = reservations.getAll();
  readRows.onsuccess = () => { rows = readRows.result; recover(); };
  readHolds.onsuccess = () => { holds = readHolds.result; recover(); };
  await completion;
}
/** Persist a bounded storage reservation before media can start. IndexedDB serializes this
 * transaction across tabs; the same reserved bytes are retained with the eventual report. */
export async function reservePlay(deviceId: string, playUid: string, limit = MAX_QUEUE): Promise<boolean> {
  if (!deviceId?.trim() || !playUid || typeof playUid !== 'string') throw new Error('A delivery identity is required.');
  const db = await open(), tx = db.transaction(['plays', 'reservations'], 'readwrite'), completion = done(tx);
  const plays = tx.objectStore('plays'), reservations = tx.objectStore('reservations'), key = deviceId + ':' + playUid;
  let reserved = false, failed: Error | undefined, rows: QueuedPlay[] | undefined, holds: PlayReservation[] | undefined;
  const decide = () => {
    if (!rows || !holds) return;
    const duplicate = rows.some(row => row.key === key) || holds.some(row => row.key === key);
    if (duplicate) { reserved = true; return; }
    const mine = rows.filter(row => row.device_id === deviceId), active = holds.filter(row => row.device_id === deviceId);
    const pending = mine.filter(row => !row.blocked).length + active.length;
    const archiveUse = mine.length + active.length;
    if (pending >= boundedLimit(limit) || archiveUse >= MAX_QUEUE) return;
    const reservation: PlayReservation = { key, device_id: deviceId, play_uid: playUid, created_at: Date.now(), expires_at: Date.now() + RESERVATION_MS,
      capacity_padding: ' '.repeat(RESERVATION_PADDING) };
    try { reservations.add(reservation); reserved = true; } catch (error: any) { failed = error; tx.abort(); }
  };
  const readRows = plays.getAll(), readHolds = reservations.getAll();
  readRows.onsuccess = () => { rows = readRows.result; decide(); };
  readHolds.onsuccess = () => { holds = readHolds.result; decide(); };
  try { await completion; } catch (error: any) {
    if (failed) throw failed;
    if (error?.name === 'QuotaExceededError') throw new Error(storageFull);
    throw error;
  }
  void navigator.storage?.persist?.().catch(() => false);
  return reserved;
}
export async function touchPlayReservation(deviceId: string, playUid: string): Promise<boolean> {
  const db = await open(), tx = db.transaction('reservations', 'readwrite'), completion = done(tx), store = tx.objectStore('reservations'), key = deviceId + ':' + playUid;
  let touched = false;
  const request = store.get(key);
  request.onsuccess = () => { if (request.result?.device_id === deviceId) { store.put({ ...request.result, expires_at: Date.now() + RESERVATION_MS }); touched = true; } };
  await completion; return touched;
}
export async function releasePlayReservation(deviceId: string, playUid: string): Promise<void> {
  const db = await open(), tx = db.transaction('reservations', 'readwrite'), completion = done(tx), store = tx.objectStore('reservations'), key = deviceId + ':' + playUid;
  const request = store.get(key);
  request.onsuccess = () => { if (request.result?.device_id === deviceId) store.delete(key); };
  await completion;
}
export async function enqueuePlay(deviceId: string, event: Record<string, any>, limit = 5000): Promise<void> {
  const db = await open();
  if (jsonBytes(event) > MAX_EVENT_BYTES) throw new Error('Delivery record exceeded its reserved storage. Playback remains paused and the record was retained for retry.');
  const tx = db.transaction(['plays', 'meta', 'reservations'], 'readwrite'), completion = done(tx), plays = tx.objectStore('plays'), meta = tx.objectStore('meta'), reservations = tx.objectStore('reservations');
  const key = deviceId + ':' + event.play_uid;
  let failed: Error | undefined, rows: QueuedPlay[] | undefined, holds: PlayReservation[] | undefined, last: any;
  let rowsReady = false, holdsReady = false, sequenceReady = false, written = false;
  const write = () => {
    if (!rowsReady || !holdsReady || !sequenceReady || written || !rows || !holds) return;
    written = true;
    const old = rows.find(row => row.key === key), hold = holds.find(row => row.key === key);
    if (old && !old.event.reservation_interrupted) return;
    if (!hold && !old) {
      const mine = rows.filter(row => row.device_id === deviceId), active = holds.filter(row => row.device_id === deviceId);
      if (mine.filter(row => !row.blocked).length + active.length >= boundedLimit(limit) || mine.length + active.length >= MAX_QUEUE) {
        failed = new Error(storageFull); tx.abort(); return;
      }
    }
    const seq = (last?.value || 0) + 1;
    meta.put({ key: 'sequence:' + deviceId, value: seq });
    const createdAt = hold?.created_at ?? old?.created_at ?? Date.now();
    const next = { key, device_id: deviceId, event: { ...event, seq_no: old?.event?.seq_no || seq }, created_at: createdAt, attempts: 0, next_attempt: 0 };
    let saved: QueuedPlay;
    try { saved = hold ? fitReservation(next, jsonBytes(hold)) : old ? fitReservation(next, jsonBytes(old)) : { ...next, capacity_padding: ' '.repeat(RESERVATION_PADDING) }; }
    catch (error: any) { failed = error; tx.abort(); return; }
    plays.put(saved);
    if (hold) reservations.delete(key);
  };
  const readRows = plays.getAll(), readHolds = reservations.getAll(), readSeq = meta.get('sequence:' + deviceId);
  readRows.onsuccess = () => { rows = readRows.result; rowsReady = true; write(); };
  readHolds.onsuccess = () => { holds = readHolds.result; holdsReady = true; write(); };
  readSeq.onsuccess = () => { last = readSeq.result; sequenceReady = true; write(); };
  try { await completion; } catch (error) { throw failed || error; }
}
async function save(row: QueuedPlay, remove = false) {
  const db = await open(), tx = db.transaction('plays', 'readwrite'), completion = done(tx);
  if (remove) tx.objectStore('plays').delete(row.key); else tx.objectStore('plays').put(row);
  await completion;
}
export async function queueStatus(deviceId: string) {
  const all = await queuedPlays(deviceId);
  const db = await open(), tx = db.transaction('reservations', 'readonly'), holds = await result<PlayReservation[]>(tx.objectStore('reservations').getAll());
  const reserved = holds.filter(row => row.device_id === deviceId).length;
  return { pending: all.filter(p => !p.blocked).length, blocked: all.filter(p => p.blocked).length, reserved, total: all.length + reserved };
}
export async function queueCapacity(deviceId: string, limit = 5000) {
  const all = await queuedPlays(deviceId), status = await queueStatus(deviceId);
  return status.pending + status.reserved < boundedLimit(limit) && all.length + status.reserved < MAX_QUEUE;
}
/** Records left behind by an earlier pairing can never be delivered under the new device identity.
 *  They stay readable through the export button, but they no longer count against this device. */
export async function strandedPlays(deviceId: string): Promise<QueuedPlay[]> {
  return (await queuedPlays()).filter(p => p.device_id !== deviceId);
}
const flushing = new Set<string>();
export async function flushPlays(deviceId: string, send: (event: any) => Promise<{ status: number; error?: string }>, batch = 25, retryHours = 72): Promise<void> {
  if (flushing.has(deviceId)) return;
  flushing.add(deviceId);
  try {
    const rows = await queuedPlays(deviceId);
    for (const row of rows.filter(r => !r.blocked && r.next_attempt <= Date.now()).slice(0, Math.max(1, Math.min(100, batch)))) {
      if (Date.now() - row.created_at > Math.min(72, Math.max(1, retryHours)) * 3600e3) {
        await save({ ...row, blocked: true, error: 'Delivery window expired; record retained for review.' }); continue;
      }
      try {
        const reply = await send(row.event);
        if (reply.status >= 200 && reply.status < 300) { await save(row, true); continue; }
        if (reply.status === 401) throw new Error('Device authorization expired. Re-pair required.');
        if (reply.status >= 400 && reply.status < 500 && reply.status !== 429) {
          await save({ ...row, blocked: true, error: reply.error || `Server rejected this record (${reply.status}).` }); continue;
        }
        throw new Error(reply.error || 'Server unavailable');
      } catch (e: any) {
        await save({ ...row, attempts: row.attempts + 1, error: String(e.message || e), next_attempt: Date.now() + Math.min(300e3, 1000 * 2 ** Math.min(row.attempts, 8)) + Math.floor(Math.random() * 1000) });
        break;
      }
    }
  } finally { flushing.delete(deviceId); }
}
