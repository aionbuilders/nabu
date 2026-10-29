// @ts-nocheck
/**
 * Mark edges of typed text do not depend on the history of the document (src/lib/behaviors/text/mark-edges.js).
 *
 * Loro decides where a character typed at the edge of a mark lands from the anchors of the style operations that happened; Nabu's
 * rule is what the text looks like: a typed character keeps a mark only when the character before it and the one after it both
 * carry it (same value), unless the user armed the mark (stored marks). The behavior corrects Loro in the same commit as the insert.
 */

import { describe, it, expect, vi } from 'vitest';
import { LoroDoc } from 'loro-crdt';
import { createFullEditor } from '#lib/index.js';
import { readDelta } from '#lib/utils/delta.js';
import { rng } from './helpers/rng.js';

const STYLES = { bold: { expand: 'none' }, italic: { expand: 'none' }, underline: { expand: 'none' }, code: { expand: 'none' }, strikethrough: { expand: 'none' }, link: { expand: 'none' } };
const flush = async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

/** `[012]3456[789]` style notation: brackets are bold. */
function show(delta) {
  return delta.map((op) => (op.attributes?.bold ? `[${op.insert}]` : op.insert)).join('');
}

async function editorWith(text) {
  const engine = createFullEditor();
  await engine.commit();
  const block = engine.children[0];
  const behavior = block.behaviors.get('text');
  behavior.insert(0, text);
  await engine.commit();
  return { engine, block, behavior };
}

/** Types `data` at `from` the way the engine does (beforeinput), with a stubbed collapsed caret. */
function type(behavior, from, data = 'X') {
  const selection = { from, to: from, isCollapsed: true, direction: 'none' };
  behavior.handleBeforeInput({ inputType: 'insertText', data, preventDefault: vi.fn(), getTargetRanges: () => [] }, selection);
}

const sel = (from, to) => ({ from, to, isCollapsed: from === to, direction: 'none' });

/** The two histories of `[012]3456[789]`. */
const HISTORIES = {
  'two marks': (b) => { b.applyMark('bold', true, sel(0, 3)); b.applyMark('bold', true, sel(7, 10)); },
  'mark all then unmark the middle': (b) => { b.applyMark('bold', true, sel(0, 10)); b.removeMark('bold', sel(3, 7)); },
};

