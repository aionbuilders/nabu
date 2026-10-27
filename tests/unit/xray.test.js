/**
 * The X-ray's data (src/site/xray.js): the tree view and the operation descriptions, read from a bare Loro document shaped like
 * Nabu's (a `blocks` tree whose nodes carry `type`, `text`, `regionType`…). Public Loro API only.
 */
import { describe, it, expect } from 'vitest';
import { LoroDoc, LoroText } from 'loro-crdt';
import { buildModel, describeBatch, treeLookup, markRanges, formatTiming, clip, MAX_LINES } from '../../src/site/xray.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

/** @param {LoroDoc} doc @param {string} type @param {string | null} text @param {any} [parent] */
function block(doc, type, text, parent) {
  const tree = doc.getTree('blocks');
  const node = parent ? parent.createNode() : tree.createNode();
  node.data.set('type', type);
  if (text !== null) node.data.setContainer('text', new LoroText()).insert(0, text);
  return node;
}

function sample() {
  const doc = new LoroDoc();
  doc.configTextStyle({ bold: { expand: 'after' }, italic: { expand: 'after' }, link: { expand: 'none' } });
  const p = block(doc, 'paragraph', 'Start typing — this is Nabu.');
  p.data.get('text').mark({ start: 0, end: 12 }, 'bold', true);
  block(doc, 'paragraph', 'Press / for blocks, ::: for a region, and ⌘Z to rewind.');
  const region = block(doc, 'region', 'The bank');
  region.data.set('regionType', 'section-2');
  const list = block(doc, 'list', null, region);
  list.data.set('listType', 'bullet');
  block(doc, 'list-item', 'First', list);
  doc.commit();
  return { doc, p, region };
}

describe('buildModel', () => {
  it('one line per block in document order, nested blocks indented, marks under their block', () => {
    const { doc } = sample();
    const lines = buildModel(doc);
    expect(lines.map((l) => [l.kind, l.depth, l.type ?? l.mark])).toEqual([
      ['block', 0, 'paragraph'],
      ['mark', 1, 'bold'],
      ['block', 0, 'paragraph'],
      ['block', 0, 'region'],
      ['block', 1, 'list'],
      ['block', 2, 'list-item'],
    ]);
    expect(lines[0].excerpt).toBe('Start typing — this is Nabu.');
    expect(lines[1].range).toEqual([0, 12]);
    expect(lines[3]).toMatchObject({ type: 'region', detail: 'section-2', excerpt: 'The bank' });
    expect(lines[4]).toMatchObject({ type: 'list', detail: 'bullet', hasText: false });
    expect(lines[0].id).toMatch(/^\d+$/);
  });

  it('truncates long text, and caps the number of lines with a final "more" line', () => {
    const { doc } = sample();
    expect(buildModel(doc, { excerpt: 10 })[2].excerpt).toBe('Press / fo…');
    const big = new LoroDoc();
    for (let i = 0; i < 100; i++) block(big, 'paragraph', 'p' + i);
    big.commit();
    const lines = buildModel(big);
    expect(lines).toHaveLength(MAX_LINES + 1);
    expect(lines.at(-1)).toMatchObject({ kind: 'more' });
  });

  it('merges adjacent runs of a mark and keeps different marks apart', () => {
    expect(markRanges([
      { insert: 'ab', attributes: { bold: true } },
      { insert: 'cd', attributes: { bold: true, italic: true } },
      { insert: 'ef' },
      { insert: 'gh', attributes: { bold: true } },
    ])).toEqual([['bold', [0, 4]], ['italic', [2, 4]], ['bold', [6, 8]]]);
  });
});

describe('describeBatch', () => {
  /** Describes each batch as it arrives, like the component does (the lookup answers for the tree as it is NOW). @param {LoroDoc} doc @param {Map<string, string>} types */
  function capture(doc, types) {
    /** @type {import('../../src/site/xray.js').Op[][]} */
    const out = [];
    const lookup = treeLookup(doc);
    doc.subscribe((b) => out.push(describeBatch(b, types, lookup)));
    return out;
  }

  it('text insert / delete / mark / unmark, with positions in the block text', async () => {
    const { doc, p } = sample();
    await flush();
    const types = new Map();
    buildModel(doc, { types });
    const ops = capture(doc, types);
    const text = p.data.get('text');
    text.insert(28, 'u'); doc.commit(); await flush();
    text.delete(27, 1); doc.commit(); await flush();
    text.mark({ start: 13, end: 20 }, 'italic', true); doc.commit(); await flush();
    text.unmark({ start: 0, end: 5 }, 'bold'); doc.commit(); await flush();
    expect(ops).toEqual([
      [{ sign: '+', text: 'insert "u" @ 28' }],
      [{ sign: '-', text: 'delete 1 @ 27' }],
      [{ sign: '+', text: 'mark italic [13, 20]' }],
      [{ sign: '-', text: 'unmark bold [0, 5]' }],
    ]);
  });

  it('block create / retype / move / delete, and region retype', async () => {
    const { doc, region } = sample();
    await flush();
    const types = new Map();
    buildModel(doc, { types });
    const out = capture(doc, types);
    const created = block(doc, 'paragraph', 'x'); doc.commit(); await flush();
    created.data.set('type', 'heading'); doc.commit(); await flush();
    region.data.set('regionType', 'chapter'); doc.commit(); await flush();
    created.move(region); doc.commit(); await flush();
    doc.getTree('blocks').delete(created.id); doc.commit(); await flush();
    const id = String(created.id).split('@')[0];
    const rid = String(region.id).split('@')[0];
    const lines = out.map((ops) => ops.map((/** @type {any} */ o) => `${o.sign} ${o.text}`));
    expect(lines[0]).toEqual([`+ block paragraph#${id}`, '+ insert "x" @ 0']);
    expect(lines[1]).toEqual([`~ retype paragraph#${id} → heading`]);
    expect(lines[2]).toEqual([`~ retype region#${rid} → chapter`]);
    expect(lines[3]).toEqual([`~ move heading#${id}`]);
    expect(lines[4]).toEqual([`- block heading#${id}`]);
  });

  it('long inserted text is clipped, line breaks shown as a symbol', () => {
    expect(clip('abcdefghijklmnop', 12)).toBe('abcdefghijkl…');
    expect(clip('a\nb', 12)).toBe('a↵b');
  });
});

describe('formatTiming', () => {
  it('a measured time in ms, or the kind of an operation that was not typed', () => {
    expect(formatTiming(2.94)).toBe('2.9 ms');
    expect(formatTiming(0.04)).toBe('<0.1 ms');
    expect(formatTiming(123.4)).toBe('123 ms');
    expect(formatTiming('paste')).toBe('paste');
  });
});
