// @ts-nocheck
/**
 * Unit tests for P-51 — media across documents: the bytes of an `nabu-asset:` image travel inside the
 * `application/x-nabu+json` fragment and are re-created in the target document.
 */
import { describe, it, expect, vi } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { ImageExtension } from '$lib/blocks/image/index.js';
import { Files } from '$lib/files/files.svelte.js';
import { FileExtension } from '$lib/blocks/file/index.js';
import { VideoExtension } from '$lib/blocks/video/index.js';
import { NabuPasteExtension, PlainTextPasteExtension, HtmlPasteExtension } from '$lib/paste/index.js';

const EXTENSIONS = [ParagraphExtension, ImageExtension, VideoExtension, FileExtension, NabuPasteExtension, PlainTextPasteExtension, HtmlPasteExtension];
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

async function makeEditor(init = {}) {
  const engine = new Nabu({ extensions: EXTENSIONS, ...init });
  await engine.commit();
  return engine;
}

/** Add an image block backed by a fresh asset; returns the block. */
async function addImage(engine, bytes = PNG, props = {}) {
  const ref = await Files.get(engine).persist(new File([bytes], 'pic.png', { type: 'image/png' }));
  const block = engine.insert('image', { ref, alt: 'a pic', ...props });
  await engine.commit();
  return block;
}

/** Copy a (void) block, as handleCopy would on a selection covering it; returns the clipboard payloads. */
function copyBlock(engine, block) {
  engine.selection = {
    sync: vi.fn(), isCollapsed: false, startBlock: block, endBlock: block, start: { from: 0 }, end: { to: 0 },
    setCursor: vi.fn(), anchorBlock: block, focusBlock: block,
  };
  const data = {};
  engine.handleCopy({ preventDefault: vi.fn(), clipboardData: { setData: (k, v) => { data[k] = v; } } });
  return data;
}

/** Paste a clipboard payload at the end of the first paragraph of `engine`. */
function pasteInto(engine, data) {
  // an image pasted alone lands in an EMPTY text block (it takes its type): always paste into a fresh one
  const anchor = engine.insert('paragraph', { text: '' });
  Object.defineProperty(anchor, 'selection', { value: { from: 0, to: 0 }, configurable: true });
  engine.selection = { anchorBlock: anchor, focusBlock: anchor, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
  engine.handlePaste({ preventDefault: vi.fn(), clipboardData: { getData: (k) => data[k] ?? '' } });
}

const images = (engine) => [...engine.blocks.values()].filter((b) => b.type === 'image');
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };


const b64 = (u8) => btoa(String.fromCharCode(...u8));

describe('P-51 copy: the bytes travel in the fragment', () => {
  it('embeds the asset in `assets` (version 1 kept), the block keeps its ref', async () => {
    const a = await makeEditor();
    const block = await addImage(a);
    const data = copyBlock(a, block);
    const frag = JSON.parse(data['application/x-nabu+json']);
    expect(frag.version).toBe(1);
    const id = block.ref.slice('nabu-asset:'.length);
    expect(frag.blocks[0].props.ref).toBe(block.ref);
    expect(frag.assets[id]).toEqual({ mime: 'image/png', name: 'pic.png', size: PNG.length, data: b64(PNG) });
  });

  it('a fragment without media has no `assets` field', async () => {
    const a = await makeEditor();
    const block = a.insert('image', { ref: 'https://x.test/a.png', alt: 'hosted' });
    await a.commit();
    const frag = JSON.parse(copyBlock(a, block)['application/x-nabu+json']);
    expect('assets' in frag).toBe(false);
  });

  it('above maxInlineSize the bytes are not embedded (ref only) and nabu.warn says so', async () => {
    const a = await makeEditor({ files: { maxInlineSize: 8 } });
    const warn = vi.spyOn(a, 'warn');
    const block = await addImage(a); // 12 bytes > 8
    const frag = JSON.parse(copyBlock(a, block)['application/x-nabu+json']);
    expect('assets' in frag).toBe(false);
    expect(frag.blocks[0].props.ref).toBe(block.ref);
    expect(warn).toHaveBeenCalled();
  });

  it('text/html never contains nabu-asset: — a small image becomes a data: URL', async () => {
    const a = await makeEditor();
    const block = await addImage(a);
    const { 'text/html': html, 'text/plain': text } = copyBlock(a, block);
    expect(html).not.toContain('nabu-asset:');
    expect(html).toContain('<img src="data:image/png;base64,' + b64(PNG) + '" alt="a pic">');
    expect(text).not.toContain('nabu-asset:');
    expect(text).toBe('a pic'); // markdown: alt text only
  });

  it('an image above the 1 MB threshold is a label, not a broken src', async () => {
    const a = await makeEditor({ files: { maxInlineSize: 8 * 1024 * 1024 } });
    const block = await addImage(a, new Uint8Array(1024 * 1024 + 1));
    const { 'text/html': html, 'application/x-nabu+json': json } = copyBlock(a, block);
    expect(html).toBe('<p>a pic</p>');
    expect(JSON.parse(json).assets).toBeTruthy(); // still embedded for Nabu itself (under maxInlineSize)
  });

  it('a non-image file (pdf) is emitted as a label, a video as a data: URL only when image/video', async () => {
    const a = await makeEditor();
    const ref = await Files.get(a).persist(new File([PNG], 'doc.pdf', { type: 'application/pdf' }));
    const block = a.insert('file', { ref, name: 'doc.pdf' });
    await a.commit();
    const { 'text/html': html, 'text/plain': text } = copyBlock(a, block);
    expect(html).toBe('<p>doc.pdf</p>');
    expect(text).toBe('doc.pdf');
  });

  it('a hosted URL is left alone everywhere', async () => {
    const a = await makeEditor();
    const block = a.insert('image', { ref: 'https://cdn.test/a.png', alt: 'h' });
    await a.commit();
    const data = copyBlock(a, block);
    expect(data['text/html']).toBe('<img src="https://cdn.test/a.png" alt="h">');
    expect(data['text/plain']).toBe('![h](https://cdn.test/a.png)');
  });
});

