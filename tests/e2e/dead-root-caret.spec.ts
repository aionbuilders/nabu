/**
 * E2E — a caret the browser leaves ON THE EDITOR ROOT (Firefox after Tab into the editor or `root.focus()`: (root, 0), collapsed).
 *
 * Typing there used to be lost: with no arrow key to give a direction, `normalize()` guessed one from the offset, found no text that
 * way (nothing before offset 0) and left the caret dead. Chromium puts the caret in the text itself, so the state is FORCED here
 * with `getSelection().collapse(root, n)`, then driven with the real keyboard. A range that merely spans the root (the browser's
 * native Select All) must not be turned into a caret.
 */

import { test, expect } from './helpers/test.js';
import { gotoEditor, clearAndReset, focusEditor, typeText, flushRender, getEditor } from './helpers/editor.js';
import { undo } from './helpers/keyboard.js';
import { buildDoc, P, allText, caret, violations } from './helpers/model.js';

/** Put the DOM selection on the editor root: collapsed at `at` ('start' = 0, 'end' = past the last child), or the full range. */
async function forceRoot(page: import('@playwright/test').Page, at: 'start' | 'end' | 'range') {
  await page.evaluate((where) => {
    const root = document.querySelector('[data-nabu-root]') as HTMLElement;
    root.focus();
    const sel = window.getSelection()!;
    const n = root.childNodes.length;
    if (where === 'range') sel.setBaseAndExtent(root, 0, root, n);
    else sel.collapse(root, where === 'start' ? 0 : n);
  }, at);
}

/** The text of the whole editor as the DOM shows it, whitespace removed (blocks are glued together). */
const domText = (page: import('@playwright/test').Page) => getEditor(page).evaluate((el) => (el.textContent ?? '').replace(/\s+/g, ''));

test.describe('Caret forced on the editor root', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  test('caret at (root, 0) on a document with text: typing lands at the start of the first block', async ({ page }) => {
    await buildDoc(page, [P('hello'), P('world')]);
    await forceRoot(page, 'start');
    await typeText(page, 'AB');
    expect(await allText(page)).toEqual(['ABhello', 'world']);
    expect(await domText(page)).toBe('ABhelloworld');
    expect(await caret(page)).toBe('AB|hello');
  });

  test('caret at (root, 0) on an empty document: typing lands in the block', async ({ page }) => {
    await forceRoot(page, 'start');
    await typeText(page, 'AB');
    expect(await allText(page)).toEqual(['AB']);
    expect(await domText(page)).toBe('AB');
    expect(await violations(page)).toEqual([]);
  });

  test('caret past the last child of the root: typing is not lost and the DOM agrees with the model', async ({ page }) => {
    await buildDoc(page, [P('hello'), P('world')]);
    await forceRoot(page, 'end');
    await typeText(page, 'AB');
    const texts = await allText(page);
    expect(texts.join('')).toContain('AB');
    expect(texts.join('').length).toBe('helloworldAB'.length);
    expect(await domText(page)).toBe(texts.join(''));
    expect(await violations(page)).toEqual([]);
  });

  test('a range (root, 0)-(root, n) stays a range (native Select All is not collapsed)', async ({ page }) => {
    await buildDoc(page, [P('hello'), P('world')]);
    await forceRoot(page, 'range');
    await flushRender(page);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    const state = await page.evaluate(() => {
      const s = window.getSelection()!;
      return { collapsed: s.isCollapsed, anchorIsRoot: s.anchorNode === document.querySelector('[data-nabu-root]') };
    });
    expect(state.collapsed).toBe(false);
    expect(await allText(page)).toEqual(['hello', 'world']);
  });

  test('undo after typing at (root, 0) gives back the original text', async ({ page }) => {
    await buildDoc(page, [P('hello'), P('world')]);
    await forceRoot(page, 'start');
    await typeText(page, 'AB');
    expect(await allText(page)).toEqual(['ABhello', 'world']);
    await undo(page);
    expect(await allText(page)).toEqual(['hello', 'world']);
  });
});
