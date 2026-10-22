/**
 * E2E — Regions, lot 3 (ADR 016 §3.6): clipboard and text forms of the markers.
 *
 * A real Ctrl+C writes the three payloads (read from the ClipboardEvent, helpers/clip-capture.ts): the internal fragment, the
 * `text/html` (marker = heading element with `data-nabu-region`) and the `text/plain` (markdown: data comment + readable
 * heading). Pastes are synthetic `paste` events carrying those payloads (the system clipboard is unreliable for custom MIME
 * types). Seeded document (`?seed=regions`): preamble, "1. The ferryman" ⊃ "1.1 The bank", "1.2 The water", "2. The return".
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor } from './helpers/editor.js';
import { selectAll } from './helpers/keyboard.js';
import { violations, focusAt, focusEnd, selectRange, collectErrors } from './helpers/model.js';
import { copy } from './helpers/clip-capture.js';

/** One-line outline of the root blocks: `p(text)`, `R:type(title)`, `toggle(text){…}`. */
async function roots(page: Page): Promise<string> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    const walk = (node: any): string => {
      const type = node.data.get('type');
      if (type === 'region') return `R:${node.data.get('regionType')}(${node.data.get('fields')?.get('title') ?? ''})`;
      const t = node.data.get('text');
      const kids = node.children() ?? [];
      return `${type === 'paragraph' ? 'p' : type}(${t ? t.toString() : ''})${kids.length ? '{' + kids.map(walk).join(' ') + '}' : ''}`;
    };
    return n.tree.roots().map(walk).join(' ; ');
  });
}
const expectRoots = (page: Page, expected: string) => expect.poll(() => roots(page), { timeout: 3000, message: 'roots' }).toBe(expected);
const labels = (page: Page) => page.evaluate(() => (window as any).nabu.regions.list.map((r: any) => r.label));
const seams = (page: Page) => page.locator('[data-block-type="region"]');