describe('mark edges of typed text', () => {
  for (const [name, build] of Object.entries(HISTORIES)) {
    it(`history "${name}": X typed at 3 and at 7 is plain, whatever the anchors`, async () => {
      for (const [at, expected] of [[3, '[012]X3456[789]'], [7, '[012]3456X[789]']]) {
        const { engine, behavior } = await editorWith('0123456789');
        build(behavior);
        await engine.commit();
        expect(show(readDelta(behavior.container)), 'setup').toBe('[012]3456[789]');
        type(behavior, at);
        await flush();
        expect(show(readDelta(behavior.container))).toBe(expected);
        expect(show(behavior.delta)).toBe(expected); // the reactive delta says the same
      }
    });
  }

  it('typing inside bold stays bold; at the edges of the text it is plain', async () => {
    const { engine, behavior } = await editorWith('0123456789');
    behavior.applyMark('bold', true, sel(2, 8));
    await engine.commit();
    type(behavior, 5);
    expect(show(readDelta(behavior.container))).toBe('01[234X567]89');
    type(behavior, 0);
    type(behavior, behavior.container.length);
    const delta = readDelta(behavior.container);
    expect(delta[0]).toEqual({ insert: 'X01' });
    expect(delta.at(-1)).toEqual({ insert: '89X' });
  });

  it('two bold ranges that meet: a character typed at the junction is bold (both sides are)', async () => {
    const { engine, behavior } = await editorWith('abcdef');
    behavior.applyMark('bold', true, sel(0, 3));
    behavior.applyMark('bold', true, sel(3, 6));
    await engine.commit();
    type(behavior, 3);
    expect(readDelta(behavior.container)).toEqual([{ insert: 'abcXdef', attributes: { bold: true } }]);
  });

  it('a link is compared by value', async () => {
    const { engine, behavior } = await editorWith('abcdef');
    behavior.applyMark('link', 'https://a.example', sel(0, 3));
    behavior.applyMark('link', 'https://b.example', sel(3, 6));
    await engine.commit();
    type(behavior, 3);
    expect(readDelta(behavior.container)).toEqual([
      { insert: 'abc', attributes: { link: 'https://a.example' } },
      { insert: 'X' },
      { insert: 'def', attributes: { link: 'https://b.example' } },
    ]);
    // inside one link it stays
    const second = await editorWith('abcdef');
    second.behavior.applyMark('link', 'https://a.example', sel(0, 6));
    await second.engine.commit();
    type(second.behavior, 3);
    expect(readDelta(second.behavior.container)).toEqual([{ insert: 'abcXdef', attributes: { link: 'https://a.example' } }]);
  });

  it('a stored mark armed with Ctrl+B still types bold at the left edge of an unmarked hole, and an armed-off one stays off inside bold', async () => {
    for (const build of Object.values(HISTORIES)) {
      const { engine, behavior } = await editorWith('0123456789');
      build(behavior);
      await engine.commit();
      engine.storedMarks = { bold: true };
      type(behavior, 3);
      expect(show(readDelta(behavior.container))).toBe('[012X]3456[789]');
      engine.storedMarks = null;
    }
    const { engine, behavior } = await editorWith('0123456789');
    behavior.applyMark('bold', true, sel(0, 10));
    await engine.commit();
    engine.storedMarks = { bold: false };
    type(behavior, 5);
    expect(show(readDelta(behavior.container))).toBe('[01234]X[56789]');
  });

  it('a stored mark of one name leaves the others to the rule', async () => {
    const { engine, behavior } = await editorWith('0123456789');
    behavior.applyMark('bold', true, sel(0, 10));
    behavior.removeMark('bold', sel(3, 7));
    await engine.commit();
    engine.storedMarks = { italic: true };
    type(behavior, 3);
    expect(readDelta(behavior.container).find((op) => op.insert.includes('X')).attributes).toEqual({ italic: true });
  });

  it('the correction is part of the typing step: one undo removes the text and leaves the document as it was', async () => {
    const { engine, behavior } = await editorWith('0123456789');
    HISTORIES['mark all then unmark the middle'](behavior);
    await engine.commit();
    engine.undoManager.clear();
    type(behavior, 3);
    await flush();
    expect(show(readDelta(behavior.container))).toBe('[012]X3456[789]');
    engine.undo();
    await engine.commit();
    await flush();
    expect(behavior.text).toBe('0123456789');
    expect(show(readDelta(behavior.container))).toBe('[012]3456[789]');
    expect(engine.undoManager.canUndo()).toBe(false);
  });

  it('typing without any mark around does not touch the document beyond the insert', async () => {
    const { engine, behavior } = await editorWith('abc');
    const spy = vi.spyOn(behavior.container, 'unmark');
    const spyMark = vi.spyOn(behavior.container, 'mark');
    type(behavior, 1);
    await flush();
    expect(spy).not.toHaveBeenCalled();
    expect(spyMark).not.toHaveBeenCalled();
    expect(behavior.text).toBe('aXbc');
  });
});

// ── Fuzz ─────────────────────────────────────────────────────────────────────

const FLAGS = ['bold', 'italic', 'underline'];
const HREFS = ['https://a.example', 'https://b.example'];
const LEN = 12;

function randomHistory(rand) {
  const int = (n) => Math.floor(rand() * n);
  const steps = [];
  const n = 2 + int(7);
  for (let i = 0; i < n; i++) {
    const a = int(LEN), c = 1 + int(LEN);
    const start = Math.min(a, c - 1), end = Math.max(a + 1, c);
    const isLink = rand() < 0.2;
    const name = isLink ? 'link' : FLAGS[int(FLAGS.length)];
    if (rand() < 0.55) steps.push({ kind: 'mark', start, end, name, value: isLink ? HREFS[int(HREFS.length)] : true });
    else steps.push({ kind: 'unmark', start, end, name });
  }
  return steps;
}

