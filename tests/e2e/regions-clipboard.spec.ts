/**
 * E2E — Regions as containers (ADR 018): clipboard, JSON and text forms.
 *
 * A real Ctrl+C writes the three payloads (read from the ClipboardEvent, helpers/clip-capture.ts): the internal fragment
 * (`application/x-nabu+json`: a region is a block with its title as `delta` and its body as `children`), the `text/html`
 * (`<section data-nabu-region="…" data-nabu-fields='…'><hN>title</hN>…body…</section>`) and the `text/plain` (markdown: data
 * comment + heading of the title + body). Pastes are synthetic `paste` events carrying those payloads (the system clipboard is
 * unreliable for custom MIME types). Seeded document (`?seed=regions`): preamble, "The ferryman" ⊃ "The bank", "The water", then
 * "The return".
 *
 * The READING side of markdown / HTML (a pasted markdown or `<section>` becoming regions, `importMarkdown`, the end of a region
 * deduced from the levels, the closing comment) is covered at the end of this file. A TEXT selection across titles copies the text blocks only (ADR 018 §3.9): the
 * structure of whole regions travels by a structure gesture (seam, future block selection), which the tests below stand in for
 * with `regionClip` (the payloads of the whole regions, built from the model).
 */

import { test, expect, type Page } from './helpers/test.js';
import { gotoEditor } from './helpers/editor.js';
import { buildTree, Pp } from './helpers/blocks.js';
import { outline, violations, focusAt, focusEnd, selectRange, collectErrors } from './helpers/model.js';
import { copy } from './helpers/clip-capture.js';

const SEED = 'p(Preamble, outside any region.) ; R:section-1(The ferryman){ p(Opening of the first section.) ; R:section-2(The bank){ p(Text of the bank.) } ; R:section-2(The water){ p(Text of the water.) } } ; R:section-1(The return){ p(Closing text.) }';
const FERRYMAN = 'R:section-1(The ferryman){ p(Opening of the first section.) ; R:section-2(The bank){ p(Text of the bank.) } ; R:section-2(The water){ p(Text of the water.) } }';
const BANK = 'R:section-2(The bank){ p(Text of the bank.) }';

const expectOutline = (page: Page, expected: string) => expect.poll(() => outline(page), { timeout: 3000, message: 'outline' }).toBe(expected);
const labels = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).nabu.regions.list.map((r: any) => r.label));
const titles = (page: Page) => page.locator('.nabu-region-title');

