// @ts-nocheck
/**
 * Unit tests for the text forms and the clipboard of region markers (ADR 016, lot 3): markdown (data comment + readable
 * heading), HTML (`data-nabu-region`), `text/plain` of a copy, the internal clipboard round trip (spanning regions, into a
 * list / toggle: root-only rule), JSON with every field type.
 */

import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension, Paragraph } from '$lib/blocks/paragraph/index.js';
import { HeadingExtension } from '$lib/blocks/heading/index.js';
import { ListExtension, ListItemExtension } from '$lib/blocks/list/index.js';
import { ToggleExtension } from '$lib/blocks/toggle/index.js';
import { CalloutExtension } from '$lib/blocks/callout/index.js';
import { BlockExtension } from '$lib/blocks/block.extension.js';
import { RichTextExtension } from '$lib/behaviors/text/index.js';
import { RegionsExtension } from '$lib/blocks/region/index.js';
import { MarkdownPasteExtension, HtmlPasteExtension, NabuPasteExtension, PlainTextPasteExtension } from '$lib/paste/index.js';
import { regionToMarkdown, regionToHtml, safeJson, encodeTypeId } from '$lib/blocks/region/format.js';

const BOOK = {
  part: { level: 1, label: 'Part {index}' },
  chapter: { level: 2, label: 'Chapitre {index} — {title}', numbering: 'document', fields: { synopsis: 'richtext', status: { type: 'enum', values: ['draft', 'final'] }, due: 'date', words: 'number', done: 'boolean', pov: 'text' } },
  scene: { level: 3, label: '{path} {title}', fields: { pov: 'text' } },
};

const EXTENSIONS = (types = BOOK) => [
  ParagraphExtension, HeadingExtension, ListExtension, ListItemExtension, ToggleExtension, CalloutExtension, RichTextExtension,
  RegionsExtension(types ? { types } : undefined), MarkdownPasteExtension, HtmlPasteExtension, NabuPasteExtension, PlainTextPasteExtension, BlockExtension,
];

