// @ts-nocheck
/**
 * Unit tests for "changing the type of ONE list item acts on that item only" (list/convert.js,
 * ListItem.retype behind block:transform / Block.transformTo) and for Ctrl/Cmd+Enter on to-do items
 * (list/todos-toggle.js). Checked on the Loro tree; each operation is ONE undo step.
 */

import { describe, it, expect, vi } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension, List, ListItem } from '$lib/blocks/list/index.js';
import { convertItemToListType } from '$lib/blocks/list/convert.js';
import { toggleTodos } from '$lib/blocks/list/todos-toggle.js';

async function makeEditor() {
  const engine = new Nabu({ extensions: [ParagraphExtension, ListExtension, ListItemExtension] });
  await engine.commit();
  engine.selection = { anchorBlock: null, focusBlock: null, blocks: new Set(), sync: vi.fn(), setCursor: vi.fn() };
  engine.undoManager.clear();
  return engine;
}

function build(engine, spec, parent = null) {
  const { type = 'bullet', start, items } = spec;
  const list = List.create(engine, 'list', { listType: type, start }, parent?.id.toString());
  for (const [text, sub, checked] of items) {
    const item = ListItem.create(engine, 'list-item', { text, checked: checked ?? (type === 'todo' ? false : undefined) }, list.node.id.toString());
    if (sub) build(engine, sub, item.node);
  }
  return list.node;
}
const ul = (...items) => ({ type: 'bullet', items });
const ol = (start, ...items) => ({ type: 'ordered', start, items });
const todo = (...items) => ({ type: 'todo', items });

const outline = (node) => {
  const type = node.data.get('type');
  if (type === 'list') {
    const start = node.data.get('start');
    const lt = node.data.get('listType');
    const tag = lt === 'ordered' ? `ol${start ? `@${start}` : ''}` : lt === 'todo' ? 'todo' : 'ul';
    return `${tag}[${(node.children() ?? []).map(outline).join(', ')}]`;
  }
  const text = node.data.get('text').toString();
  const checked = node.data.get('checked');
  const mark = checked === undefined ? '' : checked ? '[x] ' : '[ ] ';
  const sub = (node.children() ?? []).map(outline).join('');
  const label = type === 'list-item' ? mark + text : `${type === 'heading' ? 'h' + node.data.get('level') : type}(${text})`;
  return label + (sub ? ` > ${sub}` : '');
};
const doc = (engine) => engine.tree.roots().slice(1).map(outline).join(' ; ');
const nodeOf = (engine, text) => {
  let found;
  const walk = (n) => { if (n.data.get('text')?.toString() === text) found = n; (n.children() ?? []).forEach(walk); };
  engine.tree.roots().forEach(walk);
  return found;
};
const blockOf = (engine, text) => engine.blocks.get(nodeOf(engine, text).id.toString());
const setup = async (...specs) => {
  const engine = await makeEditor();
  for (const spec of specs) build(engine, spec);
  await engine.commit();
  engine.undoManager.clear();
  return engine;
};
/** Same path as `block:transform`: retype inside one transaction. */
const transform = async (engine, text, type, props) => {
  const block = blockOf(engine, text);
  await engine.transact(() => block.retype(type, props));
};
const convert = async (engine, text, listType) => {
  await engine.transact(() => { convertItemToListType(engine, nodeOf(engine, text), listType); });
};

describe('list item -> another LIST type', () => {
  it('middle item: ul[a] ol[b] ul[c]', async () => {
    const engine = await setup(ul(['a'], ['b'], ['c']));
    await convert(engine, 'b', 'ordered');
    expect(doc(engine)).toBe('ul[a] ; ol[b] ; ul[c]');
  });

  it('first / last item: no empty list left behind', async () => {
    const engine = await setup(ul(['a'], ['b'], ['c']));
    await convert(engine, 'a', 'ordered');
    expect(doc(engine)).toBe('ol[a] ; ul[b, c]');
    await convert(engine, 'c', 'todo');
    expect(doc(engine)).toBe('ol[a] ; ul[b] ; todo[[ ] c]');
  });

  it('the only item: the list changes type', async () => {
    const engine = await setup(ul(['a']));
    await convert(engine, 'a', 'ordered');
    expect(doc(engine)).toBe('ol[a]');
  });

  it('same type is a no-op (no change, no undo step)', async () => {
    const engine = await setup(ul(['a'], ['b']));
    await convert(engine, 'b', 'bullet');
    expect(doc(engine)).toBe('ul[a, b]');
    expect(engine.undoManager.canUndo()).toBe(false);
  });

  it('the item keeps its children', async () => {
    const engine = await setup(ul(['a'], ['b', ul(['b1'], ['b2'])], ['c']));
    await convert(engine, 'b', 'todo');
    expect(doc(engine)).toBe('ul[a] ; todo[[ ] b > ul[b1, b2]] ; ul[c]');
  });

  it('todo gets checked:false when entering, drops it when leaving', async () => {
    const engine = await setup(todo(['a', null, true], ['b', null, true], ['c']));
    await convert(engine, 'b', 'bullet');
    expect(doc(engine)).toBe('todo[[x] a] ; ul[b] ; todo[[ ] c]');
    await convert(engine, 'b', 'todo');
    expect(doc(engine)).toBe('todo[[x] a, [ ] b, [ ] c]'); // merged back into its neighbours
  });

  it('ordered tail keeps counting; converting the last item above an ordered list joins it', async () => {
    const engine = await setup(ol(undefined, ['a'], ['b'], ['c']));
    await convert(engine, 'b', 'bullet');
    expect(doc(engine)).toBe('ol[a] ; ul[b] ; ol@3[c]');
    const other = await setup(ul(['x'], ['y']), ol(undefined, ['z']));
    await convert(other, 'y', 'ordered');
    expect(doc(other)).toBe('ul[x] ; ol[y, z]');
  });

  it('is ONE undo step', async () => {
    const engine = await setup(ul(['a'], ['b'], ['c']));
    await convert(engine, 'b', 'ordered');
    engine.undoManager.undo();
    await engine.commit();
    expect(doc(engine)).toBe('ul[a, b, c]');
  });

  it('nested sole child: its sublist changes type in place', async () => {
    const engine = await setup(ul(['a', ul(['s'])], ['b']));
    await convert(engine, 's', 'ordered');
    expect(doc(engine)).toBe('ul[a > ol[s], b]');
  });

  it('nested item with siblings: unindented to the top level, followers become its children', async () => {
    const engine = await setup(ul(['a', ul(['s1'], ['s2'], ['s3'])], ['z']));
    await convert(engine, 's2', 'ordered');
    expect(doc(engine)).toBe('ul[a > ul[s1]] ; ol[s2 > ul[s3]] ; ul[z]');
  });
});

