import { NextRequest, NextResponse } from 'next/server';
import { handle } from '@/lib/api';

export const dynamic = 'force-dynamic';

async function run(req: NextRequest, ctx: { params: { path: string[] } }) {
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const r = await handle(req.method, ctx.params.path, req.nextUrl.searchParams, body);
  return NextResponse.json(r.body, { status: r.status ?? 200 });
}
export const GET = run;
export const POST = run;
