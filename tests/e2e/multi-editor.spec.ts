import { test, expect, type Page } from './helpers/test.js';
import { collectErrors } from './helpers/model.js';
import { Keys } from './helpers/keyboard.js';

// SEVERAL editors on one page (route /e2e/multi, src/routes/e2e/multi): the DOM selection is a single, page-wide object, and every
// engine listens to it at the document level. Each engine must act on the selection of ITS OWN root only; a read-only neighbour, an
// editor nested in another editor's UI island, an editor mounted next to the others must never move, rewrite, record or react to a
// caret that is not theirs.
//
//   A  editable, in a plain container          "Alpha one" / "Alpha two"
//   B  read-only                                "Bravo read only one" / "…two"
//   O  editable outer editor, with an `embed` block whose UI island holds
//   N  an editable NESTED editor               "Nested text"      (O: "Outer text" / embed / "Outer tail")
//   X  an extra editor the page mounts / unmounts on demand ("Xray text")
//
// The models are read through window.multi.{a,b,o,n,x} (the engines), the selection through the aria-label of the root that holds it.

const ROOTS = { a: 'Editor A', b: 'Editor B', o: 'Editor O', n: 'Nested editor', x: 'Editor X' } as const;
type Key = keyof typeof ROOTS;

const ORIGINAL = {
  a: ['Alpha one', 'Alpha two'],
  b: ['Bravo read only one', 'Bravo read only two'],
  o: ['Outer text', null, 'Outer tail'],
  n: ['Nested text'],
};

test.beforeEach(async ({ page }) => {
  await page.goto('/e2e/multi', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__multi_ready === true && document.querySelectorAll('[data-nabu-root]').length === 4, null, { timeout: 15000 });
  // the seeded text is rendered
  await expect(page.getByLabel('Nested editor')).toContainText('Nested text');
});

/** The text of the root blocks of an engine (null for a block without text). */
const texts = (page: Page, key: Key) =>
  page.evaluate((k) => (window as any).multi[k].children.map((c: any) => c.behaviors.get('text')?.text ?? null), key);

/** The text of every engine, to check that the ones that must not change did not. */
const allTexts = async (page: Page) => ({ a: await texts(page, 'a'), b: await texts(page, 'b'), o: await texts(page, 'o'), n: await texts(page, 'n') });

const markdown = (page: Page, key: Key) => page.evaluate((k) => (window as any).multi[k].serialize('markdown'), key);

/** Which editor (the label of its root) holds each end of the DOM selection; null when an end is outside every editor. */
const owner = (page: Page) =>
  page.evaluate(() => {
    const sel = getSelection()!;
    const of = (node: Node | null) => {
      const el = node && (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement);
      return el?.closest('[data-nabu-root]')?.getAttribute('aria-label') ?? null;
    };
    return { anchor: of(sel.anchorNode), focus: of(sel.focusNode), collapsed: sel.isCollapsed, text: sel.toString() };
  });

/** How many times each engine has itself placed the selection (it rewrites a selection only through this). */
const placements = (page: Page) =>
  page.evaluate(() => {
    const m = (window as any).multi;
    return Object.fromEntries(['a', 'b', 'o', 'n'].map((k) => [k, m[k].selection.placements]));
  });

/** What each engine's own model says it selects (the anchor block's text, or null: "no selection of mine"). */
const modelAnchors = (page: Page) =>
  page.evaluate(() => {
    const m = (window as any).multi;
    return Object.fromEntries(['a', 'b', 'o', 'n'].map((k) => [k, m[k].selection.anchorBlock?.behaviors.get('text')?.text ?? null]));
  });

const paragraph = (page: Page, key: Key, index = 0) => page.locator(`[aria-label="${ROOTS[key]}"] [data-block-type="paragraph"]`).nth(index);

