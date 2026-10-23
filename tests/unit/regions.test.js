// @ts-nocheck
/**
 * Unit tests for Regions as CONTAINERS (ADR 018, lot A1 — the data model): the block (header = title, body = children),
 * the title as a locked field (Enter, Backspace / Delete, flat paste, merge veto), the registry computed from the tree,
 * the normalizer (placement R1, nesting R2), `insertRegion`, JSON and clipboard round trips.
 * Real Nabu with a stubbed selection (there is no DOM selection in unit tests).
 */

import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension, Paragraph } from '$lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension, List, ListItem } from '$lib/blocks/list/index.js';
import { ToggleExtension, ToggleBlock } from '$lib/blocks/toggle/index.js';
import { BlockExtension } from '$lib/blocks/block.extension.js';
import { RichTextExtension } from '$lib/behaviors/text/index.js';
import { RegionsExtension, Regions, insertRegion, createRegion, normalizeRegions } from '$lib/blocks/region/index.js';
import { mergeCrossesRegion } from '$lib/blocks/region/facts.js';
import { FullPreset } from '$lib/presets.js';

const BOOK = {
  part: { level: 1, label: 'Part {index}' },
  chapter: { level: 2, label: 'Chapter {index}', numbering: 'document' },
  scene: { level: 3, label: '{path} {title}', fields: { pov: 'text' } },
};

async function makeEditor(options) {
  const engine = new Nabu({
    extensions: [ParagraphExtension, ListExtension, ListItemExtension, ToggleExtension, RichTextExtension, RegionsExtension(options && { types: options }), BlockExtension],
  });
  await engine.commit();
  engine.selection = { anchorBlock: null, focusBlock: null, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn(), startOffset: 0 };
  return engine;
}

/** Fixture specs: `P(text)`, `R(type, title, children, extra)`. */
const P = (text = '') => ({ type: 'paragraph', text });
const R = (regionType, title = '', children = [], extra = {}) => ({ type: 'region', regionType, title, children, ...extra });

/** Replaces the document by `specs` (a nested tree), then starts from a clean undo history. */
async function build(engine, specs) {
  for (const b of [...engine.children]) engine.delete(b);
  const add = (spec, parentId, index) => {
    const props = spec.type === 'region' ? { regionType: spec.regionType, title: spec.title, fields: spec.fields } : { text: spec.text };
    const block = engine.insert(spec.type, props, parentId, index);
    (spec.children ?? []).forEach((child, i) => add(child, block.id, i));
    return block;
  };
  specs.forEach((spec, i) => add(spec, null, i));
  await engine.commit();
  engine.undoManager.clear();
}

/** The model as an outline: `R:type(title){children}`, `p(text)`, `list{li(text)}`… */
const fmt = (node) => {
  const type = node.data.get('type');
  const text = node.data.get('text')?.toString() ?? '';
  const kids = (node.children() ?? []).map(fmt).join(' ');
  const name = type === 'region' ? `R:${node.data.get('regionType')}` : type === 'paragraph' ? 'p' : type === 'list-item' ? 'li' : type;
  return `${name}(${text || (type === 'region' || type === 'list' ? '' : '∅')})${kids ? `{${kids}}` : ''}`;
};
const doc = (engine) => engine.tree.roots().map(fmt).join(' ; ');

/** The live block whose own text is `text` (first match, document order). */
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

/** Pins the model caret of a block (no DOM selection in unit tests). */
function pin(engine, block, from, to = from) {
  Object.defineProperty(block.behaviors.get('text'), 'selection', { configurable: true, get: () => ({ from, to, isCollapsed: from === to }) });
  Object.defineProperty(block, 'selection', { configurable: true, get: () => ({ from, to, isCollapsed: from === to }) });
  engine.selection.anchorBlock = block;
  engine.selection.focusBlock = block;
  engine.selection.isCollapsed = from === to;
  engine.selection.startOffset = from;
}

/** What Nabu#dispatchEventToSelection does: the target block's beforeinput. */
function key(block, inputType) {
  const event = { inputType, data: null, preventDefault: vi.fn(), getTargetRanges: () => [] };
  return block.beforeinput(event);
}

async function settle(engine) {
  await engine.commit();
  await tick();
  await new Promise((r) => setTimeout(r, 0));
}

/** Undoes ONE step and checks that it gives back `before` and that nothing else is left to undo. */
async function expectOneUndo(engine, before) {
  engine.undoManager.undo();
  await settle(engine);
  expect(doc(engine)).toBe(before);
  expect(engine.undoManager.canUndo()).toBe(false);
}

const labels = (engine) => engine.regions.list.map((r) => r.label);

describe('types and defaults', () => {
  it('without options: a generic section division over three levels', async () => {
    const engine = await makeEditor();
    const { types, defaultType } = Regions.get(engine).config;
    expect([...types.keys()]).toEqual(['section-1', 'section-2', 'section-3']);
    expect([...types.values()].map((t) => t.level)).toEqual([1, 2, 3]);
    expect(defaultType).toBe('section-1');
    await build(engine, [R('section-1', 'One', [R('section-2', 'Two'), R('section-2', 'Three')]), R('section-1', '', [R('section-2')])]);
    expect(labels(engine)).toEqual(['1. One', '1.1 Two', '1.2 Three', '2.', '2.1']);
  });

  it('declared types: numbering defaults to "parent"; a custom declaration replaces the defaults', async () => {
    const engine = await makeEditor(BOOK);
    const { types, defaultType } = Regions.get(engine).config;
    expect([...types.keys()]).toEqual(['part', 'chapter', 'scene']);
    expect(types.get('part').numbering).toBe('parent');
    expect(types.get('chapter').numbering).toBe('document');
    expect(defaultType).toBe('part');
  });

  it('rejects an invalid declaration when the extension is created', () => {
    expect(() => RegionsExtension({ types: { a: { level: 0 } } })).toThrow(/level/);
    expect(() => RegionsExtension({ types: { a: { level: 1, numbering: 'x' } } })).toThrow(/numbering/);
    expect(() => RegionsExtension({ types: { a: { level: 1, fields: { f: 'nope' } } } })).toThrow(/unknown kind/);
  });

  it('is exposed as Regions.get(nabu) and as the nabu.regions getter; FullPreset includes it', async () => {
    const engine = await makeEditor();
    expect(engine.regions).toBe(Regions.get(engine));
    const plain = new Nabu({ extensions: [ParagraphExtension, BlockExtension] });
    expect('regions' in plain).toBe(false);
    const full = new Nabu({ extensions: FullPreset });
    expect(full.registry.has('region')).toBe(true);
    expect(full.regions.list).toEqual([]);
  });
});

