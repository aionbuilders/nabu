/**
 * E2E — P-50 / P-52: pasting in context.
 *
 * DECIDED:
 *  - caret in the BODY of a toggle: whatever is pasted (paragraphs, lists, headings, code, nested toggles…) lands INSIDE the body at
 *    the caret, never at the parent level; a partial first / last block merges with the head / tail of the caret block as usual;
 *  - caret in the HEADER of a toggle: the first block completes the header at the caret, the other blocks go to the TOP of the body
 *    (like Enter in the header creates the first body child), the header text after the caret follows the last pasted block (merged into
 *    it when it is text, else in a new paragraph); a COLLAPSED toggle is EXPANDED (the content would land hidden); one text block stays
 *    an inline merge (a collapsed toggle stays collapsed);
 *  - multi-block paste in the middle of a text-only block (heading, quote, dialogue, callout): the head stays (the first block merges into
 *    it), the pasted blocks follow, the text after the caret continues in a block of the ORIGINAL type (the last pasted block merges into
 *    it when it is text: cut at the edge of a partial copy, or a paragraph); without a tail the last pasted block keeps its own type;
 *  - `application/x-nabu+json` carries `version: 1`; a version-less fragment reads as 1; an unknown (newer) version is declined and the
 *    paste falls back to the next format of the clipboard (text/html);
 *  - a block type the editor does not know becomes a paragraph with its text, its children are kept as blocks right after it.
 *
 * (Unknown types from a MinimalPreset editor: presets are not JSON-able through `?options=`; covered at the unit level.)
 * Internal fragments are dispatched as a synthetic `paste` event; every test ends with Ctrl+Z / Ctrl+Y and no console error.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, clearAndReset } from './helpers/editor.js';
import { undo, redo } from './helpers/keyboard.js';
import { pressClip } from './helpers/clip-capture.js';
import { caret, violations, focusAt, focusEnd, focusEmpty, collectErrors } from './helpers/model.js';
import { buildTree, tree, flat, buildBlocks, Tog, Pp, Para, H, Q, C, D } from './helpers/blocks.js';

const expectTree = (page: Page, expected: string) =>
  expect.poll(() => tree(page), { timeout: 3000, message: 'model tree' }).toBe(expected);
const expectFlat = (page: Page, expected: string) =>
  expect.poll(() => flat(page), { timeout: 3000, message: 'model outline' }).toBe(expected);
const expectCaret = (page: Page, expected: string | null) =>
  expect.poll(() => caret(page), { timeout: 3000, message: 'caret' }).toBe(expected);
/**
 * Structural validity. A COLLAPSED toggle does not render its body, so the DOM-count checks are skipped for it; the list
 * helper's "lists only at root or under an item" rule predates the toggle body (a list in a toggle is fine).
 */
async function expectValid(page: Page) {
  const v = await violations(page);
  expect(v).toEqual([]);
}