describe('list item -> NON-list block (block:transform / transformTo)', () => {
  it('middle item becomes a paragraph, the list is split around it', async () => {
    const engine = await setup(ul(['a'], ['b'], ['c']));
    const id = blockOf(engine, 'b').id;
    await transform(engine, 'b', 'paragraph');
    expect(doc(engine)).toBe('ul[a] ; paragraph(b) ; ul[c]');
    expect(engine.blocks.get(id)?.type).toBe('paragraph');
  });

  it('heading: props applied; checked dropped; sublist stays a list right after it', async () => {
    const engine = await setup(todo(['a'], ['b', todo(['b1'])], ['c']));
    await transform(engine, 'b', 'heading', { level: 2 });
    expect(doc(engine)).toBe('todo[[ ] a] ; h2(b) ; todo[[ ] b1, [ ] c]'); // b1 and c: adjacent same-type lists merge
  });

  it('ordered numbering of the tail continues', async () => {
    const engine = await setup(ol(undefined, ['a'], ['b'], ['c']));
    await transform(engine, 'b', 'paragraph');
    expect(doc(engine)).toBe('ol[a] ; paragraph(b) ; ol@3[c]');
  });

  it('Block.transformTo (markdown shortcuts) follows the same rule', async () => {
    const engine = await setup(ul(['a'], ['b'], ['c']));
    blockOf(engine, 'b').transformTo('heading', { level: 1 });
    await engine.commit();
    expect(doc(engine)).toBe('ul[a] ; h1(b) ; ul[c]');
  });

  it('nested item: unindented up to the top level, then lifted; order and items preserved', async () => {
    const engine = await setup(ul(['a', ul(['s1'], ['s2', ul(['g'])], ['s3'])], ['z']));
    await transform(engine, 's2', 'heading', { level: 1 });
    expect(doc(engine)).toBe('ul[a > ul[s1]] ; h1(s2) ; ul[g, s3, z]');
  });

  it('is ONE undo step', async () => {
    const engine = await setup(ul(['a', ul(['s1'], ['s2'])], ['z']));
    await transform(engine, 's1', 'paragraph');
    engine.undoManager.undo();
    await engine.commit();
    expect(doc(engine)).toBe('ul[a > ul[s1, s2], z]');
  });
});

describe('Ctrl/Cmd+Enter toggles to-do items', () => {
  const key = (init = {}) => ({ key: 'Enter', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, ...init });
  const select = (engine, ...texts) => {
    const blocks = texts.map((t) => blockOf(engine, t));
    engine.selection = { ...engine.selection, anchorBlock: blocks[0], focusBlock: blocks.at(-1), blocks: new Set(blocks) };
  };

  it('toggles the item under the caret, Meta works too, then undo restores it', async () => {
    const engine = await setup(todo(['a'], ['b']));
    select(engine, 'a');
    expect(toggleTodos(engine, key())).toBe(true);
    await engine.commit();
    expect(doc(engine)).toBe('todo[[x] a, [ ] b]');
    expect(toggleTodos(engine, key({ ctrlKey: false, metaKey: true }))).toBe(true);
    await engine.commit();
    expect(doc(engine)).toBe('todo[[ ] a, [ ] b]');
    toggleTodos(engine, key());
    await engine.commit();
    engine.undoManager.undo();
    await engine.commit();
    expect(doc(engine)).toBe('todo[[ ] a, [ ] b]');
  });

  it('several items: any unchecked -> check all, else uncheck all', async () => {
    const engine = await setup(todo(['a', null, true], ['b'], ['c', null, true]));
    select(engine, 'a', 'b', 'c');
    toggleTodos(engine, key());
    await engine.commit();
    expect(doc(engine)).toBe('todo[[x] a, [x] b, [x] c]');
    toggleTodos(engine, key());
    await engine.commit();
    expect(doc(engine)).toBe('todo[[ ] a, [ ] b, [ ] c]');
  });

  it('not a todo item / other keys: not handled', async () => {
    const engine = await setup(ul(['a']), todo(['t']));
    select(engine, 'a');
    expect(toggleTodos(engine, key())).toBe(false);
    select(engine, 't');
    expect(toggleTodos(engine, key({ ctrlKey: false }))).toBe(false);
    expect(toggleTodos(engine, key({ shiftKey: true }))).toBe(false);
    expect(toggleTodos(engine, key({ key: 'a' }))).toBe(false);
    expect(doc(engine)).toBe('ul[a] ; todo[[ ] t]');
  });
});
