/**
 * E2E — hard STRUCTURAL cases of lists (nested lists, sublists, todo), driven by REAL keyboard / mouse input.
 *
 * Fixtures are built programmatically (`buildDoc`), operations use real keys; assertions run on the MODEL tree
 * (`outline`, read from the Loro tree), the caret (`caret`, block text with a `|`) and structural invariants
 * (`violations` / `expectValid`: list-item only under a list, list only at root or under an item, no empty list,
 * Block instances + DOM in sync with the tree).
 *
 * Convention: a test documents the CURRENT behaviour in a one-line "CURRENT:" comment when it is coherent and
 * data-preserving (product decisions: Notion / Google Docs / ProseMirror differ). A test is left FAILING only when
 * the behaviour is clearly broken (invalid/orphaned tree, lost text or children, lost caret / swallowed keystroke,
 * exception in the console, undo not restoring the state). Failing tests are tagged "BROKEN:" in their comment.
 *
 *  A. Enter (split / exit)      B. Backspace / Delete     C. Indent / unindent      D. Undo / redo of indent
 *  E. Selection across lists    F. Todo                   G. Paste into lists       H. Navigation / DOM / conversion
 */

import { test, expect, type Page } from '@playwright/test';
import {
  gotoEditor, clearAndReset, press, getMarkdown, getJson, getEditor, flushRender, exec,
} from './helpers/editor.js';
import { pasteText } from './helpers/clipboard.js';
import { undo, redo } from './helpers/keyboard.js';
import {
  buildDoc, P, I, UL, OL, TODO, outline, caret, allText, violations, expectValid,
  focusAt, focusEnd, focusEmpty, selectRange, collectErrors,
} from './helpers/model.js';

// ── local helpers ──────────────────────────────────────────────────────────

/** Poll the model outline (some ops finish in a microtask / after a commit). */
const expectOutline = (page: Page, expected: string) =>
  expect.poll(() => outline(page), { timeout: 3000, message: 'model outline' }).toBe(expected);
/** Poll the caret description (`Par|ent`, `a⟦b⟧c`, `x@1 -> y@2`). */
const expectCaret = (page: Page, expected: string | null) =>
  expect.poll(() => caret(page), { timeout: 3000, message: 'caret' }).toBe(expected);
/** Poll the markdown export. */
const expectMd = (page: Page, expected: string) =>
  expect.poll(() => getMarkdown(page), { timeout: 3000, message: 'markdown' }).toBe(expected);
