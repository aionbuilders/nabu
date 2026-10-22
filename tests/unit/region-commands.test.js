// @ts-nocheck
/**
 * Region commands (ADR 016 lot 2, ADR 017): context facts, `region:split` (Mod-Enter), the protected merges (hold Backspace /
 * Delete) and the silent paths they close, insert / move / promote / demote / navigation, one undo step each, coexistence of
 * Mod-Enter with `todo:toggle`.
 * Real Nabu over the Loro tree; the DOM selection is a stub (the block holding the caret, with its offsets), time is a fake clock.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension, Paragraph } from '$lib/blocks/paragraph/index.js';
import { HeadingExtension } from '$lib/blocks/heading/index.js';
import { ListExtension, ListItemExtension, List, ListItem } from '$lib/blocks/list/index.js';
import { ToggleExtension } from '$lib/blocks/toggle/index.js';
import { CodeExtension } from '$lib/blocks/code/index.js';
import { BlockExtension } from '$lib/blocks/block.extension.js';
import { RichTextExtension } from '$lib/behaviors/text/index.js';
import { RegionsExtension } from '$lib/blocks/region/index.js';
import { handleContainerBeforeInput } from '$lib/blocks/container.utils.js';

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

async function makeEditor(types, { messages, keymap, extra = [] } = {}) {
  const clock = fakeClock();
  const engine = new Nabu({
    extensions: [ParagraphExtension, HeadingExtension, ListExtension, ListItemExtension, ToggleExtension, CodeExtension, RichTextExtension, RegionsExtension({ types, messages }), BlockExtension, ...extra],
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

const blank = (engine) => {
  const only = engine.children.length === 1 ? engine.children[0] : null;
  return only && only.type === 'paragraph' && only.behaviors.get('text').text === '' ? only : null;
};

/** Builds the document from `p:text` / `r:type:title`, replacing the initial empty paragraph, history cleared. */
async function build(engine, spec) {
  for (const child of [...engine.children]) engine.delete(child);
  spec.forEach((item, i) => {
    if (item.startsWith('p:')) engine.insert('paragraph', { text: item.slice(2) }, null, i);
    else if (item.startsWith('h:')) engine.insert('heading', { text: item.slice(2), level: 1 }, null, i);
    else { const [, regionType, title = ''] = item.split(':'); engine.insert('region', { regionType, title }, null, i); }
  });
  await engine.commit();
  engine.undoManager.clear();
}

const at = (engine, text) => engine.children.find((b) => b.behaviors?.get('text')?.text === text);

/** `p(text)` / `R:type(title)` outline of the root blocks, straight from the tree. */
const roots = (engine) => engine.tree.roots().map((node) => {
  const type = node.data.get('type');
  if (type === 'region') return `R:${node.data.get('regionType')}(${node.data.get('fields')?.get('title') ?? ''})`;
  const t = node.data.get('text');
  const kids = (node.children() ?? []).length ? '{…}' : '';
  return `${type === 'paragraph' ? 'p' : type === 'heading' ? 'h' : type}(${t ? t.toString() : ''})${kids}`;
}).join(' ; ');

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

// ─── context facts ─────────────────────────────────────────────────────────

