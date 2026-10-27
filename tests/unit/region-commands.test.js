// @ts-nocheck
/**
 * Region commands on the container model (ADR 018 lot A2, ADR 017): context facts, `region:split` (Mod-Enter), the protected
 * merges (hold Backspace / Delete: merge into the previous region of the same level, else dissolve), `region:exit`,
 * demote / promote (Tab / Shift-Tab in a title), unwrap, move, insert and navigation; one undo step each.
 * Real Nabu over the Loro tree; the DOM selection is a stub (the block holding the caret, with its offsets), time is a fake clock.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { HeadingExtension } from '#lib/blocks/heading/index.js';
import { ListExtension, ListItemExtension } from '#lib/blocks/list/index.js';
import { ToggleExtension } from '#lib/blocks/toggle/index.js';
import { CodeExtension } from '#lib/blocks/code/index.js';
import { BlockExtension } from '#lib/blocks/block.extension.js';
import { RichTextExtension } from '#lib/behaviors/text/index.js';
import { RegionsExtension } from '#lib/blocks/region/index.js';

const BOOK = {
  part: { level: 1, label: 'Part {index}' },
  chapter: { level: 2, label: 'Chapter {index}', numbering: 'document' },
  scene: { level: 3, label: '{path} {title}' },
};

afterEach(() => vi.restoreAllMocks());

/** Time and frames the test advances by hand (`frame` = 16 ms). */
function fakeClock() {
  let t = 0; let id = 0;
  const jobs = new Map();
  return {
    now: () => t,
    timeout(fn, ms) { const k = id++; jobs.set(k, { at: t + ms, fn }); return () => jobs.delete(k); },
    frame(fn) { const k = id++; jobs.set(k, { at: t + 16, fn }); return () => jobs.delete(k); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [k, job] of jobs) if (job.at <= end && (!next || job.at < next.job.at)) next = { k, job };
        if (!next) break;
        t = next.job.at; jobs.delete(next.k); next.job.fn();
      }
      t = end;
    },
  };
}

async function makeEditor(types, { messages, keymap } = {}) {
  const clock = fakeClock();
  const engine = new Nabu({
    extensions: [ParagraphExtension, HeadingExtension, ListExtension, ListItemExtension, ToggleExtension, CodeExtension, RichTextExtension, RegionsExtension({ types, messages }), BlockExtension],
    platform: 'other',
    commandConfirm: { clock },
    keymap,
  });
  await engine.commit();
  engine.undoManager.clear();
  engine.selection = { anchorBlock: null, focusBlock: null, startBlock: null, endBlock: null, blocks: new Set(), isCollapsed: true, sync: vi.fn(), normalize: vi.fn(), setCursor: vi.fn() };
  return Object.assign(engine, { clock });
}

/** Puts the (stubbed) caret in `block` at `from` (a range with `to`). The text block's `selection` reads it. */
function setCaret(engine, block, from, to = from) {
  const read = () => ({ from, to, isCollapsed: from === to, direction: 'none' });
  Object.defineProperty(block, 'selection', { configurable: true, get: read });
  const behavior = block.behaviors?.get('text');
  if (behavior) Object.defineProperty(behavior, 'selection', { configurable: true, get: read });
  const setCursor = engine.selection.setCursor;
  engine.selection = { anchorBlock: block, focusBlock: block, startBlock: block, endBlock: block, blocks: new Set([block]), isCollapsed: from === to, sync: vi.fn(), normalize: vi.fn(), setCursor };
}

/** Fixture specs: `P(text)`, `H(text)`, `LIST(type, items)`, `R(type, title, children)`. */
const P = (text = '') => ({ type: 'paragraph', text });
const H = (text) => ({ type: 'heading', text, props: { level: 1 } });
const LI = (text, props = {}) => ({ type: 'list-item', text, props });
const LIST = (listType, children) => ({ type: 'list', props: { listType }, children });
const R = (regionType, title = '', children = []) => ({ type: 'region', regionType, title, children });

/** Replaces the document by `specs` (a nested tree), then starts from a clean undo history. */
async function build(engine, specs) {
  for (const child of [...engine.children]) engine.delete(child);
  const add = (spec, parentId, index) => {
    const props = spec.type === 'region'
      ? { regionType: spec.regionType, title: spec.title }
      : { ...(spec.text !== undefined ? { text: spec.text } : {}), ...(spec.props ?? {}) };
    const block = engine.insert(spec.type, props, parentId, index);
    (spec.children ?? []).forEach((child, i) => add(child, block.id, i));
    return block;
  };
  specs.forEach((spec, i) => add(spec, null, i));
  await engine.commit();
  engine.undoManager.clear();
}

/** The model as an outline, straight from the tree: `R:type(title){children}`, `p(text)`, `h(text)`, `list{li(text)}`. */
const fmt = (node) => {
  const type = node.data.get('type');
  const text = node.data.get('text')?.toString() ?? '';
  const kids = (node.children() ?? []).map(fmt).join(' ');
  const name = type === 'region' ? `R:${node.data.get('regionType')}` : type === 'paragraph' ? 'p' : type === 'heading' ? 'h' : type === 'list-item' ? 'li' : type;
  return `${name}(${text})${kids ? `{${kids}}` : ''}`;
};
const doc = (engine) => engine.tree.roots().map(fmt).join(' ; ');

/** The live block whose own text is `text` (first match, document order); titles count. */
function at(engine, text) {
  const walk = (blocks) => {
    for (const b of blocks) {
      if (b.behaviors?.get('text')?.text === text) return b;
      const found = walk(b.children ?? []);
      if (found) return found;
    }
    return null;
  };
  return walk(engine.children);
}

const labels = (engine) => engine.regions.list.map((r) => r.label);
const flush = async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

const key = (k, init = {}) => ({ key: k, code: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, preventDefault: vi.fn(), ...init });
const press = (engine, k, init) => { const event = key(k, init); engine.handleKeydown(event); return event; };
const release = (engine, k, init) => engine.commandConfirm.onKeyup(key(k, init));

/** Context facts as the engine builds them for the caret at (`block`, `from`). */
function facts(engine, block, from, to = from) {
  setCaret(engine, block, from, to);
  return engine.commands.context(null);
}

