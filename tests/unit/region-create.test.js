// @ts-nocheck
/**
 * Creating a region where the caret is (ADR 018 §3.5): `region:create`, the `choose` confirmation the `:::` + Space hook opens
 * (here through `commandConfirm.offer`), the slash-menu entries. Validity by place, root vs nested, "next" siblings, the
 * replaced paragraph, one undo step, the caret in the title, messages.
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
import { placeOf, regionChoices, previewPrefix, createOptions } from '$lib/blocks/region/create.js';
import { createMessages } from '$lib/blocks/region/messages.js';

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


const ids = (defs) => defs.map((d) => d.id);
/** The labels of the chooser the editor opened, or null when none is. */
const chooser = (engine) => (engine.pendingCommand?.strategy === 'choose' ? engine.pendingCommand.options.map((o) => o.label) : null);

// ─── validity by place ─────────────────────────────────────────────────────

describe('where a region can be created', () => {
  it('the place is the root or a region body: not a list item, not a title', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('r'), R('part', 'T', [P('in'), LIST('bullet', [LI('item')])])]);
    expect(placeOf(engine, at(engine, 'r'))).toEqual({ parent: null });
    expect(placeOf(engine, at(engine, 'in')).parent).toBe(engine.regions.list[0]);
    expect(placeOf(engine, at(engine, 'item'))).toBeNull();
    expect(placeOf(engine, at(engine, 'T'))).toBeNull();
    expect(placeOf(engine, null)).toBeNull();
  });

  it('at the root every type fits, in declaration order, and nothing is a "next"', async () => {
    const engine = await makeEditor(BOOK);
    const { here, next } = regionChoices(engine, null);
    expect(ids(here)).toEqual(['part', 'chapter', 'scene']);
    expect(next).toEqual([]);
  });

  it('in a region: the strictly deeper types fit; the others are the "next" ones', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [R('chapter', 'C', [P('a')])])]);
    const [part, chapter] = engine.regions.list;
    expect([ids(regionChoices(engine, part).here), ids(regionChoices(engine, part).next)]).toEqual([['chapter', 'scene'], ['part']]);
    expect([ids(regionChoices(engine, chapter).here), ids(regionChoices(engine, chapter).next)]).toEqual([['scene'], ['part', 'chapter']]);
  });

  it('in a region of the deepest level nothing fits inside: only "next" types', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('scene', 'S', [P('a')])]);
    const { here, next } = regionChoices(engine, engine.regions.list[0]);
    expect(here).toEqual([]);
    expect(ids(next)).toEqual(['part', 'chapter', 'scene']);
  });

  it('the default types carry readable names, an undeclared name falls back to the id', async () => {
    const engine = await makeEditor(undefined);
    expect(regionChoices(engine, null).here.map((d) => d.name)).toEqual(['Section', 'Subsection', 'Sub-subsection']);
    const book = await makeEditor(BOOK);
    expect(regionChoices(book, null).here.map((d) => d.name)).toEqual(['Part', 'Chapter', 'scene']);
  });
});

// ─── the chooser ───────────────────────────────────────────────────────────

describe('the chooser (strategy choose)', () => {
  it('at the root: the types in declaration order, by name', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('')]);
    setCaret(engine, at(engine, ''), 0);
    expect(engine.commandConfirm.offer('region:create')).toBe(true);
    expect(chooser(engine)).toEqual(['Part', 'Chapter', 'scene']);
    expect(engine.pendingCommand.message).toContain('3 types');
  });

  it('in a chapter: the deeper types first, then the "next" siblings (the chapter\'s own type first)', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [R('chapter', 'C', [P('')])])]);
    setCaret(engine, at(engine, ''), 0);
    engine.commandConfirm.offer('region:create');
    expect(chooser(engine)).toEqual(['scene', 'Next chapter', 'Next part']);
  });

  it('nowhere to create (a list item): nothing opens', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [LIST('bullet', [LI('')])]);
    setCaret(engine, at(engine, ''), 0);
    expect(engine.commandConfirm.offer('region:create')).toBe(false);
    expect(engine.pendingCommand).toBeNull();
  });

  it('choosing replaces the typed `::: ` paragraph; one undo step gives the paragraph back', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('a'), P('::: ')]);
    const before = doc(engine);
    setCaret(engine, at(engine, '::: '), 4);
    engine.commandConfirm.offer('region:create');
    engine.commandConfirm.choose(1); // chapter
    await flush();
    expect(engine.pendingCommand).toBeNull();
    expect(doc(engine)).toBe('p(a) ; R:chapter(){p()}');
    await expectOneUndo(engine, before);
  });

  it('Escape cancels: the paragraph keeps the typed text and no step exists', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('::: ')]);
    setCaret(engine, at(engine, '::: '), 4);
    engine.commandConfirm.offer('region:create');
    press(engine, 'Escape');
    expect(engine.pendingCommand).toBeNull();
    expect(doc(engine)).toBe('p(::: )');
    expect(engine.undoManager.canUndo()).toBe(false);
  });

  it('the keyboard picks: ArrowDown then Enter', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('')]);
    setCaret(engine, at(engine, ''), 0);
    engine.commandConfirm.offer('region:create');
    press(engine, 'ArrowDown');
    press(engine, 'Enter');
    await flush();
    expect(doc(engine)).toBe('R:chapter(){p()}');
  });

  it('labels and prompt are overridable', async () => {
    const engine = await makeEditor(BOOK, { messages: { createOption: ({ name }) => `Nouveau ${name}`, createNext: ({ name }) => `Suite : ${name}`, chooser: ({ count }) => `${count} types` } });
    await build(engine, [R('chapter', 'C', [P('')])]);
    setCaret(engine, at(engine, ''), 0);
    engine.commandConfirm.offer('region:create');
    expect(chooser(engine)).toEqual(['Nouveau scene', 'Suite : Chapter', 'Suite : Part']);
    expect(engine.pendingCommand.message).toBe('3 types');
  });
});

