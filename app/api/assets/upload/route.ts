import { NextRequest, NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { MAX_VIDEO_BYTES, MAX_IMAGE_BYTES, inspectImage, inspectVideo, storeVideo, sealMedia, removeVideo } from '@/lib/media';
import { createHash } from 'node:crypto';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer /,'');
  if (!token) return NextResponse.json({error:'Sign in to upload media'},{status:401});
  const length = Number(req.headers.get('content-length'));
  if (!length || length > MAX_VIDEO_BYTES + 65536) return NextResponse.json({error:'Maximum upload size is 25 MB'},{status:413});
  let stored: any;
  try {
    const form = await req.formData(), file = form.get('file'), creativeId = String(form.get('creative_id') || '');
    const permission = await handle('GET',['creative',creativeId,'asset'],new URLSearchParams(),{},token);
    if ((permission.status || 200) >= 400) return NextResponse.json(permission.body,{status:permission.status});
    if (!(file instanceof File) || !file.size || file.size > MAX_VIDEO_BYTES) return NextResponse.json({error:'Select a video up to 25 MB or a still image up to 10 MB'},{status:400});
    const formats: Record<string, 'mp4' | 'webm' | 'png' | 'jpg' | 'webp'> = {'video/mp4':'mp4','video/webm':'webm','image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
    const ext = Object.hasOwn(formats,file.type) ? formats[file.type] : undefined;
    if (!ext) return NextResponse.json({error:'Use MP4 / WebM video or static PNG / JPEG / WebP images'},{status:400});
    const image = ext === 'png' || ext === 'jpg' || ext === 'webp';
    if (image && file.size > MAX_IMAGE_BYTES) return NextResponse.json({error:'Maximum image size is 10 MB'},{status:413});
    const bytes = Buffer.from(await file.arrayBuffer()), inspected = image ? await inspectImage(bytes,ext) : {...await inspectVideo(bytes,ext),media_type:'video'};
    stored = await storeVideo(bytes,permission.body.org_id,ext);
    const asset = {...stored,...inspected,org_id:permission.body.org_id,creative_id:creativeId,sha256:createHash('sha256').update(bytes).digest('hex'),created_at:new Date().toISOString()};
    const result = await handle('POST',['creative',creativeId,'asset'],new URLSearchParams(),{proof:sealMedia(asset,'upload')},token);
    if ((result.status || 200)>=400) await removeVideo(stored.storage_path);
    return NextResponse.json(result.body,{status:result.status || 201});
  } catch(e) {
    if (stored) await removeVideo(stored.storage_path).catch(()=>undefined);
    const message = e instanceof Error ? e.message : 'Media upload failed';
    return NextResponse.json({error: /Video must|Image |Animated images|Use H.264|File contents|configured/.test(message) ? message : 'Could not verify or store this file. Try a valid video or still image.'},{status:400});
  }
}