async function makeEditor(types = BOOK) {
  const engine = new Nabu({ extensions: EXTENSIONS(types) });
  await engine.commit();
  engine.selection = { anchorBlock: null, focusBlock: null, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
  return engine;
}

const D = (text, attributes) => (attributes ? { insert: text, attributes } : { insert: text });
const p = (text) => ({ type: 'paragraph', partial: false, delta: [{ insert: text }] });
const R = (regionType, fields = {}) => ({ type: 'region', partial: false, props: { regionType, fields } });

/** Replaces the document with PasteBlocks (importFragment: the same path as importJSON / importMarkdown). */
async function load(engine, blocks) { await engine.importFragment({ blocks }); return engine; }

/** `p(text)` / `R:type(title)` outline of the root blocks. */
const outline = (engine) => engine.tree.roots().map((node) => {
  const type = node.data.get('type');
  if (type === 'region') return `R:${node.data.get('regionType')}(${node.data.get('fields')?.get('title') ?? ''})`;
  const t = node.data.get('text');
  const kids = (node.children() ?? []).length ? `{${node.children().map((c) => c.data.get('text')?.toString() ?? c.data.get('type')).join(',')}}` : '';
  return `${type === 'paragraph' ? 'p' : type === 'heading' ? 'h' + node.data.get('level') : type}(${t ? t.toString() : ''})${kids}`;
}).join(' ; ');

/** The model of the markers: type + every stored field (richtext as delta). */
const markers = (engine) => engine.children.filter((b) => b.type === 'region').map((b) => ({ regionType: b.regionType, fields: b.exportFields }));

const FULL = {
  title: 'La forêt',
  synopsis: [D('Elle', { italic: true }), D(' entre dans '), D('le bois', { bold: true, link: 'https://example.com/a_(b)' }), D('.\nSuite *étoile* \\ [x]')],
  status: 'final', due: '2026-10-22', words: 1234.5, done: true, pov: 'Anna',
};

// ═══ 1 · Markdown ═════════════════════════════════════════════════════════════════════════════════════════════════

describe('markdown export of a marker', () => {
  it('two lines: the data comment (sorted keys, minimal JSON) then the readable heading (computed label, level = region level)', async () => {
    const engine = await load(await makeEditor(), [R('part', { title: 'I' }), p('x'), R('chapter', { title: 'La forêt', status: 'draft', pov: 'Anna' }), R('scene', { title: 'Seuil' })]);
    expect(engine.serialize('markdown')).toBe([
      '<!-- region:part {"title":"I"} -->\n# Part 1',
      'x',
      '<!-- region:chapter {"pov":"Anna","status":"draft","title":"La forêt"} -->\n## Chapitre 1 — La forêt',
      '<!-- region:scene {"title":"Seuil"} -->\n### 1.1.1 Seuil',
    ].join('\n\n'));
  });

  it('an empty marker: `{}` and the type id as the echo when the label is empty', async () => {
    const engine = await load(await makeEditor({ scene: { level: 3, numbering: 'none', label: '{title}' } }), [R('scene')]);
    expect(engine.serialize('markdown')).toBe('<!-- region:scene {} -->\n### scene');
  });

  it('every field type is carried in the comment (richtext as an inline markdown string)', async () => {
    const engine = await load(await makeEditor(), [R('chapter', FULL)]);
    const [line] = engine.serialize('markdown').split('\n');
    const json = JSON.parse(line.replace(/^<!-- region:chapter /, '').replace(/ -->$/, ''));
    expect(json).toEqual({
      title: 'La forêt', status: 'final', due: '2026-10-22', words: 1234.5, done: true, pov: 'Anna',
      synopsis: '*Elle* entre dans [**le bois**](https://example.com/a_(b)).\\\nSuite \\*étoile\\* \\\\ \\[x\\]',
    });
    expect(Object.keys(json)).toEqual([...Object.keys(json)].sort());
  });

  it('`-->`, markup and line separators in a field can never end the comment', async () => {
    const title = 'a --> b <script>alert(1)</script> & \u2028 c';
    const engine = await load(await makeEditor(), [R('part', { title })]);
    const md = engine.serialize('markdown');
    const [comment, heading] = md.split('\n');
    expect(comment.indexOf('-->')).toBe(comment.length - 3); // the only `-->` is the closing one
    expect(comment.slice('<!-- '.length, -' -->'.length)).not.toMatch(/[<>&\u2028\u2029]/);
    expect(comment).toContain('\\u003e');
    expect(heading.startsWith('# Part 1')).toBe(true);
    const back = await load(await makeEditor(), []).then((e) => e.importMarkdown(md).then(() => e));
    expect(markers(back)[0].fields.title).toBe(title);
  });

  it('a heading level is clamped to 1..6 (a type declared at level 9)', () => {
    const config = { types: new Map([['deep', { id: 'deep', level: 9, label: '{title}', numbering: 'none', fields: new Map() }]]), defaultType: 'deep', maxLevel: 9 };
    expect(regionToMarkdown(config, { regionType: 'deep', fields: { title: 'x' } }, { label: 'x', level: 9 })).toBe('<!-- region:deep {"title":"x"} -->\n###### x');
    expect(regionToMarkdown(config, { regionType: 'deep', fields: {} }, { label: 'x', level: 0 })).toBe('<!-- region:deep {} -->\n# x');
  });

  it('a type id with unusual characters is percent-encoded and decoded back', async () => {
    expect(encodeTypeId('a.b c')).toBe('a%2Eb%20c');
    const engine = await load(await makeEditor({ 'a.b c': { level: 1 } }), [R('a.b c', { title: 'T' })]);
    expect(engine.serialize('markdown')).toContain('<!-- region:a%2Eb%20c {"title":"T"} -->');
    const back = await makeEditor({ 'a.b c': { level: 1 } });
    await back.importMarkdown(engine.serialize('markdown'));
    expect(markers(back)).toEqual([{ regionType: 'a.b c', fields: { title: 'T' } }]);
  });
});

describe('markdown import of a marker', () => {
  it('the comment is the source of truth; the following heading is CONSUMED (no heading block), whatever it says', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('Preface\n\n<!-- region:chapter {"title":"La forêt","status":"draft"} -->\n## Edited by a human\n\nBody');
    expect(outline(engine)).toBe('p(Preface) ; R:chapter(La forêt) ; p(Body)');
    expect(engine.regions.list[0].label).toBe('Chapitre 1 — La forêt'); // recomputed: the edited text is not kept
    expect(markers(engine)[0].fields).toEqual({ title: 'La forêt', status: 'draft' });
  });

  it('the heading line is optional', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('<!-- region:part {"title":"I"} -->\n\nText');
    expect(outline(engine)).toBe('R:part(I) ; p(Text)');
  });

  it('a heading WITHOUT the comment stays a heading (regions are never inferred from headings)', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('## Chapitre 2 — La forêt\n\nText');
    expect(outline(engine)).toBe('h2(Chapitre 2 — La forêt) ; p(Text)');
    expect(engine.regions.count).toBe(0);
  });

  it('only a heading IMMEDIATELY after the comment is its echo; after a blank line it is a real heading', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('<!-- region:part {"title":"I"} -->\n\n# Real heading');
    expect(outline(engine)).toBe('R:part(I) ; h1(Real heading)');
  });

  it('invalid JSON, wrong shape, other comments: the line stays literal text', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown([
      '<!-- region:part {"title": -->', '<!-- region:part {"title":"x"} --> trailing', '<!-- region:part [1,2] -->', '<!-- region:part "x" -->',
      '<!-- region:part {"a":1} -->x', '<!--region:part {"a":1} -->', '<!-- region: {"a":1} -->', '<!-- a normal comment -->', '<!-- region:part {} -->'.replace('part', 'pa rt'),
    ].join('\n\n'));
    const roots = engine.tree.roots();
    expect(roots.every((r) => r.data.get('type') === 'paragraph')).toBe(true);
    expect(roots.map((r) => r.data.get('text').toString())[0]).toBe('<!-- region:part {"title": -->');
    expect(engine.regions.count).toBe(0);
    // and an invalid comment keeps the heading under it a heading
    const e2 = await makeEditor();
    await e2.importMarkdown('<!-- region:part {nope} -->\n## Title');
    expect(outline(e2)).toBe('p(<!-- region:part {nope} -->) ; h2(Title)');
  });

  it('an unknown region type falls back to the default (top-level) type, fields kept', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('<!-- region:saga {"title":"S","mood":"dark","n":3} -->\n# Saga');
    expect(markers(engine)).toEqual([{ regionType: 'part', fields: { title: 'S', mood: 'dark', n: 3 } }]);
  });

  it('a field of the wrong type for a declared field is dropped with a warning; unknown fields are kept', async () => {
    const engine = await makeEditor();
    const warn = vi.spyOn(engine, 'warn').mockImplementation(() => {});
    await engine.importMarkdown('<!-- region:chapter {"title":"T","status":"nope","words":"12","extra":[1,{"a":true}]} -->');
    expect(markers(engine)).toEqual([{ regionType: 'chapter', fields: { title: 'T', extra: [1, { a: true }] } }]);
    expect(warn).toHaveBeenCalled();
  });

  it('a paste (one line = one block) reads the same construct', async () => {
    const engine = await makeEditor();
    const fragment = MarkdownPasteExtension.pasteInterpreters[0].interpret('before\n<!-- region:part {"title":"I"} -->\n# Part 1\nafter', engine);
    expect(fragment.blocks.map((b) => b.type)).toEqual(['paragraph', 'region', 'paragraph']);
    expect(fragment.blocks[1].props).toEqual({ regionType: 'part', fields: { title: 'I' } });
  });

  it('a marker inside a toggle body is hoisted after the toggle (root-only)', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown('<details open>\n<summary>T</summary>\n\nin body\n\n<!-- region:part {"title":"I"} -->\n# Part 1\n\nmore\n\n</details>\n\nafter');
    expect(outline(engine)).toBe('toggle(T){in body,more} ; R:part(I) ; p(after)');
  });
});