/** Dispatch a paste carrying `data` at the caret. */
async function paste(page: Page, data: Record<string, string>) {
  await page.evaluate((payload) => {
    const dt = new DataTransfer();
    for (const [k, v] of Object.entries(payload)) dt.setData(k, v);
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, data);
}

/** Copy a TEXT selection from the start of `from` to the end of `last` (real Ctrl+C) and return the clipboard event. */
async function copyRegion(page: Page, from: string, last: string) {
  await selectRange(page, from, 0, last, -1);
  return copy(page);
}

/**
 * The clipboard payloads of WHOLE regions (title + body), by title: what a structure gesture will copy (a text selection copies
 * text only). Built from the model with the same serializers as a copy: internal fragment, markdown, HTML.
 */
async function regionClip(page: Page, ...titles: string[]) {
  return page.evaluate((wanted) => {
    const n = (window as any).nabu;
    const blocks = wanted.map((title) => {
      const region = [...n.blocks.values()].find((b: any) => b.type === 'region' && b.title === title);
      if (!region) throw new Error(`no region titled "${title}"`);
      return region.serializeForClipboard();
    });
    const plain = (pb: any) => (pb.delta ?? []).map((op: any) => op.insert).join('');
    const md = (pb: any, ctx: any = {}): string => {
      const Class = n.registry.get(pb.type);
      return Class?.toMarkdown ? Class.toMarkdown(pb, { ...ctx, recurse: (c: any, o: any) => md(c, o), recurseAll: (cs: any[], o: any) => cs.map((c, k) => md(c, { ...o, before: cs.slice(0, k), after: cs.slice(k + 1) })) }) : plain(pb);
    };
    const html = (pb: any): string => {
      const Class = n.registry.get(pb.type);
      return Class?.toHtml ? Class.toHtml(pb, { recurse: html }) : `<p>${plain(pb)}</p>`;
    };
    const raw = JSON.stringify({ version: 1, blocks });
    return { type: 'copy', defaultPrevented: true, nabuRaw: raw, nabu: JSON.parse(raw), text: blocks.map((b: any, k: number) => md(b, { before: blocks.slice(0, k), after: blocks.slice(k + 1) })).join('\n\n'), html: blocks.map(html).join('\n') };
  }, titles);
}

let errors: ReturnType<typeof collectErrors>;
test.beforeEach(async ({ page }) => { errors = collectErrors(page); });
test.afterEach(async () => { expect(errors.list(), 'console / page errors').toEqual([]); });

test.describe('copy and paste of whole regions (internal clipboard)', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, { seed: 'regions' }); });

  test('copying whole regions writes the three payloads: a region block with its title and its body, comment + heading, <section>', async ({ page }) => {
    const ev = await regionClip(page, 'The ferryman', 'The return');
    // the internal fragment: two root regions, the body nested in `children`, the title as the delta
    const [first, second] = ev.nabu!.blocks;
    expect([first.type, second.type]).toEqual(['region', 'region']);
    expect(first.props).toEqual({ regionType: 'section-1', fields: {} });
    expect(first.delta).toEqual([{ insert: 'The ferryman' }]);
    expect(first.children.map((c: any) => c.type)).toEqual(['paragraph', 'region', 'region']);
    expect(first.children[1].delta).toEqual([{ insert: 'The bank' }]);
    expect(first.children[1].children.map((c: any) => c.delta[0].insert)).toEqual(['Text of the bank.']);
    expect(second.delta).toEqual([{ insert: 'The return' }]);
    // text/plain: the data comment + the title as a heading of its level, then the body
    expect(ev.text).toBe([
      '<!-- region:section-1 {} -->\n# The ferryman',
      'Opening of the first section.',
      '<!-- region:section-2 {} -->\n## The bank',
      'Text of the bank.',
      '<!-- region:section-2 {} -->\n## The water',
      'Text of the water.',
      '<!-- region:section-1 {} -->\n# The return',
      'Closing text.',
    ].join('\n\n'));
    // text/html: a <section> carrying the data, the title as a heading, the body inside
    expect(ev.html).toContain('<section data-nabu-region="section-1" data-nabu-fields=\'{}\'><h1>The ferryman</h1><p>Opening of the first section.</p><section data-nabu-region="section-2" data-nabu-fields=\'{}\'><h2>The bank</h2><p>Text of the bank.</p></section>');
    expect(ev.html).toContain('<h1>The return</h1><p>Closing text.</p></section>');
  });

  test('a real Ctrl+C on a text selection across regions copies the TEXT blocks only: no region, no title (ADR 018 §3.9)', async ({ page }) => {
    const ev = await copyRegion(page, 'Preamble, outside any region.', 'Closing text.');
    expect(ev.nabu!.blocks.map((b: any) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph']);
    expect(ev.text).toBe(['Preamble, outside any region.', 'Opening of the first section.', 'Text of the bank.', 'Text of the water.', 'Closing text.'].join('\n\n'));
    expect(ev.html).not.toContain('data-nabu-region');
    for (const title of ['The ferryman', 'The bank', 'The water', 'The return']) expect(ev.nabuRaw).not.toContain(title);
    await expectOutline(page, SEED); // a copy changes nothing
  });

  test('pasting a copied region after a region: it lands as a sibling (levels are checked), its sub-regions come with it, numbering follows', async ({ page }) => {
    const ev = await regionClip(page, 'The bank');
    expect(ev.nabu!.blocks.map((b: any) => b.type)).toEqual(['region']);
    await focusEnd(page, 'Closing text.');
    await paste(page, { 'application/x-nabu+json': ev.nabuRaw, 'text/plain': ev.text, 'text/html': ev.html });
    // a section-2 pasted in the body of "The return" (a section-1): valid there (deeper than its parent)
    await expectOutline(page, SEED.replace('p(Closing text.) }', 'p(Closing text.) ; R:section-2(The bank){ p(Text of the bank.) } }'));
    expect(await labels(page)).toEqual(['1. The ferryman', '1.1 The bank', '1.2 The water', '2. The return', '2.1 The bank']);
    await expect(titles(page)).toHaveText(['The ferryman', 'The bank', 'The water', 'The return', 'The bank']);
    expect(await violations(page)).toEqual([]);
  });

  test('a section-1 pasted inside the body of a section-1 is moved right after its parent by the normalizer (one undo step with the paste)', async ({ page }) => {
    const ev = await regionClip(page, 'The return');
    await focusEnd(page, 'Text of the water.');
    await paste(page, { 'application/x-nabu+json': ev.nabuRaw });
    // the copy is a section-1; pasted in the body of "The water" (section-2) it must climb out to the root, after "The ferryman"
    await expect.poll(async () => (await outline(page)).split(' ; ').length).toBeGreaterThan(SEED.split(' ; ').length);
    expect(await violations(page)).toEqual([]);
    expect(await labels(page)).toEqual(['1. The ferryman', '1.1 The bank', '1.2 The water', '2. The return', '3. The return']);
    await expect(page.locator('.nabu-region > .nabu-region-body > .nabu-region')).toHaveCount(2);
    await page.evaluate(() => (window as any).nabu.undo());
    await expectOutline(page, SEED);
    expect(await violations(page)).toEqual([]);
  });

  test('a region pasted into a toggle BODY is hoisted right after the toggle (placement rule)', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const t = n.insert('toggle', { text: 'Toggle', collapsed: false }, null, 3);
      n.insert('paragraph', { text: 'body one' }, t.id, 0);
      n.insert('paragraph', { text: 'body two' }, t.id, 1);
      n.insert('paragraph', { text: 'after the toggle' }, null, 4);
      await n.commit();
      n.undoManager.clear();
    });
    await expect(page.locator('[data-block-type="toggle"]')).toHaveCount(1);
    const ev = await regionClip(page, 'The bank');
    await focusEnd(page, 'body one');
    await paste(page, { 'application/x-nabu+json': ev.nabuRaw, 'text/plain': ev.text });
    await expect.poll(async () => (await outline(page)).includes('toggle(Toggle)')).toBe(true);
    const out = await outline(page);
    // the toggle keeps its body; the region (only) is a root block right after the toggle
    expect(out.slice(out.indexOf('toggle(Toggle)'))).toBe(`toggle(Toggle){p(body one) p(body two)} ; ${BANK} ; p(after the toggle)`);
    expect(await violations(page)).toEqual([]);
    expect(await labels(page)).toEqual(['1. The ferryman', '1.1 The bank', '1.2 The water', '2. The return', '1 The bank']);
  });

  test('a region pasted into a list item is hoisted: the list is cut around it', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const l = n.insert('list', { listType: 'bullet' }, null, 3);
      n.insert('list-item', { text: 'item one' }, l.id, 0);
      n.insert('list-item', { text: 'item two' }, l.id, 1);
      await n.commit();
      n.undoManager.clear();
    });
    const ev = await regionClip(page, 'The bank');
    await focusEnd(page, 'item one');
    await paste(page, { 'application/x-nabu+json': ev.nabuRaw });
    await expect.poll(async () => (await outline(page)).includes(`${BANK} ; ul[`)).toBe(true);
    const out = await outline(page);
    expect(out.slice(out.indexOf('ul['))).toBe(`ul[item one] ; ${BANK} ; ul[item two]`);
    expect(await violations(page)).toEqual([]);
    // no region ended up inside a list
    expect(await page.evaluate(() => {
      const n = (window as any).nabu;
      const nested: string[] = [];
      const walk = (node: any, inList: boolean) => { if (inList && node.data.get('type') === 'region') nested.push(node.id.toString()); (node.children() ?? []).forEach((c: any) => walk(c, inList || node.data.get('type') === 'list')); };
      n.tree.roots().forEach((r: any) => walk(r, false));
      return nested;
    })).toEqual([]);
  });

  test('a plain <h2> from the web stays a heading (only <section data-nabu-region> carries a region)', async ({ page }) => {
    await focusEnd(page, 'Closing text.');
    await paste(page, { 'text/html': '<p>from the web</p><h2>Chapitre 2</h2><p>more</p>' });
    await expect.poll(async () => (await outline(page)).includes('heading(Chapitre 2)')).toBe(true);
    await expect(page.locator('.nabu-region')).toHaveCount(4);
    expect(await violations(page)).toEqual([]);
  });
});