/** Undoes ONE step: gives back `before` and leaves nothing else to undo. */
async function expectOneUndo(engine, before) {
  engine.undo();
  await flush();
  expect(doc(engine)).toBe(before);
  expect(engine.undoManager.canUndo()).toBe(false);
}

// ─── context facts ─────────────────────────────────────────────────────────

describe('context facts', () => {
  it('at the root, outside any region: no region, the first region is next; the end of the text is a boundary', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('pre'), R('part', 'P', [P('a')])]);
    const ctx = facts(engine, at(engine, 'pre'), 0);
    expect(ctx.region).toBeNull();
    expect(ctx.previousRegion).toBeNull();
    expect(ctx.nextRegion).toBe(engine.regions.list[0]);
    expect(ctx.inBodyTextBlock).toBe(true);
    expect(ctx.inTitle).toBe(false);
    expect(ctx.atStartOfRegion).toBe(false);
    expect(ctx.atEndOfRegion).toBe(false);
    const end = facts(engine, at(engine, 'pre'), 3);
    expect(end.atEndOfRegion).toBe(true); // a Delete here would cross the title of P
    expect(end.nextBoundaryRegion).toBe(engine.regions.list[0]);
  });

  it('atStartOfRegion: the title, or the first text block of the body, whatever its type', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [
      R('part', 'P', [P('first'), P('second'), R('chapter', 'C', [H('Head'), P('more')])]),
      R('part', 'Q', [LIST('bullet', [LI('item')])]),
    ]);
    const first = at(engine, 'first');
    const ctx = facts(engine, first, 0);
    expect(ctx.region.title).toBe('P');
    expect(ctx.atStartOfRegion).toBe(true);
    expect(facts(engine, first, 1).atStartOfRegion).toBe(false);
    expect(facts(engine, first, 0, 3).atStartOfRegion).toBe(false); // a range
    expect(facts(engine, at(engine, 'second'), 0).atStartOfRegion).toBe(false); // not the first block
    expect(facts(engine, at(engine, 'P'), 0).atStartOfRegion).toBe(true); // the title itself
    expect(facts(engine, at(engine, 'P'), 1).atStartOfRegion).toBe(false);
    const heading = facts(engine, at(engine, 'Head'), 0); // a heading is the first element of C
    expect(heading.region.title).toBe('C');
    expect(heading.atStartOfRegion).toBe(true);
    expect(heading.previousRegion.title).toBe('P'); // document order
    expect(facts(engine, at(engine, 'item'), 0).atStartOfRegion).toBe(true); // the first item of the first list
    expect(facts(engine, at(engine, 'item'), 0).inBodyTextBlock).toBe(false);
  });

  it('atEndOfRegion: a title lies right after (next sibling of the block or of its ancestor), nextBoundaryRegion names it', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [
      R('part', 'P', [P('a'), P('b'), R('chapter', 'C', [P('c'), R('scene', 'S', [P('s')])])]),
      R('part', 'Q', [P('q')]),
    ]);
    const b = facts(engine, at(engine, 'b'), 1);
    expect(b.atEndOfRegion).toBe(true); // b is right before the sub-region C
    expect(b.nextBoundaryRegion.title).toBe('C');
    expect(facts(engine, at(engine, 'b'), 0).atEndOfRegion).toBe(false);
    expect(facts(engine, at(engine, 'a'), 1).atEndOfRegion).toBe(false); // the next text block is b, in the same body
    const c = facts(engine, at(engine, 'c'), 1);
    expect(c.atEndOfRegion).toBe(true);
    expect(c.nextBoundaryRegion.title).toBe('S');
    const s = facts(engine, at(engine, 's'), 1); // the last text of scene S: the NEXT TITLE is Q, whose previous sibling P holds the caret
    expect(s.atEndOfRegion).toBe(true);
    expect(s.nextBoundaryRegion.title).toBe('Q');
    expect(facts(engine, at(engine, 'q'), 1).atEndOfRegion).toBe(false); // end of the document: nothing to cross
  });

  it('inTitle / inBodyTextBlock: a title and a list item are neither a body text block; a toggle neither', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('a'), LIST('bullet', [LI('item')])])]);
    const title = facts(engine, at(engine, 'P'), 1);
    expect(title.inTitle).toBe(true);
    expect(title.inBodyTextBlock).toBe(false);
    expect(title.region.title).toBe('P');
    const para = facts(engine, at(engine, 'a'), 0);
    expect(para.inTitle).toBe(false);
    expect(para.inBodyTextBlock).toBe(true);
    const item = facts(engine, at(engine, 'item'), 0);
    expect(item.inBodyTextBlock).toBe(false);
    expect(item.region.title).toBe('P');
  });

  it('previousRegion / nextRegion follow the document order, sub-regions included', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('a'), R('chapter', 'C', [P('b')]), R('chapter', 'D', [P('d')])])]);
    expect(facts(engine, at(engine, 'a'), 0).nextRegion.title).toBe('C');
    const inC = facts(engine, at(engine, 'b'), 0);
    expect(inC.previousRegion.title).toBe('P');
    expect(inC.nextRegion.title).toBe('D');
    expect(facts(engine, at(engine, 'P'), 0).nextRegion.title).toBe('C'); // from a title: the first sub-region
  });
});

// ─── region:split ──────────────────────────────────────────────────────────

