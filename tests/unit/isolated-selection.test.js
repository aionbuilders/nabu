// @ts-nocheck
/**
 * Unit tests for ISOLATED TEXT FIELDS (`Block#isolatesSelection`, ADR 018 §3.9) with a FICTIONAL block type: the engine must
 * not know any region. A "fieldset" is a container whose own text (its "legend") is an isolated field and whose children are
 * its body. Rules under test (container.utils.js, megablock.svelte.js):
 *  - a range that crosses a legend never touches its text, never deletes it nor its container, and never merges the text
 *    blocks on either side of it (or in two different isolation owners);
 *  - the first block of every run is left (emptied): the skeleton stays;
 *  - the clipboard of a text selection holds the text blocks only;
 *  - a selection entirely inside a legend is an ordinary text selection.
 */

import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { LoroText } from 'loro-crdt';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { MegaBlock } from '#lib/blocks/megablock.svelte.js';
import { TextBehavior } from '#lib/behaviors/text/index.js';
import { extension } from '#lib/utils/extensions.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension } from '#lib/blocks/list/index.js';
import { RichTextExtension } from '#lib/behaviors/text/index.js';
import { NabuPasteExtension, PlainTextPasteExtension } from '#lib/paste/index.js';
import { BlockExtension } from '#lib/blocks/block.extension.js';
import { deleteRange, isolatedRuns, isolationOwnerOf, textBlocksInOrder, handleContainerBeforeInput } from '#lib/blocks/container.utils.js';

/** A container with an isolated legend (its text) and a free body. */
class Fieldset extends MegaBlock {
  isolatesSelection = true;
  constructor(nabu, node) {
    super(nabu, node);
    this.container = node.data.get('text') ?? node.data.setContainer('text', new LoroText());
    this.behavior = new TextBehavior(this, this.container);
    this.behaviors.set('text', this.behavior);
    this.serializers.set('application/x-nabu+json', () => ({
      type: 'fieldset', props: {}, delta: this.container.sliceDelta(0, this.container.length),
      children: this.children.map((c) => c.serialize('application/x-nabu+json')).filter(Boolean),
    }));
  }
  get text() { return this.behavior.text; }
  absorbs(block) { return this.behavior.absorbs(block); }
  static create(nabu, type, props = {}, parentId = null, index = null) {
    const node = nabu.tree.createNode(parentId || undefined, index ?? undefined);
    node.data.set('type', 'fieldset');
    const text = node.data.setContainer('text', new LoroText());
    if (props.text) text.insert(0, props.text);
    return new Fieldset(nabu, node);
  }
}
const FieldsetExtension = extension('fieldset', { block: Fieldset, component: null });

async function makeEditor() {
  const engine = new Nabu({
    extensions: [ParagraphExtension, ListExtension, ListItemExtension, RichTextExtension, FieldsetExtension, NabuPasteExtension, PlainTextPasteExtension, BlockExtension],
  });
  await engine.commit();
  engine.selection = { anchorBlock: null, focusBlock: null, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn(), startOffset: 0 };
  return engine;
}

const P = (text = '') => ({ type: 'paragraph', text });
const F = (text, children = []) => ({ type: 'fieldset', text, children });
const LI = (...items) => ({ type: 'list', props: { listType: 'bullet' }, children: items.map((text) => ({ type: 'list-item', text })) });

async function build(engine, specs) {
  for (const b of [...engine.children]) engine.delete(b);
  const add = (spec, parentId, index) => {
    const block = engine.insert(spec.type, { ...(spec.props ?? {}), ...(spec.text !== undefined ? { text: spec.text } : {}) }, parentId, index);
    (spec.children ?? []).forEach((child, i) => add(child, block.id, i));
  };
  specs.forEach((spec, i) => add(spec, null, i));
  await engine.commit();
  engine.undoManager.clear();
}

const fmt = (node) => {
  const type = node.data.get('type');
  const text = node.data.get('text')?.toString() ?? '';
  const kids = (node.children() ?? []).map(fmt).join(' ');
  const name = type === 'fieldset' ? 'F' : type === 'paragraph' ? 'p' : type === 'list-item' ? 'li' : type;
  return `${name}(${text})${kids ? `{${kids}}` : ''}`;
};
const doc = (engine) => engine.tree.roots().map(fmt).join(' ; ');

