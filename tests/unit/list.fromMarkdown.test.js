/**
 * Unit tests for List.fromMarkdown() — pure parser, no runes.
 */

import { describe, it, expect } from 'vitest';
import { List } from '$lib/blocks/list/list.svelte.js';

function parseInline(text) {
  return [{ insert: text }];
}

describe('List.fromMarkdown', () => {
  it('parses a single bullet item', () => {
    const result = List.fromMarkdown(['- hello'], { parseInline });
    expect(result).toEqual({
      type: 'list',
      props: { listType: 'bullet' },
      partial: false,
      children: [
        { type: 'list-item', delta: [{ insert: 'hello' }], partial: false },
      ],
    });
  });

  it('parses multiple bullet items', () => {
    const lines = ['- alpha', '- beta', '- gamma'];
    const result = List.fromMarkdown(lines, { parseInline });
    expect(result.children).toHaveLength(3);
    expect(result.children[0].delta).toEqual([{ insert: 'alpha' }]);
    expect(result.children[2].delta).toEqual([{ insert: 'gamma' }]);
  });

  it('parses ordered list', () => {
    const lines = ['1. first', '2. second'];
    const result = List.fromMarkdown(lines, { parseInline });
    expect(result.props.listType).toBe('ordered');
  });

  it('parses nested bullet items', () => {
    const lines = ['- parent', '  - child'];
    const result = List.fromMarkdown(lines, { parseInline });
    expect(result.children[0].children).toHaveLength(1);
    expect(result.children[0].children[0].type).toBe('list');
    expect(result.children[0].children[0].children[0].delta).toEqual([{ insert: 'child' }]);
  });

  it('returns null for empty/non-matching lines', () => {
    expect(List.fromMarkdown(['just text', 'no list here'], { parseInline })).toBeNull();
  });

  it('accepts * and + as bullet markers', () => {
    const lines = ['* star', '+ plus'];
    const result = List.fromMarkdown(lines, { parseInline });
    expect(result.children).toHaveLength(2);
    expect(result.children[0].delta).toEqual([{ insert: 'star' }]);
    expect(result.children[1].delta).toEqual([{ insert: 'plus' }]);
  });
});