describe('region:split', () => {
  it('mid-text in a body: a sibling of the same type right after the region takes the tail and ALL that follows; caret at the start of the tail; ONE undo step', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('a'), R('chapter', 'C', [P('abcdef'), P('tail'), R('scene', 'S', [P('s')])]), R('chapter', 'D', [P('d')])])]);
    const before = doc(engine);
    setCaret(engine, at(engine, 'abcdef'), 3);
    await engine.exec('region:split');
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(a) R:chapter(C){p(abc)} R:chapter(){p(def) p(tail) R:scene(S){p(s)}} R:chapter(D){p(d)}}');
    expect(labels(engine)).toEqual(['Part 1', 'Chapter 1', 'Chapter 2', '1.2.1 S', 'Chapter 3']);
    expect(engine.regions.list.map((r) => r.type)).toEqual(['part', 'chapter', 'chapter', 'scene', 'chapter']);
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'def'), 0);
    await expectOneUndo(engine, before);
  });

  it('at the end of the block: the tail is an empty paragraph that moves with the following blocks', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('end'), P('next')])]);
    setCaret(engine, at(engine, 'end'), 3);
    await engine.exec('region:split');
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(end)} ; R:part(){p() p(next)}');
    expect(engine.selection.setCursor.mock.lastCall[0].behaviors.get('text').text).toBe('');
  });

  it('at the start of a block: no cut, the block itself and its followers move; the caret stays at 0', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('one'), P('two'), P('three')])]);
    setCaret(engine, at(engine, 'two'), 0);
    await engine.exec('region:split');
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(one)} ; R:part(){p(two) p(three)}');
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'two'), 0);
  });

  it('at the root (no region): the new region has the default type and takes the tail and the root blocks up to the next root region', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('hello world'), P('more'), R('chapter', 'C', [P('x')]), P('after')]);
    setCaret(engine, at(engine, 'hello world'), 5);
    await engine.exec('region:split');
    await flush();
    expect(doc(engine)).toBe('p(hello) ; R:part(){p( world) p(more)} ; R:chapter(C){p(x)} ; p(after)');
    expect(engine.regions.list.map((r) => [r.type, r.parent?.type ?? null])).toEqual([['part', null], ['chapter', null]]);
  });

  it('at the very start of the document: the new region opens the document with everything up to the next region', async () => {
    const engine = await makeEditor();
    await build(engine, [P('text')]);
    setCaret(engine, at(engine, 'text'), 0);
    await engine.exec('region:split');
    await flush();
    expect(doc(engine)).toBe('R:section-1(){p(text)}');
    expect(engine.regions.preamble.blocks).toEqual([]);
  });

  it('a heading cut at its end opens the region with a paragraph; mid-text both halves stay headings', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [H('Title')])]);
    setCaret(engine, at(engine, 'Title'), 5);
    await engine.exec('region:split');
    await flush();
    expect(doc(engine)).toBe('R:part(P){h(Title)} ; R:part(){p()}');
    setCaret(engine, at(engine, 'Title'), 2);
    await engine.exec('region:split');
    await flush();
    expect(doc(engine)).toBe('R:part(P){h(Ti)} ; R:part(){h(tle)} ; R:part(){p()}');
  });

  it('keys: Mod-Enter splits in a body text block; not with a range, nor in a list item or a title (falls through)', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('abcd'), LIST('bullet', [LI('item')])])]);
    setCaret(engine, at(engine, 'abcd'), 2, 3);
    expect(press(engine, 'Enter', { ctrlKey: true }).preventDefault).not.toHaveBeenCalled();
    setCaret(engine, at(engine, 'abcd'), 2);
    expect(press(engine, 'Enter', { ctrlKey: true }).preventDefault).toHaveBeenCalled();
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(ab)} ; R:part(){p(cd) list(){li(item)}}');

    const before = doc(engine);
    setCaret(engine, at(engine, 'item'), 2);
    expect(press(engine, 'Enter', { ctrlKey: true }).preventDefault).not.toHaveBeenCalled();
    setCaret(engine, at(engine, 'P'), 1);
    expect(press(engine, 'Enter', { ctrlKey: true }).preventDefault).not.toHaveBeenCalled();
    expect(doc(engine)).toBe(before);
  });

  it('a code block is left alone: Mod-Enter falls through there', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [{ type: 'code', text: 'let a = 1;' }])]);
    setCaret(engine, at(engine, 'let a = 1;'), 4);
    expect(press(engine, 'Enter', { ctrlKey: true }).preventDefault).not.toHaveBeenCalled();
    expect(await engine.exec('region:split')).toBeDefined();
    await flush();
    expect(engine.regions.list.length).toBe(1);
  });

  it('coexists with todo:toggle on Mod-Enter: the toggle wins in a to-do item, the split applies in a paragraph', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('abcd'), LIST('todo', [LI('task', { checked: false })])])]);
    const item = at(engine, 'task');
    setCaret(engine, item, 2);
    expect(press(engine, 'Enter', { ctrlKey: true }).preventDefault).toHaveBeenCalled();
    expect(item.node.data.get('checked')).toBe(true);
    expect(engine.regions.list.length).toBe(1); // no region added
    setCaret(engine, at(engine, 'abcd'), 2);
    press(engine, 'Enter', { ctrlKey: true });
    await flush();
    expect(engine.regions.list.length).toBe(2);
    expect(item.node.data.get('checked')).toBe(true); // untouched
  });
});

// ─── the protected merges ──────────────────────────────────────────────────

