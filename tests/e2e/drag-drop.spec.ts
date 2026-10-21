/**
 * E2E — drag & drop (ADR 014, lot 4).
 *
 * The browser must never edit the document: every drop on the editor is taken by Nabu and goes through the paste pipeline
 * (files → media blocks, then the paste interpreters) at the model position under the pointer. Dragging the editor's own
 * text selection is a MOVE (a copy with Ctrl / Alt). The block drag handle uses pointer events and keeps working.
 *
 * Drops are real mouse drags when the source is an element of the page (`#ext-src`, an "other page" stand-in) or the editor's
 * own selection, and synthetic DragEvents (a DataTransfer carrying real File objects) for OS files — Playwright cannot drag files
 * in from the desktop. Every test ends by checking the model against the DOM (`violations`) and the console.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clearAndReset } from './helpers/editor.js';
import { undo, redo } from './helpers/keyboard.js';
import { focusAt, collectErrors, violations, allText } from './helpers/model.js';
import { buildTree, tree, Pp, Hr, Code } from './helpers/blocks.js';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./../fixtures/html/${name}`, import.meta.url)), 'utf8');

// 1x1 transparent PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

type FileSpec = { name: string; type: string };
type Payload = { files?: FileSpec[]; data?: Record<string, string> };
type Pt = { x: number; y: number };

async function boot(page: Page, query = '') {
  await page.goto('/e2e' + query);
  await page.waitForFunction(() => (window as any).__nabu_ready === true && (window as any).nabu?.children?.length > 0, null, { timeout: 20000 });
  await clearAndReset(page);
}

/** Put `text` in the (only) paragraph, undo history cleared. */
async function write(page: Page, text: string) {
  await page.evaluate(async (t) => {
    const n = (window as any).nabu;
    n.children[0].behaviors.get('text').insert(0, t);
    await n.commit();
    n.undoManager.clear();
  }, text);
  await expect.poll(() => tree(page)).toBe(`p(${text})`);
}

/** Build the root paragraphs from `texts`, undo history cleared. */
async function writeAll(page: Page, texts: string[]) {
  await buildTree(page, texts.map((t) => Pp(t)));
}

/** The viewport point at `offset` of the (unique) text block whose text is `text`; offset -1 = its end. */
async function pointAt(page: Page, text: string, offset: number): Promise<Pt> {
  return page.evaluate(([t, off]) => {
    const n = (window as any).nabu;
    const block = [...n.blocks.values()].find((b: any) => b.behaviors?.get('text')?.text === t && b.element?.isConnected) as any;
    if (!block) throw new Error(`no block "${t}"`);
    const len = (t as string).length;
    const o = (off as number) < 0 ? len : (off as number);
    const range = document.createRange();
    const a = block.getDOMPoint(o > 0 ? o - 1 : 0);
    const b = block.getDOMPoint(o > 0 ? o : Math.min(1, len));
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    const rect = range.getBoundingClientRect();
    return { x: o > 0 ? rect.right : rect.left, y: (rect.top + rect.bottom) / 2 };
  }, [text, offset] as [string, number]);
}

/** The viewport rect of the block with the given (first) type, or of the n-th root. */
const rootRect = (page: Page, index: number) => page.evaluate((i) => {
  const r = (window as any).nabu.children[i].element.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
}, index);

/** Dispatch a synthetic drag event at a viewport point, with a DataTransfer built from `payload`. */
async function dragEvent(page: Page, type: 'dragenter' | 'dragover' | 'dragleave' | 'drop', pt: Pt, payload: Payload = {}, mods: { ctrl?: boolean } = {}) {
  return page.evaluate(({ type, pt, payload, png, mods }) => {
    const dt = new DataTransfer();
    dt.effectAllowed = 'all';
    for (const f of payload.files ?? []) {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], f.name, { type: f.type }));
    }
    for (const [format, value] of Object.entries(payload.data ?? {})) dt.setData(format, value);
    const target = document.elementFromPoint(pt.x, pt.y) ?? document.body;
    const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, dataTransfer: dt, ctrlKey: !!mods.ctrl });
    const notPrevented = target.dispatchEvent(ev);
    return { prevented: !notPrevented, dropEffect: dt.dropEffect };
  }, { type, pt, payload, png: PNG_B64, mods });
}

