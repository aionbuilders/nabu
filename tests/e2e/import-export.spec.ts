/**
 * E2E — STRUCTURAL round trip of import / export (lot 5e), in the real editor.
 *
 * A "kitchen sink" document (every block type, nested lists of mixed types, P-28 sublists, toggles collapsed / open /
 * nested, callouts, code, marks, media) is built THROUGH THE API, exported (`serialize('json')` / `'markdown'`), then
 * imported into a FRESH editor (the page is reloaded) with `importJSON` / `importMarkdown`. The trees are compared on the
 * MODEL (every key stored on the Loro nodes), the rendered DOM is checked (no `<details>` text on screen, toggles render,
 * structural invariants) and no console error may appear. Formats: docs/design/import-export.md.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, clearAndReset } from './helpers/editor.js';
import { pasteText } from './helpers/clipboard.js';
import { buildDoc, P, UL, TODO, I, outline, expectValid, collectErrors, focusEmpty } from './helpers/model.js';

// ── The kitchen sink ───────────────────────────────────────────────────────

type Spec = { type: string; props?: Record<string, any>; delta?: any[]; children?: Spec[] };
const t = (insert: string, attributes?: Record<string, any>) => (attributes ? { insert, attributes } : { insert });
const item = (text: string | any[], extra: Partial<Spec> = {}): Spec => ({ type: 'list-item', delta: typeof text === 'string' ? [t(text)] : text, ...extra });
const list = (listType: string, items: Spec[], start?: number): Spec => ({ type: 'list', props: start ? { listType, start } : { listType }, children: items });
const todo = (text: string, checked: boolean, children?: Spec[]): Spec => item(text, { props: { checked }, ...(children ? { children } : {}) });
const para = (...delta: any[]): Spec => ({ type: 'paragraph', delta: delta.map((d) => (typeof d === 'string' ? t(d) : d)) });

const SINK: Spec[] = [
  { type: 'heading', props: { level: 1 }, delta: [t('Title')] },
  { type: 'heading', props: { level: 2 }, delta: [t('Two')] },
  { type: 'heading', props: { level: 3 }, delta: [t('Three')] },
  { type: 'heading', props: { level: 4 }, delta: [t('Four')] },
  { type: 'heading', props: { level: 5 }, delta: [t('Five')] },
  { type: 'heading', props: { level: 6 }, delta: [t('Six '), t('bold', { bold: true })] },
  para('Plain ', t('bold', { bold: true }), ' ', t('italic', { italic: true }), ' ', t('strike', { strikethrough: true }), ' ', t('under', { underline: true }), ' ', t('code', { code: true }), ' and ', t('a link', { link: 'https://example.com/a_(b)' }), '.'),
  para(t('bold link', { bold: true, link: 'https://example.com/' }), ' and *stars* \\ backslash _under_ `tick` [brackets](x) <b>tags</b> # hash'),
  para('line one\nline two'),
  { type: 'blockquote', delta: [t('A '), t('quote', { italic: true })] },
  { type: 'divider' },
  { type: 'code', props: { language: 'js' }, delta: [t('let a = 1;\n\nconsole.log(`a`);')] },
  { type: 'code', props: { language: null }, delta: [t('no language')] },
  { type: 'code', props: { language: 'md' }, delta: [t('```\nfence inside\n```')] },
  { type: 'callout', props: { variant: 'note' }, delta: [t('A note')] },
  { type: 'callout', props: { variant: 'tip' }, delta: [t('A '), t('tip', { bold: true })] },
  { type: 'callout', props: { variant: 'warning' }, delta: [t('first\nsecond')] },
  { type: 'callout', props: { variant: 'important' }, delta: [t('Important')] },
  { type: 'callout', props: { variant: 'caution' }, delta: [t('Careful')] },
  { type: 'dialogue', delta: [t('Hello '), t('there', { italic: true })] },
  { type: 'image', props: { ref: 'https://example.com/i.png', alt: 'an image', name: 'i.png' } },
  { type: 'video', props: { ref: 'https://example.com/v.mp4', alt: 'a video', name: 'v.mp4' } },
  { type: 'file', props: { ref: 'https://example.com/f.pdf', name: 'f.pdf' } },
  list('bullet', [
    item('one', { children: [
      list('ordered', [
        item('three'),
        item('four', { children: [list('todo', [todo('todo a', false), todo('todo b', true)])] }),
      ], 3),
    ] }),
    item('multi', { children: [list('bullet', [item('m1')]), list('ordered', [item('m2')]), list('todo', [todo('m3', true)])] }), // P-28
    item([t('two '), t('bold', { bold: true })]),
  ]),
  list('ordered', [item('first'), item('second')]),
  list('todo', [todo('open', false), todo('done', true)]),
  list('bullet', [item('after a to-do list')]), // adjacent to the to-do list above: P-30
  {
    type: 'toggle', props: { collapsed: false }, delta: [t('Open toggle '), t('bold', { bold: true })], children: [
      para('inside the toggle'),
      list('bullet', [item('in a list')]),
      { type: 'toggle', props: { collapsed: true }, delta: [t('Nested collapsed')], children: [para('deep'), { type: 'code', props: { language: 'py' }, delta: [t('x = 1')] }, { type: 'toggle', props: { collapsed: false }, delta: [t('Nested again')], children: [para('deeper')] }] },
      { type: 'heading', props: { level: 2 }, delta: [t('Heading in toggle')] },
    ],
  },
  { type: 'toggle', props: { collapsed: true }, delta: [t('Collapsed toggle')], children: [para('hidden body'), para('second')] },
  { type: 'toggle', props: { collapsed: true }, delta: [t('Empty toggle')] },
  para('# not a heading'),
  para('- not a list'),
  para('</details> and <details> are text here'),
];

/** Build `specs` at the root of the editor, through `nabu.insert` (the public API), then commit. */
async function build(page: Page, specs: Spec[]) {
  await page.evaluate(async (blocks) => {
    const n = (window as any).nabu;
    for (const c of [...n.children]) n.delete(c);
    const ins = (spec: any, parentId: string | null, index: number | null) => {
      const block = n.insert(spec.type, { ...(spec.props ?? {}), ...(spec.delta ? { delta: spec.delta } : {}) }, parentId, index);
      (spec.children ?? []).forEach((c: any, i: number) => ins(c, block.id, i));
    };
    blocks.forEach((b: any, i: number) => ins(b, null, i));
    await n.commit();
    n.undoManager.clear();
  }, specs);
  await page.waitForFunction(() => {
    const n = (window as any).nabu;
    const count = (nodes: any[]): number => nodes.reduce((s, x) => s + 1 + count(x.children() ?? []), 0);
    // a collapsed toggle does not mount its body
    return document.querySelectorAll('[data-block-id]').length > 0 && n.tree.roots().length > 0 && count(n.tree.roots()) > 0;
  });
}

