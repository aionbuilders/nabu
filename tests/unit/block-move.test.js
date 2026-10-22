// @ts-nocheck
/**
 * block:move-up / block:move-down (src/lib/blocks/move.js, P-80): one step among the siblings of one parent, a selection moves
 * as a run, an edge is a no-op, one undo step. The DOM selection is a stub (anchor / focus blocks).
 */

import { describe, it, expect, vi } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension } from '$lib/blocks/list/index.js';
import { ToggleExtension } from '$lib/blocks/toggle/index.js';
import { siblingRun } from '$lib/blocks/move.js';

async function make() {
  const engine = new Nabu({ extensions: [ParagraphExtension, ListExtension, ListItemExtension, ToggleExtension], platform: 'other' });
  engine.selection = { anchorBlock: null, focusBlock: null, blocks: new Set(), isCollapsed: true, sync: vi.fn(), normalize: vi.fn(), setCursor: vi.fn() };
  return engine;
}

const text = (node) => node.data.get('text')?.toString() ?? '';
const outline = (engine) => {
  const walk = (n) => {
    const t = n.data.get('type');
    const kids = (n.children() ?? []).map(walk).join(' ');
    return t === 'list' ? `[${kids}]` : `${text(n)}${kids ? `{${kids}}` : ''}`;
  };
  return engine.tree.roots().filter((n) => n.data.get('type') !== 'paragraph' || text(n) !== '').map(walk).join(' ; ');
};
const blockOf = (engine, t) => {
  let found;
  const walk = (n) => { if (text(n) === t) found = engine.blocks.get(n.id.toString()); (n.children() ?? []).forEach(walk); };
  engine.tree.roots().forEach(walk);
  return found;
};
const caret = (engine, t) => { const b = blockOf(engine, t); engine.selection.anchorBlock = b; engine.selection.focusBlock = b; };
const select = (engine, a, b) => { engine.selection.anchorBlock = blockOf(engine, a); engine.selection.focusBlock = blockOf(engine, b); };

async function paragraphs(...texts) {
  const engine = await make();
  texts.forEach((t, i) => engine.insert('paragraph', { text: t }, null, i));
  await engine.commit();
  engine.undoManager.clear();
  return engine;
}

