// @ts-nocheck
/**
 * ADR 019 lot B: the rules of the uid ("the uid follows the first character"), their undo / redo, moves and retypes, the
 * `serialize('json')` export, and a micro cost check. Real engine, stubbed DOM selection.
 */
import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { jsonToText } from '#lib/format.js';
import { indentListItem, unindentListItem } from '#lib/blocks/list/list-item.svelte.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { HeadingExtension } from '#lib/blocks/heading/index.js';
import { ListExtension, ListItemExtension } from '#lib/blocks/list/index.js';
import { ToggleExtension } from '#lib/blocks/toggle/index.js';
import { CalloutExtension } from '#lib/blocks/callout/index.js';
import { CodeExtension } from '#lib/blocks/code/index.js';
import { ImageExtension } from '#lib/blocks/image/index.js';
import { DialogueExtension } from '#lib/blocks/dialogue/index.js';
import { RegionsExtension } from '#lib/blocks/region/index.js';
import { RichTextExtension } from '#lib/behaviors/text/index.js';
import { BlockExtension } from '#lib/blocks/block.extension.js';
import { MarkdownPasteExtension } from '#lib/paste/markdown.paste.js';
import { NabuPasteExtension } from '#lib/paste/index.js';

const EXTENSIONS = [
  ParagraphExtension, HeadingExtension, ListExtension, ListItemExtension, ToggleExtension, CalloutExtension, CodeExtension,
  ImageExtension, DialogueExtension, RegionsExtension(), RichTextExtension, MarkdownPasteExtension, NabuPasteExtension, BlockExtension,
];

const flush = async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 10)); await tick(); };

async function make(init = {}) {
  const engine = new Nabu({ extensions: EXTENSIONS, platform: 'other', ...init });
  await engine.commit();
  for (const c of [...engine.children]) engine.delete(c);
  await engine.commit();
  engine.selection = { anchorBlock: null, focusBlock: null, startBlock: null, endBlock: null, blocks: new Set(), isCollapsed: true, sync: vi.fn(), normalize: vi.fn(), setCursor: vi.fn() };
  engine.undoManager.clear();
  return engine;
}

/** The (stubbed) caret in `block` at `from`. */
function setCaret(engine, block, from, to = from) {
  const read = () => ({ from, to, isCollapsed: from === to, direction: 'none' });
  Object.defineProperty(block, 'selection', { configurable: true, get: read });
  const behavior = block.behaviors?.get('text');
  if (behavior) Object.defineProperty(behavior, 'selection', { configurable: true, get: read });
  const setCursor = engine.selection.setCursor;
  engine.selection = { anchorBlock: block, focusBlock: block, startBlock: block, endBlock: block, blocks: new Set([block]), isCollapsed: from === to, sync: vi.fn(), normalize: vi.fn(), setCursor };
}

async function paragraphs(texts, init = { stableIds: true }) {
  const engine = await make(init);
  const stray = engine.children[0]; // the empty paragraph the engine keeps in an emptied document
  texts.forEach((t, i) => engine.insert('paragraph', { text: t }, null, i));
  engine.delete(stray);
  await engine.commit();
  engine.undoManager.clear();
  return engine;
}

/** Every live node, depth first. */
function nodes(engine) {
  const out = [];
  const walk = (n) => { out.push(n); for (const c of n.children() ?? []) walk(c); };
  for (const r of engine.tree.roots()) walk(r);
  return out;
}
const uidsOf = (engine) => nodes(engine).map((n) => n.data.get('uid'));
const unique = (list) => new Set(list).size === list.length;
const textOf = (n) => n.data.get('text')?.toString() ?? '';
/** `text|type -> uid` in document order: what an undo must give back exactly. */
const snapshot = (engine) => nodes(engine).map((n) => [n.data.get('type') + ':' + textOf(n), n.data.get('uid')]);
const uidOfText = (engine, text) => nodes(engine).find((n) => textOf(n) === text)?.data.get('uid');
const blockOfText = (engine, text) => engine.children.map(function find(b) { return b; }).flatMap(function flat(b) { return [b, ...(b.children ?? []).flatMap(flat)]; }).find((b) => b.behaviors?.get('text')?.text === text);

