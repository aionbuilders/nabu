/**
 * E2E — Regions (ADR 016, lot 1): the marker renders as an accessible seam with its computed label, the caret steps over
 * it like over a divider (one key press) and typing never lands in it, markers stay at the root, the registry follows the
 * document, and Backspace / Delete next to a marker leave a valid document (what they DO is recorded below: the
 * protect-vs-merge decision is lot 2).
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, clearAndReset, press, flushRender } from './helpers/editor.js';
import { undo } from './helpers/keyboard.js';
import { caret, violations, focusAt, focusEnd, collectErrors } from './helpers/model.js';

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

/**
 * Backspace / Delete next to a marker. CURRENT behaviour (lot 1, no region hook yet): the marker is a void block like the
 * divider but WITHOUT the divider's delete hooks, so the text merge goes through it. These tests pin that the document
 * stays valid and that nothing is lost or duplicated; whether a Backspace should instead PROTECT the marker (ADR 016,
 * open question 1) is decided in lot 2, which will change the expectations below.
 */
test.describe('Backspace / Delete next to a marker (current behaviour, decided in lot 2)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await build(page, ['p:above', 'r:section-1:Part', 'p:below']);
  });

  test('Backspace at the start of the block after a marker merges the texts through it and leaves a valid document, one undo step', async ({ page }) => {
    await focusAt(page, 'below', 0);
    await press(page, 'Backspace');
    await flushRender(page);
    // The text merge goes THROUGH the marker: both texts are kept, merged before it (the marker is left behind them).
    await expectRoots(page, 'p(abovebelow) ; R:section-1(Part)');
    await expectValid(page);
    await undo(page);
    await expectRoots(page, 'p(above) ; R:section-1(Part) ; p(below)');
    await expectValid(page);
  });

  test('Delete at the end of the block before a marker merges the texts through it and leaves a valid document, one undo step', async ({ page }) => {
    await focusEnd(page, 'above');
    await press(page, 'Delete');
    await flushRender(page);
    await expectRoots(page, 'p(abovebelow) ; R:section-1(Part)'); // same outcome as Backspace from the other side
    await expectValid(page);
    await undo(page);
    await expectRoots(page, 'p(above) ; R:section-1(Part) ; p(below)');
    await expectValid(page);
  });

  test('Backspace in an empty block right after a marker changes nothing', async ({ page }) => {
    await build(page, ['r:section-1:Part', 'p:']);
    await focusAt(page, '', 0);
    await press(page, 'Backspace');
    await flushRender(page);
    await expectRoots(page, 'R:section-1(Part) ; p()'); // nothing to merge into: untouched
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