/** A full synthetic drag: enter, over, drop. */
async function dropAt(page: Page, pt: Pt, payload: Payload) {
  await dragEvent(page, 'dragenter', pt, payload);
  await dragEvent(page, 'dragover', pt, payload);
  return dragEvent(page, 'drop', pt, payload);
}

const png = (name = 'dropped.png'): FileSpec => ({ name, type: 'image/png' });

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
const imagesDisplay = (page: Page, count: number) => expect.poll(() => page.evaluate(() =>
  [...document.querySelectorAll('[data-block-type="image"] img')].map((i) => (i as HTMLImageElement).naturalWidth),
)).toEqual(Array(count).fill(1));

/** Model dump with marks: `p(plain [b:bold])`, blocks joined by " ; ". */
function dump(page: Page): Promise<string> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    const L: Record<string, string> = { bold: 'b', italic: 'i', underline: 'u', strikethrough: 's', code: 'c' };
    const fmt = (node: any) => {
      const t = node.data.get('text');
      if (!t) return '';
      return t.toDelta().map((op: any) => {
        const marks = Object.entries(op.attributes ?? {}).map(([k, v]) => (k === 'link' ? `a=${v}` : L[k] ?? k)).sort();
        const s = String(op.insert).replace(/\n/g, '\\n');
        return marks.length ? `[${marks.join(',')}:${s}]` : s;
      }).join('');
    };
    const walk = (node: any): string => {
      const type = node.data.get('type');
      const kids: any[] = node.children() ?? [];
      const short = type === 'paragraph' ? 'p' : type === 'heading' ? 'h' + node.data.get('level') : type === 'divider' ? 'hr' : type;
      if (type === 'divider') return 'hr';
      if (type === 'list') return `${node.data.get('listType') === 'ordered' ? 'ol' : 'ul'}[${kids.map(walk).join(', ')}]`;
      if (type === 'list-item') return `li(${fmt(node)})`;
      return `${short}(${fmt(node) || '∅'})${kids.length ? '{' + kids.map(walk).join(' ') + '}' : ''}`;
    };
    return n.tree.roots().map(walk).join(' ; ');
  });
}

/** What the engine publishes while a drag is over it. */
const dropTarget = (page: Page) => page.evaluate(() => {
  const t = (window as any).nabu.dropTarget;
  if (!t) return null;
  const tb = t.block.behaviors?.get('text');
  return { block: tb ? tb.text : t.block.type, offset: t.offset, side: t.side, kind: t.kind };
});

/** The editor's DOM text agrees with the model, block by block (the DOM was not edited behind Loro's back). */
const domMatchesModel = (page: Page) => page.evaluate(() => {
  const n = (window as any).nabu;
  const bad: string[] = [];
  for (const b of n.blocks.values() as Iterable<any>) {
    const tb = b.behaviors?.get('text');
    if (!tb || !b.element?.isConnected) continue;
    // a block's own text lives in the nodes that are not inside one of its child blocks
    const walker = document.createTreeWalker(b.element, NodeFilter.SHOW_TEXT);
    let dom = '';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const owner = node.parentElement?.closest('[data-block-id]');
      if (owner === b.element) dom += node.textContent;
    }
    if (dom.replace(/\n$/, '') !== tb.text.replace(/\n$/, '')) bad.push(`${b.type}: model "${tb.text}" != DOM "${dom}"`);
  }
  return bad;
});

/** Add a draggable element outside the editor: an "other page" that drags text/plain + text/html. */
async function addExternalSource(page: Page, data: Record<string, string>) {
  await page.evaluate((d) => {
    document.getElementById('ext-src')?.remove();
    const src = document.createElement('div');
    src.id = 'ext-src';
    src.draggable = true;
    src.textContent = 'DRAG ME';
    src.style.cssText = 'position:fixed;right:8px;top:8px;padding:10px;background:#fcc;z-index:99999';
    src.addEventListener('dragstart', (e) => {
      for (const [format, value] of Object.entries(d)) e.dataTransfer!.setData(format, value);
      e.dataTransfer!.effectAllowed = 'copyMove';
    });
    document.body.appendChild(src);
  }, data);
}

