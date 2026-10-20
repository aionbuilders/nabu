// @ts-nocheck
/**
 * ADR 014 lot 1 — files live OUTSIDE the document: hash references (dedupe), the metadata index, no bytes in Loro,
 * resolve + objectURL lifetime, the migration of beta documents, and the integrity check of embedded bytes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LoroMap } from 'loro-crdt';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { ImageExtension } from '$lib/blocks/image/index.js';
import { FileExtension } from '$lib/blocks/file/index.js';
import { NabuPasteExtension, PlainTextPasteExtension, HtmlPasteExtension } from '$lib/paste/index.js';
import { Files, SILENT_ORIGIN } from '$lib/files/files.svelte.js';
import { MemoryAssetStore } from '$lib/files/store.js';
import { sha256Id, bytesToBase64 } from '$lib/files/assets.clipboard.js';

const EXTENSIONS = [ParagraphExtension, ImageExtension, FileExtension, NabuPasteExtension, PlainTextPasteExtension, HtmlPasteExtension];
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
const file = (bytes = PNG, name = 'pic.png', type = 'image/png') => new File([bytes], name, { type });

async function makeEditor(init = {}) {
  const engine = new Nabu({ extensions: EXTENSIONS, ...init });
  await engine.commit();
  return engine;
}

/** Every value of a `doc.toJSON()` tree that is binary. */
function binaryValues(value, found = []) {
  if (value instanceof Uint8Array) found.push(value);
  else if (Array.isArray(value)) value.forEach((v) => binaryValues(v, found));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => binaryValues(v, found));
  return found;
}

afterEach(() => vi.restoreAllMocks());