/** Soft assertion: the tree is structurally valid (the other assertions of the test still run when it fails). */
const expectValidSoft = async (page: Page) => expect.soft(await violations(page), 'structural violations').toEqual([]);
/** Non-empty texts of the whole document, in document order. */
const texts = async (page: Page) => (await allText(page)).filter(Boolean);
/** True when the DOM focus is inside the contenteditable (Tab must not push it out). */
const focusInEditor = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('[contenteditable="true"]'));
/** Type one char and return the outline, to check the caret is usable where it is expected. */
async function typeAndOutline(page: Page, ch = 'X') {
  await page.keyboard.type(ch);
  return outline(page);
}

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
// A. Enter (split / exit)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('A · Enter in lists', () => {
  const PARENT = () => UL(I('Parent', UL(I('c1'), I('c2'))), I('z'));

  test('1 · Enter at the END of an item that has a sublist', async ({ page }) => {
    await buildDoc(page, [PARENT()]);
    await focusEnd(page, 'Parent');
    await press(page, 'Enter');
    // CURRENT: a new empty item is created BELOW "Parent" and the sublist is transferred to it
    // ("Parent" keeps no children). Nothing is lost. (Notion: new item becomes the first CHILD of Parent.)
    await expectOutline(page, 'ul[Parent, ∅ > ul[c1, c2], z]');
    await expectCaret(page, '|');
    expect(await typeAndOutline(page)).toBe('ul[Parent, X > ul[c1, c2], z]');
    await expectCaret(page, 'X|');
    await expectValid(page);
  });

  test('2 · Enter in the MIDDLE of an item that has a sublist', async ({ page }) => {
    await buildDoc(page, [PARENT()]);
    await focusAt(page, 'Parent', 3);
    await press(page, 'Enter');
    // CURRENT: the tail ("ent") becomes the new item and takes the sublist with it; "Par" keeps no children.
    await expectOutline(page, 'ul[Par, ent > ul[c1, c2], z]');
    await expectCaret(page, '|ent');
    expect(await typeAndOutline(page)).toBe('ul[Par, Xent > ul[c1, c2], z]');
    await expectValid(page);
  });

  test('3 · Enter at the START of an item that has a sublist', async ({ page }) => {
    await buildDoc(page, [PARENT()]);
    await focusAt(page, 'Parent', 0);
    await press(page, 'Enter');
    // CURRENT: an empty item is inserted ABOVE; "Parent" keeps its sublist and the caret (start of "Parent").
    await expectOutline(page, 'ul[∅, Parent > ul[c1, c2], z]');
    await expectCaret(page, '|Parent');
    expect(await typeAndOutline(page)).toBe('ul[∅, XParent > ul[c1, c2], z]');
    await expectValid(page);
  });

  test('4 · Enter on an EMPTY item in the middle of a top-level list splits the list around a paragraph', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I(''), I('b'))]);
    await focusEmpty(page);
    await press(page, 'Enter');
    // CURRENT: list is split in two with an empty paragraph in between (same as Notion / Google Docs).
    await expectOutline(page, 'ul[a] ; p(∅) ; ul[b]');
    await expectCaret(page, '|');
    expect(await typeAndOutline(page)).toBe('ul[a] ; p(X) ; ul[b]');
    await expectValid(page);
  });

  test('4b · Enter on an EMPTY FIRST item of a multi-item list leaves no empty list behind', async ({ page }) => {
    await buildDoc(page, [UL(I(''), I('b'))]);
    await focusEmpty(page);
    await press(page, 'Enter');
    // BROKEN: the original list is left EMPTY ("ul[] ; p(∅) ; ul[b]"): list.svelte.js only destroys it when there
    // are no followers (`currentIndex === 0 && followers.length === 0`).
    expect(await texts(page)).toEqual(['b']);
    await expectCaret(page, '|');
    await expectValidSoft(page);
  });

  test('4c · Enter on an EMPTY LAST item exits the list into a paragraph right after it', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I(''))]);
    await focusEmpty(page);
    await press(page, 'Enter');
    // CURRENT: the empty item is removed, a paragraph follows the list.
    await expectOutline(page, 'ul[a] ; p(∅)');
    expect(await typeAndOutline(page)).toBe('ul[a] ; p(X)');
    await expectValid(page);
  });

  test('5a · Enter on an EMPTY NESTED item that is the last child of its sublist', async ({ page }) => {
    await buildDoc(page, [UL(I('a', UL(I('s1'), I(''))), I('b'))]);
    await focusEmpty(page);
    await press(page, 'Enter');
    // BROKEN: the exit paragraph is inserted INSIDE the parent list-item ("ul[a > ul[s1] p(∅), b]"): a paragraph
    // under a list-item. list.svelte.js onSplit CAS 1 uses `this.node.parent()` (the list-item) as the insertion
    // parent without lifting the new block out of the item. (Notion / Docs: the item is outdented one level.)
    expect(await texts(page)).toEqual(['a', 's1', 'b']);
    await expectCaret(page, '|');
    await expectValidSoft(page);
    expect(await typeAndOutline(page)).toContain('X');
  });

  test('5b · Enter on an EMPTY NESTED item in the middle of its sublist', async ({ page }) => {
    await buildDoc(page, [UL(I('a', UL(I('s1'), I(''), I('s2'))), I('b'))]);
    await focusEmpty(page);
    await press(page, 'Enter');
    // BROKEN: same root cause as 5a, plus the sublist is cut in two ("a > ul[s1] p(∅) ul[s2]": two sublists and a
    // paragraph under one list-item). No text is lost.
    expect(await texts(page)).toEqual(['a', 's1', 's2', 'b']);
    await expectCaret(page, '|');
    await expectValidSoft(page);
  });

  test('6 · Enter on an empty item that is the ONLY item of the list removes the list', async ({ page }) => {
    await buildDoc(page, [UL(I(''))]);
    await focusEmpty(page);
    await press(page, 'Enter');
    // CURRENT: list replaced by an empty paragraph (caret in it).
    await expectOutline(page, 'p(∅)');
    expect(await typeAndOutline(page)).toBe('p(X)');
    await expectValid(page);
  });

  test('1b · Enter at the end of a NESTED item adds a sibling in the same sublist', async ({ page }) => {
    await buildDoc(page, [UL(I('a', UL(I('s1'), I('s2'))), I('b'))]);
    await focusEnd(page, 's2');
    await press(page, 'Enter');
    // CURRENT: new empty item in the nested sublist, caret in it.
    await expectOutline(page, 'ul[a > ul[s1, s2, ∅], b]');
    expect(await typeAndOutline(page)).toBe('ul[a > ul[s1, s2, X], b]');
    await expectValid(page);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. Backspace / Delete
// ═══════════════════════════════════════════════════════════════════════════

test.describe('B · Backspace / Delete in lists', () => {
  test('7a · Backspace at offset 0 of a MIDDLE item (no children) merges it into the previous item', async ({ page }) => {
    await buildDoc(page, [UL(I('aa'), I('bb'), I('cc'))]);
    await focusAt(page, 'bb', 0);
    await press(page, 'Backspace');
    // CURRENT: text merged into the previous item, item removed, caret at the junction.
    // (Notion: first Backspace outdents / converts to paragraph; Docs: merges like here.)
    await expectOutline(page, 'ul[aabb, cc]');
    await expectCaret(page, 'aa|bb');
    expect(await typeAndOutline(page)).toBe('ul[aaXbb, cc]');
    await expectValid(page);
  });

  test('7b · Backspace at offset 0 of the FIRST item of a list that follows a paragraph merges into that paragraph', async ({ page }) => {
    await buildDoc(page, [P('p0'), UL(I('aa'), I('bb'))]);
    await focusAt(page, 'aa', 0);
    await press(page, 'Backspace');
    // CURRENT: the first item's text is appended to the previous paragraph; the rest of the list stays.
    await expectOutline(page, 'p(p0aa) ; ul[bb]');
    await expectCaret(page, 'p0|aa');
    await expectValid(page);
  });

  test('7b2 · Backspace at offset 0 of the first item of the FIRST list of the document does nothing', async ({ page }) => {
    await buildDoc(page, [UL(I('aa'), I('bb'))]);
    await focusAt(page, 'aa', 0);
    await press(page, 'Backspace');
    // CURRENT: no-op (nothing before to merge into); caret stays and typing still works. (Notion: converts the item to a paragraph.)
    await expectOutline(page, 'ul[aa, bb]');
    await expectCaret(page, '|aa');
    expect(await typeAndOutline(page)).toBe('ul[Xaa, bb]');
    await expectValid(page);
  });

  test('7c · Backspace at offset 0 of the FIRST item of a nested sublist merges it into the parent item', async ({ page }) => {
    await buildDoc(page, [UL(I('aa', UL(I('s1'), I('s2'))), I('bb'))]);
    await focusAt(page, 's1', 0);
    await press(page, 'Backspace');
    // CURRENT: "s1" is appended to the parent's text; its siblings stay nested under the parent.
    await expectOutline(page, 'ul[aas1 > ul[s2], bb]');
    await expectCaret(page, 'aa|s1');
    await expectValid(page);
  });

  test('8 · Backspace at offset 0 of an item that HAS children: text merges up, children are kept and follow', async ({ page }) => {
    await buildDoc(page, [UL(I('aa'), I('Parent', UL(I('c1'), I('c2'))), I('bb'))]);
    await focusAt(page, 'Parent', 0);
    await press(page, 'Backspace');
    // CURRENT: merged into "aa"; its children are re-parented under the surviving item (nothing lost).
    await expectOutline(page, 'ul[aaParent > ul[c1, c2], bb]');
    await expectCaret(page, 'aa|Parent');
    await expectValid(page);
  });

  test('8b · Backspace at offset 0 of an item whose PREVIOUS item has children merges into that previous item\'s LAST descendant', async ({ page }) => {
    await buildDoc(page, [UL(I('a', UL(I('a1'), I('a2'))), I('b'))]);
    await focusAt(page, 'b', 0);
    await press(page, 'Backspace');
    // CURRENT: merged into the visually previous line ("a2"), like a flat editor would.
    await expectOutline(page, 'ul[a > ul[a1, a2b]]');
    await expectCaret(page, 'a2|b');
    await expectValid(page);
  });

  test('9a · Delete at the end of an item whose NEXT item has children keeps the children', async ({ page }) => {
    await buildDoc(page, [UL(I('aa'), I('bb', UL(I('b1'))))]);
    await focusEnd(page, 'aa');
    await press(page, 'Delete');
    // CURRENT: next item merged into this one, its sublist moves to the surviving item.
    await expectOutline(page, 'ul[aabb > ul[b1]]');
    await expectCaret(page, 'aa|bb');
    expect(await typeAndOutline(page)).toBe('ul[aaXbb > ul[b1]]');
    await expectValid(page);
  });

  test('9b · Delete at the end of the LAST item of a list merges the following paragraph into it', async ({ page }) => {
    await buildDoc(page, [UL(I('aa'), I('bb')), P('para')]);
    await focusEnd(page, 'bb');
    await press(page, 'Delete');
    // CURRENT: the paragraph's text is appended to the last item.
    await expectOutline(page, 'ul[aa, bbpara]');
    await expectCaret(page, 'bb|para');
    await expectValid(page);
  });

  test('10 · Backspace at offset 0 of a paragraph right after a list merges into the last top-level item', async ({ page }) => {
    await buildDoc(page, [UL(I('aa'), I('bb')), P('para')]);
    await focusAt(page, 'para', 0);
    await press(page, 'Backspace');
    // CURRENT: merged into the last item of the list (the paragraph disappears).
    await expectOutline(page, 'ul[aa, bbpara]');
    await expectCaret(page, 'bb|para');
    expect(await typeAndOutline(page)).toBe('ul[aa, bbXpara]');
    await expectValid(page);
  });

  test('10b · Backspace at offset 0 of a paragraph after a list whose last item is NESTED merges into that nested item', async ({ page }) => {
    await buildDoc(page, [UL(I('aa', UL(I('s1'), I('s2')))), P('para')]);
    await focusAt(page, 'para', 0);
    await press(page, 'Backspace');
    // CURRENT: merged into the deepest last item ("s2"), which stays nested.
    await expectOutline(page, 'ul[aa > ul[s1, s2para]]');
    await expectCaret(page, 's2|para');
    await expectValid(page);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. Indent / unindent
// ═══════════════════════════════════════════════════════════════════════════

test.describe('C · Tab / Shift+Tab', () => {
  test('11 · Tab on an item that HAS children: nothing lost, but the subtree does not move along', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I('bbb', UL(I('b1'), I('b2'))), I('c'))]);
    await focusAt(page, 'bbb', 1);
    await press(page, 'Tab');
    // CURRENT: "bbb" goes under "a"; its former children are HOISTED to be its following siblings (they keep
    // their visual depth; they are no longer children of bbb). (Notion / PM: the whole subtree moves one level deeper.)
    await expectMd(page, '- a\n  - bbb\n  - b1\n  - b2\n- c');
    // BROKEN: the old (now empty) sublist of "bbb" is left behind: "bbb > ul[]" (empty list node).
    await expectValidSoft(page);
  });

  test('11b · Tab keeps a COLLAPSED caret at the same offset, and typing continues there', async ({ page }) => {
    await buildDoc(page, [UL(I('aaa'), I('bbb'))]);
    await focusAt(page, 'bbb', 1);
    await press(page, 'Tab');
    await expectMd(page, '- aaa\n  - bbb');
    // BROKEN: after the move the item's text is entirely SELECTED ("⟦bbb⟧"), so the next keystroke replaces it
    // (list-item.svelte.js indentListItem: `item.commit().then(() => block.focus())` with no offsets: the selection
    // of the re-rendered block is lost and focus() falls back to 0..text.length).
    await expectCaret(page, 'b|bb');
    expect(await typeAndOutline(page)).toBe('ul[aaa > ul[bXbb]]');
  });

  test('12 · Shift+Tab on a nested item with FOLLOWING siblings: the followers become its children', async ({ page }) => {
    await buildDoc(page, [UL(I('a', UL(I('s1'), I('s2'), I('s3'))), I('b'))]);
    await focusAt(page, 's1', 1);
    await press(page, 'Shift+Tab');
    // CURRENT: "s1" lands after "a" at the parent level and ADOPTS the followers s2, s3 as its sublist (Notion / PM do the same).
    await expectMd(page, '- a\n- s1\n  - s2\n  - s3\n- b');
    // BROKEN: "a" is left with an EMPTY sublist ("a > ul[]").
    await expectValidSoft(page);
  });

  test('12b · Shift+Tab keeps a COLLAPSED caret at the same offset, and typing continues there', async ({ page }) => {
    await buildDoc(page, [UL(I('a', UL(I('sub1'), I('sub2'))), I('b'))]);
    await focusAt(page, 'sub1', 2);
    await press(page, 'Shift+Tab');
    await expectMd(page, '- a\n- sub1\n  - sub2\n- b');
    // BROKEN: same root cause as 11b: the moved item's text ends up fully selected ("⟦sub1⟧").
    await expectCaret(page, 'su|b1');
    expect(await typeAndOutline(page)).toContain('suXb1');
  });

  test('13 · Shift+Tab on a TOP-LEVEL item does nothing (caret and typing intact)', async ({ page }) => {
    await buildDoc(page, [UL(I('aa'), I('bb'), I('cc'))]);
    await focusAt(page, 'bb', 1);
    await press(page, 'Shift+Tab');
    // CURRENT: no-op, focus stays in the editor, caret untouched.
    await expectOutline(page, 'ul[aa, bb, cc]');
    await expectCaret(page, 'b|b');
    expect(await focusInEditor(page)).toBe(true);
    expect(await typeAndOutline(page)).toBe('ul[aa, bXb, cc]');
    await expectValid(page);
  });

  test('13b · Shift+Tab on the ONLY child of a sublist leaves no empty sublist behind', async ({ page }) => {
    await buildDoc(page, [UL(I('a', UL(I('s1'))), I('b'))]);
    await focusAt(page, 's1', 1);
    await press(page, 'Shift+Tab');
    await expectMd(page, '- a\n- s1\n- b');
    // BROKEN: "a" keeps an empty sublist ("ul[a > ul[], s1, b]"): unindentListItem never removes the emptied list.
    await expectValidSoft(page);
  });

  test('13c · Tab on the FIRST item of a list does nothing (nothing to nest under)', async ({ page }) => {
    await buildDoc(page, [UL(I('aa'), I('bb'))]);
    await focusAt(page, 'aa', 1);
    await press(page, 'Tab');
    // CURRENT: no-op, focus kept in the editor (Tab is swallowed, not sent to the browser).
    await expectOutline(page, 'ul[aa, bb]');
    expect(await focusInEditor(page)).toBe(true);
    await expectCaret(page, 'a|a');
    await expectValid(page);
  });

  // Tab / Shift+Tab with a selection spanning several items.
  // BROKEN (all four): nothing is indented AND the Tab keydown is not intercepted (dispatchEventToSelection resolves
  // the target to the Nabu root, which has no `keydown`), so the browser moves the focus OUT of the editor
  // (document.activeElement becomes <body>): the next keystroke is swallowed.
  const multi: Array<[string, () => any[], [string, number, string, number], string]> = [
    ['14a · Tab with 2 selected items of the same level', () => [UL(I('aaa'), I('bbb'), I('ccc'), I('ddd'))], ['bbb', 0, 'ccc', 1], 'Tab'],
    ['14b · Shift+Tab with 2 selected nested items', () => [UL(I('a', UL(I('s1'), I('s2'), I('s3'))), I('b'))], ['s1', 0, 's2', 1], 'Shift+Tab'],
    ['14c · Tab with a selection from a nested item to a top-level item (mixed levels)', () => [UL(I('a', UL(I('s1'), I('s2'))), I('b'), I('c'))], ['s2', 0, 'c', 1], 'Tab'],
    ['14d · Shift+Tab with a selection from a nested item to a top-level item (mixed levels)', () => [UL(I('a', UL(I('s1'), I('s2'))), I('b'), I('c'))], ['s2', 0, 'c', 1], 'Shift+Tab'],
  ];
  for (const [title, doc, [ft, fo, tt, to], key] of multi) {
    test(title, async ({ page }) => {
      await buildDoc(page, doc());
      const before = (await texts(page)).slice().sort();
      await selectRange(page, ft, fo, tt, to);
      await press(page, key);
      // Whatever the outcome (indent the range, or no-op), no text may be lost / duplicated and the tree stays valid.
      expect((await texts(page)).slice().sort()).toEqual(before);
      await expectValidSoft(page);
      // The editor must keep the focus: the next keystroke must reach it.
      expect.soft(await focusInEditor(page), 'focus still in the editor after the key').toBe(true);
      await page.keyboard.type('X');
      expect((await allText(page)).join('')).toContain('X');
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// D. Undo / redo of indent
// ═══════════════════════════════════════════════════════════════════════════

test.describe('D · Undo / redo of Tab and Shift+Tab', () => {
  test('15a · one Ctrl+Z restores the exact structure and caret after Tab; redo re-applies', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I('b', UL(I('b1'))), I('ccc'))]);
    const original = await outline(page);
    await focusAt(page, 'ccc', 1);
    await press(page, 'Tab');
    await expectOutline(page, 'ul[a, b > ul[b1, ccc]]');
    const indented = await outline(page);

    await undo(page);
    // CURRENT: a single undo restores the previous tree and puts the caret back where it was.
    await expectOutline(page, original);
    await expectCaret(page, 'c|cc');
    await expectValid(page);

    await redo(page);
    await expectOutline(page, indented);
    expect(await texts(page)).toEqual(['a', 'b', 'b1', 'ccc']);
    await expectValid(page);
  });

  test('15b · one Ctrl+Z restores the exact structure and caret after Shift+Tab (followers re-nested); redo re-applies', async ({ page }) => {
    await buildDoc(page, [UL(I('a', UL(I('sub1'), I('sub2'), I('sub3'))), I('b'))]);
    const original = await outline(page);
    await focusAt(page, 'sub1', 2);
    await press(page, 'Shift+Tab');
    await expectMd(page, '- a\n- sub1\n  - sub2\n  - sub3\n- b');
    const unindented = await outline(page);

    await undo(page);
    await expectOutline(page, original);
    await expectCaret(page, 'su|b1');
    await expectValid(page);

    await redo(page);
    await expectOutline(page, unindented);
    await expectMd(page, '- a\n- sub1\n  - sub2\n  - sub3\n- b');
  });

  test('15c · typing after an undone Tab lands at the restored caret', async ({ page }) => {
    await buildDoc(page, [UL(I('aaa'), I('bbb'))]);
    await focusAt(page, 'bbb', 2);
    await press(page, 'Tab');
    await expectMd(page, '- aaa\n  - bbb');
    await undo(page);
    await expectOutline(page, 'ul[aaa, bbb]');
    expect(await typeAndOutline(page)).toBe('ul[aaa, bbXb]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E. Selection across lists
// ═══════════════════════════════════════════════════════════════════════════

test.describe('E · Selection across list items', () => {
  const THREE = () => UL(I('alpha'), I('beta'), I('gamma'));

  test('16a · select alpha (mid) -> gamma (mid) and type "X"', async ({ page }) => {
    await buildDoc(page, [THREE()]);
    await selectRange(page, 'alpha', 2, 'gamma', 3);
    await page.keyboard.type('X');
    // CURRENT: the range is replaced by "X", the item in between is removed, the tail of gamma is joined.
    await expectOutline(page, 'ul[alXma]');
    await expectCaret(page, 'alX|ma');
    await expectValid(page);
  });

  test('16b · same selection + Backspace', async ({ page }) => {
    await buildDoc(page, [THREE()]);
    await selectRange(page, 'alpha', 2, 'gamma', 3);
    await press(page, 'Backspace');
    await expectOutline(page, 'ul[alma]');
    await expectCaret(page, 'al|ma');
    expect(await typeAndOutline(page)).toBe('ul[alXma]');
    await expectValid(page);
  });

  test('16c · selection from a top item into the middle of a NESTED item + type "X"', async ({ page }) => {
    await buildDoc(page, [UL(I('item1', UL(I('s1'), I('s2'))), I('item3'))]);
    await selectRange(page, 'item1', 2, 's2', 1);
    await page.keyboard.type('X');
    // CURRENT: "it" + X + rest of s2 ("2"); s1 is removed; the following top-level item stays.
    await expectOutline(page, 'ul[itX2, item3]');
    await expectCaret(page, 'itX|2');
    await expectValid(page);
  });

  test('17 · select from a paragraph before the list into the middle of item 2, Backspace', async ({ page }) => {
    await buildDoc(page, [P('before'), UL(I('item1'), I('item2'), I('item3'))]);
    await selectRange(page, 'before', 3, 'item2', 2);
    await press(page, 'Backspace');
    // CURRENT: the paragraph keeps "bef", takes the tail of item2 ("em2"); item1 is gone; item3 stays in the list.
    await expectOutline(page, 'p(befem2) ; ul[item3]');
    await expectCaret(page, 'bef|em2');
    expect(await typeAndOutline(page)).toBe('p(befXem2) ; ul[item3]');
    await expectValid(page);
  });

  test('18a · Ctrl+A in a document with nested lists, then type "X"', async ({ page }) => {
    await buildDoc(page, [P('before'), UL(I('item1', UL(I('s1'), I('s2'))), I('item3')), P('after')]);
    await focusAt(page, 's1', 1);
    await press(page, 'Control+a');
    await page.keyboard.type('X');
    // CURRENT: everything is replaced by a single paragraph "X".
    await expectOutline(page, 'p(X)');
    await expectCaret(page, 'X|');
    await expectValid(page);
  });

  test('18b · Ctrl+A in a document with nested lists, then Backspace leaves one empty paragraph with a usable caret', async ({ page }) => {
    await buildDoc(page, [P('before'), UL(I('item1', UL(I('s1'), I('s2'))), I('item3')), P('after')]);
    await focusAt(page, 's1', 1);
    await press(page, 'Control+a');
    await press(page, 'Backspace');
    await expectOutline(page, 'p(∅)');
    expect(await typeAndOutline(page)).toBe('p(X)');
    await expectValid(page);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F. Todo
// ═══════════════════════════════════════════════════════════════════════════

test.describe('F · Todo lists', () => {
  const checkbox = (page: Page, n: number) => page.locator('[data-block-type="list-item"] .nabu-todo-check').nth(n);

  test('19a · clicking the checkbox toggles `checked` (model + JSON), the caret stays, typing continues; a 2nd click unchecks', async ({ page }) => {
    await buildDoc(page, [TODO(I('t1'), I('t2'))]);
    await focusAt(page, 't1', 1);

    await checkbox(page, 0).click();
    await expectOutline(page, 'todo[[x] t1, [ ] t2]');
    // CURRENT: the checkbox mousedown is prevented, so the caret does not move.
    await expectCaret(page, 't|1');
    expect((await getJson(page)).blocks[0].children[0].checked).toBe(true);
    expect(await typeAndOutline(page)).toBe('todo[[x] tX1, [ ] t2]');

    await checkbox(page, 0).click();
    await expectOutline(page, 'todo[[ ] tX1, [ ] t2]');
    expect((await getJson(page)).blocks[0].children[0].checked).toBe(false);
    await expectCaret(page, 'tX|1');
    await expectValid(page);
  });

  test('19b · clicking ANOTHER item\'s checkbox does not move the caret out of the item being edited', async ({ page }) => {
    await buildDoc(page, [TODO(I('t1'), I('t2'))]);
    await focusAt(page, 't1', 1);
    await checkbox(page, 1).click();
    await expectOutline(page, 'todo[[ ] t1, [x] t2]');
    await expectCaret(page, 't|1');
    expect(await typeAndOutline(page)).toBe('todo[[ ] tX1, [x] t2]');
    await expectValid(page);
  });

  test('19c · the checkbox of a NESTED todo toggles only that item', async ({ page }) => {
    await buildDoc(page, [TODO(I('t1', { sub: TODO(I('n1'), I('n2')) }))]);
    await checkbox(page, 2).click();
    await expectOutline(page, 'todo[[ ] t1 > todo[[ ] n1, [x] n2]]');
    await expectValid(page);
  });

  test('20a · Enter at the end of a CHECKED todo item creates an UNCHECKED todo item', async ({ page }) => {
    await buildDoc(page, [TODO(I('t1'), I('t2', { checked: true }))]);
    await focusEnd(page, 't2');
    await press(page, 'Enter');
    // CURRENT: the new item is a todo (same list) and is unchecked.
    await expectOutline(page, 'todo[[ ] t1, [x] t2, [ ] ∅]');
    expect(await typeAndOutline(page)).toBe('todo[[ ] t1, [x] t2, [ ] X]');
    await expectValid(page);
  });

  test('20b · Enter in the MIDDLE of a checked todo: the tail goes to a new UNCHECKED item', async ({ page }) => {
    await buildDoc(page, [TODO(I('abcd', { checked: true }))]);
    await focusAt(page, 'abcd', 2);
    await press(page, 'Enter');
    // CURRENT: first half keeps `checked`, second half is a fresh unchecked item.
    await expectOutline(page, 'todo[[x] ab, [ ] cd]');
    await expectCaret(page, '|cd');
    await expectValid(page);
  });

  test('20c · Enter on an EMPTY todo item exits the list (splitting it) like other lists', async ({ page }) => {
    await buildDoc(page, [TODO(I('t1'), I(''), I('t3'))]);
    await focusEmpty(page);
    await press(page, 'Enter');
    await expectOutline(page, 'todo[[ ] t1] ; p(∅) ; todo[[ ] t3]');
    expect(await typeAndOutline(page)).toBe('todo[[ ] t1] ; p(X) ; todo[[ ] t3]');
    await expectValid(page);
  });

  const TODO_DOC = () => [TODO(I('t1'), I('t2', { checked: true }), I('t3', { sub: TODO(I('n1', { checked: true }), I('n2')) }))];
  const TODO_MD = '- [ ] t1\n- [x] t2\n- [ ] t3\n  - [x] n1\n  - [ ] n2';

  test('21a · markdown export of a nested todo list uses `- [ ]` / `- [x]`', async ({ page }) => {
    await buildDoc(page, TODO_DOC());
    expect(await getMarkdown(page)).toBe(TODO_MD);
  });

  test('21b · pasting that markdown back recreates the same todo tree (checked states and nesting)', async ({ page }) => {
    await buildDoc(page, TODO_DOC());
    const original = await outline(page);
    expect(await getMarkdown(page)).toBe(TODO_MD);

    await buildDoc(page, [P('')]);
    await focusEmpty(page);
    await pasteText(page, TODO_MD);
    // CURRENT: the list is inserted after the (empty) paragraph that had the focus, which is kept.
    await expect.poll(() => outline(page)).toBe('p(∅) ; ' + original);
    expect(await getMarkdown(page)).toContain(TODO_MD);
    await expectValid(page);
  });

  test('22 · there is NO keyboard toggle for a todo: Ctrl+Enter is a no-op', async ({ page }) => {
    await buildDoc(page, [TODO(I('t1'), I('t2', { checked: true }))]);
    await focusEnd(page, 't1');
    await press(page, 'Control+Enter');
    // CURRENT: nothing is toggled, no item is created (the toggle is mouse-only: ListItem.svelte checkbox button).
    await expectOutline(page, 'todo[[ ] t1, [x] t2]');
    await expectCaret(page, 't1|');
    expect(await typeAndOutline(page, 'Q')).toBe('todo[[ ] t1Q, [x] t2]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// G. Paste into lists
// ═══════════════════════════════════════════════════════════════════════════

test.describe('G · Paste into list items', () => {
  test('23a · plain text "a\\nb\\nc" pasted into an EMPTY item', async ({ page }) => {
    await buildDoc(page, [UL(I(''))]);
    await focusEmpty(page);
    await pasteText(page, 'a\nb\nc');
    // BROKEN: result is "ul[a, p(b), p(c)]": the extra lines become PARAGRAPHS that are direct children of the
    // list (invalid tree). nabu.svelte.js insertFragment (leaf last/middle blocks) only calls wrapOrphan for blocks
    // with a requiredParent, so a paragraph is dropped into the list as is. (Notion / Docs: one list item per line.)
    expect(await texts(page)).toEqual(['a', 'b', 'c']);
    await expectValidSoft(page);
    await expectCaret(page, 'c|');
  });

  test('23b · plain text "a\\nb\\nc" pasted at the END of a non-empty item', async ({ page }) => {
    await buildDoc(page, [UL(I('x'))]);
    await focusEnd(page, 'x');
    await pasteText(page, 'a\nb\nc');
    // BROKEN: same root cause as 23a ("ul[xa, p(b), p(c)]").
    expect(await texts(page)).toEqual(['xa', 'b', 'c']);
    await expectValidSoft(page);
  });

  test('24 · markdown "- x\\n- y" pasted into an EMPTY item', async ({ page }) => {
    await buildDoc(page, [UL(I(''), I('after'))]);
    await focusEmpty(page);
    await pasteText(page, '- x\n- y');
    // BROKEN: a LIST is inserted as a direct child of the list ("ul[∅, ul[x, y], after]"): list under list, and the
    // empty item remains. Same cause as 23 (no wrapOrphan / no unwrapping of the fragment list into the host list).
    expect(await texts(page)).toEqual(['x', 'y', 'after']);
    await expectValidSoft(page);
  });

  test('25a · plain text pasted into an empty NESTED item', async ({ page }) => {
    await buildDoc(page, [UL(I('p', UL(I(''))))]);
    await focusEmpty(page);
    await pasteText(page, 'a\nb\nc');
    // BROKEN: paragraphs end up inside the nested list ("ul[p > ul[a, p(b), p(c)]]"), same cause as 23a.
    expect(await texts(page)).toEqual(['p', 'a', 'b', 'c']);
    await expectValidSoft(page);
  });

  test('25b · markdown list pasted at the end of a NESTED item', async ({ page }) => {
    await buildDoc(page, [UL(I('p', UL(I('n1'))))]);
    await focusEnd(page, 'n1');
    await pasteText(page, '- x\n- y');
    // BROKEN: a list is nested directly in the sublist ("ul[p > ul[n1, ul[x, y]]]"), same cause as 24.
    expect(await texts(page)).toEqual(['p', 'n1', 'x', 'y']);
    await expectValidSoft(page);
  });

  test('25c · a single line pasted into a nested item stays inline in that item', async ({ page }) => {
    await buildDoc(page, [UL(I('p', UL(I('n1'))))]);
    await focusEnd(page, 'n1');
    await pasteText(page, 'abc');
    // CURRENT: plain inline insert.
    await expectOutline(page, 'ul[p > ul[n1abc]]');
    await expectCaret(page, 'n1abc|');
    await expectValid(page);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// H. Navigation / DOM / conversion
// ═══════════════════════════════════════════════════════════════════════════

test.describe('H · Misc', () => {
  test('26 · ArrowDown / ArrowUp walk through nested items in visual order', async ({ page }) => {
    await buildDoc(page, [UL(I('top1'), I('mid', UL(I('sub1'), I('sub2'))), I('top3'))]);
    await focusAt(page, 'top1', 2);
    const at = async () => ((await caret(page)) ?? '').replace('|', '');
    const down: string[] = [];
    for (let i = 0; i < 4; i++) { await press(page, 'ArrowDown'); down.push(await at()); }
    // CURRENT: the caret goes to the visually adjacent item, descending into the sublist and back out.
    expect(down).toEqual(['mid', 'sub1', 'sub2', 'top3']);
    const up: string[] = [];
    for (let i = 0; i < 3; i++) { await press(page, 'ArrowUp'); up.push(await at()); }
    expect(up).toEqual(['sub2', 'sub1', 'mid']);
    await expectValid(page);
  });

  test('27 · a nested ordered list renders as <ol> inside the 2nd <li>, with its own numbering', async ({ page }) => {
    await buildDoc(page, [OL(I('one'), I('two', OL(I('x'), I('y'))), I('three'))]);
    const outer = page.locator('ol[data-block-type="list"]').first();
    await expect(outer.locator(':scope > li[data-block-type="list-item"]')).toHaveCount(3);
    const inner = outer.locator(':scope > li').nth(1).locator('ol[data-block-type="list"]');
    // CURRENT: the sublist sits in a wrapper <div> inside the parent <li>, as its own <ol> (new counter: 1., 2.).
    await expect(inner).toHaveCount(1);
    await expect(inner.locator(':scope > li[data-block-type="list-item"]')).toHaveCount(2);
    await expect(inner.locator(':scope > li').first()).toContainText('x');
    await expect(inner.locator(':scope > li').nth(1)).toContainText('y');
    // no stray <li> straight under the outer <ol> for nested items, and no `start` attribute by default
    await expect(outer.locator(':scope > li')).toHaveCount(3);
    await expect(outer).not.toHaveAttribute('start', /.*/);
    await expect(inner).not.toHaveAttribute('start', /.*/);
    const styles = await page.evaluate(() => {
      const o = document.querySelector('ol[data-block-type="list"]')!;
      const i = o.querySelector('ol[data-block-type="list"]')!;
      return {
        outerType: getComputedStyle(o).listStyleType, innerType: getComputedStyle(i).listStyleType,
        liDisplay: getComputedStyle(i.querySelector('li')!).display,
      };
    });
    expect(styles).toEqual({ outerType: 'decimal', innerType: 'decimal', liDisplay: 'list-item' });
    expect(await getMarkdown(page)).toBe('1. one\n2. two\n  1. x\n  2. y\n3. three');
  });

  test('28a · transforming a bullet item to a paragraph (block:transform) keeps the tree valid', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I('bb'), I('c'))]);
    await focusAt(page, 'bb', 1);
    await exec(page, 'block:transform', { type: 'paragraph' });
    // BROKEN: the list-item is retyped in place ("ul[a, p(bb), c]"): a paragraph under a list, the list is not split
    // (block.extension.js transformBlock only sets `type`; no un-nesting for blocks inside a container).
    expect(await texts(page)).toEqual(['a', 'bb', 'c']);
    await expectValidSoft(page);
    expect(await typeAndOutline(page)).toContain('bXb');
  });

  test('28b · transforming an item WITH children to a paragraph does not hide its children', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I('bb', UL(I('b1'))), I('c'))]);
    await focusAt(page, 'bb', 1);
    await exec(page, 'block:transform', { type: 'paragraph' });
    // BROKEN: besides 28a's invalid tree, the paragraph block has no children renderer: "b1" stays in the model
    // (p(bb){ul[b1]}) but disappears from the DOM / serializers.
    expect(await texts(page)).toEqual(['a', 'bb', 'b1', 'c']);
    await expect(getEditor(page)).toContainText('b1');
    await expectValidSoft(page);
  });

  const slashCmd = async (page: Page, query: string) => {
    await page.keyboard.type('/' + query);
    await page.waitForSelector('.nabu-slash');
    await press(page, 'Enter');
    await flushRender(page);
  };

  test('28c · slash menu "Numbered list" on a bullet item', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I(''), I('c'))]);
    await focusEmpty(page);
    await slashCmd(page, 'numb');
    // BROKEN: a NEW ordered list is created as a direct child of the bullet list ("ul[a, ol[∅], c]"): list under list.
    // slash-menu.svelte.js createListInBlock replaces the anchor block by a List at the same index, whatever its
    // parent. (Notion / Docs: the item changes list type in place, splitting the surrounding list.)
    expect(await texts(page)).toEqual(['a', 'c']);
    await expectValidSoft(page);
    expect(await typeAndOutline(page)).toContain('X');
  });

  test('28d · slash menu "To-do list" on a bullet item', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I(''), I('c'))]);
    await focusEmpty(page);
    await slashCmd(page, 'to-do');
    // BROKEN: same cause as 28c ("ul[a, todo[[ ] ∅], c]").
    expect(await texts(page)).toEqual(['a', 'c']);
    await expectValidSoft(page);
  });

  test('28e · slash menu "Text" on a bullet item', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I(''), I('c'))]);
    await focusEmpty(page);
    await slashCmd(page, 'text');
    // BROKEN: same cause as 28a (exec('paragraph') -> block:transform in place).
    expect(await texts(page)).toEqual(['a', 'c']);
    await expectValidSoft(page);
  });
});
