// @ts-nocheck
/**
 * ADR 014 lot 3 — history modes and the safeguards of a compaction. `full` (default) never drops anything; `compact` (opt-in,
 * at open, or `nabu.compact()`) keeps a Loro shallow snapshot from the retention point, after `onBeforeCompact`, refusing while an
 * upload is pending or changes are unsaved; the files only the dropped history referenced are released (shared store, host).
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoroDoc, LoroMap } from 'loro-crdt';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { ImageExtension } from '$lib/blocks/image/index.js';
import { FileExtension } from '$lib/blocks/file/index.js';
import { NabuPasteExtension, PlainTextPasteExtension, HtmlPasteExtension } from '$lib/paste/index.js';
import { Files } from '$lib/files/files.svelte.js';
import { createPersistedEditor, loadSnapshot, saveSnapshot, IndexedDBAssetStore, IndexedDBOutbox } from '$lib/persistence/persistence.js';
import { parseRetain, parseHistory } from '$lib/persistence/history.js';
import { releaseFiles, DEFAULT_RELEASE_GRACE_MS } from '$lib/persistence/release.js';
import { sha256Id } from '$lib/files/assets.clipboard.js';

const EXTENSIONS = [ParagraphExtension, ImageExtension, FileExtension, NabuPasteExtension, PlainTextPasteExtension, HtmlPasteExtension];
const DAY = 86_400;
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
/** Distinct, incompressible-ish bytes per `seed`. */
const bytes = (seed, length = 64) => {
  let x = (seed * 2654435761) >>> 0 || 1; // xorshift: incompressible, so a snapshot that holds them is visibly big
  return Uint8Array.from({ length }, () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x & 255; });
};
const file = (seed, name = `pic-${seed}.png`) => new File([bytes(seed)], name, { type: 'image/png' });