const marksPerChar = (delta) => {
  const out = [];
  for (const op of delta) for (let i = 0; i < op.insert.length; i++) out.push({ ...(op.attributes ?? {}) });
  return out;
};
const key = (marks) => JSON.stringify(Object.keys(marks).sort().map((k) => [k, marks[k]]));

/** A document with the same visible marks made of `mark` calls only: one per maximal run of a mark with the same value. */
function markOnlyDoc(visible) {
  const doc = new LoroDoc();
  doc.configTextStyle(STYLES);
  const text = doc.getText('t');
  text.insert(0, 'a'.repeat(visible.length));
  for (const name of [...FLAGS, 'link']) {
    let i = 0;
    while (i < visible.length) {
      if (!(name in visible[i])) { i++; continue; }
      let j = i + 1;
      while (j < visible.length && name in visible[j] && visible[j][name] === visible[i][name]) j++;
      text.mark({ start: i, end: j }, name, visible[i][name]);
      i = j;
    }
  }
  doc.commit();
  return text;
}

/** Nabu's rule, from what the text looks like. */
function ruleAt(visible, index) {
  const left = visible[index - 1], right = visible[index];
  const out = {};
  if (left && right) for (const k in left) if (k in right && left[k] === right[k]) out[k] = left[k];
  return out;
}

describe('mark edges (fuzz)', () => {
  const SEEDS = Array.from({ length: 80 }, (_, n) => 9000 + n);

  it(`${SEEDS.length} random mark / unmark histories: typing at every index gives what a mark-only document gives, and the rule`, async () => {
    const engine = createFullEditor();
    await engine.commit();
    const behavior = engine.children[0].behaviors.get('text');
    const container = behavior.container;
    let checked = 0;
    let differing = 0;
    for (const seed of SEEDS) {
      const history = randomHistory(rng(seed));
      for (let index = 0; index <= LEN; index++) {
        const where = `seed ${seed}, index ${index}\n${history.map((s) => JSON.stringify(s)).join('\n')}`;
        // the document made by the history
        if (container.length) container.delete(0, container.length);
        container.insert(0, 'a'.repeat(LEN));
        for (const s of history) {
          if (s.kind === 'mark') container.mark({ start: s.start, end: s.end }, s.name, s.value);
          else container.unmark({ start: s.start, end: s.end }, s.name);
        }
        const visible = marksPerChar(readDelta(container));
        // the same visible state from mark calls only, typed into raw (what Loro does when the history is "clean")
        const clean = markOnlyDoc(visible);
        clean.insert(index, 'X');
        const cleanMarks = marksPerChar(readDelta(clean))[index];
        // the editor path
        type(behavior, index);
        const typed = marksPerChar(readDelta(container));
        expect(container.toString().length, where).toBe(LEN + 1);
        expect(key(typed[index]), `${where}\n(editor vs rule)`).toBe(key(ruleAt(visible, index)));
        expect(key(typed[index]), `${where}\n(editor vs mark-only document)`).toBe(key(cleanMarks));
        // the neighbours did not change
        expect(typed.filter((_, i) => i !== index).map(key), `${where}\n(neighbours)`).toEqual(visible.map(key));
        const raw = markOnlyDoc(visible);
        raw.insert(index, 'X');
        if (key(marksPerChar(readDelta(raw))[index]) !== key(ruleAt(visible, index))) differing++;
        checked++;
      }
    }
    await engine.commit();
    expect(checked).toBe(SEEDS.length * (LEN + 1));
    // the rule is Loro's own result for a mark-only document: nothing to correct there
    expect(differing, 'Loro itself disagrees with the rule on a mark-only document').toBe(0);
  }, 120000);
});