describe('Backspace at the start of a region (region:merge-previous)', () => {
  it('a quick press does nothing, whatever the type of the block: the text is never merged through the title; the hold has started', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'A', [P('a')]), R('part', 'B', [P('b')])]);
    setCaret(engine, at(engine, 'b'), 0);
    const event = press(engine, 'Backspace');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(engine.pendingCommand).toMatchObject({ id: 'region:merge-previous', strategy: 'hold' });
    expect(engine.pendingCommand.target).toBe(engine.regions.list[1].block);
    release(engine, 'Backspace');
    expect(engine.pendingCommand).toBeNull();
    await flush();
    expect(doc(engine)).toBe('R:part(A){p(a)} ; R:part(B){p(b)}');
  });

  it('into the previous sibling region of the SAME level: names it; holding 700 ms appends the body (one undo step); labels renumber', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('pre'), R('part', 'A', [P('a')]), R('part', 'B', [P('b'), P('b2')])]);
    const before = doc(engine);
    setCaret(engine, at(engine, 'b'), 0);
    press(engine, 'Backspace');
    expect(engine.pendingCommand.label).toBe('Merge with “A”');
    expect(engine.pendingCommand.message).toBe('Hold Backspace to merge with “A”');
    expect(engine.commandAnnouncement).toContain('Hold Backspace to merge');
    engine.clock.advance(500);
    expect(engine.pendingCommand.progress).toBeGreaterThan(0.6);
    expect(doc(engine)).toBe(before);
    engine.clock.advance(250);
    await flush();
    expect(doc(engine)).toBe('p(pre) ; R:part(A){p(a) p(b) p(b2)}');
    expect(labels(engine)).toEqual(['Part 1']);
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'b'), 0);
    await expectOneUndo(engine, before);
    expect(labels(engine)).toEqual(['Part 1', 'Part 2']);
  });

  it('a region merges with its previous sibling even when the caret is in the title; the caret goes to the first text position of the body', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'A', [P('a')]), R('part', 'B', [R('chapter', 'C', [P('c')])])]);
    setCaret(engine, at(engine, 'B'), 0);
    press(engine, 'Backspace');
    expect(engine.pendingCommand).toMatchObject({ id: 'region:merge-previous' });
    engine.clock.advance(750);
    await flush();
    expect(doc(engine)).toBe('R:part(A){p(a) R:chapter(C){p(c)}}');
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'C'), 0); // the first text position: the title of C
  });

  it('with an empty body, the caret from the vanished title goes to the end of the region joined', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'AA', [P('a')]), R('part', 'B')]);
    setCaret(engine, at(engine, 'B'), 0);
    await engine.exec('region:merge-previous');
    await flush();
    expect(doc(engine)).toBe('R:part(AA){p(a)}');
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'AA'), 2);
  });

  it('dissolves in place when the previous sibling is text: the body takes the position, the title goes; the hold says so', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('pre'), R('part', 'P', [P('below'), R('chapter', 'C', [P('ch')])])]);
    const before = doc(engine);
    setCaret(engine, at(engine, 'below'), 0);
    press(engine, 'Backspace');
    expect(engine.pendingCommand.message).toBe('Hold Backspace to dissolve “P”');
    engine.clock.advance(750);
    await flush();
    expect(doc(engine)).toBe('p(pre) ; p(below) ; R:chapter(C){p(ch)}');
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'below'), 0);
    await expectOneUndo(engine, before);
  });

  it('dissolves when the region is the first child of a region parent, and when the previous sibling has another level', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [R('chapter', 'C', [P('ch')]), R('chapter', 'D', [P('d')])])]);
    setCaret(engine, at(engine, 'ch'), 0);
    await engine.exec('region:merge-previous');
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(ch) R:chapter(D){p(d)}}');

    const other = await makeEditor(BOOK);
    await build(other, [R('part', 'P', [R('scene', 'S', [P('s')]), R('chapter', 'C', [P('ch')])])]);
    setCaret(other, at(other, 'ch'), 0);
    press(other, 'Backspace');
    expect(other.pendingCommand.message).toBe('Hold Backspace to dissolve “C”');
    other.clock.advance(750);
    await flush();
    expect(doc(other)).toBe('R:part(P){R:scene(S){p(s)} p(ch)}');
  });

  it('the start of a region is one logical position: a heading or a list item there is protected too', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('pre'), R('part', 'P', [H('Title'), P('x')]), R('part', 'Q', [LIST('bullet', [LI('item')])])]);
    setCaret(engine, at(engine, 'Title'), 0);
    press(engine, 'Backspace');
    expect(engine.pendingCommand).toMatchObject({ id: 'region:merge-previous' });
    release(engine, 'Backspace');
    setCaret(engine, at(engine, 'item'), 0);
    press(engine, 'Backspace');
    expect(engine.pendingCommand).toMatchObject({ id: 'region:merge-previous' });
    release(engine, 'Backspace');
    setCaret(engine, at(engine, 'x'), 0); // not the first block
    press(engine, 'Backspace');
    expect(engine.pendingCommand).toBeNull();
  });

  it('releasing early cancels: nothing changes, no undo step', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'A', [P('a')]), R('part', 'B', [P('b')])]);
    setCaret(engine, at(engine, 'b'), 0);
    press(engine, 'Backspace');
    engine.clock.advance(300);
    release(engine, 'Backspace');
    engine.clock.advance(1000);
    await flush();
    expect(doc(engine)).toBe('R:part(A){p(a)} ; R:part(B){p(b)}');
    expect(engine.undoManager.canUndo()).toBe(false);
  });

  it('a held Backspace erasing a word stops at the boundary: the repeats are swallowed there, no merge', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('pre'), R('part', 'P', [P('below')])]);
    setCaret(engine, at(engine, 'below'), 0);
    const repeat = press(engine, 'Backspace', { repeat: true });
    expect(repeat.preventDefault).toHaveBeenCalled();
    expect(engine.pendingCommand).toBeNull(); // a repeat never starts a hold
    engine.clock.advance(2000);
    await flush();
    expect(doc(engine)).toBe('p(pre) ; R:part(P){p(below)}');
  });

  it('the first region of the document (nothing before it, no parent): no command, no hold; the engine finds no partner', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('text')])]);
    const block = at(engine, 'text');
    setCaret(engine, block, 0);
    const event = press(engine, 'Backspace');
    expect(engine.pendingCommand).toBeNull();
    expect(event.preventDefault).not.toHaveBeenCalled();
    block.beforeinput({ inputType: 'deleteContentBackward', preventDefault: vi.fn() }); // the veto keeps the text out of the title
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(text)}');
  });

  it('an EMPTY first block of the body is protected the same way; the engine\'s own merge path is vetoed too', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('above'), R('part', 'P', [P('')])]);
    const empty = engine.children[1].children[0];
    setCaret(engine, empty, 0);
    press(engine, 'Backspace');
    expect(engine.pendingCommand).toMatchObject({ id: 'region:merge-previous' });
    release(engine, 'Backspace');
    empty.beforeinput({ inputType: 'deleteContentBackward', preventDefault: vi.fn() });
    await flush();
    expect(doc(engine)).toBe('p(above) ; R:part(P){p()}');
  });

  it('exec runs the merge directly, without the hold; { region } acts on that region; with nothing to merge with it is a no-op', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('pre'), R('part', 'A', [P('a')]), R('part', 'B', [P('b')]), R('part', 'C', [P('c')])]);
    setCaret(engine, at(engine, 'b'), 1);
    await engine.exec('region:merge-previous');
    await flush();
    expect(doc(engine)).toBe('p(pre) ; R:part(A){p(a) p(b)} ; R:part(C){p(c)}');
    expect(engine.pendingCommand).toBeNull();
    await engine.exec('region:merge-previous', { region: engine.regions.list[1] }); // C into A
    await flush();
    expect(doc(engine)).toBe('p(pre) ; R:part(A){p(a) p(b) p(c)}');

    const lone = await makeEditor(BOOK);
    await build(lone, [R('part', 'P', [P('text')])]);
    await lone.exec('region:merge-previous', { region: lone.regions.list[0] });
    await flush();
    expect(doc(lone)).toBe('R:part(P){p(text)}');
    expect(lone.undoManager.canUndo()).toBe(false);
  });
});

