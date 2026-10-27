// @ts-nocheck — mocks intentionally implement only the surface TextBehavior uses
/**
 * Unit tests for the MarkdownShortcutsExtension input rules.
 * Each test sets the block text to the pre-trigger state and fires an
 * insertText event with the closing delimiter as `data`.
 */

import { describe, it, expect, vi } from 'vitest';
import { TextBehavior } from '#lib/behaviors/text/text.behavior.svelte.js';
import { MarkdownShortcutsExtension } from '#lib/behaviors/text/markdown-shortcuts.extension.js';
import { TypographyExtension } from '#lib/behaviors/text/typography.extension.js';

// ── Mock LoroText container ────────────────────────────────────────────────

function makeContainer(text = '') {
  return {
    toString: () => text,
    get length() { return text.length; },
    toDelta: () => (text ? [{ insert: text }] : []),
    insert: vi.fn(),
    delete: vi.fn(),
    mark: vi.fn(),
    unmark: vi.fn(),
    subscribe: vi.fn(),
    applyDelta: vi.fn(),
    sliceDelta: vi.fn(() => []),
  };
}

/** Build a TextBehavior over a mock block, using the real constructor. */
function makeBehavior(text = '', { inputRules = [] } = {}) {
  const container = makeContainer(text);
  const block = {
    nabu: {
      hooks: new Map(),
      warn: vi.fn(),
      selection: { setCursor: vi.fn() },
      BREAK: Symbol('break'),
      inputRules,
    },
    node: { data: { get: (k) => k === 'text' ? container : null, setContainer: () => container } },
    element: null,
    behaviors: new Map(),
    selected: false,
    commit: vi.fn(),
    ascend: vi.fn(),
    findBackward: vi.fn(),
    findForward: vi.fn(),
    destroy: vi.fn(),
    type: 'paragraph',
  };
  const behavior = new TextBehavior(block, container);
  block.behaviors.set('text', behavior);
  return behavior;
}

function makeSel(from, to = from) {
  return { from, to, isCollapsed: from === to };
}

function makeEvent(inputType, data = null) {
  return {
    inputType,
    data,
    preventDefault: vi.fn(),
    getTargetRanges: () => [],
  };
}

// ── Markdown shortcuts ─────────────────────────────────────────────────────

