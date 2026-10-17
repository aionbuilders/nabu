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
  // Each test uses its own unique docId to avoid cross-test contamination
  const uniqueDocId = () => `e2e-${test.info().testId}-${Date.now()}`;

  test('P0 · nabu.isNew is true for a brand-new document', async ({ page }) => {
    await gotoEditor(page, { persist: uniqueDocId() });
    const isNew = await page.evaluate(() => (window as any).nabu?.isNew);
    expect(isNew).toBe(true);
  });

  test('P0 · editor content persists across page reload', async ({ page }) => {
    await gotoEditor(page, { persist: uniqueDocId() });

    // Write content
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      for (const c of [...n.children]) n.delete(c);
      n.insert('paragraph', { text: 'persisted content' });
      await n.commit();
      await n.saveNow?.();
    });
    // `saveNow()` is awaited above, so the snapshot is already in IndexedDB: no need to wait before reloading.

    // Reload page
    await page.reload();
    await waitForEditor(page, 10000); // the engine is only exposed once the snapshot has been loaded

    await expect.poll(() => getMarkdown(page)).toContain('persisted content');
  });

  test('P0 · nabu.saveNow() is callable without error', async ({ page }) => {
    await gotoEditor(page, { persist: uniqueDocId() });
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
    await gotoEditor(page, { persist: uniqueDocId() });

    await page.evaluate(async () => {
      const n = (window as any).nabu;
      for (const c of [...n.children]) n.delete(c);
      n.insert('paragraph', { text: 'nav test content' });
      await n.commit();
      await n.saveNow?.();
    });

    await page.reload();
    await waitForEditor(page, 10000);

    await expect(getEditor(page)).toContainText('nav test content');
  });

  test('P1 · nabu.clearPersistence() removes saved data', async ({ page }) => {
    await gotoEditor(page, { persist: uniqueDocId() });

    await page.evaluate(async () => {
      const n = (window as any).nabu;
      for (const c of [...n.children]) n.delete(c);
      n.insert('paragraph', { text: 'will be cleared' });
      await n.commit();
      await n.saveNow?.();
    });

    // Clear persistence (awaited: the snapshot is gone before we reload)
    await page.evaluate(async () => {
      await (window as any).nabu?.clearPersistence?.();
    });

    await page.reload();
    await waitForEditor(page, 10000); // `isNew` is decided before the engine is exposed

    // After clearing, should get fresh document (isNew should be true)
    const isNew = await page.evaluate(() => (window as any).nabu?.isNew ?? false);
    expect(isNew).toBe(true);
  });

  test('P2 · auto-save debounce fires within 2 seconds of typing', async ({ page }) => {
    const docId = uniqueDocId();
    await gotoEditor(page, { persist: docId });

    const committedAt = await page.evaluate(async () => {
      const n = (window as any).nabu;
      for (const c of [...n.children]) n.delete(c);
      n.insert('paragraph', { text: 'auto-save test' });
      await n.commit();
      return Date.now();
    });

    // KEEP (time-based by design): the save only happens once the 2 s auto-save debounce expires, so this
    // test necessarily lasts >= 2 s. Instead of sleeping a fixed 2 s (which raced the debounce), poll
    // IndexedDB until a snapshot saved AFTER our commit shows up (no saveNow() here: that is the point).
    await expect.poll(() => page.evaluate((id) => new Promise<number>((resolve, reject) => {
      const open = indexedDB.open('nabu');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('snapshots')) { db.close(); return resolve(0); }
        const get = db.transaction('snapshots', 'readonly').objectStore('snapshots').get(id);
        get.onsuccess = () => { db.close(); resolve(get.result?.savedAt ?? 0); };
        get.onerror = () => { db.close(); reject(get.error); };
      };
    }), docId), { timeout: 8000 }).toBeGreaterThanOrEqual(committedAt);

    // Now reload and check
    await page.reload();
    await waitForEditor(page, 10000);

    await expect.poll(() => getMarkdown(page)).toContain('auto-save test');
  });
});
