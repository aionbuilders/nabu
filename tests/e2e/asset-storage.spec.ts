/**
 * E2E — ADR 014 lot 1: the bytes of a file live in the asset store (IndexedDB for a persisted editor), never in the
 * document. A persisted editor keeps showing its images after a reload, its snapshot stays small, the same bytes pasted
 * twice are ONE stored file, and a snapshot saved by the beta (bytes inside the Loro `assets` map) migrates on open.
 */
import { test, expect, type Page } from '@playwright/test';
import { undo } from './helpers/keyboard.js';
import { focusEmpty, collectErrors } from './helpers/model.js';

// 1x1 transparent PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');
const HASH_REF = /^nabu-asset:sha256-[0-9a-f]{64}$/;

const docId = () => `e2e-assets-${test.info().testId}-${Date.now()}`;

async function boot(page: Page, id: string, hostFiles?: '1' | 'gated' | 'fail') {
  await page.goto('/e2e?persist=' + encodeURIComponent(id) + (hostFiles ? '&hostFiles=' + hostFiles : ''));
  await page.waitForFunction(() => (window as any).__nabu_ready === true && (window as any).nabu?.children?.length > 0, null, { timeout: 20000 });
}

/** Append an empty paragraph (a paste / upload target). */
async function addEmptyParagraph(page: Page) {
  const before = await page.locator('[data-block-type="paragraph"]').count();
  await page.evaluate(async () => { const n = (window as any).nabu; n.insert('paragraph', {}); await n.commit(); });
  await expect.poll(() => page.locator('[data-block-type="paragraph"]').count()).toBeGreaterThan(before);
}

/** Upload through the slash menu's native file chooser. */
async function uploadImage(page: Page, buffer: Buffer = PNG, name = 'pixel.png', settled = 'ready') {
  await focusEmpty(page);
  const chooserP = new Promise<any>((res) => page.once('filechooser', res));
  await page.keyboard.type('/image');
  await expect(page.locator('.nabu-slash')).toBeVisible();
  await page.keyboard.press('Enter');
  const chooser = await chooserP;
  await chooser.setFiles({ name, mimeType: 'image/png', buffer });
  await expect.poll(() => images(page).then((l) => l[0]?.status)).toBe(settled);
  // the block is created `pending` BEFORE the file is hashed and stored: wait for its final hash ref
  await expect.poll(() => images(page).then((l) => l[0]?.ref)).toMatch(HASH_REF);
}

const images = (page: Page) => page.evaluate(() => [...(window as any).nabu.blocks.values()]
  .filter((b: any) => b.type === 'image' && !b.node.isDeleted?.()).map((b: any) => ({ ref: b.ref, status: b.status })));

/** The live image blocks with their lot-2 state: progress, reason, what is shown. */
const imageState = (page: Page) => page.evaluate(() => [...(window as any).nabu.blocks.values()]
  .filter((b: any) => b.type === 'image' && !b.node.isDeleted?.())
  .map((b: any) => ({ ref: b.ref, status: b.status, progress: b.progress, reason: b.reason?.code ?? null, shown: b.displayStatus })));

/** `assetIndex[hash].url` of the first image. */
const hostedUrl = (page: Page) => page.evaluate(() => {
  const n = (window as any).nabu;
  const b = [...n.blocks.values()].find((x: any) => x.type === 'image' && !x.node.isDeleted?.());
  return n.doc.getMap('assetIndex').toJSON()[b.ref.slice('nabu-asset:'.length)]?.url ?? null;
});

const displayed = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[data-block-type="image"] img')].map((i) => (i as HTMLImageElement).naturalWidth));

/** What IndexedDB holds: the snapshot of `id`, the stored files, the docRefs record. */
const idb = (page: Page, id: string) => page.evaluate((docId) => new Promise<any>((resolve, reject) => {
  const open = indexedDB.open('nabu');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction(['snapshots', 'assets', 'docRefs', 'outbox'], 'readonly');
    const snap = tx.objectStore('snapshots').get(docId);
    const assets = tx.objectStore('assets').getAll();
    const refs = tx.objectStore('docRefs').get(docId);
    const outbox = tx.objectStore('outbox').index('docId').getAll(docId);
    tx.oncomplete = () => {
      db.close();
      resolve({
        version: db.version,
        snapshotBytes: snap.result?.snapshot?.length ?? null,
        assets: assets.result.map((a: any) => ({ hash: a.hash, size: a.blob?.size, mime: a.mime, name: a.name })),
        docRefs: refs.result?.hashes ?? null,
        outbox: outbox.result.map((e: any) => ({ hash: e.hash, attempts: e.attempts, state: e.state })),
      });
    };
    tx.onerror = () => reject(tx.error);
  };
}), id);