describe('the region block: header = title, body = children', () => {
  it('positions, resolveOffset and wordCount cover the title, then the body', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'The title', [P('ab cd'), P('ef')])]);
    const region = engine.children[0];
    expect(region.type).toBe('region');
    expect(region.children.map((c) => c.text)).toEqual(['ab cd', 'ef']);
    expect(region.positions).toBe(10 + 6 + 3); // title + 1, then each child's text + 1
    expect(region.wordCount).toBe(2 + 2 + 1);
    expect(region.resolveOffset(0)).toEqual({ block: region, offset: 0 });
    expect(region.resolveOffset(9)).toEqual({ block: region, offset: 9 }); // the end of the title is still the title
    expect(region.resolveOffset(10)).toMatchObject({ block: region.children[0], offset: 0 });
    expect(region.resolveOffset(10 + 6 + 1)).toMatchObject({ block: region.children[1], offset: 1 });
    expect(region.transformsEnabled).toBe(false); // no "# " in a title
    expect(region.marksEnabled).toBe(true);
  });

  it('title / fields.title read the header text (reactive) and are never stored in the fields map', async () => {
    const engine = await makeEditor(BOOK);
    const block = engine.insert('region', { regionType: 'scene', title: 'Old', fields: { title: 'ignored', pov: 'Anna' } });
    await engine.commit();
    const region = engine.blocks.get(block.id);
    expect(region.title).toBe('Old');
    expect(region.fields).toMatchObject({ title: 'Old', pov: 'Anna' });
    expect([...region.node.data.get('fields').keys()]).toEqual(['pov']);
    expect(region.exportFields).toEqual({ pov: 'Anna' });
    region.behavior.container.insert(3, '!'); // typing in the header
    await engine.commit();
    expect(region.title).toBe('Old!');
    expect(region.fields.title).toBe('Old!');
    expect(engine.regions.of(region).label).toBe('1 Old!');
  });

  it('create() takes the title from delta (marks kept), else text, else title, else fields.title', async () => {
    const engine = await makeEditor(BOOK);
    const Region = engine.registry.get('region');
    const make = (props) => { const b = Region.create(engine, 'region', { regionType: 'part', ...props }); return b; };
    const withDelta = make({ delta: [{ insert: 'It' }, { insert: 'alic', attributes: { italic: true } }], text: 'no', title: 'no' });
    const withText = make({ text: 'T1', title: 'T2', fields: { title: 'T3' } });
    const withTitle = make({ title: 'T2', fields: { title: 'T3' } });
    const withField = make({ fields: { title: 'T3' } });
    const multiline = make({ title: 'a\nb' });
    await engine.commit();
    expect(withDelta.behavior.container.toDelta()).toEqual([{ insert: 'It' }, { insert: 'alic', attributes: { italic: true } }]);
    expect([withText, withTitle, withField, multiline].map((b) => b.title)).toEqual(['T1', 'T2', 'T3', 'a b']);
  });

  it('setField("title") replaces the header text on one line (one undo step) and refuses a non-string', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'Old title')]);
    const region = engine.children[0];
    const before = doc(engine);
    expect(region.setField('title', 'New\ntitle')).toBe(true);
    await settle(engine);
    expect(region.title).toBe('New title');
    expect(region.behavior.container.toString()).toBe('New title');
    await expectOneUndo(engine, before);
    expect(region.title).toBe('Old title');
    const warn = vi.spyOn(engine, 'warn').mockImplementation(() => {});
    expect(region.setField('title', 5)).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(region.setField('title', null)).toBe(true);
    await settle(engine);
    expect(region.title).toBe('');
  });

  it('an empty title shows the `untitled` message as its placeholder (customisable) when it holds the caret', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', '')]);
    const region = engine.children[0];
    engine.selection.anchorBlock = region; // focus mode (the default): only the block holding the caret shows it
    expect(region.placeholder).toBe('Untitled');
    const custom = new Nabu({ extensions: [ParagraphExtension, RichTextExtension, RegionsExtension({ messages: { untitled: 'Sans titre' } }), BlockExtension] });
    custom.selection = { anchorBlock: null, focusBlock: null, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
    const block = custom.insert('region', {});
    await custom.commit();
    custom.selection.anchorBlock = custom.blocks.get(block.id);
    expect(custom.blocks.get(block.id).placeholder).toBe('Sans titre');
  });

  it('a region drags as a container (no dragRange override): the handle moves the block, its subtree travels with it', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('pre'), R('part', 'A', [P('x')])]);
    expect(engine.children[1].dragRange()).toEqual([engine.children[1]]);
  });
});

