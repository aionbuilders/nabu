// @ts-nocheck
/**
 * ADR 019 lot A: the `stableIds` option. Stamping in the creating transaction, the index (`blockByUid`), the healer after remote
 * imports, and `stampBlockUids` on a bare LoroDoc.
 */
import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { LoroDoc, UndoManager } from 'loro-crdt';
import { stampBlockUids } from '@aionbuilders/nabu';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { Block } from '#lib/blocks/block.svelte.js';
import { UID_PREFIX, UIDS_ORIGIN, uidFor, compareTreeIds, UidIndex } from '#lib/blocks/uids.js';
import { extension } from '#lib/utils/extensions.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { HeadingExtension } from '#lib/blocks/heading/index.js';
import { ListExtension, ListItemExtension } from '#lib/blocks/list/index.js';
import { ToggleExtension } from '#lib/blocks/toggle/index.js';
import { CalloutExtension } from '#lib/blocks/callout/index.js';
import { CodeExtension } from '#lib/blocks/code/index.js';
import { ImageExtension } from '#lib/blocks/image/index.js';
import { RegionsExtension } from '#lib/blocks/region/index.js';
import { RichTextExtension } from '#lib/behaviors/text/index.js';
import { BlockExtension } from '#lib/blocks/block.extension.js';
import { MarkdownPasteExtension } from '#lib/paste/markdown.paste.js';
import { NabuPasteExtension } from '#lib/paste/index.js';

class CustomBlock extends Block {
  positions = 1;
  // does NOT go through any helper of ours: only nabu.tree.createNode
  static create(nabu, type, props = {}, parentId = null, index = null) {
    const node = nabu.tree.createNode(parentId || undefined, index ?? undefined);
    node.data.set('type', 'custom');
    return new CustomBlock(nabu, node);
  }
}
const CustomExtension = extension('custom', { block: CustomBlock });

const EXTENSIONS = [
  ParagraphExtension, HeadingExtension, ListExtension, ListItemExtension, ToggleExtension, CalloutExtension, CodeExtension,
  ImageExtension, RegionsExtension(), RichTextExtension, MarkdownPasteExtension, NabuPasteExtension, CustomExtension, BlockExtension,
];

async function make(init = {}) {
  const engine = new Nabu({ extensions: EXTENSIONS, ...init });
  await engine.commit();
  for (const c of [...engine.children]) engine.delete(c);
  await engine.commit();
  engine.undoManager.clear();
  return engine;
}

/** Every live node of the document, depth first. */
function nodes(engine) {
  const out = [];
  const walk = (n) => { out.push(n); for (const c of n.children() ?? []) walk(c); };
  for (const r of engine.tree.roots()) walk(r);
  return out;
}
const uidsOf = (engine) => nodes(engine).map((n) => n.data.get('uid'));
const unique = (list) => new Set(list).size === list.length;
const peerOf = (engine) => engine.doc.peerIdStr;

/** Two (or more) option-on engines on distinct peers, kept in sync by hand. */
async function pair(init = {}) {
  const a = new Nabu({ extensions: EXTENSIONS, stableIds: true, ...init });
  a.doc.setPeerId(1);
  await a.commit();
  const b = new Nabu({ extensions: EXTENSIONS, stableIds: true, snapshot: a.doc.export({ mode: 'snapshot' }), ...init });
  b.doc.setPeerId(2);
  await b.commit();
  return [a, b];
}
const sync = (from, to) => to.importRemote(from.doc.export({ mode: 'update', from: to.doc.version() }));
const syncBoth = (a, b) => { sync(a, b); sync(b, a); };

describe('option off', () => {
  it('writes no uid anywhere and answers nothing', async () => {
    const engine = await make();
    const p = engine.insert('paragraph', { text: 'one' });
    engine.insert('heading', { text: 'two', level: 1 });
    await engine.commit();
    engine.insertFragment({ blocks: [{ type: 'paragraph', partial: false, delta: [{ insert: 'pasted' }] }] });
    await tick(); await engine.commit();
    await engine.importMarkdown('# md\n\ntext');
    expect(engine.stableIds).toBe(false);
    expect(p.uid).toBeUndefined();
    expect(engine.blockByUid('u:' + p.id)).toBeNull();
    expect(nodes(engine).length).toBeGreaterThanOrEqual(2);
    expect(uidsOf(engine).every((u) => u === undefined)).toBe(true);
    expect(JSON.stringify(engine.doc.exportJsonUpdates())).not.toContain('"uid"');
    expect(JSON.stringify(engine.doc.toJSON())).not.toContain('uid');
  });
});

