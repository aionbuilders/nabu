// @ts-nocheck
/**
 * Unit tests for P-28 — a list item may hold SEVERAL consecutive sublists of DIFFERENT types
 * (`a > [ul[s1], ol[s2], ul[s3]]`): markdown / HTML / JSON / clipboard round-trips and rendering order.
 */

import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension, List, ListItem } from '$lib/blocks/list/index.js';
import { MarkdownPasteExtension } from '$lib/paste/markdown.paste.js';
import { PlainTextPasteExtension } from '$lib/paste/plain-text.paste.js';
import { HtmlPasteExtension } from '$lib/paste/html.paste.js';
import { NabuPasteExtension } from '$lib/paste/nabu.paste.js';

const EXTENSIONS = [ParagraphExtension, ListExtension, ListItemExtension, MarkdownPasteExtension, HtmlPasteExtension, NabuPasteExtension, PlainTextPasteExtension];

async function makeEditor() {
  const engine = new Nabu({ extensions: EXTENSIONS });
  await engine.commit();
  const block = engine.children[0];
  engine.selection = { anchorBlock: block, focusBlock: block, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
  return engine;
}

const parseInline = (text) => [{ insert: text }];

/** `ul[a > ul[s1] ol[s2]]` view of the tree. */
const outline = (node) => {
  if (node.data.get('type') === 'list') {
    const lt = node.data.get('listType');
    const start = node.data.get('start');
    return `${lt === 'ordered' ? 'ol' : lt === 'todo' ? 'todo' : 'ul'}${start ? `@${start}` : ''}[${(node.children() ?? []).map(outline).join(', ')}]`;
  }
  const checked = node.data.get('checked');
  const mark = checked === undefined ? '' : checked ? '[x] ' : '[ ] ';
  const sub = (node.children() ?? []).map(outline).join(' ');
  return mark + node.data.get('text').toString() + (sub ? ` > ${sub}` : '');
};
const doc = (engine) => engine.tree.roots().map(outline).join(' ; ');
const noIds = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'id' ? undefined : x)));

const MD = '- a\n  - s1\n  1. s2\n  - s3';
const MIXED = 'ul[a > ul[s1] ol[s2] ul[s3]]';

describe('P-28 markdown', () => {
  it('List.fromMarkdown: consecutive nested lists of different types stay separate sublists, in order', () => {
    const r = List.fromMarkdown(MD.split('\n'), { parseInline });
    expect(r.children).toHaveLength(1);
    const subs = r.children[0].children;
    expect(subs.map(s => s.props.listType)).toEqual(['bullet', 'ordered', 'bullet']);
    expect(subs.map(s => s.children.map(c => c.delta[0].insert))).toEqual([['s1'], ['s2'], ['s3']]);
  });

  it('same-type neighbours stay ONE sublist; each sub-item keeps its own deeper lists; ordered keeps its start', () => {
    const r = List.fromMarkdown(['- a', '  - s1', '  - s2', '    1. g', '    - h', '  4. o1', '  5. o2'], { parseInline });
    const subs = r.children[0].children;
    expect(subs.map(s => s.props)).toEqual([{ listType: 'bullet' }, { listType: 'ordered', start: 4 }]);
    expect(subs[0].children).toHaveLength(2);
    expect(subs[0].children[1].children.map(s => s.props.listType)).toEqual(['ordered', 'bullet']);
  });

  it('import -> serialize round-trips, and the tree has three sublists in a row', async () => {
    const engine = await makeEditor();
    await engine.importMarkdown(MD);
    expect(doc(engine)).toBe(MIXED);
    expect(engine.serialize('markdown')).toBe(MD);
  });

  it('numbering of an ordered sublist with a start survives', async () => {
    const engine = await makeEditor();
    const md = '- a\n  - s1\n  3. s2\n  4. s3\n  - s4';
    await engine.importMarkdown(md);
    expect(doc(engine)).toBe('ul[a > ul[s1] ol@3[s2, s3] ul[s4]]');
    expect(engine.serialize('markdown')).toBe(md);
  });
});

