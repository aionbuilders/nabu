// @ts-nocheck
/**
 * Unit tests for `deleteRange` (container.utils.js): THE one "delete the selected range across blocks" used by
 * cut, Backspace / Delete, typing over a selection and paste over a selection.
 *
 * Guarantees under test: valid tree after the normalizers, document order preserved for everything outside the
 * range, head of the start block + tail of the end block merged at the junction, the remaining children of
 * partially-selected containers kept in place, ONE undo step that fully restores.
 *
 * Fixtures are real Loro trees built with the block classes; the range is passed explicitly (no DOM).
 */

import { describe, it, expect, vi } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension } from '$lib/blocks/list/index.js';
import { ToggleExtension } from '$lib/blocks/toggle/index.js';
import { CodeExtension } from '$lib/blocks/code/index.js';
import { deleteRange, handleContainerBeforeInput } from '$lib/blocks/container.utils.js';

async function makeEditor() {
  const engine = new Nabu({ extensions: [ParagraphExtension, ListExtension, ListItemExtension, ToggleExtension, CodeExtension] });
  await engine.commit();
  engine.selection = { anchorBlock: null, focusBlock: null, startBlock: null, endBlock: null, blocks: new Set(), sync: vi.fn(), setCursor: vi.fn() };
  return engine;
}

// ── Fixture DSL ─────────────────────────────────────────────────────────────

const P = (text) => ({ type: 'paragraph', text });
const CODE = (text) => ({ type: 'code', text });
const UL = (...items) => ({ type: 'list', listType: 'bullet', kids: items });
const I = (text, ...subs) => ({ type: 'list-item', text, kids: subs });
const TG = (text, ...kids) => ({ type: 'toggle', text, kids });

function make(engine, spec, parentId = null) {
  const { type, kids = [], ...props } = spec;
  const block = engine.registry.get(type).create(engine, type, props, parentId);
  for (const kid of kids) make(engine, kid, block.node.id.toString());
  return block;
}

/** Builds the document (replacing the initial empty paragraph) and clears the undo history. */
async function build(engine, ...specs) {
  const initial = engine.tree.roots().map((r) => r.id);
  specs.forEach((s) => make(engine, s));
  initial.forEach((id) => engine.tree.delete(id));
  await engine.commit();
  engine.undoManager.clear();
}

const textOf = (node) => node.data.get('text')?.toString() ?? '';

function outline(node) {
  const type = node.data.get('type');
  const kids = (node.children() ?? []).map(outline);
  if (type === 'list') return `ul[${kids.join(', ')}]`;
  if (type === 'list-item') return (textOf(node) || '∅') + (kids.length ? ' > ' + kids.join(' ') : '');
  if (type === 'toggle') return `tg(${textOf(node)})` + (kids.length ? `{${kids.join(' ')}}` : '');
  const short = type === 'paragraph' ? 'p' : type;
  return `${short}(${textOf(node)})` + (kids.length ? `{${kids.join(' ')}}` : '');
}
const doc = (engine) => engine.tree.roots().map(outline).join(' ; ');

function find(engine, text) {
  let found = null;
  const walk = (n) => { if (textOf(n) === text && !found) found = n; (n.children() ?? []).forEach(walk); };
  engine.tree.roots().forEach(walk);
  if (!found) throw new Error('no block with text ' + text);
  return engine.blocks.get(found.id.toString());
}

/** Structural invariants + the Block state matching the tree (what the e2e `violations` helper checks). */
function violations(engine) {
  const out = [];
  const walk = (node, parent) => {
    const type = node.data.get('type');
    const ptype = parent ? parent.data.get('type') : null;
    const kids = node.children() ?? [];
    if (type === 'list-item' && ptype !== 'list') out.push(`list-item under ${ptype}`);
    if (type === 'list' && ptype !== null && ptype !== 'list-item') out.push(`list under ${ptype}`);
    if (type === 'list' && kids.length === 0) out.push('empty list');
    if (type === 'list') kids.forEach((k) => k.data.get('type') !== 'list-item' && out.push('non-item in list'));
    const block = engine.blocks.get(node.id.toString());
    if (!block) out.push(`no Block for ${type}`);
    else if (block.children && block.children.map((c) => c.id).join() !== kids.map((k) => k.id.toString()).join()) out.push(`stale children of ${type}`);
    kids.forEach((k) => walk(k, node));
  };
  engine.tree.roots().forEach((r) => walk(r, null));
  return out;
}

