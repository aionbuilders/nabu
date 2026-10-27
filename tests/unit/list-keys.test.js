// @ts-nocheck
/**
 * Unit tests for the list "step back one level" keys (src/lib/blocks/list/step-back.js, List.onSplit) and for
 * Tab moving a whole subtree (indent.js):
 *   A. Enter on an EMPTY item      B. Backspace at offset 0      C. ordered numbering across splits
 *   D. Tab / Shift+Tab with children
 * Everything is checked on the Loro tree; each operation is ONE undo step.
 */

import { describe, it, expect, vi } from 'vitest';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension, List, ListItem } from '#lib/blocks/list/index.js';
import { moveItems, selectedItems } from '#lib/blocks/list/indent.js';
import { stepBack } from '#lib/blocks/list/step-back.js';
import { onBeforeInput } from '#lib/blocks/list/hooks/onBeforeInput.hook.js';

async function makeEditor() {
  const engine = new Nabu({ extensions: [ParagraphExtension, ListExtension, ListItemExtension] });
  await engine.commit();
  engine.selection = { anchorBlock: null, focusBlock: null, blocks: new Set(), sync: vi.fn(), setCursor: vi.fn() };
  engine.undoManager.clear();
  return engine;
}

/**
 * `list(type, [text, kids?]...)` specs: `{ type, start, items: [[text, sublistSpec?], ...] }`.
 * Returns the list node.
 */
function build(engine, spec, parent = null) {
  const { type = 'bullet', start, items } = spec;
  const list = List.create(engine, 'list', { listType: type, start }, parent?.id.toString());
  for (const [text, sub] of items) {
    const item = ListItem.create(engine, 'list-item', { text }, list.node.id.toString());
    if (sub) build(engine, sub, item.node);
  }
  return list.node;
}
const ul = (...items) => ({ type: 'bullet', items });
const ol = (start, ...items) => ({ type: 'ordered', start, items });

const outline = (node) => {
  const type = node.data.get('type');
  if (type === 'list') {
    const start = node.data.get('start');
    const tag = node.data.get('listType') === 'ordered' ? `ol${start ? `@${start}` : ''}` : 'ul';
    return `${tag}[${(node.children() ?? []).map(outline).join(', ')}]`;
  }
  const text = node.data.get('text').toString();
  const sub = (node.children() ?? []).map(outline).join('');
  return (type === 'paragraph' ? `p(${text})` : text) + (sub ? ` > ${sub}` : '');
};
const doc = (engine) => engine.tree.roots().slice(1).map(outline).join(' ; ');
const nodeOf = (engine, text) => {
  let found;
  const walk = (n) => { if (n.data.get('text')?.toString() === text) found = n; (n.children() ?? []).forEach(walk); };
  engine.tree.roots().forEach(walk);
  return found;
};
const blockOf = (engine, text) => engine.blocks.get(nodeOf(engine, text).id.toString());
const select = (engine, ...texts) => {
  const blocks = texts.map((t) => blockOf(engine, t));
  engine.selection = { ...engine.selection, anchorBlock: blocks[0], focusBlock: blocks.at(-1), blocks: new Set(blocks) };
};
const setup = async (spec) => {
  const engine = await makeEditor();
  build(engine, spec);
  await engine.commit();
  engine.undoManager.clear();
  return engine;
};

describe('A · Enter on an EMPTY item steps back one level', () => {
  it('nested item: unindented one level, followers become its children, same block kept', async () => {
    const engine = await setup(ul(['a', ul(['s1'], [''], ['s2'])], ['b']));
    const empty = engine.blocks.get(nodeOf(engine, '').id.toString());
    const id = empty.id;
    empty.split({ offset: 0 });
    await engine.commit();
    expect(doc(engine)).toBe('ul[a > ul[s1],  > ul[s2], b]'); // the (empty) item now adopts s2
    expect(engine.blocks.get(id)?.type).toBe('list-item');
  });

  it('nested item, twice: back to the root level, a third Enter exits the list', async () => {
    const engine = await setup(ul(['a', ul(['s1'], [''])], ['b']));
    let item = blockOf(engine, '');
    item.split({ offset: 0 });
    await engine.commit();
    expect(doc(engine)).toBe('ul[a > ul[s1], , b]');
    item = blockOf(engine, '');
    item.split({ offset: 0 });
    await engine.commit();
    expect(doc(engine)).toBe('ul[a > ul[s1]] ; p() ; ul[b]');
  });

  it('top-level middle: list split around a paragraph (same node, id kept)', async () => {
    const engine = await setup(ul(['a'], [''], ['b']));
    const id = nodeOf(engine, '').id.toString();
    blockOf(engine, '').split({ offset: 0 });
    await engine.commit();
    expect(doc(engine)).toBe('ul[a] ; p() ; ul[b]');
    expect(engine.blocks.get(id).type).toBe('paragraph');
    expect(engine.selection.setCursor).toHaveBeenCalledWith(engine.blocks.get(id), 0);
  });

  it('top-level first of several: no empty list left; last: paragraph after; only item: list gone', async () => {
    let engine = await setup(ul([''], ['b']));
    blockOf(engine, '').split({ offset: 0 });
    await engine.commit();
    expect(doc(engine)).toBe('p() ; ul[b]');

    engine = await setup(ul(['a'], ['']));
    blockOf(engine, '').split({ offset: 0 });
    await engine.commit();
    expect(doc(engine)).toBe('ul[a] ; p()');

    engine = await setup(ul(['']));
    blockOf(engine, '').split({ offset: 0 });
    await engine.commit();
    expect(doc(engine)).toBe('p()');
  });

  it('a non-empty item still splits normally', async () => {
    const engine = await setup(ul(['ab']));
    blockOf(engine, 'ab').split({ offset: 1 });
    await engine.commit();
    expect(doc(engine)).toBe('ul[a, b]');
  });

  it('is ONE undo step', async () => {
    const engine = await setup(ul(['a'], [''], ['b']));
    const before = doc(engine);
    blockOf(engine, '').split({ offset: 0 });
    await engine.commit();
    expect(doc(engine)).not.toBe(before);
    engine.undo();
    expect(doc(engine)).toBe(before);
    expect(engine.undoManager.canUndo()).toBe(false);
  });
});

