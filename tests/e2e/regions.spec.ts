/**
 * E2E — Regions as CONTAINERS (ADR 018, lots A1 + A2), driven by real keys in Chromium.
 *
 * A region is a container block: its HEADER is an editable TITLE (rendered in a seam: label prefix + title + hairline), its BODY is
 * its children, sub-regions included. The title behaves as a locked field (Enter goes to the body, Backspace / Delete never merge
 * out of it). The structural commands (ADR 018 §3.5, §3.9):
 *   Mod-Enter           region:split           the tail of the body moves into a new sibling region
 *   hold Backspace      region:merge-previous  at the start of a region (title start OR first text of the body), 700 ms
 *   hold Delete         region:merge-next      at the end of a region
 *   Mod-Shift-Enter     region:exit            a paragraph right after the region, one level up (repeat to climb)
 *   Tab / Shift-Tab     region:demote/promote  ONLY in a title
 * Outline notation of the helpers (tests/e2e/helpers/model.ts): `R:section-1(The ferryman){ p(...) ; R:section-2(The bank){ p(...) } }`.
 * Out of scope here (lot B, `test.fixme` below): arrow keys crossing a title, selections spanning titles, Ctrl+A.
 * Clipboard paths: regions-clipboard.spec.ts. Drag of a seam / long titles: ui-components.spec.ts (3c, 16).
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import { gotoEditor, clearAndReset, press, flushRender } from './helpers/editor.js';
import { undo } from './helpers/keyboard.js';
import { buildTree, Pp, type TreeSpec } from './helpers/blocks.js';
import { outline, caret, violations, focusAt, focusEnd, focusEmpty, collectErrors } from './helpers/model.js';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// ── Fixtures ───────────────────────────────────────────────────────────────

/** `S1('One', Pp('a'), S2('Sub', Pp('b')))` -> a region spec (type `section-1`, title, body). */
const region = (regionType: string) => (title: string, ...children: TreeSpec[]): TreeSpec => ({ type: 'region', props: { regionType, title }, children });
const S1 = region('section-1');
const S2 = region('section-2');
const S3 = region('section-3');
/** A bullet list of plain items. */
const UL = (...items: string[]): TreeSpec => ({ type: 'list', props: { listType: 'bullet' }, children: items.map((text) => ({ type: 'list-item', text })) });

/** The seeded document (`?seed=regions`) in the outline notation. */
const SEED = 'p(Preamble, outside any region.) ; R:section-1(The ferryman){ p(Opening of the first section.) ; R:section-2(The bank){ p(Text of the bank.) } ; R:section-2(The water){ p(Text of the water.) } } ; R:section-1(The return){ p(Closing text.) }';

// ── Helpers ────────────────────────────────────────────────────────────────

const expectOutline = (page: Page, expected: string) => expect.poll(() => outline(page), { timeout: 3000, message: 'outline' }).toBe(expected);
const expectCaret = (page: Page, expected: string) => expect.poll(() => caret(page), { timeout: 3000, message: 'caret' }).toBe(expected);
async function expectValid(page: Page) { expect(await violations(page)).toEqual([]); }
const canUndo = (page: Page) => page.evaluate(() => (window as any).nabu.undoManager.canUndo());
const exec = (page: Page, topic: string, data?: any) => page.evaluate(([t, d]) => (window as any).nabu.exec(t, d), [topic, data] as [string, any]);
const pending = (page: Page) => page.evaluate(() => {
  const p = (window as any).nabu.pendingCommand;
  return p ? { id: p.id, strategy: p.strategy, progress: p.progress, message: p.message } : null;
});
const labels = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).nabu.regions.list.map((r: any) => r.label));

/** The n-th `.nabu-region` in document order (pre-order: a parent comes before its sub-regions). */
const regionEl = (page: Page, n: number) => page.locator('.nabu-region').nth(n);
const seamOf = (r: Locator) => r.locator('> .nabu-region-seam');
const titles = (page: Page) => page.locator('.nabu-region-title');
const prefixes = (page: Page) => page.locator('.nabu-region-label').evaluateAll((els) => els.map((e) => e.textContent));
const live = (page: Page) => page.locator('[data-nabu-live]');

/** Replace the document with nested blocks (undo history cleared). */
const build = (page: Page, specs: TreeSpec[]) => buildTree(page, specs);

/** Press a key down, wait for the pending hold of `id`, and hand the control back (the caller releases the key). */
async function startHold(page: Page, key: string, id: string) {
  await page.keyboard.down(key);
  await expect.poll(() => pending(page)).toMatchObject({ id, strategy: 'hold' });
}

let errors: ReturnType<typeof collectErrors>;
test.beforeEach(async ({ page }) => { errors = collectErrors(page); });
test.afterEach(async () => { expect(errors.list(), 'console / page errors').toEqual([]); });

// ════════════════════════════════════════════════════════════════════════════
// Rendering and registry
// ════════════════════════════════════════════════════════════════════════════

