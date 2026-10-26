// @ts-nocheck
/**
 * ADR 010 (theme 8): robustness of `createPersistedEditor` against fake-indexeddb — flush on page hide (P-91), backup rotation and
 * quarantine of an unreadable snapshot (P-92), IndexedDB unavailable (P-93), save status and errors (P-95), listeners released.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { createPersistedEditor } from '$lib/persistence/persistence.js';
import { openDB, loadRecords, listQuarantined, saveSnapshot, isSnapshotBytes } from '$lib/persistence/indexeddb.js';

const EXTENSIONS = [ParagraphExtension];
const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const opened = [];
const open = async (docId, extra = {}) => {
  const engine = await createPersistedEditor({ docId, preset: EXTENSIONS, debounce: 3_600_000, maxWait: 0, ...extra });
  opened.push(engine);
  return engine;
};
const edit = async (engine, text) => { engine.insert('paragraph', { text }); await engine.commit(); };
const texts = (engine) => JSON.stringify(engine.doc.toJSON());

/** Overwrite a record of an object store, whatever it contains. */
async function rawPut(storeName, value) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
}
const storeKeys = async (storeName) => {
  const db = await openDB();
  const keys = await new Promise((resolve) => { const r = db.transaction(storeName).objectStore(storeName).getAllKeys(); r.onsuccess = () => resolve(r.result); });
  db.close();
  return keys;
};

