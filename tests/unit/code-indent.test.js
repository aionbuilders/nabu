// @ts-nocheck
/**
 * Unit tests of the pure text helpers of the code block (src/lib/blocks/code/indent.js): line starts, auto-indent,
 * the lines a Tab / Shift+Tab touches and the edits that indent / outdent them.
 */
import { describe, it, expect } from 'vitest';
import { INDENT, lineStart, leadingIndent, touchedLines, indentLines, outdentLines } from '#lib/blocks/code/indent.js';

/** Apply a plan to `text` (edits come from the end of the text to its start). */
function apply(text, plan) {
  let out = text;
  for (const { index, remove, insert } of plan.edits) out = out.slice(0, index) + insert + out.slice(index + remove);
  return out;
}
/** `a⟦bc⟧d` : the text with its selection marked, to read a plan's result. */
const mark = (text, from, to) => text.slice(0, from) + '⟦' + text.slice(from, to) + '⟧' + text.slice(to);

describe('lineStart', () => {
  it('is the offset after the previous newline', () => {
    expect(lineStart('ab\ncd', 4)).toBe(3);
    expect(lineStart('ab\ncd', 3)).toBe(3);
    expect(lineStart('ab\ncd', 2)).toBe(0);
  });
  it('is 0 at the start, even when the text begins with a newline (no off-by-one on lastIndexOf)', () => {
    expect(lineStart('\nab', 0)).toBe(0);
    expect(lineStart('ab', 0)).toBe(0);
    expect(lineStart('\nab', 1)).toBe(1);
  });
});

describe('leadingIndent (auto-indent)', () => {
  it('is the spaces and tabs of the line up to the caret', () => {
    expect(leadingIndent('  x', 3)).toBe('  ');
    expect(leadingIndent('a\n\t\tx = 1', 9)).toBe('\t\t');
    expect(leadingIndent('x', 1)).toBe('');
  });
  it('stops at the caret when the caret is inside the indentation', () => {
    expect(leadingIndent('    x', 2)).toBe('  ');
    expect(leadingIndent('    x', 0)).toBe('');
  });
  it('is the whole line when the line is blank', () => {
    expect(leadingIndent('a\n   ', 5)).toBe('   ');
  });
});

describe('touchedLines', () => {
  const t = 'l1\nl2\nl3';
  it('a collapsed caret touches its own line', () => {
    expect(touchedLines(t, 4, 4)).toEqual([3]);
  });
  it('a range touches every line it overlaps', () => {
    expect(touchedLines(t, 1, 7)).toEqual([0, 3, 6]);
    expect(touchedLines(t, 1, 4)).toEqual([0, 3]);
  });
  it('a range that ends at the very start of a line does not touch that line', () => {
    expect(touchedLines(t, 0, 6)).toEqual([0, 3]);
    expect(touchedLines(t, 0, 3)).toEqual([0]);
  });
});

describe('indentLines (Tab over several lines)', () => {
  it('is null within one line (Tab then replaces the selection)', () => {
    expect(indentLines('abcd', 1, 3)).toBeNull();
    expect(indentLines('ab\ncd', 1, 1)).toBeNull();
    expect(indentLines('ab\ncd', 0, 3)).toBeNull(); // ends at the start of line 2
  });
  it('indents every touched line and keeps the selection on the same characters', () => {
    const t = 'l1\nl2\nl3';
    const plan = indentLines(t, 1, 7);
    const out = apply(t, plan);
    expect(out).toBe('  l1\n  l2\n  l3');
    expect(mark(out, plan.from, plan.to)).toBe('  l⟦1\n  l2\n  l⟧3');
  });
  it('leaves blank lines alone', () => {
    const t = 'a\n\nb';
    const plan = indentLines(t, 0, 4);
    expect(apply(t, plan)).toBe('  a\n\n  b');
  });
  it('a selection starting at the start of a line keeps its start there', () => {
    const t = 'a\nb';
    const plan = indentLines(t, 0, 3);
    expect(mark(apply(t, plan), plan.from, plan.to)).toBe('⟦  a\n  b⟧');
  });
  it('does not indent the line the selection merely reaches', () => {
    const t = 'a\nb\nc';
    const plan = indentLines(t, 0, 4); // "a\nb\n" ends at the start of "c"
    expect(apply(t, plan)).toBe('  a\n  b\nc');
  });
});

describe('outdentLines (Shift+Tab)', () => {
  it('removes up to two spaces, or one tab, from every touched line', () => {
    const t = '    a\n  b\n\tc\n d';
    const plan = outdentLines(t, 0, t.length);
    expect(apply(t, plan)).toBe('  a\nb\nc\nd');
  });
  it('a collapsed caret outdents its own line and follows its text', () => {
    const t = 'x\n    y';
    const plan = outdentLines(t, 7, 7);
    expect(apply(t, plan)).toBe('x\n  y');
    expect(mark(apply(t, plan), plan.from, plan.to)).toBe('x\n  y⟦⟧');
  });
  it('the caret inside the removed indentation lands at the start of the line', () => {
    const t = '  y';
    const plan = outdentLines(t, 1, 1);
    expect(apply(t, plan)).toBe('y');
    expect(plan.from).toBe(0);
  });
  it('is null when nothing can be removed', () => {
    expect(outdentLines('a\nb', 0, 3)).toBeNull();
    expect(outdentLines('ab', 1, 1)).toBeNull();
  });
  it('indent then outdent gives the text back', () => {
    const t = 'f(\n  a,\n  b\n)';
    const down = indentLines(t, 0, t.length);
    const indented = apply(t, down);
    const up = outdentLines(indented, down.from, down.to);
    expect(apply(indented, up)).toBe(t);
  });
  it('INDENT is two spaces', () => {
    expect(INDENT).toBe('  ');
  });
});