const at = (engine, text) => textBlocksInOrder(engine).find((b) => b.behaviors.get('text').text === text);
/** A range from `from`@`fromOffset` to `to`@`toOffset` (blocks by their text). */
const range = (engine, from, fromOffset, to, toOffset) => ({ startBlock: at(engine, from), startOffset: fromOffset, endBlock: at(engine, to), endOffset: toOffset });

/** Pins the model selection (there is no DOM selection in unit tests). */
function select(engine, from, fromOffset, to, toOffset) {
  const r = range(engine, from, fromOffset, to, toOffset);
  Object.defineProperty(r.startBlock, 'selection', { configurable: true, get: () => ({ from: r.startOffset, to: r.startBlock === r.endBlock ? r.endOffset : r.startBlock.behaviors.get('text').text.length }) });
  if (r.endBlock !== r.startBlock) Object.defineProperty(r.endBlock, 'selection', { configurable: true, get: () => ({ from: 0, to: r.endOffset }) });
  engine.selection = { sync: vi.fn(), setCursor: vi.fn(), isCollapsed: false, startBlock: r.startBlock, endBlock: r.endBlock, anchorBlock: r.startBlock, focusBlock: r.endBlock, start: { from: r.startOffset }, end: { to: r.endOffset } };
  return r;
}

async function settle(engine) {
  await engine.commit();
  await tick();
  await new Promise((r) => setTimeout(r, 0));
}

describe('the flag', () => {
  it('is off by default and carried by the fictional block, nothing else', async () => {
    const engine = await makeEditor();
    await build(engine, [P('a'), F('T', [P('b')])]);
    expect(engine.children.map((b) => b.isolatesSelection)).toEqual([false, true]);
    expect(engine.children[1].children[0].isolatesSelection).toBe(false);
  });

  it('isolationOwnerOf is the nearest isolating ANCESTOR (never the block itself)', async () => {
    const engine = await makeEditor();
    await build(engine, [P('root'), F('A', [P('a1'), F('S', [P('s1')])])]);
    expect(isolationOwnerOf(at(engine, 'root'))).toBeNull();
    expect(isolationOwnerOf(at(engine, 'a1'))).toBe(at(engine, 'A'));
    expect(isolationOwnerOf(at(engine, 's1'))).toBe(at(engine, 'S'));
    expect(isolationOwnerOf(at(engine, 'S'))).toBe(at(engine, 'A'));
    expect(isolationOwnerOf(at(engine, 'A'))).toBeNull();
  });
});

describe('isolatedRuns', () => {
  it('a document without isolated block gives the range itself', async () => {
    const engine = await makeEditor();
    await build(engine, [P('aaa'), P('bbb'), P('ccc')]);
    const r = range(engine, 'aaa', 1, 'ccc', 2);
    expect(isolatedRuns(engine, r)).toEqual([r]);
  });

  it('cuts the range at every isolated block and at every change of isolation owner; the legends are in no run', async () => {
    const engine = await makeEditor();
    await build(engine, [P('x'), F('A', [P('a1'), P('a2'), F('S', [P('s1')]), P('a3')]), F('B', [P('b1')])]);
    const runs = isolatedRuns(engine, range(engine, 'x', 0, 'b1', 1));
    expect(runs.map((r) => [r.startBlock.behaviors.get('text').text, r.startOffset, r.endBlock.behaviors.get('text').text, r.endOffset])).toEqual([
      ['x', 0, 'x', 1], ['a1', 0, 'a2', 2], ['s1', 0, 's1', 2], ['a3', 0, 'a3', 2], ['b1', 0, 'b1', 1],
    ]);
  });

  it('a range that starts or ends IN a legend leaves its text out', async () => {
    const engine = await makeEditor();
    await build(engine, [F('Title', [P('body')]), P('after')]);
    const runs = isolatedRuns(engine, range(engine, 'Title', 2, 'after', 3));
    expect(runs.map((r) => [r.startBlock.behaviors.get('text').text, r.startOffset, r.endOffset])).toEqual([['body', 0, 4], ['after', 0, 3]]);
    expect(isolatedRuns(engine, range(engine, 'Title', 1, 'Title', 3))).toEqual([]); // a legend alone is not a run either
  });
});