let OriginalBlob;
beforeEach(() => {
  // happy-dom's Blob cannot go through Node's structuredClone (what fake-indexeddb uses)
  OriginalBlob = globalThis.Blob;
  globalThis.Blob = NodeBlob;
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => { globalThis.Blob = OriginalBlob; vi.restoreAllMocks(); });

// `releaseGraceMs: 0` by default here: the tests release files they added a moment ago (the grace period has its own describe below)
const open = (docId, extra = {}) => createPersistedEditor({ docId, preset: EXTENSIONS, debounce: 3_600_000, ...extra, files: { releaseGraceMs: 0, ...extra.files } });
const idbStore = () => new IndexedDBAssetStore();
const storedKeys = async () => { const out = []; for await (const k of idbStore().keys()) out.push(k); return out.sort(); };
const hashOf = (seed) => sha256Id(bytes(seed));
const savedSize = async (docId) => (await loadSnapshot(docId)).length;

/** Add an image block whose file is `seed` (stored in the shared store). */
async function addImage(engine, seed, atTimestamp, stored) {
  // (persisting commits the index with the time of now, and Loro keeps timestamps ascending: store the files before any dated commit)
  const ref = stored ?? await Files.get(engine).persist(file(seed));
  if (atTimestamp) engine.doc.setNextCommitTimestamp(atTimestamp);
  const block = engine.insert('image', { ref, alt: `img-${seed}` });
  await engine.commit();
  return block;
}
async function removeBlock(engine, block, atTimestamp) {
  if (atTimestamp) engine.doc.setNextCommitTimestamp(atTimestamp);
  engine.tree.delete(block.node.id); await engine.commit(); }
/** Add a paragraph of text; returns the block. */
async function addText(engine, text, atTimestamp) {
  if (atTimestamp) engine.doc.setNextCommitTimestamp(atTimestamp);
  const block = engine.insert('paragraph', { text });
  await engine.commit();
  return block;
}
/** Make the history grow: many insert / delete commits. */
async function churn(engine, n = 30) {
  for (let i = 0; i < n; i++) {
    const b = engine.insert('paragraph', { text: `churn ${i} ` + 'lorem ipsum dolor sit amet '.repeat(8) });
    await engine.commit();
    engine.tree.delete(b.node.id);
    await engine.commit();
  }
}
const texts = (engine) => JSON.stringify(engine.doc.toJSON());
const canCheckout = (doc, frontiers) => {
  try { doc.checkout(frontiers); return true; } catch { return false; } finally { doc.checkoutToLatest(); }
};

describe('history option and retain parsing', () => {
  it('retain: ms number, 0, or <number><s|m|h|d|w>; anything else throws', () => {
    expect(parseRetain(0)).toBe(0);
    expect(parseRetain(1500)).toBe(1500);
    expect(parseRetain('30d')).toBe(30 * 86_400_000);
    expect(parseRetain('12h')).toBe(12 * 3_600_000);
    expect(parseRetain('1.5h')).toBe(5_400_000);
    expect(parseRetain('90s')).toBe(90_000);
    expect(parseRetain('2w')).toBe(14 * 86_400_000);
    expect(parseRetain('0')).toBe(0);
    for (const bad of [-1, NaN, Infinity, '30', '30 days', 'd', '', '1y', null, undefined, {}]) expect(() => parseRetain(bad)).toThrow(TypeError);
  });
  it('history: full by default; compact needs a valid retain; a typo throws', () => {
    expect(parseHistory(undefined)).toEqual({ mode: 'full' });
    expect(parseHistory('full')).toEqual({ mode: 'full' });
    expect(parseHistory({ mode: 'full' })).toEqual({ mode: 'full' });
    expect(parseHistory({ mode: 'compact', retain: '30d' })).toMatchObject({ mode: 'compact', retain: 30 * 86_400_000 });
    expect(() => parseHistory({ mode: 'compact' })).toThrow(TypeError);
    expect(() => parseHistory({ mode: 'compact', retain: 0, onBeforeCompact: 3 })).toThrow(TypeError);
    expect(() => parseHistory('compact')).toThrow(TypeError);
    expect(() => parseHistory({ mode: 'trim' })).toThrow(TypeError);
  });
  it('createPersistedEditor and nabu.compact reject an invalid configuration', async () => {
    await expect(open('d', { history: { mode: 'compact', retain: 'soon' } })).rejects.toThrow(TypeError);
    const engine = await open('d');
    await expect(engine.compact({})).rejects.toThrow(TypeError); // retain is required: no default drops data
  });
});

describe('timestamps', () => {
  it('a persisted editor records the time of its changes (needed for a retention window)', async () => {
    const engine = await open('ts');
    await addText(engine, 'hello');
    const stamps = [...engine.doc.getAllChanges().values()].flat().map((c) => c.timestamp);
    expect(Math.max(...stamps)).toBeGreaterThan(Date.now() / 1000 - 60);
  });
});

describe('history: full (the default) never compacts', () => {
  it('open / save / close many times: nothing is dropped, the snapshot only grows with new edits, the first version stays reachable', async () => {
    let engine = await open('novel');
    const first = engine.doc.oplogFrontiers();
    await addText(engine, 'chapter one');
    const v1 = engine.doc.oplogFrontiers();
    await churn(engine, 10);
    await engine.saveNow();
    const size = await savedSize('novel');
    for (let i = 0; i < 4; i++) {
      engine = await open('novel', i % 2 ? { history: 'full' } : {});
      await engine.saveNow();
      expect(engine.doc.isShallow()).toBe(false);
      expect(await savedSize('novel')).toBe(size); // no edit: not a byte more, not a byte less
    }
    await addText(engine, 'chapter two');
    await engine.saveNow();
    expect(await savedSize('novel')).toBeGreaterThan(size);
    const reopened = await open('novel');
    expect(canCheckout(reopened.doc, first)).toBe(true); // the very first version
    expect(canCheckout(reopened.doc, v1)).toBe(true);
    expect(reopened.doc.isShallow()).toBe(false);
  });

  it('files are never released in full mode: deleting an image keeps its bytes and index entry (every version may reference it)', async () => {
    let engine = await open('keep');
    const block = await addImage(engine, 1);
    await removeBlock(engine, block);
    await engine.saveNow();
    engine = await open('keep');
    await engine.saveNow();
    expect(await storedKeys()).toEqual([await hashOf(1)]);
    expect(Object.keys(Files.get(engine).index.toJSON())).toEqual([await hashOf(1)]);
    expect([...(await idbStore().getDocRefs('keep'))]).toEqual([await hashOf(1)]);
  });
});

describe('compact mode at open', () => {
  it('retain 0: no past history, same content, smaller snapshot, deleted image released everywhere', async () => {
    let engine = await open('c0');
    await addText(engine, 'kept text');
    const old = engine.doc.oplogFrontiers();
    const gone = await addImage(engine, 1);
    const stays = await addImage(engine, 2);
    await removeBlock(engine, gone);
    await churn(engine, 20);
    await engine.saveNow();
    const before = await savedSize('c0');
    expect(await storedKeys()).toEqual([await hashOf(1), await hashOf(2)].sort());

    engine = await open('c0', { history: { mode: 'compact', retain: 0 } });
    expect(engine.doc.isShallow()).toBe(true);
    // loro-crdt >= 1.13: a shallow snapshot keeps the meta maps of DELETED tree nodes (they can be revived), so churn that deletes blocks compacts less (~0.63 of the full size here instead of ~0.15)
    expect(await savedSize('c0')).toBeLessThan(before * 0.8);
    expect(canCheckout(engine.doc, old)).toBe(false); // the past is gone
    const imageRefs = [...engine.blocks.values()].filter((b) => b.type === 'image' && !b.node.isDeleted?.()).map((b) => b.ref);
    expect(imageRefs).toEqual([stays.ref]);
    expect(JSON.stringify(engine.doc.toJSON().blocks ?? engine.doc.toJSON())).toContain('kept text');
    // the released file: out of the index, out of docRefs, out of the shared store; the kept one is untouched
    expect(Object.keys(Files.get(engine).index.toJSON())).toEqual([await hashOf(2)]);
    expect([...(await idbStore().getDocRefs('c0'))]).toEqual([await hashOf(2)]);
    expect(await storedKeys()).toEqual([await hashOf(2)]);

    // and it keeps working: edit, save, reopen in full mode (a shallow snapshot loads), still compact
    await addText(engine, 'after compaction');
    await engine.saveNow();
    const again = await open('c0');
    expect(again.doc.isShallow()).toBe(true);
    expect(JSON.stringify(again.doc.toJSON())).toContain('after compaction');
  });

  it('a window: versions newer than the retention point survive and can be checked out, older ones are gone', async () => {
    const now = Math.floor(Date.now() / 1000);
    let engine = await open('win');
    await addText(engine, 'ten days ago', now - 10 * DAY);
    const f10 = engine.doc.oplogFrontiers();
    await addText(engine, 'five days ago', now - 5 * DAY);
    const f5 = engine.doc.oplogFrontiers();
    await addText(engine, 'two days ago', now - 2 * DAY);
    const f2 = engine.doc.oplogFrontiers();
    await addText(engine, 'yesterday', now - 1 * DAY);
    const f1 = engine.doc.oplogFrontiers();
    await addText(engine, 'today');
    await engine.saveNow();
    const content = texts(engine);

    engine = await open('win', { history: { mode: 'compact', retain: '3d' } });
    expect(engine.doc.isShallow()).toBe(true);
    expect(texts(engine)).toBe(content);
    expect(canCheckout(engine.doc, f10)).toBe(false);
    expect(canCheckout(engine.doc, f5)).toBe(true); // the retention point itself (state after the last change older than 3 days)
    expect(canCheckout(engine.doc, f2)).toBe(true);
    expect(canCheckout(engine.doc, f1)).toBe(true);
    engine.doc.checkout(f2);
    expect(texts(engine)).toContain('two days ago');
    expect(texts(engine)).not.toContain('yesterday');
    engine.doc.checkoutToLatest();

    // opening again with the same window drops nothing more
    const size = await savedSize('win');
    engine = await open('win', { history: { mode: 'compact', retain: '3d' } });
    expect(await savedSize('win')).toBe(size);
    expect(canCheckout(engine.doc, f5)).toBe(true);
  });

  it('files: a window releases the file only dropped history referenced, keeps the one a kept version still shows', async () => {
    const now = Math.floor(Date.now() / 1000);
    let engine = await open('winfiles');
    const refs = [];
    for (const seed of [1, 2, 3]) {
      engine.doc.setNextCommitTimestamp(now - 11 * DAY + seed * 10_000); // the index commit of each stored file, dated before everything below
      refs.push(await Files.get(engine).persist(file(seed)));
    }
    const a = await addImage(engine, 1, now - 10 * DAY, refs[0]); // 10d: added
    const b = await addImage(engine, 2, now - 10 * DAY + 5000, refs[1]); // 10d: added
    await removeBlock(engine, a, now - 8 * DAY); // 8d: a removed (before the window): nothing kept references it
    await removeBlock(engine, b, now - 1 * DAY); // 1d: b removed (inside the window): the kept state at the retention point shows it
    const c = await addImage(engine, 3, now - 0.5 * DAY, refs[2]);
    await removeBlock(engine, c); // created and removed inside the window
    await engine.saveNow();

    engine = await open('winfiles', { history: { mode: 'compact', retain: '3d' } });
    expect(await storedKeys()).toEqual([await hashOf(2), await hashOf(3)].sort());
    expect(Object.keys(Files.get(engine).index.toJSON()).sort()).toEqual([await hashOf(2), await hashOf(3)].sort());
  });

  it('an undated history (written before timestamps) is never windowed away; retain 0 still compacts it', async () => {
    const old = new Nabu({ extensions: EXTENSIONS }); // no timestamps recorded
    await old.commit();
    await addText(old, 'undated');
    await churn(old, 5);
    await saveSnapshot('undated', old.doc.export({ mode: 'snapshot' }));
    const size = await savedSize('undated');
    let engine = await open('undated', { history: { mode: 'compact', retain: '1d' } });
    expect(engine.doc.isShallow()).toBe(false);
    expect(await savedSize('undated')).toBe(size);
    engine = await open('undated', { history: { mode: 'compact', retain: 0 } });
    expect(engine.doc.isShallow()).toBe(true);
    expect(await savedSize('undated')).toBeLessThan(size);
  });

  it('a new document is not touched by compact mode (nothing to compact, nothing saved)', async () => {
    const engine = await open('fresh', { history: { mode: 'compact', retain: 0 } });
    expect(engine.isNew).toBe(true);
    expect(await loadSnapshot('fresh')).toBeNull();
  });
});

describe('safeguard: onBeforeCompact', () => {
  it('receives the COMPLETE snapshot (all the history) before anything is dropped', async () => {
    let engine = await open('arch');
    const first = engine.doc.oplogFrontiers();
    await addText(engine, 'v1');
    await churn(engine, 10);
    await engine.saveNow();
    const full = await loadSnapshot('arch');
    let received; let savedWhenCalled;
    engine = await open('arch', {
      history: { mode: 'compact', retain: 0, onBeforeCompact: async (snap) => { received = snap; savedWhenCalled = await loadSnapshot('arch'); } },
    });
    expect(received).toBeInstanceOf(Uint8Array);
    expect(received.length).toBe(full.length);
    expect(savedWhenCalled.length).toBe(full.length); // the stored document was still complete when the archive was handed over
    const archived = new LoroDoc(); archived.import(received);
    expect(archived.isShallow()).toBe(false);
    expect(canCheckout(archived, first)).toBe(true); // the archive restores the whole evolution
    expect(engine.doc.isShallow()).toBe(true);
  });

  it('a rejection (or a throw) ABORTS: the stored document, the files and the history are untouched', async () => {
    let engine = await open('abort');
    const first = engine.doc.oplogFrontiers();
    const img = await addImage(engine, 1);
    await removeBlock(engine, img);
    await churn(engine, 10);
    await engine.saveNow();
    const before = await loadSnapshot('abort');
    for (const failing of [async () => { throw new Error('archive down'); }, () => { throw new Error('sync throw'); }]) {
      const opened = await open('abort', { history: { mode: 'compact', retain: 0, onBeforeCompact: failing }, });
      expect(opened.doc.isShallow()).toBe(false);
      expect(canCheckout(opened.doc, first)).toBe(true);
      expect(await loadSnapshot('abort')).toEqual(before);
      expect(await storedKeys()).toEqual([await hashOf(1)]);
      expect([...(await idbStore().getDocRefs('abort'))]).toEqual([await hashOf(1)]);
    }
    // the explicit API reports it and changes nothing either
    engine = await open('abort');
    const res = await engine.compact({ retain: 0, onBeforeCompact: () => Promise.reject(new Error('no')) });
    expect(res).toMatchObject({ compacted: false, reason: 'archive-failed' });
    expect(res.error.message).toBe('no');
    expect(await loadSnapshot('abort')).toEqual(before);
    expect(await storedKeys()).toEqual([await hashOf(1)]);
  });
});

describe('safeguard: refusals (no throw, nothing dropped)', () => {
  /** A host whose uploads never finish. */
  const stuckHost = () => ({ onBeforePersist: () => new Promise(() => {}) });

  it('refuses while an upload is pending (explicit and at open: the file is only in the local store)', async () => {
    let engine = await open('up', { files: stuckHost() });
    await addText(engine, 'text');
    await churn(engine, 5);
    await addImage(engine, 1); // the host never answers
    await flush();
    await engine.saveNow();
    const before = await loadSnapshot('up');
    expect(await engine.compact({ retain: 0 })).toMatchObject({ compacted: false, reason: 'pending-uploads' });
    expect(await loadSnapshot('up')).toEqual(before);
    expect(engine.doc.isShallow()).toBe(false);

    // reopened in compact mode: the outbox entry resumes the upload, which blocks the compaction
    const warn = vi.spyOn(Nabu.prototype, 'warn').mockImplementation(() => {});
    engine = await open('up', { files: stuckHost(), history: { mode: 'compact', retain: 0 } });
    expect(engine.doc.isShallow()).toBe(false);
    expect(await loadSnapshot('up')).toEqual(before);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pending-uploads'));
    expect(await new IndexedDBOutbox('up').list()).toHaveLength(1);
  });

  it('refuses with unsaved changes, and with uncommitted operations; works once saved', async () => {
    const engine = await open('unsaved');
    await addText(engine, 'one');
    await churn(engine, 5);
    await engine.saveNow();
    await addText(engine, 'two'); // not saved yet
    expect(await engine.compact({ retain: 0 })).toMatchObject({ compacted: false, reason: 'unsaved-changes' });
    await engine.saveNow();
    engine.insert('paragraph', { text: 'not committed' });
    expect(await engine.compact({ retain: 0 })).toMatchObject({ compacted: false, reason: 'unsaved-changes' });
    await engine.commit();
    await engine.saveNow();
    expect(engine.doc.isShallow()).toBe(false);
    expect(await engine.compact({ retain: 0 })).toMatchObject({ compacted: true });
  });

  it('refuses while the document is checked out to an old version, and while another compaction runs', async () => {
    const engine = await open('busy');
    const first = engine.doc.oplogFrontiers();
    await addText(engine, 'one');
    await churn(engine, 5);
    await engine.saveNow();
    engine.doc.checkout(first);
    expect(await engine.compact({ retain: 0 })).toMatchObject({ compacted: false, reason: 'detached' });
    engine.doc.checkoutToLatest();
    const [a, b] = await Promise.all([engine.compact({ retain: 0 }), engine.compact({ retain: 0 })]);
    expect([a.compacted, b.compacted].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.compacted).reason).toBe('busy');
  });

  it('nothing to compact: reported, nothing written (a second compaction right after the first)', async () => {
    const engine = await open('nothing');
    await addText(engine, 'one');
    await engine.saveNow();
    expect(await engine.compact({ retain: 0 })).toMatchObject({ compacted: true });
    expect(await engine.compact({ retain: 0 })).toMatchObject({ compacted: false, reason: 'nothing-to-compact' });
    expect(await engine.compact({ retain: '30d' })).toMatchObject({ compacted: false, reason: 'nothing-to-compact' });
  });
});

