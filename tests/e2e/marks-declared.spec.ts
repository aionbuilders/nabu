/**
 * E2E — a mark exists in an editor only if one of its extensions declares it in `loroTextStyles`.
 *
 * Route /e2e/marks (src/routes/e2e/marks): four editors on one page, a REAL paste (clipboard write + Ctrl+V) in each:
 *   full     every mark                          minimal  MinimalPreset, no mark
 *   bold     MinimalPreset + a `bold` declaration  lists    MinimalPreset + lists + markdown paste, no mark
 * What does not come in as a mark: the text stays, the model has no attribute, the DOM has no mark element (`.nabu-bold`, `<a>`...).
 */

import { test, expect, type Page } from './helpers/test.js';
import { collectErrors } from './helpers/model.js';
import { pasteHtml } from './helpers/clipboard.js';
import { copy } from './helpers/clip-capture.js';
import { Keys } from './helpers/keyboard.js';

type Key = 'full' | 'minimal' | 'bold' | 'lists';

const HTML = '<p>a <b>bold</b> <i>italic</i> <code>code</code> <a href="https://example.com">link</a> z</p>';
const LIST = '<ul><li><b>one</b><ul><li><i>two</i><ul><li><a href="https://example.com">three</a></li></ul></li></ul></li></ul>';
// A mark is drawn as a classed <span> (`nabu-bold`...) or an <a>; the semantic tags are listed too, in case the paste kept raw HTML.
const INLINE = '.nabu-bold, .nabu-italic, .nabu-underline, .nabu-code, .nabu-strikethrough, a, strong, em, b, i, code, u, s, del';

let errors: ReturnType<typeof collectErrors>;

test.beforeEach(async ({ page }) => {
  errors = collectErrors(page);
  await page.goto('/e2e/marks', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__marks_ready === true && document.querySelectorAll('[data-nabu-root]').length === 4, null, { timeout: 15000 });
});

test.afterEach(() => {
  expect(errors.list(), 'console / page errors').toEqual([]);
});

const root = (page: Page, key: Key) => page.getByLabel(`Editor ${key}`);

/** A real click in the (empty) editor, so that the caret and the focus are in it. */
async function focus(page: Page, key: Key) {
  await root(page, key).locator('[data-block-type="paragraph"]').first().click();
}

/** Every attribute of every text of the document of an editor, as sorted unique names. */
const marksOf = (page: Page, key: Key) => page.evaluate((k) => {
  const n = (window as any).marks[k];
  const found = new Set<string>();
  for (const b of n.blocks.values()) for (const op of b.behaviors?.get('text')?.container?.toDelta() ?? []) Object.keys(op.attributes ?? {}).forEach((a) => found.add(a));
  return [...found].sort();
}, key);

/** The attributes of the `serialize('json')` runs (anything but `text`), at any depth. */
const jsonMarksOf = (page: Page, key: Key) => page.evaluate((k) => {
  const found = new Set<string>();
  const walk = (b: any) => {
    for (const run of Array.isArray(b.content) ? b.content : []) Object.keys(run).filter((a) => a !== 'text').forEach((a) => found.add(a));
    (b.children ?? []).forEach(walk);
  };
  const json = (window as any).marks[k].serialize('json');
  (typeof json === 'string' ? JSON.parse(json) : json).blocks.forEach(walk);
  return [...found].sort();
}, key);

