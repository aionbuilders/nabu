/**
 * normalizeDelta / readDelta: the canonical form of a rich-text delta (see src/lib/utils/delta.js).
 * Loro keeps a split where a mark was removed over exactly the range it was applied to; the engine only reads canonical deltas.
 */

import { describe, it, expect } from 'vitest';
import { LoroDoc } from 'loro-crdt';
import { normalizeDelta, readDelta } from '#lib/utils/delta.js';

const b = { bold: true };
const i = { italic: true };
const link = (href) => ({ link: href });

describe('normalizeDelta', () => {
  it('returns the very same array when the delta already is canonical (nothing allocated)', () => {
    const delta = [{ insert: 'a' }, { insert: 'b', attributes: b }, { insert: 'c' }, { insert: 'd', attributes: { bold: true, italic: true } }];
    expect(normalizeDelta(delta)).toBe(delta);
    const empty = [];
    expect(normalizeDelta(empty)).toBe(empty);
    const one = [{ insert: 'x', attributes: link('https://a.example') }];
    expect(normalizeDelta(one)).toBe(one);
  });

  it('merges adjacent unstyled runs (the Loro split after mark + unmark of the same range)', () => {
    expect(normalizeDelta([{ insert: 'The ford is upstre' }, { insert: 'am.' }])).toEqual([{ insert: 'The ford is upstream.' }]);
  });

  it('merges any number of adjacent runs with equal attributes', () => {
    expect(normalizeDelta([{ insert: 'a', attributes: b }, { insert: 'b', attributes: b }, { insert: 'c', attributes: b }]))
      .toEqual([{ insert: 'abc', attributes: b }]);
    expect(normalizeDelta([{ insert: 'a' }, { insert: 'b' }, { insert: 'c', attributes: i }, { insert: 'd' }, { insert: 'e' }]))
      .toEqual([{ insert: 'ab' }, { insert: 'c', attributes: i }, { insert: 'de' }]);
  });

  it('does not merge runs with different attributes', () => {
    const delta = [{ insert: 'a', attributes: b }, { insert: 'b', attributes: i }, { insert: 'c' }];
    expect(normalizeDelta(delta)).toBe(delta);
    // a subset is not equal
    const subset = [{ insert: 'a', attributes: b }, { insert: 'b', attributes: { bold: true, italic: true } }];
    expect(normalizeDelta(subset)).toEqual(subset);
    const superset = [{ insert: 'a', attributes: { bold: true, italic: true } }, { insert: 'b', attributes: b }];
    expect(normalizeDelta(superset)).toEqual(superset);
  });

  it('compares attributes whatever the order of their keys', () => {
    expect(normalizeDelta([
      { insert: 'a', attributes: { bold: true, italic: true } },
      { insert: 'b', attributes: { italic: true, bold: true } },
    ])).toEqual([{ insert: 'ab', attributes: { bold: true, italic: true } }]);
  });

  it('treats null, undefined and false attributes as absent', () => {
    expect(normalizeDelta([{ insert: 'a' }, { insert: 'b', attributes: { bold: null } }])).toEqual([{ insert: 'ab' }]);
    expect(normalizeDelta([{ insert: 'a' }, { insert: 'b', attributes: { bold: false } }])).toEqual([{ insert: 'ab' }]);
    expect(normalizeDelta([{ insert: 'a', attributes: { bold: undefined } }, { insert: 'b', attributes: {} }])).toEqual([{ insert: 'ab' }]);
    expect(normalizeDelta([{ insert: 'a', attributes: { bold: true, italic: false } }, { insert: 'b', attributes: { bold: true, link: null } }]))
      .toEqual([{ insert: 'ab', attributes: { bold: true } }]);
  });

  it('drops the off attributes of a run that is kept alone, and its empty attributes object', () => {
    expect(normalizeDelta([{ insert: 'a', attributes: { bold: true, italic: null } }])).toEqual([{ insert: 'a', attributes: { bold: true } }]);
    const [only] = normalizeDelta([{ insert: 'a', attributes: { bold: false, italic: null } }]);
    expect(only).toEqual({ insert: 'a' });
    expect('attributes' in only).toBe(false);
    const [empty] = normalizeDelta([{ insert: 'a', attributes: {} }]);
    expect('attributes' in empty).toBe(false);
  });

  it('keeps a falsy value that is not one of the three "off" values (the empty string is a value)', () => {
    expect(normalizeDelta([{ insert: 'a', attributes: { link: '' } }, { insert: 'b' }])).toEqual([{ insert: 'a', attributes: { link: '' } }, { insert: 'b' }]);
  });

  it('merges links with the same href and keeps links with different hrefs apart', () => {
    expect(normalizeDelta([{ insert: 'a', attributes: link('https://a.example') }, { insert: 'b', attributes: link('https://a.example') }]))
      .toEqual([{ insert: 'ab', attributes: link('https://a.example') }]);
    const apart = [{ insert: 'a', attributes: link('https://a.example') }, { insert: 'b', attributes: link('https://b.example') }];
    expect(normalizeDelta(apart)).toBe(apart);
    // same href but not the same other marks
    const marked = [{ insert: 'a', attributes: { link: 'https://a.example', bold: true } }, { insert: 'b', attributes: link('https://a.example') }];
    expect(normalizeDelta(marked)).toEqual(marked);
  });

  it('compares an object value by its content', () => {
    expect(normalizeDelta([{ insert: 'a', attributes: { x: { n: 1 } } }, { insert: 'b', attributes: { x: { n: 1 } } }]))
      .toEqual([{ insert: 'ab', attributes: { x: { n: 1 } } }]);
    const apart = [{ insert: 'a', attributes: { x: { n: 1 } } }, { insert: 'b', attributes: { x: { n: 2 } } }];
    expect(normalizeDelta(apart)).toEqual(apart);
  });

  it('drops empty inserts and merges what they used to separate', () => {
    expect(normalizeDelta([{ insert: 'a' }, { insert: '' }, { insert: 'b' }])).toEqual([{ insert: 'ab' }]);
    expect(normalizeDelta([{ insert: '' }, { insert: '', attributes: b }])).toEqual([]);
    expect(normalizeDelta([{ insert: 'a', attributes: b }, { insert: '', attributes: i }, { insert: 'b', attributes: b }])).toEqual([{ insert: 'ab', attributes: b }]);
  });

  it('keeps an embed untouched, never merges across it', () => {
    const embed = { insert: { image: 'x.png' }, attributes: b };
    const out = normalizeDelta([{ insert: 'a' }, { insert: 'b' }, embed, { insert: 'c' }, { insert: 'd' }]);
    expect(out).toEqual([{ insert: 'ab' }, embed, { insert: 'cd' }]);
    expect(out[1]).toBe(embed);
    // an embed alone / between runs that do not need merging: same array
    const plain = [{ insert: 'a' }, embed, { insert: 'c' }];
    expect(normalizeDelta(plain)).toBe(plain);
    // two embeds are never merged
    expect(normalizeDelta([embed, embed])).toEqual([embed, embed]);
  });

  it('never mutates its input', () => {
    const input = [{ insert: 'a', attributes: { bold: true, italic: null } }, { insert: 'b', attributes: b }, { insert: 'c' }, { insert: 'd' }];
    const copy = JSON.parse(JSON.stringify(input));
    normalizeDelta(input);
    expect(input).toEqual(copy);
  });

  it('preserves the text: the concatenation of the inserts', () => {
    const delta = [{ insert: 'ab' }, { insert: '' }, { insert: 'cd', attributes: { bold: false } }, { insert: 'e', attributes: i }, { insert: 'f', attributes: i }];
    const text = (d) => d.map((op) => op.insert).join('');
    expect(text(normalizeDelta(delta))).toBe(text(delta));
  });

  it('is idempotent', () => {
    const delta = [{ insert: 'a', attributes: { bold: null } }, { insert: '' }, { insert: 'b' }, { insert: 'c', attributes: b }, { insert: 'd', attributes: { bold: true, x: false } }];
    const once = normalizeDelta(delta);
    expect(normalizeDelta(once)).toBe(once);
  });
});