describe('context facts', () => {
  it('in the preamble: no region, the first region is next, nothing is "at the start of a region"', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['p:pre', 'r:part:P', 'p:a']);
    const ctx = facts(engine, at(engine, 'pre'), 0);
    expect(ctx.region).toBeNull();
    expect(ctx.previousRegion).toBeNull();
    expect(ctx.nextRegion).toBe(engine.regions.list[0]);
    expect(ctx.inRootTextBlock).toBe(true);
    expect(ctx.atStartOfRegion).toBe(false);
    expect(ctx.atEndOfRegion).toBe(false);
    expect(facts(engine, at(engine, 'pre'), 3).atEndOfRegion).toBe(true); // a Delete here would cross the first marker
  });

  it('atStartOfRegion: collapsed, offset 0, first text block after the marker', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['p:pre', 'r:part:P', 'p:first', 'p:second', 'r:chapter:C', 'p:ch']);
    const first = at(engine, 'first');
    const ctx = facts(engine, first, 0);
    expect(ctx.region.title).toBe('P');
    expect(ctx.atStartOfRegion).toBe(true);
    expect(ctx.previousRegion).toBeNull();
    expect(facts(engine, first, 1).atStartOfRegion).toBe(false);
    expect(facts(engine, first, 0, 3).atStartOfRegion).toBe(false); // a range
    expect(facts(engine, at(engine, 'second'), 0).atStartOfRegion).toBe(false); // not the first block
    const sub = facts(engine, at(engine, 'ch'), 0);
    expect(sub.atStartOfRegion).toBe(true);
    expect(sub.previousRegion.title).toBe('P'); // the previous region in document order
  });

  it('atEndOfRegion: caret at the end of the last text block before the next marker, which is nextRegion', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['r:part:P', 'p:a', 'p:b', 'r:chapter:C', 'p:c']);
    const b = at(engine, 'b');
    const ctx = facts(engine, b, 1);
    expect(ctx.atEndOfRegion).toBe(true);
    expect(ctx.nextRegion.title).toBe('C');
    expect(facts(engine, b, 0).atEndOfRegion).toBe(false);
    expect(facts(engine, at(engine, 'a'), 1).atEndOfRegion).toBe(false); // the next text block is in the same region
    expect(facts(engine, at(engine, 'c'), 1).atEndOfRegion).toBe(false); // end of the document: nothing to cross
  });

  it('inRootTextBlock is false in a list item', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['r:part:P']);
    const list = List.create(engine, 'list', { listType: 'bullet' }, null, 1);
    const item = ListItem.create(engine, 'list-item', { text: 'in list' }, list.node.id.toString());
    await engine.commit();
    const ctx = facts(engine, engine.blocks.get(item.node.id.toString()), 0);
    expect(ctx.inRootTextBlock).toBe(false);
    expect(ctx.atStartOfRegion).toBe(false);
    expect(ctx.region.title).toBe('P');
  });
});

// ─── region:split ──────────────────────────────────────────────────────────