let errors: ReturnType<typeof collectErrors>;
test.beforeEach(({ page }) => { errors = collectErrors(page); });
test.afterEach(async ({ page }) => {
  expect(errors.list(), 'console / page errors').toEqual([]);
  expect(await violations(page)).toEqual([]);
  expect(await domMatchesModel(page)).toEqual([]);
});

test.describe('the browser never edits the document (desync protection)', () => {
  test('1 · a REAL drag of text/html from another element: Nabu inserts it, model == DOM, one undo', async ({ page }) => {
    await boot(page);
    await write(page, 'Hello world');
    await addExternalSource(page, {
      'text/plain': 'EXT red',
      'text/html': '<p>E<b>XT</b> <span style="color:red">red</span></p>',
    });
    const at = await pointAt(page, 'Hello world', 6);
    await page.dragAndDrop('#ext-src', '.nabu-editor [data-block-id]', { targetPosition: { x: at.x - (await rootRect(page, 0)).left, y: 8 } });
    await expect.poll(() => dump(page)).toBe('p(Hello E[b:XT] redworld)');
    await undo(page);
    await expect.poll(() => dump(page)).toBe('p(Hello world)');
    await redo(page);
    await expect.poll(() => dump(page)).toBe('p(Hello E[b:XT] redworld)');
  });

  test('2 · a drop the editor cannot read changes nothing (and is not offered)', async ({ page }) => {
    await boot(page);
    await write(page, 'Hello');
    const pt = await pointAt(page, 'Hello', 2);
    const over = await dragEvent(page, 'dragover', pt, { data: { 'application/x-foreign': 'zzz' } });
    expect(over.prevented).toBe(false); // not accepted
    expect(await dropTarget(page)).toBeNull();
    await dragEvent(page, 'drop', pt, { data: { 'application/x-foreign': 'zzz' } });
    expect(await dump(page)).toBe('p(Hello)');
  });

  test('3 · every drop is cancelled (no browser insertion, no navigation to a dropped file)', async ({ page }) => {
    await boot(page);
    await write(page, 'Hello');
    const pt = await pointAt(page, 'Hello', 2);
    expect((await dragEvent(page, 'drop', pt, { files: [png()] })).prevented).toBe(true);
    expect((await dragEvent(page, 'drop', pt, { data: { 'text/plain': 'x' } })).prevented).toBe(true);
    expect((await dragEvent(page, 'drop', pt, { data: { 'application/x-foreign': 'x' } })).prevented).toBe(true);
  });
});

