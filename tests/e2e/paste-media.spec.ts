/**
 * E2E — P-51 media across documents. An image uploaded in the default mode is held by the asset store (ADR 014) and the
 * document only has its `nabu-asset:sha256-<hex>` ref: copying it must carry the bytes, pasting it elsewhere must re-create
 * the file there (in that document's store).
 *
 * Two editors = two pages of one browser context (each /e2e page is its own in-memory document). The copied payloads are
 * read from the ClipboardEvent (helpers/clip-capture.ts) and replayed as a synthetic `paste` on the other page.
 * The target editor can be given an in-memory host upload hook through the dev-only `?hostFiles=1|gated` option.
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, clearAndReset } from './helpers/editor.js';
import { undo, redo } from './helpers/keyboard.js';
import { selectRange, focusEmpty, collectErrors } from './helpers/model.js';
import { buildTree, tree, Pp } from './helpers/blocks.js';
import { copy, type ClipEvent } from './helpers/clip-capture.js';

// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** Open an editor on `/e2e` (optionally with the dev-only host upload hook) in a given page, starting with one empty paragraph. */
async function boot(page: Page, hostFiles?: '1' | 'gated') {
  await page.goto('/e2e' + (hostFiles ? '?hostFiles=' + hostFiles : ''));
  await page.waitForFunction(() => (window as any).__nabu_ready === true && (window as any).nabu?.children?.length > 0, null, { timeout: 20000 });
  await clearAndReset(page);
}

/** Upload PNG through the slash menu's native file chooser; leaves `before ; image ; after`, fully persisted. */
async function uploadImage(page: Page) {
  await focusEmpty(page);
  const chooserP = new Promise<any>((res) => page.once('filechooser', res));
  await page.keyboard.type('/image');
  await expect(page.locator('.nabu-slash')).toBeVisible();
  await page.keyboard.press('Enter');
  const chooser = await chooserP;
  await chooser.setFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PNG });
  await expect.poll(() => tree(page)).toBe('p(∅) ; image(∅)');
  await expect.poll(() => page.evaluate(() => [...(window as any).nabu.blocks.values()].find((b: any) => b.type === 'image')?.status)).toBe('ready');
  await page.evaluate(async () => {
    const n = (window as any).nabu;
    n.children[0].behaviors.get('text').insert(0, 'before');
    n.insert('paragraph', { text: 'after' }, null, 2);
    await n.commit();
    n.undoManager.clear();
  });
  await expect.poll(() => tree(page)).toBe('p(before) ; image(∅) ; p(after)');
}

/** Append an empty paragraph (the paste target of the same-document tests). */
async function addEmptyParagraph(page: Page) {
  await page.evaluate(async () => { const n = (window as any).nabu; n.insert('paragraph', {}); await n.commit(); n.undoManager.clear(); });
  await expect.poll(() => page.locator('[data-block-type="paragraph"]').count()).toBeGreaterThan(1);
}

/** Select from the start of "before" to the end of "after" (the image included) and copy. */
async function copyAll(page: Page): Promise<ClipEvent> {
  await selectRange(page, 'before', 0, 'after', -1);
  return copy(page);
}

