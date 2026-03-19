/**
 * E2E — Lists (bullet and ordered)
 * Tab/Shift+Tab for indent/unindent, Enter to create items, empty item to exit
 */

import { test, expect } from '@playwright/test';
import {
  gotoEditor, clearAndReset, focusEditor,
  typeText, press, getMarkdown, getRootBlockCount,
  getEditor, waitForBlockType,
} from './helpers/editor.js';
import { indent, unindent } from './helpers/keyboard.js';

test.describe('Lists', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    // Insert a list via API to start
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      const list = n.insert('list', { listType: 'bullet' });
      n.insert('list-item', { text: '' }, list.node.id.toString(), 0);
      await n.commit();
    });
    await page.waitForTimeout(50);
    // Click the first list item to focus it
    await page.locator('[data-block-type="list-item"]').first().click();
  });

  // P0 ─────────────────────────────────────────────────────────────────────

  test('P0 · Enter inside list item creates new list item', async ({ page }) => {
    await typeText(page, 'item one');
    await press(page, 'Enter');
    await typeText(page, 'item two');

    const md = await getMarkdown(page);
    expect(md).toContain('item one');
    expect(md).toContain('item two');
    expect(md).toMatch(/^- item one\n- item two/m);
  });

  test('P0 · Enter on empty list item exits list and creates paragraph', async ({ page }) => {
    await typeText(page, 'item');
    await press(page, 'Enter');
    // New item is empty — press Enter again to exit
    await press(page, 'Enter');

    await waitForBlockType(page, 'paragraph');
    const count = await getRootBlockCount(page);
    expect(count).toBeGreaterThanOrEqual(2); // list + paragraph
  });

  test('P0 · Tab indents a list item into nested list', async ({ page }) => {
    await typeText(page, 'parent');
    await press(page, 'Enter');
    await typeText(page, 'child');
    await indent(page);

    const md = await getMarkdown(page);
    expect(md).toContain('  - child');
  });

  test('P0 · Shift+Tab unindents a nested list item', async ({ page }) => {
    await typeText(page, 'parent');
    await press(page, 'Enter');
    await typeText(page, 'child');
    await indent(page);
    await unindent(page);

    const md = await getMarkdown(page);
    // After unindent, child should be at same level as parent
    expect(md).toMatch(/^- parent\n- child/m);
  });

  // P1 ─────────────────────────────────────────────────────────────────────

  test('P1 · list renders with correct DOM structure', async ({ page }) => {
    await typeText(page, 'item');
    await expect(page.locator('[data-block-type="list"]')).toBeVisible();
    await expect(page.locator('[data-block-type="list-item"]')).toBeVisible();
  });

  test('P1 · ordered list renders correctly', async ({ page }) => {
    // Replace bullet with ordered via API
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      for (const c of [...n.children]) n.delete(c);
      const list = n.insert('list', { listType: 'ordered' });
      n.insert('list-item', { text: 'first' }, list.node.id.toString(), 0);
      n.insert('list-item', { text: 'second' }, list.node.id.toString(), 1);
      await n.commit();
    });

    const md = await getMarkdown(page);
    expect(md).toContain('1. first');
    expect(md).toContain('2. second');
  });

  test('P1 · multiple levels of nesting work', async ({ page }) => {
    await typeText(page, 'level1');
    await press(page, 'Enter');
    await typeText(page, 'level2');
    await indent(page);
    await press(page, 'ArrowRight'); // Move cursor to end of "level2" to ensure indenting creates nested list
    await press(page, 'Enter');
    await typeText(page, 'level3');
    await indent(page);

    const md = await getMarkdown(page);
    expect(md).toContain('- level1');
    expect(md).toContain('  - level2');
    expect(md).toContain('    - level3');
  });

  test('P1 · Tab does nothing when item is first in list', async ({ page }) => {
    await typeText(page, 'first item');
    // Can't indent first item
    await indent(page);
    // Should not crash and item should still be there
    await expect(getEditor(page)).toContainText('first item');
  });

  test('P1 · list:indent exec action works', async ({ page }) => {
    await typeText(page, 'first');
    await press(page, 'Enter');
    await typeText(page, 'second');
    await page.evaluate(() => (window as any).nabu.exec('list:indent'));
    await page.waitForTimeout(100);
    const md = await getMarkdown(page);
    expect(md).toContain('  - second');
  });

  // P2 ─────────────────────────────────────────────────────────────────────

  test('P2 · Backspace at start of list item merges with previous item', async ({ page }) => {
    await typeText(page, 'first');
    await press(page, 'Enter');
    await typeText(page, 'second');
    await press(page, 'Home');
    await press(page, 'Backspace');

    const md = await getMarkdown(page);
    expect(md).toContain('firstsecond');
  });

  test('P2 · list survives undo', async ({ page }) => {
    await typeText(page, 'item');
    await press(page, 'Enter');
    await typeText(page, 'item2');
    await press(page, 'Control+z');
    await page.waitForTimeout(100);
    await expect(getEditor(page)).toBeVisible();
  });
});
