// @ts-nocheck
/**
 * ADR 010 (P-94): two tabs on the same document never overwrite each other. Merge on save (`mergeStored` / `saveMerged`: the stored
 * record is read, merged into the live document and written in ONE transaction), live sync through a BroadcastChannel (`startSync`:
 * update / hello protocol, echo safety, late joiner), imports are never undo steps. Two "tabs" are two persisted editors of the same
 * docId against one fake-indexeddb (and one fake BroadcastChannel bus).
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { LoroDoc } from 'loro-crdt';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { createPersistedEditor } from '$lib/persistence/persistence.js';
import { loadRecords, listQuarantined } from '$lib/persistence/indexeddb.js';
import { mergeStored } from '$lib/persistence/merge.js';
import { startSync, channelName } from '$lib/persistence/sync.js';
import { readRev, revToken } from '$lib/persistence/tail.js';

const EXTENSIONS = [ParagraphExtension];
const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const opened = [];
const open = async (docId, extra = {}) => {
  const engine = await createPersistedEditor({ docId, preset: EXTENSIONS, debounce: 3_600_000, maxWait: 0, sync: false, ...extra });
  opened.push(engine);
  return engine;
};
const edit = async (engine, text) => { engine.insert('paragraph', { text }); await engine.commit(); };
const words = (engine) => {
  const out = [];
  const walk = (node) => { const t = node.data.get('text'); if (t) out.push(t.toString()); for (const c of node.children() ?? []) walk(c); };
  for (const r of engine.tree.roots()) walk(r);
  return out.filter(Boolean);
};

/** An in-memory BroadcastChannel bus: a message posted on one channel reaches the OTHER channels of the same name (asynchronously). */
class FakeBroadcastChannel {
  static all = [];
  static posted = [];
  constructor(name) { this.name = name; this.onmessage = null; this.closed = false; FakeBroadcastChannel.all.push(this); }
  postMessage(data) {
    if (this.closed) throw new Error('closed');
    FakeBroadcastChannel.posted.push({ name: this.name, data });
    for (const peer of FakeBroadcastChannel.all) {
      if (peer === this || peer.closed || peer.name !== this.name) continue;
      const copy = structuredClone(data);
      setTimeout(() => { if (!peer.closed) peer.onmessage?.({ data: copy }); }, 0);
    }
  }
  close() { this.closed = true; }
}

