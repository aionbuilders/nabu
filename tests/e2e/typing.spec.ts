/**
 * E2E — Basic Typing
 * P0: Core text input pipeline
 */

import { test, expect } from '@playwright/test';
import {
  gotoEditor, clearAndReset, getEditor, focusEditor,
  typeText, press, getMarkdown, getBlocks, getRootBlockCount,
} from './helpers/editor.js';

test.describe('Basic Typing', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  // P0 ─────────────────────────────────────────────────────────────────────

  test('P0 · types plain text into empty paragraph', async ({ page }) => {
    await typeText(page, 'Hello, world!');
    await expect(getEditor(page)).toContainText('Hello, world!');
  });

  test('P0 · Enter creates a new paragraph', async ({ page }) => {
    await typeText(page, 'first');
    await press(page, 'Enter');
    await typeText(page, 'second');

    const count = await getRootBlockCount(page);
    expect(count).toBe(2);
    const md = await getMarkdown(page);
    expect(md).toContain('first');
    expect(md).toContain('second');
  });

  test('P0 · Backspace deletes the character before the cursor', async ({ page }) => {
    await typeText(page, 'helllo');
    await press(page, 'ArrowLeft'); // Move cursor before last "o"
    await press(page, 'Backspace');
    const md = await getMarkdown(page);
    expect(md).toContain('hello'); // not "helllo"
    expect(md).not.toContain('helllo');
  });

  test('P0 · Backspace at start of block merges with previous paragraph', async ({ page }) => {
    await typeText(page, 'first');
    await press(page, 'Enter');
    await typeText(page, 'second');
    await press(page, 'Home');
    await press(page, 'Backspace');

    const count = await getRootBlockCount(page);
    expect(count).toBe(1);
    const md = await getMarkdown(page);
    expect(md).toContain('firstsecond');
  });

  test('P0 · Delete at end of block merges with next paragraph', async ({ page }) => {
    await typeText(page, 'first');
    await press(page, 'Enter');
    await typeText(page, 'second');
    // Go back to end of first paragraph
    await press(page, 'ArrowUp');
    await press(page, 'End');
    await press(page, 'Delete');

    const count = await getRootBlockCount(page);
    expect(count).toBe(1);
  });

  // P1 ─────────────────────────────────────────────────────────────────────

  test('P1 · types special characters: em-dash substitution (-- + space)', async ({ page }) => {
    await typeText(page, 'hello--');
    await typeText(page, ' ');
    const md = await getMarkdown(page);
    // -- followed by space becomes em-dash
    expect(md).toContain('— ');
  });

  test('P1 · Home/End navigate within a line', async ({ page }) => {
    await typeText(page, 'hello');
    await press(page, 'Home');
    await typeText(page, 'X');
    const md = await getMarkdown(page);
    expect(md.trim()).toContain('Xhello');
  });

  test('P1 · multi-line text split preserves content', async ({ page }) => {
    await typeText(page, 'hello world');
    // Move cursor to middle
    await press(page, 'Home');
    for (let i = 0; i < 5; i++) await press(page, 'ArrowRight');
    await press(page, 'Enter');

    const count = await getRootBlockCount(page);
    expect(count).toBe(2);
    const md = await getMarkdown(page);
    expect(md).toContain('hello');
    expect(md).toContain('world');
  });

  test('P1 · typing into empty document does not crash', async ({ page }) => {
    await typeText(page, 'abc');
    await expect(getEditor(page)).toContainText('abc');
  });

  // P2 ─────────────────────────────────────────────────────────────────────

  test('P2 · rapid typing is handled correctly', async ({ page }) => {
    const longText = 'abcdefghijklmnopqrstuvwxyz0123456789';
    await typeText(page, longText);
    await expect(getEditor(page)).toContainText(longText);
  });

  test('P2 · typing unicode characters works', async ({ page }) => {
    await typeText(page, 'héllo wörld 你好');
    await expect(getEditor(page)).toContainText('héllo');
  });
});