describe('fields', () => {
  const FIELDS = {
    note: {
      level: 1,
      fields: { pov: 'text', synopsis: 'richtext', weight: 'number', draft: 'boolean', status: { type: 'enum', values: ['todo', 'doing', 'done'] }, due: 'date' },
    },
  };
  const note = async (engine, title = 'T') => { await build(engine, [R('note', title)]); return engine.children[0]; };

  it('typed fields are stored and read back, unset ones are null', async () => {
    const engine = await makeEditor(FIELDS);
    const m = await note(engine);
    expect(m.fields.title).toBe('T');
    expect(m.fields).toMatchObject({ pov: null, synopsis: null, weight: null, draft: null, status: null, due: null });
    for (const [name, value] of [['pov', 'Anna'], ['weight', 3.5], ['draft', false], ['status', 'doing'], ['due', '2026-10-22'], ['synopsis', 'Once upon']]) {
      expect(m.setField(name, value)).toBe(true);
    }
    await engine.commit();
    expect(m.fields).toMatchObject({ title: 'T', pov: 'Anna', weight: 3.5, draft: false, status: 'doing', due: '2026-10-22', synopsis: 'Once upon' });
    expect(m.richtext('synopsis').toString()).toBe('Once upon');
    expect(m.richtext('pov')).toBe(null);
  });

  it('refuses invalid values for declared fields (nothing written, warning), accepts null to clear', async () => {
    const engine = await makeEditor(FIELDS);
    const warn = vi.spyOn(engine, 'warn').mockImplementation(() => {});
    const m = await note(engine);
    for (const [name, value] of [['pov', 3], ['weight', '3'], ['weight', NaN], ['draft', 'yes'], ['status', 'finished'], ['due', '2026-02-31'], ['due', 'tomorrow'], ['synopsis', 12], ['title', 5]]) {
      expect(m.setField(name, value)).toBe(false);
    }
    expect(warn).toHaveBeenCalledTimes(9);
    expect(m.fields).toMatchObject({ title: 'T', pov: null, weight: null, draft: null, status: null, due: null, synopsis: null });
    m.setField('weight', 2);
    expect(m.fields.weight).toBe(2);
    expect(m.setField('weight', null)).toBe(true);
    expect(m.exportFields.weight).toBeUndefined();
  });

  it('unknown fields are kept as-is, and an undeclared type keeps everything', async () => {
    const engine = await makeEditor(FIELDS);
    const m = await note(engine);
    m.setField('custom', { a: [1, 2] });
    expect(m.fields.custom).toEqual({ a: [1, 2] });
    const b = engine.registry.get('region').create(engine, 'region', { regionType: 'ghost', fields: { title: 'G', whatever: 7, pov: 'kept' } });
    await engine.commit();
    expect(engine.blocks.get(b.id).fields).toMatchObject({ title: 'G', whatever: 7, pov: 'kept' });
  });

  it('create() drops invalid declared values (warning) and applies richtext deltas', async () => {
    const engine = await makeEditor(FIELDS);
    const warn = vi.spyOn(engine, 'warn').mockImplementation(() => {});
    const b = engine.registry.get('region').create(engine, 'region', {
      regionType: 'note', title: 'Hi', fields: { weight: 'heavy', status: 'done', synopsis: [{ insert: 'bold', attributes: { bold: true } }, { insert: ' text' }] },
    });
    await engine.commit();
    const m = engine.blocks.get(b.id);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(m.fields).toMatchObject({ title: 'Hi', weight: null, status: 'done', synopsis: 'bold text' });
    expect(m.richtext('synopsis').toDelta()).toEqual([{ insert: 'bold', attributes: { bold: true } }, { insert: ' text' }]);
  });

  it('fields are reactive to direct Loro changes; setRegionType changes the type (the level follows) and refuses an undeclared one', async () => {
    const engine = await makeEditor({ ...FIELDS, scene: { level: 3 } });
    const m = await note(engine);
    m.node.data.get('fields').set('pov', 'Direct');
    engine.doc.commit();
    await Promise.resolve();
    expect(m.fields.pov).toBe('Direct');
    expect(engine.regions.of(m).level).toBe(1);
    expect(m.setRegionType('scene')).toBe(true);
    expect(engine.regions.of(m).level).toBe(3);
    const warn = vi.spyOn(engine, 'warn').mockImplementation(() => {});
    expect(m.setRegionType('nope')).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});

describe('the title is a locked field (ADR 018 §3.9)', () => {
  it('Enter never splits the title: the caret goes into the first body child when it is an empty paragraph', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'Title', [P(''), P('body')])]);
    const region = engine.children[0];
    const before = doc(engine);
    pin(engine, region, 2);
    expect(key(region, 'insertParagraph')).toBe(true);
    await settle(engine);
    expect(doc(engine)).toBe(before);
    expect(region.title).toBe('Title');
    const [target, offset] = engine.selection.setCursor.mock.calls.at(-1);
    expect(target).toBe(region.children[0]);
    expect(offset).toBe(0);
  });

  it('otherwise a NEW empty paragraph opens the body (at index 0), the caret in it, in one undo step', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'Title', [P('body')])]);
    const region = engine.children[0];
    const before = doc(engine);
    for (const caret of [0, 3, 5]) { // start, middle, end of the title: always the same
      pin(engine, region, caret);
      expect(key(region, 'insertParagraph')).toBe(true);
      await settle(engine);
      expect(doc(engine)).toBe('R:part(Title){p(∅) p(body)}');
      expect(region.title).toBe('Title');
      const [target, offset] = engine.selection.setCursor.mock.calls.at(-1);
      expect(target).toBe(region.children[0]);
      expect(offset).toBe(0);
      if (caret === 0) await expectOneUndo(engine, before);
      else break;
    }
  });

  it('Enter in the title of a region without body creates its first paragraph', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'Title')]);
    pin(engine, engine.children[0], 5);
    key(engine.children[0], 'insertParagraph');
    await settle(engine);
    expect(doc(engine)).toBe('R:part(Title){p(∅)}');
  });

  it('Backspace at the very start of the title and Delete at its very end do nothing; elsewhere they edit the title', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('before'), R('part', 'Title', [P('body')])]);
    const region = engine.children[1];
    const snapshot = doc(engine);
    pin(engine, region, 0);
    expect(key(region, 'deleteContentBackward')).toBe(true);
    pin(engine, region, 5);
    expect(key(region, 'deleteContentForward')).toBe(true);
    await settle(engine);
    expect(doc(engine)).toBe(snapshot);
    expect(engine.undoManager.canUndo()).toBe(false);
    pin(engine, region, 5);
    key(region, 'deleteContentBackward'); // inside the title, Backspace is an ordinary deletion
    await settle(engine);
    expect(region.title).toBe('Titl');
  });

  it('a multi-block paste in the title is flattened: one line, marks kept, nothing goes to the body', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'Ab', [P('body')])]);
    const region = engine.children[0];
    pin(engine, region, 1);
    const blocks = [
      { type: 'paragraph', partial: 'start', delta: [{ insert: 'one ' }, { insert: 'two', attributes: { bold: true } }] },
      { type: 'paragraph', partial: false, delta: [{ insert: 'three\nfour' }] },
      { type: 'list', partial: false, children: [{ type: 'list-item', partial: false, delta: [{ insert: 'five' }] }] },
      { type: 'paragraph', partial: 'end', delta: [] },
    ];
    const before = doc(engine);
    engine.insertFragment({ blocks });
    await settle(engine);
    expect(region.title).toBe('Aone two three four fiveb');
    expect(region.behavior.container.toDelta()).toEqual([{ insert: 'Aone ' }, { insert: 'two', attributes: { bold: true } }, { insert: ' three four fiveb' }]);
    expect(region.children.map((c) => c.text)).toEqual(['body']);
    const [target, offset] = engine.selection.setCursor.mock.calls.at(-1);
    expect(target).toBe(region);
    expect(offset).toBe('Aone two three four five'.length);
    await expectOneUndo(engine, before);
  });

  it('a single text block keeps the engine\'s inline paste (acceptPaste declines)', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'Ab')]);
    const region = engine.children[0];
    expect(region.acceptPaste([{ type: 'paragraph', partial: false, delta: [{ insert: 'x' }] }], { offset: 1 })).toBe(null);
    pin(engine, region, 1);
    engine.insertFragment({ blocks: [{ type: 'paragraph', partial: 'both', delta: [{ insert: 'x' }] }] });
    await settle(engine);
    expect(region.title).toBe('Axb');
  });

  it('no text merge goes into or out of a title (onBeforeMerge veto), nor across a seam', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('pre'), R('part', 'A', [P('a1'), R('chapter', 'C', [P('c1')]), P('a2')]), R('part', 'B', [P('b1')])]);
    const hooks = engine.hooks.get('onBeforeMerge');
    expect(hooks).toHaveLength(1);
    const veto = (survivor, victim) => hooks[0](engine, at(engine, survivor) ?? engine.children.find((b) => b.title === survivor), at(engine, victim) ?? engine.children.find((b) => b.title === victim));
    const [partA, partB] = engine.children.slice(1);
    expect(hooks[0](engine, partA, at(engine, 'a1'))).toBe(engine.BREAK); // the body into the title
    expect(hooks[0](engine, at(engine, 'pre'), partA)).toBe(engine.BREAK); // the title into the text above
    expect(veto('a1', 'a2')).toBeUndefined(); // same region
    expect(veto('a1', 'c1')).toBe(engine.BREAK); // sub-region
    expect(veto('a2', 'c1')).toBe(engine.BREAK);
    expect(veto('a2', 'b1')).toBe(engine.BREAK); // two regions
    expect(veto('pre', 'pre')).toBeUndefined();
    expect(mergeCrossesRegion(engine, partA, partB)).toBe(true);
  });

  it('Backspace at the start of the first body child, and Delete at the end of the text before a sub-region, merge nothing', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'A', [P('a1'), R('chapter', 'C', [P('c1')])])]);
    const snapshot = doc(engine);
    const a1 = at(engine, 'a1');
    pin(engine, a1, 0);
    key(a1, 'deleteContentBackward');
    pin(engine, a1, 2);
    key(a1, 'deleteContentForward');
    await settle(engine);
    expect(doc(engine)).toBe(snapshot);
    expect(engine.undoManager.canUndo()).toBe(false);
  });
});