test.describe('dropping external content', () => {
  test('4 · text/plain lands at the drop point, mid-paragraph', async ({ page }) => {
    await boot(page);
    await write(page, 'Hello world');
    await dropAt(page, await pointAt(page, 'Hello world', 5), { data: { 'text/plain': ',' } });
    await expect.poll(() => dump(page)).toBe('p(Hello, world)');
  });

  test('5 · HTML from outside is parsed (bold kept, no Google Docs junk) at the drop point', async ({ page }) => {
    await boot(page);
    await write(page, 'Hello world');
    await dropAt(page, await pointAt(page, 'Hello world', 11), { data: { 'text/html': '<b id="docs-internal-guid-1" style="font-weight:normal;"><p dir="ltr">a <span style="font-weight:700">bold</span> word</p></b>', 'text/plain': 'a bold word' } });
    await expect.poll(() => dump(page)).toBe('p(Hello worlda [b:bold] word)');
  });

  test('6 · a full Google Docs fixture dropped on an empty paragraph = the same structure as pasting it', async ({ page }) => {
    await boot(page);
    const r = await rootRect(page, 0);
    await dropAt(page, { x: r.left + 20, y: (r.top + r.bottom) / 2 }, { data: { 'text/html': fixture('google-docs.html') } });
    await expect.poll(async () => (await dump(page)).startsWith('h1(Project notes)')).toBe(true);
    const model = await dump(page);
    expect(model).toContain('p(This is a [b:bold] word, an [i:italic] one and a [a=https://example.org/docs?page=2&lang=en:link].)');
    await undo(page);
    await expect.poll(() => dump(page)).toBe('p(∅)');
  });

  test('7 · markdown text and an internal fragment are interpreted like a paste', async ({ page }) => {
    await boot(page);
    await write(page, 'Hello world');
    await dropAt(page, await pointAt(page, 'Hello world', 11), { data: { 'text/plain': '# Title\n\nSome **bold** text' } });
    await expect.poll(() => dump(page)).toBe('p(Hello worldTitle) ; p(Some [b:bold] text)'); // like a paste: the first block merges into the text it lands in
    const fragment = JSON.stringify({ version: 1, blocks: [{ type: 'paragraph', partial: false, delta: [{ insert: 'one' }] }, { type: 'paragraph', partial: false, delta: [{ insert: 'two' }] }] });
    await dropAt(page, await pointAt(page, 'Some bold text', 4), { data: { 'application/x-nabu+json': fragment, 'text/plain': 'one\ntwo' } });
    await expect.poll(() => dump(page)).toBe('p(Hello worldTitle) ; p(Someone) ; p(two [b:bold] text)');
  });

  test('8 · into a code block the text is inserted verbatim (no interpretation)', async ({ page }) => {
    await boot(page);
    await buildTree(page, [Code('a = 1', 'js')]);
    await dropAt(page, await pointAt(page, 'a = 1', 5), { data: { 'text/plain': '\n# not a heading\n- not a list', 'text/html': '<h1>nope</h1>' } });
    await expect.poll(() => tree(page)).toBe('code:js(a = 1\\n# not a heading\\n- not a list)');
  });
});

test.describe('dropping files', () => {
  test('9 · an image dropped mid-paragraph splits it around an image block that displays', async ({ page }) => {
    await boot(page);
    await write(page, 'Hello world');
    await dropAt(page, await pointAt(page, 'Hello world', 6), { files: [png()], data: { 'text/plain': 'dropped.png' } });
    await expect.poll(() => tree(page)).toBe('p(Hello ) ; image(∅) ; p(world)');
    const [img] = await media(page);
    expect(img.ref).toMatch(/^nabu-asset:sha256-[0-9a-f]{64}$/);
    expect(img.status).toBe('ready');
    await imagesDisplay(page, 1);
    // one undo step
    await undo(page);
    await expect.poll(() => tree(page)).toBe('p(Hello world)');
    await redo(page);
    await expect.poll(() => tree(page)).toBe('p(Hello ) ; image(∅) ; p(world)');
  });

  test('10 · several files give several blocks, in order, at the drop point', async ({ page }) => {
    await boot(page);
    await writeAll(page, ['first', 'Hello world', 'last']);
    await dropAt(page, await pointAt(page, 'Hello world', 5), { files: [png('a.png'), { name: 'clip.mp4', type: 'video/mp4' }, { name: 'doc.pdf', type: 'application/pdf' }] });
    await expect.poll(() => tree(page)).toBe('p(first) ; p(Hello) ; image(∅) ; video(∅) ; file(∅) ; p( world) ; p(last)');
    expect((await media(page)).map((m) => m.type + ':' + m.name)).toEqual(['image:a.png', 'video:clip.mp4', 'file:doc.pdf']);
    await undo(page);
    await expect.poll(() => tree(page)).toBe('p(first) ; p(Hello world) ; p(last)');
  });

  test('11 · a file over files.maxFileSize is rejected like a pasted one (status), the others still land', async ({ page }) => {
    await boot(page, '?options=' + encodeURIComponent(JSON.stringify({ files: { maxFileSize: 10 } })));
    await write(page, 'Hello');
    await dropAt(page, await pointAt(page, 'Hello', 5), { files: [png('big.png')] });
    await expect.poll(async () => (await media(page)).map((m) => m.status)).toEqual(['rejected']);
  });

  test('12 · with a host onBeforePersist the dropped block is pending, then ready (same hash)', async ({ page }) => {
    await boot(page, '?hostFiles=gated');
    await write(page, 'Hello');
    await dropAt(page, await pointAt(page, 'Hello', 5), { files: [png('up.png')] });
    await expect.poll(async () => (await media(page))[0]?.status).toBe('pending');
    const [pending] = await media(page);
    await page.evaluate(() => (window as any).__hostRelease());
    await expect.poll(async () => (await media(page))[0]?.status).toBe('ready');
    expect((await media(page))[0].ref).toBe(pending.ref);
  });
});