describe('nabu.compact() on a live editor', () => {
  it('saves a shallow snapshot, keeps the live editor working, and every later save stays compacted', async () => {
    let engine = await open('live');
    const first = engine.doc.oplogFrontiers();
    await addText(engine, 'one');
    await churn(engine, 20);
    await engine.saveNow();
    const before = await savedSize('live');
    const result = await engine.compact({ retain: 0 });
    expect(result).toMatchObject({ compacted: true, bytesBefore: before });
    // loro-crdt >= 1.13: a shallow snapshot keeps the meta maps of DELETED tree nodes (they can be revived), so churn that deletes blocks compacts less (~0.63 of the full size here instead of ~0.15)
    expect(result.bytesAfter).toBeLessThan(before * 0.8);
    expect(await savedSize('live')).toBe(result.bytesAfter);
    // the live document is untouched (it still has its history in memory) and keeps editing
    expect(canCheckout(engine.doc, first)).toBe(true);
    await addText(engine, 'two');
    await engine.saveNow();
    const reopened = await open('live');
    expect(reopened.doc.isShallow()).toBe(true);
    expect(canCheckout(reopened.doc, first)).toBe(false);
    expect(JSON.stringify(reopened.doc.toJSON())).toContain('two');
    expect(await savedSize('live')).toBeLessThan(before * 0.8);
  });

  it('the undo stack is cleared by a compaction (its steps may point at released files); new edits are undoable again', async () => {
    const engine = await open('undo');
    await addText(engine, 'one');
    const img = await addImage(engine, 1);
    await removeBlock(engine, img);
    await engine.saveNow();
    expect(engine.undoManager.canUndo()).toBe(true);
    expect(await engine.compact({ retain: 0 })).toMatchObject({ compacted: true, released: [await hashOf(1)] });
    expect(engine.undoManager.canUndo()).toBe(false);
    const block = await addText(engine, 'after');
    expect(engine.undoManager.canUndo()).toBe(true);
    engine.undo();
    await flush();
    expect(JSON.stringify(engine.doc.toJSON())).not.toContain('after');
    expect(JSON.stringify(engine.doc.toJSON())).toContain('one');
    expect(block).toBeTruthy();
  });

  it('the editor opened in compact mode has a working (empty, then growing) undo stack', async () => {
    let engine = await open('undo2');
    await addText(engine, 'one');
    await churn(engine, 5);
    await engine.saveNow();
    engine = await open('undo2', { history: { mode: 'compact', retain: 0 } });
    expect(engine.undoManager.canUndo()).toBe(false);
    await addText(engine, 'two');
    expect(engine.undoManager.canUndo()).toBe(true);
    engine.undo(); await flush();
    expect(JSON.stringify(engine.doc.toJSON())).not.toContain('two');
  });
});