/** Dispatch a paste carrying `data` at the caret. */
async function paste(page: Page, data: Record<string, string>) {
  await page.evaluate((payload) => {
    const dt = new DataTransfer();
    for (const [k, v] of Object.entries(payload)) dt.setData(k, v);
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, data);
}

let errors: ReturnType<typeof collectErrors>;
test.beforeEach(async ({ page }) => { errors = collectErrors(page); });
test.afterEach(async () => { expect(errors.list(), 'console / page errors').toEqual([]); });

test.describe('copy and paste across regions', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, { seed: 'regions' }); });

  test('copy writes the markers in the three payloads (markdown: comment + heading with the labels of the source)', async ({ page }) => {
    await selectRange(page, 'Opening of the first section.', 8, 'Text of the water.', 4);
    const ev = await copy(page);
    expect(ev.nabu!.blocks.map((b: any) => b.type)).toEqual(['paragraph', 'region', 'paragraph', 'region', 'paragraph']);
    expect(ev.nabu!.blocks[1].props).toEqual({ regionType: 'section-2', fields: { title: 'The bank' } });
    expect(ev.text).toBe([
      'of the first section.',
      '<!-- region:section-2 {"title":"The bank"} -->\n## 1.1 The bank',
      'Text of the bank.',
      '<!-- region:section-2 {"title":"The water"} -->\n## 1.2 The water',
      'Text',
    ].join('\n\n'));
    expect(ev.html).toContain('<h2 data-nabu-region="section-2" data-nabu-fields=\'{&quot;title&quot;:&quot;The bank&quot;}\'>1.1 The bank</h2>');
    expect(ev.html).toContain('>1.2 The water</h2>');
  });

  test('paste at the end of the document reproduces the markers and labels; numbering follows', async ({ page }) => {
    await selectRange(page, 'Opening of the first section.', 8, 'Text of the water.', 4);
    const ev = await copy(page);
    await focusEnd(page, 'Closing text.');
    await paste(page, { 'application/x-nabu+json': ev.nabuRaw, 'text/plain': ev.text, 'text/html': ev.html });
    await expectRoots(page, [
      'p(Preamble, outside any region.)', 'R:section-1(The ferryman)', 'p(Opening of the first section.)', 'R:section-2(The bank)', 'p(Text of the bank.)',
      'R:section-2(The water)', 'p(Text of the water.)', 'R:section-1(The return)', 'p(Closing text.of the first section.)',
      'R:section-2(The bank)', 'p(Text of the bank.)', 'R:section-2(The water)', 'p(Text)',
    ].join(' ; '));
    await expect(seams(page)).toHaveCount(6);
    expect(await labels(page)).toEqual(['1. The ferryman', '1.1 The bank', '1.2 The water', '2. The return', '2.1 The bank', '2.2 The water']);
    await expect(seams(page).nth(4)).toHaveText('2.1 The bank');
    expect(await violations(page)).toEqual([]);
  });

  test('the markdown text/plain alone (another app) restores the markers, and so does Nabu’s own text/html', async ({ page }) => {
    await selectRange(page, 'Opening of the first section.', 8, 'Text of the water.', 4);
    const ev = await copy(page);
    await focusEnd(page, 'Closing text.');
    await paste(page, { 'text/plain': ev.text });
    await expect(seams(page)).toHaveCount(6);
    expect(await labels(page)).toEqual(['1. The ferryman', '1.1 The bank', '1.2 The water', '2. The return', '2.1 The bank', '2.2 The water']);
    expect(await violations(page)).toEqual([]);
    // html only, at the very end
    await focusEnd(page, 'Text');
    await paste(page, { 'text/html': ev.html });
    await expect(seams(page)).toHaveCount(8);
    expect(await labels(page)).toEqual(['1. The ferryman', '1.1 The bank', '1.2 The water', '2. The return', '2.1 The bank', '2.2 The water', '2.3 The bank', '2.4 The water']);
    expect(await violations(page)).toEqual([]);
  });

  test('a plain <h2> from the web stays a heading (a marker needs data-nabu-region)', async ({ page }) => {
    await focusEnd(page, 'Closing text.');
    await paste(page, { 'text/html': '<p>from the web</p><h2>Chapitre 2</h2><p>more</p>' });
    await expect.poll(() => roots(page)).toContain('heading(Chapitre 2)');
    await expect(seams(page)).toHaveCount(4);
    expect(await violations(page)).toEqual([]);
  });

  test('a marker pasted into a toggle BODY is hoisted right after the toggle (root-only rule)', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const t = n.insert('toggle', { text: 'Toggle', collapsed: false }, null, 9);
      n.insert('paragraph', { text: 'body one' }, t.id, 0);
      n.insert('paragraph', { text: 'body two' }, t.id, 1);
      n.insert('paragraph', { text: 'after the toggle' }, null, 10);
      await n.commit();
      n.undoManager.clear();
    });
    await expect(page.locator('[data-block-type="toggle"]')).toHaveCount(1);
    await selectRange(page, 'Opening of the first section.', 8, 'Text of the bank.', 4);
    const ev = await copy(page);
    await focusAt(page, 'body one', 4);
    await paste(page, { 'application/x-nabu+json': ev.nabuRaw, 'text/plain': ev.text });
    await expect.poll(async () => (await roots(page)).includes('toggle(Toggle)')).toBe(true);
    const outline = await roots(page);
    // the text stays in the body; the marker (only) is a root block right after the toggle
    expect(outline.slice(outline.indexOf('toggle(Toggle)'))).toBe('toggle(Toggle){p(bodyof the first section.) p(Text one) p(body two)} ; R:section-2(The bank) ; p(after the toggle)');
    expect(await violations(page)).toEqual([]);
    expect(await labels(page)).toEqual(['1. The ferryman', '1.1 The bank', '1.2 The water', '2. The return', '2.1 The bank']);
  });

  test('a marker pasted into a list item is hoisted: the list is cut around it', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const l = n.insert('list', { listType: 'bullet' }, null, 9);
      n.insert('list-item', { text: 'item one' }, l.id, 0);
      n.insert('list-item', { text: 'item two' }, l.id, 1);
      await n.commit();
      n.undoManager.clear();
    });
    await selectRange(page, 'Opening of the first section.', 8, 'Text of the bank.', 4);
    const ev = await copy(page);
    await focusAt(page, 'item one', 4);
    await paste(page, { 'application/x-nabu+json': ev.nabuRaw });
    await expect.poll(async () => (await roots(page)).includes('R:section-2(The bank) ; p(Text)')).toBe(true);
    expect(await violations(page)).toEqual([]);
    expect(await page.evaluate(() => {
      const n = (window as any).nabu;
      const nested: string[] = [];
      const walk = (node: any, depth: number) => { if (depth > 0 && node.data.get('type') === 'region') nested.push(node.id.toString()); (node.children() ?? []).forEach((c: any) => walk(c, depth + 1)); };
      n.tree.roots().forEach((r: any) => walk(r, 0));
      return nested;
    })).toEqual([]);
  });
});

