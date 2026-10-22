// @ts-nocheck
/**
 * Unit tests for Regions (ADR 016, lot 1): types / defaults, extent rule, numbering, labels, `at()`, word counts,
 * typed fields, root-only hoisting (one undo step), reactivity, JSON round trip.
 */

import { describe, it, expect, vi } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension, Paragraph } from '$lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension, List, ListItem } from '$lib/blocks/list/index.js';
import { ToggleExtension, ToggleBlock } from '$lib/blocks/toggle/index.js';
import { BlockExtension } from '$lib/blocks/block.extension.js';
import { RichTextExtension } from '$lib/behaviors/text/index.js';
import { RegionsExtension, Regions, insertRegion, RegionBlock, normalizeRegions } from '$lib/blocks/region/index.js';
import { FullPreset } from '$lib/presets.js';

const BOOK = {
  part: { level: 1, label: 'Part {index}' },
  chapter: { level: 2, label: 'Chapter {index}', numbering: 'document' },
  scene: { level: 3, label: '{path} {title}', fields: { pov: 'text' } },
};

async function makeEditor(options, extra = []) {
  const engine = new Nabu({
    extensions: [ParagraphExtension, ListExtension, ListItemExtension, ToggleExtension, RichTextExtension, RegionsExtension(options && { types: options }), BlockExtension, ...extra],
  });
  await engine.commit();
  engine.selection = { anchorBlock: null, focusBlock: null, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
  // A document is never empty: the engine starts with one empty paragraph, which the first helper call below reuses.
  engine.undoManager.clear();
  return engine;
}

/** The untouched initial empty paragraph (the only block of a fresh document). */
const blank = (engine) => {
  const only = engine.children.length === 1 ? engine.children[0] : null;
  return only && only.type === 'paragraph' && only.behaviors.get('text').text === '' ? only : null;
};

const para = async (engine, text, index = null) => {
  const initial = blank(engine);
  if (initial) {
    initial.behaviors.get('text').container.insert(0, text);
    await engine.commit();
    return initial;
  }
  const b = Paragraph.create(engine, 'paragraph', { text }, null, index);
  await engine.commit();
  return engine.blocks.get(b.id);
};
const region = async (engine, regionType, title = '', index = null) => {
  const initial = blank(engine);
  if (initial) { index = 0; engine.delete(initial); }
  const b = engine.registry.get('region').create(engine, 'region', { regionType, title }, null, index);
  await engine.commit();
  return engine.blocks.get(b.id);
};

/** Builds a document from a compact spec: 'p:text' | 'r:type:title'. */
async function build(engine, spec) {
  for (const item of spec) {
    if (item.startsWith('p:')) await para(engine, item.slice(2));
    else { const [, type, title = ''] = item.split(':'); await region(engine, type, title); }
  }
}

const labels = (engine) => engine.regions.list.map((r) => r.label);

describe('types and defaults', () => {
  it('without options: a generic section division over three levels', async () => {
    const engine = await makeEditor();
    const { types, defaultType } = Regions.get(engine).config;
    expect([...types.keys()]).toEqual(['section-1', 'section-2', 'section-3']);
    expect([...types.values()].map((t) => t.level)).toEqual([1, 2, 3]);
    expect(defaultType).toBe('section-1');
    await build(engine, ['r:section-1:One', 'r:section-2:Two', 'r:section-2:Three', 'r:section-1:', 'r:section-2:']);
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
    expect(() => RegionsExtension({ types: { a: { level: 1, fields: { f: { type: 'enum' } } } } })).toThrow(/values/);
  });

  it('is exposed as Regions.get(nabu) and as the nabu.regions getter, installed by the extension only', async () => {
    const engine = await makeEditor();
    expect(engine.regions).toBe(Regions.get(engine));
    const plain = new Nabu({ extensions: [ParagraphExtension, BlockExtension] });
    expect('regions' in plain).toBe(false);
  });

  it('FullPreset includes it', () => {
    const engine = new Nabu({ extensions: FullPreset });
    expect(engine.registry.has('region')).toBe(true);
    expect(engine.regions.list).toEqual([]);
  });
});

describe('extent rule', () => {
  it('a region runs from its marker to the next marker of the same or a higher level', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, [
      'p:preamble',
      'r:part:P1', 'p:a',
      'r:chapter:C1', 'p:b',
      'r:scene:S1', 'p:c',
      'r:scene:S2', 'p:d',
      'r:chapter:C2', 'p:e',
      'r:part:P2', 'p:f',
    ]);
    const r = engine.regions;
    const [p1, c1, s1, s2, c2, p2] = r.list;
    const text = (rg) => rg.blocks.map((b) => b.behaviors.get('text')?.text ?? `<${b.regionType}>`);
    expect(r.list.map((x) => [x.type, x.start, x.end])).toEqual([
      ['part', 1, 11], ['chapter', 3, 9], ['scene', 5, 7], ['scene', 7, 9], ['chapter', 9, 11], ['part', 11, 13],
    ]);
    expect(text(p1)).toEqual(['a', '<chapter>', 'b', '<scene>', 'c', '<scene>', 'd', '<chapter>', 'e']);
    expect(text(c1)).toEqual(['b', '<scene>', 'c', '<scene>', 'd']);
    expect(text(s1)).toEqual(['c']);
    expect(text(s2)).toEqual(['d']);
    expect(text(c2)).toEqual(['e']);
    expect(text(p2)).toEqual(['f']);
    // own content: up to the first sub-region
    expect(text({ blocks: p1.ownBlocks })).toEqual(['a']);
    expect(text({ blocks: c1.ownBlocks })).toEqual(['b']);
    expect(p1.first).toBe(p1.marker);
    expect(p1.last.behaviors.get('text').text).toBe('e');
    // tree
    expect(r.tree.map((x) => x.type)).toEqual(['part', 'part']);
    expect(p1.children.map((x) => x.type)).toEqual(['chapter', 'chapter']);
    expect(c1.children.map((x) => x.type)).toEqual(['scene', 'scene']);
    expect(s1.parent).toBe(c1);
    expect(r.parentOf(c1)).toBe(p1);
    expect(r.parentOf(p1)).toBe(null);
  });

  it('skipped levels: a scene right after a part is a child of the part; a later chapter closes the scene', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['r:part:P', 'p:a', 'r:scene:S', 'p:b', 'r:chapter:C', 'p:c']);
    const [p, s, c] = engine.regions.list;
    expect(s.parent).toBe(p);
    expect(c.parent).toBe(p);
    expect(s.blocks.map((b) => b.behaviors.get('text').text)).toEqual(['b']);
    expect(p.children).toEqual([s, c]);
    expect(s.path).toEqual([1, 1]);
  });

  it('preamble: blocks before the first marker belong to no region; the whole document without any marker', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['p:x', 'p:y']);
    expect(engine.regions.list).toEqual([]);
    expect(engine.regions.preamble.blocks.length).toBe(2);
    await region(engine, 'part', 'P');
    await para(engine, 'z');
    expect(engine.regions.preamble.blocks.map((b) => b.behaviors.get('text').text)).toEqual(['x', 'y']);
    expect(engine.regions.at(engine.children[0])).toBe(null);
    expect(engine.regions.at(engine.children[3]).type).toBe('part');
  });

  it('a marker whose type is not declared is a leaf at the deepest level, unnumbered, labelled by its title', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['r:part:P', 'r:mystery:Odd', 'p:a', 'r:chapter:C']);
    const [p, odd, c] = engine.regions.list;
    expect(odd.def).toBeUndefined();
    expect(odd.level).toBe(3);
    expect(odd.index).toBe(null);
    expect(odd.parent).toBe(p);
    expect(odd.label).toBe('Odd');
    expect(c.parent).toBe(p);
    expect(odd.blocks.length).toBe(1);
  });
});

