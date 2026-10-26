/**
 * E2E — no whitespace TEXT NODE between the elements rendered by the blocks.
 *
 * The editor preserves whitespace (white-space: pre-wrap): a whitespace-only text node sitting between two elements of a block's
 * markup (typically a Svelte template indented over several lines) becomes a real, selectable line: it shows up as a phantom
 * blue bar on Ctrl+A and adds vertical space. Components must glue their tags (`><`), the way Region.svelte does.
 *
 * Allowed: text inside a block's OWN text (a RichText container: a text block element, an inline mark, a code block), which may
 * legitimately be made of spaces only. Empty text nodes ("") are Svelte anchors and are fine.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, clearAndReset, press, flushRender, getEditorText } from './helpers/editor.js';
import { selectAll } from './helpers/keyboard.js';
import { buildTree, Pp, Tog, Hr, Code, type TreeSpec } from './helpers/blocks.js';
import { focusAt, collectErrors } from './helpers/model.js';

const SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="#888"/></svg>');

const region = (regionType: string) => (title: string, ...children: TreeSpec[]): TreeSpec => ({ type: 'region', props: { regionType, title }, children });
const S1 = region('section-1');
const S2 = region('section-2');
const S3 = region('section-3');
const li = (text: string, ...children: TreeSpec[]): TreeSpec => ({ type: 'list-item', text, children });
const list = (listType: string, ...items: TreeSpec[]): TreeSpec => ({ type: 'list', props: { listType }, children: items });

/** One block of every kind (see `registry` check below), nested where the type allows it. */
const EVERYTHING: TreeSpec[] = [
  { type: 'heading', text: 'A heading', props: { level: 2 } },
  Pp('A paragraph'),
  { type: 'blockquote', text: 'A quote' },
  { type: 'callout', text: 'A callout', props: { variant: 'tip' } },
  { type: 'dialogue', text: 'A line of dialogue' },
  Code('const a = 1;\nconst b = 2;\n', 'js'),
  Hr(),
  { type: 'image', props: { ref: SVG, alt: 'an image' } },
  { type: 'video', props: { ref: 'https://example.com/v.mp4', alt: 'a video', name: 'v.mp4' } },
  { type: 'file', props: { ref: 'https://example.com/f.pdf', name: 'f.pdf' } },
  { type: 'file', props: { ref: 'https://example.com/g.pdf', name: 'g.pdf' } },
  Tog('Open toggle', [Pp('inside the toggle'), Tog('Nested toggle', [Pp('deep')])]),
  Tog('Collapsed toggle', [Pp('hidden')], true),
  list('bullet', li('one', list('ordered', li('two', list('todo', li('three'), li('four'))), li('five')), list('bullet', li('six'))), li('seven')),
  list('todo', li('open'), { type: 'list-item', text: 'done', props: { checked: true } }),
  S1('Region one', Pp('in one'), S2('Sub region', Pp('in sub'), S3('Sub sub', Pp('in sub sub'))), Pp('text after the sub region (end marker)')),
  S1('Region two', Pp('in two')),
  Pp('The end'),
];

/** Whitespace-only text nodes of the editor that are NOT part of a block's own text. Returns a readable path for each. */
function findPhantoms(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-nabu-root]')!;
    const OWN_TEXT = '.nabu-bold, .nabu-italic, .nabu-underline, .nabu-strikethrough, .nabu-code, a.nabu-link, pre, code, ' +
      '.item-content, .nabu-region-title, .nabu-callout-body, .nabu-toggle-header, ' +
      '[data-block-type="paragraph"], [data-block-type="heading"], [data-block-type="blockquote"], [data-block-type="dialogue"]';
    const label = (el: Element) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const data = (n as Text).data;
      if (data === '' || data.trim() !== '') continue;
      const parent = n.parentElement!;
      if (parent.closest(OWN_TEXT)) continue;
      const path: string[] = [];
      for (let e: Element | null = parent; e && e !== root; e = e.parentElement) path.unshift(label(e));
      out.push(`${JSON.stringify(data)} in ${path.join(' > ')}`);
    }
    return out;
  });
}