test.describe('seeded document', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, { seed: 'regions' }); });

  test('the seed is nested: sections hold their sub-sections in their body', async ({ page }) => {
    await expectOutline(page, SEED);
    // the DOM nests like the model: a sub-region is inside the BODY of its parent region, the title is in the seam
    await expect(page.locator('.nabu-region')).toHaveCount(4);
    await expect(page.locator('.nabu-region > .nabu-region-body > .nabu-region')).toHaveCount(2);
    await expect(page.locator('.nabu-region > .nabu-region-seam > .nabu-region-title')).toHaveCount(4);
    await expect(regionEl(page, 0).locator('> .nabu-region-body > .nabu-region')).toHaveCount(2);
    await expect(regionEl(page, 0).locator('> .nabu-region-body > [data-block-type="paragraph"]')).toHaveText('Opening of the first section.');
    await expectValid(page);
  });

  test('seams render the label prefix and the editable title, as headings of their level', async ({ page }) => {
    expect(await prefixes(page)).toEqual(['1.', '1.1', '1.2', '2.']);
    await expect(titles(page)).toHaveText(['The ferryman', 'The bank', 'The water', 'The return']);
    const info = await page.locator('.nabu-region').evaluateAll((els) => els.map((e) => {
      const seam = e.querySelector(':scope > .nabu-region-seam')!;
      return [e.getAttribute('data-region-type'), e.getAttribute('data-region-level'), seam.getAttribute('role'), seam.getAttribute('aria-level')];
    }));
    expect(info).toEqual([['section-1', '1', 'heading', '1'], ['section-2', '2', 'heading', '2'], ['section-2', '2', 'heading', '2'], ['section-1', '1', 'heading', '1']]);
    // accessible tree: headings by level
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(2);
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(2);
    await expect(page.getByRole('heading', { level: 2, name: /The bank/ })).toBeVisible();
    // the label is decoration, not editable; the title IS the block (data-block-id) and is editable
    await expect(page.locator('.nabu-region-label').first()).toHaveAttribute('contenteditable', 'false');
    const title = titles(page).first();
    await expect(title).toHaveAttribute('data-block-type', 'region');
    await expect(title).toHaveAttribute('data-block-id', /.+/);
    expect(await title.evaluate((el) => (el as HTMLElement).isContentEditable)).toBe(true);
    await expectValid(page);
  });

  test('the registry matches the document (extent, tree, preamble, word counts)', async ({ page }) => {
    const info = await page.evaluate(() => {
      const r = (window as any).nabu.regions;
      return {
        labels: r.list.map((x: any) => x.label),
        paths: r.list.map((x: any) => x.pathString),
        parents: r.list.map((x: any) => x.parent?.title ?? null),
        tree: r.tree.map((x: any) => [x.label, x.children.map((c: any) => c.label)]),
        preamble: r.preamble.blocks.length,
        words: r.list.map((x: any) => [x.wordCount, x.ownWordCount]),
      };
    });
    expect(info.labels).toEqual(['1. The ferryman', '1.1 The bank', '1.2 The water', '2. The return']);
    expect(info.paths).toEqual(['1', '1.1', '1.2', '2']);
    expect(info.parents).toEqual([null, 'The ferryman', 'The ferryman', null]);
    expect(info.tree).toEqual([['1. The ferryman', ['1.1 The bank', '1.2 The water']], ['2. The return', []]]);
    expect(info.preamble).toBe(1);
    // the body (the region's own title is not counted, the titles of its sub-regions are part of its body): "Opening of the first section." = 5,
    // + "The bank" 2 + "Text of the bank." 4 + "The water" 2 + "Text of the water." 4 = 17; "Closing text." = 2
    expect(info.words).toEqual([[17, 5], [4, 4], [4, 4], [2, 2]]);
  });

  test('setting the title programmatically updates the seam and the label', async ({ page }) => {
    await page.evaluate(() => { (window as any).nabu.regions.list[1].setField('title', 'The shore'); });
    await expect(titles(page).nth(1)).toHaveText('The shore');
    expect(await labels(page)).toEqual(['1. The ferryman', '1.1 The shore', '1.2 The water', '2. The return']);
    await expectOutline(page, SEED.replace('The bank', 'The shore'));
  });

  test('inserting a region in the middle of a body renumbers the following ones', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const ferryman = n.regions.list[0].block;
      n.insert('region', { regionType: 'section-2', title: 'Inserted' }, ferryman.id, 2); // between "The bank" and "The water"
      await n.commit();
    });
    await expect(titles(page)).toHaveText(['The ferryman', 'The bank', 'Inserted', 'The water', 'The return']);
    expect(await prefixes(page)).toEqual(['1.', '1.1', '1.2', '1.3', '2.']);
    await expectValid(page);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The title: an editable, locked field
// ════════════════════════════════════════════════════════════════════════════

test.describe('typing in a title', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, { seed: 'regions' }); });

  test('typing in a title edits it in place; the label, the registry and the model follow live', async ({ page }) => {
    await focusEnd(page, 'The bank');
    await page.keyboard.type(' side');
    await expect(titles(page).nth(1)).toHaveText('The bank side');
    await expect(page.locator('.nabu-region-label').nth(1)).toHaveText('1.1');
    expect(await labels(page)).toEqual(['1. The ferryman', '1.1 The bank side', '1.2 The water', '2. The return']);
    await expectOutline(page, SEED.replace('The bank', 'The bank side'));
    await expectCaret(page, 'The bank side|');
    await expectValid(page);
  });

  test('a title empties into its placeholder; typing brings it back, and inline marks work in a title', async ({ page }) => {
    await focusEnd(page, 'The bank');
    for (let i = 0; i < 'The bank'.length; i++) await press(page, 'Backspace');
    await expect(titles(page).nth(1)).toHaveClass(/empty/);
    await expect(titles(page).nth(1)).toHaveAttribute('data-placeholder', 'Untitled');
    await expectOutline(page, SEED.replace('R:section-2(The bank)', 'R:section-2(∅)'));
    await page.keyboard.type('New');
    await press(page, 'Shift+Home');
    await press(page, `${MOD}+b`);
    await expect(titles(page).nth(1)).toHaveText('New');
    await expect(titles(page).nth(1).locator('.nabu-bold')).toHaveText('New');
    await expectValid(page);
  });

  test('a title edit is undoable like any text; the structure is untouched', async ({ page }) => {
    await focusEnd(page, 'The water');
    await page.keyboard.type('s');
    await expectOutline(page, SEED.replace('The water', 'The waters'));
    await undo(page);
    await expectOutline(page, SEED);
    await expectValid(page);
  });
});

test.describe('Enter in a title', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, { seed: 'regions' }); });

  test('goes to a NEW empty paragraph at the top of the body; the title is never split; one undo step', async ({ page }) => {
    await focusAt(page, 'The ferryman', 3);
    await press(page, 'Enter');
    await expectOutline(page, SEED.replace('{ p(Opening of the first section.)', '{ p(∅) ; p(Opening of the first section.)'));
    await expect(titles(page).first()).toHaveText('The ferryman');
    await expectCaret(page, '|');
    await page.keyboard.type('Intro');
    await expectOutline(page, SEED.replace('{ p(Opening of the first section.)', '{ p(Intro) ; p(Opening of the first section.)'));
    await undo(page); // the typing
    await undo(page); // the new paragraph: ONE step
    await expectOutline(page, SEED);
    await expectValid(page);
  });

  test('goes into the first body paragraph when it is an empty paragraph already (no new block)', async ({ page }) => {
    await build(page, [S1('One', Pp(''), Pp('b'))]);
    await focusEnd(page, 'One');
    await press(page, 'Enter');
    await expectCaret(page, '|');
    await page.keyboard.type('x');
    await expectOutline(page, 'R:section-1(One){ p(x) ; p(b) }');
    await expectValid(page);
  });

  test('in an empty region it creates the first paragraph of the body; the title text stays whole', async ({ page }) => {
    await build(page, [S1('Empty')]);
    await focusAt(page, 'Empty', 2);
    await press(page, 'Enter');
    await expectOutline(page, 'R:section-1(Empty){ p(∅) }');
    await page.keyboard.type('Z');
    await expectOutline(page, 'R:section-1(Empty){ p(Z) }');
    await expectValid(page);
  });
});