describe('numbering, path, label', () => {
  it('"parent" restarts at 1 in each parent region, "document" continues, "none" has no index', async () => {
    const engine = await makeEditor({
      part: { level: 1, label: 'Part {index}' },
      chapter: { level: 2, label: 'Chapter {index}', numbering: 'document' },
      scene: { level: 3, label: '{path}' },
      note: { level: 3, numbering: 'none', label: 'Note: {title}' },
    });
    await build(engine, [
      'r:part:', 'r:chapter:', 'r:scene:', 'r:note:n1', 'r:scene:',
      'r:chapter:', 'r:scene:',
      'r:part:', 'r:chapter:', 'r:scene:', 'r:scene:',
    ]);
    const l = engine.regions.list;
    expect(l.map((x) => x.index)).toEqual([1, 1, 1, null, 2, 2, 1, 2, 3, 1, 2]);
    expect(l.map((x) => x.pathString)).toEqual(['1', '1.1', '1.1.1', '1.1', '1.1.2', '1.2', '1.2.1', '2', '2.3', '2.3.1', '2.3.2']);
    expect(labels(engine)).toEqual([
      'Part 1', 'Chapter 1', '1.1.1', 'Note: n1', '1.1.2', 'Chapter 2', '1.2.1', 'Part 2', 'Chapter 3', '2.3.1', '2.3.2',
    ]);
    expect(l[5].path).toEqual([1, 2]);
  });

  it('"parent" counts per type: two types on the same level are numbered separately', async () => {
    const engine = await makeEditor({ a: { level: 1 }, b: { level: 1 } });
    await build(engine, ['r:a:', 'r:b:', 'r:a:', 'r:b:']);
    expect(engine.regions.list.map((x) => x.index)).toEqual([1, 1, 2, 2]);
  });

  it('label tokens: {index} {path} {title} {type} {level}; an empty title leaves no dangling space', async () => {
    const engine = await makeEditor({ x: { level: 1, label: '[{type}/{level}] {index} · {path} · {title}' }, y: { level: 1, numbering: 'none' } });
    const a = await region(engine, 'x', 'The  ferryman');
    expect(engine.regions.of(a).label).toBe('[x/1] 1 · 1 · The ferryman');
    await region(engine, 'x', '');
    expect(engine.regions.list[1].label).toBe('[x/1] 2 · 2 ·');
    const y = await region(engine, 'y', 'Free');
    expect(engine.regions.of(y).label).toBe('Free'); // default label of an unnumbered type = {title}
  });

  it('the label follows the title (reactive)', async () => {
    const engine = await makeEditor(BOOK);
    const s = await region(engine, 'scene', 'Old');
    const r = engine.regions.of(s);
    expect(r.label).toBe('1 Old');
    s.setField('title', 'New');
    expect(engine.regions.of(s).label).toBe('1 New');
    expect(r.title).toBe('New');
  });
});

