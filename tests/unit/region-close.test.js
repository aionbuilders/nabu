// @ts-nocheck
/**
 * Closing a region from inside it (ADR 018 §3.5, lot E): `:::` + Enter and `region:close`. The trigger conditions, the direct
 * close with one region, the chooser (innermost first), the effect on the tree (innermost / middle / outermost region closed
 * from the middle of a scene), the caret, one undo step, `exec` with `{ region }`, the equivalence with `region:exit` at the end.
 * Real Nabu over the Loro tree; the DOM selection is a stub, time is a fake clock.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { HeadingExtension } from '$lib/blocks/heading/index.js';
import { ListExtension, ListItemExtension } from '$lib/blocks/list/index.js';
import { ToggleExtension } from '$lib/blocks/toggle/index.js';
import { CodeExtension } from '$lib/blocks/code/index.js';
import { BlockExtension } from '$lib/blocks/block.extension.js';
import { RichTextExtension } from '$lib/behaviors/text/index.js';
import { RegionsExtension } from '$lib/blocks/region/index.js';

const BOOK = {
  part: { level: 1, name: 'Part', label: 'Part {index}' },
  chapter: { level: 2, name: 'Chapter', label: 'Chapter {index}', numbering: 'document' },
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



/** The (stubbed) caret goes to the end of `block`'s text, then the Enter reaches the hooks the way `dispatchEventToSelection` runs them. True when a hook took it. */
async function enter(engine, block) {
  const text = block.behaviors.get('text').text;
  setCaret(engine, block, text.length);
  const event = { inputType: 'insertParagraph', preventDefault: vi.fn() };
  let taken = false;
  for (const hook of engine.hooks.get('onBeforeInput') ?? []) if (hook(engine, event, block) === engine.BREAK) { taken = true; break; }
  await flush();
  return taken;
}

const chooser = (engine) => (engine.pendingCommand?.strategy === 'choose' ? engine.pendingCommand.options : null);
const lastCaret = (engine) => engine.selection.setCursor.mock.calls.at(-1);

/** part P > chapter C > scene S, the `:::` in the middle of the scene; text before and after at every level. */
const NESTED = () => [R('part', 'P', [P('a'), R('chapter', 'C', [P('b'), R('scene', 'S', [P('c'), P(':::'), P('d')]), P('e')]), P('f')]), P('tail')];

describe('the trigger (:::  + Enter)', () => {
  it('a `:::` paragraph that is a direct child of a region body, caret at its end: the Enter is taken (trailing spaces allowed)', async () => {
    for (const text of [':::', ':::  ']) {
      const engine = await makeEditor(BOOK);
      await build(engine, [R('chapter', 'C', [P('a'), P(text), P('z')])]);
      expect(await enter(engine, at(engine, text))).toBe(true);
      expect(doc(engine)).toBe('R:chapter(C){p(a)} ; p(z)');
    }
  });

  it('is an ordinary Enter everywhere else: outside any region, other text, caret not at the end, a selection, a list item', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P(':::'), R('chapter', 'C', [P('::: x'), P(':::'), P(' :::'), LIST('bullet', [LI(':::')])])]);
    const before = doc(engine);
    expect(await enter(engine, engine.children[0])).toBe(false); // the root
    expect(await enter(engine, at(engine, '::: x'))).toBe(false);
    expect(await enter(engine, at(engine, ' :::'))).toBe(false);
    expect(await enter(engine, at(engine, ':::', 1))).toBe(false);
    const mark = engine.regions.list[0].block.children[1];
    setCaret(engine, mark, 1);
    expect(await (async () => { const e = { inputType: 'insertParagraph', preventDefault: vi.fn() }; for (const h of engine.hooks.get('onBeforeInput')) if (h(engine, e, mark) === engine.BREAK) return true; return false; })()).toBe(false); // caret at 1
    setCaret(engine, mark, 0, 3);
    expect(await (async () => { const e = { inputType: 'insertParagraph', preventDefault: vi.fn() }; for (const h of engine.hooks.get('onBeforeInput')) if (h(engine, e, mark) === engine.BREAK) return true; return false; })()).toBe(false); // a selection
    expect(doc(engine)).toBe(before);
    expect(engine.pendingCommand).toBeNull();
  });

  it('only the Enter: a space or a letter after `:::` is not taken by the close', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('chapter', 'C', [P(':::')])]);
    const block = at(engine, ':::');
    setCaret(engine, block, 3);
    for (const hook of engine.hooks.get('onBeforeInput') ?? []) expect(hook(engine, { inputType: 'insertText', data: 'x', preventDefault: vi.fn() }, block)).not.toBe(engine.BREAK);
    expect(doc(engine)).toBe('R:chapter(C){p(:::)}');
  });
});