/** Every key stored on every node of the MODEL tree (text containers as deltas); ids are not part of it. */
async function dump(page: Page): Promise<any[]> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    const d = (node: any): any => {
      const props: Record<string, any> = {};
      for (const k of node.data.keys()) {
        if (k === 'type') continue;
        const v = node.data.get(k);
        props[k] = v && typeof v.toDelta === 'function' ? v.toDelta() : v;
      }
      return { type: node.data.get('type'), props, children: (node.children() ?? []).map(d) };
    };
    return n.tree.roots().map(d);
  });
}

/** A fresh editor: reload the page and start from its single empty paragraph. */
async function freshEditor(page: Page) {
  await gotoEditor(page);
  await clearAndReset(page);
}

const importMarkdown = (page: Page, md: string) => page.evaluate(async (m) => { await (window as any).nabu.importMarkdown(m); }, md);
const importJSON = (page: Page, json: any) => page.evaluate(async (j) => { await (window as any).nabu.importJSON(j); }, json);
const exportDoc = (page: Page, format: 'markdown' | 'json') => page.evaluate((f) => (window as any).nabu.serialize(f), format);

/** What the rendered DOM must look like for the sink: no markup text on screen, the toggles rendered, a valid tree. */
async function expectSaneDom(page: Page) {
  await expectValid(page);
  const shown = await page.locator('[contenteditable="true"]').first().innerText();
  expect(shown).not.toMatch(/<\/?summary|<details open>/);
  // the only `<details>` on screen is the literal text of the sink's last paragraph
  expect(shown).toContain('</details> and <details> are text here');
  expect(shown.split('<details>').length - 1).toBe(1);
  expect(shown.split('</details>').length - 1).toBe(1);
  // open toggle + nested collapsed + collapsed + empty (the bodies of collapsed toggles are not mounted)
  expect(await page.locator('.nabu-toggle').count()).toBe(4);
  expect(await page.locator('.nabu-toggle.collapsed').count()).toBe(3);
  expect(await page.locator('.nabu-toggle-header', { hasText: 'Open toggle' }).count()).toBe(1);
}

let errors: ReturnType<typeof collectErrors>;

test.beforeEach(async ({ page }) => {
  errors = collectErrors(page);
  await gotoEditor(page);
  await clearAndReset(page);
});

test.afterEach(async () => {
  expect(errors.list(), 'console / page errors').toEqual([]);
});

// ── JSON ────────────────────────────────────────────────────────────────────

test('JSON: the kitchen sink survives export -> a fresh editor -> importJSON, every prop included', async ({ page }) => {
  await build(page, SINK);
  const original = await dump(page);
  expect(original).toHaveLength(SINK.length);
  const json = await exportDoc(page, 'json');
  expect(json.version).toBe('1');

  await freshEditor(page);
  await importJSON(page, JSON.parse(JSON.stringify(json)));
  expect(await dump(page)).toEqual(original);
  await expectSaneDom(page);

  // a second generation is identical too
  const again = await exportDoc(page, 'json');
  await freshEditor(page);
  await importJSON(page, again);
  expect(await dump(page)).toEqual(original);
});

