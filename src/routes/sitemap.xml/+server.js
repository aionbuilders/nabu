import { SITE_URL } from '../../site/url.js';
import { docsNav } from '../../site/docs/content.server.js';
import { allPages } from '../../site/api/model.server.js';
import { chapters } from '../../site/architecture/chapters.server.js';
import { records } from '../../site/architecture/adr.server.js';
import { adrHref } from '../../site/architecture/adr.js';

// Written once, at build time: the list is derived from the same models that draw the pages (docs navigation, API model, chapters,
// decision records), so a new page is in the sitemap without anyone remembering to add it.
export const prerender = true;

/** Pages that are neither generated nor listed in a model. */
const STATIC_PAGES = ['/', '/docs', '/changelog', '/api', '/api/internals', '/labs', '/labs/performance', '/architecture', '/architecture/decisions', '/architecture/limits', '/architecture/others', '/brand'];

/** @param {string} path */
const priority = (path) => {
  if (path === '/') return '1.0';
  if (path.split('/').length <= 2) return '0.8';
  return '0.6';
};

/** @param {string} s */
const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function GET() {
  const paths = [
    ...STATIC_PAGES,
    ...docsNav().order.map((p) => p.href),
    ...allPages().map((p) => `/api/${p.entry}/${p.name}`),
    ...chapters().map((c) => c.href),
    ...records().adrs.map((a) => adrHref(a.number)),
  ];
  const urls = [...new Set(paths)]
    .map((path) => `  <url>\n    <loc>${escapeXml(SITE_URL + (path === '/' ? '/' : path))}</loc>\n    <priority>${priority(path)}</priority>\n  </url>`)
    .join('\n');

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'max-age=3600' },
  });
}
