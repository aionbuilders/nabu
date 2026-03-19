/**
 * E2E — Structural Navigation
 * Arrow keys, cross-block cursor movement
 */

import { test, expect } from '@playwright/test';
import {
  gotoEditor, clearAndReset, focusEditor,
  typeText, press, getEditor, getRootBlockCount,
  getMarkdown, insertBlock,
} from './helpers/editor.js';

test.describe('Structural Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  // P0 ─────────────────────────────────────────────────────────────────────

  test('P0 · ArrowDown moves cursor to next block', async ({ page }) => {
    await typeText(page, 'first');
    await press(page, 'Enter');
    await typeText(page, 'second');
    // Go back up then down
    await press(page, 'ArrowUp');
    await press(page, 'ArrowDown');
    // Type at cursor position in second block
    await typeText(page, 'X');
    const md = await getMarkdown(page);
    expect(md).toContain('secondX');
  });

  test('P0 · ArrowUp moves cursor to previous block', async ({ page }) => {
    await typeText(page, 'first');
    await press(page, 'Enter');
    await typeText(page, 'second');
    await press(page, 'ArrowUp');
    await typeText(page, 'X');
    const md = await getMarkdown(page);
    expect(md).toContain('firstX');
  });

  test('P0 · heading block renders with correct tag', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('heading', { level: 1, text: 'My Heading' });
      await n.commit();
    });
    await expect(page.locator('[data-block-type="heading"]')).toBeVisible();
    await expect(getEditor(page)).toContainText('My Heading');
  });

  // P1 ─────────────────────────────────────────────────────────────────────

  test('P1 · cursor at end of last block does nothing on ArrowDown', async ({ page }) => {
    await typeText(page, 'only block');
    await press(page, 'End');
    await press(page, 'ArrowDown');
    // Should still show the same content
    await expect(getEditor(page)).toContainText('only block');
  });

  test('P1 · cursor at start of first block does nothing on ArrowUp', async ({ page }) => {
    await typeText(page, 'only block');
    await press(page, 'Home');
    await press(page, 'ArrowUp');
    await expect(getEditor(page)).toContainText('only block');
  });

  test('P1 · multiple blocks are ordered correctly in DOM', async ({ page }) => {
    await typeText(page, 'a');
    await press(page, 'Enter');
    await typeText(page, 'b');
    await press(page, 'Enter');
    await typeText(page, 'c');

    const text = await getEditor(page).textContent();
    const aIdx = text?.indexOf('a') ?? -1;
    const bIdx = text?.indexOf('b') ?? -1;
    const cIdx = text?.indexOf('c') ?? -1;
    expect(aIdx).toBeLessThan(bIdx);
    expect(bIdx).toBeLessThan(cIdx);
  });

  test('P1 · blocks have data-block-id attributes', async ({ page }) => {
    await typeText(page, 'para one');
    const firstBlock = await page.locator('[data-block-id]').first();
    const id = await firstBlock.getAttribute('data-block-id');
    expect(id).toBeTruthy();
    expect(id).toMatch(/\d+/);
  });

  test('P1 · inserting heading then paragraph preserves block order', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('heading', { level: 2, text: 'Title' });
      n.insert('paragraph', { text: 'Body text' });
      await n.commit();
    });

    const count = await getRootBlockCount(page);
    expect(count).toBe(2);
    await expect(getEditor(page)).toContainText('Title');
    await expect(getEditor(page)).toContainText('Body text');
  });

  // P2 ─────────────────────────────────────────────────────────────────────

  test('P2 · 20 paragraphs render without error', async ({ page }) => {
    for (let i = 0; i < 19; i++) {
      await typeText(page, `line ${i}`);
      await press(page, 'Enter');
    }
    await typeText(page, 'line 19');
    const count = await getRootBlockCount(page);
    expect(count).toBe(20);
  });
});
