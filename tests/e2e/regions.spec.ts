/**
 * E2E — Regions (ADR 016, lot 1): the marker renders as an accessible seam with its computed label, the caret steps over
 * it like over a divider (one key press) and typing never lands in it, markers stay at the root, the registry follows the
 * document. Lot 2 (ADR 016 §3.4 / §6, ADR 017): Mod-Enter splits, Backspace / Delete at a region boundary NEVER merge text through
 * the marker (the merge is a HOLD of the key on the seam), the structural commands run through `nabu.exec`, one undo step each.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, clearAndReset, press, flushRender } from './helpers/editor.js';
import { undo } from './helpers/keyboard.js';
import { caret, violations, focusAt, focusEnd, focusEmpty, selectRange, collectErrors } from './helpers/model.js';

/** One-line outline of the root blocks: `p(text)` or `R:type(title)`. */
async function roots(page: Page): Promise<string> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    return n.tree.roots().map((node: any) => {
      const type = node.data.get('type');
      if (type === 'region') return `R:${node.data.get('regionType')}(${node.data.get('fields')?.get('title') ?? ''})`;
      const t = node.data.get('text');
      const kids = (node.children() ?? []).length ? '{…}' : '';
      return `${type === 'paragraph' ? 'p' : type}(${t ? t.toString() : ''})${kids}`;
    }).join(' ; ');
  });
}

/** Replace the document with `p:text` / `r:type:title` items (programmatic fixture, undo history cleared). */
async function build(page: Page, spec: string[]) {
  await page.evaluate(async (items) => {
    const n = (window as any).nabu;
    for (const c of [...n.children]) n.delete(c);
    items.forEach((item, i) => {
      if (item.startsWith('p:')) n.insert('paragraph', { text: item.slice(2) }, null, i);
      else { const [, regionType, title = ''] = item.split(':'); n.insert('region', { regionType, title }, null, i); }
    });
    await n.commit();
    n.undoManager.clear();
  }, spec);
  await page.waitForFunction(() => {
    const n = (window as any).nabu;
    return n.tree.roots().length > 0 && document.querySelectorAll('[data-block-id]').length === n.tree.roots().length;
  });
}

/** Text of the block holding the caret, the `|` caret marker removed. */
const inBlock = async (page: Page) => (await caret(page))?.replace('|', '');
const expectCaret = (page: Page, expected: string) => expect.poll(() => caret(page), { timeout: 3000, message: 'caret' }).toBe(expected);
const expectRoots = (page: Page, expected: string) => expect.poll(() => roots(page), { timeout: 3000, message: 'roots' }).toBe(expected);
async function expectValid(page: Page) { expect(await violations(page)).toEqual([]); }

let errors: ReturnType<typeof collectErrors>;
test.beforeEach(async ({ page }) => { errors = collectErrors(page); });
test.afterEach(async () => { expect(errors.list(), 'console / page errors').toEqual([]); });