const bytesInDoc = (page: Page) => page.evaluate(() => {
  const walk = (v: any): number => v instanceof Uint8Array ? 1 : Array.isArray(v) ? v.reduce((n, x) => n + walk(x), 0) : v && typeof v === 'object' ? Object.values(v).reduce((n: number, x: any) => n + walk(x), 0) : 0;
  return walk((window as any).nabu.doc.toJSON());
});

async function pasteFiles(page: Page, count: number) {
  await page.evaluate(({ count, png }) => {
    const dt = new DataTransfer();
    for (let i = 0; i < count; i++) dt.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], `shot-${i}.png`, { type: 'image/png' }));
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { count, png: PNG_B64 });
}

let errors: ReturnType<typeof collectErrors>;
test.beforeEach(({ page }) => { errors = collectErrors(page); });
test.afterEach(() => { expect(errors.list()).toEqual([]); });

test.describe('asset storage (persisted editor)', () => {
  test('1 · an uploaded image survives a reload: it is shown from the IndexedDB store', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    await uploadImage(page);
    const [img] = await images(page);
    expect(img.ref).toMatch(HASH_REF);
    await expect.poll(() => displayed(page)).toEqual([1]);
    await page.evaluate(() => (window as any).nabu.saveNow());

    await page.reload();
    await page.waitForFunction(() => (window as any).__nabu_ready === true && (window as any).nabu?.children?.length > 0, null, { timeout: 20000 });
    expect(await images(page)).toEqual([img]);
    await expect.poll(() => displayed(page)).toEqual([1]); // decoded from the stored blob
    expect(await bytesInDoc(page)).toBe(0);
  });

  test('2 · the saved snapshot does not contain the bytes; the store has them; docRefs lists the file', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    const big = Buffer.concat([PNG, Buffer.from(Array.from({ length: 200 * 1024 }, (_, i) => (i * 31 + 7) % 251))]); // ~200 KB, not a decodable image: only its storage matters
    await uploadImage(page, big, 'big.png');
    await page.evaluate(() => (window as any).nabu.saveNow());
    const [img] = await images(page);
    const state = await idb(page, id);
    expect(state.version).toBe(3);
    expect(state.snapshotBytes).toBeLessThan(10 * 1024);
    expect(state.assets).toHaveLength(1);
    expect(state.assets[0]).toMatchObject({ hash: img.ref.slice('nabu-asset:'.length), size: big.length, mime: 'image/png', name: 'big.png' });
    expect(state.docRefs).toEqual([img.ref.slice('nabu-asset:'.length)]);
  });

  test('3 · pasting the same image twice stores ONE file and gives the same ref', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    await focusEmpty(page);
    await pasteFiles(page, 1);
    await expect.poll(() => images(page).then((l) => l.length)).toBe(1);
    await addEmptyParagraph(page);
    await focusEmpty(page);
    await pasteFiles(page, 1);
    await expect.poll(() => images(page).then((l) => l.length)).toBe(2);
    const refs = (await images(page)).map((i) => i.ref);
    expect(refs[0]).toMatch(HASH_REF);
    expect(refs[1]).toBe(refs[0]);
    await page.evaluate(() => (window as any).nabu.saveNow());
    expect((await idb(page, id)).assets).toHaveLength(1);
    await expect.poll(() => displayed(page)).toEqual([1, 1]);
  });

  test('4 · Ctrl+Z removes the pasted image but the stored file and the index entry stay (not an undo step)', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    await focusEmpty(page);
    await pasteFiles(page, 1);
    await expect.poll(() => images(page).then((l) => l.length)).toBe(1);
    await undo(page);
    await expect.poll(() => images(page).then((l) => l.length)).toBe(0);
    expect(await page.evaluate(() => Object.keys((window as any).nabu.doc.getMap('assetIndex').toJSON()))).toHaveLength(1);
  });
});