describe('deleting a range across isolated fields', () => {
  it('clears the text on both sides of a legend and merges nothing; legends and containers stay', async () => {
    const engine = await makeEditor();
    await build(engine, [F('One', [P('aaXX')]), F('Two', [P('YYbb')])]);
    deleteRange(engine, range(engine, 'aaXX', 2, 'YYbb', 2));
    await settle(engine);
    expect(doc(engine)).toBe('F(One){p(aa)} ; F(Two){p(bb)}');
  });

  it('the junction (caret) is the start of the range', async () => {
    const engine = await makeEditor();
    await build(engine, [F('One', [P('aaXX')]), F('Two', [P('YYbb')])]);
    const junction = deleteRange(engine, range(engine, 'aaXX', 2, 'YYbb', 2));
    expect(junction.block).toBe(at(engine, 'aaXX'));
    expect(junction.offset).toBe(2);
  });

  it('a root paragraph before a field and its body do not merge', async () => {
    const engine = await makeEditor();
    await build(engine, [P('abcd'), F('T', [P('efgh')])]);
    deleteRange(engine, range(engine, 'abcd', 2, 'efgh', 2));
    await settle(engine);
    expect(doc(engine)).toBe('p(ab) ; F(T){p(gh)}');
  });

  it('a range ending in a legend deletes up to the block above it; the body below is untouched', async () => {
    const engine = await makeEditor();
    await build(engine, [P('abcd'), F('Title', [P('body')])]);
    deleteRange(engine, range(engine, 'abcd', 1, 'Title', 3));
    await settle(engine);
    expect(doc(engine)).toBe('p(a) ; F(Title){p(body)}');
  });

  it('a range starting in a legend deletes from the start of the body', async () => {
    const engine = await makeEditor();
    await build(engine, [F('Title', [P('body'), P('more')]), P('after')]);
    deleteRange(engine, range(engine, 'Title', 2, 'after', 2));
    await settle(engine);
    expect(doc(engine)).toBe('F(Title){p()} ; p(ter)');
  });

  it('the whole text of a document (Select All, Delete) keeps the skeleton: legends, containers, one empty block per run', async () => {
    const engine = await makeEditor();
    await build(engine, [P('x'), F('A', [P('a1'), P('a2'), F('S', [P('s1'), P('s2')]), P('a3')]), F('B', [P('b1'), LI('i1', 'i2')])]);
    const blocks = textBlocksInOrder(engine).filter((b) => !b.isolatesSelection);
    deleteRange(engine, { startBlock: blocks[0], startOffset: 0, endBlock: blocks.at(-1), endOffset: blocks.at(-1).behaviors.get('text').text.length });
    await settle(engine);
    expect(doc(engine)).toBe('p() ; F(A){p() F(S){p()} p()} ; F(B){p()}');
  });

  it('sibling blocks of a same body are merged as usual (nothing isolated between them)', async () => {
    const engine = await makeEditor();
    await build(engine, [F('T', [P('alpha'), P('beta'), P('gamma')])]);
    deleteRange(engine, range(engine, 'alpha', 2, 'gamma', 2));
    await settle(engine);
    expect(doc(engine)).toBe('F(T){p(almma)}');
  });

  it('the end of a sub-field body and the text after it, in the parent body, are in different owners: no merge', async () => {
    const engine = await makeEditor();
    await build(engine, [F('C', [P('p1'), F('S', [P('q1'), P('q2')]), P('p3')])]);
    deleteRange(engine, range(engine, 'q2', 1, 'p3', 1));
    await settle(engine);
    expect(doc(engine)).toBe('F(C){p(p1) F(S){p(q1) p(q)} p(3)}');
  });

  it('a list that follows a legend is cleared like any list, and stays', async () => {
    const engine = await makeEditor();
    await build(engine, [F('T', [LI('one', 'two', 'three')]), P('end')]);
    deleteRange(engine, range(engine, 'one', 1, 'end', 1));
    await settle(engine);
    expect(doc(engine)).toBe('F(T){list(){li(o)}} ; p(nd)');
  });

  it('a selection entirely INSIDE a legend is an ordinary text deletion', async () => {
    const engine = await makeEditor();
    await build(engine, [F('Title', [P('body')])]);
    deleteRange(engine, range(engine, 'Title', 1, 'Title', 4));
    await settle(engine);
    expect(doc(engine)).toBe('F(Te){p(body)}');
  });

  it('is one undo step', async () => {
    const engine = await makeEditor();
    await build(engine, [F('One', [P('aaXX')]), F('Two', [P('YYbb')])]);
    const before = doc(engine);
    const sel = select(engine, 'aaXX', 2, 'YYbb', 2);
    const event = { inputType: 'deleteContentBackward', data: null, preventDefault: vi.fn() };
    expect(handleContainerBeforeInput(engine, engine, event)).toBe(true);
    await settle(engine);
    expect(doc(engine)).toBe('F(One){p(aa)} ; F(Two){p(bb)}');
    expect(sel.startBlock).toBeTruthy();
    engine.undoManager.undo();
    await settle(engine);
    expect(doc(engine)).toBe(before);
    expect(engine.undoManager.canUndo()).toBe(false);
  });
});

