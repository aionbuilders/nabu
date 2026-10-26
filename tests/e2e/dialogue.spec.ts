/**
 * E2E — Dialogue block
 * Type -- at start of line → transform to dialogue
 * Serialization, splitting, merging
 */

import { test, expect, type Page } from './helpers/test.js';
import {
  gotoEditor, clearAndReset, focusEditor,
  typeText, press, getMarkdown, getRootBlockCount,
  getEditor, waitForBlockType, focus,
} from './helpers/editor.js';
import { pasteText } from './helpers/clipboard.js';

const treeFlat = (page: Page) =>
  page.evaluate(() => (window as any).nabu.children.map((b: any) => `${b.type}(${b.text ?? ''})`).join(' ; '));

test.describe('Dialogue Block', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  // P0 ─────────────────────────────────────────────────────────────────────

  test('P0 · dialogue block renders with correct data-block-type', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('dialogue', { text: 'Hello said the fox' });
      await n.commit();
    });
    await expect(page.locator('[data-block-type="dialogue"]')).toBeVisible();
  });

  test('P0 · dialogue serializes to markdown with the `-- ` prefix (whatever the display dash)', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('dialogue', { text: 'Hello world' });
      await n.commit();
    });
    const md = await getMarkdown(page);
    expect(md).toContain('-- Hello world');
  });

  test('P0 · typing in dialogue block works', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('dialogue', { text: '' });
      await n.commit();
      n.focus({offset: 0}); // Focus at start of block to ensure typing goes into it
      
    });
    await page.evaluate(() => {
      const n = (window as any).nabu;
      const dialogueBlock = n.children.find((b: any) => b.type === 'dialogue');
      if (dialogueBlock) {
        n.focus({offset: 0});
      }
    })

    await typeText(page, 'spoken text');
    const md = await getMarkdown(page);
    expect(md).toContain('-- spoken text');
  });

  // P1 ─────────────────────────────────────────────────────────────────────

  test('P1 · Enter inside dialogue creates new dialogue block', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('dialogue', { text: '' });
      await n.commit();
      n.focus({offset: 0}); // Focus at start of block to ensure typing goes into it
    });
    await typeText(page, 'first line');
    await press(page, 'Enter');
    await typeText(page, 'second line');

    const md = await getMarkdown(page);
    expect(md).toContain('-- first line');
    expect(md).toContain('-- second line');
  });

  test('P1 · Two Backspace at start of dialogue merges with previous block', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('paragraph', { text: 'before' });
      n.insert('dialogue', { text: 'after' });
      await n.commit();
      n.focus({offset: 10}); // Focus at start of block to ensure typing goes into it
    });
    const getMd = () => page.evaluate(() => {
      const n = (window as any).nabu;
      return n.serialize('markdown');
    });
    let md = await getMd();

    await test.step('Verify initial markdown structure', async () => {
      expect(md).toContain('before\n\n-- after');
    });

    await test.step('Press Home and then two Backspaces to merge dialogue with previous block', async () => {
      await press(page, 'Home');
      await press(page, 'Backspace');
      md = await getMd();
      expect(md).toContain('before\n\nafter');
      await press(page, 'Backspace');
      md = await getMd();
      expect(md).toContain('beforeafter');
    });

    const count = await getRootBlockCount(page);
    expect(count).toBeLessThan(2);
  });

  test('P1 · bold mark works inside dialogue', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('dialogue', { text: '' });
      await n.commit();
      n.focus({offset: 0}); // Focus at start of block to ensure typing goes into it
    });
    await typeText(page, 'bold text');
    await press(page, 'Home');
    await press(page, 'Shift+End');
    await press(page, 'Control+b');
    const md = await getMarkdown(page);
    expect(md).toContain('-- **bold text**');
  });

  test('P1 · dialogue JSON serialization includes type and content', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('dialogue', { text: 'test' });
      await n.commit();
      n.focus({offset: 3}); // Focus at start of block to ensure typing goes into it
    });
    const json = await page.evaluate(() => (window as any).nabu.serialize('json'));
    const dialogueBlock = json.blocks?.find((b: any) => b.type === 'dialogue');
    expect(dialogueBlock).toBeTruthy();
    expect(dialogueBlock?.content).toBeTruthy();
  });

  // P2 ─────────────────────────────────────────────────────────────────────

  test('P2 · block:transform converts paragraph to dialogue via exec', async ({ page }) => {
    await typeText(page, 'transform me');
    await page.evaluate(() =>
      (window as any).nabu.exec('block:transform', { type: 'dialogue' })
    );
    await waitForBlockType(page, 'dialogue');
    const md = await getMarkdown(page);
    expect(md).toContain('-- transform me');
  });

  test('P1 · the display dash is cosmetic: overriding --nb-dialogue-dash does not change the markdown', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('dialogue', { text: 'Hello' });
      await n.commit();
      document.documentElement.style.setProperty('--nb-dialogue-dash', '"—"');
    });
    const dash = await page.evaluate(() => getComputedStyle(document.querySelector('[data-block-type="dialogue"]')!, '::before').content);
    expect(dash).toBe('"—"');
    expect(await getMarkdown(page)).toBe('-- Hello');
  });

  test('P1 · paste "-- hi" gives a dialogue; "– hi" / "— hi" stay plain paragraphs; "- hi" is a list', async ({ page }) => {
    const paste = async (text: string) => {
      await clearAndReset(page);
      await focus(page, 0);
      await pasteText(page, text);
    };
    await paste('-- hi');
    await expect.poll(() => treeFlat(page)).toBe('dialogue(hi)');
    await paste('– hi');
    await expect.poll(() => treeFlat(page)).toBe('paragraph(– hi)');
    await paste('— hi');
    await expect.poll(() => treeFlat(page)).toBe('paragraph(— hi)');
    await paste('- hi');
    await expect.poll(() => treeFlat(page)).toMatch(/(^| ; )list\(/);
    await paste('-- a\n- b\n-- c');
    await expect.poll(() => treeFlat(page)).toMatch(/dialogue\(a\) ; list\(.*\) ; dialogue\(c\)$/);
  });

  test('P1 · markdown export -> paste round trip keeps the dialogue lines', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('dialogue', { text: 'Tu viens ?' });
      n.insert('paragraph', { text: '– not a dialogue' });
      n.insert('dialogue', { text: 'Oui.' });
      await n.commit();
    });
    const md = await getMarkdown(page);
    expect(md).toBe('-- Tu viens ?\n\n– not a dialogue\n\n-- Oui.');
    await clearAndReset(page);
    await focus(page, 0);
    await pasteText(page, md);
    await expect.poll(() => treeFlat(page)).toBe('dialogue(Tu viens ?) ; paragraph(– not a dialogue) ; dialogue(Oui.)');
    expect(await getMarkdown(page)).toBe(md);
  });
});
