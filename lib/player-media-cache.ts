/** Uploaded media only. YouTube remains online-only. Allowances are consumed before playback. */
type MediaItem = { assignment_id: string; valid_until: string; duration_s: number; max_plays?: number; kind?: string; youtube_id?: string; asset_id?: string; asset_url?: string; asset_sha256?: string; asset_bytes?: number; asset_mime?: string; media_type?: string; width?: number; height?: number };
let opening: Promise<IDBDatabase> | undefined;
function open() {
  if (!opening) opening = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('gridcast-media-v1', 1);
    r.onupgradeneeded = () => { for (const name of ['media', 'schedules', 'allowances']) r.result.createObjectStore(name, { keyPath: 'key' }); };
    r.onerror = () => { opening = undefined; reject(r.error); };
    r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); opening = undefined; }; resolve(r.result); };
  });
  return opening;
}
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error || new Error('Offline storage unavailable')); });
const result = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const keyFor = (i: MediaItem) => i.asset_id && i.asset_sha256 ? `${i.asset_id}:${i.asset_sha256}` : null;
async function row(store: string, key: string) { const db = await open(); return result<any>(db.transaction(store).objectStore(store).get(key)); }
const downloads = new Map<string, Promise<void>>();
export async function cacheMedia(item: MediaItem): Promise<boolean> {
  const key = keyFor(item);
  if (item.youtube_id || !key || !item.asset_url || !Number.isSafeInteger(item.asset_bytes) || item.asset_bytes! <= 0) return false;
  if ((await row('media', key))?.blob) return true;
  if (!downloads.has(key)) downloads.set(key, (async () => {
    const response = await fetch(item.asset_url!, { credentials: 'omit' });
    if (!response.ok) throw new Error('Media download failed');
    const blob = await response.blob();
    if (blob.size !== item.asset_bytes) throw new Error('Incomplete media download');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(n => n.toString(16).padStart(2, '0')).join('');
    if (digest !== item.asset_sha256!.toLowerCase()) throw new Error('Media checksum did not match');
    const db = await open(), tx = db.transaction('media', 'readwrite'), complete = done(tx);
    tx.objectStore('media').put({ key, blob: blob.slice(0, blob.size, item.asset_mime || blob.type) }); await complete;
  })().finally(() => downloads.delete(key)));
  await downloads.get(key); return true;
}
export async function cachedMediaUrl(item: MediaItem): Promise<string | null> {
  const key = keyFor(item); if (!key) return null;
  const saved = await row('media', key); return saved?.blob ? URL.createObjectURL(saved.blob) : null;
}
export async function saveReadySchedule(deviceId: string, playlist: any, offset: number): Promise<boolean> {
  const isUploaded = (i: MediaItem) => !i.youtube_id && !!keyFor(i);
  playlist = { ...playlist, items: playlist.items.filter(isUploaded), filler_items: (playlist.filler_items || []).filter(isUploaded) };
  const items: MediaItem[] = [...playlist.items, ...playlist.filler_items];
  if (!items.length) return false;
  if (!(await Promise.all(items.map(cacheMedia))).every(Boolean)) return false;
  const until = Math.min(...items.map(i => Date.parse(i.valid_until)));
  if (!Number.isFinite(until) || until <= Date.now() + offset) return false;
  const db = await open(), tx = db.transaction('schedules', 'readwrite'), complete = done(tx);
  const store = tx.objectStore('schedules'), previous = store.get(deviceId);
  previous.onsuccess = () => {
    if (Date.parse(previous.result?.playlist?.server_time || '') > Date.parse(playlist.server_time)) return;
    store.put({ key: deviceId, playlist, offset, until, saved: Date.now() });
  };
  await complete;
  void navigator.storage?.persist?.().catch(() => false);
  return true;
}
export async function readySchedule(deviceId: string) {
  const saved = await row('schedules', deviceId);
  if (!saved || Date.now() < saved.saved - 1000 || Date.now() + saved.offset >= saved.until) return null;
  const items: MediaItem[] = [...saved.playlist.items, ...(saved.playlist.filler_items || [])];
  for (const item of items) if (!(await row('media', keyFor(item)!))?.blob) return null;
  return saved;
}
/** IDB serializes this transaction across tabs; reloads never reset an assignment's use count. */
export async function reserveLocalPlay(deviceId: string, item: MediaItem, now: number): Promise<boolean> {
  const cap = item.max_plays;
  if (!Number.isSafeInteger(cap) || cap! <= 0 || now + item.duration_s * 1000 > Date.parse(item.valid_until)) return false;
  const db = await open(), tx = db.transaction('allowances', 'readwrite'), complete = done(tx), store = tx.objectStore('allowances');
  const key = `${deviceId}:${item.assignment_id}`, read = store.get(key); let allowed = false;
  read.onsuccess = () => {
    const used = Number(read.result?.used || 0);
    if (used >= cap!) return;
    store.put({ key, used: used + 1, until: item.valid_until }); allowed = true;
  };
  await complete; return allowed;
}
export async function clearReadySchedule(deviceId: string) {
  const db = await open(), tx = db.transaction('schedules', 'readwrite'), complete = done(tx);
  tx.objectStore('schedules').delete(deviceId); await complete;
}
