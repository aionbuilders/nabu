/**
 * E2E — Basic Typing
 * P0: Core text input pipeline
 */

import { test, expect } from './helpers/test.js';
import {
  gotoEditor, clearAndReset, getEditor, focusEditor,
  typeText, press, getMarkdown, getBlocks, getRootBlockCount,
} from './helpers/editor.js';
import { undo } from './helpers/keyboard.js';
import { buildBlocks, buildTree, Para, H, Q, Code, flat, tree } from './helpers/blocks.js';
import { buildDoc, P, UL, I, outline, caret, focusAt, focusEnd, selectRange, collectErrors } from './helpers/model.js';

test.describe('Basic Typing', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  // P0 ─────────────────────────────────────────────────────────────────────

  test('P0 · types plain text into empty paragraph', async ({ page }) => {
    await typeText(page, 'Hello, world!');
    await expect(getEditor(page)).toContainText('Hello, world!');
  });

  test('P0 · Enter creates a new paragraph', async ({ page }) => {
    await typeText(page, 'first');
    await press(page, 'Enter');
    await typeText(page, 'second');

    const count = await getRootBlockCount(page);
    expect(count).toBe(2);
    const md = await getMarkdown(page);
    expect(md).toContain('first');
    expect(md).toContain('second');
  });

  test('P0 · Backspace deletes the character before the cursor', async ({ page }) => {
    await typeText(page, 'helllo');
    await press(page, 'ArrowLeft'); // Move cursor before last "o"
    await press(page, 'Backspace');
    const md = await getMarkdown(page);
    expect(md).toContain('hello'); // not "helllo"
    expect(md).not.toContain('helllo');
  });

  test('P0 · Backspace at start of block merges with previous paragraph', async ({ page }) => {
    await typeText(page, 'first');
    await press(page, 'Enter');
    await typeText(page, 'second');
    await press(page, 'Home');
    await press(page, 'Backspace');

    const count = await getRootBlockCount(page);
    expect(count).toBe(1);
    const md = await getMarkdown(page);
    expect(md).toContain('firstsecond');
  });

  test('P0 · Delete at end of block merges with next paragraph', async ({ page }) => {
    await typeText(page, 'first');
    await press(page, 'Enter');
    await typeText(page, 'second');
    // Go back to end of first paragraph
    await press(page, 'ArrowUp');
    await press(page, 'End');
    await press(page, 'Delete');

    const count = await getRootBlockCount(page);
    expect(count).toBe(1);
  });

  // P1 ─────────────────────────────────────────────────────────────────────

  test('P1 · types special characters: em-dash substitution (-- + space)', async ({ page }) => {
    await typeText(page, 'hello--');
    await typeText(page, ' ');
    const md = await getMarkdown(page);
    // -- followed by space becomes em-dash
    expect(md).toContain('— ');
  });

  test('P1 · Home/End navigate within a line', async ({ page }) => {
    await typeText(page, 'hello');
    await press(page, 'Home');
    await typeText(page, 'X');
    const md = await getMarkdown(page);
    expect(md.trim()).toContain('Xhello');
  });

  test('P1 · multi-line text split preserves content', async ({ page }) => {
    await typeText(page, 'hello world');
    // Move cursor to middle
    await press(page, 'Home');
    for (let i = 0; i < 5; i++) await press(page, 'ArrowRight');
    await press(page, 'Enter');

    const count = await getRootBlockCount(page);
    expect(count).toBe(2);
    const md = await getMarkdown(page);
    expect(md).toContain('hello');
    expect(md).toContain('world');
  });

  test('P1 · typing into empty document does not crash', async ({ page }) => {
    await typeText(page, 'abc');
    await expect(getEditor(page)).toContainText('abc');
  });

  // P2 ─────────────────────────────────────────────────────────────────────

  test('P2 · rapid typing is handled correctly', async ({ page }) => {
    const longText = 'abcdefghijklmnopqrstuvwxyz0123456789';
    await typeText(page, longText);
    await expect(getEditor(page)).toContainText(longText);
  });

  test('P2 · typing unicode characters works', async ({ page }) => {
    await typeText(page, 'héllo wörld 你好');
    await expect(getEditor(page)).toContainText('héllo');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Forward Delete (deleteContentForward): used to be swallowed anywhere but at the end of a block
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Delete key (forward deletion)', () => {
  let errors: ReturnType<typeof collectErrors>;
  test.beforeEach(async ({ page }) => {
    errors = collectErrors(page);
    await gotoEditor(page);
    await clearAndReset(page);
  });
  test.afterEach(async () => {
    expect(errors.list(), 'console / page errors').toEqual([]);
  });

  test('"abc|def" + Delete -> "abc|ef", repeated Delete keeps eating forward', async ({ page }) => {
    await buildBlocks(page, [Para('abcdef')]);
    await focusAt(page, 'abcdef', 3);
    await press(page, 'Delete');
    await expect.poll(() => flat(page)).toBe('p(abcef)');
    await expect.poll(() => caret(page)).toBe('abc|ef');
    await press(page, 'Delete');
    await press(page, 'Delete');
    await expect.poll(() => flat(page)).toBe('p(abc)');
    await expect.poll(() => caret(page)).toBe('abc|');
  });

  test('Delete at the start of a block deletes the first character', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await focusAt(page, 'abc', 0);
    await press(page, 'Delete');
    await expect.poll(() => flat(page)).toBe('p(bc)');
    await expect.poll(() => caret(page)).toBe('|bc');
  });

  test('Delete with a selection inside one block deletes it; Ctrl+Z restores text AND selection', async ({ page }) => {
    await buildBlocks(page, [Para('abcdef')]);
    await selectRange(page, 'abcdef', 1, 'abcdef', 4);
    await press(page, 'Delete');
    await expect.poll(() => flat(page)).toBe('p(aef)');
    await expect.poll(() => caret(page)).toBe('a|ef');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(abcdef)');
    await expect.poll(() => caret(page)).toBe('a⟦bcd⟧ef');
  });

  test('Ctrl+Z after a collapsed Delete restores the text and the caret', async ({ page }) => {
    await buildBlocks(page, [Para('abcdef')]);
    await focusAt(page, 'abcdef', 3);
    await press(page, 'Delete');
    await expect.poll(() => flat(page)).toBe('p(abcef)');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(abcdef)');
    await expect.poll(() => caret(page)).toBe('abc|def');
  });

  test('a successive run of Delete presses is ONE undo step (typing-merge, like Backspace)', async ({ page }) => {
    await buildBlocks(page, [Para('abcdef')]);
    await focusAt(page, 'abcdef', 1);
    await press(page, 'Delete');
    await press(page, 'Delete');
    await press(page, 'Delete');
    await expect.poll(() => flat(page)).toBe('p(aef)');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(abcdef)');
  });

  for (const [name, glyph] of [
    ['a family emoji', '👨‍👩‍👧'],
    ['a flag', '🇫🇷'],
    ['e + combining accent', 'e\u0301'],
    ['a surrogate pair', '𝒳'],
  ] as const) {
    test(`one Delete removes ${name} whole`, async ({ page }) => {
      await buildBlocks(page, [Para(`a${glyph}b`)]);
      await focusAt(page, `a${glyph}b`, 1);
      await press(page, 'Delete');
      await expect.poll(() => flat(page)).toBe('p(ab)');
      await expect.poll(() => caret(page)).toBe('a|b');
    });
  }

  test('Delete in a code block deletes one character', async ({ page }) => {
    await buildTree(page, [Code('x = 1', 'js')]);
    await focusAt(page, 'x = 1', 1);
    await press(page, 'Delete');
    await expect.poll(() => tree(page)).toContain('x= 1');
    await expect.poll(() => caret(page)).toBe('x|= 1');
  });

  test('Delete in a list item, a heading and a quote deletes one character', async ({ page }) => {
    await buildDoc(page, [UL(I('item'))]);
    await focusAt(page, 'item', 1);
    await press(page, 'Delete');
    await expect.poll(() => outline(page)).toBe('ul[iem]');
    await expect.poll(() => caret(page)).toBe('i|em');

    await buildBlocks(page, [H('Title', 2), Q('quote')]);
    await focusAt(page, 'Title', 2);
    await press(page, 'Delete');
    await expect.poll(() => flat(page)).toBe('h2(Tile) ; q(quote)');
    await focusAt(page, 'quote', 0);
    await press(page, 'Delete');
    await expect.poll(() => flat(page)).toBe('h2(Tile) ; q(uote)');
  });

  test('Delete at the end of a block still merges the next one (caret stays at the junction)', async ({ page }) => {
    await buildBlocks(page, [Para('first'), Para('second')]);
    await focusEnd(page, 'first');
    await press(page, 'Delete');
    await expect.poll(() => flat(page)).toBe('p(firstsecond)');
    await expect.poll(() => caret(page)).toBe('first|second');
  });

  test('Delete at the end of the LAST block is a no-op (no error)', async ({ page }) => {
    await buildBlocks(page, [Para('only')]);
    await focusEnd(page, 'only');
    await press(page, 'Delete');
    await expect.poll(() => flat(page)).toBe('p(only)');
    await expect.poll(() => caret(page)).toBe('only|');
  });
});
