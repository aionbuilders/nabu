/**
 * E2E — deleting a selection that spans SEVERAL blocks (P-44): Backspace / Delete, typing over it, Enter over it,
 * cut, and paste back. They all go through one implementation (`deleteRange`, container.utils.js).
 *
 * Guarantees asserted on the MODEL (outline / tree), never the DOM: valid tree (`violations`), document order
 * preserved for everything outside the selection (the rest of a partially selected sublist stays where it was),
 * head of the start block + tail of the end block merged at the caret, one undo step that restores everything.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, clearAndReset, press } from './helpers/editor.js';
import { undo, redo, selectAll } from './helpers/keyboard.js';
import {
  buildDoc, I, UL, P, outline, caret, violations, allText, focusAt, selectRange, collectErrors,
} from './helpers/model.js';
import { buildTree, Code, Tog, Pp, type TreeSpec } from './helpers/blocks.js';
import { cut } from './helpers/clip-capture.js';

let errors: ReturnType<typeof collectErrors>;

test.beforeEach(async ({ page }) => {
  errors = collectErrors(page);
  await gotoEditor(page);
  await clearAndReset(page);
});

test.afterEach(async () => {
  expect(errors.list(), 'console / page errors').toEqual([]);
});

const ORIGINAL = 'ul[x, a > ul[s1, s2, s3], z]';
const nested = (page: Page) => buildDoc(page, [UL(I('x'), I('a', UL(I('s1'), I('s2'), I('s3'))), I('z'))]);

/** Paste an internal nabu fragment (as written by cut / copy) at the current selection. */
async function pasteFragment(page: Page, raw: string) {
  await page.evaluate((r) => {
    const dt = new DataTransfer();
    dt.setData('application/x-nabu+json', r);
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, raw);
}

// ═══════════════════════════════════════════════════════════════════════════
// A. Backspace / Delete / typing / Enter over a selection crossing nested-list levels
// ═══════════════════════════════════════════════════════════════════════════

test.describe('A · replacing a cross-level selection', () => {
  test('1 · Backspace over x@1 -> s2@1: "x2", then s3, then z (order kept), one undo restores', async ({ page }) => {
    await nested(page);
    await selectRange(page, 'x', 1, 's2', 1);
    await press(page, 'Backspace');
    await expect.poll(() => outline(page)).toBe('ul[x2, s3, z]');
    expect(await violations(page)).toEqual([]);
    expect(await caret(page)).toBe('x|2');

    await undo(page);
    await expect.poll(() => outline(page)).toBe(ORIGINAL);
    expect(await violations(page)).toEqual([]);
  });

  test('2 · Delete over the same selection behaves like Backspace', async ({ page }) => {
    await nested(page);
    await selectRange(page, 'x', 1, 's2', 1);
    await press(page, 'Delete');
    await expect.poll(() => outline(page)).toBe('ul[x2, s3, z]');
    expect(await violations(page)).toEqual([]);
    expect(await caret(page)).toBe('x|2');
  });

  test('3 · typing "X" over the same selection: "xX2", s3 still before z, caret after the X', async ({ page }) => {
    await nested(page);
    await selectRange(page, 'x', 1, 's2', 1);
    await page.keyboard.type('X');
    await expect.poll(() => outline(page)).toBe('ul[xX2, s3, z]');
    expect(await violations(page)).toEqual([]);
    expect(await caret(page)).toBe('xX|2');
    await page.keyboard.type('Y');
    expect(await outline(page)).toBe('ul[xXY2, s3, z]');
  });

  test('4 · Enter over the same selection splits at the junction, the order is kept', async ({ page }) => {
    await nested(page);
    await selectRange(page, 'x', 1, 's2', 1);
    await press(page, 'Enter');
    await expect.poll(() => outline(page)).toBe('ul[x, 2, s3, z]');
    expect(await violations(page)).toEqual([]);
    expect(await caret(page)).toBe('|2');
    await undo(page);
    await expect.poll(() => outline(page)).toBe(ORIGINAL);
  });

  const cases: Array<[string, number, string, number, string]> = [
    // [from block, offset, to block, offset, expected outline after Backspace]
    ['x', 1, 's2', 1, 'ul[x2, s3, z]'],
    ['a', 0, 'z', 1, 'ul[x, ∅]'],
    ['s1', 1, 's3', 1, 'ul[x, a > ul[s3], z]'],
    ['a', 1, 's2', 1, 'ul[x, a2 > ul[s3], z]'], // the start block is the ancestor of the end block: the rest of its body stays under it
    ['x', 0, 's3', 2, 'ul[∅, z]'],
    ['s2', 1, 'z', 0, 'ul[x, a > ul[s1, sz]]'],
  ];
  for (const [fb, fo, tb, to, expected] of cases) {
    test(`5 · Backspace ${fb}@${fo} -> ${tb}@${to}: ${expected}`, async ({ page }) => {
      await nested(page);
      await selectRange(page, fb, fo, tb, to);
      await press(page, 'Backspace');
      await expect.poll(() => outline(page)).toBe(expected);
      expect(await violations(page)).toEqual([]);
      await undo(page);
      await expect.poll(() => outline(page)).toBe(ORIGINAL);
      expect(await violations(page)).toEqual([]);
    });
  }

  test('6 · different roots: paragraph -> item of another list; the rest of that list follows, in order', async ({ page }) => {
    await buildDoc(page, [P('abc'), UL(I('a1'), I('b1'), I('c1'))]);
    await selectRange(page, 'abc', 1, 'b1', 1);
    await press(page, 'Backspace');
    await expect.poll(() => outline(page)).toBe('p(a1) ; ul[c1]');
    expect(await violations(page)).toEqual([]);
    expect(await caret(page)).toBe('a|1');
    await undo(page);
    await expect.poll(() => outline(page)).toBe('p(abc) ; ul[a1, b1, c1]');
  });

  test('7 · two lists with a paragraph between: survivors of the second list join the first', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I('b'), I('c')), P('mid'), UL(I('d'), I('e'), I('f'))]);
    await selectRange(page, 'b', 1, 'e', 0);
    await press(page, 'Backspace');
    await expect.poll(() => outline(page)).toBe('ul[a, be, f]');
    expect(await violations(page)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. Cut, then paste back
// ═══════════════════════════════════════════════════════════════════════════

test.describe('B · cut and paste back', () => {
  // [from, offset, to, offset, paste back?]
  const cases: Array<[string, number, string, number, boolean]> = [
    ['x', 1, 's2', 1, true],
    ['a', 0, 'z', 1, true],
    ['s1', 1, 's3', 1, true],
    // ends in the TEXT of an item that has a sublist: the merged item adopts the sublist. Pasting a multi-block
    // fragment into an item that has children puts the item's tail after those children (paste side, not asserted).
    ['x', 1, 'a', 0, false],
  ];
  for (const [fb, fo, tb, to, pasteBack] of cases) {
    test(`8 · cut ${fb}@${fo} -> ${tb}@${to}: valid, one undo restores, pasting it back loses no text`, async ({ page }) => {
      await nested(page);
      await selectRange(page, fb, fo, tb, to);
      const ev = await cut(page);
      expect(await violations(page)).toEqual([]);
      const afterCut = await outline(page);
      expect(afterCut).not.toBe(ORIGINAL);

      // one Ctrl+Z gives back the original outline; redo cuts again
      await undo(page);
      await expect.poll(() => outline(page)).toBe(ORIGINAL);
      await redo(page);
      await expect.poll(() => outline(page)).toBe(afterCut);

      if (!pasteBack) return;
      await pasteFragment(page, ev.nabuRaw);
      await expect.poll(async () => (await outline(page)) !== afterCut).toBe(true);
      expect(await violations(page)).toEqual([]);
      // Nothing lost, nothing duplicated, same document order. (The exact STRUCTURE after a paste is the paste
      // side's business — insertFragment splits the host block at the caret — and is not asserted here.)
      expect((await allText(page)).join('')).toBe('xas1s2s3z');
    });
  }

  test('9 · cut x@1 -> s2@1 puts the caret at the junction and typing continues there', async ({ page }) => {
    await nested(page);
    await selectRange(page, 'x', 1, 's2', 1);
    await cut(page);
    await expect.poll(() => outline(page)).toBe('ul[x2, s3, z]');
    expect(await caret(page)).toBe('x|2');
    await page.keyboard.type('Q');
    expect(await outline(page)).toBe('ul[xQ2, s3, z]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. Mixed content: toggle, code, lists
// ═══════════════════════════════════════════════════════════════════════════

test.describe('C · mixed documents', () => {
  const MIXED = (): TreeSpec[] => [
    Pp('first'),
    { type: 'list', props: { listType: 'bullet' }, children: [{ type: 'list-item', text: 'a', children: [{ type: 'list', props: { listType: 'bullet' }, children: [{ type: 'list-item', text: 'b' }] }] }, { type: 'list-item', text: 'c' }] },
    Tog('Toggle', [Pp('inner1'), Pp('inner2')]),
    Code('line one\nline two'),
    Pp('last'),
  ];

  test('10 · Ctrl+A then Backspace leaves ONE empty block with a usable caret; one undo restores', async ({ page }) => {
    await buildTree(page, MIXED());
    const before = await outline(page);
    await focusAt(page, 'first', 2);
    await selectAll(page);
    await press(page, 'Backspace');
    await expect.poll(() => outline(page)).toBe('p(∅)');
    expect(await violations(page)).toEqual([]);
    expect(await caret(page)).toBe('|');
    await page.keyboard.type('Z');
    expect(await outline(page)).toBe('p(Z)');

    await undo(page);
    await undo(page);
    await expect.poll(() => outline(page)).toBe(before);
  });

  test('11 · Ctrl+A then typing replaces everything with the typed text', async ({ page }) => {
    await buildTree(page, MIXED());
    await focusAt(page, 'first', 2);
    await selectAll(page);
    await page.keyboard.type('N');
    await expect.poll(() => outline(page)).toBe('p(N)');
    expect(await violations(page)).toEqual([]);
  });

  test('12 · from a paragraph into an expanded toggle body: the rest of the body is promoted, in order', async ({ page }) => {
    await buildTree(page, [Pp('para'), Tog('Head', [Pp('b1'), Pp('b2'), Pp('b3')]), Pp('end')]);
    await selectRange(page, 'para', 2, 'b2', 1);
    await press(page, 'Backspace');
    await expect.poll(() => outline(page)).toBe('p(pa2) ; p(b3) ; p(end)');
    expect(await violations(page)).toEqual([]);
    await undo(page);
    await expect.poll(() => outline(page)).toBe('p(para) ; toggle(Head){p(b1) p(b2) p(b3)} ; p(end)');
  });

  test('13 · from a toggle header into its body: the rest of the body stays in the toggle', async ({ page }) => {
    await buildTree(page, [Tog('Head', [Pp('b1'), Pp('b2'), Pp('b3')]), Pp('end')]);
    await selectRange(page, 'Head', 2, 'b2', 1);
    await press(page, 'Backspace');
    await expect.poll(() => outline(page)).toBe('toggle(He2){p(b3)} ; p(end)');
    expect(await violations(page)).toEqual([]);
    expect(await caret(page)).toBe('He|2');
  });

  test('14 · list item -> code block: the code tail is merged into the item', async ({ page }) => {
    await buildTree(page, [
      { type: 'list', props: { listType: 'bullet' }, children: [{ type: 'list-item', text: 'item' }] },
      Code('abc'),
      Pp('tail'),
    ]);
    await selectRange(page, 'item', 2, 'abc', 1);
    await press(page, 'Backspace');
    await expect.poll(() => outline(page)).toBe('ul[itbc] ; p(tail)');
    expect(await violations(page)).toEqual([]);
  });
});