describe('hash references and deduplication', () => {
  it('a ref is nabu-asset:sha256-<hex of the bytes>; the same bytes twice give the same ref and ONE stored file', async () => {
    const engine = await makeEditor();
    const files = Files.get(engine);
    const a = await files.persist(file(PNG, 'one.png'));
    const b = await files.persist(file(PNG, 'two.png'));
    expect(a).toBe('nabu-asset:' + await sha256Id(PNG));
    expect(a).toMatch(/^nabu-asset:sha256-[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(files.store.size).toBe(1);
    expect(Object.keys(files.index.toJSON())).toEqual([a.slice('nabu-asset:'.length)]);
    const c = await files.persist(file(new Uint8Array([9, 9, 9]), 'other.png'));
    expect(c).not.toBe(a);
    expect(files.store.size).toBe(2);
  });

  it('a host-provided files.store is used', async () => {
    const store = new MemoryAssetStore();
    const engine = await makeEditor({ files: { store } });
    await Files.get(engine).persist(file());
    expect(Files.get(engine).store).toBe(store);
    expect(store.size).toBe(1);
  });
});

describe('the document holds references and metadata only', () => {
  it('assetIndex = hash -> { mime, name, size }; no Uint8Array anywhere in the document; the export does not grow by the file size', async () => {
    const engine = await makeEditor();
    const before = engine.doc.export({ mode: 'snapshot' }).length;
    const big = new Uint8Array(300 * 1024).map((_, i) => (i * 31 + 7) % 251); // incompressible enough
    const ref = await Files.get(engine).persist(file(big, 'big.png'));
    engine.insert('image', { ref, alt: 'big', name: 'big.png' });
    await engine.commit();
    const after = engine.doc.export({ mode: 'snapshot' }).length;
    expect(after - before).toBeLessThan(2000); // a few dozen bytes of metadata + the block, not 300 KB
    expect(binaryValues(engine.doc.toJSON())).toHaveLength(0);
    expect(engine.doc.toJSON().assetIndex[ref.slice('nabu-asset:'.length)]).toEqual({ mime: 'image/png', name: 'big.png', size: big.length });
    expect(engine.doc.toJSON().assets ?? {}).toEqual({});
  });

  it('writing the index is not an undo step', async () => {
    const engine = await makeEditor();
    engine.undoManager.clear();
    await Files.get(engine).persist(file());
    expect(engine.undoManager.canUndo()).toBe(false);
  });
});

describe('resolve: objectURL from the store, revoked when no mounted block uses it', () => {
  it('resolve is "" while the file is read from the store, then a blob: URL; state() follows', async () => {
    const engine = await makeEditor();
    const files = Files.get(engine);
    const ref = await files.persist(file());
    expect(files.state(ref)).toBe('loading');
    expect(files.resolve(ref)).toBe('');
    await flush();
    expect(files.state(ref)).toBe('ready');
    expect(files.resolve(ref)).toMatch(/^blob:/);
    expect(files.resolve(ref)).toBe(files.resolve(ref)); // cached: one objectURL per file
  });

  it('a file neither the store nor the index has is "missing"; the index url (through config.resolve) is the fallback', async () => {
    const hash = 'sha256-' + 'a'.repeat(64);
    const engine = await makeEditor({ files: { resolve: (u) => u + '?signed' } });
    const files = Files.get(engine);
    expect(files.resolve('nabu-asset:' + hash)).toBe('');
    await flush();
    expect(files.state('nabu-asset:' + hash)).toBe('missing');
    expect(files.resolve('nabu-asset:' + hash)).toBe('');

    const other = 'sha256-' + 'b'.repeat(64);
    files.index.set(other, { mime: 'image/png', name: 'x.png', size: 1, url: 'https://cdn.test/x.png' });
    files.resolve('nabu-asset:' + other);
    await flush();
    expect(files.resolve('nabu-asset:' + other)).toBe('https://cdn.test/x.png?signed');
  });

  it('a missing file is flagged by the media block (isMissing) so the component can say so', async () => {
    const engine = await makeEditor();
    const block = engine.insert('image', { ref: 'nabu-asset:sha256-' + 'c'.repeat(64), alt: 'gone' });
    await engine.commit();
    expect(block.isMissing).toBe(false); // loading
    await flush();
    expect(block.isMissing).toBe(true);
    expect(block.displaySrc).toBe('');
  });

  it('the objectURL is revoked once the last holder lets go (after the grace period), and made again on demand', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const engine = await makeEditor();
    const files = Files.get(engine);
    files.revokeGraceMs = 0;
    const ref = await files.persist(file());
    const releaseA = files.hold(ref); // a mounted block
    const releaseB = files.hold(ref);
    files.resolve(ref);
    await flush();
    const url = files.resolve(ref);
    expect(url).toMatch(/^blob:/);
    releaseA();
    await flush();
    expect(revoke).not.toHaveBeenCalledWith(url); // still held by B
    expect(files.resolve(ref)).toBe(url);
    releaseB();
    releaseB(); // idempotent
    await flush();
    expect(revoke).toHaveBeenCalledWith(url);
    files.hold(ref); // mounted again
    expect(files.resolve(ref)).toBe(''); // gone: loads again
    await flush();
    expect(files.resolve(ref)).toMatch(/^blob:/);
    expect(files.resolve(ref)).not.toBe(url);
  });

  it('a URL that nobody ever holds (resolved outside a component) is revoked after the grace period too', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const engine = await makeEditor();
    const files = Files.get(engine);
    files.revokeGraceMs = 5;
    const ref = await files.persist(file());
    files.resolve(ref);
    await new Promise((r) => setTimeout(r, 2));
    const url = files.resolve(ref);
    expect(url).toMatch(/^blob:/);
    await new Promise((r) => setTimeout(r, 30));
    expect(revoke).toHaveBeenCalledWith(url);
  });

  it('a remount in the same tick (a block that moves) keeps the URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const engine = await makeEditor();
    const files = Files.get(engine);
    files.revokeGraceMs = 0;
    const ref = await files.persist(file());
    const release = files.hold(ref);
    files.resolve(ref);
    await flush();
    const url = files.resolve(ref);
    release();
    files.hold(ref); // remounted before the timer
    await flush();
    expect(revoke).not.toHaveBeenCalledWith(url);
  });
});

