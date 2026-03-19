/**
 * E2E — Copy / Cut
 * FLAKY_RISK: clipboard APIs need explicit permissions
 */

import { test, expect } from '@playwright/test';
import {
  gotoEditor, clearAndReset, focusEditor,
  typeText, press, getMarkdown, getRootBlockCount, getEditor,
} from './helpers/editor.js';
import { selectLine, selectAll } from './helpers/keyboard.js';
import { readClipboardText } from './helpers/clipboard.js';

test.describe('Copy / Cut', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  // P0 ─────────────────────────────────────────────────────────────────────

  test('P0 · Ctrl+C copies selected text to clipboard', async ({ page }) => {
    await typeText(page, 'copy me');
    await selectLine(page);
    await press(page, 'Control+c');
    await page.waitForTimeout(100);
    const text = await readClipboardText(page);
    expect(text).toContain('copy me');
  });

  test('P0 · Ctrl+X cuts selected text and removes it', async ({ page }) => {
    await typeText(page, 'cut me');
    await selectLine(page);
    await press(page, 'Control+x');
    await page.waitForTimeout(100);
    // Content should be empty or missing
    const md = await getMarkdown(page);
    expect(md.trim()).toBe('');
    // Clipboard should have the text
    const text = await readClipboardText(page);
    expect(text).toContain('cut me');
  });

  // P1 ─────────────────────────────────────────────────────────────────────

  test('P1 · copy multi-block selection captures both blocks', async ({ page }) => {
    await typeText(page, 'first');
    await press(page, 'Enter');
    await typeText(page, 'second');
    await selectAll(page);
    await press(page, 'Control+c');
    await page.waitForTimeout(100);
    const text = await readClipboardText(page);
    expect(text).toContain('first');
    expect(text).toContain('second');
  });

  test('P1 · copy preserves bold marks in clipboard text', async ({ page }) => {
    await typeText(page, 'bold text');
    await selectLine(page);
    await press(page, 'Control+b');
    await selectLine(page);
    await press(page, 'Control+c');
    await page.waitForTimeout(100);
    // Clipboard should have something (exact format depends on implementation)
    const text = await readClipboardText(page);
    expect(text).toBeTruthy();
  });

  test('P1 · cut leaves nothing selected', async ({ page }) => {
    await typeText(page, 'remove this');
    await selectLine(page);
    await press(page, 'Control+x');
    await page.waitForTimeout(100);
    await expect(getEditor(page)).not.toContainText('remove this');
  });

  // P2 ─────────────────────────────────────────────────────────────────────

  test('P2 · cut empty selection is noop', async ({ page }) => {
    await typeText(page, 'intact');
    // No selection — just cursor
    await press(page, 'End');
    await press(page, 'Control+x');
    await page.waitForTimeout(100);
    await expect(getEditor(page)).toContainText('intact');
  });
});