describe('release of files (shared store, host)', () => {
  it('a file used by two documents survives the compaction of one; it goes when the last one lets go', async () => {
    const a = await open('doc-a');
    const b = await open('doc-b');
    const shared = await addImage(a, 1); await addImage(b, 1); // same bytes in both
    const only = await addImage(a, 2);
    await removeBlock(a, shared); await removeBlock(a, only);
    await a.saveNow(); await b.saveNow();
    expect(await storedKeys()).toEqual([await hashOf(1), await hashOf(2)].sort());

    const result = await a.compact({ retain: 0 });
    expect(result.released.sort()).toEqual([await hashOf(1), await hashOf(2)].sort());
    expect(result.deleted).toEqual([await hashOf(2)]);
    expect(await storedKeys()).toEqual([await hashOf(1)]); // still used by doc-b
    expect([...(await idbStore().getDocRefs('doc-b'))]).toEqual([await hashOf(1)]);

    const reopenedB = await open('doc-b');
    const [blockB] = [...reopenedB.blocks.values()].filter((x) => x.type === 'image');
    await removeBlock(reopenedB, blockB);
    await reopenedB.saveNow();
    expect((await reopenedB.compact({ retain: 0 })).deleted).toEqual([await hashOf(1)]);
    expect(await storedKeys()).toEqual([]);
  });

  /** A host that "uploads" to https://cdn.test/<name>. */
  const host = (released = vi.fn()) => ({ onBeforePersist: async (f) => ({ ref: 'https://cdn.test/' + f.name }), onAssetReleased: released });

  it('host mode: onAssetReleased(url) is called for each released hosted file; Nabu deletes nothing at the host; full mode never calls it', async () => {
    const released = vi.fn();
    let engine = await open('host', { files: host(released) });
    const img = await addImage(engine, 1);
    const kept = await addImage(engine, 2);
    await flush();
    await removeBlock(engine, img);
    await engine.saveNow();
    // full mode: reopen, save: nothing released
    engine = await open('host', { files: host(released) });
    await engine.saveNow();
    expect(released).not.toHaveBeenCalled();
    expect(await engine.compact({ retain: 0 })).toMatchObject({ compacted: true, released: [await hashOf(1)] });
    expect(released).toHaveBeenCalledTimes(1);
    expect(released).toHaveBeenCalledWith('https://cdn.test/pic-1.png');
    expect(kept).toBeTruthy();
  });

  it('host mode, at open: a release callback that throws is swallowed (nabu.warn) and the compaction still completes', async () => {
    let engine = await open('host2', { files: host() });
    const img = await addImage(engine, 1);
    await flush();
    await removeBlock(engine, img);
    await engine.saveNow();
    const warn = vi.spyOn(Nabu.prototype, 'warn').mockImplementation(() => {});
    const released = vi.fn(async () => { throw new Error('host refused'); });
    engine = await open('host2', { files: host(released), history: { mode: 'compact', retain: 0 } });
    expect(released).toHaveBeenCalledWith('https://cdn.test/pic-1.png');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('onAssetReleased failed'));
    expect(engine.doc.isShallow()).toBe(true);
    expect(await storedKeys()).toEqual([]);
  });

  it('clearPersistence() releases the document\'s files: bytes (unless another document uses them) and host urls', async () => {
    const released = vi.fn();
    const a = await open('gone', { files: host(released) });
    const b = await open('stays');
    await addImage(a, 1); await addImage(a, 2); await addImage(b, 2); // file 2 is shared
    await flush();
    await a.saveNow(); await b.saveNow();
    await a.clearPersistence();
    expect(await loadSnapshot('gone')).toBeNull();
    expect(await storedKeys()).toEqual([await hashOf(2)]); // 1 gone, 2 still used by "stays"
    expect(released).toHaveBeenCalledTimes(2);
    expect(released).toHaveBeenCalledWith('https://cdn.test/pic-1.png');
    expect(released).toHaveBeenCalledWith('https://cdn.test/pic-2.png');
    expect([...(await idbStore().getDocRefs('gone'))]).toEqual([]);
  });

  it('a custom store without the docRefs API: bytes are never deleted (it cannot tell who uses them)', async () => {
    const kept = new Map();
    const store = {
      has: async (h) => kept.has(h), get: async (h) => kept.get(h) ?? null, put: async (h, blob) => { kept.set(h, blob); },
      delete: vi.fn(async (h) => { kept.delete(h); }), keys: async function* () { yield* kept.keys(); },
    };
    const engine = await open('custom', { files: { store } });
    const img = await addImage(engine, 1);
    await removeBlock(engine, img);
    await engine.saveNow();
    expect(await engine.compact({ retain: 0 })).toMatchObject({ compacted: true, released: [await hashOf(1)], deleted: [] });
    expect(store.delete).not.toHaveBeenCalled();
    await engine.clearPersistence();
    expect(store.delete).not.toHaveBeenCalled();
  });
});

