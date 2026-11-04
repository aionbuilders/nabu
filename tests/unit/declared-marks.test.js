// @ts-nocheck
/**
 * A mark exists in an editor only if one of its extensions declares it in `loroTextStyles`: any other attribute of a delta op is
 * dropped where content comes in (paste, drop, Markdown / JSON import), at any depth. The text stays. Remote updates and the
 * existing document are never rewritten.
 */
import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { MinimalPreset, FullPreset } from '#lib/presets.js';
import { Extension, dropUndeclaredMarks } from '#lib/utils/extensions.js';
import { MarkdownPasteExtension } from '#lib/paste/markdown.paste.js';
import { ListExtension, ListItemExtension } from '#lib/blocks/list/index.js';

const BoldOnly = new Extension('bold-only', { loroTextStyles: { bold: { expand: 'none' } } });

const HTML = '<p>a <b>bold</b> <i>italic</i> <code>code</code> <a href="https://example.com">link</a> z</p>';

async function editor(extensions) {
  const engine = new Nabu({ extensions });
  await engine.commit();
  const block = engine.children[0];
  engine.selection = { anchorBlock: block, focusBlock: block, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
  return engine;
}

async function paste(engine, data) {
  engine.handlePaste({ preventDefault: vi.fn(), clipboardData: { getData: (f) => data[f] ?? '' } });
  await tick();
  await engine.commit();
}

const deltas = (engine) => [...engine.blocks.values()].flatMap((b) => b.behaviors?.get('text')?.container?.toDelta() ?? []);
const marks = (engine) => [...new Set(deltas(engine).flatMap((op) => Object.keys(op.attributes ?? {})))].sort();
const text = (engine) => deltas(engine).map((op) => op.insert).join('');
const jsonMarks = (engine) => {
  const found = new Set();
  const walk = (b) => {
    for (const run of Array.isArray(b.content) ? b.content : []) Object.keys(run).filter((k) => k !== 'text').forEach((k) => found.add(k));
    (b.children ?? []).forEach(walk);
  };
  JSON.parse(JSON.stringify(engine.serialize('json'))).blocks.forEach(walk);
  return [...found].sort();
};

describe('HTML paste', () => {
  it('MinimalPreset: the text stays, no mark is stored', async () => {
    const engine = await editor(MinimalPreset);
    await paste(engine, { 'text/html': HTML });
    expect(text(engine)).toContain('a bold italic code link z');
    expect(marks(engine)).toEqual([]);
    expect(jsonMarks(engine)).toEqual([]);
  });

  it('FullPreset: every mark is kept (unchanged)', async () => {
    const engine = await editor(FullPreset);
    await paste(engine, { 'text/html': HTML });
    expect(marks(engine)).toEqual(['bold', 'code', 'italic', 'link']);
  });

  it('a custom preset declaring only bold keeps bold and drops the others', async () => {
    const engine = await editor([...MinimalPreset, BoldOnly]);
    await paste(engine, { 'text/html': HTML });
    expect(text(engine)).toContain('a bold italic code link z');
    expect(marks(engine)).toEqual(['bold']);
  });
});

describe('Nabu clipboard format', () => {
  it('a fragment copied from a Full editor loses its marks in a Minimal one', async () => {
    const source = await editor(FullPreset);
    await paste(source, { 'text/html': HTML });
    const fragment = { version: 1, blocks: [...source.blocks.values()].filter((b) => b.behaviors?.get('text')?.text).map((b) => ({ type: b.type, partial: false, delta: b.behaviors.get('text').container.toDelta() })) };
    expect(fragment.blocks.flatMap((b) => b.delta).some((op) => op.attributes?.bold)).toBe(true);

    const target = await editor(MinimalPreset);
    await paste(target, { 'application/x-nabu+json': JSON.stringify(fragment) });
    expect(text(target)).toContain('bold italic code link');
    expect(marks(target)).toEqual([]);
  });
});

describe('document import', () => {
  const json = { version: '1', blocks: [{ type: 'paragraph', content: [{ text: 'plain ' }, { text: 'bold', bold: true }, { text: ' link', link: 'https://example.com', italic: true }] }] };

  it('importJSON into MinimalPreset keeps the text, drops the marks', async () => {
    const engine = new Nabu({ extensions: MinimalPreset });
    await engine.importJSON(json);
    expect(text(engine)).toBe('plain bold link');
    expect(marks(engine)).toEqual([]);
  });

  it('importJSON with a declared mark keeps it', async () => {
    const engine = new Nabu({ extensions: [...MinimalPreset, BoldOnly] });
    await engine.importJSON(json);
    expect(marks(engine)).toEqual(['bold']);
  });

  it('importMarkdown into an editor without marks keeps the text, drops the marks', async () => {
    const engine = new Nabu({ extensions: [...MinimalPreset, MarkdownPasteExtension] });
    await engine.importMarkdown('plain **bold** *it* `code` [link](https://example.com)');
    expect(text(engine)).toBe('plain bold it code link');
    expect(marks(engine)).toEqual([]);
  });

  it('importMarkdown into FullPreset keeps them', async () => {
    const engine = new Nabu({ extensions: FullPreset });
    await engine.importMarkdown('plain **bold** *it* `code` [link](https://example.com)');
    expect(marks(engine)).toEqual(['bold', 'code', 'italic', 'link']);
  });
});

describe('nested blocks', () => {
  const LIST = '<ul><li><b>one</b><ul><li><i>two</i><ul><li><a href="https://example.com">three</a></li></ul></li></ul></li></ul>';

  it('a list pasted into MinimalPreset (degraded to paragraphs) has no mark left', async () => {
    const engine = await editor(MinimalPreset);
    await paste(engine, { 'text/html': LIST });
    expect(text(engine)).toContain('one');
    expect(text(engine)).toContain('three');
    expect(marks(engine)).toEqual([]);
  });

  it('a nested list pasted where lists exist keeps its structure and has no mark at any depth', async () => {
    const engine = await editor([...MinimalPreset, ListExtension, ListItemExtension]);
    await paste(engine, { 'text/html': LIST });
    expect([...engine.blocks.values()].filter((b) => b.type === 'list-item')).toHaveLength(3);
    expect(text(engine)).toContain('onetwothree');
    expect(marks(engine)).toEqual([]);
  });
});

describe('what is not rewritten', () => {
  it('remote updates carry CRDT ops, not fragments: the marks of a snapshot are kept', async () => {
    const engine = await editor(FullPreset);
    await paste(engine, { 'text/html': HTML });
    const reader = new Nabu({ extensions: MinimalPreset });
    reader.importRemote(engine.doc.export({ mode: 'snapshot' }));
    expect(deltas(reader).some((op) => op.attributes?.bold)).toBe(true);
  });

  it('the helper keeps identity when nothing changes, and does not mutate its input', () => {
    const blocks = [{ type: 'paragraph', delta: [{ insert: 'a' }, { insert: 'b', attributes: { bold: true } }], children: [{ type: 'paragraph', delta: [{ insert: 'c', attributes: { italic: true } }] }] }];
    const frozen = JSON.stringify(blocks);
    const same = dropUndeclaredMarks(blocks, new Set(['bold', 'italic']));
    expect(same[0]).toBe(blocks[0]);
    const out = dropUndeclaredMarks(blocks, new Set(['bold']));
    expect(out[0].delta[1].attributes).toEqual({ bold: true });
    expect(out[0].children[0].delta[0]).toEqual({ insert: 'c' });
    expect(JSON.stringify(blocks)).toBe(frozen);
  });
});
