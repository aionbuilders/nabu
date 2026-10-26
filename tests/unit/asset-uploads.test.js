// @ts-nocheck
/**
 * ADR 014 lot 2 — host mode: the bytes go to the local store first, the block keeps its hash ref FOREVER, the upload runs in the
 * background (progress / retry / cancel / abort when the last block goes / restart on undo), the outbox lets an interrupted upload
 * resume, `files.maxFileSize` refuses big files with a readable reason, and a copy right after opening still carries the bytes (P-65).
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { ImageExtension } from '$lib/blocks/image/index.js';
import { FileExtension } from '$lib/blocks/file/index.js';
import { NabuPasteExtension, PlainTextPasteExtension, HtmlPasteExtension } from '$lib/paste/index.js';
import { Files, FileRejectedError } from '$lib/files/files.svelte.js';
import { MemoryAssetStore } from '$lib/files/store.js';
import { MemoryOutbox } from '$lib/files/outbox.js';
import { IndexedDBOutbox } from '$lib/persistence/outbox.js';
import { insertMediaFromFile } from '$lib/blocks/media/media.helpers.js';
import { sha256Id, bytesToBase64 } from '$lib/files/assets.clipboard.js';

const EXTENSIONS = [ParagraphExtension, ImageExtension, FileExtension, NabuPasteExtension, PlainTextPasteExtension, HtmlPasteExtension];
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const file = (bytes = PNG, name = 'pic.png', type = 'image/png') => new File([bytes], name, { type });
const images = (engine) => [...engine.blocks.values()].filter((b) => b.type === 'image' && !b.node.isDeleted?.());

/** A host whose uploads are controlled by the test. Each call: `{ file, ctx, resolve(ref), reject(err), progress(p) }`. */
function makeHost() {
  const calls = [];
  const hook = (f, ctx) => new Promise((resolve, reject) => {
    const call = {
      file: f, ctx, aborted: false,
      resolve: (ref = 'https://host.test/' + f.name) => resolve({ ref }),
      resolveNothing: () => resolve(undefined),
      reject: (error = new Error('host down')) => reject(error),
      progress: (p) => ctx.onProgress(p),
    };
    ctx.signal.addEventListener('abort', () => { call.aborted = true; reject(new DOMException('aborted', 'AbortError')); });
    calls.push(call);
  });
  return { calls, hook };
}

async function makeEditor(init = {}) {
  const engine = new Nabu({ extensions: EXTENSIONS, ...init });
  await engine.commit();
  return engine;
}

