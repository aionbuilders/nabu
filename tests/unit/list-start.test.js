// @ts-nocheck
/**
 * Unit tests for P-14 — ordered lists keep their start number (`List.start`, `<ol start>`).
 */

import { describe, it, expect } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension, List } from '$lib/blocks/list/index.js';
import { ListItem } from '$lib/blocks/list/list-item.svelte.js';
import { listStart } from '$lib/blocks/list/list.svelte.js';
import { BlockExtension } from '$lib/blocks/block.extension.js';

const parseInline = (text) => [{ insert: text }];

describe('listStart()', () => {
  it('only ordered lists have a start, and 1 is the default (null)', () => {
    expect(listStart('ordered', 3)).toBe(3);
    expect(listStart('ordered', '3')).toBe(3);
    expect(listStart('ordered', 0)).toBe(0);
    expect(listStart('ordered', 1)).toBeNull();
    expect(listStart('ordered', undefined)).toBeNull();
    expect(listStart('ordered', '')).toBeNull();
    expect(listStart('ordered', -2)).toBeNull();
    expect(listStart('ordered', 2.5)).toBeNull();
    expect(listStart('ordered', 'abc')).toBeNull();
    expect(listStart('bullet', 3)).toBeNull();
    expect(listStart('todo', 3)).toBeNull();
  });
});

describe('List.fromMarkdown — start number', () => {
  it('"3. a / 4. b" -> ordered list starting at 3', () => {
    const r = List.fromMarkdown(['3. a', '4. b'], { parseInline });
    expect(r.props).toEqual({ listType: 'ordered', start: 3 });
    expect(r.children).toHaveLength(2);
  });

  it('a list starting at 1 has no start prop; bullets never have one', () => {
    expect(List.fromMarkdown(['1. a', '2. b'], { parseInline }).props).toEqual({ listType: 'ordered' });
    expect(List.fromMarkdown(['- a'], { parseInline }).props).toEqual({ listType: 'bullet' });
  });

  it('"0. a" starts at 0; "3) a" works too; a nested ordered list has its own start', () => {
    expect(List.fromMarkdown(['0. a'], { parseInline }).props.start).toBe(0);
    expect(List.fromMarkdown(['3) a'], { parseInline }).props.start).toBe(3);
    const r = List.fromMarkdown(['1. a', '  5. sub', '  6. sub2'], { parseInline });
    expect(r.props).toEqual({ listType: 'ordered' });
    expect(r.children[0].children[0].props).toEqual({ listType: 'ordered', start: 5 });
  });
});

describe('List.fromHTML — <ol start>', () => {
  const html = (str) => { const d = document.createElement('div'); d.innerHTML = str; return d.firstElementChild; };
  const parseChildren = () => [{ type: 'list-item', delta: [{ insert: 'x' }], partial: false }];

  it('reads start from <ol start="3">', () => {
    const r = List.fromHTML(html('<ol start="3"><li>x</li></ol>'), { parseChildren }, { props: { listType: 'ordered' } });
    expect(r.props).toEqual({ listType: 'ordered', start: 3 });
  });

  it('ignores start on <ul>, start="1" and garbage', () => {
    expect(List.fromHTML(html('<ul start="3"><li>x</li></ul>'), { parseChildren }, { props: { listType: 'bullet' } }).props).toEqual({ listType: 'bullet' });
    expect(List.fromHTML(html('<ol start="1"><li>x</li></ol>'), { parseChildren }, { props: { listType: 'ordered' } }).props).toEqual({ listType: 'ordered' });
    expect(List.fromHTML(html('<ol start="x"><li>x</li></ol>'), { parseChildren }, { props: { listType: 'ordered' } }).props).toEqual({ listType: 'ordered' });
  });
});

