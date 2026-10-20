/**
 * E2E — P-55 pasting FILES (a screenshot, a file copied from the OS) and P-53 (a block without text pasted into a text block).
 *
 * The paste is a synthetic ClipboardEvent carrying a DataTransfer with real File objects. Files become media blocks
 * through the generic `pasteFileHandlers` of the media extensions; they take precedence over the text payloads of the
 * clipboard, except an internal copy (`application/x-nabu+json`). With the dev-only `?hostFiles=1|gated` hook the bytes go
 * to a host `onBeforePersist` and the block is pending until it answers.
 */
import { test, expect, type Page } from '@playwright/test';
import { clearAndReset } from './helpers/editor.js';
import { undo, redo } from './helpers/keyboard.js';
import { focusAt, focusEmpty, collectErrors, violations } from './helpers/model.js';
import { tree } from './helpers/blocks.js';

// 1x1 transparent PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

type FileSpec = { name: string; type: string; b64?: string };

async function boot(page: Page, query = '') {
  await page.goto('/e2e' + query);
  await page.waitForFunction(() => (window as any).__nabu_ready === true && (window as any).nabu?.children?.length > 0, null, { timeout: 20000 });
  await clearAndReset(page);
}

/** Paste `files` (+ text payloads) at the caret as a synthetic ClipboardEvent. */
async function pasteFiles(page: Page, files: FileSpec[], data: Record<string, string> = {}) {
  await page.evaluate(({ files, data, png }) => {
    const dt = new DataTransfer();
    for (const f of files) {
      const bytes = Uint8Array.from(atob(f.b64 ?? png), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], f.name, { type: f.type }));
    }
    for (const [format, value] of Object.entries(data)) dt.setData(format, value);
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { files, data, png: PNG_B64 });
}

const png = (name = 'screenshot.png'): FileSpec => ({ name, type: 'image/png' });

/** Paste HTML / text payloads only. */
async function pasteData(page: Page, data: Record<string, string>) {
  await pasteFiles(page, [], data);
}

/** The media blocks, in document order. */
const media = (page: Page) => page.evaluate(() => {
  const n = (window as any).nabu;
  const out: any[] = [];
  const walk = (node: any) => {
    const b = n.blocks.get(node.id.toString());
    if (b && ['image', 'video', 'file'].includes(b.type)) out.push({ type: b.type, ref: b.ref, status: b.status, name: b.name });
    (node.children() ?? []).forEach(walk);
  };
  n.tree.roots().forEach(walk);
  return out;
});
/** Files the document knows (ADR 014: the `assetIndex` map holds metadata, the bytes live in the asset store). */
const assetIds = (page: Page) => page.evaluate(() => Object.keys((window as any).nabu.doc.getMap('assetIndex').toJSON()));
const imagesDisplay = (page: Page, count: number) => expect.poll(() => page.evaluate(() =>
  [...document.querySelectorAll('[data-block-type="image"] img')].map((i) => (i as HTMLImageElement).naturalWidth),
)).toEqual(Array(count).fill(1));

/** Put text in the (only) paragraph and the caret at `offset`. */
async function writeAndFocus(page: Page, text: string, offset: number) {
  await page.evaluate(async (t) => {
    const n = (window as any).nabu;
    n.children[0].behaviors.get('text').insert(0, t);
    await n.commit();
    n.undoManager.clear();
  }, text);
  await expect.poll(() => tree(page)).toBe(`p(${text})`);
  await focusAt(page, text, offset);
}

let errors: ReturnType<typeof collectErrors>;
test.beforeEach(({ page }) => { errors = collectErrors(page); });
test.afterEach(async ({ page }) => {
  expect(errors.list(), 'console / page errors').toEqual([]);
  expect(await violations(page)).toEqual([]);
});

