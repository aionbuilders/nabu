// @ts-nocheck  (build-time script, not part of the library nor of the type-checked site)
/**
 * Generates the social card, `static/og.png` (1200x630): `node scripts/og-image.js` (or `bun scripts/og-image.js`).
 *
 * An HTML page built from the brand assets (night background, the dark lockup of brand/nabu-logo-dark.svg), set in the fonts the site
 * already ships (@fontsource/syne, @fontsource/inter, read from node_modules and inlined: no network, no Google Fonts), screenshotted
 * with Playwright's Chromium. Re-run it when the tagline or the brand changes, and commit the PNG.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'static/og.png');

const TAGLINE = 'Block editing, down to the last keystroke.';
const FACTS = 'Svelte 5 · CRDT · MIT';
const HOST = 'nabu.aion.builders';

const font = (family, weight, file) => {
  const data = readFileSync(resolve(ROOT, 'node_modules/@fontsource', file)).toString('base64');
  return `@font-face { font-family: '${family}'; font-weight: ${weight}; font-style: normal; src: url(data:font/woff2;base64,${data}) format('woff2'); }`;
};

// The lockup, as drawn by the brand (the SVG is used as is; only its size is set here).
const logo = readFileSync(resolve(ROOT, 'brand/nabu-logo-dark.svg'), 'utf8').replace('<svg ', '<svg width="480" ');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
${font('Syne', 700, 'syne/files/syne-latin-700-normal.woff2')}
${font('Inter', 500, 'inter/files/inter-latin-500-normal.woff2')}
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; background: #0B0B0C; overflow: hidden; }
.card { position: relative; width: 1200px; height: 630px; padding: 72px 88px 64px; display: flex; flex-direction: column; justify-content: space-between; color: #EDEDED; }
.card::before { content: ''; position: absolute; inset: 0; background: radial-gradient(900px 420px at 100% 0%, rgba(255, 111, 97, 0.16), transparent 70%); }
.card > * { position: relative; }
h1 { max-width: 1020px; font: 700 70px / 1.06 'Syne', sans-serif; letter-spacing: -0.02em; }
h1 em { font-style: normal; color: #FF6F61; white-space: nowrap; }
.foot { display: flex; align-items: baseline; justify-content: space-between; padding-top: 28px; border-top: 1px solid #2A2A2E; font: 500 28px / 1 'Inter', sans-serif; color: #A9A9AE; }
.foot .host { font-size: 24px; color: #7C7C82; }
</style></head><body>
<div class="card">
  ${logo}
  <h1>${TAGLINE.replace("last keystroke.", "<em>last keystroke.</em>")}</h1>
  <div class="foot"><span>${FACTS}</span><span class="host">${HOST}</span></div>
</div>
</body></html>`;

// A file URL rather than setContent: same-origin rules are not at play, and the page can be opened by hand to tweak it.
const dir = mkdtempSync(join(tmpdir(), 'nabu-og-'));
const page_file = join(dir, 'og.html');
writeFileSync(page_file, html);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(page_file).href);
  await page.evaluate(() => document.fonts.ready);
  const ok = await page.evaluate(() => document.fonts.check("700 20px Syne") && document.fonts.check("500 20px Inter"));
  if (!ok) throw new Error('og-image: the local fonts did not load');
  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log(`og-image: ${OUT} (${TAGLINE})`);
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
