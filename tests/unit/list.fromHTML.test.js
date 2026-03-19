/**
 * Unit tests for List.fromHTML() and ListItem.fromHTML() — static parsers.
 * Uses happy-dom for DOM access.
 */

import { describe, it, expect } from 'vitest';
import { List } from '$lib/blocks/list/list.svelte.js';
import { ListItem } from '$lib/blocks/list/list-item.svelte.js';

function parseInline(el) {
  return [{ insert: el.textContent || '' }];
}

function parseBlock(el) {
  if (el.matches('ul')) return List.fromHTML(el, { parseChildren }, { props: { listType: 'bullet' } });
  if (el.matches('ol')) return List.fromHTML(el, { parseChildren }, { props: { listType: 'ordered' } });
  if (el.matches('li')) return ListItem.fromHTML(el, { parseInline, parseBlock });
  return null;
}

function parseChildren(el) {
  return [...el.children].map(parseBlock).filter(Boolean);
}

function html(str) {
  const div = document.createElement('div');
  div.innerHTML = str;
  return div.firstElementChild;
}

describe('List.fromHTML', () => {
  it('parses a simple <ul> with <li> children', () => {
    const el = html('<ul><li>alpha</li><li>beta</li></ul>');
    const result = List.fromHTML(el, { parseChildren }, { props: { listType: 'bullet' } });
    expect(result.type).toBe('list');
    expect(result.props.listType).toBe('bullet');
    expect(result.children).toHaveLength(2);
  });

  it('parses a simple <ol>', () => {
    const el = html('<ol><li>first</li></ol>');
    const result = List.fromHTML(el, { parseChildren }, { props: { listType: 'ordered' } });
    expect(result.props.listType).toBe('ordered');
  });

  it('returns null for empty list', () => {
    const el = html('<ul></ul>');
    const result = List.fromHTML(el, { parseChildren }, { props: { listType: 'bullet' } });
    expect(result).toBeNull();
  });
});

describe('ListItem.fromHTML', () => {
  it('parses a <li> with text', () => {
    const el = html('<li>hello</li>');
    const result = ListItem.fromHTML(el, { parseInline, parseBlock });
    expect(result.type).toBe('list-item');
    expect(result.delta).toEqual([{ insert: 'hello' }]);
  });

  it('captures nested <ul> as children', () => {
    const el = html('<li>parent<ul><li>child</li></ul></li>');
    const result = ListItem.fromHTML(el, { parseInline, parseBlock });
    expect(result.children).toHaveLength(1);
    expect(result.children[0].type).toBe('list');
  });
});
