/**
 * E2E — IME composition on Firefox.
 *
 * `keyboard.insertText` is a real composition on Firefox: Juggler calls `commitCompositionWith`, so the page gets compositionstart,
 * compositionupdate, beforeinput(insertCompositionText), compositionend, input. `keyboard.type` takes that path for every character
 * outside the US layout. The first test guards this: if Playwright changes it, this file would stop testing compositions.
 *
 * LIMITS: only a composition committed at once. Juggler has no running composition, no cancel, no real IME or dead key.
 *
 * Firefox puts composed text in a NEW text node in an empty block, where Chromium writes into the one it has, hence the DOM checks.
 */

import { test, expect, type Page } from '../helpers/test.js';
import { gotoEditor, clearAndReset, press, flushRender, getJson } from '../helpers/editor.js';
import { undo, bold } from '../helpers/keyboard.js';
import { buildBlocks, buildTree, flat, Para, H, Q, C, D, Code } from '../helpers/blocks.js';
import { buildDoc, UL, I, caret, focusAt, focusEnd, focusEmpty, selectRange, collectErrors, allText } from '../helpers/model.js';

let errors: ReturnType<typeof collectErrors>;

test.beforeEach(async ({ page }) => {
  errors = collectErrors(page);
  await gotoEditor(page);
  await clearAndReset(page);
});

test.afterEach(async () => {
  expect(errors.list(), 'console / page errors').toEqual([]);
});

/** Blocks whose rendered text is not their model text (own text nodes only, nested blocks and UI excluded). An empty block renders a lone "\n". */
const diverged = (page: Page) => page.evaluate(() => {
  const out: string[] = [];
  for (const b of (window as any).nabu.blocks.values()) {
    const tb = b.behaviors?.get('text');
    if (!tb || !b.element?.isConnected) continue;
    const walker = document.createTreeWalker(b.element, NodeFilter.SHOW_TEXT);
    let dom = '';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const nearest = n.parentElement?.closest('[data-block-id]');
      const own = nearest === b.element || !b.element.contains(nearest); // some blocks carry the id on a wrapper of their text element
      if (own && !n.parentElement?.closest('[data-nabu-ui]')) dom += (n as Text).data;
    }
    const expected = tb.text === '' ? '\n' : tb.text;
    if (dom !== expected) out.push(`${b.type}: dom ${JSON.stringify(dom)}, model ${JSON.stringify(tb.text)}`);
  }
  return out;
});

/** The caret, the model and the DOM agree, once the render settled. */
async function expectText(page: Page, expectedCaret: string) {
  await expect.poll(() => caret(page)).toBe(expectedCaret);
  await flushRender(page);
  expect(await diverged(page)).toEqual([]);
}

const compose = async (page: Page, text: string) => { await page.keyboard.insertText(text); await flushRender(page); };

test('insertText is a composition on this browser', async ({ page }) => {
  await focusEmpty(page);
  await page.evaluate(() => {
    (window as any).__events = [];
    for (const t of ['compositionstart', 'compositionend']) document.addEventListener(t, () => (window as any).__events.push(t), true);
  });
  await compose(page, 'é');
  expect(await page.evaluate(() => (window as any).__events)).toEqual(['compositionstart', 'compositionend']);
});