/** A real mouse click in a paragraph of an editor, then End (the caret at the end of that paragraph). */
async function clickEnd(page: Page, key: Key, index = 0) {
  await paragraph(page, key, index).click();
  await page.keyboard.press('End');
}

/** The selection stays in `key` for a while (a stolen caret shows up within a few frames: selectionchange, effects, timers). */
async function expectStays(page: Page, key: Key, frames = 6) {
  for (let i = 0; i < frames; i++) {
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const o = await owner(page);
    expect(o.anchor, `anchor after ${i} frames`).toBe(ROOTS[key]);
    expect(o.focus, `focus after ${i} frames`).toBe(ROOTS[key]);
  }
}

test.describe('several editors on one page', () => {
  test('the page starts as seeded, four roots, no selection of anybody', async ({ page }) => {
    expect(await allTexts(page)).toEqual(ORIGINAL);
    const anchors = await modelAnchors(page);
    expect(Object.values(anchors).every((v) => v === null)).toBe(true);
  });

  test('a real click and typing in each editor: the text lands in that editor only', async ({ page }) => {
    const errors = collectErrors(page);

    await clickEnd(page, 'a');
    await expectStays(page, 'a');
    await page.keyboard.type('+A');
    expect(await allTexts(page)).toEqual({ ...ORIGINAL, a: ['Alpha one+A', 'Alpha two'] });

    await clickEnd(page, 'o');
    await expectStays(page, 'o');
    await page.keyboard.type('+O');
    expect(await allTexts(page)).toEqual({ ...ORIGINAL, a: ['Alpha one+A', 'Alpha two'], o: ['Outer text+O', null, 'Outer tail'] });

    await clickEnd(page, 'n');
    await expectStays(page, 'n');
    await page.keyboard.type('+N');
    expect(await allTexts(page)).toEqual({ ...ORIGINAL, a: ['Alpha one+A', 'Alpha two'], o: ['Outer text+O', null, 'Outer tail'], n: ['Nested text+N'] });

    // back in A: the others did not keep a stake in the caret
    await clickEnd(page, 'a', 1);
    await expectStays(page, 'a');
    await page.keyboard.type('+a2');
    expect((await texts(page, 'a'))[1]).toBe('Alpha two+a2');
    expect(await texts(page, 'o')).toEqual(['Outer text+O', null, 'Outer tail']);
    expect(await texts(page, 'n')).toEqual(['Nested text+N']);
    expect(await texts(page, 'b')).toEqual(ORIGINAL.b);
    expect(errors.list()).toEqual([]);
  });

  test('a read-only neighbour never steals the selection, whatever happens around', async ({ page }) => {
    const errors = collectErrors(page);
    // the editors on both sides of B are read-only B's neighbours: click, type, click, type, with B sitting between A and O
    for (let round = 0; round < 3; round++) {
      await clickEnd(page, 'a');
      await expectStays(page, 'a');
      await page.keyboard.type('a');
      await clickEnd(page, 'o');
      await expectStays(page, 'o');
      await page.keyboard.type('o');
    }
    expect(await texts(page, 'a')).toEqual(['Alpha oneaaa', 'Alpha two']);
    expect((await texts(page, 'o'))[0]).toBe('Outer textooo');
    expect(await texts(page, 'b')).toEqual(ORIGINAL.b);
    expect(errors.list()).toEqual([]);
  });

  test('clicking into the read-only editor selects there, it is not rewritten, and typing changes nothing', async ({ page }) => {
    const errors = collectErrors(page);
    await clickEnd(page, 'a');
    const before = await placements(page);
    await paragraph(page, 'b').click();
    await expectStays(page, 'b', 4);
    await page.keyboard.type('zzz');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    expect(await texts(page, 'b')).toEqual(ORIGINAL.b);
    expect(await texts(page, 'a')).toEqual(ORIGINAL.a);
    expect(await texts(page, 'o')).toEqual(ORIGINAL.o);
    // nobody moved the caret that sits in the read-only editor, except possibly the read-only editor itself
    const after = await placements(page);
    expect(after.a).toBe(before.a);
    expect(after.o).toBe(before.o);
    expect(after.n).toBe(before.n);
    // and the editable ones still work afterwards
    await clickEnd(page, 'a');
    await page.keyboard.type('!');
    expect((await texts(page, 'a'))[0]).toBe('Alpha one!');
    expect(errors.list()).toEqual([]);
  });

  test('arrows and Shift+arrows stay inside the editor', async ({ page }) => {
    const errors = collectErrors(page);
    await paragraph(page, 'a').click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await expectStays(page, 'a', 2);
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
    await expectStays(page, 'a', 2);
    expect((await owner(page)).text).toBe('ha o');
    // down across the two paragraphs, past the end of the document, then up again
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expectStays(page, 'a', 2);
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+End');
    await expectStays(page, 'a', 2);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Shift+ArrowLeft');
    await expectStays(page, 'a', 2);

    // in the nested editor: moves inside its text stay in it ...
    await paragraph(page, 'n').click();
    await page.keyboard.press('Home');
    for (const key of ['ArrowRight', 'ArrowRight', 'Shift+ArrowRight', 'Shift+ArrowRight', 'ArrowLeft', 'Shift+End', 'Shift+Home']) {
      await page.keyboard.press(key);
      await expectStays(page, 'n', 2);
    }
    // ... and a key that leaves it (right / down at its very end) is the BROWSER moving the caret on to the next editable text, the
    // outer editor's tail: the caret is then the outer editor's, never A's or B's, and no engine rewrote it
    await page.keyboard.press('End');
    const placed = await placements(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const left = await owner(page);
    expect([ROOTS.n, ROOTS.o]).toContain(left.anchor);
    expect(left.focus).toBe(left.anchor);
    const placedAfter = await placements(page);
    expect(placedAfter.a).toBe(placed.a);
    expect(placedAfter.b).toBe(placed.b);
    // in the outer one: up at the first paragraph and left at its start stay in it
    await paragraph(page, 'o').click();
    await page.keyboard.press('Home');
    for (const key of ['ArrowLeft', 'ArrowUp', 'Shift+ArrowUp', 'Shift+ArrowLeft']) {
      await page.keyboard.press(key);
      await expectStays(page, 'o', 2);
    }

    expect(await allTexts(page)).toEqual(ORIGINAL);
    expect(errors.list()).toEqual([]);
  });

  test('Ctrl+A selects the text of the focused editor only', async ({ page }) => {
    await clickEnd(page, 'a');
    await page.keyboard.press(Keys.selectAll);
    const o = await owner(page);
    expect(o.anchor).toBe(ROOTS.a);
    expect(o.focus).toBe(ROOTS.a);
    expect(o.text).toContain('Alpha one');
    expect(o.text).not.toContain('Bravo');
    expect(o.text).not.toContain('Outer');
    expect(await allTexts(page)).toEqual(ORIGINAL);
  });

  test('Ctrl+B only affects the focused editor', async ({ page }) => {
    const errors = collectErrors(page);
    await clickEnd(page, 'a');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press(Keys.bold);
    expect(await markdown(page, 'a')).toContain('**Alpha one**');
    for (const key of ['b', 'o', 'n'] as Key[]) expect(await markdown(page, key), key).not.toContain('**');

    // a bold toggled at a caret of another editor: stored marks belong to that editor
    await clickEnd(page, 'o');
    await page.keyboard.press(Keys.bold);
    await page.keyboard.type('bold');
    expect(await markdown(page, 'o')).toContain('**bold**');
    expect(await markdown(page, 'n')).not.toContain('**');
    expect(await markdown(page, 'a')).not.toContain('bold');

    // and typing in the nested editor right after: no stored mark leaked from O into N, none from N into O
    await clickEnd(page, 'n');
    await page.keyboard.type('plain');
    expect(await markdown(page, 'n')).toBe('Nested textplain');
    expect(await markdown(page, 'o')).not.toContain('plain');
    expect(errors.list()).toEqual([]);
  });

  test('Ctrl+Z and redo only affect the focused editor; the undo histories are isolated', async ({ page }) => {
    const errors = collectErrors(page);
    await clickEnd(page, 'a');
    await page.keyboard.type('1');
    await clickEnd(page, 'o');
    await page.keyboard.type('2');
    await clickEnd(page, 'n');
    await page.keyboard.type('3');
    expect(await allTexts(page)).toEqual({ ...ORIGINAL, a: ['Alpha one1', 'Alpha two'], o: ['Outer text2', null, 'Outer tail'], n: ['Nested text3'] });

    // undo in A: only A's "1" goes
    await clickEnd(page, 'a');
    await page.keyboard.press(Keys.undo);
    await expectStays(page, 'a', 3);
    expect(await allTexts(page)).toEqual({ ...ORIGINAL, o: ['Outer text2', null, 'Outer tail'], n: ['Nested text3'] });
    // A has nothing more to undo: a second Ctrl+Z must not reach into the others
    await page.keyboard.press(Keys.undo);
    expect(await allTexts(page)).toEqual({ ...ORIGINAL, o: ['Outer text2', null, 'Outer tail'], n: ['Nested text3'] });

    // undo in N (nested): O's "2" stays
    await clickEnd(page, 'n');
    await page.keyboard.press(Keys.undo);
    await expectStays(page, 'n', 3);
    expect(await allTexts(page)).toEqual({ ...ORIGINAL, o: ['Outer text2', null, 'Outer tail'] });

    // undo in O: N is not affected; then redo in O only brings O's text back
    await clickEnd(page, 'o');
    await page.keyboard.press(Keys.undo);
    await expectStays(page, 'o', 3);
    expect(await allTexts(page)).toEqual(ORIGINAL);
    await page.keyboard.press('Control+Shift+z');
    expect(await allTexts(page)).toEqual({ ...ORIGINAL, o: ['Outer text2', null, 'Outer tail'] });

    // redo in A: A only
    await clickEnd(page, 'a');
    await page.keyboard.press('Control+Shift+z');
    expect(await allTexts(page)).toEqual({ ...ORIGINAL, a: ['Alpha one1', 'Alpha two'], o: ['Outer text2', null, 'Outer tail'] });
    expect(errors.list()).toEqual([]);
  });

  test('a drag across two editors leaves both models, and their selection machinery, untouched', async ({ page }) => {
    const errors = collectErrors(page);
    const from = await paragraph(page, 'a', 1).boundingBox();
    const to = await paragraph(page, 'b', 0).boundingBox();
    const toO = await paragraph(page, 'o', 0).boundingBox();
    if (!from || !to || !toO) throw new Error('no boxes');

    for (const target of [to, toO]) {
      await page.mouse.click(2, 2); // no selection left: a press inside a selected text would start a native drag-and-drop of it
      const before = await placements(page);
      await page.mouse.move(from.x + 20, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + 30, target.y + target.height / 2, { steps: 8 });
      await page.mouse.up();
      expect(await allTexts(page)).toEqual(ORIGINAL);
      const after = await placements(page);
      expect(after, 'no engine placed the selection during a drag across roots').toEqual(before);
    }

    // and one from the read-only editor into A
    await page.mouse.click(2, 2);
    const before = await placements(page);
    await page.mouse.move(to.x + 40, to.y + to.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + from.height / 2, { steps: 8 });
    await page.mouse.up();
    expect(await allTexts(page)).toEqual(ORIGINAL);
    expect(await placements(page)).toEqual(before);
    expect(errors.list()).toEqual([]);
  });

  test('a selection that crosses two roots is nobody\'s: not rewritten, not mirrored in either model', async ({ page }) => {
    const errors = collectErrors(page);
    await clickEnd(page, 'a');
    const before = await placements(page);
    // the browser may not let a user drag produce this (it clamps to the editing host); a script can
    await page.evaluate(() => {
      const first = (label: string) => {
        const p = document.querySelector(`[aria-label="${label}"] [data-block-type="paragraph"]`)!;
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        return walker.nextNode()!;
      };
      getSelection()!.setBaseAndExtent(first('Editor A'), 2, first('Editor O'), 3);
    });
    // let selectionchange, the effects and the timers run
    await page.evaluate(() => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => r())), 100)));
    const o = await owner(page);
    expect(o.anchor).toBe(ROOTS.a);
    expect(o.focus).toBe(ROOTS.o);
    expect(await placements(page)).toEqual(before);
    const anchors = await modelAnchors(page);
    expect(anchors.a).toBeNull();
    expect(anchors.o).toBeNull();
    // a key press with such a selection does not make either engine rewrite it
    await page.keyboard.press('ArrowRight');
    expect(await placements(page)).toEqual(before);
    expect(await allTexts(page)).toEqual(ORIGINAL);
    expect(errors.list()).toEqual([]);
  });

  test('an editor mounted and unmounted next to the others: no error, the others keep working', async ({ page }) => {
    const errors = collectErrors(page);
    await page.locator('#mount-x').click();
    await expect(page.getByLabel('Editor X')).toContainText('Xray text');
    await clickEnd(page, 'x');
    await expectStays(page, 'x', 3);
    await page.keyboard.type('+X');
    expect(await texts(page, 'x')).toEqual(['Xray text+X']);
    expect(await allTexts(page)).toEqual(ORIGINAL);

    // unmounted while it holds the focus and the selection (the focusout fires while Svelte tears the editor down)
    await page.evaluate(() => (window as any).multi.unmountX());
    await expect(page.getByLabel('Editor X')).toHaveCount(0);
    await page.evaluate(() => new Promise<void>((r) => setTimeout(r, 50)));

    await clickEnd(page, 'a');
    await expectStays(page, 'a', 3);
    await page.keyboard.type('+A');
    expect((await texts(page, 'a'))[0]).toBe('Alpha one+A');

    // and again, several times, focus in the mounted editor each time
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => (window as any).multi.mountX());
      await expect(page.getByLabel('Editor X')).toHaveCount(1);
      await clickEnd(page, 'x');
      await page.keyboard.type(`${i}`);
      await clickEnd(page, 'o');
      await page.keyboard.type('.');
      await page.evaluate(() => (window as any).multi.unmountX());
      await expect(page.getByLabel('Editor X')).toHaveCount(0);
    }
    expect((await texts(page, 'o'))[0]).toBe('Outer text...');
    await clickEnd(page, 'a');
    await page.keyboard.type('!');
    expect((await texts(page, 'a'))[0]).toBe('Alpha one+A!');
    expect(errors.list()).toEqual([]);
  });

  test('the engines know their own roots, and let go of them', async ({ page }) => {
    const mounted = await page.evaluate(() => {
      const m = (window as any).multi;
      return Object.fromEntries(['a', 'b', 'o', 'n'].map((k) => [k, m[k].internals.selection.root?.getAttribute('aria-label') ?? null]));
    });
    expect(mounted).toEqual({ a: 'Editor A', b: 'Editor B', o: 'Editor O', n: 'Nested editor' });
    await page.evaluate(() => (window as any).multi.mountX());
    await expect(page.getByLabel('Editor X')).toHaveCount(1);
    const x = await page.evaluate(() => {
      const eng = (window as any).multi.x;
      (window as any).__x = eng;
      return eng.internals.selection.root?.getAttribute('aria-label') ?? null;
    });
    expect(x).toBe('Editor X');
    await page.evaluate(() => (window as any).multi.unmountX());
    await expect(page.getByLabel('Editor X')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__x.internals.selection.root)).toBeNull();
  });
});