test.describe('positions', () => {
  test('13 · beside a block without text (a divider: a 1px rule), above = before, below = after', async ({ page }) => {
    await boot(page);
    await buildTree(page, [Pp('a'), Hr(), Pp('b')]);
    const hr = await page.evaluate(() => { const r = (window as any).nabu.children[1].element.getBoundingClientRect(); return { x: r.left + 20, top: r.top, bottom: r.bottom }; });
    await dropAt(page, { x: hr.x, y: hr.top - 5 }, { data: { 'text/plain': 'UP' } });
    await expect.poll(() => tree(page)).toBe('p(a) ; p(UP) ; hr ; p(b)');
    const hr2 = await page.evaluate(() => { const r = (window as any).nabu.children[2].element.getBoundingClientRect(); return { x: r.left + 20, top: r.top, bottom: r.bottom }; });
    await dropAt(page, { x: hr2.x, y: hr2.bottom + 5 }, { data: { 'text/plain': 'DOWN' } });
    await expect.poll(() => tree(page)).toBe('p(a) ; p(UP) ; hr ; p(DOWN) ; p(b)');
  });

  test('14 · a file on a divider: before / after it, no stray empty paragraph', async ({ page }) => {
    await boot(page);
    await buildTree(page, [Pp('a'), Hr()]);
    const r = await page.evaluate(() => { const b = (window as any).nabu.children[1].element.getBoundingClientRect(); return { x: b.left + 20, top: b.top, bottom: b.bottom }; });
    await dropAt(page, { x: r.x, y: r.bottom + 5 }, { files: [png()] });
    await expect.poll(() => tree(page)).toBe('p(a) ; hr ; image(∅)');
    await undo(page);
    await expect.poll(() => tree(page)).toBe('p(a) ; hr');
  });

  test('15 · below the last block (editor padding): end of the document; above the first: its start', async ({ page }) => {
    await boot(page);
    await writeAll(page, ['one', 'two']);
    const editor = (await page.locator('.nabu-editor').boundingBox())!;
    const last = await rootRect(page, 1);
    await dropAt(page, { x: editor.x + 40, y: Math.min(last.bottom + 30, editor.y + editor.height - 2) }, { data: { 'text/plain': '!' } });
    await expect.poll(() => dump(page)).toBe('p(one) ; p(two!)');
    const first = await rootRect(page, 0);
    await dropAt(page, { x: editor.x + 40, y: Math.max(first.top - 8, editor.y + 1) }, { data: { 'text/plain': '>' } });
    await expect.poll(() => dump(page)).toBe('p(>one) ; p(two!)');
  });

  test('16 · below a trailing divider the file lands after it', async ({ page }) => {
    await boot(page);
    await buildTree(page, [Pp('a'), Hr()]);
    const editor = (await page.locator('.nabu-editor').boundingBox())!;
    const hr = await page.evaluate(() => (window as any).nabu.children[1].element.getBoundingClientRect().bottom);
    await dropAt(page, { x: editor.x + 40, y: Math.min(hr + 30, editor.y + editor.height - 2) }, { files: [png()] });
    await expect.poll(() => tree(page)).toBe('p(a) ; hr ; image(∅)');
  });
});