async function holdBackspace(page: Page, text: string) {
  await focusAt(page, text, 0);
  await page.keyboard.down('Backspace');
  await expect.poll(() => page.evaluate(() => (window as any).nabu.pendingCommand?.strategy ?? null)).toBe('hold');
}

let errors: ReturnType<typeof collectErrors>;
test.beforeEach(async ({ page }) => { errors = collectErrors(page); });
test.afterEach(async () => { expect(errors.list(), 'console / page errors').toEqual([]); });

test.describe('no whitespace text node in the rendered blocks', () => {
  test('seeded regions document', async ({ page }) => {
    await gotoEditor(page, { seed: 'regions' });
    await flushRender(page);
    expect(await page.locator('.nabu-region').count()).toBeGreaterThan(2);
    expect(await findPhantoms(page)).toEqual([]);
  });

  test('regions with sub-regions, an end marker and a pending hold', async ({ page }) => {
    await gotoEditor(page, { seed: 'regions' });
    await buildTree(page, [Pp('pre'), S1('One', Pp('a'), S2('Sub', Pp('b')), Pp('after the sub region')), S1('Two', Pp('c'))]);
    await expect(page.locator('[data-region-end]').first()).toBeVisible();
    expect(await findPhantoms(page)).toEqual([]);
    await holdBackspace(page, 'c');
    try {
      await expect(page.locator('[data-region-hint]')).toHaveCount(1);
      await expect(page.locator('.nabu-region-drain')).toHaveCount(1);
      expect(await findPhantoms(page)).toEqual([]);
    } finally {
      await page.keyboard.up('Backspace');
    }
  });

  test('a document holding one block of every registered type', async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await buildTree(page, EVERYTHING);
    await flushRender(page);
    // every registered block type is in the document (a new type must be added to EVERYTHING)
    const registered: string[] = await page.evaluate(() => [...(window as any).nabu.registry.keys()]);
    const present: string[] = await page.evaluate(() => {
      const types = new Set<string>();
      const walk = (bs: any[]) => bs.forEach((b) => { types.add(b.type); walk(b.children ?? []); });
      walk((window as any).nabu.children);
      return [...types];
    });
    expect(registered.filter((t) => !present.includes(t)), 'registered types missing from the fixture').toEqual([]);
    expect(await findPhantoms(page)).toEqual([]);
  });
});

test.describe('the seam adds no phantom line', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, { seed: 'regions' }); await flushRender(page); });

  test('seam-to-body gap equals the seam margin, and Ctrl+A changes nothing in the model', async ({ page }) => {
    const gaps = await page.evaluate(() => [...document.querySelectorAll('.nabu-region')].map((r) => {
      const seam = r.querySelector(':scope > .nabu-region-seam')!;
      const body = r.querySelector(':scope > .nabu-region-body')!;
      return {
        gap: body.getBoundingClientRect().top - seam.getBoundingClientRect().bottom,
        margin: parseFloat(getComputedStyle(seam).marginBottom),
        children: r.childNodes.length,
      };
    }));
    expect(gaps.length).toBeGreaterThan(2);
    for (const g of gaps) expect(Math.abs(g.gap - g.margin)).toBeLessThanOrEqual(1);

    const textBefore = await getEditorText(page);
    await focusAt(page, 'Preamble, outside any region.', 3);
    await selectAll(page);
    await flushRender(page);
    const selected = await page.evaluate(() => window.getSelection()!.toString());
    // the selection spans the document, and holds no line made of whitespace only
    expect(selected).toContain('Preamble, outside any region.');
    expect(selected).toContain('Closing text.');
    expect(selected.split('\n').filter((l) => l !== '' && l.trim() === '')).toEqual([]);
    expect(await getEditorText(page)).toBe(textBefore);
    await press(page, 'ArrowRight');
    expect(await getEditorText(page)).toBe(textBefore);
  });
});
