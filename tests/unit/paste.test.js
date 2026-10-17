// @ts-nocheck
/**
 * Unit tests for paste behavior (P-01 type adoption, P-02 one line = one block,
 * P-03 a paste is its own undo step). Uses a real Nabu with a stubbed selection:
 * there is no DOM selection in unit tests, only the surface insertFragment reads.
 */

import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { HeadingExtension } from '$lib/blocks/heading/index.js';
import { ListExtension } from '$lib/blocks/list/index.js';
import { MarkdownPasteExtension } from '$lib/paste/markdown.paste.js';
import { PlainTextPasteExtension } from '$lib/paste/plain-text.paste.js';

async function makeEditor(extensions = [ParagraphExtension, HeadingExtension, ListExtension, MarkdownPasteExtension, PlainTextPasteExtension]) {
  const engine = new Nabu({ extensions });
  await engine.commit();
  const block = engine.children[0];
  engine.selection = {
    anchorBlock: block, focusBlock: block, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn(),
  };
  return { engine, block };
}

/** Run the text/plain paste pipeline (handlePaste) with the given string. */
async function paste(engine, text) {
  engine.handlePaste({
    preventDefault: vi.fn(),
    clipboardData: { getData: (format) => (format === 'text/plain' ? text : '') },
  });
  await tick();
  await engine.commit();
}

/** Cursor at `offset` in `block` (insertFragment reads block.selection.from). */
function cursorAt(engine, block, offset) {
  Object.defineProperty(block, 'selection', { value: { from: offset, to: offset }, configurable: true });
  engine.selection.anchorBlock = block;
}

const types = (engine) => engine.tree.roots().map(r => r.data.get('type'));
const texts = (engine) => engine.tree.roots().map(r => r.data.get('text')?.toString());

describe('P-01 — whole block pasted into an empty block adopts its type', () => {
  it('"# My Heading" into an empty paragraph becomes a level-1 heading', async () => {
    const { engine } = await makeEditor();
    await paste(engine, '# My Heading');

    expect(engine.tree.roots()).toHaveLength(1);
    expect(types(engine)).toEqual(['heading']);
    expect(engine.tree.roots()[0].data.get('level')).toBe(1);
    expect(engine.serialize('markdown')).toBe('# My Heading');
    // The replaced block instance is the one that gets the cursor.
    const [last] = engine.selection.setCursor.mock.calls.at(-1);
    expect(last).toBe(engine.blocks.get(engine.tree.roots()[0].id.toString()));
  });

  it('keeps the paragraph when pasting a heading mid-text', async () => {
    const { engine, block } = await makeEditor();
    block.insert(0, 'abc');
    await engine.commit();
    cursorAt(engine, engine.children[0], 3);
    await paste(engine, '# My Heading');

    expect(types(engine)).toEqual(['paragraph']);
    expect(texts(engine)).toEqual(['abcMy Heading']);
  });

  it('does not coerce an empty heading when pasting plain text', async () => {
    const { engine } = await makeEditor();
    engine.children[0].node.data.set('type', 'heading');
    engine.children[0].node.data.set('level', 2);
    await engine.commit();
    engine.selection.anchorBlock = engine.children[0];

    await paste(engine, 'just text');
    expect(types(engine)).toEqual(['heading']);
    expect(texts(engine)).toEqual(['just text']);
  });

  it('does not coerce when the fragment is a partial block', async () => {
    const { engine } = await makeEditor();
    engine.insertFragment({ blocks: [{ type: 'heading', props: { level: 1 }, partial: 'both', delta: [{ insert: 'x' }] }] });
    await engine.commit();
    expect(types(engine)).toEqual(['paragraph']);
  });

  it('adopts the type of the first block of a multi-block paste', async () => {
    const { engine } = await makeEditor();
    await paste(engine, '## Title\nbody');
    expect(types(engine)).toEqual(['heading', 'paragraph']);
    expect(engine.tree.roots()[0].data.get('level')).toBe(2);
  });
});