// ─── region:create (exec) ──────────────────────────────────────────────────

describe('region:create', () => {
  it('conversion shape: the empty paragraph becomes a region with an empty title and one empty paragraph; caret in the title', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('a'), P(''), P('z')]);
    setCaret(engine, engine.children[1], 0);
    await engine.exec('region:create', { type: 'part' });
    await flush();
    expect(doc(engine)).toBe('p(a) ; R:part(){p()} ; p(z)');
    const region = engine.regions.list[0];
    expect(region.title).toBe('');
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(region.block, 0);
  });

  it('is ONE undo step', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('a'), P('')]);
    const before = doc(engine);
    setCaret(engine, engine.children[1], 0);
    await engine.exec('region:create', { type: 'chapter' });
    await flush();
    await expectOneUndo(engine, before);
  });

  it('root vs nested: in a region body a deeper type nests', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('a'), P(''), P('b')])]);
    setCaret(engine, at(engine, ''), 0);
    await engine.exec('region:create', { type: 'chapter' });
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(a) R:chapter(){p()} p(b)}');
  });

  it('without a type: the top type at the root, the shallowest deeper type in a region, the region\'s own type at the deepest level', async () => {
    let engine = await makeEditor(BOOK);
    await build(engine, [P('')]);
    setCaret(engine, at(engine, ''), 0);
    await engine.exec('region:create');
    await flush();
    expect(doc(engine)).toBe('R:part(){p()}');

    engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('')])]);
    setCaret(engine, at(engine, ''), 0);
    await engine.exec('region:create');
    await flush();
    expect(doc(engine)).toBe('R:part(P){R:chapter(){p()}}');

    engine = await makeEditor(BOOK);
    await build(engine, [R('scene', 'S', [P('')])]);
    setCaret(engine, at(engine, ''), 0);
    await engine.exec('region:create');
    await flush();
    expect(doc(engine)).toBe('R:scene(S) ; R:scene(){p()}');
  });

  it('a "next" type is a SIBLING after the region and takes what follows the caret', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [R('chapter', 'C', [P('a'), P(''), P('b')])]), P('tail')]);
    setCaret(engine, at(engine, ''), 0);
    await engine.exec('region:create', { type: 'chapter' });
    await flush();
    expect(doc(engine)).toBe('R:part(P){R:chapter(C){p(a)} R:chapter(){p(b)}} ; p(tail)');
  });

  it('a "next" type shallower than the parent climbs to the ancestor whose parent accepts it, keeping the document order', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'A', [R('chapter', 'C1', [P('a'), P(''), P('b')]), R('chapter', 'C2', [P('c')])])]);
    setCaret(engine, at(engine, ''), 0);
    await engine.exec('region:create', { type: 'part' });
    await flush();
    expect(doc(engine)).toBe('R:part(A){R:chapter(C1){p(a)}} ; R:part(){p(b) R:chapter(C2){p(c)}}');
  });

  it('a non-empty paragraph stays: the region follows it (also a "next" one)', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('keep'), P('x')])]);
    setCaret(engine, at(engine, 'keep'), 2);
    await engine.exec('region:create', { type: 'chapter' });
    await flush();
    expect(doc(engine)).toBe('R:part(P){p(keep) R:chapter(){p()} p(x)}');
  });

  it('refuses where no region fits (a list) and for an undeclared type; nothing changes', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [LIST('bullet', [LI('')]), P('')]);
    const before = doc(engine);
    setCaret(engine, at(engine, ''), 0);
    await engine.exec('region:create', { type: 'part' });
    await flush();
    expect(doc(engine)).toBe(before);
    setCaret(engine, engine.children[1], 0);
    vi.spyOn(engine, 'warn').mockImplementation(() => {});
    await engine.exec('region:create', { type: 'nope' });
    await flush();
    expect(doc(engine)).toBe(before);
    expect(engine.undoManager.canUndo()).toBe(false);
  });
});

