import { describe, it, expect } from 'vitest';
import { buildDoc } from '../../src/site/docs/doc.server.js';
import { loadDocEngine, createDocEngine } from '../../src/site/docs/doc-preset.js';
import { DocTableBlock, splitRow } from '../../src/site/docs/table.svelte.js';

// The Nabu document of a documentation page, built the way the site builds it (src/site/docs/doc.server.js): the premise of the
// server render + hydration is that the browser rebuilds, from the snapshot, the SAME tree with the SAME block ids.

const MD = [
  '# Title', '', 'Intro with a [link](./other.md#part) and `code`.', '',
  '## Install', '', '```bash', 'npm install thing', '```', '',
  '```js test', 'const a = "x"; // note', '```', '',
  '| Name | Type | Notes |', '|:---|:---:|---:|', '| `a` | **b** | c \\| d |', '| e | f | |', '',
  '## Install', '', '### Deeper', '', '#### Too deep', '', '- one', '- two', '',
].join('\n');

describe('buildDoc', () => {
  it('collects the headings (unique anchors), the table of contents and the code tokens', async () => {
    const doc = await buildDoc(MD, { dir: 'docs/guides' });
    expect(doc.title).toBe('Title');
    expect(Object.values(doc.ids)).toEqual(['title', 'install', 'install-1', 'deeper', 'too-deep']);
    expect(doc.toc).toEqual([
      { id: 'install', label: 'Install', level: 1 },
      { id: 'install-1', label: 'Install', level: 1 },
      { id: 'deeper', label: 'Deeper', level: 2 },
    ]);
    // two highlighted blocks; the tokens add up to the source (ADR 013's contract) and use the --shiki-* variables
    const tokens = Object.values(doc.code);
    expect(tokens).toHaveLength(2);
    expect(tokens.map((t) => t.map((s) => s[0]).join(''))).toEqual(['npm install thing', 'const a = "x"; // note']);
    expect(tokens[1].some(([, color]) => color === '--shiki-token-comment')).toBe(true);
  });

  it('is reproducible: the same Markdown gives the same block ids (one peer), so the same prerendered markup', async () => {
    // (the snapshot bytes themselves carry a timestamp; the tree, and with it every `data-block-id`, does not)
    const [a, b] = [await buildDoc(MD, { dir: 'docs/guides' }), await buildDoc(MD, { dir: 'docs/guides' })];
    expect(a.ids).toEqual(b.ids);
    expect(Object.keys(a.ids)[0]).toMatch(/^\d+@1$/);
    expect(loadDocEngine(a.snapshot).serialize('json')).toEqual(loadDocEngine(b.snapshot).serialize('json'));
  });

  it('the engine the browser rebuilds from the snapshot is the same document, block ids included', async () => {
    const doc = await buildDoc(MD, { dir: 'docs/guides' });
    const engine = loadDocEngine(doc.snapshot);
    expect(engine.readonly).toBe(true);
    const ids = [];
    const walk = (blocks) => blocks.forEach((b) => { ids.push(b.id); walk(b.children ?? []); });
    walk(engine.children);
    for (const id of Object.keys(doc.ids)) expect(ids).toContain(id);
    for (const id of Object.keys(doc.code)) expect(ids).toContain(id);
    expect(engine.children.map((b) => b.type)).toEqual(['heading', 'paragraph', 'heading', 'code', 'code', 'table', 'heading', 'heading', 'heading', 'list']);
  });

  it('rewrites the links and drops the test flag before the import', async () => {
    const engine = loadDocEngine((await buildDoc(MD, { dir: 'docs/guides' })).snapshot);
    const json = engine.serialize('json');
    const link = json.blocks[1].content.find((r) => r.link ?? r.attributes?.link);
    expect(JSON.stringify(link)).toContain('/docs/guides/other#part');
    expect(json.blocks.filter((b) => b.type === 'code').map((b) => b.props.language)).toEqual(['bash', 'js']);
  });
});

describe('the table block', () => {
  it('reads a GFM table: header, alignment, rows padded to the header width, escaped pipes, inline marks', async () => {
    const engine = createDocEngine();
    await engine.importMarkdown(MD);
    const table = engine.children.find((b) => b.type === 'table');
    expect(table).toBeInstanceOf(DocTableBlock);
    expect(table.head.map((c) => c.map((o) => o.insert).join(''))).toEqual(['Name', 'Type', 'Notes']);
    expect(table.align).toEqual(['left', 'center', 'right']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][0]).toEqual([{ insert: 'a', attributes: { code: true } }]);
    expect(table.rows[0][1]).toEqual([{ insert: 'b', attributes: { bold: true } }]);
    expect(table.rows[0][2].map((o) => o.insert).join('')).toBe('c | d');
    expect(table.rows[1][2]).toEqual([]); // padded cell
  });

  it('round-trips to Markdown and HTML', async () => {
    const engine = createDocEngine();
    await engine.importMarkdown('| A | B |\n|---|--:|\n| 1 | `x` |\n');
    const md = engine.serialize('markdown');
    expect(md).toBe('| A | B |\n| --- | ---: |\n| 1 | x |');
    expect(DocTableBlock.toHtml({ props: { head: [[{ insert: 'A' }]], rows: [[[{ insert: '<1>' }]]], align: ['right'] } }))
      .toBe('<table><thead><tr><th style="text-align:right">A</th></tr></thead><tbody><tr><td style="text-align:right">&lt;1&gt;</td></tr></tbody></table>');
  });

  it('is not a table without a delimiter row of the same width', async () => {
    const engine = createDocEngine();
    await engine.importMarkdown('| A | B |\n| text | text |\n\nplain | pipes\n');
    expect(engine.children.map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
    expect(splitRow('| a | b \\| c |')).toEqual(['a', 'b \\| c']);
  });
});

describe('the blocks Nabu\'s Markdown syntax makes, in a docs page', () => {
  const SAMPLE = [
    '# Tour', '', 'Text with **bold**.', '',
    '<details>', '<summary>More</summary>', '', 'Hidden text.', '', '</details>', '',
    '> [!NOTE]', '> A callout.', '',
    '<!-- region:section-2 {"title":"A region"} -->', '', 'Inside the region.', '', '<!-- /region -->', '',
    '-- Dialogue line', '',
    '- [ ] To do', '- [x] Done', '',
    '![The Nabu mark](/nabu-icon-512.png)', '',
    '> A plain quote', '',
  ].join('\n');

  it('are real blocks (toggle, callout, region, dialogue, to-do list, image), not text', async () => {
    const engine = createDocEngine();
    await engine.importMarkdown(SAMPLE);
    const types = [];
    const walk = (blocks) => blocks.forEach((b) => { types.push(b.type); walk(b.children ?? []); });
    walk(engine.children);
    for (const type of ['toggle', 'callout', 'region', 'dialogue', 'list', 'image', 'blockquote']) expect(types, type).toContain(type);
    const list = engine.serialize('json').blocks.find((b) => b.type === 'list');
    expect(list.props.listType).toBe('todo');
    expect(engine.serialize('json').blocks.find((b) => b.type === 'image').props).toMatchObject({ ref: '/nabu-icon-512.png', alt: 'The Nabu mark' });
  });

  it('survive the snapshot, so the page can be rendered and hydrated', async () => {
    const doc = await buildDoc(SAMPLE, { dir: 'docs/getting-started' });
    const engine = loadDocEngine(doc.snapshot);
    expect(engine.children.map((b) => b.type)).toEqual(['heading', 'paragraph', 'toggle', 'callout', 'region', 'dialogue', 'list', 'image', 'blockquote']);
  });
});