describe('readDelta (on a real Loro text)', () => {
  function text(initial = 'The ford is upstream.') {
    const doc = new LoroDoc();
    doc.configTextStyle({ bold: { expand: 'none' }, italic: { expand: 'none' }, link: { expand: 'none' } });
    const t = doc.getText('t');
    t.insert(0, initial);
    doc.commit();
    return { doc, t };
  }

  it('merges the split Loro leaves after bold + unbold of exactly the same range', () => {
    const { doc, t } = text();
    t.mark({ start: 18, end: 21 }, 'bold', true);
    t.unmark({ start: 18, end: 21 }, 'bold');
    doc.commit();
    expect(readDelta(t)).toEqual([{ insert: 'The ford is upstream.' }]);
  });

  it('merges the split a snapshot carries', () => {
    const { doc, t } = text();
    t.mark({ start: 18, end: 21 }, 'bold', true);
    t.unmark({ start: 18, end: 21 }, 'bold');
    doc.commit();
    const copy = new LoroDoc();
    copy.import(doc.export({ mode: 'snapshot' }));
    expect(readDelta(copy.getText('t'))).toEqual([{ insert: 'The ford is upstream.' }]);
  });

  it('keeps the real runs of a text that is still marked', () => {
    const { doc, t } = text('abcdef');
    t.mark({ start: 2, end: 4 }, 'bold', true);
    doc.commit();
    expect(readDelta(t)).toEqual([{ insert: 'ab' }, { insert: 'cd', attributes: { bold: true } }, { insert: 'ef' }]);
  });
});