test.describe('migration of a beta document', () => {
  test('5 · bytes in the Loro `assets` map move to the store on open; refs are rewritten; the image still displays', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    // build a document exactly as the beta saved it: bytes in the `assets` map, a block with a `nabu-asset:<uuid>` ref
    await page.evaluate(async (b64) => {
      const n = (window as any).nabu;
      const LoroMapCtor = n.doc.getMap('scratch').constructor;
      const sub = n.doc.getMap('assets').setContainer('legacy-uuid-1', new LoroMapCtor());
      sub.set('data', Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      sub.set('type', 'image/png');
      sub.set('name', 'old.png');
      n.insert('image', { ref: 'nabu-asset:legacy-uuid-1', alt: 'beta' });
      await n.commit();
      await n.saveNow();
    }, PNG_B64);
    expect((await idb(page, id)).assets).toHaveLength(0);

    await page.reload();
    await page.waitForFunction(() => (window as any).__nabu_ready === true && (window as any).nabu?.children?.length > 0, null, { timeout: 20000 });
    await expect.poll(async () => (await images(page))[0]?.ref).toMatch(HASH_REF);
    expect(await page.evaluate(() => Object.keys((window as any).nabu.doc.getMap('assets').toJSON()))).toEqual([]);
    expect(await bytesInDoc(page)).toBe(0);
    await expect.poll(() => displayed(page)).toEqual([1]);
    expect((await images(page))[0].status).toBe('ready');

    // saved, reopened: the migration is done for good and the file is in the store
    await page.evaluate(() => (window as any).nabu.saveNow());
    const state = await idb(page, id);
    expect(state.assets).toHaveLength(1);
    expect(state.assets[0]).toMatchObject({ mime: 'image/png', name: 'old.png' });
    await page.reload();
    await page.waitForFunction(() => (window as any).__nabu_ready === true && (window as any).nabu?.children?.length > 0, null, { timeout: 20000 });
    expect((await images(page))[0].ref).toBe('nabu-asset:' + state.assets[0].hash);
    await expect.poll(() => displayed(page)).toEqual([1]);
  });

  test('6 · a version 1 IndexedDB (snapshots only) upgrades to 3 without losing the saved documents', async ({ page }) => {
    const id = docId();
    // an in-memory editor writes a snapshot the way the beta did: base `nabu` created at version 1 with only `snapshots`
    await page.goto('/e2e');
    await page.waitForFunction(() => (window as any).__nabu_ready === true && (window as any).nabu?.children?.length > 0, null, { timeout: 20000 });
    await page.evaluate(async (docId) => {
      const n = (window as any).nabu;
      n.children[0].behaviors.get('text').insert(0, 'saved by the beta');
      await n.commit();
      const snapshot = n.doc.export({ mode: 'snapshot' });
      await new Promise<void>((resolve, reject) => {
        const del = indexedDB.deleteDatabase('nabu');
        del.onsuccess = () => resolve();
        del.onerror = () => reject(del.error);
        del.onblocked = () => resolve();
      });
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('nabu', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('snapshots', { keyPath: 'docId' });
        open.onsuccess = () => {
          const tx = open.result.transaction('snapshots', 'readwrite');
          tx.objectStore('snapshots').put({ docId, snapshot, savedAt: Date.now() });
          tx.oncomplete = () => { open.result.close(); resolve(); };
        };
        open.onerror = () => reject(open.error);
      });
    }, id);

    await boot(page, id);
    await expect(page.locator('[contenteditable="true"]').first()).toContainText('saved by the beta');
    await addEmptyParagraph(page);
    await uploadImage(page); // the new stores work on the upgraded database
    await page.evaluate(() => (window as any).nabu.saveNow());
    const state = await idb(page, id);
    expect(state.version).toBe(3);
    expect(state.assets).toHaveLength(1);
  });
});