describe('region:split', () => {
  it('mid-text: head stays, tail starts a new region of the SAME type, caret at the start of the tail; ONE undo step', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['r:part:P', 'p:a', 'r:chapter:C', 'p:abcdef']);
    setCaret(engine, at(engine, 'abcdef'), 3);
    await engine.exec('region:split');
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; p(a) ; R:chapter(C) ; p(abc) ; R:chapter() ; p(def)');
    expect(labels(engine)).toEqual(['Part 1', 'Chapter 1', 'Chapter 2']);
    const tail = at(engine, 'def');
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(tail, 0);
    engine.undo();
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; p(a) ; R:chapter(C) ; p(abcdef)');
    expect(engine.undoManager.canUndo()).toBe(false); // the whole split was ONE step
  });

  it('at the end of the block: the tail is an empty paragraph, the marker between', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['r:part:P', 'p:end', 'p:next']);
    setCaret(engine, at(engine, 'end'), 3);
    await engine.exec('region:split');
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; p(end) ; R:part() ; p() ; p(next)');
    expect(engine.selection.setCursor.mock.lastCall[0].behaviors.get('text').text).toBe('');
  });

  it('at the start of a block: no cut, the marker goes right before it and the caret stays', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['r:part:P', 'p:one', 'p:two']);
    setCaret(engine, at(engine, 'two'), 0);
    await engine.exec('region:split');
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; p(one) ; R:part() ; p(two)');
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'two'), 0);
  });

  it('in the preamble: a marker of the default (top-level) type', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['p:hello world', 'r:chapter:C', 'p:x']);
    setCaret(engine, at(engine, 'hello world'), 5);
    await engine.exec('region:split');
    await flush();
    expect(roots(engine)).toBe('p(hello) ; R:part() ; p( world) ; R:chapter(C) ; p(x)');
    // the chapter is now a child of the new part
    expect(engine.regions.list.map((r) => [r.type, r.parent?.type ?? null])).toEqual([['part', null], ['chapter', 'part']]);
  });

  it('at the very start of the document: the marker opens the first region (no preamble)', async () => {
    const engine = await makeEditor();
    await build(engine, ['p:text']);
    setCaret(engine, at(engine, 'text'), 0);
    await engine.exec('region:split');
    await flush();
    expect(roots(engine)).toBe('R:section-1() ; p(text)');
    expect(engine.regions.preamble.blocks).toEqual([]);
  });

  it('a heading cut at its end opens the region with a paragraph; mid-text both halves stay headings', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['r:part:P', 'h:Title']);
    setCaret(engine, at(engine, 'Title'), 5);
    await engine.exec('region:split');
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; h(Title) ; R:part() ; p()');
    setCaret(engine, at(engine, 'Title'), 2);
    await engine.exec('region:split');
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; h(Ti) ; R:part() ; h(tle) ; R:part() ; p()');
  });

  it('keys: Mod-Enter splits in a root text block; not in a list item (falls through) nor with a range', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['r:part:P', 'p:abcd']);
    setCaret(engine, at(engine, 'abcd'), 2, 3);
    expect(press(engine, 'Enter', { ctrlKey: true }).preventDefault).not.toHaveBeenCalled();
    setCaret(engine, at(engine, 'abcd'), 2);
    expect(press(engine, 'Enter', { ctrlKey: true }).preventDefault).toHaveBeenCalled();
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; p(ab) ; R:part() ; p(cd)');

    const list = List.create(engine, 'list', { listType: 'bullet' }, null);
    const item = ListItem.create(engine, 'list-item', { text: 'item' }, list.node.id.toString());
    await engine.commit();
    setCaret(engine, engine.blocks.get(item.node.id.toString()), 2);
    const before = roots(engine);
    expect(press(engine, 'Enter', { ctrlKey: true }).preventDefault).not.toHaveBeenCalled();
    expect(roots(engine)).toBe(before);
  });

  it('a code block is left alone: Mod-Enter falls through there', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['r:part:P']);
    engine.insert('code', { text: 'let a = 1;' }, null, 1);
    await engine.commit();
    setCaret(engine, engine.children[1], 4);
    const event = press(engine, 'Enter', { ctrlKey: true });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(await engine.exec('region:split')).toBeDefined();
    await flush();
    expect(engine.regions.list.length).toBe(1);
  });

  it('coexists with todo:toggle on Mod-Enter: the toggle wins in a to-do item, the split applies in a paragraph', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['r:part:P', 'p:abcd']);
    const list = List.create(engine, 'list', { listType: 'todo' }, null);
    const item = ListItem.create(engine, 'list-item', { text: 'task', checked: false }, list.node.id.toString());
    await engine.commit();
    const block = engine.blocks.get(item.node.id.toString());
    setCaret(engine, block, 2);
    expect(press(engine, 'Enter', { ctrlKey: true }).preventDefault).toHaveBeenCalled();
    expect(item.node.data.get('checked')).toBe(true);
    expect(engine.regions.list.length).toBe(1); // no marker added
    setCaret(engine, at(engine, 'abcd'), 2);
    press(engine, 'Enter', { ctrlKey: true });
    await flush();
    expect(engine.regions.list.length).toBe(2);
    expect(item.node.data.get('checked')).toBe(true); // untouched
  });
});

// ─── the protected merges ──────────────────────────────────────────────────