describe('P-02 — paste: one line = one block', () => {
  it('"a\\nb\\nc\\nd" creates 4 paragraphs (markdown interpreter)', async () => {
    const { engine } = await makeEditor();
    await paste(engine, 'a\nb\nc\nd');
    expect(types(engine)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph']);
    expect(texts(engine)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('"a\\nb\\nc\\nd" creates 4 paragraphs (plain-text fallback)', async () => {
    const { engine } = await makeEditor([ParagraphExtension, PlainTextPasteExtension]);
    await paste(engine, 'a\nb\nc\nd');
    expect(texts(engine)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('runs of blank lines are separators, not empty paragraphs', async () => {
    const { engine } = await makeEditor();
    await paste(engine, 'a\n\n\nb');
    expect(texts(engine)).toEqual(['a', 'b']);

    const plain = await makeEditor([ParagraphExtension, PlainTextPasteExtension]);
    await paste(plain.engine, 'a\n\n\nb');
    expect(texts(plain.engine)).toEqual(['a', 'b']);
  });

  it('importMarkdown keeps CommonMark semantics (consecutive lines = one paragraph)', async () => {
    const { engine } = await makeEditor();
    await engine.importMarkdown('line one\nline two');
    expect(texts(engine)).toEqual(['line one line two']);
  });

  it('pasting a markdown bullet list still yields a list', async () => {
    const { engine } = await makeEditor();
    await paste(engine, '- one\n- two\n- three');
    const list = engine.tree.roots().find(r => r.data.get('type') === 'list');
    expect(list).toBeTruthy();
    expect(list.children()).toHaveLength(3);
  });

  it('a heading line between plain lines is split out on paste', async () => {
    const { engine } = await makeEditor();
    await paste(engine, 'a\n# H\nb');
    expect(types(engine)).toEqual(['paragraph', 'heading', 'paragraph']);
  });
});

describe('P-03 — a paste is its own undo step', () => {
  async function typed(engine, block, text) {
    block.insert(block.text.length, text);
    await engine.commit();
  }

  it('undo right after a paste removes only the paste', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, 'original');
    cursorAt(engine, engine.children[0], 8);

    engine.insertFragment({ blocks: [{ type: 'paragraph', partial: 'both', delta: [{ insert: ' pasted' }] }] });
    await engine.commit();
    expect(texts(engine)).toEqual(['original pasted']);

    engine.undo();
    expect(texts(engine)).toEqual(['original']);
  });

  it('typing right after a paste does not merge into the paste step', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, 'original');
    cursorAt(engine, engine.children[0], 8);
    engine.insertFragment({ blocks: [{ type: 'paragraph', partial: 'both', delta: [{ insert: ' pasted' }] }] });
    await engine.commit();

    await typed(engine, engine.children[0], '!');
    expect(texts(engine)).toEqual(['original pasted!']);

    engine.undo();
    expect(texts(engine)).toEqual(['original pasted']);
    engine.undo();
    expect(texts(engine)).toEqual(['original']);
  });

  it('restores the configured merge interval afterwards (typing merges again)', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, 'a');
    cursorAt(engine, engine.children[0], 1);
    engine.insertFragment({ blocks: [{ type: 'paragraph', partial: 'both', delta: [{ insert: 'P' }] }] });
    await engine.commit();

    await typed(engine, engine.children[0], 'x');
    await typed(engine, engine.children[0], 'y');
    expect(texts(engine)).toEqual(['aPxy']);
    engine.undo();
    expect(texts(engine)).toEqual(['aP']);
  });

  it('multi-block paste is a single isolated undo step', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, 'original');
    cursorAt(engine, engine.children[0], 8);
    await paste(engine, '\nx\ny');
    expect(texts(engine)).toEqual(['originalx', 'y']);
    engine.undo();
    expect(texts(engine)).toEqual(['original']);
  });
});
