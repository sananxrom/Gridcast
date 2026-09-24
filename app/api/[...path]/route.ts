import { NextRequest, NextResponse } from 'next/server';
import { handle } from '@/lib/api';

export const dynamic = 'force-dynamic';

async function run(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const token = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? null;
  // One throttle bucket per caller. Without this every pairing attempt on the platform shares one bucket,
  // so 20 wrong codes a minute would block installs everywhere.
  const clientKey = (req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || 'unknown').trim();
  const r = await handle(req.method, (await ctx.params).path, req.nextUrl.searchParams, body, token, clientKey);
  return NextResponse.json(r.body, { status: r.status ?? 200 });
}
export const GET = run;
export const POST = run;
