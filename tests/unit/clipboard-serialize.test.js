// @ts-nocheck
/**
 * Unit tests for COPY serialization (P-43 / P-45 / P-46): `MegaBlock.serializeForClipboard` on hybrid blocks (text +
 * children: list item, toggle), structural props, ordered-list renumbering, and the text/plain rule of `Nabu.handleCopy`.
 */

import { describe, it, expect, vi } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { HeadingExtension } from '$lib/blocks/heading/index.js';
import { CodeExtension } from '$lib/blocks/code/index.js';
import { ToggleExtension } from '$lib/blocks/toggle/index.js';
import { ListExtension, ListItemExtension } from '$lib/blocks/list/index.js';
import { MarkdownPasteExtension } from '$lib/paste/markdown.paste.js';
import { PlainTextPasteExtension } from '$lib/paste/plain-text.paste.js';
import { HtmlPasteExtension } from '$lib/paste/html.paste.js';
import { NabuPasteExtension } from '$lib/paste/nabu.paste.js';

const EXTENSIONS = [
  ParagraphExtension, HeadingExtension, CodeExtension, ToggleExtension, ListExtension, ListItemExtension,
  MarkdownPasteExtension, HtmlPasteExtension, NabuPasteExtension, PlainTextPasteExtension,
];

async function makeEditor() {
  const engine = new Nabu({ extensions: EXTENSIONS });
  await engine.commit();
  return engine;
}

/** Every block of the tree, depth-first. */
function allBlocks(engine) {
  const all = [];
  const walk = (b) => { all.push(b); (b.children ?? []).forEach(walk); };
  engine.children.forEach(walk);
  return all;
}

/** Fake selection from `fromText`@`from` to `toText`@`to` (`to` = -1 -> end of the block), then run handleCopy. */
function copy(engine, fromText, from, toText, to) {
  const all = allBlocks(engine);
  const first = all.find((b) => b.text === fromText);
  const last = all.find((b) => b.text === toText);
  if (!first || !last) throw new Error('no block ' + fromText + ' / ' + toText);
  engine.selection = {
    sync: vi.fn(), isCollapsed: false, startBlock: first, endBlock: last,
    start: { from }, end: { to: to === -1 ? last.text.length : to }, setCursor: vi.fn(), anchorBlock: first, focusBlock: last,
  };
  const data = {};
  engine.handleCopy({ preventDefault: vi.fn(), clipboardData: { setData: (k, v) => { data[k] = v; } } });
  return { fragment: data['application/x-nabu+json'] ? JSON.parse(data['application/x-nabu+json']) : null, html: data['text/html'], text: data['text/plain'] };
}

/** `type(text){children}` compact form of a fragment block. */
const shape = (b) => {
  const text = b.delta ? JSON.stringify(b.delta.map((op) => op.insert).join('')) : '∅';
  const kids = b.children?.length ? `[${b.children.map(shape).join(' ')}]` : '';
  return `${b.type}${b.partial === undefined ? '' : `(${b.partial})`}${text}${kids}`;
};

const MD_NESTED = '- x1\n- a\n  - s1\n  - s2\n  - S3';