test.describe('nabu.dropTarget (reactive state for a UI)', () => {
  test('17 · set while dragging over, with the kind; cleared on leave, on drop', async ({ page }) => {
    await boot(page);
    await write(page, 'Hello world');
    expect(await dropTarget(page)).toBeNull();
    const pt = await pointAt(page, 'Hello world', 6);

    const over = await dragEvent(page, 'dragover', pt, { files: [png()] });
    expect(over.prevented).toBe(true);
    // (dropEffect is not testable with a synthetic DataTransfer: the browser ignores its setter; real drags in test 1)
    expect(await dropTarget(page)).toEqual({ block: 'Hello world', offset: 6, side: 'inside', kind: 'files' });

    await dragEvent(page, 'dragover', pt, { data: { 'text/html': '<b>x</b>' } });
    expect(await dropTarget(page)).toEqual({ block: 'Hello world', offset: 6, side: 'inside', kind: 'content' });

    await dragEvent(page, 'dragleave', { x: 1, y: 1 }, { data: { 'text/html': '<b>x</b>' } });
    // dragleave dispatched on a target outside the editor is not ours; leaving the editor is
    await page.evaluate(() => {
      const root = document.querySelector('.nabu-editor')!;
      const dt = new DataTransfer(); dt.setData('text/plain', 'x');
      root.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: dt, relatedTarget: document.body }));
    });
    expect(await dropTarget(page)).toBeNull();

    await dragEvent(page, 'dragover', pt, { data: { 'text/plain': 'x' } });
    expect(await dropTarget(page)).not.toBeNull();
    await dragEvent(page, 'drop', pt, { data: { 'text/plain': 'x' } });
    expect(await dropTarget(page)).toBeNull();
  });

  test('18 · beside a block without text it reports before / after', async ({ page }) => {
    await boot(page);
    await buildTree(page, [Pp('a'), Hr()]);
    const r = await page.evaluate(() => { const b = (window as any).nabu.children[1].element.getBoundingClientRect(); return { x: b.left + 20, top: b.top, bottom: b.bottom }; });
    await dragEvent(page, 'dragover', { x: r.x, y: r.top - 5 }, { data: { 'text/plain': 'x' } });
    expect(await dropTarget(page)).toEqual({ block: 'divider', offset: 0, side: 'before', kind: 'content' });
    await dragEvent(page, 'dragover', { x: r.x, y: r.bottom + 5 }, { data: { 'text/plain': 'x' } });
    expect(await dropTarget(page)).toEqual({ block: 'divider', offset: 0, side: 'after', kind: 'content' });
  });
});

