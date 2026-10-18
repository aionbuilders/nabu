// @ts-nocheck
/**
 * Unit tests for P-49 — pasting into a list: the generic `Block#acceptPaste` extension point and the List
 * rules ("what a list item can hold is absorbed; everything else splits the list").
 */

import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { Block } from '$lib/blocks/block.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { HeadingExtension } from '$lib/blocks/heading/index.js';
import { ListExtension, ListItemExtension } from '$lib/blocks/list/index.js';
import { planPaste } from '$lib/blocks/list/paste.js';

const EXTENSIONS = [ParagraphExtension, HeadingExtension, ListExtension, ListItemExtension];

/** Outline of the tree: `ul[a, b > ol[c]] ; heading(T)`. */
const outline = (node) => {
  const type = node.data.get('type');
  const kids = node.children() ?? [];
  if (type === 'list') {
    const lt = node.data.get('listType');
    const start = node.data.get('start');
    return `${lt === 'ordered' ? 'ol' : lt === 'todo' ? 'todo' : 'ul'}${start ? `@${start}` : ''}[${kids.map(outline).join(', ')}]`;
  }
  const text = node.data.get('text')?.toString() ?? '';
  if (type === 'list-item') {
    const checked = node.data.get('checked');
    const mark = checked === undefined ? '' : checked ? '[x] ' : '[ ] ';
    return mark + text + (kids.length ? ` > ${kids.map(outline).join(' ')}` : '');
  }
  return `${type === 'paragraph' ? 'p' : type}(${text})`;
};
const doc = (engine) => engine.tree.roots().map(outline).join(' ; ');

