/**
 * Cheap REGRESSION GUARDS on a 1 000-block document (AUDIT 2026-10, theme 8c). The full measurements (1k / 5k / 10k, scroll, bulk
 * operations, profiling) live in tests/e2e/perf/large-docs.perf.ts and run on demand: `bunx playwright test --project=perf`.
 *
 * The bounds are ~3x the values measured on a production build after the P-104..P-106 fixes (2026-10-26: importJSON of 1 000 blocks
 * ~1 s, was ~6 s; Enter ~10 ms, was ~45 ms; typing ~2.5 ms, was ~6 ms), generous on purpose so that they do not flake under the
 * parallel workers: a failure means "got markedly worse" (a quadratic path is back).
 */

import { test, expect } from './helpers/test.js';
import { gotoEditor, waitForEditor } from './helpers/editor.js';
import { genDoc } from './perf/gen-doc.js';
import { installPerf, openSeeded } from './perf/harness.js';
import { findPhantoms } from './helpers/dom-invariant.js';
import { copy } from './helpers/clip-capture.js';
import { dragWithHandle, hoverPoint, dropPoint, mustRect } from './helpers/ui.js';

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
  test('importJSON + render of 1 000 blocks stays under 3 s (measured ~1 s; was ~6 s when the tree subscription was quadratic)', async ({ page }) => {
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
    expect(ms).toBeLessThan(3000);
  });

  test('opening a saved 1 000-block document shows every block under 2 s (measured ~0.6 s)', async ({ page }) => {
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
    expect(ms).toBeLessThan(2000);
  });

  test('typing in the middle of 1 000 blocks: median key->DOM under 8 ms (measured ~2.5 ms)', async ({ page }) => {
    test.setTimeout(60000);
    const g = doc();
    await openSeeded(page, docId(), JSON.stringify(g.doc), g.nodes);
    await installPerf(page);
    await page.evaluate(() => (window as any).__perf.place(0.5));
    const keys = [...'the quick brown fox'].map((c) => (c === ' ' ? 'Space' : c));
    await latencies(page, keys.slice(0, 4)); // warm-up
    const xs = await latencies(page, keys);
    console.log(`[large-docs] typing mid-document: median ${median(xs).toFixed(1)} ms, max ${xs[xs.length - 1].toFixed(1)} ms`);
    expect(median(xs)).toBeLessThan(8);
    expect(xs[xs.length - 1]).toBeLessThan(100);
  });

  test('Enter (split) in the middle of 1 000 blocks: median key->DOM under 35 ms (measured ~11 ms; was ~45 ms)', async ({ page }) => {
    test.setTimeout(60000);
    const g = doc();
    await openSeeded(page, docId(), JSON.stringify(g.doc), g.nodes);
    await installPerf(page);
    await page.evaluate(() => (window as any).__perf.place(0.5, 8));
    const xs = await latencies(page, Array(10).fill('Enter'), () => page.evaluate(() => (window as any).__perf.placeInCurrent(5)));
    console.log(`[large-docs] Enter mid-document: median ${median(xs).toFixed(1)} ms, max ${xs[xs.length - 1].toFixed(1)} ms`);
    expect(median(xs)).toBeLessThan(35);
  });
});

/**
 * RENDER COST, not engine cost (2026-10-27). At 10 000 blocks the engine needs ~1 ms of script and creates no DOM node per key, yet the key took
 * ~85 ms to reach the screen: the browser lays out, paints and syncs the selection of the WHOLE contenteditable. The fix is to let it skip
 * what is off screen: a long list of sibling blocks is rendered in chunks of ~64 blocks (BlockList.svelte, blocks/chunks.js) and each
 * chunk / region body is `content-visibility: auto`. These guards are deterministic (no timing): they fail if a keystroke starts
 * re-creating blocks, or if the page stops being skippable.
 */