/** Put the caret in a fresh empty paragraph, the way a paste needs it. */
async function caret(engine) {
  const anchor = engine.insert('paragraph', { text: '' });
  await engine.commit();
  Object.defineProperty(anchor, 'selection', { value: { from: 0, to: 0 }, configurable: true });
  engine.selection = { anchorBlock: anchor, focusBlock: anchor, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
}

/** Add a media block through the same path as the picker / slash menu, then let the background work run. */
async function upload(engine, f = file()) {
  await insertMediaFromFile(engine, 'image', f);
  await flush();
  return images(engine).at(-1);
}

afterEach(() => vi.restoreAllMocks());

describe('host mode lifecycle (stub onBeforePersist)', () => {
  it('pending (hash ref, local bytes) → ready with the host location in the index; the ref never changes; not an undo step', async () => {
    const host = makeHost();
    const engine = await makeEditor({ files: { onBeforePersist: host.hook } });
    engine.undoManager.clear();
    const hash = await sha256Id(PNG);
    const block = await upload(engine);
    expect(block.ref).toBe('nabu-asset:' + hash);
    expect(block.status).toBe('pending');
    expect(host.calls).toHaveLength(1);
    expect(host.calls[0].file).toMatchObject({ name: 'pic.png', type: 'image/png', size: PNG.length });
    expect(Files.get(engine).store.size).toBe(1);
    expect(Files.get(engine).index.get(hash).url).toBeUndefined();
    const undoDepth = () => { let n = 0; while (engine.undoManager.canUndo()) { engine.undo(); n++; } return n; };

    host.calls[0].resolve('https://cdn.test/pic.png');
    await flush();
    expect(block.status).toBe('ready');
    expect(block.ref).toBe('nabu-asset:' + hash);
    expect(Files.get(engine).index.get(hash)).toMatchObject({ mime: 'image/png', name: 'pic.png', size: PNG.length, url: 'https://cdn.test/pic.png' });
    expect(block.progress).toBeNull();
    expect(block.reason).toBeNull();
    expect(undoDepth()).toBeLessThanOrEqual(2); // creating the block (+ its ref), nothing for the upload completion
    await flush();
    expect(images(engine)).toHaveLength(0); // everything undone: the block is gone, not "ready → pending"
  });

  it('a host that returns nothing keeps the local file: ready, no url', async () => {
    const host = makeHost();
    const engine = await makeEditor({ files: { onBeforePersist: host.hook } });
    const block = await upload(engine);
    host.calls[0].resolveNothing();
    await flush();
    expect(block.status).toBe('ready');
    expect(Files.get(engine).index.get(block.ref.slice('nabu-asset:'.length)).url).toBeUndefined();
  });

  it('the block is displayed from the local bytes first, then from the index url (through files.resolve)', async () => {
    const host = makeHost();
    const store = new MemoryAssetStore();
    const engine = await makeEditor({ files: { store, onBeforePersist: host.hook, resolve: (u) => u + '?signed' } });
    const block = await upload(engine);
    block.displaySrc; await flush();
    expect(block.displaySrc).toMatch(/^blob:/);
    host.calls[0].resolve('https://cdn.test/pic.png');
    await flush();
    expect(block.displaySrc).toMatch(/^blob:/); // still the local copy (no empty flash when the preview goes away)
    // another session that has no local bytes: the host location
    const hash = block.ref.slice('nabu-asset:'.length);
    const other = new Nabu({ extensions: EXTENSIONS, snapshot: engine.doc.export({ mode: 'snapshot' }), files: { store: new MemoryAssetStore(), onBeforePersist: host.hook, resolve: (u) => u + '?signed' } });
    const remote = images(other)[0];
    remote.displaySrc; await flush();
    expect(remote.status).toBe('ready');
    expect(remote.isMissing).toBe(false);
    expect(remote.displaySrc).toBe('https://cdn.test/pic.png?signed');
    expect(hash).toBeTruthy();
  });

  it('progress is reactive state: 0 when the upload starts, the values the host reports (clamped), null when it ends', async () => {
    const host = makeHost();
    const engine = await makeEditor({ files: { onBeforePersist: host.hook } });
    const block = await upload(engine);
    expect(block.progress).toBe(0);
    host.calls[0].progress(0.25);
    expect(block.progress).toBe(0.25);
    host.calls[0].progress(7);
    expect(block.progress).toBe(1);
    host.calls[0].progress(-3);
    expect(block.progress).toBe(0);
    host.calls[0].progress(NaN);
    expect(block.progress).toBe(0);
    host.calls[0].resolve();
    await flush();
    expect(block.progress).toBeNull();
    // a block with no upload at all
    expect(images(await makeEditor())[0]?.progress ?? null).toBeNull();
  });

  it('a failing upload: error + reason, local copy kept, outbox keeps the entry; retry() runs it again from the local copy', async () => {
    const host = makeHost();
    const outbox = new MemoryOutbox();
    const store = new MemoryAssetStore();
    const engine = await makeEditor({ files: { onBeforePersist: host.hook, outbox, store } });
    const warn = vi.spyOn(engine, 'warn').mockImplementation(() => {});
    const block = await upload(engine);
    const hash = block.ref.slice('nabu-asset:'.length);
    expect(await outbox.list()).toEqual([expect.objectContaining({ hash, attempts: 1, state: 'pending' })]);
    host.calls[0].reject(new Error('503'));
    await flush();
    expect(block.status).toBe('error');
    expect(block.reason).toEqual({ code: 'upload-failed', message: 'The upload failed: 503' });
    expect(block.progress).toBeNull();
    expect(await store.has(hash)).toBe(true);
    expect(await outbox.list()).toEqual([expect.objectContaining({ hash, attempts: 1, state: 'error' })]);
    expect(warn).toHaveBeenCalled();
    expect(host.calls).toHaveLength(1); // no automatic retry

    const done = block.retry();
    await flush();
    expect(block.status).toBe('pending');
    expect(block.reason).toBeNull();
    expect(host.calls).toHaveLength(2);
    expect(host.calls[1].file.size).toBe(PNG.length);
    host.calls[1].resolve();
    expect(await done).toBe(true);
    await flush();
    expect(block.status).toBe('ready');
    expect(await outbox.list()).toEqual([]);
  });

  it('retry() with nothing to retry is false: no host, a plain URL, bytes gone', async () => {
    const plain = await makeEditor();
    const a = plain.insert('image', { ref: 'https://x.test/a.png' }); await plain.commit();
    expect(await a.retry()).toBe(false);
    expect(await (await upload(plain)).retry()).toBe(false); // no host
    const host = makeHost();
    const store = new MemoryAssetStore();
    const engine = await makeEditor({ files: { onBeforePersist: host.hook, store } });
    const block = await upload(engine);
    host.calls[0].reject();
    await flush();
    await store.delete(block.ref.slice('nabu-asset:'.length));
    expect(await block.retry()).toBe(false);
    expect(block.status).toBe('error');
  });

  it('cancel() aborts the signal handed to the host and leaves the block in error with the reason "cancelled"; retry() restarts', async () => {
    const host = makeHost();
    const outbox = new MemoryOutbox();
    const engine = await makeEditor({ files: { onBeforePersist: host.hook, outbox } });
    const block = await upload(engine);
    expect(block.cancel()).toBe(true);
    expect(host.calls[0].ctx.signal.aborted).toBe(true);
    await flush();
    expect(block.status).toBe('error');
    expect(block.reason.code).toBe('cancelled');
    expect(block.progress).toBeNull();
    expect((await outbox.list())[0].state).toBe('error');
    expect(block.cancel()).toBe(false); // nothing running any more
    expect(host.calls).toHaveLength(1); // not restarted by itself
    block.retry();
    await flush();
    expect(host.calls).toHaveLength(2);
    host.calls[1].resolve();
    await flush();
    expect(block.status).toBe('ready');
  });

  it('a host that ignores the signal and answers after a cancel does not flip the block back to ready', async () => {
    const host = { calls: [], hook(f, ctx) { return new Promise((r) => host.calls.push({ resolve: () => r({ ref: 'https://x.test/late' }), ctx })); } };
    const engine = await makeEditor({ files: { onBeforePersist: host.hook } });
    const block = await upload(engine);
    block.cancel();
    host.calls[0].resolve();
    await flush();
    expect(block.status).toBe('error');
    expect(block.reason.code).toBe('cancelled');
  });

  it('deleting the LAST block that shows a file in flight aborts the upload; an undo that brings it back restarts it', async () => {
    const host = makeHost();
    const outbox = new MemoryOutbox();
    const engine = await makeEditor({ files: { onBeforePersist: host.hook, outbox } });
    const block = await upload(engine);
    engine.undoManager.clear();
    engine.tree.delete(block.node.id);
    await engine.commit();
    await flush();
    expect(host.calls[0].aborted).toBe(true);
    expect(images(engine)).toHaveLength(0);
    expect((await outbox.list())[0].state).toBe('pending'); // not an error: the block is just gone

    engine.undo();
    await flush();
    const back = images(engine);
    expect(back).toHaveLength(1);
    expect(back[0].status).toBe('pending');
    expect(host.calls).toHaveLength(2); // restarted
    host.calls[1].resolve();
    await flush();
    expect(images(engine)[0].status).toBe('ready');
  });

  it('deleting one of two blocks that show the same file does NOT abort the upload', async () => {
    const host = makeHost();
    const engine = await makeEditor({ files: { onBeforePersist: host.hook } });
    const first = await upload(engine);
    const second = await upload(engine); // same bytes: same hash, same upload
    expect(second.ref).toBe(first.ref);
    expect(host.calls).toHaveLength(1);
    engine.tree.delete(first.node.id);
    await engine.commit();
    await flush();
    expect(host.calls[0].aborted).toBe(false);
    host.calls[0].resolve();
    await flush();
    expect(images(engine)).toHaveLength(1);
    expect(images(engine)[0].status).toBe('ready');
  });

  it('a file that nobody references yet (Files#persist) is not aborted by the "last block deleted" rule', async () => {
    const host = makeHost();
    const engine = await makeEditor({ files: { onBeforePersist: host.hook } });
    const files = Files.get(engine);
    const ref = await files.persist(file());
    await flush();
    expect(host.calls).toHaveLength(1);
    engine.insert('image', { ref, status: 'pending' }); await engine.commit(); await flush();
    engine.tree.delete(images(engine)[0].node.id); await engine.commit(); await flush();
    expect(host.calls[0].aborted).toBe(true); // it WAS referenced, and is not any more
  });

  it('existing documents whose blocks hold plain host URLs keep working: no upload, displayed as they are', async () => {
    const host = makeHost();
    const engine = await makeEditor({ files: { onBeforePersist: host.hook, resolve: (u) => u + '?v=1' } });
    const block = engine.insert('image', { ref: 'https://cdn.test/old.png' }); await engine.commit(); await flush();
    expect(block.status).toBe('ready');
    expect(block.displaySrc).toBe('https://cdn.test/old.png?v=1');
    expect(host.calls).toHaveLength(0);
  });

  it('a pasted fragment (copy from another document) in a host editor: pending → ready, one upload for the file', async () => {
    const a = await makeEditor();
    const ref = await Files.get(a).persist(file());
    a.insert('image', { ref }); await a.commit();
    const host = makeHost();
    const b = await makeEditor({ files: { onBeforePersist: host.hook } });
    await caret(b);
    b.insertFragment({ blocks: [{ type: 'image', props: { ref, alt: 'x' }, partial: false }], assets: a.serialize('json').assets });
    await Files.get(b).whenIdle(); await flush();
    expect(images(b)[0].status).toBe('pending');
    expect(host.calls).toHaveLength(1);
    host.calls[0].resolve();
    await flush();
    expect(images(b)[0].status).toBe('ready');
    expect(images(b)[0].ref).toBe(ref);
  });

  it('a pending block without any host configured (the host was removed) becomes ready from its local copy', async () => {
    const store = new MemoryAssetStore();
    const host = makeHost();
    const a = await makeEditor({ files: { onBeforePersist: host.hook, store } });
    await upload(a);
    const b = new Nabu({ extensions: EXTENSIONS, snapshot: a.doc.export({ mode: 'snapshot' }), files: { store } });
    await Files.get(b).whenResumed(); await flush();
    expect(images(b)[0].status).toBe('ready');
  });
});

describe('outbox: resume after the document is opened again', () => {
  it('an upload in flight when the editor goes away resumes on the next open (same store and outbox), attempts counted', async () => {
    const store = new MemoryAssetStore();
    const outbox = new MemoryOutbox();
    const first = makeHost();
    const a = await makeEditor({ files: { onBeforePersist: first.hook, store, outbox } });
    const block = await upload(a);
    const hash = block.ref.slice('nabu-asset:'.length);
    const snapshot = a.doc.export({ mode: 'snapshot' }); // the tab closes here: the host never answers

    const second = makeHost();
    const b = new Nabu({ extensions: EXTENSIONS, snapshot, files: { onBeforePersist: second.hook, store, outbox } });
    await Files.get(b).whenResumed(); await flush();
    expect(second.calls).toHaveLength(1); // resumed by itself
    expect(images(b)[0].status).toBe('pending');
    expect(images(b)[0].progress).toBe(0);
    expect((await outbox.list())[0]).toMatchObject({ hash, attempts: 2, state: 'pending' });
    second.calls[0].resolve('https://cdn.test/r.png');
    await flush();
    expect(images(b)[0].status).toBe('ready');
    expect(Files.get(b).index.get(hash).url).toBe('https://cdn.test/r.png');
    expect(await outbox.list()).toEqual([]);
  });

  it('works with the IndexedDB outbox (fake-indexeddb): the entry survives, a second instance resumes it', async () => {
    globalThis.indexedDB = new IDBFactory();
    const store = new MemoryAssetStore();
    const first = makeHost();
    const a = await makeEditor({ files: { onBeforePersist: first.hook, store, outbox: new IndexedDBOutbox('doc-1') } });
    await upload(a);
    expect(await new IndexedDBOutbox('doc-1').list()).toHaveLength(1);
    expect(await new IndexedDBOutbox('doc-2').list()).toHaveLength(0);
    const snapshot = a.doc.export({ mode: 'snapshot' });
    const second = makeHost();
    const b = new Nabu({ extensions: EXTENSIONS, snapshot, files: { onBeforePersist: second.hook, store, outbox: new IndexedDBOutbox('doc-1') } });
    await Files.get(b).whenResumed(); await flush();
    expect(second.calls).toHaveLength(1);
    second.calls[0].resolve();
    await flush();
    expect(images(b)[0].status).toBe('ready');
    expect(await new IndexedDBOutbox('doc-1').list()).toEqual([]);
  });

  it('an entry for a file the document no longer references is dropped (nothing resumes)', async () => {
    const store = new MemoryAssetStore();
    const outbox = new MemoryOutbox();
    const host = makeHost();
    const a = await makeEditor({ files: { onBeforePersist: host.hook, store, outbox } });
    const block = await upload(a);
    a.tree.delete(block.node.id); await a.commit(); await flush();
    const second = makeHost();
    const b = new Nabu({ extensions: EXTENSIONS, snapshot: a.doc.export({ mode: 'snapshot' }), files: { onBeforePersist: second.hook, store, outbox } });
    await Files.get(b).whenResumed(); await flush();
    expect(second.calls).toHaveLength(0);
    expect(await outbox.list()).toEqual([]);
  });

  it('an upload that FAILED before the tab closed is retried by itself on the next open (P-97)', async () => {
    const store = new MemoryAssetStore();
    const outbox = new MemoryOutbox();
    const host = makeHost();
    const a = await makeEditor({ files: { onBeforePersist: host.hook, store, outbox } });
    vi.spyOn(a, 'warn').mockImplementation(() => {});
    await upload(a);
    host.calls[0].reject(); await flush();
    expect((await outbox.list())[0]).toMatchObject({ state: 'error' });
    const second = makeHost();
    const b = new Nabu({ extensions: EXTENSIONS, snapshot: a.doc.export({ mode: 'snapshot' }), files: { onBeforePersist: second.hook, store, outbox } });
    await Files.get(b).whenResumed(); await flush();
    expect(second.calls).toHaveLength(1); // retried at open, nobody called retry()
    expect(images(b)[0].status).toBe('pending');
    second.calls[0].resolve('https://cdn.test/again.png');
    await flush();
    expect(images(b)[0].status).toBe('ready');
    expect(await outbox.list()).toEqual([]);
    Files.get(b).dispose();
  });

  describe('retry on open (P-97): backoff, attempts, online, opt-out', () => {
    const FAST = { initialDelay: 40, maxDelay: 120, maxAttempts: 4 };
    const until = async (fn, ms = 2000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); } };

    /** A document saved with a failed upload; returns what is needed to reopen it. */
    async function failedDocument() {
      const store = new MemoryAssetStore();
      const outbox = new MemoryOutbox();
      const host = makeHost();
      const a = await makeEditor({ files: { onBeforePersist: host.hook, store, outbox } });
      vi.spyOn(a, 'warn').mockImplementation(() => {});
      await upload(a);
      host.calls[0].reject(); await flush();
      return { store, outbox, snapshot: a.doc.export({ mode: 'snapshot' }) };
    }
    const reopen = async ({ store, outbox, snapshot }, host, autoRetry = FAST) => {
      const b = new Nabu({ extensions: EXTENSIONS, snapshot, files: { onBeforePersist: host.hook, store, outbox, autoRetry } });
      vi.spyOn(b, 'warn').mockImplementation(() => {});
      await Files.get(b).whenResumed();
      return b;
    };

    it('a host that keeps failing is retried after 2 s, 4 s, 8 s… (here 40, 80, 120 ms), then given up; the block stays in error', async () => {
      const doc = await failedDocument();
      const stamps = [];
      const host = { calls: [], hook: async () => { stamps.push(Date.now()); throw new Error('down'); } };
      const b = await reopen(doc, host);
      await until(() => stamps.length === 4);
      await new Promise((r) => setTimeout(r, 300)); // no fifth attempt
      expect(stamps).toHaveLength(4);
      const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
      expect(gaps[0]).toBeGreaterThanOrEqual(35); // initialDelay
      expect(gaps[1]).toBeGreaterThanOrEqual(75); // doubled
      expect(gaps[2]).toBeGreaterThanOrEqual(110); // capped at maxDelay (120), not 160
      expect(gaps[2]).toBeLessThan(400);
      expect(images(b)[0].status).toBe('error');
      expect((await doc.outbox.list())[0]).toMatchObject({ state: 'error' });
      Files.get(b).dispose();
    });

    it('a later attempt that succeeds ends the series: ready, outbox empty, no more calls', async () => {
      const doc = await failedDocument();
      let n = 0;
      const calls = [];
      const host = { calls, hook: async (f) => { calls.push(f); if (++n < 3) throw new Error('down'); return { ref: 'https://cdn.test/ok.png' }; } };
      const b = await reopen(doc, host);
      await until(() => images(b)[0].status === 'ready');
      await new Promise((r) => setTimeout(r, 200));
      expect(calls).toHaveLength(3);
      expect(await doc.outbox.list()).toEqual([]);
      Files.get(b).dispose();
    });

    it('the online event grants a fresh series to a file that used up its attempts', async () => {
      const doc = await failedDocument();
      let up = false;
      const calls = [];
      const host = { calls, hook: async (f) => { calls.push(f); if (!up) throw new Error('down'); return { ref: 'https://cdn.test/ok.png' }; } };
      const b = await reopen(doc, host, { initialDelay: 10, maxDelay: 20, maxAttempts: 2 });
      await until(() => calls.length === 2);
      await new Promise((r) => setTimeout(r, 150));
      expect(calls).toHaveLength(2);
      up = true;
      globalThis.dispatchEvent(new Event('online'));
      await until(() => images(b)[0].status === 'ready');
      expect(calls).toHaveLength(3);
      Files.get(b).dispose();
    });

    it('offline: nothing is attempted (no attempt used) until the browser says it is online', async () => {
      const doc = await failedDocument();
      Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
      try {
        const calls = [];
        const host = { calls, hook: async (f) => { calls.push(f); return { ref: 'https://cdn.test/ok.png' }; } };
        const b = await reopen(doc, host);
        await new Promise((r) => setTimeout(r, 150));
        expect(calls).toHaveLength(0);
        Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
        globalThis.dispatchEvent(new Event('online'));
        await until(() => images(b)[0].status === 'ready');
        expect(calls).toHaveLength(1);
        Files.get(b).dispose();
      } finally { delete globalThis.navigator.onLine; }
    });

    it('an upload the user cancelled is not retried; autoRetry: false turns the whole thing off', async () => {
      const store = new MemoryAssetStore();
      const outbox = new MemoryOutbox();
      const host = makeHost();
      const a = await makeEditor({ files: { onBeforePersist: host.hook, store, outbox } });
      await upload(a);
      Files.get(a).cancel(images(a)[0].ref); await flush();
      expect(images(a)[0].reason.code).toBe('cancelled');
      const doc = { store, outbox, snapshot: a.doc.export({ mode: 'snapshot' }) };
      const second = makeHost();
      const b = await reopen(doc, second);
      await new Promise((r) => setTimeout(r, 150));
      expect(second.calls).toHaveLength(0);
      Files.get(b).dispose();

      const failed = await failedDocument();
      const third = makeHost();
      const c = await reopen(failed, third, false);
      await new Promise((r) => setTimeout(r, 150));
      expect(third.calls).toHaveLength(0);
      expect(images(c)[0].status).toBe('error');
    });

    it('dispose() stops the pending retries', async () => {
      const doc = await failedDocument();
      const calls = [];
      const host = { calls, hook: async (f) => { calls.push(f); throw new Error('down'); } };
      const b = await reopen(doc, host);
      await until(() => calls.length === 1);
      Files.get(b).dispose();
      await new Promise((r) => setTimeout(r, 250));
      expect(calls).toHaveLength(1);
    });

    it('changes IMPORTED from another tab never start an upload here (that tab owns it)', async () => {
      const store = new MemoryAssetStore();
      const hostA = makeHost();
      const a = await makeEditor({ files: { onBeforePersist: hostA.hook, store } });
      const hostB = makeHost();
      const b = await makeEditor({ files: { onBeforePersist: hostB.hook, store } });
      b.doc.import(a.doc.export({ mode: 'snapshot' }));
      await flush();
      await upload(a); // pending in A, bytes in the shared store
      b.doc.import(a.doc.export({ mode: 'update', from: b.doc.version() }));
      await flush();
      expect(images(b)[0].status).toBe('pending');
      expect(hostA.calls).toHaveLength(1);
      expect(hostB.calls).toHaveLength(0);
    });
  });

  it('an entry still pending whose block was saved as ready (the status was not saved in time) is resumed', async () => {
    const store = new MemoryAssetStore();
    const outbox = new MemoryOutbox();
    const host = makeHost();
    const a = await makeEditor({ files: { onBeforePersist: host.hook, store, outbox } });
    const block = await upload(a);
    block.node.data.set('status', 'ready'); await a.commit();
    const second = makeHost();
    const b = new Nabu({ extensions: EXTENSIONS, snapshot: a.doc.export({ mode: 'snapshot' }), files: { onBeforePersist: second.hook, store, outbox } });
    await Files.get(b).whenResumed(); await flush();
    expect(second.calls).toHaveLength(1);
    expect(images(b)[0].status).toBe('pending');
  });

  it('a document opened where neither the bytes nor a host url exist (another device): shown as missing, reason "interrupted", nothing is sent', async () => {
    const host = makeHost();
    const a = await makeEditor({ files: { onBeforePersist: host.hook } });
    await upload(a); // still uploading
    const second = makeHost();
    const b = new Nabu({ extensions: EXTENSIONS, snapshot: a.doc.export({ mode: 'snapshot' }), files: { onBeforePersist: second.hook, store: new MemoryAssetStore() } });
    await Files.get(b).whenResumed(); await flush();
    const block = images(b)[0];
    block.displaySrc; await flush();
    expect(block.status).toBe('pending'); // what is stored
    expect(block.isMissing).toBe(true);
    expect(block.displayStatus).toBe('missing'); // what is shown
    expect(block.reason).toEqual(expect.objectContaining({ code: 'interrupted' }));
    expect(second.calls).toHaveLength(0);
    expect(block.displaySrc).toBe('');
  });
});

