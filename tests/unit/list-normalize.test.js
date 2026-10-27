// @ts-nocheck
/**
 * Unit tests for the list schema normalizer (src/lib/blocks/list/normalize.js).
 * Each test builds a BROKEN tree with low-level operations (List.create / tree.move, bypassing the
 * normal list operations), commits, and asserts the normalized tree, that the moved blocks kept their
 * ids (so the caret survives) and that the fix is part of the breaking operation's undo step.
 */

import { describe, it, expect, vi } from 'vitest';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { ParagraphExtension, Paragraph } from '#lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension, List, ListItem } from '#lib/blocks/list/index.js';
import { BlockExtension } from '#lib/blocks/block.extension.js';

async function makeEditor() {
  const engine = new Nabu({ extensions: [ParagraphExtension, ListExtension, ListItemExtension, BlockExtension] });
  await engine.commit();
  engine.selection = { anchorBlock: null, focusBlock: null, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
  engine.undoManager.clear();
  return engine;
}

const pid = (parent) => parent?.id.toString() ?? null;
const mkList = (engine, parent, listType = 'bullet', extra = {}) =>
  List.create(engine, 'list', { listType, ...extra }, pid(parent)).node;
const mkItem = (engine, parent, text) => ListItem.create(engine, 'list-item', { text }, pid(parent)).node;
const mkP = (engine, parent, text) => Paragraph.create(engine, 'paragraph', { text }, pid(parent)).node;

/** Compact, comparable view of a node. */
function outline(node) {
  const type = node.data.get('type');
  const kids = (node.children() ?? []).map(outline);
  if (type === 'list') {
    const start = node.data.get('start');
    return `list:${node.data.get('listType')}${start ? `@${start}` : ''}[${kids.join(', ')}]`;
  }
  const text = node.data.get('text')?.toString();
  const label = `${type === 'list-item' ? 'item' : 'p'}:${text}`;
  return kids.length ? `${label}[${kids.join(', ')}]` : label;
}
// The editor starts with one empty paragraph: it is not part of what these tests build.
const doc = (engine) => engine.tree.roots().slice(1).map(outline);

/** Ids of every node by its text, to check that moves kept identities. */
function idsByText(engine) {
  const ids = {};
  const walk = (node) => {
    const text = node.data.get('text')?.toString();
    if (text) ids[text] = node.id.toString();
    for (const child of node.children() ?? []) walk(child);
  };
  for (const root of engine.tree.roots()) walk(root);
  return ids;
}

const findByText = (engine, text) => {
  let found = null;
  const walk = (node) => {
    if (node.data.get('text')?.toString() === text) found = node;
    for (const child of node.children() ?? []) walk(child);
  };
  for (const root of engine.tree.roots()) walk(root);
  return found;
};

describe('list normalizer', () => {
  it('R1 — a list emptied by the transaction is deleted', async () => {
    const engine = await makeEditor();
    mkP(engine, null, 'a');
    const list = mkList(engine, null);
    const item = mkItem(engine, list, 'x');
    mkP(engine, null, 'b');
    await engine.commit();
    expect(doc(engine)).toEqual(['p:a', 'list:bullet[item:x]', 'p:b']);
    const before = idsByText(engine);
    delete before.x;

    engine.tree.delete(item.id);
    await engine.commit();

    expect(doc(engine)).toEqual(['p:a', 'p:b']);
    expect(idsByText(engine)).toEqual(before);
  });

  it('R1 — an emptied nested list is deleted, leaving a plain item', async () => {
    const engine = await makeEditor();
    const list = mkList(engine, null);
    const x = mkItem(engine, list, 'x');
    const sub = mkList(engine, x);
    const y = mkItem(engine, sub, 'y');
    await engine.commit();
    expect(doc(engine)).toEqual(['list:bullet[item:x[list:bullet[item:y]]]']);

    y.move(list, 1); // moves the only sublist item out (the Shift+Tab shape)
    await engine.commit();
    expect(doc(engine)).toEqual(['list:bullet[item:x, item:y]']);
  });

  it('R1 — a list created by the transaction is left alone so it can be filled right after (nabu.insert pattern)', async () => {
    const engine = await makeEditor();
    const list = engine.insert('list', { listType: 'bullet' }); // commits an empty list
    expect(doc(engine)).toEqual(['list:bullet[]']);
    engine.insert('list-item', { text: 'a' }, list.id);
    await engine.commit();
    expect(doc(engine)).toEqual(['list:bullet[item:a]']);
  });

  it('R2a — a list directly inside a list is unwrapped, order preserved', async () => {
    const engine = await makeEditor();
    const list = mkList(engine, null);
    mkItem(engine, list, 'a');
    const inner = mkList(engine, list);
    mkItem(engine, inner, 'b');
    mkItem(engine, inner, 'c');
    mkItem(engine, list, 'd');
    const before = idsByText(engine);

    await engine.commit();

    expect(doc(engine)).toEqual(['list:bullet[item:a, item:b, item:c, item:d]']);
    expect(idsByText(engine)).toEqual(before);
    expect(engine.tree.roots()).toHaveLength(2); // the initial paragraph + the list
  });

  it('R2b — a paragraph in a list splits it (top level)', async () => {
    const engine = await makeEditor();
    const list = mkList(engine, null, 'ordered', { start: 3 });
    mkItem(engine, list, 'a');
    mkItem(engine, list, 'b');
    mkP(engine, list, 'P');
    mkItem(engine, list, 'c');
    mkItem(engine, list, 'd');
    const before = idsByText(engine);

    await engine.commit();

    // The first part keeps its `start`; the continuation restarts at 1 (no `start`).
    expect(doc(engine)).toEqual(['list:ordered@3[item:a, item:b]', 'p:P', 'list:ordered[item:c, item:d]']);
    expect(idsByText(engine)).toEqual(before);
  });

  it('R2b — a paragraph as the first / last child leaves no empty list', async () => {
    const engine = await makeEditor();
    const list = mkList(engine, null);
    mkP(engine, list, 'first');
    mkItem(engine, list, 'a');
    mkP(engine, list, 'last');
    await engine.commit();
    expect(doc(engine)).toEqual(['p:first', 'list:bullet[item:a]', 'p:last']);
  });

  it('R2b — nested: the hoisted block cascades up through the list items', async () => {
    const engine = await makeEditor();
    const root = mkList(engine, null);
    const x = mkItem(engine, root, 'X');
    const sub = mkList(engine, x);
    mkItem(engine, sub, 'a');
    mkP(engine, sub, 'P');
    mkItem(engine, sub, 'b');
    mkItem(engine, root, 'Y');
    const before = idsByText(engine);

    await engine.commit();

    expect(doc(engine)).toEqual([
      'list:bullet[item:X[list:bullet[item:a]]]',
      'p:P',
      'list:bullet[item:b, item:Y]',
    ]);
    expect(idsByText(engine)).toEqual(before);
  });

  it('DECIDED (P-28) R3a — an item may hold several sublists of different types, in order (nothing is merged)', async () => {
    const engine = await makeEditor();
    const root = mkList(engine, null);
    const x = mkItem(engine, root, 'X');
    const first = mkList(engine, x, 'bullet');
    mkItem(engine, first, 'a');
    const second = mkList(engine, x, 'ordered');
    mkItem(engine, second, 'b');
    const third = mkList(engine, x, 'bullet');
    mkItem(engine, third, 'c');
    const before = idsByText(engine);

    await engine.commit();

    expect(doc(engine)).toEqual(['list:bullet[item:X[list:bullet[item:a], list:ordered[item:b], list:bullet[item:c]]]']);
    expect(idsByText(engine)).toEqual(before);
  });

  it('R4 at the nested level — ADJACENT sublists of the same type merge, the first keeps its start', async () => {
    const engine = await makeEditor();
    const root = mkList(engine, null);
    const x = mkItem(engine, root, 'X');
    const first = mkList(engine, x, 'ordered', { start: 3 });
    mkItem(engine, first, 'a');
    const second = mkList(engine, x, 'ordered', { start: 7 });
    mkItem(engine, second, 'b');
    const third = mkList(engine, x, 'bullet');
    mkItem(engine, third, 'c');
    const fourth = mkList(engine, x, 'bullet');
    mkItem(engine, fourth, 'd');
    const firstId = first.id.toString();
    const thirdId = third.id.toString();
    const before = idsByText(engine);

    await engine.commit();

    expect(doc(engine)).toEqual(['list:bullet[item:X[list:ordered@3[item:a, item:b], list:bullet[item:c, item:d]]]']);
    const children = findByText(engine, 'X').children();
    expect(children[0].id.toString()).toBe(firstId);
    expect(children[1].id.toString()).toBe(thirdId);
    expect(idsByText(engine)).toEqual(before);
  });

  it('nested: same-type sublists separated by another type are NOT merged', async () => {
    const engine = await makeEditor();
    const root = mkList(engine, null);
    const x = mkItem(engine, root, 'X');
    mkItem(engine, mkList(engine, x, 'bullet'), 'a');
    mkItem(engine, mkList(engine, x, 'todo'), 'b');
    mkItem(engine, mkList(engine, x, 'bullet'), 'c');
    await engine.commit();
    expect(doc(engine)).toEqual(['list:bullet[item:X[list:bullet[item:a], list:todo[item:b], list:bullet[item:c]]]']);
  });

  it('nested: changing the listType of the middle sublist re-merges its neighbours (one undo step)', async () => {
    const engine = await makeEditor();
    const root = mkList(engine, null);
    const x = mkItem(engine, root, 'X');
    mkItem(engine, mkList(engine, x, 'bullet'), 'a');
    const middle = mkList(engine, x, 'ordered');
    mkItem(engine, middle, 'b');
    mkItem(engine, mkList(engine, x, 'bullet'), 'c');
    await engine.commit();
    engine.undoManager.clear();

    middle.data.set('listType', 'bullet');
    await engine.commit();

    expect(doc(engine)).toEqual(['list:bullet[item:X[list:bullet[item:a, item:b, item:c]]]']);
    engine.undoManager.undo();
    await engine.commit();
    expect(doc(engine)).toEqual(['list:bullet[item:X[list:bullet[item:a], list:ordered[item:b], list:bullet[item:c]]]']);
  });

  it('R3b — a non-list child of an item is hoisted after it, and splits the list', async () => {
    const engine = await makeEditor();
    const root = mkList(engine, null);
    const x = mkItem(engine, root, 'X');
    const sub = mkList(engine, x);
    mkItem(engine, sub, 'a');
    mkP(engine, x, 'P');
    mkItem(engine, root, 'Y');
    const before = idsByText(engine);

    await engine.commit();

    expect(doc(engine)).toEqual(['list:bullet[item:X[list:bullet[item:a]]]', 'p:P', 'list:bullet[item:Y]']);
    expect(idsByText(engine)).toEqual(before);
  });

  it('R3b — the document order is preserved when the foreign child comes before a sublist', async () => {
    const engine = await makeEditor();
    const root = mkList(engine, null);
    const x = mkItem(engine, root, 'X');
    mkP(engine, x, 'P');
    const sub = mkList(engine, x);
    mkItem(engine, sub, 'a');
    await engine.commit();
    expect(doc(engine)).toEqual(['list:bullet[item:X]', 'p:P', 'list:bullet[item:a]']);
  });

  it('adjacent lists of the same type merge (first keeps its start), other types do not', async () => {
    const engine = await makeEditor();
    const l1 = mkList(engine, null, 'ordered', { start: 4 });
    mkItem(engine, l1, 'a');
    const l2 = mkList(engine, null, 'ordered');
    mkItem(engine, l2, 'b');
    const l3 = mkList(engine, null, 'bullet');
    mkItem(engine, l3, 'c');
    await engine.commit();
    expect(doc(engine)).toEqual(['list:ordered@4[item:a, item:b]', 'list:bullet[item:c]']);
  });

  it('a valid document is left untouched', async () => {
    const engine = await makeEditor();
    const root = mkList(engine, null);
    const x = mkItem(engine, root, 'X');
    const sub = mkList(engine, x);
    mkItem(engine, sub, 'a');
    mkItem(engine, root, 'Y');
    mkP(engine, null, 'p');
    await engine.commit();
    const snapshot = doc(engine);
    const ids = idsByText(engine);
    await engine.commit();
    expect(doc(engine)).toEqual(snapshot);
    expect(idsByText(engine)).toEqual(ids);
  });

  describe('undo', () => {
    it('breaking operation + normalization are ONE undo step (R2b)', async () => {
      const engine = await makeEditor();
      const list = mkList(engine, null);
      mkItem(engine, list, 'a');
      mkItem(engine, list, 'b');
      const p = mkP(engine, null, 'P');
      await engine.commit();
      const valid = doc(engine);
      expect(valid).toEqual(['list:bullet[item:a, item:b]', 'p:P']);
      engine.undoManager.clear();

      // The breaking op: drop the paragraph in the middle of the list.
      p.move(list, 1);
      await engine.commit();
      expect(doc(engine)).toEqual(['list:bullet[item:a]', 'p:P', 'list:bullet[item:b]']);

      engine.undo();
      expect(doc(engine)).toEqual(valid);
      expect(engine.undoManager.canUndo()).toBe(false);
    });

    it('breaking operation + normalization are ONE undo step (R3b cascade)', async () => {
      const engine = await makeEditor();
      const root = mkList(engine, null);
      const x = mkItem(engine, root, 'X');
      const sub = mkList(engine, x);
      mkItem(engine, sub, 'a');
      mkItem(engine, root, 'Y');
      const p = mkP(engine, null, 'P');
      await engine.commit();
      const valid = doc(engine);
      engine.undoManager.clear();

      p.move(x, 1);
      await engine.commit();
      expect(doc(engine)).toEqual(['list:bullet[item:X[list:bullet[item:a]]]', 'p:P', 'list:bullet[item:Y]']);

      engine.undo();
      expect(doc(engine)).toEqual(valid);
      expect(engine.undoManager.canUndo()).toBe(false);
    });

    it('breaking operation + normalization are ONE undo step (R1)', async () => {
      const engine = await makeEditor();
      const list = mkList(engine, null);
      const a = mkItem(engine, list, 'a');
      await engine.commit();
      const valid = doc(engine);
      engine.undoManager.clear();

      engine.tree.delete(a.id); // the list loses its last item
      await engine.commit();
      expect(doc(engine)).toEqual([]);

      engine.undo();
      expect(doc(engine)).toEqual(valid);
      expect(engine.undoManager.canUndo()).toBe(false);
    });
  });
});
