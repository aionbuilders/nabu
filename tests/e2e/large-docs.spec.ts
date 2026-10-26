/**
 * Cheap REGRESSION GUARDS on a 1 000-block document (AUDIT 2026-10, theme 8c). The full measurements (1k / 5k / 10k, scroll, bulk
 * operations, profiling) live in tests/e2e/perf/large-docs.perf.ts and run on demand: `bunx playwright test --project=perf`.
 *
 * The bounds are ~3x the values measured on a production build (see the audit), generous on purpose so that they do not flake under
 * the parallel workers. They pin TODAY's behaviour, which is known to be slow in places (importJSON is O(N^2): ~6 s for 1 000 blocks;
 * Enter / Backspace pay a normalizer pass): a failure means "got markedly worse"; once the product is fixed, TIGHTEN the bounds.
 */

import { test, expect } from './helpers/test.js';
import { gotoEditor, waitForEditor } from './helpers/editor.js';
import { genDoc } from './perf/gen-doc.js';
import { installPerf, openSeeded } from './perf/harness.js';

// 1 000 blocks: the end-of-test DOM invariant check would only burn its 5 s cap on such a document.
test.use({ domInvariant: false });

const N = 1000;
const doc = () => genDoc({ blocks: N });
const docId = () => `e2e-large-${test.info().testId}-${Date.now()}`;

/** ms from keydown to the first DOM mutation, for each key of `keys`, with `before` run (not timed) ahead of each key. */
async function latencies(page: import('@playwright/test').Page, keys: string[], before?: () => Promise<unknown>) {
  const out: number[] = [];
  for (const key of keys) {
    await before?.();
    await page.keyboard.press(key);
    const s = await page.evaluate(() => (window as any).__perf.sample());
    expect(s, `no DOM update after ${key}`).not.toBeNull();
    out.push(s!.dom);
  }
  return out.sort((a, b) => a - b);
}
const median = (xs: number[]) => xs[Math.floor(xs.length / 2)];

test.describe('large document (1 000 blocks)', () => {
  test('importJSON + render of 1 000 blocks stays under 20 s (measured ~6 s; target < 2 s)', async ({ page }) => {
    test.setTimeout(90000);
    const g = doc();
    await gotoEditor(page, {});
    const json = JSON.stringify(g.doc);
    const ms = await page.evaluate(async ([json, nodes]) => {
      const n = (window as any).nabu;
      const t0 = performance.now();
      await n.importJSON(json);
      while (document.querySelectorAll('[data-block-id]').length < (nodes as number)) await new Promise((r) => setTimeout(r, 5));
      await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      return performance.now() - t0;
    }, [json, g.nodes] as [string, number]);
    console.log(`[large-docs] importJSON + render of ${g.nodes} blocks: ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(20000);
  });

  test('opening a saved 1 000-block document shows every block under 4 s (measured ~0.6 s)', async ({ page }) => {
    test.setTimeout(60000);
    const g = doc();
    const id = docId();
    await openSeeded(page, id, JSON.stringify(g.doc), g.nodes); // seeds a snapshot, reloads
    const t0 = Date.now();
    await page.reload();
    await waitForEditor(page, 30000);
    await page.waitForFunction((n) => document.querySelectorAll('[data-block-id]').length >= n, g.nodes, { timeout: 30000 });
    const ms = Date.now() - t0;
    console.log(`[large-docs] reload of ${g.nodes} blocks, all in the DOM: ${ms} ms`);
    expect(ms).toBeLessThan(4000);
  });

  test('typing in the middle of 1 000 blocks: median key->DOM under 30 ms (measured ~6 ms)', async ({ page }) => {
    test.setTimeout(60000);
    const g = doc();
    await openSeeded(page, docId(), JSON.stringify(g.doc), g.nodes);
    await installPerf(page);
    await page.evaluate(() => (window as any).__perf.place(0.5));
    const keys = [...'the quick brown fox'].map((c) => (c === ' ' ? 'Space' : c));
    await latencies(page, keys.slice(0, 4)); // warm-up
    const xs = await latencies(page, keys);
    console.log(`[large-docs] typing mid-document: median ${median(xs).toFixed(1)} ms, max ${xs[xs.length - 1].toFixed(1)} ms`);
    expect(median(xs)).toBeLessThan(30);
    expect(xs[xs.length - 1]).toBeLessThan(400);
  });

  test('Enter (split) in the middle of 1 000 blocks: median key->DOM under 150 ms (measured ~45 ms; target < 16 ms)', async ({ page }) => {
    test.setTimeout(60000);
    const g = doc();
    await openSeeded(page, docId(), JSON.stringify(g.doc), g.nodes);
    await installPerf(page);
    await page.evaluate(() => (window as any).__perf.place(0.5, 8));
    const xs = await latencies(page, Array(10).fill('Enter'), () => page.evaluate(() => (window as any).__perf.placeInCurrent(5)));
    console.log(`[large-docs] Enter mid-document: median ${median(xs).toFixed(1)} ms, max ${xs[xs.length - 1].toFixed(1)} ms`);
    expect(median(xs)).toBeLessThan(150);
  });
});