test.describe('seeded document', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, { seed: 'regions' }); });

  test('markers render as seams with their computed labels, as headings of their level', async ({ page }) => {
    const seams = page.locator('[data-block-type="region"]');
    await expect(seams).toHaveCount(4);
    await expect(seams.nth(0)).toHaveText('1. The ferryman');
    await expect(seams.nth(1)).toHaveText('1.1 The bank');
    await expect(seams.nth(2)).toHaveText('1.2 The water');
    await expect(seams.nth(3)).toHaveText('2. The return');
    const levels = await seams.evaluateAll((els) => els.map((e) => [e.getAttribute('role'), e.getAttribute('aria-level')]));
    expect(levels).toEqual([['heading', '1'], ['heading', '2'], ['heading', '2'], ['heading', '1']]);
    // accessible tree: headings by level, with the label as name
    await expect(page.getByRole('heading', { level: 2, name: '1.1 The bank' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(2);
    // inert + not editable, like the other void blocks
    await expect(seams.first()).toHaveAttribute('contenteditable', 'false');
    await expect(seams.first()).toHaveAttribute('data-nabu-inert', '');
    await expectValid(page);
  });

  test('the registry matches the document (extent, tree, preamble, word counts)', async ({ page }) => {
    const info = await page.evaluate(() => {
      const r = (window as any).nabu.regions;
      return {
        labels: r.list.map((x: any) => x.label),
        paths: r.list.map((x: any) => x.pathString),
        tree: r.tree.map((x: any) => [x.label, x.children.map((c: any) => c.label)]),
        preamble: r.preamble.blocks.length,
        words: r.list.map((x: any) => [x.wordCount, x.ownWordCount]),
      };
    });
    expect(info.labels).toEqual(['1. The ferryman', '1.1 The bank', '1.2 The water', '2. The return']);
    expect(info.paths).toEqual(['1', '1.1', '1.2', '2']);
    expect(info.tree).toEqual([['1. The ferryman', ['1.1 The bank', '1.2 The water']], ['2. The return', []]]);
    expect(info.preamble).toBe(1);
    // "Opening of the first section." = 5, "Text of the bank." = 4, "Text of the water." = 4, "Closing text." = 2
    expect(info.words).toEqual([[13, 5], [4, 4], [4, 4], [2, 2]]);
  });

  test('a label follows its title live; the seam updates', async ({ page }) => {
    await page.evaluate(() => { const r = (window as any).nabu.regions.list[1]; r.setField('title', 'The shore'); });
    await expect(page.locator('[data-block-type="region"]').nth(1)).toHaveText('1.1 The shore');
  });

  test('inserting a marker in the middle renumbers the following ones', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.insert('region', { regionType: 'section-2', title: 'Inserted' }, null, 5); // right after the text of "The bank"
      await n.commit();
    });
    const seams = page.locator('[data-block-type="region"]');
    await expect(seams).toHaveCount(5);
    await expect(seams.nth(1)).toHaveText('1.1 The bank');
    await expect(seams.nth(2)).toHaveText('1.2 Inserted');
    await expect(seams.nth(3)).toHaveText('1.3 The water');
    await expectValid(page);
  });
});

test.describe('caret and typing', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await build(page, ['p:above', 'r:section-1:Part', 'p:below']);
  });

  test('ArrowDown / ArrowUp cross a marker in ONE press and typing is never swallowed', async ({ page }) => {
    await focusEnd(page, 'above');
    await press(page, 'ArrowDown');
    expect(await inBlock(page)).toBe('below');
    await press(page, 'ArrowUp');
    expect(await inBlock(page)).toBe('above');
    await press(page, 'ArrowDown');
    await page.keyboard.type('X');
    await expectRoots(page, 'p(above) ; R:section-1(Part) ; p(belowX)');
    await expectValid(page);
  });

  test('ArrowRight at the end of the block above lands at the start of the block below, and back with ArrowLeft', async ({ page }) => {
    await focusEnd(page, 'above');
    await press(page, 'ArrowRight');
    await expectCaret(page, '|below');
    await press(page, 'ArrowLeft');
    await expectCaret(page, 'above|');
    await page.keyboard.type('Z');
    await expectRoots(page, 'p(aboveZ) ; R:section-1(Part) ; p(below)');
    await expectValid(page);
  });

  test('clicking a marker does not put a caret in it; typing afterwards changes no marker data', async ({ page }) => {
    await page.locator('[data-block-type="region"]').click();
    await page.keyboard.type('abc');
    await flushRender(page);
    expect(await roots(page)).toMatch(/^p\(.*\) ; R:section-1\(Part\) ; p\(.*\)$/);
    await expectValid(page);
  });

  test('a marker as the last block: ArrowRight out of the text above opens ONE empty paragraph (like a divider)', async ({ page }) => {
    await build(page, ['p:above', 'r:section-1:Part']);
    await focusEnd(page, 'above');
    await press(page, 'ArrowRight');
    await page.keyboard.type('Q');
    await expectRoots(page, 'p(above) ; R:section-1(Part) ; p(Q)');
    await expectValid(page);
  });

  test('Enter / typing at the end of the block above never touches the marker', async ({ page }) => {
    await focusEnd(page, 'above');
    await press(page, 'Enter');
    await page.keyboard.type('new');
    await expectRoots(page, 'p(above) ; p(new) ; R:section-1(Part) ; p(below)');
    await expectValid(page);
  });
});

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const exec = (page: Page, topic: string, data?: any) => page.evaluate(([t, d]) => (window as any).nabu.exec(t, d), [topic, data] as [string, any]);
const pending = (page: Page) => page.evaluate(() => {
  const p = (window as any).nabu.pendingCommand;
  return p ? { id: p.id, strategy: p.strategy, progress: p.progress, message: p.message } : null;
});
const seams = (page: Page) => page.locator('[data-block-type="region"]');
const live = (page: Page) => page.locator('[data-nabu-live]');
const seamTexts = (page: Page) => seams(page).evaluateAll((els) => els.map((e) => e.querySelector('.nabu-region-label')?.textContent));

