// @ts-nocheck — exercises static serializers/parsers only (no rune constructors)
/**
 * Unit tests for the Blockquote and Divider blocks (static serializers,
 * markdown rules and HTML rules).
 */

import { describe, it, expect } from 'vitest';
import { BlockquoteBlock } from '$lib/blocks/blockquote/blockquote.svelte.js';
import { DividerBlock } from '$lib/blocks/divider/divider.svelte.js';

describe('BlockquoteBlock statics', () => {
  it('toMarkdown produces "> text"', async () => {
    const pb = { type: 'blockquote', delta: [{ insert: 'quoted' }] };
    expect(BlockquoteBlock.toMarkdown(pb)).toBe('> quoted');
  });

  it('toHtml wraps in <blockquote>', async () => {
    const pb = { type: 'blockquote', delta: [{ insert: 'quoted' }] };
    expect(BlockquoteBlock.toHtml(pb)).toBe('<blockquote>quoted</blockquote>');
  });

  it('fromMarkdown strips the "> " prefix and joins lines', async () => {
    const parseInline = (text) => [{ insert: text }];
    const pb = BlockquoteBlock.fromMarkdown(['> line one', '> line two'], { parseInline });
    expect(pb).toEqual({ type: 'blockquote', delta: [{ insert: 'line one\nline two' }], partial: false });
  });

  it('markdownRules detect quote lines and consume the run', async () => {
    const rule = BlockquoteBlock.markdownRules[0];
    expect(rule.detect.test('> hello')).toBe(true);
    rule.detect.lastIndex = 0;
    expect(rule.detect.test('hello')).toBe(false);
    expect(rule.consume(['> a', '> b', '', 'c'], 0)).toBe(2);
  });
});

describe('DividerBlock statics', () => {
  it('toMarkdown produces ---', async () => {
    expect(DividerBlock.toMarkdown({ type: 'divider' })).toBe('---');
  });

  it('fromMarkdown recognizes ---, *** and ___', async () => {
    expect(DividerBlock.fromMarkdown(['---'])).toEqual({ type: 'divider', partial: false });
    expect(DividerBlock.fromMarkdown(['***'])).toEqual({ type: 'divider', partial: false });
    expect(DividerBlock.fromMarkdown(['___'])).toEqual({ type: 'divider', partial: false });
    expect(DividerBlock.fromMarkdown(['--'])).toBe(null);
  });

  it('fromHTML maps <hr> to a divider PasteBlock', async () => {
    expect(DividerBlock.fromHTML()).toEqual({ type: 'divider', partial: false });
  });
});
