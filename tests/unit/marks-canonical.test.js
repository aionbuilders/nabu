/**
 * Property / fuzz test of the canonical delta (src/lib/utils/delta.js) against random mark, unmark, insert and delete sequences.
 *
 * Loro keeps a split where a mark is removed over exactly the range it was applied to; `readDelta` hides it. Every step checks:
 *   - the canonical invariants: no two adjacent runs with the same effective attributes, no off (null / false / undefined)
 *     attribute value, no empty run, no empty `attributes` object;
 *   - the text of the runs is `container.toString()`;
 *   - the marks are what a plain model of the text says (a mark that does not apply / remove as expected would show here).
 * The sequences are generated from a fixed seed: a failure names its seed and step and reproduces as is. The same checks run on
 * the raw Loro text, on a TextBehavior of a real editor, and after a snapshot round-trip.
 */

import { describe, it, expect } from 'vitest';
import { LoroDoc } from 'loro-crdt';
import { createFullEditor } from '#lib/index.js';
import { readDelta, normalizeDelta } from '#lib/utils/delta.js';

const STYLES = { bold: { expand: 'none' }, italic: { expand: 'none' }, underline: { expand: 'none' }, code: { expand: 'none' }, strikethrough: { expand: 'none' }, link: { expand: 'none' } };
const FLAGS = ['bold', 'italic', 'underline', 'code', 'strikethrough'];
const HREFS = ['https://a.example', 'https://b.example'];
const WORDS = ['ab', 'The ford', ' is ', 'x', 'upstream.', '\n', 'é', 'longer words here'];

/** mulberry32: a small seeded PRNG, so a failing sequence reproduces. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random step: mark, unmark, insert or delete, on random (possibly empty or whole) ranges of a text of `length`. */
function randomStep(rand, length) {
  const int = (n) => Math.floor(rand() * n);
  const pick = (list) => list[int(list.length)];
  // never empty: Loro refuses an empty mark range and the behavior ignores a collapsed selection (both covered elsewhere)
  const range = () => {
    if (rand() < 0.15) return { start: 0, end: length }; // the whole text
    const a = int(length), c = 1 + int(length);
    return { start: Math.min(a, c - 1), end: Math.max(a + 1, c) };
  };
  const r = length === 0 ? 0.7 : rand(); // an empty text can only be inserted into
  if (r < 0.34) {
    if (rand() < 0.2) return { kind: 'mark', ...range(), name: 'link', value: pick(HREFS) };
    return { kind: 'mark', ...range(), name: pick(FLAGS), value: true };
  }
  if (r < 0.66) return { kind: 'unmark', ...range(), name: rand() < 0.15 ? 'link' : pick(FLAGS) };
  if (r < 0.84 || length === 0) return { kind: 'insert', index: int(length + 1), text: pick(WORDS) };
  const { start, end } = range();
  return { kind: 'delete', index: start, length: Math.min(end - start, 6) };
}

/**
 * The text as a plain model: one `{ ch, marks }` per UTF-16 unit. Mark, unmark and delete are exact. What a text inserted next to a
 * mark takes depends on Loro's anchors (two marks that meet at the insertion point are two ranges: the text takes neither), which
 * the model cannot know: `settle` reads it back from the delta, after checking it is allowed (only a mark both neighbours carry
 * with the same value, and the same marks for the whole insert).
 */