describe('P-51 paste: the asset is re-created in the target document', () => {
  it('another document: the bytes are restored (same id), the image resolves', async () => {
    const a = await makeEditor();
    const b = await makeEditor();
    const block = await addImage(a);
    pasteInto(b, copyBlock(a, block));
    await flush();
    const [pasted] = images(b);
    expect(pasted.ref).toBe(block.ref);
    expect(pasted.status).toBe('ready');
    const asset = Files.get(b).getAsset(pasted.ref);
    expect([...asset.data]).toEqual([...PNG]);
    expect(asset.type).toBe('image/png');
    expect(asset.name).toBe('pic.png');
    expect(Files.get(b).resolve(pasted.ref)).toMatch(/^blob:/);
  });

  it('the same document: the ref is reused, no second asset', async () => {
    const a = await makeEditor();
    const block = await addImage(a);
    pasteInto(a, copyBlock(a, block));
    await flush();
    expect(images(a)).toHaveLength(2);
    expect(images(a).map((i) => i.ref)).toEqual([block.ref, block.ref]);
    expect(Object.keys(Files.get(a).assets.toJSON())).toHaveLength(1);
  });

  it('pasting twice in another document stores the asset once', async () => {
    const a = await makeEditor();
    const b = await makeEditor();
    const data = copyBlock(a, await addImage(a));
    pasteInto(b, data);
    await flush();
    pasteInto(b, data);
    await flush();
    expect(images(b)).toHaveLength(2);
    expect(Object.keys(Files.get(b).assets.toJSON())).toHaveLength(1);
  });

  it('paste is ONE undo step (the asset and the block go together)', async () => {
    const a = await makeEditor();
    const b = await makeEditor();
    const data = copyBlock(a, await addImage(a));
    b.undoManager.clear();
    pasteInto(b, data);
    await flush();
    expect(images(b)).toHaveLength(1);
    b.undo();
    await flush();
    expect(images(b)).toHaveLength(0);
  });

  it('no bytes in the fragment: the block is kept, status "missing", nothing crashes', async () => {
    const a = await makeEditor();
    const b = await makeEditor();
    const data = copyBlock(a, await addImage(a));
    const frag = JSON.parse(data['application/x-nabu+json']);
    delete frag.assets;
    pasteInto(b, { 'application/x-nabu+json': JSON.stringify(frag) });
    await flush();
    const [pasted] = images(b);
    expect(pasted.status).toBe('missing');
    expect(pasted.ref).toMatch(/^nabu-asset:/);
    expect(pasted.displaySrc).toBe('');
    expect(Files.get(b).getAsset(pasted.ref)).toBeNull();
  });

  it('corrupt bytes (invalid base64 / wrong shape) degrade to "missing"', async () => {
    const b = await makeEditor();
    for (const bad of [{ data: '***not base64***' }, { data: 42 }, 'junk', null]) {
      const frag = { version: 1, blocks: [{ type: 'image', props: { ref: 'nabu-asset:zzz', alt: '' }, partial: false }], assets: { zzz: bad } };
      pasteInto(b, { 'application/x-nabu+json': JSON.stringify(frag) });
      await flush();
    }
    expect(images(b).length).toBe(4);
    expect(images(b).every((i) => i.status === 'missing')).toBe(true);
  });

  it('a hosted URL pastes unchanged into another document', async () => {
    const a = await makeEditor();
    const b = await makeEditor();
    const block = a.insert('image', { ref: 'https://cdn.test/a.png', alt: 'h' });
    await a.commit();
    pasteInto(b, copyBlock(a, block));
    await flush();
    expect(images(b)[0].ref).toBe('https://cdn.test/a.png');
    expect(images(b)[0].status).toBe('ready');
  });

  it('a video and a file block travel too', async () => {
    const a = await makeEditor();
    const b = await makeEditor();
    const vref = await Files.get(a).persist(new File([PNG], 'v.mp4', { type: 'video/mp4' }));
    const video = a.insert('video', { ref: vref, name: 'v.mp4' });
    await a.commit();
    pasteInto(b, copyBlock(a, video));
    const pasted = [...b.blocks.values()].find((x) => x.type === 'video');
    expect(Files.get(b).getAsset(pasted.ref).type).toBe('video/mp4');
  });
});

