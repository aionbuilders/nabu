/**
 * E2E — the caret never rests on a NON-TEXT position (P-34) and the document always offers a caret after its
 * last block (P-35), driven by REAL keyboard / mouse input.
 *
 * Around a Toggle (arrow button + collapsible body), a Divider and an Image (void blocks) the browser parks the
 * native caret on wrappers / the editor root; the engine moves it to the nearest text position in the direction
 * of travel, so every arrow press lands in a text block at once and the next keystroke is never swallowed.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, clearAndReset, press } from './helpers/editor.js';
import { undo } from './helpers/keyboard.js';
import { caret, violations, focusAt, focusEnd, collectErrors } from './helpers/model.js';
import { buildTree, tree, Tog, Hr, Pp, type TreeSpec } from './helpers/blocks.js';

const SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="#888"/></svg>');
const Img = (): TreeSpec => ({ type: 'image', props: { ref: SVG, alt: 'x' } });

/** Text of the block holding the caret (the `|` caret marker removed), or the raw description when outside a text block. */
const inBlock = async (page: Page) => (await caret(page))?.replace('|', '');
const expectCaret = (page: Page, expected: string) =>
  expect.poll(() => caret(page), { timeout: 3000, message: 'caret' }).toBe(expected);
const expectTree = (page: Page, expected: string | RegExp) =>
  expect.poll(() => tree(page), { timeout: 3000, message: 'model tree' })[expected instanceof RegExp ? 'toMatch' : 'toBe'](expected as never);
async function expectValid(page: Page) {
  const v = (await violations(page)).filter((x) => !x.startsWith('DOM has') && !x.startsWith('DOM block'));
  expect(v).toEqual([]);
}

let errors: ReturnType<typeof collectErrors>;
test.beforeEach(async ({ page }) => {
  errors = collectErrors(page);
  await gotoEditor(page);
  await clearAndReset(page);
});
test.afterEach(async () => {
  expect(errors.list(), 'console / page errors').toEqual([]);
});

test.describe('P-34 · expanded Toggle', () => {
  test('ArrowDown / ArrowUp go header -> body -> after -> body -> header, one press each', async ({ page }) => {
    await buildTree(page, [Tog('Head', [Pp('body')]), Pp('after')]);
    await focusEnd(page, 'Head');
    await press(page, 'ArrowDown');
    expect(await inBlock(page)).toBe('body');
    await press(page, 'ArrowDown');
    expect(await inBlock(page)).toBe('after');
    await press(page, 'ArrowUp');
    expect(await inBlock(page)).toBe('body');
    await press(page, 'ArrowUp');
    expect(await inBlock(page)).toBe('Head');
    await page.keyboard.type('X');
    await expectTree(page, 'toggle▾(HeadX){p(body)} ; p(after)');
    await expectValid(page);
  });

  test('ArrowRight / ArrowLeft cross header end <-> body start and body end <-> after, one press each', async ({ page }) => {
    await buildTree(page, [Tog('Head', [Pp('body')]), Pp('after')]);
    await focusEnd(page, 'Head');
    await press(page, 'ArrowRight');
    await expectCaret(page, '|body');
    await press(page, 'ArrowLeft');
    await expectCaret(page, 'Head|');
    await focusEnd(page, 'body');
    await press(page, 'ArrowRight');
    await expectCaret(page, '|after');
    await press(page, 'ArrowLeft');
    await expectCaret(page, 'body|');
    await page.keyboard.type('Y');
    await expectTree(page, 'toggle▾(Head){p(bodyY)} ; p(after)');
    await expectValid(page);
  });

  test('a COLLAPSED toggle is stepped over in both directions and its hidden body is never entered', async ({ page }) => {
    await buildTree(page, [Pp('before'), Tog('Head', [Pp('body')], true), Pp('after')]);
    await focusEnd(page, 'before');
    await press(page, 'ArrowDown');
    expect(await inBlock(page)).toBe('Head');
    await press(page, 'ArrowDown');
    expect(await inBlock(page)).toBe('after');
    await press(page, 'ArrowUp');
    expect(await inBlock(page)).toBe('Head');
    await press(page, 'ArrowRight');
    await expectCaret(page, '|after');
    await press(page, 'ArrowLeft');
    await expectCaret(page, 'Head|');
    await page.keyboard.type('Z');
    await expectTree(page, 'p(before) ; toggle▸(HeadZ){p(body)} ; p(after)');
  });

  test('Backspace at the start of the block after a collapsed toggle never merges into the hidden body', async ({ page }) => {
    await buildTree(page, [Tog('Head', [Pp('body')], true), Pp('after')]);
    await focusAt(page, 'after', 0);
    await press(page, 'Backspace');
    await expectTree(page, 'toggle▸(Headafter){p(body)}');
  });
});

