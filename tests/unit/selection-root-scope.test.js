// @ts-nocheck
/**
 * Several editors on one page: the DOM selection is page-wide, an engine only acts on the selection of ITS OWN root
 * (NabuSelection#scope: 'mine' | 'outside' | 'foreign'). Real Nabu / NabuSelection over happy-dom nodes (no editor rendered: the
 * block elements are faked, as in selection-sync.test.js).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { DividerExtension } from '#lib/blocks/divider/index.js';
import { captureSelection } from '#lib/blocks/undo-selection.js';
import { closestWithin } from '#lib/utils/dom-scope.js';

/** An engine with its faked DOM: a root holding one div per root block, with a text node. `parent` hosts the root (default: body). */
async function make(texts, { parent = document.body, attach = true, extensions = [ParagraphExtension] } = {}) {
  const engine = new Nabu({ extensions });
  for (const c of [...engine.children]) engine.delete(c); // the engine seeds an empty paragraph in an empty document
  for (const _ of texts) engine.insert('paragraph', {});
  await engine.commit();
  const root = document.createElement('div');
  root.setAttribute('data-nabu-root', 'true');
  const nodes = [];
  engine.children.forEach((block, i) => {
    const el = document.createElement('div');
    el.setAttribute('data-block-id', block.id);
    const t = document.createTextNode(texts[i]);
    el.appendChild(t);
    block.element = el;
    root.appendChild(el);
    nodes.push(t);
  });
  parent.appendChild(root);
  const detach = attach ? engine.selection.attachRoot(root) : () => {};
  flushSync();
  return { engine, root, nodes, blocks: [...engine.children], detach };
}

const caret = (node, offset) => window.getSelection().setBaseAndExtent(node, offset, node, offset);
// happy-dom reports the focus of a range across two trees as its anchor: a range across roots is stubbed as the browser reports it.
const cross = (a, ao, f, fo) => vi.spyOn(window, 'getSelection').mockReturnValue(/** @type {any} */ ({
  rangeCount: 1, anchorNode: a, anchorOffset: ao, focusNode: f, focusOffset: fo, isCollapsed: false, type: 'Range', direction: 'forward',
  getRangeAt: () => ({ startContainer: a, startOffset: ao, endContainer: f, endOffset: fo, toString: () => '', cloneContents: () => document.createDocumentFragment() }),
}));

// happy-dom dispatches `selectionchange` synchronously, browsers queue it as a task: swallow it, the tests call sync() themselves.
const swallow = (e) => e.stopImmediatePropagation();
beforeEach(() => document.addEventListener('selectionchange', swallow, true));

afterEach(() => { vi.restoreAllMocks(); document.removeEventListener('selectionchange', swallow, true); window.getSelection().removeAllRanges(); document.body.innerHTML = ''; });

describe('the engine knows its root', () => {
  it('attachRoot sets it, the returned function clears it (only if it is still the same element)', async () => {
    const { engine, root, detach } = await make(['x']);
    expect(engine.selection.root).toBe(root);
    expect(engine.internals.selection.root).toBe(root);
    const other = document.createElement('div');
    const detachOther = engine.selection.attachRoot(other); // a remount sets the next root first ...
    detach(); // ... then the old one is torn down: the new root stays
    expect(engine.selection.root).toBe(other);
    detachOther();
    expect(engine.selection.root).toBeNull();
  });

  it('without a root, nothing is mine', async () => {
    const { engine, nodes } = await make(['x'], { attach: false });
    expect(engine.selection.owns(nodes[0])).toBe(false);
    caret(nodes[0], 0);
    expect(engine.selection.scope()).toBe('foreign'); // it is inside a [data-nabu-root], but not mine
    expect(engine.selection.sync()).toBe(false);
    expect(engine.selection.anchorBlock).toBeNull();
  });
});

