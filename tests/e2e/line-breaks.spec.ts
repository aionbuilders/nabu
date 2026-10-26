/**
 * E2E — a line break at the END of a text block must be VISIBLE at once.
 *
 * `white-space: pre-wrap` gives no line box to a trailing "\n" ("abc\n" renders as one line), so one Shift+Enter at the end
 * of a paragraph used to show nothing — it took two. RichText / Code now render a filler `<br data-nabu-filler>` after a
 * text ending with "\n". The filler is rendering only: not text (offsets unchanged), not in the model, not in the clipboard.
 *
 * Visibility is measured on the real layout: the block height grows by about one line, the native caret sits BELOW the first
 * line, and what is typed next lands on the second line.
 */

import { test, expect, type Page } from './helpers/test.js';
import { gotoEditor, clearAndReset, press } from './helpers/editor.js';
import { caret, violations, focusEnd, collectErrors, allText, selectRange } from './helpers/model.js';
import { buildBlocks, buildTree, flat, tree, Para, H, C, Q, Code } from './helpers/blocks.js';
import { copy } from './helpers/clip-capture.js';

let errors: ReturnType<typeof collectErrors>;

test.beforeEach(async ({ page }) => {
  errors = collectErrors(page);
  await gotoEditor(page);
  await clearAndReset(page);
});

test.afterEach(async () => {
  expect(errors.list(), 'console / page errors').toEqual([]);
});

// ── helpers ────────────────────────────────────────────────────────────────

/** Height of the (only) text block element. */
const blockHeight = (page: Page, type: string) =>
  page.evaluate((t) => document.querySelector(`[data-block-type="${t}"]`)!.getBoundingClientRect().height, type);

/** Computed line height of the block (px). */
const lineHeight = (page: Page, type: string) =>
  page.evaluate((t) => {
    const el = document.querySelector(`[data-block-type="${t}"]`)!;
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight);
    return Number.isFinite(lh) ? lh : parseFloat(cs.fontSize) * 1.2;
  }, type);

/** Top of the first text line of the block (its own rect top). */
const blockTop = (page: Page, type: string) =>
  page.evaluate((t) => {
    const el = document.querySelector(`[data-block-type="${t}"]`)!;
    return el.getBoundingClientRect().top + parseFloat(getComputedStyle(el).paddingTop);
  }, type);

/** Number of rendered fillers in the whole editor. */
const fillers = (page: Page) => page.evaluate(() => document.querySelectorAll('[data-nabu-filler]').length);

/** DOM text of the block (what the browser exposes as text: fillers are not text), and the model text. */
async function domVsModel(page: Page) {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    return [...document.querySelectorAll('[data-block-id]')].map((el) => {
      const b = n.blocks.get(el.getAttribute('data-block-id'));
      const tb = b?.behaviors?.get('text');
      if (!tb) return null;
      const range = document.createRange();
      range.selectNodeContents((el as Element));
      // An empty block renders a lone "\n" placeholder text node (no model text).
      const dom = tb.text === '' ? '' : range.toString();
      return { dom, model: tb.text as string };
    }).filter(Boolean);
  });
}

async function expectConsistent(page: Page) {
  expect(await violations(page)).toEqual([]);
  for (const x of (await domVsModel(page)) as any[]) expect(x.dom).toBe(x.model);
}

async function startParagraph(page: Page, text: string) {
  await buildBlocks(page, [Para(text)]);
  await focusEnd(page, text);
}

// ═══════════════════════════════════════════════════════════════════════════