test.describe('an empty block', () => {
  test('an accent first, then typing: the DOM follows the model and the caret stays at the end', async ({ page }) => {
    await focusEmpty(page);
    await page.keyboard.type('été');
    await expectText(page, 'été|');
    expect(await page.locator('[data-block-type="paragraph"]').first().textContent()).toBe('été');
  });

  test('a whole French sentence, typed key by key', async ({ page }) => {
    await focusEmpty(page);
    await page.keyboard.type('à côté, ça a été très dur');
    await expectText(page, 'à côté, ça a été très dur|');
  });

  test('several characters in one composition', async ({ page }) => {
    await focusEmpty(page);
    await compose(page, 'ça');
    await page.keyboard.type('x');
    await expectText(page, 'çax|');
  });

  for (const [name, spec] of [['heading', H('')], ['quote', Q('')], ['callout', C('')], ['dialogue', D('')]] as const) {
    test(`in a ${name}`, async ({ page }) => {
      await buildBlocks(page, [spec]);
      await focusEmpty(page);
      await page.keyboard.type('été');
      await expectText(page, 'été|');
    });
  }

  test('in a code block', async ({ page }) => {
    await buildTree(page, [Code('')]);
    await focusEmpty(page);
    await page.keyboard.type('été');
    await expectText(page, 'été|');
  });

  test('in a list item', async ({ page }) => {
    await buildDoc(page, [UL(I('un'), I(''))]);
    await focusEmpty(page);
    await page.keyboard.type('été');
    await expectText(page, 'été|');
    expect(await allText(page)).toEqual(['un', 'été']);
  });

  test('after other empty blocks', async ({ page }) => {
    await buildBlocks(page, [Para('un'), Para(''), Para(''), Para('')]);
    await focusEmpty(page, 2);
    await page.keyboard.type('été');
    await expectText(page, 'été|');
    expect(await flat(page)).toBe('p(un) ; p(∅) ; p(∅) ; p(été)');
  });

  test('made by Enter', async ({ page }) => {
    await buildBlocks(page, [Para('un')]);
    await focusEnd(page, 'un');
    await press(page, 'Enter');
    await page.keyboard.type('été');
    await expectText(page, 'été|');
    expect(await flat(page)).toBe('p(un) ; p(été)');
  });

  test('emptied with Backspace', async ({ page }) => {
    await buildBlocks(page, [Para('ab')]);
    await focusEnd(page, 'ab');
    await press(page, 'Backspace');
    await press(page, 'Backspace');
    await page.keyboard.type('été');
    await expectText(page, 'été|');
  });

  test('undo goes back to empty, and the block still takes a composition', async ({ page }) => {
    await focusEmpty(page);
    await compose(page, 'é');
    await expectText(page, 'é|');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(∅)');
    await expectText(page, '|');
    await page.keyboard.type('à');
    await page.keyboard.type('x');
    await expectText(page, 'àx|');
  });

  test('with bold switched on', async ({ page }) => {
    await focusEmpty(page);
    await bold(page);
    await page.keyboard.type('été');
    await expectText(page, 'été|');
    expect((await getJson(page)).blocks[0].content).toEqual([{ text: 'été', bold: true }]);
  });
});

test.describe('a block with text', () => {
  test('at the start, in the middle, at the end', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await focusAt(page, 'abc', 0);
    await compose(page, 'é');
    await expectText(page, 'é|abc');
    await focusAt(page, 'éabc', 2);
    await compose(page, 'à');
    await expectText(page, 'éaà|bc');
    await focusEnd(page, 'éaàbc');
    await compose(page, 'ç');
    await page.keyboard.type('z');
    await expectText(page, 'éaàbcçz|');
  });

  test('after a line break', async ({ page }) => {
    await buildBlocks(page, [Para('un')]);
    await focusEnd(page, 'un');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('été');
    await expectText(page, 'un\nété|');
  });

  test('after bold text', async ({ page }) => {
    await focusEmpty(page);
    await bold(page);
    await page.keyboard.type('gras');
    await bold(page);
    await page.keyboard.type(' été');
    await expectText(page, 'gras été|');
  });

  test('at the end of a bold run, without bold switched on: not bold, shown once', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await selectRange(page, 'abc', 0, 'abc', 3);
    await bold(page);
    await focusEnd(page, 'abc');
    await compose(page, 'é');
    await expectText(page, 'abcé|');
    expect((await getJson(page)).blocks[0].content).toEqual([{ text: 'abc', bold: true }, { text: 'é' }]);
  });

  test('inside a bold run: stays bold', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await selectRange(page, 'abc', 0, 'abc', 3);
    await bold(page);
    await focusAt(page, 'abc', 1);
    await compose(page, 'é');
    await expectText(page, 'aé|bc');
    expect((await getJson(page)).blocks[0].content).toEqual([{ text: 'aébc', bold: true }]);
  });

  test('over a selection in one block', async ({ page }) => {
    await buildBlocks(page, [Para('abcd')]);
    await selectRange(page, 'abcd', 1, 'abcd', 3);
    await compose(page, 'é');
    await page.keyboard.type('x');
    await expectText(page, 'aéx|d');
  });

  test('over a selection across blocks', async ({ page }) => {
    await buildBlocks(page, [Para('abc'), Para('def')]);
    await selectRange(page, 'abc', 1, 'def', 2);
    await compose(page, 'é');
    await page.keyboard.type('x');
    await expectText(page, 'aéx|f');
    expect(await flat(page)).toBe('p(aéxf)');
  });
});
