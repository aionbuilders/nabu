/**
 * E2E — Paste
 * Plain text, HTML, Markdown, and Nabu-native paste
 * FLAKY_RISK: clipboard APIs need explicit permissions
 */

import { test, expect } from '@playwright/test';
import {
  gotoEditor, clearAndReset, focusEditor,
  typeText, press, getMarkdown, getRootBlockCount, getEditor, waitForBlockType,
} from './helpers/editor.js';
import { pasteText, pasteHtml } from './helpers/clipboard.js';

test.describe('Paste', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  // P0 ─────────────────────────────────────────────────────────────────────

  test('P0 · paste plain text inserts content at cursor', async ({ page }) => {
    await pasteText(page, 'pasted plain text');
    await expect(getEditor(page)).toContainText('pasted plain text');
  });

  test('P0 · paste creates multiple paragraphs from newline-separated text', async ({ page }) => {
    await pasteText(page, 'line one\n\nline two\n\nline three');
    await page.waitForTimeout(200);
    const count = await getRootBlockCount(page);
    expect(count).toBeGreaterThanOrEqual(2);
    await expect(getEditor(page)).toContainText('line one');
    await expect(getEditor(page)).toContainText('line three');
  });

  test('P0 · paste HTML with <strong> creates bold', async ({ page }) => {
    await pasteHtml(page, '<p>Hello <strong>bold</strong> world</p>', 'Hello bold world');
    await page.waitForTimeout(200);
    const md = await getMarkdown(page);
    expect(md).toContain('**bold**');
  });

  // P1 ─────────────────────────────────────────────────────────────────────

  test('P1 · paste HTML with <ul> creates bullet list', async ({ page }) => {
    await pasteHtml(
      page,
      '<ul><li>alpha</li><li>beta</li></ul>',
      '- alpha\n- beta',
    );
    await page.waitForTimeout(300);
    await waitForBlockType(page, 'list');
    const md = await getMarkdown(page);
    expect(md).toContain('alpha');
    expect(md).toContain('beta');
  });

  test('P1 · paste markdown heading creates heading block', async ({ page }) => {
    await pasteText(page, '# My Heading');
    await page.waitForTimeout(300);
    // await waitForBlockType(page, 'heading');
    const md = await getMarkdown(page);
    expect(md).toContain('# My Heading');
  });

  test('P1 · paste markdown bullet list creates list blocks', async ({ page }) => {
    await pasteText(page, '- item one\n- item two');
    await page.waitForTimeout(300);
    await waitForBlockType(page, 'list');
    const md = await getMarkdown(page);
    expect(md).toContain('item one');
    expect(md).toContain('item two');
  });

  test('P1 · paste replaces selected text', async ({ page }) => {
    await typeText(page, 'replace me');
    await press(page, 'Home');
    await press(page, 'Shift+End');
    await pasteText(page, 'new content');
    await page.waitForTimeout(100);
    await expect(getEditor(page)).toContainText('new content');
    await expect(getEditor(page)).not.toContainText('replace me');
  });

  test('P1 · paste HTML with <em> creates italic', async ({ page }) => {
    await pasteHtml(page, '<p><em>italic</em> text</p>', 'italic text');
    await page.waitForTimeout(200);
    const md = await getMarkdown(page);
    expect(md).toContain('*italic*');
  });

  // P2 ─────────────────────────────────────────────────────────────────────

  test('P2 · paste at end of non-empty paragraph appends correctly', async ({ page }) => {
    await typeText(page, 'existing ');
    await pasteText(page, 'pasted');
    await page.waitForTimeout(100);
    await expect(getEditor(page)).toContainText('existing pasted');
  });

  test('P2 · paste HTML with mixed tags parses correctly', async ({ page }) => {
    await pasteHtml(
      page,
      '<p>Hello <strong>bold</strong> and <em>italic</em></p>',
      'Hello bold and italic',
    );
    await page.waitForTimeout(200);
    const md = await getMarkdown(page);
    expect(md).toContain('**bold**');
    expect(md).toContain('*italic*');
  });
});