/** Replay a copied payload as a paste at the caret of the (empty) paragraph. */
async function pasteInto(page: Page, data: Record<string, string>) {
  await focusEmpty(page);
  await page.evaluate((payload) => {
    const dt = new DataTransfer();
    for (const [format, value] of Object.entries(payload)) dt.setData(format, value);
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, data);
}
const payload = (ev: ClipEvent) => ({ 'application/x-nabu+json': ev.nabuRaw, 'text/html': ev.html, 'text/plain': ev.text });

const imageInfo = (page: Page) => page.evaluate(() => {
  const n = (window as any).nabu;
  return [...n.blocks.values()].filter((b: any) => b.type === 'image' && !b.node.isDeleted?.()).map((b: any) => ({ ref: b.ref, status: b.status }));
});
/** Files the document knows (ADR 014: the `assetIndex` map holds metadata, the bytes live in the asset store). */
const assetIds = (page: Page) => page.evaluate(() => Object.keys((window as any).nabu.doc.getMap('assetIndex').toJSON()));
/** Binary values anywhere in the Loro document: ADR 014 says there must be none. */
const bytesInDoc = (page: Page) => page.evaluate(() => {
  const walk = (v: any): number => v instanceof Uint8Array ? 1 : Array.isArray(v) ? v.reduce((n, x) => n + walk(x), 0) : v && typeof v === 'object' ? Object.values(v).reduce((n: number, x: any) => n + walk(x), 0) : 0;
  return walk((window as any).nabu.doc.toJSON());
});
/** Every <img> of the editor has decoded (naturalWidth > 0). */
const imagesDisplay = (page: Page, count: number) => expect.poll(() => page.evaluate(() =>
  [...document.querySelectorAll('[data-block-type="image"] img')].map((i) => (i as HTMLImageElement).naturalWidth),
)).toEqual(Array(count).fill(1));

let errors: ReturnType<typeof collectErrors>;
test.beforeEach(({ page }) => { errors = collectErrors(page); });
test.afterEach(() => { expect(errors.list()).toEqual([]); });

test.describe('A · the bytes travel with the copy', () => {
  test('1 · the fragment carries the asset; text/html has a data: URL and no nabu-asset:', async ({ page }) => {
    await boot(page);
    await uploadImage(page);
    const ev = await copyAll(page);
    const [img] = await imageInfo(page);
    expect(img.ref).toMatch(/^nabu-asset:sha256-[0-9a-f]{64}$/);

    const id = img.ref.slice('nabu-asset:'.length);
    const frag = ev.nabu as any;
    expect(frag.version).toBe(1);
    expect(frag.blocks.map((b: any) => b.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(frag.blocks[1].props.ref).toBe(img.ref);
    expect(frag.assets[id]).toMatchObject({ mime: 'image/png', name: 'pixel.png', size: PNG.length, data: PNG.toString('base64') });

    expect(ev.html).not.toContain('nabu-asset:');
    expect(ev.html).toContain('<img src="data:image/png;base64,' + PNG.toString('base64') + '"');
    expect(ev.text).not.toContain('nabu-asset:');
    expect(ev.nabuRaw).toContain('nabu-asset:'); // Nabu-to-Nabu keeps the ref
  });
});

test.describe('B · paste', () => {
  test('2 · same document: the ref is reused, still one asset; both images display', async ({ page }) => {
    await boot(page);
    await uploadImage(page);
    const ev = await copyAll(page);
    const [orig] = await imageInfo(page);
    await addEmptyParagraph(page);
    await pasteInto(page, payload(ev));
    await expect.poll(() => tree(page)).toBe('p(before) ; image(∅) ; p(after) ; p(before) ; image(∅) ; p(after)');
    expect((await imageInfo(page)).map((i) => i.ref)).toEqual([orig.ref, orig.ref]);
    expect(await assetIds(page)).toHaveLength(1);
    await imagesDisplay(page, 2);
  });

  test('3 · another document (default storage): the asset is re-created there and the image displays', async ({ page, context }) => {
    await boot(page);
    await uploadImage(page);
    const ev = await copyAll(page);
    const [orig] = await imageInfo(page);

    const other = await context.newPage();
    const otherErrors = collectErrors(other);
    await boot(other);
    expect(await imageInfo(other)).toEqual([]);
    expect(await assetIds(other)).toEqual([]);
    await pasteInto(other, payload(ev));
    await expect.poll(() => tree(other)).toBe('p(before) ; image(∅) ; p(after)');
    expect(await imageInfo(other)).toEqual([{ ref: orig.ref, status: 'ready' }]);
    await expect.poll(() => assetIds(other)).toEqual([orig.ref.slice('nabu-asset:'.length)]); // stored + indexed in the background
    await imagesDisplay(other, 1);
    expect(otherErrors.list()).toEqual([]);
  });

  test('4 · another document with a host onBeforePersist: uploaded to the host, the block keeps its hash ref, no bytes in the document, image displays', async ({ page, context }) => {
    await boot(page);
    await uploadImage(page);
    const ev = await copyAll(page);
    const [orig] = await imageInfo(page);

    const host = await context.newPage();
    await boot(host, '1');
    await pasteInto(host, payload(ev));
    await expect.poll(() => tree(host)).toBe('p(before) ; image(∅) ; p(after)');
    await expect.poll(async () => (await imageInfo(host))[0]?.status).toBe('ready');
    expect(await imageInfo(host)).toEqual([{ ref: orig.ref, status: 'ready' }]); // the ref is the content hash and never changes
    const uploads = await host.evaluate(() => (window as any).__hostUploads);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ name: 'pixel.png', type: 'image/png', size: PNG.length });
    const url = await host.evaluate((hash) => (window as any).nabu.doc.getMap('assetIndex').toJSON()[hash]?.url, orig.ref.slice('nabu-asset:'.length));
    expect(url).toBe(uploads[0].ref); // the host location is recorded in the index
    expect(await bytesInDoc(host)).toBe(0); // the document never holds bytes (the local store has a copy first)
    await imagesDisplay(host, 1);
  });

  test('5 · with a slow host upload the block shows at once (pending, displayed from the local copy); Ctrl+Z removes the whole paste, Ctrl+Shift+Z brings it back ready', async ({ page, context }) => {
    await boot(page);
    await uploadImage(page);
    const ev = await copyAll(page);
    const [orig] = await imageInfo(page);

    const host = await context.newPage();
    await boot(host, 'gated');
    await pasteInto(host, payload(ev));
    await expect.poll(() => tree(host)).toBe('p(before) ; image(∅) ; p(after)');
    expect(await imageInfo(host)).toEqual([{ ref: orig.ref, status: 'pending' }]);
    await expect(host.locator('.nabu-image-spinner')).toBeVisible();
    await imagesDisplay(host, 1); // shown from the local copy while it is sent

    await host.evaluate(() => (window as any).__hostRelease());
    await expect.poll(async () => (await imageInfo(host))[0]?.status).toBe('ready');
    expect((await imageInfo(host))[0].ref).toBe(orig.ref);

    await undo(host); // ONE step: the completion of the upload is not its own undo step
    await expect.poll(() => tree(host)).toBe('p(∅)');
    await expect.poll(() => imageInfo(host)).toEqual([]);
    await redo(host);
    await expect.poll(() => tree(host)).toBe('p(before) ; image(∅) ; p(after)');
    await expect.poll(() => imageInfo(host)).toEqual([{ ref: orig.ref, status: 'ready' }]);
    await imagesDisplay(host, 1);
  });

  test('6 · Ctrl+Z after a default-mode paste removes the pasted blocks in one step', async ({ page, context }) => {
    await boot(page);
    await uploadImage(page);
    const ev = await copyAll(page);
    const other = await context.newPage();
    await boot(other);
    await pasteInto(other, payload(ev));
    await expect.poll(() => tree(other)).toBe('p(before) ; image(∅) ; p(after)');
    await undo(other);
    await expect.poll(() => tree(other)).toBe('p(∅)');
    await redo(other);
    await expect.poll(() => tree(other)).toBe('p(before) ; image(∅) ; p(after)');
    await imagesDisplay(other, 1);
  });

  test('7 · a fragment without the bytes keeps the block in a "missing file" state, no error', async ({ page, context }) => {
    await boot(page);
    await uploadImage(page);
    const ev = await copyAll(page);
    const { assets: _drop, ...bare } = ev.nabu as any;

    const other = await context.newPage();
    const otherErrors = collectErrors(other);
    await boot(other);
    await pasteInto(other, { 'application/x-nabu+json': JSON.stringify(bare) });
    await expect.poll(() => tree(other)).toBe('p(before) ; image(∅) ; p(after)');
    expect((await imageInfo(other))[0].status).toBe('missing');
    await expect(other.locator('[data-block-type="image"] [data-nabu-missing]')).toHaveText(/Missing file/);
    expect(await other.locator('[data-block-type="image"] img').count()).toBe(0);
    expect(otherErrors.list()).toEqual([]);
  });

  test('8 · a hosted URL image pastes across documents unchanged (nothing embedded)', async ({ page, context }) => {
    await boot(page);
    const url = 'https://example.com/photo.png';
    await buildTree(page, [Pp('before'), { type: 'image', props: { ref: url, alt: 'photo' } }, Pp('after')]);
    const ev = await copyAll(page);
    expect((ev.nabu as any).assets).toBeUndefined();
    expect(ev.html).toContain(`<img src="${url}" alt="photo">`);

    const other = await context.newPage();
    await boot(other);
    await pasteInto(other, payload(ev));
    await expect.poll(() => tree(other)).toBe('p(before) ; image(∅) ; p(after)');
    expect(await imageInfo(other)).toEqual([{ ref: url, status: 'ready' }]);
    expect(await assetIds(other)).toEqual([]);
  });
});