describe('Backspace at the start of a region', () => {
  const setup = async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['p:pre', 'r:part:P', 'p:below', 'r:chapter:C', 'p:ch']);
    return engine;
  };

  it('a quick press does nothing: the text is never merged through the marker; the hold has started', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'below'), 0);
    const event = press(engine, 'Backspace');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(engine.pendingCommand).toMatchObject({ id: 'region:merge-previous', strategy: 'hold' });
    expect(engine.pendingCommand.target).toBe(engine.regions.list[0].marker);
    release(engine, 'Backspace');
    expect(engine.pendingCommand).toBeNull();
    await flush();
    expect(roots(engine)).toBe('p(pre) ; R:part(P) ; p(below) ; R:chapter(C) ; p(ch)');
  });

  it('the hold message names what is merged with; holding 700 ms removes the marker (one undo step, content joins the preamble)', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'below'), 0);
    press(engine, 'Backspace');
    expect(engine.pendingCommand.label).toBe('Merge with the text above');
    expect(engine.pendingCommand.message).toBe('Hold Backspace to merge with the text above');
    expect(engine.commandAnnouncement).toContain('Hold Backspace to merge');
    engine.clock.advance(500);
    expect(engine.pendingCommand.progress).toBeGreaterThan(0.6);
    expect(roots(engine)).toContain('R:part(P)');
    engine.clock.advance(250);
    await flush();
    expect(roots(engine)).toBe('p(pre) ; p(below) ; R:chapter(C) ; p(ch)');
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'below'), 0);
    engine.undo();
    await flush();
    expect(roots(engine)).toBe('p(pre) ; R:part(P) ; p(below) ; R:chapter(C) ; p(ch)');
    expect(labels(engine)).toEqual(['Part 1', 'Chapter 1']);
  });

  it('merging a region into the previous one names it, labels renumber', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'ch'), 0);
    press(engine, 'Backspace');
    expect(engine.pendingCommand.message).toBe('Hold Backspace to merge with “P”');
    engine.clock.advance(750);
    await flush();
    expect(roots(engine)).toBe('p(pre) ; R:part(P) ; p(below) ; p(ch)');
    expect(labels(engine)).toEqual(['Part 1']);
  });

  it('releasing early cancels: nothing changes, no undo step', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'ch'), 0);
    press(engine, 'Backspace');
    engine.clock.advance(300);
    release(engine, 'Backspace');
    engine.clock.advance(1000);
    await flush();
    expect(roots(engine)).toBe('p(pre) ; R:part(P) ; p(below) ; R:chapter(C) ; p(ch)');
    expect(engine.undoManager.canUndo()).toBe(false);
  });

  it('a held Backspace erasing a word stops at the boundary: the repeats are swallowed there, no merge', async () => {
    const engine = await setup();
    const block = at(engine, 'below');
    setCaret(engine, block, 0);
    const repeat = press(engine, 'Backspace', { repeat: true });
    expect(repeat.preventDefault).toHaveBeenCalled();
    expect(engine.pendingCommand).toBeNull(); // a repeat never starts a hold
    engine.clock.advance(2000);
    await flush();
    expect(roots(engine)).toBe('p(pre) ; R:part(P) ; p(below) ; R:chapter(C) ; p(ch)');
  });

  it('the first region of the document (no preamble): Backspace there does nothing, no hold', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['r:part:P', 'p:text']);
    const block = at(engine, 'text');
    setCaret(engine, block, 0);
    const event = press(engine, 'Backspace');
    expect(engine.pendingCommand).toBeNull();
    expect(event.preventDefault).not.toHaveBeenCalled(); // no command: the legacy path runs...
    const input = { inputType: 'deleteContentBackward', preventDefault: vi.fn() };
    block.beforeinput(input); // ...and the engine's own merge finds no partner
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; p(text)');
  });

  it('only a plain paragraph is protected by the hold: a heading first converts to a paragraph (its own Backspace)', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['p:pre', 'r:part:P', 'h:Title']);
    setCaret(engine, at(engine, 'Title'), 0);
    press(engine, 'Backspace');
    expect(engine.pendingCommand).toBeNull();
  });

  it('an EMPTY first block after a marker is protected the same way', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['p:above', 'r:part:P', 'p:']);
    const empty = engine.children[2];
    setCaret(engine, empty, 0);
    press(engine, 'Backspace');
    expect(engine.pendingCommand).toMatchObject({ id: 'region:merge-previous' });
    release(engine, 'Backspace');
    empty.beforeinput({ inputType: 'deleteContentBackward', preventDefault: vi.fn() });
    await flush();
    expect(roots(engine)).toBe('p(above) ; R:part(P) ; p()'); // the engine's own path is vetoed too
  });

  it('exec runs the merge directly, without the hold (confirmation is a keyboard concern)', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'ch'), 1);
    await engine.exec('region:merge-previous');
    await flush();
    expect(roots(engine)).toBe('p(pre) ; R:part(P) ; p(below) ; p(ch)');
    expect(engine.pendingCommand).toBeNull();
  });

  it('exec with { region } merges that region; with nothing to merge into it is a no-op', async () => {
    const engine = await setup();
    await engine.exec('region:merge-previous', { region: engine.regions.list[1] });
    await flush();
    expect(roots(engine)).toBe('p(pre) ; R:part(P) ; p(below) ; p(ch)');

    const lone = await makeEditor(BOOK);
    await build(lone, ['r:part:P', 'p:text']);
    await lone.exec('region:merge-previous', { region: lone.regions.list[0] });
    await flush();
    expect(roots(lone)).toBe('R:part(P) ; p(text)');
  });
});