/** Enter at `offset`: the real split path. */
async function enter(engine, block, offset) {
  block.ascend('onSplit', null, { offset, delta: block.container.sliceDelta(offset, block.container.length) });
  await engine.commit();
  await flush();
}
/** Backspace / Delete at a block boundary: the real text behavior. */
async function backspace(engine, block) {
  const e = { inputType: 'deleteContentBackward', preventDefault: vi.fn() };
  block.behaviors.get('text').handleDeleteContentBackward(e, { from: 0, to: 0, isCollapsed: true });
  await engine.commit();
  await flush();
}
async function forwardDelete(engine, block) {
  const e = { inputType: 'deleteContentForward', preventDefault: vi.fn() };
  const len = block.behaviors.get('text').text.length;
  block.behaviors.get('text').handleDeleteContentForward(e, { from: len, to: len, isCollapsed: true });
  await engine.commit();
  await flush();
}

describe('split', () => {
  it('in the middle: the first half keeps the uid, the second gets a new one', async () => {
    const engine = await paragraphs(['abcdef']);
    const [p] = engine.children;
    const uid = p.uid;
    await enter(engine, p, 3);
    const [a, b] = engine.children;
    expect(a.text).toBe('abc');
    expect(b.text).toBe('def');
    expect(a.uid).toBe(uid);
    expect(b.uid).toBe('u:' + b.id);
    expect(b.uid).not.toBe(uid);
    expect(engine.blockByUid(uid)).toBe(a);
  });

  it('Enter at offset 0 of a non-empty paragraph: the block with the text keeps the uid, the empty one has a new one', async () => {
    const engine = await paragraphs(['text', 'after']);
    const [p] = engine.children;
    const uid = p.uid;
    await enter(engine, p, 0);
    const [empty, full] = engine.children.slice(0, 2);
    expect(empty.text).toBe('');
    expect(full.text).toBe('text');
    expect(full.uid).toBe(uid);
    expect(empty.uid).toBeTruthy();
    expect(empty.uid).not.toBe(uid);
    expect(unique(uidsOf(engine))).toBe(true);
    expect(engine.blockByUid(uid).text).toBe('text');
    expect(engine.blockByUid(empty.uid)).toBe(empty);
  });

  it('Enter at offset 0 of a heading, a list item and a dialogue follows the same rule', async () => {
    const engine = await make({ stableIds: true });
    const h = engine.insert('heading', { text: 'title', level: 1 });
    const d = engine.insert('dialogue', { text: 'hello' });
    const list = engine.insert('list', {});
    const li = engine.insert('list-item', { text: 'item' }, list.id, 0);
    await engine.commit();
    for (const [b, text] of [[d, 'hello'], [li, 'item']]) {
      const uid = b.uid;
      await enter(engine, b, 0);
      expect(engine.blockByUid(uid).text, b.type).toBe(text);
    }
    // a heading at offset 0 keeps its text AND its node (an empty paragraph appears above): nothing to transfer
    const hid = h.uid;
    await enter(engine, h, 0);
    expect(engine.blockByUid(hid)).toBe(h);
    expect(unique(uidsOf(engine))).toBe(true);
  });

  it('option off: nothing is written by a split', async () => {
    const engine = await paragraphs(['text'], {});
    await enter(engine, engine.children[0], 0);
    expect(uidsOf(engine).every((u) => u === undefined)).toBe(true);
  });
});

