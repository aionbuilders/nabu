/**
 * The numbers behind the Performance lab: 60 characters typed in the middle of the lab's 1,000 and 10,000-block documents and at the
 * end of the home page editor, measured by the SAME shared meter as the site (src/site/measure.js: key to next paint, and engine work).
 * Run alone, on a production build, nothing else heavy running:
 *     bunx playwright test tests/e2e/perf/lab-numbers.perf.ts --project=perf
 * Prints the table and writes test-results/lab-numbers.json. The numbers are NOT printed on the site; they sit in measure.js's header.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { test, expect, type Page } from '../helpers/test.js';
import { waitForEditor } from '../helpers/editor.js';

test.use({ domInvariant: false, viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });

const TEXT = 'the quick brown fox jumps over the lazy dog again and again, writing a long letter by the lamp'; // > 60 characters
const rows: any[] = [];

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]; };
const r1 = (x: number) => Math.round(x * 10) / 10;

async function type60(page: Page) {
  await page.keyboard.type(TEXT.slice(0, 60), { delay: 90 }); // a steady, human-ish pace: one frame per key, no coalescing
}

for (const blocks of [1000, 10000]) {
  test(`lab, ${blocks} blocks`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto(`/labs/performance?blocks=${blocks}`);
    const loaded = page.getByTestId('lab-loaded');
    await expect(loaded).toBeVisible({ timeout: 240_000 });
    const loadText = (await loaded.textContent())!;
    await page.getByTestId('lab-jump').click();
    await page.waitForTimeout(500);
    await type60(page);
    await expect(page.getByTestId('lab-count')).toHaveText('60', { timeout: 60_000 });
    const row = {
      where: `lab ${blocks}`, load: loadText,
      last: Number(await page.getByTestId('lab-last').getAttribute('data-ms')),
      p50: await page.getByTestId('lab-p50').textContent(), p95: await page.getByTestId('lab-p95').textContent(),
      engineP50: await page.getByTestId('lab-engine').textContent(),
    };
    console.log('[lab-numbers]', JSON.stringify(row));
    rows.push(row);
  });
}

test('home editor', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await waitForEditor(page);
  await page.waitForTimeout(500);
  await page.locator('[data-nabu-root]').getByText('Everything you type is kept in this browser.').click();
  await page.keyboard.press('End');
  await page.waitForTimeout(300);
  await type60(page);
  await page.waitForTimeout(500);
  const samples: Array<{ paint: number; engine: number }> = await page.evaluate(() => (window as any).__keySamples);
  expect(samples.length).toBeGreaterThanOrEqual(55);
  const paint = samples.map((s) => s.paint), engine = samples.map((s) => s.engine);
  const row = { where: 'home', n: samples.length, p50: r1(pct(paint, 50)), p95: r1(pct(paint, 95)), max: r1(Math.max(...paint)), engineP50: r1(pct(engine, 50)) };
  console.log('[lab-numbers]', JSON.stringify(row));
  rows.push(row);
});

test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/lab-numbers.json', JSON.stringify(rows, null, 2));
});
