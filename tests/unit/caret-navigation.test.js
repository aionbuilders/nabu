// @ts-nocheck
/**
 * Unit tests for P-34 / P-35 — the caret never rests on a non-text position, and the document always
 * offers a caret after its last block. Real Nabu / NabuSelection over happy-dom nodes (no editor rendered:
 * the block elements are faked). The void block and the foldable container are FICTIONAL types: the
 * mechanism is generic.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { Block } from '#lib/blocks/block.svelte.js';
import { MegaBlock } from '#lib/blocks/megablock.svelte.js';
import { extension } from '#lib/utils/extensions.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';

class VoidBlock extends Block {
  positions = 1;
  static create(nabu, type, props = {}, parentId = null, index = null) {
    const node = nabu.tree.createNode(parentId || undefined, index ?? undefined);
    node.data.set('type', 'void');
    return new VoidBlock(nabu, node);
  }
}
class FoldBlock extends MegaBlock {
  folded = false;
  get hidesChildren() { return this.folded; }
  static create(nabu, type, props = {}, parentId = null, index = null) {
    const node = nabu.tree.createNode(parentId || undefined, index ?? undefined);
    node.data.set('type', 'fold');
    return new FoldBlock(nabu, node);
  }
}
const VoidExtension = extension('void', { block: VoidBlock });
const FoldExtension = extension('fold', { block: FoldBlock });

/**
 * happy-dom's TreeWalker does not descend through non-matching ancestors with SHOW_TEXT (a walker rooted
 * above the block elements finds nothing): swap in a minimal, correct document-order text walker.
 */
function textWalker(root, whatToShow, filter) {
  const accepts = (n) => n.nodeType === 3 && (!filter || (filter.acceptNode ?? filter)(n) === 1);
  const flat = () => { const out = []; (function walk(n) { out.push(n); n.childNodes.forEach(walk); })(root); return out; };
  const step = (dir) => {
    const all = flat();
    for (let i = all.indexOf(walker.currentNode) + dir; i >= 0 && i < all.length; i += dir) {
      if (accepts(all[i])) return (walker.currentNode = all[i]);
    }
    return null;
  };
  const walker = { currentNode: root, nextNode: () => step(1), previousNode: () => step(-1) };
  return walker;
}

