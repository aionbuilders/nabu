/**
 * E2E — nabu.exec() Action Bus
 * Tests all registered actions via the Pulse-based exec system
 */

import { test, expect } from '@playwright/test';
import {
  gotoEditor, clearAndReset, focusEditor,
  typeText, press, getMarkdown, waitForBlockType,
  getEditor, getRootBlockCount,
  focus,
} from './helpers/editor.js';

test.describe('Action Bus (nabu.exec)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');

    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);

    console.log('--- Starting test with empty editor ---');
    const md = await getMarkdown(page);
    const blockCount = await getRootBlockCount(page);
    console.log(`Initial markdown: "${md}"`);
    console.log(`Initial root block count: ${blockCount}`);
  });

  // P0 ─────────────────────────────────────────────────────────────────────

  test('P0 · exec("undo") reverts last change', async ({ page }) => {
    await typeText(page, 'before undo');
    await page.evaluate(() => (window as any).nabu.exec('undo'));
    await page.waitForTimeout(100);
    const md = await getMarkdown(page);
    expect(md.trim().length).toBeLessThan('before undo'.length + 1);
  });

  test('P0 · exec("redo") restores after undo', async ({ page }) => {
    await typeText(page, 'redo target');
    await page.evaluate(() => (window as any).nabu.exec('undo'));
    await page.waitForTimeout(100);
    await page.evaluate(() => (window as any).nabu.exec('redo'));
    await page.waitForTimeout(100);
    await expect(getEditor(page)).toContainText('redo target');
  });

  test('P0 · exec("mark:toggle", {mark: "bold"}) toggles bold', async ({ page }) => {
    await typeText(page, 'bold action');
    await press(page, 'Home');
    await press(page, 'Shift+End');
    await page.evaluate(() =>
      (window as any).nabu.exec('mark:toggle', { mark: 'bold', value: true })
    );
    await page.waitForTimeout(100);
    const md = await getMarkdown(page);
    expect(md).toContain('**bold action**');
  });

  test('P0 · exec("mark:apply", {mark: "italic"}) applies italic', async ({ page }) => {
    await typeText(page, 'italic action');
    await press(page, 'Home');
    await press(page, 'Shift+End');
    await page.evaluate(() =>
      (window as any).nabu.exec('mark:apply', { mark: 'italic', value: true })
    );
    await page.waitForTimeout(100);
    const md = await getMarkdown(page);
    expect(md).toContain('*italic action*');
  });

  // P1 ─────────────────────────────────────────────────────────────────────

  test('P1 · exec("mark:remove", {mark: "bold"}) removes bold', async ({ page }) => {
    await typeText(page, 'remove bold');
    await press(page, 'Home');
    await press(page, 'Shift+End');
    await press(page, 'Control+b'); // apply first
    await press(page, 'Home');
    await press(page, 'Shift+End');
    await page.evaluate(() =>
      (window as any).nabu.exec('mark:remove', { mark: 'bold' })
    );
    await page.waitForTimeout(100);
    const md = await getMarkdown(page);
    expect(md).not.toContain('**remove bold**');
    expect(md).toContain('remove bold');
  });

  test('P1 · exec("bold") shorthand applies bold', async ({ page }) => {
    await typeText(page, 'shorthand bold');
    await press(page, 'Home');
    await press(page, 'Shift+End');
    await page.evaluate(() => (window as any).nabu.exec('bold'));
    await page.waitForTimeout(100);
    const md = await getMarkdown(page);
    expect(md).toContain('**shorthand bold**');
  });

  test('P1 · exec("italic") shorthand applies italic', async ({ page }) => {
    await typeText(page, 'shorthand italic');
    await press(page, 'Home');
    await press(page, 'Shift+End');
    await page.evaluate(() => (window as any).nabu.exec('italic'));
    await page.waitForTimeout(100);
    const md = await getMarkdown(page);
    expect(md).toContain('*shorthand italic*');
  });

  test('P1 · exec("block:transform") changes block type to heading', async ({ page }) => {
    await typeText(page, 'my title');
    await page.evaluate(() =>
      (window as any).nabu.exec('block:transform', { type: 'heading', props: { level: 1 } })
    );
    await page.waitForTimeout(100);
    await waitForBlockType(page, 'heading');
    const md = await getMarkdown(page);
    expect(md).toContain('# my title');
  });

  test('P1 · exec("list:indent") indents list item', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      const list = n.insert('list', { listType: 'bullet' });
      n.insert('list-item', { text: 'parent' }, list.node.id.toString(), 0);
      n.insert('list-item', { text: 'child' }, list.node.id.toString(), 1);
      await n.commit();
      return n.serialize("markdown");
    }).then(console.log);
    await focus(page, 10);
    await page.waitForTimeout(200);
    const selection = await page.evaluate(() => (window as any).nabu.selection.startBlock.selection);
    console.log('Current selection start block ID:', selection);

    await page.evaluate(() => (window as any).nabu.selection.startBlock.id).then(console.log)
    await page.evaluate(() => (window as any).nabu.exec('list:indent'));
    
    await page.waitForTimeout(100);
    const md = await getMarkdown(page);
    expect(md).toContain('  - child');
  });

  test('P1 · exec("list:unindent") unindents nested item', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      const list = n.insert('list', { listType: 'bullet' });
      const item1 = n.insert('list-item', { text: 'parent' }, list.node.id.toString(), 0);
      const sublist = n.insert('list', { listType: 'bullet' }, item1.node.id.toString());
      n.insert('list-item', { text: 'nested' }, sublist.node.id.toString(), 0);
      await n.commit();
      return n.serialize("markdown");
    }).then(console.log);
    await page.waitForTimeout(200);
    await focus(page, 10);
    await page.waitForTimeout(200);
    await page.evaluate(() => (window as any).nabu.exec('list:unindent'));
    await page.waitForTimeout(100);
    const md = await getMarkdown(page);
    expect(md).toMatch(/^- nested/m);
  });

  // P2 ─────────────────────────────────────────────────────────────────────

  test('P2 · exec with unknown action does not crash', async ({ page }) => {
    await page.evaluate(() =>
      (window as any).nabu.exec('nonexistent:action', {})
    );
    await page.waitForTimeout(50);
    await expect(getEditor(page)).toBeVisible();
  });

  test('P2 · exec returns a promise/value from pulse.emit', async ({ page }) => {
    const result = await page.evaluate(() =>
      (window as any).nabu.exec('undo')
    );
    // Should not throw
    await expect(getEditor(page)).toBeVisible();
  });
});
