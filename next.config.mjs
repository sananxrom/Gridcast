import { fileURLToPath } from 'node:url';
/** @type {import('next').NextConfig} */
// Non-indexable product: noindex on every response, including /api and static assets.
export const noindexHeaders = async () => [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }];

export default {
  headers: noindexHeaders,
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  serverExternalPackages: ['ffprobe-static'],
  outputFileTracingIncludes: { '/api/assets/upload': ['./node_modules/ffprobe-static/bin/linux/x64/*','./node_modules/ffprobe-static/bin/darwin/x64/*','./node_modules/ffprobe-static/bin/darwin/arm64/*'] },
  images: { remotePatterns: [{ protocol: 'https', hostname: 'i.ytimg.com' }] },
};