describe('markdown round trip of documents with regions', () => {
  const roundTrip = async (blocks, types = BOOK) => {
    const a = await load(await makeEditor(types), blocks);
    const md = a.serialize('markdown');
    const b = await makeEditor(types);
    await b.importMarkdown(md);
    return { a, b, md };
  };

  it('the tree (types + every field) and the markdown are fixed points', async () => {
    const { a, b, md } = await roundTrip([
      p('Preface'), R('part', { title: 'I' }), R('chapter', { title: 'La forêt', status: 'final', due: '2026-10-22', words: 3, done: false, pov: 'Anna' }),
      p('Text'), R('scene', { title: 'Seuil', extra: { deep: [1, 2] } }), p('Scene text'), R('chapter', { title: '' }), R('chapter', { title: 'Fin' }),
    ]);
    expect(markers(b)).toEqual(markers(a));
    expect(b.regions.list.map((r) => r.label)).toEqual(a.regions.list.map((r) => r.label));
    expect(b.serialize('markdown')).toBe(md);
    expect(outline(b)).toBe(outline(a));
  });

  it('richtext fields survive the markdown form (marks, links, line break, escapes)', async () => {
    const { a, b, md } = await roundTrip([R('chapter', { title: 'T', synopsis: FULL.synopsis })]);
    expect(b.serialize('markdown')).toBe(md);
    expect(markers(b)[0].fields.synopsis).toEqual(markers(a)[0].fields.synopsis);
  });

  it('a document that STARTS or ENDS with a marker', async () => {
    const { b, md } = await roundTrip([R('part', { title: 'A' }), p('x'), R('part', { title: 'B' })]);
    expect(b.serialize('markdown')).toBe(md);
    expect(b.regions.count).toBe(2);
  });

  it('nested levels give heading levels 1, 2, 3 (labels from the registry)', async () => {
    const { md } = await roundTrip([R('part', { title: 'A' }), R('chapter', { title: 'B' }), R('scene', { title: 'C' })]);
    expect(md.split('\n\n').map((s) => s.split('\n')[1])).toEqual(['# Part 1', '## Chapitre 1 — B', '### 1.1.1 C']);
  });

  it('the default sections: levels 1..3, labels "1.", "1.1"', async () => {
    const a = await load(await makeEditor(null), [R('section-1', { title: 'One' }), R('section-2', { title: 'Two' }), R('section-3', { title: 'Three' })]);
    expect(a.serialize('markdown')).toBe([
      '<!-- region:section-1 {"title":"One"} -->\n# 1. One',
      '<!-- region:section-2 {"title":"Two"} -->\n## 1.1 Two',
      '<!-- region:section-3 {"title":"Three"} -->\n### 1.1.1 Three',
    ].join('\n\n'));
  });
});