describe('files.maxFileSize', () => {
  it('a picked file over the limit: the block is created `rejected`, no ref, a readable reason; nothing is stored or sent', async () => {
    const host = makeHost();
    const store = new MemoryAssetStore();
    const engine = await makeEditor({ files: { maxFileSize: 8, store, onBeforePersist: host.hook } });
    const warn = vi.spyOn(engine, 'warn').mockImplementation(() => {});
    const block = await upload(engine, file(PNG, 'big.png'));
    expect(block.status).toBe('rejected');
    expect(block.ref).toBe('');
    expect(block.name).toBe('big.png');
    expect(block.reason.code).toBe('too-large');
    expect(block.reason.message).toBe('The file is too large (12 B); the limit is 8 B.');
    expect(block.isMissing).toBe(false);
    expect(store.size).toBe(0);
    expect(host.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    // persisted: the reason survives a reload of the document
    const reopened = new Nabu({ extensions: EXTENSIONS, snapshot: engine.doc.export({ mode: 'snapshot' }) });
    expect(images(reopened)[0].status).toBe('rejected');
    expect(images(reopened)[0].reason.code).toBe('too-large');
  });

  it('a file at the limit is accepted; no limit by default', async () => {
    const engine = await makeEditor({ files: { maxFileSize: PNG.length } });
    expect((await upload(engine)).status).toBe('ready');
    const free = await makeEditor();
    expect((await upload(free, file(new Uint8Array(3 * 1024 * 1024)))).status).toBe('ready');
  });

  it('ingest / persist throw FileRejectedError with the reason', async () => {
    const engine = await makeEditor({ files: { maxFileSize: 4 } });
    const files = Files.get(engine);
    await expect(files.ingest(file())).rejects.toBeInstanceOf(FileRejectedError);
    await expect(files.persist(file())).rejects.toMatchObject({ reason: { code: 'too-large' } });
    expect(files.checkSize(5)).toMatchObject({ code: 'too-large' });
    expect(files.checkSize(4)).toBeNull();
  });

  it('a pasted file over the limit becomes a rejected block (one undo step)', async () => {
    const engine = await makeEditor({ files: { maxFileSize: 8 } });
    const anchor = engine.insert('paragraph', { text: '' }); await engine.commit();
    Object.defineProperty(anchor, 'selection', { value: { from: 0, to: 0 }, configurable: true });
    engine.selection = { anchorBlock: anchor, focusBlock: anchor, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
    engine.warn = vi.fn();
    const f = file(PNG, 'shot.png');
    engine.handlePaste({ preventDefault: vi.fn(), clipboardData: { files: [f], items: [{ kind: 'file', type: f.type, getAsFile: () => f }], types: ['Files'], getData: () => '' } });
    await flush();
    const [block] = images(engine);
    expect(block.status).toBe('rejected');
    expect(block.ref).toBe('');
    expect(block.reason.code).toBe('too-large');
    expect(Files.get(engine).store.size).toBe(0);
  });

  it('a fragment whose embedded file is over the limit: rejected block, bytes not stored', async () => {
    const hash = await sha256Id(PNG);
    const engine = await makeEditor({ files: { maxFileSize: 8 } });
    await engine.importJSON({ version: '1', blocks: [{ type: 'image', props: { ref: 'nabu-asset:' + hash } }], assets: { [hash]: { mime: 'image/png', name: 'p.png', size: PNG.length, data: bytesToBase64(PNG) } } });
    expect(images(engine)[0].status).toBe('rejected');
    expect(images(engine)[0].ref).toBe('');
    expect(Files.get(engine).store.size).toBe(0);
  });

  it('a rejected block copied and pasted stays rejected (the refusal travels)', async () => {
    const a = await makeEditor({ files: { maxFileSize: 8 } });
    const rejected = await upload(a);
    const data = {};
    a.selection = { sync: vi.fn(), isCollapsed: false, startBlock: rejected, endBlock: rejected, start: { from: 0 }, end: { to: 0 }, setCursor: vi.fn(), anchorBlock: rejected, focusBlock: rejected };
    a.handleCopy({ preventDefault: vi.fn(), clipboardData: { setData: (k, v) => { data[k] = v; } } });
    const b = await makeEditor();
    const anchor = b.insert('paragraph', { text: '' }); await b.commit();
    Object.defineProperty(anchor, 'selection', { value: { from: 0, to: 0 }, configurable: true });
    b.selection = { anchorBlock: anchor, focusBlock: anchor, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
    b.handlePaste({ preventDefault: vi.fn(), clipboardData: { getData: (k) => data[k] ?? '' } });
    await flush();
    expect(images(b)[0].status).toBe('rejected');
    expect(images(b)[0].reason.code).toBe('too-large');
  });
});

describe('P-65: a copy / export right after opening carries the bytes, or says it does not', () => {
  it('open a saved document: after whenIdle() (the preload), serialize("json") and a copy carry every small file', async () => {
    const store = new MemoryAssetStore();
    const a = await makeEditor({ files: { store } });
    const one = await upload(a, file(PNG, 'one.png'));
    const two = await upload(a, file(new Uint8Array([9, 8, 7]), 'two.png'));
    const reopened = new Nabu({ extensions: EXTENSIONS, snapshot: a.doc.export({ mode: 'snapshot' }), files: { store } });
    // the files are warmed whatever the blocks do: even a file no block references is preloaded
    await Files.get(reopened).whenIdle();
    const json = reopened.serialize('json');
    expect(Object.keys(json.assets).sort()).toEqual([one.ref, two.ref].map((r) => r.slice('nabu-asset:'.length)).sort());
    for (const entry of Object.values(json.assets)) expect(typeof entry.data).toBe('string');

    const block = images(reopened)[0];
    const data = {};
    reopened.selection = { sync: vi.fn(), isCollapsed: false, startBlock: block, endBlock: block, start: { from: 0 }, end: { to: 0 }, setCursor: vi.fn(), anchorBlock: block, focusBlock: block };
    reopened.handleCopy({ preventDefault: vi.fn(), clipboardData: { setData: (k, v) => { data[k] = v; } } });
    const frag = JSON.parse(data['application/x-nabu+json']);
    expect(Object.values(frag.assets)[0].data).toBeTruthy();
  });

  it('the preload reads the index, not only the blocks (a file without a block is ready for the next paste)', async () => {
    const store = new MemoryAssetStore();
    const a = await makeEditor({ files: { store } });
    const ref = await Files.get(a).persist(file()); // indexed, no block
    const reopened = new Nabu({ extensions: EXTENSIONS, snapshot: a.doc.export({ mode: 'snapshot' }), files: { store } });
    await Files.get(reopened).whenIdle();
    expect(Files.get(reopened).getAsset(ref)).not.toBeNull();
  });

  it('files above maxInlineSize are not preloaded', async () => {
    const store = new MemoryAssetStore();
    const a = await makeEditor({ files: { store, maxInlineSize: 4 } });
    const ref = await Files.get(a).persist(file());
    const reopened = new Nabu({ extensions: EXTENSIONS, snapshot: a.doc.export({ mode: 'snapshot' }), files: { store, maxInlineSize: 4 } });
    await Files.get(reopened).whenIdle();
    expect(Files.get(reopened).getAsset(ref)).toBeNull();
  });

  it('a copy that still finds the bytes missing does NOT silently ship without them: the entry is marked, nabu.warn says so, the receiver shows `missing` with the reason', async () => {
    const store = new MemoryAssetStore();
    const a = await makeEditor({ files: { store } });
    await upload(a);
    const reopened = new Nabu({ extensions: EXTENSIONS, snapshot: a.doc.export({ mode: 'snapshot' }), files: { store } });
    const warn = vi.spyOn(reopened, 'warn').mockImplementation(() => {});
    // copy BEFORE the bytes are loaded (no whenIdle)
    const block = images(reopened)[0];
    const data = {};
    reopened.selection = { sync: vi.fn(), isCollapsed: false, startBlock: block, endBlock: block, start: { from: 0 }, end: { to: 0 }, setCursor: vi.fn(), anchorBlock: block, focusBlock: block };
    reopened.handleCopy({ preventDefault: vi.fn(), clipboardData: { setData: (k, v) => { data[k] = v; } } });
    const frag = JSON.parse(data['application/x-nabu+json']);
    const hash = block.ref.slice('nabu-asset:'.length);
    expect(frag.assets[hash]).toEqual({ mime: 'image/png', name: 'pic.png', size: PNG.length, omitted: true });
    expect(warn).toHaveBeenCalled();

    const receiver = await makeEditor();
    const anchor = receiver.insert('paragraph', { text: '' }); await receiver.commit();
    Object.defineProperty(anchor, 'selection', { value: { from: 0, to: 0 }, configurable: true });
    receiver.selection = { anchorBlock: anchor, focusBlock: anchor, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
    receiver.handlePaste({ preventDefault: vi.fn(), clipboardData: { getData: (k) => data[k] ?? '' } });
    await Files.get(receiver).whenIdle(); await flush();
    const pasted = images(receiver)[0];
    expect(pasted.status).toBe('missing');
    expect(pasted.isMissing).toBe(true);
    expect(pasted.reason).toEqual({ code: 'not-embedded', message: expect.any(String) });
    expect(Files.get(receiver).store.size).toBe(0);
  });

  it('a receiver whose store already has the omitted file shows it normally', async () => {
    const store = new MemoryAssetStore();
    const a = await makeEditor({ files: { store } });
    const block = await upload(a);
    const hash = block.ref.slice('nabu-asset:'.length);
    const b = await makeEditor({ files: { store } }); // same store: another document of the same origin
    await caret(b);
    b.insertFragment({ blocks: [{ type: 'image', props: { ref: block.ref }, partial: false }], assets: { [hash]: { mime: 'image/png', name: 'pic.png', size: PNG.length, omitted: true } } });
    await Files.get(b).whenIdle(); await flush();
    expect(images(b)[0].status).toBe('ready');
    expect(images(b)[0].isMissing).toBe(false);
  });
});