test.describe('paragraph', () => {
  test('1 · ONE Shift+Enter at the end shows a new line, the caret is on it, typing lands there', async ({ page }) => {
    await startParagraph(page, 'abc');
    const h0 = await blockHeight(page, 'paragraph');
    const lh = await lineHeight(page, 'paragraph');
    const top = await blockTop(page, 'paragraph');

    await press(page, 'Shift+Enter');
    await expect.poll(() => flat(page)).toBe('p(abc\\n)');
    await expect.poll(() => fillers(page)).toBe(1);
    await expect.poll(() => caret(page)).toBe('abc\n|');

    // the block grew by about one line
    const h1 = await blockHeight(page, 'paragraph');
    expect(h1).toBeGreaterThan(h0 + lh * 0.8);
    expect(h1).toBeLessThan(h0 + lh * 1.2);

    // (the native caret itself cannot be measured — a collapsed range has no client rect — but it was checked on a
    // `screenshot({ caret: 'initial' })` to sit on the second line; what is typed next is asserted below)

    await page.keyboard.type('d');
    await expect.poll(() => flat(page)).toBe('p(abc\\nd)');
    await expect.poll(() => fillers(page)).toBe(0);
    // "d" is rendered on the second line
    const dTop = await page.evaluate(() => {
      const el = document.querySelector('[data-block-type="paragraph"]')!;
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = w.nextNode())) {
        const i = node.textContent!.indexOf('d');
        if (i >= 0) { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); return r.getBoundingClientRect().top; }
      }
      return null;
    });
    expect(dTop!).toBeGreaterThan(top + lh * 0.8);
    await expect.poll(() => caret(page)).toBe('abc\nd|');
    await expectConsistent(page);
  });

  test('2 · two Shift+Enter give two new lines', async ({ page }) => {
    await startParagraph(page, 'abc');
    const h0 = await blockHeight(page, 'paragraph');
    const lh = await lineHeight(page, 'paragraph');
    await press(page, 'Shift+Enter');
    await press(page, 'Shift+Enter');
    await expect.poll(() => flat(page)).toBe('p(abc\\n\\n)');
    await expect.poll(() => caret(page)).toBe('abc\n\n|');
    const h2 = await blockHeight(page, 'paragraph');
    expect(h2).toBeGreaterThan(h0 + lh * 1.8);
    expect(h2).toBeLessThan(h0 + lh * 2.2);
    await page.keyboard.type('x');
    await expect.poll(() => flat(page)).toBe('p(abc\\n\\nx)');
    await expectConsistent(page);
  });

  test('3 · Backspace after a single Shift+Enter removes it and the extra line disappears', async ({ page }) => {
    await startParagraph(page, 'abc');
    const h0 = await blockHeight(page, 'paragraph');
    await press(page, 'Shift+Enter');
    await expect.poll(() => fillers(page)).toBe(1);
    await press(page, 'Backspace');
    await expect.poll(() => flat(page)).toBe('p(abc)');
    await expect.poll(() => fillers(page)).toBe(0);
    await expect.poll(() => caret(page)).toBe('abc|');
    expect(await blockHeight(page, 'paragraph')).toBeCloseTo(h0, 0);
    await page.keyboard.type('Z');
    await expect.poll(() => flat(page)).toBe('p(abcZ)');
    await expectConsistent(page);
  });

  test('4 · a newline in the MIDDLE has no filler; ArrowLeft/Right across the trailing break keeps the model offsets', async ({ page }) => {
    await buildBlocks(page, [Para('ab\ncd')]);
    expect(await fillers(page)).toBe(0);
    await startParagraph(page, 'abc');
    await press(page, 'Shift+Enter');
    await expect.poll(() => caret(page)).toBe('abc\n|');
    await press(page, 'ArrowLeft');
    await expect.poll(() => caret(page)).toBe('abc|\n');
    await press(page, 'ArrowRight');
    await expect.poll(() => caret(page)).toBe('abc\n|');
    await page.keyboard.type('q');
    await expect.poll(() => flat(page)).toBe('p(abc\\nq)');
    await expectConsistent(page);
  });

  test('5 · an empty paragraph renders no filler (its lone "\\n" node is one line already); a text that is only "\\n" gets one', async ({ page }) => {
    await buildBlocks(page, [Para('')]);
    expect(await fillers(page)).toBe(0);
    await buildBlocks(page, [Para('\n')]);
    expect(await fillers(page)).toBe(1);
    expect(await blockHeight(page, 'paragraph')).toBeGreaterThan((await lineHeight(page, 'paragraph')) * 1.8);
  });

  test('6 · copying "abc\\n" does not carry the filler (text/plain, text/html, fragment)', async ({ page }) => {
    await startParagraph(page, 'abc');
    await press(page, 'Shift+Enter');
    await expect.poll(() => fillers(page)).toBe(1);
    await selectRange(page, 'abc\n', 0, 'abc\n', 4);
    const ev = await copy(page);
    expect(ev.text).toBe('abc\n');
    expect(ev.html).not.toContain('data-nabu-filler');
    expect(JSON.stringify(ev.nabu)).not.toContain('filler');
    expect(await allText(page)).toEqual(['abc\n']);
  });

  test('7 · a marked trailing newline (bold "abc\\n") still gets the filler', async ({ page }) => {
    await buildBlocks(page, [Para('abc\n')]);
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const b: any = [...n.blocks.values()].find((x: any) => x.behaviors?.get('text')?.text === 'abc\n');
      b.behaviors.get('text').container.mark({ start: 0, end: 4 }, 'bold', true);
      await n.commit();
    });
    await expect.poll(() => fillers(page)).toBe(1);
    await expectConsistent(page);
  });
});