const swallow = (e) => e.stopImmediatePropagation();
beforeEach(() => {
  document.addEventListener('selectionchange', swallow, true);
  vi.spyOn(document, 'createTreeWalker').mockImplementation(textWalker);
});
afterEach(() => {
  document.removeEventListener('selectionchange', swallow, true);
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

/** Fake the rendered DOM of the root blocks: `[text]` -> text block, `---` -> inert void. */
function render(engine, spec) {
  const root = document.createElement('div');
  root.setAttribute('data-nabu-root', 'true');
  const texts = [];
  engine.children.forEach((block, i) => {
    const el = document.createElement('div');
    el.setAttribute('data-block-id', block.id);
    if (spec[i] === '---') {
      el.setAttribute('data-nabu-inert', '');
      texts.push(null);
    } else {
      const t = document.createTextNode(spec[i]);
      el.appendChild(t);
      texts.push(t);
    }
    block.element = el;
    root.appendChild(el);
  });
  document.body.appendChild(root);
  return { root, texts };
}
const caret = (node, offset) => window.getSelection().setBaseAndExtent(node, offset, node, offset);
const keydown = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
const types = (engine) => engine.children.map((c) => c.type).join(',');

async function makeEngine(structure, spec) {
  const engine = new Nabu({ extensions: [ParagraphExtension, VoidExtension, FoldExtension] });
  // The engine seeds an empty paragraph in an empty document: only keep the requested blocks.
  for (const c of [...engine.children]) engine.delete(c);
  structure.forEach((type, i) => engine.insert(type, spec[i] === '---' ? {} : { text: spec[i] }));
  await engine.commit();
  const dom = render(engine, spec);
  flushSync();
  return { engine, ...dom };
}

describe('default block', () => {
  it('is declared by an extension (`defaultBlock`), not hard-coded in the engine', () => {
    expect(new Nabu({ extensions: [ParagraphExtension] }).defaultBlockType).toBe('paragraph');
    expect(new Nabu({ extensions: [VoidExtension] }).defaultBlockType).toBeNull();
  });
});

describe('hidesChildren', () => {
  it('findForward / findBackward / lastVisibleBlock never enter a block that hides its children', async () => {
    const engine = new Nabu({ extensions: [ParagraphExtension, FoldExtension] });
    for (const c of [...engine.children]) engine.delete(c);
    const fold = engine.insert('fold', {});
    engine.insert('paragraph', {}, fold.node.id.toString(), 0);
    engine.insert('paragraph', {});
    await engine.commit();
    const [f, after] = engine.children;
    const body = f.children[0];
    const hasText = (b) => b.behaviors.has('text');

    expect(f.findForward(hasText)).toBe(body);
    expect(after.findBackward(hasText)).toBe(body);

    f.folded = true;
    expect(f.findForward(hasText)).toBe(after);
    expect(after.findBackward(hasText)).toBeNull();
    expect(f.findLastDescendant(hasText)).toBeNull();

    f.folded = false;
    engine.delete(after);
    await engine.commit();
    expect(engine.lastVisibleBlock).toBe(body);
    f.folded = true;
    expect(engine.lastVisibleBlock).toBe(f);
  });
});

describe('selection.normalize()', () => {
  it('moves an element caret on the editor root to the nearest text, backward by default', async () => {
    const { engine, texts, root } = await makeEngine(['paragraph', 'void', 'paragraph'], ['above', '---', 'below']);
    caret(root, 1); // between "above" and the void
    expect(engine.selection.sync()).toBe(true);
    expect(engine.selection.normalize()).toBe(true);
    const s = window.getSelection();
    expect(s.anchorNode).toBe(texts[0]);
    expect(s.anchorOffset).toBe(5);
  });

  it('follows the direction of travel (ArrowRight) and skips the void block', async () => {
    const { engine, texts, root } = await makeEngine(['paragraph', 'void', 'paragraph'], ['above', '---', 'below']);
    flushSync();
    caret(texts[0], 5);
    keydown('ArrowRight');
    caret(root, 1); // where the browser parks the caret next to the void
    engine.selection.sync();
    expect(engine.selection.normalize()).toBe(true);
    const s = window.getSelection();
    expect(s.anchorNode).toBe(texts[2]);
    expect(s.anchorOffset).toBe(0);
  });

  it('leaves a caret inside a text block alone', async () => {
    const { engine, texts } = await makeEngine(['paragraph', 'void', 'paragraph'], ['above', '---', 'below']);
    caret(texts[2], 2);
    engine.selection.sync();
    expect(engine.selection.normalize()).toBe(false);
    expect(window.getSelection().anchorOffset).toBe(2);
  });

  it('treats a stray text node that is not inside any block as dead', async () => {
    const { engine, texts, root } = await makeEngine(['paragraph', 'paragraph'], ['one', 'two']);
    const stray = document.createTextNode(' ');
    root.insertBefore(stray, root.children[1]);
    caret(stray, 1);
    engine.selection.sync();
    expect(engine.selection.normalize()).toBe(true);
    expect(window.getSelection().anchorNode).toBe(texts[0]);
  });

  it('ignores positions outside any editor', async () => {
    const { engine } = await makeEngine(['paragraph'], ['one']);
    const outside = document.createElement('p');
    outside.textContent = 'page text';
    document.body.appendChild(outside);
    caret(outside, 0);
    engine.selection.sync();
    expect(engine.selection.normalize()).toBe(false);
  });
});

describe('P-35 · openTrailingCaret()', () => {
  it('creates ONE empty default block after a trailing void block, and does nothing eagerly', async () => {
    const { engine } = await makeEngine(['paragraph', 'void'], ['above', '---']);
    expect(types(engine)).toBe('paragraph,void'); // never created on load
    engine.undoManager.clear();
    const opened = engine.openTrailingCaret();
    await engine.commit();
    const block = await opened;
    expect(types(engine)).toBe('paragraph,void,paragraph');
    expect(block).toBe(engine.children[2]);
    // one undo step
    engine.undo();
    await engine.commit();
    expect(types(engine)).toBe('paragraph,void');
  });

  it('when the document already ends with text, only places the caret there (no new block)', async () => {
    const { engine, texts } = await makeEngine(['paragraph', 'paragraph'], ['one', 'two']);
    const block = await engine.openTrailingCaret();
    expect(types(engine)).toBe('paragraph,paragraph');
    expect(block).toBe(engine.children[1]);
    expect(window.getSelection().anchorNode).toBe(texts[1]);
    expect(window.getSelection().anchorOffset).toBe(3);
  });

  it('does nothing without a default block type', async () => {
    const engine = new Nabu({ extensions: [VoidExtension] });
    engine.insert('void', {});
    await engine.commit();
    expect(await engine.openTrailingCaret()).toBeNull();
    expect(types(engine)).toBe('void');
  });

  it('ArrowRight leaving the document onto a trailing void opens the caret below it', async () => {
    const { engine, texts, root } = await makeEngine(['paragraph', 'void'], ['above', '---']);
    caret(texts[0], 5);
    keydown('ArrowRight');
    caret(root, 2); // the browser parks the caret after the void
    engine.selection.sync();
    engine.selection.normalize();
    await engine.commit();
    await new Promise((r) => setTimeout(r, 0));
    expect(types(engine)).toBe('paragraph,void,paragraph');
  });
});
