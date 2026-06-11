// @ts-nocheck — mocks intentionally implement only the surface TextBehavior uses
/**
 * Unit tests for TextBehavior word/line deletion inputTypes
 * (deleteWordBackward, deleteWordForward, deleteSoftLineBackward — issue #4)
 * and the declarative input rules system (TÂCHE 2).
 */

import { describe, it, expect, vi } from 'vitest';
import { TextBehavior } from '$lib/behaviors/text/text.behavior.svelte.js';
import { TypographyExtension } from '$lib/behaviors/text/typography.extension.js';

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

// ── deleteWordBackward ─────────────────────────────────────────────────────

describe('TextBehavior deleteWordBackward', () => {
  it('deletes the word AND its surrounding whitespace (issue #4)', () => {
    // "this is a sentence " with cursor at the end → "this is a"
    const b = makeBehavior('this is a sentence ');
    b.handleBeforeInput(makeEvent('deleteWordBackward'), makeSel(19));
    expect(b.container.delete).toHaveBeenCalledWith(9, 10); // " sentence "
  });

  it('deletes the previous word with its leading space mid-text', () => {
    const b = makeBehavior('hello world');
    b.handleBeforeInput(makeEvent('deleteWordBackward'), makeSel(11));
    expect(b.container.delete).toHaveBeenCalledWith(5, 6); // " world"
  });

  it('does nothing at offset 0', () => {
    const b = makeBehavior('hello');
    b.handleBeforeInput(makeEvent('deleteWordBackward'), makeSel(0));
    expect(b.container.delete).not.toHaveBeenCalled();
  });

  it('deletes the selection when not collapsed', () => {
    const b = makeBehavior('hello world');
    b.handleBeforeInput(makeEvent('deleteWordBackward'), makeSel(2, 7));
    expect(b.container.delete).toHaveBeenCalledWith(2, 5);
  });
});

// ── deleteWordForward ──────────────────────────────────────────────────────

describe('TextBehavior deleteWordForward', () => {
  it('deletes the next word including leading + trailing whitespace', () => {
    const b = makeBehavior('hello world after');
    b.handleBeforeInput(makeEvent('deleteWordForward'), makeSel(5));
    expect(b.container.delete).toHaveBeenCalledWith(5, 7); // " world "
  });

  it('does nothing at end of text', () => {
    const b = makeBehavior('hello');
    b.handleBeforeInput(makeEvent('deleteWordForward'), makeSel(5));
    expect(b.container.delete).not.toHaveBeenCalled();
  });
});

// ── deleteSoftLineBackward ─────────────────────────────────────────────────

describe('TextBehavior deleteSoftLineBackward', () => {
  it('deletes from the start of the current soft line to the cursor', () => {
    const b = makeBehavior('line1\nline2');
    b.handleBeforeInput(makeEvent('deleteSoftLineBackward'), makeSel(11));
    expect(b.container.delete).toHaveBeenCalledWith(6, 5); // "line2"
  });

  it('deletes from the start of the text when there is no newline', () => {
    const b = makeBehavior('hello');
    b.handleBeforeInput(makeEvent('deleteSoftLineBackward'), makeSel(3));
    expect(b.container.delete).toHaveBeenCalledWith(0, 3);
  });
});

// ── Input rules ────────────────────────────────────────────────────────────

describe('Input rules', () => {
  it('fires a matching rule and swallows the typed text', () => {
    const handler = vi.fn(() => true);
    const b = makeBehavior('abc', { inputRules: [{ pattern: /c$/, handler }] });
    const result = b.handleBeforeInput(makeEvent('insertText', 'x'), makeSel(3));
    expect(handler).toHaveBeenCalled();
    expect(result).toBe(true);
    expect(b.container.insert).not.toHaveBeenCalled();
  });

  it('falls through to normal insertion when no rule matches', () => {
    const b = makeBehavior('abc', { inputRules: [{ pattern: /z$/, handler: vi.fn(() => true) }] });
    b.handleBeforeInput(makeEvent('insertText', 'x'), makeSel(3));
    expect(b.container.insert).toHaveBeenCalledWith(3, 'x');
  });

  it('typography rule converts "-- " into "— "', () => {
    const b = makeBehavior('a--', { inputRules: TypographyExtension.inputRules });
    b.handleBeforeInput(makeEvent('insertText', ' '), makeSel(3));
    expect(b.container.delete).toHaveBeenCalledWith(1, 2);
    expect(b.container.insert).toHaveBeenCalledWith(1, '— ');
  });

  it('typography rule does not fire for non-space characters', () => {
    const b = makeBehavior('a--', { inputRules: TypographyExtension.inputRules });
    b.handleBeforeInput(makeEvent('insertText', 'h'), makeSel(3));
    expect(b.container.delete).not.toHaveBeenCalled();
    expect(b.container.insert).toHaveBeenCalledWith(3, 'h');
  });
});