test.describe('other blocks', () => {
  test('8 · Code: Enter at the end shows the new line at once', async ({ page }) => {
    await buildTree(page, [Code('abc')]);
    await focusEnd(page, 'abc');
    const h0 = await blockHeight(page, 'code');
    const lh = await lineHeight(page, 'code');
    await press(page, 'Enter');
    await expect.poll(() => tree(page)).toBe('code(abc\\n)');
    await expect.poll(() => fillers(page)).toBe(1);
    const h1 = await blockHeight(page, 'code');
    expect(h1).toBeGreaterThan(h0 + lh * 0.8);
    await page.keyboard.type('d');
    await expect.poll(() => caret(page)).toBe('abc\nd|');
    await expect.poll(() => fillers(page)).toBe(0);
    await press(page, 'Enter');
    await press(page, 'Backspace');
    await expect.poll(() => caret(page)).toBe('abc\nd|');
    await expectConsistent(page);
  });

  test('9 · Callout: Enter at the end shows the new line at once; Backspace removes it', async ({ page }) => {
    await buildBlocks(page, [C('abc')]);
    await focusEnd(page, 'abc');
    const h0 = await blockHeight(page, 'callout');
    const lh = await lineHeight(page, 'callout');
    await press(page, 'Enter');
    await expect.poll(() => flat(page)).toBe('callout:note(abc\\n)');
    await expect.poll(() => fillers(page)).toBe(1);
    expect(await blockHeight(page, 'callout')).toBeGreaterThan(h0 + lh * 0.8);
    await page.keyboard.type('d');
    await expect.poll(() => caret(page)).toBe('abc\nd|');
    await press(page, 'Backspace');
    await press(page, 'Backspace');
    await expect.poll(() => flat(page)).toBe('callout:note(abc)');
    expect(await blockHeight(page, 'callout')).toBeCloseTo(h0, 0);
    await expectConsistent(page);
  });

  test('10 · Heading: Shift+Enter at the end shows the new line at once', async ({ page }) => {
    await buildBlocks(page, [H('abc', 2)]);
    await focusEnd(page, 'abc');
    const h0 = await blockHeight(page, 'heading');
    await press(page, 'Shift+Enter');
    await expect.poll(() => flat(page)).toBe('h2(abc\\n)');
    await expect.poll(() => fillers(page)).toBe(1);
    expect(await blockHeight(page, 'heading')).toBeGreaterThan(h0 * 1.6);
    await page.keyboard.type('d');
    await expect.poll(() => flat(page)).toBe('h2(abc\\nd)');
    await expectConsistent(page);
  });

  test('11 · Quote: Shift+Enter at the end shows the new line at once', async ({ page }) => {
    await buildBlocks(page, [Q('abc')]);
    await focusEnd(page, 'abc');
    const h0 = await blockHeight(page, 'blockquote');
    await press(page, 'Shift+Enter');
    await expect.poll(() => fillers(page)).toBe(1);
    expect(await blockHeight(page, 'blockquote')).toBeGreaterThan(h0 * 1.6);
    await page.keyboard.type('d');
    await expect.poll(() => flat(page)).toBe('q(abc\\nd)');
    await expectConsistent(page);
  });
});

test.describe('caret and IME around the filler', () => {
  test('12 · ArrowDown from the first line onto the empty last line stays in the block, typing lands there', async ({ page }) => {
    await buildBlocks(page, [Para('abc\n'), Para('next')]);
    await focusEnd(page, 'abc\n');
    await press(page, 'ArrowLeft');
    await expect.poll(() => caret(page)).toBe('abc|\n');
    await press(page, 'ArrowDown');
    await expect.poll(() => caret(page)).toBe('abc\n|');
    await page.keyboard.type('x');
    await expect.poll(() => flat(page)).toBe('p(abc\\nx) ; p(next)');
    await expectConsistent(page);
  });

  test('13 · IME composition on the empty last line (after a trailing newline) lands there', async ({ page }) => {
    await startParagraph(page, 'abc');
    await press(page, 'Shift+Enter');
    await expect.poll(() => caret(page)).toBe('abc\n|');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.imeSetComposition', { text: 'かな', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.insertText', { text: 'かな' });
    await expect.poll(() => flat(page)).toBe('p(abc\\nかな)');
    await expect.poll(() => caret(page)).toBe('abc\nかな|');
    await expect.poll(() => fillers(page)).toBe(0);
    await expectConsistent(page);
  });

  test('14 · a CANCELED composition on the empty last line leaves the line (and its filler) in place', async ({ page }) => {
    await startParagraph(page, 'abc');
    await press(page, 'Shift+Enter');
    const h1 = await blockHeight(page, 'paragraph');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
    await expect.poll(() => flat(page)).toBe('p(abc\\n)');
    await expect.poll(() => fillers(page)).toBe(1);
    expect(await blockHeight(page, 'paragraph')).toBeCloseTo(h1, 0);
    await page.keyboard.type('z');
    await expect.poll(() => flat(page)).toBe('p(abc\\nz)');
    await expectConsistent(page);
  });
});