describe('legacy (beta) bytes in the history (ADR 014 §3.7)', () => {
  it('stay in a full history after the migration; an explicit compaction with retain 0 purges them', async () => {
    const big = bytes(5, 60_000);
    const old = new Nabu({ extensions: EXTENSIONS });
    await old.commit();
    const entry = old.doc.getMap('assets').setContainer('uuid-1', new LoroMap());
    entry.set('data', big); entry.set('type', 'image/png'); entry.set('name', 'old.png');
    old.insert('image', { ref: 'nabu-asset:uuid-1', alt: 'beta' });
    await old.commit();
    await saveSnapshot('beta', old.doc.export({ mode: 'snapshot' }));

    // full mode: migrated (bytes in the store), but the bytes are still in the saved history
    let engine = await open('beta');
    await engine.saveNow();
    expect(await storedKeys()).toEqual([await sha256Id(big)]);
    expect(await savedSize('beta')).toBeGreaterThan(50_000);

    // compact mode, retain 0: gone from the document, the files stay (the image still shows it)
    engine = await open('beta', { history: { mode: 'compact', retain: 0 } });
    expect(await savedSize('beta')).toBeLessThan(5_000);
    expect(engine.doc.isShallow()).toBe(true);
    expect(await storedKeys()).toEqual([await sha256Id(big)]);
    const [image] = [...engine.blocks.values()].filter((b) => b.type === 'image');
    expect(image.ref).toBe('nabu-asset:' + await sha256Id(big));
  });
});