test.describe('host mode (ADR 014 lot 2): background upload, outbox, resume', () => {
  test('7 · pending (progress, hash ref) → release → ready; the ref never changes, the host location is the index url, the outbox is emptied', async ({ page }) => {
    const id = docId();
    await boot(page, id, 'gated');
    await uploadImage(page, PNG, 'pixel.png', 'pending');
    const [pending] = await imageState(page);
    expect(pending.ref).toMatch(HASH_REF);
    await expect.poll(async () => (await imageState(page))[0].progress).toBe(0.5);
    await expect(page.locator('.nabu-image-spinner')).toBeVisible();
    await expect.poll(() => displayed(page)).toEqual([1]); // the local copy is shown while it is sent
    await page.evaluate(() => (window as any).nabu.saveNow());
    expect((await idb(page, id)).outbox).toEqual([{ hash: pending.ref.slice('nabu-asset:'.length), attempts: 1, state: 'pending' }]);

    await page.evaluate(() => (window as any).__hostRelease());
    await expect.poll(async () => (await imageState(page))[0].status).toBe('ready');
    expect(await imageState(page)).toEqual([{ ref: pending.ref, status: 'ready', progress: null, reason: null, shown: 'ready' }]);
    expect(await hostedUrl(page)).toBe(await page.evaluate(() => (window as any).__hostUploads[0].ref));
    await expect.poll(async () => (await idb(page, id)).outbox).toEqual([]);
    expect(await bytesInDoc(page)).toBe(0);
  });

  test('8 · reload (close) during a gated upload → reopen: the upload resumes by itself and completes', async ({ page }) => {
    const id = docId();
    await boot(page, id, 'gated');
    await uploadImage(page, PNG, 'pixel.png', 'pending');
    const [before] = await imageState(page);
    await page.evaluate(() => (window as any).nabu.saveNow());
    expect((await idb(page, id)).outbox).toHaveLength(1);
    expect((await idb(page, id)).assets).toHaveLength(1); // the local copy is the outbox payload

    await page.reload();
    await page.waitForFunction(() => (window as any).__nabu_ready === true && (window as any).nabu?.children?.length > 0, null, { timeout: 20000 });
    await expect.poll(() => page.evaluate(() => (window as any).__hostUploads.length)).toBe(1); // resumed, nobody asked
    expect(await page.evaluate(() => (window as any).__hostUploads[0])).toMatchObject({ name: 'pixel.png', type: 'image/png', size: PNG.length });
    await expect.poll(async () => (await imageState(page))[0]).toMatchObject({ ref: before.ref, status: 'pending', progress: 0.5 });
    await expect.poll(() => displayed(page)).toEqual([1]);
    expect((await idb(page, id)).outbox).toEqual([{ hash: before.ref.slice('nabu-asset:'.length), attempts: 2, state: 'pending' }]);

    await page.evaluate(() => (window as any).__hostRelease());
    await expect.poll(async () => (await imageState(page))[0].status).toBe('ready');
    expect((await imageState(page))[0].ref).toBe(before.ref);
    expect(await hostedUrl(page)).toBe(await page.evaluate(() => (window as any).__hostUploads[0].ref));
    await expect.poll(async () => (await idb(page, id)).outbox).toEqual([]);

    // saved, then reopened with the host: nothing left to resume
    await page.evaluate(() => (window as any).nabu.saveNow());
    await page.reload();
    await page.waitForFunction(() => (window as any).__nabu_ready === true && (window as any).nabu?.children?.length > 0, null, { timeout: 20000 });
    await expect.poll(async () => (await imageState(page))[0]?.status).toBe('ready');
    expect(await page.evaluate(() => (window as any).__hostUploads.length)).toBe(0);
  });

  test('9 · a failing host → error (reason, local copy kept) → the host recovers → block.retry() → ready', async ({ page }) => {
    const id = docId();
    await boot(page, id, 'fail');
    await uploadImage(page, PNG, 'pixel.png', 'error');
    const [failed] = await imageState(page);
    expect(failed).toMatchObject({ status: 'error', reason: 'upload-failed', progress: null, shown: 'error' });
    await page.evaluate(() => (window as any).nabu.saveNow());
    const state = await idb(page, id);
    expect(state.assets).toHaveLength(1);
    expect(state.outbox).toEqual([{ hash: failed.ref.slice('nabu-asset:'.length), attempts: 1, state: 'error' }]);
    await expect.poll(() => displayed(page).then((l) => l.length)).toBe(0); // the error state is shown (no <img>)

    await page.evaluate(() => { (window as any).__hostFailing = false; });
    const ok = await page.evaluate(() => [...(window as any).nabu.blocks.values()].find((b: any) => b.type === 'image').retry());
    expect(ok).toBe(true);
    await expect.poll(async () => (await imageState(page))[0].status).toBe('ready');
    expect((await imageState(page))[0].ref).toBe(failed.ref);
    expect(await page.evaluate(() => (window as any).__hostUploads.length)).toBe(2);
    await expect.poll(() => displayed(page)).toEqual([1]);
  });

  test('10 · deleting the last block aborts the upload; Ctrl+Z brings the block back and restarts it; cancel() leaves it in error', async ({ page }) => {
    const id = docId();
    await boot(page, id, 'gated');
    await uploadImage(page, PNG, 'pixel.png', 'pending');
    await expect.poll(() => page.evaluate(() => (window as any).__hostUploads.length)).toBe(1);
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.undoManager.clear();
      const block = [...n.blocks.values()].find((b: any) => b.type === 'image');
      n.tree.delete(block.node.id);
      await n.commit();
    });
    await expect.poll(() => page.evaluate(() => (window as any).__hostAborted)).toBe(1);
    expect(await images(page)).toEqual([]);
    await page.evaluate(() => (window as any).nabu.undo());
    await expect.poll(async () => (await images(page)).map((i) => i.status)).toEqual(['pending']);
    await expect.poll(() => page.evaluate(() => (window as any).__hostUploads.length)).toBe(2); // restarted

    const cancelled = await page.evaluate(() => [...(window as any).nabu.blocks.values()].find((b: any) => b.type === 'image' && !b.node.isDeleted?.()).cancel());
    expect(cancelled).toBe(true);
    await expect.poll(async () => (await imageState(page))[0]).toMatchObject({ status: 'error', reason: 'cancelled', progress: null });
    expect(await page.evaluate(() => (window as any).__hostAborted)).toBe(2);
  });

  test('11 · a copy made right after a reload carries the bytes of the stored image (preload)', async ({ page }) => {
    const id = docId();
    await boot(page, id);
    await uploadImage(page);
    const [img] = await images(page);
    await page.evaluate(() => (window as any).nabu.saveNow());
    await page.reload();
    await page.waitForFunction(() => (window as any).__nabu_ready === true && (window as any).nabu?.children?.length > 0, null, { timeout: 20000 });
    const assets = await page.evaluate(async () => {
      const n = (window as any).nabu;
      await n.systems.get('files').whenIdle(); // the preload
      const json = n.serialize('json');
      return Object.fromEntries(Object.entries(json.assets ?? {}).map(([k, v]: [string, any]) => [k, { omitted: v.omitted ?? false, hasData: typeof v.data === 'string' && v.data.length > 0 }]));
    });
    expect(assets).toEqual({ [img.ref.slice('nabu-asset:'.length)]: { omitted: false, hasData: true } });
  });

  test('12 · files.maxFileSize: a too big file gives a rejected block with a readable reason (nothing stored)', async ({ page }) => {
    const id = docId();
    await page.goto('/e2e?persist=' + encodeURIComponent(id) + '&options=' + encodeURIComponent(JSON.stringify({ files: { maxFileSize: 50 } })));
    await page.waitForFunction(() => (window as any).__nabu_ready === true && (window as any).nabu?.children?.length > 0, null, { timeout: 20000 });
    await focusEmpty(page);
    const chooserP = new Promise<any>((res) => page.once('filechooser', res));
    await page.keyboard.type('/image');
    await expect(page.locator('.nabu-slash')).toBeVisible();
    await page.keyboard.press('Enter');
    const chooser = await chooserP;
    await chooser.setFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.concat([PNG, Buffer.alloc(200)]) });
    await expect.poll(async () => (await imageState(page))[0]?.status).toBe('rejected');
    expect(await imageState(page)).toEqual([{ ref: '', status: 'rejected', progress: null, reason: 'too-large', shown: 'rejected' }]);
    expect(await page.evaluate(() => [...(window as any).nabu.blocks.values()].find((b: any) => b.type === 'image').reason.message)).toMatch(/too large/i);
    await page.evaluate(() => (window as any).nabu.saveNow());
    expect((await idb(page, id)).assets).toHaveLength(0);
  });
});
