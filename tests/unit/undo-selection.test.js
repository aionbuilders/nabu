// @ts-nocheck
/**
 * Unit tests for ADR 015 — undo / redo restore the SELECTION with Loro stable cursors.
 * Loro level: a UndoManager configured like the Nabu one stores the captured endpoints with each step, and the endpoints are
 * resolved after the undo, including after a (simulated) remote edit synced from a second document.
 * Nabu level: a block recreated by an undo (new id, new text container) is found again by its tree path.
 */

import { describe, it, expect, vi } from 'vitest';
import { LoroDoc, UndoManager } from 'loro-crdt';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { BlockExtension } from '#lib/blocks/block.extension.js';
import { makeEndpoint, resolveOffset, restoreSelection } from '#lib/blocks/undo-selection.js';

/** A text-block stand-in: all makeEndpoint() needs from a Block. */
const fakeBlock = (text, id = 'b1') => ({ id, parent: null, index: 0, behaviors: new Map([['text', { container: text }]]) });

/** A document with one text, an UndoManager that stores `pending.pre` with undo steps and `pending.post` with redo steps. */
function setup(initial) {
  const doc = new LoroDoc();
  doc.setPeerId(1);
  const text = doc.getText('t');
  text.insert(0, initial);
  doc.commit();
  const pending = { pre: null, post: null };
  const popped = [];
  const um = new UndoManager(doc, {
    mergeInterval: 0,
    onPush: (isUndo) => ({ value: isUndo ? pending.pre : pending.post, cursors: [] }),
    onPop: (_isUndo, stored) => popped.push(stored.value),
  });
  um.clear();
  const block = fakeBlock(text);
  const ep = (offset, role = 'end') => makeEndpoint(block, offset, role);
  /** Offsets the popped step's selection stands at now. */
  const lastRange = () => {
    const v = popped.at(-1);
    const len = text.length;
    return [resolveOffset(doc, v.anchor, len), resolveOffset(doc, v.focus, len)];
  };
  return { doc, text, um, pending, ep, lastRange, popped };
}
const sel = (a, f = a) => ({ anchor: a, focus: f });

describe('selection captured before a change comes back after undo', () => {
  it('bold on "important": undo gives the same range back', () => {
    const { doc, text, um, pending, ep, lastRange } = setup('hello important world');
    pending.pre = sel(ep(6, 'start'), ep(15, 'end'));
    text.mark({ start: 6, end: 15 }, 'bold', true);
    doc.commit();
    um.undo();
    expect(lastRange()).toEqual([6, 15]);
    expect(text.toString().slice(6, 15)).toBe('important');
  });

  it('deleting the selection: undo selects the re-inserted text again (the start neighbour is alive, the start char is not)', () => {
    const { doc, text, um, pending, ep, lastRange } = setup('hello important world');
    pending.pre = sel(ep(6, 'start'), ep(15, 'end'));
    text.delete(6, 9);
    doc.commit();
    um.undo();
    expect(text.toString()).toBe('hello important world');
    expect(lastRange()).toEqual([6, 15]);
  });

  it('a backward selection keeps its direction (anchor after focus)', () => {
    const { doc, text, um, pending, ep, lastRange } = setup('hello important world');
    pending.pre = sel(ep(15, 'end'), ep(6, 'start')); // anchor = the end, focus = the start
    text.delete(6, 9);
    doc.commit();
    um.undo();
    expect(lastRange()).toEqual([15, 6]);
  });

  it('typing: the caret goes back where typing started; redo puts it at the end of the retyped text', () => {
    const { doc, text, um, pending, ep, lastRange } = setup('hello world');
    pending.pre = sel(ep(6));
    text.insert(6, 'bonjour ');
    doc.commit();
    pending.post = sel(ep(14)); // what the editor captures once the action is rendered
    um.undo();
    expect(text.toString()).toBe('hello world');
    expect(lastRange()).toEqual([6, 6]);
    um.redo();
    expect(text.toString()).toBe('hello bonjour world');
    expect(lastRange()).toEqual([14, 14]);
  });

  it('P-111 typing over a multi-block range (the typed character AND the merged tail are new characters): redo puts the caret right after the typed character', () => {
    const { doc, text, um, pending, ep, lastRange } = setup('alpha gamma');
    pending.pre = sel(ep(2, 'start'), ep(9, 'end'));
    text.delete(2, 9); // the range, ...
    text.insert(2, 'Xma'); // ... the typed character, and the tail of the last block re-inserted by the merge: all new characters
    doc.commit();
    pending.post = sel(ep(3)); // "alX|ma", captured once the action is rendered
    um.undo();
    expect(text.toString()).toBe('alpha gamma');
    um.redo();
    expect(text.toString()).toBe('alXma');
    expect(lastRange()).toEqual([3, 3]); // both cursors are dead: the stored offset, as the text has the length it had
  });

  it('the stored offset is only trusted when the text kept its length (both cursors dead after a REMOTE deletion: the tombstones)', () => {
    const { doc, text, ep } = setup('hello important world');
    const e = ep(8); // inside "important"
    text.delete(3, 15); // everything around it is gone, whatever the length
    doc.commit();
    const at = resolveOffset(doc, e, text.length);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThanOrEqual(text.length);
    expect(resolveOffset(doc, { ...e, length: text.length }, text.length)).toBe(Math.min(8, text.length)); // same length: the stored offset
  });

  it('Backspace and Delete: the caret returns to where it was, whichever neighbour the key deleted', () => {
    const back = setup('abcdef');
    back.pending.pre = sel(back.ep(3));
    back.text.delete(2, 1); // Backspace at 3
    back.doc.commit();
    back.um.undo();
    expect(back.lastRange()).toEqual([3, 3]);

    const fwd = setup('abcdef');
    fwd.pending.pre = sel(fwd.ep(3));
    fwd.text.delete(3, 1); // Delete at 3
    fwd.doc.commit();
    fwd.um.undo();
    expect(fwd.text.toString()).toBe('abcdef');
    expect(fwd.lastRange()).toEqual([3, 3]);
  });

  it('a caret at the very start / end of the text', () => {
    const { doc, text, um, pending, ep, lastRange } = setup('hello');
    pending.pre = sel(ep(5));
    text.insert(5, ' world');
    doc.commit();
    um.undo();
    expect(lastRange()).toEqual([5, 5]);

    pending.pre = sel(ep(0));
    text.insert(0, '>> ');
    doc.commit();
    um.undo();
    expect(lastRange()).toEqual([0, 0]);
  });
});