describe('at / of / next / prev', () => {
  async function doc() {
    const engine = await makeEditor(BOOK);
    await build(engine, ['p:pre', 'r:part:P', 'p:a', 'r:chapter:C', 'p:b', 'r:scene:S', 'p:c', 'r:chapter:C2', 'p:d']);
    const byText = (t) => engine.children.find((b) => b.behaviors.get('text')?.text === t);
    return { engine, byText };
  }

  it('at(block) is the deepest region containing it; a marker belongs to its own region', async () => {
    const { engine, byText } = await doc();
    const r = engine.regions;
    expect(r.at(byText('pre'))).toBe(null);
    expect(r.at(byText('a')).type).toBe('part');
    expect(r.at(byText('b')).type).toBe('chapter');
    expect(r.at(byText('c')).type).toBe('scene');
    expect(r.at(byText('d')).title).toBe('C2');
    const scene = r.list[2];
    expect(r.at(scene.marker)).toBe(scene);
    expect(r.at({ block: byText('c') })).toBe(scene);
    expect(r.at(4)).toBe(r.list[1]); // root index
  });

  it('at() resolves a nested block to its root block, and the current selection by default', async () => {
    const engine = await makeEditor(BOOK);
    await region(engine, 'part', 'P');
    const list = List.create(engine, 'list', { listType: 'bullet' });
    const item = ListItem.create(engine, 'list-item', { text: 'in list' }, list.node.id.toString());
    await engine.commit();
    await region(engine, 'part', 'P2');
    expect(engine.regions.at(engine.blocks.get(item.id)).title).toBe('P');
    engine.selection.anchorBlock = engine.blocks.get(item.id);
    expect(engine.regions.at().title).toBe('P');
    engine.selection.anchorBlock = null;
    expect(engine.regions.at()).toBe(null);
  });

  it('of / next / prev', async () => {
    const { engine } = await doc();
    const r = engine.regions;
    const [p, c, s, c2] = r.list;
    expect(r.of(c.marker)).toBe(c);
    expect(r.of(c.marker.id)).toBe(c);
    expect(r.of(engine.children[0])).toBe(null);
    expect(r.next(p)).toBe(c);
    expect(r.next(s)).toBe(c2);
    expect(r.next(c2)).toBe(null);
    expect(r.prev(c)).toBe(p);
    expect(r.prev(p)).toBe(null);
  });
});