describe('block:move-up / block:move-down', () => {
  it('are engine commands with the documented keys', async () => {
    const engine = await make();
    expect(engine.commands.get('block:move-up').keys).toEqual(['Mod-Shift-ArrowUp']);
    expect(engine.commands.get('block:move-down').keys).toEqual(['Mod-Shift-ArrowDown']);
  });

  it('moves the block at the caret one step among its siblings', async () => {
    const engine = await paragraphs('one', 'two', 'three');
    caret(engine, 'two');
    await engine.exec('block:move-up');
    expect(outline(engine)).toBe('two ; one ; three');
    await engine.exec('block:move-down');
    await engine.exec('block:move-down');
    expect(outline(engine)).toBe('one ; three ; two');
  });

  it('is a no-op at the edges (and the key is still handled)', async () => {
    const engine = await paragraphs('one', 'two');
    caret(engine, 'one');
    await engine.exec('block:move-up');
    expect(outline(engine)).toBe('one ; two');
    caret(engine, 'two');
    await engine.exec('block:move-down');
    expect(outline(engine)).toBe('one ; two');
    const event = { key: 'ArrowUp', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, preventDefault: vi.fn() };
    caret(engine, 'one');
    engine.handleKeydown(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('Mod-Shift-ArrowDown on the keyboard moves the block', async () => {
    const engine = await paragraphs('one', 'two', 'three');
    caret(engine, 'one');
    const event = { key: 'ArrowDown', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, preventDefault: vi.fn() };
    engine.handleKeydown(event);
    await engine.commit();
    expect(outline(engine)).toBe('two ; one ; three');
  });

  it('a selection moves the whole run of its blocks together', async () => {
    const engine = await paragraphs('a', 'b', 'c', 'd', 'e');
    select(engine, 'b', 'd');
    await engine.exec('block:move-up');
    expect(outline(engine)).toBe('b ; c ; d ; a ; e');
    await engine.exec('block:move-down');
    await engine.exec('block:move-down');
    expect(outline(engine)).toBe('a ; e ; b ; c ; d');
    await engine.exec('block:move-down'); // at the end
    expect(outline(engine)).toBe('a ; e ; b ; c ; d');
  });

  it('a backward selection (focus before anchor) moves the same run', async () => {
    const engine = await paragraphs('a', 'b', 'c', 'd');
    select(engine, 'c', 'b');
    await engine.exec('block:move-up');
    expect(outline(engine)).toBe('b ; c ; a ; d');
  });

  it('one undo step per move, redo moves again', async () => {
    const engine = await paragraphs('a', 'b', 'c');
    select(engine, 'b', 'c');
    await engine.exec('block:move-up');
    expect(outline(engine)).toBe('b ; c ; a');
    engine.undo();
    await engine.commit();
    expect(outline(engine)).toBe('a ; b ; c');
    engine.redo();
    await engine.commit();
    expect(outline(engine)).toBe('b ; c ; a');
  });

  it('a list item moves among the items of its list, with its sub-list; never out of the list', async () => {
    const engine = await make();
    const list = engine.insert('list', { listType: 'bullet' }, null, 0);
    const a = engine.insert('list-item', { text: 'a' }, list.id, 0);
    engine.insert('list-item', { text: 'b' }, list.id, 1);
    const sub = engine.insert('list', { listType: 'bullet' }, a.id, 0);
    engine.insert('list-item', { text: 'a1' }, sub.id, 0);
    engine.insert('list-item', { text: 'a2' }, sub.id, 1);
    engine.insert('paragraph', { text: 'after' }, null, 1);
    await engine.commit();
    caret(engine, 'a');
    await engine.exec('block:move-down');
    expect(outline(engine)).toBe('[b a{[a1 a2]}] ; after');
  });

  it('inside a toggle body the block moves among the body children and stops at the edge', async () => {
    const engine = await make();
    const t = engine.insert('toggle', { text: 'Head' }, null, 0);
    engine.insert('paragraph', { text: 'x' }, t.id, 0);
    engine.insert('paragraph', { text: 'y' }, t.id, 1);
    engine.insert('paragraph', { text: 'out' }, null, 1);
    await engine.commit();
    caret(engine, 'y');
    await engine.exec('block:move-up');
    expect(outline(engine)).toBe('Head{y x} ; out');
    await engine.exec('block:move-up');
    expect(outline(engine)).toBe('Head{y x} ; out');
    caret(engine, 'x');
    await engine.exec('block:move-down');
    expect(outline(engine)).toBe('Head{y x} ; out');
  });

  it('data.block moves a given block (id or Block) whatever the selection', async () => {
    const engine = await paragraphs('a', 'b', 'c');
    await engine.exec('block:move-up', { block: blockOf(engine, 'c') });
    expect(outline(engine)).toBe('a ; c ; b');
    await engine.exec('block:move-down', { block: blockOf(engine, 'a').id });
    expect(outline(engine)).toBe('c ; a ; b');
  });

  it('does nothing without a selection', async () => {
    const engine = await paragraphs('a', 'b');
    await engine.exec('block:move-up');
    expect(outline(engine)).toBe('a ; b');
  });
});

describe('siblingRun', () => {
  it('a container selected from its own text to a descendant moves as one block; two ends in different containers move the containers', async () => {
    const engine = await make();
    const t = engine.insert('toggle', { text: 'Head' }, null, 0);
    engine.insert('paragraph', { text: 'x' }, t.id, 0);
    const u = engine.insert('toggle', { text: 'Other' }, null, 1);
    engine.insert('paragraph', { text: 'y' }, u.id, 0);
    engine.insert('paragraph', { text: 'z' }, null, 2);
    await engine.commit();
    const run = (a, b) => { const r = siblingRun(blockOf(engine, a), blockOf(engine, b), engine); return r && [r.from, r.to, r.siblings === engine.children]; };
    expect(run('Head', 'x')).toEqual([0, 0, true]);
    expect(run('x', 'y')).toEqual([0, 1, true]);
    expect(run('y', 'x')).toEqual([0, 1, true]);
    expect(run('x', 'z')).toEqual([0, 2, true]);
    expect(run('x', 'x')).toEqual([0, 0, false]);
  });
});