// ─── slash menu ────────────────────────────────────────────────────────────

describe('slash-menu entries', () => {
  const titles = (engine, block) => engine.slashCommands.filter((c) => c.when(engine, block)).map((c) => c.title);

  it('one entry per declared type, named by the type', async () => {
    const engine = await makeEditor(BOOK);
    expect(engine.slashCommands.map((c) => c.title)).toEqual(['Part', 'Chapter', 'scene']);
    const defaults = await makeEditor(undefined);
    expect(defaults.slashCommands.map((c) => c.title)).toEqual(['Section', 'Subsection', 'Sub-subsection']);
  });

  it('shown only for the types valid at the caret\'s place', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('r'), R('part', 'P', [P('p'), R('chapter', 'C', [P('c'), LIST('bullet', [LI('item')])])]), R('scene', 'S', [P('s')])]);
    expect(titles(engine, at(engine, 'r'))).toEqual(['Part', 'Chapter', 'scene']);
    expect(titles(engine, at(engine, 'p'))).toEqual(['Chapter', 'scene']);
    expect(titles(engine, at(engine, 'c'))).toEqual(['scene']);
    expect(titles(engine, at(engine, 's'))).toEqual([]);
    expect(titles(engine, at(engine, 'item'))).toEqual([]);
  });

  it('running an entry creates the region the same way (caret in the title)', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('')])]);
    setCaret(engine, at(engine, ''), 0);
    await engine.slashCommands.find((c) => c.title === 'Chapter').run(engine);
    await flush();
    expect(doc(engine)).toBe('R:part(P){R:chapter(){p()}}');
    expect(engine.selection.setCursor).toHaveBeenLastCalledWith(engine.regions.list[1].block, 0);
  });

  it('titles are overridable', async () => {
    const engine = await makeEditor(BOOK, { messages: { slash: ({ name }) => `Insérer : ${name}` } });
    expect(engine.slashCommands[0].title).toBe('Insérer : Part');
  });
});


// ─── groups, number previews, footer (lot D) ───────────────────────────────

describe('the chooser in groups, with the number each type would get', () => {
  const pending = (engine) => engine.pendingCommand;
  const rows = (engine) => pending(engine).options.map((o) => [o.group, o.label, o.detail ?? '']);

  it('at the root: one "Here" group with every type, no "Next"; the details are the prefixes', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('')]);
    setCaret(engine, at(engine, ''), 0);
    engine.commandConfirm.offer('region:create');
    expect(rows(engine)).toEqual([['Here', 'Part', 'Part 1'], ['Here', 'Chapter', 'Chapter 1'], ['Here', 'scene', '1']]);
    expect(pending(engine).footer).toBe('↑↓ choose · ↵ create · Esc cancel');
  });

  it('in a region: "Here" (deeper types) then "Next" (own type first), with the numbers they would get', async () => {
    const engine = await makeEditor(undefined);
    await build(engine, [R('section-1', 'One', [R('section-2', 'A', [P('x')]), R('section-2', 'B', [P('')]), P('after')]), R('section-1', 'Two', [P('t')])]);
    setCaret(engine, at(engine, ''), 0);
    engine.commandConfirm.offer('region:create');
    // caret in "1.2 B": a sub-subsection is its first (1.2.1); the next subsection would be 1.3, the next section 2. ("Two" becomes 3.)
    expect(rows(engine)).toEqual([
      ['Here', 'Sub-subsection', '1.2.1'],
      ['Next', 'Next subsection', '1.3'],
      ['Next', 'Next section', '2.'],
    ]);
  });

  it('the "Next" group is absent at the deepest level when nothing is shallower; the "Here" group when nothing fits inside', async () => {
    const engine = await makeEditor(undefined);
    await build(engine, [R('section-3', 'S', [P('')])]);
    setCaret(engine, at(engine, ''), 0);
    engine.commandConfirm.offer('region:create');
    expect([...new Set(pending(engine).options.map((o) => o.group))]).toEqual(['Next']);
    expect(pending(engine).options.map((o) => o.id)).toEqual(['section-3', 'section-1', 'section-2']);
  });

  it('groups, the footer and the other texts are overridable', async () => {
    const engine = await makeEditor(BOOK, { messages: { groupHere: 'Ici', groupNext: 'Ensuite', chooserFooter: '↑↓ choisir' } });
    await build(engine, [R('part', 'P', [P('')])]);
    setCaret(engine, at(engine, ''), 0);
    engine.commandConfirm.offer('region:create');
    expect([...new Set(pending(engine).options.map((o) => o.group))]).toEqual(['Ici', 'Ensuite']);
    expect(pending(engine).footer).toBe('↑↓ choisir');
  });

  it('digits count across the groups, and the highlight crosses them', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('')])]);
    setCaret(engine, at(engine, ''), 0);
    engine.commandConfirm.offer('region:create');
    expect(pending(engine).options.map((o) => o.id)).toEqual(['chapter', 'scene', 'part']);
    press(engine, 'ArrowDown'); press(engine, 'ArrowDown');
    expect(pending(engine).selectedIndex).toBe(2); // first of "Next"
    press(engine, '3');
    await flush();
    expect(doc(engine)).toBe('R:part(P) ; R:part(){p()}'); // the "Next part" sibling (the empty caret paragraph is replaced)
  });
});

