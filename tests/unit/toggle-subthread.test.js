// @ts-nocheck
/**
 * Unit tests for P-40 — sub-thread rules of the Toggle (header + collapsible body), reusable by any container block:
 *  a) Enter on an EMPTY paragraph that is the LAST child of the body exits the sub-thread (it moves right after the toggle);
 *  b) Backspace at offset 0 of the HEADER turns the toggle into a paragraph, its children follow it (one undo step);
 *  c) Enter in a COLLAPSED header creates the paragraph AFTER the toggle, which stays collapsed;
 *  d) hidden content is never touched: Delete at the end of a collapsed header acts on the next VISIBLE block.
 * Real Nabu with a stubbed selection (there is no DOM selection in unit tests).
 */

import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { HeadingExtension } from '#lib/blocks/heading/index.js';
import { ToggleExtension } from '#lib/blocks/toggle/index.js';
import { RichTextExtension } from '#lib/behaviors/text/index.js';
import { BlockExtension } from '#lib/blocks/block.extension.js';

async function makeEditor() {
  const engine = new Nabu({ extensions: [ParagraphExtension, HeadingExtension, ToggleExtension, RichTextExtension, BlockExtension] });
  await engine.commit();
  engine.selection = { anchorBlock: null, focusBlock: null, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn(), startOffset: 0 };
  return engine;
}

/** Fixture specs: `Tog(text, children, collapsed)`, `P(text)`, `H(text)`. */
const P = (text = '') => ({ type: 'paragraph', text });
const H = (text = '') => ({ type: 'heading', text });
const Tog = (text, children = [], collapsed = false) => ({ type: 'toggle', text, children, collapsed });

/** Replace the document by `specs`, then start from a clean undo history. */
async function build(engine, specs) {
  for (const b of [...engine.children]) engine.delete(b);
  const add = (spec, parentId) => {
    const props = { text: spec.text };
    if (spec.type === 'toggle') props.collapsed = spec.collapsed;
    const b = engine.insert(spec.type, props, parentId);
    for (const c of spec.children ?? []) add(c, b.id);
    return b;
  };
  specs.forEach((s) => add(s, null));
  await engine.commit();
  engine.undoManager.clear();
}

const fmt = (n) => {
  const t = n.data.get('type');
  const txt = n.data.get('text')?.toString() ?? '';
  const kids = (n.children() ?? []).map(fmt).join(' ');
  if (t === 'toggle') return `toggle${n.data.get('collapsed') ? '▸' : '▾'}(${txt})${kids ? `{${kids}}` : ''}`;
  return `${t === 'paragraph' ? 'p' : t}(${txt || '∅'})`;
};
const doc = (engine) => engine.tree.roots().map(fmt).join(' ; ');

/** The live block whose own text is `text` (first match, document order). */
function at(engine, text) {
  const walk = (blocks) => {
    for (const b of blocks) {
      if (b.text === text) return b;
      const found = walk(b.children ?? []);
      if (found) return found;
    }
    return null;
  };
  return walk(engine.children);
}

/** Pin the model caret of a block (no DOM selection in unit tests). */
function pin(engine, block, from, to = from) {
  Object.defineProperty(block.behaviors.get('text'), 'selection', {
    configurable: true,
    get: () => ({ from, to, isCollapsed: from === to }),
  });
  engine.selection.anchorBlock = block;
  engine.selection.focusBlock = block;
  engine.selection.startOffset = from;
}

/** What Nabu#dispatchEventToSelection does for a collapsed caret: the target block's beforeinput. */
function key(block, inputType) {
  const event = { inputType, data: null, preventDefault: vi.fn(), getTargetRanges: () => [] };
  return block.beforeinput(event);
}

async function settle(engine) {
  await engine.commit();
  await tick();
  await new Promise((r) => setTimeout(r, 0));
}

/** Run `fn`, settle, and check that ONE undo step gives back `before`. */
async function expectOneUndo(engine, before) {
  engine.undoManager.undo();
  await settle(engine);
  expect(doc(engine)).toBe(before);
  expect(engine.undoManager.canUndo()).toBe(false);
}

