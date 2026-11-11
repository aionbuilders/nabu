/**
 * The `content-visibility: auto` boxes of a large document never nest (src/lib/blocks/region/Region.svelte, BlockList.svelte): WebKit pays
 * for a nested pair on every keystroke (~380 ms vs ~25 ms at 90,000 words, see the note in Region.svelte). Checked on the real DOM
 * with getComputedStyle: no `auto` element has an `auto` ancestor, and the boxes that should be `auto` are.
 */

import { test, expect } from './helpers/test.js';
import { gotoEditor } from './helpers/editor.js';

// 800+ blocks: the end-of-test DOM invariant check would only burn its 5 s cap on such a document.
test.use({ domInvariant: false });

type Spec = [string, Record<string, any>, Spec[]?];
const region = (level: number, title: string, children: Spec[]): Spec => ['region', { regionType: `section-${level}`, title }, children];
const paras = (n: number, tag: string): Spec[] => Array.from({ length: n }, (_, i) => ['paragraph', { text: `${tag} ${i}` }] as Spec);

/** Builds `specs` at the root of the (empty, in-memory) editor. */
async function build(page: import('@playwright/test').Page, specs: Spec[]) {
  await page.evaluate(async (specs) => {
    const eng = (window as any).nabu;
    for (const child of [...eng.children]) eng.delete(child);
    const put = (list: any[], parentId: string | null) => list.forEach(([type, props, children]: any, i: number) => {
      const block = eng.insert(type, props, parentId, i);
      if (children) put(children, block.id);
    });
    put(specs, null);
    await eng.commit();
  }, specs);
  await page.waitForFunction((n) => document.querySelectorAll('[data-block-id]').length >= n, 1, { timeout: 30000 });
}

/** Every body is told apart by the text of its region's title; returns what the DOM computes. */
const inspect = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const root = document.querySelector('[data-nabu-root]')!;
  const auto = (el: Element) => getComputedStyle(el).contentVisibility === 'auto';
  const all = [...root.querySelectorAll('*')].filter(auto);
  const nested = all.filter((el) => el.parentElement?.closest('*') && [...(function* () { for (let p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) yield p; })()].some(auto));
  const bodies = [...root.querySelectorAll('.nabu-region-body')].map((body) => ({
    title: body.parentElement!.querySelector('.nabu-region-title')!.textContent,
    auto: auto(body),
    leaf: !body.querySelector(':scope > .nabu-region, :scope > .nabu-chunk .nabu-region'),
    inChunk: !!body.closest('.nabu-chunk'),
  }));
  return {
    large: root.closest('.nabu-editor')?.hasAttribute('data-nabu-large') ?? root.hasAttribute('data-nabu-large'),
    autoCount: all.length,
    nested: nested.map((el) => el.className),
    chunks: root.querySelectorAll('.nabu-chunk').length,
    chunksAuto: [...root.querySelectorAll('.nabu-chunk')].filter(auto).length,
    bodies,
  };
});

test.describe('content-visibility: auto boxes of a large document', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, {}); });

  test('nested regions (part > chapter > scene): only the leaf bodies are auto', async ({ page }) => {
    test.setTimeout(90000);
    const part = (p: number) => region(1, `Part ${p}`, Array.from({ length: 3 }, (_, c) => region(2, `Chapter ${p}.${c}`,
      Array.from({ length: 3 }, (_, s) => region(3, `Scene ${p}.${c}.${s}`, paras(30, `s${p}${c}${s}`))))));
    await build(page, [1, 2, 3].map(part));
    const r = await inspect(page);
    expect(r.large).toBe(true);
    expect(r.nested).toEqual([]);
    expect(r.bodies.length).toBe(39);
    for (const b of r.bodies) expect(b.auto, b.title ?? '').toBe(b.leaf);
    expect(r.bodies.filter((b) => b.auto).length).toBe(27);
  });

  test('a region body of 500 paragraphs is chunked: its chunks are auto, the body is not', async ({ page }) => {
    test.setTimeout(90000);
    await build(page, [...paras(400, 'root'), region(1, 'Big', paras(500, 'big')), region(1, 'Small', paras(5, 'small'))]);
    const r = await inspect(page);
    expect(r.large).toBe(true);
    expect(r.nested).toEqual([]);
    expect(r.chunks).toBeGreaterThan(3);
    expect(r.chunksAuto).toBe(r.chunks);
    expect(r.bodies.find((b) => b.title === 'Big')!.auto).toBe(false);
    expect(r.bodies.find((b) => b.title === 'Small')!.auto).toBe(true);
  });

  test('a flat root of 500+ blocks holding regions: the regions sit inside chunks, their bodies are not auto', async ({ page }) => {
    test.setTimeout(90000);
    // A region every 12 paragraphs, so that they are spread over the chunks.
    const flat = Array.from({ length: 42 }, (_, i): Spec[] => [...paras(12, `flat${i}`), region(1, `R${i}`, paras(20, `r${i}`))]).flat();
    await build(page, flat);
    const r = await inspect(page);
    expect(r.large).toBe(true);
    expect(r.nested).toEqual([]);
    expect(r.chunks).toBeGreaterThan(2);
    expect(r.chunksAuto).toBe(r.chunks);
    const inChunk = r.bodies.filter((b) => b.inChunk);
    expect(inChunk.length).toBeGreaterThan(0);
    for (const b of inChunk) expect(b.auto, b.title ?? '').toBe(false);
  });

  test('a body turns leaf / non-leaf as regions come and go', async ({ page }) => {
    test.setTimeout(90000);
    await build(page, [region(1, 'Outer', [...paras(850, 'x').slice(0, 300), region(2, 'Inner', paras(300, 'y'))]), region(1, 'Other', paras(300, 'z'))]);
    let r = await inspect(page);
    expect(r.nested).toEqual([]);
    expect(r.bodies.find((b) => b.title === 'Outer')!.auto).toBe(false);
    expect(r.bodies.find((b) => b.title === 'Inner')!.auto).toBe(true);
    // Remove the inner region: the outer body becomes a leaf.
    await page.evaluate(async () => {
      const eng = (window as any).nabu;
      const outer = eng.children[0];
      eng.delete(outer.children.find((c: any) => c.type === 'region'));
      await eng.commit();
    });
    await page.waitForFunction(() => !document.querySelector('.nabu-region .nabu-region'));
    r = await inspect(page);
    expect(r.nested).toEqual([]);
    expect(r.bodies.find((b) => b.title === 'Outer')!.auto).toBe(true);
  });

  test('a small document (< 800 blocks): nothing is auto', async ({ page }) => {
    test.setTimeout(60000);
    await build(page, [region(1, 'A', [region(2, 'B', paras(100, 'b'))]), region(1, 'C', paras(100, 'c'))]);
    const r = await inspect(page);
    expect(r.large).toBe(false);
    expect(r.autoCount).toBe(0);
  });
});