describe('collaborative: a remote edit shifts the stored selection', () => {
  /** Two peers on the same text; `sync(from, to)` ships what `to` is missing. */
  function twoPeers(initial) {
    const a = setup(initial);
    const b = new LoroDoc();
    b.setPeerId(2);
    b.import(a.doc.export({ mode: 'snapshot' }));
    const sync = (from, to) => to.import(from.export({ mode: 'update', from: to.version() }));
    return { a, b, bText: b.getText('t'), sync };
  }

  it('B inserts text before "important"; A undoes its bold: exactly "important" is selected (shifted)', () => {
    const { a, b, bText, sync } = twoPeers('hello important world');
    a.pending.pre = sel(a.ep(6, 'start'), a.ep(15, 'end'));
    a.text.mark({ start: 6, end: 15 }, 'bold', true);
    a.doc.commit();

    bText.insert(0, 'Well, ');
    b.commit();
    sync(b, a.doc);
    expect(a.text.toString()).toBe('Well, hello important world');

    a.um.undo();
    const [from, to] = a.lastRange();
    expect(a.text.toString().slice(from, to)).toBe('important');
    expect(a.text.toDelta().some((op) => op.attributes?.bold)).toBe(false); // only A's own change was undone
  });

  it('B inserts text right inside the selected word: the range stretches over it', () => {
    const { a, b, bText, sync } = twoPeers('hello important world');
    a.pending.pre = sel(a.ep(6, 'start'), a.ep(15, 'end'));
    a.text.mark({ start: 6, end: 15 }, 'bold', true);
    a.doc.commit();
    bText.insert(10, '!!');
    b.commit();
    sync(b, a.doc);
    a.um.undo();
    const [from, to] = a.lastRange();
    expect(a.text.toString().slice(from, to)).toBe('impo!!rtant');
  });

  it('B deletes the selected text: A gets a collapsed caret where it was', () => {
    const { a, b, bText, sync } = twoPeers('hello important world');
    a.pending.pre = sel(a.ep(6, 'start'), a.ep(15, 'end'));
    a.text.mark({ start: 6, end: 15 }, 'bold', true);
    a.doc.commit();
    bText.delete(6, 9);
    b.commit();
    sync(b, a.doc);
    expect(a.text.toString()).toBe('hello  world');
    a.um.undo();
    const [from, to] = a.lastRange();
    expect(from).toBe(to);
    expect(from).toBe(6);
  });

  it('B deletes the selection AND both neighbours: still a collapsed, in-range caret', () => {
    const { a, b, bText, sync } = twoPeers('hello important world');
    a.pending.pre = sel(a.ep(6, 'start'), a.ep(15, 'end'));
    a.text.mark({ start: 6, end: 15 }, 'bold', true);
    a.doc.commit();
    bText.delete(5, 11); // " important "
    b.commit();
    sync(b, a.doc);
    expect(a.text.toString()).toBe('helloworld');
    a.um.undo();
    const [from, to] = a.lastRange();
    expect(from).toBe(to);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(from).toBeLessThanOrEqual(a.text.length);
  });

  it('A undoes its own deletion while B typed before it: the re-inserted text is selected at its shifted place', () => {
    const { a, b, bText, sync } = twoPeers('hello important world');
    a.pending.pre = sel(a.ep(6, 'start'), a.ep(15, 'end'));
    a.text.delete(6, 9);
    a.doc.commit();
    bText.insert(0, '>> ');
    b.commit();
    sync(b, a.doc);
    a.um.undo();
    expect(a.text.toString()).toBe('>> hello important world');
    const [from, to] = a.lastRange();
    expect(a.text.toString().slice(from, to)).toBe('important');
  });
});

