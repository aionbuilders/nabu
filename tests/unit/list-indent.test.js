// @ts-nocheck
/**
 * Unit tests for Tab / Shift+Tab on list items (src/lib/blocks/list/indent.js): one item or every item a
 * selection touches, in ONE transaction, on the tree (the Block state is stale inside a batch of moves).
 */

import { describe, it, expect, vi } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension, List, ListItem } from '$lib/blocks/list/index.js';
import { moveItems, selectedItems, handleTab } from '$lib/blocks/list/indent.js';

async function makeEditor() {
  const engine = new Nabu({ extensions: [ParagraphExtension, ListExtension, ListItemExtension] });
  await engine.commit();
  engine.selection = { anchorBlock: null, focusBlock: null, blocks: new Set(), sync: vi.fn(), setCursor: vi.fn() };
  engine.undoManager.clear();
  return engine;
}

/** Builds `[text, [children...]]` specs into a list under `parent`. */
function build(engine, specs, parent = null) {
  const list = List.create(engine, 'list', { listType: 'bullet' }, parent?.id.toString());
  for (const [text, kids] of specs) {
    const item = ListItem.create(engine, 'list-item', { text }, list.node.id.toString());
    if (kids) build(engine, kids, item.node);
  }
  return list.node;
}

const outline = (node) => {
  if (node.data.get('type') === 'list') return `[${(node.children() ?? []).map(outline).join(', ')}]`;
  const sub = (node.children() ?? []).map(outline).join('');
  return node.data.get('text').toString() + (sub ? ` > ${sub}` : '');
};
const doc = (engine) => engine.tree.roots().slice(1).map(outline).join('');
const nodeOf = (engine, text) => {
  let found;
  const walk = (n) => { if (n.data.get('text')?.toString() === text) found = n; (n.children() ?? []).forEach(walk); };
  engine.tree.roots().forEach(walk);
  return found;
};
/** `texts` = every block of the selection, in document order (what `selection.blocks` holds). */
const select = (engine, ...texts) => {
  const blocks = texts.map((t) => engine.blocks.get(nodeOf(engine, t).id.toString()));
  engine.selection = { ...engine.selection, anchorBlock: blocks[0], focusBlock: blocks.at(-1), blocks: new Set(blocks) };
};

describe('list Tab / Shift+Tab on several items', () => {
  it('Tab indents every selected item, keeping their order and relative structure', async () => {
    const engine = await makeEditor();
    build(engine, [['aaa'], ['bbb'], ['ccc'], ['ddd']]);
    await engine.commit();
    select(engine, 'bbb', 'ccc');
    expect(await moveItems(engine, selectedItems(engine), false)).toBe(true);
    expect(doc(engine)).toBe('[aaa > [bbb, ccc], ddd]');
  });

  it('Tab: the first item of the list stays, the others move', async () => {
    const engine = await makeEditor();
    build(engine, [['aaa'], ['bbb'], ['ccc']]);
    await engine.commit();
    select(engine, 'aaa', 'bbb', 'ccc');
    await moveItems(engine, selectedItems(engine), false);
    expect(doc(engine)).toBe('[aaa > [bbb, ccc]]');
  });

  it('Shift+Tab unindents nested items; the unselected follower becomes a child of the last one', async () => {
    const engine = await makeEditor();
    build(engine, [['a', [['s1'], ['s2'], ['s3']]], ['b']]);
    await engine.commit();
    select(engine, 's1', 's2');
    await moveItems(engine, selectedItems(engine), true);
    expect(doc(engine)).toBe('[a, s1, s2 > [s3], b]');
  });

  it('Shift+Tab on a whole sublist flattens it, no empty list left behind', async () => {
    const engine = await makeEditor();
    build(engine, [['a', [['s1'], ['s2'], ['s3']]], ['b']]);
    await engine.commit();
    select(engine, 's1', 's2', 's3');
    await moveItems(engine, selectedItems(engine), true);
    expect(doc(engine)).toBe('[a, s1, s2, s3, b]');
  });

  it('mixed levels: Tab moves each item one level deeper (relative depths kept)', async () => {
    const engine = await makeEditor();
    build(engine, [['a', [['s1'], ['s2']]], ['b'], ['c']]);
    await engine.commit();
    select(engine, 's2', 'b', 'c');
    await moveItems(engine, selectedItems(engine), false);
    expect(doc(engine)).toBe('[a > [s1 > [s2], b, c]]');
  });

  it('mixed levels: Shift+Tab moves the nested item out, the top-level ones stay', async () => {
    const engine = await makeEditor();
    build(engine, [['a', [['s1'], ['s2']]], ['b'], ['c']]);
    await engine.commit();
    select(engine, 's2', 'b', 'c');
    await moveItems(engine, selectedItems(engine), true);
    expect(doc(engine)).toBe('[a > [s1], s2, b, c]');
  });

  it('the whole move is ONE undo step', async () => {
    const engine = await makeEditor();
    build(engine, [['aaa'], ['bbb'], ['ccc'], ['ddd']]);
    await engine.commit();
    engine.undoManager.clear();
    select(engine, 'bbb', 'ccc', 'ddd');
    await moveItems(engine, selectedItems(engine), false);
    expect(doc(engine)).toBe('[aaa > [bbb, ccc, ddd]]');
    engine.undo();
    expect(doc(engine)).toBe('[aaa, bbb, ccc, ddd]');
    expect(engine.undoManager.canUndo()).toBe(false);
  });

  it('handleTab claims the key whenever items are selected, even if none can move; ignores other keys / modifiers', async () => {
    const engine = await makeEditor();
    build(engine, [['aaa'], ['bbb']]);
    await engine.commit();
    select(engine, 'aaa');
    expect(handleTab(engine, { key: 'Tab', shiftKey: true })).toBe(true); // top-level: cannot unindent
    expect(doc(engine)).toBe('[aaa, bbb]');
    expect(handleTab(engine, { key: 'Tab', ctrlKey: true })).toBe(false);
    expect(handleTab(engine, { key: 'a' })).toBe(false);
    engine.selection = { ...engine.selection, anchorBlock: null, focusBlock: null, blocks: new Set() };
    expect(handleTab(engine, { key: 'Tab' })).toBe(false);
  });

  it('a selection spanning several blocks is routed by the List extension hook (no block handler involved)', async () => {
    const engine = await makeEditor();
    build(engine, [['aaa'], ['bbb'], ['ccc']]);
    await engine.commit();
    select(engine, 'bbb', 'ccc');
    const event = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };
    engine.dispatchEventToSelection('keydown', event, 'onKeyDown');
    expect(event.preventDefault).toHaveBeenCalled();
    await engine.commit();
    expect(doc(engine)).toBe('[aaa > [bbb, ccc]]');
  });
});