describe('previewPrefix: the prefix a new region would get', () => {
  const defOf = (engine, id) => engine.regions.config.types.get(id);
  const preview = (engine, id, block, parent) => previewPrefix(engine, defOf(engine, id), block, parent);

  it('"document" numbering continues over the document, "parent" numbering counts the siblings and carries the path', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [
      R('part', 'P1', [R('chapter', 'C1', [P('a')]), R('chapter', 'C2', [P('b'), P('c')])]),
      R('part', 'P2', [P('d')]),
    ]);
    const [, , c2, p2] = engine.regions.list;
    expect(preview(engine, 'chapter', at(engine, 'd'), p2)).toBe('Chapter 3'); // inside P2: the third chapter of the document
    expect(preview(engine, 'part', at(engine, 'd'), p2)).toBe('Part 3'); // "next" of P2
    expect(preview(engine, 'scene', at(engine, 'd'), p2)).toBe('2.1'); // first scene directly in P2 (the chapters' index is not part of its path)
    expect(preview(engine, 'scene', at(engine, 'b'), c2)).toBe('1.2.1'); // path = Part 1 > Chapter 2 > scene 1
    expect(preview(engine, 'chapter', at(engine, 'b'), c2)).toBe('Chapter 3'); // "next" of C2, in P1
  });

  it('counts only what comes BEFORE the place: later siblings would be renumbered, not counted', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P1', [P('a')]), P('mid'), R('part', 'P2', [P('b')])]);
    expect(preview(engine, 'part', at(engine, 'mid'), null)).toBe('Part 2');
    expect(preview(engine, 'part', at(engine, 'a'), engine.regions.list[0])).toBe('Part 2'); // "next" of P1, after it
    await build(engine, [P('mid'), R('part', 'P1', [P('a')])]);
    expect(preview(engine, 'part', at(engine, 'mid'), null)).toBe('Part 1');
  });

  it('existing sub-regions before the caret count', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('chapter', 'C', [R('scene', 'S1', [P('x')]), P('y'), R('scene', 'S2', [P('z')]), P('w')])]);
    const chapter = engine.regions.list[0];
    expect(preview(engine, 'scene', at(engine, 'y'), chapter)).toBe('1.2');
    expect(preview(engine, 'scene', at(engine, 'w'), chapter)).toBe('1.3');
  });

  it('an unnumbered type shows only what its label shows', async () => {
    const engine = await makeEditor({ ...BOOK, note: { level: 3, numbering: 'none', label: '{title}' } });
    await build(engine, [R('part', 'P', [P('a')])]);
    expect(preview(engine, 'note', at(engine, 'a'), engine.regions.list[0])).toBe('');
  });

  it('the default types: "1." sections, "1.1" subsections', async () => {
    const engine = await makeEditor(undefined);
    await build(engine, [R('section-1', 'One', [P('a')])]);
    expect(preview(engine, 'section-1', at(engine, 'a'), engine.regions.list[0])).toBe('2.');
    expect(preview(engine, 'section-2', at(engine, 'a'), engine.regions.list[0])).toBe('1.1');
  });
});

describe('createOptions (pure)', () => {
  it('the options carry group and detail, in the order Here then Next (own type first)', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [R('chapter', 'C', [P('')])])]);
    const text = createMessages(undefined);
    const options = createOptions(engine, at(engine, ''), engine.regions.list[1], text);
    expect(options.map((o) => [o.group, o.id, o.detail])).toEqual([
      ['Here', 'scene', '1.1.1'],
      ['Next', 'chapter', 'Chapter 2'],
      ['Next', 'part', 'Part 2'],
    ]);
  });
});