test.describe('markdown export and import', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, { seed: 'regions' }); });

  test('serialize("markdown") holds the comment and the readable heading of every marker', async ({ page }) => {
    const md = await page.evaluate(() => (window as any).nabu.serialize('markdown'));
    expect(md).toBe([
      'Preamble, outside any region.',
      '<!-- region:section-1 {"title":"The ferryman"} -->\n# 1. The ferryman',
      'Opening of the first section.',
      '<!-- region:section-2 {"title":"The bank"} -->\n## 1.1 The bank',
      'Text of the bank.',
      '<!-- region:section-2 {"title":"The water"} -->\n## 1.2 The water',
      'Text of the water.',
      '<!-- region:section-1 {"title":"The return"} -->\n# 2. The return',
      'Closing text.',
    ].join('\n\n'));
  });

  test('select all + Ctrl+C: the text/plain is that same markdown', async ({ page }) => {
    await focusAt(page, 'Preamble, outside any region.', 0);
    await selectAll(page);
    const ev = await copy(page);
    expect(ev.text).toContain('<!-- region:section-2 {"title":"The bank"} -->\n## 1.1 The bank');
    expect(ev.text).toContain('<!-- region:section-1 {"title":"The return"} -->\n# 2. The return');
  });

  test('importMarkdown of a document with regions: seams with their labels, the echo headings are not blocks, idempotent', async ({ page }) => {
    const md = [
      'Preface',
      '<!-- region:section-1 {"title":"La forêt"} -->\n# Edited by hand',
      'Text',
      '<!-- region:section-2 {"title":"Le seuil"} -->\n## 1.1 Le seuil',
      'More',
      '<!-- region:section-1 {"title":"Fin"} -->',
      'End',
      '## Chapitre 2 — a plain heading, never a region',
    ].join('\n\n');
    await page.evaluate((m) => (window as any).nabu.importMarkdown(m), md);
    await expect(seams(page)).toHaveCount(3);
    await expect(seams(page).nth(0)).toHaveText('1. La forêt');
    await expect(seams(page).nth(1)).toHaveText('1.1 Le seuil');
    await expect(seams(page).nth(2)).toHaveText('2. Fin');
    // the echo headings were consumed; the heading without comment is a heading block
    await expect(page.locator('[data-block-type="heading"]')).toHaveCount(1);
    expect(await roots(page)).toBe('p(Preface) ; R:section-1(La forêt) ; p(Text) ; R:section-2(Le seuil) ; p(More) ; R:section-1(Fin) ; p(End) ; heading(Chapitre 2 — a plain heading, never a region)');
    expect(await violations(page)).toEqual([]);
    // fixed point: export -> import -> export
    const first = await page.evaluate(() => (window as any).nabu.serialize('markdown'));
    expect(first).toContain('<!-- region:section-1 {"title":"La forêt"} -->\n# 1. La forêt');
    const second = await page.evaluate(async (m) => { const n = (window as any).nabu; await n.importMarkdown(m); return n.serialize('markdown'); }, first);
    expect(second).toBe(first);
  });

  test('an invalid or foreign comment stays visible text', async ({ page }) => {
    await page.evaluate(() => (window as any).nabu.importMarkdown('<!-- region:section-1 {broken -->\n\n<!-- just a comment -->\n\n## Heading'));
    await expect(seams(page)).toHaveCount(0);
    expect(await roots(page)).toBe('p(<!-- region:section-1 {broken -->) ; p(<!-- just a comment -->) ; heading(Heading)');
  });
});