describe('Nabu level — a block recreated by the undo is found again by its tree path', () => {
  it('cursors on the old text container are ignored; the stored path + offset place the selection', async () => {
    const engine = new Nabu({ extensions: [ParagraphExtension, BlockExtension] });
    await engine.commit();
    const first = engine.children[0];
    first.insert(0, 'hello');
    engine.insert('paragraph', { text: 'world' }, null, 1);
    await engine.commit();
    engine.undoManager.clear();

    const second = engine.children[1];
    const oldId = second.id;
    const snap = { anchor: makeEndpoint(first, 2, 'start'), focus: makeEndpoint(second, 3, 'end') };
    engine.delete(second);
    await engine.commit();
    expect(engine.children.length).toBe(1);
    engine.undoManager.undo();
    await new Promise((r) => setTimeout(r, 20));
    expect(engine.children.length).toBe(2);
    expect(engine.children[1].id).not.toBe(oldId); // Loro re-creates a node deleted then undone: the id can't be trusted

    const setBaseAndExtent = vi.fn();
    const setCursor = vi.fn();
    engine.selection = { setBaseAndExtent, setCursor, sync: vi.fn() };
    // No DOM here: give both blocks a point so the range path is taken.
    for (const b of engine.children) b.element = {}, b.getDOMPoint = (offset) => ({ node: b.id, offset });
    restoreSelection(engine, snap);
    await vi.waitFor(() => expect(setBaseAndExtent).toHaveBeenCalled());
    const [aNode, aOff, fNode, fOff] = setBaseAndExtent.mock.calls.at(-1);
    expect(aNode).toBe(engine.children[0].id);
    expect(aOff).toBe(2);
    expect(fNode).toBe(engine.children[1].id); // the NEW block
    expect(fOff).toBe(3);
  });

  it('a stored block gone for good (and no path) never throws: the nearest text block takes a caret', async () => {
    const engine = new Nabu({ extensions: [ParagraphExtension, BlockExtension] });
    await engine.commit();
    const first = engine.children[0];
    first.insert(0, 'abc');
    await engine.commit();
    const ghost = { id: 'nope', parent: null, index: 7, behaviors: new Map([['text', { container: first.behaviors.get('text').container }]]) };
    const snap = { anchor: makeEndpoint(ghost, 99, 'end'), focus: null };
    snap.focus = snap.anchor;
    const setCursor = vi.fn();
    engine.selection = { setBaseAndExtent: vi.fn(), setCursor, sync: vi.fn() };
    first.element = {};
    expect(() => restoreSelection(engine, snap)).not.toThrow();
    await vi.waitFor(() => expect(setCursor).toHaveBeenCalled());
    const [block, offset] = setCursor.mock.calls.at(-1);
    expect(block).toBe(engine.children[0]);
    expect(offset).toBe(3); // clamped to the text
  });
});
