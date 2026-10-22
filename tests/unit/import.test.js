// @ts-nocheck
/**
 * Integration tests for nabu.importMarkdown() / importJSON() (TÂCHE 9).
 * Uses a real Nabu instance with a minimal extension set.
 */

import { describe, it, expect } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { HeadingExtension } from '$lib/blocks/heading/index.js';
import { BlockquoteExtension } from '$lib/blocks/blockquote/index.js';
import { DividerExtension } from '$lib/blocks/divider/index.js';
import { MarkdownPasteExtension } from '$lib/paste/markdown.paste.js';
import { jsonToPasteBlocks } from '$lib/utils/extensions.js';

function makeEditor() {
  return new Nabu({ extensions: [ParagraphExtension, HeadingExtension, BlockquoteExtension, DividerExtension, MarkdownPasteExtension] });
}

describe('nabu.importMarkdown', () => {
  it('replaces the document with parsed heading + paragraph', async () => {
    const engine = makeEditor();
    await engine.importMarkdown('# Titre\n\nParagraphe.');

    const roots = engine.tree.roots();
    expect(roots).toHaveLength(2);
    expect(roots[0].data.get('type')).toBe('heading');
    expect(roots[0].data.get('level')).toBe(1);
    expect(roots[0].data.get('text').toString()).toBe('Titre');
    expect(roots[1].data.get('type')).toBe('paragraph');
    expect(roots[1].data.get('text').toString()).toBe('Paragraphe.');
  });

  it('clears the previous document content', async () => {
    const engine = makeEditor();
    await engine.importMarkdown('First doc');
    await engine.importMarkdown('## Second');

    const roots = engine.tree.roots();
    expect(roots).toHaveLength(1);
    expect(roots[0].data.get('type')).toBe('heading');
    expect(roots[0].data.get('text').toString()).toBe('Second');
  });
});

describe('Blockquote + Divider integration (TÂCHE 7)', () => {
  it('engine.insert("divider") works and serializes to ---', async () => {
    const engine = makeEditor();
    engine.insert('divider');
    await engine.commit();
    const types = engine.tree.roots().map(r => r.data.get('type'));
    expect(types).toContain('divider');
    expect(engine.serialize('markdown')).toContain('---');
  });

  it('imports markdown quotes and dividers', async () => {
    const engine = makeEditor();
    await engine.importMarkdown('> citation\n\n---\n\nAprès.');
    const types = engine.tree.roots().map(r => r.data.get('type'));
    expect(types).toEqual(['blockquote', 'divider', 'paragraph']);
    expect(engine.serialize('markdown')).toBe('> citation\n\n---\n\nAprès.');
  });
});

describe('nabu.importJSON', () => {
  it('loads a serialize("json") export', async () => {
    const engine = makeEditor();
    await engine.importJSON({
      version: '1',
      blocks: [
        { type: 'heading', props: { level: 2 }, content: [{ text: 'Hello' }] },
        { type: 'paragraph', content: [{ text: 'World', bold: true }] },
      ],
    });

    const roots = engine.tree.roots();
    expect(roots).toHaveLength(2);
    expect(roots[0].data.get('type')).toBe('heading');
    expect(roots[0].data.get('level')).toBe(2);
    expect(roots[1].data.get('text').toString()).toBe('World');
  });

  it('round-trips through serialize("json")', async () => {
    const engine = makeEditor();
    await engine.importMarkdown('# Title\n\nBody text.');
    const exported = engine.serialize('json');

    const engine2 = makeEditor();
    await engine2.importJSON(exported);
    expect(engine2.serialize('markdown')).toBe('# Title\n\nBody text.');
  });
});

describe('jsonToPasteBlocks', () => {
  it('converts content runs to delta ops with attributes', () => {
    const pbs = jsonToPasteBlocks([
      { type: 'paragraph', content: [{ text: 'a' }, { text: 'b', bold: true }] },
    ]);
    expect(pbs).toEqual([
      {
        type: 'paragraph',
        partial: false,
        delta: [{ insert: 'a' }, { insert: 'b', attributes: { bold: true } }],
      },
    ]);
  });

  it('recurses into children', () => {
    const pbs = jsonToPasteBlocks([
      { type: 'list', props: { listType: 'bullet' }, children: [
        { type: 'list-item', content: [{ text: 'item' }] },
      ]},
    ]);
    expect(pbs[0].children).toEqual([
      { type: 'list-item', partial: false, delta: [{ insert: 'item' }] },
    ]);
  });
});