/**
 * Backspace / Delete at a region boundary (ADR 016 §6 question 1, decided in lot 2): the text is NEVER merged through the
 * marker. A quick press does nothing; HOLDING the key on the seam (ADR 017 `hold`, 700 ms) removes the marker.
 */
test.describe('Backspace / Delete at a region boundary (protected, merge = hold)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await build(page, ['p:above', 'r:section-1:Part', 'p:below']);
  });

  test('a quick Backspace at the start of the block after a marker does nothing (no text merged through it)', async ({ page }) => {
    await focusAt(page, 'below', 0);
    await press(page, 'Backspace');
    await flushRender(page);
    await expectRoots(page, 'p(above) ; R:section-1(Part) ; p(below)');
    expect(await pending(page)).toBeNull();
    await expect(page.locator('[data-region-hint]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).nabu.undoManager.canUndo())).toBe(false);
    await expectValid(page);
  });

  test('holding Backspace shows the hint above the label, the hairline drains, ~800 ms merges: the seam is gone and labels renumber', async ({ page }) => {
    await build(page, ['p:pre', 'r:section-1:One', 'p:a', 'r:section-1:Two', 'p:below']);
    await focusAt(page, 'below', 0);
    const seam = seams(page).nth(1);
    const before = await seam.boundingBox();
    await page.keyboard.down('Backspace');
    await expect.poll(() => pending(page)).toMatchObject({ id: 'region:merge-previous', strategy: 'hold' });
    // the hint: DOM text on the seam being merged, the warning tint, the aria-live prompt
    await expect(seam).toHaveAttribute('data-region-pending', 'hold');
    const hint = seam.locator('[data-region-hint]');
    await expect(hint).toHaveText('Hold Backspace to merge with “One”');
    await expect(live(page)).toContainText('Hold Backspace to merge with “One”');
    // no layout shift: the seam does not move while the hint shows
    const during = await seam.boundingBox();
    expect(during).toEqual(before);
    const hintBox = await hint.boundingBox();
    expect(hintBox!.y + hintBox!.height).toBeLessThanOrEqual(during!.y + 1); // above the label, in the margin
    const color = await hint.evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe('rgb(180, 83, 9)');
    // no bubble, no background, no border: the engine's default target outline / fill is switched off on a seam
    const box = await seam.evaluate((el) => { const c = getComputedStyle(el); return [c.outlineStyle, c.backgroundImage, c.backgroundColor]; });
    expect(box).toEqual(['none', 'none', 'rgba(0, 0, 0, 0)']);
    const hintBox2 = await hint.evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.borderTopStyle]; });
    expect(hintBox2).toEqual(['rgba(0, 0, 0, 0)', 'none']);
    // the hairline drains with the progress
    await page.waitForTimeout(300);
    const scale = await seam.locator('.nabu-region-drain').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    expect(scale).toBeGreaterThan(0.1);
    expect(scale).toBeLessThan(0.9);
    // nothing merged yet
    await expectRoots(page, 'p(pre) ; R:section-1(One) ; p(a) ; R:section-1(Two) ; p(below)');
    await page.waitForTimeout(700);
    await expectRoots(page, 'p(pre) ; R:section-1(One) ; p(a) ; p(below)');
    await expect(seams(page)).toHaveCount(1);
    await expect(seams(page).first()).toHaveText('1. One');
    expect(await pending(page)).toBeNull();
    await expect(page.locator('[data-region-hint]')).toHaveCount(0);
    await page.keyboard.up('Backspace');
    await expectCaret(page, '|below');
    await expectValid(page);
  });

  test('releasing early cancels: the seam is intact and the hairline is restored', async ({ page }) => {
    await focusAt(page, 'below', 0);
    await page.keyboard.down('Backspace');
    await expect.poll(() => pending(page)).not.toBeNull();
    await expect(page.locator('[data-region-hint]')).toHaveCount(1);
    await page.waitForTimeout(250);
    await page.keyboard.up('Backspace');
    expect(await pending(page)).toBeNull();
    await expect(page.locator('[data-region-hint]')).toHaveCount(0);
    await expect(page.locator('.nabu-region-drain')).toHaveCount(0);
    await expect(seams(page).first()).not.toHaveAttribute('data-region-pending', /.*/);
    await page.waitForTimeout(800);
    await expectRoots(page, 'p(above) ; R:section-1(Part) ; p(below)');
    await expect(live(page)).toContainText('Cancelled');
    await expectValid(page);
  });

  test('Ctrl+Z after a held merge restores the marker and the caret (one undo step)', async ({ page }) => {
    await focusAt(page, 'below', 0);
    await page.keyboard.down('Backspace');
    await expect.poll(() => roots(page), { timeout: 4000 }).toBe('p(above) ; p(below)');
    await page.keyboard.up('Backspace');
    await undo(page);
    await expectRoots(page, 'p(above) ; R:section-1(Part) ; p(below)');
    await expectCaret(page, '|below');
    await expect(seams(page).first()).toHaveText('1. Part');
    await expectValid(page);
  });

  test('a held Backspace erasing a word stops at the boundary: no merge, the key must be released', async ({ page }) => {
    await build(page, ['p:above', 'r:section-1:Part', 'p:word']);
    await focusEnd(page, 'word');
    await page.keyboard.down('Backspace'); // the fresh press erases one letter...
    for (let i = 0; i < 9; i++) await page.keyboard.down('Backspace'); // ...the auto-repeats erase the rest and stop at the seam
    await page.waitForTimeout(900);
    await expectRoots(page, 'p(above) ; R:section-1(Part) ; p()');
    expect(await pending(page)).toBeNull();
    await page.keyboard.up('Backspace');
    // a NEW press at the boundary now asks for the hold
    await page.keyboard.down('Backspace');
    await expect.poll(() => pending(page)).toMatchObject({ id: 'region:merge-previous' });
    await page.keyboard.up('Backspace');
    await expectRoots(page, 'p(above) ; R:section-1(Part) ; p()');
    await expectValid(page);
  });

  test('the first region of the document (no preamble): Backspace at its start does nothing, no hold', async ({ page }) => {
    await build(page, ['r:section-1:Part', 'p:text']);
    await focusAt(page, 'text', 0);
    await page.keyboard.down('Backspace');
    await page.waitForTimeout(900);
    await page.keyboard.up('Backspace');
    await expectRoots(page, 'R:section-1(Part) ; p(text)');
    expect(await pending(page)).toBeNull();
    await expectValid(page);
  });

  test('Backspace in an EMPTY block right after a marker is protected the same way (hold to merge)', async ({ page }) => {
    await build(page, ['p:above', 'r:section-1:Part', 'p:']);
    await focusEmpty(page);
    await press(page, 'Backspace');
    await flushRender(page);
    await expectRoots(page, 'p(above) ; R:section-1(Part) ; p()');
    await page.keyboard.down('Backspace');
    await expect.poll(() => roots(page), { timeout: 4000 }).toBe('p(above) ; p()');
    await page.keyboard.up('Backspace');
    await expectValid(page);
  });

  test('a quick Delete at the end of the block before a marker does nothing; holding it removes the NEXT marker', async ({ page }) => {
    await focusEnd(page, 'above');
    await press(page, 'Delete');
    await flushRender(page);
    await expectRoots(page, 'p(above) ; R:section-1(Part) ; p(below)');
    await page.keyboard.down('Delete');
    await expect.poll(() => pending(page)).toMatchObject({ id: 'region:merge-next', strategy: 'hold' });
    await expect(seams(page).first()).toHaveAttribute('data-region-pending', 'hold');
    await expect(seams(page).first().locator('[data-region-hint]')).toHaveText('Hold Delete to merge “Part” into this region');
    await expect(live(page)).toContainText('Hold Delete to merge “Part” into this region');
    await expect.poll(() => roots(page), { timeout: 4000 }).toBe('p(above) ; p(below)');
    await page.keyboard.up('Delete');
    await expectCaret(page, 'above|');
    await undo(page);
    await expectRoots(page, 'p(above) ; R:section-1(Part) ; p(below)');
    await expectCaret(page, 'above|');
    await expectValid(page);
  });

  test('a held Delete erasing forward stops at the boundary (no merge)', async ({ page }) => {
    await build(page, ['p:word', 'r:section-1:Part', 'p:below']);
    await focusAt(page, 'word', 0);
    await page.keyboard.down('Delete');
    for (let i = 0; i < 9; i++) await page.keyboard.down('Delete');
    await page.waitForTimeout(900);
    await expectRoots(page, 'p() ; R:section-1(Part) ; p(below)');
    expect(await pending(page)).toBeNull();
    await page.keyboard.up('Delete');
    await expectValid(page);
  });

  test('a selection spanning a marker deletes the text and the marker, as one undo step', async ({ page }) => {
    await build(page, ['p:aaXX', 'r:section-1:Part', 'p:YYbb']);
    await selectRange(page, 'aaXX', 2, 'YYbb', 2);
    await press(page, 'Backspace');
    await flushRender(page);
    await expectRoots(page, 'p(aabb)');
    await undo(page);
    await expectRoots(page, 'p(aaXX) ; R:section-1(Part) ; p(YYbb)');
    await expectValid(page);
  });
});

