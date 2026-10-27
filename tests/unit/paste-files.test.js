// @ts-nocheck
/**
 * P-55 / P-53 — files on the clipboard become media blocks (generic `pasteFileHandlers`), a block without text pasted
 * into a text block splits it, and web images can be imported through `files.importRemote`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { ImageExtension } from '#lib/blocks/image/index.js';
import { VideoExtension } from '#lib/blocks/video/index.js';
import { FileExtension } from '#lib/blocks/file/index.js';
import { DividerExtension } from '#lib/blocks/divider/index.js';
import { ListExtension, ListItemExtension } from '#lib/blocks/list/index.js';
import { NabuPasteExtension, PlainTextPasteExtension, HtmlPasteExtension } from '#lib/paste/index.js';
import { Files } from '#lib/files/files.svelte.js';
import { extension } from '#lib/utils/extensions.js';

const EXTENSIONS = [ParagraphExtension, ImageExtension, VideoExtension, FileExtension, DividerExtension, ListExtension, ListItemExtension, NabuPasteExtension, PlainTextPasteExtension, HtmlPasteExtension];
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const flush = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setTimeout(r, 0)); };

async function makeEditor(init = {}, extensions = EXTENSIONS) {
  const engine = new Nabu({ extensions, ...init });
  await engine.commit();
  return engine;
}

/** A paragraph with `text` and the caret at `offset`, as the selection surface insertFragment reads. */
async function caretIn(engine, text, offset = text.length) {
  const block = engine.children[0];
  if (text) block.behaviors.get('text').insert(0, text);
  await engine.commit();
  Object.defineProperty(block, 'selection', { value: { from: offset, to: offset }, configurable: true });
  engine.selection = { anchorBlock: block, focusBlock: block, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
  engine.undoManager.clear();
  return block;
}

/** A DataTransfer-like clipboard: text payloads and files (as `files` and as `items`). */
function clipboard({ files = [], data = {} } = {}) {
  return {
    files,
    items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    types: [...Object.keys(data), ...(files.length ? ['Files'] : [])],
    getData: (k) => data[k] ?? '',
  };
}
const paste = (engine, clip) => engine.handlePaste({ preventDefault: vi.fn(), clipboardData: clip });
const png = (name = 'shot.png') => new File([PNG], name, { type: 'image/png' });

/** Compact outline of the root blocks: `p(text)`, `image`, `video`, `file(name)`, `hr`. */
const shape = (engine) => engine.tree.roots().map((n) => {
  const type = n.data.get('type');
  if (type === 'paragraph') return `p(${n.data.get('text')?.toString() ?? ''})`;
  if (type === 'divider') return 'hr';
  return type === 'file' ? `file(${n.data.get('name')})` : type;
}).join(' ; ');
const media = (engine) => [...engine.blocks.values()].filter((b) => ['image', 'video', 'file'].includes(b.type) && !b.node.isDeleted?.());

describe('P-53 — a block without text pasted into a text block', () => {
  const image = { type: 'image', props: { ref: 'https://example.org/a.png', alt: '' }, partial: false };

  it('mid-text: the block is split around it (head, image, tail)', async () => {
    const engine = await makeEditor();
    await caretIn(engine, 'Hello world', 6);
    engine.insertFragment({ blocks: [image] });
    await flush();
    expect(shape(engine)).toBe('p(Hello ) ; image ; p(world)');
  });

  it('at the end: the image follows; at the start: the image comes first (no blank head left)', async () => {
    const a = await makeEditor();
    await caretIn(a, 'Hello');
    a.insertFragment({ blocks: [image] });
    await flush();
    expect(shape(a)).toBe('p(Hello) ; image');

    const b = await makeEditor();
    await caretIn(b, 'Hello', 0);
    b.insertFragment({ blocks: [image] });
    await flush();
    expect(shape(b)).toBe('image ; p(Hello)');
  });

  it('into an empty text block it replaces it (as before)', async () => {
    const engine = await makeEditor();
    await caretIn(engine, '');
    engine.insertFragment({ blocks: [image] });
    await flush();
    expect(shape(engine)).toBe('image');
  });

  it('several blocks, the first without text (image, then a paragraph)', async () => {
    const engine = await makeEditor();
    await caretIn(engine, 'Hello world', 6);
    engine.insertFragment({ blocks: [image, { type: 'divider', partial: false }] });
    await flush();
    expect(shape(engine)).toBe('p(Hello ) ; image ; hr ; p(world)');
  });

  it('a divider (any block without a delta) is inserted too', async () => {
    const engine = await makeEditor();
    await caretIn(engine, 'ab', 1);
    engine.insertFragment({ blocks: [{ type: 'divider', partial: false }] });
    await flush();
    expect(shape(engine)).toBe('p(a) ; hr ; p(b)');
  });

  it('is one undo step', async () => {
    const engine = await makeEditor();
    await caretIn(engine, 'Hello world', 6);
    engine.insertFragment({ blocks: [image] });
    await flush();
    engine.undo();
    await flush();
    expect(shape(engine)).toBe('p(Hello world)');
  });

  it('HTML: a lone <img> pasted mid-text splits the paragraph', async () => {
    const engine = await makeEditor();
    await caretIn(engine, 'Hello world', 6);
    paste(engine, clipboard({ data: { 'text/html': '<img src="https://example.org/a.png" alt="x">' } }));
    await flush();
    expect(shape(engine)).toBe('p(Hello ) ; image ; p(world)');
    expect(media(engine)[0].ref).toBe('https://example.org/a.png');
  });
});

describe('P-55 — files on the clipboard', () => {
  it('a screenshot becomes an image block stored in the asset store (hash ref); the text payloads are ignored', async () => {
    const engine = await makeEditor();
    await caretIn(engine, '');
    paste(engine, clipboard({ files: [png()], data: { 'text/plain': 'shot.png', 'text/html': '<p>shot.png</p>' } }));
    await flush();
    expect(shape(engine)).toBe('image');
    const [img] = media(engine);
    expect(img.ref).toMatch(/^nabu-asset:sha256-[0-9a-f]{64}$/);
    expect(img.status).toBe('ready');
    expect(img.name).toBe('shot.png');
    expect(Files.get(engine).getAsset(img.ref)).toMatchObject({ type: 'image/png', name: 'shot.png' });
    expect([...Files.get(engine).getAsset(img.ref).data]).toEqual([...PNG]);
  });

  it('works from `items` when `files` is empty', async () => {
    const engine = await makeEditor();
    await caretIn(engine, '');
    const clip = clipboard({ files: [png()] });
    clip.files = [];
    paste(engine, clip);
    await flush();
    expect(shape(engine)).toBe('image');
  });

  it('image / video / any other file by MIME type; several files give several blocks, in order', async () => {
    const engine = await makeEditor();
    await caretIn(engine, '');
    paste(engine, clipboard({ files: [
      new File([PNG], 'a.png', { type: 'image/png' }),
      new File([PNG], 'clip.mp4', { type: 'video/mp4' }),
      new File([PNG], 'doc.pdf', { type: 'application/pdf' }),
      new File([PNG], 'b.jpg', { type: 'image/jpeg' }),
    ] }));
    await flush();
    expect(shape(engine)).toBe('image ; video ; file(doc.pdf) ; image');
  });

  it('pasted mid-text, the paragraph is split around the blocks', async () => {
    const engine = await makeEditor();
    await caretIn(engine, 'Hello world', 6);
    paste(engine, clipboard({ files: [png('1.png'), png('2.png')] }));
    await flush();
    expect(shape(engine)).toBe('p(Hello ) ; image ; image ; p(world)');
  });

  it('is ONE undo step (the blocks; the files are stored outside the document, outside undo)', async () => {
    const engine = await makeEditor();
    await caretIn(engine, 'Hello world', 6);
    paste(engine, clipboard({ files: [png('1.png'), png('2.png')] }));
    await flush();
    expect(Object.keys(Files.get(engine).index.toJSON())).toHaveLength(1); // the same bytes twice: one file
    expect(Files.get(engine).store.size).toBe(1);
    engine.undo();
    await flush();
    expect(shape(engine)).toBe('p(Hello world)');
    engine.redo();
    await flush();
    expect(shape(engine)).toBe('p(Hello ) ; image ; image ; p(world)');
  });

  it('an internal copy (application/x-nabu+json) wins over the files', async () => {
    const engine = await makeEditor();
    await caretIn(engine, '');
    const fragment = JSON.stringify({ version: 1, blocks: [{ type: 'paragraph', partial: false, delta: [{ insert: 'internal' }] }, { type: 'paragraph', partial: false, delta: [{ insert: 'copy' }] }] });
    paste(engine, clipboard({ files: [png()], data: { 'application/x-nabu+json': fragment, 'text/plain': 'internal\ncopy' } }));
    await flush();
    expect(shape(engine)).toBe('p(internal) ; p(copy)');
    expect(media(engine)).toHaveLength(0);
  });

  it('a spreadsheet range (HTML table + the image of it) pastes as rows, not as a picture', async () => {
    const engine = await makeEditor();
    await caretIn(engine, '');
    paste(engine, clipboard({ files: [png('range.png')], data: { 'text/html': '<table><tr><td>a</td><td>b</td></tr></table>', 'text/plain': 'a\tb' } }));
    await flush();
    expect(shape(engine)).toBe('p(a\tb)');
  });

  it('with no handler for the files, the text payloads are pasted as usual', async () => {
    const engine = await makeEditor({}, [ParagraphExtension, PlainTextPasteExtension]);
    await caretIn(engine, '');
    paste(engine, clipboard({ files: [png()], data: { 'text/plain': 'just text' } }));
    await flush();
    expect(shape(engine)).toBe('p(just text)');
  });

  it('the engine is generic: any extension can declare pasteFileHandlers (here, a file becomes a paragraph)', async () => {
    const named = extension('named-files', {
      pasteFileHandlers: [{ priority: 100, accepts: (file) => file.name === 'special.bin', block: (file) => ({ type: 'file', partial: false, props: { name: 'SPECIAL ' + file.name } }) }],
    });
    const engine = await makeEditor({}, [...EXTENSIONS, named]);
    await caretIn(engine, '');
    paste(engine, clipboard({ files: [new File([PNG], 'special.bin', { type: 'image/png' })] }));
    await flush();
    expect(shape(engine)).toBe('file(SPECIAL special.bin)'); // asked before the image handler (priority)
  });

  it('a handler that throws or declines does not break the paste: the next one takes the file', async () => {
    const bad = extension('bad', { pasteFileHandlers: [{ priority: 99, accepts: () => { throw new Error('x'); }, block: () => null }, { priority: 98, accepts: () => true, block: () => null }] });
    const engine = await makeEditor({}, [...EXTENSIONS, bad]);
    engine.warn = vi.fn();
    await caretIn(engine, '');
    paste(engine, clipboard({ files: [png()] }));
    await flush();
    expect(shape(engine)).toBe('image');
  });

  describe('with a host onBeforePersist', () => {
    it('the block is pending with its hash ref (local preview), then ready once the host has the file (silent commit)', async () => {
      let release;
      const gate = new Promise((r) => { release = r; });
      const uploads = [];
      const engine = await makeEditor({ files: { onBeforePersist: async (file) => { uploads.push(file); await gate; return { ref: 'https://host.test/' + file.name }; } } });
      await caretIn(engine, '');
      paste(engine, clipboard({ files: [png('up.png')] }));
      await flush();
      const [img] = media(engine);
      expect(img.status).toBe('pending');
      expect(img.ref).toMatch(/^nabu-asset:sha256-[0-9a-f]{64}$/);
      expect(uploads).toHaveLength(1);
      expect(uploads[0]).toMatchObject({ name: 'up.png', type: 'image/png' });
      expect(Object.keys(Files.get(engine).assets.toJSON())).toHaveLength(0); // no bytes in the document
      expect(Files.get(engine).store.size).toBe(1); // the local store has them first
      release();
      await flush();
      const ref = img.ref;
      expect(media(engine)[0].status).toBe('ready');
      expect(media(engine)[0].ref).toBe(ref); // the ref never changes
      expect(Files.get(engine).index.get(ref.slice('nabu-asset:'.length)).url).toBe('https://host.test/up.png');
      // one undo removes the whole paste, even after the upload completed
      engine.undo();
      await flush();
      expect(media(engine)).toHaveLength(0);
    });
  });
});

describe('files.importRemote', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });
  const url = 'https://example.org/pics/cat.png';
  const html = `<p>x</p><img src="${url}" alt="cat">`;

  it('is OFF by default: the original URL is kept, nothing is fetched', async () => {
    globalThis.fetch = vi.fn();
    const engine = await makeEditor();
    await caretIn(engine, '');
    paste(engine, clipboard({ data: { 'text/html': html } }));
    await flush();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(media(engine)[0].ref).toBe(url);
  });

  it('ON: fetched, stored in the document, the block shows the original while pending', async () => {
    let finish;
    globalThis.fetch = vi.fn(() => new Promise((r) => { finish = () => r({ ok: true, blob: async () => new Blob([PNG], { type: 'image/png' }) }); }));
    const engine = await makeEditor({ files: { importRemote: true } });
    await caretIn(engine, '');
    paste(engine, clipboard({ data: { 'text/html': html } }));
    await flush();
    let [img] = media(engine);
    expect(img.status).toBe('pending');
    expect(img.displaySrc).toBe(url); // shown from its origin meanwhile
    expect(globalThis.fetch).toHaveBeenCalledWith(url, expect.objectContaining({ credentials: 'omit' }));
    finish();
    await flush();
    [img] = media(engine);
    expect(img.status).toBe('ready');
    expect(img.ref).toMatch(/^nabu-asset:sha256-/);
    expect(Files.get(engine).getAsset(img.ref)).toMatchObject({ type: 'image/png', name: 'cat.png' });
    // the swap is not an undo step: one undo removes the pasted content
    engine.undo();
    await flush();
    expect(media(engine)).toHaveLength(0);
  });

  it('ON, through onBeforePersist: the host receives the downloaded File; the block keeps the hash ref', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob([PNG], { type: 'image/png' }) }));
    const seen = [];
    const engine = await makeEditor({ files: { importRemote: true, onBeforePersist: async (file) => { seen.push(file); return { ref: 'https://host.test/' + file.name }; } } });
    await caretIn(engine, '');
    paste(engine, clipboard({ data: { 'text/html': html } }));
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ name: 'cat.png', type: 'image/png' });
    expect(media(engine)[0].ref).toMatch(/^nabu-asset:sha256-/);
    expect(media(engine)[0].status).toBe('ready');
    expect(Files.get(engine).index.get(media(engine)[0].ref.slice('nabu-asset:'.length)).url).toBe('https://host.test/cat.png');
  });

  it('a failing fetch (network, CORS, HTTP error, not a media type) keeps the original URL', async () => {
    for (const failing of [
      () => Promise.reject(new TypeError('Failed to fetch')),
      async () => ({ ok: false, status: 404, blob: async () => new Blob([]) }),
      async () => ({ ok: true, blob: async () => new Blob(['<html>'], { type: 'text/html' }) }),
    ]) {
      globalThis.fetch = vi.fn(failing);
      const engine = await makeEditor({ files: { importRemote: true } });
      await caretIn(engine, '');
      paste(engine, clipboard({ data: { 'text/html': html } }));
      await flush();
      expect(media(engine)[0].ref).toBe(url);
      expect(media(engine)[0].status).toBe('ready');
    }
  });

  it('only the HTML of outside content is imported (not an internal copy, not data: / relative URLs)', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob([PNG], { type: 'image/png' }) }));
    const engine = await makeEditor({ files: { importRemote: true } });
    await caretIn(engine, '');
    paste(engine, clipboard({ data: { 'text/html': '<img src="/local.png"><img src="data:image/png;base64,AAAA">' } }));
    engine.insertFragment({ blocks: [{ type: 'image', props: { ref: url }, partial: false }] }); // no `external` flag
    await flush();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('the same URL twice in one paste is fetched once', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob([PNG], { type: 'image/png' }) }));
    const engine = await makeEditor({ files: { importRemote: true } });
    await caretIn(engine, '');
    paste(engine, clipboard({ data: { 'text/html': `<img src="${url}"><img src="${url}">` } }));
    await flush();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(media(engine)).toHaveLength(2);
    expect(media(engine).every((m) => m.ref.startsWith('nabu-asset:'))).toBe(true);
  });
});
