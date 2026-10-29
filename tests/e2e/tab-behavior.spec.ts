/**
 * E2E — the `tab` option (audit P-41), driven by REAL keys.
 *
 *  - Structural meanings of Tab (list indent, code indentation, region title demote / promote) are the same under EVERY mode.
 *  - In a plain text block the mode decides: 'focus' (the browser moves the focus), 'stay' (swallowed; Escape then Tab leaves),
 *    'indent' (a tab character; Shift+Tab removes it).
 *  - The default of the route (a Full editor) is 'stay'; an explicit `tab` option wins.
 *  - `--nb-paragraph-indent` (layout, not content): applied to paragraphs except the first of a text.
 *
 * A focusable button is placed before and after the editor by the test (`#before` / `#after`) to see where the focus goes.
 */

import { test, expect, type Page } from './helpers/test.js';
import { gotoEditor, clearAndReset, press } from './helpers/editor.js';
import { undo } from './helpers/keyboard.js';
import { buildTree, tree, Pp, Code, Hr, type TreeSpec } from './helpers/blocks.js';
import { outline, focusAt, focusEnd, focusEmpty, selectRange, violations } from './helpers/model.js';

type Mode = 'focus' | 'stay' | 'indent';
const MODES: Mode[] = ['focus', 'stay', 'indent'];

/** Put a button before and after the editor, so that the focus has somewhere to go in both directions. */
async function addProbes(page: Page) {
  await page.evaluate(() => {
    const main = document.querySelector('main')!;
    const before = Object.assign(document.createElement('button'), { id: 'before', textContent: 'before' });
    const after = Object.assign(document.createElement('button'), { id: 'after', textContent: 'after' });
    main.before(before);
    main.after(after);
  });
}
/** Put the focus back in the editor (a programmatic selection does not take it from a button). */
const refocus = (page: Page) => page.evaluate(() => (document.querySelector('[data-nabu-root]') as HTMLElement).focus());
const active = (page: Page) => page.evaluate(() => document.activeElement?.id || (document.activeElement?.closest('[data-nabu-root]') ? 'editor' : document.activeElement?.tagName || ''));
const expectActive = (page: Page, id: string) => expect.poll(() => active(page), { timeout: 3000, message: 'focused element' }).toBe(id);
const expectTree = (page: Page, expected: string) => expect.poll(() => tree(page), { timeout: 3000, message: 'model tree' }).toBe(expected);
const expectOutline = (page: Page, expected: string) => expect.poll(() => outline(page), { timeout: 3000, message: 'outline' }).toBe(expected);

async function open(page: Page, tab?: Mode, extra: Record<string, unknown> = {}) {
  await gotoEditor(page, { options: { ...(tab ? { tab } : {}), ...extra } });
  await clearAndReset(page);
  await addProbes(page);
}
const S1 = (title: string, ...children: TreeSpec[]): TreeSpec => ({ type: 'region', props: { regionType: 'section-1', title }, children });

// ════════════════════════════════════════════════════════════════════════════
// Defaults, option and announcement
// ════════════════════════════════════════════════════════════════════════════

