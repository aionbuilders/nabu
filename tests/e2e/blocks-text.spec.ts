/**
 * E2E — EDITING behaviour of the text blocks Heading, Blockquote, Callout and Dialogue, driven by REAL keyboard /
 * mouse input (triggers `# ` / `> ` / `! ` / `-- ` are covered by shortcuts-slash.spec.ts and are not repeated here).
 *
 * Fixtures are built programmatically (`buildBlocks`); assertions run on the MODEL tree (`flat`: `h2(Title) ; p(∅) ;
 * q(x) ; callout:tip(x) ; dialogue(x)`), the caret (`caret`: block text with a `|`) and the structural invariants
 * (`expectValid`). Conventions as in lists-structure.spec.ts: "CURRENT:" = coherent, data-preserving behaviour that is
 * not specifically decided (Notion / Docs differ), "DECIDED:" = product decision, "BROKEN:" = clearly broken (lost
 * caret / invalid tree / feature not working) and the test is left FAILING.
 *
 *  A. Heading     B. Blockquote     C. Callout     D. Dialogue     E. Cross-block selection     F. Undo (one step)
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, clearAndReset, press, getMarkdown, getJson } from './helpers/editor.js';
import { undo, bold } from './helpers/keyboard.js';
import { caret, expectValid, violations, focusAt, focusEnd, focusEmpty, selectRange, collectErrors } from './helpers/model.js';
import { buildBlocks, flat, H, Q, C, D, Para, type TextSpec } from './helpers/blocks.js';

// ── local helpers ──────────────────────────────────────────────────────────

const expectFlat = (page: Page, expected: string) =>
  expect.poll(() => flat(page), { timeout: 3000, message: 'model tree' }).toBe(expected);
const expectCaret = (page: Page, expected: string | null) =>
  expect.poll(() => caret(page), { timeout: 3000, message: 'caret' }).toBe(expected);
const expectMd = (page: Page, expected: string) =>
  expect.poll(() => getMarkdown(page), { timeout: 3000, message: 'markdown' }).toBe(expected);
const focusInEditor = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('[contenteditable="true"]'));
/** Type one char and return the tree, to check the caret is usable where it is expected. */
async function typeAndFlat(page: Page, ch = 'X') {
  await page.keyboard.type(ch);
  return flat(page);
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
// A. Heading
// ═══════════════════════════════════════════════════════════════════════════

test.describe('A · Heading', () => {
  test('1 · Enter at the END of a heading creates a PARAGRAPH below, caret in it', async ({ page }) => {
    await buildBlocks(page, [H('Title', 2)]);
    await focusEnd(page, 'Title');
    await press(page, 'Enter');
    // DECIDED: a new paragraph (not a new heading) follows a heading; the heading keeps its level.
    await expectFlat(page, 'h2(Title) ; p(∅)');
    await expectCaret(page, '|');
    expect(await typeAndFlat(page)).toBe('h2(Title) ; p(X)');
    await expectCaret(page, 'X|');
    await expectValid(page);
  });

  test('2 · Enter in the MIDDLE of a heading: the tail becomes a paragraph, the head keeps the heading type', async ({ page }) => {
    await buildBlocks(page, [H('Title', 2)]);
    await focusAt(page, 'Title', 2);
    await press(page, 'Enter');
    // CURRENT: head stays h2, tail ("tle") moves to a PARAGRAPH (Notion: both halves stay headings; Google Docs: both headings).
    await expectFlat(page, 'h2(Ti) ; p(tle)');
    await expectCaret(page, '|tle');
    expect(await typeAndFlat(page)).toBe('h2(Ti) ; p(Xtle)');
    await expectValid(page);
  });

  test('3 · Enter at the START of a non-empty heading: an empty heading above, the text is DEMOTED to a paragraph', async ({ page }) => {
    await buildBlocks(page, [H('Title', 2)]);
    await focusAt(page, 'Title', 0);
    await press(page, 'Enter');
    // CURRENT: same split rule as in the middle: head = "" keeps h2, tail = whole text becomes a paragraph. No text lost.
    // (Notion: empty heading above and the text stays a heading.)
    await expectFlat(page, 'h2(∅) ; p(Title)');
    await expectCaret(page, '|Title');
    expect(await typeAndFlat(page)).toBe('h2(∅) ; p(XTitle)');
    await expectValid(page);
  });

  test('4 · Backspace at offset 0 turns the heading into a paragraph (text + caret kept); a 2nd Backspace merges it up', async ({ page }) => {
    await buildBlocks(page, [Para('before'), H('Title', 2)]);
    await focusAt(page, 'Title', 0);
    await press(page, 'Backspace');
    // DECIDED: same two-step behaviour as lists / quote / dialogue: first de-transform, then merge.
    await expectFlat(page, 'p(before) ; p(Title)');
    await expectCaret(page, '|Title');
    await press(page, 'Backspace');
    await expectFlat(page, 'p(beforeTitle)');
    await expectCaret(page, 'before|Title');
    expect(await typeAndFlat(page)).toBe('p(beforeXTitle)');
    await expectValid(page);
  });

  test('4b · Backspace at offset 0 of the FIRST heading of the document: becomes a paragraph, a 2nd Backspace is a no-op', async ({ page }) => {
    await buildBlocks(page, [H('Title', 1), Para('after')]);
    await focusAt(page, 'Title', 0);
    await press(page, 'Backspace');
    await expectFlat(page, 'p(Title) ; p(after)');
    await press(page, 'Backspace');
    // CURRENT: nothing above to merge into -> no-op, nothing lost, caret still usable.
    await expectFlat(page, 'p(Title) ; p(after)');
    await expectCaret(page, '|Title');
    expect(await typeAndFlat(page)).toBe('p(XTitle) ; p(after)');
    await expectValid(page);
  });

  test('4c · Backspace in the middle of a heading only deletes a character (keeps the heading type)', async ({ page }) => {
    await buildBlocks(page, [H('Title', 3)]);
    await focusAt(page, 'Title', 2);
    await press(page, 'Backspace');
    await expectFlat(page, 'h3(Ttle)');
    await expectCaret(page, 'T|tle');
    await expectValid(page);
  });

  test('5 · marks inside a heading: bold keeps the level and serializes as `## **x**`', async ({ page }) => {
    await buildBlocks(page, [H('', 2)]);
    await focusEmpty(page);
    await page.keyboard.type('x');
    await press(page, 'Home');
    await press(page, 'Shift+End');
    await bold(page);
    // CURRENT: marksEnabled stays true on headings; the bold run lives inside the `##` line.
    await expectMd(page, '## **x**');
    await expectFlat(page, 'h2(x)');
    await expectCaret(page, '⟦x⟧');
    const json = await getJson(page);
    expect(json.blocks[0].type).toBe('heading');
    expect(json.blocks[0].props).toEqual({ level: 2 });
    expect(json.blocks[0].content).toEqual([expect.objectContaining({ text: 'x', bold: true })]);
    await press(page, 'End');
    await page.keyboard.type('y');
    await expectFlat(page, 'h2(xy)');
    await expectCaret(page, 'xy|');
    await expectValid(page);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. Blockquote
// ═══════════════════════════════════════════════════════════════════════════

test.describe('B · Blockquote', () => {
  test('6a · Enter at the end of a NON-EMPTY quote leaves the quote: a PARAGRAPH is created below', async ({ page }) => {
    await buildBlocks(page, [Q('quote')]);
    await focusEnd(page, 'quote');
    await press(page, 'Enter');
    // CURRENT: a quote is a single block; Enter ends it (new paragraph, not a new quote). (Notion: Enter creates a new
    // quote line, a second Enter on the empty line exits; Docs / markdown editors: same as Notion.)
    await expectFlat(page, 'q(quote) ; p(∅)');
    await expectCaret(page, '|');
    expect(await typeAndFlat(page)).toBe('q(quote) ; p(X)');
    await expectValid(page);
  });

  test('6b · Enter in the MIDDLE of a quote splits it: head stays a quote, tail becomes a paragraph', async ({ page }) => {
    await buildBlocks(page, [Q('quote')]);
    await focusAt(page, 'quote', 2);
    await press(page, 'Enter');
    // CURRENT: same rule as heading (the paragraph split hook is generic).
    await expectFlat(page, 'q(qu) ; p(ote)');
    await expectCaret(page, '|ote');
    expect(await typeAndFlat(page)).toBe('q(qu) ; p(Xote)');
    await expectValid(page);
  });

  test('6c · Enter on an EMPTY quote exits it into a paragraph (caret in it, typing continues)', async ({ page }) => {
    await buildBlocks(page, [Para('a'), Q('')]);
    await focusEmpty(page);
    await press(page, 'Enter');
    // DECIDED (blockquote.extension.js): Enter in an empty blockquote -> the quote is converted to a paragraph in place.
    await expectFlat(page, 'p(a) ; p(∅)');
    await expectCaret(page, '|');
    expect(await typeAndFlat(page)).toBe('p(a) ; p(X)');
    await expectValid(page);
  });

  test('6d · Shift+Enter in a quote inserts a newline INSIDE the quote; Enter right after it leaves the quote', async ({ page }) => {
    await buildBlocks(page, [Q('quote')]);
    await focusEnd(page, 'quote');
    await press(page, 'Shift+Enter');
    await expectFlat(page, 'q(quote\\n)');
    await expectCaret(page, 'quote\n|');
    expect(await typeAndFlat(page, 'Z')).toBe('q(quote\\nZ)');
    await press(page, 'Enter');
    // CURRENT: the multi-line quote is split like any other (Enter at the end -> paragraph below).
    await expectFlat(page, 'q(quote\\nZ) ; p(∅)');
    await expectCaret(page, '|');
    await expectValid(page);
  });

  test('7 · Backspace at offset 0 turns the quote into a paragraph (text + caret kept), a 2nd Backspace merges', async ({ page }) => {
    await buildBlocks(page, [Para('before'), Q('quote')]);
    await focusAt(page, 'quote', 0);
    await press(page, 'Backspace');
    await expectFlat(page, 'p(before) ; p(quote)');
    await expectCaret(page, '|quote');
    await press(page, 'Backspace');
    await expectFlat(page, 'p(beforequote)');
    await expectCaret(page, 'before|quote');
    expect(await typeAndFlat(page)).toBe('p(beforeXquote)');
    await expectValid(page);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. Callout
// ═══════════════════════════════════════════════════════════════════════════

test.describe('C · Callout', () => {
  test('8a · Enter inside a callout inserts a NEWLINE in the same block (splitsOnEnter = false); the caret follows', async ({ page }) => {
    await buildBlocks(page, [C('note')]);
    await focusAt(page, 'note', 2);
    await press(page, 'Enter');
    // DECIDED (callout.svelte.js): a callout is one multi-line cohesive note.
    await expectFlat(page, 'callout:note(no\\nte)');
    await expectCaret(page, 'no\n|te');
    expect(await typeAndFlat(page)).toBe('callout:note(no\\nXte)');
    await press(page, 'End');
    await press(page, 'Enter');
    await press(page, 'Enter');
    // CURRENT: Enter never leaves the callout, even on an empty line (blank lines accumulate).
    await expectFlat(page, 'callout:note(no\\nXte\\n\\n)');
    expect(await violations(page)).toEqual([]);
    expect(await getMarkdown(page)).toBe('> [!NOTE]\n> no\n> Xte\n> \n> ');
  });

  test('8b · ArrowDown on the last line of a callout that ends the document creates a paragraph and moves the caret in it', async ({ page }) => {
    await buildBlocks(page, [C('note')]);
    await focusEnd(page, 'note');
    await press(page, 'ArrowDown');
    // DECIDED (callout.svelte.js keydown): ArrowDown is the keyboard way OUT of a trailing callout.
    await expectFlat(page, 'callout:note(note) ; p(∅)');
    await expectCaret(page, '|');
    expect(await typeAndFlat(page, 'Y')).toBe('callout:note(note) ; p(Y)');
    await expectValid(page);
  });

  test('8c · ArrowDown on the last line of a callout FOLLOWED by a block just moves the caret there (no paragraph added)', async ({ page }) => {
    await buildBlocks(page, [C('note'), Para('after')]);
    await focusEnd(page, 'note');
    await press(page, 'ArrowDown');
    await expectFlat(page, 'callout:note(note) ; p(after)');
    // the caret is in "after" (the exact offset depends on the pixel column, so only the block and the text are checked)
    expect(await caret(page)).toContain('after');
    await page.keyboard.type('Y');
    const tree = await flat(page);
    expect(tree).toMatch(/^callout:note\(note\) ; p\([^)]*Y[^)]*\)$/);
    expect(tree.replace('Y', '')).toBe('callout:note(note) ; p(after)');
    await expectValid(page);
  });

  test('8d · ArrowDown from a NON-last line stays inside the callout (no paragraph created)', async ({ page }) => {
    await buildBlocks(page, [C('one')]);
    await focusEnd(page, 'one');
    await press(page, 'Enter');
    await page.keyboard.type('two');
    await press(page, 'ArrowUp');
    await press(page, 'ArrowDown');
    await expectFlat(page, 'callout:note(one\\ntwo)');
    expect(await caret(page)).toContain('two');
    await expectValid(page);
  });

  test('8e · marks work inside a callout: bold on a selection serializes in the quoted body', async ({ page }) => {
    await buildBlocks(page, [C('', 'warning')]);
    await focusEmpty(page);
    await page.keyboard.type('careful');
    await press(page, 'Shift+Home');
    await bold(page);
    // CURRENT: marksEnabled stays true on callouts.
    await expectMd(page, '> [!WARNING]\n> **careful**');
    await expectFlat(page, 'callout:warning(careful)');
    await expectValid(page);
  });

  test('9 · clicking the icon cycles note -> tip -> important -> warning -> caution -> note; caret kept, typing continues', async ({ page }) => {
    await buildBlocks(page, [C('a'), Para('after')]);
    await focusEnd(page, 'a');
    const icon = page.locator('.nabu-callout-icon');
    const aside = page.locator('aside.nabu-callout');
    const order = ['tip', 'important', 'warning', 'caution', 'note'];
    for (const v of order) {
      await icon.click();
      await expectFlat(page, `callout:${v}(a) ; p(after)`);
      await expect(aside).toHaveClass(new RegExp(`callout-${v}\\b`));
      await expect(aside).toHaveAttribute('data-callout', v);
      // DECIDED (Callout.svelte): the icon's mousedown is prevented, so the editor keeps focus and the caret.
      await expectCaret(page, 'a|');
      expect(await focusInEditor(page)).toBe(true);
    }
    expect(await typeAndFlat(page, 'Z')).toBe('callout:note(aZ) ; p(after)');
    await expectCaret(page, 'aZ|');
    expect((await getJson(page)).blocks[0].props).toEqual({ variant: 'note' });
    await expectValid(page);
  });

  test('9b · clicking the icon while the caret is in ANOTHER block does not move the caret', async ({ page }) => {
    await buildBlocks(page, [C('a', 'tip'), Para('after')]);
    await focusAt(page, 'after', 2);
    await page.locator('.nabu-callout-icon').click();
    await expectFlat(page, 'callout:important(a) ; p(after)');
    await expectCaret(page, 'af|ter');
    expect(await typeAndFlat(page)).toBe('callout:important(a) ; p(afXter)');
    await expectValid(page);
  });

  test('10a · Backspace at offset 0 of an EMPTY callout turns it into a paragraph', async ({ page }) => {
    await buildBlocks(page, [Para('a'), C('', 'tip')]);
    await focusEmpty(page);
    await press(page, 'Backspace');
    await expectFlat(page, 'p(a) ; p(∅)');
    await expectCaret(page, '|');
    expect(await typeAndFlat(page)).toBe('p(a) ; p(X)');
    await expectValid(page);
  });

  test('10b · Backspace at offset 0 of a NON-empty callout merges it into the previous block (no de-transform step)', async ({ page }) => {
    await buildBlocks(page, [Para('before'), C('note', 'tip')]);
    await focusAt(page, 'note', 0);
    await press(page, 'Backspace');
    // CURRENT: unlike heading / quote / dialogue, a non-empty callout is NOT turned into a paragraph first: its text is
    // appended to the previous block and the callout (with its variant) disappears. Nothing is lost.
    await expectFlat(page, 'p(beforenote)');
    await expectCaret(page, 'before|note');
    await expectValid(page);
  });

  test('10c · Backspace at offset 0 of a non-empty callout that is the FIRST block is a no-op (text and caret kept)', async ({ page }) => {
    await buildBlocks(page, [C('note')]);
    await focusAt(page, 'note', 0);
    await press(page, 'Backspace');
    // CURRENT: nothing above -> nothing happens (no way to get a paragraph with Backspace, only via the slash menu).
    await expectFlat(page, 'callout:note(note)');
    await expectCaret(page, '|note');
    expect(await typeAndFlat(page)).toBe('callout:note(Xnote)');
    await expectValid(page);
  });

  test('11a · markdown triggers `# ` / `## ` / `> ` / `--- ` typed at the start of a callout stay LITERAL (transformsEnabled = false)', async ({ page }) => {
    // BROKEN: the callout is transformed away (`# a` -> h1, `## a` -> h2, `> a` -> quote, `--- ` -> divider + paragraph).
    // CalloutBlock sets transformsEnabled = false, but the shortcut hooks (heading / blockquote / divider onBeforeInput)
    // are run by Nabu.dispatchEventToSelection (nabu.svelte.js ~l.759) BEFORE TextBehavior.handleBeforeInput, which is
    // the only place that honours the flag (text.behavior.svelte.js ~l.149).
    for (const trigger of ['# ', '## ', '> ', '--- ']) {
      await buildBlocks(page, [C('')]);
      await focusEmpty(page);
      await page.keyboard.type(trigger + 'a');
      expect.soft(await flat(page), `trigger ${JSON.stringify(trigger)}`).toBe(`callout:note(${trigger}a)`);
    }
  });

  test('11b · other triggers (`- `, `1. `, `[] `, `-- `, "``` ") typed at the start of a callout stay literal', async ({ page }) => {
    for (const trigger of ['- ', '1. ', '[] ', '-- ', '``` ']) {
      await buildBlocks(page, [C('')]);
      await focusEmpty(page);
      await page.keyboard.type(trigger + 'a');
      // CURRENT: literal text, the block stays a callout.
      expect.soft(await flat(page), `trigger ${JSON.stringify(trigger)}`).toBe(`callout:note(${trigger}a)`);
    }
  });

  test('11c · triggers at the start of the 2nd LINE of a callout stay literal', async ({ page }) => {
    for (const trigger of ['# ', '- ', '> ', '1. ']) {
      await buildBlocks(page, [C('note')]);
      await focusEnd(page, 'note');
      await press(page, 'Enter');
      await page.keyboard.type(trigger + 'a');
      // CURRENT: the hooks only look at the text before the caret from the start of the BLOCK, so a later line never triggers.
      expect.soft(await flat(page), `trigger ${JSON.stringify(trigger)}`).toBe(`callout:note(note\\n${trigger}a)`);
    }
    await expectValid(page);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D. Dialogue
// ═══════════════════════════════════════════════════════════════════════════

test.describe('D · Dialogue', () => {
  test('12a · Enter at the end of a dialogue creates a PARAGRAPH below, caret in it', async ({ page }) => {
    await buildBlocks(page, [D('talk')]);
    await focusEnd(page, 'talk');
    await press(page, 'Enter');
    // CURRENT: a paragraph follows. dialogue/index.js defines an onSplit that would create a new DIALOGUE (and turn an
    // empty one into a paragraph) but it never runs: the hooks are tried in registration order and the Paragraph
    // extension's generic onSplit (returns a truthy value for ANY block) wins. (Intended-by-code: new dialogue line.)
    await expectFlat(page, 'dialogue(talk) ; p(∅)');
    await expectCaret(page, '|');
    expect(await typeAndFlat(page)).toBe('dialogue(talk) ; p(X)');
    await expectValid(page);
  });

  test('12b · Enter on an EMPTY dialogue: the dialogue is kept and a paragraph is added below (it is NOT converted)', async ({ page }) => {
    await buildBlocks(page, [D('')]);
    await focusEmpty(page);
    await press(page, 'Enter');
    // CURRENT: same cause as 12a (the dialogue onSplit "empty -> paragraph" branch is dead code): an empty dialogue
    // line stays behind, caret goes to the new paragraph.
    await expectFlat(page, 'dialogue(∅) ; p(∅)');
    await expectCaret(page, '|');
    expect(await typeAndFlat(page)).toBe('dialogue(∅) ; p(X)');
    await expectValid(page);
  });

  test('12c · Backspace at offset 0 turns the dialogue into a paragraph (text + caret kept); a 2nd Backspace merges', async ({ page }) => {
    await buildBlocks(page, [Para('before'), D('talk')]);
    await focusAt(page, 'talk', 0);
    await press(page, 'Backspace');
    await expectFlat(page, 'p(before) ; p(talk)');
    await expectCaret(page, '|talk');
    expect(await typeAndFlat(page)).toBe('p(before) ; p(Xtalk)');
    await expectValid(page);
  });

  test('12d · Backspace in an EMPTY dialogue turns it into an empty paragraph', async ({ page }) => {
    await buildBlocks(page, [D('')]);
    await focusEmpty(page);
    await press(page, 'Backspace');
    await expectFlat(page, 'p(∅)');
    expect(await typeAndFlat(page)).toBe('p(X)');
    await expectValid(page);
  });

  test('12e · Enter in the MIDDLE of a dialogue: the tail becomes a paragraph', async ({ page }) => {
    await buildBlocks(page, [D('talk')]);
    await focusAt(page, 'talk', 2);
    await press(page, 'Enter');
    // CURRENT: see 12a.
    await expectFlat(page, 'dialogue(ta) ; p(lk)');
    await expectCaret(page, '|lk');
    await expectValid(page);
  });

  test('13 · marks inside a dialogue + the dash is a CSS prefix (not part of the text); markdown uses an em-dash', async ({ page }) => {
    await buildBlocks(page, [D('')]);
    await focusEmpty(page);
    await page.keyboard.type('hi there');
    await expectMd(page, '— hi there');
    await press(page, 'Home');
    await press(page, 'Shift+End');
    await bold(page);
    await expectMd(page, '— **hi there**');
    await expectFlat(page, 'dialogue(hi there)');
    await press(page, 'ArrowRight');
    await page.keyboard.type('!');
    await expectFlat(page, 'dialogue(hi there!)');
    // The dash only exists as the ::before pseudo-element of the block: the model text stays dash-free.
    const dash = await page.evaluate(() => getComputedStyle(document.querySelector('[data-block-type="dialogue"]')!, '::before').content);
    // CURRENT: rendered with an EN dash "–" (Dialogue.svelte), while markdown export uses an EM dash "—".
    expect(dash).toMatch(/^"[–—]"$/);
    expect(await page.locator('[data-block-type="dialogue"]').innerText()).not.toMatch(/[–—]/);
    expect((await getJson(page)).blocks[0].type).toBe('dialogue');
    await expectValid(page);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E. Cross-block selection
// ═══════════════════════════════════════════════════════════════════════════

test.describe('E · Selection spanning paragraph -> heading -> callout', () => {
  const DOC = () => [Para('para'), H('Head', 2), C('call', 'tip'), Para('end')];

  test('14a · typing "X" replaces the range: head of the paragraph + X + tail of the callout in the FIRST block', async ({ page }) => {
    await buildBlocks(page, DOC());
    await selectRange(page, 'para', 2, 'call', 2);
    await expectCaret(page, 'para@2 -> call@2');
    await page.keyboard.type('X');
    // CURRENT: the first block (paragraph) survives and absorbs the tail of the last one; the middle blocks vanish.
    await expectFlat(page, 'p(paXll) ; p(end)');
    await expectCaret(page, 'paX|ll');
    expect(await typeAndFlat(page, 'Y')).toBe('p(paXYll) ; p(end)');
    await expectValid(page);
  });

  test('14b · Backspace on the same range', async ({ page }) => {
    await buildBlocks(page, DOC());
    await selectRange(page, 'para', 2, 'call', 2);
    await press(page, 'Backspace');
    await expectFlat(page, 'p(pall) ; p(end)');
    await expectCaret(page, 'pa|ll');
    expect(await typeAndFlat(page)).toBe('p(paXll) ; p(end)');
    await expectValid(page);
  });

  test('14c · selection from the HEADING start to the middle of the callout + "X": the heading survives', async ({ page }) => {
    await buildBlocks(page, [Para('p'), H('Head', 2), C('call', 'tip')]);
    await selectRange(page, 'Head', 0, 'call', 2);
    await page.keyboard.type('X');
    // CURRENT: the range starts in the heading, so the heading block is the survivor (keeps its level).
    await expectFlat(page, 'p(p) ; h2(Xll)');
    await expectCaret(page, 'X|ll');
    await expectValid(page);
  });

  test('14d · one Ctrl+Z restores all three blocks, with their types / level / variant, and the selection start', async ({ page }) => {
    await buildBlocks(page, DOC());
    const original = await flat(page);
    await selectRange(page, 'para', 2, 'call', 2);
    await page.keyboard.type('X');
    await undo(page);
    await expectFlat(page, original);
    await expectFlat(page, 'p(para) ; h2(Head) ; callout:tip(call) ; p(end)');
    await expectValid(page);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F. Undo after Enter / Backspace, per block (ONE step restores structure + caret; typing then lands at the caret)
// ═══════════════════════════════════════════════════════════════════════════

type UndoCase = {
  title: string;
  doc: TextSpec[];
  at: { text: string; offset: number | 'end' } | 'empty';
  key: string;
  after: string;        // tree after the key
  undone: string;       // tree after ONE Ctrl+Z
  caretUndone: string;  // caret after the undo
  typed: string;        // tree after typing "X" at the restored caret
};

const UNDO_CASES: UndoCase[] = [
  { title: 'heading · Enter at the end', doc: [H('Title', 2)], at: { text: 'Title', offset: 'end' }, key: 'Enter',
    after: 'h2(Title) ; p(∅)', undone: 'h2(Title)', caretUndone: 'Title|', typed: 'h2(TitleX)' },
  { title: 'heading · Enter in the middle', doc: [H('Title', 2)], at: { text: 'Title', offset: 2 }, key: 'Enter',
    after: 'h2(Ti) ; p(tle)', undone: 'h2(Title)', caretUndone: 'Ti|tle', typed: 'h2(TiXtle)' },
  { title: 'heading · Backspace at 0', doc: [H('Title', 2)], at: { text: 'Title', offset: 0 }, key: 'Backspace',
    after: 'p(Title)', undone: 'h2(Title)', caretUndone: '|Title', typed: 'h2(XTitle)' },
  { title: 'quote · Enter in the middle', doc: [Q('quote')], at: { text: 'quote', offset: 2 }, key: 'Enter',
    after: 'q(qu) ; p(ote)', undone: 'q(quote)', caretUndone: 'qu|ote', typed: 'q(quXote)' },
  { title: 'quote · Backspace at 0', doc: [Q('quote')], at: { text: 'quote', offset: 0 }, key: 'Backspace',
    after: 'p(quote)', undone: 'q(quote)', caretUndone: '|quote', typed: 'q(Xquote)' },
  { title: 'quote · Enter on an empty quote', doc: [Q('')], at: 'empty', key: 'Enter',
    after: 'p(∅)', undone: 'q(∅)', caretUndone: '|', typed: 'q(X)' },
  { title: 'callout · Enter (newline) in the middle', doc: [C('note')], at: { text: 'note', offset: 2 }, key: 'Enter',
    after: 'callout:note(no\\nte)', undone: 'callout:note(note)', caretUndone: 'no|te', typed: 'callout:note(noXte)' },
  { title: 'callout · Backspace on an empty callout', doc: [C('', 'tip')], at: 'empty', key: 'Backspace',
    after: 'p(∅)', undone: 'callout:tip(∅)', caretUndone: '|', typed: 'callout:tip(X)' },
  { title: 'callout · Backspace at 0 (merge into the previous block)', doc: [Para('b'), C('note', 'tip')], at: { text: 'note', offset: 0 }, key: 'Backspace',
    after: 'p(bnote)', undone: 'p(b) ; callout:tip(note)', caretUndone: '|note', typed: 'p(b) ; callout:tip(Xnote)' },
  { title: 'callout · ArrowDown escape (paragraph creation)', doc: [C('note')], at: { text: 'note', offset: 'end' }, key: 'ArrowDown',
    after: 'callout:note(note) ; p(∅)', undone: 'callout:note(note)', caretUndone: 'note|', typed: 'callout:note(noteX)' },
  { title: 'dialogue · Enter in the middle', doc: [D('talk')], at: { text: 'talk', offset: 2 }, key: 'Enter',
    after: 'dialogue(ta) ; p(lk)', undone: 'dialogue(talk)', caretUndone: 'ta|lk', typed: 'dialogue(taXlk)' },
  { title: 'dialogue · Backspace at 0', doc: [D('talk')], at: { text: 'talk', offset: 0 }, key: 'Backspace',
    after: 'p(talk)', undone: 'dialogue(talk)', caretUndone: '|talk', typed: 'dialogue(Xtalk)' },
  { title: 'dialogue · Enter on an empty dialogue', doc: [D('')], at: 'empty', key: 'Enter',
    after: 'dialogue(∅) ; p(∅)', undone: 'dialogue(∅)', caretUndone: '|', typed: 'dialogue(X)' },
];

test.describe('F · Ctrl+Z after Enter / Backspace', () => {
  for (const c of UNDO_CASES) {
    test(`15 · ${c.title}: one Ctrl+Z restores the structure and the caret`, async ({ page }) => {
      await buildBlocks(page, c.doc);
      if (c.at === 'empty') await focusEmpty(page);
      else if (c.at.offset === 'end') await focusEnd(page, c.at.text);
      else await focusAt(page, c.at.text, c.at.offset);

      await press(page, c.key);
      await expectFlat(page, c.after);
      await undo(page);
      await expectFlat(page, c.undone);
      await expectCaret(page, c.caretUndone);
      expect(await typeAndFlat(page)).toBe(c.typed);
      await expectValid(page);
    });
  }
});