describe('kindOf / owns / scope', () => {
  it('mine, foreign, none', async () => {
    const a = await make(['alpha']);
    const b = await make(['bravo']);
    const page = document.createElement('p');
    page.textContent = 'page text';
    document.body.appendChild(page);
    expect(a.engine.selection.kindOf(a.nodes[0])).toBe('mine');
    expect(a.engine.selection.kindOf(a.root)).toBe('mine');
    expect(a.engine.selection.kindOf(b.nodes[0])).toBe('foreign');
    expect(b.engine.selection.kindOf(a.nodes[0])).toBe('foreign');
    expect(a.engine.selection.kindOf(page.firstChild)).toBe('none');
    expect(a.engine.selection.kindOf(null)).toBe('none');
  });

  it('the scope of a selection: mine / outside / foreign (a range across roots is foreign for both)', async () => {
    const a = await make(['alpha']);
    const b = await make(['bravo']);
    const page = document.createElement('p');
    page.textContent = 'page text';
    document.body.appendChild(page);

    caret(a.nodes[0], 2);
    expect(a.engine.selection.scope()).toBe('mine');
    expect(b.engine.selection.scope()).toBe('foreign');

    caret(page.firstChild, 2);
    expect(a.engine.selection.scope()).toBe('outside');
    expect(b.engine.selection.scope()).toBe('outside');

    cross(a.nodes[0], 1, page.firstChild, 3); // from my text out into the page: still mine
    expect(a.engine.selection.scope()).toBe('mine');
    expect(b.engine.selection.scope()).toBe('foreign'); // an end of it is in A's root
    vi.restoreAllMocks();

    cross(a.nodes[0], 1, b.nodes[0], 3); // across roots
    expect(a.engine.selection.scope()).toBe('foreign');
    expect(b.engine.selection.scope()).toBe('foreign');

    vi.restoreAllMocks();
    window.getSelection().removeAllRanges();
    expect(a.engine.selection.scope()).toBe('outside');
  });

  it('a nested editor (in a UI island of another) is not mine for the outer one, and the outer is not for the nested', async () => {
    const outer = await make(['outer']);
    const island = document.createElement('div');
    island.setAttribute('data-nabu-ui', '');
    outer.root.appendChild(island);
    const inner = await make(['inner'], { parent: island });
    expect(outer.engine.selection.kindOf(inner.nodes[0])).toBe('foreign');
    expect(inner.engine.selection.kindOf(inner.nodes[0])).toBe('mine');
    expect(inner.engine.selection.kindOf(outer.nodes[0])).toBe('foreign');
    caret(inner.nodes[0], 1);
    expect(outer.engine.selection.scope()).toBe('foreign');
    expect(inner.engine.selection.scope()).toBe('mine');
    // the island AROUND the nested editor is not a marker of its content ...
    expect(inner.engine.selection.closestOwn(inner.nodes[0], '[data-nabu-ui]')).toBeNull();
    // ... it is one of the outer editor's
    expect(outer.engine.selection.closestOwn(island, '[data-nabu-ui]')).toBe(island);
  });

  it('closestWithin: the nearest match must lie inside the root', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-nabu-ui', '');
    const root = document.createElement('div');
    const child = document.createElement('span');
    root.appendChild(child);
    wrapper.appendChild(root);
    expect(closestWithin(child, '[data-nabu-ui]', root)).toBeNull();
    expect(closestWithin(child, '[data-nabu-ui]', wrapper)).toBe(wrapper);
    expect(closestWithin(child, 'span', root)).toBe(child);
    expect(closestWithin(child, 'span', null)).toBeNull();
  });
});

