/**
 * E2E — hard STRUCTURAL cases of lists (nested lists, sublists, todo), driven by REAL keyboard / mouse input.
 *
 * Fixtures are built programmatically (`buildDoc`), operations use real keys; assertions run on the MODEL tree
 * (`outline`, read from the Loro tree), the caret (`caret`, block text with a `|`) and structural invariants
 * (`violations` / `expectValid`: list-item only under a list, list only at root or under an item, no empty list,
 * Block instances + DOM in sync with the tree).
 *
 * Convention: a test documents the DECIDED (product owner) behaviour in a one-line "DECIDED:" comment, or the CURRENT
 * one ("CURRENT:") when it is coherent and data-preserving but not specifically decided (Notion / Google Docs /
 * ProseMirror differ). A test is left FAILING only when
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
    // DECIDED: a top-level empty item exits the list: split in two with an empty paragraph in between.
    await expectOutline(page, 'ul[a] ; p(∅) ; ul[b]');
    await expectCaret(page, '|');
    expect(await typeAndOutline(page)).toBe('ul[a] ; p(X) ; ul[b]');
    await expectValid(page);
  });

  test('4b · Enter on an EMPTY FIRST item of a multi-item list leaves no empty list behind', async ({ page }) => {
    await buildDoc(page, [UL(I(''), I('b'))]);
    await focusEmpty(page);
    await press(page, 'Enter');
    // DECIDED: the emptied original list is removed; the paragraph comes first, the rest stays a list.
    await expectOutline(page, 'p(∅) ; ul[b]');
    await expectCaret(page, '|');
    await expectValid(page);
  });

  test('4c · Enter on an EMPTY LAST item exits the list into a paragraph right after it', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I(''))]);
    await focusEmpty(page);
    await press(page, 'Enter');
    // DECIDED: the empty item becomes a paragraph right after the list.
    await expectOutline(page, 'ul[a] ; p(∅)');
    expect(await typeAndOutline(page)).toBe('ul[a] ; p(X)');
    await expectValid(page);
  });

  test('5a · Enter on an EMPTY NESTED item that is the last child of its sublist unindents it one level', async ({ page }) => {
    await buildDoc(page, [UL(I('a', UL(I('s1'), I(''))), I('b'))]);
    await focusEmpty(page);
    await press(page, 'Enter');
    // DECIDED: step back one level, exactly like Shift+Tab: the item lands after its parent "a", caret stays in it.
    await expectOutline(page, 'ul[a > ul[s1], ∅, b]');
    await expectCaret(page, '|');
    expect(await typeAndOutline(page)).toBe('ul[a > ul[s1], X, b]');
    await expectValid(page);
  });

  test('5b · Enter on an EMPTY NESTED item in the middle of its sublist unindents it and its followers become its children', async ({ page }) => {
    await buildDoc(page, [UL(I('a', UL(I('s1'), I(''), I('s2'))), I('b'))]);
    await focusEmpty(page);
    await press(page, 'Enter');
    // DECIDED: same as Shift+Tab (unindentNode): "s2" is adopted as a child of the unindented item.
    await expectOutline(page, 'ul[a > ul[s1], ∅ > ul[s2], b]');
    await expectCaret(page, '|');
    expect(await typeAndOutline(page)).toBe('ul[a > ul[s1], X > ul[s2], b]');
    await expectValid(page);
  });

  test('5c · Enter on an empty nested item twice goes back to the root level, a third Enter exits the list', async ({ page }) => {
    await buildDoc(page, [UL(I('a', UL(I('s1'), I(''))), I('b'))]);
    await focusEmpty(page);
    await press(page, 'Enter');
    await expectOutline(page, 'ul[a > ul[s1], ∅, b]');
    await press(page, 'Enter');
    // DECIDED: the 2nd Enter is the top-level case: the list is split around a paragraph.
    await expectOutline(page, 'ul[a > ul[s1]] ; p(∅) ; ul[b]');
    await expectCaret(page, '|');
    expect(await typeAndOutline(page)).toBe('ul[a > ul[s1]] ; p(X) ; ul[b]');
    await expectValid(page);
  });

  test('5d · one Ctrl+Z after Enter on an empty item restores structure and caret (nested and top-level)', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I(''), I('b', UL(I('s'), I(''))))]);
    const original = await outline(page);
    await focusEmpty(page, 1); // the nested one
    await press(page, 'Enter');
    await expectOutline(page, 'ul[a, ∅, b > ul[s], ∅]');
    await undo(page);
    await expectOutline(page, original);
    await expectCaret(page, '|');
    expect(await typeAndOutline(page)).toBe('ul[a, ∅, b > ul[s, X]]');
    await expectValid(page);

    await buildDoc(page, [UL(I('a'), I(''), I('b'))]);
    await focusEmpty(page);
    await press(page, 'Enter');
    await expectOutline(page, 'ul[a] ; p(∅) ; ul[b]');
    await undo(page);
    await expectOutline(page, 'ul[a, ∅, b]');
    await expectCaret(page, '|');
    await expectValid(page);
  });

  test('5e · Enter on an empty item of an ORDERED list keeps the numbering of the tail', async ({ page }) => {
    await buildDoc(page, [OL(I('a'), I(''), I('c'), I('d'))]);
    await focusEmpty(page);
    await press(page, 'Enter');
    await expectOutline(page, 'ol[a] ; p(∅) ; ol[c, d]');
    await expect(page.locator('ol[data-block-type="list"]').nth(1)).toHaveAttribute('start', '3');
    await expectMd(page, '1. a\n\n3. c\n4. d');
    await expectValid(page);
  });

  test('6 · Enter on an empty item that is the ONLY item of the list removes the list', async ({ page }) => {
    await buildDoc(page, [UL(I(''))]);
    await focusEmpty(page);
    await press(page, 'Enter');
    // DECIDED: the list disappears, replaced by an empty paragraph (caret in it).
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
  test('7a · Backspace at offset 0 of a MIDDLE item (no children) turns ONLY that item into a paragraph', async ({ page }) => {
    await buildDoc(page, [UL(I('aa'), I('bb'), I('cc'))]);
    await focusAt(page, 'bb', 0);
    await press(page, 'Backspace');
    // DECIDED: step back one level: the list is split around the paragraph, text and caret preserved.
    await expectOutline(page, 'ul[aa] ; p(bb) ; ul[cc]');
    await expectCaret(page, '|bb');
    expect(await typeAndOutline(page)).toBe('ul[aa] ; p(Xbb) ; ul[cc]');
    await expectValid(page);
  });

  test('7a2 · a SECOND Backspace then merges the paragraph into the last item above', async ({ page }) => {
    await buildDoc(page, [UL(I('aa'), I('bb'), I('cc'))]);
    await focusAt(page, 'bb', 0);
    await press(page, 'Backspace');
    await press(page, 'Backspace');
    // DECIDED: the normal paragraph merge (the two lists become adjacent again and merge).
    await expectOutline(page, 'ul[aabb, cc]');
    await expectCaret(page, 'aa|bb');
    expect(await typeAndOutline(page)).toBe('ul[aaXbb, cc]');
    await expectValid(page);
  });

  test('7a3 · Backspace with a selection, or not at offset 0, keeps its usual meaning', async ({ page }) => {
    await buildDoc(page, [UL(I('aa'), I('bb'), I('cc'))]);
    await focusAt(page, 'bb', 1);
    await press(page, 'Backspace');
    await expectOutline(page, 'ul[aa, b, cc]');
    await selectRange(page, 'aa', 0, 'b', 1);
    await press(page, 'Backspace');
    expect(await texts(page)).toEqual(['cc']);
    await expectValid(page);
  });

  test('7b · Backspace at offset 0 of the FIRST item of a list that follows a paragraph turns it into a paragraph (no merge yet)', async ({ page }) => {
    await buildDoc(page, [P('p0'), UL(I('aa'), I('bb'))]);
    await focusAt(page, 'aa', 0);
    await press(page, 'Backspace');
    // DECIDED: the item leaves the list first; a second Backspace would merge it into "p0".
    await expectOutline(page, 'p(p0) ; p(aa) ; ul[bb]');
    await expectCaret(page, '|aa');
    await press(page, 'Backspace');
    await expectOutline(page, 'p(p0aa) ; ul[bb]');
    await expectCaret(page, 'p0|aa');
    await expectValid(page);
  });

  test('7b2 · Backspace at offset 0 of the first item of the FIRST list of the document turns it into a paragraph', async ({ page }) => {
    await buildDoc(page, [UL(I('aa'), I('bb'))]);
    await focusAt(page, 'aa', 0);
    await press(page, 'Backspace');
    // DECIDED: top-level -> paragraph, the rest stays a list; caret and typing intact.
    await expectOutline(page, 'p(aa) ; ul[bb]');
    await expectCaret(page, '|aa');
    expect(await typeAndOutline(page)).toBe('p(Xaa) ; ul[bb]');
    await expectValid(page);
  });

  test('7c · Backspace at offset 0 of the FIRST item of a nested sublist unindents it one level', async ({ page }) => {
    await buildDoc(page, [UL(I('aa', UL(I('s1'), I('s2'))), I('bb'))]);
    await focusAt(page, 's1', 0);
    await press(page, 'Backspace');
    // DECIDED: like Shift+Tab: "s1" lands after "aa" and adopts its follower "s2"; caret stays at offset 0.
    await expectOutline(page, 'ul[aa, s1 > ul[s2], bb]');
    await expectCaret(page, '|s1');
    expect(await typeAndOutline(page)).toBe('ul[aa, Xs1 > ul[s2], bb]');
    await expectValid(page);
  });

  test('7d · Backspace on a nested item, twice: unindent, then the item becomes a paragraph', async ({ page }) => {
    await buildDoc(page, [UL(I('aa', UL(I('s1'))), I('bb'))]);
    await focusAt(page, 's1', 0);
    await press(page, 'Backspace');
    await expectOutline(page, 'ul[aa, s1, bb]');
    await press(page, 'Backspace');
    await expectOutline(page, 'ul[aa] ; p(s1) ; ul[bb]');
    await expectCaret(page, '|s1');
    await expectValid(page);
  });

  test('7e · Backspace on a middle top-level item of an ORDERED list keeps the numbering (<ol start>, markdown)', async ({ page }) => {
    await buildDoc(page, [OL(I('a'), I('b'), I('c'))]);
    await focusAt(page, 'b', 0);
    await press(page, 'Backspace');
    // DECIDED: the tail list starts at the number its first item had (3).
    await expectOutline(page, 'ol[a] ; p(b) ; ol[c]');
    const lists = page.locator('ol[data-block-type="list"]');
    await expect(lists).toHaveCount(2);
    await expect(lists.nth(0)).not.toHaveAttribute('start', /.*/);
    await expect(lists.nth(1)).toHaveAttribute('start', '3');
    await expectMd(page, '1. a\n\nb\n\n3. c');
    await expectValid(page);
  });

  test('7f · one Ctrl+Z after Backspace restores structure + caret (top-level and nested)', async ({ page }) => {
    await buildDoc(page, [OL(I('a'), I('bb', UL(I('s1'), I('s2'))), I('c'))]);
    const original = await outline(page);
    await focusAt(page, 'bb', 0);
    await press(page, 'Backspace');
    await expectOutline(page, 'ol[a] ; p(bb) ; ul[s1, s2] ; ol[c]');
    await undo(page);
    await expectOutline(page, original);
    await expectCaret(page, '|bb');
    await expectMd(page, '1. a\n2. bb\n  - s1\n  - s2\n3. c');
    expect(await typeAndOutline(page)).toBe('ol[a, Xbb > ul[s1, s2], c]');
    await expectValid(page);

    await focusAt(page, 's2', 0);
    await press(page, 'Backspace');
    await expectOutline(page, 'ol[a, Xbb > ul[s1], s2, c]');
    await undo(page);
    await expectOutline(page, 'ol[a, Xbb > ul[s1, s2], c]');
    await expectCaret(page, '|s2');
    await expectValid(page);
  });

  test('8 · Backspace at offset 0 of an item that HAS children: the item becomes a paragraph, the children stay a list right below', async ({ page }) => {
    await buildDoc(page, [UL(I('aa'), I('Parent', UL(I('c1'), I('c2'))), I('bb'))]);
    await focusAt(page, 'Parent', 0);
    await press(page, 'Backspace');
    // DECIDED: nothing lost, no other item changes type; the sub-items keep their relative nesting
    // (and merge with the list of the items that followed, which has the same type and is now adjacent).
    await expectOutline(page, 'ul[aa] ; p(Parent) ; ul[c1, c2, bb]');
    await expectCaret(page, '|Parent');
    await expectValid(page);
  });

  test('8a · Backspace on an item with NESTED grandchildren keeps their relative nesting', async ({ page }) => {
    await buildDoc(page, [UL(I('P', UL(I('c1', UL(I('g1'))), I('c2'))))]);
    await focusAt(page, 'P', 0);
    await press(page, 'Backspace');
    await expectOutline(page, 'p(P) ; ul[c1 > ul[g1], c2]');
    await expectValid(page);
  });

  test('8b · Backspace at offset 0 of an item whose PREVIOUS item has children turns it into a paragraph, that list is untouched', async ({ page }) => {
    await buildDoc(page, [UL(I('a', UL(I('a1'), I('a2'))), I('b'))]);
    await focusAt(page, 'b', 0);
    await press(page, 'Backspace');
    // DECIDED: top-level -> paragraph; a SECOND Backspace merges into the last descendant ("a2"), like a flat editor.
    await expectOutline(page, 'ul[a > ul[a1, a2]] ; p(b)');
    await press(page, 'Backspace');
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
  test('11 · Tab on an item that HAS children: the whole subtree moves along', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I('bbb', UL(I('b1'), I('b2'))), I('c'))]);
    await focusAt(page, 'bbb', 1);
    await press(page, 'Tab');
    // DECIDED: "bbb" goes under "a" and keeps its children (they go one level deeper with it).
    await expectOutline(page, 'ul[a > ul[bbb > ul[b1, b2]], c]');
    await expectMd(page, '- a\n  - bbb\n    - b1\n    - b2\n- c');
    await expectCaret(page, 'b|bb');
    await expectValid(page);
  });

  test('11a · Tab on an item with children, then Ctrl+Z: structure and caret restored in one step', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I('bbb', UL(I('b1'), I('b2'))), I('c'))]);
    const original = await outline(page);
    await focusAt(page, 'bbb', 1);
    await press(page, 'Tab');
    await undo(page);
    await expectOutline(page, original);
    await expectCaret(page, 'b|bb');
    await expectValid(page);
  });

  test('11c · Shift+Tab on a nested item with children keeps its children; the followers are appended after them', async ({ page }) => {
    await buildDoc(page, [UL(I('a', UL(I('s1', UL(I('k1'))), I('s2'))), I('b'))]);
    await focusAt(page, 's1', 1);
    await press(page, 'Shift+Tab');
    // DECIDED: its own children stay its children (the follower "s2" joins them).
    await expectOutline(page, 'ul[a, s1 > ul[k1, s2], b]');
    await expectCaret(page, 's|1');
    await expectValid(page);
  });

  test('11d · Tab with several selected items: a selected child moves with its selected parent, once', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I('bbb', UL(I('b1'), I('b2'))), I('c'))]);
    await selectRange(page, 'bbb', 0, 'c', 1);
    await press(page, 'Tab');
    await expectOutline(page, 'ul[a > ul[bbb > ul[b1, b2], c]]');
    await expectValid(page);
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

  test('22 · Ctrl+Enter toggles the todo item (caret unchanged), a second press unchecks, one undo step each', async ({ page }) => {
    await buildDoc(page, [TODO(I('t1'), I('t2', { checked: true }))]);
    await focusAt(page, 't1', 1);
    await press(page, 'Control+Enter');
    // DECIDED: Ctrl/Cmd+Enter toggles `checked` of the todo item under the caret; the caret stays; no item is created.
    await expectOutline(page, 'todo[[x] t1, [x] t2]');
    await expectCaret(page, 't|1');
    expect(await typeAndOutline(page, 'Q')).toBe('todo[[x] tQ1, [x] t2]');
    await focusAt(page, 'tQ1', 2);
    await press(page, 'Control+Enter');
    await expectOutline(page, 'todo[[ ] tQ1, [x] t2]');
    await undo(page);
    await expectOutline(page, 'todo[[x] tQ1, [x] t2]');
    await expectValid(page);
  });

  test('22b · Ctrl+Enter with a selection over several todo items: any unchecked -> check all, else uncheck all', async ({ page }) => {
    await buildDoc(page, [TODO(I('t1', { checked: true }), I('t2'), I('t3', { sub: TODO(I('t4', { checked: true })) }))]);
    await selectRange(page, 't1', 1, 't3', 1);
    await press(page, 'Control+Enter');
    await expectOutline(page, 'todo[[x] t1, [x] t2, [x] t3 > todo[[x] t4]]');
    await expectCaret(page, 't1@1 -> t3@1');
    await press(page, 'Control+Enter');
    await expectOutline(page, 'todo[[ ] t1, [ ] t2, [ ] t3 > todo[[x] t4]]');
    await undo(page);
    await expectOutline(page, 'todo[[x] t1, [x] t2, [x] t3 > todo[[x] t4]]');
    await expectValid(page);
  });

  test('22c · Ctrl+Enter outside a todo item does nothing', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I('b'))]);
    await focusAt(page, 'a', 1);
    await press(page, 'Control+Enter');
    await expectOutline(page, 'ul[a, b]');
    await expectCaret(page, 'a|');
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

  test('28a · transforming a bullet item to a paragraph (block:transform) splits the list around it', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I('bb'), I('c'))]);
    await focusAt(page, 'bb', 1);
    await exec(page, 'block:transform', { type: 'paragraph' });
    // DECIDED (P-26): only that item changes type, in place: same result as Backspace on a top-level item.
    await expectOutline(page, 'ul[a] ; p(bb) ; ul[c]');
    expect(await texts(page)).toEqual(['a', 'bb', 'c']);
    await expectCaret(page, 'b|b');
    await expectValidSoft(page);
    expect(await typeAndOutline(page)).toContain('bXb');
  });

  test('28b · transforming an item WITH children to a paragraph keeps its children as a list right below', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I('bb', UL(I('b1'))), I('c'))]);
    await focusAt(page, 'bb', 1);
    await exec(page, 'block:transform', { type: 'paragraph' });
    // DECIDED (P-26): the sub-items stay a list right after the new block.
    await expectOutline(page, 'ul[a] ; p(bb) ; ul[b1, c]');
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

  test('28c · slash menu "Numbered list" on a bullet item turns ONLY that item into an ordered list', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I(''), I('c'))]);
    await focusEmpty(page);
    await slashCmd(page, 'numb');
    // DECIDED (P-26): the surrounding list is split around the item.
    await expectOutline(page, 'ul[a] ; ol[∅] ; ul[c]');
    await expectCaret(page, '|');
    expect(await typeAndOutline(page)).toBe('ul[a] ; ol[X] ; ul[c]');
    await expectValidSoft(page);
  });

  test('28d · slash menu "To-do list" on a bullet item', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I(''), I('c'))]);
    await focusEmpty(page);
    await slashCmd(page, 'to-do');
    // DECIDED (P-26): same as 28c; the item enters the todo list unchecked.
    await expectOutline(page, 'ul[a] ; todo[[ ] ∅] ; ul[c]');
    await expectValidSoft(page);
  });

  test('28e · slash menu "Text" on a bullet item', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I(''), I('c'))]);
    await focusEmpty(page);
    await slashCmd(page, 'text');
    // DECIDED (P-26): same as 28a.
    await expectOutline(page, 'ul[a] ; p(∅) ; ul[c]');
    await expectValidSoft(page);
  });

  test('28f · "Numbered list" on a bullet item keeps its text and caret; converting to the SAME type does nothing', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I('bb'), I('c'))]);
    await focusAt(page, 'bb', 1);
    await exec(page, 'list:convert', { listType: 'bullet' });
    await expectOutline(page, 'ul[a, bb, c]');
    await exec(page, 'list:convert', { listType: 'ordered' });
    await expectOutline(page, 'ul[a] ; ol[bb] ; ul[c]');
    await expectCaret(page, 'b|b');
    await expectMd(page, '- a\n\n1. bb\n\n- c');
    await undo(page);
    await expectOutline(page, 'ul[a, bb, c]');
    await expectValid(page);
  });

  test('28g · the LAST bullet item right above an ordered list becomes part of it', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I('b')), OL(I('x'), I('y'))]);
    await focusAt(page, 'b', 1);
    await exec(page, 'list:convert', { listType: 'ordered' });
    await expectOutline(page, 'ul[a] ; ol[b, x, y]');
    await expectValid(page);
  });

  test('28h · "Text" on a MIDDLE ordered item: the numbering of the tail continues', async ({ page }) => {
    await buildDoc(page, [OL(I('a'), I('b'), I('c'), I('d'))]);
    await focusAt(page, 'b', 1);
    await exec(page, 'paragraph');
    await expectOutline(page, 'ol[a] ; p(b) ; ol[c, d]');
    const lists = page.locator('ol[data-block-type="list"]');
    await expect(lists.nth(1)).toHaveAttribute('start', '3');
    await expectMd(page, '1. a\n\nb\n\n3. c\n4. d');
    await expectValid(page);
  });

  test('28i · "Heading 1" on a NESTED item: unindented to the top level (followers become its children), then lifted', async ({ page }) => {
    await buildDoc(page, [UL(I('a', UL(I('s1'), I('s2'), I('s3'))), I('z'))]);
    await focusAt(page, 's2', 1);
    await exec(page, 'heading:1');
    // DECIDED (P-26): same as pressing Backspace until the item is top-level, then on it: order and items are kept.
    await expectOutline(page, 'ul[a > ul[s1]] ; heading(s2) ; ul[s3, z]');
    expect(await texts(page)).toEqual(['a', 's1', 's2', 's3', 'z']);
    await expectCaret(page, 's|2');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[a > ul[s1, s2, s3], z]');
  });

  test('28j · "To-do list" on an item WITH children keeps them; leaving the todo list drops `checked`', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I('b', UL(I('b1'), I('b2'))), I('c'))]);
    await focusAt(page, 'b', 1);
    await exec(page, 'list:convert', { listType: 'todo' });
    await expectOutline(page, 'ul[a] ; todo[[ ] b > ul[b1, b2]] ; ul[c]');
    await press(page, 'Control+Enter');
    await expectOutline(page, 'ul[a] ; todo[[x] b > ul[b1, b2]] ; ul[c]');
    await exec(page, 'list:convert', { listType: 'bullet' });
    await expectOutline(page, 'ul[a, b > ul[b1, b2], c]');
    expect((await getJson(page)).blocks[0].children[1].checked).toBeUndefined();
    await expectValid(page);
  });

  test('28k · "# " typed at the start of a list item follows the same rule (list split, item becomes a heading)', async ({ page }) => {
    await buildDoc(page, [UL(I('a'), I('b'), I('c'))]);
    await focusAt(page, 'b', 0);
    await page.keyboard.type('# ');
    await expectOutline(page, 'ul[a] ; heading(b) ; ul[c]');
    await expectValid(page);
  });
});
