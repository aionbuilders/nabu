import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from './helpers/test.js';
import { collectErrors } from './helpers/model.js';

// The Performance lab (src/site/PerfLab.svelte, route /labs/performance): a generated document of 1,000 / 5,000 / 10,000 blocks in a real
// editor, and the meter fed by the shared key-to-next-paint measure (src/site/measure.js). `?blocks=N` picks the size.
// 1 000+ blocks: the end-of-test DOM invariant check would only burn its cap on such a document.
test.use({ domInvariant: false });

const SHOTS = '/tmp/claude-1000/-home-killiandvcz-workspace--aionbuilders-nabu/80c82aab-d2d3-4d76-9871-9dafb82b36a2/scratchpad/site-shots';

const status = (page: Page) => page.getByTestId('lab-status');
const loaded = (page: Page) => page.getByTestId('lab-loaded');
const pane = (page: Page) => page.getByTestId('lab-editor').locator('[data-nabu-root]');
const numeric = /^\d+(\.\d)?|^<0\.1/;

async function openLab(page: Page, blocks: number) {
  await page.goto(`/labs/performance?blocks=${blocks}`);
  await expect(loaded(page)).toBeVisible({ timeout: 180_000 });
}

const TEXT = 'the quick brown fox jumps over the lazy dog again and again'; // 59 characters

/** Caret in the middle of the document, then `n` characters typed one by one. */
async function typeInMiddle(page: Page, n: number) {
  await page.getByTestId('lab-jump').click();
  await page.keyboard.type(TEXT.slice(0, n), { delay: 100 });
}

let errors: ReturnType<typeof collectErrors>;
test.beforeEach(async ({ page }) => { errors = collectErrors(page); });
test.afterEach(async () => { expect(errors.list(), 'console / page errors').toEqual([]); });

test.describe('performance lab', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 1440, height: 1000 } });

  test('the page: title, size control, meter at rest, "How we measure" closed', async ({ page }) => {
    await page.goto('/labs/performance?blocks=1000');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/10,000 blocks\.\s*One frame\./);
    await expect(page).toHaveTitle('Performance lab — Nabu');
    const radios = page.getByTestId('lab-sizes').getByRole('radio');
    await expect(radios).toHaveCount(3);
    await expect(page.getByTestId('lab-sizes')).toContainText('1,000');
    await expect(page.getByTestId('lab-sizes')).toContainText('5,000');
    await expect(page.getByTestId('lab-sizes')).toContainText('10,000');
    await expect(page.getByTestId('lab-last')).toContainText('—');
    await expect(page.getByTestId('lab-how')).not.toHaveAttribute('open', '');
    await expect(loaded(page)).toBeVisible({ timeout: 120_000 });
  });

  test('/labs lists the lab as the one available, no "Coming soon"', async ({ page }) => {
    await page.goto('/labs');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Labs');
    await expect(page.getByText('Coming soon')).toHaveCount(0);
    await page.getByTestId('lab-card-performance').click();
    await expect(page).toHaveURL(/\/labs\/performance$/);
  });

  test('1,000 then 10,000 blocks: load, type, the meter moves', async ({ page }) => {
    test.setTimeout(420_000);
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));

    // ── 1,000 blocks ──
    await page.goto('/labs/performance?blocks=1000');
    await expect(status(page)).toContainText(/Loading 1,000 blocks…|blocks loaded/, { timeout: 60_000 });
    await expect(loaded(page)).toContainText(/^1,0\d\d blocks loaded in /, { timeout: 120_000 });
    await expect(page.getByTestId('lab-size-1000')).toBeChecked();
    await expect(pane(page).locator('[data-block-id]').first()).toBeVisible();
    expect(await pane(page).locator('[data-block-id]').count()).toBeGreaterThanOrEqual(1000);

    await typeInMiddle(page, 30);
    await expect(page.getByTestId('lab-count')).toHaveText('30', { timeout: 20_000 });
    const ms = await page.getByTestId('lab-last').getAttribute('data-ms');
    expect(Number(ms)).toBeGreaterThan(0);
    await expect(page.getByTestId('lab-last')).toContainText(/\d/);
    await expect(page.getByTestId('lab-p50')).toHaveText(/^\d+(\.\d)? ms$|^<0\.1 ms$/);
    await expect(page.getByTestId('lab-p95')).toHaveText(/^\d+(\.\d)? ms$|^<0\.1 ms$/);
    await expect(page.getByTestId('lab-engine')).toContainText(/Engine work · p50 (\d+(\.\d)?|<0\.1) ms/);
    const pts = (await page.getByTestId('lab-spark-line').getAttribute('points'))!.trim().split(' ');
    expect(pts.length).toBe(30);
    for (const p of pts) expect(p).toMatch(/^[\d.]+,[\d.]+$/);
    // the typed text is in the document
    await expect(pane(page)).toContainText('the quick brown fox jumps over');

    // the sparkline keeps the last 60 keystrokes at most
    await typeInMiddle(page, 59);
    await expect(page.getByTestId('lab-count')).toHaveText('89', { timeout: 30_000 });
    expect((await page.getByTestId('lab-spark-line').getAttribute('points'))!.trim().split(' ').length).toBe(60);

    // ── 10,000 blocks: the meter resets with the new document ──
    await page.getByTestId('lab-size-10000').check();
    // (the "Loading 10,000 blocks…" state is on screen while the thread is busy: not observable from here, the page does not answer)
    await expect(loaded(page)).toContainText(/^10,\d\d\d blocks loaded in /, { timeout: 300_000 });
    await expect(page.getByTestId('lab-count')).toHaveText('0');
    expect(await pane(page).locator('[data-block-id]').count()).toBeGreaterThanOrEqual(10000);

    await typeInMiddle(page, 40);
    await expect(page.getByTestId('lab-count')).toHaveText('40', { timeout: 60_000 });
    expect(Number(await page.getByTestId('lab-last').getAttribute('data-ms'))).toBeGreaterThan(0);
    await expect(page.getByTestId('lab-p50')).toHaveText(/ms$/);
    expect(numeric.test((await page.getByTestId('lab-p95').textContent())!)).toBe(true);

    // ── How we measure ──
    const how = page.getByTestId('lab-how');
    await how.getByText('How we measure').click();
    await expect(how).toHaveAttribute('open', '');
    await expect(how).toContainText('Key to next paint');
    await expect(how).toContainText('Engine work');
    await expect(how).toContainText('16.7 ms');
    await expect(how).toContainText('Your machine, your numbers');

    // ── nothing leaves localhost ──
    const outside = requests.filter((u) => !/^(http:\/\/localhost[:/]|data:|blob:)/.test(u));
    expect(outside, 'requests outside localhost').toEqual([]);

    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/lab-perf-1440-dark.png`, fullPage: true });
  });

  test('the light theme', async ({ page }) => {
    test.setTimeout(300_000);
    await page.emulateMedia({ colorScheme: 'light' });
    await openLab(page, 5000);
    await typeInMiddle(page, 25);
    await expect(page.getByTestId('lab-count')).toHaveText('25', { timeout: 30_000 });
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/lab-perf-1440-light.png`, fullPage: true });
  });
});