describe('the model only mirrors a selection that is mine', () => {
  it('a selection in another editor reads as "no selection of mine"; mine comes back with the caret', async () => {
    const a = await make(['alpha']);
    const b = await make(['bravo']);
    caret(a.nodes[0], 3);
    expect(a.engine.selection.sync()).toBe(true);
    expect(b.engine.selection.sync()).toBe(false); // nothing to mirror, and it was already empty
    expect(a.engine.selection.anchorBlock).toBe(a.blocks[0]);
    expect(b.engine.selection.anchorBlock).toBeNull();

    caret(b.nodes[0], 2);
    expect(a.engine.selection.sync()).toBe(true); // A's mirror is cleared
    expect(b.engine.selection.sync()).toBe(true);
    expect(a.engine.selection.anchorBlock).toBeNull();
    expect(a.engine.selection.is).toBe(false);
    expect(b.engine.selection.anchorBlock).toBe(b.blocks[0]);
    expect(b.engine.selection.anchorOffset).toBe(2);
    expect(a.engine.selection.sync()).toBe(false); // idempotent
  });

  it('a range across two roots is mirrored by neither', async () => {
    const a = await make(['alpha']);
    const b = await make(['bravo']);
    cross(a.nodes[0], 1, b.nodes[0], 2);
    a.engine.selection.sync();
    b.engine.selection.sync();
    expect(a.engine.selection.anchorBlock).toBeNull();
    expect(b.engine.selection.anchorBlock).toBeNull();
    expect(a.engine.selection.isCollapsed).toBe(true);
    expect(a.engine.selection.isRange).toBe(false);
  });
});

describe('an engine never rewrites a selection that is not its own', () => {
  /** An element caret on a root: a "dead" position for the engine that owns that root. */
  const deadCaret = (root) => {
    // a stray text node after the first block: not part of any block's text, so a dead position
    const stray = document.createTextNode(' ');
    root.insertBefore(stray, root.children[1] ?? null);
    caret(stray, 1);
    return stray;
  };

  it('normalize(): only the owner moves a dead caret', async () => {
    const a = await make(['alpha']);
    const b = await make(['bravo']);
    const dead = deadCaret(b.root);
    expect(a.engine.selection.normalize()).toBe(false);
    expect(a.engine.selection.placements).toBe(0);
    expect(window.getSelection().anchorNode).toBe(dead); // untouched
    // it IS the owner's business (what it does with it is covered by caret-navigation.test.js; happy-dom's TreeWalker cannot walk back here)
    expect(b.engine.selection.scope()).toBe('mine');
  });

  it('normalize(): a range across two roots is left alone by both', async () => {
    const a = await make(['alpha', 'alto']);
    const b = await make(['bravo']);
    cross(a.root, 1, b.nodes[0], 2); // the anchor is a dead position of A
    expect(a.engine.selection.normalize()).toBe(false);
    expect(b.engine.selection.normalize()).toBe(false);
    expect(window.getSelection().anchorNode).toBe(a.root);
    expect(window.getSelection().focusNode).toBe(b.nodes[0]);
    expect(a.engine.selection.placements + b.engine.selection.placements).toBe(0);
  });

  it('normalize(): a caret in the page, outside every editor, is none of their business', async () => {
    const a = await make(['alpha']);
    const page = document.createElement('p');
    page.textContent = 'page text';
    document.body.appendChild(page);
    caret(page.firstChild, 2);
    expect(a.engine.selection.normalize()).toBe(false);
    expect(window.getSelection().anchorNode).toBe(page.firstChild);
  });

  it('repairAfterRemoval(): ignores a dead caret in another editor, repairs its own', async () => {
    const a = await make(['alpha']);
    const b = await make(['bravo']);
    const dead = deadCaret(b.root);
    expect(a.engine.selection.repairAfterRemoval()).toBe(false);
    expect(window.getSelection().anchorNode).toBe(dead);
    expect(b.engine.selection.scope()).toBe('mine');
  });

  it('scheduleRepair(): the deferred check is scoped as well', async () => {
    const a = await make(['alpha']);
    const b = await make(['bravo']);
    const dead = deadCaret(b.root);
    a.engine.selection.scheduleRepair();
    await new Promise((r) => setTimeout(r, 10));
    expect(window.getSelection().anchorNode).toBe(dead);
  });

  it('the document-level key listeners of A do nothing while the selection is in B', async () => {
    const a = await make(['alpha']);
    const b = await make(['bravo']);
    const dead = deadCaret(b.root);
    await Promise.resolve(); // the engines' effects have started their listeners
    await new Promise((r) => setTimeout(r, 0));
    a.engine.storedMarks = { bold: true };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    expect(a.engine.selection.placements).toBe(0);
    expect(a.engine.storedMarks).toEqual({ bold: true }); // an arrow of B's does not clear A's stored marks
    expect(window.getSelection().anchorNode).toBe(dead);
  });

  it('a nested editor: the outer engine leaves the caret of the nested one alone, and the nested one is not blocked by the outer UI island', async () => {
    const outer = await make(['outer']);
    const island = document.createElement('div');
    island.setAttribute('data-nabu-ui', '');
    outer.root.appendChild(island);
    const inner = await make(['inner'], { parent: island });
    const dead = deadCaret(inner.root);
    expect(outer.engine.selection.normalize()).toBe(false);
    expect(window.getSelection().anchorNode).toBe(dead);
    // the island around the nested root would make a naive `closest('[data-nabu-ui]')` skip the nested editor's own repair
    expect(inner.engine.selection.scope()).toBe('mine');
    expect(inner.engine.selection.closestOwn(dead, '[data-nabu-ui]')).toBeNull();
  });

  it('an inert block ABOVE the nested editor does not make its text dead', async () => {
    const outer = await make(['outer'], { extensions: [ParagraphExtension, DividerExtension] });
    const inertHost = document.createElement('div');
    inertHost.setAttribute('data-nabu-inert', '');
    outer.root.appendChild(inertHost);
    const inner = await make(['inner'], { parent: inertHost });
    caret(inner.nodes[0], 2);
    expect(inner.engine.selection.normalize()).toBe(false); // a valid text position: nothing to correct
    expect(window.getSelection().anchorNode).toBe(inner.nodes[0]);
  });
});