describe('Delete at the end of a region', () => {
  const setup = async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['r:part:P', 'p:a', 'r:chapter:C', 'p:b', 'r:chapter:D', 'p:c']);
    return engine;
  };

  it('the hold targets the NEXT marker; a quick press does nothing; holding removes that marker', async () => {
    const engine = await setup();
    const a = at(engine, 'a');
    setCaret(engine, a, 1);
    press(engine, 'Delete');
    expect(engine.pendingCommand).toMatchObject({ id: 'region:merge-next', strategy: 'hold' });
    expect(engine.pendingCommand.target).toBe(engine.regions.list[1].marker);
    expect(engine.pendingCommand.message).toBe('Hold Delete to merge “C” into this region');
    release(engine, 'Delete');
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; p(a) ; R:chapter(C) ; p(b) ; R:chapter(D) ; p(c)');

    press(engine, 'Delete');
    engine.clock.advance(750);
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; p(a) ; p(b) ; R:chapter(D) ; p(c)');
    expect(labels(engine)).toEqual(['Part 1', 'Chapter 1']);
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(a, 1);
    engine.undo();
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; p(a) ; R:chapter(C) ; p(b) ; R:chapter(D) ; p(c)');
  });

  it('from the preamble: the first marker is the one removed; the engine merge through it is vetoed', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['p:pre', 'r:part:P', 'p:x']);
    const pre = at(engine, 'pre');
    setCaret(engine, pre, 3);
    press(engine, 'Delete');
    expect(engine.pendingCommand).toMatchObject({ id: 'region:merge-next' });
    release(engine, 'Delete');
    const input = { inputType: 'deleteContentForward', preventDefault: vi.fn() };
    pre.beforeinput(input);
    await flush();
    expect(roots(engine)).toBe('p(pre) ; R:part(P) ; p(x)');
  });

  it('the last block of the document: Delete is native (no hold)', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'c'), 1);
    press(engine, 'Delete');
    expect(engine.pendingCommand).toBeNull();
  });

  it('exec removes the next marker directly', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'a'), 0);
    await engine.exec('region:merge-next');
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; p(a) ; p(b) ; R:chapter(D) ; p(c)');
  });
});

describe('selections that span a marker', () => {
  it('delete the selected text AND the marker inside it, as one undo step', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['p:aaXX', 'r:part:P', 'p:YYbb']);
    const start = at(engine, 'aaXX');
    const end = at(engine, 'YYbb');
    Object.defineProperty(start, 'selection', { configurable: true, get: () => ({ from: 2, to: 4 }) });
    Object.defineProperty(end, 'selection', { configurable: true, get: () => ({ from: 0, to: 2 }) });
    engine.selection = { ...engine.selection, startBlock: start, endBlock: end, anchorBlock: start, focusBlock: end, isCollapsed: false };
    const handled = handleContainerBeforeInput(engine, engine, { inputType: 'deleteContentBackward', preventDefault: vi.fn() });
    expect(handled).toBe(true);
    await flush();
    expect(roots(engine)).toBe('p(aabb)');
    engine.undo();
    await flush();
    expect(roots(engine)).toBe('p(aaXX) ; R:part(P) ; p(YYbb)');
  });
});

// ─── keyless commands ──────────────────────────────────────────────────────

