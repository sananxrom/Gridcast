import { NextRequest, NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { MAX_VIDEO_BYTES, inspectVideo, storeVideo, sealMedia, removeVideo } from '@/lib/media';
import { createHash } from 'node:crypto';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer /,'');
  if (!token) return NextResponse.json({error:'Sign in to upload a video'},{status:401});
  const length = Number(req.headers.get('content-length'));
  if (!length || length > MAX_VIDEO_BYTES + 65536) return NextResponse.json({error:'Maximum video size is 25 MB'},{status:413});
  let stored: any;
  try {
    const form = await req.formData(), file = form.get('file'), creativeId = String(form.get('creative_id') || '');
    const permission = await handle('GET',['creative',creativeId,'asset'],new URLSearchParams(),{},token);
    if ((permission.status || 200) >= 400) return NextResponse.json(permission.body,{status:permission.status});
    if (!(file instanceof File) || !file.size || file.size > MAX_VIDEO_BYTES) return NextResponse.json({error:'Select an MP4 or WebM video up to 25 MB'},{status:400});
    const ext = file.type === 'video/mp4' ? 'mp4' : file.type === 'video/webm' ? 'webm' : null;
    if (!ext) return NextResponse.json({error:'Only MP4 and WebM videos are supported'},{status:400});
    const bytes = Buffer.from(await file.arrayBuffer()), inspected = await inspectVideo(bytes,ext);
    stored = await storeVideo(bytes,permission.body.org_id,ext);
    const asset = {...stored,...inspected,org_id:permission.body.org_id,creative_id:creativeId,sha256:createHash('sha256').update(bytes).digest('hex'),created_at:new Date().toISOString()};
    const result = await handle('POST',['creative',creativeId,'asset'],new URLSearchParams(),{proof:sealMedia(asset,'upload')},token);
    if ((result.status || 200)>=400) await removeVideo(stored.storage_path);
    return NextResponse.json(result.body,{status:result.status || 201});
  } catch(e) {
    if (stored) await removeVideo(stored.storage_path).catch(()=>undefined);
    const message = e instanceof Error ? e.message : 'Video upload failed';
    return NextResponse.json({error: /Video must|Use H.264|File contents|configured/.test(message) ? message : 'Could not verify or store this video. Try a valid MP4 or WebM.'},{status:400});
  }
}