// ═══ 2 · HTML ═════════════════════════════════════════════════════════════════════════════════════════════════════

const htmlInterpret = (engine, html) => HtmlPasteExtension.pasteInterpreters[0].interpret(html, engine);

describe('HTML form of a marker', () => {
  const config = (engine) => engine.regions.config;

  it('export: a heading element with the type and the fields as escaped JSON', async () => {
    const engine = await load(await makeEditor(), [R('chapter', { title: 'A "q" <b> & \'s\' -->', status: 'draft' })]);
    const pb = engine.children[0].serialize('application/x-nabu+json');
    const html = regionToHtml(config(engine), pb.props, pb.echo);
    expect(html).toBe('<h2 data-nabu-region="chapter" data-nabu-fields=\'{&quot;status&quot;:&quot;draft&quot;,&quot;title&quot;:&quot;A \\&quot;q\\&quot; \\u003cb\\u003e \\u0026 &#39;s&#39; --\\u003e&quot;}\'>Chapitre 1 — A &quot;q&quot; &lt;b&gt; &amp; &#39;s&#39; --&gt;</h2>');
    expect(html).not.toMatch(/<b>|<script/);
  });

  it('paste: ONLY an element carrying data-nabu-region becomes a marker; type validated, fields parsed and sanitized', async () => {
    const engine = await makeEditor();
    const pb = engine.children.length ? null : null; void pb;
    const src = await load(await makeEditor(), [R('chapter', FULL)]);
    const html = regionToHtml(config(src), src.children[0].serialize('application/x-nabu+json').props, src.children[0].serialize('application/x-nabu+json').echo);
    const fragment = htmlInterpret(engine, `<p>before</p>${html}<p>after</p>`);
    expect(fragment.blocks.map((b) => b.type)).toEqual(['paragraph', 'region', 'paragraph']);
    await load(engine, fragment.blocks);
    const [m] = markers(engine);
    expect(m.regionType).toBe('chapter');
    expect(m.fields).toEqual(markers(src)[0].fields);
  });

  it('a plain <h2> from the web stays a heading; an empty or hostile attribute does not make a marker out of nothing', async () => {
    const engine = await makeEditor();
    expect(htmlInterpret(engine, '<h2>Chapitre 2</h2><h1 data-other="x">T</h1>').blocks.map((b) => b.type)).toEqual(['heading', 'heading']);
    expect(htmlInterpret(engine, '<h2 data-nabu-region="">T</h2>').blocks.map((b) => b.type)).toEqual(['heading']);
  });

  it('invalid / hostile data: bad JSON = a marker without fields; unknown type = default type; unsafe link in richtext dropped; no HTML ever passes through', async () => {
    const engine = await makeEditor();
    const one = (attrs) => htmlInterpret(engine, `<h2 ${attrs}>x</h2>`).blocks;
    expect(one(`data-nabu-region="chapter" data-nabu-fields="{nope"`)[0].props).toEqual({ regionType: 'chapter', fields: {} });
    expect(one(`data-nabu-region="chapter" data-nabu-fields="[1]"`)[0].props.fields).toEqual({});
    expect(one(`data-nabu-region="saga" data-nabu-fields='{"title":"T","__proto__":{"x":1}}'`)[0].props).toEqual({ regionType: 'part', fields: { title: 'T' } });
    const evil = one(`data-nabu-region="chapter" data-nabu-fields='{"synopsis":"[click](javascript:alert(1)) <img src=x onerror=alert(1)>","title":"<script>x</script>"}'`)[0];
    expect(JSON.stringify(evil.props.fields.synopsis)).not.toContain('javascript');
    await load(engine, [evil]);
    expect(engine.children[0].fields.title).toBe('<script>x</script>'); // text, never markup
    expect(engine.children[0].richtext('synopsis').toString()).toContain('click');
    expect(JSON.stringify(engine.children[0].exportFields.synopsis)).not.toContain('javascript');
  });
});