describe('closing with ONE region: direct, no chooser', () => {
  it('what follows leaves the region and comes right after it; the caret goes to its start', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('pre'), R('chapter', 'C', [P('a'), P(':::'), P('b'), P('c')]), P('tail')]);
    expect(await enter(engine, at(engine, ':::'))).toBe(true);
    expect(engine.pendingCommand).toBeNull();
    expect(doc(engine)).toBe('p(pre) ; R:chapter(C){p(a)} ; p(b) ; p(c) ; p(tail)');
    expect(lastCaret(engine)).toEqual([at(engine, 'b'), 0]);
  });

  it('nothing follows: an empty paragraph is created right after the region and gets the caret', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('chapter', 'C', [P('a'), P(':::')]), P('tail')]);
    await enter(engine, at(engine, ':::'));
    expect(doc(engine)).toBe('R:chapter(C){p(a)} ; p() ; p(tail)');
    const created = engine.children[1];
    expect(lastCaret(engine)).toEqual([created, 0]);
  });

  it('the first block that follows is a region: the caret goes to its title', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('a'), P(':::'), R('chapter', 'C', [P('b')])])]);
    await enter(engine, at(engine, ':::'));
    expect(doc(engine)).toBe('R:part(P){p(a)} ; R:chapter(C){p(b)}');
    expect(lastCaret(engine)).toEqual([engine.regions.list[1].block, 0]);
  });

  it('is ONE undo step; the undo gives the `:::` back', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('chapter', 'C', [P('a'), P(':::'), P('b')]), P('tail')]);
    const before = doc(engine);
    await enter(engine, at(engine, ':::'));
    expect(doc(engine)).not.toBe(before);
    await expectOneUndo(engine, before);
  });
});

describe('the chooser (2 regions or more)', () => {
  it('lists the regions that contain the caret, innermost first: label, detail = numbering prefix', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, NESTED());
    const before = doc(engine);
    expect(await enter(engine, at(engine, ':::'))).toBe(true);
    expect(doc(engine)).toBe(before); // the Enter is not applied, nothing moved
    const options = chooser(engine);
    expect(options.map((o) => o.label)).toEqual(['Close scene 1.1.1 — S', 'Close Chapter 1 — C', 'Close Part 1 — P']);
    expect(options.map((o) => o.detail)).toEqual(['1.1.1', 'Chapter 1', 'Part 1']);
    expect(engine.pendingCommand.footer).toBe('↑↓ choose · ↵ close · Esc cancel');
    expect(engine.pendingCommand.message).toContain('3 choices');
  });

  it('the part of the label after the dash is omitted for an empty title; no title, no dash', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', '', [R('scene', '', [P(':::')])])]);
    await enter(engine, at(engine, ':::'));
    expect(chooser(engine).map((o) => o.label)).toEqual(['Close scene 1.1', 'Close Part 1']);
    for (const o of chooser(engine)) expect(o.label).not.toContain('—');
  });

  it('the labels are overridable', async () => {
    const engine = await makeEditor(BOOK, { messages: { closeOption: ({ typeName, title }) => `Fermer ${typeName} ${title}`, closeFooter: 'pied', closeChooser: ({ count }) => `${count} choix` } });
    await build(engine, [R('part', 'P', [R('chapter', 'C', [P(':::')])])]);
    await enter(engine, at(engine, ':::'));
    expect(chooser(engine).map((o) => o.label)).toEqual(['Fermer Chapter C', 'Fermer Part P']);
    expect(engine.pendingCommand.footer).toBe('pied');
    expect(engine.pendingCommand.message).toBe('2 choix');
  });

  it('Escape cancels: nothing changes, no undo step, the paragraph keeps `:::`', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, NESTED());
    const before = doc(engine);
    await enter(engine, at(engine, ':::'));
    press(engine, 'Escape');
    expect(engine.pendingCommand).toBeNull();
    expect(doc(engine)).toBe(before);
    expect(engine.undoManager.canUndo()).toBe(false);
  });

  it('the keyboard picks (arrows, Enter, a digit) and the choice runs', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, NESTED());
    await enter(engine, at(engine, ':::'));
    press(engine, 'ArrowDown');
    press(engine, 'Enter'); // the chapter
    await flush();
    expect(engine.pendingCommand).toBeNull();
    expect(doc(engine)).toBe('R:part(P){p(a) R:chapter(C){p(b) R:scene(S){p(c)}} p(d) p(e) p(f)} ; p(tail)');

    const again = await makeEditor(BOOK);
    await build(again, NESTED());
    await enter(again, at(again, ':::'));
    press(again, '3');
    await flush();
    expect(doc(again)).toBe('R:part(P){p(a) R:chapter(C){p(b) R:scene(S){p(c)}}} ; p(d) ; p(e) ; p(f) ; p(tail)');
  });
});

