import { mkdirSync } from 'node:fs';
import { test, expect } from './helpers/test.js';

// The brand identity page (/brand): src/routes/(site)/brand, src/site/brand. No editor on it.

const SHOTS = '/tmp/claude-1000/-home-killiandvcz-workspace--aionbuilders-nabu/80c82aab-d2d3-4d76-9871-9dafb82b36a2/scratchpad/site-shots';

const SECTIONS = [
  'One mark, three readings',
  'The lockup',
  'How it is built',
  'The mark alone',
  'Colour',
  'Type',
  'How we sound',
  'The ferryman',
  'Please don’t',
];

const HEX = ['#F04E31', '#FF6F61', '#C2381F', '#1A1A1A', '#F2F2F2', '#0B0B0C'];

const noHScroll = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('brand page', () => {
  test.use({ colorScheme: 'dark' });

  test('renders: H1, every section heading, metadata', async ({ page }) => {
    const res = await page.goto('/brand');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('The scribe’s mark');
    for (const name of SECTIONS) await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(SECTIONS.length);
    await expect(page).toHaveTitle('Brand · Nabu');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Nabu brand/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://nabu.aion.builders/brand');
    // the three readings
    for (const t of ['An N, in negative space', 'Quotation marks', 'Wedges in clay']) await expect(page.getByText(t, { exact: true })).toBeVisible();
    // the rules of the construction
    await expect(page.getByText('The gap between mark and word is 0.3 × the mark’s height.')).toBeVisible();
    await expect(page.getByTestId('construction')).toBeVisible();
    // the six misuse examples
    await expect(page.locator('.misuse figure')).toHaveCount(6);
  });

  test('is prerendered (the HTML carries the content before any script runs)', async ({ request }) => {
    const html = await (await request.get('/brand')).text();
    expect(html).toContain('The scribe’s mark');
    expect(html).toContain('<title>Brand · Nabu</title>');
    expect(html).toContain('rel="canonical" href="https://nabu.aion.builders/brand"');
    expect(html).toContain('5.4:1');
  });

  test('the logos are the real files: the page markup equals brand/*.svg', async ({ page, request }) => {
    await page.goto('/brand');
    for (const [id, file] of [['light', 'nabu-logo-light.svg'], ['dark', 'nabu-logo-dark.svg']] as const) {
      const served = await (await request.get(`/brand/files/${file}`)).text();
      const inline = await page.locator(`.tile.lockup.${id} svg`).evaluate((el) => el.querySelector('path:last-child')!.getAttribute('d'));
      expect(served).toContain(inline!);
    }
  });

  test('every download link returns 200 with the right type', async ({ page, request }) => {
    await page.goto('/brand');
    const links = page.locator('a[download]');
    const hrefs = await links.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')!));
    // 10 files: lockups 3 + mark + icons (5) + the source board, listed once each, plus the kit in the hero
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const name of ['nabu-logo-light.svg', 'nabu-logo-dark.svg', 'nabu-logo-mono.svg', 'nabu-mark.svg', 'nabu-icon.svg', 'nabu-icon-square.svg', 'nabu-icon-512.png', 'apple-touch-icon.png', 'favicon-32.png', 'nabu-brand-kit.zip']) {
      expect(hrefs, name).toContain(`/brand/files/${name}`);
    }
    for (const href of hrefs) {
      const res = await request.get(href);
      expect(res.status(), href).toBe(200);
      const type = res.headers()['content-type'];
      if (href.endsWith('.svg')) expect(type, href).toContain('image/svg+xml');
      if (href.endsWith('.png')) expect(type, href).toContain('image/png');
      if (href.endsWith('.zip')) expect(type, href).toContain('zip');
      expect((await res.body()).length, href).toBeGreaterThan(100);
    }
    // the kit is a real zip, and the download attribute names the file
    const zip = await (await request.get('/brand/files/nabu-brand-kit.zip')).body();
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    await expect(page.getByRole('link', { name: 'Download the kit (.zip)' })).toHaveAttribute('download', '');
    await expect(page.getByRole('link', { name: 'brand/ on GitHub' })).toHaveAttribute('href', 'https://github.com/aionbuilders/nabu/tree/main/brand');
    // an unknown file is a 404, not a path traversal
    expect((await request.get('/brand/files/nope.svg')).status()).toBe(404);
  });

  test('the download button really downloads', async ({ page }) => {
    await page.goto('/brand');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'nabu-logo-dark.svg' }).click()]);
    expect(download.suggestedFilename()).toBe('nabu-logo-dark.svg');
  });

  test('swatches: hex codes, and the copy buttons put them on the clipboard', async ({ page }) => {
    await page.goto('/brand');
    const palette = page.locator('.palette');
    for (const hex of HEX) await expect(palette.getByRole('button', { name: `Copy ${hex}` })).toBeVisible();
    await expect(palette.getByRole('button')).toHaveCount(HEX.length);
    for (const hex of HEX) {
      const button = palette.getByRole('button', { name: `Copy ${hex}` });
      await expect(button).toContainText(hex);
      await button.click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(hex);
      await expect(page.getByRole('status').filter({ hasText: `${hex} copied` })).toHaveCount(1);
    }
  });

  test('contrast ratios are the computed ones', async ({ page }) => {
    await page.goto('/brand');
    await expect(page.getByTestId('contrast-link')).toHaveText('5.4:1');
    await expect(page.getByTestId('contrast-pastel')).toHaveText('7.2:1');
    await expect(page.getByTestId('contrast-vif')).toHaveText('3.6:1');
  });

  test('accessibility: images are named or decorative, no external request', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.hostname !== 'localhost') external.push(r.url());
    });
    await page.goto('/brand');
    await page.evaluate(() => document.fonts.ready);
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll('main svg, main img')]
        .filter((el) => {
          if (el.closest('[aria-hidden="true"]') || el.getAttribute('aria-hidden') === 'true') return false;
          if (el instanceof HTMLImageElement) return el.getAttribute('alt') === null;
          return !(el.getAttribute('role') === 'img' && el.getAttribute('aria-label')) && !el.closest('svg[role="img"]:not(:scope)');
        })
        .map((el) => el.outerHTML.slice(0, 80))
    );
    expect(bad).toEqual([]);
    expect(external).toEqual([]);
  });

  test('desktop 1440: no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/brand');
    expect(await noHScroll(page)).toBe(true);
    // three columns for the readings and the lockups, six swatches on a row
    const xs = await page.locator('.palette > *').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(xs).size).toBe(1);
  });

  test('mobile 375: no horizontal scroll, grids collapse, the construction scrolls in its frame', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/brand');
    await page.evaluate(() => document.fonts.ready);
    expect(await noHScroll(page)).toBe(true);
    // the readings and the lockups stack
    for (const sel of ['#mark .grid3', '#logo .grid3']) {
      const tops = await page.locator(`${sel} > figure`).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      expect(new Set(tops).size, sel).toBe(3);
    }
    // two swatches per row
    const rows = await page.locator('.palette > *').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
    expect(rows).toBe(3);
    // nothing sticks out of the viewport, except inside the construction frame (which scrolls itself)
    const outside = await page.evaluate(() =>
      [...document.querySelectorAll('main *')]
        .filter((el) => !el.closest('.frame') && el.getBoundingClientRect().right > window.innerWidth + 0.5 && getComputedStyle(el).position !== 'fixed')
        .map((el) => `${el.tagName}.${el.className}`)
    );
    expect(outside).toEqual([]);
    const frame = page.getByRole('region', { name: /Construction drawing/ });
    const dims = await frame.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(dims.scroll).toBeGreaterThan(dims.client); // scrolls inside itself, legible, instead of shrinking
    expect(dims.client).toBeLessThanOrEqual(375);
    // its labels stay readable: the drawing is not scaled below ~0.75 (10.5 units -> >= 8px)
    const scale = await page.getByTestId('construction').evaluate((el) => el.getBoundingClientRect().width / 900);
    expect(scale).toBeGreaterThan(0.75);
    // copy buttons are tap targets
    const h = await page.getByRole('button', { name: 'Copy #F04E31' }).evaluate((el) => el.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(44);
  });

  test('footer: Brand is under Project, not in the top nav, and the link works', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Brand' })).toHaveCount(0);
    const link = page.locator('footer').getByRole('navigation', { name: 'Project' }).getByRole('link', { name: 'Brand', exact: true });
    await expect(link).toHaveAttribute('href', '/brand');
    await link.click();
    await expect(page).toHaveURL(/\/brand$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('The scribe’s mark');
    await expect(page.getByRole('navigation', { name: 'Main' }).locator('a[aria-current="page"]')).toHaveCount(0);
  });
});

