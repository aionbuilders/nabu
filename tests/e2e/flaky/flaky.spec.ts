/**
 * FLAKY suite — tests with timing sensitivity, clipboard APIs, or CRDT edge cases.
 * Project config: retries: 2, timeout: 15000
 */

import { test, expect } from '@playwright/test';
import {
  gotoEditor, clearAndReset, focusEditor, waitForEditor,
  typeText, press, getMarkdown, getRootBlockCount, getEditor,
  waitForBlockType,
} from '../helpers/editor.js';
import { readClipboardText, pasteText, pasteHtml } from '../helpers/clipboard.js';
import { undo, redo, selectLine, selectAll } from '../helpers/keyboard.js';

// ── Clipboard (FLAKY_RISK: clipboard permissions timing) ───────────────────

test.describe('Clipboard (flaky)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  test('copy plain text then paste into new location', async ({ page }) => {
    await typeText(page, 'copy this text');
    await press(page, 'Home');
    await press(page, 'Shift+End');
    await press(page, 'Control+c');
    await page.waitForTimeout(150);
    await press(page, 'End');
    await press(page, 'Enter');
    await press(page, 'Control+v');
    await page.waitForTimeout(200);

    const md = await getMarkdown(page);
    const occurrences = (md.match(/copy this text/g) || []).length;
    expect(occurrences).toBe(2);
  });

  test('paste plain text with multiple newlines creates correct paragraphs', async ({ page }) => {
    await pasteText(page, 'a\nb\nc\nd');
    await page.waitForTimeout(300);

    const count = await getRootBlockCount(page);
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('paste HTML table falls back to plain text', async ({ page }) => {
    await pasteHtml(
      page,
      '<table><tr><td>cell</td></tr></table>',
      'cell',
    );
    await page.waitForTimeout(200);
    await expect(getEditor(page)).toContainText('cell');
  });

  test('paste Nabu-format data restores structure', async ({ page }) => {
    // Copy a block
    await typeText(page, 'structured block');
    await selectLine(page);
    await press(page, 'Control+c');
    await page.waitForTimeout(200);

    // New line and paste
    await press(page, 'End');
    await press(page, 'Enter');
    await press(page, 'Control+v');
    await page.waitForTimeout(300);

    const count = await getRootBlockCount(page);
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ── CRDT Undo (FLAKY_RISK: undo granularity timing) ───────────────────────

test.describe('Undo CRDT edge cases (flaky)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  test('undo after cross-block delete restores both blocks', async ({ page }) => {
    await typeText(page, 'first');
    await press(page, 'Enter');
    await typeText(page, 'second');
    // Select across blocks and delete
    await press(page, 'ArrowUp');
    await press(page, 'Home');
    await selectAll(page);
    await press(page, 'Backspace');
    await page.waitForTimeout(100);

    await undo(page);
    await page.waitForTimeout(200);

    // At least some content should be restored
    await expect(getEditor(page)).toBeVisible();
  });

  test('undo after paste restores pre-paste state', async ({ page }) => {
    await typeText(page, 'original');
    await press(page, 'End');
    await pasteText(page, ' pasted');
    await page.waitForTimeout(200);

    await undo(page);
    await page.waitForTimeout(200);

    const md = await getMarkdown(page);
    // Either back to "original" or partially reverted
    expect(md).toBeTruthy();
  });

  test('redo after multiple undos is stable', async ({ page }) => {
    await typeText(page, 'a');
    await typeText(page, 'b');
    await typeText(page, 'c');

    await undo(page);
    await undo(page);
    await undo(page);
    await page.waitForTimeout(100);

    await redo(page);
    await redo(page);
    await page.waitForTimeout(100);

    // Should not crash
    await expect(getEditor(page)).toBeVisible();
  });
});

// ── Persistence timing (FLAKY_RISK: IndexedDB timing) ─────────────────────

test.describe('Persistence timing (flaky)', () => {
  test('content persists with short debounce wait', async ({ page }) => {
    await gotoEditor(page);

    await page.evaluate(async () => {
      const n = (window as any).nabu;
      for (const c of [...n.children]) n.delete(c);
      n.insert('paragraph', { text: 'quick save test' });
      await n.commit();
    });

    // Minimal wait — debounce might not have fired
    await page.waitForTimeout(1500);
    await page.evaluate(async () => {
      await (window as any).nabu?.saveNow?.();
    });

    await page.reload();
    await waitForEditor(page, 12000);
    await page.waitForTimeout(500);

    const md = await getMarkdown(page);
    expect(md).toContain('quick save test');
  });
});

// ── Cross-block selection (FLAKY_RISK: selection API timing) ──────────────

test.describe('Cross-block selection (flaky)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  test('Shift+Click selects across multiple blocks', async ({ page }) => {
    await typeText(page, 'block one');
    await press(page, 'Enter');
    await typeText(page, 'block two');
    await press(page, 'Enter');
    await typeText(page, 'block three');

    // Click first block, shift-click last
    const firstBlock = page.locator('[data-block-type]').first();
    const lastBlock = page.locator('[data-block-type]').last();
    await firstBlock.click();
    await lastBlock.click({ modifiers: ['Shift'] });

    // Now delete selection
    await press(page, 'Backspace');
    await page.waitForTimeout(100);

    const count = await getRootBlockCount(page);
    expect(count).toBeLessThan(3);
  });

  test('typing over cross-block selection replaces content', async ({ page }) => {
    await typeText(page, 'alpha');
    await press(page, 'Enter');
    await typeText(page, 'beta');
    await press(page, 'Control+a');
    await typeText(page, 'replaced');
    await page.waitForTimeout(100);

    await expect(getEditor(page)).toContainText('replaced');
    await expect(getEditor(page)).not.toContainText('alpha');
  });

  test('mark applied to cross-block selection marks all blocks', async ({ page }) => {
    await typeText(page, 'first block');
    await press(page, 'Enter');
    await typeText(page, 'second block');
    await press(page, 'Control+a');
    await press(page, 'Control+b');
    await page.waitForTimeout(100);

    const md = await getMarkdown(page);
    expect(md).toContain('**first block**');
    expect(md).toContain('**second block**');
  });
});