describe('merge', () => {
  it('Backspace at the start of a paragraph after an EMPTY paragraph: the merged block has the paragraph\'s uid', async () => {
    const engine = await paragraphs(['', 'text']);
    const [empty, p] = engine.children;
    const uid = p.uid;
    const gone = empty.uid;
    await backspace(engine, p);
    expect(engine.children.length).toBe(1);
    expect(engine.children[0].text).toBe('text');
    expect(engine.children[0].uid).toBe(uid);
    expect(engine.blockByUid(uid).text).toBe('text');
    expect(engine.blockByUid(gone)).toBeNull();
    expect(unique(uidsOf(engine))).toBe(true);
  });

  it('Backspace after a NON-empty paragraph: the survivor keeps its own uid', async () => {
    const engine = await paragraphs(['one', 'two']);
    const [a, b] = engine.children;
    const uid = a.uid;
    await backspace(engine, b);
    expect(engine.children.length).toBe(1);
    expect(engine.children[0].text).toBe('onetwo');
    expect(engine.children[0].uid).toBe(uid);
    expect(engine.blockByUid(b.uid)).toBeNull();
  });

  it('Delete at the end of an empty block before a non-empty one: the survivor takes the uid of the consumed block', async () => {
    const engine = await paragraphs(['', 'text']);
    const [empty, p] = engine.children;
    const uid = p.uid;
    await forwardDelete(engine, empty);
    expect(engine.children.length).toBe(1);
    expect(engine.children[0].text).toBe('text');
    expect(engine.children[0].uid).toBe(uid);
    expect(unique(uidsOf(engine))).toBe(true);
  });

  it('Delete at the end of a non-empty block: the survivor keeps its uid', async () => {
    const engine = await paragraphs(['one', 'two']);
    const [a] = engine.children;
    const uid = a.uid;
    await forwardDelete(engine, a);
    expect(engine.children[0].uid).toBe(uid);
    expect(engine.children[0].text).toBe('onetwo');
  });

  it('option off: nothing is written by a merge', async () => {
    const engine = await paragraphs(['', 'text'], {});
    await backspace(engine, engine.children[1]);
    expect(uidsOf(engine).every((u) => u === undefined)).toBe(true);
  });
});

describe('undo / redo of the transfers (Orduin saves its caret by uid)', () => {
  it('Enter at offset 0: undo gives back every uid exactly, redo gives back the state after', async () => {
    const engine = await paragraphs(['one', 'two', 'three']);
    const [, p] = engine.children;
    setCaret(engine, p, 0);
    const before = snapshot(engine);
    await enter(engine, p, 0);
    const after = snapshot(engine);
    expect(after).not.toEqual(before);
    expect(unique(after.map((x) => x[1]))).toBe(true);

    engine.undo(); await flush();
    expect(snapshot(engine)).toEqual(before);
    expect(unique(uidsOf(engine))).toBe(true);
    for (const [, uid] of before) expect(engine.blockByUid(uid)).not.toBeNull();

    engine.redo(); await flush();
    expect(snapshot(engine)).toEqual(after);
    expect(unique(uidsOf(engine))).toBe(true);
    engine.undo(); await flush();
    expect(snapshot(engine)).toEqual(before);
  });

  it('Backspace into an empty block: undo and redo give back every uid exactly', async () => {
    const engine = await paragraphs(['one', '', 'three']);
    const p = engine.children[2];
    setCaret(engine, engine.children[1], 0);
    const before = snapshot(engine);
    // empty block in the middle: Backspace at the start of "three" merges it into the empty block above
    await backspace(engine, p);
    const after = snapshot(engine);
    expect(after.length).toBe(before.length - 1);
    expect(uidOfText(engine, 'three')).toBe(before[2][1]);

    engine.undo(); await flush();
    expect(snapshot(engine)).toEqual(before);
    expect(unique(uidsOf(engine))).toBe(true);
    for (const [, uid] of before) expect(engine.blockByUid(uid)).not.toBeNull();

    engine.redo(); await flush();
    expect(snapshot(engine)).toEqual(after);
    expect(unique(uidsOf(engine))).toBe(true);
  });

  it('deleting a block then undo brings its uid back (a new block id)', async () => {
    const engine = await paragraphs(['one', 'two']);
    const [, p] = engine.children;
    const uid = p.uid;
    engine.delete(p); await engine.commit();
    expect(engine.blockByUid(uid)).toBeNull();
    engine.undo(); await flush();
    expect(engine.blockByUid(uid).text).toBe('two');
  });
});