describe('static serializers (clipboard)', () => {
  const pb = (start) => ({
    type: 'list', props: { listType: 'ordered', ...(start !== undefined ? { start } : {}) },
    children: [{ type: 'list-item', delta: [{ insert: 'a' }] }, { type: 'list-item', delta: [{ insert: 'b' }] }],
  });
  const recurse = (child, ctx) => ListItem.toMarkdown(child, { ...ctx, recurse: () => '' });

  it('toMarkdown numbers from start', () => {
    expect(List.toMarkdown(pb(3), { recurse })).toBe('3. a\n4. b');
    expect(List.toMarkdown(pb(), { recurse })).toBe('1. a\n2. b');
    expect(List.toMarkdown(pb(0), { recurse })).toBe('0. a\n1. b');
  });

  it('toHtml emits <ol start>', () => {
    const r = (child) => '<li></li>';
    expect(List.toHtml(pb(3), { recurse: r })).toBe('<ol start="3"><li></li><li></li></ol>');
    expect(List.toHtml(pb(), { recurse: r })).toBe('<ol><li></li><li></li></ol>');
  });
});

describe('List block — start round trip', () => {
  async function makeEditor() {
    const engine = new Nabu({ extensions: [ParagraphExtension, ListExtension, ListItemExtension, BlockExtension] });
    await engine.commit();
    return engine;
  }
  const doc = { version: '1', blocks: [{
    type: 'list', props: { listType: 'ordered', start: 3 },
    children: [
      { type: 'list-item', content: [{ text: 'a' }] },
      { type: 'list-item', content: [{ text: 'b' }], children: [
        { type: 'list', props: { listType: 'ordered' }, children: [{ type: 'list-item', content: [{ text: 'sub' }] }] },
      ] },
    ],
  }] };

  it('importJSON keeps start; serialize(json) and serialize(markdown) emit it; nested lists restart at 1', async () => {
    const engine = await makeEditor();
    await engine.importJSON(doc);
    const list = engine.children.find(b => b.type === 'list');
    expect(list.start).toBe(3);

    const json = engine.serialize('json');
    expect(json.blocks[0].props).toEqual({ listType: 'ordered', start: 3 });
    expect(json.blocks[0].children[1].children[0].props).toEqual({ listType: 'ordered' });

    expect(engine.serialize('markdown')).toBe('3. a\n4. b\n  1. sub');
  });

  it('JSON export -> import round-trips the start', async () => {
    const a = await makeEditor();
    await a.importJSON(doc);
    const b = await makeEditor();
    await b.importJSON(a.serialize('json'));
    const noIds = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'id' ? undefined : x)));
    expect(noIds(b.serialize('json'))).toEqual(noIds(a.serialize('json')));
    expect(b.serialize('markdown')).toBe(a.serialize('markdown'));
  });

  it('a default list stores/emits no start; bullets ignore a given start', async () => {
    const engine = await makeEditor();
    await engine.importJSON({ blocks: [
      { type: 'list', props: { listType: 'ordered', start: 1 }, children: [{ type: 'list-item', content: [{ text: 'a' }] }] },
      { type: 'list', props: { listType: 'bullet', start: 7 }, children: [{ type: 'list-item', content: [{ text: 'b' }] }] },
    ] });
    expect(engine.serialize('json').blocks.map(b => b.props)).toEqual([{ listType: 'ordered' }, { listType: 'bullet' }]);
  });

  it('adjacent ordered lists merge into the first one, which keeps its start', async () => {
    const engine = await makeEditor();
    await engine.importJSON({ blocks: [
      { type: 'list', props: { listType: 'ordered', start: 3 }, children: [{ type: 'list-item', content: [{ text: 'a' }] }] },
      { type: 'paragraph', content: [{ text: '' }] },
    ] });
    // the paragraph becomes a second ordered list right under the first one (what "7. " does)
    const p = engine.children[1];
    const second = List.create(engine, 'list', { listType: 'ordered', start: 7 }, null, 1);
    ListItem.create(engine, 'list-item', { text: 'b' }, second.node.id.toString());
    p.destroy();
    await engine.commit();
    expect(engine.children.map(b => b.type)).toEqual(['list']);
    expect(engine.children[0].start).toBe(3);
    expect(engine.serialize('markdown')).toBe('3. a\n4. b');
  });
});