describe('grace period of a release (multi-tab safety, files.releaseGraceMs)', () => {
  const GRACE = { releaseGraceMs: DEFAULT_RELEASE_GRACE_MS };

  it('default: 10 minutes', () => { expect(DEFAULT_RELEASE_GRACE_MS).toBe(10 * 60 * 1000); });

  it('a file another tab just added (not in its docRefs yet) is kept by a compaction; after the grace period it is deleted', async () => {
    const a = await open('tab-a', { files: GRACE });
    const b = await open('tab-b', { files: GRACE });
    const block = await addImage(a, 1);
    await a.saveNow();
    // tab B adds the same bytes (already stored: deduplicated, its record is refreshed) but has not saved yet
    await Files.get(b).persist(file(1));
    expect([...(await idbStore().getDocRefs('tab-b'))]).toEqual([]);
    await removeBlock(a, block);
    await a.saveNow();

    const first = await a.compact({ retain: 0 });
    expect(first).toMatchObject({ compacted: true, released: [await hashOf(1)], deleted: [], skipped: [await hashOf(1)] });
    expect(await storedKeys()).toEqual([await hashOf(1)]); // still there
    expect([...(await idbStore().getDocRefs('tab-a'))]).toEqual([await hashOf(1)]); // tracked, reconsidered later

    // later: B still does not reference it
    const real = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(real + DEFAULT_RELEASE_GRACE_MS + 60_000);
    await addText(a, 'something new');
    await a.saveNow();
    const second = await a.compact({ retain: 0 });
    expect(second).toMatchObject({ compacted: true, deleted: [await hashOf(1)], skipped: [] });
    expect(await storedKeys()).toEqual([]);
    expect([...(await idbStore().getDocRefs('tab-a'))]).toEqual([]);
  });

  it('a file B references (docRefs saved) is never deleted, grace or not', async () => {
    const a = await open('tab-a', { files: GRACE });
    const b = await open('tab-b', { files: GRACE });
    const block = await addImage(a, 1);
    await addImage(b, 1);
    await a.saveNow(); await b.saveNow();
    await removeBlock(a, block);
    await a.saveNow();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + DEFAULT_RELEASE_GRACE_MS + 60_000);
    expect((await a.compact({ retain: 0 })).deleted).toEqual([]);
    expect(await storedKeys()).toEqual([await hashOf(1)]);
  });

  it('clearPersistence() skips a recent file too, and remembers it in the docRefs of that id', async () => {
    const a = await open('tab-a', { files: GRACE });
    await addImage(a, 1);
    await a.saveNow();
    await a.clearPersistence();
    expect(await loadSnapshot('tab-a')).toBeNull();
    expect(await storedKeys()).toEqual([await hashOf(1)]);
    expect([...(await idbStore().getDocRefs('tab-a'))]).toEqual([await hashOf(1)]);
    // a document with that id, opened and cleared again after the grace period, finishes the job
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + DEFAULT_RELEASE_GRACE_MS + 60_000);
    const again = await open('tab-a', { files: GRACE });
    await again.clearPersistence();
    expect(await storedKeys()).toEqual([]);
  });

  it('releaseFiles: no savedAt (legacy record, or a store that cannot say) is kept; releaseGraceMs 0 disables the grace', async () => {
    const make = (savedAt) => ({ referencedHashes: async () => new Set(), savedAt, has: async () => true, delete: vi.fn(async () => {}) });
    const nabu = (releaseGraceMs) => ({ fileConfig: releaseGraceMs === undefined ? {} : { releaseGraceMs }, warn: vi.fn() });
    const H = 'sha256-' + 'a'.repeat(64);
    const old = Date.now() - 10 * DEFAULT_RELEASE_GRACE_MS;

    let store = make(async () => null);
    expect(await releaseFiles(nabu(), store, [H], new Map())).toEqual({ deleted: [], skipped: [H] });
    store = make(undefined);
    expect(await releaseFiles(nabu(), store, [H], new Map())).toEqual({ deleted: [], skipped: [H] });
    store = make(async () => Date.now());
    expect(await releaseFiles(nabu(), store, [H], new Map())).toEqual({ deleted: [], skipped: [H] });
    expect(store.delete).not.toHaveBeenCalled();
    store = make(async () => old);
    expect(await releaseFiles(nabu(), store, [H], new Map())).toEqual({ deleted: [H], skipped: [] });
    store = make(async () => null);
    expect(await releaseFiles(nabu(0), store, [H], new Map())).toEqual({ deleted: [H], skipped: [] });
    store = make(async () => Date.now());
    expect(await releaseFiles(nabu(60_000), store, [H], new Map())).toEqual({ deleted: [], skipped: [H] }); // the option is honoured
  });
});
