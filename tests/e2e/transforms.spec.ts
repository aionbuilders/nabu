/**
 * E2E — Block Type Transforms
 * block:transform exec action, transformTo API
 */

import { test, expect } from '@playwright/test';
import {
  gotoEditor, clearAndReset, focusEditor,
  typeText, press, getMarkdown, waitForBlockType, getBlocks,
} from './helpers/editor.js';

test.describe('Block Transforms', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  // P0 ─────────────────────────────────────────────────────────────────────

  test('P0 · paragraph transforms to heading via block:transform', async ({ page }) => {
    await typeText(page, 'My Title');
    await page.evaluate(() =>
      (window as any).nabu.exec('block:transform', { type: 'heading', props: { level: 1 } })
    );
    await page.waitForTimeout(100);
    await waitForBlockType(page, 'heading');
    await expect(page.locator('[data-block-type="heading"]')).toBeVisible();
    const md = await getMarkdown(page);
    expect(md).toContain('# My Title');
  });

  test('P0 · heading transforms back to paragraph', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('heading', { level: 1, text: 'A Heading' });
      await n.commit();
      n.focus({offset: 0}); // Focus at start of block to ensure typing goes into it
    });
    await page.evaluate(() =>
      (window as any).nabu.exec('block:transform', { type: 'paragraph' })
    );
    await page.waitForTimeout(100);
    await waitForBlockType(page, 'paragraph');
    const md = await getMarkdown(page);
    expect(md).not.toContain('#');
    expect(md).toContain('A Heading');
  });

  test('P0 · paragraph transforms to dialogue via block:transform', async ({ page }) => {
    await typeText(page, 'spoken words');
    await page.evaluate(() =>
      (window as any).nabu.exec('block:transform', { type: 'dialogue' })
    );
    await page.waitForTimeout(100);
    await waitForBlockType(page, 'dialogue');
    const md = await getMarkdown(page);
    expect(md).toContain('—');
    expect(md).toContain('spoken words');
  });

  // P1 ─────────────────────────────────────────────────────────────────────

  test('P1 · heading level 1 markdown serialization', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('heading', { level: 1, text: 'Level One' });
      await n.commit();
    });
    const md = await getMarkdown(page);
    expect(md.trim()).toMatch(/^# Level One/);
  });

  test('P1 · heading level 2 markdown serialization', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('heading', { level: 2, text: 'Level Two' });
      await n.commit();
    });
    const md = await getMarkdown(page);
    expect(md.trim()).toMatch(/^## Level Two/);
  });

  test('P1 · text content is preserved after transform', async ({ page }) => {
    await typeText(page, 'preserve me');
    await page.evaluate(() =>
      (window as any).nabu.exec('block:transform', { type: 'heading', props: { level: 3 } })
    );
    await page.waitForTimeout(100);
    const md = await getMarkdown(page);
    expect(md).toContain('preserve me');
  });

  test('P1 · transformTo() method changes block type', async ({ page }) => {
    await typeText(page, 'transform direct');
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const block = n.children[0];
      block.transformTo('heading', { level: 2 });
    });
    await page.waitForTimeout(100);
    const md = await getMarkdown(page);
    expect(md).toContain('## transform direct');
  });

  // P2 ─────────────────────────────────────────────────────────────────────

  test('P2 · transform preserves bold marks', async ({ page }) => {
    await typeText(page, 'bold text');
    await press(page, 'Home');
    await press(page, 'Shift+End');
    await press(page, 'Control+b');

    await page.evaluate(() =>
      (window as any).nabu.exec('block:transform', { type: 'heading', props: { level: 1 } })
    );
    await page.waitForTimeout(100);
    const md = await getMarkdown(page);
    expect(md).toContain('**bold text**');
  });
});
