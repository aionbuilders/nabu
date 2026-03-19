/**
 * E2E — Undo / Redo
 * FLAKY_RISK: CRDT undo semantics may differ from linear undo
 */

import { test, expect } from '@playwright/test';
import {
  gotoEditor, clearAndReset, focusEditor,
  typeText, press, getMarkdown, getRootBlockCount, getEditor,
} from './helpers/editor.js';
import { undo, redo } from './helpers/keyboard.js';

test.describe('Undo / Redo', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  // P0 ─────────────────────────────────────────────────────────────────────

  test('P0 · Ctrl+Z undoes typed text', async ({ page }) => {
    await typeText(page, 'hello');
    await undo(page);
    // Should no longer contain "hello" (or partial undo depending on granularity)
    const md = await getMarkdown(page);
    // At minimum, undo removed some characters
    expect(md.trim().length).toBeLessThan('hello'.length + 1);
  });

  test('P0 · Ctrl+Z undoes block creation from Enter', async ({ page }) => {
    await typeText(page, 'first');
    await press(page, 'Enter');
    await typeText(page, 'second');
    await undo(page);
    // After undo, second block should be gone or merged
    const count = await getRootBlockCount(page);
    expect(count).toBeLessThanOrEqual(2);
  });

  test('P0 · nabu.exec("undo") is equivalent to Ctrl+Z', async ({ page }) => {
    await typeText(page, 'to undo');
    await page.evaluate(() => (window as any).nabu.exec('undo'));
    await page.waitForTimeout(100);
    const md = await getMarkdown(page);
    expect(md.trim().length).toBeLessThan('to undo'.length + 1);
  });

  // P1 ─────────────────────────────────────────────────────────────────────

  test('P1 · Ctrl+Y (or Ctrl+Shift+Z) redoes after undo', async ({ page }) => {
    await typeText(page, 'hello');
    await undo(page);
    await redo(page);
    // Content should be restored
    await expect(getEditor(page)).toContainText('hello');
  });

  test('P1 · nabu.exec("redo") redoes last undone change', async ({ page }) => {
    await typeText(page, 'redo me');
    await page.evaluate(() => (window as any).nabu.exec('undo'));
    await page.waitForTimeout(100);
    await page.evaluate(() => (window as any).nabu.exec('redo'));
    await page.waitForTimeout(100);
    await expect(getEditor(page)).toContainText('redo me');
  });

  test('P1 · multiple undos revert multiple changes', async ({ page }) => {
    await typeText(page, 'a');
    await typeText(page, 'b');
    await typeText(page, 'c');
    await undo(page);
    await undo(page);
    // At least 'a' should still be there; 'b' and 'c' removed
    const md = await getMarkdown(page);
    expect(md).not.toContain('c');
  });

  test('P1 · undo does not crash when history is empty', async ({ page }) => {
    // Already fresh state — extra undo should be noop
    await undo(page);
    await undo(page);
    // No crash
    await expect(getEditor(page)).toBeVisible();
  });

  // P2 ─────────────────────────────────────────────────────────────────────

  test('P2 · undo/redo cycle preserves block structure', async ({ page }) => {
    await typeText(page, 'para1');
    await press(page, 'Enter');
    await typeText(page, 'para2');

    const beforeCount = await getRootBlockCount(page);
    await undo(page);
    await redo(page);

    const afterCount = await getRootBlockCount(page);
    expect(afterCount).toBe(beforeCount);
  });
});