for (const [name, Void] of [['Divider', Hr], ['Image', Img]] as const) {
  const tag = name === 'Divider' ? 'hr' : 'image(∅)';
  test.describe(`P-34 · ${name} (void block)`, () => {
    test('ArrowDown / ArrowUp / ArrowRight / ArrowLeft cross it in ONE press and typing is never swallowed', async ({ page }) => {
      await buildTree(page, [Pp('above'), Void(), Pp('below')]);
      await focusEnd(page, 'above');
      await press(page, 'ArrowDown');
      expect(await inBlock(page)).toBe('below');
      await press(page, 'ArrowUp');
      expect(await inBlock(page)).toBe('above');
      await focusEnd(page, 'above');
      await press(page, 'ArrowRight');
      await expectCaret(page, '|below');
      await press(page, 'ArrowLeft');
      await expectCaret(page, 'above|');
      await page.keyboard.type('X');
      await expectTree(page, `p(aboveX) ; ${tag} ; p(below)`);
      await expectValid(page);
    });

    test('ArrowRight / ArrowDown out of the last text block create ONE empty paragraph after a trailing ' + name.toLowerCase() + ' (one undo step); nothing is created on load', async ({ page }) => {
      await buildTree(page, [Pp('above'), Void()]);
      await expectTree(page, `p(above) ; ${tag}`); // never created eagerly
      await focusEnd(page, 'above');
      await press(page, 'ArrowRight');
      await page.keyboard.type('X');
      await expectTree(page, `p(above) ; ${tag} ; p(X)`);
      await undo(page);
      await undo(page);
      await expectTree(page, `p(above) ; ${tag}`);

      await buildTree(page, [Pp('above'), Void()]);
      await focusEnd(page, 'above');
      await press(page, 'ArrowDown');
      await page.keyboard.type('Y');
      await expectTree(page, `p(above) ; ${tag} ; p(Y)`);
      await expectValid(page);
    });

    test('a click in the empty area BELOW a trailing ' + name.toLowerCase() + ' creates an empty paragraph with the caret in it', async ({ page }) => {
      await buildTree(page, [Pp('above'), Void()]);
      const box = (await page.locator('[data-nabu-root]').boundingBox())!;
      await page.mouse.click(box.x + 40, box.y + box.height - 8);
      await page.keyboard.type('Q');
      await expectTree(page, `p(above) ; ${tag} ; p(Q)`);
      await expectValid(page);
    });

    test('a click below a trailing void when the document ENDS WITH TEXT creates nothing', async ({ page }) => {
      await buildTree(page, [Void(), Pp('last')]);
      const box = (await page.locator('[data-nabu-root]').boundingBox())!;
      await page.mouse.click(box.x + 40, box.y + box.height - 8);
      await page.keyboard.type('Q');
      expect(await tree(page)).toMatch(new RegExp(`^${tag.replace(/[()]/g, '\\$&')} ; p\\(.*Q.*\\)$`));
    });
  });
}

test.describe('P-34 · typing never lands on a dead caret', () => {
  test('Enter / Backspace right after a press that parked the native caret on a wrapper still act on the text block', async ({ page }) => {
    await buildTree(page, [Pp('above'), Hr(), Pp('below')]);
    await focusAt(page, 'below', 0);
    await press(page, 'ArrowLeft');
    await press(page, 'Enter');
    await expectTree(page, 'p(above) ; p(∅) ; hr ; p(below)');
  });
});