/** Deletes [from@fo, to@to] (texts identify the blocks), commits, returns the junction. */
async function cut(engine, from, fo, to, eo) {
  const startBlock = find(engine, from);
  const endBlock = find(engine, to);
  const junction = deleteRange(engine, { startBlock, startOffset: fo, endBlock, endOffset: eo });
  await engine.commit();
  return junction;
}

/** The case under test: cut, then check validity, then ONE undo restores the original, then redo re-cuts. */
async function check(specs, from, fo, to, eo, expected) {
  const engine = await makeEditor();
  await build(engine, ...specs);
  const original = doc(engine);
  const junction = await cut(engine, from, fo, to, eo);
  expect(doc(engine)).toBe(expected);
  expect(violations(engine)).toEqual([]);
  expect(junction).not.toBeNull();
  engine.undo();
  await engine.commit();
  expect(doc(engine)).toBe(original);
  expect(violations(engine)).toEqual([]);
  engine.redo();
  await engine.commit();
  expect(doc(engine)).toBe(expected);
  return { engine, junction };
}

const NESTED = () => [UL(I('x'), I('a', UL(I('s1'), I('s2'), I('s3'))), I('z'))];

describe('deleteRange', () => {
  describe('inside one block', () => {
    it('removes the range, keeps the rest', async () => {
      await check([P('hello world')], 'hello world', 2, 'hello world', 7, 'p(heorld)');
    });
  });

  describe('flat blocks', () => {
    it('mid p1 -> mid p3: head + tail merged, the middle block destroyed', async () => {
      const { junction } = await check([P('hello world'), P('second'), P('third para')], 'hello world', 3, 'third para', 5, 'p(hel para)');
      expect(junction.offset).toBe(3);
      expect(junction.block.type).toBe('paragraph');
    });

    it('blocks after the range keep their place', async () => {
      await check([P('one'), P('two'), P('three'), P('four')], 'one', 1, 'three', 2, 'p(oree) ; p(four)');
    });
  });

  describe('same root list, nested levels (the corrupting case)', () => {
    it('x@1 -> s2@1: merged "x2", s3 stays before z', async () => {
      await check(NESTED(), 'x', 1, 's2', 1, 'ul[x2, s3, z]');
    });

    it('a@0 -> z@1: sublist gone with its parent, nothing left behind', async () => {
      await check(NESTED(), 'a', 0, 'z', 1, 'ul[x, ∅]');
    });

    it('s1@1 -> s3@1: both ends inside the sublist', async () => {
      await check(NESTED(), 's1', 1, 's3', 1, 'ul[x, a > ul[s3], z]');
    });

    it('x@0 -> z@1: everything but the end of z', async () => {
      await check(NESTED(), 'x', 0, 'z', 1, 'ul[∅]');
    });

    it('x@1 -> s3@2: the whole sublist selected, z stays', async () => {
      await check(NESTED(), 'x', 1, 's3', 2, 'ul[x, z]');
    });
  });

  describe('start block is an ancestor of the end block (selection from a hybrid into its body)', () => {
    it('a@1 -> s2@1: the rest of the body stays under a, in place', async () => {
      await check(NESTED(), 'a', 1, 's2', 1, 'ul[x, a2 > ul[s3], z]');
    });

    it('a@0 -> s3@2: the whole body consumed, an emptied sublist is dropped by the normalizer', async () => {
      await check(NESTED(), 'a', 0, 's3', 2, 'ul[x, ∅, z]');
    });

    it('three levels: the removed middle item hands its remaining children to its place', async () => {
      const spec = [UL(I('top', UL(I('mid', UL(I('c1'), I('c2'), I('c3'))), I('m2'))), I('after'))];
      await check(spec, 'top', 1, 'c2', 1, 'ul[t2 > ul[c3, m2], after]');
    });

    it('toggle header -> a body paragraph: the later body paragraphs stay in the toggle', async () => {
      await check([TG('Head', P('b1'), P('b2'), P('b3')), P('end')], 'Head', 2, 'b2', 1, 'tg(He2){p(b3)} ; p(end)');
    });
  });

  describe('different roots', () => {
    it('paragraph -> item of a root list: the rest of that list follows the merged paragraph', async () => {
      await check([P('abc'), UL(I('a1'), I('b1'), I('c1'))], 'abc', 1, 'b1', 1, 'p(a1) ; ul[c1]');
    });

    it('item of one list -> item of another: the survivors join the first list, in order', async () => {
      await check([UL(I('a'), I('b'), I('c')), P('mid'), UL(I('d'), I('e'), I('f'))], 'b', 0, 'e', 1, 'ul[a, ∅, f]');
    });

    it('list item -> paragraph after the list', async () => {
      await check([UL(I('one'), I('two')), P('para'), P('tail')], 'one', 1, 'para', 2, 'ul[ora] ; p(tail)');
    });

    it('survivors from the end block\'s nested list keep their order', async () => {
      const spec = [UL(I('x')), UL(I('a', UL(I('s1'), I('s2'), I('s3'))), I('z'))];
      await check(spec, 'x', 1, 's1', 1, 'ul[x1, s2, s3, z]');
    });
  });

  describe('end block is a hybrid', () => {
    it('ends in the text of an item that has a sublist: its sublist is adopted by the merged item', async () => {
      await check(NESTED(), 'x', 1, 'a', 0, 'ul[xa > ul[s1, s2, s3], z]');
    });

    it('paragraph -> list item with a sublist: the sublist is promoted after the paragraph', async () => {
      const spec = [P('abc'), UL(I('a', UL(I('s1'))), I('z'))];
      await check(spec, 'abc', 1, 'a', 0, 'p(aa) ; ul[s1, z]');
    });
  });

  describe('toggles', () => {
    it('paragraph -> into the body of an expanded toggle: the toggle goes, its remaining body is promoted', async () => {
      await check([P('para'), TG('Head', P('b1'), P('b2'), P('b3')), P('end')], 'para', 2, 'b2', 1, 'p(pa2) ; p(b3) ; p(end)');
    });

    it('paragraph -> toggle header: the body is promoted after the paragraph', async () => {
      await check([P('para'), TG('Head', P('b1'), P('b2')), P('end')], 'para', 2, 'Head', 2, 'p(paad) ; p(b1) ; p(b2) ; p(end)');
    });

    it('toggle header -> paragraph after the toggle: the body is part of the range', async () => {
      await check([TG('Head', P('b1'), P('b2')), P('end')], 'Head', 2, 'end', 1, 'tg(Hend)');
    });
  });

  describe('Ctrl+A in a mixed document', () => {
    it('everything collapses into one block', async () => {
      const spec = [P('first'), UL(I('a', UL(I('b'))), I('c')), TG('T', P('inner')), CODE('code line')];
      const { engine } = await check(spec, 'first', 0, 'code line', 9, 'p()');
      expect(engine.tree.roots().length).toBe(1);
    });
  });
});