describe('registry: list, tree, parent, children', () => {
  it('list is the pre-order document order; tree the top-level regions; parent = nearest region ancestor', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [
      P('pre'),
      R('part', 'P1', [P('a'), R('chapter', 'C1', [R('scene', 'S1'), P('b'), R('scene', 'S2')]), P('c'), R('chapter', 'C2')]),
      R('part', 'P2'),
    ]);
    const r = engine.regions;
    const titles = (regions) => regions.map((x) => x.title);
    expect(titles(r.list)).toEqual(['P1', 'C1', 'S1', 'S2', 'C2', 'P2']);
    expect(r.list.map((x) => x.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(titles(r.tree)).toEqual(['P1', 'P2']);
    expect(r.count).toBe(6);
    const [p1, c1, s1, s2, c2, p2] = r.list;
    expect(r.list.map((x) => x.parent?.title ?? null)).toEqual([null, 'P1', 'C1', 'C1', 'P1', null]);
    expect(titles(p1.children)).toEqual(['C1', 'C2']);
    expect(titles(c1.children)).toEqual(['S1', 'S2']);
    expect(s1.children).toEqual([]);
    expect(r.parentOf(s2)).toBe(c1);
    expect(r.parentOf(p2)).toBe(null);
    expect(p1.block.type).toBe('region');
    expect(p1.marker).toBe(p1.block); // alias kept for now
  });

  it('a region lives only at the root or in a region body: one inside another container is not listed', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'A'), P('x')]);
    expect(engine.regions.count).toBe(1);
  });

  it('a region whose type is not declared is a leaf at the deepest level, unnumbered, labelled by its title', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [R('mystery', 'Odd', [R('scene', 'S')])])]);
    const [p, odd, s] = engine.regions.list;
    expect(odd.def).toBe(undefined);
    expect(odd.level).toBe(3);
    expect(odd.index).toBe(null);
    expect(odd.label).toBe('Odd');
    expect(odd.parent).toBe(p);
    expect(s.parent).toBe(odd);
  });

  it('typing does not recompute the structure (same array); a structure change does', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('one')])]);
    const list = engine.regions.list;
    at(engine, 'one').behaviors.get('text').container.insert(3, ' two');
    engine.children[0].behavior.container.insert(1, '!');
    await engine.commit();
    expect(engine.regions.list).toBe(list);
    await insertRegion(engine, { type: 'chapter', parent: engine.children[0] });
    expect(engine.regions.list).not.toBe(list);
    expect(engine.regions.count).toBe(2);
  });

  it('insert / move / delete / retype a region updates the registry', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'A'), R('part', 'B')]);
    const [a, b] = engine.children;
    expect(labels(engine)).toEqual(['Part 1', 'Part 2']);
    b.node.move(undefined, 0);
    await engine.commit();
    expect(engine.regions.list.map((r) => r.block.id)).toEqual([b.id, a.id]);
    a.node.move(b.node, 0); // A becomes a sub-region of B (R2 will move it out again: parts do not nest)
    await engine.commit();
    expect(engine.regions.list.map((r) => r.parent)).toEqual([null, null]);
    engine.delete(engine.blocks.get(b.id));
    await engine.commit();
    expect(labels(engine)).toEqual(['Part 1']);
    engine.blocks.get(a.id).setRegionType('chapter');
    expect(labels(engine)).toEqual(['Chapter 1']);
  });
});

