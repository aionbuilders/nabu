/**
 * E2E — the automatic DOM / selection invariant (helpers/dom-invariant.ts, run by the auto fixture of helpers/test.ts after EVERY test).
 *
 * This file proves the checker itself: it reports a stray whitespace line / element between blocks (negative tests), accepts the
 * legitimate lines (empty paragraph, trailing spaces, code, images ...), and leaves the selection, the focus and the model alone.
 * The negative tests create odd DOM on purpose, so the whole file opts out of the AUTOMATIC check (`domInvariant: false`) and asserts
 * on `checkDomInvariant` directly.
 */

import { test, expect, type Page } from './helpers/test.js';
import { gotoEditor, clearAndReset, flushRender } from './helpers/editor.js';
import { buildTree, Pp, Tog, Hr, Code, type TreeSpec } from './helpers/blocks.js';
import { focusAt, selectRange, caret } from './helpers/model.js';
import { checkDomInvariant } from './helpers/dom-invariant.js';

test.use({ domInvariant: false }); // odd DOM on purpose: asserted below with checkDomInvariant

const SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="#888"/></svg>');
const li = (text: string, ...children: TreeSpec[]): TreeSpec => ({ type: 'list-item', text, children });
const list = (listType: string, ...items: TreeSpec[]): TreeSpec => ({ type: 'list', props: { listType }, children: items });

async function boot(page: Page, specs: TreeSpec[]) {
  await gotoEditor(page);
  await clearAndReset(page);
  await buildTree(page, specs);
  await flushRender(page);
}

/** Insert a DOM node `where` the first block whose text is `text`: 'before' it, as a sibling. */
async function stray(page: Page, text: string, kind: 'text' | 'inline-element' | 'br' | 'empty-block') {
  await page.evaluate(({ text, kind }) => {
    const blocks = [...document.querySelectorAll('[data-nabu-root] [data-block-id]')];
    const target = blocks.find((b) => b.textContent === text)!;
    let node: Node;
    if (kind === 'text') node = document.createTextNode(' ');
    else if (kind === 'br') node = document.createElement('br');
    else {
      const el = document.createElement(kind === 'empty-block' ? 'div' : 'span');
      el.style.cssText = kind === 'empty-block' ? 'height:24px' : 'display:inline-block;width:12px;height:24px';
      node = el;
    }
    target.parentNode!.insertBefore(node, target);
  }, { text, kind });
}

const DOC: TreeSpec[] = [Pp('first'), Pp('second'), Tog('Toggle', [Pp('inside'), Pp('inside two')]), list('bullet', li('one', list('ordered', li('sub'))), li('two')), Pp('last')];