test('JSON: an export of an unknown version is refused and the document is untouched', async ({ page }) => {
  await build(page, [para('keep me')]);
  const before = await dump(page);
  await importJSON(page, { version: '99', blocks: [{ type: 'paragraph', content: [{ text: 'from the future' }] }] });
  expect(await dump(page)).toEqual(before);
});

// ── Markdown ────────────────────────────────────────────────────────────────

test('markdown: the kitchen sink survives export -> a fresh editor -> importMarkdown (documented loss aside)', async ({ page }) => {
  await build(page, SINK);
  const original = await dump(page);
  const md = await exportDoc(page, 'markdown');
  expect(md).toContain('<details open>\n<summary>Open toggle **bold**</summary>');
  expect(md).toContain('<details>\n<summary>Collapsed toggle</summary>');

  // what markdown cannot express: the name of an image, the type of a video / file (a link in a paragraph)
  const expected = original.map((n) => {
    if (n.type === 'image') return { ...n, props: { ...n.props, name: '' } };
    if (n.type === 'video') return { type: 'paragraph', props: { text: [t('a video', { link: 'https://example.com/v.mp4' })] }, children: [] };
    if (n.type === 'file') return { type: 'paragraph', props: { text: [t('f.pdf', { link: 'https://example.com/f.pdf' })] }, children: [] };
    return n;
  });

  await freshEditor(page);
  await importMarkdown(page, md);
  expect(await dump(page)).toEqual(expected);
  await expectSaneDom(page);
  // and the markdown is a fixed point
  expect(await exportDoc(page, 'markdown')).toBe(md);
});

test('markdown: the <details> construct Nabu emits is a toggle (paste too); every other HTML stays literal text', async ({ page }) => {
  // PASTE: a toggle with a markdown body
  await focusEmpty(page);
  await pasteText(page, '<details open>\n<summary>**Why** it works</summary>\n\nBecause:\n\n- one\n- two\n\n</details>');
  await expect.poll(() => outline(page)).toMatch(/(^| ; )toggle\(Why it works\)\{p\(Because:\) ul\[one, two\]\}$/);
  expect(await page.locator('.nabu-toggle').count()).toBe(1);
  expect(await page.locator('.nabu-toggle.collapsed').count()).toBe(0);
  await expectValid(page);

  // IMPORT: attributes, wrong case, no closing line, no summary: literal text, no toggle, nothing interpreted
  const literal = [
    '<details class="x">', '<summary>S</summary>', '', 'body', '', '</details>', '',
    '<details onclick="alert(1)">', '<summary>S</summary>', '', 'b', '', '</details>', '',
    '<DETAILS>', '<summary>S</summary>', '', 'c', '', '</details>', '',
    '<details>', '<summary>S</summary>', '', 'never closed',
  ].join('\n');
  await importMarkdown(page, literal);
  const model = await dump(page);
  expect(model.every((n: any) => n.type === 'paragraph')).toBe(true);
  expect(await page.locator('.nabu-toggle').count()).toBe(0);
  const shown = await page.locator('[contenteditable="true"]').first().innerText();
  expect(shown).toContain('<details class="x">');
  expect(shown).toContain('<details onclick="alert(1)">');
  expect(await page.locator('[contenteditable="true"] details').count()).toBe(0);
  await expectValid(page);
});

test('markdown P-30: a change of marker starts a new list, and the exporter alternates it between adjacent lists', async ({ page }) => {
  await importMarkdown(page, '- [ ] a\n* b\n1. c\n2) d');
  // the ordered lists `1.` / `2)` are adjacent lists of one type: merged by the normalizer
  await expect.poll(() => outline(page)).toBe('todo[[ ] a] ; ul[b] ; ol[c, d]');

  // a to-do list directly followed by a bullet list, built through the API: exported with different bullets
  await buildDoc(page, [TODO(I('t1'), I('t2', { checked: true })), UL(I('b1'), I('b2', TODO(I('s1')))), P('end')]);
  const before = await outline(page);
  const md = await exportDoc(page, 'markdown');
  expect(md).toBe('- [ ] t1\n- [x] t2\n\n* b1\n* b2\n  - [ ] s1\n\nend');
  await freshEditor(page);
  await importMarkdown(page, md);
  expect(await outline(page)).toBe(before);
  await expectValid(page);
});

test('markdown: a fenced code in a list item is the TEXT of the item, exported as an indented fence and read back unchanged', async ({ page }) => {
  await importMarkdown(page, '- install\n  ```sh\n  npm i nabu\n  ```\n- done');
  const first = await dump(page);
  expect(first[0].children[0].props.text).toEqual([t('install\n```sh\nnpm i nabu\n```')]);
  const md = await exportDoc(page, 'markdown');
  expect(md).toBe('- install\n  ```sh\n  npm i nabu\n  ```\n- done');
  await freshEditor(page);
  await importMarkdown(page, md);
  expect(await dump(page)).toEqual(first);
  await expectValid(page);
});