describe('registry: numbering, path, label', () => {
  it('"parent" restarts at 1 in each parent region, "document" continues, "none" has no index', async () => {
    const engine = await makeEditor({
      part: { level: 1, label: 'Part {index}' },
      chapter: { level: 2, label: 'Chapter {index}', numbering: 'document' },
      scene: { level: 3, label: '{path}' },
      note: { level: 3, numbering: 'none', label: 'Note: {title}' },
    });
    await build(engine, [
      R('part', '', [R('chapter', '', [R('scene'), R('note', 'n1'), R('scene')]), R('chapter', '', [R('scene')])]),
      R('part', '', [R('chapter', '', [R('scene'), R('scene')])]),
    ]);
    const l = engine.regions.list;
    expect(l.map((x) => x.index)).toEqual([1, 1, 1, null, 2, 2, 1, 2, 3, 1, 2]);
    expect(l.map((x) => x.pathString)).toEqual(['1', '1.1', '1.1.1', '1.1', '1.1.2', '1.2', '1.2.1', '2', '2.3', '2.3.1', '2.3.2']);
    expect(labels(engine)).toEqual(['Part 1', 'Chapter 1', '1.1.1', 'Note: n1', '1.1.2', 'Chapter 2', '1.2.1', 'Part 2', 'Chapter 3', '2.3.1', '2.3.2']);
    expect(l[5].path).toEqual([1, 2]);
  });

  it('"parent" counts per type: two types on the same level are numbered separately', async () => {
    const engine = await makeEditor({ a: { level: 1 }, b: { level: 1 } });
    await build(engine, [R('a'), R('b'), R('a'), R('b')]);
    expect(engine.regions.list.map((x) => x.index)).toEqual([1, 1, 2, 2]);
  });

  it('label tokens: {index} {path} {title} {type} {level}; an empty title leaves no dangling space; prefix = the label without the title', async () => {
    const engine = await makeEditor({ x: { level: 1, label: '[{type}/{level}] {index} · {path} · {title}' }, y: { level: 1, numbering: 'none' }, z: { level: 1, label: 'Chapter {index}', numbering: 'document' } });
    await build(engine, [R('x', 'The  ferryman'), R('x', ''), R('y', 'Free'), R('z', 'Zed')]);
    const [a, b, y, z] = engine.regions.list;
    expect(a.label).toBe('[x/1] 1 · 1 · The ferryman');
    expect(a.prefix).toBe('[x/1] 1 · 1 ·');
    expect(b.label).toBe('[x/1] 2 · 2 ·');
    expect(y.label).toBe('Free'); // default label of an unnumbered type = {title}
    expect(y.prefix).toBe('');
    expect(z.prefix).toBe('Chapter 1');
  });

  it('the label follows the title (reactive)', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', '', [R('chapter', '', [R('scene', 'Old')])])]);
    const scene = engine.regions.list[2];
    expect(scene.label).toBe('1.1.1 Old');
    scene.setField('title', 'New');
    expect(scene.label).toBe('1.1.1 New');
    expect(scene.title).toBe('New');
  });
});