describe('moves keep the uid', () => {
  it('a drag move (the handle moves the node), a keyboard move, an indent and an outdent, a region move', async () => {
    const engine = await paragraphs(['one', 'two', 'three']);
    const [a, b, c] = engine.children;
    const uids = [a.uid, b.uid, c.uid];
    // drag handle: node.moveAfter / moveBefore
    a.node.moveAfter(c.node); await engine.commit(); await flush();
    expect(engine.children.map((x) => x.text)).toEqual(['two', 'three', 'one']);
    expect(engine.children.map((x) => x.uid)).toEqual([uids[1], uids[2], uids[0]]);
    // keyboard move
    setCaret(engine, engine.children[2], 0);
    await engine.exec('block:move-up'); await flush();
    expect(engine.children.map((x) => x.text)).toEqual(['two', 'one', 'three']);
    expect(engine.children.map((x) => x.uid)).toEqual([uids[1], uids[0], uids[2]]);

    // list items: indent / outdent
    const e2 = await make({ stableIds: true });
    const list = e2.insert('list', { listType: 'bullet' });
    const i1 = e2.insert('list-item', { text: 'x' }, list.id, 0);
    const i2 = e2.insert('list-item', { text: 'y' }, list.id, 1);
    await e2.commit();
    const [u1, u2] = [i1.uid, i2.uid];
    indentListItem(e2.blocks.get(i2.id)); await e2.commit(); await flush();
    expect(textOf(nodes(e2).find((n) => n.data.get('uid') === u2).parent().parent())).toBe('x');
    unindentListItem(e2.blocks.get(e2.blockByUid(u2).id)); await e2.commit(); await flush();
    expect(e2.blockByUid(u1).text).toBe('x');
    expect(e2.blockByUid(u2).text).toBe('y');
    expect(unique(uidsOf(e2))).toBe(true);
  });

  it('region:move keeps the uids of the regions', async () => {
    const engine = await make({ stableIds: true });
    const r1 = engine.insert('region', { regionType: 'section-1', title: 'A' });
    engine.insert('paragraph', { text: 'a' }, r1.id, 0);
    const r2 = engine.insert('region', { regionType: 'section-1', title: 'B' });
    engine.insert('paragraph', { text: 'b' }, r2.id, 0);
    await engine.commit();
    const [u1, u2] = [r1.uid, r2.uid];
    setCaret(engine, blockOfText(engine, 'b'), 0);
    await engine.exec('region:move-up'); await flush();
    expect(engine.blockByUid(u1).type).toBe('region');
    expect(engine.blockByUid(u2).type).toBe('region');
    expect(unique(uidsOf(engine))).toBe(true);
  });
});

describe('retypes keep the uid', () => {
  it('paragraph to heading by the markdown shortcut and by block:transform', async () => {
    const engine = await paragraphs(['#', 'plain']);
    const [shortcut, plain] = engine.children;
    const [u1, u2] = [shortcut.uid, plain.uid];
    setCaret(engine, shortcut, 1);
    for (const hook of engine.hooks.get('onBeforeInput')) {
      if (hook(engine, { inputType: 'insertText', data: ' ', preventDefault: vi.fn() }, shortcut) === engine.BREAK) break;
    }
    await flush();
    expect(engine.blockByUid(u1).type).toBe('heading');
    setCaret(engine, plain, 0);
    await engine.exec('block:transform', { type: 'heading', props: { level: 2 } }); await flush();
    expect(engine.blockByUid(u2).type).toBe('heading');
    expect(unique(uidsOf(engine))).toBe(true);
  });

  it('paragraph to list item ("- ") and list:convert: the item inherits the uid', async () => {
    const engine = await paragraphs(['-', 'other']);
    const [shortcut, other] = engine.children;
    const [u1, u2] = [shortcut.uid, other.uid];
    setCaret(engine, shortcut, 1);
    for (const hook of engine.hooks.get('onBeforeInput')) {
      if (hook(engine, { inputType: 'insertText', data: ' ', preventDefault: vi.fn() }, shortcut) === engine.BREAK) break;
    }
    await flush();
    expect(engine.blockByUid(u1)?.type).toBe('list-item');
    expect(unique(uidsOf(engine))).toBe(true);
    setCaret(engine, engine.blockByUid(u2), 0);
    await engine.exec('list:convert', { listType: 'bullet' }).catch(() => {}); await flush();
    expect(unique(uidsOf(engine))).toBe(true);
  });

  it('list step-back (Enter in an empty item) and toggle exit keep the uid', async () => {
    const engine = await make({ stableIds: true });
    const list = engine.insert('list', { listType: 'bullet' });
    const item = engine.insert('list-item', { text: '' }, list.id, 0);
    await engine.commit();
    const uid = item.uid;
    await enter(engine, engine.blocks.get(item.id), 0);
    expect(engine.blockByUid(uid)?.type).toBe('paragraph');

    const e2 = await make({ stableIds: true });
    const toggle = e2.insert('toggle', { text: 'T' });
    const inner = e2.insert('paragraph', { text: '' }, toggle.id, 0);
    await e2.commit();
    const iu = inner.uid;
    await enter(e2, e2.blocks.get(inner.id), 0);
    expect(e2.blockByUid(iu)).not.toBeNull();
    expect(e2.blockByUid(iu).parent ?? null).toBeNull();
    expect(unique(uidsOf(e2))).toBe(true);
  });
});