describe('MarkdownShortcutsExtension', () => {
  const rules = MarkdownShortcutsExtension.inputRules;

  it('**bold** — typed final "*" converts to bold mark', () => {
    // text before cursor: '**bold*', typed char: '*'
    // match[0] = '**bold*' (length 7), match[1] = 'bold'
    // start = 7 - 7 = 0
    const b = makeBehavior('**bold*', { inputRules: rules });
    b.handleBeforeInput(makeEvent('insertText', '*'), makeSel(7));
    expect(b.container.delete).toHaveBeenCalledWith(0, 7);
    expect(b.container.insert).toHaveBeenCalledWith(0, 'bold');
    expect(b.container.mark).toHaveBeenCalledWith({ start: 0, end: 4 }, 'bold', true);
    expect(b.container.mark).toHaveBeenCalledTimes(1);
  });

  it('*italic* — typed final "*" converts to italic mark', () => {
    // text before cursor: '*italic', typed char: '*'
    // match[0] = '*italic' (length 7), match[1] = 'italic'
    // start = 7 - 7 = 0
    const b = makeBehavior('*italic', { inputRules: rules });
    b.handleBeforeInput(makeEvent('insertText', '*'), makeSel(7));
    expect(b.container.delete).toHaveBeenCalledWith(0, 7);
    expect(b.container.insert).toHaveBeenCalledWith(0, 'italic');
    expect(b.container.mark).toHaveBeenCalledWith({ start: 0, end: 6 }, 'italic', true);
    expect(b.container.mark).toHaveBeenCalledTimes(1);
  });

  it('`code` — typed final "`" converts to code mark', () => {
    // text before cursor: '`code', typed char: '`'
    // match[0] = '`code' (length 5), match[1] = 'code'
    // start = 5 - 5 = 0
    const b = makeBehavior('`code', { inputRules: rules });
    b.handleBeforeInput(makeEvent('insertText', '`'), makeSel(5));
    expect(b.container.delete).toHaveBeenCalledWith(0, 5);
    expect(b.container.insert).toHaveBeenCalledWith(0, 'code');
    expect(b.container.mark).toHaveBeenCalledWith({ start: 0, end: 4 }, 'code', true);
    expect(b.container.mark).toHaveBeenCalledTimes(1);
  });

  it('~~strike~~ — typed final "~" converts to strikethrough mark', () => {
    // text before cursor: '~~hit~', typed char: '~'
    // match[0] = '~~hit~' (length 6), match[1] = 'hit'
    // start = 6 - 6 = 0
    const b = makeBehavior('~~hit~', { inputRules: rules });
    b.handleBeforeInput(makeEvent('insertText', '~'), makeSel(6));
    expect(b.container.delete).toHaveBeenCalledWith(0, 6);
    expect(b.container.insert).toHaveBeenCalledWith(0, 'hit');
    expect(b.container.mark).toHaveBeenCalledWith({ start: 0, end: 3 }, 'strikethrough', true);
    expect(b.container.mark).toHaveBeenCalledTimes(1);
  });

  it('***bold-italic*** — typed final "*" applies both bold and italic marks', () => {
    // text before cursor: '***bi**', typed char: '*'
    // match[0] = '***bi**' (length 7), match[1] = 'bi'
    // start = 7 - 7 = 0
    const b = makeBehavior('***bi**', { inputRules: rules });
    b.handleBeforeInput(makeEvent('insertText', '*'), makeSel(7));
    expect(b.container.delete).toHaveBeenCalledWith(0, 7);
    expect(b.container.insert).toHaveBeenCalledWith(0, 'bi');
    expect(b.container.mark).toHaveBeenCalledWith({ start: 0, end: 2 }, 'bold', true);
    expect(b.container.mark).toHaveBeenCalledWith({ start: 0, end: 2 }, 'italic', true);
    expect(b.container.mark).toHaveBeenCalledTimes(2);
  });

  it('__bold__ — typed final "_" converts to bold mark', () => {
    // text before cursor: '__b_', typed char: '_'
    // match[0] = '__b_' (length 4), match[1] = 'b'
    // start = 4 - 4 = 0
    const b = makeBehavior('__b_', { inputRules: rules });
    b.handleBeforeInput(makeEvent('insertText', '_'), makeSel(4));
    expect(b.container.delete).toHaveBeenCalledWith(0, 4);
    expect(b.container.insert).toHaveBeenCalledWith(0, 'b');
    expect(b.container.mark).toHaveBeenCalledWith({ start: 0, end: 1 }, 'bold', true);
    expect(b.container.mark).toHaveBeenCalledTimes(1);
  });

  it('_italic_ — typed final "_" converts to italic mark', () => {
    // text before cursor: '_i', typed char: '_'
    // match[0] = '_i' (length 2), match[1] = 'i'
    // start = 2 - 2 = 0
    const b = makeBehavior('_i', { inputRules: rules });
    b.handleBeforeInput(makeEvent('insertText', '_'), makeSel(2));
    expect(b.container.delete).toHaveBeenCalledWith(0, 2);
    expect(b.container.insert).toHaveBeenCalledWith(0, 'i');
    expect(b.container.mark).toHaveBeenCalledWith({ start: 0, end: 1 }, 'italic', true);
    expect(b.container.mark).toHaveBeenCalledTimes(1);
  });

  it('guard: typing wrong char does not trigger rule', () => {
    // text before cursor: '**bold*', typed char: 'x' (not '*') — no rule should fire
    const b = makeBehavior('**bold*', { inputRules: rules });
    b.handleBeforeInput(makeEvent('insertText', 'x'), makeSel(7));
    // Normal insert happens instead
    expect(b.container.mark).not.toHaveBeenCalled();
    expect(b.container.delete).not.toHaveBeenCalled();
    expect(b.container.insert).toHaveBeenCalledWith(7, 'x');
  });

  it('no-false-positive: incomplete pattern does not trigger rule', () => {
    // text: '**bold' (no partial closing delimiter), typed char: '!' — no rule fires
    const b = makeBehavior('**bold', { inputRules: rules });
    b.handleBeforeInput(makeEvent('insertText', '!'), makeSel(6));
    expect(b.container.mark).not.toHaveBeenCalled();
    expect(b.container.delete).not.toHaveBeenCalled();
    expect(b.container.insert).toHaveBeenCalledWith(6, '!');
  });

  // ── P-09: ***x*** typed character by character ────────────────────────────

  /** Types `typed` one char at a time through the real input path; returns the behavior. Applied conversions rewrite the text. */
  function typeAll(typed, { rules: r = rules, start = '' } = {}) {
    // The mock container is static, so replay the states by hand: for each char, the text before the cursor is typed[0..i).
    const fired = [];
    for (let i = 0; i < typed.length; i++) {
      const b = makeBehavior(start + typed.slice(0, i), { inputRules: r });
      b.handleBeforeInput(makeEvent('insertText', typed[i]), makeSel((start + typed.slice(0, i)).length));
      fired.push({ i, converted: b.container.mark.mock.calls.length > 0, b });
    }
    return fired;
  }

  it('***both*** typed char by char: nothing fires before the 3rd closing "*", then bold+italic', () => {
    const fired = typeAll('***both***');
    // no conversion until the very last char (text before it: '***both**')
    expect(fired.slice(0, -1).some(f => f.converted)).toBe(false);
    const last = fired.at(-1).b;
    expect(last.container.delete).toHaveBeenCalledWith(0, 9);
    expect(last.container.insert).toHaveBeenCalledWith(0, 'both');
    expect(last.container.mark).toHaveBeenCalledWith({ start: 0, end: 4 }, 'bold', true);
    expect(last.container.mark).toHaveBeenCalledWith({ start: 0, end: 4 }, 'italic', true);
    expect(last.container.mark).toHaveBeenCalledTimes(2);
  });

  it('**bold** / *it* still work when typed char by char', () => {
    for (const [typed, inner, mark] of [['**bold**', 'bold', 'bold'], ['*it*', 'it', 'italic']]) {
      const fired = typeAll(typed);
      expect(fired.slice(0, -1).some(f => f.converted)).toBe(false);
      const last = fired.at(-1).b;
      expect(last.container.insert).toHaveBeenCalledWith(0, inner);
      expect(last.container.mark).toHaveBeenCalledWith({ start: 0, end: inner.length }, mark, true);
    }
  });

  it('the bold rule does not fire inside a longer asterisk run ("***x*" + "*")', () => {
    const b = makeBehavior('***x*', { inputRules: rules });
    b.handleBeforeInput(makeEvent('insertText', '*'), makeSel(5));
    expect(b.container.mark).not.toHaveBeenCalled();
    expect(b.container.insert).toHaveBeenCalledWith(5, '*');
  });

  // ── P-10: flanking rules / false positives ────────────────────────────────

  /** Whether typing `char` after `text` (cursor at the end, or at `cursor`) converts something. */
  function converts(text, char, cursor = text.length) {
    const b = makeBehavior(text, { inputRules: rules });
    b.handleBeforeInput(makeEvent('insertText', char), makeSel(cursor));
    return b.container.mark.mock.calls.length > 0;
  }

  it('whitespace-flanked asterisks stay literal ("2 * 3 * 4", "* not *")', () => {
    expect(converts('2 * 3 ', '*')).toBe(false);
    expect(converts('* not ', '*')).toBe(false);
    expect(converts('* not', '*')).toBe(false);   // opener followed by whitespace
    expect(converts('** not *', '*')).toBe(false);
    expect(converts('**bold *', '*')).toBe(false); // closer preceded by whitespace
    expect(converts('~~ x~', '~')).toBe(false);
    expect(converts('~~x ~', '~')).toBe(false);
    expect(converts('_ x', '_')).toBe(false);
    expect(converts('_x ', '_')).toBe(false);
  });

  it('"*" is allowed intraword (CommonMark): "a*b" + "*" -> italic b', () => {
    expect(converts('a*b', '*')).toBe(true);
  });

  it('"_" never opens or closes intraword', () => {
    expect(converts('snake_case', '_')).toBe(false);        // intraword opener
    expect(converts('foo__bar_', '_')).toBe(false);         // intraword "__" opener
    expect(converts('_it', '_', 3)).toBe(true);
    expect(converts('x _it', '_')).toBe(true);              // opener after a space
    expect(converts('(_it', '_')).toBe(true);               // opener after punctuation
    expect(converts('__bold_', '_')).toBe(true);
    expect(converts('x __bold_', '_')).toBe(true);
  });

  it('"_" does not close when a letter/digit follows the cursor (intraword closer)', () => {
    // "_it|abc": typing "_" would close in the middle of a word
    expect(converts('_itabc', '_', 3)).toBe(false);
    // …but before whitespace / punctuation / end it does
    expect(converts('_it y', '_', 3)).toBe(true);
    expect(converts('_it.', '_', 3)).toBe(true);
  });

  it('snake_case_name typed char by char never converts', () => {
    expect(typeAll('snake_case_name').some(f => f.converted)).toBe(false);
  });

  it('`code` keeps inner spaces but needs a non-space char and no longer backtick run', () => {
    expect(converts('`a b', '`')).toBe(true);
    expect(converts('`', '`')).toBe(false);       // empty
    expect(converts('`  ', '`')).toBe(false);     // spaces only
    expect(converts('``x', '`')).toBe(false);     // inside a run of backticks
  });
});

describe('TypographyExtension', () => {
  const rules = TypographyExtension.inputRules;
  const type = (text, data = ' ') => {
    const b = makeBehavior(text, { inputRules: rules });
    b.handleBeforeInput(makeEvent('insertText', data), makeSel(text.length));
    return b;
  };

  it('"-- " after a word becomes an em dash', () => {
    const b = type('abc --');
    expect(b.container.delete).toHaveBeenCalledWith(4, 2);
    expect(b.container.insert).toHaveBeenCalledWith(4, '— ');
  });

  it('"--- " is left alone (the "--" is preceded by another "-")', () => {
    const b = type('abc ---');
    expect(b.container.delete).not.toHaveBeenCalled();
    expect(b.container.insert).toHaveBeenCalledWith(7, ' ');
  });

  it('"--" followed by a non-space char keeps the double dash', () => {
    const b = type('abc --', 'h');
    expect(b.container.delete).not.toHaveBeenCalled();
  });
});
