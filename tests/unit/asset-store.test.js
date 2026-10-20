// @ts-nocheck
/**
 * ADR 014 §3.3 — the asset stores (where the BYTES of the files live): the in-memory one (non-persisted editors), the
 * IndexedDB one (persisted editors; run here on fake-indexeddb) and the IndexedDB schema upgrade 1 → 2.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryAssetStore } from '$lib/files/store.js';
import { IndexedDBAssetStore } from '$lib/persistence/asset-store.js';
import { loadSnapshot, saveSnapshot, deleteSnapshot, openDB } from '$lib/persistence/indexeddb.js';

const H1 = 'sha256-' + '1'.repeat(64);
const H2 = 'sha256-' + '2'.repeat(64);
const meta = (name, size = 3) => ({ mime: 'image/png', name, size });
// happy-dom's Blob cannot go through Node's structuredClone (what fake-indexeddb uses): the IndexedDB runs use Node's Blob
let BlobCtor = Blob;
const blobOf = (...bytes) => new BlobCtor([new Uint8Array(bytes)], { type: 'image/png' });
const bytesOf = async (blob) => [...new Uint8Array(await blob.arrayBuffer())];
const collect = async (iterable) => { const out = []; for await (const k of iterable) out.push(k); return out; };

/** The contract every store must honour. */
function contract(make) {
  let store;
  beforeEach(async () => { store = await make(); });

  it('put / has / get round trip (bytes and type)', async () => {
    expect(await store.has(H1)).toBe(false);
    expect(await store.get(H1)).toBeNull();
    await store.put(H1, blobOf(1, 2, 3), meta('a.png'));
    expect(await store.has(H1)).toBe(true);
    const blob = await store.get(H1);
    expect(await bytesOf(blob)).toEqual([1, 2, 3]);
    expect(blob.type).toBe('image/png');
  });

  it('keys() lists the hashes, delete() removes one', async () => {
    await store.put(H1, blobOf(1), meta('a.png', 1));
    await store.put(H2, blobOf(2), meta('b.png', 1));
    expect((await collect(store.keys())).sort()).toEqual([H1, H2]);
    await store.delete(H1);
    expect(await store.has(H1)).toBe(false);
    expect(await collect(store.keys())).toEqual([H2]);
  });

  it('put twice with the same hash keeps one entry', async () => {
    await store.put(H1, blobOf(1, 2, 3), meta('a.png'));
    await store.put(H1, blobOf(1, 2, 3), meta('a.png'));
    expect(await collect(store.keys())).toEqual([H1]);
  });

  it('stat() returns the metadata given to put()', async () => {
    await store.put(H1, blobOf(1, 2, 3), meta('a.png'));
    expect(await store.stat(H1)).toEqual({ mime: 'image/png', name: 'a.png', size: 3 });
    expect(await store.stat(H2)).toBeNull();
  });
}

describe('MemoryAssetStore', () => {
  beforeEach(() => { BlobCtor = Blob; });
  contract(() => new MemoryAssetStore());
});

describe('IndexedDBAssetStore (fake-indexeddb)', () => {
  beforeEach(() => { BlobCtor = NodeBlob; });
  contract(() => { globalThis.indexedDB = new IDBFactory(); return new IndexedDBAssetStore(); });

  it('docRefs: which files each document references; the union is what must not be collected', async () => {
    globalThis.indexedDB = new IDBFactory();
    const store = new IndexedDBAssetStore();
    expect([...(await store.getDocRefs('a'))]).toEqual([]);
    await store.setDocRefs('a', [H1, H2]);
    await store.setDocRefs('b', [H2]);
    expect([...(await store.getDocRefs('a'))].sort()).toEqual([H1, H2]);
    expect([...(await store.referencedHashes())].sort()).toEqual([H1, H2]);
    await store.setDocRefs('a', [H1]); // replaced, not merged
    expect([...(await store.getDocRefs('a'))]).toEqual([H1]);
    await store.clearDocRefs('a');
    expect([...(await store.referencedHashes())]).toEqual([H2]);
  });

  it('the store is shared by every document of the origin (one database)', async () => {
    globalThis.indexedDB = new IDBFactory();
    await new IndexedDBAssetStore().put(H1, blobOf(9), meta('a.png', 1));
    expect(await new IndexedDBAssetStore().has(H1)).toBe(true); // another instance (another document), same bytes
  });
});

describe('IndexedDB schema upgrade (ADR 014)', () => {
  it('a version 1 database (snapshots only) upgrades to 2 and keeps its snapshots', async () => {
    globalThis.indexedDB = new IDBFactory();
    // what the beta created: base `nabu`, version 1, a `snapshots` store
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('nabu', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('snapshots', { keyPath: 'docId' });
      request.onsuccess = () => {
        const tx = request.result.transaction('snapshots', 'readwrite');
        tx.objectStore('snapshots').put({ docId: 'old-doc', snapshot: new Uint8Array([7, 8, 9]), savedAt: 1 });
        tx.oncomplete = () => { request.result.close(); resolve(); };
      };
      request.onerror = () => reject(request.error);
    });

    const db = await openDB();
    expect(db.version).toBe(2);
    expect([...db.objectStoreNames].sort()).toEqual(['assets', 'docRefs', 'snapshots']);
    db.close();
    expect([...(await loadSnapshot('old-doc'))]).toEqual([7, 8, 9]);

    // and the new stores work on the upgraded database
    const store = new IndexedDBAssetStore();
    await store.put(H1, blobOf(1), meta('a.png', 1));
    expect(await store.has(H1)).toBe(true);
    await saveSnapshot('new-doc', new Uint8Array([1]));
    await deleteSnapshot('old-doc');
    expect(await loadSnapshot('old-doc')).toBeNull();
    expect([...(await loadSnapshot('new-doc'))]).toEqual([1]);
  });
});