describe('regions', () => {
  it('region:split: the region that stays keeps its uid, the new one gets a new uid', async () => {
    const engine = await make({ stableIds: true });
    const r = engine.insert('region', { regionType: 'section-1', title: 'R' });
    engine.insert('paragraph', { text: 'abcdef' }, r.id, 0);
    engine.insert('paragraph', { text: 'tail' }, r.id, 1);
    await engine.commit();
    const uid = r.uid;
    setCaret(engine, blockOfText(engine, 'abcdef'), 3);
    await engine.exec('region:split'); await flush();
    const regions = nodes(engine).filter((n) => n.data.get('type') === 'region');
    expect(regions.length).toBe(2);
    expect(regions[0].data.get('uid')).toBe(uid);
    expect(regions[1].data.get('uid')).not.toBe(uid);
    expect(unique(uidsOf(engine))).toBe(true);
  });

  it('region:merge-previous: the surviving region keeps its uid', async () => {
    const engine = await make({ stableIds: true });
    const a = engine.insert('region', { regionType: 'section-1', title: 'AA' });
    engine.insert('paragraph', { text: 'a' }, a.id, 0);
    const b = engine.insert('region', { regionType: 'section-1', title: 'BB' });
    engine.insert('paragraph', { text: 'b' }, b.id, 0);
    await engine.commit();
    const [ua, ub] = [a.uid, b.uid];
    setCaret(engine, blockOfText(engine, 'BB'), 0);
    await engine.exec('region:merge-previous'); await flush();
    expect(engine.blockByUid(ua).type).toBe('region');
    expect(engine.blockByUid(ub)).toBeNull();
    expect(unique(uidsOf(engine))).toBe(true);
  });
});

describe('every type', () => {
  it('has a unique uid, and delete then undo brings it back: toggle body, callout, code, image, list items, dialogue', async () => {
    const engine = await make({ stableIds: true });
    const toggle = engine.insert('toggle', { text: 't' });
    const kid = engine.insert('paragraph', { text: 'kid' }, toggle.id, 0);
    const callout = engine.insert('callout', { text: 'c' });
    const code = engine.insert('code', { text: 'x' });
    const image = engine.insert('image', { ref: 'r', alt: 'a' });
    const dialogue = engine.insert('dialogue', { text: 'd' });
    const list = engine.insert('list', { listType: 'bullet' });
    const li = engine.insert('list-item', { text: 'i' }, list.id, 0);
    await engine.commit();
    expect(unique(uidsOf(engine))).toBe(true);
    for (const b of [kid, callout, code, image, dialogue, li]) {
      const { uid, type } = b;
      expect(uid, type).toBeTruthy();
      engine.undoManager.clear();
      engine.delete(engine.blocks.get(b.id)); await engine.commit();
      expect(engine.blockByUid(uid), type).toBeNull();
      engine.undo(); await flush();
      expect(engine.blockByUid(uid)?.type, type).toBe(type);
    }
    expect(unique(uidsOf(engine))).toBe(true);
  });

  it('Enter in a toggle body child splits it by the usual rule', async () => {
    const engine = await make({ stableIds: true });
    const toggle = engine.insert('toggle', { text: 't' });
    const kid = engine.insert('paragraph', { text: 'abcdef' }, toggle.id, 0);
    await engine.commit();
    const uid = kid.uid;
    await enter(engine, engine.blocks.get(kid.id), 3);
    expect(engine.blockByUid(uid).text).toBe('abc');
    expect(unique(uidsOf(engine))).toBe(true);
  });

  it('two adjacent lists merged by the normalizer: one list survives with a uid, all uids unique', async () => {
    const engine = await make({ stableIds: true });
    const l1 = engine.insert('list', { listType: 'bullet' });
    engine.insert('list-item', { text: 'a' }, l1.id, 0);
    const l2 = engine.insert('list', { listType: 'bullet' });
    engine.insert('list-item', { text: 'b' }, l2.id, 0);
    await engine.commit();
    await flush();
    const lists = nodes(engine).filter((n) => n.data.get('type') === 'list');
    expect(lists.length).toBe(1);
    expect(lists[0].data.get('uid')).toBeTruthy();
    expect(unique(uidsOf(engine))).toBe(true);
    expect(uidsOf(engine).every(Boolean)).toBe(true);
  });
});

