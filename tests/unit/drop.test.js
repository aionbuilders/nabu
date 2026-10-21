// @ts-nocheck
/**
 * ADR 014 lot 4 — drag & drop: the pure helpers (routing, effects, geometry, range maths) and the engine entry points
 * (`dropAt`, `insertFragment({ at })`, the `dropTarget` lifecycle of the drag handlers). The pointer → position mapping
 * needs a layout engine and is covered end to end in tests/e2e/drag-drop.spec.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { ImageExtension } from '$lib/blocks/image/index.js';
import { VideoExtension } from '$lib/blocks/video/index.js';
import { FileExtension } from '$lib/blocks/file/index.js';
import { DividerExtension } from '$lib/blocks/divider/index.js';
import { CodeExtension } from '$lib/blocks/code/index.js';
import { NabuPasteExtension, PlainTextPasteExtension, HtmlPasteExtension } from '$lib/paste/index.js';
import {
  transferKind, pickDropEffect, pointerHalf, nearestRect, sameTarget, wantsCopy, compareBlocks, positionInRange, positionAfterRemoval,
  DRAG_MARKER, NABU_FORMAT,
} from '$lib/utils/drop.js';

vi.mock('$lib/utils/drop.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, resolveDropPosition: vi.fn() };
});
import { resolveDropPosition } from '$lib/utils/drop.js';

const EXTENSIONS = [ParagraphExtension, ImageExtension, VideoExtension, FileExtension, DividerExtension, CodeExtension, NabuPasteExtension, PlainTextPasteExtension, HtmlPasteExtension];
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const flush = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setTimeout(r, 0)); };

async function makeEditor(texts = [], extensions = EXTENSIONS) {
  const engine = new Nabu({ extensions });
  await engine.commit();
  texts.forEach((t, i) => {
    const block = i === 0 ? engine.children[0] : engine.insert('paragraph', {}, null, i);
    if (t) block.behaviors.get('text').insert(0, t);
  });
  await engine.commit();
  engine.undoManager.clear();
  return engine;
}
const shape = (engine) => engine.tree.roots().map((n) => {
  const type = n.data.get('type');
  const text = n.data.get('text')?.toString() ?? '';
  return type === 'paragraph' ? `p(${text})` : type === 'divider' ? 'hr' : type === 'code' ? `code(${text})` : type;
}).join(' ; ');

/** A DataTransfer-like payload. */
function transfer({ files = [], data = {} } = {}) {
  return {
    files,
    items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    types: [...Object.keys(data), ...(files.length ? ['Files'] : [])],
    effectAllowed: 'all',
    dropEffect: 'none',
    getData: (k) => data[k] ?? '',
  };
}
const inside = (block, offset) => ({ block, offset, side: 'inside' });

describe('transferKind — what a drag carries, from its types', () => {
  const ctx = { formats: ['application/x-nabu+json', 'text/html', 'text/plain'], files: true };
  it('files, content, nothing', () => {
    expect(transferKind(['Files'], ctx)).toBe('files');
    expect(transferKind(['text/plain'], ctx)).toBe('content');
    expect(transferKind(['text/uri-list', 'text/html'], ctx)).toBe('content');
    expect(transferKind(['application/x-foreign'], ctx)).toBeNull();
    expect(transferKind([], ctx)).toBeNull();
    expect(transferKind(null, ctx)).toBeNull();
  });
  it('an internal fragment is content even with files; files need a file handler', () => {
    expect(transferKind(['Files', 'application/x-nabu+json'], ctx)).toBe('content');
    expect(transferKind(['Files'], { ...ctx, files: false })).toBeNull();
    expect(transferKind(['Files', 'text/plain'], { ...ctx, files: false })).toBe('content');
  });
  it('only the formats an interpreter reads count', () => {
    expect(transferKind(['text/plain'], { formats: ['text/html'], files: true })).toBeNull();
  });
});

