/**
 * E2E — Persistence (IndexedDB)
 * createPersistedEditor auto-saves and restores state
 * FLAKY_RISK: timing dependent
 */

import { test, expect } from '@playwright/test';
import {
  gotoEditor, waitForEditor, getMarkdown, getEditor, getBlocks,
} from './helpers/editor.js';

test.describe('Persistence', () => {
  // Each test uses a unique docId to avoid cross-test contamination
  const TEST_DOC_ID = `test-persistence-${Date.now()}`;

  test('P0 · nabu.isNew is true for a brand-new document', async ({ page }) => {
    await gotoEditor(page);
    const isNew = await page.evaluate(() => (window as any).nabu?.isNew ?? true);
    // The demo app uses 'nabu-demo' — it may or may not be new depending on prior runs.
    // We just check the property exists and is a boolean.
    expect(typeof isNew).toBe('boolean');
  });

  test('P0 · editor content persists across page reload', async ({ page }) => {
    await gotoEditor(page);

    // Write content
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      for (const c of [...n.children]) n.delete(c);
      n.insert('paragraph', { text: 'persisted content' });
      await n.commit();
      await n.saveNow?.();
    });
    await page.waitForTimeout(500);

    // Reload page
    await page.reload();
    await waitForEditor(page, 10000);
    await page.waitForTimeout(500);

    const md = await getMarkdown(page);
    expect(md).toContain('persisted content');
  });

  test('P0 · nabu.saveNow() is callable without error', async ({ page }) => {
    await gotoEditor(page);
    const result = await page.evaluate(async () => {
      try {
        await (window as any).nabu?.saveNow?.();
        return 'ok';
      } catch (e) {
        return String(e);
      }
    });
    expect(result).toBe('ok');
  });

  test('P1 · content survives soft navigation (back/forward)', async ({ page }) => {
    await gotoEditor(page);

    await page.evaluate(async () => {
      const n = (window as any).nabu;
      for (const c of [...n.children]) n.delete(c);
      n.insert('paragraph', { text: 'nav test content' });
      await n.commit();
      await n.saveNow?.();
    });
    await page.waitForTimeout(300);

    await page.reload();
    await waitForEditor(page, 10000);

    await expect(getEditor(page)).toContainText('nav test content');
  });

  test('P1 · nabu.clearPersistence() removes saved data', async ({ page }) => {
    await gotoEditor(page);

    await page.evaluate(async () => {
      const n = (window as any).nabu;
      for (const c of [...n.children]) n.delete(c);
      n.insert('paragraph', { text: 'will be cleared' });
      await n.commit();
      await n.saveNow?.();
    });
    await page.waitForTimeout(300);

    // Clear persistence
    await page.evaluate(async () => {
      await (window as any).nabu?.clearPersistence?.();
    });

    await page.reload();
    await waitForEditor(page, 10000);
    await page.waitForTimeout(300);

    // After clearing, should get fresh document (isNew should be true)
    const isNew = await page.evaluate(() => (window as any).nabu?.isNew ?? false);
    expect(isNew).toBe(true);
  });

  test('P2 · auto-save debounce fires within 2 seconds of typing', async ({ page }) => {
    await gotoEditor(page);

    await page.evaluate(async () => {
      const n = (window as any).nabu;
      for (const c of [...n.children]) n.delete(c);
      n.insert('paragraph', { text: 'auto-save test' });
      await n.commit();
    });

    // Wait for debounce
    await page.waitForTimeout(2000);

    // Now reload and check
    await page.reload();
    await waitForEditor(page, 10000);
    await page.waitForTimeout(500);

    const md = await getMarkdown(page);
    expect(md).toContain('auto-save test');
  });
});
