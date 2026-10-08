/**
 * E2E — Text editing & marks (gap coverage)
 *
 * Complements typing / marks / undo / edge-cases specs with:
 *  A. typing & structure (mid-text insertion, split/merge cursor, placeholder, word deletion, select-all delete)
 *  B. marks (strikethrough/underline/code toggle, mixed-selection toggle, FloatingToolbar, stored marks)
 *  C. links (set / expand: none / remove, via action and via toolbar)
 *  D. misc (typography negative case, undo/redo cursor sanity)
 *
 * Assertions are on the MODEL (serialize('json') runs, getSelection) unless the DOM is the point.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  gotoEditor, clearAndReset, focusEditor, getEditor, getBlock,
  typeText, press, getJson, getBlocks, getSelection, getRootBlockCount, exec,
} from './helpers/editor.js';
import {
  bold, italic, underline, code, undo, redo, selectAll, selectForward, selectLine, goToStart,
} from './helpers/keyboard.js';

const isMac = process.platform === 'darwin';
const wordMod = isMac ? 'Alt' : 'Control';

type Run = { text: string; [mark: string]: any };

/** Delta runs ({text, bold?, link?, ...}) of the block at `index` (root level). */
async function runs(page: Page, index = 0): Promise<Run[]> {
  const json = await getJson(page);
  return json.blocks[index].content ?? [];
}

/** Concatenated text of the runs that carry `mark` (truthy). */
async function textWith(page: Page, mark: string, index = 0): Promise<string> {
  return (await runs(page, index)).filter(r => r[mark]).map(r => r.text).join('');
}

/** Concatenated text of the runs that do NOT carry `mark`. */
async function textWithout(page: Page, mark: string, index = 0): Promise<string> {
  return (await runs(page, index)).filter(r => !r[mark]).map(r => r.text).join('');
}

async function fullText(page: Page, index = 0): Promise<string> {
  return (await runs(page, index)).map(r => r.text).join('');
}

/**
 * Collapses the caret at `offset` in the first text block and waits for the model selection to
 * catch up (selectionchange -> model sync is async; racing it makes Enter/Delete act on a stale offset).
 */
async function placeCursor(page: Page, offset: number) {
  await press(page, 'Home');
  for (let i = 0; i < offset; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await getSelection(page))?.focusOffset).toBe(offset);
}

/** Selects `len` characters starting at `start` in the first text block (keyboard only). */
async function selectRange(page: Page, start: number, len: number) {
  await placeCursor(page, start);
  await selectForward(page, len);
  await expect.poll(async () => {
    const s = await getSelection(page);
    return s ? s.focusOffset - s.anchorOffset : null;
  }).toBe(len);
}

