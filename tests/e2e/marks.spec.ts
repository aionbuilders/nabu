/**
 * E2E — Rich Text Marks
 * Bold, italic, underline, code, strikethrough via keyboard shortcuts
 */

import { test, expect } from '@playwright/test';
import {
  gotoEditor, clearAndReset, focusEditor,
  typeText, press, getMarkdown, exec,
} from './helpers/editor.js';
import { bold, italic, underline, code, selectForward, selectLine, goToStart } from './helpers/keyboard.js';

test.describe('Rich Text Marks', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  // P0 ─────────────────────────────────────────────────────────────────────

  test('P0 · Ctrl+B applies bold to selection', async ({ page }) => {
    await typeText(page, 'hello world');
    await goToStart(page);
    await selectForward(page, 5); // select "hello"
    await bold(page);

    const md = await getMarkdown(page);
    expect(md).toContain('**hello**');
  });

  test('P0 · Ctrl+I applies italic to selection', async ({ page }) => {
    await typeText(page, 'hello world');
    await goToStart(page);
    await selectForward(page, 5);
    await italic(page);

    const md = await getMarkdown(page);
    expect(md).toContain('*hello*');
  });

  test('P0 · Ctrl+E applies inline code to selection', async ({ page }) => {
    await typeText(page, 'hello world');
    await goToStart(page);
    await selectForward(page, 5);
    await code(page);

    const md = await getMarkdown(page);
    expect(md).toContain('`hello`');
  });

  test('P0 · Ctrl+B toggles bold off when already active', async ({ page }) => {
    await typeText(page, 'hello');
    await selectLine(page);
    await bold(page);
    // Apply bold again to toggle off
    await selectLine(page);
    await bold(page);

    const md = await getMarkdown(page);
    // No bold markers around hello
    expect(md).not.toContain('**hello**');
    expect(md).toContain('hello');
  });

  // P1 ─────────────────────────────────────────────────────────────────────

  test('P1 · Ctrl+U applies underline to selection', async ({ page }) => {
    await typeText(page, 'test');
    await selectLine(page);
    await underline(page);
    const md = await getMarkdown(page);
    expect(md).toContain('<u>test</u>');
  });

  test('P1 · mark:toggle exec action applies bold', async ({ page }) => {
    await typeText(page, 'exec bold');
    // Select all via keyboard
    await press(page, 'Control+a');
    // Exec the action
    await page.evaluate(() => (window as any).nabu.exec('mark:toggle', { mark: 'bold', value: true }));
    await page.waitForTimeout(100);
    const md = await getMarkdown(page);
    expect(md).toContain('**exec bold**');
  });

  test('P1 · mark:toggle exec action toggles bold off', async ({ page }) => {
    await typeText(page, 'toggle off');
    await selectLine(page);
    await bold(page);
    // Now toggle off
    await selectLine(page);
    await page.evaluate(() => (window as any).nabu.exec('mark:toggle', { mark: 'bold', value: true }));
    await page.waitForTimeout(100);
    const md = await getMarkdown(page);
    expect(md).not.toContain('**toggle off**');
  });

  test('P1 · bold and italic can be combined', async ({ page }) => {
    await typeText(page, 'both');
    await selectLine(page);
    await bold(page);
    await selectLine(page);
    await italic(page);

    const md = await getMarkdown(page);
    // Should have bold+italic combined
    expect(md).toMatch(/\*\*\*both\*\*\*|\*both\*\*/);
  });

  test('P1 · marks are preserved after typing more text', async ({ page }) => {
    await typeText(page, 'hello ');
    await selectLine(page);
    await press(page, 'Shift+ArrowLeft'); // Select just "hello"
    await bold(page);
    // Move to end and type more
    await press(page, 'End');
    await typeText(page, ' world');
    const md = await getMarkdown(page);
    expect(md).toContain('**hello**');
  });

  // P2 ─────────────────────────────────────────────────────────────────────

  test('P2 · mark applies to only the selected range', async ({ page }) => {
    await typeText(page, 'hello world');
    await goToStart(page);
    await selectForward(page, 5); // select "hello"
    await bold(page);

    const md = await getMarkdown(page);
    expect(md).toContain('**hello**');
    expect(md).toContain(' world');
    // "world" should NOT be bold
    expect(md).not.toContain('**world**');
  });

  test('P2 · no mark is applied when selection is collapsed', async ({ page }) => {
    await typeText(page, 'hello');
    // Move to middle, don't select
    await press(page, 'Home');
    await press(page, 'ArrowRight');
    await press(page, 'ArrowRight');
    await bold(page); // collapsed selection — should be noop
    const md = await getMarkdown(page);
    // No bold markers expected
    expect(md).not.toContain('**');
  });
});