describe('B · Backspace at offset 0 steps back one level', () => {
  const backspace = async (engine, text) => {
    const block = blockOf(engine, text);
    Object.defineProperty(block.behavior, 'selection', { value: { from: 0, to: 0, isCollapsed: true }, configurable: true });
    const result = onBeforeInput(engine, { inputType: 'deleteContentBackward' }, block);
    await engine.commit();
    return result;
  };

  it('nested item: unindented one level (like Shift+Tab)', async () => {
    const engine = await setup(ul(['aa', ul(['s1'], ['s2'])], ['bb']));
    expect(await backspace(engine, 's1')).toBe(engine.BREAK);
    expect(doc(engine)).toBe('ul[aa, s1 > ul[s2], bb]');
  });

  it('top-level middle item: only it becomes a paragraph, the list is split, text kept', async () => {
    const engine = await setup(ul(['aa'], ['bb'], ['cc']));
    const id = nodeOf(engine, 'bb').id.toString();
    await backspace(engine, 'bb');
    expect(doc(engine)).toBe('ul[aa] ; p(bb) ; ul[cc]');
    expect(engine.blocks.get(id).type).toBe('paragraph');
    expect(engine.blocks.get(id).behavior.text).toBe('bb');
  });

  it('top-level first item: becomes a paragraph before the rest of the list', async () => {
    const engine = await setup(ul(['aa'], ['bb']));
    await backspace(engine, 'aa');
    expect(doc(engine)).toBe('p(aa) ; ul[bb]');
  });

  it('top-level item with children: the sublist stays a list right after the paragraph, nesting kept', async () => {
    const engine = await setup(ul(['aa'], ['P', ul(['c1', ul(['d1'])], ['c2'])], ['bb']));
    await backspace(engine, 'P');
    expect(doc(engine)).toBe('ul[aa] ; p(P) ; ul[c1 > ul[d1], c2, bb]');
  });

  it('a second Backspace (paragraph at offset 0) is the normal merge into the previous block', async () => {
    const engine = await setup(ul(['aa'], ['bb'], ['cc']));
    await backspace(engine, 'bb');
    const para = blockOf(engine, 'bb');
    Object.defineProperty(para.behavior, 'selection', { value: { from: 0, to: 0, isCollapsed: true }, configurable: true });
    para.behavior.handleDeleteContentBackward({ preventDefault() {} });
    await engine.commit();
    expect(doc(engine)).toBe('ul[aabb, cc]'); // merged into the last item above; the two lists are adjacent again
  });

  it('a todo item loses its checked state when it becomes a paragraph', async () => {
    const engine = await makeEditor();
    const list = List.create(engine, 'list', { listType: 'todo' });
    ListItem.create(engine, 'list-item', { text: 'x', checked: true }, list.node.id.toString());
    await engine.commit();
    await backspace(engine, 'x');
    expect(doc(engine)).toBe('p(x)');
    expect(nodeOf(engine, 'x').data.get('checked')).toBeUndefined();
  });

  it('not collapsed / not at offset 0 / other keys: unchanged (hook lets it through)', async () => {
    const engine = await setup(ul(['aa'], ['bb']));
    const block = blockOf(engine, 'bb');
    const run = (sel, inputType = 'deleteContentBackward') => {
      Object.defineProperty(block.behavior, 'selection', { value: sel, configurable: true });
      return onBeforeInput(engine, { inputType }, block);
    };
    expect(run({ from: 1, to: 1, isCollapsed: true })).toBe(engine.CONTINUE);
    expect(run({ from: 0, to: 1, isCollapsed: false })).toBe(engine.CONTINUE);
    expect(run({ from: 0, to: 0, isCollapsed: true }, 'deleteContentForward')).toBe(engine.CONTINUE);
    await engine.commit();
    expect(doc(engine)).toBe('ul[aa, bb]');
  });

  it('is ONE undo step', async () => {
    const engine = await setup(ul(['aa'], ['P', ul(['c1'])], ['bb']));
    const before = doc(engine);
    await backspace(engine, 'P');
    expect(doc(engine)).toBe('ul[aa] ; p(P) ; ul[c1, bb]');
    engine.undo();
    expect(doc(engine)).toBe(before);
    expect(engine.undoManager.canUndo()).toBe(false);
  });
});