describe('the effect, from the middle of a scene', () => {
  it('the innermost region (scene): its following siblings leave it, nothing else moves', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, NESTED());
    setCaret(engine, at(engine, ':::'), 3);
    await engine.exec('region:close');
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(a) R:chapter(C){p(b) R:scene(S){p(c)} p(d) p(e)} p(f)} ; p(tail)');
    expect(lastCaret(engine)).toEqual([at(engine, 'd'), 0]);
  });

  it('the middle region (chapter): the following blocks of the scene, then of the chapter, follow it in the part', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, NESTED());
    const chapter = engine.regions.list[1];
    setCaret(engine, at(engine, ':::'), 3);
    await engine.exec('region:close', { region: chapter });
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(a) R:chapter(C){p(b) R:scene(S){p(c)}} p(d) p(e) p(f)} ; p(tail)');
    expect(lastCaret(engine)).toEqual([at(engine, 'd'), 0]);
    expect(engine.regions.list.map((r) => r.type)).toEqual(['part', 'chapter', 'scene']);
  });

  it('the outermost region (part): everything that followed goes to the root, in document order', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, NESTED());
    setCaret(engine, at(engine, ':::'), 3);
    await engine.exec('region:close', { region: engine.regions.list[0].block });
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(a) R:chapter(C){p(b) R:scene(S){p(c)}}} ; p(d) ; p(e) ; p(f) ; p(tail)');
    expect(lastCaret(engine)).toEqual([at(engine, 'd'), 0]);
  });

  it('moved sub-regions stay valid in their new level (the nesting rule holds)', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [R('chapter', 'C', [P('b'), P(':::'), P('x'), R('scene', 'S', [P('s')]), P('y')]), R('chapter', 'C2', [P('z')])])]);
    const before = doc(engine);
    setCaret(engine, at(engine, ':::'), 3);
    await engine.exec('region:close');
    await flush();
    expect(doc(engine)).toBe('R:part(P){R:chapter(C){p(b)} p(x) R:scene(S){p(s)} p(y) R:chapter(C2){p(z)}}');
    await expectOneUndo(engine, before);
    setCaret(engine, at(engine, ':::'), 3);
    await engine.exec('region:close', { region: engine.regions.list[0] });
    await flush();
    expect(doc(engine)).toBe('R:part(P){R:chapter(C){p(b)}} ; p(x) ; R:scene(S){p(s)} ; p(y) ; R:chapter(C2){p(z)}');
    expect(engine.regions.list.map((r) => r.parent?.title ?? null)).toEqual([null, 'P', null, null]);
  });

  it('closing the middle region is ONE undo step that gives the `:::` back', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, NESTED());
    const before = doc(engine);
    setCaret(engine, at(engine, ':::'), 3);
    await engine.exec('region:close', { region: engine.regions.list[1] });
    await flush();
    await expectOneUndo(engine, before);
    expect(at(engine, ':::')).toBeTruthy();
  });
});