let warnings;
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  FakeBroadcastChannel.all = [];
  FakeBroadcastChannel.posted = [];
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args) => { warnings.push(args.join(' ')); });
});
afterEach(() => {
  for (const engine of opened.splice(0)) engine.persistence.dispose();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('mergeStored', () => {
  const docWith = (text, peer) => {
    const doc = new LoroDoc();
    if (peer) doc.setPeerId(peer);
    doc.getText('t').insert(0, text);
    doc.commit();
    return doc;
  };

  it('a record the document already holds is not imported (the document is ahead or equal)', () => {
    const doc = docWith('abc', 1);
    const record = doc.export({ mode: 'snapshot' });
    doc.getText('t').insert(3, 'd'); doc.commit();
    const importBytes = vi.fn();
    expect(mergeStored(doc, record, importBytes)).toEqual({ imported: false, covers: false, merged: true });
    const same = doc.export({ mode: 'snapshot' });
    expect(mergeStored(doc, same, importBytes)).toEqual({ imported: false, covers: true, merged: true });
    expect(importBytes).not.toHaveBeenCalled();
  });

  it('a record that is ahead is imported, and then covers the document', () => {
    const a = docWith('abc', 1);
    const b = new LoroDoc(); b.import(a.export({ mode: 'snapshot' }));
    a.getText('t').insert(3, 'XYZ'); a.commit();
    const result = mergeStored(b, a.export({ mode: 'snapshot' }));
    expect(result).toEqual({ imported: true, covers: true, merged: true });
    expect(b.getText('t').toString()).toBe('abcXYZ');
  });

  it('a concurrent record is imported; the document then holds more than the record', () => {
    const a = docWith('base', 1);
    const b = new LoroDoc(); b.setPeerId(2); b.import(a.export({ mode: 'snapshot' }));
    a.getText('t').insert(4, 'A'); a.commit();
    b.getText('t').insert(4, 'B'); b.commit();
    const result = mergeStored(b, a.export({ mode: 'snapshot' }));
    expect(result).toEqual({ imported: true, covers: false, merged: true });
    expect(b.getText('t').toString()).toMatch(/^base(AB|BA)$/);
  });

  it('a shallow snapshot that does not follow from the document cannot be merged', () => {
    const a = docWith('abc', 1);
    a.getText('t').insert(3, 'd'); a.commit();
    const shallow = a.export({ mode: 'shallow-snapshot', frontiers: a.frontiers() });
    const other = docWith('zzz', 2);
    expect(mergeStored(other, shallow)).toMatchObject({ merged: false });
    expect(other.getText('t').toString()).toBe('zzz');
  });

  it('unreadable bytes throw', () => {
    expect(() => mergeStored(new LoroDoc(), new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});

describe('merge before save (sync: false)', () => {
  it('two tabs: both saved edits survive in the document, in the store and in a third tab', async () => {
    const a = await open('d');
    await edit(a, 'base'); await a.saveNow();
    const b = await open('d');
    await edit(a, 'from A'); await a.saveNow();
    await edit(b, 'from B'); await b.saveNow(); // B never saw A's edit: its save must import it, not overwrite it
    expect(words(b)).toEqual(expect.arrayContaining(['base', 'from A', 'from B']));
    await a.saveNow(); // A picks B's edit up too
    expect(words(a)).toEqual(expect.arrayContaining(['base', 'from A', 'from B']));
    const c = await open('d');
    expect(words(c).sort()).toEqual(['base', 'from A', 'from B']);
  });

  it('saving the same state again from the other tab writes nothing (the stored record already holds everything)', async () => {
    const a = await open('d');
    await edit(a, 'one'); await a.saveNow();
    const b = await open('d');
    await edit(b, 'two'); await b.saveNow();
    const written = (await loadRecords('d')).current.savedAt;
    await a.saveNow(); // A imports 'two'; the record then equals A's document: no write
    expect((await loadRecords('d')).current.savedAt).toBe(written);
    expect(words(a)).toContain('two');
    expect(a.persistence.status).toBe('saved');
    // and the next local edit is saved normally
    await edit(a, 'three'); await a.saveNow();
    expect((await loadRecords('d')).current.savedAt).toBeGreaterThanOrEqual(written);
    expect(words(await open('d')).sort()).toEqual(['one', 'three', 'two']);
  });

  it('simultaneous saves cannot overwrite each other (one transaction per merge)', async () => {
    const a = await open('d');
    await edit(a, 'base'); await a.saveNow();
    const b = await open('d');
    await edit(a, 'A1'); await edit(b, 'B1');
    await Promise.all([a.saveNow(), b.saveNow()]);
    await Promise.all([a.saveNow(), b.saveNow()]);
    expect(words(await open('d')).sort()).toEqual(['A1', 'B1', 'base']);
  });

  it('imported changes are not undo steps: undo in the importing tab only undoes its own edit', async () => {
    const a = await open('d');
    await edit(a, 'base'); await a.saveNow();
    const b = await open('d');
    b.undoManager.clear();
    await edit(a, 'from A'); await a.saveNow();
    await b.saveNow(); // imports 'from A'
    expect(words(b)).toContain('from A');
    expect(b.undoManager.canUndo()).toBe(false);
    await edit(b, 'from B');
    expect(b.undoManager.canUndo()).toBe(true);
    b.undo(); await tick();
    expect(words(b)).toContain('from A');
    expect(words(b)).not.toContain('from B');
    expect(b.undoManager.canUndo()).toBe(false);
  });

  it('a stored record that cannot be merged is copied to the quarantine before it is replaced', async () => {
    const a = await open('d');
    await edit(a, 'base'); await a.saveNow();
    // another tab compacted the document and kept editing: a shallow snapshot with changes this document cannot receive
    const other = new LoroDoc(); other.setPeerId(99);
    other.getText('t').insert(0, 'zzz'); other.commit();
    other.getText('t').insert(3, 'y'); other.commit();
    const shallow = other.export({ mode: 'shallow-snapshot', frontiers: other.frontiers() });
    const { openDB } = await import('$lib/persistence/indexeddb.js');
    const db = await openDB();
    await new Promise((resolve, reject) => { const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put({ docId: 'd', snapshot: shallow, savedAt: 5 }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
    await edit(a, 'mine'); await a.saveNow();
    const [kept] = await listQuarantined('d');
    expect(kept.key).toMatch(/-unmerged$/);
    expect(kept.snapshot).toEqual(shallow);
    expect(warnings.join('\n')).toMatch(/could not be merged/);
    expect(words(await open('d')).sort()).toEqual(['base', 'mine']);
  });

  it('the revision marker follows the record that is stored', async () => {
    const a = await open('d');
    await edit(a, 'one'); await a.saveNow();
    const { current } = await loadRecords('d');
    expect(readRev('d')).toBe(revToken(current));
  });

  it('page hide: when another tab wrote since, the save merges (the other tab\'s edit survives); when nobody did, it stays blind', async () => {
    const hide = () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    try {
      const a = await open('d');
      await edit(a, 'base'); await a.saveNow();
      const b = await open('d');
      await edit(b, 'from B'); await b.saveNow();
      await edit(a, 'from A'); // A has not seen B's edit and is unsaved
      hide();
      await tick(30);
      expect(words(await open('d')).sort()).toEqual(['base', 'from A', 'from B']);
    } finally { delete document.visibilityState; }
  });
});

describe('live sync (BroadcastChannel)', () => {
  beforeEach(() => { vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const live = (docId, extra = {}) => open(docId, { sync: true, ...extra });

  it('an edit in one tab reaches the other at once, in both directions, without any save', async () => {
    const a = await live('d');
    const b = await live('d');
    expect(a.persistence.sync).toBe(true);
    await edit(a, 'typed in A'); await tick();
    expect(words(b)).toContain('typed in A');
    await edit(b, 'typed in B'); await tick();
    expect(words(a)).toContain('typed in B');
    expect(words(a)).toEqual(words(b));
  });

  it('imported changes are not rebroadcast and are not undo steps; the receiver does not echo', async () => {
    const a = await live('d');
    const b = await live('d');
    await tick(30); // (the opening handshake, and the default paragraph each new document creates)
    b.undoManager.clear();
    FakeBroadcastChannel.posted.length = 0;
    await edit(a, 'x'); await tick();
    const updates = FakeBroadcastChannel.posted.filter((m) => m.data.t === 'update');
    expect(updates).toHaveLength(1); // A's own commit only: B imported it and said nothing
    expect(b.undoManager.canUndo()).toBe(false);
    b.undoManager.clear();
    await edit(b, 'y'); await tick();
    b.undo(); await tick();
    expect(words(b)).toContain('x');
    expect(words(a)).toEqual(words(b)); // the undo went out as a normal local change
  });

  it('concurrent typing in both tabs converges', async () => {
    const a = await live('d');
    const b = await live('d');
    await edit(a, 'seed'); await tick();
    const block = (engine) => [...engine.blocks.values()].find((x) => x.behaviors?.get('text')?.text === 'seed');
    const ta = block(a).behaviors.get('text'); const tb = block(b).behaviors.get('text');
    ta.container.insert(0, 'AAA'); a.doc.commit();
    tb.container.insert(4, 'BBB'); b.doc.commit();
    await tick();
    expect(ta.container.toString()).toBe(tb.container.toString());
    expect(ta.container.toString()).toMatch(/AAA/);
    expect(ta.container.toString()).toMatch(/BBB/);
  });

  it('a tab opened later gets the unsaved changes of the others (hello / update)', async () => {
    const a = await live('d');
    await edit(a, 'saved'); await a.saveNow();
    await edit(a, 'unsaved'); // only in A's memory
    const b = await live('d');
    expect(words(b)).toEqual(['saved']);
    await tick();
    expect(words(b).sort()).toEqual(['saved', 'unsaved']);
  });

  it('two tabs that diverged meanwhile converge in both directions through the hello exchange', async () => {
    const a = await live('d');
    await edit(a, 'base'); await a.saveNow();
    const b = await live('d');
    await tick();
    // B goes silent (its channel is closed: a frozen tab), both edit
    const channelOfB = FakeBroadcastChannel.all[FakeBroadcastChannel.all.length - 1];
    channelOfB.closed = true;
    await edit(a, 'A while away'); await edit(b, 'B while away'); await tick();
    expect(words(a)).not.toContain('B while away');
    channelOfB.closed = false; // wakes up and asks again
    const sync = startSync({ nabu: b, docId: 'd', BroadcastChannelImpl: FakeBroadcastChannel });
    sync.hello(); await tick();
    expect(words(a).sort()).toEqual(['A while away', 'B while away', 'base']);
    expect(words(b).sort()).toEqual(words(a).sort());
    sync.close();
  });

  it('an update that arrives with a gap triggers a hello and is completed', async () => {
    const a = await live('d');
    const b = await live('d');
    await edit(a, 'one'); await tick();
    // A's next update is lost on the way to B
    const lost = FakeBroadcastChannel.all[1]; // B's channel
    const original = lost.onmessage;
    lost.onmessage = null;
    await edit(a, 'two'); await tick();
    lost.onmessage = original;
    expect(words(b)).not.toContain('two');
    await edit(a, 'three'); await tick(30);
    expect(words(b).sort()).toEqual(['one', 'three', 'two']);
  });

  it('sync: false opens no channel; no BroadcastChannel is skipped silently; dispose() closes the channel', async () => {
    const off = await open('d', { sync: false });
    expect(FakeBroadcastChannel.all).toHaveLength(0);
    expect(off.persistence.sync).toBe(false);
    const on = await live('d2');
    expect(FakeBroadcastChannel.all).toHaveLength(1);
    expect(FakeBroadcastChannel.all[0].name).toBe(channelName('d2'));
    on.persistence.dispose();
    expect(FakeBroadcastChannel.all[0].closed).toBe(true);
    expect(on.persistence.sync).toBe(false);
    vi.stubGlobal('BroadcastChannel', undefined);
    const none = await live('d3');
    expect(none.persistence.sync).toBe(false);
    await edit(none, 'still works'); await none.saveNow();
    expect(warnings).toEqual([]);
  });

  it('a change that arrives during an IME composition waits for its end', async () => {
    const a = await live('d');
    const b = await live('d');
    Object.defineProperty(b, 'composing', { get: () => composing, configurable: true });
    let composing = true;
    await edit(a, 'during composition'); await tick(5);
    expect(words(b)).not.toContain('during composition');
    composing = false;
    await new Promise((r) => setTimeout(r, 300));
    expect(words(b)).toContain('during composition');
  });

  it('a corrupted message is ignored', async () => {
    const a = await live('d');
    const b = await live('d');
    const channel = FakeBroadcastChannel.all[0];
    channel.onmessage({ data: null });
    channel.onmessage({ data: { t: 'update', from: 'x', bytes: new Uint8Array([1, 2, 3]) } });
    channel.onmessage({ data: { t: 'hello', from: 'x', vv: 'nope' } });
    await edit(a, 'fine'); await tick();
    expect(words(b)).toContain('fine');
    expect(warnings.join('\n')).toMatch(/could not apply a change from another tab/);
  });
});