test.describe('pasting files', () => {
  test('1 · a PNG screenshot becomes an image block stored in the document, and displays', async ({ page }) => {
    await boot(page);
    await focusEmpty(page);
    await pasteFiles(page, [png()], { 'text/plain': 'screenshot.png' });
    await expect.poll(() => tree(page)).toBe('image(∅)');
    const [img] = await media(page);
    expect(img.ref).toMatch(/^nabu-asset:sha256-[0-9a-f]{64}$/);
    expect(img.status).toBe('ready');
    expect(await assetIds(page)).toEqual([img.ref.slice('nabu-asset:'.length)]);
    await imagesDisplay(page, 1);
  });

  test('2 · with a host onBeforePersist: pending with a preview, then ready with the host ref', async ({ page }) => {
    await boot(page, '?hostFiles=gated');
    await focusEmpty(page);
    await pasteFiles(page, [png('up.png')]);
    await expect.poll(async () => (await media(page))[0]?.status).toBe('pending');
    expect((await media(page))[0].ref).toMatch(/^nabu-pending:/);
    await imagesDisplay(page, 1); // the local preview is shown meanwhile
    expect(await page.evaluate(() => Object.keys((window as any).nabu.doc.getMap('assets').toJSON()))).toEqual([]); // never bytes in the document
    await page.evaluate(() => (window as any).__hostRelease());
    await expect.poll(async () => (await media(page))[0]?.status).toBe('ready');
    const [img] = await media(page);
    expect(img.ref).toMatch(/^blob:/);
    expect(await page.evaluate(() => (window as any).__hostUploads.map((u: any) => [u.name, u.type]))).toEqual([['up.png', 'image/png']]);
    await imagesDisplay(page, 1);
    // the swap is not an undo step: one undo removes the block, one redo brings it back with the final ref
    await undo(page);
    await expect.poll(() => tree(page)).toBe('p(∅)');
    await redo(page);
    await expect.poll(() => tree(page)).toBe('image(∅)');
    expect((await media(page))[0].ref).toMatch(/^blob:/);
  });

  test('3 · several files give several blocks, in order, by type', async ({ page }) => {
    await boot(page);
    await focusEmpty(page);
    await pasteFiles(page, [png('a.png'), { name: 'clip.mp4', type: 'video/mp4' }, { name: 'doc.pdf', type: 'application/pdf' }, png('b.png')]);
    await expect.poll(async () => (await media(page)).map((m) => m.type + ':' + m.name)).toEqual(['image:a.png', 'video:clip.mp4', 'file:doc.pdf', 'image:b.png']);
    await expect.poll(() => tree(page)).toBe('image(∅) ; video(∅) ; file(∅) ; image(∅)');
    expect(await assetIds(page)).toHaveLength(1); // the four files are the same bytes: one hash, one stored file
  });

  test('4 · an internal copy (application/x-nabu+json) wins over the files on the clipboard', async ({ page }) => {
    await boot(page);
    await focusEmpty(page);
    const fragment = JSON.stringify({ version: 1, blocks: [{ type: 'paragraph', partial: false, delta: [{ insert: 'copied' }] }, { type: 'paragraph', partial: false, delta: [{ insert: 'text' }] }] });
    await pasteFiles(page, [png()], { 'application/x-nabu+json': fragment, 'text/plain': 'copied\ntext' });
    await expect.poll(() => tree(page)).toBe('p(copied) ; p(text)');
    expect(await media(page)).toEqual([]);
  });

  test('5 · pasted mid-text, the paragraph is split around the media', async ({ page }) => {
    await boot(page);
    await writeAndFocus(page, 'Hello world', 6);
    await pasteFiles(page, [png('1.png'), png('2.png')]);
    await expect.poll(() => tree(page)).toBe('p(Hello ) ; image(∅) ; image(∅) ; p(world)');
    await imagesDisplay(page, 2);
  });

  test('6 · Ctrl+Z restores the text in one step, Ctrl+Y brings the media back', async ({ page }) => {
    await boot(page);
    await writeAndFocus(page, 'Hello world', 6);
    await pasteFiles(page, [png('1.png'), png('2.png')]);
    await expect.poll(() => tree(page)).toBe('p(Hello ) ; image(∅) ; image(∅) ; p(world)');
    await undo(page);
    await expect.poll(() => tree(page)).toBe('p(Hello world)');
    expect(await assetIds(page)).toHaveLength(1); // the file (same bytes twice) stays known: storing it is not an undo step
    await redo(page);
    await expect.poll(() => tree(page)).toBe('p(Hello ) ; image(∅) ; image(∅) ; p(world)');
    await imagesDisplay(page, 2);
  });

  test('7 · a spreadsheet range (HTML table + the picture of it) pastes as rows, not as a picture', async ({ page }) => {
    await boot(page);
    await focusEmpty(page);
    await pasteFiles(page, [png('range.png')], { 'text/html': '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>', 'text/plain': 'a\tb\nc\td' });
    await expect.poll(() => tree(page)).toBe('p(a\\tb) ; p(c\\td)');
    expect(await media(page)).toEqual([]);
  });
});