describe('migration of a beta document (ADR 014 §3.7)', () => {
  /** A document as the beta saved it: bytes in the Loro `assets` map, blocks referencing `nabu-asset:<uuid>`. */
  async function betaSnapshot() {
    const old = await makeEditor();
    const sub = old.doc.getMap('assets').setContainer('uuid-1', new LoroMap());
    sub.set('data', PNG); sub.set('type', 'image/png'); sub.set('name', 'pic.png');
    const second = old.doc.getMap('assets').setContainer('uuid-2', new LoroMap());
    second.set('data', PNG); second.set('type', 'image/png'); second.set('name', 'same-bytes.png'); // same bytes as uuid-1
    old.insert('image', { ref: 'nabu-asset:uuid-1', alt: 'one' });
    old.insert('image', { ref: 'nabu-asset:uuid-2', alt: 'two' });
    old.insert('image', { ref: 'https://cdn.test/hosted.png', alt: 'hosted' });
    await old.commit();
    expect(binaryValues(old.doc.toJSON())).toHaveLength(2);
    return old.doc.export({ mode: 'snapshot' });
  }

  it('bytes go to the store, the index is completed, refs are rewritten and legacy entries removed - in ONE silent commit', async () => {
    const snapshot = await betaSnapshot();
    const store = new MemoryAssetStore();
    const engine = new Nabu({ extensions: EXTENSIONS, snapshot, files: { store } });
    const origins = [];
    engine.doc.subscribe((event) => origins.push(event.origin));
    const hash = await sha256Id(PNG);

    await Files.get(engine).whenIdle();

    expect(origins).toEqual([SILENT_ORIGIN]); // one commit, silent
    const images = [...engine.blocks.values()].filter((b) => b.type === 'image');
    expect(images.map((i) => i.ref).sort()).toEqual(['https://cdn.test/hosted.png', 'nabu-asset:' + hash, 'nabu-asset:' + hash].sort());
    const json = engine.doc.toJSON();
    expect(json.assets ?? {}).toEqual({});
    expect(binaryValues(json)).toHaveLength(0);
    expect(json.assetIndex[hash]).toMatchObject({ mime: 'image/png', size: PNG.length });
    expect(store.size).toBe(1); // identical bytes: deduplicated
    expect(await store.has(hash)).toBe(true);
    expect(engine.undoManager.canUndo()).toBe(false); // not an undo step

    // the migrated images display from the store
    const migrated = images.find((i) => i.ref.startsWith('nabu-asset:'));
    migrated.displaySrc; await flush();
    expect(migrated.displaySrc).toMatch(/^blob:/);
  });

  it('the migrated document, saved and reopened, has nothing left to migrate', async () => {
    const store = new MemoryAssetStore();
    const engine = new Nabu({ extensions: EXTENSIONS, snapshot: await betaSnapshot(), files: { store } });
    await Files.get(engine).whenIdle();
    const reopened = new Nabu({ extensions: EXTENSIONS, snapshot: engine.doc.export({ mode: 'snapshot' }), files: { store } });
    const origins = [];
    reopened.doc.subscribe((event) => origins.push(event.origin));
    await Files.get(reopened).whenIdle();
    expect(origins).toEqual([]);
    expect([...reopened.blocks.values()].filter((b) => b.type === 'image' && b.ref.startsWith('nabu-asset:sha256-'))).toHaveLength(2);
  });

  it('before it ends, a beta ref still displays from the bytes in the document', async () => {
    const engine = new Nabu({ extensions: EXTENSIONS, snapshot: await betaSnapshot() });
    const block = [...engine.blocks.values()].find((b) => b.ref === 'nabu-asset:uuid-1');
    expect(block.displaySrc).toMatch(/^blob:/);
    await Files.get(engine).whenIdle();
  });
});