test.describe('tab option: default and announcement', () => {
  test('a Full editor (the route) defaults to "stay"; an explicit option wins', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => (window as any).nabu.tab)).toBe('stay');
    await open(page, 'focus');
    expect(await page.evaluate(() => (window as any).nabu.tab)).toBe('focus');
    await open(page, 'indent');
    expect(await page.evaluate(() => (window as any).nabu.tab)).toBe('indent');
  });

  test('an unknown mode (and the not-yet-implemented "nest") falls back to the preset default', async ({ page }) => {
    await open(page, 'nest' as Mode);
    expect(await page.evaluate(() => (window as any).nabu.tab)).toBe('stay');
    await open(page, 'bogus' as Mode);
    expect(await page.evaluate(() => (window as any).nabu.tab)).toBe('stay');
  });

  test('"stay" and "indent" announce the way out on the editor root; "focus" says nothing; the text is overridable', async ({ page }) => {
    const root = () => page.locator('[data-nabu-root]');
    await open(page, 'stay');
    await expect(root()).toHaveAttribute('aria-description', 'Press Escape then Tab to leave the editor');
    await open(page, 'indent');
    await expect(root()).toHaveAttribute('aria-description', 'Press Escape then Tab to leave the editor');
    await open(page, 'focus');
    await expect(root()).not.toHaveAttribute('aria-description');
    await open(page, 'stay', { tabHint: 'Échap puis Tab pour sortir' });
    await expect(root()).toHaveAttribute('aria-description', 'Échap puis Tab pour sortir');
    await open(page, 'stay', { tabHint: false });
    await expect(root()).not.toHaveAttribute('aria-description');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 'focus'
// ════════════════════════════════════════════════════════════════════════════

test.describe("tab: 'focus'", () => {
  test.beforeEach(async ({ page }) => { await open(page, 'focus'); });

  test('Tab and Shift+Tab in a paragraph leave the editor, the text is untouched', async ({ page }) => {
    await buildTree(page, [Pp('hello')]);
    await focusEnd(page, 'hello');
    await press(page, 'Tab');
    await expectActive(page, 'after');
    await expectTree(page, 'p(hello)');
    await refocus(page);
    await focusEnd(page, 'hello');
    await press(page, 'Shift+Tab');
    await expectActive(page, 'before');
    await expectTree(page, 'p(hello)');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 'stay'
// ════════════════════════════════════════════════════════════════════════════

test.describe("tab: 'stay'", () => {
  test.beforeEach(async ({ page }) => { await open(page, 'stay'); await buildTree(page, [Pp('hello')]); await focusEnd(page, 'hello'); });

  test('Tab and Shift+Tab are swallowed: the focus and the caret stay, the text is untouched', async ({ page }) => {
    await press(page, 'Tab');
    await press(page, 'Shift+Tab');
    await press(page, 'Tab');
    await expectActive(page, 'editor');
    await expectTree(page, 'p(hello)');
    await page.keyboard.type('!');
    await expectTree(page, 'p(hello!)');
  });

  test('Escape then Tab leaves the editor; Escape then Shift+Tab leaves backwards', async ({ page }) => {
    await press(page, 'Escape');
    await press(page, 'Tab');
    await expectActive(page, 'after');
    await refocus(page);
    await focusEnd(page, 'hello');
    await press(page, 'Escape');
    await press(page, 'Shift+Tab');
    await expectActive(page, 'before');
    await expectTree(page, 'p(hello)');
  });

  test('the way out is for ONE key: a second Tab (back in the editor) is swallowed again', async ({ page }) => {
    await press(page, 'Escape');
    await press(page, 'Tab');
    await expectActive(page, 'after');
    await press(page, 'Shift+Tab'); // the focus comes back into the editor
    await expectActive(page, 'editor');
    await press(page, 'Tab');
    await expectActive(page, 'editor');
  });

  test('a typed key after Escape re-arms the trap', async ({ page }) => {
    await press(page, 'Escape');
    await page.keyboard.type('x');
    await press(page, 'Tab');
    await expectActive(page, 'editor');
    await expectTree(page, 'p(hellox)');
  });

  test('an arrow key or a click after Escape re-arms the trap', async ({ page }) => {
    await press(page, 'Escape');
    await press(page, 'ArrowLeft');
    await press(page, 'Tab');
    await expectActive(page, 'editor');
    await press(page, 'Escape');
    await page.locator('[data-block-type="paragraph"]').click();
    await press(page, 'Tab');
    await expectActive(page, 'editor');
  });

  test('the Shift of Shift+Tab does not re-arm the trap', async ({ page }) => {
    await press(page, 'Escape');
    await page.keyboard.down('Shift');
    await press(page, 'Tab');
    await page.keyboard.up('Shift');
    await expectActive(page, 'before');
  });

  test('an Escape that closes the slash menu is consumed by it: the next Tab stays', async ({ page }) => {
    await buildTree(page, [Pp('')]);
    await focusEmpty(page);
    await page.keyboard.type('/');
    await expect(page.locator('.nabu-slash')).toBeVisible();
    await press(page, 'Escape');
    await expect(page.locator('.nabu-slash')).toHaveCount(0);
    await press(page, 'Tab');
    await expectActive(page, 'editor');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 'indent'
// ════════════════════════════════════════════════════════════════════════════

test.describe("tab: 'indent'", () => {
  test.beforeEach(async ({ page }) => { await open(page, 'indent'); });

  test('Tab inserts a tab character at the caret; one undo step; focus stays', async ({ page }) => {
    await buildTree(page, [Pp('abcd')]);
    await focusAt(page, 'abcd', 2);
    await press(page, 'Tab');
    await expectTree(page, 'p(ab\\tcd)');
    await expectActive(page, 'editor');
    await page.keyboard.type('X');
    await expectTree(page, 'p(ab\\tXcd)');
    await undo(page);
    await undo(page);
    await expectTree(page, 'p(abcd)');
  });

  test('Tab replaces a selection inside one block', async ({ page }) => {
    await buildTree(page, [Pp('abcd')]);
    await selectRange(page, 'abcd', 1, 'abcd', 3);
    await press(page, 'Tab');
    await expectTree(page, 'p(a\\td)');
    await undo(page);
    await expectTree(page, 'p(abcd)');
  });

  test('Shift+Tab removes one tab right before the caret; else nothing, and it does not leave', async ({ page }) => {
    await buildTree(page, [Pp('ab\t\tcd')]);
    await focusAt(page, 'ab\t\tcd', 4);
    await press(page, 'Shift+Tab');
    await expectTree(page, 'p(ab\\tcd)');
    await press(page, 'Shift+Tab');
    await expectTree(page, 'p(abcd)');
    await press(page, 'Shift+Tab');
    await expectTree(page, 'p(abcd)');
    await expectActive(page, 'editor');
    await page.keyboard.type('X');
    await expectTree(page, 'p(abXcd)');
  });

  test('a selection across several blocks: Tab and Shift+Tab do nothing special (like "stay")', async ({ page }) => {
    await buildTree(page, [Pp('one'), Pp('two')]);
    await selectRange(page, 'one', 1, 'two', 2);
    await press(page, 'Tab');
    await press(page, 'Shift+Tab');
    await expectTree(page, 'p(one) ; p(two)');
    await expectActive(page, 'editor');
  });

  test('Escape then Tab leaves the editor (no keyboard trap)', async ({ page }) => {
    await buildTree(page, [Pp('abcd')]);
    await focusAt(page, 'abcd', 2);
    await press(page, 'Escape');
    await press(page, 'Tab');
    await expectActive(page, 'after');
    await expectTree(page, 'p(abcd)');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Structural meanings keep priority, whatever the mode
// ════════════════════════════════════════════════════════════════════════════

for (const mode of MODES) {
  test.describe(`structural Tab under tab: '${mode}'`, () => {
    test.beforeEach(async ({ page }) => { await open(page, mode); });

    test('list: Tab indents, Shift+Tab outdents, the focus stays', async ({ page }) => {
      await buildTree(page, [{ type: 'list', props: { listType: 'bullet' }, children: [{ type: 'list-item', text: 'a' }, { type: 'list-item', text: 'b' }] }]);
      await focusEnd(page, 'b');
      await press(page, 'Tab');
      await expectOutline(page, 'ul[a > ul[b]]');
      await expectActive(page, 'editor');
      await press(page, 'Shift+Tab');
      await expectOutline(page, 'ul[a, b]');
      await expectActive(page, 'editor');
    });

    test('list: Tab on the first item (nothing to indent under) does not leave the editor', async ({ page }) => {
      await buildTree(page, [{ type: 'list', props: { listType: 'bullet' }, children: [{ type: 'list-item', text: 'a' }] }]);
      await focusEnd(page, 'a');
      await press(page, 'Tab');
      await expectOutline(page, 'ul[a]');
      await expectActive(page, 'editor');
    });

    test('code: Tab inserts two spaces, Shift+Tab removes them', async ({ page }) => {
      await buildTree(page, [Code('ab')]);
      await focusAt(page, 'ab', 1);
      await press(page, 'Tab');
      await expectTree(page, 'code(a  b)');
      await expectActive(page, 'editor');
      await press(page, 'Home');
      await press(page, 'Tab');
      await expectTree(page, 'code(  a  b)');
      await press(page, 'Shift+Tab');
      await expectTree(page, 'code(a  b)');
      await expectActive(page, 'editor');
    });

    test('region title: Tab demotes, Shift+Tab promotes', async ({ page }) => {
      await buildTree(page, [S1('A', Pp('a')), S1('Bee', Pp('b'))]);
      await focusAt(page, 'Bee', 1);
      await press(page, 'Tab');
      await expectOutline(page, 'R:section-1(A){ p(a) ; R:section-2(Bee){ p(b) } }');
      await expectActive(page, 'editor');
      await press(page, 'Shift+Tab');
      await expectOutline(page, 'R:section-1(A){ p(a) } ; R:section-1(Bee){ p(b) }');
      await expectActive(page, 'editor');
    });
  });
}

test.describe('structural Tab does not use the Escape way out', () => {
  test("list: Escape then Tab still indents (the key keeps its structural meaning)", async ({ page }) => {
    await open(page, 'stay');
    await buildTree(page, [{ type: 'list', props: { listType: 'bullet' }, children: [{ type: 'list-item', text: 'a' }, { type: 'list-item', text: 'b' }] }]);
    await focusEnd(page, 'b');
    await press(page, 'Escape');
    await press(page, 'Tab');
    await expectOutline(page, 'ul[a > ul[b]]');
    await expectActive(page, 'editor');
  });
});

// The one structural Tab that DOES give way: in a code block Tab indents, which made the block a keyboard trap (WCAG 2.1.2).
// Escape then Tab (the CodeMirror / GitHub convention) leaves it, under every mode; the language select is reached with Escape then Shift+Tab.
for (const mode of MODES) {
  test.describe(`code block way out (tab: ${mode})`, () => {
    const select = (page: Page) => page.locator('select.nabu-code-lang');

    test('Escape then Tab moves the focus out of the editor and writes nothing', async ({ page }) => {
      await open(page, mode);
      await buildTree(page, [Code('ab')]);
      await focusAt(page, 'ab', 1);
      await press(page, 'Escape');
      await press(page, 'Tab');
      await expectActive(page, 'after');
      await expectTree(page, 'code(ab)');
    });

    test('Escape then Shift+Tab reaches the language select, which works with the keyboard', async ({ page }) => {
      await open(page, mode);
      await buildTree(page, [Code('ab')]);
      await focusAt(page, 'ab', 1);
      await press(page, 'Escape');
      await press(page, 'Shift+Tab');
      await expect(select(page)).toBeFocused();
      await expectTree(page, 'code(ab)');
      await page.keyboard.type('py'); // a select picks the option that starts with the typed letters
      await expectTree(page, 'code:python(ab)');
      // and the focus can go on in both directions
      await press(page, 'Tab');
      await expectActive(page, 'after');
    });

    test('without an Escape, Tab and Shift+Tab keep their meaning (indent, outdent)', async ({ page }) => {
      await open(page, mode);
      await buildTree(page, [Code('ab')]);
      await focusAt(page, 'ab', 1);
      await press(page, 'Tab');
      await expectTree(page, 'code(a  b)');
      await press(page, 'Home');
      await press(page, 'Tab');
      await expectTree(page, 'code(  a  b)');
      await press(page, 'Shift+Tab');
      await expectTree(page, 'code(a  b)');
      await expectActive(page, 'editor');
    });

    test('Escape, then another key, then Tab: the way out is closed again, Tab indents', async ({ page }) => {
      await open(page, mode);
      await buildTree(page, [Code('ab')]);
      await focusAt(page, 'ab', 1);
      await press(page, 'Escape');
      await page.keyboard.type('x');
      await press(page, 'Tab');
      await expectTree(page, 'code(ax  b)');
      await expectActive(page, 'editor');
      // an arrow key closes it too
      await press(page, 'Escape');
      await press(page, 'ArrowLeft');
      await press(page, 'Tab');
      await expectTree(page, 'code(ax    b)'); // the caret was after the two spaces, one step left, and Tab added two more
      await expectActive(page, 'editor');
    });

    test('the way out is used once: the next Tab indents again', async ({ page }) => {
      await open(page, mode);
      await buildTree(page, [Code('ab'), Pp('')]);
      await focusAt(page, 'ab', 1);
      await press(page, 'Escape');
      await press(page, 'Shift+Tab'); // select
      await refocus(page);
      await focusAt(page, 'ab', 1);
      await press(page, 'Tab');
      await expectTree(page, 'code(a  b) ; p(∅)');
    });

    test('a click closes the way out', async ({ page }) => {
      await open(page, mode);
      await buildTree(page, [Code('ab')]);
      await focusAt(page, 'ab', 1);
      await press(page, 'Escape');
      await page.locator('pre[data-block-type="code"]').click();
      await press(page, 'Tab');
      await expectActive(page, 'editor');
      expect(await tree(page)).toContain('  ');
    });

    test('Escape alone in the code changes nothing (text, caret, focus)', async ({ page }) => {
      await open(page, mode);
      await buildTree(page, [Code('ab')]);
      await focusAt(page, 'ab', 1);
      await press(page, 'Escape');
      await expectTree(page, 'code(ab)');
      await expectActive(page, 'editor');
      await page.keyboard.type('x');
      await expectTree(page, 'code(axb)');
    });

    test('outside code nothing changed: Escape then Tab in a paragraph follows the mode', async ({ page }) => {
      await open(page, mode);
      await buildTree(page, [Pp('hello'), Code('ab')]);
      await focusEnd(page, 'hello');
      await press(page, 'Escape');
      await expectTree(page, 'p(hello) ; code(ab)');
      await press(page, 'Tab');
      // 'indent' and 'stay' leave with Escape then Tab, 'focus' leaves with any Tab: always out
      await expectActive(page, 'after');
      await expectTree(page, 'p(hello) ; code(ab)');
    });

    test('a plain Tab in a paragraph before a code block does not land on the select', async ({ page }) => {
      await open(page, 'focus');
      await buildTree(page, [Pp('hello'), Code('ab')]);
      await focusEnd(page, 'hello');
      await press(page, 'Tab');
      await expectActive(page, 'after');
    });
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Paragraph indent: --nb-paragraph-indent
// ════════════════════════════════════════════════════════════════════════════

const indents = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll('[data-block-type="paragraph"]')].map((el) => [el.textContent, getComputedStyle(el).textIndent]));

test.describe('--nb-paragraph-indent', () => {
  const doc = (): TreeSpec[] => [
    Pp('start'), Pp('second'),
    { type: 'heading', text: 'Title', props: { level: 1 } }, Pp('after heading'), Pp('next'),
    Hr(), Pp('after divider'), Pp('again'),
    S1('Part', Pp('first of region'), Pp('second of region')),
    Pp('after region'),
  ];

  test('applied to paragraphs, except the first of the document, of a region, and after a heading or a divider', async ({ page }) => {
    await gotoEditor(page, { vars: '--nb-paragraph-indent:20px' });
    await clearAndReset(page);
    await buildTree(page, doc());
    expect(await indents(page)).toEqual([
      ['start', '0px'],
      ['second', '20px'],
      ['after heading', '0px'],
      ['next', '20px'],
      ['after divider', '0px'],
      ['again', '20px'],
      ['first of region', '0px'],
      ['second of region', '20px'],
      ['after region', '20px'],
    ]);
    expect(await violations(page)).toEqual([]);
  });

  test('defaults to 0: nothing is indented', async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await buildTree(page, doc());
    expect((await indents(page)).every(([, v]) => v === '0px')).toBe(true);
  });
});