describe('serialize("json") and import', () => {
  it('carries uid on every block with the option, none without', async () => {
    const on = await make({ stableIds: true });
    on.insert('paragraph', { text: 'a' });
    const toggle = on.insert('toggle', { text: 't' });
    on.insert('paragraph', { text: 'k' }, toggle.id, 0);
    const list = on.insert('list', { listType: 'bullet' });
    on.insert('list-item', { text: 'i' }, list.id, 0);
    on.insert('image', { ref: 'r', alt: 'a' });
    await on.commit();
    const json = on.serialize('json');
    const all = [];
    const walk = (bs) => bs.forEach((b) => { all.push(b); walk(b.children ?? []); });
    walk(json.blocks);
    expect(all.length).toBeGreaterThanOrEqual(6);
    const live = new Set(uidsOf(on));
    for (const b of all) expect(live.has(b.uid), b.type).toBe(true);
    for (const b of all) expect(typeof b.uid, b.type).toBe('string');

    const off = await make();
    off.insert('paragraph', { text: 'a' });
    await off.commit();
    expect(off.serialize('json').blocks.every((b) => !('uid' in b))).toBe(true);
  });

  it('importJSON of a JSON that carries uids gives new, unique uids; jsonToText is the same with or without them', async () => {
    const source = await make({ stableIds: true });
    source.insert('paragraph', { text: 'one' });
    const list = source.insert('list', { listType: 'bullet' });
    source.insert('list-item', { text: 'item' }, list.id, 0);
    await source.commit();
    const json = source.serialize('json');
    const carried = new Set();
    const walk = (bs) => bs.forEach((b) => { carried.add(b.uid); walk(b.children ?? []); });
    walk(json.blocks);
    expect(carried.size).toBeGreaterThanOrEqual(3);

    const target = await make({ stableIds: true });
    await target.importJSON(json);
    await flush();
    const uids = uidsOf(target);
    expect(uids.every(Boolean)).toBe(true);
    expect(unique(uids)).toBe(true);
    for (const u of uids) expect(carried.has(u), u).toBe(false);
    expect(target.serialize('text')).toBe(source.serialize('text'));

    const stripped = JSON.parse(JSON.stringify(json), (k, v) => (k === 'uid' ? undefined : v));
    expect(jsonToText(json)).toBe(jsonToText(stripped));
  });

  it('importJSON into an option-off editor writes no uid', async () => {
    const source = await make({ stableIds: true });
    source.insert('paragraph', { text: 'one' });
    await source.commit();
    const target = await make();
    await target.importJSON(source.serialize('json'));
    expect(uidsOf(target).every((u) => u === undefined)).toBe(true);
  });
});

describe('cost (numbers are reported, nothing tight is asserted)', () => {
  // Prints numbers only (no bound): opt in with NABU_COST=1, it takes 10 to 20 s.
  it.skipIf(!process.env.NABU_COST)('10,000 paragraphs off vs on, and one keystroke in a 10,000-block document', async () => {
    const N = 10_000;
    const report = {};
    for (const on of [false, true]) {
      const engine = await make(on ? { stableIds: true } : {});
      const t0 = performance.now();
      for (let i = 0; i < N; i++) engine.insertPending('paragraph', { text: 'n' + i });
      await engine.commit();
      report[on ? 'create on' : 'create off'] = Math.round(performance.now() - t0);
      const p = engine.children[Math.floor(N / 2)];
      const runs = 30;
      const t1 = performance.now();
      for (let i = 0; i < runs; i++) { p.insert(0, 'x'); await engine.commit(); }
      report[on ? 'keystroke on (ms)' : 'keystroke off (ms)'] = +((performance.now() - t1) / runs).toFixed(2);
      expect(engine.children.length).toBeGreaterThanOrEqual(N);
      if (on) expect(unique(uidsOf(engine))).toBe(true);
    }
    process.stderr.write('STABLE-IDS COST ' + JSON.stringify(report) + '\n');
  }, 600_000);
});
