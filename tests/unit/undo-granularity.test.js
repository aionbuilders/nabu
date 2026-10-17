// @ts-nocheck
/**
 * Unit tests for P-07 — structural operations are their own undo step.
 * Plain typing keeps merging within the UndoManager's merge window (1 s), but a split,
 * a merge, a block type change, a multi-block deletion, a list indent or a cut must each
 * be undone on their own, and the typing right after them must not merge into them.
 * Real Nabu with a stubbed selection (there is no DOM selection in unit tests).
 */

import { describe, it, expect, vi } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { HeadingExtension } from '$lib/blocks/heading/index.js';
import { ListExtension, ListItemExtension } from '$lib/blocks/list/index.js';
import { List, ListItem } from '$lib/blocks/list/index.js';
import { indentListItem } from '$lib/blocks/list/list-item.svelte.js';
import { BlockExtension } from '$lib/blocks/block.extension.js';

async function makeEditor() {
  const engine = new Nabu({
    extensions: [ParagraphExtension, HeadingExtension, ListExtension, ListItemExtension, BlockExtension],
  });
  await engine.commit();
  const block = engine.children[0];
  engine.selection = { anchorBlock: block, focusBlock: block, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
  // Start from a clean undo history (the initial paragraph creation is not a step to undo).
  engine.undoManager.clear();
  return { engine, block };
}

/** Type `text` at the end of `block` and commit (one keystroke-like transaction). */
async function typed(engine, block, text) {
  block.insert(block.text.length, text);
  await engine.commit();
}

/** Enter at `offset`: the real split path (handleInsertParagraph → onSplit hook). */
async function enter(engine, block, offset) {
  block.ascend('onSplit', null, { offset, delta: block.container.sliceDelta(offset, block.container.length) });
  await engine.commit();
}

const texts = (engine) => engine.tree.roots().map(r => r.data.get('text')?.toString());
const types = (engine) => engine.tree.roots().map(r => r.data.get('type'));

describe('P-07 — structural operations are their own undo step', () => {
  it('plain consecutive typing still merges into a single step', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, 'a');
    await typed(engine, block, 'b');
    await typed(engine, block, 'c');
    expect(texts(engine)).toEqual(['abc']);

    engine.undo();
    expect(texts(engine)).toEqual(['']);
    expect(engine.undoManager.canUndo()).toBe(false);
  });

  it('typing "abc", Enter, "def" → three undo steps (def, the split, abc)', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, 'abc');
    await enter(engine, block, 3);
    expect(texts(engine)).toEqual(['abc', '']);
    await typed(engine, engine.children[1], 'def');
    expect(texts(engine)).toEqual(['abc', 'def']);

    engine.undo();
    expect(texts(engine)).toEqual(['abc', '']);
    engine.undo();
    expect(texts(engine)).toEqual(['abc']);
    engine.undo();
    expect(texts(engine)).toEqual(['']);
  });

  it('splitting mid-text is one step that restores the whole block', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, 'hello world');
    await enter(engine, block, 5);
    expect(texts(engine)).toEqual(['hello', ' world']);

    engine.undo();
    expect(texts(engine)).toEqual(['hello world']);
  });

  it('typing right after a structural op does not merge into it, then merges again', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, 'abc');
    await enter(engine, block, 3);
    const second = engine.children[1];
    await typed(engine, second, 'd');
    await typed(engine, second, 'e');
    await typed(engine, second, 'f');

    engine.undo(); // "def" is a single merged step
    expect(texts(engine)).toEqual(['abc', '']);
    engine.undo(); // the split
    expect(texts(engine)).toEqual(['abc']);
  });

  it('a merge (Backspace at the start of a block) is its own step', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, 'abc');
    await enter(engine, block, 3);
    await typed(engine, engine.children[1], 'def');

    // Backspace at the start of the 2nd block: previous.consume(block); block.destroy(); commit()
    const [first, second] = engine.children;
    first.consume(second);
    second.destroy();
    await first.commit();
    expect(texts(engine)).toEqual(['abcdef']);
    await typed(engine, engine.children[0], '!');
    expect(texts(engine)).toEqual(['abcdef!']);

    engine.undo(); // "!"
    expect(texts(engine)).toEqual(['abcdef']);
    engine.undo(); // the merge
    expect(texts(engine)).toEqual(['abc', 'def']);
    engine.undo(); // "def"
    expect(texts(engine)).toEqual(['abc', '']);
  });

  it('a block:transform action is its own step and the next typing does not merge into it', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, 'title');
    await engine.exec('block:transform', { type: 'heading', props: { level: 2 } });
    expect(types(engine)).toEqual(['heading']);
    await typed(engine, engine.children[0], '!');
    expect(texts(engine)).toEqual(['title!']);

    engine.undo(); // "!"
    expect(texts(engine)).toEqual(['title']);
    expect(types(engine)).toEqual(['heading']);
    engine.undo(); // transform
    expect(types(engine)).toEqual(['paragraph']);
    expect(texts(engine)).toEqual(['title']);
    engine.undo(); // "title"
    expect(texts(engine)).toEqual(['']);
  });

  it('transformTo() (used by markdown shortcuts) is its own step', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, 'abc');
    block.transformTo('heading', { level: 1 });
    await engine.commit();
    expect(types(engine)).toEqual(['heading']);

    engine.undo();
    expect(types(engine)).toEqual(['paragraph']);
    expect(texts(engine)).toEqual(['abc']);
  });

  it('deleting a block (multi-block selection deletion) is its own step', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, 'one');
    await enter(engine, block, 3);
    await typed(engine, engine.children[1], 'two');
    expect(texts(engine)).toEqual(['one', 'two']);

    engine.delete(engine.children[1]);
    await engine.commit();
    expect(texts(engine)).toEqual(['one']);

    engine.undo();
    expect(texts(engine)).toEqual(['one', 'two']);
  });

  it('moving a block (list indent / reorder) is its own step', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, 'one');
    await enter(engine, block, 3);
    await typed(engine, engine.children[1], 'two');

    const [a, b] = engine.children;
    b.node.move(undefined, 0); // reorder: "two" before "one"
    await engine.commit();
    expect(texts(engine)).toEqual(['two', 'one']);

    engine.undo();
    expect(texts(engine)).toEqual(['one', 'two']);
  });

  it('a text-only edit after structure (no tree / type op) is not isolated', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, 'abc');
    await enter(engine, block, 3);
    await typed(engine, engine.children[1], 'x');
    await typed(engine, engine.children[1], 'y'); // merges with "x"
    await typed(engine, engine.children[0], 'z'); // edit in another block: still within the typing step
    expect(texts(engine)).toEqual(['abcz', 'xy']);
    engine.undo();
    expect(texts(engine)).toEqual(['abc', '']);
  });

  it('indenting a list item is its own step', async () => {
    const { engine } = await makeEditor();
    const list = List.create(engine, 'list', { listType: 'bullet' });
    const one = ListItem.create(engine, 'list-item', { text: 'one' }, list.node.id.toString());
    const two = ListItem.create(engine, 'list-item', { text: 'two' }, list.node.id.toString());
    await engine.commit();
    engine.undoManager.clear();
    const depth = (item) => { let d = 0; let n = item.node.parent(); while (n) { d++; n = n.parent(); } return d; };
    expect(depth(engine.blocks.get(two.id))).toBe(depth(engine.blocks.get(one.id)));
    const flat = depth(engine.blocks.get(two.id));

    await typed(engine, engine.blocks.get(two.id), '!'); // typing just before the indent must not absorb it
    // The indent commits twice in one synchronous turn (sublist creation, then the move): one step.
    indentListItem(engine.blocks.get(two.id));
    await engine.commit();
    expect(depth(engine.blocks.get(two.id))).toBeGreaterThan(flat);
    await typed(engine, engine.blocks.get(two.id), '?'); // …and the typing after it is isolated too

    engine.undo(); // "?"
    expect(engine.blocks.get(two.id).text).toBe('two!');
    expect(depth(engine.blocks.get(two.id))).toBeGreaterThan(flat);

    engine.undo(); // the indent only
    expect(depth(engine.blocks.get(two.id))).toBe(flat);
    expect(engine.blocks.get(two.id).text).toBe('two!');
    engine.undo(); // the typing
    expect(list.node.children().map(n => n.data.get('text').toString())).toEqual(['one', 'two']);
  });

  it('a cut is its own step and the next typing does not merge into it', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, 'hello world');

    // Cut " world": a single-block text deletion (no structural op), isolated explicitly by handleCut().
    Object.defineProperty(block, 'selection', { value: { from: 5, to: 11 }, configurable: true });
    engine.selection = {
      anchorBlock: block, focusBlock: block, startBlock: block, endBlock: block,
      isCollapsed: false, sync: vi.fn(), setCursor: vi.fn(),
    };
    vi.spyOn(engine, 'handleCopy').mockImplementation(() => {});
    engine.handleCut({ preventDefault() {} });
    await engine.commit();
    expect(texts(engine)).toEqual(['hello']);

    await typed(engine, engine.children[0], '!');
    expect(texts(engine)).toEqual(['hello!']);

    engine.undo(); // "!"
    expect(texts(engine)).toEqual(['hello']);
    engine.undo(); // the cut
    expect(texts(engine)).toEqual(['hello world']);
  });

  it('paste isolation is untouched: a structural paste is still two isolated steps', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, 'abc');
    engine.selection = { anchorBlock: block, focusBlock: block, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
    Object.defineProperty(block, 'selection', { value: { from: 3, to: 3 }, configurable: true });
    engine.insertFragment({ blocks: [
      { type: 'paragraph', partial: false, delta: [{ insert: 'x' }] },
      { type: 'paragraph', partial: false, delta: [{ insert: 'y' }] },
    ] });
    await engine.commit();
    const afterPaste = texts(engine);
    expect(afterPaste.length).toBeGreaterThan(1);
    await typed(engine, engine.children.at(-1), 'z');

    engine.undo(); // "z"
    expect(texts(engine)).toEqual(afterPaste);
    engine.undo(); // the whole paste
    expect(texts(engine)).toEqual(['abc']);
  });
});
