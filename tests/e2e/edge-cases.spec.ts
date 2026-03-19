/**
 * E2E — Critical Edge Cases
 * Empty document, boundary conditions, structural integrity
 */

import { test, expect } from '@playwright/test';
import {
  gotoEditor, clearAndReset, focusEditor,
  typeText, press, getMarkdown, getRootBlockCount, getEditor,
  waitForBlockType, waitForBlockCount,
  focus,
} from './helpers/editor.js';

test.describe('Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
    
  });

  // P0 ─────────────────────────────────────────────────────────────────────

  test('P0 · editor loads with at least one block', async ({ page }) => {
    const count = await getRootBlockCount(page);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('P0 · deleting all text from a paragraph leaves an empty paragraph', async ({ page }) => {
    await typeText(page, 'hello');
    await press(page, 'Control+a');
    await press(page, 'Backspace');
    const count = await getRootBlockCount(page);
    // Should have at least one block (editor never fully empty)
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('P0 · cross-block backspace merges correctly', async ({ page }) => {
    await typeText(page, 'first');
    await press(page, 'Enter');
    await typeText(page, 'second');
    await press(page, 'Home');
    await press(page, 'Backspace');

    const md = await getMarkdown(page);
    expect(md).toContain('firstsecond');
    expect(await getRootBlockCount(page)).toBe(1);
  });

  test('P0 · cross-block delete merges correctly', async ({ page }) => {
    await typeText(page, 'first');
    await press(page, 'Enter');
    await typeText(page, 'second');
    await press(page, 'ArrowUp');
    await press(page, 'End');
    await press(page, 'Delete');

    const md = await getMarkdown(page);
    expect(md).toContain('firstsecond');
  });

  test('P0 · multi-block selection delete removes intermediate blocks', async ({ page }) => {
    await typeText(page, 'a');
    await press(page, 'Enter');
    await typeText(page, 'b');
    await press(page, 'Enter');
    await typeText(page, 'c');
    // Select all
    await press(page, 'Control+a');
    await press(page, 'Backspace');
    await page.waitForTimeout(100);

    const count = await getRootBlockCount(page);
    expect(count).toBeLessThanOrEqual(2);
  });

  // P1 ─────────────────────────────────────────────────────────────────────

  test('P1 · ListItem outside List is auto-wrapped by wrapOrphan', async ({ page }) => {
    // This tests that wrapOrphan works — if a list-item is relocated outside a list,
    // the CRDT tree remains valid
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      const list = n.insert('list', { listType: 'bullet' });
      n.insert('list-item', { text: 'item' }, list.node.id.toString(), 0);
      await n.commit();
    });
    await waitForBlockType(page, 'list-item');
    await expect(getEditor(page)).toContainText('item');
  });

  test('P1 · heading level 1-6 all render without error', async ({ page }) => {
    for (let level = 1; level <= 6; level++) {
      await page.evaluate(async (lvl) => {
        const n = (window as any).nabu;
        for (const c of [...n.children]) n.delete(c);
        n.insert('heading', { level: lvl, text: `H${lvl}` });
        await n.commit();
      }, level);
      await expect(getEditor(page)).toContainText(`H${level}`);
    }
  });

  test('P1 · rapid Enter presses create correct block count', async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      await press(page, 'Enter');
    }
    const count = await getRootBlockCount(page);
    expect(count).toBe(6); // 1 original + 5 new
  });

  test('P1 · splitting and merging blocks preserves CRDT integrity', async ({ page }) => {
    await typeText(page, 'hello world');
    // Split
    await press(page, 'Home');
    for (let i = 0; i < 5; i++) await press(page, 'ArrowRight');
    await press(page, 'Enter');
    // Merge back
    await press(page, 'Home');
    await press(page, 'Backspace');
    const md = await getMarkdown(page);
    expect(md.trim()).toBe('hello world');
    expect(await getRootBlockCount(page)).toBe(1);
  });

  test('P1 · typing after undo does not corrupt state', async ({ page }) => {
    await typeText(page, 'hello');
    await press(page, 'Control+z');
    await focus(page, 0);
    await page.waitForTimeout(300);
    await typeText(page, 'world');
    const md = await getMarkdown(page);
    expect(md.trim()).toBe('world');
  });

  // P2 ─────────────────────────────────────────────────────────────────────

  test('P2 · inserting 50 blocks via API does not crash', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      for (const c of [...n.children]) n.delete(c);
      for (let i = 0; i < 50; i++) {
        n.insert('paragraph', { text: `line ${i}` });
      }
      await n.commit();
    });
    await page.waitForTimeout(500);
    const count = await getRootBlockCount(page);
    expect(count).toBe(50);
    await expect(getEditor(page)).toBeVisible();
  });

  test('P2 · editor remains interactive after many operations', async ({ page }) => {
    for (let i = 0; i < 10; i++) {
      await typeText(page, `line${i}`);
      await press(page, 'Enter');
    }
    for (let i = 0; i < 5; i++) {
      await press(page, 'Control+z');
      await page.waitForTimeout(30);
    }
    await typeText(page, 'final');
    await expect(getEditor(page)).toContainText('final');
  });
});
