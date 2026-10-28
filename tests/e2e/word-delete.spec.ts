/**
 * E2E — word deletion with REAL keys (GitHub issue #4): Ctrl+Backspace / Ctrl+Delete arrive as `beforeinput`
 * `deleteWordBackward` / `deleteWordForward` (Option+Backspace on a Mac does the same; Playwright's headless Chromium on Linux
 * has no Alt+Backspace binding, so only the Ctrl chords can be driven here — the Mac forward rule is covered by
 * tests/unit/delete-word.test.js). The headless run is a Linux / "other" platform, so Ctrl+Delete follows the Windows rule.
 *
 * Backward: the word AND the whitespace between it and the caret go, the caret lands where the word started.
 */

import { test, expect } from './helpers/test.js';
import { gotoEditor, clearAndReset, focusEditor, press, getMarkdown } from './helpers/editor.js';
import { undo } from './helpers/keyboard.js';
import { buildDoc, P, caret, focusAt, focusEnd, violations } from './helpers/model.js';

test.describe('Word deletion (Ctrl+Backspace / Ctrl+Delete)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  /** Place the caret in the single paragraph `text` at `offset` (-1: end), press `chord`, expect the caret description. */
  async function check(page: import('@playwright/test').Page, text: string, offset: number, chord: string, expected: string) {
    await buildDoc(page, [P(text)]);
    if (offset < 0) await focusEnd(page, text); else await focusAt(page, text, offset);
    await press(page, chord);
    await expect.poll(() => caret(page), { timeout: 3000 }).toBe(expected);
    expect((await violations(page)).filter((v) => !v.startsWith('DOM has') && !v.startsWith('DOM block'))).toEqual([]);
  }

  test('typed text: "this is a sentence " -> "this is a |" (the space before the word stays)', async ({ page }) => {
    await page.keyboard.type('this is a sentence ');
    await press(page, 'Control+Backspace');
    await expect.poll(() => caret(page)).toBe('this is a |');
    expect(await getMarkdown(page)).toContain('this is a');
    await page.keyboard.type('X');
    await expect.poll(() => caret(page)).toBe('this is a X|');
  });

  test('typed text: "hello world" -> "hello |"', async ({ page }) => {
    await page.keyboard.type('hello world');
    await press(page, 'Control+Backspace');
    await expect.poll(() => caret(page)).toBe('hello |');
    await press(page, 'Control+Backspace');
    await expect.poll(() => caret(page)).toBe('|');
  });

  test('backward: several spaces, punctuation, mid-word, non-Latin', async ({ page }) => {
    await check(page, 'one two   ', -1, 'Control+Backspace', 'one |');
    await check(page, 'say word, ', -1, 'Control+Backspace', 'say word|');
    await check(page, 'the end.', -1, 'Control+Backspace', 'the end|');
    await check(page, 'wait... ok', -1, 'Control+Backspace', 'wait... |');
    await check(page, 'one two three', 11, 'Control+Backspace', 'one two |ee');
    await check(page, '你好世界很好', -1, 'Control+Backspace', '你好世界|');
    await check(page, 'café olé', -1, 'Control+Backspace', 'café |');
  });

  test('backward at the start of the block deletes nothing', async ({ page }) => {
    await check(page, 'hello', 0, 'Control+Backspace', '|hello');
  });

  test('forward (Windows rule in this run): the word and the whitespace after it', async ({ page }) => {
    await check(page, 'one two three', 4, 'Control+Delete', 'one |three');
    await check(page, 'one two', 4, 'Control+Delete', 'one |');
    await check(page, 'one two', 3, 'Control+Delete', 'one|two');
    await check(page, '你好世界', 0, 'Control+Delete', '|世界');
    await check(page, 'hello', -1, 'Control+Delete', 'hello|');
  });

  test('one undo restores the deleted word and the caret', async ({ page }) => {
    await buildDoc(page, [P('this is a sentence ')]);
    await focusEnd(page, 'this is a sentence ');
    await press(page, 'Control+Backspace');
    await expect.poll(() => caret(page)).toBe('this is a |');
    await undo(page);
    await expect.poll(() => caret(page), { timeout: 3000 }).toBe('this is a sentence |');
  });
});