describe('Delete at the end of a region (region:merge-next)', () => {
  it('the hold targets the NEXT region (the one that vanishes); a quick press does nothing; holding merges it into the previous sibling; caret stays', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('a')]), R('part', 'Q', [P('b')]), R('part', 'T', [P('c')])]);
    const before = doc(engine);
    const a = at(engine, 'a');
    setCaret(engine, a, 1);
    press(engine, 'Delete');
    expect(engine.pendingCommand).toMatchObject({ id: 'region:merge-next', strategy: 'hold' });
    expect(engine.pendingCommand.target).toBe(engine.regions.list[1].block);
    expect(engine.pendingCommand.message).toBe('Hold Delete to merge “Q” into this region');
    release(engine, 'Delete');
    await flush();
    expect(doc(engine)).toBe(before);

    press(engine, 'Delete');
    engine.clock.advance(750);
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(a) p(b)} ; R:part(T){p(c)}');
    expect(labels(engine)).toEqual(['Part 1', 'Part 2']);
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(a, 1);
    await expectOneUndo(engine, before);
  });

  it('from the last text of a nested region, the next region at an upper level merges into the PREVIOUS SIBLING (the parent)', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [R('chapter', 'C', [P('a')])]), R('part', 'Q', [P('b')])]);
    setCaret(engine, at(engine, 'a'), 1);
    press(engine, 'Delete');
    expect(engine.pendingCommand.message).toBe('Hold Delete to merge “Q” into this region');
    engine.clock.advance(750);
    await flush();
    expect(doc(engine)).toBe('R:part(P){R:chapter(C){p(a)} p(b)}');
  });

  it('from the text before a region (previous sibling is text): the region is dissolved; the engine merge through it is vetoed', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('pre'), R('part', 'P', [P('x')])]);
    const pre = at(engine, 'pre');
    setCaret(engine, pre, 3);
    press(engine, 'Delete');
    expect(engine.pendingCommand).toMatchObject({ id: 'region:merge-next' });
    expect(engine.pendingCommand.message).toBe('Hold Delete to dissolve “P”');
    release(engine, 'Delete');
    pre.beforeinput({ inputType: 'deleteContentForward', preventDefault: vi.fn() });
    await flush();
    expect(doc(engine)).toBe('p(pre) ; R:part(P){p(x)}');
    press(engine, 'Delete');
    engine.clock.advance(750);
    await flush();
    expect(doc(engine)).toBe('p(pre) ; p(x)');
  });

  it('the last block of the document: Delete is native (no hold)', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('a')]), R('part', 'Q', [P('c')])]);
    setCaret(engine, at(engine, 'c'), 1);
    press(engine, 'Delete');
    expect(engine.pendingCommand).toBeNull();
  });

  it('exec merges the next sibling region of the caret\'s region directly; { region } the next sibling of that one', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('a')]), R('part', 'Q', [P('b')]), R('part', 'T', [P('c')]), R('part', 'U', [P('d')])]);
    setCaret(engine, at(engine, 'a'), 0);
    await engine.exec('region:merge-next');
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(a) p(b)} ; R:part(T){p(c)} ; R:part(U){p(d)}');
    await engine.exec('region:merge-next', { region: engine.regions.list[1] }); // T absorbs U
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(a) p(b)} ; R:part(T){p(c) p(d)}');
  });
});

// ─── region:exit ───────────────────────────────────────────────────────────

describe('region:exit', () => {
  it('Mod-Shift-Enter: a new empty paragraph right after the region, in its parent; the caret goes there; one undo step', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('a'), R('chapter', 'C', [P('b')])])]);
    const before = doc(engine);
    setCaret(engine, at(engine, 'b'), 1);
    const event = press(engine, 'Enter', { ctrlKey: true, shiftKey: true });
    expect(event.preventDefault).toHaveBeenCalled();
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(a) R:chapter(C){p(b)} p()}');
    expect(engine.selection.setCursor.mock.lastCall[0].behaviors.get('text').text).toBe('');
    await expectOneUndo(engine, before);
  });

  it('works from a title too; not taken outside any region nor with a range', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('pre'), R('part', 'P', [P('a')])]);
    setCaret(engine, at(engine, 'P'), 1);
    await engine.exec('region:exit');
    await flush();
    expect(doc(engine)).toBe('p(pre) ; R:part(P){p(a)} ; p()');
    setCaret(engine, at(engine, 'pre'), 1);
    expect(press(engine, 'Enter', { ctrlKey: true, shiftKey: true }).preventDefault).not.toHaveBeenCalled();
    setCaret(engine, at(engine, 'a'), 0, 1);
    expect(press(engine, 'Enter', { ctrlKey: true, shiftKey: true }).preventDefault).not.toHaveBeenCalled();
  });

  it('repeated from an empty last paragraph, it climbs: scene, chapter, part, root (the SAME paragraph moves out)', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [R('chapter', 'C', [R('scene', 'S', [P('x'), P('')])])])]);
    const empty = at(engine, '');
    const climb = async () => { setCaret(engine, empty, 0); await engine.exec('region:exit'); await flush(); };
    await climb();
    expect(doc(engine)).toBe('R:part(P){R:chapter(C){R:scene(S){p(x)} p()}}');
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(empty, 0);
    await climb();
    expect(doc(engine)).toBe('R:part(P){R:chapter(C){R:scene(S){p(x)}} p()}');
    await climb();
    expect(doc(engine)).toBe('R:part(P){R:chapter(C){R:scene(S){p(x)}}} ; p()');
    expect(await engine.exec('region:exit')).not.toBe(true); // at the root: nothing to leave
    expect(engine.blocks.get(empty.id)).toBe(empty); // never recreated
  });

  it('an empty paragraph that is NOT the last child does not move: a new paragraph is created after the region', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P(''), P('b')])]);
    setCaret(engine, engine.children[0].children[0], 0);
    await engine.exec('region:exit');
    await flush();
    expect(doc(engine)).toBe('R:part(P){p() p(b)} ; p()');
  });
});