describe('C · ordered numbering continues across splits', () => {
  it('Backspace on a middle item: the tail list starts at the number its first item had', async () => {
    const engine = await setup(ol(undefined, ['a'], ['b'], ['c']));
    await stepBack(engine, nodeOf(engine, 'b'));
    expect(doc(engine)).toBe('ol[a] ; p(b) ; ol@3[c]');
  });

  it('the original list start is taken into account', async () => {
    const engine = await setup(ol(5, ['a'], ['b'], ['c'], ['d']));
    await stepBack(engine, nodeOf(engine, 'b'));
    expect(doc(engine)).toBe('ol@5[a] ; p(b) ; ol@7[c, d]');
  });

  it('Enter on an empty middle item', async () => {
    const engine = await setup(ol(undefined, ['a'], [''], ['c']));
    blockOf(engine, '').split({ offset: 0 });
    await engine.commit();
    expect(doc(engine)).toBe('ol[a] ; p() ; ol@3[c]');
  });

  it('first item out: the rest starts at 2; with children the sublist sits between', async () => {
    let engine = await setup(ol(undefined, ['a'], ['b']));
    await stepBack(engine, nodeOf(engine, 'a'));
    expect(doc(engine)).toBe('p(a) ; ol@2[b]');

    engine = await setup(ol(undefined, ['a'], ['b', ul(['b1'])], ['c']));
    await stepBack(engine, nodeOf(engine, 'b'));
    expect(doc(engine)).toBe('ol[a] ; p(b) ; ul[b1] ; ol@3[c]');
  });

  it('bullet lists get no start', async () => {
    const engine = await setup(ul(['a'], ['b'], ['c']));
    await stepBack(engine, nodeOf(engine, 'b'));
    expect(doc(engine)).toBe('ul[a] ; p(b) ; ul[c]');
  });
});

describe('D · Tab moves the whole subtree', () => {
  const tab = async (engine, ...texts) => { select(engine, ...texts); return moveItems(engine, selectedItems(engine), false); };
  const shiftTab = async (engine, ...texts) => { select(engine, ...texts); return moveItems(engine, selectedItems(engine), true); };

  it('an item with children keeps them as its children', async () => {
    const engine = await setup(ul(['a'], ['bbb', ul(['b1'], ['b2'])], ['c']));
    await tab(engine, 'bbb');
    expect(doc(engine)).toBe('ul[a > ul[bbb > ul[b1, b2]], c]');
  });

  it('into a previous sibling that already has a sublist: appended after it, subtree intact', async () => {
    const engine = await setup(ul(['a', ul(['a1'])], ['bbb', ul(['b1'])]));
    await tab(engine, 'bbb');
    expect(doc(engine)).toBe('ul[a > ul[a1, bbb > ul[b1]]]');
  });

  it('Shift+Tab keeps the item\'s children and appends the following siblings after them', async () => {
    const engine = await setup(ul(['a', ul(['s1', ul(['k1'])], ['s2'])], ['b']));
    await shiftTab(engine, 's1');
    expect(doc(engine)).toBe('ul[a, s1 > ul[k1, s2], b]');
  });

  it('multi-selection: a selected child is not moved a second time with its selected parent', async () => {
    const engine = await setup(ul(['a'], ['bbb', ul(['b1'], ['b2'])], ['c']));
    await tab(engine, 'bbb', 'b1', 'b2', 'c');
    expect(doc(engine)).toBe('ul[a > ul[bbb > ul[b1, b2], c]]');
  });

  it('multi-selection Shift+Tab: parent and child selected, the child follows its parent', async () => {
    const engine = await setup(ul(['a', ul(['s1', ul(['k1'])])], ['b']));
    await shiftTab(engine, 's1', 'k1');
    expect(doc(engine)).toBe('ul[a, s1 > ul[k1], b]');
  });

  it('no empty list is left behind and the move is ONE undo step', async () => {
    const engine = await setup(ul(['a'], ['bbb', ul(['b1'])]));
    const before = doc(engine);
    await tab(engine, 'bbb');
    expect(doc(engine)).toBe('ul[a > ul[bbb > ul[b1]]]');
    engine.undo();
    expect(doc(engine)).toBe(before);
    expect(engine.undoManager.canUndo()).toBe(false);
  });
});