test.describe('the checker reports a stray line', () => {
  test.beforeEach(async ({ page }) => { await boot(page, DOC); });

  test('a clean document has no violation', async ({ page }) => {
    expect(await checkDomInvariant(page)).toEqual([]);
  });

  test('a whitespace text node between two root blocks (rule a and rule b), with the block ids', async ({ page }) => {
    await stray(page, 'second', 'text');
    const v = await checkDomInvariant(page);
    expect(v.some((m) => m.startsWith('whitespace-only text node'))).toBe(true);
    const phantom = v.find((m) => m.startsWith('phantom selectable box'));
    expect(phantom, v.join('\n')).toBeTruthy();
    expect(phantom).toMatch(/gap between blocks/);
    expect(phantom).toMatch(/previous block: paragraph#\S+; next block: paragraph#\S+/);
  });

  test('a whitespace text node between two blocks INSIDE a container (toggle body)', async ({ page }) => {
    await stray(page, 'inside two', 'text');
    const v = await checkDomInvariant(page);
    expect(v.some((m) => m.startsWith('phantom selectable box') && /gap between blocks|container/.test(m)), v.join('\n')).toBe(true);
  });

  test('a whitespace text node between two list items', async ({ page }) => {
    await stray(page, 'two', 'text');
    const v = await checkDomInvariant(page);
    expect(v.length, v.join('\n')).toBeGreaterThan(0);
  });

  test('a stray inline element with height between two blocks', async ({ page }) => {
    await stray(page, 'second', 'inline-element');
    const v = await checkDomInvariant(page);
    expect(v.some((m) => m.startsWith('phantom selectable box') && /<span/.test(m)), v.join('\n')).toBe(true);
  });

  test('a stray <br> and a stray empty block with height between two blocks', async ({ page }) => {
    await stray(page, 'second', 'br');
    expect((await checkDomInvariant(page)).some((m) => /<br>/.test(m))).toBe(true);
    await stray(page, 'last', 'empty-block');
    expect((await checkDomInvariant(page)).some((m) => /<div/.test(m))).toBe(true);
  });

  test('a stray element in a container, between its children', async ({ page }) => {
    await stray(page, 'inside two', 'inline-element');
    const v = await checkDomInvariant(page);
    expect(v.some((m) => m.startsWith('phantom selectable box') && /gap between blocks|container/.test(m)), v.join('\n')).toBe(true);
  });

  test('a stray whitespace text node inside a leaf block markup that is not a text container (image)', async ({ page }) => {
    await boot(page, [Pp('x'), { type: 'image', props: { ref: SVG, alt: 'an image' } }, Pp('y')]);
    await page.evaluate(() => {
      const img = document.querySelector('[data-nabu-root] img')!;
      img.parentNode!.insertBefore(document.createTextNode('\n  '), img);
    });
    const v = await checkDomInvariant(page);
    expect(v.some((m) => m.startsWith('whitespace-only text node')), v.join('\n')).toBe(true);
  });
});

test.describe('the checker accepts legitimate lines', () => {
  test('empty paragraphs, trailing spaces, a lone space, soft breaks, code, divider, image, marks', async ({ page }) => {
    await boot(page, [
      Pp(''), Pp('trailing   '), Pp('   '), Pp('soft\nbreak\n'), Pp('a very long paragraph '.repeat(30)),
      Code('const a = 1;\n\n\nconst b = 2;\n', 'js'), Code('', null), Hr(),
      { type: 'image', props: { ref: SVG, alt: 'an image' } },
      { type: 'heading', text: '', props: { level: 2 } }, { type: 'heading', text: 'Title', props: { level: 1 } },
      { type: 'callout', text: '', props: { variant: 'tip' } }, { type: 'blockquote', text: ' ' },
      Tog('', []), Tog('Header', [Pp('')], true),
      list('todo', li(''), li('item', list('bullet', li('')))),
    ]);
    expect(await checkDomInvariant(page)).toEqual([]);
  });

  test('returns [] on a page without an editor root', async ({ page }) => {
    await page.goto('about:blank');
    expect(await checkDomInvariant(page)).toEqual([]);
  });
});

test.describe('the check is read-only', () => {
  test('selection (DOM + model), focus and the DOM itself are untouched and no selectionchange fires', async ({ page }) => {
    await boot(page, DOC);
    await selectRange(page, 'first', 1, 'inside', 3);
    await flushRender(page);
    const snap = () => page.evaluate(() => {
      const s = window.getSelection()!;
      return {
        anchor: s.anchorNode && [s.anchorNode.nodeName, s.anchorNode.textContent, s.anchorOffset],
        focus: s.focusNode && [s.focusNode.nodeName, s.focusNode.textContent, s.focusOffset],
        active: document.activeElement?.tagName + '.' + document.activeElement?.className,
        html: document.querySelector('[data-nabu-root]')!.innerHTML,
        model: JSON.stringify((window as any).nabu.selection.range ?? null),
      };
    });
    const before = await snap();
    const beforeCaret = await caret(page);
    await page.evaluate(() => { (window as any).__sc = 0; document.addEventListener('selectionchange', () => (window as any).__sc++); });
    expect(await checkDomInvariant(page)).toEqual([]);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => (window as any).__sc), 'selectionchange events fired by the check').toBe(0);
    expect(await snap()).toEqual(before);
    expect(await caret(page)).toBe(beforeCaret);
    // and a collapsed caret
    await focusAt(page, 'last', 2);
    const c = await caret(page);
    await checkDomInvariant(page);
    expect(await caret(page)).toBe(c);
  });
});

test.describe('opt-out', () => {
  test('the annotation `skip-dom-invariant` silences the automatic check for one test', async ({ page }) => {
    test.info().annotations.push({ type: 'skip-dom-invariant', description: 'this test deliberately injects a stray whitespace node' });
    await boot(page, DOC);
    await stray(page, 'second', 'text');
    expect((await checkDomInvariant(page)).length).toBeGreaterThan(0);
  });
});
