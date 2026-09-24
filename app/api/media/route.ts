import { NextRequest } from 'next/server';
import { openMedia, readVideo } from '@/lib/media';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const grant = openMedia(req.nextUrl.searchParams.get('grant') || '', 'read');
  if (!grant || !Number.isSafeInteger(grant.bytes) || grant.bytes < 1) return new Response(null,{status:403});
  const range = req.headers.get('range'), match = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
  if (range && !match) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${grant.bytes}`}});
  const start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]),grant.bytes-1) : grant.bytes-1;
  if (start > end || start < 0 || end >= grant.bytes) return new Response(null,{status:416});
  try {
    const bytes = await readVideo(grant,start,end);
    return new Response(new Uint8Array(bytes),{status:range?206:200,headers:{'Content-Type':grant.mime,'Content-Length':String(bytes.length),'Accept-Ranges':'bytes','Cache-Control':'private,max-age=60','X-Content-Type-Options':'nosniff',...(range?{'Content-Range':`bytes ${start}-${end}/${grant.bytes}`}:{})}});
  } catch { return new Response(null,{status:404}); }
}