describe('registry: at, of, next, prev, blocks, preamble, word counts', () => {
  async function sample() {
    const engine = await makeEditor(BOOK);
    await build(engine, [
      P('pre one'), P('pre two'),
      R('part', 'P', [P('a'), R('chapter', 'C', [P('b'), R('scene', 'S', [P('c d')]), P('e')]), R('chapter', 'C2', [P('f')])]),
      P('after'),
    ]);
    return engine;
  }

  it('at(block) is the nearest region ancestor; a region block belongs to itself; the preamble belongs to none', async () => {
    const engine = await sample();
    const r = engine.regions;
    const [p, c, s, c2] = r.list;
    expect(r.at(at(engine, 'pre one'))).toBe(null);
    expect(r.at(at(engine, 'after'))).toBe(null); // a root block after the last region is outside it
    expect(r.at(at(engine, 'a'))).toBe(p);
    expect(r.at(at(engine, 'b'))).toBe(c);
    expect(r.at(at(engine, 'c d'))).toBe(s);
    expect(r.at(at(engine, 'e'))).toBe(c); // text of the chapter after its sub-region
    expect(r.at(at(engine, 'f'))).toBe(c2);
    expect(r.at(s.block)).toBe(s);
    expect(r.at({ block: at(engine, 'c d') })).toBe(s);
  });

  it('at() looks through plain containers, and defaults to the block of the selection anchor', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P')]);
    const region = engine.children[0];
    const list = List.create(engine, 'list', { listType: 'bullet' }, region.id);
    const item = ListItem.create(engine, 'list-item', { text: 'in list' }, list.node.id.toString());
    await engine.commit();
    const live = engine.blocks.get(item.id);
    expect(engine.regions.at(live).title).toBe('P');
    engine.selection.anchorBlock = live;
    expect(engine.regions.at().title).toBe('P');
    engine.selection.anchorBlock = null;
    expect(engine.regions.at()).toBe(null);
  });

  it('of / next / prev follow the pre-order list', async () => {
    const engine = await sample();
    const r = engine.regions;
    const [p, c, s, c2] = r.list;
    expect(r.of(c.block)).toBe(c);
    expect(r.of(c.block.id)).toBe(c);
    expect(r.of(engine.children[0])).toBe(null);
    expect(r.next(p)).toBe(c);
    expect(r.next(s)).toBe(c2);
    expect(r.next(c2)).toBe(null);
    expect(r.prev(c)).toBe(p);
    expect(r.prev(p)).toBe(null);
  });

  it('blocks = the direct children of the body (sub-regions included), ownBlocks = those that are not regions', async () => {
    const engine = await sample();
    const [p, c] = engine.regions.list;
    const names = (blocks) => blocks.map((b) => (b.type === 'region' ? `R:${b.title}` : b.text));
    expect(names(p.blocks)).toEqual(['a', 'R:C', 'R:C2']);
    expect(names(p.ownBlocks)).toEqual(['a']);
    expect(names(c.blocks)).toEqual(['b', 'R:S', 'e']);
    expect(names(c.ownBlocks)).toEqual(['b', 'e']);
  });

  it('wordCount = the body (title excluded, sub-regions included), ownWordCount = the own blocks; follows the text', async () => {
    const engine = await sample();
    const [p, c, s, c2] = engine.regions.list;
    // the title of a sub-region is text of the parent's body: P = a(1) + C(title 1 + b 1 + S(title 1 + 2) + e 1) + C2(title 1 + f 1)
    expect([p, c, s, c2].map((x) => x.wordCount)).toEqual([1 + 6 + 2, 1 + 3 + 1, 2, 1]);
    expect([p, c, s, c2].map((x) => x.ownWordCount)).toEqual([1, 2, 2, 1]);
    expect(p.block.wordCount).toBe(1 + p.wordCount); // the block itself counts its title as well
    at(engine, 'f').behaviors.get('text').container.insert(1, ' g h');
    await engine.commit();
    expect(c2.wordCount).toBe(3);
    expect(p.wordCount).toBe(1 + 6 + (1 + 3));
  });

  it('preamble = the root blocks before the first root region (the whole document without any region)', async () => {
    const engine = await sample();
    expect(engine.regions.preamble.blocks.map((b) => b.text)).toEqual(['pre one', 'pre two']);
    expect(engine.regions.preamble.wordCount).toBe(4);
    await build(engine, [P('only')]);
    expect(engine.regions.preamble.blocks.map((b) => b.text)).toEqual(['only']);
    expect(engine.regions.count).toBe(0);
  });
});