test.describe('Backspace / Delete in a title never merge', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, { seed: 'regions' }); });

  test('a quick Backspace at the start of a title does nothing: nothing merges into the title', async ({ page }) => {
    await focusAt(page, 'The bank', 0);
    await press(page, 'Backspace');
    await flushRender(page);
    await expectOutline(page, SEED);
    await expectCaret(page, '|The bank');
    expect(await pending(page)).toBeNull();
    expect(await canUndo(page)).toBe(false);
  });

  test('a quick Backspace at the start of the title that follows a paragraph does not merge the title into it', async ({ page }) => {
    await focusAt(page, 'The ferryman', 0);
    await press(page, 'Backspace');
    await flushRender(page);
    await expectOutline(page, SEED);
    expect(await canUndo(page)).toBe(false);
  });

  test('a quick Delete at the end of a title does nothing: the first paragraph of the body is not absorbed', async ({ page }) => {
    await focusEnd(page, 'The ferryman');
    await press(page, 'Delete');
    await flushRender(page);
    await expectOutline(page, SEED);
    await expectCaret(page, 'The ferryman|');
    expect(await canUndo(page)).toBe(false);
  });

  test('inside a title Backspace and Delete erase characters as usual', async ({ page }) => {
    await focusAt(page, 'The bank', 4);
    await press(page, 'Backspace');
    await expectOutline(page, SEED.replace('The bank', 'Thebank'));
    await press(page, 'Delete');
    await expectOutline(page, SEED.replace('The bank', 'Theank'));
    expect(await pending(page)).toBeNull();
    await expectValid(page);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The protected merge: HOLD Backspace / Delete
// ════════════════════════════════════════════════════════════════════════════

test.describe('hold Backspace at the start of a region (region:merge-previous)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await build(page, [Pp('pre'), S1('One', Pp('a')), S1('Two', Pp('b'))]);
  });

  test('a quick Backspace at the start of the first paragraph of a body does nothing (no text merged through the seam)', async ({ page }) => {
    await focusAt(page, 'b', 0);
    await press(page, 'Backspace');
    await flushRender(page);
    await expectOutline(page, 'p(pre) ; R:section-1(One){ p(a) } ; R:section-1(Two){ p(b) }');
    expect(await pending(page)).toBeNull();
    await expect(page.locator('[data-region-hint]')).toHaveCount(0);
    expect(await canUndo(page)).toBe(false);
    await expectValid(page);
  });

  test('held: the hint shows above the seam (no layout shift), the hairline drains, ~700 ms merges the region into the previous one; undo restores structure and caret', async ({ page }) => {
    await focusAt(page, 'b', 0);
    const two = regionEl(page, 1);
    const seam = seamOf(two);
    const before = { seam: await seam.boundingBox(), region: await two.boundingBox(), body: await two.locator('> .nabu-region-body').boundingBox() };
    await page.keyboard.down('Backspace');
    await expect.poll(() => pending(page)).toMatchObject({ id: 'region:merge-previous', strategy: 'hold' });
    // the hint: DOM text on the seam of the region being merged, the warning tint, the aria-live prompt
    await expect(two).toHaveAttribute('data-region-pending', 'hold');
    const hint = seam.locator('[data-region-hint]');
    await expect(hint).toHaveText('Hold Backspace to merge with “One”');
    await expect(live(page)).toContainText('Hold Backspace to merge with “One”');
    // no layout shift: neither the seam, nor the region, nor its body move while the hint shows
    expect(await seam.boundingBox()).toEqual(before.seam);
    expect(await two.boundingBox()).toEqual(before.region);
    expect(await two.locator('> .nabu-region-body').boundingBox()).toEqual(before.body);
    // the hint sits ABOVE the seam, in its top margin
    const hintBox = await hint.boundingBox();
    expect(hintBox!.y + hintBox!.height).toBeLessThanOrEqual(before.seam!.y + 1);
    expect(await hint.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(180, 83, 9)');
    // no bubble, no background, no border: the engine's default target outline / fill is switched off on the title
    const titleBox = await titles(page).nth(1).evaluate((el) => { const c = getComputedStyle(el); return [c.outlineStyle, c.backgroundImage, c.backgroundColor]; });
    expect(titleBox).toEqual(['none', 'none', 'rgba(0, 0, 0, 0)']);
    expect(await hint.evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.borderTopStyle]; })).toEqual(['rgba(0, 0, 0, 0)', 'none']);
    // the hairline drains with the progress
    await page.waitForTimeout(300);
    const scale = await seam.locator('.nabu-region-drain').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    expect(scale).toBeGreaterThan(0.1);
    expect(scale).toBeLessThan(0.9);
    // nothing merged yet
    expect(await outline(page)).toBe('p(pre) ; R:section-1(One){ p(a) } ; R:section-1(Two){ p(b) }');
    await expectOutline(page, 'p(pre) ; R:section-1(One){ p(a) ; p(b) }'); // ... then, past 700 ms, merged
    await expect(page.locator('.nabu-region')).toHaveCount(1);
    await expect(titles(page)).toHaveText(['One']);
    expect(await pending(page)).toBeNull();
    await expect(page.locator('[data-region-hint]')).toHaveCount(0);
    await page.keyboard.up('Backspace');
    await expectCaret(page, '|b');
    await expectValid(page);
    // one undo step: the region (title included) is back, the caret too
    await undo(page);
    await expectOutline(page, 'p(pre) ; R:section-1(One){ p(a) } ; R:section-1(Two){ p(b) }');
    await expectCaret(page, '|b');
    await expect(titles(page)).toHaveText(['One', 'Two']);
    await expectValid(page);
  });

  test('held from the START OF THE TITLE it is the same single logical position: the body joins the previous region', async ({ page }) => {
    await build(page, [S1('One', Pp('a')), S1('Two', Pp('b'), Pp('c'))]);
    await focusAt(page, 'Two', 0);
    await startHold(page, 'Backspace', 'region:merge-previous');
    await expect(live(page)).toContainText('Hold Backspace to merge with “One”');
    await expectOutline(page, 'R:section-1(One){ p(a) ; p(b) ; p(c) }');
    await page.keyboard.up('Backspace');
    await expectCaret(page, '|b'); // the title went away: the caret lands at the start of the body
    await undo(page);
    await expectOutline(page, 'R:section-1(One){ p(a) } ; R:section-1(Two){ p(b) ; p(c) }');
    await expectValid(page);
  });

  test('releasing early cancels: the region is intact and the hairline is restored', async ({ page }) => {
    await focusAt(page, 'b', 0);
    await page.keyboard.down('Backspace');
    await expect.poll(() => pending(page)).not.toBeNull();
    await expect(page.locator('[data-region-hint]')).toHaveCount(1);
    await page.waitForTimeout(250);
    await page.keyboard.up('Backspace');
    expect(await pending(page)).toBeNull();
    await expect(page.locator('[data-region-hint]')).toHaveCount(0);
    await expect(page.locator('.nabu-region-drain')).toHaveCount(0);
    await expect(regionEl(page, 1)).not.toHaveAttribute('data-region-pending', /.*/);
    await page.waitForTimeout(800);
    await expectOutline(page, 'p(pre) ; R:section-1(One){ p(a) } ; R:section-1(Two){ p(b) }');
    await expect(live(page)).toContainText('Cancelled');
    expect(await canUndo(page)).toBe(false);
    await expectValid(page);
  });

  test('a region with no previous region of its level is DISSOLVED in place: its body stays, its title goes away', async ({ page }) => {
    await focusAt(page, 'a', 0);
    await startHold(page, 'Backspace', 'region:merge-previous');
    await expect(seamOf(regionEl(page, 0)).locator('[data-region-hint]')).toHaveText('Hold Backspace to dissolve “One”');
    await expectOutline(page, 'p(pre) ; p(a) ; R:section-1(Two){ p(b) }');
    await page.keyboard.up('Backspace');
    await expectCaret(page, '|a');
    await undo(page);
    await expectOutline(page, 'p(pre) ; R:section-1(One){ p(a) } ; R:section-1(Two){ p(b) }');
    await expectCaret(page, '|a');
    await expectValid(page);
  });

  test('sub-regions: merges into the previous SAME-LEVEL sibling; a sub-region that follows no region dissolves into its parent', async ({ page }) => {
    await build(page, [S1('A', Pp('a'), S2('B', Pp('b')), S2('C', Pp('c1'), Pp('c2')))]);
    await focusAt(page, 'c1', 0);
    await startHold(page, 'Backspace', 'region:merge-previous');
    await expectOutline(page, 'R:section-1(A){ p(a) ; R:section-2(B){ p(b) ; p(c1) ; p(c2) } }');
    await page.keyboard.up('Backspace');
    expect(await labels(page)).toEqual(['1. A', '1.1 B']);
    // B now follows a paragraph (not a region): holding at its body dissolves it into A
    await focusAt(page, 'b', 0);
    await startHold(page, 'Backspace', 'region:merge-previous');
    await expectOutline(page, 'R:section-1(A){ p(a) ; p(b) ; p(c1) ; p(c2) }');
    await page.keyboard.up('Backspace');
    await expectValid(page);
  });

  test('the first region of the document (no preamble, no parent): Backspace at its start does nothing, no hold', async ({ page }) => {
    await build(page, [S1('Only', Pp('text'))]);
    await focusAt(page, 'text', 0);
    await page.keyboard.down('Backspace');
    await page.waitForTimeout(900);
    await page.keyboard.up('Backspace');
    await expectOutline(page, 'R:section-1(Only){ p(text) }');
    expect(await pending(page)).toBeNull();
    expect(await canUndo(page)).toBe(false);
    await expectValid(page);
  });

  test('a held Backspace erasing a word stops at the start of the region: no merge until the key is released and pressed again', async ({ page }) => {
    await build(page, [S1('One', Pp('a')), S1('Two', Pp('word'))]);
    await focusEnd(page, 'word');
    await page.keyboard.down('Backspace'); // the fresh press erases one letter...
    for (let i = 0; i < 9; i++) await page.keyboard.down('Backspace'); // ...the auto-repeats erase the rest and stop at the seam
    await page.waitForTimeout(900);
    await expectOutline(page, 'R:section-1(One){ p(a) } ; R:section-1(Two){ p(∅) }');
    expect(await pending(page)).toBeNull();
    await page.keyboard.up('Backspace');
    // a NEW press at the start of the region now asks for the hold
    await page.keyboard.down('Backspace');
    await expect.poll(() => pending(page)).toMatchObject({ id: 'region:merge-previous' });
    await page.keyboard.up('Backspace');
    await expectOutline(page, 'R:section-1(One){ p(a) } ; R:section-1(Two){ p(∅) }');
    await expectValid(page);
  });

  test('in an EMPTY first paragraph of a body Backspace is protected the same way (hold to merge)', async ({ page }) => {
    await build(page, [S1('One', Pp('a')), S1('Two', Pp(''), Pp('b'))]);
    await focusEmpty(page);
    await expectCaret(page, '|');
    await press(page, 'Backspace'); // quick
    await flushRender(page);
    await expectOutline(page, 'R:section-1(One){ p(a) } ; R:section-1(Two){ p(∅) ; p(b) }');
    await page.keyboard.down('Backspace');
    await expect.poll(() => outline(page), { timeout: 4000 }).toBe('R:section-1(One){ p(a) ; p(∅) ; p(b) }');
    await page.keyboard.up('Backspace');
    await expectValid(page);
  });

  test('a quick Backspace at the start of a NON-first paragraph of a body still merges the two paragraphs (the protection is for the region start only)', async ({ page }) => {
    await build(page, [S1('One', Pp('a'), Pp('b'))]);
    await focusAt(page, 'b', 0);
    await press(page, 'Backspace');
    await expectOutline(page, 'R:section-1(One){ p(ab) }');
    expect(await pending(page)).toBeNull();
    await expectValid(page);
  });
});