describe('P-40 a) Enter on an EMPTY last body paragraph exits the sub-thread', () => {
  it('moves the paragraph right after the toggle, caret in it, one undo step', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Head', [P('a'), P('')]), P('after')]);
    const before = doc(engine);
    const empty = engine.children[0].children[1];
    pin(engine, empty, 0);
    key(empty, 'insertParagraph');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▾(Head){p(a)} ; p(∅) ; p(after)');
    expect(engine.selection.setCursor).toHaveBeenCalled();
    const [target, offset] = engine.selection.setCursor.mock.calls.at(-1);
    expect(target.id).toBe(empty.id);
    expect(offset).toBe(0);
    expect(target.parent).toBe(null);
    await expectOneUndo(engine, before);
  });

  it('the only child: the toggle keeps an empty body, and Enter in the header recreates a first child', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Head', [P('')])]);
    const empty = engine.children[0].children[0];
    pin(engine, empty, 0);
    key(empty, 'insertParagraph');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▾(Head) ; p(∅)');
    const toggle = engine.children[0];
    pin(engine, toggle, 4);
    key(toggle, 'insertParagraph');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▾(Head){p(∅)} ; p(∅)');
  });

  it('an empty paragraph that is NOT the last child still just adds a paragraph', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Head', [P(''), P('b')])]);
    const empty = engine.children[0].children[0];
    pin(engine, empty, 0);
    key(empty, 'insertParagraph');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▾(Head){p(∅) p(∅) p(b)}');
  });

  it('a NON-empty last paragraph splits normally inside the body', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Head', [P('ab')])]);
    const last = engine.children[0].children[0];
    pin(engine, last, 1);
    key(last, 'insertParagraph');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▾(Head){p(a) p(b)}');
  });

  it('other block types keep their own Enter (an empty last heading is not an exit)', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Head', [H('')])]);
    const h = engine.children[0].children[0];
    pin(engine, h, 0);
    key(h, 'insertParagraph');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▾(Head){heading(∅) p(∅)}');
  });

  it('a nested toggle: the exit goes to the OUTER body, right after the inner toggle', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Outer', [Tog('Inner', [P('x'), P('')]), P('y')])]);
    const empty = engine.children[0].children[0].children[1];
    pin(engine, empty, 0);
    key(empty, 'insertParagraph');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▾(Outer){toggle▾(Inner){p(x)} p(∅) p(y)}');
  });
});

describe('P-40 b) Backspace at offset 0 of the header turns the toggle into a paragraph', () => {
  it('header text kept, children follow it in order, one undo step (previous block present)', async () => {
    const engine = await makeEditor();
    await build(engine, [P('before'), Tog('Head', [P('a'), P('b')]), P('after')]);
    const before = doc(engine);
    const toggle = engine.children[1];
    pin(engine, toggle, 0);
    expect(key(toggle, 'deleteContentBackward')).toBe(true);
    await settle(engine);
    expect(doc(engine)).toBe('p(before) ; p(Head) ; p(a) ; p(b) ; p(after)');
    await expectOneUndo(engine, before);
  });

  it('first block of the document: same result (no more no-op)', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Head', [P('a')])]);
    const before = doc(engine);
    const toggle = engine.children[0];
    pin(engine, toggle, 0);
    key(toggle, 'deleteContentBackward');
    await settle(engine);
    expect(doc(engine)).toBe('p(Head) ; p(a)');
    await expectOneUndo(engine, before);
  });

  it('empty header with a body, and empty header without a body', async () => {
    const engine = await makeEditor();
    await build(engine, [P('before'), Tog('', [P('a')])]);
    let toggle = engine.children[1];
    pin(engine, toggle, 0);
    key(toggle, 'deleteContentBackward');
    await settle(engine);
    expect(doc(engine)).toBe('p(before) ; p(∅) ; p(a)');

    await build(engine, [P('before'), Tog('', [])]);
    toggle = engine.children[1];
    pin(engine, toggle, 0);
    key(toggle, 'deleteContentBackward');
    await settle(engine);
    expect(doc(engine)).toBe('p(before) ; p(∅)');
  });

  it('a COLLAPSED toggle: the hidden children come out right after the paragraph, nothing lost', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Head', [P('a'), P('b')], true), P('after')]);
    const toggle = engine.children[0];
    pin(engine, toggle, 0);
    key(toggle, 'deleteContentBackward');
    await settle(engine);
    expect(doc(engine)).toBe('p(Head) ; p(a) ; p(b) ; p(after)');
    expect(engine.children[0].node.data.get('collapsed')).toBeUndefined();
  });

  it('a toggle nested in a toggle: it dissolves inside the OUTER body', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Outer', [P('x'), Tog('Inner', [P('a')]), P('y')])]);
    const inner = engine.children[0].children[1];
    pin(engine, inner, 0);
    key(inner, 'deleteContentBackward');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▾(Outer){p(x) p(Inner) p(a) p(y)}');
  });

  it('inside the header (offset > 0) Backspace is a plain character deletion', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Head', [P('a')])]);
    const toggle = engine.children[0];
    pin(engine, toggle, 2);
    key(toggle, 'deleteContentBackward');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▾(Had){p(a)}');
  });
});