test.describe('large document: what the browser has to look at', () => {
  /** Skipped = the browser does not render the contents of the element now (off screen, `content-visibility: auto`): its first child is then not rendered. */
  const skippedOf = (page: import('@playwright/test').Page, selector: string) =>
    page.evaluate(async (sel) => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // the browser decides what is on screen at its next frame
      const els = [...document.querySelectorAll(sel)] as any[];
      return { total: els.length, skipped: els.filter((e) => e.firstElementChild && !e.firstElementChild.checkVisibility({ contentVisibilityAuto: true })).length, auto: els.every((e) => getComputedStyle(e).contentVisibility === 'auto') };
    }, selector);

  test('typing re-creates nothing: no block element is added or removed by 30 keystrokes', async ({ page }) => {
    test.setTimeout(90000);
    const g = doc();
    await openSeeded(page, docId(), JSON.stringify(g.doc), g.nodes);
    await installPerf(page);
    await page.evaluate(() => (window as any).__perf.place(0.5));
    await page.evaluate(() => {
      const w = window as any;
      w.__mut = { added: 0, removed: 0, text: 0 };
      new MutationObserver((recs) => {
        for (const r of recs) {
          if (r.type === 'characterData') w.__mut.text++;
          for (const n of r.addedNodes) if (n.nodeType === 1) w.__mut.added++;
          for (const n of r.removedNodes) if (n.nodeType === 1) w.__mut.removed++;
        }
      }).observe(document.querySelector('[data-nabu-root]')!, { subtree: true, childList: true, characterData: true });
    });
    for (const c of 'the quick brown fox jumps over') await page.keyboard.press(c === ' ' ? 'Space' : c);
    await page.evaluate(() => (window as any).__perf.sample());
    const m = await page.evaluate(() => (window as any).__mut);
    console.log(`[large-docs] 30 keystrokes at ${g.nodes} blocks: ${JSON.stringify(m)}`);
    expect(m.added, 'an element was added').toBe(0);
    expect(m.removed, 'an element was removed').toBe(0);
    expect(m.text, 'the text of the edited block was written once per key at most').toBeLessThanOrEqual(60);
  });

  test('a long flat document is rendered in chunks, in order, and most of them are skipped off screen', async ({ page }) => {
    test.setTimeout(90000);
    const g = doc();
    await openSeeded(page, docId(), JSON.stringify(g.doc), g.nodes);
    const r = await page.evaluate(() => {
      const root = document.querySelector('[data-nabu-root]')!;
      const chunks = [...root.children].filter((c) => c.classList.contains('nabu-chunk'));
      const nabu = (window as any).nabu;
      // (the element of a block is its first element carrying the id: a container may hold it on an inner element)
      const inChunks = chunks.flatMap((c) => [...c.children].map((b) => (b.hasAttribute('data-block-id') ? b : b.querySelector('[data-block-id]'))?.getAttribute('data-block-id')));
      return { chunks: chunks.length, strays: [...root.children].filter((c) => !c.classList.contains('nabu-chunk')).length, inChunks, model: nabu.children.map((b: any) => b.id) };
    });
    expect(r.chunks, 'chunk wrappers').toBeGreaterThan(4);
    expect(r.strays, 'elements of the root that are not a chunk').toBe(0);
    expect(r.inChunks, 'the blocks, chunk after chunk, are the model order').toEqual(r.model);
    const s = await skippedOf(page, '.nabu-chunk');
    console.log(`[large-docs] ${s.total} chunks, ${s.skipped} skipped by the browser`);
    expect(s.auto).toBe(true);
    expect(s.skipped, 'chunks skipped').toBeGreaterThanOrEqual(Math.floor(s.total * 0.6));
    expect(await findPhantoms(page), 'whitespace nodes in the chunked markup').toEqual([]);
  });

  test('a document with regions skips the off-screen region bodies', async ({ page }) => {
    test.setTimeout(90000);
    const g = genDoc({ blocks: N, regions: true });
    await openSeeded(page, docId(), JSON.stringify(g.doc), g.nodes);
    expect(await page.locator('[data-nabu-root][data-nabu-large]').count()).toBe(1);
    const s = await skippedOf(page, '.nabu-region-body');
    console.log(`[large-docs] ${s.total} region bodies, ${s.skipped} skipped by the browser`);
    expect(s.auto).toBe(true);
    expect(s.skipped, 'region bodies skipped').toBeGreaterThanOrEqual(Math.floor(s.total * 0.6));
  });

  test('a small document is left exactly as it was: no chunk, no skipped body', async ({ page }) => {
    await gotoEditor(page, {});
    await page.locator('[data-nabu-root]').click();
    await page.keyboard.type('Small');
    expect(await page.locator('.nabu-chunk').count()).toBe(0);
    expect(await page.locator('[data-nabu-root][data-nabu-large]').count()).toBe(0);
  });

  test('the caret, Enter, Backspace and undo work across the edge of two chunks', async ({ page }) => {
    test.setTimeout(120000);
    const g = doc();
    await openSeeded(page, docId(), JSON.stringify(g.doc), g.nodes);
    // The first paragraph of a chunk (not the first chunk) whose previous chunk ends with a paragraph.
    const edge = await page.evaluate(async () => {
      const nabu = (window as any).nabu;
      const chunks = [...document.querySelectorAll('.nabu-chunk')];
      for (let i = Math.floor(chunks.length / 2); i < chunks.length; i++) {
        const first = chunks[i].firstElementChild, prev = chunks[i - 1].lastElementChild;
        const b = nabu.blocks.get(first?.getAttribute('data-block-id')), a = nabu.blocks.get(prev?.getAttribute('data-block-id'));
        if (a?.type === 'paragraph' && b?.type === 'paragraph' && a.text.length > 5 && b.text.length > 5) {
          first!.scrollIntoView({ block: 'center' });
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          return { a: a.id, b: b.id, aText: a.text as string, bText: b.text as string };
        }
      }
      return null;
    });
    expect(edge, 'a chunk edge between two paragraphs').not.toBeNull();
    const at = (id: string, offset: number) => page.evaluate(async ([id, offset]) => { const n = (window as any).nabu; const b = n.blocks.get(id); await n.focus({ from: { block: b, offset }, to: { block: b, offset } }); }, [id, offset] as [string, number]);
    const caret = () => page.evaluate(() => { const n = (window as any).nabu; n.selection.sync(); const b = n.selection.anchorBlock; return { id: b?.id, offset: b?.behaviors.get('text').selection?.from }; });
    const text = (id: string) => page.evaluate((id) => (window as any).nabu.blocks.get(id)?.text ?? null, id);

    // The caret crosses the edge with the arrow keys, both ways.
    await at(edge!.a, edge!.aText.length);
    await page.keyboard.press('ArrowRight');
    expect(await caret()).toEqual({ id: edge!.b, offset: 0 });
    await page.keyboard.press('ArrowLeft');
    expect((await caret()).id).toBe(edge!.a);

    // Typing at the start of the first block of a chunk.
    await at(edge!.b, 0);
    await page.keyboard.type('XY');
    expect(await text(edge!.b)).toBe('XY' + edge!.bText);

    // Backspace at the start of that block merges it into the last block of the previous chunk: the chunk of `b` goes away.
    await at(edge!.b, 0);
    const before = await page.locator('[data-block-id]').count();
    await page.keyboard.press('Backspace');
    expect(await text(edge!.a)).toBe(edge!.aText + 'XY' + edge!.bText);
    expect(await page.locator(`[data-block-id="${edge!.b}"]`).count()).toBe(0);
    expect(await page.locator('[data-block-id]').count()).toBe(before - 1);
    expect((await caret()).id).toBe(edge!.a);

    // Undo gives the block back, in its place.
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-block-id]')).toHaveCount(before);
    const restored = await page.evaluate(() => { const c = [...document.querySelectorAll('.nabu-chunk')]; return c.length; });
    expect(restored).toBeGreaterThan(4);
    const order = await page.evaluate(() => {
      const root = document.querySelector('[data-nabu-root]')!;
      const dom = [...root.querySelectorAll(':scope > .nabu-chunk > *')].map((b) => (b.hasAttribute('data-block-id') ? b : b.querySelector('[data-block-id]'))?.getAttribute('data-block-id'));
      return { dom, model: (window as any).nabu.children.map((b: any) => b.id) };
    });
    expect(order.dom).toEqual(order.model);
    // The merge is undone: the block is back with the text typed in it, the previous one has its own text again.
    expect(await page.evaluate((t) => [...document.querySelectorAll('[data-block-type="paragraph"]')].some((e) => e.textContent === t), 'XY' + edge!.bText)).toBe(true);
    expect(await text(edge!.a)).toBe(edge!.aText);
  });

  test('select all and delete empty a chunked document, undo brings it back (the markup goes flat and chunked again)', async ({ page }) => {
    test.setTimeout(120000);
    const g = doc();
    await openSeeded(page, docId(), JSON.stringify(g.doc), g.nodes);
    await installPerf(page);
    const sig = await page.evaluate(() => (window as any).__perf.contentSig());
    await page.evaluate(() => (window as any).__perf.place(0.3));
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await expect.poll(() => page.locator('.nabu-chunk').count(), { timeout: 30000 }).toBe(0);
    await page.keyboard.press('Control+z');
    await expect.poll(() => page.locator('.nabu-chunk').count(), { timeout: 60000 }).toBeGreaterThan(4);
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('[data-block-id]').length), { timeout: 60000 }).toBe(g.nodes);
    // (undoing a deletion gives the blocks back with new ids: the content is compared, not the ids)
    const { idHash: _a, ...back } = await page.evaluate(() => (window as any).__perf.contentSig());
    const { idHash: _b, ...was } = sig;
    expect(back).toEqual(was);
  });
});