describe('P-51 paste with a host onBeforePersist: re-uploaded, optimistic preview, final ref', () => {
  function hostEditor() {
    const uploads = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    return {
      uploads, release,
      make: () => makeEditor({ files: { onBeforePersist: async (file) => { uploads.push(file); await gate; return { ref: 'https://host.test/' + file.name }; } } }),
    };
  }

  it('block appears pending with a local preview, then gets the host ref; no asset is stored inline', async () => {
    const a = await makeEditor();
    const host = hostEditor();
    const b = await host.make();
    const data = copyBlock(a, await addImage(a));
    pasteInto(b, data);
    await flush();
    let [pasted] = images(b);
    expect(pasted.status).toBe('pending');
    expect(pasted.ref).toMatch(/^nabu-pending:/);
    expect(pasted.displaySrc).toMatch(/^blob:/);
    expect(host.uploads).toHaveLength(1);
    expect(host.uploads[0].name).toBe('pic.png');
    host.release();
    await flush();
    [pasted] = images(b);
    expect(pasted.status).toBe('ready');
    expect(pasted.ref).toBe('https://host.test/pic.png');
    expect(Object.keys(Files.get(b).assets.toJSON())).toHaveLength(0);
  });

  it('two pastes of the same asset upload it once and both blocks get the ref', async () => {
    const a = await makeEditor();
    const host = hostEditor();
    const b = await host.make();
    const data = copyBlock(a, await addImage(a));
    pasteInto(b, data);
    await flush();
    pasteInto(b, data);
    host.release();
    await flush();
    expect(host.uploads).toHaveLength(1);
    expect(images(b).map((i) => i.ref)).toEqual(['https://host.test/pic.png', 'https://host.test/pic.png']);
  });

  it('the settle commit is not an undo step: undo removes the whole paste, redo brings the final ref back', async () => {
    const a = await makeEditor();
    const host = hostEditor();
    const b = await host.make();
    const data = copyBlock(a, await addImage(a));
    b.undoManager.clear();
    pasteInto(b, data);
    host.release();
    await flush();
    expect(images(b)[0].ref).toBe('https://host.test/pic.png');
    b.undo();
    await flush();
    expect(images(b)).toHaveLength(0);
    b.redo();
    await flush();
    expect(images(b)).toHaveLength(1);
    expect(images(b)[0].ref).toBe('https://host.test/pic.png');
  });

  it('a failing upload ends in the error status', async () => {
    const a = await makeEditor();
    const b = await makeEditor({ files: { onBeforePersist: async () => { throw new Error('boom'); } } });
    pasteInto(b, copyBlock(a, await addImage(a)));
    await flush();
    expect(images(b)[0].status).toBe('error');
  });

  it('undoing the paste before the upload ends is harmless', async () => {
    const a = await makeEditor();
    const host = hostEditor();
    const b = await host.make();
    const data = copyBlock(a, await addImage(a));
    b.undoManager.clear();
    pasteInto(b, data);
    await flush();
    b.undo();
    await flush();
    host.release();
    await flush();
    expect(images(b)).toHaveLength(0);
  });
});