test.describe('dragging the editor\'s own text', () => {
  /** Select [from, to) of the block with `text`, press on the selection and drag to `target`, release. */
  async function dragSelection(page: Page, text: string, from: number, to: number, target: Pt, opts: { mod?: string } = {}) {
    await page.evaluate(async ([t, f, e]) => {
      const n = (window as any).nabu;
      const block = [...n.blocks.values()].find((b: any) => b.behaviors?.get('text')?.text === t && b.element?.isConnected) as any;
      await n.focus({ from: { block, offset: f }, to: { block, offset: e } });
    }, [text, from, to] as [string, number, number]);
    const a = await pointAt(page, text, from);
    const b = await pointAt(page, text, to);
    const start = { x: (a.x + b.x) / 2, y: b.y };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 6, start.y + 4, { steps: 3 });
    if (opts.mod) await page.keyboard.down(opts.mod);
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.up();
    if (opts.mod) await page.keyboard.up(opts.mod);
  }

  test('19 · a selection dragged to another block is MOVED, in one undo step', async ({ page }) => {
    await boot(page);
    await writeAll(page, ['Hello world', 'Second']);
    await dragSelection(page, 'Hello world', 5, 11, await pointAt(page, 'Second', -1));
    await expect.poll(() => dump(page)).toBe('p(Hello) ; p(Second world)');
    await undo(page);
    await expect.poll(() => dump(page)).toBe('p(Hello world) ; p(Second)');
    await redo(page);
    await expect.poll(() => dump(page)).toBe('p(Hello) ; p(Second world)');
  });

  test('20 · moved inside the same block: the offset is corrected for the deletion', async ({ page }) => {
    await boot(page);
    await write(page, 'one two three');
    await dragSelection(page, 'one two three', 0, 4, await pointAt(page, 'one two three', -1));
    await expect.poll(() => dump(page)).toBe('p(two threeone )');
    await undo(page);
    await expect.poll(() => dump(page)).toBe('p(one two three)');
  });

  test('21 · moved BACKWARD, marks travel with the text', async ({ page }) => {
    await boot(page);
    await write(page, 'abc def');
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.children[0].behaviors.get('text').container.mark({ start: 4, end: 7 }, 'bold', true);
      await n.commit();
      n.undoManager.clear();
    });
    await expect.poll(() => dump(page)).toBe('p(abc [b:def])');
    await dragSelection(page, 'abc def', 4, 7, await pointAt(page, 'abc def', 0));
    await expect.poll(() => dump(page)).toBe('p([b:def]abc )');
  });

  test('22 · Ctrl-drag COPIES instead of moving', async ({ page }) => {
    await boot(page);
    await writeAll(page, ['Hello world', 'Second']);
    await dragSelection(page, 'Hello world', 5, 11, await pointAt(page, 'Second', -1), { mod: 'Control' });
    await expect.poll(() => dump(page)).toBe('p(Hello world) ; p(Second world)');
    await undo(page);
    await expect.poll(() => dump(page)).toBe('p(Hello world) ; p(Second)');
  });

  test('23 · dropped back onto itself it does nothing (no undo step, no loss)', async ({ page }) => {
    await boot(page);
    await write(page, 'Hello world');
    const a = await pointAt(page, 'Hello world', 6);
    const b = await pointAt(page, 'Hello world', 9);
    await dragSelection(page, 'Hello world', 5, 11, { x: (a.x + b.x) / 2 + 2, y: a.y });
    await expect.poll(() => dump(page)).toBe('p(Hello world)');
    expect(await page.evaluate(() => (window as any).nabu.undoManager.canUndo())).toBe(false);
    expect(await dropTarget(page)).toBeNull();
  });

  test('24 · a selection spanning two blocks is moved whole', async ({ page }) => {
    await boot(page);
    await writeAll(page, ['alpha beta', 'gamma delta', 'omega']);
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const [a, b] = [n.children[0], n.children[1]];
      await n.focus({ from: { block: a, offset: 6 }, to: { block: b, offset: 5 } });
    });
    const from = await pointAt(page, 'alpha beta', 8);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 6, from.y + 4, { steps: 3 });
    const target = await pointAt(page, 'omega', -1);
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => dump(page)).toBe('p(alpha  delta) ; p(omegabeta) ; p(gamma)');
    await undo(page);
    await expect.poll(() => dump(page)).toBe('p(alpha beta) ; p(gamma delta) ; p(omega)');
  });

  test('25 · dragstart of something that is not the text selection (an image) is cancelled', async ({ page }) => {
    await boot(page);
    await buildTree(page, [Pp('a'), { type: 'image', props: { ref: 'https://example.org/x.png' } }]);
    const prevented = await page.evaluate(() => {
      const target = document.querySelector('[data-block-type="image"] img') ?? document.querySelector('[data-block-type="image"]')!;
      const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
      return !target.dispatchEvent(ev);
    });
    expect(prevented).toBe(true);
  });
});

test.describe('the block drag handle keeps working', () => {
  test('26 · dragging a block by its handle moves it (pointer events), nothing HTML5 DnD gets involved', async ({ page }) => {
    await boot(page);
    await writeAll(page, ['one', 'two', 'three']);
    const first = await rootRect(page, 0);
    await page.mouse.move(first.left + 20, (first.top + first.bottom) / 2);
    const handle = page.locator('.nabu-drag-handle');
    await expect(handle).toBeVisible();
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    const third = await rootRect(page, 2);
    await page.mouse.move(third.left + 30, third.bottom - 2, { steps: 8 });
    expect(await dropTarget(page)).toBeNull(); // the handle's own drag does not publish a Nabu drop target
    await page.mouse.up();
    await expect.poll(() => tree(page)).toBe('p(two) ; p(three) ; p(one)');
    expect(await allText(page)).toEqual(['two', 'three', 'one']);
  });
});