describe('P-43 hybrid blocks (list item with a sublist)', () => {
  it('boundary hybrid block (start): its text tail AND the children inside the selection are copied (test 4)', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('- top\n- alpha\n  - one\n  - two\n  - three');
    const { fragment, html, text } = copy(engine, 'alpha', 2, 'two', 1);
    expect(fragment.blocks.map(shape)).toEqual(['list-item(start)"pha"[list∅[list-item(false)"one" list-item(end)"t"]]']);
    expect(text).toBe('- pha\n  - one\n  - t');
    expect(html).toContain('<ul><li>one</li><li>t</li></ul>');
  });

  it('pure-container branch keeps the TEXT of a hybrid block that is neither boundary nor fully selected (P-29)', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown(MD_NESTED);
    const { fragment, text } = copy(engine, 'x1', 1, 'S3', 1);
    expect(fragment.blocks.map(shape)).toEqual([
      'list∅[list-item(start)"1" list-item(false)"a"[list∅[list-item(false)"s1" list-item(false)"s2" list-item(end)"S"]]]',
    ]);
    expect(text).toBe('- 1\n- a\n  - s1\n  - s2\n  - S');
  });

  it('a hybrid boundary at the END keeps its head text and drops its children', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('- a\n  - s1\n- b\n  - t1');
    const { fragment } = copy(engine, 'a', 0, 'b', 1);
    expect(fragment.blocks.map(shape)).toEqual(['list∅[list-item(start)"a"[list∅[list-item(false)"s1"]] list-item(end)"b"]']);
  });

  it('a selection that starts INSIDE a child does not copy the hybrid parent text', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('- a\n  - s1\n  - s2\n- z');
    const { fragment } = copy(engine, 's2', 0, 'z', -1);
    expect(fragment.blocks.map(shape)).toEqual(['list∅[list-item∅[list∅[list-item(start)"s2"]] list-item(end)"z"]']);
  });
});

describe('P-43 props (clipboardProps)', () => {
  it('a to-do item carries `checked`; markdown and html show it (test 8)', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('- [x] t1\n- [ ] t2\n- [x] t3');
    const { fragment, html, text } = copy(engine, 't1', 0, 't3', -1);
    expect(fragment.blocks[0].props).toEqual({ listType: 'todo' });
    expect(fragment.blocks[0].children.map((c) => c.props.checked)).toEqual([true, false, true]);
    expect(text).toBe('- [x] t1\n- [ ] t2\n- [x] t3');
    expect(html).toContain('<li><input type="checkbox" disabled checked> t1</li>');
    expect(html).toContain('<li><input type="checkbox" disabled> t2</li>');
  });

  it('a plain bullet item has no `checked` prop', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('- a\n- b');
    const { fragment } = copy(engine, 'a', 0, 'b', -1);
    expect(fragment.blocks[0].children.map((c) => c.props)).toEqual([{}, {}]);
  });

  it('a COLLAPSED toggle keeps `collapsed: true` (fragment + html), an open one `collapsed: false`', async () => {
    const engine = await makeEditor();
    await engine.importFragment({ blocks: [
      { type: 'paragraph', delta: [{ insert: 'before' }], partial: false },
      { type: 'toggle', props: { collapsed: true }, delta: [{ insert: 'Head' }], partial: false, children: [{ type: 'paragraph', delta: [{ insert: 'body' }], partial: false }] },
      { type: 'toggle', props: { collapsed: false }, delta: [{ insert: 'Open' }], partial: false, children: [{ type: 'paragraph', delta: [{ insert: 'b2' }], partial: false }] },
      { type: 'paragraph', delta: [{ insert: 'after' }], partial: false },
    ] });
    const { fragment, html } = copy(engine, 'before', 0, 'after', -1);
    expect(fragment.blocks[1].props).toEqual({ collapsed: true });
    expect(fragment.blocks[2].props).toEqual({ collapsed: false });
    expect(html).toContain('<details><summary>Head</summary>');
    expect(html).toContain('<details open><summary>Open</summary>');
  });

  it('toggle header start + body: header tail and the body paragraphs are all copied (test 7b)', async () => {
    const engine = await makeEditor();
    await engine.importFragment({ blocks: [
      { type: 'toggle', props: { collapsed: false }, delta: [{ insert: 'Head' }], partial: false, children: [
        { type: 'paragraph', delta: [{ insert: 'body1' }], partial: false },
        { type: 'paragraph', delta: [{ insert: 'body2' }], partial: false },
      ] },
    ] });
    const { fragment } = copy(engine, 'Head', 2, 'body2', 2);
    expect(fragment.blocks.map(shape)).toEqual(['toggle(start)"ad"[paragraph(false)"body1" paragraph(end)"bo"]']);
  });
});