describe('handleContainerBeforeInput over a multi-block selection', () => {
  async function typeOver(specs, from, fo, to, eo, inputType, data, expected) {
    const engine = await makeEditor();
    await build(engine, ...specs);
    const startBlock = find(engine, from);
    const endBlock = find(engine, to);
    engine.selection = {
      ...engine.selection, startBlock, endBlock,
      // what `selectionRange` reads off the blocks
    };
    startBlock.selection = { from: fo, to: 99 };
    endBlock.selection = { from: 0, to: eo };
    const event = { inputType, data, preventDefault: vi.fn() };
    const handled = handleContainerBeforeInput(engine, engine, event);
    expect(handled).toBe(true);
    await engine.commit();
    expect(doc(engine)).toBe(expected);
    expect(violations(engine)).toEqual([]);
    engine.undo();
    await engine.commit();
    return engine;
  }

  it('Backspace over x@1 -> s2@1 keeps s3 before z', async () => {
    const engine = await typeOver(NESTED(), 'x', 1, 's2', 1, 'deleteContentBackward', null, 'ul[x2, s3, z]');
    expect(doc(engine)).toBe('ul[x, a > ul[s1, s2, s3], z]');
  });

  it('typing "X" over the same selection: x + X + 2, s3 before z', async () => {
    await typeOver(NESTED(), 'x', 1, 's2', 1, 'insertText', 'X', 'ul[xX2, s3, z]');
  });

  it('Enter over x@1 -> s2@1 splits at the junction: "2" is a new item, s3 and z follow in order', async () => {
    await typeOver(NESTED(), 'x', 1, 's2', 1, 'insertParagraph', null, 'ul[x, 2, s3, z]');
  });

  it('Enter over a@1 -> s2@1 (start is an ancestor): the new item takes the remaining body with it', async () => {
    await typeOver(NESTED(), 'a', 1, 's2', 1, 'insertParagraph', null, 'ul[x, a, 2 > ul[s3], z]');
  });

  it('word deletion over a range deletes the range', async () => {
    await typeOver([P('hello world'), P('second')], 'hello world', 5, 'second', 3, 'deleteWordBackward', null, 'p(helloond)');
  });
});