test.describe('brand page themes', () => {
  const bg = (page: import('@playwright/test').Page, sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);

  test('dark: the page is night, the hero tile blends in', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto('/brand');
    expect(await bg(page, '.site')).toBe('rgb(11, 11, 12)');
    expect(await bg(page, '.hero-art')).toBe('rgba(0, 0, 0, 0)');
    await ctx.close();
  });

  test('light: page and text follow the theme, the dark tiles stay dark', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto('/brand');
    expect(await bg(page, '.site')).toBe('rgb(250, 250, 248)');
    expect(await bg(page, '.hero-art')).toBe('rgb(11, 11, 12)');
    expect(await bg(page, '.tile.lockup.dark')).toBe('rgb(20, 20, 22)');
    expect(await bg(page, '.tile.read2')).toBe('rgb(20, 20, 22)');
    expect(await bg(page, '.tile.bad')).toBe('rgb(20, 20, 22)');
    expect(await page.locator('.lead').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(85, 85, 91)');
    // the construction drawing follows the theme: the word is ink, not paper
    const word = await page.locator('[data-testid="construction"] .lockup .word').evaluate((el) => getComputedStyle(el).fill);
    expect(word).toBe('rgb(26, 26, 26)');
    await ctx.close();
  });

  test('toggle: an explicit choice wins over the system preference', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto('/brand');
    await page.getByTestId('theme-toggle').click(); // system -> dark
    await page.getByTestId('theme-toggle').click(); // -> light
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await bg(page, '.site')).toBe('rgb(250, 250, 248)');
    expect(await bg(page, '.hero-art')).toBe('rgb(11, 11, 12)');
    await ctx.close();
  });
});

test('screenshots of the brand page', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true });
  for (const [name, scheme, width, height] of [
    ['brand-1440-dark', 'dark', 1440, 900],
    ['brand-1440-light', 'light', 1440, 900],
    ['brand-375-dark', 'dark', 375, 812],
    ['brand-375-light', 'light', 375, 812],
  ] as const) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width, height } });
    const page = await ctx.newPage();
    await page.goto('/brand');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
    if (width === 375) {
      // readable crops of the sections that change most on a phone
      for (const id of ['mark', 'construction', 'icon', 'colour', 'misuse']) await page.locator(`#${id}`).screenshot({ path: `${SHOTS}/${name}-${id}.png` });
    }
    await ctx.close();
  }
});