describe('region:close by exec', () => {
  it('without data: the innermost region; with { region }: that one (a Region, its block or its id)', async () => {
    for (const pick of [(e) => e.regions.list[1], (e) => e.regions.list[1].block, (e) => e.regions.list[1].block.id]) {
      const engine = await makeEditor(BOOK);
      await build(engine, NESTED());
      setCaret(engine, at(engine, ':::'), 3);
      await engine.exec('region:close', { region: pick(engine) });
      await flush();
      expect(doc(engine)).toBe('R:part(P){p(a) R:chapter(C){p(b) R:scene(S){p(c)}} p(d) p(e) p(f)} ; p(tail)');
    }
  });

  it('runs directly, with no chooser', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, NESTED());
    setCaret(engine, at(engine, ':::'), 3);
    await engine.exec('region:close');
    expect(engine.pendingCommand).toBeNull();
  });

  it('refuses a region that does not contain the caret, and a caret that is not on a closing mark', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('chapter', 'A', [P(':::')]), R('chapter', 'B', [P('x')])]);
    const before = doc(engine);
    setCaret(engine, at(engine, ':::'), 3);
    await engine.exec('region:close', { region: engine.regions.list[1] });
    setCaret(engine, at(engine, 'x'), 1);
    await engine.exec('region:close');
    await flush();
    expect(doc(engine)).toBe(before);
    expect(engine.undoManager.canUndo()).toBe(false);
  });

  it('`when` holds on a closing mark in a region body only', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P(':::'), R('chapter', 'C', [P(':::'), P('x')])]);
    const when = (block) => { setCaret(engine, block, 0); return engine.commands.entries.get('region:close').def.when(engine.commands.context(null)); };
    expect(when(engine.children[0])).toBe(false);
    expect(when(engine.regions.list[0].block.children[0])).toBe(true);
    expect(when(at(engine, 'x'))).toBe(false);
  });
});

describe('at the end of a region', () => {
  it('`:::` + Enter closing the region gives what Mod-Shift-Enter gives from the same position', async () => {
    const closed = await makeEditor(BOOK);
    await build(closed, [R('part', 'P', [R('chapter', 'C', [P('a'), P(':::')]), P('after')]), P('tail')]);
    await enter(closed, at(closed, ':::'));
    // the chooser is open (2 regions): close the chapter
    closed.commandConfirm.choose(0);
    await flush();

    const exited = await makeEditor(BOOK);
    await build(exited, [R('part', 'P', [R('chapter', 'C', [P('a'), P('')]), P('after')]), P('tail')]);
    const empty = exited.regions.list[1].block.children[1];
    setCaret(exited, empty, 0);
    await exited.exec('region:exit', { region: exited.regions.list[1] });
    await flush();
    // exit moves the (empty) caret paragraph itself, close creates a fresh one: same outline
    expect(doc(closed)).toBe(doc(exited));
    expect(doc(closed)).toBe('R:part(P){R:chapter(C){p(a)} p() p(after)} ; p(tail)');
  });

  it('with the last paragraph of a single region it is the same too', async () => {
    const closed = await makeEditor(BOOK);
    await build(closed, [R('chapter', 'C', [P('a'), P(':::')])]);
    await enter(closed, at(closed, ':::'));
    const exited = await makeEditor(BOOK);
    await build(exited, [R('chapter', 'C', [P('a'), P('')])]);
    setCaret(exited, exited.regions.list[0].block.children[1], 0);
    await exited.exec('region:exit');
    await flush();
    expect(doc(closed)).toBe(doc(exited));
  });
});