test.describe('Text editing & marks', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  // ── A. Typing & structure ─────────────────────────────────────────────────

  test('P1 · A1 · inserting mid-text after ArrowLeft fixes a typo', async ({ page }) => {
    await typeText(page, 'helo');
    await press(page, 'ArrowLeft');
    await typeText(page, 'l');

    expect(await fullText(page)).toBe('hello');
    expect(await getSelection(page)).toMatchObject({ focusOffset: 4, anchorOffset: 4 });
  });

  test('P0 · A2 · Enter mid-text splits the block and moves the cursor to start of the 2nd block', async ({ page }) => {
    await typeText(page, 'hello world');
    await placeCursor(page, 5);
    await press(page, 'Enter');

    const blocks = await getBlocks(page);
    expect(blocks.map(b => b.text)).toEqual(['hello', ' world']);

    await expect.poll(async () => (await getSelection(page))?.focusBlockId).toBe(blocks[1].id);
    const sel = await getSelection(page);
    expect(sel?.focusOffset).toBe(0);
    expect(sel?.anchorOffset).toBe(0);
  });

  test('P1 · A3 · empty paragraph exposes its placeholder, which clears once text is typed', async ({ page }) => {
    const para = getBlock(page, 'paragraph');
    await expect(para).toHaveAttribute('data-placeholder', 'Start writing...');
    await expect(para).toHaveText('');
    expect((await getBlocks(page))[0].text ?? '').toBe('');

    await typeText(page, 'x');
    await expect(para).toHaveAttribute('data-placeholder', '');
    await expect(para).toHaveText('x');

    await press(page, 'Backspace');
    await expect(para).toHaveAttribute('data-placeholder', 'Start writing...');
  });

  test('P2 · A3b · placeholder is actually rendered on screen for an empty paragraph', async ({ page }) => {
    // The attribute alone is invisible: a CSS rule must render it (e.g. via ::after { content: attr(data-placeholder) }).
    // Default show is 'focus': wait for the caret (selectionchange, async) to reach the model first.
    await expect(getBlock(page, 'paragraph')).toHaveAttribute('data-placeholder', 'Start writing...');
    const content = await page.evaluate(() => {
      const el = document.querySelector('[data-block-type="paragraph"]')!;
      return getComputedStyle(el, '::after').content;
    });
    expect(content).toContain('Start writing...');
  });

  /** Rendered `::after` content of the nth paragraph ('none' / 'normal' when no placeholder is drawn). */
  async function afterContent(page: Page, index: number): Promise<string> {
    return page.evaluate((i) => {
      const el = document.querySelectorAll('[data-block-type="paragraph"]')[i]!;
      return getComputedStyle(el, '::after').content;
    }, index);
  }

  test('P1 · A3c · default show "focus": only the empty block holding the cursor shows its placeholder', async ({ page }) => {
    await press(page, 'Enter'); // two empty paragraphs, cursor in the 2nd
    await expect.poll(() => getRootBlockCount(page)).toBe(2);
    const first = getBlock(page, 'paragraph', 0);
    const second = getBlock(page, 'paragraph', 1);

    await expect(second).toHaveAttribute('data-placeholder', 'Start writing...');
    await expect(first).toHaveAttribute('data-placeholder', '');
    expect(await afterContent(page, 1)).toContain('Start writing...');
    expect(await afterContent(page, 0)).not.toContain('Start writing...');

    // the placeholder follows the caret
    await press(page, 'ArrowUp');
    await expect(first).toHaveAttribute('data-placeholder', 'Start writing...');
    await expect(second).toHaveAttribute('data-placeholder', '');
    expect(await afterContent(page, 0)).toContain('Start writing...');
    expect(await afterContent(page, 1)).not.toContain('Start writing...');
  });

  test('P1 · A3d · the placeholder disappears as soon as you type, with nothing drawn and the text untouched', async ({ page }) => {
    const para = getBlock(page, 'paragraph');
    expect(await afterContent(page, 0)).toContain('Start writing...');

    await page.keyboard.type('a');
    await expect(para).toHaveAttribute('data-placeholder', '');
    expect(await afterContent(page, 0)).not.toContain('Start writing...');
    await expect(para).toHaveText('a');
    expect(await fullText(page)).toBe('a');
  });

  test('P2 · A3e · placeholders: { show: "empty" } shows it on every empty block, text override applies', async ({ page }) => {
    await gotoEditor(page, { options: { placeholders: { show: 'empty', text: { paragraph: 'Write here' } } } });
    await clearAndReset(page);
    await focusEditor(page);
    await press(page, 'Enter');
    await expect.poll(() => getRootBlockCount(page)).toBe(2);
    await typeText(page, 'x');
    await press(page, 'Enter'); // [empty, "x", empty], cursor in the last one
    await expect.poll(() => getRootBlockCount(page)).toBe(3);

    await expect(getBlock(page, 'paragraph', 0)).toHaveAttribute('data-placeholder', 'Write here'); // unfocused, still shown
    await expect(getBlock(page, 'paragraph', 1)).toHaveAttribute('data-placeholder', '');
    await expect(getBlock(page, 'paragraph', 2)).toHaveAttribute('data-placeholder', 'Write here');
    expect(await afterContent(page, 0)).toContain('Write here');
  });

  test('P2 · A3f · placeholders: false disables them entirely', async ({ page }) => {
    await gotoEditor(page, { options: { placeholders: false } });
    await clearAndReset(page);
    await focusEditor(page);

    const para = getBlock(page, 'paragraph');
    await expect(para).toHaveAttribute('data-placeholder', '');
    expect(await afterContent(page, 0)).not.toContain('Start writing...');
  });

  test('P0 · A4 · Backspace at start of 2nd paragraph merges and leaves the cursor at the junction', async ({ page }) => {
    await typeText(page, 'first');
    await press(page, 'Enter');
    await typeText(page, 'second');
    await goToStart(page);
    await press(page, 'Backspace');

    await expect.poll(() => getRootBlockCount(page)).toBe(1);
    expect(await fullText(page)).toBe('firstsecond');

    const [block] = await getBlocks(page);
    await expect.poll(async () => (await getSelection(page))?.focusOffset).toBe(5);
    const sel = await getSelection(page);
    expect(sel?.focusBlockId).toBe(block.id);
    expect(sel?.anchorOffset).toBe(5);

    // typing lands exactly at the junction
    await typeText(page, '|');
    expect(await fullText(page)).toBe('first|second');
  });

  test('P1 · A6 · Ctrl+Backspace deletes the previous word without leaving an orphan space', async ({ page }) => {
    await typeText(page, 'one two three');
    await press(page, `${wordMod}+Backspace`);

    expect(await fullText(page)).toBe('one two');
    expect((await getSelection(page))?.focusOffset).toBe(7);
  });

  test('P1 · A6b · Ctrl+Delete deletes the next word from inside the text', async ({ page }) => {
    await typeText(page, 'one two three');
    await placeCursor(page, 3); // after "one"
    await press(page, `${wordMod}+Delete`);

    // Chromium/Linux forward word deletion removes " two" (up to end of next word).
    // Whatever whitespace policy applies, "two" must be gone, "one" and "three" must survive intact.
    const text = await fullText(page);
    expect(text).not.toContain('two');
    expect(text.startsWith('one')).toBe(true);
    expect(text.endsWith('three')).toBe(true);
    expect(text.replace(/\s+/g, ' ')).toMatch(/^one ?three$|^one three$/);
    expect((await getSelection(page))?.focusOffset).toBe(3);
  });

  test('P1 · A8 · Select-all + Backspace over 3 paragraphs leaves one empty paragraph and typing works', async ({ page }) => {
    await typeText(page, 'one');
    await press(page, 'Enter');
    await typeText(page, 'two');
    await press(page, 'Enter');
    await typeText(page, 'three');
    expect(await getRootBlockCount(page)).toBe(3);

    await selectAll(page);
    await press(page, 'Backspace');

    await expect.poll(() => getRootBlockCount(page)).toBe(1);
    const [block] = await getBlocks(page);
    expect(block.type).toBe('paragraph');
    expect(block.text ?? '').toBe('');

    await typeText(page, 'again');
    expect(await getRootBlockCount(page)).toBe(1);
    expect(await fullText(page)).toBe('again');
  });

  // ── B. Marks ──────────────────────────────────────────────────────────────

  test('P1 · B1 · Ctrl+Shift+X toggles strikethrough on and off', async ({ page }) => {
    await typeText(page, 'strike');
    await selectLine(page);
    await press(page, 'Control+Shift+x');
    expect(await textWith(page, 'strikethrough')).toBe('strike');

    await selectLine(page);
    await press(page, 'Control+Shift+x');
    expect(await textWith(page, 'strikethrough')).toBe('');
    expect(await fullText(page)).toBe('strike');
  });

  test('P1 · B1b · Ctrl+U toggles underline off on the second press', async ({ page }) => {
    await typeText(page, 'under');
    await selectLine(page);
    await underline(page);
    expect(await textWith(page, 'underline')).toBe('under');

    await selectLine(page);
    await underline(page);
    expect(await textWith(page, 'underline')).toBe('');
  });

  test('P1 · B1c · Ctrl+E toggles inline code off on the second press', async ({ page }) => {
    await typeText(page, 'mono');
    await selectLine(page);
    await code(page);
    expect(await textWith(page, 'code')).toBe('mono');

    await selectLine(page);
    await code(page);
    expect(await textWith(page, 'code')).toBe('');
  });

  test('P1 · B2 · Ctrl+B on a partially bold selection bolds everything, then unbolds everything', async ({ page }) => {
    await typeText(page, 'hello world');
    await selectRange(page, 0, 5);
    await bold(page);
    expect(await textWith(page, 'bold')).toBe('hello');

    await selectLine(page); // whole block text
    await bold(page);
    expect(await textWith(page, 'bold')).toBe('hello world');
    expect(await textWithout(page, 'bold')).toBe('');

    await selectLine(page);
    await bold(page);
    expect(await textWith(page, 'bold')).toBe('');
    expect(await fullText(page)).toBe('hello world');
  });

  test('P1 · B4 · FloatingToolbar is hidden on a collapsed cursor and visible on a selection', async ({ page }) => {
    const toolbar = page.locator('.nabu-toolbar');
    await typeText(page, 'hello world');
    await expect(toolbar).toHaveCount(0);

    await selectLine(page);
    await expect(toolbar).toBeVisible();

    await press(page, 'ArrowRight'); // collapse
    await expect(toolbar).toHaveCount(0);
  });

  test('P1 · B4b · clicking the toolbar B button bolds the selection and shows it as active', async ({ page }) => {
    await typeText(page, 'hello world');
    await selectRange(page, 0, 5);

    const boldBtn = page.locator('.nabu-toolbar .nabu-toolbar-btn', { hasText: /^B$/ });
    await expect(boldBtn).toBeVisible();
    await expect(boldBtn).not.toHaveClass(/active/);

    await boldBtn.click();

    expect(await textWith(page, 'bold')).toBe('hello');
    expect(await textWithout(page, 'bold')).toBe(' world');
    // selection is preserved and fully bold -> button is active
    await expect(page.locator('.nabu-toolbar')).toBeVisible();
    await expect(boldBtn).toHaveClass(/active/);

    // clicking again removes it
    await boldBtn.click();
    expect(await textWith(page, 'bold')).toBe('');
    await expect(boldBtn).not.toHaveClass(/active/);
  });

  test('P0 · B5 · stored mark: Ctrl+B at a collapsed cursor bolds only what is typed next', async ({ page }) => {
    await typeText(page, 'plain ');
    await bold(page);
    await typeText(page, 'bold');
    await bold(page);
    await typeText(page, ' after');

    expect(await fullText(page)).toBe('plain bold after');
    expect(await textWith(page, 'bold')).toBe('bold');
    expect(await textWithout(page, 'bold')).toBe('plain  after');
  });

  test('P1 · B5b · stored mark is dropped when the cursor moves (ArrowLeft)', async ({ page }) => {
    await typeText(page, 'abcdef');
    await bold(page);            // pending bold at end
    await press(page, 'ArrowLeft'); // selection change -> pending mark must be cleared
    await typeText(page, 'X');

    expect(await fullText(page)).toBe('abcdeXf');
    expect(await textWith(page, 'bold')).toBe('');
  });

  test('P1 · B5c · stored mark is dropped when the user clicks elsewhere in the text', async ({ page }) => {
    await typeText(page, 'abcdef');
    await bold(page);
    // click on the block itself (left part) -> moves the caret and fires mousedown
    const box = (await getBlock(page, 'paragraph').boundingBox())!;
    await page.mouse.click(box.x + 1, box.y + box.height / 2);
    await typeText(page, 'X');

    expect(await fullText(page)).toContain('X');
    expect(await textWith(page, 'bold')).toBe('');
  });

  // ── C. Links ──────────────────────────────────────────────────────────────

  test('P0 · C1 · link:set links exactly the selected word and renders an <a>', async ({ page }) => {
    await typeText(page, 'visit example now');
    await selectRange(page, 6, 7); // "example"
    await exec(page, 'link:set', { href: 'https://example.com' });

    const r = await runs(page);
    expect(r.filter(x => x.link).map(x => ({ text: x.text, link: x.link })))
      .toEqual([{ text: 'example', link: 'https://example.com' }]);
    expect(await fullText(page)).toBe('visit example now');

    const a = getEditor(page).locator('a[href="https://example.com"]');
    await expect(a).toHaveCount(1);
    await expect(a).toHaveText('example');
  });

  test('P1 · C1b · toolbar link button prompts for a URL and links the selection', async ({ page }) => {
    const prompts: string[] = [];
    page.on('dialog', async d => {
      prompts.push(d.type());
      await d.accept('https://example.com');
    });

    await typeText(page, 'visit example now');
    await selectRange(page, 6, 7);

    const linkBtn = page.locator('.nabu-toolbar .nabu-toolbar-btn[title="Link"]');
    await expect(linkBtn).toBeVisible();
    await linkBtn.click();

    await expect.poll(() => textWith(page, 'link')).toBe('example');
    expect(prompts).toEqual(['prompt']);
    expect((await runs(page)).find(x => x.link)?.link).toBe('https://example.com');
    await expect(getEditor(page).locator('a[href="https://example.com"]')).toHaveText('example');
  });

  test('P1 · C2 · typing right after a linked word does not extend the link', async ({ page }) => {
    await typeText(page, 'link');
    await selectLine(page);
    await exec(page, 'link:set', { href: 'https://example.com' });
    expect(await textWith(page, 'link')).toBe('link');

    await press(page, 'End');
    await typeText(page, 'xyz');

    expect(await fullText(page)).toBe('linkxyz');
    expect(await textWith(page, 'link')).toBe('link');
    expect(await textWithout(page, 'link')).toBe('xyz');
  });

  test('P1 · C3 · link:remove strips the link from the selected word', async ({ page }) => {
    await typeText(page, 'visit example now');
    await selectRange(page, 6, 7);
    await exec(page, 'link:set', { href: 'https://example.com' });
    expect(await textWith(page, 'link')).toBe('example');

    await selectRange(page, 6, 7);
    await exec(page, 'link:remove');

    expect(await textWith(page, 'link')).toBe('');
    expect(await fullText(page)).toBe('visit example now');
    await expect(getEditor(page).locator('a')).toHaveCount(0);
  });

  test('P2 · C3b · toolbar link button on an already-linked selection removes the link (no prompt)', async ({ page }) => {
    let dialogs = 0;
    page.on('dialog', async d => { dialogs++; await d.dismiss(); });

    await typeText(page, 'linked');
    await selectLine(page);
    await exec(page, 'link:set', { href: 'https://example.com' });
    expect(await textWith(page, 'link')).toBe('linked');

    await selectLine(page);
    const linkBtn = page.locator('.nabu-toolbar .nabu-toolbar-btn[title="Link"]');
    await expect(linkBtn).toBeVisible();
    await expect(linkBtn).toHaveClass(/active/);
    await linkBtn.click();

    await expect.poll(() => textWith(page, 'link')).toBe('');
    expect(dialogs).toBe(0);
  });

  // ── D. Misc ───────────────────────────────────────────────────────────────

  test('P1 · D1 · "--help" keeps its double dash (no em-dash without a trailing space)', async ({ page }) => {
    await typeText(page, '--help');
    expect(await fullText(page)).toBe('--help');
  });

  test('P1 · D1b · "a-- b" becomes "a— b" once the space is typed', async ({ page }) => {
    await typeText(page, 'a-- b');
    expect(await fullText(page)).toBe('a— b');
  });

  test('P1 · D2 · undo is granular around a split (def, then the split) and leaves a sensible cursor', async ({ page }) => {
    await typeText(page, 'abc');
    await press(page, 'Enter');
    await typeText(page, 'def');
    expect(await getRootBlockCount(page)).toBe(2);

    // P-07: a split is its own undo step, and the typing after it does not merge into it,
    // even though everything was typed well within the UndoManager's 1 s merge window.
    // 1st Ctrl+Z removes "def" only (both blocks stay, the 2nd one is empty)…
    await undo(page);
    await expect.poll(async () => (await getBlocks(page)).map(b => b.text ?? '')).toEqual(['abc', '']);
    // …2nd Ctrl+Z removes the split (back to a single "abc" paragraph).
    await undo(page);
    await expect.poll(() => getRootBlockCount(page)).toBe(1);
    expect((await getBlocks(page)).map(b => b.text ?? '')).toEqual(['abc']);

    const blocks = await getBlocks(page);
    const sel = await getSelection(page);
    expect(sel).not.toBeNull();
    // Cursor must be collapsed and live in an existing block, within its text bounds.
    const target = blocks.find(b => b.id === sel!.focusBlockId);
    expect(target, 'cursor must be inside an existing block').toBeTruthy();
    const len = (target!.text ?? '').length;
    expect(sel!.focusOffset).toBeGreaterThanOrEqual(0);
    expect(sel!.focusOffset).toBeLessThanOrEqual(len);
    expect(sel!.anchorBlockId).toBe(sel!.focusBlockId);
    expect(sel!.anchorOffset).toBe(sel!.focusOffset);

    // Typing inserts exactly at the reported cursor, without corrupting the text.
    const before = target!.text ?? '';
    const at = sel!.focusOffset;
    await typeText(page, 'Z');
    expect(await fullText(page)).toBe(before.slice(0, at) + 'Z' + before.slice(at));
    expect(await getRootBlockCount(page)).toBe(1);

    // Redo still works after the edit being a new branch: no crash, doc stays a single paragraph tree.
    await redo(page);
    expect((await getBlocks(page)).every(b => b.type === 'paragraph')).toBe(true);
  });
});