describe('region:insert', () => {
  const setup = async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['p:pre', 'r:part:P', 'p:a', 'r:chapter:C', 'p:b', 'r:part:Q', 'p:c']);
    return engine;
  };

  it('after the current region\'s whole range (sub-regions included), of the same type by default; the caret stays', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'a'), 1);
    await engine.exec('region:insert', { at: 'after' });
    await flush();
    expect(roots(engine)).toBe('p(pre) ; R:part(P) ; p(a) ; R:chapter(C) ; p(b) ; R:part() ; R:part(Q) ; p(c)');
    expect(engine.selection.setCursor).not.toHaveBeenCalled();
  });

  it('before, with a given type and title; one undo step', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'b'), 0);
    await engine.exec('region:insert', { type: 'scene', at: 'before', title: 'S' });
    await flush();
    expect(roots(engine)).toBe('p(pre) ; R:part(P) ; p(a) ; R:scene(S) ; R:chapter(C) ; p(b) ; R:part(Q) ; p(c)');
    engine.undo();
    await flush();
    expect(roots(engine)).toBe('p(pre) ; R:part(P) ; p(a) ; R:chapter(C) ; p(b) ; R:part(Q) ; p(c)');
  });

  it('in the preamble: "before" is the start of the document, "after" the end of the preamble; default type is the top level', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'pre'), 0);
    await engine.exec('region:insert', { at: 'after' });
    await flush();
    expect(roots(engine).startsWith('p(pre) ; R:part() ; R:part(P)')).toBe(true);
    await engine.exec('region:insert', { at: 'before', type: 'chapter' });
    await flush();
    expect(roots(engine).startsWith('R:chapter() ; p(pre)')).toBe(true);
  });

  it('an undeclared type is refused with a warning', async () => {
    const engine = await setup();
    const warn = vi.spyOn(Nabu.prototype, 'warn').mockImplementation(() => {});
    setCaret(engine, at(engine, 'a'), 0);
    const before = roots(engine);
    await engine.exec('region:insert', { type: 'nope' });
    await flush();
    expect(roots(engine)).toBe(before);
    expect(warn).toHaveBeenCalled();
  });
});