test.describe('region:split (Mod-Enter)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
  });

  test('cuts at the caret: the tail starts a new region of the same type, typing continues in it; Ctrl+Z puts everything back', async ({ page }) => {
    await build(page, ['p:pre', 'r:section-2:Two', 'p:abcdef']);
    await focusAt(page, 'abcdef', 3);
    await press(page, `${MOD}+Enter`);
    await expectRoots(page, 'p(pre) ; R:section-2(Two) ; p(abc) ; R:section-2() ; p(def)');
    await expectCaret(page, '|def');
    await page.keyboard.type('X');
    await expectRoots(page, 'p(pre) ; R:section-2(Two) ; p(abc) ; R:section-2() ; p(Xdef)');
    await undo(page); // the typing
    await undo(page); // the split: ONE step
    await expectRoots(page, 'p(pre) ; R:section-2(Two) ; p(abcdef)');
    await expectCaret(page, 'abc|def');
    await expectValid(page);
  });

  test('in the preamble it opens a top-level region', async ({ page }) => {
    await build(page, ['p:hello world']);
    await focusAt(page, 'hello world', 5);
    await press(page, `${MOD}+Enter`);
    await expectRoots(page, 'p(hello) ; R:section-1() ; p( world)');
    await expectValid(page);
  });

  test('coexists with todo:toggle: in a to-do item Mod-Enter checks it and adds no marker', async ({ page }) => {
    await build(page, ['p:text', 'r:section-1:Part', 'p:para']);
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const l = n.insert('list', { listType: 'todo' }, null, 3);
      n.insert('list-item', { text: 'task', checked: false }, l.id, 0);
      await n.commit();
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-block-id]').length >= 5);
    await focusEnd(page, 'task');
    await press(page, `${MOD}+Enter`);
    await flushRender(page);
    expect(await page.evaluate(() => { const n = (window as any).nabu; return n.tree.roots().at(-1).children()[0].data.get('checked'); })).toBe(true);
    await expect(seams(page)).toHaveCount(1);
    await focusAt(page, 'para', 2);
    await press(page, `${MOD}+Enter`);
    await expect(seams(page)).toHaveCount(2);
    await expectValid(page);
  });
});