// ═══ 3 · Clipboard (copy → text/plain, text/html, internal fragment → paste) ═════════════════════════════════════

const allBlocks = (engine) => {
  const all = [];
  const walk = (b) => { all.push(b); (b.children ?? []).forEach(walk); };
  engine.children.forEach(walk);
  return all;
};
const textOf = (b) => b.behaviors?.get('text')?.text;

/** Select from `from`@`fromOffset` to `to`@`toOffset` (blocks found by text or by index), run handleCopy. */
function copy(engine, from, fromOffset, to, toOffset) {
  const pick = (spec) => (typeof spec === 'number' ? engine.children[spec] : allBlocks(engine).find((b) => textOf(b) === spec));
  const first = pick(from);
  const last = pick(to);
  engine.selection = {
    sync: vi.fn(), isCollapsed: false, startBlock: first, endBlock: last,
    start: { from: fromOffset }, end: { to: toOffset }, setCursor: vi.fn(), anchorBlock: first, focusBlock: last,
  };
  const data = {};
  engine.handleCopy({ preventDefault: vi.fn(), clipboardData: { setData: (k, v) => { data[k] = v; } } });
  return { data, fragment: data['application/x-nabu+json'] ? JSON.parse(data['application/x-nabu+json']) : null, html: data['text/html'], text: data['text/plain'] };
}

