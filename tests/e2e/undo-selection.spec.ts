/**
 * E2E — undo / redo restore the SELECTION (ADR 015).
 *
 * Ctrl+Z gives back the selection as it was right BEFORE the undone action (a range stays a range, a backward one stays
 * backward, a cross-block one stays cross-block); Ctrl+Y gives back where the action ENDED. The restored selection is
 * scrolled into view ("nearest"), and it is a real, usable selection (typing replaces it).
 *
 * Asserted against the MODEL: `caret()` (model.ts) prints the selection as `a⟦bc⟧d` / `a|bc` / `first@3 -> last@2`.
 */

import { test, expect, type Page } from './helpers/test.js';
import { gotoEditor, clearAndReset, press, typeText, getMarkdown } from './helpers/editor.js';
import { undo, redo, bold } from './helpers/keyboard.js';
import { buildBlocks, Para, flat } from './helpers/blocks.js';
import { caret, focusAt, selectRange, collectErrors } from './helpers/model.js';
import { pasteText } from './helpers/clipboard.js';

let errors: ReturnType<typeof collectErrors>;

test.beforeEach(async ({ page }) => {
  errors = collectErrors(page);
  await gotoEditor(page);
  await clearAndReset(page);
});

test.afterEach(async () => {
  expect(errors.list(), 'console / page errors').toEqual([]);
});

/** The DOM direction of the selection ('backward' when the focus is before the anchor). */
const direction = (page: Page) => page.evaluate(() => (window.getSelection() as any).direction as string);

// ═══════════════════════════════════════════════════════════════════════════
// A. Ctrl+Z gives back the selection as it was before the action
// ═══════════════════════════════════════════════════════════════════════════