describe('a created block', () => {
  it('has uid = u: + TreeID and is found by blockByUid, for several types', async () => {
    const engine = await make({ stableIds: true });
    const made = [];
    made.push(engine.insert('paragraph', { text: 'p' }));
    made.push(engine.insert('heading', { text: 'h', level: 2 }));
    const list = engine.insert('list', {});
    made.push(list, engine.insert('list-item', { text: 'i' }, list.id, 0));
    const toggle = engine.insert('toggle', { text: 't' });
    made.push(toggle, engine.insert('paragraph', { text: 'in toggle' }, toggle.id, 0));
    made.push(engine.insert('callout', { text: 'c' }));
    made.push(engine.insert('code', { text: 'x' }));
    made.push(engine.insert('region', { title: 'R' }));
    made.push(engine.insert('image', { ref: 'r', alt: 'a' }));
    await engine.commit();
    for (const b of made) {
      expect(b.uid, b.type).toBe(UID_PREFIX + b.id);
      expect(engine.blockByUid(b.uid), b.type).toBe(b);
    }
    expect(unique(uidsOf(engine))).toBe(true);
    expect(engine.blockByUid('u:nope')).toBeNull();
  });
});

describe('undo and redo', () => {
  it('delete then undo: same uid, different block id', async () => {
    const engine = await make({ stableIds: true });
    const p = engine.insert('paragraph', { text: 'keep me' });
    await engine.commit();
    engine.undoManager.clear();
    const { uid, id } = p;
    engine.delete(p);
    await engine.commit();
    expect(engine.blockByUid(uid)).toBeNull();
    engine.undo(); await tick();
    const back = engine.blockByUid(uid);
    expect(back).not.toBeNull();
    expect(back.id).not.toBe(id);
    expect(back.uid).toBe(uid);
    expect(back.text).toBe('keep me');
  });

  it('undo of a creation then redo keeps the uid', async () => {
    const engine = await make({ stableIds: true });
    const p = engine.insert('paragraph', { text: 'x' });
    await engine.commit();
    const { uid } = p;
    engine.undo(); await tick();
    expect(engine.blockByUid(uid)).toBeNull();
    expect(engine.children.some((c) => c.uid === uid)).toBe(false);
    engine.redo(); await tick();
    const back = engine.blockByUid(uid);
    expect(back?.uid).toBe(uid);
    expect(engine.children.some((c) => c.uid === uid)).toBe(true);
  });
});

describe('copies are new blocks', () => {
  it('paste, importJSON and importMarkdown mint new unique uids', async () => {
    const engine = await make({ stableIds: true });
    const p = engine.insert('paragraph', { text: 'orig' });
    await engine.commit();
    const clip = { blocks: [p.toClipboardBlock ? p.toClipboardBlock() : { type: 'paragraph', partial: false, delta: [{ insert: 'orig' }] }] };
    engine.insertFragment(clip); await tick(); await engine.commit();
    engine.insertFragment(clip); await tick(); await engine.commit();
    const json = engine.serialize('json');
    await engine.importJSON(json);
    await engine.importJSON(json);
    await engine.importMarkdown('# t\n\n- a\n- b');
    await engine.commit();
    const all = uidsOf(engine);
    expect(nodes(engine).length).toBeGreaterThan(3);
    expect(all.every((u) => typeof u === 'string' && u.startsWith(UID_PREFIX))).toBe(true);
    expect(unique(all)).toBe(true);
  });
});

describe('a custom block from /extend', () => {
  it('is stamped, in the same undo step as its creation', async () => {
    const engine = await make({ stableIds: true });
    const c = engine.insert('custom', {});
    await engine.commit();
    expect(c).toBeInstanceOf(CustomBlock);
    expect(c.uid).toBe(UID_PREFIX + c.id);
    expect(engine.blockByUid(c.uid)).toBe(c);
    const { uid } = c;
    engine.undo(); await tick();
    expect(engine.blockByUid(uid)).toBeNull();
    expect(nodes(engine).some((n) => n.data.get('type') === 'custom')).toBe(false);
    engine.redo(); await tick();
    expect(engine.blockByUid(uid)?.type).toBe('custom');
  });
});