describe('embedding in an export / clipboard: keyed by hash, verified on import', () => {
  const b64 = bytesToBase64(PNG);

  it('a hash that does not match its bytes is treated as missing, with a warning, and nothing is stored', async () => {
    const engine = await makeEditor();
    const warn = vi.spyOn(engine, 'warn').mockImplementation(() => {});
    const forged = 'sha256-' + 'd'.repeat(64);
    await engine.importJSON({ version: '1', blocks: [{ type: 'image', props: { ref: 'nabu-asset:' + forged, alt: 'forged' } }], assets: { [forged]: { mime: 'image/png', name: 'f.png', size: PNG.length, data: b64 } } });
    const [image] = [...engine.blocks.values()].filter((b) => b.type === 'image');
    expect(image.status).toBe('missing');
    expect(warn).toHaveBeenCalled();
    expect(Files.get(engine).store.size).toBe(0);
    expect(Object.keys(Files.get(engine).index.toJSON())).toHaveLength(0);
  });

  it('matching bytes are stored and indexed; the file is reused when the store already has it', async () => {
    const hash = await sha256Id(PNG);
    const store = new MemoryAssetStore();
    const put = vi.spyOn(store, 'put');
    const engine = await makeEditor({ files: { store } });
    const json = { version: '1', blocks: [{ type: 'image', props: { ref: 'nabu-asset:' + hash, alt: 'ok' } }], assets: { [hash]: { mime: 'image/png', name: 'ok.png', size: PNG.length, data: b64 } } };
    await engine.importJSON(json);
    await engine.importJSON(json);
    expect(put).toHaveBeenCalledTimes(1);
    expect(Files.get(engine).index.get(hash)).toEqual({ mime: 'image/png', name: 'ok.png', size: PNG.length });
    expect([...engine.blocks.values()].filter((b) => b.type === 'image').every((b) => b.status === 'ready')).toBe(true);
  });

  it('a beta clipboard fragment (nabu-asset:<uuid> + assets keyed by uuid) pastes: pending, then the hash ref', async () => {
    const engine = await makeEditor();
    const anchor = engine.insert('paragraph', { text: '' });
    Object.defineProperty(anchor, 'selection', { value: { from: 0, to: 0 }, configurable: true });
    engine.selection = { anchorBlock: anchor, focusBlock: anchor, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
    engine.insertFragment({ blocks: [{ type: 'image', props: { ref: 'nabu-asset:old-uuid', alt: 'old' }, partial: false }], assets: { 'old-uuid': { mime: 'image/png', name: 'o.png', size: PNG.length, data: b64 } } });
    const [image] = [...engine.blocks.values()].filter((b) => b.type === 'image');
    expect(image.status).toBe('pending');
    await Files.get(engine).whenIdle();
    await flush();
    const [done] = [...engine.blocks.values()].filter((b) => b.type === 'image');
    expect(done.status).toBe('ready');
    expect(done.ref).toBe('nabu-asset:' + await sha256Id(PNG));
    expect(Files.get(engine).store.size).toBe(1);
  });

  it('serialize("json") embeds small files keyed by hash, even after the document was reopened (bytes read back from the store)', async () => {
    const store = new MemoryAssetStore();
    const a = await makeEditor({ files: { store } });
    const ref = await Files.get(a).persist(file());
    a.insert('image', { ref, alt: 'x' });
    await a.commit();
    const reopened = new Nabu({ extensions: EXTENSIONS, snapshot: a.doc.export({ mode: 'snapshot' }), files: { store } });
    await Files.get(reopened).whenIdle(); // blocks warm their bytes at load
    const json = reopened.serialize('json');
    expect(Object.keys(json.assets)).toEqual([ref.slice('nabu-asset:'.length)]);
  });
});