describe('region:move', () => {
  const setup = async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['p:pre', 'r:part:A', 'p:a', 'r:chapter:A1', 'p:a1', 'r:part:B', 'p:b', 'r:chapter:B1', 'p:b1', 'r:part:C', 'p:c']);
    return engine;
  };

  it('down: the region moves WITH its sub-regions after its next sibling; labels renumber; one undo step; the caret stays', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'a1'), 1);
    await engine.exec('region:move', { direction: 'down' }); // the caret is in chapter A1: no next sibling of its level
    await flush();
    expect(roots(engine)).toBe('p(pre) ; R:part(A) ; p(a) ; R:chapter(A1) ; p(a1) ; R:part(B) ; p(b) ; R:chapter(B1) ; p(b1) ; R:part(C) ; p(c)');

    setCaret(engine, at(engine, 'a'), 0);
    await engine.exec('region:move', { direction: 'down' });
    await flush();
    expect(roots(engine)).toBe('p(pre) ; R:part(B) ; p(b) ; R:chapter(B1) ; p(b1) ; R:part(A) ; p(a) ; R:chapter(A1) ; p(a1) ; R:part(C) ; p(c)');
    expect(labels(engine)).toEqual(['Part 1', 'Chapter 1', 'Part 2', 'Chapter 2', 'Part 3']);
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'a'), 0);
    engine.undo();
    await flush();
    expect(roots(engine)).toBe('p(pre) ; R:part(A) ; p(a) ; R:chapter(A1) ; p(a1) ; R:part(B) ; p(b) ; R:chapter(B1) ; p(b1) ; R:part(C) ; p(c)');
  });

  it('up: before the previous sibling; at the edges (first / last) nothing moves and nothing is committed', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'c'), 0);
    await engine.exec('region:move', { direction: 'up' });
    await flush();
    expect(roots(engine)).toBe('p(pre) ; R:part(A) ; p(a) ; R:chapter(A1) ; p(a1) ; R:part(C) ; p(c) ; R:part(B) ; p(b) ; R:chapter(B1) ; p(b1)');
    // the first region cannot go up, the last cannot go down
    const first = engine.regions.list[0];
    await engine.exec('region:move', { direction: 'up', region: first });
    await engine.exec('region:move', { direction: 'down', region: engine.regions.tree.at(-1) });
    await flush();
    expect(roots(engine)).toBe('p(pre) ; R:part(A) ; p(a) ; R:chapter(A1) ; p(a1) ; R:part(C) ; p(c) ; R:part(B) ; p(b) ; R:chapter(B1) ; p(b1)');
  });

  it('a child moves among its siblings only (within the same parent), and never past an edge', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['r:part:P', 'r:chapter:X', 'p:x', 'r:chapter:Y', 'p:y', 'r:part:Q', 'r:chapter:Z', 'p:z']);
    await engine.exec('region:move', { direction: 'down', region: engine.regions.list[1] }); // X down: after Y
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; R:chapter(Y) ; p(y) ; R:chapter(X) ; p(x) ; R:part(Q) ; R:chapter(Z) ; p(z)');
    await engine.exec('region:move', { direction: 'down', region: engine.regions.list[2] }); // X is now the last child of P: stays
    await engine.exec('region:move', { direction: 'up', region: engine.regions.list[4] }); // Z is Q's only child: stays
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; R:chapter(Y) ; p(y) ; R:chapter(X) ; p(x) ; R:part(Q) ; R:chapter(Z) ; p(z)');
  });

  it('refuses a missing direction with a warning', async () => {
    const engine = await setup();
    const warn = vi.spyOn(Nabu.prototype, 'warn').mockImplementation(() => {});
    setCaret(engine, at(engine, 'a'), 0);
    await engine.exec('region:move', {});
    expect(warn).toHaveBeenCalled();
  });
});

describe('region:move-up / region:move-down (what a keymap binds)', () => {
  it('move the region holding the caret, from a key', async () => {
    const engine = await makeEditor(BOOK, { keymap: { 'region:move-down': ['Mod-Alt-ArrowDown'], 'region:move-up': ['Mod-Alt-ArrowUp'] } });
    await build(engine, ['r:part:A', 'p:a', 'r:part:B', 'p:b']);
    setCaret(engine, at(engine, 'a'), 0);
    const down = press(engine, 'ArrowDown', { ctrlKey: true, altKey: true });
    await flush();
    expect(down.preventDefault).toHaveBeenCalled();
    expect(roots(engine)).toBe('R:part(B) ; p(b) ; R:part(A) ; p(a)');
    press(engine, 'ArrowUp', { ctrlKey: true, altKey: true });
    await flush();
    expect(roots(engine)).toBe('R:part(A) ; p(a) ; R:part(B) ; p(b)');
  });
});

describe('region:promote / region:demote', () => {
  it('swap the type to the level above / below (the first declared type of that level); no-op at the edges', async () => {
    const engine = await makeEditor({
      part: { level: 1 },
      book: { level: 1 },
      chapter: { level: 2, numbering: 'document' },
      scene: { level: 3 },
    });
    await build(engine, ['r:part:P', 'p:a', 'r:chapter:C', 'p:b']);
    setCaret(engine, at(engine, 'b'), 0);
    await engine.exec('region:demote'); // chapter -> scene
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; p(a) ; R:scene(C) ; p(b)');
    await engine.exec('region:demote'); // already the deepest level: nothing
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; p(a) ; R:scene(C) ; p(b)');
    await engine.exec('region:promote'); // scene -> chapter
    await engine.exec('region:promote'); // chapter -> part (the FIRST declared type of level 1)
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; p(a) ; R:part(C) ; p(b)');
    await engine.exec('region:promote');
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; p(a) ; R:part(C) ; p(b)');
    // one undo step per change
    engine.undo();
    await flush();
    expect(roots(engine)).toBe('R:part(P) ; p(a) ; R:chapter(C) ; p(b)');
  });

  it('works on a given region; the following regions re-nest by their levels', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['r:part:P', 'r:chapter:C1', 'r:chapter:C2', 'r:scene:S']);
    await engine.exec('region:promote', { region: engine.regions.list[2] }); // C2 becomes a part
    await flush();
    expect(engine.regions.list.map((r) => [r.title, r.type, r.parent?.title ?? null])).toEqual([
      ['P', 'part', null], ['C1', 'chapter', 'P'], ['C2', 'part', null], ['S', 'scene', 'C2'],
    ]);
  });
});

