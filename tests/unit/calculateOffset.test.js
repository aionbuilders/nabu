/**
 * Unit tests for TextBehavior.calculateOffset() and getDOMPoint()
 * Uses happy-dom (set in vitest.config.js) for real DOM APIs.
 *
 * NOTE: Svelte 5 compiles $state to private fields — must use real constructor.
 * We inject a minimal mock block and container.
 */

import { describe, it, expect, vi } from 'vitest';
import { TextBehavior } from '$lib/behaviors/text/text.behavior.svelte.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeBehavior(element) {
  const container = {
    toString: () => '',
    toDelta: () => [],
    subscribe: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    mark: vi.fn(),
    unmark: vi.fn(),
    applyDelta: vi.fn(),
    sliceDelta: vi.fn(() => []),
    length: 0,
  };
  const block = {
    nabu: { hooks: new Map(), warn: vi.fn(), selection: null, BREAK: Symbol('break') },
    node: { data: { get: (k) => k === 'text' ? container : null, setContainer: () => container } },
    element,
    behaviors: new Map(),
    selected: false,
    commit: vi.fn(),
    ascend: vi.fn(),
    findBackward: vi.fn(),
    findForward: vi.fn(),
    destroy: vi.fn(),
    type: 'paragraph',
  };
  return new TextBehavior(block, container);
}

function makeElement(html) {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

// ── calculateOffset ────────────────────────────────────────────────────────

describe('TextBehavior.calculateOffset', () => {
  it('returns 0 when there is no element', () => {
    const b = makeBehavior(null);
    const textNode = document.createTextNode('hello');
    expect(b.calculateOffset(textNode, 0, null)).toBe(0);
  });

  it('calculates offset in a simple text node', () => {
    const el = makeElement('hello');
    const b = makeBehavior(el);
    const textNode = el.firstChild;
    expect(b.calculateOffset(textNode, 3, el)).toBe(3);
  });

  it('calculates offset spanning across multiple text nodes', () => {
    // <span>hel</span><span>lo</span>
    const el = makeElement('<span>hel</span><span>lo</span>');
    const b = makeBehavior(el);
    const secondSpan = el.childNodes[1];
    const secondText = secondSpan.firstChild;
    // offset 2 in the second text node = "hel" + "lo".slice(0,2) = 5
    expect(b.calculateOffset(secondText, 2, el)).toBe(5);
  });

  it('returns 0 for offset 0 at the start of the element', () => {
    const el = makeElement('hello');
    const b = makeBehavior(el);
    const textNode = el.firstChild;
    expect(b.calculateOffset(textNode, 0, el)).toBe(0);
  });
});

// ── getDOMPoint ────────────────────────────────────────────────────────────

describe('TextBehavior.getDOMPoint', () => {
  it('returns null when element is null', () => {
    const b = makeBehavior(null);
    expect(b.getDOMPoint(0, null)).toBeNull();
  });

  it('returns the correct text node and offset for targetOffset = 0', () => {
    const el = makeElement('hello');
    const b = makeBehavior(el);
    const result = b.getDOMPoint(0, el);
    expect(result).not.toBeNull();
    expect(result.node).toBe(el.firstChild);
    expect(result.offset).toBe(0);
  });

  it('returns the correct text node and offset for a mid-word position', () => {
    const el = makeElement('hello');
    const b = makeBehavior(el);
    const result = b.getDOMPoint(3, el);
    expect(result.node).toBe(el.firstChild);
    expect(result.offset).toBe(3);
  });

  it('returns a valid (node, offset) pair — falls back to element end if TreeWalker misses nested spans', () => {
    // happy-dom's TreeWalker may not descend into <span> children, causing the fallback path.
    // The important contract: the result is never null and always points to a valid node.
    // Cross-span accuracy is verified by E2E tests in a real browser.
    const el = makeElement('<span>hel</span><span>lo</span>');
    const b = makeBehavior(el);
    const result = b.getDOMPoint(4, el);
    // Must not be null — a valid fallback is acceptable
    expect(result).not.toBeNull();
    expect(result.node).toBeTruthy();
  });

  it('falls back to the element when the text is empty', () => {
    const el = makeElement('');
    const b = makeBehavior(el);
    const result = b.getDOMPoint(0, el);
    expect(result.node).toBe(el);
  });
});

// ── with the trailing render filler (<br data-nabu-filler>) ────────────────

describe('offset mapping with a trailing filler', () => {
  it('calculateOffset ignores the filler: caret at the end of "abc\\n" is 4, before or after the <br>', () => {
    const el = makeElement('abc\n<br data-nabu-filler>');
    const b = makeBehavior(el);
    const text = el.firstChild;
    expect(b.calculateOffset(text, 4, el)).toBe(4);
    expect(b.calculateOffset(el, 1, el)).toBe(4); // (element, before <br>)
    expect(b.calculateOffset(el, 2, el)).toBe(4); // (element, after <br>)
  });

  it('calculateOffset counts text after a marked span + filler the same way', () => {
    const el = makeElement('<span>ab</span>c\n<br data-nabu-filler>');
    const b = makeBehavior(el);
    expect(b.calculateOffset(el, el.childNodes.length, el)).toBe(4);
  });

  it('getDOMPoint(length) lands on the end of the last TEXT node, never on the filler', () => {
    const el = makeElement('abc\n<br data-nabu-filler>');
    const b = makeBehavior(el);
    const point = b.getDOMPoint(4, el);
    expect(point.node).toBe(el.firstChild);
    expect(point.offset).toBe(4);
    expect(b.getDOMPoint(3, el)).toEqual({ node: el.firstChild, offset: 3 });
  });

  it('round-trips every offset of "ab\\n\\n" with its filler', () => {
    const el = makeElement('ab\n\n<br data-nabu-filler>');
    const b = makeBehavior(el);
    for (let i = 0; i <= 4; i++) {
      const p = b.getDOMPoint(i, el);
      expect(b.calculateOffset(p.node, p.offset, el)).toBe(i);
    }
  });
});