describe('wordCount', () => {
  it('sums the range\'s root blocks (markers count 0); sub-regions included in the parent, excluded from "own"', async () => {
    const engine = await makeEditor(BOOK);
    await build(engine, ['p:one two', 'r:part:P', 'p:three four five', 'r:chapter:C', 'p:six seven', 'r:chapter:C2', 'p:eight']);
    const [p, c, c2] = engine.regions.list;
    expect(engine.regions.preamble.wordCount).toBe(2);
    expect(p.wordCount).toBe(3 + 2 + 1);
    expect(p.ownWordCount).toBe(3);
    expect(c.wordCount).toBe(2);
    expect(c2.wordCount).toBe(1);
    expect(engine.regions.list[0].marker.wordCount).toBe(0);
  });

  it('follows the text', async () => {
    const engine = await makeEditor(BOOK);
    await region(engine, 'part', 'P');
    const b = await para(engine, 'a b');
    expect(engine.regions.list[0].wordCount).toBe(2);
    b.behaviors.get('text').container.insert(3, ' c d');
    await engine.commit();
    expect(engine.regions.list[0].wordCount).toBe(4);
  });
});

describe('fields', () => {
  const FIELDS = {
    note: {
      level: 1,
      fields: {
        pov: 'text',
        synopsis: 'richtext',
        weight: 'number',
        draft: 'boolean',
        status: { type: 'enum', values: ['todo', 'doing', 'done'] },
        due: 'date',
      },
    },
  };

  it('title is a base field; typed fields are stored and read back, unset ones are null', async () => {
    const engine = await makeEditor(FIELDS);
    const m = await region(engine, 'note', 'T');
    expect(m.fields.title).toBe('T');
    expect(m.fields).toMatchObject({ pov: null, synopsis: null, weight: null, draft: null, status: null, due: null });
    expect(m.setField('pov', 'Anna')).toBe(true);
    expect(m.setField('weight', 3.5)).toBe(true);
    expect(m.setField('draft', false)).toBe(true);
    expect(m.setField('status', 'doing')).toBe(true);
    expect(m.setField('due', '2026-10-22')).toBe(true);
    expect(m.setField('synopsis', 'Once upon')).toBe(true);
    await engine.commit();
    expect(m.fields).toMatchObject({ title: 'T', pov: 'Anna', weight: 3.5, draft: false, status: 'doing', due: '2026-10-22', synopsis: 'Once upon' });
    expect(m.richtext('synopsis').toString()).toBe('Once upon');
    expect(m.richtext('pov')).toBe(null);
  });

  it('refuses invalid values for declared fields (nothing written, warning), accepts null to clear', async () => {
    const engine = await makeEditor(FIELDS);
    const warn = vi.spyOn(engine, 'warn').mockImplementation(() => {});
    const m = await region(engine, 'note', 'T');
    expect(m.setField('pov', 3)).toBe(false);
    expect(m.setField('weight', '3')).toBe(false);
    expect(m.setField('weight', NaN)).toBe(false);
    expect(m.setField('weight', Infinity)).toBe(false);
    expect(m.setField('draft', 'yes')).toBe(false);
    expect(m.setField('status', 'finished')).toBe(false);
    expect(m.setField('due', '2026-02-31')).toBe(false);
    expect(m.setField('due', 'tomorrow')).toBe(false);
    expect(m.setField('synopsis', 12)).toBe(false);
    expect(m.setField('title', 5)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(10);
    expect(m.fields).toMatchObject({ title: 'T', pov: null, weight: null, draft: null, status: null, due: null, synopsis: null });
    m.setField('weight', 2);
    expect(m.fields.weight).toBe(2);
    expect(m.setField('weight', null)).toBe(true);
    expect(m.fields.weight).toBe(null);
    expect(m.exportFields.weight).toBeUndefined();
  });

  it('dates: ISO date or datetime strings, a Date is stored as its ISO string', async () => {
    const engine = await makeEditor(FIELDS);
    const m = await region(engine, 'note');
    expect(m.setField('due', '2026-10-22T10:30:00Z')).toBe(true);
    expect(m.setField('due', new Date('2026-01-02T03:04:05.000Z'))).toBe(true);
    expect(m.fields.due).toBe('2026-01-02T03:04:05.000Z');
    expect(m.setField('due', new Date('nope'))).toBe(false);
  });

  it('unknown fields are kept as-is (create + setField), and an undeclared type keeps everything', async () => {
    const engine = await makeEditor(FIELDS);
    const m = await region(engine, 'note');
    m.setField('custom', { a: [1, 2] });
    expect(m.fields.custom).toEqual({ a: [1, 2] });
    const b = engine.registry.get('region').create(engine, 'region', { regionType: 'ghost', fields: { title: 'G', whatever: 7, pov: 'kept' } });
    await engine.commit();
    const g = engine.blocks.get(b.id);
    expect(g.fields).toMatchObject({ title: 'G', whatever: 7, pov: 'kept' });
  });

  it('create() drops invalid declared values (warning) and applies richtext deltas', async () => {
    const engine = await makeEditor(FIELDS);
    const warn = vi.spyOn(engine, 'warn').mockImplementation(() => {});
    const b = engine.registry.get('region').create(engine, 'region', {
      regionType: 'note',
      fields: { weight: 'heavy', status: 'done', synopsis: [{ insert: 'bold', attributes: { bold: true } }, { insert: ' text' }] },
      title: 'Hi',
    });
    await engine.commit();
    const m = engine.blocks.get(b.id);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(m.fields).toMatchObject({ title: 'Hi', weight: null, status: 'done', synopsis: 'bold text' });
    expect(m.richtext('synopsis').toDelta()).toEqual([{ insert: 'bold', attributes: { bold: true } }, { insert: ' text' }]);
  });

  it('fields are reactive to remote / direct Loro changes', async () => {
    const engine = await makeEditor(FIELDS);
    const m = await region(engine, 'note', 'T');
    m.node.data.get('fields').set('pov', 'Direct');
    engine.doc.commit();
    await Promise.resolve();
    expect(m.fields.pov).toBe('Direct');
  });

  it('setRegionType changes the type (the level follows), refuses an undeclared one', async () => {
    const engine = await makeEditor(BOOK);
    const m = await region(engine, 'part', 'X');
    expect(engine.regions.of(m).level).toBe(1);
    expect(m.setRegionType('scene')).toBe(true);
    expect(engine.regions.of(m).level).toBe(3);
    const warn = vi.spyOn(engine, 'warn').mockImplementation(() => {});
    expect(m.setRegionType('nope')).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});

describe('insertRegion helper', () => {
  it('inserts at the root: start / end / index / after / before a (nested) block', async () => {
    const engine = await makeEditor(BOOK);
    const a = await para(engine, 'a');
    const b = await para(engine, 'b');
    const kinds = () => engine.children.map((x) => x.behaviors.get('text')?.text ?? 'R');
    await insertRegion(engine, { at: 'start' });
    await insertRegion(engine, { type: 'chapter', at: 'end', title: 'End' });
    expect(kinds()).toEqual(['R', 'a', 'b', 'R']);
    await insertRegion(engine, { at: { after: a } });
    await insertRegion(engine, { at: { before: b } });
    await insertRegion(engine, { at: 1 });
    expect(kinds()).toEqual(['R', 'R', 'a', 'R', 'R', 'b', 'R']);
    expect(engine.regions.list[engine.regions.count - 1].title).toBe('End');
    await expect(insertRegion(engine, { type: 'nope' })).rejects.toThrow(/not declared/);
  });

  it('inserting after a nested block lands after its top-level block', async () => {
    const engine = await makeEditor(BOOK);
    const list = List.create(engine, 'list', { listType: 'bullet' });
    const item = ListItem.create(engine, 'list-item', { text: 'x' }, list.node.id.toString());
    await engine.commit();
    const m = await insertRegion(engine, { at: engine.blocks.get(item.id) });
    expect(engine.children.map((b) => b.type)).toEqual(['paragraph', 'list', 'region']);
    expect(m.parent).toBe(null);
  });
});

describe('root-only rule (hoisting)', () => {
  const kinds = (engine) => engine.tree.roots().map((r) => {
    const t = r.data.get('type');
    const kids = (r.children() ?? []).map((k) => k.data.get('type') === 'region' ? 'R' : (k.data.get('text')?.toString() ?? k.data.get('type')));
    return kids.length ? `${t}[${kids.join(',')}]` : (t === 'region' ? 'R' : `${t}:${r.data.get('text')?.toString() ?? ''}`);
  });

  it('a marker inside a list is hoisted to the root, in one undo step with the operation that put it there', async () => {
    const engine = await makeEditor(BOOK);
    const list = List.create(engine, 'list', { listType: 'bullet' });
    ListItem.create(engine, 'list-item', { text: 'one' }, list.node.id.toString());
    ListItem.create(engine, 'list-item', { text: 'two' }, list.node.id.toString());
    await engine.commit();
    await para(engine, 'after');
    engine.undoManager.clear();

    const m = engine.registry.get('region').create(engine, 'region', { regionType: 'part', title: 'P' }, list.node.id.toString(), 1);
    await engine.commit();
    expect(engine.blocks.get(m.id).parent).toBe(null);
    // (the list normalizer splits the list around the marker, as it does for any foreign child)
    expect(kinds(engine).filter((k) => k !== 'paragraph:')).toEqual(['list[one]', 'R', 'list[two]', 'paragraph:after']);
    expect(engine.regions.count).toBe(1);

    engine.undo();
    await engine.commit();
    expect(engine.tree.roots().some((r) => r.id.toString() === m.id)).toBe(false);
    expect(engine.undoManager.canUndo()).toBe(false); // one step for creation + hoisting
  });

  it('a marker inside a toggle body is hoisted right AFTER the toggle; several markers keep their order', async () => {
    const engine = await makeEditor(BOOK);
    const t = ToggleBlock.create(engine, 'toggle', { text: 'T' });
    await engine.commit();
    const tid = t.node.id.toString();
    Paragraph.create(engine, 'paragraph', { text: 'body' }, tid);
    await engine.commit();
    await para(engine, 'tail');
    engine.undoManager.clear();

    const m1 = engine.registry.get('region').create(engine, 'region', { regionType: 'part', title: 'A' }, tid);
    const m2 = engine.registry.get('region').create(engine, 'region', { regionType: 'part', title: 'B' }, tid);
    await engine.commit();
    const roots = engine.tree.roots().map((r) => r.id.toString());
    const ti = roots.indexOf(tid);
    expect(roots.slice(ti + 1, ti + 3)).toEqual([m1.id, m2.id]);
    expect(engine.regions.list.map((r) => r.title)).toEqual(['A', 'B']);
    expect(kinds(engine).find((k) => k.startsWith('toggle'))).toBe('toggle[paragraph]'.replace('paragraph', 'body'));
    engine.undo();
    await engine.commit();
    expect(engine.regions.count).toBe(0);
    expect(engine.undoManager.canUndo()).toBe(false);
  });

  it('a move into a container is undone by the hoisting: block id and fields survive', async () => {
    const engine = await makeEditor(BOOK);
    const m = await region(engine, 'chapter', 'Keep');
    const t = ToggleBlock.create(engine, 'toggle', { text: 'T' });
    await engine.commit();
    engine.undoManager.clear();
    m.node.move(t.node, 0);
    await engine.commit();
    const again = engine.blocks.get(m.id);
    expect(again.parent).toBe(null);
    expect(again.fields.title).toBe('Keep');
    expect(engine.children.map((b) => b.type)).toEqual(['toggle', 'region']);
  });

  it('a block retyped into a region while nested is hoisted too', async () => {
    const engine = await makeEditor(BOOK);
    const t = ToggleBlock.create(engine, 'toggle', { text: 'T' });
    await engine.commit();
    const p = Paragraph.create(engine, 'paragraph', { text: '' }, t.node.id.toString());
    await engine.commit();
    p.node.data.set('type', 'region');
    p.node.data.set('regionType', 'part');
    await engine.commit();
    expect(engine.children.map((b) => b.type)).toEqual(['paragraph', 'toggle', 'region']);
  });

  it('is opt-in: no extension, no hook', async () => {
    const engine = new Nabu({ extensions: [ParagraphExtension, BlockExtension] });
    expect(engine.hooks.get('onBeforeTransaction') ?? []).not.toContain(normalizeRegions);
    const withRegions = new Nabu({ extensions: [ParagraphExtension, RegionsExtension(), BlockExtension] });
    expect(withRegions.hooks.get('onBeforeTransaction')).toContain(normalizeRegions);
  });
});

describe('reactivity', () => {
  // Plain reads of the $derived registry: an unowned derived recomputes when a dependency changed, and returns the
  // SAME array when none did.
  it('insert / move / delete / retype a marker updates the registry', async () => {
    const engine = await makeEditor(BOOK);
    const l0 = engine.regions.list;
    expect(l0).toEqual([]);
    const a = await region(engine, 'part', '');
    await para(engine, 'x');
    const b = await region(engine, 'part', '');
    expect(labels(engine)).toEqual(['Part 1', 'Part 2']);

    b.node.move(undefined, 0); // b before everything
    await engine.commit();
    expect(engine.children[0].id).toBe(b.id);
    expect(engine.regions.list.map((r) => r.marker.id)).toEqual([b.id, a.id]);
    expect(labels(engine)).toEqual(['Part 1', 'Part 2']);

    engine.delete(engine.blocks.get(b.id));
    await engine.commit();
    expect(labels(engine)).toEqual(['Part 1']);

    a.setRegionType('chapter');
    expect(labels(engine)).toEqual(['Chapter 1']);
    expect(engine.regions.list[0].level).toBe(2);
  });

  it('typing does not recompute the structure (same array), word counts follow', async () => {
    const engine = await makeEditor(BOOK);
    await region(engine, 'part', 'P');
    const p = await para(engine, 'one');
    const list = engine.regions.list;
    expect(engine.regions.list[0].wordCount).toBe(1);
    p.behaviors.get('text').container.insert(3, ' two three');
    await engine.commit();
    expect(engine.regions.list).toBe(list);
    expect(engine.regions.list[0].wordCount).toBe(3);
  });

  it('a field change shows in region.fields without touching the structure', async () => {
    const engine = await makeEditor({ part: { level: 1, fields: { pov: 'text' } } });
    const m = await region(engine, 'part', 'P');
    const list = engine.regions.list;
    m.setField('pov', 'Anna');
    expect(engine.regions.list).toBe(list);
    expect(engine.regions.list[0].fields.pov).toBe('Anna');
  });
});

describe('JSON round trip', () => {
  it('serialize("json") writes { type: "region", props: { regionType, fields } } and importJSON restores it exactly', async () => {
    const engine = await makeEditor({ ...BOOK, note: { level: 3, fields: { synopsis: 'richtext', weight: 'number' } } });
    await para(engine, 'before');
    const part = await region(engine, 'part', 'La forêt');
    const note = engine.registry.get('region').create(engine, 'region', {
      regionType: 'note', title: 'N', fields: { weight: 2, synopsis: [{ insert: 'rich', attributes: { bold: true } }], extra: { k: true } },
    });
    await engine.commit();
    await para(engine, 'after');
    const json = engine.serialize('json');
    const exported = json.blocks.filter((b) => b.type === 'region');
    expect(exported[0]).toEqual({ id: part.id, type: 'region', props: { regionType: 'part', fields: { title: 'La forêt' } } });
    expect(exported[1].props).toEqual({
      regionType: 'note',
      fields: { title: 'N', weight: 2, synopsis: [{ insert: 'rich', attributes: { bold: true } }], extra: { k: true } },
    });

    const other = await makeEditor({ ...BOOK, note: { level: 3, fields: { synopsis: 'richtext', weight: 'number' } } });
    await other.importJSON(JSON.stringify(json));
    await other.commit();
    expect(other.serialize('json').blocks.map(({ id, ...rest }) => rest)).toEqual(json.blocks.map(({ id, ...rest }) => rest));
    expect(other.regions.list.map((r) => [r.type, r.title])).toEqual([['part', 'La forêt'], ['note', 'N']]);
    expect(other.regions.list[1].marker.richtext('synopsis').toDelta()).toEqual([{ insert: 'rich', attributes: { bold: true } }]);
  });

  it('the markdown export holds the marker (data comment + readable heading, lot 3) and the clipboard serializer adds the label echo', async () => {
    const engine = await makeEditor(BOOK);
    await para(engine, 'a');
    await region(engine, 'part', 'P');
    await para(engine, 'b');
    expect(engine.serialize('markdown')).toBe('a\n\n<!-- region:part {"title":"P"} -->\n# Part 1\n\nb');
    expect(engine.children[1].serialize('application/x-nabu+json')).toEqual({ type: 'region', props: { regionType: 'part', fields: { title: 'P' } }, partial: false, echo: { label: 'Part 1', level: 1 } });
    expect(engine.registry.get('region').toMarkdown({})).toBe('<!-- region:part {} -->\n# part'); // a hand-made block without a type: the default type
  });
});
