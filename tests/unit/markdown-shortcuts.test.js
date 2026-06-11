// @ts-nocheck — mocks intentionally implement only the surface TextBehavior uses
/**
 * Unit tests for the MarkdownShortcutsExtension input rules.
 * Each test sets the block text to the pre-trigger state and fires an
 * insertText event with the closing delimiter as `data`.
 */

import { describe, it, expect, vi } from 'vitest';
import { TextBehavior } from '$lib/behaviors/text/text.behavior.svelte.js';
import { MarkdownShortcutsExtension } from '$lib/behaviors/text/markdown-shortcuts.extension.js';

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
});
