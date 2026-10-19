/**
 * E2E — URL / HTML safety (P-42): an unsafe `javascript:` URL never becomes a live link or media source, whether it
 * arrives by paste, by the link actions, or already sits in the document (snapshot, remote peer, raw Loro mark).
 * The copy-side escaping is covered by clipboard-copy.spec.ts (10b–10e).
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, clearAndReset, focusEditor, getEditor } from './helpers/editor.js';
import { pasteHtml } from './helpers/clipboard.js';
import { buildBlocks, buildTree, Para, Pp, type TreeSpec } from './helpers/blocks.js';
import { selectRange, allText } from './helpers/model.js';

/** Every link mark value in the model. */
const links = (page: Page) => page.evaluate(() =>
  [...(window as any).nabu.blocks.values()]
    .flatMap((b: any) => b.behaviors?.get('text')?.container?.toDelta() ?? [])
    .map((op: any) => op.attributes?.link)
    .filter(Boolean));

/** Apply a raw Loro mark, bypassing the link actions (what a snapshot / remote peer / old document can contain). */
async function rawMark(page: Page, blockText: string, start: number, end: number, name: string, value: any) {
  await page.evaluate(async ([t, s, e, name, value]) => {
    const n = (window as any).nabu;
    const hit = [...n.blocks.values()].find((b: any) => b.behaviors?.get('text')?.text === t) as any;
    if (!hit) throw new Error('no block with text ' + t);
    hit.behaviors.get('text').container.mark({ start: s, end: e }, name, value);
    await n.commit();
  }, [blockText, start, end, name, value] as [string, number, number, string, any]);
}

test.describe('URL safety', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
  });

  test('pasting <a href="javascript:…"> keeps the text and creates no link', async ({ page }) => {
    await focusEditor(page);
    await pasteHtml(page, '<p><a href="javascript:alert(1)">x</a></p>', 'x');
    await expect(getEditor(page)).toContainText('x');
    expect(await links(page)).toEqual([]);
    await expect(page.locator('[data-block-id] a')).toHaveCount(0);
  });

  test('pasting a safe link still creates the link (control)', async ({ page }) => {
    await focusEditor(page);
    await pasteHtml(page, '<p><a href="https://example.com/ok">ok</a></p>', 'ok');
    await expect.poll(() => links(page)).toEqual(['https://example.com/ok']);
    await expect(page.locator('[data-block-id] a[href="https://example.com/ok"]')).toHaveCount(1);
  });

  test('pasting <script>/<iframe>/on* attributes produces no live content', async ({ page }) => {
    await focusEditor(page);
    await page.evaluate(() => { (window as any).pwned = false; });
    await pasteHtml(page,
      '<p onclick="window.pwned=true">a<script>window.pwned=true</script><iframe src="javascript:window.pwned=true"></iframe><img src="x" onerror="window.pwned=true"><b onmouseover="window.pwned=true">b</b></p>',
      'ab');
    // the <img src="x"> is a (relative, safe) image block now: it splits the paragraph, its onerror is just not an attribute anywhere
    await expect.poll(() => allText(page)).toEqual(['a', 'b']);
    await expect(page.locator('[data-block-id] script, [data-block-id] iframe, [data-block-id] [onclick], [data-block-id] [onerror], [data-block-id] [onmouseover]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).pwned)).toBe(false);
  });

  test('link:set with a javascript: href is refused (the text stays unlinked)', async ({ page }) => {
    await buildBlocks(page, [Para('click me')]);
    await selectRange(page, 'click me', 0, 'click me', -1);
    await page.evaluate(() => (window as any).nabu.exec('link:set', { href: 'javascript:alert(1)' }));
    expect(await links(page)).toEqual([]);
    await page.evaluate(() => (window as any).nabu.exec('link:set', { href: 'https://example.com' }));
    await expect.poll(() => links(page)).toEqual(['https://example.com']);
  });

  test('a document that already contains a javascript: link renders no live javascript: href', async ({ page }) => {
    await buildBlocks(page, [Para('click me'), Para('fine')]);
    await rawMark(page, 'click me', 0, 8, 'link', 'javascript:alert(1)');
    await rawMark(page, 'fine', 0, 4, 'link', 'https://example.com/fine');
    expect(await links(page)).toContain('javascript:alert(1)'); // it IS in the model (that is the point of the test)

    await expect(page.locator('[data-block-id] a[href="https://example.com/fine"]')).toHaveCount(1); // render works
    await expect(page.locator('a[href^="javascript" i]')).toHaveCount(0);
    await expect(getEditor(page)).toContainText('click me'); // the label is still there
  });

  test('obfuscated schemes in the model are not rendered as live links either', async ({ page }) => {
    await buildBlocks(page, [Para('one'), Para('two'), Para('three')]);
    await rawMark(page, 'one', 0, 3, 'link', ' JaVa\nScRiPt:alert(1)');
    await rawMark(page, 'two', 0, 3, 'link', '&#106;avascript:alert(1)');
    await rawMark(page, 'three', 0, 5, 'link', 'data:text/html,<script>alert(1)</script>');
    await expect(page.locator('[data-block-id] a')).toHaveCount(0);
  });

  test('media blocks with unsafe refs render no live src / href', async ({ page }) => {
    await buildTree(page, [
      Pp('a'),
      { type: 'image', props: { ref: 'javascript:alert(1)', alt: 'img' } },
      { type: 'video', props: { ref: 'javascript:alert(1)' } },
      { type: 'file', props: { ref: 'javascript:alert(1)', name: 'doc.pdf' } },
      { type: 'image', props: { ref: 'data:text/html,<script>alert(1)</script>', alt: 'img2' } },
    ] as TreeSpec[]);
    await expect(page.locator('[data-block-type="image"]')).toHaveCount(2);
    await expect(page.locator('[data-block-type] [src^="javascript" i], [data-block-type] [href^="javascript" i], [data-block-type] [src^="data:text" i]')).toHaveCount(0);
    await expect(page.locator('[data-block-type="file"]')).toContainText('doc.pdf');
  });

  test('media blocks with safe refs still render (control)', async ({ page }) => {
    await buildTree(page, [
      Pp('a'),
      { type: 'image', props: { ref: 'https://example.com/a.png', alt: 'img' } },
    ] as TreeSpec[]);
    await expect(page.locator('[data-block-type="image"] img[src="https://example.com/a.png"]')).toHaveCount(1);
  });
});
