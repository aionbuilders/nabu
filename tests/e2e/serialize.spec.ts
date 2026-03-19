/**
 * E2E — Serialization (Markdown + JSON root)
 */

import { test, expect } from '@playwright/test';
import {
  gotoEditor, clearAndReset, focusEditor,
  typeText, press, getMarkdown, getJson,
} from './helpers/editor.js';

test.describe('Serialization', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  // P0 ─────────────────────────────────────────────────────────────────────

  test('P0 · markdown serializes plain paragraph', async ({ page }) => {
    await typeText(page, 'Hello world');
    const md = await getMarkdown(page);
    expect(md.trim()).toBe('Hello world');
  });

  test('P0 · markdown serializes heading with level', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('heading', { level: 2, text: 'Section' });
      await n.commit();
    });
    const md = await getMarkdown(page);
    expect(md.trim()).toBe('## Section');
  });

  test('P0 · markdown serializes bold text', async ({ page }) => {
    await typeText(page, 'bold');
    await press(page, 'Home');
    await press(page, 'Shift+End');
    await press(page, 'Control+b');
    const md = await getMarkdown(page);
    expect(md).toContain('**bold**');
  });

  test('P0 · json serializes paragraph with type and content', async ({ page }) => {
    await typeText(page, 'json test');
    const json = await getJson(page);
    expect(json).toBeTruthy();
    expect(json.type ?? json.blocks?.[0]?.type).toMatch(/paragraph|root/);
  });

  // P1 ─────────────────────────────────────────────────────────────────────

  test('P1 · markdown serializes dialogue with em-dash', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('dialogue', { text: 'spoken' });
      await n.commit();
    });
    const md = await getMarkdown(page);
    expect(md).toContain('— spoken');
  });

  test('P1 · markdown serializes bullet list correctly', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      const list = n.insert('list', { listType: 'bullet' });
      n.insert('list-item', { text: 'alpha' }, list.node.id.toString(), 0);
      n.insert('list-item', { text: 'beta' }, list.node.id.toString(), 1);
      await n.commit();
    });
    const md = await getMarkdown(page);
    expect(md).toContain('- alpha');
    expect(md).toContain('- beta');
  });

  test('P1 · markdown serializes ordered list correctly', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      const list = n.insert('list', { listType: 'ordered' });
      n.insert('list-item', { text: 'one' }, list.node.id.toString(), 0);
      n.insert('list-item', { text: 'two' }, list.node.id.toString(), 1);
      await n.commit();
    });
    const md = await getMarkdown(page);
    expect(md).toContain('1. one');
    expect(md).toContain('2. two');
  });

  test('P1 · markdown serializes mixed content correctly', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('heading', { level: 1, text: 'Title' });
      n.insert('paragraph', { text: 'Body paragraph' });
      n.insert('dialogue', { text: 'A line of dialogue' });
      await n.commit();
    });
    const md = await getMarkdown(page);
    expect(md).toContain('# Title');
    expect(md).toContain('Body paragraph');
    expect(md).toContain('— A line of dialogue');
  });

  test('P1 · json serializes all block types', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('heading', { level: 1, text: 'Head' });
      n.insert('paragraph', { text: 'Para' });
      await n.commit();
    });
    const json = await getJson(page);
    expect(json).toBeTruthy();
    // The json should have structure
    const jsonStr = JSON.stringify(json);
    expect(jsonStr).toContain('heading');
    expect(jsonStr).toContain('paragraph');
  });

  // P2 ─────────────────────────────────────────────────────────────────────

  test('P2 · markdown serializes nested list with sublists', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      const list = n.insert('list', { listType: 'bullet' });
      const item = n.insert('list-item', { text: 'parent' }, list.node.id.toString(), 0);
      const sublist = n.insert('list', { listType: 'bullet' }, item.node.id.toString());
      n.insert('list-item', { text: 'child' }, sublist.node.id.toString(), 0);
      await n.commit();
    });
    const md = await getMarkdown(page);
    expect(md).toContain('- parent');
    expect(md).toContain('  - child');
  });
});