describe('effects and geometry', () => {
  it('pickDropEffect announces an effect the source allows', () => {
    expect(pickDropEffect('all', 'move')).toBe('move');
    expect(pickDropEffect('uninitialized', 'copy')).toBe('copy');
    expect(pickDropEffect('copyMove', 'move')).toBe('move');
    expect(pickDropEffect('copy', 'move')).toBe('copy');
    expect(pickDropEffect('move', 'copy')).toBe('move');
    expect(pickDropEffect('linkMove', 'copy')).toBe('move');
    expect(pickDropEffect('link', 'copy')).toBe('link');
  });
  it('wantsCopy: Ctrl (Windows / Linux) or Alt / Option (macOS)', () => {
    expect(wantsCopy({})).toBe(false);
    expect(wantsCopy({ ctrlKey: true })).toBe(true);
    expect(wantsCopy({ altKey: true })).toBe(true);
  });
  it('pointerHalf / nearestRect', () => {
    expect(pointerHalf(10, { top: 0, bottom: 40 })).toBe('before');
    expect(pointerHalf(30, { top: 0, bottom: 40 })).toBe('after');
    const rects = [{ top: 0, bottom: 100 }, { top: 10, bottom: 30 }, { top: 120, bottom: 140 }];
    expect(nearestRect(rects, 20)).toBe(1); // the deepest (smallest) box containing the point
    expect(nearestRect(rects, 60)).toBe(0);
    expect(nearestRect(rects, 110)).toBe(2); // 10 from the 3rd, 10 from the 1st: the smallest wins the tie
    expect(nearestRect(rects, 500)).toBe(2); // below everything: the nearest edge
    expect(nearestRect(rects, -50)).toBe(0);
    expect(nearestRect([], 5)).toBe(-1);
  });
  it('sameTarget', () => {
    const b = {};
    const t = { block: b, offset: 1, side: 'inside', kind: 'move' };
    expect(sameTarget(t, { ...t })).toBe(true);
    expect(sameTarget(t, { ...t, kind: 'content' })).toBe(false);
    expect(sameTarget(t, null)).toBe(false);
    expect(sameTarget(null, null)).toBe(true);
  });
});

describe('range maths', () => {
  const el = (parent) => { const e = document.createElement('div'); (parent ?? document.body).appendChild(e); return e; };
  const blockOf = (e) => ({ element: e });
  const root = el();
  const a = blockOf(el(root)), b = blockOf(el(root)), c = blockOf(el(root));
  const child = blockOf(el(b.element)); // a child block of b: after b's own text

  it('compareBlocks: pre-order, a block before its children', () => {
    expect(compareBlocks(a.element, b.element)).toBe(-1);
    expect(compareBlocks(c.element, a.element)).toBe(1);
    expect(compareBlocks(b.element, child.element)).toBe(-1);
    expect(compareBlocks(child.element, b.element)).toBe(1);
    expect(compareBlocks(child.element, c.element)).toBe(-1);
    expect(compareBlocks(a.element, a.element)).toBe(0);
  });

  it('positionInRange: the ends are in (dropping at the edge of the selection changes nothing)', () => {
    const one = { startBlock: a, startOffset: 2, endBlock: a, endOffset: 5 };
    expect(positionInRange(one, inside(a, 1))).toBe(false);
    expect(positionInRange(one, inside(a, 2))).toBe(true);
    expect(positionInRange(one, inside(a, 4))).toBe(true);
    expect(positionInRange(one, inside(a, 5))).toBe(true);
    expect(positionInRange(one, inside(a, 6))).toBe(false);
    expect(positionInRange(one, inside(b, 0))).toBe(false);

    const many = { startBlock: a, startOffset: 2, endBlock: c, endOffset: 3 };
    expect(positionInRange(many, inside(a, 1))).toBe(false);
    expect(positionInRange(many, inside(a, 9))).toBe(true);
    expect(positionInRange(many, inside(b, 0))).toBe(true); // a whole block between
    expect(positionInRange(many, inside(child, 0))).toBe(true);
    expect(positionInRange(many, inside(c, 3))).toBe(true);
    expect(positionInRange(many, inside(c, 4))).toBe(false);
    expect(positionInRange(many, { block: b, offset: 0, side: 'after' })).toBe(true); // beside a block inside it
    expect(positionInRange({ ...many, endBlock: b, endOffset: 1 }, { block: c, offset: 0, side: 'before' })).toBe(false);
  });

  it('positionAfterRemoval: shifts by what was removed before the position', () => {
    const one = { startBlock: a, startOffset: 2, endBlock: a, endOffset: 5 };
    expect(positionAfterRemoval(one, inside(a, 9), false)).toEqual(inside(a, 6));
    expect(positionAfterRemoval(one, inside(a, 1), false)).toEqual(inside(a, 1));
    expect(positionAfterRemoval(one, inside(b, 4), false)).toEqual(inside(b, 4));
    const many = { startBlock: a, startOffset: 2, endBlock: b, endOffset: 3 };
    expect(positionAfterRemoval(many, inside(b, 7), true)).toEqual(inside(a, 6)); // b merged into a: 2 + (7 - 3)
    expect(positionAfterRemoval(many, inside(b, 7), false)).toEqual(inside(b, 4)); // b kept its tail
    expect(positionAfterRemoval(many, inside(c, 7), true)).toEqual(inside(c, 7));
    const beside = { block: c, offset: 0, side: 'after' };
    expect(positionAfterRemoval(many, beside, true)).toBe(beside);
  });
});