describe('P-28 JSON', () => {
  it('serialize(json) lists every sublist; export -> import round-trips', async () => {
    const a = await makeEditor();
    await a.importMarkdown(MD);
    const json = a.serialize('json');
    expect(json.blocks[0].children[0].children.map(c => c.props.listType)).toEqual(['bullet', 'ordered', 'bullet']);

    const b = await makeEditor();
    await b.importJSON(JSON.parse(JSON.stringify(json)));
    expect(doc(b)).toBe(MIXED);
    expect(noIds(b.serialize('json'))).toEqual(noIds(json));
  });
});

describe('P-28 HTML', () => {
  const HTML = '<ul><li>a<ul><li>s1</li></ul><ol><li>s2</li></ol><ul><li>s3</li></ul></li></ul>';

  it('pasting <li>a<ul/><ol/><ul/></li> keeps three sublists in order', async () => {
    const engine = await makeEditor();
    const fragment = HtmlPasteExtension.pasteInterpreters[0].interpret(HTML, engine);
    await engine.importFragment(fragment);
    expect(doc(engine)).toBe(MIXED);
  });
});

/**
 * Runs `handleCopy` from the start of the block with text `from` to the end of the block with text `to`.
 * @returns {{ json: string, html: string, text: string }}
 */
function copy(engine, from, to) {
  const all = [];
  const walk = (b) => { all.push(b); (b.children ?? []).forEach(walk); };
  engine.children.forEach(walk);
  const first = all.find(b => b.text === from);
  const last = all.find(b => b.text === to);
  engine.selection = {
    sync: vi.fn(), isCollapsed: false, startBlock: first, endBlock: last,
    start: { from: 0 }, end: { to: last.text.length }, setCursor: vi.fn(), anchorBlock: first, focusBlock: last,
  };
  const data = {};
  engine.handleCopy({ preventDefault: vi.fn(), clipboardData: { setData: (k, v) => { data[k] = v; } } });
  return { json: data['application/x-nabu+json'], html: data['text/html'], text: data['text/plain'] };
}

describe('P-28 clipboard', () => {
  const paste = async (json) => {
    const dst = await makeEditor();
    dst.handlePaste({ preventDefault: vi.fn(), clipboardData: { getData: (f) => (f === 'application/x-nabu+json' ? json : '') } });
    await tick();
    await dst.commit();
    return dst;
  };

  it('copying the whole item emits every sublist in nabu JSON / markdown / HTML; pasting rebuilds them', async () => {
    const src = await makeEditor();
    await src.importMarkdown('before\n\n' + MD + '\n\nafter');
    const { json, text, html } = copy(src, 'before', 'after');
    expect(text).toBe('before\n\n' + MD + '\n\nafter');
    expect(html).toContain('<ul><li>a<ul><li>s1</li></ul><ol><li>s2</li></ol><ul><li>s3</li></ul></li></ul>');

    const dst = await paste(json);
    expect(doc(dst)).toBe('before ; ' + MIXED + ' ; after');
    expect(dst.serialize('markdown')).toBe('before\n\n' + MD + '\n\nafter');
  });

  it('copying across the sublists of one item keeps all of them, in order', async () => {
    const src = await makeEditor();
    await src.importMarkdown(MD);
    const { json } = copy(src, 's1', 's3');
    const wrapper = JSON.parse(json).blocks[0];
    expect(wrapper.children.map(c => c.props.listType)).toEqual(['bullet', 'ordered', 'bullet']);
    expect(wrapper.children.map(c => c.children[0].delta[0].insert)).toEqual(['s1', 's2', 's3']);
    expect(doc(await paste(json))).toContain('ul[s1] ol[s2] ul[s3]');
  });
});
