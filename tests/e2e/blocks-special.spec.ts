/**
 * E2E — EDITING behaviour of the "special" blocks Code, Toggle and Divider, driven by REAL keyboard / mouse input
 * (triggers like "``` + Enter", "--- " are covered by shortcuts-slash.spec.ts and are not repeated here).
 *
 * Fixtures are built programmatically (`buildTree`); assertions run on the MODEL tree (`tree`: `p(a) ; code:js(x\ny) ;
 * toggle▾(Head){p(child)} ; toggle▸(...) ; hr`), the caret (`caret`) and the structural invariants. Conventions as in
 * blocks-text.spec.ts: "CURRENT:" = coherent, data-preserving behaviour that is not specifically decided (Notion /
 * Docs differ), "DECIDED:" = product decision, "BROKEN:" = clearly broken (lost / stuck caret, swallowed keystroke,
 * text or children lost, no keyboard way out…) and the test is left FAILING.
 *
 *  A. Code (1-7)     B. Toggle (8-12d)     C. Divider (13-15)     D. Cross-block selection (16)
 */

import { test, expect, type Page } from './helpers/test.js';
import { gotoEditor, clearAndReset, press, getMarkdown, getJson, flushRender } from './helpers/editor.js';
import { undo, bold } from './helpers/keyboard.js';
import { pasteText, pasteHtml } from './helpers/clipboard.js';
import { caret, violations, focusAt, focusEnd, focusEmpty, selectRange, allText, collectErrors } from './helpers/model.js';
import { buildTree, tree, Code, Tog, Hr, Pp } from './helpers/blocks.js';

// ── local helpers ──────────────────────────────────────────────────────────

const expectTree = (page: Page, expected: string) =>
  expect.poll(() => tree(page), { timeout: 3000, message: 'model tree' }).toBe(expected);
const expectCaret = (page: Page, expected: string | null) =>
  expect.poll(() => caret(page), { timeout: 3000, message: 'caret' }).toBe(expected);
const focusInEditor = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('[contenteditable="true"]'));
/** Structural validity. A COLLAPSED toggle does not render its body, so the "one DOM node per block" check is skipped for it. */
async function expectValid(page: Page) {
  const v = (await violations(page)).filter((x) => !x.startsWith('DOM has') && !x.startsWith('DOM block'));
  expect(v).toEqual([]);
}
/** Type one char and return the tree, to check the caret is usable where it is expected. */
async function typeAndTree(page: Page, ch = 'X') {
  await page.keyboard.type(ch);
  return tree(page);
}
/** Where is the native caret right now: the id-less description of the DOM node, for failure messages. */
const rawCaret = (page: Page) => page.evaluate(() => {
  const s = getSelection();
  const n: any = s?.anchorNode;
  if (!n) return 'no selection';
  const el: Element = n.nodeType === 1 ? n : n.parentElement;
  return `${n.nodeName}@${s!.anchorOffset} in .${(el.className || '').toString().split(' ')[0]}`;
});

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
// A. Code
// ═══════════════════════════════════════════════════════════════════════════