describe('two peers', () => {
  it('both delete and undo the same paragraph offline: unique uids, equal documents, the smallest TreeID keeps it', async () => {
    const [a, b] = await pair();
    const p = a.insert('paragraph', { text: 'P' });
    await a.commit();
    syncBoth(a, b); await tick();
    const uid = p.uid;
    expect(b.blockByUid(uid)?.text).toBe('P');
    a.undoManager.clear(); b.undoManager.clear();

    for (const e of [a, b]) {
      const blk = e.blockByUid(uid);
      e.delete(blk); await e.commit();
      e.undo(); await tick();
      expect(e.blockByUid(uid)).not.toBeNull();
    }
    syncBoth(a, b); await tick();
    syncBoth(a, b); await tick();

    for (const e of [a, b]) {
      const all = uidsOf(e);
      expect(nodes(e).filter((n) => n.data.get('text')?.toString() === 'P').length).toBe(2);
      expect(all.every(Boolean)).toBe(true);
      expect(unique(all)).toBe(true);
    }
    expect(a.doc.toJSON()).toEqual(b.doc.toJSON());
    const copies = nodes(a).filter((n) => n.data.get('text')?.toString() === 'P');
    const ids = copies.map((n) => n.id.toString()).sort(compareTreeIds);
    const keeper = copies.find((n) => n.id.toString() === ids[0]);
    const other = copies.find((n) => n.id.toString() === ids[1]);
    expect(keeper.data.get('uid')).toBe(uid);
    expect(other.data.get('uid')).toBe(uidFor(ids[1]));
    expect(a.blockByUid(uid).id).toBe(ids[0]);
    expect(b.blockByUid(uid).id).toBe(ids[0]);
  });

  it('a peer without the option creates blocks; peers with it stamp them, with the same values', async () => {
    const plain = new Nabu({ extensions: EXTENSIONS });
    plain.doc.setPeerId(7);
    plain.insert('paragraph', { text: 'a' });
    plain.insert('heading', { text: 'b', level: 1 });
    await plain.commit();
    expect(uidsOf(plain).every((u) => u === undefined)).toBe(true);
    const bytes = plain.doc.export({ mode: 'update' });

    const [a, b] = await pair();
    a.importRemote(bytes); b.importRemote(bytes); await tick();
    for (const e of [a, b]) {
      expect(e.children.length).toBeGreaterThanOrEqual(2);
      for (const blk of e.children) {
        expect(blk.uid).toBe(UID_PREFIX + blk.id);
        expect(e.blockByUid(blk.uid)).toBe(blk);
      }
    }
    syncBoth(a, b); await tick();
    expect(a.doc.toJSON()).toEqual(b.doc.toJSON());
    expect(unique(uidsOf(a))).toBe(true);
    expect(uidsOf(a)).toEqual(uidsOf(b));
  });

  it('a snapshot without uids is stamped on open', async () => {
    const plain = new Nabu({ extensions: EXTENSIONS });
    plain.insert('paragraph', { text: 'a' });
    const list = plain.insert('list', {});
    plain.insert('list-item', { text: 'i' }, list.id, 0);
    await plain.commit();
    const engine = new Nabu({ extensions: EXTENSIONS, stableIds: true, snapshot: plain.doc.export({ mode: 'snapshot' }) });
    await engine.commit();
    expect(nodes(engine).length).toBeGreaterThanOrEqual(3);
    for (const n of nodes(engine)) expect(n.data.get('uid')).toBe(uidFor(n.id.toString()));
    const first = engine.children[0];
    expect(engine.blockByUid(first.uid)).toBe(first);
  });
});