/** Dispatch a paste carrying the given clipboard payloads at the caret. */
async function pasteData(page: Page, data: Record<string, string>) {
  await page.evaluate((payload) => {
    const dt = new DataTransfer();
    for (const [format, value] of Object.entries(payload)) dt.setData(format, value);
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, data);
}
/** Dispatch an internal `application/x-nabu+json` fragment (`version: 1` unless `extra` says otherwise). */
const pasteFragment = (page: Page, blocks: any[], extra: Record<string, any> = { version: 1 }) =>
  pasteData(page, { 'application/x-nabu+json': JSON.stringify({ ...extra, blocks }) });

// pasted-fragment builders
const pPara = (text: string, partial: any = false) => ({ type: 'paragraph', partial, delta: [{ insert: text }] });
const pHead = (text: string, level = 1) => ({ type: 'heading', partial: false, props: { level }, delta: [{ insert: text }] });
const pCode = (text: string) => ({ type: 'code', partial: false, props: {}, delta: [{ insert: text }] });
const pItem = (text: string) => ({ type: 'list-item', partial: false, delta: [{ insert: text }] });
const pList = (...items: string[]) => ({ type: 'list', partial: false, props: { listType: 'bullet' }, children: items.map(pItem) });
const pToggle = (text: string, children: any[] = [], collapsed = false) =>
  ({ type: 'toggle', partial: false, props: { collapsed }, delta: [{ insert: text }], ...(children.length ? { children } : {}) });
const pZzz = (text: string, children?: any[]) =>
  ({ type: 'zzz', partial: false, props: { weird: 1 }, delta: [{ insert: text }], ...(children ? { children } : {}) });

const LIST_AB = 'list(∅){list-item(a) list-item(b)}';

let errors: ReturnType<typeof collectErrors>;

test.beforeEach(async ({ page }) => {
  errors = collectErrors(page);
  await gotoEditor(page);
  await clearAndReset(page);
});

test.afterEach(async () => {
  expect(errors.list(), 'console / page errors').toEqual([]);
});

/** One undo gives back `before`, one redo gives `after`. */
async function undoRedo(page: Page, before: string, after: string) {
  await undo(page);
  await expectTree(page, before);
  await expectValid(page);
  await redo(page);
  await expectTree(page, after);
  await expectValid(page);
}

// ═══════════════════════════════════════════════════════════════════════════
// A. Caret in the BODY of a toggle
// ═══════════════════════════════════════════════════════════════════════════

test.describe('A · pasting into the body of a toggle', () => {
  test('1 · [p, list, h, code] land INSIDE the body at the caret; the text after the caret follows in a paragraph; one undo', async ({ page }) => {
    await buildTree(page, [Tog('Tg', [Pp('b1'), Pp('b2')]), Pp('after')]);
    await focusAt(page, 'b1', 1);
    await pasteFragment(page, [pPara('x1', 'start'), pList('a', 'b'), pHead('H'), pCode('cc')]);
    const after = `toggle▾(Tg){p(bx1) list(∅){list-item(a) list-item(b)} h1(H) code(cc) p(1) p(b2)} ; p(after)`;
    await expectTree(page, after);
    await expectCaret(page, '|1');
    await expectValid(page);
    await undoRedo(page, 'toggle▾(Tg){p(b1) p(b2)} ; p(after)', after);
  });

  test('2 · a partial LAST block merges with the tail of the caret block; the caret sits at the junction', async ({ page }) => {
    await buildTree(page, [Tog('Tg', [Pp('b1')])]);
    await focusAt(page, 'b1', 1);
    await pasteFragment(page, [pPara('x1', 'start'), pHead('H'), pPara('z9', 'end')]);
    await expectTree(page, 'toggle▾(Tg){p(bx1) h1(H) p(z91)}');
    await expectCaret(page, 'z9|1');
    await expectValid(page);
  });

  test('3 · a toggle pasted into the body is a NESTED toggle, with its own body', async ({ page }) => {
    await buildTree(page, [Tog('Tg', [Pp('b1')])]);
    await focusEnd(page, 'b1');
    await pasteFragment(page, [pPara('x'), pToggle('Inner', [pPara('i1'), pPara('i2')])]);
    const after = 'toggle▾(Tg){p(b1x) toggle▾(Inner){p(i1) p(i2)}}';
    await expectTree(page, after);
    await expectValid(page);
    await undoRedo(page, 'toggle▾(Tg){p(b1)}', after);
  });

  test('4 · a childless toggle alone, into an EMPTY body paragraph, replaces it (nested toggle)', async ({ page }) => {
    await buildTree(page, [Tog('Tg', [Pp('')])]);
    await focusEmpty(page);
    await pasteFragment(page, [pToggle('Solo')]);
    await expectTree(page, 'toggle▾(Tg){toggle▾(Solo)}');
    await expectValid(page);
    await undo(page);
    await expectTree(page, 'toggle▾(Tg){p(∅)}');
  });

  test('5 · a heading pasted alone into an empty body paragraph makes it a heading, inside the body', async ({ page }) => {
    await buildTree(page, [Tog('Tg', [Pp(''), Pp('b2')])]);
    await focusEmpty(page);
    await pasteFragment(page, [pHead('Title', 2)]);
    await expectTree(page, 'toggle▾(Tg){h2(Title) p(b2)}');
    await expectCaret(page, 'Title|');
    await expectValid(page);
  });

  test('6 · markdown (real paste path) pasted in the body stays in the body: the first block merges, the list follows inside', async ({ page }) => {
    await buildTree(page, [Tog('Tg', [Pp('b1')]), Pp('after')]);
    await focusEnd(page, 'b1');
    await pasteData(page, { 'text/plain': 'intro\n\n- one\n- two\n\n# Title' });
    await expectTree(page, 'toggle▾(Tg){p(b1intro) list(∅){list-item(one) list-item(two)} h1(Title)} ; p(after)');
    await expectValid(page);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. Caret in the HEADER of a toggle
// ═══════════════════════════════════════════════════════════════════════════

test.describe('B · pasting into the header of a toggle', () => {
  test('7 · expanded: the first block completes the header, the others open the body, the tail merges into the last text; one undo', async ({ page }) => {
    await buildTree(page, [Tog('Hdr', [Pp('b1')]), Pp('after')]);
    await focusAt(page, 'Hdr', 2);
    await pasteFragment(page, [pPara('x1', 'start'), pPara('x2'), pPara('x3', 'end')]);
    const after = 'toggle▾(Hdx1){p(x2) p(x3r) p(b1)} ; p(after)';
    await expectTree(page, after);
    await expectCaret(page, 'x3|r');
    await expectValid(page);
    await undoRedo(page, 'toggle▾(Hdr){p(b1)} ; p(after)', after);
  });

  test('8 · a non-text last block: the tail becomes its own paragraph right after it, caret at its start', async ({ page }) => {
    await buildTree(page, [Tog('Hdr', [Pp('b1')])]);
    await focusAt(page, 'Hdr', 2);
    await pasteFragment(page, [pPara('x1'), pList('a', 'b')]);
    await expectTree(page, `toggle▾(Hdx1){${LIST_AB} p(r) p(b1)}`);
    await expectCaret(page, '|r');
    await expectValid(page);
  });

  test('9 · at the END of the header there is no tail', async ({ page }) => {
    await buildTree(page, [Tog('Hdr', [Pp('b1')])]);
    await focusEnd(page, 'Hdr');
    await pasteFragment(page, [pPara('x1'), pHead('H')]);
    await expectTree(page, 'toggle▾(Hdrx1){h1(H) p(b1)}');
    await expectCaret(page, 'H|');
    await expectValid(page);
  });

  test('10 · a first block that is not text (a list) leaves the header alone and opens the body', async ({ page }) => {
    await buildTree(page, [Tog('Hdr', [Pp('b1')])]);
    await focusEnd(page, 'Hdr');
    await pasteFragment(page, [pList('a'), pPara('z')]);
    await expectTree(page, 'toggle▾(Hdr){list(∅){list-item(a)} p(z) p(b1)}');
    await expectValid(page);
  });

  test('11 · COLLAPSED: the toggle is EXPANDED (the content would land hidden); one undo collapses it back', async ({ page }) => {
    await buildTree(page, [Tog('Hdr', [Pp('b1')], true), Pp('after')]);
    await focusAt(page, 'Hdr', 2);
    await pasteFragment(page, [pPara('x1'), pPara('x2')]);
    const after = 'toggle▾(Hdx1){p(x2r) p(b1)} ; p(after)';
    await expectTree(page, after);
    await expect(page.locator('.nabu-toggle-body')).toHaveCount(1);
    await expect(page.locator('.nabu-toggle-arrow').first()).toHaveAttribute('aria-expanded', 'true');
    await expectCaret(page, 'x2|r');
    await expectValid(page);
    await undo(page);
    await expectTree(page, 'toggle▸(Hdr){p(b1)} ; p(after)');
    await expect(page.locator('.nabu-toggle-body')).toHaveCount(0);
    await redo(page);
    await expectTree(page, after);
  });

  test('12 · ONE text block into a collapsed header is an inline merge: it stays collapsed', async ({ page }) => {
    await buildTree(page, [Tog('Hdr', [Pp('b1')], true)]);
    await focusAt(page, 'Hdr', 2);
    await pasteFragment(page, [pPara('x1')]);
    await expectTree(page, 'toggle▸(Hdx1r){p(b1)}');
    await expectCaret(page, 'Hdx1|r');
    await expectValid(page);
  });

  test('13 · multi-line plain text (real paste path) into the header', async ({ page }) => {
    await buildTree(page, [Tog('Hdr', [Pp('b1')])]);
    await focusAt(page, 'Hdr', 2);
    await pasteData(page, { 'text/plain': 'x1\nx2\nx3' });
    await expectTree(page, 'toggle▾(Hdx1){p(x2) p(x3r) p(b1)}');
    await expectValid(page);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. Text-only blocks
// ═══════════════════════════════════════════════════════════════════════════

test.describe('C · multi-block paste in the middle of a text-only block', () => {
  const CASES = [
    { name: 'heading', spec: () => H('Title', 2), fmt: (t: string) => `h2(${t})` },
    { name: 'blockquote', spec: () => Q('Title'), fmt: (t: string) => `q(${t})` },
    { name: 'dialogue', spec: () => D('Title'), fmt: (t: string) => `dialogue(${t})` },
    { name: 'callout', spec: () => C('Title'), fmt: (t: string) => `callout:note(${t})` },
  ];
  for (const { name, spec, fmt } of CASES) {
    test(`${name} · head + first block, middle block, then the tail continues in a ${name}; one undo`, async ({ page }) => {
      await buildBlocks(page, [spec(), Para('after')]);
      await focusAt(page, 'Title', 2);
      await pasteFragment(page, [pPara('p1', 'start'), pPara('p2'), pPara('p3', 'end')]);
      const after = `${fmt('Tip1')} ; p(p2) ; ${fmt('p3tle')} ; p(after)`;
      await expectFlat(page, after);
      await expectCaret(page, 'p3|tle');
      await expectValid(page);
      await undo(page);
      await expectFlat(page, `${fmt('Title')} ; p(after)`);
      await redo(page);
      await expectFlat(page, after);
    });

    test(`${name} · a non-text last block is kept as it is, the tail follows in a ${name}`, async ({ page }) => {
      await buildBlocks(page, [spec()]);
      await focusAt(page, 'Title', 2);
      await pasteFragment(page, [pPara('p1'), pHead('H', 3)]);
      await expectFlat(page, `${fmt('Tip1')} ; h3(H) ; ${fmt('tle')}`);
      await expectCaret(page, '|tle');
      await expectValid(page);
    });
  }

  test('at the END of a heading there is no tail: the last pasted block keeps its own type', async ({ page }) => {
    await buildBlocks(page, [H('Title', 2)]);
    await focusEnd(page, 'Title');
    await pasteFragment(page, [pPara('p1'), pPara('p2')]);
    await expectFlat(page, 'h2(Titlep1) ; p(p2)');
    await expectCaret(page, 'p2|');
  });

  test('a paragraph keeps its kind on both sides (unchanged)', async ({ page }) => {
    await buildBlocks(page, [Para('Title')]);
    await focusAt(page, 'Title', 2);
    await pasteFragment(page, [pPara('p1'), pPara('p2')]);
    await expectFlat(page, 'p(Tip1) ; p(p2tle)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D. Format versioning
// ═══════════════════════════════════════════════════════════════════════════

test.describe('D · application/x-nabu+json versioning', () => {
  test('copy writes `version: 1`', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await focusAt(page, 'abc', 0);
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const b = n.children[0];
      await n.focus({ from: { block: b, offset: 0 }, to: { block: b, offset: 3 } });
    });
    const ev = await pressClip(page, 'Control+c');
    expect(ev.nabu?.version).toBe(1);
    expect(ev.nabu?.blocks).toHaveLength(1);
  });

  test('a version-1 fragment and a version-less fragment paste the same', async ({ page }) => {
    const blocks = [pPara('a'), pPara('b')];
    await buildBlocks(page, [Para('xy')]);
    await focusAt(page, 'xy', 1);
    await pasteFragment(page, blocks, { version: 1 });
    await expectFlat(page, 'p(xa) ; p(by)');
    await expectCaret(page, 'b|y');

    await buildBlocks(page, [Para('xy')]);
    await focusAt(page, 'xy', 1);
    await pasteFragment(page, blocks, {});
    await expectFlat(page, 'p(xa) ; p(by)');
    await expectCaret(page, 'b|y');
    await expectValid(page);
  });

  test('a `version: 99` fragment is not mis-parsed: the paste falls back to text/html', async ({ page }) => {
    await buildBlocks(page, [Para('xy')]);
    await focusAt(page, 'xy', 1);
    await pasteData(page, {
      'application/x-nabu+json': JSON.stringify({ version: 99, blocks: [pPara('FUTURE1'), pPara('FUTURE2')] }),
      'text/html': '<p>H1</p><p>H2</p>',
      'text/plain': 'H1\n\nH2',
    });
    await expectFlat(page, 'p(xH1) ; p(H2y)');
    await expectValid(page);
    await undo(page);
    await expectFlat(page, 'p(xy)');
  });

  test('a `version: 99` fragment with nothing else on the clipboard inserts nothing', async ({ page }) => {
    await buildBlocks(page, [Para('xy')]);
    await focusAt(page, 'xy', 1);
    await pasteFragment(page, [pPara('FUTURE')], { version: 99 });
    await expectFlat(page, 'p(xy)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E. Unknown block types
// ═══════════════════════════════════════════════════════════════════════════

test.describe('E · a block type the editor does not know is degraded, never dropped', () => {
  test('an unknown container: a paragraph with its text, its children kept as blocks right after it', async ({ page }) => {
    await buildTree(page, [Pp('xy')]);
    await focusEnd(page, 'xy');
    await pasteFragment(page, [pPara('a'), pZzz('Z', [pPara('c1'), pZzz('c2', [pPara('c3')])])]);
    const after = 'p(xya) ; p(Z) ; p(c1) ; p(c2) ; p(c3)';
    await expectTree(page, after);
    await expectValid(page);
    await undoRedo(page, 'p(xy)', after);
  });

  test('inside a toggle body the unknown block and its children stay in the body', async ({ page }) => {
    await buildTree(page, [Tog('Tg', [Pp('b1')])]);
    await focusEnd(page, 'b1');
    await pasteFragment(page, [pPara('a'), pZzz('Z', [pPara('c1')])]);
    await expectTree(page, 'toggle▾(Tg){p(b1a) p(Z) p(c1)}');
    await expectValid(page);
  });

  test('an unknown child of a known container is degraded in place', async ({ page }) => {
    await buildTree(page, [Pp('')]);
    await focusEmpty(page);
    await pasteFragment(page, [pPara('a'), pToggle('T', [pZzz('Z', [pPara('c1')])])]);
    await expectTree(page, 'p(a) ; toggle▾(T){p(Z) p(c1)}');
    await expectValid(page);
  });

  test('a single unknown leaf pasted inline keeps its text', async ({ page }) => {
    await buildTree(page, [Pp('xy')]);
    await focusAt(page, 'xy', 1);
    await pasteFragment(page, [pZzz('Z')]);
    await expectTree(page, 'p(xZy)');
    await expectCaret(page, 'xZ|y');
  });
});