describe('the undo selection is recorded for the selection of this editor only', () => {
  it('captureSelection / captureUndoSelection ignore a selection in another editor', async () => {
    const a = await make(['alpha']);
    const b = await make(['bravo']);
    caret(b.nodes[0], 2);
    expect(captureSelection(a.engine)).toBeNull();
    expect(captureSelection(b.engine)).not.toBeNull();
    // a recorded selection of A is not replaced by B's caret
    caret(a.nodes[0], 1);
    a.engine.captureUndoSelection();
    const before = a.engine.internals.undoManager; // (reference only: the snapshot is private) — the capture below must not throw nor change A
    caret(b.nodes[0], 2);
    a.engine.captureUndoSelection();
    expect(a.engine.internals.undoManager).toBe(before);
    cross(a.nodes[0], 1, b.nodes[0], 2); // across roots
    expect(captureSelection(a.engine)).toBeNull();
    expect(captureSelection(b.engine)).toBeNull();
  });
});

describe('onBeforeInput hooks (finding: they run twice per keystroke when no hook answers)', () => {
  it('a hook that answers nothing is called by dispatchEventToSelection AND by TextBehavior#handleBeforeInput', async () => {
    const seen = [];
    const probe = { name: 'probe', hooks: { onBeforeInput: (nabu, event, block) => { seen.push(block.id); } } };
    const a = await make(['alpha'], { extensions: [ParagraphExtension, probe] });
    caret(a.nodes[0], 5);
    a.engine.selection.sync();
    const event = { inputType: 'insertText', data: 'x', preventDefault() {} };
    a.engine.handleBeforeinput(event);
    // once per layer: the global dispatch, then the block's own behavior
    expect(seen).toEqual([a.blocks[0].id, a.blocks[0].id]);
    await a.engine.commit();
  });
});