let warnings;
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args) => { warnings.push(args.join(' ')); });
});
afterEach(() => {
  for (const engine of opened.splice(0)) engine.persistence.dispose(); // the page listeners are global: an editor of an earlier test must not react to this one
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('backup rotation (P-92)', () => {
  it('every save keeps the snapshot it replaces as the backup', async () => {
    const engine = await open('d');
    await edit(engine, 'one');
    await engine.saveNow();
    expect((await loadRecords('d')).backup).toBeNull(); // the first save replaced nothing
    const first = (await loadRecords('d')).current.snapshot;
    await edit(engine, 'two');
    await engine.saveNow();
    const { current, backup } = await loadRecords('d');
    expect(backup.snapshot).toEqual(first);
    expect(current.snapshot).not.toEqual(first);
    await edit(engine, 'three');
    await engine.saveNow();
    expect((await loadRecords('d')).backup.snapshot).toEqual(current.snapshot); // rotated
  });

  it('a database without backup (an older version) loads exactly as before', async () => {
    const engine = await open('d');
    await edit(engine, 'legacy');
    await engine.saveNow();
    const db = await openDB(); // simulate: drop the backup that the layout change would not have
    await new Promise((r) => { const tx = db.transaction('backups', 'readwrite'); tx.objectStore('backups').clear(); tx.oncomplete = r; });
    db.close();
    const again = await open('d');
    expect(texts(again)).toContain('legacy');
    expect(again.isNew).toBe(false);
    expect(again.persistence.recovery).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('an unreadable current record never replaces a good backup', async () => {
    await saveSnapshot('d', new Uint8Array([1, 2, 3]));
    await saveSnapshot('d', new Uint8Array([4, 5, 6]));
    await rawPut('snapshots', { docId: 'd', snapshot: 'garbage', savedAt: 1 });
    await saveSnapshot('d', new Uint8Array([7, 8, 9]));
    expect([...(await loadRecords('d')).backup.snapshot]).toEqual([1, 2, 3]);
  });
});

describe('unreadable snapshot (P-92)', () => {
  /** A document saved twice: returns the bytes of the first and the second save. */
  async function twoSaves(docId = 'd') {
    const engine = await open(docId);
    await edit(engine, 'first words');
    await engine.saveNow();
    await edit(engine, 'second words');
    await engine.saveNow();
    return engine;
  }

  it('corrupted latest: the previous save is restored, the bad record is kept aside, the host is told', async () => {
    await twoSaves();
    const garbage = Uint8Array.from({ length: 40 }, (_, i) => (i * 37 + 11) % 256);
    await rawPut('snapshots', { docId: 'd', snapshot: garbage, savedAt: 7 });
    const onRecover = vi.fn();
    const engine = await open('d', { onRecover });
    expect(texts(engine)).toContain('first words');
    expect(texts(engine)).not.toContain('second words');
    expect(engine.isNew).toBe(false);
    const recovery = engine.persistence.recovery;
    expect(recovery).toMatchObject({ kind: 'backup' });
    expect(recovery.error).toBeInstanceOf(Error);
    expect(recovery.quarantinedKey).toMatch(/^d@\d+$/);
    expect(recovery.at).toBeGreaterThan(Date.now() - 5000);
    expect(onRecover).toHaveBeenCalledWith(recovery);
    expect(warnings.join('\n')).toMatch(/could not be read/);
    // the unreadable record is untouched, in the quarantine
    const [quarantined] = await listQuarantined('d');
    expect(quarantined).toMatchObject({ key: recovery.quarantinedKey, source: 'snapshot', savedAt: 7 });
    expect(quarantined.snapshot).toEqual(garbage);
    // the live snapshot is the good one again: the next boot is clean, and a save does not push the garbage into the backup
    expect(isSnapshotBytes((await loadRecords('d')).current.snapshot)).toBe(true);
    const next = await open('d');
    expect(next.persistence.recovery).toBeNull();
    expect(texts(next)).toContain('first words');
    expect(await listQuarantined('d')).toHaveLength(1);
  });

  it('a TRUNCATED snapshot is quarantined the same way', async () => {
    await twoSaves();
    const { current } = await loadRecords('d');
    const truncated = current.snapshot.slice(0, Math.floor(current.snapshot.length * 0.6));
    await rawPut('snapshots', { docId: 'd', snapshot: truncated, savedAt: 1 });
    const engine = await open('d');
    expect(engine.persistence.recovery?.kind).toMatch(/backup|empty/); // Loro may or may not accept a prefix; either way it boots
    if (engine.persistence.recovery) expect((await listQuarantined('d'))[0].snapshot).toEqual(truncated);
  });

  it('a record whose snapshot is not bytes (a string): backup', async () => {
    await twoSaves();
    await rawPut('snapshots', { docId: 'd', snapshot: 'not a snapshot', savedAt: 1 });
    const engine = await open('d');
    expect(engine.persistence.recovery.kind).toBe('backup');
    expect((await listQuarantined('d'))[0].snapshot).toBe('not a snapshot');
  });

  it('no backup (only one save) and a corrupted snapshot: starts EMPTY, still boots, the record is kept', async () => {
    const first = await open('d');
    await edit(first, 'only save');
    await first.saveNow();
    await rawPut('snapshots', { docId: 'd', snapshot: new Uint8Array([9, 9, 9, 9]), savedAt: 3 });
    const onRecover = vi.fn();
    const engine = await open('d', { onRecover });
    expect(engine.persistence.recovery.kind).toBe('empty');
    expect(engine.isNew).toBe(true);
    expect(texts(engine)).not.toContain('only save');
    expect(onRecover).toHaveBeenCalledTimes(1);
    expect((await listQuarantined('d')).map((q) => [...q.snapshot])).toEqual([[9, 9, 9, 9]]);
    expect(await loadRecords('d')).toEqual({ current: null, backup: null });
    // and the editor is usable and saves normally
    await edit(engine, 'new life');
    await engine.saveNow();
    expect(texts(await open('d'))).toContain('new life');
  });

  it('both the snapshot and the backup are unreadable: empty, both quarantined', async () => {
    await twoSaves();
    await rawPut('snapshots', { docId: 'd', snapshot: new Uint8Array([1, 1, 1]), savedAt: 1 });
    await rawPut('backups', { docId: 'd', snapshot: new Uint8Array([2, 2, 2]), savedAt: 1 });
    const engine = await open('d');
    expect(engine.persistence.recovery.kind).toBe('empty');
    expect(engine.persistence.recovery.quarantinedKeys).toHaveLength(2);
    const quarantined = await listQuarantined('d');
    expect(quarantined.map((q) => q.source).sort()).toEqual(['backup', 'snapshot']);
  });

  it('a failing onRecover does not stop the boot', async () => {
    await twoSaves();
    await rawPut('snapshots', { docId: 'd', snapshot: 'x', savedAt: 1 });
    const engine = await open('d', { onRecover: () => { throw new Error('host bug'); } });
    expect(engine.persistence.recovery.kind).toBe('backup');
    expect(warnings.join('\n')).toMatch(/onRecover threw/);
  });

  it('clearPersistence() removes the backup and the quarantined records too', async () => {
    await twoSaves();
    await rawPut('snapshots', { docId: 'd', snapshot: 'x', savedAt: 1 });
    const engine = await open('d');
    expect(await listQuarantined('d')).toHaveLength(1);
    await engine.clearPersistence();
    expect(await loadRecords('d')).toEqual({ current: null, backup: null });
    expect(await listQuarantined('d')).toEqual([]);
    expect(await storeKeys('quarantine')).toEqual([]);
  });

  it('after clearPersistence() the page hide does not bring the discarded document back; the next change is saved again', async () => {
    const engine = await open('d');
    await edit(engine, 'to discard');
    await engine.saveNow();
    await edit(engine, 'unsaved at clear time');
    await engine.clearPersistence();
    window.dispatchEvent(new Event('pagehide'));
    await tick();
    expect(await loadRecords('d')).toEqual({ current: null, backup: null });
    expect(localStorage.getItem('nabu:tail:d')).toBeNull();
    await edit(engine, 'new start');
    window.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(async () => expect((await loadRecords('d')).current).not.toBeNull());
  });

  it('a compaction drops the backup (the history it removed must not survive in it)', async () => {
    const engine = await open('d', { history: { mode: 'compact', retain: 0 } });
    await edit(engine, 'a');
    await engine.saveNow();
    await edit(engine, 'b');
    await engine.saveNow();
    expect((await loadRecords('d')).backup).not.toBeNull();
    const result = await engine.compact({ retain: 0 });
    if (result.compacted) expect((await loadRecords('d')).backup).toBeNull();
  });
});

describe('IndexedDB unavailable (P-93)', () => {
  it('no indexedDB at all: boots in memory, available=false, status unavailable, a warning, typing works', async () => {
    globalThis.indexedDB = undefined;
    const engine = await open('d');
    expect(engine.persistence).toMatchObject({ available: false, status: 'unavailable', recovery: null });
    expect(engine.persistence.lastError).toBeTruthy();
    expect(engine.isNew).toBe(true);
    expect(warnings.join('\n')).toMatch(/IndexedDB is not available/);
    await edit(engine, 'still usable');
    expect(texts(engine)).toContain('still usable');
    expect(engine.persistence.status).toBe('unavailable');
    await expect(engine.saveNow()).rejects.toThrow(/unavailable/);
    await expect(engine.clearPersistence()).resolves.toBeUndefined();
    expect(await engine.compact({ retain: 0 })).toMatchObject({ compacted: false });
  });

  it('indexedDB.open() fails: same', async () => {
    globalThis.indexedDB = { open() { const req = {}; setTimeout(() => req.onerror?.({ target: req }), 0); return req; } };
    const engine = await open('d');
    expect(engine.persistence.available).toBe(false);
    expect(engine.persistence.status).toBe('unavailable');
  });

  it('a file pasted in memory mode goes to a memory store (the IndexedDB asset store is not used)', async () => {
    globalThis.indexedDB = undefined;
    const engine = await open('d');
    expect(engine.fileConfig.store.constructor.name).toBe('MemoryAssetStore');
  });

  it('a regular boot reports available=true, status saved, no recovery', async () => {
    const engine = await open('d');
    expect(engine.persistence).toMatchObject({ available: true, status: 'saved', lastSavedAt: null, lastError: null, recovery: null, docId: 'd' });
  });
});

describe('save status and errors (P-95)', () => {
  it('a change is pending, a save is saving, then saved (lastSavedAt set)', async () => {
    const engine = await open('d');
    const p = engine.persistence;
    expect(p.status).toBe('saved');
    await edit(engine, 'x');
    await tick(2);
    expect(p.status).toBe('pending');
    const saving = engine.saveNow();
    await tick(1);
    expect(p.status).toBe('saving');
    await saving;
    expect(p.status).toBe('saved');
    expect(p.lastSavedAt).toBeGreaterThan(Date.now() - 5000);
    expect(p.lastError).toBeNull();
  });

  it('the status is a reactive $state (an effect sees pending -> saving -> saved)', async () => {
    const { recordStatuses } = await import('./helpers/persistence-status.svelte.js');
    const engine = await open('d');
    const seen = recordStatuses(engine.persistence);
    await edit(engine, 'x');
    await tick(2);
    const saving = engine.saveNow();
    await saving;
    await tick(2);
    expect(seen.log.slice(-3)).toEqual(['pending', 'saving', 'saved']);
    seen.stop();
  });

  it('an autosave failure sets error, warns, calls onSaveError; the next change retries; saveNow rejects for its awaiter', async () => {
    const onSaveError = vi.fn();
    const engine = await open('d', { debounce: 20, onSaveError });
    const p = engine.persistence;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    await edit(engine, 'cannot save');
    await vi.waitFor(() => expect(p.status).toBe('error'));
    expect(onSaveError).toHaveBeenCalledTimes(1);
    expect(onSaveError.mock.calls[0][0].name).toBe('QuotaExceededError');
    expect(p.lastError.name).toBe('QuotaExceededError');
    expect(warnings.join('\n')).toMatch(/could not save/);
    await expect(engine.saveNow()).rejects.toThrow(/quota/i);
    expect(onSaveError).toHaveBeenCalledTimes(1); // not called for saveNow
    expect(p.status).toBe('error');
    // the disk has room again; the next change retries
    spy.mockRestore();
    await edit(engine, 'second try');
    expect(p.status).toBe('pending');
    await vi.waitFor(() => expect(p.status).toBe('saved'));
    expect(p.lastError).toBeNull();
    expect(texts(await open('d'))).toContain('second try');
  });

  it('a throwing onSaveError is reported, not thrown', async () => {
    const engine = await open('d', { debounce: 10, onSaveError: () => { throw new Error('host bug'); } });
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new Error('disk'); });
    await edit(engine, 'x');
    await vi.waitFor(() => expect(warnings.join('\n')).toMatch(/onSaveError threw/));
  });
});

describe('flush on page hide (P-91)', () => {
  const hide = () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  afterEach(() => { delete document.visibilityState; });

  it('visibilitychange -> hidden saves at once, without waiting for the debounce', async () => {
    const engine = await open('d'); // debounce: one hour
    await edit(engine, 'last words');
    expect((await loadRecords('d')).current).toBeNull();
    hide();
    await vi.waitFor(() => expect(engine.persistence.status).toBe('saved'));
    expect((await loadRecords('d')).current).not.toBeNull();
    expect(texts(await open('d'))).toContain('last words');
  });

  it('pagehide saves at once; two events in a row save once', async () => {
    const engine = await open('d');
    await edit(engine, 'bye');
    window.dispatchEvent(new Event('pagehide'));
    hide();
    await vi.waitFor(() => expect(engine.persistence.status).toBe('saved'));
    expect((await loadRecords('d')).backup).toBeNull(); // a second save would have rotated the first into the backup
  });

  it('visible again, or nothing to save: nothing is written', async () => {
    const engine = await open('d');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    hide();
    window.dispatchEvent(new Event('pagehide'));
    await tick();
    expect((await loadRecords('d')).current).toBeNull(); // a fresh, untouched document is not written
    expect(engine.persistence.status).toBe('saved');
  });

  it('an already saved document is not saved again on hide', async () => {
    const engine = await open('d');
    await edit(engine, 'x');
    await engine.saveNow();
    const { current } = await loadRecords('d');
    hide();
    await tick();
    expect((await loadRecords('d')).current.savedAt).toBe(current.savedAt);
  });

  it('a failed save is retried on hide', async () => {
    const engine = await open('d', { debounce: 10 });
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new Error('disk'); });
    await edit(engine, 'x');
    await vi.waitFor(() => expect(engine.persistence.status).toBe('error'));
    spy.mockRestore();
    hide();
    await vi.waitFor(() => expect(engine.persistence.status).toBe('saved'));
  });

  it('dispose() removes both listeners, cancels the autosave and stops saving', async () => {
    const docAdd = vi.spyOn(document, 'addEventListener');
    const docRemove = vi.spyOn(document, 'removeEventListener');
    const winAdd = vi.spyOn(window, 'addEventListener');
    const winRemove = vi.spyOn(window, 'removeEventListener');
    const engine = await open('d');
    const added = [...docAdd.mock.calls, ...winAdd.mock.calls].filter(([type]) => type === 'visibilitychange' || type === 'pagehide');
    expect(added.map(([type]) => type).sort()).toEqual(['pagehide', 'visibilitychange']);
    await edit(engine, 'unsaved');
    engine.persistence.dispose();
    engine.persistence.dispose(); // idempotent
    const removed = [...docRemove.mock.calls, ...winRemove.mock.calls].filter(([type]) => type === 'visibilitychange' || type === 'pagehide');
    expect(removed.map(([type, fn]) => [type, fn]).sort()).toEqual(added.map(([type, fn]) => [type, fn]).sort());
    hide();
    window.dispatchEvent(new Event('pagehide'));
    await tick();
    expect((await loadRecords('d')).current).toBeNull();
    await expect(engine.saveNow()).rejects.toThrow(/disposed/);
  });

  it('an editor in memory (IndexedDB unavailable) adds no listener', async () => {
    globalThis.indexedDB = undefined;
    const docAdd = vi.spyOn(document, 'addEventListener');
    await open('d');
    expect(docAdd.mock.calls.filter(([type]) => type === 'visibilitychange')).toEqual([]);
  });
});

