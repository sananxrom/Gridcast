import type { MetadataRoute } from 'next';

// Crawling stays allowed on purpose: a crawler blocked by robots.txt never fetches the page,
// so it would never see the noindex header (next.config.mjs) or meta tag (app/layout.tsx).
// Indexing is prevented by noindex, not by robots.txt. This is not access control.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: '/' } };
}