test.describe('P-53 · a block without text pasted into a text block', () => {
  test('8 · a lone <img> pasted mid-text splits the paragraph (head, image, tail)', async ({ page }) => {
    await boot(page);
    await writeAndFocus(page, 'Hello world', 6);
    await pasteData(page, { 'text/html': `<img src="data:image/png;base64,${PNG_B64}" alt="pixel">` });
    await expect.poll(() => tree(page)).toBe('p(Hello ) ; image(∅) ; p(world)');
    await imagesDisplay(page, 1);
    await undo(page);
    await expect.poll(() => tree(page)).toBe('p(Hello world)');
  });

  test('9 · at the start of the text the image comes first; at the end it follows', async ({ page }) => {
    await boot(page);
    await writeAndFocus(page, 'Hello', 0);
    await pasteData(page, { 'text/html': `<img src="data:image/png;base64,${PNG_B64}">` });
    await expect.poll(() => tree(page)).toBe('image(∅) ; p(Hello)');
    await clearAndReset(page);
    await writeAndFocus(page, 'Hello', 5);
    await pasteData(page, { 'text/html': `<img src="data:image/png;base64,${PNG_B64}">` });
    await expect.poll(() => tree(page)).toBe('p(Hello) ; image(∅)');
  });
});

test.describe('files.importRemote', () => {
  test('10 · opt-in: a web image is fetched and stored in the document; the original URL is shown meanwhile', async ({ page }) => {
    await page.route('https://remote.test/**', async (route) => {
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: Buffer.from(PNG_B64, 'base64') });
    });
    await boot(page, '?options=' + encodeURIComponent(JSON.stringify({ files: { importRemote: true } })));
    await focusEmpty(page);
    await pasteData(page, { 'text/html': '<p>Cat:</p><img src="https://remote.test/pics/cat.png" alt="cat">' });
    await expect.poll(async () => (await media(page))[0]?.status).toBe('pending');
    await expect.poll(async () => (await media(page))[0]?.status).toBe('ready');
    const [img] = await media(page);
    expect(img.ref).toMatch(/^nabu-asset:sha256-[0-9a-f]{64}$/);
    expect(await assetIds(page)).toHaveLength(1);
    await imagesDisplay(page, 1);
    await undo(page);
    await expect.poll(() => tree(page)).toBe('p(∅)');
  });

  test('11 · a failing fetch keeps the original URL (hot-linked)', async ({ page }) => {
    await page.route('https://remote.test/**', (route) => route.abort());
    await boot(page, '?options=' + encodeURIComponent(JSON.stringify({ files: { importRemote: true } })));
    await focusEmpty(page);
    await pasteData(page, { 'text/html': '<p>Cat:</p><img src="https://remote.test/pics/cat.png" alt="cat">' });
    await expect.poll(async () => (await media(page))[0]?.status).toBe('ready');
    expect((await media(page))[0].ref).toBe('https://remote.test/pics/cat.png');
    expect(await assetIds(page)).toEqual([]);
  });

  test('12 · off by default: nothing is fetched, the URL is kept', async ({ page }) => {
    let fetches = 0; // the <img> itself loads from the page (hot-link): only a fetch() would be an import
    await page.route('https://remote.test/**', (route) => { if (route.request().resourceType() === 'fetch') fetches++; return route.abort(); });
    await boot(page);
    await focusEmpty(page);
    await pasteData(page, { 'text/html': '<img src="https://remote.test/pics/cat.png">' });
    await expect.poll(async () => (await media(page))[0]?.ref).toBe('https://remote.test/pics/cat.png');
    expect(fetches).toBe(0);
  });
});
