/**
 * E2E — P-49: pasting INTO a list.
 *
 * DECIDED: "what a list item can hold is absorbed; everything else splits the list."
 *  - paragraphs (and a pasted list's items) become ITEMS of the list the caret is in, same level, and ADOPT the
 *    list's type (their own nested sublists keep theirs; `checked` is kept only in a to-do list, items from
 *    paragraphs are unchecked);
 *  - a block an item cannot hold (heading, code, image…) SPLITS the list at the caret (items before stay, the
 *    block comes right after, the rest of the list follows with continued numbering); the blocks that follow it
 *    are inserted as they are (a paragraph stays a paragraph), above the list tail;
 *  - the first block merges into the head of the caret item, the last one (when still inside the list) with its
 *    tail; the caret ends after the pasted content; one undo step; the tree stays valid.
 *
 * The internal fragments are dispatched as a synthetic `paste` event carrying `application/x-nabu+json`;
 * markdown / plain text go through the real Ctrl+V.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, clearAndReset, getEditor } from './helpers/editor.js';
import { pasteText } from './helpers/clipboard.js';
import { undo, redo } from './helpers/keyboard.js';
import { copy } from './helpers/clip-capture.js';
import {
  buildDoc, P, I, UL, OL, TODO, outline, caret, violations, expectValid,
  focusAt, focusEnd, focusEmpty, selectRange, collectErrors,
} from './helpers/model.js';

const expectOutline = (page: Page, expected: string) =>
  expect.poll(() => outline(page), { timeout: 3000, message: 'model outline' }).toBe(expected);
const expectCaret = (page: Page, expected: string | null) =>
  expect.poll(() => caret(page), { timeout: 3000, message: 'caret' }).toBe(expected);

/** Dispatch a paste carrying an internal `application/x-nabu+json` fragment at the caret. */
async function pasteFragment(page: Page, blocks: any[]) {
  await page.evaluate((raw) => {
    const dt = new DataTransfer();
    dt.setData('application/x-nabu+json', raw);
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, JSON.stringify({ blocks }));
}

/** `start` of every root list, in order (null when unset). */
const rootStarts = (page: Page) => page.evaluate(() => {
  const n = (window as any).nabu;
  return n.tree.roots().filter((r: any) => r.data.get('type') === 'list').map((r: any) => r.data.get('start') ?? null);
});
/** `checked` data of every list item, in document order (undefined = unset). */
const checkedData = (page: Page) => page.evaluate(() => {
  const n = (window as any).nabu;
  const out: any[] = [];
  const walk = (node: any) => { if (node.data.get('type') === 'list-item') out.push(node.data.get('checked') ?? null); (node.children() ?? []).forEach(walk); };
  n.tree.roots().forEach(walk);
  return out;
});

// pasted-fragment builders
const pPara = (text: string, partial: any = false) => ({ type: 'paragraph', partial, delta: [{ insert: text }] });
const pHead = (text: string, level = 1) => ({ type: 'heading', partial: false, props: { level }, delta: [{ insert: text }] });
const pItem = (text: string, props?: any, children?: any[], partial: any = false) =>
  ({ type: 'list-item', partial, delta: [{ insert: text }], ...(props ? { props } : {}), ...(children ? { children } : {}) });
const pList = (listType: string, items: any[], extra: any = {}) => ({ type: 'list', props: { listType, ...extra }, children: items });

let errors: ReturnType<typeof collectErrors>;

test.beforeEach(async ({ page }) => {
  errors = collectErrors(page);
  await gotoEditor(page);
  await clearAndReset(page);
});

test.afterEach(async () => {
  expect(errors.list(), 'console / page errors').toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════
// A. Paragraphs become items
// ═══════════════════════════════════════════════════════════════════════════

test.describe('A · paragraphs are absorbed as list items', () => {
  test('1 · three lines into an EMPTY item: three items, caret at the end of the last, one undo', async ({ page }) => {
    await buildDoc(page, [UL(I(''), I('after'))]);
    await focusEmpty(page);
    await pasteText(page, 'a\nb\nc');
    await expectOutline(page, 'ul[a, b, c, after]');
    await expectCaret(page, 'c|');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[∅, after]');
    await expectValid(page);
    await redo(page);
    await expectOutline(page, 'ul[a, b, c, after]');
  });

  test('2 · three lines into the MIDDLE of an item: first merges into the head, last with the tail', async ({ page }) => {
    await buildDoc(page, [UL(I('xy'), I('z'))]);
    await focusAt(page, 'xy', 1);
    await pasteText(page, 'a\nb\nc');
    await expectOutline(page, 'ul[xa, b, cy, z]');
    await expectCaret(page, 'c|y');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[xy, z]');
    await expectValid(page);
  });

  test('3 · at the END of an item the sublists stay under it unless the last paragraph merges: they follow the caret item', async ({ page }) => {
    await buildDoc(page, [UL(I('x', UL(I('s1'))), I('z'))]);
    await focusEnd(page, 'x');
    await pasteText(page, 'a\nb');
    // the last pasted line is the caret item: it carries the sublists of the item (like Enter)
    await expectOutline(page, 'ul[xa, b > ul[s1], z]');
    await expectCaret(page, 'b|');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[x > ul[s1], z]');
  });

  test('4 · into an ORDERED list the items are numbered; the pasted paragraphs keep the list (no restart)', async ({ page }) => {
    await buildDoc(page, [OL(I('one'), I('two'))]);
    await focusEnd(page, 'one');
    await pasteText(page, 'a\nb');
    await expectOutline(page, 'ol[onea, b, two]');
    expect(await rootStarts(page)).toEqual([null]);
    await expectValid(page);
  });

  test('5 · into a TO-DO list the new items are UNCHECKED, the checked state of the others is untouched', async ({ page }) => {
    await buildDoc(page, [TODO(I('t1', { checked: true }), I('t2', { checked: true }))]);
    await focusEnd(page, 't1');
    await pasteText(page, 'a\nb\nc');
    await expectOutline(page, 'todo[[x] t1a, [ ] b, [ ] c, [x] t2]');
    expect(await checkedData(page)).toEqual([true, false, false, true]);
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'todo[[x] t1, [x] t2]');
  });

  test('6 · into a NESTED item: the items join the nested level', async ({ page }) => {
    await buildDoc(page, [UL(I('p', UL(I(''))))]);
    await focusEmpty(page);
    await pasteText(page, 'a\nb\nc');
    await expectOutline(page, 'ul[p > ul[a, b, c]]');
    await expectCaret(page, 'c|');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[p > ul[∅]]');
  });

  test('7 · a single line stays inline in the item', async ({ page }) => {
    await buildDoc(page, [UL(I('p', UL(I('n1'))))]);
    await focusEnd(page, 'n1');
    await pasteText(page, 'abc');
    await expectOutline(page, 'ul[p > ul[n1abc]]');
    await expectCaret(page, 'n1abc|');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. Pasted lists
// ═══════════════════════════════════════════════════════════════════════════

test.describe('B · pasted lists join the current level', () => {
  test('8 · markdown "- x\\n  - y\\n- z" into an EMPTY NESTED item: relative nesting kept, at the nested level', async ({ page }) => {
    await buildDoc(page, [UL(I('p', UL(I(''), I('n2'))))]);
    await focusEmpty(page);
    await pasteText(page, '- x\n  - y\n- z');
    await expectOutline(page, 'ul[p > ul[x > ul[y], z, n2]]');
    await expectCaret(page, 'z|');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[p > ul[∅, n2]]');
    await expectValid(page);
  });

  test('9 · a NUMBERED list pasted into a BULLET list adopts the bullet type; its own sublists keep their type', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I('b'))]);
    await focusEnd(page, 'a');
    await pasteText(page, '1. x\n  1. s\n2. y');
    await expectOutline(page, 'ul[a, x > ol[s], y, b]');
    await expectCaret(page, 'y|');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[a, b]');
  });

  test('10 · a list pasted into the middle of an item: head, pasted items, then the tail as an item', async ({ page }) => {
    await buildDoc(page, [UL(I('ab'), I('z'))]);
    await focusAt(page, 'ab', 1);
    await pasteText(page, '- x\n- y');
    await expectOutline(page, 'ul[a, x, y, b, z]');
    await expectCaret(page, 'y|');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[ab, z]');
  });

  test('11 · a list pasted at the START of an item goes before it', async ({ page }) => {
    await buildDoc(page, [UL(I('ab'))]);
    await focusAt(page, 'ab', 0);
    await pasteText(page, '- x\n- y');
    await expectOutline(page, 'ul[x, y, ab]');
    await expectCaret(page, 'y|');
    await expectValid(page);
  });

  test('12 · a TO-DO list pasted into a to-do list keeps its checked flags; into a bullet list they are dropped', async ({ page }) => {
    await buildDoc(page, [TODO(I('t')), P('sep'), UL(I('u'))]);
    await focusEnd(page, 't');
    await pasteFragment(page, [pList('todo', [pItem('x', { checked: true }), pItem('y', { checked: false })])]);
    await expectOutline(page, 'todo[[ ] t, [x] x, [ ] y] ; p(sep) ; ul[u]');
    await expectCaret(page, 'y|');
    await undo(page);
    await expectOutline(page, 'todo[[ ] t] ; p(sep) ; ul[u]');

    await focusEnd(page, 'u');
    await pasteFragment(page, [pList('todo', [pItem('x', { checked: true }), pItem('y', { checked: false })])]);
    await expectOutline(page, 'todo[[ ] t] ; p(sep) ; ul[u, x, y]');
    expect(await checkedData(page)).toEqual([false, null, null, null]);
    await expectValid(page);
  });

  test('13 · an item with sublists keeps them when pasted into a list (internal fragment, mixed sublist types)', async ({ page }) => {
    await buildDoc(page, [UL(I('a'))]);
    await focusEnd(page, 'a');
    await pasteFragment(page, [pList('bullet', [
      pItem('x', undefined, [pList('bullet', [pItem('s1')]), pList('ordered', [pItem('s2')])]),
      pItem('y'),
    ])]);
    await expectOutline(page, 'ul[a, x > ul[s1] ol[s2], y]');
    await expectCaret(page, 'y|');
    await expectValid(page);
  });

  test('14 · a copied range of items pasted in the middle of an item: partial first / last items merge with head / tail', async ({ page }) => {
    await buildDoc(page, [UL(I('hello'), I('mid'), I('world')), P('sep'), UL(I('ab'))]);
    await selectRange(page, 'hello', 3, 'world', 2); // "lo", "mid", "wo"
    const ev = await copy(page);
    expect(ev.nabuRaw).not.toBe('');
    await focusAt(page, 'ab', 1);
    await pasteFragment(page, ev.nabu!.blocks);
    await expectOutline(page, 'ul[hello, mid, world] ; p(sep) ; ul[alo, mid, wob]');
    await expectCaret(page, 'wo|b');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[hello, mid, world] ; p(sep) ; ul[ab]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. What an item cannot hold splits the list
// ═══════════════════════════════════════════════════════════════════════════

test.describe('C · blocks an item cannot hold split the list', () => {
  test('15 · a heading in the MIDDLE of an ORDERED list: split, the tail keeps counting; caret after the heading', async ({ page }) => {
    await buildDoc(page, [OL(I('one'), I('twothree'), I('four'))]);
    await focusAt(page, 'twothree', 3);
    await pasteText(page, '# Title');
    await expectOutline(page, 'ol[one, two] ; heading(Title) ; ol[three, four]');
    expect(await rootStarts(page)).toEqual([null, 3]);
    await expectCaret(page, 'Title|');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ol[one, twothree, four]');
    expect(await rootStarts(page)).toEqual([null]);
    await expectValid(page);
    await redo(page);
    await expectOutline(page, 'ol[one, two] ; heading(Title) ; ol[three, four]');
  });

  test('16 · a heading at the END of an item: the list continues below with the following items (numbering continues)', async ({ page }) => {
    await buildDoc(page, [OL(I('one'), I('two'), I('three'))]);
    await focusEnd(page, 'two');
    await pasteText(page, '# Title');
    await expectOutline(page, 'ol[one, two] ; heading(Title) ; ol[three]');
    expect(await rootStarts(page)).toEqual([null, 3]);
    await expectCaret(page, 'Title|');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ol[one, two, three]');
  });

  test('17 · a heading at the end of the LAST item leaves no empty list; at the START of the first item no empty list either', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I('b'))]);
    await focusEnd(page, 'b');
    await pasteText(page, '# T');
    await expectOutline(page, 'ul[a, b] ; heading(T)');
    await expectValid(page);
    await undo(page);

    await focusAt(page, 'a', 0);
    await pasteText(page, '# T');
    await expectOutline(page, 'heading(T) ; ul[a, b]');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[a, b]');
  });

  test('18 · a CODE block and an IMAGE split the list', async ({ page }) => {
    await buildDoc(page, [UL(I('ab'), I('z'))]);
    await focusAt(page, 'ab', 1);
    await pasteText(page, '```js\nx = 1\n```');
    await expectOutline(page, 'ul[a] ; code(x = 1) ; ul[b, z]');
    await expectCaret(page, 'x = 1|');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[ab, z]');

    await focusAt(page, 'ab', 1);
    await pasteText(page, '![alt](https://example.com/a.png)');
    await expectOutline(page, 'ul[a] ; image(∅) ; ul[b, z]');
    await expectCaret(page, '|b');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[ab, z]');
    await expectValid(page);
  });

  test('19 · a heading pasted in a NESTED item splits the whole list at the top level, document order kept', async ({ page }) => {
    await buildDoc(page, [UL(I('p', UL(I('n1'), I('n2'))), I('q'))]);
    await focusEnd(page, 'n1');
    await pasteText(page, '# T');
    // items before stay (p > n1), the heading goes after them at the top level, the rest follows below
    await expectOutline(page, 'ul[p > ul[n1]] ; heading(T) ; ul[n2, q]');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[p > ul[n1, n2], q]');
    await expectValid(page);
  });

  test('20 · MIXED [p1, heading, p2] into "a|b": a+p1 stays an item, the heading splits, p2 stays a paragraph, the tail "b" continues the list', async ({ page }) => {
    await buildDoc(page, [UL(I('ab'), I('z'))]);
    await focusAt(page, 'ab', 1);
    await pasteFragment(page, [pPara('P1', 'start'), pHead('H'), pPara('P2', 'end')]);
    await expectOutline(page, 'ul[aP1] ; heading(H) ; p(P2) ; ul[b, z]');
    await expectCaret(page, 'P2|');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[ab, z]');
    await expectValid(page);
  });

  test('21 · MIXED [p, p, p] (internal) stays inside the list; [heading, p] puts the paragraph after the heading', async ({ page }) => {
    await buildDoc(page, [UL(I('ab'))]);
    await focusAt(page, 'ab', 1);
    await pasteFragment(page, [pPara('P1', 'start'), pPara('P2'), pPara('P3', 'end')]);
    await expectOutline(page, 'ul[aP1, P2, P3b]');
    await expectCaret(page, 'P3|b');
    await undo(page);
    await expectOutline(page, 'ul[ab]');

    await focusEnd(page, 'ab');
    await pasteFragment(page, [pHead('H'), pPara('P', 'end')]);
    await expectOutline(page, 'ul[ab] ; heading(H) ; p(P)');
    await expectCaret(page, 'P|');
    await expectValid(page);
  });

  test('22 · a paragraph then a pasted LIST after a heading: the list stays a list of its own type, above the tail', async ({ page }) => {
    await buildDoc(page, [UL(I('ab'))]);
    await focusAt(page, 'ab', 1);
    await pasteFragment(page, [pHead('H'), pList('ordered', [pItem('x'), pItem('y')])]);
    await expectOutline(page, 'ul[a] ; heading(H) ; ol[x, y] ; ul[b]');
    await expectCaret(page, 'y|');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[ab]');
  });

  test('23 · a toggle with children and a divider split the list; a selection is replaced first', async ({ page }) => {
    await buildDoc(page, [UL(I('abcd'), I('z'))]);
    await focusAt(page, 'abcd', 1);
    await pasteFragment(page, [
      { type: 'toggle', partial: false, props: { collapsed: false }, delta: [{ insert: 'T' }], children: [pPara('kid')] },
      { type: 'divider', partial: false },
    ]);
    await expectOutline(page, 'ul[a] ; toggle(T){p(kid)} ; divider(∅) ; ul[bcd, z]');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[abcd, z]');

    await selectRange(page, 'abcd', 1, 'abcd', 3); // "bc" selected
    await pasteText(page, '# T');
    await expectOutline(page, 'ul[a] ; heading(T) ; ul[d, z]');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[abcd, z]');
  });

  test('24 · the editor stays usable after a split paste: typing goes where the caret is', async ({ page }) => {
    await buildDoc(page, [OL(I('one'), I('two'))]);
    await focusEnd(page, 'one');
    await pasteText(page, '# T');
    await expectCaret(page, 'T|');
    await page.keyboard.type('!');
    await expectOutline(page, 'ol[one] ; heading(T!) ; ol[two]');
    expect(await violations(page)).toEqual([]);
    await expect(getEditor(page)).toContainText('T!');
  });
});
