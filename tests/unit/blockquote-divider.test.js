// @ts-nocheck — exercises static serializers/parsers only (no rune constructors)
/**
 * Unit tests for the Blockquote and Divider blocks (static serializers,
 * markdown rules and HTML rules).
 */

import { describe, it, expect } from 'vitest';

describe('BlockquoteBlock statics', () => {
  it('toMarkdown produces "> text"', async () => {
    const { BlockquoteBlock } = await import('$lib/blocks/blockquote/blockquote.svelte.js');
    const pb = { type: 'blockquote', delta: [{ insert: 'quoted' }] };
    expect(BlockquoteBlock.toMarkdown(pb)).toBe('> quoted');
  });

  it('toHtml wraps in <blockquote>', async () => {
    const { BlockquoteBlock } = await import('$lib/blocks/blockquote/blockquote.svelte.js');
    const pb = { type: 'blockquote', delta: [{ insert: 'quoted' }] };
    expect(BlockquoteBlock.toHtml(pb)).toBe('<blockquote>quoted</blockquote>');
  });

  it('fromMarkdown strips the "> " prefix and joins lines', async () => {
    const { BlockquoteBlock } = await import('$lib/blocks/blockquote/blockquote.svelte.js');
    const parseInline = (text) => [{ insert: text }];
    const pb = BlockquoteBlock.fromMarkdown(['> line one', '> line two'], { parseInline });
    expect(pb).toEqual({ type: 'blockquote', delta: [{ insert: 'line one\nline two' }], partial: false });
  });

  it('markdownRules detect quote lines and consume the run', async () => {
    const { BlockquoteBlock } = await import('$lib/blocks/blockquote/blockquote.svelte.js');
    const rule = BlockquoteBlock.markdownRules[0];
    expect(rule.detect.test('> hello')).toBe(true);
    rule.detect.lastIndex = 0;
    expect(rule.detect.test('hello')).toBe(false);
    expect(rule.consume(['> a', '> b', '', 'c'], 0)).toBe(2);
  });
});

describe('DividerBlock statics', () => {
  it('toMarkdown produces ---', async () => {
    const { DividerBlock } = await import('$lib/blocks/divider/divider.svelte.js');
    expect(DividerBlock.toMarkdown({ type: 'divider' })).toBe('---');
  });

  it('fromMarkdown recognizes ---, *** and ___', async () => {
    const { DividerBlock } = await import('$lib/blocks/divider/divider.svelte.js');
    expect(DividerBlock.fromMarkdown(['---'])).toEqual({ type: 'divider', partial: false });
    expect(DividerBlock.fromMarkdown(['***'])).toEqual({ type: 'divider', partial: false });
    expect(DividerBlock.fromMarkdown(['___'])).toEqual({ type: 'divider', partial: false });
    expect(DividerBlock.fromMarkdown(['--'])).toBe(null);
  });

  it('fromHTML maps <hr> to a divider PasteBlock', async () => {
    const { DividerBlock } = await import('$lib/blocks/divider/divider.svelte.js');
    expect(DividerBlock.fromHTML()).toEqual({ type: 'divider', partial: false });
  });
});
