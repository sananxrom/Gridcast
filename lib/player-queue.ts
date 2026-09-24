/** Durable telemetry only. This does not cache or promise offline YouTube playback. */
export type QueuedPlay = { key: string; device_id: string; event: Record<string, any>; created_at: number; attempts: number; next_attempt: number; error?: string; blocked?: boolean };
let opening: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise((resolve, reject) => {
    const r = indexedDB.open('gridcast-player-v1', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('plays', { keyPath: 'key' });
      r.result.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onerror = () => { opening = undefined; reject(r.error); };
    r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); opening = undefined; }; resolve(r.result); };
  });
  return opening;
}
function done(tx: IDBTransaction) { return new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error || new Error('Queue transaction aborted')); }); }
function result<T>(r: IDBRequest<T>) { return new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
export async function queuedPlays(deviceId?: string): Promise<QueuedPlay[]> {
  const db = await open(), tx = db.transaction('plays', 'readonly');
  const rows = await result<QueuedPlay[]>(tx.objectStore('plays').getAll());
  return rows.filter(p => !deviceId || p.device_id === deviceId).sort((a, b) => a.event.seq_no - b.event.seq_no);
}
export async function enqueuePlay(deviceId: string, event: Record<string, any>, limit = 5000): Promise<void> {
  const db = await open();
  const tx = db.transaction(['plays', 'meta'], 'readwrite'), completion = done(tx), plays = tx.objectStore('plays'), meta = tx.objectStore('meta');
  const key = deviceId + ':' + event.play_uid;
  const countRequest = plays.getAll();
  let failure: Error | undefined;
  countRequest.onsuccess = () => {
    const mine = (countRequest.result || []).filter((r: QueuedPlay) => r.device_id === deviceId).length;
    if (mine >= Math.max(1, Math.min(5000, limit))) { failure = new Error('Telemetry queue is full. Playback stopped to protect delivery records.'); tx.abort(); return; }
    const old = plays.get(key);
    old.onsuccess = () => {
      if (old.result) return;
      const last = meta.get('sequence:' + deviceId);
      last.onsuccess = () => {
        const seq = (last.result?.value || 0) + 1;
        meta.put({ key: 'sequence:' + deviceId, value: seq });
        plays.add({ key, device_id: deviceId, event: { ...event, seq_no: seq }, created_at: Date.now(), attempts: 0, next_attempt: 0 });
      };
    };
  };
  try { await completion; } catch (e) { throw failure || e; }
}
async function save(row: QueuedPlay, remove = false) {
  const db = await open(), tx = db.transaction('plays', 'readwrite'), completion = done(tx);
  if (remove) tx.objectStore('plays').delete(row.key); else tx.objectStore('plays').put(row);
  await completion;
}
export async function queueStatus(deviceId: string) {
  const all = await queuedPlays(deviceId);
  return { pending: all.filter(p => !p.blocked).length, blocked: all.filter(p => p.blocked).length, total: all.length };
}
export async function queueCapacity(deviceId: string, limit = 5000) {
  return (await queuedPlays(deviceId)).length < Math.max(1, Math.min(5000, limit));
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
