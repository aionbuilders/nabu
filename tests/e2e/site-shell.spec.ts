import { mkdirSync } from 'node:fs';
import { test, expect } from './helpers/test.js';

// The public website shell (src/site + src/routes/(site)): header, footer, theme, mobile menu.
// These pages have no editor: the editor DOM invariant fixture is a no-op here (no [data-nabu-root]).

const SHOTS = '/tmp/claude-1000/-home-killiandvcz-workspace--aionbuilders-nabu/80c82aab-d2d3-4d76-9871-9dafb82b36a2/scratchpad/site-shots';

const NAV = [
  ['Docs', '/docs'],
  ['API', '/api'],
  ['Labs', '/labs'],
  ['Architecture', '/architecture'],
  ['Changelog', '/changelog'],
] as const;

test.describe('site shell', () => {
  test.use({ colorScheme: 'dark' });

  test('/ renders the landmarks and the H1', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toHaveCount(1);
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('footer')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Every keystroke,\s*accounted for\./);
    await expect(page.getByText('A block editor whose truth is a CRDT.')).toBeVisible();
    const h1 = await page.getByRole('heading', { level: 1 }).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { size: cs.fontSize, weight: cs.fontWeight, family: cs.fontFamily };
    });
    expect(h1.size).toBe('76px');
    expect(h1.family).toContain('Syne');
    // fonts are self-hosted: Syne really loaded, no Google Fonts request
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('700 76px Syne'))).toBe(true);
    // the library theme CSS and the head from the root layout are still there
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
    await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute('href', /\/favicon\.svg$/);
  });

  test('requests no third-party font', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.hostname !== 'localhost') external.push(r.url());
    });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    expect(external).toEqual([]);
  });

  test('nav links point to the right routes and every stub renders', async ({ page }) => {
    await page.goto('/');
    for (const [label, href] of NAV) {
      await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label, exact: true })).toHaveAttribute('href', href);
    }
    await expect(page.getByRole('link', { name: /GitHub/ }).first()).toHaveAttribute('href', 'https://github.com/aionbuilders/nabu');
    for (const [label, href] of NAV) {
      const res = await page.goto(href);
      expect(res?.status(), href).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(label);
      await expect(page.getByText('Coming soon')).toBeVisible();
      await expect(page.locator('header')).toBeVisible();
      await expect(page.locator('footer')).toBeVisible();
      await expect(page).toHaveTitle(`${label} — Nabu`);
      // active item follows the route
      const current = page.getByRole('navigation', { name: 'Main' }).locator('a[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText(label);
    }
  });

  test('client-side navigation from the header works', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Labs', exact: true }).click();
    await expect(page).toHaveURL(/\/labs$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Labs');
  });

  test('footer has the three columns', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await expect(footer).toContainText('A block editor for the web, built on a CRDT.');
    await expect(footer).toContainText('MIT licensed. Built with Nabu.');
    for (const [col, links] of [
      ['Learn', ['Getting started', 'Guides', 'API reference']],
      ['Explore', ['Labs', 'Architecture', 'Roadmap']],
      ['Project', ['Changelog', 'GitHub', 'License']],
    ] as const) {
      const nav = footer.getByRole('navigation', { name: col });
      for (const l of links) await expect(nav.getByRole('link', { name: l, exact: true })).toBeVisible();
    }
  });

  test('theme toggle cycles dark / light / system and persists across reload', async ({ page }) => {
    await page.goto('/');
    const root = page.locator('html');
    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toHaveAttribute('data-mode', 'system');
    const bg = () => page.locator('.site').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg()).toBe('rgb(11, 11, 12)'); // system = dark here

    await toggle.click(); // system -> ... order is dark, light, system: from system the next is dark
    await expect(root).toHaveAttribute('data-theme', 'dark');
    await toggle.click();
    await expect(root).toHaveAttribute('data-theme', 'light');
    expect(await bg()).toBe('rgb(250, 250, 248)');
    expect(await page.evaluate(() => localStorage.getItem('nabu-site-theme'))).toBe('light');

    await page.reload();
    await expect(root).toHaveAttribute('data-theme', 'light'); // applied before paint, then confirmed by the toggle
    await expect(page.getByTestId('theme-toggle')).toHaveAttribute('data-mode', 'light');
    expect(await bg()).toBe('rgb(250, 250, 248)');

    await page.getByTestId('theme-toggle').click(); // -> system
    await expect(root).not.toHaveAttribute('data-theme', /.+/);
    expect(await page.evaluate(() => localStorage.getItem('nabu-site-theme'))).toBeNull();
  });

  test('system light preference is honoured when nothing is stored, explicit dark overrides it', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto('/');
    const bg = () => page.locator('.site').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg()).toBe('rgb(250, 250, 248)');
    await page.evaluate(() => localStorage.setItem('nabu-site-theme', 'dark'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await bg()).toBe('rgb(11, 11, 12)');
    await ctx.close();
  });

  test('skip link is first in the DOM and focuses main', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    expect(await page.evaluate(() => document.querySelector('.site')?.firstElementChild?.textContent)).toBe('Skip to content');
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
  });

  test('focus rings are visible (coral outline)', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab'); // skip link
    await page.keyboard.press('Tab'); // logo
    const outline = await page.evaluate(() => {
      const cs = getComputedStyle(document.activeElement as Element);
      return { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor };
    });
    expect(outline.style).toBe('solid');
    expect(outline.width).toBe('2px');
    expect(outline.color).toBe('rgb(255, 111, 97)');
  });

  test('desktop: no horizontal scroll, menu button hidden', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('#site-menu-button')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('tablet (760px, just above the mobile breakpoint): header fits', async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const box = await page.getByTestId('theme-toggle').boundingBox(); // last item of the bar
    expect(box!.x + box!.width).toBeLessThanOrEqual(760 - 16 + 0.5);
    const brand = await page.locator('header .brand').boundingBox();
    const github = await page.getByRole('link', { name: /GitHub/ }).first().boundingBox();
    expect(github!.x).toBeGreaterThan(brand!.x + brand!.width); // nothing wrapped onto / over the logo
  });

  test('mobile (375px): menu button opens the nav, no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/');
    const button = page.locator('#site-menu-button');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(nav).toBeHidden();
    const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(await noScroll()).toBe(true);

    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(nav).toBeVisible();
    for (const [label] of NAV) await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    expect(await noScroll()).toBe(true);
    // 16px side gutter
    const bar = await page.locator('header .brand').boundingBox();
    expect(bar!.x).toBe(16);

    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(nav).toBeHidden();

    await button.click();
    await nav.getByRole('link', { name: 'Docs', exact: true }).click();
    await expect(page).toHaveURL(/\/docs$/);
    await expect(button).toHaveAttribute('aria-expanded', 'false'); // closes on navigation
    expect(await noScroll()).toBe(true);
  });

  test('mobile: home, footer stacked, no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const learn = await page.locator('footer nav[aria-label="Learn"]').boundingBox();
    const explore = await page.locator('footer nav[aria-label="Explore"]').boundingBox();
    expect(explore!.y).toBeGreaterThan(learn!.y + learn!.height - 1); // stacked
  });

  test('/playground still renders the editor', async ({ page }) => {
    await page.goto('/playground');
    await expect(page.locator('[data-nabu-root]').first()).toBeVisible();
  });

  test('screenshots of the shell', async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true });
    for (const [name, scheme, width, height] of [
      ['home-1440-dark', 'dark', 1440, 900],
      ['home-1440-light', 'light', 1440, 900],
      ['home-375-dark', 'dark', 375, 812],
      ['home-375-light', 'light', 375, 812],
    ] as const) {
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width, height } });
      const page = await ctx.newPage();
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
      if (width === 375) {
        await page.locator('#site-menu-button').click();
        await page.screenshot({ path: `${SHOTS}/${name}-menu.png` });
      }
      await ctx.close();
    }
  });
});