test.describe('hold Delete at the end of a region (region:merge-next)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await build(page, [S1('One', Pp('a')), S1('Two', Pp('b'))]);
  });

  test('a quick Delete at the end of the last paragraph of a region does nothing; holding it absorbs the NEXT region; undo restores', async ({ page }) => {
    await focusEnd(page, 'a');
    await press(page, 'Delete');
    await flushRender(page);
    await expectOutline(page, 'R:section-1(One){ p(a) } ; R:section-1(Two){ p(b) }');
    expect(await canUndo(page)).toBe(false);
    await startHold(page, 'Delete', 'region:merge-next');
    // the hint is on the seam of the region that goes away
    await expect(regionEl(page, 1)).toHaveAttribute('data-region-pending', 'hold');
    await expect(seamOf(regionEl(page, 1)).locator('[data-region-hint]')).toHaveText('Hold Delete to merge “Two” into this region');
    await expect(live(page)).toContainText('Hold Delete to merge “Two” into this region');
    await expectOutline(page, 'R:section-1(One){ p(a) ; p(b) }');
    await page.keyboard.up('Delete');
    await expectCaret(page, 'a|');
    await undo(page);
    await expectOutline(page, 'R:section-1(One){ p(a) } ; R:section-1(Two){ p(b) }');
    await expectCaret(page, 'a|');
    await expectValid(page);
  });

  test('a held Delete erasing forward stops at the end of the region (no merge)', async ({ page }) => {
    await build(page, [S1('One', Pp('word')), S1('Two', Pp('b'))]);
    await focusAt(page, 'word', 0);
    await page.keyboard.down('Delete');
    for (let i = 0; i < 9; i++) await page.keyboard.down('Delete');
    await page.waitForTimeout(900);
    await expectOutline(page, 'R:section-1(One){ p(∅) } ; R:section-1(Two){ p(b) }');
    expect(await pending(page)).toBeNull();
    await page.keyboard.up('Delete');
    await expectValid(page);
  });

  test('at the end of the last paragraph of a sub-region the NEXT region is the sibling of the parent; releasing early changes nothing', async ({ page }) => {
    await build(page, [S1('A', S2('B', Pp('b'))), S1('C', Pp('c'))]);
    await focusEnd(page, 'b');
    await startHold(page, 'Delete', 'region:merge-next');
    await page.waitForTimeout(250);
    await page.keyboard.up('Delete');
    await page.waitForTimeout(800);
    await expectOutline(page, 'R:section-1(A){ R:section-2(B){ p(b) } } ; R:section-1(C){ p(c) }');
    await expectValid(page);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// region:split (Mod-Enter)
// ════════════════════════════════════════════════════════════════════════════

test.describe('region:split (Mod-Enter)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
  });

  test('mid-text: the tail and the rest of the body move into a NEW sibling region of the same type; typing continues in it; undo puts everything back', async ({ page }) => {
    await build(page, [Pp('pre'), S2('Two', Pp('abcdef'), Pp('more'))]);
    await focusAt(page, 'abcdef', 3);
    await press(page, `${MOD}+Enter`);
    await expectOutline(page, 'p(pre) ; R:section-2(Two){ p(abc) } ; R:section-2(∅){ p(def) ; p(more) }');
    await expectCaret(page, '|def');
    await page.keyboard.type('X');
    await expectOutline(page, 'p(pre) ; R:section-2(Two){ p(abc) } ; R:section-2(∅){ p(Xdef) ; p(more) }');
    await undo(page); // the typing
    await undo(page); // the split: ONE step
    await expectOutline(page, 'p(pre) ; R:section-2(Two){ p(abcdef) ; p(more) }');
    await expectCaret(page, 'abc|def');
    await expectValid(page);
  });

  test('at offset 0: no cut, the block itself starts the new region', async ({ page }) => {
    await build(page, [S1('Part', Pp('x'), Pp('abcdef'))]);
    await focusAt(page, 'abcdef', 0);
    await press(page, `${MOD}+Enter`);
    await expectOutline(page, 'R:section-1(Part){ p(x) } ; R:section-1(∅){ p(abcdef) }');
    await expectCaret(page, '|abcdef');
    await expect(titles(page).nth(1)).toHaveClass(/empty/);
    await undo(page);
    await expectOutline(page, 'R:section-1(Part){ p(x) ; p(abcdef) }');
    await expectCaret(page, '|abcdef');
    await expectValid(page);
  });

  test('in a sub-region: a sibling sub-region (same type) right after it, the rest of THAT body moves; the parent keeps the others', async ({ page }) => {
    await build(page, [S1('A', Pp('a'), S2('B', Pp('b1'), Pp('b2')), S2('C', Pp('c')))]);
    await focusAt(page, 'b1', 1);
    await press(page, `${MOD}+Enter`);
    await expectOutline(page, 'R:section-1(A){ p(a) ; R:section-2(B){ p(b) } ; R:section-2(∅){ p(1) ; p(b2) } ; R:section-2(C){ p(c) } }');
    expect(await labels(page)).toEqual(['1. A', '1.1 B', '1.2', '1.3 C']);
    await expectValid(page);
  });

  test('in the preamble it opens a top-level region taking the rest of the root blocks up to the next root region', async ({ page }) => {
    await build(page, [Pp('hello world'), Pp('tail'), S1('Next', Pp('n'))]);
    await focusAt(page, 'hello world', 5);
    await press(page, `${MOD}+Enter`);
    await expectOutline(page, 'p(hello) ; R:section-1(∅){ p( world) ; p(tail) } ; R:section-1(Next){ p(n) }');
    await expectValid(page);
  });

  test('in a title it splits nothing; in a to-do item Mod-Enter keeps its own meaning (check)', async ({ page }) => {
    await build(page, [S1('Part', Pp('para'), { type: 'list', props: { listType: 'todo' }, children: [{ type: 'list-item', text: 'task', props: { checked: false } }] })]);
    await focusAt(page, 'Part', 2);
    await press(page, `${MOD}+Enter`);
    await flushRender(page);
    await expect(page.locator('.nabu-region')).toHaveCount(1);
    await focusEnd(page, 'task');
    await press(page, `${MOD}+Enter`);
    await flushRender(page);
    expect(await page.evaluate(() => (window as any).nabu.tree.roots()[0].children()[1].children()[0].data.get('checked'))).toBe(true);
    await expect(page.locator('.nabu-region')).toHaveCount(1);
    await focusAt(page, 'para', 2);
    await press(page, `${MOD}+Enter`);
    await expect(page.locator('.nabu-region')).toHaveCount(2);
    await expectValid(page);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// region:exit (Mod-Shift-Enter)
// ════════════════════════════════════════════════════════════════════════════

test.describe('region:exit (Mod-Shift-Enter)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
  });

  test('from a body paragraph: a new empty paragraph right after the region, one level up; the caret is in it; one undo step', async ({ page }) => {
    await build(page, [S1('One', Pp('a'), Pp('b')), S1('Two', Pp('c'))]);
    await focusAt(page, 'a', 1);
    await press(page, `${MOD}+Shift+Enter`);
    await expectOutline(page, 'R:section-1(One){ p(a) ; p(b) } ; p(∅) ; R:section-1(Two){ p(c) }');
    await page.keyboard.type('after');
    await expectOutline(page, 'R:section-1(One){ p(a) ; p(b) } ; p(after) ; R:section-1(Two){ p(c) }');
    await undo(page);
    await undo(page);
    await expectOutline(page, 'R:section-1(One){ p(a) ; p(b) } ; R:section-1(Two){ p(c) }');
    await expectValid(page);
  });

  test('repeated from an empty last paragraph it CLIMBS: sub-region body -> parent body -> root', async ({ page }) => {
    await build(page, [S1('A', Pp('a'), S2('B', Pp('b'), Pp('')))]);
    await focusEnd(page, 'b');
    await press(page, 'ArrowDown'); // into the empty last paragraph of B
    await expectCaret(page, '|');
    await press(page, `${MOD}+Shift+Enter`);
    await expectOutline(page, 'R:section-1(A){ p(a) ; R:section-2(B){ p(b) } ; p(∅) }');
    await expectCaret(page, '|');
    await press(page, `${MOD}+Shift+Enter`);
    await expectOutline(page, 'R:section-1(A){ p(a) ; R:section-2(B){ p(b) } } ; p(∅)');
    await page.keyboard.type('end');
    await expectOutline(page, 'R:section-1(A){ p(a) ; R:section-2(B){ p(b) } } ; p(end)');
    await expectValid(page);
  });

  test('from a title: a paragraph right after the region', async ({ page }) => {
    await build(page, [S1('One', Pp('a')), Pp('z')]);
    await focusAt(page, 'One', 1);
    await press(page, `${MOD}+Shift+Enter`);
    await expectOutline(page, 'R:section-1(One){ p(a) } ; p(∅) ; p(z)');
    await page.keyboard.type('n');
    await expectOutline(page, 'R:section-1(One){ p(a) } ; p(n) ; p(z)');
    await expectValid(page);
  });

  test('Enter on an empty paragraph stays an ordinary Enter (an empty paragraph is an author\'s choice, not an exit)', async ({ page }) => {
    await build(page, [S1('One', Pp('a'), Pp(''))]);
    await focusAt(page, 'a', 1);
    await press(page, 'ArrowDown');
    await press(page, 'Enter');
    await expectOutline(page, 'R:section-1(One){ p(a) ; p(∅) ; p(∅) }');
    await expectValid(page);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Tab / Shift-Tab in a title (demote / promote)
// ════════════════════════════════════════════════════════════════════════════

test.describe('Tab / Shift-Tab (region:demote / region:promote)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
  });

  test('Tab in a title demotes: the region becomes the LAST sub-region of the previous sibling (retyped); the caret stays; one undo step', async ({ page }) => {
    await build(page, [S1('A', Pp('a')), S1('Bee', Pp('b'))]);
    await focusAt(page, 'Bee', 1);
    await press(page, 'Tab');
    await expectOutline(page, 'R:section-1(A){ p(a) ; R:section-2(Bee){ p(b) } }');
    expect(await prefixes(page)).toEqual(['1.', '1.1']);
    await expectCaret(page, 'B|ee');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'R:section-1(A){ p(a) } ; R:section-1(Bee){ p(b) }');
    await expectCaret(page, 'B|ee');
    await expectValid(page);
  });

  test('Shift-Tab in a sub-region title promotes: it leaves its parent, the following siblings follow it into its body', async ({ page }) => {
    await build(page, [S1('A', Pp('a'), S2('B', Pp('b')), S2('C', Pp('c')))]);
    await focusEnd(page, 'B');
    await press(page, 'Shift+Tab');
    await expectOutline(page, 'R:section-1(A){ p(a) } ; R:section-1(B){ p(b) ; R:section-2(C){ p(c) } }');
    expect(await prefixes(page)).toEqual(['1.', '2.', '2.1']);
    await expectCaret(page, 'B|');
    await undo(page);
    await expectOutline(page, 'R:section-1(A){ p(a) ; R:section-2(B){ p(b) } ; R:section-2(C){ p(c) } }');
    await expectValid(page);
  });

  test('Tab demotes a region with its subtree; sub-regions too deep for the new level are moved out beside it', async ({ page }) => {
    await build(page, [S1('A', Pp('a')), S1('B', Pp('b'), S2('B1', Pp('b1')))]);
    await focusAt(page, 'B', 0);
    await press(page, 'Tab');
    await expectOutline(page, 'R:section-1(A){ p(a) ; R:section-2(B){ p(b) } ; R:section-2(B1){ p(b1) } }');
    await expectValid(page);
  });

  test('without a previous sibling region (or no parent) Tab and Shift-Tab do nothing: no undo step', async ({ page }) => {
    await build(page, [S1('A', Pp('a'), S2('B', Pp('b')))]);
    await focusAt(page, 'A', 1);
    await press(page, 'Tab'); // nothing before A
    await press(page, 'Shift+Tab'); // A has no parent region
    await focusAt(page, 'B', 1);
    await press(page, 'Tab'); // B has no previous sibling region
    await flushRender(page);
    await expectOutline(page, 'R:section-1(A){ p(a) ; R:section-2(B){ p(b) } }');
    expect(await canUndo(page)).toBe(false);
    await expectValid(page);
  });

  test('Tab in a body paragraph does NOT change regions', async ({ page }) => {
    await build(page, [S1('A', Pp('a')), S1('B', Pp('b'), Pp('c'))]);
    await focusAt(page, 'b', 1);
    await press(page, 'Tab');
    await press(page, 'Shift+Tab');
    await flushRender(page);
    expect(await labels(page)).toEqual(['1. A', '2. B']);
    expect(await page.evaluate(() => (window as any).nabu.regions.list.map((r: any) => r.level))).toEqual([1, 1]);
    await expectValid(page);
  });

  test('Tab on a list item in a body keeps its list meaning (nests the item); the regions are untouched', async ({ page }) => {
    await build(page, [S1('A', UL('one', 'two')), S1('B', Pp('b'))]);
    await focusAt(page, 'two', 1);
    await press(page, 'Tab');
    await expectOutline(page, 'R:section-1(A){ ul[one > ul[two]] } ; R:section-1(B){ p(b) }');
    await expectValid(page);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Undo: one step per command
// ════════════════════════════════════════════════════════════════════════════

test.describe('undo', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, { seed: 'regions' }); });

  test('each structural command is ONE undo step, in order: demote, split, exit, then back', async ({ page }) => {
    const head = 'p(Preamble, outside any region.) ; R:section-1(The ferryman){ p(Opening of the first section.) ; R:section-2(The bank){ p(Text of the bank.) } ; R:section-2(The water){ p(Text of the water.) }';
    await focusAt(page, 'The return', 2);
    await press(page, 'Tab'); // The return -> last sub-region of The ferryman
    const s1 = `${head} ; R:section-2(The return){ p(Closing text.) } }`;
    await expectOutline(page, s1);
    await focusAt(page, 'Closing text.', 7);
    await press(page, `${MOD}+Enter`);
    const s2 = `${head} ; R:section-2(The return){ p(Closing) } ; R:section-2(∅){ p( text.) } }`;
    await expectOutline(page, s2);
    await press(page, `${MOD}+Shift+Enter`);
    const s3 = `${head} ; R:section-2(The return){ p(Closing) } ; R:section-2(∅){ p( text.) } ; p(∅) }`;
    await expectOutline(page, s3);
    await undo(page); // exit
    await expectOutline(page, s2);
    await undo(page); // split
    await expectOutline(page, s1);
    await undo(page); // demote
    await expectOutline(page, SEED);
    await expectCaret(page, 'Th|e return');
    await expectValid(page);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Keyless commands (through the action bus), seeded document
// ════════════════════════════════════════════════════════════════════════════

test.describe('structural commands through exec (seeded document)', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, { seed: 'regions' }); });

  test('region:move down: the region swaps with its next sibling, WITH its body; labels renumber; undo restores the caret', async ({ page }) => {
    await focusAt(page, 'Text of the bank.', 4);
    await exec(page, 'region:move', { direction: 'down' });
    await expectOutline(page, SEED.replace('R:section-2(The bank){ p(Text of the bank.) } ; R:section-2(The water){ p(Text of the water.) }', 'R:section-2(The water){ p(Text of the water.) } ; R:section-2(The bank){ p(Text of the bank.) }'));
    expect(await labels(page)).toEqual(['1. The ferryman', '1.1 The water', '1.2 The bank', '2. The return']);
    await expectCaret(page, 'Text| of the bank.');
    await undo(page);
    await expectOutline(page, SEED);
    await expectCaret(page, 'Text| of the bank.');
    await expectValid(page);
  });

  test('region:move at the edge of its parent is a no-op (no undo step)', async ({ page }) => {
    await focusAt(page, 'Text of the water.', 0);
    await exec(page, 'region:move', { direction: 'down' });
    await flushRender(page);
    expect(await canUndo(page)).toBe(false);
    await expectOutline(page, SEED);
  });

  test('region:promote / region:demote change the level of the region holding the caret (structurally)', async ({ page }) => {
    await focusAt(page, 'Text of the water.', 0);
    await exec(page, 'region:promote');
    await expect.poll(() => labels(page)).toEqual(['1. The ferryman', '1.1 The bank', '2. The water', '3. The return']);
    await exec(page, 'region:demote');
    await expect.poll(() => labels(page)).toEqual(['1. The ferryman', '1.1 The bank', '1.2 The water', '2. The return']);
    await expectOutline(page, SEED);
    await expectValid(page);
  });

  test('region:unwrap dissolves the region: the title becomes a paragraph, the body stays; one undo step', async ({ page }) => {
    await focusAt(page, 'Text of the bank.', 2);
    await exec(page, 'region:unwrap');
    await expectOutline(page, SEED.replace('R:section-2(The bank){ p(Text of the bank.) }', 'p(The bank) ; p(Text of the bank.)'));
    await undo(page);
    await expectOutline(page, SEED);
    await expectValid(page);
  });

  test('region:next / region:prev / region:parent move the caret to the first text position of the target region body', async ({ page }) => {
    await focusAt(page, 'Opening of the first section.', 3);
    await exec(page, 'region:next');
    await expectCaret(page, '|Text of the bank.');
    await exec(page, 'region:parent');
    await expectCaret(page, '|Opening of the first section.');
    await exec(page, 'region:next', { region: await page.evaluate(() => (window as any).nabu.regions.list[2].block.id) });
    await expectCaret(page, '|Closing text.');
    await exec(page, 'region:prev');
    await expectCaret(page, '|Text of the water.');
  });

  test('region:insert adds a sibling region before the current one, one undo step', async ({ page }) => {
    await focusAt(page, 'Text of the bank.', 0);
    await exec(page, 'region:insert', { type: 'section-2', at: 'before', title: 'New' });
    await expect.poll(() => labels(page)).toEqual(['1. The ferryman', '1.1 New', '1.2 The bank', '1.3 The water', '2. The return']);
    await expectOutline(page, SEED.replace('R:section-2(The bank)', 'R:section-2(New) ; R:section-2(The bank)'));
    await undo(page);
    await expect.poll(() => labels(page)).toEqual(['1. The ferryman', '1.1 The bank', '1.2 The water', '2. The return']);
  });

  test('region:merge-previous through exec runs directly (no hold)', async ({ page }) => {
    await focusAt(page, 'Text of the water.', 2);
    await exec(page, 'region:merge-previous');
    await expectOutline(page, SEED.replace('R:section-2(The bank){ p(Text of the bank.) } ; R:section-2(The water){ p(Text of the water.) }', 'R:section-2(The bank){ p(Text of the bank.) ; p(Text of the water.) }'));
    expect(await pending(page)).toBeNull();
    await expectValid(page);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Placement and nesting rules (the normalizer)
// ════════════════════════════════════════════════════════════════════════════

test.describe('where a region may live', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
  });

  test('a region inserted into a toggle ends up right after the toggle, in the operation\'s undo step', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const t = n.insert('toggle', { text: 'T' }, null, 1);
      n.insert('paragraph', { text: 'body' }, t.id, 0);
      await n.commit();
      n.undoManager.clear();
      n.insert('region', { regionType: 'section-1', title: 'Hoisted' }, t.id, 1);
      await n.commit();
    });
    await expectOutline(page, 'p(∅) ; toggle(T){p(body)} ; R:section-1(Hoisted)');
    await expectValid(page);
    await page.evaluate(() => (window as any).nabu.undo());
    await expectOutline(page, 'p(∅) ; toggle(T){p(body)}');
    await expectValid(page);
  });

  test('a region inserted into a list is hoisted: the list is cut around it', async ({ page }) => {
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
    await expectOutline(page, 'p(∅) ; ul[one] ; R:section-1(In list) ; ul[two]');
    await expectValid(page);
  });

  test('a region hoisted out of a list INSIDE a region lands in that region\'s body, not at the root', async ({ page }) => {
    await build(page, [S1('A', UL('one', 'two'))]);
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const list = n.regions.list[0].block.children[0];
      n.insert('region', { regionType: 'section-2', title: 'In list' }, list.id, 1);
      await n.commit();
    });
    await expectOutline(page, 'R:section-1(A){ ul[one] ; R:section-2(In list) ; ul[two] }');
    await expectValid(page);
  });

  test('a sub-region must be strictly deeper than its parent: a same-level region put in a body goes right after the parent (undo gives it back)', async ({ page }) => {
    await build(page, [S1('A', Pp('a')), Pp('z')]);
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.insert('region', { regionType: 'section-1', title: 'Same level' }, n.regions.list[0].block.id, 1);
      await n.commit();
    });
    await expectOutline(page, 'R:section-1(A){ p(a) } ; R:section-1(Same level) ; p(z)');
    await expectValid(page);
    await page.evaluate(() => (window as any).nabu.undo());
    await expectOutline(page, 'R:section-1(A){ p(a) } ; p(z)');
  });

  test('a section-3 may live directly in a section-1 body (levels need not be consecutive)', async ({ page }) => {
    await build(page, [S1('A', S3('Deep', Pp('d')))]);
    await expectOutline(page, 'R:section-1(A){ R:section-3(Deep){ p(d) } }');
    expect(await prefixes(page)).toEqual(['1.', '1.1']);
    await expectValid(page);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Regression: the command facts must stay cheap in a long document without regions
// ════════════════════════════════════════════════════════════════════════════

test.describe('long documents', () => {
  test('keys that carry a region command (Backspace, Delete, Mod-Enter, Tab) answer at once in 60 paragraphs without any region', async ({ page }) => {
    // `Block#findForward` is exponential when nothing matches; the facts of the regions use their own linear search (facts.js).
    await gotoEditor(page);
    await clearAndReset(page);
    await build(page, Array.from({ length: 60 }, (_, i) => Pp(`line ${i + 1}`)));
    await focusAt(page, 'line 3', 3);
    await press(page, 'Backspace');
    await expectOutline(page, Array.from({ length: 60 }, (_, i) => `p(${i === 2 ? 'lie 3' : `line ${i + 1}`})`).join(' ; '));
    await press(page, 'Delete');
    await press(page, `${MOD}+Enter`); // splits the preamble: a region takes the rest of the root blocks
    await expect(page.locator('.nabu-region')).toHaveCount(1);
    await expectValid(page);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The title in the caret model (ADR 018 §3.9). Horizontal arrows already cross it; the rest is lot B (test.fixme)
// ════════════════════════════════════════════════════════════════════════════

test.describe('the title as a field of the caret and selection model', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await build(page, [Pp('above'), S1('Part', Pp('below'))]);
  });

  test('ArrowRight / ArrowLeft step through the title: above -> start of the title -> end of the title -> start of the body, and back', async ({ page }) => {
    await focusEnd(page, 'above');
    await press(page, 'ArrowRight');
    await expectCaret(page, '|Part');
    for (let i = 0; i < 'Part'.length; i++) await press(page, 'ArrowRight');
    await expectCaret(page, 'Part|');
    await press(page, 'ArrowRight');
    await expectCaret(page, '|below');
    await press(page, 'ArrowLeft');
    await expectCaret(page, 'Part|');
    for (let i = 0; i < 'Part'.length; i++) await press(page, 'ArrowLeft');
    await expectCaret(page, '|Part');
    await press(page, 'ArrowLeft');
    await expectCaret(page, 'above|');
    await expectOutline(page, 'p(above) ; R:section-1(Part){ p(below) }');
    await expectValid(page);
  });

  test('typing right after an arrow step into the title goes into the title, not into a neighbour', async ({ page }) => {
    await focusEnd(page, 'above');
    await press(page, 'ArrowRight');
    await page.keyboard.type('X');
    await expectOutline(page, 'p(above) ; R:section-1(XPart){ p(below) }');
    await expectValid(page);
  });

  test('ArrowDown at the end of the block above lands at the START of the title (ADR 018 §3.9)', async ({ page }) => {
    test.fixme(true, 'TODO(ADR-018 lot B): ArrowDown into a title keeps the native column and lands at the END of the title (Part|), not at its start');
    await focusEnd(page, 'above');
    await press(page, 'ArrowDown');
    await expectCaret(page, '|Part');
  });

  test('a selection spanning two regions deletes the text on both sides but never merges them (titles intact)', async ({ page }) => {
    test.fixme(true, 'TODO(ADR-018 lot B): selections spanning titles do not exclude the titles yet (today the second region is deleted and its text merged into the first)');
    await build(page, [S1('One', Pp('aaXX')), S1('Two', Pp('YYbb'))]);
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const [a, b] = ['aaXX', 'YYbb'].map((t) => [...n.blocks.values()].find((x: any) => x.behaviors?.get('text')?.text === t));
      await n.focus({ from: { block: a, offset: 2 }, to: { block: b, offset: 2 } });
    });
    await press(page, 'Backspace');
    await expectOutline(page, 'R:section-1(One){ p(aa) } ; R:section-1(Two){ p(bb) }');
  });

  test('Ctrl+A in a title selects the title only', async ({ page }) => {
    test.fixme(true, 'TODO(ADR-018 lot B): Ctrl+A in a title selects the whole document today (Ctrl+A then Backspace empties it)');
    await focusAt(page, 'Part', 2);
    await press(page, `${MOD}+a`);
    await press(page, 'Backspace');
    await expectOutline(page, 'p(above) ; R:section-1(∅){ p(below) }');
  });
});