test.describe('HTML paste', () => {
  test('1 · MinimalPreset: the text is there, the model has no mark, the DOM has no inline element', async ({ page }) => {
    await focus(page, 'minimal');
    await pasteHtml(page, HTML, 'a bold italic code link z');
    await expect(root(page, 'minimal')).toContainText('a bold italic code link z');
    expect(await marksOf(page, 'minimal')).toEqual([]);
    expect(await jsonMarksOf(page, 'minimal')).toEqual([]);
    await expect(root(page, 'minimal').locator(INLINE)).toHaveCount(0);
  });

  test('2 · FullPreset: every mark is kept, in the model and in the DOM', async ({ page }) => {
    await focus(page, 'full');
    await pasteHtml(page, HTML, 'a bold italic code link z');
    await expect(root(page, 'full')).toContainText('a bold italic code link z');
    expect(await marksOf(page, 'full')).toEqual(['bold', 'code', 'italic', 'link']);
    await expect(root(page, 'full').locator('a.nabu-link')).toHaveCount(1);
    await expect(root(page, 'full').locator('.nabu-bold')).toHaveCount(1);
  });

  test('3 · a preset declaring only bold keeps bold and drops the others', async ({ page }) => {
    await focus(page, 'bold');
    await pasteHtml(page, HTML, 'a bold italic code link z');
    await expect(root(page, 'bold')).toContainText('a bold italic code link z');
    expect(await marksOf(page, 'bold')).toEqual(['bold']);
    await expect(root(page, 'bold').locator('.nabu-bold')).toHaveCount(1);
    await expect(root(page, 'bold').locator('a, .nabu-italic, .nabu-code')).toHaveCount(0);
  });
});

test.describe('the other ways in', () => {
  test('4 · importJSON and importMarkdown into an editor without marks', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).marks.lists;
      await n.importJSON({ version: '1', blocks: [{ type: 'paragraph', content: [{ text: 'json ' }, { text: 'bold', bold: true }, { text: ' link', link: 'https://example.com' }] }] });
    });
    await expect(root(page, 'lists')).toContainText('json bold link');
    expect(await marksOf(page, 'lists')).toEqual([]);

    await page.evaluate(async () => (window as any).marks.lists.importMarkdown('md **bold** *it* [link](https://example.com)'));
    await expect(root(page, 'lists')).toContainText('md bold it link');
    expect(await marksOf(page, 'lists')).toEqual([]);
    await expect(root(page, 'lists').locator(INLINE)).toHaveCount(0);
  });

  test('5 · a copy from a Full editor pasted into a Minimal one on the same page (Nabu clipboard format): no marks', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).marks.full;
      await n.importMarkdown('copy **bold** and *italic* and [link](https://example.com)');
    });
    await expect(root(page, 'full').locator('.nabu-bold')).toHaveCount(1);
    await root(page, 'full').locator('[data-block-type="paragraph"]').first().click();
    await page.keyboard.press(Keys.selectAll);
    const ev = await copy(page);
    expect(ev.nabuRaw).toContain('"bold":true');

    await focus(page, 'minimal');
    await page.evaluate((raw) => {
      const dt = new DataTransfer();
      dt.setData('application/x-nabu+json', raw);
      (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, ev.nabuRaw);
    await expect(root(page, 'minimal')).toContainText('copy bold and italic and link');
    expect(await marksOf(page, 'minimal')).toEqual([]);
    await expect(root(page, 'minimal').locator(INLINE)).toHaveCount(0);
    // the source keeps its marks
    expect(await marksOf(page, 'full')).toEqual(['bold', 'italic', 'link']);
  });

  test('6 · nested children: a list pasted into Minimal (degraded) and into an editor with lists has no mark at any depth', async ({ page }) => {
    await focus(page, 'minimal');
    await pasteHtml(page, LIST, 'one\ntwo\nthree');
    await expect(root(page, 'minimal')).toContainText('three');
    expect(await marksOf(page, 'minimal')).toEqual([]);
    await expect(root(page, 'minimal').locator(INLINE)).toHaveCount(0);

    await focus(page, 'lists');
    await pasteHtml(page, LIST, 'one\ntwo\nthree');
    await expect(root(page, 'lists').locator('[data-block-type="list-item"]')).toHaveCount(3);
    expect(await marksOf(page, 'lists')).toEqual([]);
    expect(await jsonMarksOf(page, 'lists')).toEqual([]);
    await expect(root(page, 'lists').locator(INLINE)).toHaveCount(0);
  });
});
