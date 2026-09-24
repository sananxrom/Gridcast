import { fileURLToPath } from 'node:url';
/** @type {import('next').NextConfig} */
export default {
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  serverExternalPackages: ['ffprobe-static'],
  outputFileTracingIncludes: { '/api/assets/upload': ['./node_modules/ffprobe-static/bin/linux/x64/*','./node_modules/ffprobe-static/bin/darwin/x64/*','./node_modules/ffprobe-static/bin/darwin/arm64/*'] },
  images: { remotePatterns: [{ protocol: 'https', hostname: 'i.ytimg.com' }] },
};
