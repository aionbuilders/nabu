import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from './helpers/test.js';
import { collectErrors } from './helpers/model.js';

// Launch sweep: EVERY page of the sitemap, at 375 and 1440, in dark and light. Each must render an h1, raise no console / page error,
// answer no 4xx/5xx for its own assets, and never scroll sideways. Plus the sitemap and robots.txt themselves, and the 404 page.
test.use({ domInvariant: false });

const SHOTS = '/tmp/claude-1000/-home-killiandvcz-workspace--aionbuilders-nabu/80c82aab-d2d3-4d76-9871-9dafb82b36a2/scratchpad/site-shots';
const SITE = 'https://nabu.aion.builders';

/** `page.goto` that tries again when Chromium reports `net::ERR_NETWORK_CHANGED` or lands on its error page, which also shows as a navigation interrupted by another one (the host's network reset, a WSL2 / laptop flake: see helpers/editor.ts). */
async function gotoRetry(page: Page, path: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await page.goto(path, { waitUntil: 'load' });
    } catch (e: any) {
      if (attempt >= 6 || !/ERR_NETWORK_CHANGED|chrome-error:|interrupted by another navigation/.test(String(e?.message))) throw e;
      await page.waitForTimeout(500);
    }
  }
}

async function sitemapPaths(request: any): Promise<string[]> {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  return locs.map((loc) => {
    expect(loc.startsWith(SITE), loc).toBe(true);
    return loc.slice(SITE.length) || '/';
  });
}

test.describe('sitemap and robots', () => {
  test('the sitemap lists the real pages, once each, and nothing that is gone', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.headers()['content-type']).toContain('xml');
    const paths = await sitemapPaths(request);
    expect(new Set(paths).size).toBe(paths.length);
    for (const must of ['/', '/docs', '/docs/getting-started/installation', '/docs/guides/persistence-and-sync', '/docs/getting-started/tour-of-the-blocks', '/changelog', '/api', '/api/internals', '/labs', '/labs/performance', '/architecture', '/architecture/limits', '/architecture/decisions', '/architecture/others', '/brand']) {
      expect(paths, must).toContain(must);
    }
    expect(paths.some((p) => p.startsWith('/api/root/'))).toBe(true);
    expect(paths.some((p) => /^\/architecture\/chapters\/[a-z0-9-]+$/.test(p))).toBe(true);
    expect(paths.some((p) => /^\/architecture\/decisions\/\d{3}$/.test(p))).toBe(true);
    expect(paths.some((p) => p.startsWith('/playground'))).toBe(false);
    expect(paths.length).toBeGreaterThan(60);
  });

  test('robots.txt points at the sitemap', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  test('the social card exists and is a 1200x630 PNG', async ({ request }) => {
    const res = await request.get('/og.png');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
    const body = await res.body();
    expect(body.readUInt32BE(16)).toBe(1200); // IHDR width
    expect(body.readUInt32BE(20)).toBe(630); // IHDR height
  });

  test('the head declares the card: og:image, twitter:card summary_large_image, one canonical', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', `${SITE}/og.png`);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', SITE);
  });
});

for (const scheme of ['dark', 'light'] as const) {
  for (const width of [375, 1440] as const) {
    test.describe(`every page, ${width}px, ${scheme}`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height: width === 375 ? 800 : 900 } });

      test('renders an h1, no console error, no failed request, no horizontal scroll', async ({ page, request }) => {
        test.setTimeout(600_000);
        const paths = await sitemapPaths(request);
        const errors = collectErrors(page);
        const failed: string[] = [];
        page.on('response', (r) => {
          if (r.status() >= 400 && r.url().startsWith(new URL(page.url() === 'about:blank' ? SITE : page.url()).origin)) failed.push(`${r.status()} ${r.url()}`);
        });
        const problems: string[] = [];
        for (const path of paths) {
          errors.list().length = 0;
          failed.length = 0;
          const res = await gotoRetry(page, path);
          if (res?.status() !== 200) problems.push(`${path}: status ${res?.status()}`);
          const h1 = await page.locator('h1').count();
          if (h1 < 1) problems.push(`${path}: no h1`);
          // let the client hydrate and settle before measuring (editors mount on the client)
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(150);
          const over = await page.evaluate(() => {
            const d = document.documentElement;
            return d.scrollWidth - d.clientWidth;
          });
          if (over > 0) problems.push(`${path}: horizontal scroll (+${over}px)`);
          for (const e of errors.list()) problems.push(`${path}: ${e}`);
          for (const f of failed) problems.push(`${path}: ${f}`);
        }
        expect(problems, `${paths.length} pages checked`).toEqual([]);
      });
    });
  }
}

test.describe('404 page', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });

  test('an unknown URL answers 404 with the site shell, a way home and a way to the docs', async ({ page }) => {
    const res = await page.goto('/this/page/does-not-exist');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nobody has crossed here.');
    await expect(page.locator('header')).toHaveCount(1);
    await expect(page.locator('footer')).toHaveCount(1);
    await expect(page.getByTestId('error-page').getByRole('link', { name: 'Back to the home page' })).toHaveAttribute('href', '/');
    await expect(page.getByTestId('error-page').getByRole('link', { name: 'Read the docs' })).toHaveAttribute('href', '/docs');
    await expect(page).toHaveTitle('Page not found — Nabu');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    mkdirSync(SHOTS, { recursive: true });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${SHOTS}/launch-404.png` });
  });

  test('a missing page inside a section (a doc that does not exist) is the same 404, and the shell still works', async ({ page }) => {
    const res = await page.goto('/docs/guides/nope');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nobody has crossed here.');
    await page.getByTestId('error-page').getByRole('link', { name: 'Read the docs' }).click();
    await expect(page).toHaveURL(/\/docs$/);
  });

  test('375px: no horizontal scroll, even with a long URL', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/a-very-long-path-that-goes-on-and-on-without-any-break-to-test-the-wrapping-of-the-page-address-on-a-phone');
    await expect(page.getByTestId('error-page')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test.describe('home page', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });

  test('the proofs are true and every link goes to a page that exists', async ({ page, request }) => {
    await page.goto('/');
    const proofs = page.getByTestId('proofs');
    await expect(proofs).toBeVisible();
    await expect(page.getByTestId('proof-merge')).toContainText('Saved as you type');
    await expect(page.getByTestId('proof-merge').getByRole('link')).toHaveAttribute('href', '/docs/guides/persistence-and-sync');
    await expect(page.getByTestId('proof-tests').getByRole('link')).toHaveAttribute('href', /github\.com\/aionbuilders\/nabu\/tree\/main\/tests$/);
    for (const link of await proofs.getByRole('link').all()) {
      const href = (await link.getAttribute('href'))!;
      if (href.startsWith('#')) await expect(page.locator(href), href).toHaveCount(1);
      else if (href.startsWith('/')) expect((await request.get(href)).status(), href).toBe(200);
    }
    mkdirSync(SHOTS, { recursive: true });
    await page.getByTestId('proofs').scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${SHOTS}/launch-home-proofs.png`, fullPage: true });
  });

  test('the header has no search button any more', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /search/i })).toHaveCount(0);
    await expect(page.getByText('⌘K')).toHaveCount(0);
  });
});
