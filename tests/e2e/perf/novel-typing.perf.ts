/**
 * Typing in the MIDDLE of a 90,000-word novel (nested regions: parts > chapters > scenes) on WebKit. Run on demand:
 *
 *   bunx playwright test --project=perf-webkit
 *
 * (`NABU_WEBKIT_EXE=<launcher>` runs another WebKit build than the one Playwright pins, see the `perf-webkit` project in playwright.config.js.)
 *
 * WHY. In a large document every region body used to be `content-visibility: auto`, and WebKit spends ~380 ms per keystroke on boxes of
 * that kind stacked inside each other (layout itself takes 1 ms: the cost is in its frame work). Now only the LEAF bodies are `auto`
 * (region/Region.svelte). Measured on WebKitGTK (Playwright's webkit-2370, 1440x1000), key to next paint, 40 keys, caret mid-document:
 *
 *   before the fix   p50 ~380 ms, p95 ~550 ms (90,000 words)    after   p50 ~25-30 ms, p95 ~40 ms
 *
 * BUDGET: p50 under 60 ms. About 2x the measured median, so that a noisy machine does not flake, and 6x under the broken behaviour,
 * so that nested `auto` boxes coming back (or any other change that makes WebKit pay per keystroke for the size of the document)
 * fails. The p95 is only reported: WebKit's frame timing is too jittery to be a bound.
 */

import { test, expect, type Page } from '@playwright/test';
import { genNovel } from './gen-novel.js';
import { waitForEditor } from '../helpers/editor.js';
import { installPerf, openPersisted, percentile, round, seedSnapshot, setTarget } from './harness.js';

const WORDS = 90_000;
const KEYS = 40;
const BUDGET_P50_MS = 60;
const TYPED = 'the quick brown fox jumps over the lazy dog'.slice(0, KEYS);

/** WPE / GTK WebKit can hang forever in `close()` after a big document: never wait for it. */
const closeSoon = (x: { close(): Promise<unknown> }) => Promise.race([x.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);

/** Puts the caret in a paragraph in the middle of the document and makes sure that paragraph is on screen. */
async function placeMiddle(page: Page) {
  const id = await page.evaluate(async () => {
    const perf = (window as any).__perf;
    const where = await perf.place(0.5);
    // WebKit: scrollIntoView on a `content-visibility` box can leave the target far away.
    for (let i = 0; i < 12; i++) {
      const el = document.querySelector(`[data-block-id="${where.id}"]`)!;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.top >= 0 && r.bottom <= innerHeight) break;
      window.scrollBy({ top: r.top - innerHeight / 2, behavior: 'instant' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    return where.id as string;
  });
  await page.waitForTimeout(500);
  return id;
}

test(`novel of ${WORDS} words: typing in the middle, key to next paint p50 under ${BUDGET_P50_MS} ms`, async ({ browser, browserName }) => {
  test.setTimeout(600_000);
  const g = genNovel(WORDS);
  const docId = `perf-novel-${Date.now()}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const seeder = await ctx.newPage();
    await openPersisted(seeder, docId);
    await seedSnapshot(seeder, docId, JSON.stringify(g.doc));
    await closeSoon(seeder);

    const page = await ctx.newPage();
    await page.goto('/e2e?persist=' + encodeURIComponent(docId) + '&options=' + encodeURIComponent(JSON.stringify({ debounce: 3_600_000, maxWait: 0 })), { waitUntil: 'domcontentloaded' });
    await setTarget(page, g.nodes);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForEditor(page, 120_000);
    await page.waitForFunction((n) => document.querySelectorAll('[data-block-id]').length >= n, g.nodes, { timeout: 120_000 });
    await installPerf(page);

    // The point of the test: the document is large, and no `auto` box has an `auto` ancestor.
    const nested = await page.evaluate(() => {
      const root = document.querySelector('[data-nabu-root]')!;
      const auto = (el: Element | null) => !!el && getComputedStyle(el).contentVisibility === 'auto';
      return { large: root.closest('.nabu-editor')?.hasAttribute('data-nabu-large') ?? false, nested: [...root.querySelectorAll('*')].filter((el) => auto(el) && auto(el.parentElement?.closest('.nabu-region-body, .nabu-chunk') ?? null)).length };
    });
    expect(nested.large).toBe(true);
    expect(nested.nested).toBe(0);

    const id = await placeMiddle(page);
    const hit = await page.evaluate((id) => { const n = getSelection()?.anchorNode; return (n?.nodeType === 1 ? (n as Element) : n?.parentElement)?.closest('[data-block-id]')?.getAttribute('data-block-id') === id; }, id);
    expect(hit, 'the caret is in the paragraph that was targeted').toBe(true);
    const before = await page.evaluate((id) => document.querySelector(`[data-block-id="${id}"]`)!.textContent!.length, id);

    // Warm-up (not counted), then the measured keys.
    for (const ch of 'abcde') { await page.keyboard.press(ch); await page.evaluate(() => (window as any).__perf.sample()); }
    const paint: number[] = [];
    for (const ch of TYPED) {
      await page.keyboard.press(ch === ' ' ? 'Space' : ch);
      const s = await page.evaluate(() => (window as any).__perf.sample());
      if (s?.paint != null) paint.push(s.paint);
    }
    const grew = (await page.evaluate((id) => document.querySelector(`[data-block-id="${id}"]`)!.textContent!.length, id)) - before;
    const p50 = round(percentile(paint, 50)), p95 = round(percentile(paint, 95));
    console.log(`[novel-typing] ${browserName} ${g.words} words (${g.nodes} blocks, ${g.scenes} scenes): ${paint.length} keys, key->paint p50 ${p50} ms, p95 ${p95} ms, max ${round(Math.max(...paint))} ms`);
    expect(grew).toBe(KEYS + 5);
    expect(paint.length).toBeGreaterThanOrEqual(KEYS - 2);
    expect(p50, `key->paint p50 ${p50} ms (p95 ${p95} ms)`).toBeLessThan(BUDGET_P50_MS);
    await closeSoon(page);
  } finally {
    await closeSoon(ctx);
  }
});