/** An editor holding the given lists (`[['bullet', ['ab', 'z']]]`), the caret at (`text`, `offset`). */
async function setup(lists, text, offset) {
  const engine = new Nabu({ extensions: EXTENSIONS });
  await engine.commit();
  for (const c of [...engine.children]) engine.delete(c);
  for (const [listType, items] of lists) {
    const list = engine.insert('list', { listType }, null);
    items.forEach((t, i) => engine.insert('list-item', { text: t, ...(listType === 'todo' ? { checked: false } : {}) }, list.id, i));
  }
  await engine.commit();
  const find = () => [...engine.blocks.values()].find((b) => b.type === 'list-item' && b.behaviors.get('text').text === text);
  const block = find();
  Object.defineProperty(block, 'selection', { value: { from: offset, to: offset }, configurable: true });
  engine.selection = { anchorBlock: block, focusBlock: block, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
  return { engine, block };
}

const para = (text, partial = false) => ({ type: 'paragraph', partial, delta: [{ insert: text }] });
const head = (text) => ({ type: 'heading', partial: false, props: { level: 1 }, delta: [{ insert: text }] });
const item = (text, props, children, partial = false) => ({ type: 'list-item', partial, delta: [{ insert: text }], ...(props ? { props } : {}), ...(children ? { children } : {}) });
const list = (listType, items) => ({ type: 'list', partial: false, props: { listType }, children: items });

async function paste(engine, blocks) {
  engine.insertFragment({ blocks });
  await tick();
  await engine.commit();
}

describe('Block#acceptPaste — the generic extension point', () => {
  it('declines by default (the engine does the default insertion)', async () => {
    const engine = new Nabu({ extensions: EXTENSIONS });
    await engine.commit();
    expect(engine.children[0].acceptPaste([para('x')], { offset: 0 })).toBeNull();
    expect(typeof Block.prototype.acceptPaste).toBe('function');
  });

  it('a block that takes over the paste is called with the fragment and the caret offset; the engine commits and places the caret', async () => {
    const engine = new Nabu({ extensions: EXTENSIONS });
    await engine.commit();
    const block = engine.children[0];
    engine.selection = { anchorBlock: block, focusBlock: block, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
    const hook = vi.fn(() => ({ block, offset: 0 }));
    block.acceptPaste = hook;
    engine.insertFragment({ blocks: [para('a'), para('b')] });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0][0].map((b) => b.delta[0].insert)).toEqual(['a', 'b']);
    expect(hook.mock.calls[0][1]).toEqual({ offset: 0 });
    await tick();
    expect(engine.selection.setCursor).toHaveBeenCalledWith(block, 0);
    // the default insertion did NOT run
    expect(doc(engine)).toBe('p()');
  });

  it('a block that declines leaves the default insertion in charge', async () => {
    const engine = new Nabu({ extensions: EXTENSIONS });
    await engine.commit();
    const block = engine.children[0];
    engine.selection = { anchorBlock: block, focusBlock: block, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
    await paste(engine, [para('a'), para('b')]);
    expect(engine.tree.roots().map((r) => r.data.get('text').toString())).toEqual(['a', 'b']);
  });
});

describe('planPaste — what a list does with each pasted block', () => {
  it('sorts paragraphs, lists, items and foreign blocks; a single text block is left to the inline merge', () => {
    expect(planPaste([para('a', 'both')])).toBeNull();
    expect(planPaste([para('a'), para('b')]).map((u) => u.kind)).toEqual(['text', 'text']);
    expect(planPaste([list('bullet', [item('x')])]).map((u) => u.kind)).toEqual(['list']);
    expect(planPaste([para('a', 'start'), head('H'), para('b', 'end')]).map((u) => u.kind)).toEqual(['text', 'foreign', 'text']);
    expect(planPaste([head('H')]).map((u) => u.kind)).toEqual(['foreign']);
    // the cut edge of a partial copy is plain text, a whole block in the middle is not
    expect(planPaste([{ ...head('H'), partial: 'start' }, head('M'), { ...head('E'), partial: 'end' }]).map((u) => u.kind)).toEqual(['text', 'foreign', 'text']);
    expect(planPaste([{ ...head('H'), partial: 'both' }])).toBeNull();
    expect(planPaste([])).toBeNull();
  });
});

describe('P-49 — pasting into a list item', () => {
  it('paragraphs become items; first merges with the head, last with the tail', async () => {
    const { engine } = await setup([['bullet', ['xy', 'z']]], 'xy', 1);
    await paste(engine, [para('a', 'start'), para('b'), para('c', 'end')]);
    expect(doc(engine)).toBe('ul[xa, b, cy, z]');
  });

  it('into an empty item the first paragraph fills it', async () => {
    const { engine } = await setup([['bullet', ['', 'z']]], '', 0);
    await paste(engine, [para('a'), para('b')]);
    expect(doc(engine)).toBe('ul[a, b, z]');
  });

  it('items adopt the type of the destination list; their own sublists keep theirs', async () => {
    const { engine } = await setup([['bullet', ['a', 'b']]], 'a', 1);
    await paste(engine, [list('ordered', [item('x', undefined, [list('ordered', [item('s')])]), item('y')])]);
    expect(doc(engine)).toBe('ul[a, x > ol[s], y, b]');
  });

  it('checked is kept in a to-do list only; paragraphs give unchecked items', async () => {
    const { engine } = await setup([['todo', ['t']], ['bullet', ['u']]], 't', 1);
    await paste(engine, [list('todo', [item('x', { checked: true }), item('y')])]);
    expect(doc(engine)).toBe('todo[[ ] t, [x] x, [ ] y] ; ul[u]');

    const other = await setup([['todo', ['t']], ['bullet', ['u']]], 'u', 1);
    await paste(other.engine, [list('todo', [item('x', { checked: true }), item('y', { checked: false })])]);
    expect(doc(other.engine)).toBe('todo[[ ] t] ; ul[u, x, y]');

    const para3 = await setup([['todo', ['t1', 't2']]], 't1', 2);
    await paste(para3.engine, [para('a'), para('b')]);
    expect(doc(para3.engine)).toBe('todo[[ ] t1a, [ ] b, [ ] t2]');
  });

  it('a heading splits the list; an ordered tail keeps counting', async () => {
    const { engine } = await setup([['ordered', ['one', 'twothree', 'four']]], 'twothree', 3);
    await paste(engine, [head('H')]);
    expect(doc(engine)).toBe('ol[one, two] ; heading(H) ; ol@3[three, four]');
  });

  it('mixed [p1, heading, p2]: p1 merges, the heading splits, p2 stays a paragraph, the tail continues the list', async () => {
    const { engine } = await setup([['bullet', ['ab', 'z']]], 'ab', 1);
    await paste(engine, [para('P1', 'start'), head('H'), para('P2', 'end')]);
    expect(doc(engine)).toBe('ul[aP1] ; heading(H) ; p(P2) ; ul[b, z]');
  });

  it('a heading at the end of the last item / start of the first leaves no empty list', async () => {
    const end = await setup([['bullet', ['a', 'b']]], 'b', 1);
    await paste(end.engine, [head('H')]);
    expect(doc(end.engine)).toBe('ul[a, b] ; heading(H)');

    const start = await setup([['bullet', ['a', 'b']]], 'a', 0);
    await paste(start.engine, [head('H')]);
    expect(doc(start.engine)).toBe('heading(H) ; ul[a, b]');
  });

  it('the caret ends after the pasted content', async () => {
    const { engine } = await setup([['bullet', ['xy']]], 'xy', 1);
    await paste(engine, [para('a', 'start'), para('b'), para('c', 'end')]);
    const [block, offset] = engine.selection.setCursor.mock.calls.at(-1);
    expect(block.behaviors.get('text').text).toBe('cy');
    expect(offset).toBe(1);

    const split = await setup([['bullet', ['ab']]], 'ab', 1);
    await paste(split.engine, [head('Title')]);
    const [hb, ho] = split.engine.selection.setCursor.mock.calls.at(-1);
    expect(hb.behaviors.get('text').text).toBe('Title');
    expect(ho).toBe(5);
  });

  it('the paste is ONE undo step', async () => {
    const { engine } = await setup([['bullet', ['ab', 'z']]], 'ab', 1);
    engine.undoManager.clear();
    await paste(engine, [para('P1', 'start'), head('H'), para('P2', 'end')]);
    expect(doc(engine)).toBe('ul[aP1] ; heading(H) ; p(P2) ; ul[b, z]');
    engine.undo();
    await tick();
    expect(doc(engine)).toBe('ul[ab, z]');
  });
});