test.describe('A · Code', () => {
  test('1 · Enter inserts a newline INSIDE the code block (no split); one undo restores', async ({ page }) => {
    await buildTree(page, [Code('ab', 'js')]);
    await focusAt(page, 'ab', 1);
    await press(page, 'Enter');
    // DECIDED: splitsOnEnter = false on code: Enter is a literal "\n", language kept.
    await expectTree(page, 'code:js(a\\nb)');
    await expectCaret(page, 'a\n|b');
    expect(await typeAndTree(page, 'X')).toBe('code:js(a\\nXb)');
    await press(page, 'Backspace');
    await expectTree(page, 'code:js(a\\nb)');
    await undo(page);
    // one undo = the Enter (the typed X / Backspace were a no-net-change pair, history may coalesce them)
    await expect.poll(() => tree(page)).toMatch(/^code:js\((ab|a\\nb)\)$/);
    await undo(page);
    await expectTree(page, 'code:js(ab)');
    await expectValid(page);
  });

  test('1b · Enter at the END (and twice) adds trailing newlines, still one block; markdown keeps them inside the fence', async ({ page }) => {
    await buildTree(page, [Code('ab')]);
    await focusEnd(page, 'ab');
    await press(page, 'Enter');
    await expectTree(page, 'code(ab\\n)');
    await expectCaret(page, 'ab\n|');
    await press(page, 'Enter');
    await expectTree(page, 'code(ab\\n\\n)');
    expect(await typeAndTree(page, 'z')).toBe('code(ab\\n\\nz)');
    expect(await getMarkdown(page)).toBe('```\nab\n\nz\n```');
    await expectValid(page);
  });

  test('2 · Tab inserts TWO SPACES at the caret, Shift+Tab removes up to two leading spaces; focus stays; undo restores', async ({ page }) => {
    await buildTree(page, [Code('ab\ncd')]);
    await focusAt(page, 'ab\ncd', 4); // "ab\nc|d"
    await press(page, 'Tab');
    // DECIDED: soft indentation of 2 spaces inserted AT THE CARET (not at the line start, not a "\t").
    await expectTree(page, 'code(ab\\nc  d)');
    await expectCaret(page, 'ab\nc  |d');
    expect(await focusInEditor(page)).toBe(true);
    // Shift+Tab: outdent the CURRENT line, which now is "c  d" (no leading spaces) -> nothing to remove, key still swallowed.
    await press(page, 'Shift+Tab');
    await expectTree(page, 'code(ab\\nc  d)');
    expect(await focusInEditor(page)).toBe(true);
    // Indent at the start of the line, then outdent it.
    await press(page, 'Home');
    await press(page, 'Tab');
    await expectTree(page, 'code(ab\\n  c  d)');
    await press(page, 'Shift+Tab');
    await expectTree(page, 'code(ab\\nc  d)');
    expect(await focusInEditor(page)).toBe(true);
    // typing continues at the caret
    const t = await typeAndTree(page, 'X');
    expect(t).toMatch(/^code\(ab\\n.*X.*\)$/);
    await expectValid(page);
  });

  test('2b · Tab then Ctrl+Z restores the text; Tab with a selection REPLACES it by two spaces (undo gives it back)', async ({ page }) => {
    await buildTree(page, [Code('abcd')]);
    await focusAt(page, 'abcd', 2);
    await press(page, 'Tab');
    await expectTree(page, 'code(ab  cd)');
    await undo(page);
    await expectTree(page, 'code(abcd)');
    await selectRange(page, 'abcd', 1, 'abcd', 3);
    await press(page, 'Tab');
    // CURRENT: a non-collapsed selection is deleted and replaced by "  " (VS Code / Notion would indent the line instead).
    await expectTree(page, 'code(a  d)');
    expect(await focusInEditor(page)).toBe(true);
    await undo(page);
    await expectTree(page, 'code(abcd)');
    await expectValid(page);
  });

  test('3 · EXIT a code block at the end of the document: ArrowDown on the last line creates a paragraph (Enter / Ctrl+Enter do not)', async ({ page }) => {
    await buildTree(page, [Code('l1\nl2')]);
    await focusEnd(page, 'l1\nl2');
    await press(page, 'Control+Enter');
    // CURRENT: Ctrl+Enter is not bound; Enter only adds a newline (see 1b). The way out is ArrowDown.
    await expectTree(page, 'code(l1\\nl2)');
    await press(page, 'ArrowUp'); // moves to line 1, still in the block
    await press(page, 'ArrowDown'); // back to the last line, still no new block
    await expectTree(page, 'code(l1\\nl2)');
    await press(page, 'ArrowDown');
    // DECIDED: ArrowDown from the last line of the LAST block of the document appends an empty paragraph, caret in it.
    await expectTree(page, 'code(l1\\nl2) ; p(∅)');
    await expectCaret(page, '|');
    expect(await typeAndTree(page, 'X')).toBe('code(l1\\nl2) ; p(X)');
    await expectValid(page);
    // one undo removes the typed char; the structural step (the paragraph) is undone by the next one
    await undo(page);
    await undo(page);
    await expectTree(page, 'code(l1\\nl2)');
  });

  test('3b · with a block after the code block, ArrowDown from its last line moves the caret to that block (no extra paragraph)', async ({ page }) => {
    await buildTree(page, [Code('l1\nl2'), Pp('after')]);
    await focusEnd(page, 'l1\nl2');
    await press(page, 'ArrowDown');
    await page.keyboard.type('X');
    // the caret column is the browser's business: just require the X to land in "after" and nothing else to change
    const t = await tree(page);
    expect(t.replace('X', '')).toBe('code(l1\\nl2) ; p(after)');
    expect(t).toMatch(/^code\(l1\\nl2\) ; p\(.*X.*\)$/);
    await expectValid(page);
  });

  test('4 · marks are disabled (Ctrl+B does nothing) and markdown syntax typed mid-block stays LITERAL inside code', async ({ page }) => {
    await buildTree(page, [Code('x')]);
    await focusEnd(page, 'x');
    for (const line of ['- a', '1. b', '**x** `y` ---', '[] c', '```']) {
      await press(page, 'Enter');
      await page.keyboard.type(line);
    }
    await press(page, 'Enter');
    await page.keyboard.type('# not a heading');
    // DECIDED: no list / inline-mark / code-fence conversion anywhere in a code block, the type never changes.
    const expected = 'x\n- a\n1. b\n**x** `y` ---\n[] c\n```\n# not a heading';
    await expectTree(page, 'code(' + expected.replace(/\n/g, '\\n') + ')');
    // Ctrl+B on a selection: no bold anywhere (code serialises to a plain string).
    await press(page, 'Home');
    await press(page, 'Shift+End');
    await bold(page);
    await expectTree(page, 'code(' + expected.replace(/\n/g, '\\n') + ')');
    const json = await getJson(page);
    expect(json.blocks).toHaveLength(1);
    expect(json.blocks[0].type).toBe('code');
    expect(json.blocks[0].content).toBe(expected);
    const attrs = await page.evaluate(() => {
      const n = (window as any).nabu;
      return n.tree.roots()[0].data.get('text').toDelta().filter((op: any) => op.attributes);
    });
    expect(attrs).toEqual([]);
    expect(await focusInEditor(page)).toBe(true);
    await expectValid(page);
  });

  test('4b · block-level triggers `# ` / `> ` / `--- ` typed at the START of a code block stay literal (the block is not transformed)', async ({ page }) => {
    const results: Record<string, string> = {};
    for (const seq of ['# h', '> q', '--- ']) {
      await buildTree(page, [Code('')]);
      await focusEmpty(page);
      await page.keyboard.type(seq);
      results[seq] = await tree(page);
    }
    await buildTree(page, [Code('x')]);
    await focusAt(page, 'x', 0);
    await page.keyboard.type('# h');
    results['# h before "x"'] = await tree(page);
    // EXPECTED (transformsEnabled = false): the typed text is kept verbatim in a code block.
    // BROKEN (if red): the heading / blockquote / divider extensions' onBeforeInput hooks run from Nabu.dispatchEventToSelection
    // (nabu.svelte.js ~757) BEFORE the block's own `transformsEnabled === false` guard in TextBehavior.handleBeforeInput,
    // so `# `, `> ` and `--- ` still convert the code block (`- ` / `1. ` do not). Typing code like "# comment" or "> x" at the
    // start of an empty code block silently turns it into a heading / quote / divider.
    expect(results).toEqual({
      '# h': 'code(# h)',
      '> q': 'code(> q)',
      '--- ': 'code(--- )',
      '# h before "x"': 'code(# hx)',
    });
  });

  test('5 · pasting HTML into a code block inserts PLAIN TEXT only (no heading / paragraph / list blocks created)', async ({ page }) => {
    await buildTree(page, [Code('ab')]);
    await focusEnd(page, 'ab');
    await pasteHtml(page, '<h1>Title</h1><p>para <b>bold</b></p><ul><li>one</li></ul>', 'Title\npara bold\none');
    await flushRender(page);
    // EXPECTED: the clipboard text lands inside the code block, still ONE block. Nothing may spill into new blocks.
    // BROKEN (if red): the first line is merged into the code block, the remaining lines become a p + a list AFTER it.
    expect(await tree(page)).toBe('code(abTitle\\npara bold\\none)');
    await undo(page);
    await expectTree(page, 'code(ab)');
    await expectValid(page);
  });

  test('5b · pasting plain text with a BLANK LINE / markdown-looking lines (a script with comments) stays in the code block', async ({ page }) => {
    await buildTree(page, [Code('ab')]);
    await focusEnd(page, 'ab');
    await pasteText(page, '# comment\n\n- not a list\nlast');
    await flushRender(page);
    // EXPECTED: a code block is a verbatim buffer: one block with the exact text.
    // BROKEN (if red): blank lines / markdown syntax are interpreted as paste block boundaries (heading, list, paragraphs created).
    expect(await tree(page)).toBe('code(ab# comment\\n\\n- not a list\\nlast)');
    await undo(page);
    await expectTree(page, 'code(ab)');
    await expectValid(page);
  });

  test('6 · Backspace at offset 0: non-empty code -> paragraph (same text, language dropped) then a 2nd Backspace merges up; empty code -> paragraph', async ({ page }) => {
    // (a) non-empty, previous paragraph
    await buildTree(page, [Pp('para'), Code('ab', 'js')]);
    await focusAt(page, 'ab', 0);
    await press(page, 'Backspace');
    // DECIDED (P-39, code.extension.js): first Backspace de-transforms (same text, language dropped, caret stays at 0)...
    await expectTree(page, 'p(para) ; p(ab)');
    await expectCaret(page, '|ab');
    expect(await page.evaluate(() => (window as any).nabu.children[1].node.data.get('language') ?? null)).toBeNull();
    // ...the second one merges normally.
    await press(page, 'Backspace');
    await expectTree(page, 'p(paraab)');
    await expectCaret(page, 'para|ab');
    expect(await typeAndTree(page, 'X')).toBe('p(paraXab)');
    await undo(page); // the typed X
    await undo(page); // the merge
    await expectTree(page, 'p(para) ; p(ab)');
    await undo(page); // the code -> paragraph step
    await expectTree(page, 'p(para) ; code:js(ab)');
    // (b) non-empty, first block of the document: becomes a paragraph, a 2nd Backspace is then a no-op
    await buildTree(page, [Code('ab')]);
    await focusAt(page, 'ab', 0);
    await press(page, 'Backspace');
    await expectTree(page, 'p(ab)');
    await expectCaret(page, '|ab');
    await press(page, 'Backspace');
    await expectTree(page, 'p(ab)');
    expect(await typeAndTree(page, 'X')).toBe('p(Xab)');
    // (c) EMPTY code block after a paragraph: de-transformed to an empty paragraph, caret in it
    await buildTree(page, [Pp('para'), Code('')]);
    await focusEmpty(page);
    await press(page, 'Backspace');
    await expectTree(page, 'p(para) ; p(∅)');
    await expectCaret(page, '|');
    expect(await typeAndTree(page, 'X')).toBe('p(para) ; p(X)');
    // (d) EMPTY code block alone
    await buildTree(page, [Code('')]);
    await focusEmpty(page);
    await press(page, 'Backspace');
    await expectTree(page, 'p(∅)');
    await undo(page);
    await expectTree(page, 'code(∅)');
    await expectValid(page);
  });

  test('7 · language: the <select> sets `language` (model + markdown fence), keeps the text and the caret usable; "plaintext" clears it', async ({ page }) => {
    await buildTree(page, [Code('x = 1')]);
    await focusEnd(page, 'x = 1');
    const select = page.locator('.nabu-code-lang');
    await expect(select).toHaveValue('plaintext');
    await select.selectOption('python');
    await expectTree(page, 'code:python(x = 1)');
    expect(await getMarkdown(page)).toBe('```python\nx = 1\n```');
    expect((await getJson(page)).blocks[0].props).toEqual({ language: 'python' });
    // back in the text: typing continues in the block, language kept
    await focusEnd(page, 'x = 1');
    expect(await focusInEditor(page)).toBe(true);
    expect(await typeAndTree(page, '2')).toBe('code:python(x = 12)');
    await press(page, 'Enter');
    await expectTree(page, 'code:python(x = 12\\n)');
    // Enter in the middle of text keeps the language too (see 1)
    await select.selectOption('plaintext');
    expect(await getMarkdown(page)).toBe('```\nx = 12\n\n```');
    expect((await getJson(page)).blocks[0].props).toEqual({ language: null });
    await expectValid(page);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. Toggle
// ═══════════════════════════════════════════════════════════════════════════

const arrow = (page: Page) => page.locator('.nabu-toggle-arrow').first();

test.describe('B · Toggle', () => {
  test('8 · clicking the arrow collapses / expands (model `collapsed`, aria-expanded, body not rendered); caret + typing are kept', async ({ page }) => {
    await buildTree(page, [Tog('Head', [Pp('body')]), Pp('after')]);
    await focusAt(page, 'Head', 2);
    await expect(arrow(page)).toHaveAttribute('aria-expanded', 'true');
    await arrow(page).click();
    // (the DOM is a div, not <details>: the state is `.collapsed` + aria-expanded + the body element removed)
    await expectTree(page, 'toggle▸(Head){p(body)} ; p(after)');
    await expect(arrow(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.nabu-toggle-body')).toHaveCount(0);
    // DECIDED: mousedown is prevented -> the editor keeps focus and the caret stays in the header
    expect(await focusInEditor(page)).toBe(true);
    await expectCaret(page, 'He|ad');
    expect(await typeAndTree(page, 'Q')).toBe('toggle▸(HeQad){p(body)} ; p(after)');
    await arrow(page).click();
    await expectTree(page, 'toggle▾(HeQad){p(body)} ; p(after)');
    await expect(arrow(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.nabu-toggle-body')).toHaveCount(1);
    await expectCaret(page, 'HeQ|ad');
    expect(await typeAndTree(page, 'R')).toBe('toggle▾(HeQRad){p(body)} ; p(after)');
    await expectValid(page);
  });

  test('8b · collapsing is undoable (one Ctrl+Z re-expands) and the state survives in the markdown / json', async ({ page }) => {
    await buildTree(page, [Tog('Head', [Pp('body')])]);
    await focusEnd(page, 'Head');
    await arrow(page).click();
    await expectTree(page, 'toggle▸(Head){p(body)}');
    expect((await getJson(page)).blocks[0].props).toEqual({ collapsed: true });
    // the hidden body is still serialised
    expect(await getMarkdown(page)).toContain('body');
    await undo(page);
    await expectTree(page, 'toggle▾(Head){p(body)}');
    await expect(page.locator('.nabu-toggle-body')).toHaveCount(1);
    await expectValid(page);
  });

  test('9 · Enter in the header: an EMPTY body gets a first paragraph (caret in it); with a body the tail / new paragraph goes FIRST', async ({ page }) => {
    // (a) no body yet
    await buildTree(page, [Tog('Head', []), Pp('after')]);
    await focusEnd(page, 'Head');
    await press(page, 'Enter');
    await expectTree(page, 'toggle▾(Head){p(∅)} ; p(after)');
    await expectCaret(page, '|');
    expect(await typeAndTree(page, 'Z')).toBe('toggle▾(Head){p(Z)} ; p(after)');
    await undo(page);
    await undo(page);
    await expectTree(page, 'toggle▾(Head) ; p(after)');
    // (b) with an existing body child: the new / split-off paragraph is the FIRST child (what the code comment intends; Notion does the same)
    // BROKEN (if red): nabu.insert(..., parentId, 0) -> Paragraph.create does `index || undefined`, 0 is falsy -> APPENDED after "body".
    await buildTree(page, [Tog('Head', [Pp('body')])]);
    await focusEnd(page, 'Head');
    await press(page, 'Enter');
    await expectTree(page, 'toggle▾(Head){p(∅) p(body)}');
    await expectCaret(page, '|');
    // (c) mid-header split: head stays in the header, the TAIL is the first body paragraph (before "body")
    await buildTree(page, [Tog('Head', [Pp('body')])]);
    await focusAt(page, 'Head', 2);
    await press(page, 'Enter');
    await expectTree(page, 'toggle▾(He){p(ad) p(body)}');
    await expectCaret(page, '|ad');
    await expectValid(page);
  });

  test('9b · Enter at the end of a COLLAPSED header: a new paragraph AFTER the toggle takes the caret, the toggle stays collapsed, hidden body untouched; one Ctrl+Z', async ({ page }) => {
    await buildTree(page, [Tog('Head', [Pp('body')], true), Pp('after')]);
    await focusEnd(page, 'Head');
    await press(page, 'Enter');
    // DECIDED (P-40 c): the sub-thread stays closed, the new paragraph is a sibling after the toggle.
    await expectTree(page, 'toggle▸(Head){p(body)} ; p(∅) ; p(after)');
    await expect(page.locator('.nabu-toggle-body')).toHaveCount(0);
    await expectCaret(page, '|');
    expect(await typeAndTree(page, 'Z')).toBe('toggle▸(Head){p(body)} ; p(Z) ; p(after)');
    await undo(page);
    await undo(page);
    await expectTree(page, 'toggle▸(Head){p(body)} ; p(after)');
    await expectValid(page);
  });

  test('9c · Enter in the MIDDLE of a COLLAPSED header: the tail goes into the new paragraph after the toggle, which stays collapsed; one Ctrl+Z', async ({ page }) => {
    await buildTree(page, [Tog('Head', [Pp('body')], true), Pp('after')]);
    await focusAt(page, 'Head', 2);
    await press(page, 'Enter');
    await expectTree(page, 'toggle▸(He){p(body)} ; p(ad) ; p(after)');
    await expectCaret(page, '|ad');
    await undo(page);
    await expectTree(page, 'toggle▸(Head){p(body)} ; p(after)');
    await expectValid(page);
  });

  test('10 · ArrowDown from the header of a COLLAPSED toggle goes to the next block in ONE press; typing never reaches the hidden body', async ({ page }) => {
    await buildTree(page, [Tog('Head', [Pp('body')], true), Pp('after')]);
    await focusEnd(page, 'Head');
    await press(page, 'ArrowDown');
    // EXPECTED: the caret is in "after" right away. Hidden content must never receive the caret or the typing.
    // BROKEN (if red): the first press leaves the native caret on a non-text node of the toggle wrapper (no model caret);
    // a typed char is swallowed and only a 2nd ArrowDown reaches "after".
    const where = await rawCaret(page);
    const c = await caret(page);
    expect(c, `native caret after ArrowDown: ${where}`).toMatch(/after/);
    const t = await typeAndTree(page, 'X');
    expect(t.replace('X', '')).toBe('toggle▸(Head){p(body)} ; p(after)');
    expect(t).toMatch(/^toggle▸\(Head\)\{p\(body\)\} ; p\(.*X.*\)$/);
    await expectValid(page);
  });

  test('10b · the other directions around a COLLAPSED toggle (ArrowUp / ArrowLeft into it, ArrowRight out of it) land in a text block at once and never in the hidden body', async ({ page }) => {
    const results: Record<string, string> = {};
    const cases: [string, () => Promise<void>][] = [
      ['up from after', async () => { await focusAt(page, 'after', 0); await press(page, 'ArrowUp'); }],
      ['left from after', async () => { await focusAt(page, 'after', 0); await press(page, 'ArrowLeft'); }],
      ['right from header end', async () => { await focusEnd(page, 'Head'); await press(page, 'ArrowRight'); }],
    ];
    for (const [name, run] of cases) {
      await buildTree(page, [Tog('Head', [Pp('body')], true), Pp('after')]);
      await run();
      const c = await caret(page);
      results[name] = c && !c.startsWith('<') && !c.includes('body') ? 'in a text block' : `${c} (native: ${await rawCaret(page)})`;
      const t = await typeAndTree(page, 'X');
      expect(t, `${name}: hidden body must stay untouched`).toContain('{p(body)}');
    }
    // EXPECTED: every single press ends with a real caret in "Head" / "after". BROKEN (if red): the wrapper's non-text nodes
    // (arrow button area) capture the native caret for one press -> keystroke swallowed.
    expect(results).toEqual({
      'up from after': 'in a text block',
      'left from after': 'in a text block',
      'right from header end': 'in a text block',
    });
  });

  test('11 · Backspace at offset 0 of the header: the toggle becomes a paragraph with the header text, its children follow it (same parent, in order); one Ctrl+Z', async ({ page }) => {
    // (a) previous paragraph + body children
    await buildTree(page, [Pp('before'), Tog('Head', [Pp('body'), Pp('body2')]), Pp('after')]);
    await focusAt(page, 'Head', 0);
    await press(page, 'Backspace');
    // DECIDED (P-40 b): no merge into the previous block any more; nothing is lost, the body comes out right after.
    await expectTree(page, 'p(before) ; p(Head) ; p(body) ; p(body2) ; p(after)');
    await expectCaret(page, '|Head');
    expect((await allText(page)).join('|')).toBe('before|Head|body|body2|after');
    expect(await typeAndTree(page, 'X')).toBe('p(before) ; p(XHead) ; p(body) ; p(body2) ; p(after)');
    await undo(page);
    await undo(page);
    await expectTree(page, 'p(before) ; toggle▾(Head){p(body) p(body2)} ; p(after)');
    // (b) first block of the document: same behaviour (it used to be a no-op)
    await buildTree(page, [Tog('Head', [Pp('body'), Pp('body2')])]);
    await focusAt(page, 'Head', 0);
    await press(page, 'Backspace');
    await expectTree(page, 'p(Head) ; p(body) ; p(body2)');
    await expectCaret(page, '|Head');
    await undo(page);
    await expectTree(page, 'toggle▾(Head){p(body) p(body2)}');
    // (c) EMPTY header without body: a paragraph, caret kept
    await buildTree(page, [Pp('before'), Tog('', [])]);
    await focusEmpty(page, 0);
    await press(page, 'Backspace');
    await expectTree(page, 'p(before) ; p(∅)');
    // (d) COLLAPSED toggle: the hidden children come out too (nothing lost), one Ctrl+Z puts everything back
    await buildTree(page, [Tog('Head', [Pp('body')], true), Pp('after')]);
    await focusAt(page, 'Head', 0);
    await press(page, 'Backspace');
    await expectTree(page, 'p(Head) ; p(body) ; p(after)');
    await undo(page);
    await expectTree(page, 'toggle▸(Head){p(body)} ; p(after)');
    await expectValid(page);
  });

  test('11b · Backspace in the MIDDLE of the header is a plain deletion (the toggle stays a toggle)', async ({ page }) => {
    await buildTree(page, [Pp('before'), Tog('Head', [Pp('body')])]);
    await focusAt(page, 'Head', 2);
    await press(page, 'Backspace');
    await expectTree(page, 'p(before) ; toggle▾(Had){p(body)}');
    await expectCaret(page, 'H|ad');
  });

  test('12 · Backspace at offset 0 of the FIRST body child merges it into the header; Enter on an EMPTY last body paragraph EXITS the sub-thread', async ({ page }) => {
    await buildTree(page, [Pp('before'), Tog('Head', [Pp('body'), Pp('body2')])]);
    await focusAt(page, 'body', 0);
    await press(page, 'Backspace');
    // CURRENT: plain merge up into the header; the 2nd child stays in the body. Nothing lost.
    await expectTree(page, 'p(before) ; toggle▾(Headbody){p(body2)}');
    await expectCaret(page, 'Head|body');
    expect(await typeAndTree(page, 'X')).toBe('p(before) ; toggle▾(HeadXbody){p(body2)}');
    await undo(page);
    await undo(page);
    await expectTree(page, 'p(before) ; toggle▾(Head){p(body) p(body2)}');

    // DECIDED (P-40 a): Enter on an empty paragraph that is the LAST child moves it right after the toggle.
    await buildTree(page, [Tog('Head', [Pp('body'), Pp('')]), Pp('after')]);
    await focusEmpty(page);
    await press(page, 'Enter');
    await expectTree(page, 'toggle▾(Head){p(body)} ; p(∅) ; p(after)');
    await expectCaret(page, '|');
    expect(await typeAndTree(page, 'X')).toBe('toggle▾(Head){p(body)} ; p(X) ; p(after)');
    await expectValid(page);
  });

  test('12c · exit the sub-thread: ONE Ctrl+Z puts the empty paragraph back in the body; an empty MIDDLE child only adds a paragraph; the last child of the only body leaves an empty body', async ({ page }) => {
    await buildTree(page, [Tog('Head', [Pp('body'), Pp('')]), Pp('after')]);
    await focusEmpty(page);
    await press(page, 'Enter');
    await expectTree(page, 'toggle▾(Head){p(body)} ; p(∅) ; p(after)');
    await undo(page);
    await expectTree(page, 'toggle▾(Head){p(body) p(∅)} ; p(after)');
    // an empty paragraph that is NOT the last child: no exit
    await buildTree(page, [Tog('Head', [Pp(''), Pp('b')])]);
    await focusEmpty(page);
    await press(page, 'Enter');
    await expectTree(page, 'toggle▾(Head){p(∅) p(∅) p(b)}');
    // only child: the toggle keeps an empty body, Enter at the end of the header recreates a first child
    await buildTree(page, [Tog('Head', [Pp('')])]);
    await focusEmpty(page);
    await press(page, 'Enter');
    await expectTree(page, 'toggle▾(Head) ; p(∅)');
    await focusEnd(page, 'Head');
    await press(page, 'Enter');
    await expectTree(page, 'toggle▾(Head){p(∅)} ; p(∅)');
    await expectValid(page);
  });

  test('12d · Delete at the END of a COLLAPSED header merges the next VISIBLE block, never the hidden child; no next block: no-op; one Ctrl+Z', async ({ page }) => {
    await buildTree(page, [Tog('Head', [Pp('hidden')], true), Pp('next')]);
    await focusEnd(page, 'Head');
    await press(page, 'Delete');
    await expectTree(page, 'toggle▸(Headnext){p(hidden)}');
    await expectCaret(page, 'Head|next');
    await undo(page);
    await expectTree(page, 'toggle▸(Head){p(hidden)} ; p(next)');
    // Backspace at offset 0 of the block right after: same, into the header
    await focusAt(page, 'next', 0);
    await press(page, 'Backspace');
    await expectTree(page, 'toggle▸(Headnext){p(hidden)}');
    // nothing after the collapsed toggle: no-op
    await buildTree(page, [Tog('Head', [Pp('hidden')], true)]);
    await focusEnd(page, 'Head');
    await press(page, 'Delete');
    await expectTree(page, 'toggle▸(Head){p(hidden)}');
    expect(await typeAndTree(page, 'Q')).toBe('toggle▸(HeadQ){p(hidden)}');
    await expectValid(page);
  });

  test('12b · keyboard way OUT of the toggle body: ArrowDown from the last body child reaches the next block (one press)', async ({ page }) => {
    await buildTree(page, [Tog('Head', [Pp('body')]), Pp('after')]);
    await focusEnd(page, 'body');
    await press(page, 'ArrowDown');
    const c = await caret(page);
    expect(c, `native caret: ${await rawCaret(page)}`).toMatch(/after/);
    const t = await typeAndTree(page, 'X');
    expect(t.replace('X', '')).toBe('toggle▾(Head){p(body)} ; p(after)');
    expect(t).toMatch(/\{p\(body\)\} ; p\(.*X.*\)$/);
    await expectValid(page);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. Divider
// ═══════════════════════════════════════════════════════════════════════════

test.describe('C · Divider', () => {
  test('13 · ArrowDown / ArrowUp across a divider move the caret to the block after / before in ONE press', async ({ page }) => {
    await buildTree(page, [Pp('above'), Hr(), Pp('below')]);
    await focusEnd(page, 'above');
    await press(page, 'ArrowDown');
    expect(await caret(page)).toMatch(/below/);
    expect(await typeAndTree(page, 'X')).toMatch(/^p\(above\) ; hr ; p\(.*X.*\)$/);
    await buildTree(page, [Pp('above'), Hr(), Pp('below')]);
    await focusAt(page, 'below', 0);
    await press(page, 'ArrowUp');
    expect(await caret(page)).toMatch(/above/);
    expect(await typeAndTree(page, 'X')).toMatch(/^p\(.*X.*above.*\) ; hr ; p\(below\)$|^p\(.*X.*\) ; hr ; p\(below\)$/);
    await expectValid(page);
  });

  test('13b · ArrowRight / ArrowLeft across a divider reach the neighbouring text block in ONE press (no dead keystroke)', async ({ page }) => {
    const results: Record<string, string> = {};
    await buildTree(page, [Pp('above'), Hr(), Pp('below')]);
    await focusAt(page, 'below', 0);
    await press(page, 'ArrowLeft');
    results.left = (await caret(page)) ?? 'null';
    await buildTree(page, [Pp('above'), Hr(), Pp('below')]);
    await focusEnd(page, 'above');
    await press(page, 'ArrowRight');
    results.right = (await caret(page)) ?? 'null';
    // EXPECTED: left -> end of "above" (or its last char), right -> start of "below".
    // BROKEN (if red): the first press parks the native caret on the editor root (DIV@n, no model caret) and typing is swallowed;
    // it takes 2-3 presses to get through the divider.
    expect(results.left).toMatch(/^above\|?$|^abov\|e$/);
    expect(results.right).toMatch(/^\|below$|^b\|elow$/);
    await expectValid(page);
  });

  test('14 · Backspace at offset 0 of the block right after a divider deletes the DIVIDER (no text lost); a 2nd Backspace merges up; undo restores it', async ({ page }) => {
    await buildTree(page, [Pp('above'), Hr(), Pp('below')]);
    await focusAt(page, 'below', 0);
    await press(page, 'Backspace');
    // DECIDED (divider.extension.js): the divider goes first, the text stays untouched, caret still at the start of "below".
    await expectTree(page, 'p(above) ; p(below)');
    await expectCaret(page, '|below');
    await press(page, 'Backspace');
    await expectTree(page, 'p(abovebelow)');
    await expectCaret(page, 'above|below');
    await undo(page);
    await expectTree(page, 'p(above) ; p(below)');
    await undo(page);
    await expectTree(page, 'p(above) ; hr ; p(below)');
    // empty block after the divider: the divider is deleted, the empty block remains with the caret
    await buildTree(page, [Pp('above'), Hr(), Pp('')]);
    await focusEmpty(page);
    await press(page, 'Backspace');
    await expectTree(page, 'p(above) ; p(∅)');
    await expectCaret(page, '|');
    await expectValid(page);
  });

  test('14b · Delete at the END of the block before a divider deletes the DIVIDER (text + caret kept); one undo restores it', async ({ page }) => {
    await buildTree(page, [Pp('above'), Hr(), Pp('below')]);
    await focusEnd(page, 'above');
    await press(page, 'Delete');
    // DECIDED (P-39, divider.extension.js): symmetric with Backspace after a divider: the divider goes, the text and the caret stay.
    await expectTree(page, 'p(above) ; p(below)');
    await expectCaret(page, 'above|');
    await undo(page); // ONE step restores the divider
    await expectTree(page, 'p(above) ; hr ; p(below)');
    await press(page, 'Delete');
    await expectTree(page, 'p(above) ; p(below)');
    expect(await typeAndTree(page, 'X')).toBe('p(aboveX) ; p(below)');
    // a second Delete (divider gone) then merges normally
    await buildTree(page, [Pp('above'), Hr(), Pp('below')]);
    await focusEnd(page, 'above');
    await press(page, 'Delete');
    await press(page, 'Delete');
    await expectTree(page, 'p(abovebelow)');
    await expectValid(page);
  });

  test('15 · a divider as the LAST block: a caret below it can be reached by keyboard (ArrowDown from the block above)', async ({ page }) => {
    await buildTree(page, [Pp('above'), Hr()]);
    await focusEnd(page, 'above');
    await press(page, 'ArrowDown');
    await page.keyboard.type('X');
    // EXPECTED: some way to continue writing after a trailing divider (Notion keeps a trailing empty paragraph, Docs creates one).
    // BROKEN (if red): ArrowDown parks the caret on the editor root, the typed char is swallowed, the document stays [p, hr]
    // and there is no keyboard / click path to a position below the divider (Enter in "above" only inserts BETWEEN).
    const t = await tree(page);
    expect(t).toMatch(/^p\(above\) ; hr ; p\(.*X.*\)$/);
    await expectValid(page);
  });

  test('15b · clicking a divider (middle / last / only block): no error, focus stays in the editor, nothing lost, tree valid', async ({ page }) => {
    await buildTree(page, [Pp('above'), Hr(), Pp('below')]);
    await page.locator('hr').click();
    await page.keyboard.type('X');
    // CURRENT: the divider is inert (contenteditable=false): the click leaves the native caret next to it, typing is a no-op
    // or lands in a text block. Either way the document keeps its three blocks and all its text.
    const t = await tree(page);
    expect(t.replace('X', '')).toBe('p(above) ; hr ; p(below)');
    expect(await focusInEditor(page)).toBe(true);
    await buildTree(page, [Pp('above'), Hr()]);
    await page.locator('hr').click();
    await page.keyboard.type('Y');
    expect((await tree(page)).replace('Y', '')).toBe('p(above) ; hr');
    await buildTree(page, [Hr()]);
    await page.locator('hr').click({ force: true });
    await page.keyboard.type('Z');
    expect(await tree(page)).toBe('hr');
    await press(page, 'Enter');
    await press(page, 'Backspace');
    await press(page, 'Delete');
    await flushRender(page);
    // no crash, still one divider
    expect(await page.locator('[data-block-type="divider"]').count()).toBe(1);
    await expectValid(page);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D. Cross-block selection
// ═══════════════════════════════════════════════════════════════════════════

test.describe('D · Cross-block selection', () => {
  test('16 · selection paragraph -> code -> divider -> paragraph, typing "X": valid tree, nothing duplicated, ONE undo restores', async ({ page }) => {
    await buildTree(page, [Pp('start'), Code('code'), Hr(), Pp('end')]);
    await selectRange(page, 'start', 2, 'end', 1);
    await page.keyboard.type('X');
    await flushRender(page);
    // EXPECTED: everything between the two boundaries is removed (code + divider included), the outer text joins around the X.
    await expectTree(page, 'p(stXnd)');
    await expectCaret(page, 'stX|nd');
    await expectValid(page);
    await undo(page);
    await expectTree(page, 'p(start) ; code(code) ; hr ; p(end)');
    await expectValid(page);
  });

  test('16b · same selection + Backspace; and selection from INSIDE the code block to the next paragraph across the divider', async ({ page }) => {
    await buildTree(page, [Pp('start'), Code('code'), Hr(), Pp('end')]);
    await selectRange(page, 'start', 2, 'end', 1);
    await press(page, 'Backspace');
    await expectTree(page, 'p(stnd)');
    await expectCaret(page, 'st|nd');
    await undo(page);
    await expectTree(page, 'p(start) ; code(code) ; hr ; p(end)');
    // from inside the code block (keeps the code type: it is the first block of the range)
    await selectRange(page, 'code', 2, 'end', 1);
    await page.keyboard.type('X');
    await flushRender(page);
    // CURRENT: the range starts in the code block, so the merged block keeps the code type: "coXnd"
    await expectTree(page, 'p(start) ; code(coXnd)');
    await expectValid(page);
    await undo(page);
    await expectTree(page, 'p(start) ; code(code) ; hr ; p(end)');
  });
});
