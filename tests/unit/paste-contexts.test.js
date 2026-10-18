// @ts-nocheck
/**
 * Unit tests for P-50 / P-52 — paste in context:
 *  - pasting INTO a toggle: the body keeps what is pasted; the header takes the first block and sends the others to the top of the body;
 *  - multi-block paste in the middle of a text-only block (heading, quote, dialogue, callout): the text after the caret continues in
 *    a block of the ORIGINAL type;
 *  - `application/x-nabu+json` format versioning;
 *  - unknown block types are degraded to the default text block (text kept, children kept), never dropped.
 * Real Nabu with a stubbed selection (there is no DOM selection in unit tests).
 */
import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { HeadingExtension } from '$lib/blocks/heading/index.js';
import { BlockquoteExtension } from '$lib/blocks/blockquote/index.js';
import { DialogueExtension } from '$lib/blocks/dialogue/index.js';
import { CalloutExtension } from '$lib/blocks/callout/index.js';
import { CodeExtension } from '$lib/blocks/code/index.js';
import { DividerExtension } from '$lib/blocks/divider/index.js';
import { ToggleExtension } from '$lib/blocks/toggle/index.js';
import { ListExtension, ListItemExtension } from '$lib/blocks/list/index.js';
import { RichTextExtension } from '$lib/behaviors/text/index.js';
import { NabuPasteExtension, PlainTextPasteExtension, HtmlPasteExtension } from '$lib/paste/index.js';
import { MinimalPreset } from '$lib/presets.js';
import { degradeUnknownBlocks } from '$lib/utils/extensions.js';
import { BlockExtension } from '$lib/blocks/block.extension.js';

const EXTENSIONS = [ParagraphExtension, HeadingExtension, BlockquoteExtension, DialogueExtension, CalloutExtension, CodeExtension, DividerExtension, ToggleExtension, ListExtension, ListItemExtension, RichTextExtension, NabuPasteExtension, PlainTextPasteExtension, HtmlPasteExtension, BlockExtension];

const outline = (node) => {
  const type = node.data.get('type');
  const kids = node.children() ?? [];
  const text = node.data.get('text')?.toString() ?? '';
  if (type === 'list') {
    const lt = node.data.get('listType');
    return `${lt === 'ordered' ? 'ol' : lt === 'todo' ? 'todo' : 'ul'}[${kids.map(outline).join(', ')}]`;
  }
  if (type === 'list-item') return text + (kids.length ? ` > ${kids.map(outline).join(' ')}` : '');
  const body = kids.length ? `{${kids.map(outline).join(' ')}}` : '';
  if (type === 'toggle') return `toggle${node.data.get('collapsed') ? '▸' : '▾'}(${text})${body}`;
  const short = type === 'paragraph' ? 'p' : type === 'heading' ? `h${node.data.get('level') ?? 1}` : type;
  return `${short}(${text})${body}`;
};
const doc = (engine) => engine.tree.roots().map(outline).join(' ; ');