describe('maxWait is wired to the autosave (P-96)', () => {
  it('a continuous burst is saved before the pause', async () => {
    const engine = await open('d', { debounce: 60, maxWait: 150 });
    const t0 = Date.now();
    while (Date.now() - t0 < 600) { await edit(engine, 'x'); await new Promise((r) => setTimeout(r, 20)); }
    expect((await loadRecords('d')).current).not.toBeNull(); // still typing, yet saved
  });
  it('maxWait: 0 restores the trailing-only debounce', async () => {
    const engine = await open('d', { debounce: 60, maxWait: 0 });
    const t0 = Date.now();
    while (Date.now() - t0 < 400) { await edit(engine, 'x'); await new Promise((r) => setTimeout(r, 20)); }
    expect((await loadRecords('d')).current).toBeNull();
    await vi.waitFor(async () => expect((await loadRecords('d')).current).not.toBeNull());
  });
});

describe('the tail in localStorage (P-91: a page that goes away before IndexedDB can be written)', () => {
  beforeEach(() => { localStorage.clear(); });
  /** The page goes away but its IndexedDB write never lands (what a reload does in Chromium). */
  const goAway = (engine) => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('page gone', 'AbortError'); });
    window.dispatchEvent(new Event('pagehide'));
    engine.persistence.dispose();
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation((...a) => { warnings.push(a.join(' ')); });
  };

  it('changes made since the last save are written synchronously at pagehide, merged at the next boot, and removed by the next save', async () => {
    const engine = await open('d');
    await edit(engine, 'saved words');
    await engine.saveNow();
    expect(localStorage.getItem('nabu:tail:d')).toBeNull();
    await edit(engine, 'last words');
    window.dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem('nabu:tail:d')).not.toBeNull(); // synchronous: no await between the event and this line
    goAway(engine);

    const again = await open('d');
    expect(texts(again)).toContain('saved words');
    expect(texts(again)).toContain('last words');
    expect(again.isNew).toBe(false);
    expect(again.persistence.status).toBe('pending'); // merged, not stored yet
    expect(localStorage.getItem('nabu:tail:d')).not.toBeNull();
    await again.saveNow();
    expect(localStorage.getItem('nabu:tail:d')).toBeNull();
    expect(texts(await open('d'))).toContain('last words');
  });

  it('a document that never reached IndexedDB is restored from its tail (and is not "new")', async () => {
    const engine = await open('d');
    await edit(engine, 'typed in the first seconds');
    goAway(engine);
    expect(await loadRecords('d')).toEqual({ current: null, backup: null });
    const again = await open('d');
    expect(texts(again)).toContain('typed in the first seconds');
    expect(again.isNew).toBe(false);
    await again.saveNow();
    expect(texts(await open('d'))).toContain('typed in the first seconds');
    // the default empty paragraph of the first session was not duplicated by the merge
    expect(again.children.filter((b) => b.type === 'paragraph').length).toBe(engine.children.filter((b) => b.type === 'paragraph').length);
  });

  it('a tail already contained in the snapshot (the IndexedDB write did land) changes nothing and is removed', async () => {
    const engine = await open('d');
    await edit(engine, 'both ways');
    window.dispatchEvent(new Event('pagehide')); // IndexedDB save + tail
    await vi.waitFor(() => expect(engine.persistence.status).toBe('saved'));
    expect(localStorage.getItem('nabu:tail:d')).toBeNull(); // the save removed it
    localStorage.setItem('nabu:tail:d', JSON.stringify({ v: 1, at: 1, update: btoa(String.fromCharCode(...engine.doc.export({ mode: 'update' }))) }));
    const again = await open('d');
    expect(again.persistence.status).toBe('saved');
    expect(localStorage.getItem('nabu:tail:d')).toBeNull();
    expect(texts(again)).toBe(texts(engine));
  });

  it('a garbage tail is parked, never blocks the boot', async () => {
    const engine = await open('d');
    await edit(engine, 'x');
    await engine.saveNow();
    localStorage.setItem('nabu:tail:d', JSON.stringify({ v: 1, at: 1, update: btoa('not a loro update') }));
    const again = await open('d');
    expect(texts(again)).toContain('x');
    expect(localStorage.getItem('nabu:tail:d')).toBeNull();
    expect(localStorage.getItem('nabu:tail:d:unapplied')).not.toBeNull();
  });

  it('too big, or no localStorage: no tail, no error', async () => {
    const { writeTail, MAX_TAIL_BYTES } = await import('$lib/persistence/tail.js');
    expect(writeTail('big', new Uint8Array(MAX_TAIL_BYTES + 1))).toBe(false);
    expect(writeTail('empty', new Uint8Array(0))).toBe(false);
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(writeTail('full', new Uint8Array([1]))).toBe(false);
  });
});
