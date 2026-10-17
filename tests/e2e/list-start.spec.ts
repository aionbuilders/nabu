/**
 * E2E — ordered lists keep their start number (P-14): "3. " shortcut, markdown / HTML paste,
 * Enter, adjacent-list merge, Tab, JSON round trip, and ordered-under-bullet adjacency.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, clearAndReset, focusEditor, press, getJson, getSelection } from './helpers/editor.js';
import { pasteText, pasteHtml } from './helpers/clipboard.js';
import { indent } from './helpers/keyboard.js';

const md = (page: Page) => page.evaluate(() => (window as any).nabu.serialize('markdown'));
/** Props of the first list in the document (a pasted list lands after the empty paragraph that was focused). */
const listProps = async (page: Page) => (await getJson(page)).blocks.find((b: any) => b.type === 'list')?.props;
/** Types char by char with a short pause: the model caret must follow each key (see shortcuts-slash.spec.ts). */
async function typeSlow(page: Page, text: string) {
  for (const c of text) { await page.keyboard.type(c); await page.waitForTimeout(40); }
}

test.describe('List start number', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
    await expect.poll(async () => (await getSelection(page))?.focusBlockId).toBeTruthy();
  });

  test('P1 · "3. a" Enter "b" numbers 3, 4 in the DOM start attribute and in markdown', async ({ page }) => {
    await typeSlow(page, '3. a');
    await press(page, 'Enter');
    await typeSlow(page, 'b');

    await expect(page.locator('ol[data-block-type="list"]')).toHaveAttribute('start', '3');
    expect(await md(page)).toBe('3. a\n4. b');
    expect((await getJson(page)).blocks[0].props).toEqual({ listType: 'ordered', start: 3 });
  });

  test('P1 · pasting markdown "3. a / 4. b" creates a list starting at 3', async ({ page }) => {
    await pasteText(page, '3. a\n4. b');
    await expect.poll(async () => (await getJson(page)).blocks.some((b: any) => b.type === 'list')).toBe(true);

    expect(await listProps(page)).toEqual({ listType: 'ordered', start: 3 });
    expect(await md(page)).toContain('3. a\n4. b');
  });

  test('P1 · pasting HTML <ol start="5"> creates a list starting at 5', async ({ page }) => {
    await pasteHtml(page, '<ol start="5"><li>a</li><li>b</li></ol>', 'a\nb');
    await expect.poll(async () => (await getJson(page)).blocks.some((b: any) => b.type === 'list')).toBe(true);

    expect(await listProps(page)).toEqual({ listType: 'ordered', start: 5 });
    await expect(page.locator('ol[data-block-type="list"]')).toHaveAttribute('start', '5');
  });

  test('P1 · a list typed right under another ordered list merges into it and keeps the FIRST start', async ({ page }) => {
    await typeSlow(page, '3. a');
    await press(page, 'Enter');
    await press(page, 'Enter'); // exit the list: an empty paragraph right under it
    await expect.poll(async () => (await getJson(page)).blocks.map((b: any) => b.type)).toEqual(['list', 'paragraph']);
    await typeSlow(page, '7. b');

    await expect.poll(async () => (await getJson(page)).blocks.length).toBe(1);
    expect((await getJson(page)).blocks[0].props).toEqual({ listType: 'ordered', start: 3 });
    expect(await md(page)).toBe('3. a\n4. b');
  });

  test('P1 · an ordered list typed under a BULLET list stays a separate list (it used to be destroyed)', async ({ page }) => {
    await typeSlow(page, '- a');
    await press(page, 'Enter');
    await press(page, 'Enter');
    await expect.poll(async () => (await getJson(page)).blocks.map((b: any) => b.type)).toEqual(['list', 'paragraph']);
    await typeSlow(page, '1. b');

    await expect.poll(async () => (await getJson(page)).blocks.map((b: any) => b.props?.listType)).toEqual(['bullet', 'ordered']);
    expect(await md(page)).toBe('- a\n\n1. b');
  });

  test('P1 · indenting an item under a list that starts at 3 makes a nested list that starts at 1', async ({ page }) => {
    await typeSlow(page, '3. a');
    await press(page, 'Enter');
    await typeSlow(page, 'b');
    await indent(page);

    await expect.poll(async () => md(page)).toBe('3. a\n  1. b');
    expect((await getJson(page)).blocks[0].props).toEqual({ listType: 'ordered', start: 3 });
  });

  test('P1 · JSON export -> import round-trips the start', async ({ page }) => {
    await typeSlow(page, '4. a');
    await press(page, 'Enter');
    await typeSlow(page, 'b');
    const json = await getJson(page);

    await page.evaluate(async (j) => { await (window as any).nabu.importJSON(j); }, json);
    await expect.poll(async () => md(page)).toBe('4. a\n5. b');
    expect((await getJson(page)).blocks[0].props).toEqual({ listType: 'ordered', start: 4 });
  });
});