test.describe('A · undo restores the selection of before the action', () => {
  test('1 · bold on "important" then Ctrl+Z: bold removed AND "important" selected again', async ({ page }) => {
    await buildBlocks(page, [Para('say important things')]);
    await selectRange(page, 'say important things', 4, 'say important things', 13);
    await bold(page);
    await expect.poll(() => getMarkdown(page)).toContain('**important**');

    await undo(page);
    await expect.poll(() => getMarkdown(page)).not.toContain('**');
    await expect.poll(() => caret(page)).toBe('say ⟦important⟧ things');
  });

  test('2 · select a paragraph\'s text + Backspace, Ctrl+Z: it comes back selected', async ({ page }) => {
    await buildBlocks(page, [Para('one'), Para('the second paragraph'), Para('three')]);
    await selectRange(page, 'the second paragraph', 0, 'the second paragraph', -1);
    await press(page, 'Backspace');
    await expect.poll(() => flat(page)).toBe('p(one) ; p(∅) ; p(three)');

    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(one) ; p(the second paragraph) ; p(three)');
    await expect.poll(() => caret(page)).toBe('⟦the second paragraph⟧');
  });

  test('3 · type "bonjour" then Ctrl+Z: the caret is back where typing started', async ({ page }) => {
    await buildBlocks(page, [Para('hello world')]);
    await focusAt(page, 'hello world', 5);
    await typeText(page, 'bonjour');
    await expect.poll(() => flat(page)).toBe('p(hellobonjour world)');

    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(hello world)');
    await expect.poll(() => caret(page)).toBe('hello| world');
  });

  test('4 · paste over a selection then Ctrl+Z: the pre-paste selection is back', async ({ page }) => {
    await buildBlocks(page, [Para('hello world')]);
    await selectRange(page, 'hello world', 6, 'hello world', 11);
    await pasteText(page, 'there');
    await expect.poll(() => flat(page)).toBe('p(hello there)');

    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(hello world)');
    await expect.poll(() => caret(page)).toBe('hello ⟦world⟧');
  });

  test('5 · a multi-block selection + Backspace, Ctrl+Z: the SAME multi-block selection is back', async ({ page }) => {
    await buildBlocks(page, [Para('alpha'), Para('beta'), Para('gamma')]);
    await selectRange(page, 'alpha', 2, 'gamma', 3);
    await press(page, 'Backspace');
    await expect.poll(() => flat(page)).toBe('p(alma)');

    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(alpha) ; p(beta) ; p(gamma)');
    await expect.poll(() => caret(page)).toBe('alpha@2 -> gamma@3');
    // anchor and focus are in different blocks, the first one holds the anchor
    const ends = await page.evaluate(() => {
      const s = window.getSelection()!;
      const text = (n: Node) => (n.parentElement!.closest('[data-block-id]') as HTMLElement).textContent;
      return [text(s.anchorNode!), text(s.focusNode!)];
    });
    expect(ends).toEqual(['alpha', 'gamma']);
  });

  test('6 · a BACKWARD selection keeps its direction (single block)', async ({ page }) => {
    await buildBlocks(page, [Para('say important things')]);
    await selectRange(page, 'say important things', 13, 'say important things', 4); // anchor after focus
    expect(await direction(page)).toBe('backward');
    await press(page, 'Backspace');
    await expect.poll(() => flat(page)).toBe('p(say  things)');

    await undo(page);
    await expect.poll(() => caret(page)).toBe('say ⟦important⟧ things');
    expect(await direction(page)).toBe('backward');
  });

  test('7 · a BACKWARD multi-block selection keeps its direction', async ({ page }) => {
    await buildBlocks(page, [Para('alpha'), Para('beta'), Para('gamma')]);
    await selectRange(page, 'gamma', 3, 'alpha', 2); // anchor in gamma, focus in alpha
    await press(page, 'Delete');
    await expect.poll(() => flat(page)).toBe('p(alma)');

    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(alpha) ; p(beta) ; p(gamma)');
    await expect.poll(() => caret(page)).toBe('gamma@3 -> alpha@2');
    expect(await direction(page)).toBe('backward');
  });

  test('8 · Backspace at a caret: the caret comes back where it was, and a second Backspace/undo round works too', async ({ page }) => {
    await buildBlocks(page, [Para('abcdef')]);
    await focusAt(page, 'abcdef', 3);
    await press(page, 'Backspace');
    await expect.poll(() => flat(page)).toBe('p(abdef)');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(abcdef)');
    await expect.poll(() => caret(page)).toBe('abc|def');

    await press(page, 'Backspace');
    await expect.poll(() => flat(page)).toBe('p(abdef)');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(abcdef)');
    await expect.poll(() => caret(page)).toBe('abc|def');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. Ctrl+Y / Ctrl+Shift+Z gives back where the action ended
// ═══════════════════════════════════════════════════════════════════════════

test.describe('B · redo restores where the action ended', () => {
  test('1 · redo of typing: the caret is at the end of the retyped text', async ({ page }) => {
    await buildBlocks(page, [Para('hello world')]);
    await focusAt(page, 'hello world', 5);
    await typeText(page, 'bonjour');
    await undo(page);
    await expect.poll(() => caret(page)).toBe('hello| world');

    await redo(page);
    await expect.poll(() => flat(page)).toBe('p(hellobonjour world)');
    await expect.poll(() => caret(page)).toBe('hellobonjour| world');
  });

  test('2 · redo of bold: the text is selected (and bold again)', async ({ page }) => {
    await buildBlocks(page, [Para('say important things')]);
    await selectRange(page, 'say important things', 4, 'say important things', 13);
    await bold(page);
    await undo(page);
    await redo(page);
    await expect.poll(() => getMarkdown(page)).toContain('**important**');
    await expect.poll(() => caret(page)).toBe('say ⟦important⟧ things');
  });

  test('3 · redo of a deletion: the caret is where the deletion left it', async ({ page }) => {
    await buildBlocks(page, [Para('say important things')]);
    await selectRange(page, 'say important things', 4, 'say important things', 13);
    await press(page, 'Backspace');
    await undo(page);
    await expect.poll(() => caret(page)).toBe('say ⟦important⟧ things');

    await redo(page);
    await expect.poll(() => flat(page)).toBe('p(say  things)');
    await expect.poll(() => caret(page)).toBe('say | things');
  });

  test('4 · Ctrl+Shift+Z is redo too, and it still lands where the action ended after the caret moved elsewhere', async ({ page }) => {
    await buildBlocks(page, [Para('first line'), Para('second line')]);
    await focusAt(page, 'first line', 5);
    await typeText(page, 'XY');
    await page.locator('[data-block-id]', { hasText: 'second line' }).click(); // the user clicks elsewhere
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(first line) ; p(second line)');

    await press(page, 'Control+Shift+z');
    await expect.poll(() => flat(page)).toBe('p(firstXY line) ; p(second line)');
    await expect.poll(() => caret(page)).toBe('firstXY| line');
  });

  test('5 · undo, redo, undo, redo keep landing on the right selections', async ({ page }) => {
    await buildBlocks(page, [Para('say important things')]);
    await selectRange(page, 'say important things', 4, 'say important things', 13);
    await bold(page);
    for (let i = 0; i < 2; i++) {
      await undo(page);
      await expect.poll(() => getMarkdown(page)).not.toContain('**');
      await expect.poll(() => caret(page)).toBe('say ⟦important⟧ things');
      await redo(page);
      await expect.poll(() => getMarkdown(page)).toContain('**important**');
      await expect.poll(() => caret(page)).toBe('say ⟦important⟧ things');
    }
  });

  test('6 · redo of a multi-block deletion: a caret at the join', async ({ page }) => {
    await buildBlocks(page, [Para('alpha'), Para('beta'), Para('gamma')]);
    await selectRange(page, 'alpha', 2, 'gamma', 3);
    await press(page, 'Backspace');
    await undo(page);
    await redo(page);
    await expect.poll(() => flat(page)).toBe('p(alma)');
    await expect.poll(() => caret(page)).toBe('al|ma');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. The restored selection is scrolled into view, and usable
// ═══════════════════════════════════════════════════════════════════════════

test.describe('C · scroll and usability', () => {
  const longDoc = () => Array.from({ length: 70 }, (_, i) => Para(`paragraph number ${i + 1} with some text`));
  /** Is the block with that text fully inside the window? */
  const visible = (page: Page, text: string) => page.evaluate((t) => {
    const n = (window as any).nabu;
    const block = [...n.blocks.values()].find((b: any) => b.behaviors?.get('text')?.text === t) as any;
    const r = block.element.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  }, text);
  const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

  test('1 · undoing a change far above scrolls it into view', async ({ page }) => {
    await buildBlocks(page, longDoc());
    await focusAt(page, 'paragraph number 1 with some text', 9);
    await typeText(page, 'XYZ');
    // move to the end of the document: the first paragraph leaves the viewport
    await selectRange(page, 'paragraph number 70 with some text', -1, 'paragraph number 70 with some text', -1);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => scrollY(page)).toBeGreaterThan(300);
    expect(await visible(page, 'paragraphXYZ number 1 with some text')).toBe(false);

    await undo(page);
    await expect.poll(() => visible(page, 'paragraph number 1 with some text')).toBe(true);
    await expect.poll(() => caret(page)).toBe('paragraph| number 1 with some text');
  });

  test('2 · redo scrolls to where the action ended', async ({ page }) => {
    await buildBlocks(page, longDoc());
    await focusAt(page, 'paragraph number 1 with some text', 9);
    await typeText(page, 'XYZ');
    await undo(page);
    await selectRange(page, 'paragraph number 70 with some text', -1, 'paragraph number 70 with some text', -1);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => scrollY(page)).toBeGreaterThan(300);

    await redo(page);
    await expect.poll(() => visible(page, 'paragraphXYZ number 1 with some text')).toBe(true);
  });

  test('3 · an already visible selection does not scroll the page', async ({ page }) => {
    await buildBlocks(page, longDoc());
    await selectRange(page, 'paragraph number 5 with some text', 0, 'paragraph number 5 with some text', 9);
    await press(page, 'Backspace');
    await page.evaluate(() => window.scrollTo(0, 120));
    const before = await scrollY(page);
    await undo(page);
    await expect.poll(() => caret(page)).toBe('⟦paragraph⟧ number 5 with some text');
    expect(await scrollY(page)).toBe(before);
  });

  test('4 · after undoing a deletion the selection is live: typing replaces it', async ({ page }) => {
    await buildBlocks(page, [Para('say important things')]);
    await selectRange(page, 'say important things', 4, 'say important things', 13);
    await press(page, 'Backspace');
    await undo(page);
    await expect.poll(() => caret(page)).toBe('say ⟦important⟧ things');
    await typeText(page, 'X');
    await expect.poll(() => flat(page)).toBe('p(say X things)');
    await expect.poll(() => caret(page)).toBe('say X| things');
  });

  test('5 · after undoing typing, typing again continues at the restored caret', async ({ page }) => {
    await buildBlocks(page, [Para('hello world')]);
    await focusAt(page, 'hello world', 5);
    await typeText(page, 'abc');
    await undo(page);
    await typeText(page, 'Z');
    await expect.poll(() => flat(page)).toBe('p(helloZ world)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D. Existing undo behaviors are unchanged
// ═══════════════════════════════════════════════════════════════════════════

test.describe('D · unchanged behaviors', () => {
  test('1 · markdown shortcut: "# " -> heading; Ctrl+Z -> paragraph "# " with the caret after the space', async ({ page }) => {
    await buildBlocks(page, [Para('')]);
    await page.evaluate(async () => { await (window as any).nabu.focus({ offset: 0 }); });
    await typeText(page, '# ');
    await expect.poll(() => flat(page)).toBe('h1(∅)');

    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(# )');
    await expect.poll(() => caret(page)).toBe('# |');
  });

  test('2 · "- " list shortcut: undo puts the caret back after the "- " in the restored paragraph', async ({ page }) => {
    await buildBlocks(page, [Para('')]);
    await page.evaluate(async () => { await (window as any).nabu.focus({ offset: 0 }); });
    await typeText(page, '- ');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(- )');
    await expect.poll(() => caret(page)).toBe('- |');
  });

  test('3 · a block deleted whole (Enter split joined back) comes back with a sensible caret', async ({ page }) => {
    await buildBlocks(page, [Para('first'), Para('second')]);
    await focusAt(page, 'second', 0);
    await press(page, 'Backspace'); // merge into "first"
    await expect.poll(() => flat(page)).toBe('p(firstsecond)');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(first) ; p(second)');
    await expect.poll(() => caret(page)).toBe('|second');
  });
});
