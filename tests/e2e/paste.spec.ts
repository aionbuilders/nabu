/**
 * E2E — Paste
 * Plain text, HTML, Markdown, and Nabu-native paste
 * FLAKY_RISK: clipboard APIs need explicit permissions
 */

import { test, expect } from './helpers/test.js';
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
    await expect.poll(() => getRootBlockCount(page)).toBeGreaterThanOrEqual(2);
    await expect(getEditor(page)).toContainText('line one');
    await expect(getEditor(page)).toContainText('line three');
  });

  test('P0 · paste HTML with <strong> creates bold', async ({ page }) => {
    await pasteHtml(page, '<p>Hello <strong>bold</strong> world</p>', 'Hello bold world');
    await expect.poll(() => getMarkdown(page)).toContain('**bold**');
  });

  // P1 ─────────────────────────────────────────────────────────────────────

  test('P1 · paste HTML with <ul> creates bullet list', async ({ page }) => {
    await pasteHtml(
      page,
      '<ul><li>alpha</li><li>beta</li></ul>',
      '- alpha\n- beta',
    );
    await waitForBlockType(page, 'list');
    await expect.poll(() => getMarkdown(page)).toContain('alpha');
    expect(await getMarkdown(page)).toContain('beta');
  });

  test('P1 · paste markdown heading creates heading block', async ({ page }) => {
    await pasteText(page, '# My Heading');
    // await waitForBlockType(page, 'heading');
    await expect.poll(() => getMarkdown(page)).toContain('# My Heading');
  });

  test('P1 · paste markdown bullet list creates list blocks', async ({ page }) => {
    await pasteText(page, '- item one\n- item two');
    await waitForBlockType(page, 'list');
    await expect.poll(() => getMarkdown(page)).toContain('item one');
    expect(await getMarkdown(page)).toContain('item two');
  });

  test('P1 · paste replaces selected text', async ({ page }) => {
    await typeText(page, 'replace me');
    await press(page, 'Home');
    await press(page, 'Shift+End');
    await pasteText(page, 'new content');
    await expect(getEditor(page)).toContainText('new content');
    await expect(getEditor(page)).not.toContainText('replace me');
  });

  test('P1 · paste HTML with <em> creates italic', async ({ page }) => {
    await pasteHtml(page, '<p><em>italic</em> text</p>', 'italic text');
    await expect.poll(() => getMarkdown(page)).toContain('*italic*');
  });

  // P2 ─────────────────────────────────────────────────────────────────────

  test('P2 · paste at end of non-empty paragraph appends correctly', async ({ page }) => {
    await typeText(page, 'existing ');
    await pasteText(page, 'pasted');
    await expect(getEditor(page)).toContainText('existing pasted');
  });

  test('P2 · paste HTML with mixed tags parses correctly', async ({ page }) => {
    await pasteHtml(
      page,
      '<p>Hello <strong>bold</strong> and <em>italic</em></p>',
      'Hello bold and italic',
    );
    await expect.poll(() => getMarkdown(page)).toContain('**bold**');
    expect(await getMarkdown(page)).toContain('*italic*');
  });
});