test.describe('performance lab, phone (375px)', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 375, height: 812 }, hasTouch: true });

  test('defaults to 1,000 blocks, usable, no horizontal scroll', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/labs/performance');
    await expect(loaded(page)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('lab-size-1000')).toBeChecked();
    await expect(loaded(page)).toContainText(/^1,0\d\d blocks loaded/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // every control is reachable and at least 40px high
    for (const n of [1000, 5000, 10000]) {
      const box = (await page.getByTestId(`lab-size-${n}`).locator('xpath=..').boundingBox())!;
      expect(box.width).toBeGreaterThan(60);
      expect(box.height).toBeGreaterThanOrEqual(40);
      expect(box.x + box.width).toBeLessThanOrEqual(375);
    }
    await typeInMiddle(page, 20);
    await expect(page.getByTestId('lab-count')).toHaveText('20', { timeout: 30_000 });
    const meter = (await page.getByTestId('lab-meter').boundingBox())!;
    expect(meter.x).toBeGreaterThanOrEqual(0);
    expect(meter.x + meter.width).toBeLessThanOrEqual(375);
    await page.getByTestId('lab-how').getByText('How we measure').click();
    await expect(page.getByTestId('lab-how')).toContainText('Key to next paint');
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/lab-perf-375-dark.png`, fullPage: true });
  });
});

test.describe('home: the performance proof', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 1440, height: 1000 } });

  test('a frame-based promise linking to the lab, no millisecond figure; every proof link goes somewhere', async ({ page }) => {
    await page.goto('/');
    const proofs = page.getByTestId('proofs');
    await expect(proofs).toBeVisible();
    const perf = page.getByTestId('proof-perf');
    await expect(perf).toContainText('Every keystroke on screen within one frame');
    await expect(perf).toContainText('even at 10,000 blocks');
    await expect(perf.getByRole('link')).toHaveAttribute('href', '/labs/performance');
    // no latency figure on the page ("3 ms" and the like)
    await expect(proofs).not.toContainText(/\d\s?ms\b/);
    // every proof link points to something that exists: an in-page anchor, a route of the site (200), or the GitHub docs folder
    const hrefs = await proofs.getByRole('link').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
    expect(hrefs.length).toBe(4);
    for (const href of hrefs) {
      if (href.startsWith('#')) await expect(page.locator(href)).toHaveCount(1);
      else if (href.startsWith('/')) expect((await page.request.get(href)).status(), href).toBe(200);
      else expect(href).toBe('https://github.com/aionbuilders/nabu/tree/main/docs');
    }
    await perf.getByRole('link').click();
    await expect(page).toHaveURL(/\/labs\/performance$/);
  });
});