// ─── demote / promote ──────────────────────────────────────────────────────

describe('region:demote (Tab in a title)', () => {
  const setup = async (types = BOOK) => {
    const engine = await makeEditor(types);
    await build(engine, [R('part', 'P', [R('chapter', 'A', [P('a')]), R('chapter', 'B', [P('b1'), R('scene', 'S', [P('s')])])])]);
    return engine;
  };

  it('B becomes the last child of its previous sibling A, retyped; its sub-regions that are now too shallow come out after it; caret stays; one undo step', async () => {
    const engine = await setup();
    const before = doc(engine);
    const title = at(engine, 'B');
    setCaret(engine, title, 1);
    const event = press(engine, 'Tab');
    expect(event.preventDefault).toHaveBeenCalled();
    await flush();
    expect(doc(engine)).toBe('R:part(P){R:chapter(A){p(a) R:scene(B){p(b1)} R:scene(S){p(s)}}}');
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(title, 1);
    await expectOneUndo(engine, before);
  });

  it('Tab outside a title is NOT taken (a paragraph, a list item keep their own Tab)', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'b1'), 0);
    expect(press(engine, 'Tab').preventDefault).not.toHaveBeenCalled();
    await flush();
    expect(engine.undoManager.canUndo()).toBe(false);
  });

  it('no-op (no commit) without a previous sibling region, after text, with no deeper type, or next to a region that is too deep', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [R('chapter', 'A', [P('a')]), P('t'), R('chapter', 'B', [P('b')]), R('scene', 'Z', [P('z')]), R('chapter', 'D', [P('d')])])]);
    const before = doc(engine);
    for (const title of ['A', 'B', 'Z', 'D']) { // first child / after text / deepest type / the previous sibling Z is a scene
      setCaret(engine, at(engine, title), 0);
      await engine.exec('region:demote');
    }
    await flush();
    expect(doc(engine)).toBe(before);
    expect(engine.undoManager.canUndo()).toBe(false);
  });
});

describe('region:promote (Shift-Tab in a title)', () => {
  const setup = async (types = BOOK) => {
    const engine = await makeEditor(types);
    await build(engine, [R('part', 'P', [P('intro'), R('chapter', 'A', [P('a')]), R('chapter', 'B', [P('b'), R('scene', 'S', [P('s')])]), R('chapter', 'C', [P('c')])])]);
    return engine;
  };

  it('B leaves P to sit right after it, retyped; what FOLLOWED it in P (C) follows it into its body; caret stays; one undo step', async () => {
    const engine = await setup();
    const before = doc(engine);
    const title = at(engine, 'B');
    setCaret(engine, title, 1);
    const event = press(engine, 'Tab', { shiftKey: true });
    expect(event.preventDefault).toHaveBeenCalled();
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(intro) R:chapter(A){p(a)}} ; R:part(B){p(b) R:scene(S){p(s)} R:chapter(C){p(c)}}');
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(title, 1);
    await expectOneUndo(engine, before);
  });

  it('text that followed it follows it too; with several types on the level, the first declared one is used', async () => {
    const engine = await makeEditor({ part: { level: 1 }, book: { level: 1 }, chapter: { level: 2 }, scene: { level: 3 } });
    await build(engine, [R('part', 'P', [R('chapter', 'B', [P('b')]), P('tail'), R('chapter', 'C', [P('c')])])]);
    setCaret(engine, at(engine, 'B'), 0);
    await engine.exec('region:promote');
    await flush();
    expect(doc(engine)).toBe('R:part(P) ; R:part(B){p(b) p(tail) R:chapter(C){p(c)}}');
  });

  it('promote then demote gives back the same structure (types and order)', async () => {
    const engine = await setup();
    const before = doc(engine);
    setCaret(engine, at(engine, 'B'), 1);
    await engine.exec('region:promote');
    await flush();
    expect(doc(engine)).not.toBe(before);
    setCaret(engine, at(engine, 'B'), 1);
    await engine.exec('region:demote');
    await flush();
    expect(doc(engine)).toBe(before);
  });

  it('no-op (no commit) at the root and at the highest level', async () => {
    const engine = await setup();
    const before = doc(engine);
    setCaret(engine, at(engine, 'P'), 0);
    await engine.exec('region:promote'); // a root region has no parent
    const flat = await makeEditor(BOOK);
    await build(flat, [R('chapter', 'X', [P('x')]), R('part', 'Y', [R('chapter', 'Z')])]);
    await flat.exec('region:promote', { region: flat.regions.list[0] });
    await flat.exec('region:promote', { region: flat.regions.list[2] }); // Z -> part: allowed; then no level above part
    await flush();
    await flat.exec('region:promote', { region: flat.regions.list[2] });
    await flush();
    expect(doc(engine)).toBe(before);
    expect(engine.undoManager.canUndo()).toBe(false);
    expect(doc(flat)).toBe('R:chapter(X){p(x)} ; R:part(Y) ; R:part(Z)');
  });
});

// ─── unwrap ────────────────────────────────────────────────────────────────