class Model {
  chars = [];
  #candidate = {};
  apply(step) {
    if (step.kind === 'mark') for (let i = step.start; i < step.end; i++) this.chars[i].marks[step.name] = step.value;
    else if (step.kind === 'unmark') for (let i = step.start; i < step.end; i++) delete this.chars[i].marks[step.name];
    else if (step.kind === 'insert') {
      const left = this.chars[step.index - 1]?.marks ?? {}, right = this.chars[step.index]?.marks ?? {};
      this.#candidate = {};
      for (const k in left) this.#candidate[k] = [left[k]];
      for (const k in right) (this.#candidate[k] ??= []).push(right[k]);
      this.chars.splice(step.index, 0, ...Array.from(step.text, (ch) => ({ ch, marks: {} })));
    } else this.chars.splice(step.index, step.length);
  }
  /** After an insert step: takes the marks Loro gave the inserted text, if they are allowed. */
  settle(step, delta, where) {
    if (step.kind !== 'insert') return;
    const fail = (m) => { throw new Error(`${where}: ${m}`); };
    let pos = 0;
    const marksAt = [];
    for (const op of delta) for (let i = 0; i < op.insert.length; i++) marksAt[pos++] = op.attributes ?? {};
    const first = marksAt[step.index];
    for (let i = 0; i < step.text.length; i++) {
      if (attrKey(marksAt[step.index + i]) !== attrKey(first)) fail('the inserted text does not take the same marks all along');
      this.chars[step.index + i].marks = { ...first };
    }
    for (const k in first) if (!(this.#candidate[k] ?? []).includes(first[k])) fail(`an insert took a mark ${k} that no neighbour carries`);
  }
  get length() { return this.chars.length; }
  get text() { return this.chars.map((c) => c.ch).join(''); }
  /** The canonical delta the model stands for. */
  delta() {
    const out = [];
    for (const { ch, marks } of this.chars) {
      const last = out[out.length - 1];
      const key = JSON.stringify(Object.keys(marks).sort().map((k) => [k, marks[k]]));
      if (last && last.key === key) last.insert += ch;
      else out.push({ key, insert: ch, attributes: Object.keys(marks).length ? { ...marks } : undefined });
    }
    return out.map(({ insert, attributes }) => (attributes ? { insert, attributes } : { insert }));
  }
}

function attrKey(attrs) { return JSON.stringify(Object.keys(attrs ?? {}).sort().map((k) => [k, attrs[k]])); }

/** The canonical invariants of a delta whose text is `text` (plain checks: this runs thousands of times). */
function expectCanonical(delta, text, where) {
  const fail = (m) => { throw new Error(`${where}: ${m}`); };
  if (delta.map((op) => op.insert).join('') !== text) fail('the text of the runs is not the text of the container');
  for (let i = 0; i < delta.length; i++) {
    const op = delta[i];
    if (typeof op.insert !== 'string') fail(`run ${i} is not text`);
    if (op.insert.length === 0) fail(`run ${i} is empty`);
    if (op.attributes !== undefined) {
      const keys = Object.keys(op.attributes);
      if (keys.length === 0) fail(`run ${i} has an empty attributes object`);
      for (const k of keys) if (op.attributes[k] === null || op.attributes[k] === undefined || op.attributes[k] === false) fail(`run ${i} keeps an off ${k}`);
    }
    if (i > 0 && attrKey(op.attributes) === attrKey(delta[i - 1].attributes)) fail(`runs ${i - 1} and ${i} have the same attributes (${JSON.stringify(op.insert)})`);
  }
}

const describeSteps = (steps) => steps.map((s) => JSON.stringify(s)).join('\n');

function applyToLoro(text, step) {
  if (step.kind === 'mark') text.mark({ start: step.start, end: step.end }, step.name, step.value);
  else if (step.kind === 'unmark') text.unmark({ start: step.start, end: step.end }, step.name);
  else if (step.kind === 'insert') text.insert(step.index, step.text);
  else text.delete(step.index, step.length);
}

/** The model of the random start text. */
function seedModel(rand, initial) {
  const model = new Model();
  model.apply({ kind: 'insert', index: 0, text: initial });
  return model;
}

const SEEDS = Array.from({ length: 300 }, (_, n) => 1000 + n);
const STEPS = 25;

describe('canonical delta, raw Loro text (fuzz)', () => {
  it(`${SEEDS.length} random sequences of ${STEPS} steps stay canonical and match the model, also after a snapshot round-trip`, () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const rand = rng(seed);
      const doc = new LoroDoc();
      doc.configTextStyle(STYLES);
      const text = doc.getText('t');
      const initial = 'The ford is upstream.';
      text.insert(0, initial);
      const model = seedModel(rand, initial);
      const steps = [];
      for (let n = 0; n < STEPS; n++) {
        const step = randomStep(rand, model.length);
        steps.push(step);
        applyToLoro(text, step);
        model.apply(step);
        doc.commit();
        const where = `seed ${seed} step ${n}\n${describeSteps(steps)}`;
        const delta = readDelta(text);
        expectCanonical(delta, text.toString(), where);
        model.settle(step, delta, where);
        expect(delta, `${where}: the marks are not what the model says`).toEqual(model.delta());
        // the raw delta and the canonical one say the same thing
        expect(normalizeDelta(text.toDelta()), where).toEqual(delta);
        checked++;
        if (n % 5 === 4 || n === STEPS - 1) {
          const copy = new LoroDoc();
          copy.configTextStyle(STYLES);
          copy.import(doc.export({ mode: 'snapshot' }));
          const reloaded = copy.getText('t');
          expectCanonical(readDelta(reloaded), reloaded.toString(), `${where}\n(after a snapshot round-trip)`);
          expect(readDelta(reloaded), `${where}\n(after a snapshot round-trip)`).toEqual(delta);
        }
      }
    }
    expect(checked).toBe(SEEDS.length * STEPS);
  }, 60000);

  it('bold then unbold of exactly the same range, whatever the range, gives one run', () => {
    const initial = 'The ford is upstream.';
    for (let start = 0; start < initial.length; start++) {
      for (let end = start + 1; end <= initial.length; end++) {
        const doc = new LoroDoc();
        doc.configTextStyle(STYLES);
        const text = doc.getText('t');
        text.insert(0, initial);
        text.mark({ start, end }, 'bold', true);
        text.unmark({ start, end }, 'bold');
        doc.commit();
        expect(readDelta(text), `[${start}, ${end})`).toEqual([{ insert: initial }]);
      }
    }
  });
});

describe('canonical delta, TextBehavior of a real editor (fuzz)', () => {
  const flush = async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
  const sel = (from, to) => ({ from, to, isCollapsed: from === to, direction: 'none' });

  it('the reactive delta, the JSON export and the serialized document stay canonical and match the model', async () => {
    const engine = createFullEditor();
    await engine.commit();
    const block = engine.children[0];
    const behavior = block.behaviors.get('text');
    const runs = 120, steps = 15;
    let checked = 0;
    for (let seed = 5000; seed < 5000 + runs; seed++) {
      const rand = rng(seed);
      // a fresh text each run
      if (behavior.container.length) behavior.container.delete(0, behavior.container.length);
      behavior.insert(0, 'The ford is upstream.');
      const model = seedModel(rand, 'The ford is upstream.');
      const done = [];
      for (let n = 0; n < steps; n++) {
        const step = randomStep(rand, model.length);
        done.push(step);
        if (step.kind === 'mark') behavior.applyMark(step.name, step.value, sel(step.start, step.end));
        else if (step.kind === 'unmark') behavior.removeMark(step.name, sel(step.start, step.end));
        else if (step.kind === 'insert') behavior.insert(step.index, step.text);
        else behavior.delete({ index: step.index, length: step.length });
        model.apply(step);
        await engine.commit();
        await flush();
        const where = `seed ${seed} step ${n}\n${describeSteps(done)}`;
        expect(behavior.text, where).toBe(model.text);
        expectCanonical(behavior.delta, behavior.text, `${where}\n(behavior.delta)`);
        model.settle(step, behavior.delta, where);
        expect(behavior.delta, `${where}: the marks are not what the model says`).toEqual(model.delta());
        // the JSON export is built from the same delta: one run per canonical op
        const json = block.serialize('json').content;
        expect(json.map((r) => r.text), where).toEqual(model.delta().map((op) => op.insert));
        checked++;
      }
    }
    expect(checked).toBe(runs * steps);

    // and the whole document survives a snapshot round-trip canonical
    const snapshot = engine.doc.export({ mode: 'snapshot' });
    const copy = new LoroDoc();
    copy.import(snapshot);
    const reloaded = copy.getTree('blocks').roots()[0].data.get('text');
    expectCanonical(readDelta(reloaded), reloaded.toString(), 'after a snapshot round-trip');
    expect(readDelta(reloaded)).toEqual(behavior.delta);
  }, 60000);

  it('toggleMark twice on the same selection leaves one run, even after a partial overlap', async () => {
    const engine = createFullEditor();
    await engine.commit();
    const behavior = engine.children[0].behaviors.get('text');
    behavior.insert(0, 'The ford is upstream.');
    await engine.commit();
    const toggle = async (from, to, mark = 'bold') => { behavior.toggleMark(mark, true, sel(from, to)); await engine.commit(); await flush(); };

    await toggle(18, 21); await toggle(18, 21);
    expect(behavior.delta).toEqual([{ insert: 'The ford is upstream.' }]);

    await toggle(4, 8); // bold [4, 8)
    await toggle(6, 12); // partly bold: applied, bold [4, 12)
    expect(behavior.delta).toEqual([{ insert: 'The ' }, { insert: 'ford is ', attributes: { bold: true } }, { insert: 'upstream.' }]);
    await toggle(4, 12); // fully bold: off, over the whole bold range
    expect(behavior.delta).toEqual([{ insert: 'The ford is upstream.' }]);

    // italic + bold, then one of them removed over its own range
    await toggle(4, 8, 'italic'); await toggle(4, 8);
    await toggle(4, 8); // bold off again: the italic run stays one run
    expect(behavior.delta).toEqual([{ insert: 'The ' }, { insert: 'ford', attributes: { italic: true } }, { insert: ' is upstream.' }]);
    await toggle(4, 8, 'italic');
    expect(behavior.delta).toEqual([{ insert: 'The ford is upstream.' }]);
  });

  it('a collapsed selection changes nothing', async () => {
    const engine = createFullEditor();
    await engine.commit();
    const behavior = engine.children[0].behaviors.get('text');
    behavior.insert(0, 'abc');
    await engine.commit();
    behavior.applyMark('bold', true, sel(1, 1));
    behavior.removeMark('bold', sel(1, 1));
    behavior.toggleMark('bold', true, sel(2, 2));
    await engine.commit();
    await flush();
    expect(behavior.delta).toEqual([{ insert: 'abc' }]);
  });
});