describe('normalizer R1: a region lives at the root or in a region body', () => {
  async function chapterWithList() {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [R('chapter', 'C', [P('intro'), { type: 'toggle', text: 'T', children: [P('body')] }, P('tail')])])]);
    return engine;
  }

  it('a region pasted in a toggle body goes right AFTER the toggle, inside its chapter; several keep their order; one undo step', async () => {
    const engine = await chapterWithList();
    // `build` does not know the toggle's `collapsed`; the toggle is a plain container for this test
    const toggle = at(engine, 'T');
    const before = doc(engine);
    const Region = engine.registry.get('region');
    const s1 = Region.create(engine, 'region', { regionType: 'scene', title: 'S1' }, toggle.id);
    const s2 = Region.create(engine, 'region', { regionType: 'scene', title: 'S2' }, toggle.id);
    await engine.commit();
    expect(doc(engine)).toBe('R:part(P){R:chapter(C){p(intro) toggle(T){p(body)} R:scene(S1) R:scene(S2) p(tail)}}');
    expect(engine.blocks.get(s1.id).parent).toBe(engine.regions.list[1].block);
    expect(engine.blocks.get(s2.id).parent).toBe(engine.regions.list[1].block);
    expect(engine.regions.list.map((r) => r.title)).toEqual(['P', 'C', 'S1', 'S2']);
    await expectOneUndo(engine, before);
  });

  it('a region created in a list goes after the list (the highest container below its region), at the root without a region', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P')]);
    const part = engine.children[0];
    const list = List.create(engine, 'list', { listType: 'bullet' }, part.id);
    ListItem.create(engine, 'list-item', { text: 'one' }, list.node.id.toString());
    await engine.commit();
    engine.undoManager.clear();
    const region = engine.registry.get('region').create(engine, 'region', { regionType: 'chapter', title: 'In list' }, list.node.id.toString(), 1);
    await engine.commit();
    const live = engine.blocks.get(region.id);
    expect(live.parent.id).toBe(part.id);
    const siblings = part.children.map((b) => b.type);
    expect(siblings.indexOf('region')).toBeGreaterThan(siblings.indexOf('list'));
    expect(engine.regions.list.map((r) => r.title)).toEqual(['P', 'In list']);
    expect(engine.regions.at(live).parent.title).toBe('P');

    const rootList = List.create(engine, 'list', { listType: 'bullet' });
    ListItem.create(engine, 'list-item', { text: 'x' }, rootList.node.id.toString());
    await engine.commit();
    const root = engine.registry.get('region').create(engine, 'region', { regionType: 'part', title: 'Root' }, rootList.node.id.toString());
    await engine.commit();
    expect(engine.blocks.get(root.id).parent).toBe(null);
  });

  it('moving an existing region into a container is undone by the normalizer: the block id, title and body survive', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('chapter', 'Keep', [P('kept')]), { type: 'toggle', text: 'T' }]);
    const [chapter, toggle] = engine.children;
    chapter.node.move(toggle.node, 0);
    await engine.commit();
    const again = engine.blocks.get(chapter.id);
    expect(again.parent).toBe(null);
    expect(again.title).toBe('Keep');
    expect(doc(engine)).toBe('toggle(T) ; R:chapter(Keep){p(kept)}');
  });

  it('a block retyped into a region while nested in a container is hoisted too', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [{ type: 'toggle', text: 'T', children: [P('')] }])]);
    const nested = at(engine, 'T').children[0];
    nested.node.data.set('type', 'region');
    nested.node.data.set('regionType', 'chapter');
    await engine.commit();
    expect(doc(engine)).toBe('R:part(P){toggle(T) R:chapter()}');
  });

  it('is opt-in: no extension, no hook', async () => {
    const engine = new Nabu({ extensions: [ParagraphExtension, BlockExtension] });
    expect(engine.hooks.get('onBeforeTransaction') ?? []).not.toContain(normalizeRegions);
    const withRegions = new Nabu({ extensions: [ParagraphExtension, RegionsExtension(), BlockExtension] });
    expect(withRegions.hooks.get('onBeforeTransaction')).toContain(normalizeRegions);
  });
});

describe('normalizer R2: a sub-region is strictly deeper than its parent region', () => {
  it('a chapter placed in a scene moves right after the scene, with its body; one undo step', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [R('chapter', 'C', [R('scene', 'S', [P('s text')])]), R('chapter', 'C2', [P('moves')])])]);
    const before = doc(engine);
    const [, , scene, c2] = engine.regions.list;
    c2.block.node.move(scene.block.node, 1);
    await engine.commit();
    expect(doc(engine)).toBe('R:part(P){R:chapter(C){R:scene(S){p(s text)}} R:chapter(C2){p(moves)}}');
    expect(engine.regions.list.map((r) => r.title)).toEqual(['P', 'C', 'S', 'C2']);
    expect(engine.regions.list[3].parent.title).toBe('P');
    await expectOneUndo(engine, before);
  });

  it('it climbs until valid: a part pasted in a scene goes up to the root, after the top-level part', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [R('chapter', 'C', [R('scene', 'S')])]), P('end')]);
    const scene = engine.regions.list[2];
    const stray = engine.registry.get('region').create(engine, 'region', { regionType: 'part', title: 'Stray', fields: {} }, scene.block.id);
    await engine.commit();
    expect(doc(engine)).toBe('R:part(P){R:chapter(C){R:scene(S)}} ; R:part(Stray) ; p(end)');
    expect(engine.blocks.get(stray.id).parent).toBe(null);
  });

  it('an equal level is invalid too, and several displaced regions keep their order', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('chapter', 'C', [R('scene', 'S')])]);
    const scene = engine.regions.list[1].block;
    const Region = engine.registry.get('region');
    Region.create(engine, 'region', { regionType: 'scene', title: 'X1' }, scene.id);
    Region.create(engine, 'region', { regionType: 'scene', title: 'X2' }, scene.id);
    Region.create(engine, 'region', { regionType: 'scene', title: 'X3' }, scene.id);
    await engine.commit();
    expect(doc(engine)).toBe('R:chapter(C){R:scene(S) R:scene(X1) R:scene(X2) R:scene(X3)}');
  });

  it('an undeclared type is valid anywhere under a region and does not constrain its children', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('scene', 'S', [R('mystery', 'M', [R('part', 'Deep')])])]);
    expect(doc(engine)).toBe('R:scene(S){R:mystery(M){R:part(Deep)}}');
  });

  it('retyping a parent to a deeper level moves the children that no longer fit', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [R('chapter', 'C', [P('c text')])])]);
    engine.regions.list[0].block.setRegionType('scene');
    await engine.commit();
    expect(doc(engine)).toBe('R:scene(P) ; R:chapter(C){p(c text)}');
  });
});