test.describe('a multi-block paste in a title lands flat', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await buildTree(page, [Pp('one'), Pp('two'), { type: 'region', props: { regionType: 'section-1', title: 'Part' }, children: [Pp('body')] }]);
  });

  test('two pasted paragraphs go into the title on one line (joined by a space), nothing goes to the body', async ({ page }) => {
    const ev = await copyRegion(page, 'one', 'two');
    expect(ev.nabu!.blocks.map((b: any) => b.type)).toEqual(['paragraph', 'paragraph']);
    await focusAt(page, 'Part', 2);
    await paste(page, { 'application/x-nabu+json': ev.nabuRaw, 'text/plain': ev.text });
    await expectOutline(page, 'p(one) ; p(two) ; R:section-1(Paone twort){ p(body) }');
    await expect(titles(page)).toHaveText(['Paone twort']);
    expect(await violations(page)).toEqual([]);
  });

  test('a single pasted paragraph is the engine\'s inline paste: its text goes into the title', async ({ page }) => {
    const ev = await copyRegion(page, 'one', 'one');
    await focusAt(page, 'Part', 4);
    await paste(page, { 'application/x-nabu+json': ev.nabuRaw, 'text/plain': ev.text });
    await expectOutline(page, 'p(one) ; p(two) ; R:section-1(Partone){ p(body) }');
    expect(await violations(page)).toEqual([]);
  });
});