describe('insertFragment({ at }) and dropAt — the paste pipeline at a drop position', () => {
  it('text / plain text mid-paragraph, without touching the DOM selection', async () => {
    const engine = await makeEditor(['Hello world']);
    engine.dropAt(transfer({ data: { 'text/plain': ',' } }), inside(engine.children[0], 5));
    await flush();
    expect(shape(engine)).toBe('p(Hello, world)');
    engine.undo();
    await flush();
    expect(shape(engine)).toBe('p(Hello world)');
  });

  it('HTML goes through the HTML engine (bold kept)', async () => {
    const engine = await makeEditor(['ab']);
    engine.dropAt(transfer({ data: { 'text/html': '<p>x<b>y</b></p>' } }), inside(engine.children[0], 1));
    await flush();
    expect(engine.children[0].behaviors.get('text').delta).toEqual([{ insert: 'ax' }, { insert: 'y', attributes: { bold: true } }, { insert: 'b' }]);
  });

  it('files: media blocks in order at the drop point, ONE undo step', async () => {
    const engine = await makeEditor(['first', 'Hello world']);
    const png = (name) => new File([PNG], name, { type: 'image/png' });
    engine.dropAt(transfer({ files: [png('1.png'), png('2.png')] }), inside(engine.children[1], 6));
    await flush();
    expect(shape(engine)).toBe('p(first) ; p(Hello ) ; image ; image ; p(world)');
    engine.undo();
    await flush();
    expect(shape(engine)).toBe('p(first) ; p(Hello world)');
  });

  it('beside a block without text: before / after, through an empty text block (no stray block left)', async () => {
    const engine = await makeEditor(['a']);
    engine.insert('divider', {}, null, 1);
    await engine.commit();
    engine.undoManager.clear();
    const hr = engine.children[1];
    engine.dropAt(transfer({ data: { 'text/plain': 'UP' } }), { block: hr, offset: 0, side: 'before' });
    await flush();
    expect(shape(engine)).toBe('p(a) ; p(UP) ; hr');
    engine.dropAt(transfer({ files: [new File([PNG], 'x.png', { type: 'image/png' })] }), { block: hr, offset: 0, side: 'after' });
    await flush();
    expect(shape(engine)).toBe('p(a) ; p(UP) ; hr ; image');
    engine.undo();
    await flush();
    expect(shape(engine)).toBe('p(a) ; p(UP) ; hr');
  });

  it('a position beside a block that is gone, or an unreadable payload, does nothing', async () => {
    const engine = await makeEditor(['a']);
    engine.dropAt(transfer({ data: { 'application/x-foreign': 'zzz' } }), inside(engine.children[0], 1));
    await flush();
    expect(shape(engine)).toBe('p(a)');
    expect(engine.undoManager.canUndo()).toBe(false);
  });

  it('into a code block: verbatim plain text at the offset', async () => {
    const engine = new Nabu({ extensions: EXTENSIONS });
    await engine.commit();
    engine.insert('code', { text: 'a = 1' }, null, 0);
    await engine.commit();
    const code = engine.children.find((b) => b.type === 'code');
    engine.dropAt(transfer({ data: { 'text/plain': '# x\n- y', 'text/html': '<h1>no</h1>' } }), inside(code, 5));
    await flush();
    expect(code.behaviors.get('text').text).toBe('a = 1# x\n- y');
  });

  it('a MOVE deletes the source and inserts at the corrected position, in ONE undo step', async () => {
    const engine = await makeEditor(['Hello world', 'Second']);
    const [p1, p2] = engine.children;
    const range = { startBlock: p1, startOffset: 5, endBlock: p1, endOffset: 11 };
    const fragment = JSON.stringify({ version: 1, blocks: [{ type: 'paragraph', partial: 'both', delta: [{ insert: ' world' }] }] });
    engine.dropAt(transfer({ data: { [NABU_FORMAT]: fragment, 'text/plain': ' world' } }), inside(p2, 6), { source: { range } });
    await flush();
    expect(shape(engine)).toBe('p(Hello) ; p(Second world)');
    engine.undo();
    await flush();
    expect(shape(engine)).toBe('p(Hello world) ; p(Second)');
  });

  it('a move inside the same block corrects the offset; onto the source itself it is a no-op', async () => {
    const engine = await makeEditor(['one two three']);
    const [p] = engine.children;
    const fragment = JSON.stringify({ version: 1, blocks: [{ type: 'paragraph', partial: 'both', delta: [{ insert: 'one ' }] }] });
    const payload = transfer({ data: { [NABU_FORMAT]: fragment } });
    const range = { startBlock: p, startOffset: 0, endBlock: p, endOffset: 4 };
    engine.dropAt(payload, inside(p, 2), { source: { range } });
    await flush();
    expect(shape(engine)).toBe('p(one two three)');
    expect(engine.undoManager.canUndo()).toBe(false);
    engine.dropAt(payload, inside(p, 13), { source: { range } });
    await flush();
    expect(shape(engine)).toBe('p(two threeone )');
  });

  it('a move whose payload cannot be read loses nothing', async () => {
    const engine = await makeEditor(['Hello world', 'Second']);
    const [p1, p2] = engine.children;
    engine.dropAt(transfer({ data: {} }), inside(p2, 6), { source: { range: { startBlock: p1, startOffset: 5, endBlock: p1, endOffset: 11 } } });
    await flush();
    expect(shape(engine)).toBe('p(Hello world) ; p(Second)');
  });
});