describe('region:unwrap', () => {
  it('the title becomes a paragraph (marks kept) at the region\'s position, the body follows in order; caret in the title keeps its offset; one undo step', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('pre'), R('chapter', 'Title', [P('x'), R('scene', 'S', [P('s')])]), P('post')]);
    const titleBlock = at(engine, 'Title');
    titleBlock.container.mark({ start: 0, end: 3 }, 'bold', true);
    await engine.commit();
    engine.undoManager.clear();
    const delta = titleBlock.container.toDelta();
    const before = doc(engine);
    setCaret(engine, titleBlock, 2);
    await engine.exec('region:unwrap');
    await flush();
    expect(doc(engine)).toBe('p(pre) ; p(Title) ; p(x) ; R:scene(S){p(s)} ; p(post)');
    const paragraph = engine.children[1];
    expect(paragraph.behaviors.get('text').container.toDelta()).toEqual(delta);
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(paragraph, 2);
    await expectOneUndo(engine, before);
  });

  it('an empty title leaves no paragraph; the caret from the title goes to the start of the body; a caret in the body is put back', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [R('chapter', '', [P('x'), P('y')])])]);
    setCaret(engine, engine.children[0].children[0], 0);
    await engine.exec('region:unwrap');
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(x) p(y)}');
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'x'), 0);

    const other = await makeEditor(BOOK);
    await build(other, [R('part', 'P', [P('x')])]);
    setCaret(other, at(other, 'x'), 1);
    await other.exec('region:unwrap');
    await flush();
    expect(doc(other)).toBe('p(P) ; p(x)');
    expect(other.selection.setCursor).toHaveBeenLastCalledWith(at(other, 'x'), 1);
  });

  it('exec { region } unwraps that region', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [R('chapter', 'C', [P('c')]), P('t')])]);
    await engine.exec('region:unwrap', { region: engine.regions.list[1] });
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(C) p(c) p(t)}');
  });
});

// ─── move / insert / navigation ────────────────────────────────────────────

describe('region:move', () => {
  const setup = async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('pre'), R('part', 'A', [P('a'), R('chapter', 'A1', [P('a1')])]), P('mid'), R('part', 'B', [P('b'), R('chapter', 'B1', [P('b1')])]), R('part', 'C', [P('c')])]);
    return engine;
  };
  const ALL = 'p(pre) ; R:part(A){p(a) R:chapter(A1){p(a1)}} ; p(mid) ; R:part(B){p(b) R:chapter(B1){p(b1)}} ; R:part(C){p(c)}';

  it('down: swaps with the next sibling region of the same level, bodies included; the text between stays in place; labels renumber; caret stays; one undo step', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'a'), 0);
    await engine.exec('region:move', { direction: 'down' });
    await flush();
    expect(doc(engine)).toBe('p(pre) ; R:part(B){p(b) R:chapter(B1){p(b1)}} ; p(mid) ; R:part(A){p(a) R:chapter(A1){p(a1)}} ; R:part(C){p(c)}');
    expect(labels(engine)).toEqual(['Part 1', 'Chapter 1', 'Part 2', 'Chapter 2', 'Part 3']);
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'a'), 0);
    await expectOneUndo(engine, ALL);
  });

  it('up: swaps with the previous one (one undo step)', async () => {
    const engine = await setup();
    await engine.exec('region:move', { direction: 'up', region: engine.regions.list[4] }); // C (list: A, A1, B, B1, C)
    await flush();
    expect(doc(engine)).toBe('p(pre) ; R:part(A){p(a) R:chapter(A1){p(a1)}} ; p(mid) ; R:part(C){p(c)} ; R:part(B){p(b) R:chapter(B1){p(b1)}}');
    await expectOneUndo(engine, ALL);
  });

  it('edges: the first region cannot go up, the last cannot go down, a child never leaves its parent, another level is a barrier', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [R('chapter', 'X', [P('x')]), R('scene', 'Y', [P('y')])]), R('part', 'Q', [R('chapter', 'Z', [P('z')])])]);
    const before = doc(engine);
    const [p, x, y, q, z] = engine.regions.list;
    await engine.exec('region:move', { direction: 'up', region: p });
    await engine.exec('region:move', { direction: 'down', region: q });
    await engine.exec('region:move', { direction: 'down', region: x }); // next sibling is a scene
    await engine.exec('region:move', { direction: 'up', region: z }); // only child of Q
    await engine.exec('region:move', { direction: 'down', region: y });
    await flush();
    expect(doc(engine)).toBe(before);
    expect(engine.undoManager.canUndo()).toBe(false);
  });

  it('refuses a missing direction with a warning', async () => {
    const engine = await setup();
    const warn = vi.spyOn(Nabu.prototype, 'warn').mockImplementation(() => {});
    setCaret(engine, at(engine, 'a'), 0);
    await engine.exec('region:move', {});
    expect(warn).toHaveBeenCalled();
  });

  it('region:move-up / move-down are what a keymap binds', async () => {
    const engine = await makeEditor(BOOK, { keymap: { 'region:move-down': ['Mod-Alt-ArrowDown'], 'region:move-up': ['Mod-Alt-ArrowUp'] } });
    await build(engine, [R('part', 'A', [P('a')]), R('part', 'B', [P('b')])]);
    setCaret(engine, at(engine, 'a'), 0);
    const down = press(engine, 'ArrowDown', { ctrlKey: true, altKey: true });
    await flush();
    expect(down.preventDefault).toHaveBeenCalled();
    expect(doc(engine)).toBe('R:part(B){p(b)} ; R:part(A){p(a)}');
    press(engine, 'ArrowUp', { ctrlKey: true, altKey: true });
    await flush();
    expect(doc(engine)).toBe('R:part(A){p(a)} ; R:part(B){p(b)}');
  });
});

describe('region:insert', () => {
  const setup = async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('pre'), R('part', 'P', [P('a'), R('chapter', 'C', [P('b')])]), R('part', 'Q', [P('c')])]);
    return engine;
  };

  it('after the current region (a sibling in its parent), of its type by default; the caret stays', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'b'), 1);
    await engine.exec('region:insert', { at: 'after' });
    await flush();
    expect(doc(engine)).toBe('p(pre) ; R:part(P){p(a) R:chapter(C){p(b)} R:chapter()} ; R:part(Q){p(c)}');
    expect(engine.selection.setCursor).not.toHaveBeenCalled();
  });

  it('before, with a given type and title; one undo step', async () => {
    const engine = await setup();
    const before = doc(engine);
    setCaret(engine, at(engine, 'b'), 0);
    await engine.exec('region:insert', { type: 'scene', at: 'before', title: 'S' });
    await flush();
    expect(doc(engine)).toBe('p(pre) ; R:part(P){p(a) R:scene(S) R:chapter(C){p(b)}} ; R:part(Q){p(c)}');
    await expectOneUndo(engine, before);
  });

  it('outside any region: at the caret\'s position among the root blocks; the default type', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'pre'), 0);
    await engine.exec('region:insert', { at: 'after' });
    await flush();
    expect(doc(engine).startsWith('p(pre) ; R:part() ; R:part(P)')).toBe(true);
    await engine.exec('region:insert', { at: 'before', type: 'chapter' });
    await flush();
    expect(doc(engine).startsWith('R:chapter() ; p(pre)')).toBe(true);
  });

  it('an undeclared type is refused with a warning', async () => {
    const engine = await setup();
    const warn = vi.spyOn(Nabu.prototype, 'warn').mockImplementation(() => {});
    setCaret(engine, at(engine, 'a'), 0);
    const before = doc(engine);
    await engine.exec('region:insert', { type: 'nope' });
    await flush();
    expect(doc(engine)).toBe(before);
    expect(warn).toHaveBeenCalled();
  });
});

