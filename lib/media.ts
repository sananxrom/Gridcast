import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertAuthConfigured } from './auth';
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
function key() { assertAuthConfigured(); const key = process.env.GC_AUTH_SECRET; if (!key || key.length < 32) throw new Error('Media requires GC_AUTH_SECRET with at least 32 characters'); return key; }
export function sealMedia(value: any, purpose: string, seconds = 900) {
  const payload = Buffer.from(JSON.stringify({ value, purpose, exp: Date.now() + seconds * 1000 })).toString('base64url');
  return payload + '.' + createHmac('sha256', key()).update('gridcast-media:' + payload).digest('base64url');
}
export function openMedia(token: string, purpose: string): any | null {
  try {
    const [payload,signature,...rest] = token.split('.'); if (rest.length || !payload || !signature || token.length > 12000) return null;
    const expected = createHmac('sha256', key()).update('gridcast-media:' + payload).digest(); const actual = Buffer.from(signature,'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual,expected)) return null;
    const data = JSON.parse(Buffer.from(payload,'base64url').toString());
    return data.purpose === purpose && data.exp > Date.now() ? data.value : null;
  } catch { return null; }
}
const mediaRoot = () => path.join(process.cwd(), 'data', 'media');
function safePath(storagePath: string) { if (!/^media\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(mp4|webm)$/.test(storagePath)) throw new Error('Invalid media path'); return storagePath; }
async function bucket() {
  const { getApps, initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getStorage } = await import('firebase-admin/storage');
  const app = getApps().find(a => a.name === 'gridcast-media') || initializeApp({ credential: applicationDefault(), projectId: process.env.GC_FIREBASE_PROJECT },'gridcast-media');
  return getStorage(app).bucket(process.env.GC_MEDIA_BUCKET);
}
export async function inspectVideo(buffer: Buffer, ext: 'mp4' | 'webm') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'gridcast-video-')); const file = path.join(dir,'input.'+ext);
  try {
    await fs.writeFile(file, buffer, { mode: 0o600 });
    const binary = process.env.GC_FFPROBE_PATH || require('ffprobe-static').path as string;
    const { stdout } = await promisify(execFile)(binary, ['-v','error','-protocol_whitelist','file','-show_streams','-show_format','-of','json',file], { timeout: 15000, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout), video = result.streams?.find((s: any)=>s.codec_type === 'video');
    const duration = Number(result.format?.duration || video?.duration), width = Number(video?.width), height = Number(video?.height);
    if (!(duration >= 1 && duration <= 600 && width >= 16 && height >= 16 && width <= 7680 && height <= 7680)) throw new Error('Video must be 1–600 seconds with valid dimensions');
    if (!['h264','vp8','vp9','av1'].includes(video.codec_name)) throw new Error('Use H.264, VP8, VP9 or AV1 video');
    if ((ext === 'webm' && !String(result.format?.format_name).includes('webm')) || (ext === 'mp4' && !String(result.format?.format_name).includes('mp4'))) throw new Error('File contents do not match its video format');
    return { duration_s: Math.round(duration * 1000)/1000, width, height, aspect: `${width}:${height}`, codec: video.codec_name, metadata_source: 'server_ffprobe' };
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
export async function storeVideo(buffer: Buffer, orgId: string, ext: 'mp4' | 'webm') {
  const id = 'asset_' + randomUUID(), storage_path = safePath(`media/${orgId}/${id}.${ext}`), mime = ext === 'mp4' ? 'video/mp4' : 'video/webm';
  if (process.env.GC_MEDIA_BUCKET) await (await bucket()).file(storage_path).save(buffer,{ resumable: false, contentType: mime, metadata:{ cacheControl:'private,max-age=900' }, preconditionOpts:{ ifGenerationMatch:0 } });
  else {
    if (process.env.NODE_ENV === 'production') throw new Error('Durable video storage is not configured');
    const file = path.join(mediaRoot(),storage_path); await fs.mkdir(path.dirname(file),{recursive:true}); await fs.writeFile(file,buffer,{flag:'wx',mode:0o600});
  }
  return { id, asset_id:id, storage_path, mime, bytes:buffer.length };
}
export async function removeVideo(storagePath: string) {
  safePath(storagePath);
  if (process.env.GC_MEDIA_BUCKET) await (await bucket()).file(storagePath).delete({ignoreNotFound:true});
  else await fs.rm(path.join(mediaRoot(),storagePath),{force:true});
}
export function mediaUrl(asset: any) { return '/api/media?grant=' + sealMedia({ storage_path: asset.storage_path, mime: asset.mime, bytes: asset.bytes },'read'); }
export async function readVideo(grant: any, start: number, end: number) {
  const storagePath = safePath(grant.storage_path);
  if (process.env.GC_MEDIA_BUCKET) {
    const [bytes] = await (await bucket()).file(storagePath).download({start,end}); return bytes;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Durable video storage is not configured');
  const file = await fs.open(path.join(mediaRoot(),storagePath),'r');
  try { const buffer = Buffer.alloc(end-start+1); const {bytesRead} = await file.read(buffer,0,buffer.length,start); return buffer.subarray(0,bytesRead); } finally { await file.close(); }
}