/** Paste a clipboard (the formats of a copy) at the end of the text block `target`. */
async function pasteAt(engine, data, target, offset) {
  const block = allBlocks(engine).find((b) => textOf(b) === target);
  Object.defineProperty(block, 'selection', { value: { from: offset, to: offset }, configurable: true });
  engine.selection = { anchorBlock: block, focusBlock: block, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
  const event = { preventDefault: vi.fn(), clipboardData: { getData: (k) => data[k] ?? '', types: Object.keys(data), files: [], items: [] } };
  engine.handlePaste(event);
  await tick();
  await engine.commit();
  await tick();
}

const SOURCE = () => [
  p('intro'), R('part', { title: 'I' }), p('one'), R('chapter', { title: 'La forêt', synopsis: [D('un '), D('résumé', { bold: true })], status: 'draft', words: 7, done: true, due: '2026-01-02' }),
  p('two'), R('chapter', { title: 'Le lac' }), p('three'), p('tail'),
];

describe('clipboard: a selection spanning regions', () => {
  it('the internal fragment carries the markers with their fields (richtext as delta); the label echo is not data', async () => {
    const engine = await load(await makeEditor(), SOURCE());
    const { fragment } = copy(engine, 'one', 1, 'three', 3);
    expect(fragment.blocks.map((b) => b.type)).toEqual(['paragraph', 'region', 'paragraph', 'region', 'paragraph']);
    expect(fragment.blocks[1].props).toEqual({ regionType: 'chapter', fields: { title: 'La forêt', synopsis: [{ insert: 'un ' }, { insert: 'résumé', attributes: { bold: true } }], status: 'draft', words: 7, done: true, due: '2026-01-02' } });
    expect(fragment.blocks[1].echo).toEqual({ label: 'Chapitre 1 — La forêt', level: 2 });
  });

  it('text/plain (several blocks) is the markdown form: comment + heading with the labels of the SOURCE document', async () => {
    const engine = await load(await makeEditor(), SOURCE());
    const { text } = copy(engine, 'one', 1, 'three', 3);
    expect(text).toBe([
      'ne',
      '<!-- region:chapter {"done":true,"due":"2026-01-02","status":"draft","synopsis":"un **résumé**","title":"La forêt","words":7} -->\n## Chapitre 1 — La forêt',
      'two',
      '<!-- region:chapter {"title":"Le lac"} -->\n## Chapitre 2 — Le lac',
      'thr',
    ].join('\n\n'));
  });

  it('text/html: marker elements between the paragraphs', async () => {
    const engine = await load(await makeEditor(), SOURCE());
    const { html } = copy(engine, 'one', 1, 'three', 3);
    expect(html).toContain('<h2 data-nabu-region="chapter" data-nabu-fields=\'');
    expect(html).toContain('>Chapitre 2 — Le lac</h2>');
    expect(html.match(/data-nabu-region/g)).toHaveLength(2);
  });

  it('pasting it at the END of the document reproduces the markers with every field; numbering follows', async () => {
    const engine = await load(await makeEditor(), SOURCE());
    const before = markers(engine);
    const { data } = copy(engine, 'one', 1, 'three', 3);
    await pasteAt(engine, data, 'tail', 4);
    expect(markers(engine)).toEqual([...before, before[1], before[2]]);
    expect(engine.regions.list.map((r) => r.label)).toEqual(['Part 1', 'Chapitre 1 — La forêt', 'Chapitre 2 — Le lac', 'Chapitre 3 — La forêt', 'Chapitre 4 — Le lac']);
    expect(engine.children.map((b) => b.type)).toEqual(['paragraph', 'region', 'paragraph', 'region', 'paragraph', 'region', 'paragraph', 'paragraph', 'region', 'paragraph', 'region', 'paragraph']);
  });

  it('into ANOTHER editor (same types, then a plain editor without the extension: degraded, text kept)', async () => {
    const engine = await load(await makeEditor(), SOURCE());
    const { data } = copy(engine, 'one', 1, 'three', 3);
    const other = await load(await makeEditor(), [p('target')]);
    await pasteAt(other, data, 'target', 6);
    expect(markers(other)).toEqual([markers(engine)[1], markers(engine)[2]]);
    expect(other.regions.list.map((r) => r.label)).toEqual(['Chapitre 1 — La forêt', 'Chapitre 2 — Le lac']);
    // a different declaration: the unknown type is kept as is, the registry treats it as an unnumbered leaf
    const poor = await load(await makeEditor({ section: { level: 1 } }), [p('target')]);
    await pasteAt(poor, data, 'target', 6);
    expect(markers(poor).map((m) => m.regionType)).toEqual(['chapter', 'chapter']);
  });

  it('only the markdown text/plain (another application’s clipboard) restores the markers too', async () => {
    const engine = await load(await makeEditor(), SOURCE());
    const { text } = copy(engine, 'one', 1, 'three', 3);
    const other = await load(await makeEditor(), [p('target')]);
    await pasteAt(other, { 'text/plain': text }, 'target', 6);
    expect(markers(other)).toEqual([markers(engine)[1], markers(engine)[2]]);
    expect(outline(other)).toBe('p(targetne) ; R:chapter(La forêt) ; p(two) ; R:chapter(Le lac) ; p(thr)');
  });

  it('only the text/html (Nabu’s own HTML, no internal fragment) restores the markers too', async () => {
    const engine = await load(await makeEditor(), SOURCE());
    const { html } = copy(engine, 'one', 1, 'three', 3);
    const other = await load(await makeEditor(), [p('target')]);
    await pasteAt(other, { 'text/html': html }, 'target', 6);
    expect(markers(other)).toEqual([markers(engine)[1], markers(engine)[2]]);
  });

  it('a marker alone: copying just a marker gives its markdown form as text/plain (it is not a text block)', async () => {
    const engine = await load(await makeEditor(), [p('a'), R('chapter', { title: 'Seul' }), p('b')]);
    const marker = engine.children[1];
    engine.selection = { sync: vi.fn(), isCollapsed: false, startBlock: marker, endBlock: marker, start: { from: 0 }, end: { to: 0 }, setCursor: vi.fn(), anchorBlock: marker, focusBlock: marker };
    const data = {};
    engine.handleCopy({ preventDefault: vi.fn(), clipboardData: { setData: (k, v) => { data[k] = v; } } });
    expect(data['text/plain']).toBe('<!-- region:chapter {"title":"Seul"} -->\n## Chapitre 1 — Seul');
    expect(data['text/html']).toContain('data-nabu-region="chapter"');
  });
});

describe('clipboard: markers pasted into containers follow the root-only rule', () => {
  const marker = () => ({ type: 'region', partial: false, props: { regionType: 'chapter', fields: { title: 'Pasted' } } });
  const paste = async (engine, blocks) => { engine.insertFragment({ blocks }); await tick(); await engine.commit(); };
  const at = async (specs, caretText, offset) => {
    const engine = await makeEditor();
    await engine.importMarkdown(specs);
    const block = allBlocks(engine).find((b) => textOf(b) === caretText);
    Object.defineProperty(block, 'selection', { value: { from: offset, to: offset }, configurable: true });
    engine.selection = { anchorBlock: block, focusBlock: block, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
    return engine;
  };

  it('in a toggle BODY: hoisted right after the toggle', async () => {
    const engine = await at('<details open>\n<summary>T</summary>\n\nbody one\n\nbody two\n\n</details>\n\nafter', 'body one', 8);
    await paste(engine, [p('x'), marker(), p('y')]);
    expect(engine.children.map((b) => b.type)).toEqual(['toggle', 'region', 'paragraph']);
    expect(engine.children[0].children.map(textOf)).toEqual(['body onex', 'y', 'body two']);
    expect(engine.regions.list.map((r) => r.title)).toEqual(['Pasted']);
    expect(violations(engine)).toEqual([]);
  });

  it('in a list item: the list is split around the marker, which is at the root', async () => {
    const engine = await at('- one\n- two\n- three', 'two', 3);
    await paste(engine, [p('x'), marker(), p('y')]);
    // the pasted paragraph joins the item, the list normalizer cuts the list around the marker (its remainder follows it)
    expect(treeOf(engine)).toBe('list[list-item(one) list-item(twox)] ; region ; paragraph(y) ; list[list-item(three)]');
    expect(engine.regions.count).toBe(1);
    expect(violations(engine)).toEqual([]);
  });

  it('in a nested list item: the marker lands at the root after the top-level list structure', async () => {
    const engine = await at('- one\n  - nested\n- three', 'nested', 6);
    await paste(engine, [p('x'), marker(), p('y')]);
    expect(treeOf(engine)).toBe('list[list-item(one)[list[list-item(nestedx)]]] ; region ; paragraph(y) ; list[list-item(three)]');
    // no marker is left anywhere but at the root
    const nested = allBlocks(engine).filter((b) => b.type === 'region' && b.parent);
    expect(nested).toEqual([]);
    expect(violations(engine)).toEqual([]);
  });

  it('in a callout: hoisted after it', async () => {
    const engine = await at('> [!NOTE]\n> note text', 'note text', 4);
    await paste(engine, [marker(), p('y')]);
    expect(allBlocks(engine).filter((b) => b.type === 'region' && b.parent)).toEqual([]);
    expect(engine.regions.count).toBe(1);
  });
});

const treeOf = (engine) => { const w = (b) => `${b.type}${textOf(b) !== undefined ? '(' + textOf(b) + ')' : ''}${b.children?.length ? '[' + b.children.map(w).join(' ') + ']' : ''}`; return engine.children.map(w).join(' ; '); };
function violations(engine) {
  const out = [];
  for (const b of allBlocks(engine)) if (b.type === 'region' && b.parent) out.push(`nested marker ${b.id}`);
  return out;
}

// ═══ 4 · JSON ═════════════════════════════════════════════════════════════════════════════════════════════════════

describe('JSON export / import of markers with every field type', () => {
  it('text, richtext, enum, date, number, boolean and an unknown field: exact, twice', async () => {
    const a = await load(await makeEditor(), [p('x'), R('chapter', FULL), R('scene', { title: 'S', pov: 'Bo', unknown: { k: [1, null, 'z'] } })]);
    const json = JSON.parse(JSON.stringify(a.serialize('json')));
    expect(json.blocks[1]).toMatchObject({ type: 'region', props: { regionType: 'chapter', fields: { status: 'final', due: '2026-10-22', words: 1234.5, done: true, title: 'La forêt' } } });
    expect(Array.isArray(json.blocks[1].props.fields.synopsis)).toBe(true);
    const b = await makeEditor();
    await b.importJSON(json);
    expect(markers(b)).toEqual(markers(a));
    expect(b.children[1].richtext('synopsis').toDelta()).toEqual(a.children[1].richtext('synopsis').toDelta());
    const c = await makeEditor();
    await c.importJSON(JSON.stringify(b.serialize('json')));
    expect(markers(c)).toEqual(markers(a));
  });
});

describe('format helpers', () => {
  it('safeJson sorts keys at every level and never emits `>` `<` `&`', () => {
    expect(safeJson({ b: 1, a: { d: '>', c: '<&' } })).toBe('{"a":{"c":"\\u003c\\u0026","d":"\\u003e"},"b":1}');
  });
});