/** Build a document from nested specs `{ type, text, props, children }`. */
async function setup(specs, caretText, offset, opts = {}) {
  const engine = new Nabu({ extensions: opts.extensions ?? EXTENSIONS });
  await engine.commit();
  for (const c of [...engine.children]) engine.delete(c);
  const add = (spec, parentId, index) => {
    const b = engine.insert(spec.type, { text: spec.text ?? '', ...(spec.props ?? {}) }, parentId, index);
    (spec.children ?? []).forEach((c, i) => add(c, b.id, i));
  };
  specs.forEach((s, i) => add(s, null, i));
  await engine.commit();
  engine.undoManager.clear();
  const all = [];
  const walk = (bs) => bs.forEach((b) => { all.push(b); walk(b.children ?? []); });
  walk(engine.children);
  const block = all.find((b) => b.behaviors.get('text')?.text === caretText);
  Object.defineProperty(block, 'selection', { value: { from: offset, to: offset }, configurable: true });
  engine.selection = { anchorBlock: block, focusBlock: block, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
  return { engine, block };
}
const P = (text, children) => ({ type: 'paragraph', text, children });
const H = (text, level = 1) => ({ type: 'heading', text, props: { level } });
const Q = (text) => ({ type: 'blockquote', text });
const D = (text) => ({ type: 'dialogue', text });
const C = (text) => ({ type: 'callout', text });
const T = (text, children = [], collapsed = false) => ({ type: 'toggle', text, children, props: { collapsed } });

const para = (text, partial = false) => ({ type: 'paragraph', partial, delta: [{ insert: text }] });
const head = (text, level = 1) => ({ type: 'heading', partial: false, props: { level }, delta: [{ insert: text }] });
const code = (text) => ({ type: 'code', partial: false, props: {}, delta: [{ insert: text }] });
const li = (text) => ({ type: 'list-item', partial: false, delta: [{ insert: text }] });
const ul = (...items) => ({ type: 'list', partial: false, props: { listType: 'bullet' }, children: items.map(li) });
const tog = (text, children = [], collapsed = false) => ({ type: 'toggle', partial: false, props: { collapsed }, delta: [{ insert: text }], ...(children.length ? { children } : {}) });

async function paste(engine, blocks) {
  engine.insertFragment({ blocks });
  await tick();
  await engine.commit();
}


// ═══ 1 · Pasting into a toggle body ═══════════════════════════════════════════════════════════════════════════════

describe('P-50 · caret in the BODY of a toggle: everything lands inside', () => {
  it('paragraph, list, heading, code land inside the body at the caret; the caret block head/tail merge as usual', async () => {
    const { engine } = await setup([T('Tg', [P('b1'), P('b2')])], 'b1', 1);
    await paste(engine, [para('x1', 'start'), ul('a', 'b'), head('H'), code('cc'), para('z9', 'end')]);
    expect(doc(engine)).toBe('toggle▾(Tg){p(bx1) ul[a, b] h1(H) code(cc) p(z91) p(b2)}');
  });

  it('the text after the caret stays in the body, in a paragraph, when the last block is not text', async () => {
    const { engine } = await setup([T('Tg', [P('b1')])], 'b1', 1);
    await paste(engine, [para('x1'), code('cc')]);
    expect(doc(engine)).toBe('toggle▾(Tg){p(bx1) code(cc) p(1)}');
  });

  it('a toggle pasted into the body is a NESTED toggle (with its body)', async () => {
    const { engine } = await setup([T('Tg', [P('b1')])], 'b1', 2);
    await paste(engine, [para('x'), tog('Inner', [para('i1'), para('i2')])]);
    expect(doc(engine)).toBe('toggle▾(Tg){p(b1x) toggle▾(Inner){p(i1) p(i2)}}');
  });

  it('a childless toggle alone, into an EMPTY body paragraph, replaces it (the body adopts the pasted type)', async () => {
    const { engine } = await setup([T('Tg', [P('')])], '', 0);
    // the caret block is the empty paragraph of the body (the header has text)
    await paste(engine, [tog('Solo')]);
    expect(doc(engine)).toBe('toggle▾(Tg){toggle▾(Solo)}');
  });

  it('a list item in the body keeps the list rules: a heading splits the list, inside the body', async () => {
    const { engine } = await setup([T('Tg', [{ type: 'list', props: { listType: 'bullet' }, children: [{ type: 'list-item', text: 'ab' }, { type: 'list-item', text: 'cd' }] }])], 'ab', 1);
    await paste(engine, [head('H'), para('p', 'end')]);
    expect(doc(engine)).toBe('toggle▾(Tg){ul[a] h1(H) p(p) ul[b, cd]}');
  });
});

// ═══ 2 · Pasting into the header ══════════════════════════════════════════════════════════════════════════════════

describe('P-50 · caret in the HEADER of a toggle', () => {
  it('one text block: inline merge into the header (unchanged)', async () => {
    const { engine } = await setup([T('Hdr', [P('b1')])], 'Hdr', 2);
    await paste(engine, [para('x1')]);
    expect(doc(engine)).toBe('toggle▾(Hdx1r){p(b1)}');
  });

  it('several blocks: the first completes the header, the others go to the TOP of the body, the tail follows the last (merged into it when text)', async () => {
    const { engine } = await setup([T('Hdr', [P('b1')])], 'Hdr', 2);
    await paste(engine, [para('x1', 'start'), para('x2'), para('x3', 'end')]);
    expect(doc(engine)).toBe('toggle▾(Hdx1){p(x2) p(x3r) p(b1)}');
  });

  it('the tail becomes its own paragraph when the last block is not text', async () => {
    const { engine } = await setup([T('Hdr', [P('b1')])], 'Hdr', 2);
    await paste(engine, [para('x1'), ul('a', 'b')]);
    expect(doc(engine)).toBe('toggle▾(Hdx1){ul[a, b] p(r) p(b1)}');
  });

  it('at the END of the header there is no tail: nothing is created for it', async () => {
    const { engine } = await setup([T('Hdr', [P('b1')])], 'Hdr', 3);
    await paste(engine, [para('x1'), head('H')]);
    expect(doc(engine)).toBe('toggle▾(Hdrx1){h1(H) p(b1)}');
  });

  it('a first block that is not text (a list) leaves the header alone; the list opens the body', async () => {
    const { engine } = await setup([T('Hdr', [P('b1')])], 'Hdr', 3);
    await paste(engine, [ul('a'), para('z')]);
    expect(doc(engine)).toBe('toggle▾(Hdr){ul[a] p(z) p(b1)}');
  });

  it('a COLLAPSED toggle is expanded (the pasted content would land hidden)', async () => {
    const { engine } = await setup([T('Hdr', [P('b1')], true)], 'Hdr', 2);
    await paste(engine, [para('x1'), para('x2')]);
    expect(doc(engine)).toBe('toggle▾(Hdx1){p(x2r) p(b1)}');
  });

  it('a single text block into a COLLAPSED header stays collapsed (inline merge)', async () => {
    const { engine } = await setup([T('Hdr', [P('b1')], true)], 'Hdr', 2);
    await paste(engine, [para('x1')]);
    expect(doc(engine)).toBe('toggle▸(Hdx1r){p(b1)}');
  });

  it('the caret ends at the junction with the tail', async () => {
    const { engine } = await setup([T('Hdr', [P('b1')])], 'Hdr', 2);
    await paste(engine, [para('x1'), para('x2')]);
    const [call] = engine.selection.setCursor.mock.calls.slice(-1);
    expect(call[0].behaviors.get('text').text).toBe('x2r');
    expect(call[1]).toBe(2);
  });

  it('one undo step restores header, body and collapsed state', async () => {
    const { engine } = await setup([T('Hdr', [P('b1')], true)], 'Hdr', 2);
    await paste(engine, [para('x1'), para('x2')]);
    expect(doc(engine)).toBe('toggle▾(Hdx1){p(x2r) p(b1)}');
    engine.undoManager.undo();
    await tick(); await engine.commit();
    expect(doc(engine)).toBe('toggle▸(Hdr){p(b1)}');
    expect(engine.undoManager.canUndo()).toBe(false);
  });
});

// ═══ 3 · Text-only blocks ═════════════════════════════════════════════════════════════════════════════════════════

describe('P-50 · multi-block paste in the middle of a text-only block', () => {
  const KINDS = [
    ['heading', H('Title', 2), (t) => `h2(${t})`],
    ['blockquote', Q('Title'), (t) => `blockquote(${t})`],
    ['dialogue', D('Title'), (t) => `dialogue(${t})`],
    ['callout', C('Title'), (t) => `callout(${t})`],
  ];
  for (const [name, anchor, fmt] of KINDS) {
    it(`${name}: head stays (first block merged), pasted blocks follow, the tail continues in a ${name} (last text merges into it)`, async () => {
      const { engine } = await setup([anchor], 'Title', 2);
      await paste(engine, [para('p1', 'start'), para('p2'), para('p3', 'end')]);
      expect(doc(engine)).toBe(`${fmt('Tip1')} ; p(p2) ; ${fmt('p3tle')}`);
    });

    it(`${name}: a non-text last block is kept as it is, the tail follows in a ${name}`, async () => {
      const { engine } = await setup([anchor], 'Title', 2);
      await paste(engine, [para('p1'), head('H', 3)]);
      expect(doc(engine)).toBe(`${fmt('Tip1')} ; h3(H) ; ${fmt('tle')}`);
    });
  }

  it('at the END of the text there is no tail: the last pasted block keeps its own type', async () => {
    const { engine } = await setup([H('Title', 2)], 'Title', 5);
    await paste(engine, [para('p1'), para('p2')]);
    expect(doc(engine)).toBe('h2(Titlep1) ; p(p2)');
  });

  it('a pasted container: the tail goes in a block of the original type after it', async () => {
    const { engine } = await setup([Q('Title')], 'Title', 2);
    await paste(engine, [ul('a', 'b')]);
    expect(doc(engine)).toBe('blockquote(Ti) ; ul[a, b] ; blockquote(tle)');
  });

  it('a paragraph keeps its kind as well (unchanged)', async () => {
    const { engine } = await setup([P('Title')], 'Title', 2);
    await paste(engine, [para('p1'), para('p2')]);
    expect(doc(engine)).toBe('p(Tip1) ; p(p2tle)');
  });
});

// ═══ 4 · Format versioning ════════════════════════════════════════════════════════════════════════════════════════

describe('P-52 · application/x-nabu+json versioning', () => {
  const raw = (extra) => JSON.stringify({ ...extra, blocks: [para('a'), para('b')] });
  const nabuInterpreter = () => NabuPasteExtension.pasteInterpreters[0];

  it('copy writes `version: 1`', async () => {
    const engine = new Nabu({ extensions: EXTENSIONS });
    await engine.commit();
    engine.insert('paragraph', { text: 'abc' }, null, 0);
    await engine.commit();
    const block = engine.children.find((b) => b.text === 'abc');
    engine.selection = { sync: vi.fn(), isCollapsed: false, startBlock: block, endBlock: block, start: { from: 0 }, end: { to: 3 }, setCursor: vi.fn(), anchorBlock: block, focusBlock: block };
    const data = {};
    engine.handleCopy({ preventDefault: vi.fn(), clipboardData: { setData: (k, v) => { data[k] = v; } } });
    expect(JSON.parse(data['application/x-nabu+json']).version).toBe(1);
  });

  it('accepts version 1, a version-less fragment and "1"', () => {
    for (const extra of [{ version: 1 }, {}, { version: '1' }]) {
      expect(nabuInterpreter().interpret(raw(extra), { warn: vi.fn() }).blocks).toHaveLength(2);
    }
  });

  it('an unknown version declines (null) and warns; garbage versions too', () => {
    for (const version of [99, 2, '2', 0, 'x', true, {}]) {
      const nabu = { warn: vi.fn() };
      expect(nabuInterpreter().interpret(raw({ version }), nabu)).toBeNull();
      expect(nabu.warn).toHaveBeenCalledTimes(1);
    }
  });

  it('a version-less and a version-1 fragment paste the same; a version 99 one falls back to text/html', async () => {
    const results = [];
    for (const extra of [{}, { version: 1 }]) {
      const { engine } = await setup([P('xy')], 'xy', 1);
      engine.handlePaste({ preventDefault: vi.fn(), clipboardData: { getData: (f) => f === 'application/x-nabu+json' ? raw(extra) : '' } });
      await tick(); await engine.commit();
      results.push(doc(engine));
    }
    expect(results[0]).toBe('p(xa) ; p(by)');
    expect(results[1]).toBe(results[0]);

    const { engine } = await setup([P('xy')], 'xy', 1);
    engine.handlePaste({
      preventDefault: vi.fn(),
      clipboardData: { getData: (f) => f === 'application/x-nabu+json' ? raw({ version: 99 }) : f === 'text/html' ? '<p>H1</p><p>H2</p>' : f === 'text/plain' ? 'plain' : '' },
    });
    await tick(); await engine.commit();
    expect(doc(engine)).toBe('p(xH1) ; p(H2y)');
  });
});

// ═══ 5 · Unknown block types ══════════════════════════════════════════════════════════════════════════════════════

describe('P-52 · unknown block types are degraded, never dropped', () => {
  const zzz = (text, children, partial = false) => ({ type: 'zzz', partial, props: { weird: 1 }, delta: [{ insert: text }], ...(children ? { children } : {}) });

  it('degradeUnknownBlocks: text kept, children follow as siblings, recursive, known containers recursed into', () => {
    const known = (t) => ['paragraph', 'toggle'].includes(t);
    const out = degradeUnknownBlocks(
      [zzz('a', [zzz('b', [para('c')]), para('d')]), tog('T', [zzz('e', [para('f')])]), zzz('g', undefined, 'start')],
      known, 'paragraph',
    );
    expect(out.map((b) => `${b.type}:${(b.delta ?? []).map((o) => o.insert).join('')}${b.children ? `[${b.children.map((c) => `${c.type}:${c.delta?.[0]?.insert}`).join(',')}]` : ''}`))
      .toEqual(['paragraph:a', 'paragraph:b', 'paragraph:c', 'paragraph:d', 'toggle:T[paragraph:e,paragraph:f]', 'paragraph:g']);
    expect(out[0].props).toBeUndefined();
    expect(out[5].partial).toBe('start');
    // no fallback type: untouched
    const same = [zzz('a')];
    expect(degradeUnknownBlocks(same, () => false, null)).toBe(same);
  });

  it('paste (default path): an unknown container with children becomes a paragraph followed by its children', async () => {
    const { engine } = await setup([P('xy')], 'xy', 2);
    await paste(engine, [para('a'), zzz('Z', [para('c1'), zzz('c2', [para('c3')])])]);
    expect(doc(engine)).toBe('p(xya) ; p(Z) ; p(c1) ; p(c2) ; p(c3)');
  });

  it('paste as the ONLY block: an unknown leaf keeps its text (inline), an unknown container keeps text + children', async () => {
    const { engine } = await setup([P('xy')], 'xy', 1);
    await paste(engine, [zzz('Z', [para('c1')])]);
    expect(doc(engine)).toBe('p(xZ) ; p(c1y)');
  });

  it('paste into a toggle body: the unknown block and its children stay inside the body', async () => {
    const { engine } = await setup([T('Tg', [P('b1')])], 'b1', 2);
    await paste(engine, [para('a'), zzz('Z', [para('c1')])]);
    expect(doc(engine)).toBe('toggle▾(Tg){p(b1a) p(Z) p(c1)}');
  });

  it('a known container with an unknown child: the child is degraded in place', async () => {
    const { engine } = await setup([P('')], '', 0);
    await paste(engine, [para('a'), tog('T', [zzz('Z', [para('c1')])])]);
    expect(doc(engine)).toBe('p(a) ; toggle▾(T){p(Z) p(c1)}');
  });

  it('a minimal editor (paragraph only) receives a FullPreset fragment: every block is kept as a paragraph', async () => {
    const { engine } = await setup([P('')], '', 0, { extensions: MinimalPreset });
    await paste(engine, [head('Title'), tog('T', [para('t1'), ul('a', 'b')]), code('cc'), { type: 'divider', partial: false }]);
    const roots = engine.tree.roots();
    const texts = [];
    const walk = (n) => { texts.push(n.data.get('text')?.toString() ?? ''); (n.children() ?? []).forEach(walk); };
    roots.forEach(walk);
    expect(texts.filter(Boolean)).toEqual(['Title', 'T', 't1', 'a', 'b', 'cc']);
    const types = new Set();
    const kinds = (n) => { types.add(n.data.get('type')); (n.children() ?? []).forEach(kinds); };
    roots.forEach(kinds);
    expect([...types]).toEqual(['paragraph']);
  });

  it('importFragment / importJSON: unknown root blocks and their children are kept too', async () => {
    const { engine } = await setup([P('old')], 'old', 0, { extensions: MinimalPreset });
    await engine.importFragment({ blocks: [zzz('Z', [para('c1')]), para('after')] });
    expect(doc(engine)).toBe('p(Z) ; p(c1) ; p(after)');
    await engine.importJSON({ blocks: [{ type: 'zzz', content: [{ text: 'J' }], children: [{ type: 'paragraph', content: [{ text: 'k' }] }] }] });
    expect(doc(engine)).toBe('p(J) ; p(k)');
  });
});