describe('region:next / prev / parent', () => {
  const setup = async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['p:pre', 'r:part:P', 'p:a', 'r:chapter:C', 'p:b', 'r:chapter:D', 'r:chapter:E', 'p:e']);
    return engine;
  };

  it('next / prev put the caret at the first text position of the target region', async () => {
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

  it('from the preamble, next goes to the first region; prev has nowhere to go', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'pre'), 0);
    await engine.exec('region:prev');
    await flush();
    expect(engine.selection.setCursor).not.toHaveBeenCalled();
    await engine.exec('region:next');
    await flush();
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'a'), 0);
  });

  it('parent goes to the parent region; a root region has none; an empty target region moves nothing', async () => {
    const engine = await setup();
    setCaret(engine, at(engine, 'b'), 0);
    await engine.exec('region:parent');
    await flush();
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'a'), 0);
    engine.selection.setCursor.mockClear();
    setCaret(engine, at(engine, 'a'), 0);
    await engine.exec('region:parent');
    await flush();
    expect(engine.selection.setCursor).not.toHaveBeenCalled();
    // D is an empty region: there is no text position in it
    setCaret(engine, at(engine, 'b'), 0);
    await engine.exec('region:next'); // C -> D (empty)
    await flush();
    expect(engine.selection.setCursor).not.toHaveBeenCalled();
  });

  it('data.region navigates from that region', async () => {
    const engine = await setup();
    await engine.exec('region:next', { region: engine.regions.list[0] });
    await flush();
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'b'), 0);
  });
});

describe('registration', () => {
  it('default keys, labels (overridable), keymap', async () => {
    const engine = await makeEditor(BOOK, { messages: { split: 'Couper ici', mergePreamble: 'Fusionner avec le texte précédent', hold: ({ keys, label }) => `Maintenez ${keys} : ${label}` } });
    const list = Object.fromEntries(engine.commands.list().filter((c) => c.id.startsWith('region:')).map((c) => [c.id, c]));
    expect(Object.keys(list).sort()).toEqual([
      'region:demote', 'region:insert', 'region:merge-next', 'region:merge-previous', 'region:move', 'region:move-down', 'region:move-up', 'region:next', 'region:parent', 'region:prev', 'region:promote', 'region:split',
    ]);
    expect(list['region:split'].keys).toEqual(['Mod-Enter']);
    expect(list['region:split'].label).toBe('Couper ici');
    expect(list['region:merge-previous'].keys).toEqual(['Backspace', 'Shift-Backspace']);
    expect(list['region:merge-next'].keys).toEqual(['Delete']);
    for (const id of ['region:insert', 'region:move', 'region:move-up', 'region:move-down', 'region:promote', 'region:demote', 'region:next', 'region:prev', 'region:parent']) expect(list[id].keys).toEqual([]);
    await build(engine, ['p:pre', 'r:part:P', 'p:x']);
    setCaret(engine, at(engine, 'x'), 0);
    press(engine, 'Backspace');
    expect(engine.pendingCommand.message).toBe('Maintenez Backspace : Fusionner avec le texte précédent');
  });

  it('the keyless commands can be bound with the keymap option', async () => {
    const engine = await makeEditor(BOOK, { keymap: { 'region:next': ['Mod-Alt-j'] } });
    await build(engine, ['r:part:P', 'p:a', 'r:part:Q', 'p:b']);
    setCaret(engine, at(engine, 'a'), 0);
    const event = press(engine, 'j', { ctrlKey: true, altKey: true });
    await flush();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(at(engine, 'b'), 0);
  });
});