/**
 * The risks of `content-visibility: auto` chunks (2026-10-28): what the browser skips is still in the DOM, so the model-driven features
 * (caret, copy, drag) and the tree of accessibility must not notice. 10 000 blocks where the size matters, 1 000 elsewhere.
 */
test.describe('large document: skipped chunks and the features that reach into them', () => {
  const BIG = 10000;
  const inViewport = (page: import('@playwright/test').Page, sel: string) =>
    page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.height > 0; }, sel);

  test('Ctrl+End and Ctrl+Home put the caret in the last and the first text block, scrolled into view (10 000 blocks)', async ({ page }) => {
    test.setTimeout(240000);
    const g = genDoc({ blocks: BIG });
    await openSeeded(page, docId(), JSON.stringify(g.doc), g.nodes);
    await installPerf(page);
    await page.evaluate(() => (window as any).__perf.place(0.5));
    const ends = await page.evaluate(() => {
      const n = (window as any).nabu;
      const texts: any[] = [];
      const walk = (bs: any[]) => { for (const b of bs) { if (b.behaviors?.has('text')) texts.push(b); if (b.children?.length) walk(b.children); } };
      walk(n.children);
      return { first: texts[0].id, last: texts.at(-1).id };
    });
    const where = () => page.evaluate(() => { const n = (window as any).nabu; n.selection.sync(); return n.selection.anchorBlock?.id; });
    await page.keyboard.press('Control+End');
    await expect.poll(where, { timeout: 20000 }).toBe(ends.last);
    await expect.poll(() => inViewport(page, `[data-block-id="${ends.last}"]`), { message: 'the last block is on screen' }).toBe(true);
    await page.keyboard.press('Control+Home');
    await expect.poll(where, { timeout: 20000 }).toBe(ends.first);
    await expect.poll(() => inViewport(page, `[data-block-id="${ends.first}"]`), { message: 'the first block is on screen' }).toBe(true);
    // typing lands where the caret is
    await page.keyboard.type('Q');
    expect(await page.evaluate((id) => (window as any).nabu.blocks.get(id).text.startsWith('Q'), ends.first)).toBe(true);
    // Shift extends from where the caret was: the anchor stays, the focus goes to the end
    const mid = await page.evaluate(() => (window as any).__perf.place(0.5));
    await page.keyboard.press('Control+Shift+End');
    await expect.poll(() => page.evaluate(() => { const n = (window as any).nabu; n.selection.sync(); return [n.selection.anchorBlock?.id, n.selection.focusBlock?.id]; }), { timeout: 20000 }).toEqual([mid.id, ends.last]);
  });

  test('the model puts the caret in a block of a far, skipped chunk: it can be scrolled to and typed in', async ({ page }) => {
    test.setTimeout(180000);
    const g = doc();
    await openSeeded(page, docId(), JSON.stringify(g.doc), g.nodes);
    await installPerf(page);
    const far = await page.evaluate(() => {
      const n = (window as any).nabu;
      const ps = [...n.blocks.values()].filter((b: any) => b.type === 'paragraph' && !b.parent && b.text.length > 30);
      const b = ps[Math.floor(ps.length * 0.9)] as any;
      return { id: b.id, text: b.text as string, skipped: !b.element.checkVisibility({ contentVisibilityAuto: true }) };
    });
    expect(far.skipped, 'the target is in a skipped chunk').toBe(true);
    await page.evaluate(async (id) => { const n = (window as any).nabu; const b = n.blocks.get(id); await n.focus({ from: { block: b, offset: 5 }, to: { block: b, offset: 5 } }); }, far.id);
    // (`nabu.focus` does not scroll; the browser then makes the chunk that holds the selection relevant, so it is rendered)
    await page.evaluate((id) => (window as any).nabu.blocks.get(id).element.scrollIntoView({ block: 'center' }), far.id);
    await expect.poll(() => inViewport(page, `[data-block-id="${far.id}"]`), { message: 'scrolled to the block' }).toBe(true);
    await page.keyboard.type('ZZ');
    expect(await page.evaluate((id) => (window as any).nabu.blocks.get(id).text.slice(0, 9), far.id)).toBe(far.text.slice(0, 5) + 'ZZ' + far.text.slice(5, 7));
    // and scrollIntoView on the element of a skipped block works too
    const top = await page.evaluate(() => { const n = (window as any).nabu; const b = n.children[3]; b.element.scrollIntoView({ block: 'center' }); return n.children[3].id; });
    await expect.poll(() => inViewport(page, `[data-block-id="${top}"]`)).toBe(true);
  });

  test('Select all + Copy at 10 000 blocks puts the whole document on the clipboard', async ({ page }) => {
    test.setTimeout(240000);
    const g = genDoc({ blocks: BIG });
    await openSeeded(page, docId(), JSON.stringify(g.doc), g.nodes);
    await installPerf(page);
    await page.evaluate(() => (window as any).__perf.place(0.3));
    const want = await page.evaluate(() => { const n = (window as any).nabu; return { roots: n.children.length, first: n.children[0].text ?? '', last: n.children.at(-1).text ?? '' }; });
    await page.keyboard.press('Control+a');
    const ev = await copy(page);
    expect(ev.nabu?.blocks.length, 'every root block is in the fragment').toBe(want.roots);
    if (want.first) expect(ev.text).toContain(want.first.slice(0, 40));
    if (want.last) expect(ev.text).toContain(want.last.slice(0, 40));
    expect(ev.text.length).toBeGreaterThan(g.chars * 0.9);
  });

  test('the text of a skipped chunk is in the DOM and in the accessibility tree (find in page, screen readers)', async ({ page }) => {
    test.setTimeout(120000);
    const g = doc();
    await openSeeded(page, docId(), JSON.stringify(g.doc), g.nodes);
    const probe = await page.evaluate(() => {
      const n = (window as any).nabu;
      const ps = n.children.filter((b: any) => b.type === 'paragraph' && b.text.length > 40);
      const pick = (f: number) => { const b = ps[Math.floor(ps.length * f)]; return { id: b.id, snippet: (b.text as string).slice(10, 40) }; };
      return { mid: pick(0.5), late: pick(0.95), skipped: ps.filter((b: any) => !b.element.checkVisibility({ contentVisibilityAuto: true })).length };
    });
    expect(probe.skipped, 'most paragraphs are in skipped chunks').toBeGreaterThan(100);
    const dom = await page.evaluate(([a, b]) => { const t = document.querySelector('[data-nabu-root]')!.textContent ?? ''; return [t.includes(a), t.includes(b)]; }, [probe.mid.snippet, probe.late.snippet]);
    expect(dom).toEqual([true, true]);
    // The browser's own find-in-page API walks the DOM, skipped content included (it activates the chunk).
    expect(await page.evaluate((t) => (window as any).find(t, true, false, true), probe.late.snippet)).toBe(true);
    await expect.poll(() => inViewport(page, `[data-block-id="${probe.late.id}"]`), { message: 'find scrolled to the match' }).toBe(true);
    // Accessibility tree of the root.
    const aria = await page.locator('[data-nabu-root]').ariaSnapshot();
    expect(aria).toContain(probe.mid.snippet.slice(0, 20));
    expect(aria).toContain(probe.late.snippet.slice(0, 20));
  });

  test('a block dragged across the edge of two chunks moves there, in one undo step', async ({ page }) => {
    test.setTimeout(180000);
    const g = doc();
    await openSeeded(page, docId(), JSON.stringify(g.doc), g.nodes);
    await page.setViewportSize({ width: 1280, height: 1000 });
    const edge = await page.evaluate(async () => {
      const n = (window as any).nabu;
      const chunks = [...document.querySelectorAll('.nabu-chunk')];
      for (let i = Math.floor(chunks.length / 2); i < chunks.length; i++) {
        const a = chunks[i - 1].lastElementChild, b = chunks[i].firstElementChild, c = chunks[i].children[1];
        const ba = n.blocks.get(a?.getAttribute('data-block-id')), bb = n.blocks.get(b?.getAttribute('data-block-id')), bc = n.blocks.get(c?.getAttribute('data-block-id'));
        if (ba?.type === 'paragraph' && bb?.type === 'paragraph' && bc?.type === 'paragraph' && ba.text.length > 5 && bb.text.length > 5 && bc.text.length > 5) {
          b!.scrollIntoView({ block: 'center' });
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          return { a: ba.id, b: bb.id, c: bc.id, aText: ba.text as string, cText: bc.text as string };
        }
      }
      return null;
    });
    expect(edge).not.toBeNull();
    const order = () => page.evaluate(() => (window as any).nabu.children.map((b: any) => b.id) as string[]);
    const before = await order();
    // a (last of the previous chunk) is dragged below c (second block of the next chunk)
    await dragWithHandle(page, hoverPoint(await mustRect(page, `[data-block-id="${edge!.a}"]`)), dropPoint(await mustRect(page, `[data-block-id="${edge!.c}"]`), 'after'));
    await expect.poll(async () => (await order()).indexOf(edge!.a)).toBeGreaterThan(before.indexOf(edge!.a));
    const after = await order();
    expect(after.indexOf(edge!.a)).toBe(after.indexOf(edge!.c) + 1);
    expect(after.length).toBe(before.length);
    await page.keyboard.press('Control+z');
    await expect.poll(order).toEqual(before);
    const dom = await page.evaluate(() => [...document.querySelectorAll(':scope .nabu-chunk > *')].map((b) => (b.hasAttribute('data-block-id') ? b : b.querySelector('[data-block-id]'))?.getAttribute('data-block-id')));
    expect(dom).toEqual(before);
  });

  test('jumping the scrollbar to the middle, the end and the top shows content each time and throws nothing', async ({ page }) => {
    test.setTimeout(240000);
    const g = genDoc({ blocks: BIG });
    await openSeeded(page, docId(), JSON.stringify(g.doc), g.nodes);
    const errors: string[] = []; // (after the seeding: the seeding helper writes through a stand-in engine that logs private-field errors)
    page.on('pageerror', (e) => errors.push(String(e)));
    const h0 = await page.evaluate(() => document.documentElement.scrollHeight);
    for (const f of [0.5, 1, 0.25, 0]) {
      await page.evaluate((f) => window.scrollTo(0, f * (document.documentElement.scrollHeight - innerHeight)), f);
      // the chunks that come into view are laid out at the next frames (the point may also fall in the gap between two blocks)
      await expect.poll(() => page.evaluate(() => {
        for (const dy of [0, 20, -20, 40, -40]) {
          const b = document.elementFromPoint(innerWidth / 2, innerHeight / 2 + dy)?.closest('[data-block-id]');
          if (b && (b.textContent ?? '').trim().length > 0) return true;
        }
        return false;
      }), { message: `a block with text is under the middle of the viewport at ${f * 100}%`, timeout: 10000 }).toBe(true);
    }
    const h1 = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log(`[large-docs] document height ${h0}px at load, ${h1}px after the jumps`);
    expect(h0).toBeGreaterThan(g.nodes * 20); // the estimate is in the right order of magnitude
    expect(errors).toEqual([]);
  });
});