test.describe('structural commands through exec (seeded document)', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, { seed: 'regions' }); });

  test('region:move down: the region and its content swap with its next sibling, labels renumber, Ctrl+Z restores the caret', async ({ page }) => {
    await focusAt(page, 'Text of the bank.', 4);
    await exec(page, 'region:move', { direction: 'down' });
    await expect.poll(() => seamTexts(page)).toEqual(['1. The ferryman', '1.1 The water', '1.2 The bank', '2. The return']);
    await expectRoots(page, 'p(Preamble, outside any region.) ; R:section-1(The ferryman) ; p(Opening of the first section.) ; R:section-2(The water) ; p(Text of the water.) ; R:section-2(The bank) ; p(Text of the bank.) ; R:section-1(The return) ; p(Closing text.)');
    await expectCaret(page, 'Text| of the bank.');
    await undo(page);
    await expect.poll(() => seamTexts(page)).toEqual(['1. The ferryman', '1.1 The bank', '1.2 The water', '2. The return']);
    await expectCaret(page, 'Text| of the bank.');
    await expectValid(page);
  });

  test('region:move at the edge is a no-op (no undo step)', async ({ page }) => {
    await focusAt(page, 'Closing text.', 0);
    await exec(page, 'region:move', { direction: 'down' });
    await flushRender(page);
    expect(await page.evaluate(() => (window as any).nabu.undoManager.canUndo())).toBe(false);
  });

  test('region:promote / region:demote change the level of the region holding the caret', async ({ page }) => {
    await focusAt(page, 'Text of the water.', 0);
    await exec(page, 'region:promote');
    await expect.poll(() => seamTexts(page)).toEqual(['1. The ferryman', '1.1 The bank', '2. The water', '3. The return']);
    await exec(page, 'region:demote');
    await expect.poll(() => seamTexts(page)).toEqual(['1. The ferryman', '1.1 The bank', '1.2 The water', '2. The return']);
    await expectValid(page);
  });

  test('region:next / region:prev / region:parent move the caret to the first text position of the target region', async ({ page }) => {
    await focusAt(page, 'Opening of the first section.', 3);
    await exec(page, 'region:next');
    await expectCaret(page, '|Text of the bank.');
    await exec(page, 'region:parent');
    await expectCaret(page, '|Opening of the first section.');
    await exec(page, 'region:next', { region: await page.evaluate(() => (window as any).nabu.regions.list[2].marker.id) });
    await expectCaret(page, '|Closing text.');
  });

  test('region:insert adds a marker after the region\'s whole range, one undo step', async ({ page }) => {
    await focusAt(page, 'Text of the bank.', 0);
    await exec(page, 'region:insert', { type: 'section-2', at: 'before', title: 'New' });
    await expect.poll(() => seamTexts(page)).toEqual(['1. The ferryman', '1.1 New', '1.2 The bank', '1.3 The water', '2. The return']);
    await undo(page);
    await expect.poll(() => seamTexts(page)).toEqual(['1. The ferryman', '1.1 The bank', '1.2 The water', '2. The return']);
  });

  test('region:merge-previous through exec runs directly (no hold); the live region keeps the last outcome', async ({ page }) => {
    await focusAt(page, 'Text of the bank.', 2);
    await exec(page, 'region:merge-previous');
    await expect.poll(() => seamTexts(page)).toEqual(['1. The ferryman', '1.1 The water', '2. The return']);
    expect(await pending(page)).toBeNull();
    await expectValid(page);
  });
});

