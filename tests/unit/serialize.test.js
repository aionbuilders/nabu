/**
 * Unit tests for block serialize() methods.
 * Tests serialization logic without triggering Svelte constructors.
 * We call the serializers directly after injecting state.
 */

import { describe, it, expect } from 'vitest';
import { deltaToMarkdown, deltaToHtml } from '$lib/behaviors/text/text.behavior.svelte.js';

// Re-use static methods and serializer logic directly (no rune constructors needed)

// ── Paragraph markdown serializer ──────────────────────────────────────────

describe('Paragraph markdown serialization', () => {
  it('serializes plain text', () => {
    const delta = [{ insert: 'Hello world' }];
    expect(deltaToMarkdown(delta)).toBe('Hello world');
  });

  it('serializes bold + italic inline', () => {
    const delta = [
      { insert: 'start ' },
      { insert: 'bold', attributes: { bold: true } },
      { insert: ' mid ' },
      { insert: 'it', attributes: { italic: true } },
      { insert: ' end' },
    ];
    expect(deltaToMarkdown(delta)).toBe('start **bold** mid *it* end');
  });
});

// ── Dialogue markdown serializer ───────────────────────────────────────────

describe('Dialogue markdown serialization', () => {
  it('prepends em-dash to the text content', () => {
    const text = 'Hello said the fox';
    // The dialogue serializer does: `— ${behavior.toMarkdown()}`
    const markdown = `— ${deltaToMarkdown([{ insert: text }])}`;
    expect(markdown).toBe(`— ${text}`);
  });

  it('handles bold inside dialogue', () => {
    const delta = [{ insert: 'bold', attributes: { bold: true } }];
    const markdown = `— ${deltaToMarkdown(delta)}`;
    expect(markdown).toBe('— **bold**');
  });
});

// ── ListItem markdown serializer ───────────────────────────────────────────

describe('ListItem.toMarkdown (static)', () => {
  // Static method — safe to import without constructor
  it('produces correct bullet markdown', async () => {
    const { ListItem } = await import('$lib/blocks/list/list-item.svelte.js');
    const pb = { type: 'list-item', delta: [{ insert: 'item one' }] };
    const helpers = {
      recurse: () => '',
      listType: 'bullet',
      index: 0,
      depth: 0,
    };
    expect(ListItem.toMarkdown(pb, helpers)).toBe('- item one');
  });

  it('produces correct ordered markdown', async () => {
    const { ListItem } = await import('$lib/blocks/list/list-item.svelte.js');
    const pb = { type: 'list-item', delta: [{ insert: 'second' }] };
    expect(ListItem.toMarkdown(pb, { recurse: () => '', listType: 'ordered', index: 1, depth: 0 })).toBe('2. second');
  });

  it('indents nested items', async () => {
    const { ListItem } = await import('$lib/blocks/list/list-item.svelte.js');
    const pb = { type: 'list-item', delta: [{ insert: 'nested' }] };
    expect(ListItem.toMarkdown(pb, { recurse: () => '', listType: 'bullet', index: 0, depth: 2 })).toBe('    - nested');
  });
});

// ── ListItem HTML serializer ───────────────────────────────────────────────

describe('ListItem.toHtml (static)', () => {
  it('wraps in <li>', async () => {
    const { ListItem } = await import('$lib/blocks/list/list-item.svelte.js');
    const pb = { type: 'list-item', delta: [{ insert: 'item' }] };
    expect(ListItem.toHtml(pb, { recurse: () => '' })).toBe('<li>item</li>');
  });
});

// ── List markdown/html (static) ────────────────────────────────────────────

describe('List.toMarkdown (static)', () => {
  it('joins children markdown', async () => {
    const { List } = await import('$lib/blocks/list/list.svelte.js');
    const pb = {
      type: 'list',
      props: { listType: 'bullet' },
      children: [
        { type: 'list-item', delta: [{ insert: 'a' }] },
        { type: 'list-item', delta: [{ insert: 'b' }] },
      ],
    };
    const result = List.toMarkdown(pb, {
      recurse: (child, ctx) => `- ${deltaToMarkdown(child.delta)}`,
      depth: 0,
    });
    expect(result).toBe('- a\n- b');
  });
});

describe('List.toHtml (static)', () => {
  it('wraps bullet list in <ul>', async () => {
    const { List } = await import('$lib/blocks/list/list.svelte.js');
    const pb = {
      type: 'list',
      props: { listType: 'bullet' },
      children: [{ type: 'list-item', delta: [{ insert: 'x' }] }],
    };
    const result = List.toHtml(pb, { recurse: () => '<li>x</li>' });
    expect(result).toBe('<ul><li>x</li></ul>');
  });

  it('wraps ordered list in <ol>', async () => {
    const { List } = await import('$lib/blocks/list/list.svelte.js');
    const pb = {
      type: 'list',
      props: { listType: 'ordered' },
      children: [{ type: 'list-item', delta: [] }],
    };
    const result = List.toHtml(pb, { recurse: () => '<li>1</li>' });
    expect(result).toBe('<ol><li>1</li></ol>');
  });
});