describe('P-40 c) Enter in a COLLAPSED header', () => {
  it('at the end: a new paragraph AFTER the toggle (caret in it), the toggle stays collapsed, one undo step', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Head', [P('body')], true), P('after')]);
    const before = doc(engine);
    const toggle = engine.children[0];
    pin(engine, toggle, 4);
    key(toggle, 'insertParagraph');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▸(Head){p(body)} ; p(∅) ; p(after)');
    const [target, offset] = engine.selection.setCursor.mock.calls.at(-1);
    expect(target.id).toBe(engine.children[1].id);
    expect(offset).toBe(0);
    await expectOneUndo(engine, before);
  });

  it('in the middle: the header is split, the tail goes into the new paragraph after the toggle', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Head', [P('body')], true)]);
    const toggle = engine.children[0];
    pin(engine, toggle, 2);
    key(toggle, 'insertParagraph');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▸(He){p(body)} ; p(ad)');
  });

  it('an EXPANDED toggle is unchanged: the tail is the first body child', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Head', [P('body')])]);
    const toggle = engine.children[0];
    pin(engine, toggle, 2);
    key(toggle, 'insertParagraph');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▾(He){p(ad) p(body)}');
  });

  it('a collapsed toggle without a body works the same', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Head', [], true)]);
    const toggle = engine.children[0];
    pin(engine, toggle, 4);
    key(toggle, 'insertParagraph');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▸(Head) ; p(∅)');
  });
});

describe('P-40 d) hidden content is never touched', () => {
  it('Delete at the end of a collapsed header merges the next VISIBLE block, not the hidden child; one undo step', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Head', [P('hidden')], true), P('next')]);
    const before = doc(engine);
    const toggle = engine.children[0];
    pin(engine, toggle, 4);
    key(toggle, 'deleteContentForward');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▸(Headnext){p(hidden)}');
    await expectOneUndo(engine, before);
  });

  it('Delete at the end of a collapsed header with nothing after: no-op, hidden child kept', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Head', [P('hidden')], true)]);
    const toggle = engine.children[0];
    pin(engine, toggle, 4);
    key(toggle, 'deleteContentForward');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▸(Head){p(hidden)}');
  });

  it('the children of the merged next block do not vanish into the hidden body: they stay visible, after the toggle', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Head', [P('hidden')], true), Tog('Next', [P('c1')])]);
    const toggle = engine.children[0];
    pin(engine, toggle, 4);
    key(toggle, 'deleteContentForward');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▸(HeadNext){p(hidden)} ; p(c1)');
  });

  it('Backspace at offset 0 of the block right after a collapsed toggle merges into the header, not the hidden child', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Head', [P('hidden')], true), P('next')]);
    const next = engine.children[1];
    pin(engine, next, 0);
    key(next, 'deleteContentBackward');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▸(Headnext){p(hidden)}');
  });

  it('an EXPANDED toggle is unchanged: Delete at the end of the header merges its first child', async () => {
    const engine = await makeEditor();
    await build(engine, [Tog('Head', [P('a'), P('b')])]);
    const toggle = engine.children[0];
    pin(engine, toggle, 4);
    key(toggle, 'deleteContentForward');
    await settle(engine);
    expect(doc(engine)).toBe('toggle▾(Heada){p(b)}');
  });
});