describe('stampBlockUids on a bare LoroDoc', () => {
  function bare() {
    const doc = new LoroDoc();
    const tree = doc.getTree('blocks');
    const a = tree.createNode(); a.data.set('type', 'paragraph');
    const b = tree.createNode(); b.data.set('type', 'list');
    const c = b.createNode(); c.data.set('type', 'list-item');
    doc.commit();
    return { doc, tree };
  }

  it('stamps every node, returns the count, and a second call writes nothing', () => {
    const { doc, tree } = bare();
    expect(stampBlockUids(doc)).toBe(3);
    for (const n of tree.getNodes({ withDeleted: false })) expect(n.data.get('uid')).toBe(uidFor(n.id.toString()));
    const v = doc.version().toJSON();
    expect(stampBlockUids(doc)).toBe(0);
    expect(doc.version().toJSON()).toEqual(v);
  });

  it('heals duplicates: the smallest TreeID keeps the uid', () => {
    const { doc, tree } = bare();
    const [x, y, z] = tree.getNodes({ withDeleted: false });
    for (const n of [x, y, z]) n.data.set('uid', 'u:shared');
    doc.commit();
    expect(stampBlockUids(doc)).toBe(2);
    const sorted = [x, y, z].map((n) => n.id.toString()).sort(compareTreeIds);
    for (const n of tree.getNodes({ withDeleted: false })) {
      const id = n.id.toString();
      expect(n.data.get('uid')).toBe(id === sorted[0] ? 'u:shared' : uidFor(id));
    }
    expect(stampBlockUids(doc)).toBe(0);
  });

  it('two forks stamped separately then merged both ways converge, with unique uids', () => {
    const { doc } = bare();
    const f1 = new LoroDoc(); f1.import(doc.export({ mode: 'snapshot' })); f1.setPeerId(11);
    const f2 = new LoroDoc(); f2.import(doc.export({ mode: 'snapshot' })); f2.setPeerId(22);
    const n1 = f1.getTree('blocks').createNode(); n1.data.set('type', 'paragraph'); f1.commit();
    const n2 = f2.getTree('blocks').createNode(); n2.data.set('type', 'paragraph'); f2.commit();
    stampBlockUids(f1); stampBlockUids(f2);
    f1.import(f2.export({ mode: 'update' }));
    f2.import(f1.export({ mode: 'update' }));
    expect(f1.toJSON()).toEqual(f2.toJSON());
    expect(stampBlockUids(f1)).toBe(0);
    expect(stampBlockUids(f2)).toBe(0);
    const uids = f1.getTree('blocks').getNodes({ withDeleted: false }).map((n) => n.data.get('uid'));
    expect(uids.length).toBe(5);
    expect(unique(uids)).toBe(true);
  });

  it('cannot be undone by a fresh UndoManager', () => {
    const { doc } = bare();
    const undo = new UndoManager(doc, { excludeOriginPrefixes: ['nabu:silent'] });
    stampBlockUids(doc);
    expect(undo.canUndo()).toBe(false);
    // and the origin is the documented silent one
    expect(UIDS_ORIGIN.startsWith('nabu:silent')).toBe(true);
  });
});

describe('silence', () => {
  it('a stamp or a heal adds no undo step: one letter, undo, only the letter goes', async () => {
    const [a, b] = await pair();
    const p = a.insert('paragraph', { text: '' });
    await a.commit();
    syncBoth(a, b); await tick();
    a.selection = { anchorBlock: p, focusBlock: p, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
    a.undoManager.clear();
    p.insert(0, 'x');
    await a.commit();
    // a remote import that makes A heal / stamp (a peer without the option adds a block)
    const plain = new Nabu({ extensions: EXTENSIONS, snapshot: a.doc.export({ mode: 'snapshot' }) });
    plain.doc.setPeerId(9);
    plain.tree.createNode().data.set('type', 'paragraph'); // a block without uid, as an old build wrote it
    plain.doc.commit();
    a.importRemote(plain.doc.export({ mode: 'update', from: a.doc.version() })); await tick();
    expect(uidsOf(a).length).toBeGreaterThan(2);
    const before = uidsOf(a);
    expect(before.every(Boolean)).toBe(true);
    a.undo(); await tick();
    expect(p.text).toBe('');
    expect(uidsOf(a)).toEqual(before);
    expect(a.undoManager.canUndo()).toBe(false);
  });
});

describe('cost guard', () => {
  it('option off: 2,000 blocks write no uid and never touch the index', async () => {
    const spy = vi.spyOn(UidIndex.prototype, 'add');
    const engine = await make();
    for (let i = 0; i < 2000; i++) engine.insert('paragraph', { text: 'n' + i });
    await engine.commit();
    expect(nodes(engine).length).toBeGreaterThanOrEqual(2000);
    expect(uidsOf(engine).some((u) => u !== undefined)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }, 180_000);
});