describe('P-45 ordered list renumbering', () => {
  it('copying items 2-3 of a list starting at 3 -> start = first copied item number (4)', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('3. i1\n4. i2\n5. i3\n6. i4');
    const { fragment, text, html } = copy(engine, 'i2', 0, 'i3', -1);
    expect(fragment.blocks[0].props).toEqual({ listType: 'ordered', start: 4 });
    expect(text).toBe('4. i2\n5. i3');
    expect(html).toBe('<ol start="4"><li>i2</li><li>i3</li></ol>');
  });

  it('copying from the first item keeps the original start; a slice starting at index 1 of a list from 1 -> start 2', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('3. i1\n4. i2\n5. i3');
    expect(copy(engine, 'i1', 0, 'i2', -1).fragment.blocks[0].props).toEqual({ listType: 'ordered', start: 3 });
    const other = await makeEditor();
    await other.importMarkdown('1. a\n2. b\n3. c');
    expect(copy(other, 'b', 0, 'c', -1).fragment.blocks[0].props).toEqual({ listType: 'ordered', start: 2 });
  });

  it('bullet lists never get a start', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('- a\n- b\n- c');
    expect(copy(engine, 'b', 0, 'c', -1).fragment.blocks[0].props).toEqual({ listType: 'bullet' });
  });
});

describe('P-46 text/plain: raw text inside ONE block, markdown across blocks', () => {
  it('partial selection in a paragraph with marks: raw text, html keeps the marks', async () => {
    const engine = await makeEditor();
    await engine.importFragment({ blocks: [{ type: 'paragraph', delta: [{ insert: 'hello', attributes: { bold: true } }, { insert: ' world' }], partial: false }] });
    const { text, html } = copy(engine, 'hello world', 2, 'hello world', 9);
    expect(text).toBe('llo wor');
    expect(html).toBe('<p><strong>llo</strong> wor</p>');
  });

  it('partial selection in a heading: raw text (no `# `)', async () => {
    const engine = await makeEditor();
    await engine.importFragment({ blocks: [{ type: 'heading', props: { level: 2 }, delta: [{ insert: 'Big title' }], partial: false }] });
    expect(copy(engine, 'Big title', 4, 'Big title', 9).text).toBe('title');
  });

  it('inside a list item: raw text (no `- `)', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('- alpha\n- beta');
    expect(copy(engine, 'alpha', 1, 'alpha', 4).text).toBe('lph');
  });

  it('inside a code block: the raw code, no fence', async () => {
    const engine = await makeEditor();
    await engine.importFragment({ blocks: [{ type: 'code', props: { language: 'js' }, delta: [{ insert: 'const a = 1;\nrun();' }], partial: false }] });
    const src = 'const a = 1;\nrun();';
    expect(copy(engine, src, 6, src, 18).text).toBe('a = 1;\nrun()');
  });

  it('several blocks: markdown, as before', async () => {
    const engine = await makeEditor();
    await engine.importFragment({ blocks: [
      { type: 'paragraph', delta: [{ insert: 'one' }], partial: false },
      { type: 'paragraph', delta: [{ insert: 'two' }], partial: false },
    ] });
    expect(copy(engine, 'one', 1, 'two', 2).text).toBe('ne\n\ntw');
    const e2 = await makeEditor();
    await e2.importFragment({ blocks: [
      { type: 'heading', props: { level: 1 }, delta: [{ insert: 'T' }], partial: false },
      { type: 'paragraph', delta: [{ insert: 'p' }], partial: false },
    ] });
    expect(copy(e2, 'T', 0, 'p', -1).text).toBe('# T\n\np');
  });
});

describe('copy -> paste round-trip of hybrid blocks', () => {
  it('pasting the P-29 selection into an empty paragraph reproduces the selected structure', async () => {
    const src = await makeEditor();
    await src.importMarkdown(MD_NESTED);
    const { fragment } = copy(src, 'x1', 1, 'S3', 1);

    const dst = await makeEditor();
    dst.selection = { anchorBlock: dst.children[0], focusBlock: dst.children[0], isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
    dst.insertFragment(fragment);
    await dst.commit();
    expect(dst.serialize('markdown').replace(/^\s+|\s+$/g, '')).toContain('- 1\n- a\n  - s1\n  - s2\n  - S');
  });
});
