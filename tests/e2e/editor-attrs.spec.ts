/**
 * E2E — `<NabuEditor>` passes its other attributes to the root element, and the editor's own always win.
 *
 * Route /e2e/attrs (src/routes/e2e/attrs), rendered on the server:
 *   A  id, class, style, aria-describedby (toggled live), autocapitalize, enterkeyhint, inputmode, data-foo
 *   B  attributes the editor owns, passed by a host (contenteditable, role, data-nabu-root, lang, translate, aria-label, onkeydown)
 *   C  `readonly` toggled live
 */

import { test, expect, type Page } from './helpers/test.js';
import { collectErrors } from './helpers/model.js';

let errors: ReturnType<typeof collectErrors>;

test.beforeEach(async ({ page }) => {
  errors = collectErrors(page);
  await page.goto('/e2e/attrs', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('main[data-hydrated]') && (window as any).attrs, null, { timeout: 15000 });
});

test.afterEach(() => {
  expect(errors.list(), 'console / page errors').toEqual([]);
});

const A = (page: Page) => page.getByLabel('Editor A');
const B = (page: Page) => page.getByLabel('Editor B');
const C = (page: Page) => page.getByLabel('Editor C');

test('7 · id, aria-describedby, autocapitalize, enterkeyhint, inputmode, data-* and style reach the root', async ({ page }) => {
  const root = page.locator('[data-nabu-root]#ed-a');
  await expect(root).toHaveCount(1);
  await expect(root).toHaveAttribute('aria-describedby', 'note-1');
  await expect(root).toHaveAttribute('autocapitalize', 'sentences');
  await expect(root).toHaveAttribute('enterkeyhint', 'send');
  await expect(root).toHaveAttribute('inputmode', 'text');
  await expect(root).toHaveAttribute('data-foo', 'bar');
  await expect(root).toHaveAttribute('style', /outline-offset: 7px/);
  expect(await root.evaluate((el) => getComputedStyle(el).outlineOffset)).toBe('7px');
});

test('8 · class is merged with nabu-editor, the scoped styles still apply', async ({ page }) => {
  const root = A(page);
  await expect(root).toHaveClass(/(^|\s)mine(\s|$)/);
  await expect(root).toHaveClass(/(^|\s)nabu-editor(\s|$)/);
  // padding: 1rem comes from the scoped CSS of Nabu.svelte, min-height: 100px too
  const box = await root.evaluate((el) => { const s = getComputedStyle(el); return { padding: s.paddingLeft, minHeight: s.minHeight }; });
  expect(box).toEqual({ padding: '16px', minHeight: '100px' });
  // an editor without a class has the same styling
  expect(await C(page).evaluate((el) => getComputedStyle(el).paddingLeft)).toBe('16px');
});

test('9 · the editor\'s own attributes and handlers cannot be overridden by the host', async ({ page }) => {
  const root = B(page);
  await expect(root).toHaveAttribute('contenteditable', 'true');
  await expect(root).not.toHaveAttribute('role', 'textbox');
  await expect(root).toHaveAttribute('data-nabu-root', 'true');
  await expect(root).toHaveAttribute('translate', 'no');
  await expect(root).not.toHaveAttribute('lang', 'xx');
  await expect(root).toHaveAttribute('aria-label', 'Editor B');
  await expect(page.locator('[data-nabu-root]')).toHaveCount(3);

  // the editor's handler still runs: typing and Enter work, the host's onkeydown is not called
  await root.locator('[data-block-type="paragraph"]').first().click();
  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  await page.keyboard.type('world');
  const texts = await page.evaluate(() => (window as any).attrs.b.children.map((c: any) => c.behaviors.get('text').text));
  expect(texts).toEqual(['hello', 'world']);
  expect(await page.evaluate(() => (window as any).__hostKeydowns)).toBe(0);
});

test('10 · a reactive attribute changes live, and readonly still toggles contenteditable', async ({ page }) => {
  await expect(A(page)).toHaveAttribute('aria-describedby', 'note-1');
  await page.click('#toggle-describedby');
  await expect(A(page)).not.toHaveAttribute('aria-describedby', /.*/);
  await page.click('#toggle-describedby');
  await expect(A(page)).toHaveAttribute('aria-describedby', 'note-1');

  await expect(C(page)).toHaveAttribute('contenteditable', 'true');
  await page.click('#toggle-readonly');
  await expect(C(page)).toHaveAttribute('contenteditable', 'false');
  await expect(C(page)).toHaveAttribute('role', 'document');
  await page.click('#toggle-readonly');
  await expect(C(page)).toHaveAttribute('contenteditable', 'true');
  await expect(C(page)).not.toHaveAttribute('role', /.*/);
});

test('11 · server rendering: the attributes are in the HTML, and hydration kept the root', async ({ page }) => {
  const response = await page.request.get('/e2e/attrs');
  expect(response.ok()).toBe(true);
  const html = await response.text();
  const seen = await page.evaluate((markup) => {
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    const a = doc.querySelector('#ed-a');
    const b = doc.querySelector('[aria-label="Editor B"]');
    return {
      a: a && { root: a.hasAttribute('data-nabu-root'), cls: a.getAttribute('class'), describedby: a.getAttribute('aria-describedby'), cap: a.getAttribute('autocapitalize'), hint: a.getAttribute('enterkeyhint'), foo: a.getAttribute('data-foo'), style: a.getAttribute('style') },
      b: b && { editable: b.getAttribute('contenteditable'), role: b.getAttribute('role'), root: b.getAttribute('data-nabu-root') },
    };
  }, html);
  expect(seen.a).toMatchObject({ root: true, describedby: 'note-1', cap: 'sentences', hint: 'send', foo: 'bar' });
  expect(seen.a?.cls).toMatch(/\bmine\b/);
  expect(seen.a?.cls).toMatch(/\bnabu-editor\b/);
  expect(seen.a?.style).toContain('outline-offset: 7px');
  expect(seen.b).toEqual({ editable: 'true', role: null, root: 'true' });

  // the client took the markup over (set in beforeEach): the same elements are interactive, no console error (afterEach)
  await A(page).locator('[data-block-type="paragraph"]').first().click();
  await page.keyboard.type('ok');
  await expect(A(page)).toContainText('ok');
});