describe('createRegion / insertRegion', () => {
  it('inserts at the root: start / end / index / after / before a block (a nested block counts as its top-level block)', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('a'), P('b')]);
    const [a, b] = engine.children;
    const kinds = () => engine.children.map((x) => (x.type === 'region' ? `R:${x.title}` : x.text));
    await insertRegion(engine, { at: 'start', title: 'S' });
    await insertRegion(engine, { type: 'chapter', at: 'end', title: 'End' });
    expect(kinds()).toEqual(['R:S', 'a', 'b', 'R:End']);
    await insertRegion(engine, { at: { after: a }, title: 'Aft' });
    await insertRegion(engine, { at: { before: b }, title: 'Bef' });
    await insertRegion(engine, { at: 1, title: 'One' });
    expect(kinds()).toEqual(['R:S', 'R:One', 'a', 'R:Aft', 'R:Bef', 'b', 'R:End']);
    await expect(insertRegion(engine, { type: 'nope' })).rejects.toThrow(/not declared/);
  });

  it('inserts in the body of a parent region, relative to its children; returns the live block', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [R('part', 'P', [P('a'), P('b')])]);
    const part = engine.children[0];
    const kinds = () => part.children.map((x) => (x.type === 'region' ? `R:${x.title}` : x.text));
    const [a, b] = part.children;
    const first = await insertRegion(engine, { type: 'chapter', parent: part, at: 'start', title: 'S' });
    await insertRegion(engine, { type: 'chapter', parent: part, at: { after: a }, title: 'Aft' });
    await insertRegion(engine, { type: 'chapter', parent: part, at: { before: b }, title: 'Bef' });
    await insertRegion(engine, { type: 'chapter', parent: part, title: 'End' });
    expect(kinds()).toEqual(['R:S', 'a', 'R:Aft', 'R:Bef', 'b', 'R:End']);
    expect(first).toBe(engine.blocks.get(first.id));
    expect(first.parent).toBe(part);
  });

  it('createRegion does not commit (the caller owns the transaction) and puts the title in the header', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [P('x')]);
    const region = createRegion(engine, { type: 'chapter', title: 'Draft', fields: { title: 'no' }, index: 0 });
    expect(engine.children.some((b) => b.id === region.id)).toBe(false);
    await engine.commit();
    expect(engine.children[0].title).toBe('Draft');
    expect(() => createRegion(engine, { type: 'nope' })).toThrow(/not declared/);
  });
});

describe('JSON and clipboard round trips', () => {
  const NOTE = { ...BOOK, note: { level: 3, fields: { synopsis: 'richtext', weight: 'number' } } };
  const noIds = (value) => JSON.parse(JSON.stringify(value, (k, v) => (k === 'id' ? undefined : v)));

  async function source() {
    const engine = await makeEditor(NOTE);
    await build(engine, [P('before'), R('part', 'La forêt', [P('in the body'), R('chapter', 'C', [R('note', 'N', [], { fields: { weight: 2, synopsis: [{ insert: 'rich', attributes: { bold: true } }], extra: { k: true } } })])])]);
    engine.children[1].behavior.container.mark({ start: 0, end: 2 }, 'italic', true);
    await engine.commit();
    return engine;
  }

  it('serialize("json") writes the container: props { regionType, fields } without the title, the title as content, the body as children', async () => {
    const engine = await source();
    const json = engine.serialize('json');
    const part = json.blocks[1];
    expect(part).toMatchObject({ id: engine.children[1].id, type: 'region', props: { regionType: 'part', fields: {} } });
    expect(part.content.map((run) => run.text).join('')).toBe('La forêt');
    expect(part.children.map((c) => c.type)).toEqual(['paragraph', 'region']);
    const note = part.children[1].children[0];
    expect(note.props).toEqual({ regionType: 'note', fields: { weight: 2, synopsis: [{ insert: 'rich', attributes: { bold: true } }], extra: { k: true } } });
    expect(note.content).toEqual([{ text: 'N' }]);
  });

  it('importJSON restores the document exactly (twice), marks of the title included', async () => {
    const engine = await source();
    const json = engine.serialize('json');
    const other = await makeEditor(NOTE);
    await other.importJSON(JSON.stringify(json));
    expect(noIds(other.serialize('json'))).toEqual(noIds(json));
    expect(doc(other)).toBe(doc(engine));
    expect(other.children[1].behavior.container.toDelta()).toEqual(engine.children[1].behavior.container.toDelta());
    expect(other.regions.list.map((r) => [r.type, r.title, r.parent?.title ?? null])).toEqual([['part', 'La forêt', null], ['chapter', 'C', 'La forêt'], ['note', 'N', 'C']]);
    expect(other.regions.list[2].block.richtext('synopsis').toDelta()).toEqual([{ insert: 'rich', attributes: { bold: true } }]);
    const third = await makeEditor(NOTE);
    await third.importJSON(JSON.stringify(other.serialize('json')));
    expect(noIds(third.serialize('json'))).toEqual(noIds(json));
  });

  it('the clipboard form (serializeForClipboard / application/x-nabu+json) round-trips a whole region through the engine\'s paste path', async () => {
    const engine = await source();
    const region = engine.children[1];
    const pb = region.serializeForClipboard();
    expect(pb).toMatchObject({ type: 'region', partial: false, props: { regionType: 'part', fields: {} } });
    expect(pb.delta.map((op) => op.insert).join('')).toBe('La forêt');
    expect(pb.children.map((c) => c.type)).toEqual(['paragraph', 'region']);
    const whole = region.serialize('application/x-nabu+json'); // the form of a block that is wholly selected
    expect(whole).toMatchObject({ type: 'region', props: region.exportProps, delta: region.behavior.container.toDelta() });
    expect(whole.children.map((c) => c.type)).toEqual(['paragraph', 'region']);
    const other = await makeEditor(NOTE);
    await other.importFragment({ blocks: [pb] });
    expect(doc(other)).toBe('R:part(La forêt){p(in the body) R:chapter(C){R:note(N)}}');
    expect(noIds(other.children[0].serialize('json'))).toEqual(noIds(region.serialize('json')));
  });
});