describe('drag handlers — nabu.dropTarget lifecycle', () => {
  const rootEl = () => { const e = document.createElement('div'); e.setAttribute('data-nabu-root', 'true'); document.body.appendChild(e); return e; };
  const event = (root, dt, extra = {}) => ({ currentTarget: root, target: root, relatedTarget: null, clientX: 5, clientY: 5, dataTransfer: dt, preventDefault: vi.fn(), ...extra });

  it('set on dragover (files / content), cleared on leave and on drop; not offered for unknown types', async () => {
    const engine = await makeEditor(['Hello']);
    const root = rootEl();
    resolveDropPosition.mockReturnValue(inside(engine.children[0], 2));

    const files = event(root, transfer({ files: [new File([PNG], 'x.png', { type: 'image/png' })] }));
    engine.handleDragOver(files);
    expect(files.preventDefault).toHaveBeenCalled();
    expect(engine.dropTarget).toMatchObject({ offset: 2, side: 'inside', kind: 'files' });
    expect(files.dataTransfer.dropEffect).toBe('copy');

    engine.handleDragOver(event(root, transfer({ data: { 'text/html': '<b>x</b>' } })));
    expect(engine.dropTarget.kind).toBe('content');

    engine.handleDragLeave(event(root, transfer(), { relatedTarget: document.body }));
    expect(engine.dropTarget).toBeNull();

    const foreign = event(root, transfer({ data: { 'application/x-foreign': '1' } }));
    engine.handleDragOver(foreign);
    expect(foreign.preventDefault).not.toHaveBeenCalled();
    expect(engine.dropTarget).toBeNull();

    engine.handleDragOver(event(root, transfer({ data: { 'text/plain': 'x' } })));
    expect(engine.dropTarget).not.toBeNull();
    const drop = event(root, transfer({ data: { 'text/plain': 'X' } }));
    engine.handleDrop(drop);
    expect(drop.preventDefault).toHaveBeenCalled(); // the browser's own insertion never happens
    expect(engine.dropTarget).toBeNull();
    await flush();
    expect(shape(engine)).toBe('p(HeXllo)');
  });

  it('events from a UI island, a form control or a nested editor are not ours', async () => {
    const engine = await makeEditor(['Hello']);
    const root = rootEl();
    const input = document.createElement('input');
    root.appendChild(input);
    const e = event(root, transfer({ data: { 'text/plain': 'X' } }), { target: input });
    engine.handleDrop(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    await flush();
    expect(shape(engine)).toBe('p(Hello)');
  });

  it('dragstart of a non-selection drag is cancelled', async () => {
    const engine = await makeEditor(['Hello']);
    const root = rootEl();
    const img = document.createElement('img');
    root.appendChild(img);
    const e = event(root, transfer(), { target: img });
    engine.handleDragStart(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(Array.from(e.dataTransfer.types)).not.toContain(DRAG_MARKER);
  });
});