test.describe('JSON and markdown export', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, { seed: 'regions' }); });

  test('serialize("json") -> importJSON restores the nested regions exactly (titles, types, bodies)', async ({ page }) => {
    const json = await page.evaluate(() => JSON.parse(JSON.stringify((window as any).nabu.serialize('json'))));
    await page.evaluate(async () => { const n = (window as any).nabu; for (const c of [...n.children]) n.delete(c); n.insert('paragraph', { text: 'scratch' }); await n.commit(); });
    await page.evaluate(async (j) => { await (window as any).nabu.importJSON(j); }, json);
    await expectOutline(page, SEED);
    expect(await labels(page)).toEqual(['1. The ferryman', '1.1 The bank', '1.2 The water', '2. The return']);
    await expect(page.locator('.nabu-region > .nabu-region-body > .nabu-region')).toHaveCount(2);
    expect(await violations(page)).toEqual([]);
  });

  test('serialize("markdown") holds the data comment and the heading of the title of every region, bodies in place', async ({ page }) => {
    const md = await page.evaluate(() => (window as any).nabu.serialize('markdown'));
    expect(md).toBe([
      'Preamble, outside any region.',
      '<!-- region:section-1 {} -->\n# The ferryman',
      'Opening of the first section.',
      '<!-- region:section-2 {} -->\n## The bank',
      'Text of the bank.',
      '<!-- region:section-2 {} -->\n## The water',
      'Text of the water.',
      '<!-- region:section-1 {} -->\n# The return',
      'Closing text.',
    ].join('\n\n'));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Lot C — reading markdown / HTML back into regions
// ════════════════════════════════════════════════════════════════════════════

test.describe('markdown / HTML import of regions', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, { seed: 'regions' }); });

  test('the markdown text/plain alone (another app) restores the regions, and so does Nabu\'s own text/html', async ({ page }) => {
    const ev = await regionClip(page, 'The bank', 'The water');
    await focusEnd(page, 'Closing text.');
    await paste(page, { 'text/plain': ev.text });
    await expect(page.locator('.nabu-region')).toHaveCount(6);
    await focusEnd(page, 'Opening of the first section.');
    await paste(page, { 'text/html': ev.html });
    await expect(page.locator('.nabu-region')).toHaveCount(8);
  });

  test('importMarkdown of a document with regions: titles, nesting deduced from the levels, idempotent', async ({ page }) => {
    const md = [
      'Preface',
      '<!-- region:section-1 {} -->\n# La forêt',
      'Text',
      '<!-- region:section-2 {} -->\n## Le seuil',
      'More',
      '<!-- region:section-1 {} -->\n# Fin',
      'End',
    ].join('\n\n');
    await page.evaluate((m) => (window as any).nabu.importMarkdown(m), md);
    await expectOutline(page, 'p(Preface) ; R:section-1(La forêt){ p(Text) ; R:section-2(Le seuil){ p(More) } } ; R:section-1(Fin){ p(End) }');
    const first = await page.evaluate(() => (window as any).nabu.serialize('markdown'));
    const second = await page.evaluate(async (m) => { const n = (window as any).nabu; await n.importMarkdown(m); return n.serialize('markdown'); }, first);
    expect(second).toBe(first);
  });

  test('importMarkdown with closing comments: text after a sub-region goes back to its parent; the document is a fixed point', async ({ page }) => {
    const md = [
      '<!-- region:section-1 {} -->\n# Part',
      'In the part.',
      '<!-- region:section-2 {} -->\n## Sub',
      'In the sub.',
      '<!-- /region -->',
      'Back in the part.',
      '<!-- /region -->',
      'At the root.',
    ].join('\n\n');
    await page.evaluate((m) => (window as any).nabu.importMarkdown(m), md);
    await expectOutline(page, 'R:section-1(Part){ p(In the part.) ; R:section-2(Sub){ p(In the sub.) } ; p(Back in the part.) } ; p(At the root.)');
    expect(await page.evaluate(() => (window as any).nabu.serialize('markdown'))).toBe(md);
    expect(await violations(page)).toEqual([]);
  });

  test('an invalid or foreign comment stays visible text; a heading without comment is never a region', async ({ page }) => {
    await page.evaluate(() => (window as any).nabu.importMarkdown('<!-- region:section-1 {broken -->\n\n<!-- just a comment -->\n\n## Heading'));
    await expect(page.locator('.nabu-region')).toHaveCount(0);
    await expectOutline(page, 'p(<!-- region:section-1 {broken -->) ; p(<!-- just a comment -->) ; heading(Heading)');
  });
});