describe('typing over a selection that crosses isolated fields', () => {
  it('replaces the text on each side, inserts at the start of the range, merges nothing', async () => {
    const engine = await makeEditor();
    await build(engine, [F('One', [P('aaXX')]), F('Two', [P('YYbb')])]);
    select(engine, 'aaXX', 2, 'YYbb', 2);
    const event = { inputType: 'insertText', data: 'Z', preventDefault: vi.fn() };
    expect(handleContainerBeforeInput(engine, engine, event)).toBe(true);
    await settle(engine);
    expect(doc(engine)).toBe('F(One){p(aaZ)} ; F(Two){p(bb)}');
  });

  it('does nothing when the range holds no text outside the fields', async () => {
    const engine = await makeEditor();
    await build(engine, [F('One', []), F('Two', [])]);
    select(engine, 'One', 1, 'Two', 1);
    const event = { inputType: 'insertText', data: 'Z', preventDefault: vi.fn() };
    expect(handleContainerBeforeInput(engine, engine, event)).toBe(false);
    expect(doc(engine)).toBe('F(One) ; F(Two)');
  });
});

describe('the clipboard of a text selection', () => {
  function copy(engine, from, fromOffset, to, toOffset) {
    select(engine, from, fromOffset, to, toOffset);
    const data = {};
    engine.handleCopy({ preventDefault: vi.fn(), clipboardData: { setData: (k, v) => { data[k] = v; } } });
    return { fragment: JSON.parse(data['application/x-nabu+json']), text: data['text/plain'], html: data['text/html'] };
  }

  it('across fields: the text blocks only, as if the fields were not there', async () => {
    const engine = await makeEditor();
    await build(engine, [P('intro'), F('One', [P('aa'), F('Sub', [P('bb')])]), F('Two', [P('cc')]), P('tail')]);
    const { fragment, text, html } = copy(engine, 'intro', 2, 'tail', 2);
    expect(fragment.blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph']);
    expect(fragment.blocks.map((b) => b.delta.map((op) => op.insert).join(''))).toEqual(['tro', 'aa', 'bb', 'cc', 'ta']);
    expect(text).toBe('tro\n\naa\n\nbb\n\ncc\n\nta');
    expect(JSON.stringify(fragment) + html).not.toMatch(/One|Two|Sub|fieldset/);
  });

  it('inside one body: the blocks, no container', async () => {
    const engine = await makeEditor();
    await build(engine, [F('T', [P('alpha'), P('beta')])]);
    const { fragment } = copy(engine, 'alpha', 3, 'beta', 2);
    expect(fragment.blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
  });

  it('inside a legend: its text', async () => {
    const engine = await makeEditor();
    await build(engine, [F('Title', [P('body')])]);
    const { text } = copy(engine, 'Title', 1, 'Title', 4);
    expect(text).toBe('itl');
  });

  it('a whole container (no text selection) keeps its structure', async () => {
    const engine = await makeEditor();
    await build(engine, [F('T', [P('a')])]);
    const pb = engine.children[0].serializeForClipboard();
    expect(pb).toMatchObject({ type: 'fieldset', delta: [{ insert: 'T' }], children: [{ type: 'paragraph' }] });
  });

  it('cut across fields: the text blocks are copied, the same text is deleted, the fields stay', async () => {
    const engine = await makeEditor();
    await build(engine, [F('One', [P('aaXX')]), F('Two', [P('YYbb')])]);
    select(engine, 'aaXX', 2, 'YYbb', 2);
    const data = {};
    engine.handleCut({ preventDefault: vi.fn(), clipboardData: { setData: (k, v) => { data[k] = v; } } });
    await settle(engine);
    expect(data['text/plain']).toBe('XX\n\nYY');
    expect(doc(engine)).toBe('F(One){p(aa)} ; F(Two){p(bb)}');
  });
});