test.describe('root-only rule', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
  });

  test('a marker inserted into a toggle or a list ends up at the root, in the operation\'s undo step', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const t = n.insert('toggle', { text: 'T' }, null, 1);
      n.insert('paragraph', { text: 'body' }, t.id, 0);
      await n.commit();
      n.undoManager.clear();
      n.insert('region', { regionType: 'section-1', title: 'Hoisted' }, t.id, 1);
      await n.commit();
    });
    await expect.poll(() => roots(page)).toBe('p() ; toggle(T){…} ; R:section-1(Hoisted)');
    await expectValid(page);
    await page.evaluate(() => (window as any).nabu.undo());
    await expectRoots(page, 'p() ; toggle(T){…}');
    await expectValid(page);
  });

  test('a marker in a list item position is kept at the root by the normalizers (list split around it)', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const l = n.insert('list', { listType: 'bullet' }, null, 1);
      n.insert('list-item', { text: 'one' }, l.id, 0);
      n.insert('list-item', { text: 'two' }, l.id, 1);
      await n.commit();
      n.undoManager.clear();
      n.insert('region', { regionType: 'section-1', title: 'In list' }, l.id, 1);
      await n.commit();
    });
    await expect.poll(() => roots(page)).toBe('p() ; list(){…} ; R:section-1(In list) ; list(){…}');
    await expectValid(page);
  });
});