describe('region:next / prev / parent', () => {
  const setup = async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('pre'), R('part', 'P', [P('a'), R('chapter', 'C', [P('b')]), R('chapter', 'D'), R('chapter', 'E', [P('e')])])]);
    return engine;
  };

  it('next / prev put the caret at the first text position of the BODY of the target region', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'a'), 1);
    await engine.exec('region:next');
    await flush();
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'b'), 0);
    setCaret(engine, at(engine, 'b'), 1);
    await engine.exec('region:prev');
    await flush();
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'a'), 0);
  });

  it('from the root, next goes to the first region; prev has nowhere to go', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'pre'), 0);
    await engine.exec('region:prev');
    await flush();
    expect(engine.selection.setCursor).not.toHaveBeenCalled();
    await engine.exec('region:next');
    await flush();
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'a'), 0);
  });

  it('parent goes to the parent region; a root region has none; an empty region gets the caret at the end of its title', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'b'), 0);
    await engine.exec('region:parent');
    await flush();
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'a'), 0);
    engine.selection.setCursor.mockClear();
    setCaret(engine, at(engine, 'pre'), 0);
    await engine.exec('region:parent');
    await flush();
    expect(engine.selection.setCursor).not.toHaveBeenCalled();
    setCaret(engine, at(engine, 'b'), 0);
    await engine.exec('region:next'); // C -> D (empty body)
    await flush();
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'D'), 1);
  });

  it('data.region navigates from that region', async () => {
    const engine = await setup();
    await engine.exec('region:next', { region: engine.regions.list[0] });
    await flush();
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'b'), 0);
  });
});

// ─── registration ──────────────────────────────────────────────────────────

describe('registration', () => {
  it('default keys, labels (overridable), keymap', async () => {
    const engine = await makeEditor(BOOK, { messages: { split: 'Couper ici', dissolve: ({ title }) => `dissoudre « ${title} »`, hold: ({ keys, label }) => `Maintenez ${keys} : ${label}` } });
    const list = Object.fromEntries(engine.commands.list().filter((c) => c.id.startsWith('region:')).map((c) => [c.id, c]));
    expect(Object.keys(list).sort()).toEqual([
      'region:close', 'region:create', 'region:demote', 'region:exit', 'region:insert', 'region:merge-next', 'region:merge-previous', 'region:move', 'region:move-down', 'region:move-up', 'region:next', 'region:parent', 'region:prev', 'region:promote', 'region:split', 'region:unwrap',
    ]);
    expect(list['region:split'].keys).toEqual(['Mod-Enter']);
    expect(list['region:split'].label).toBe('Couper ici');
    expect(list['region:merge-previous'].keys).toEqual(['Backspace', 'Shift-Backspace']);
    expect(list['region:merge-next'].keys).toEqual(['Delete']);
    expect(list['region:exit'].keys).toEqual(['Mod-Shift-Enter']);
    expect(list['region:demote'].keys).toEqual(['Tab']);
    expect(list['region:promote'].keys).toEqual(['Shift-Tab']);
    for (const id of ['region:close', 'region:create', 'region:insert', 'region:unwrap', 'region:move', 'region:move-up', 'region:move-down', 'region:next', 'region:prev', 'region:parent']) expect(list[id].keys).toEqual([]);
    await build(engine, [P('pre'), R('part', 'P', [P('x')])]);
    setCaret(engine, at(engine, 'x'), 0);
    press(engine, 'Backspace');
    expect(engine.pendingCommand.message).toBe('Maintenez Backspace : dissoudre « P »');
  });

  it('the keyless commands can be bound with the keymap option', async () => {
    const engine = await makeEditor(BOOK, { keymap: { 'region:next': ['Mod-Alt-j'] } });
    await build(engine, [R('part', 'P', [P('a')]), R('part', 'Q', [P('b')])]);
    setCaret(engine, at(engine, 'a'), 0);
    const event = press(engine, 'j', { ctrlKey: true, altKey: true });
    await flush();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'b'), 0);
  });
});


// ─── labels without a caret (P-116) ────────────────────────────────────────

describe('commands.list() labels', () => {
  const row = (engine, id, ctx) => engine.commands.list(ctx).find((r) => r.id === id);

  it('without a caret the merge labels are generic and never empty', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'A', [P('a')]), R('part', 'B', [P('b')])]);
    expect(row(engine, 'region:merge-previous').label).toBe('Merge with the previous region');
    expect(row(engine, 'region:merge-next').label).toBe('Merge the next region into this one');
    for (const { label } of engine.commands.list()) expect(label.trim()).not.toBe('');
    for (const { label } of engine.commands.list()) expect(label).not.toContain('“”');
  });

  it('with the caret in a region the label still names the region', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'A', [P('a')]), R('part', 'B', [P('b')])]);
    setCaret(engine, at(engine, 'b'), 0);
    expect(row(engine, 'region:merge-previous', engine.commands.context(null)).label).toBe('Merge with “A”');
    expect(row(engine, 'region:merge-previous').label).toBe('Merge with “A”');
  });

  it('the generic labels are messages, overridable', async () => {
    const engine = await makeEditor(BOOK, { messages: { mergePreviousGeneric: 'Fusionner avec la région précédente' } });
    await build(engine, [R('part', 'A', [P('a')])]);
    expect(row(engine, 'region:merge-previous').label).toBe('Fusionner avec la région précédente');
  });
});
