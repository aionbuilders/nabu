import { SITE_URL } from '../../site/url.js';

// Prerendered, so that the sitemap URL comes from the same constant as everything else (src/site/url.js).
export const prerender = true;

export function GET() {
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'max-age=3600' },
  });
}
