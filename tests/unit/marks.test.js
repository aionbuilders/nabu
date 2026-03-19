/**
 * Unit tests for TextBehavior mark methods:
 * isMarkActive, applyMark, removeMark, toggleMark
 *
 * NOTE: Svelte 5 compiles $state in .svelte.js files to private fields.
 * We must call `new TextBehavior(block, container)` to initialise them.
 */

import { describe, it, expect, vi } from 'vitest';
import { TextBehavior } from '$lib/behaviors/text/text.behavior.svelte.js';

// ── Mock LoroText container ────────────────────────────────────────────────

function makeContainer(delta = []) {
  let _delta = [...delta];
  return {
    toString: () => _delta.map(op => op.insert).join(''),
    get length() { return _delta.map(op => op.insert ?? '').join('').length; },
    toDelta: () => [..._delta],
    insert: vi.fn((index, text) => {
      // Simple mock: just track calls
    }),
    delete: vi.fn(),
    mark: vi.fn((range, name, value) => {
      // Apply mark to delta ops in range (simplified)
      _delta = _delta.map(op => {
        if (typeof op.insert !== 'string') return op;
        return { ...op, attributes: { ...op.attributes, [name]: value } };
      });
    }),
    unmark: vi.fn((range, name) => {
      _delta = _delta.map(op => {
        if (typeof op.insert !== 'string') return op;
        const attrs = { ...op.attributes };
        delete attrs[name];
        return { ...op, attributes: Object.keys(attrs).length ? attrs : undefined };
      });
    }),
    subscribe: vi.fn(),
    applyDelta: vi.fn(),
    sliceDelta: vi.fn(() => []),
  };
}

/** Build a TextBehavior using the real constructor. */
function makeBehavior(delta = []) {
  const container = makeContainer(delta);
  const block = {
    nabu: { hooks: new Map(), warn: vi.fn(), selection: null, BREAK: Symbol('break') },
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
  // Call actual constructor — initialises Svelte-compiled private fields
  return new TextBehavior(block, container);
}

function makeSel(from, to) {
  return { from, to, isCollapsed: from === to };
}

// ── isMarkActive ───────────────────────────────────────────────────────────

describe('TextBehavior.isMarkActive', () => {
  it('returns false for a collapsed selection', () => {
    const b = makeBehavior([{ insert: 'hello' }]);
    expect(b.isMarkActive('bold', makeSel(2, 2))).toBe(false);
  });

  it('returns false when no ops in range have the mark', () => {
    const b = makeBehavior([{ insert: 'hello world' }]);
    expect(b.isMarkActive('bold', makeSel(0, 5))).toBe(false);
  });

  it('returns true when all ops in range have the mark', () => {
    const b = makeBehavior([{ insert: 'hello', attributes: { bold: true } }]);
    expect(b.isMarkActive('bold', makeSel(0, 5))).toBe(true);
  });

  it('returns false when only part of the selection has the mark', () => {
    const b = makeBehavior([
      { insert: 'he' },
      { insert: 'llo', attributes: { bold: true } },
    ]);
    expect(b.isMarkActive('bold', makeSel(0, 5))).toBe(false);
  });

  it('returns false for null selection', () => {
    const b = makeBehavior([{ insert: 'hello' }]);
    expect(b.isMarkActive('bold', null)).toBe(false);
  });
});

// ── applyMark ──────────────────────────────────────────────────────────────

describe('TextBehavior.applyMark', () => {
  it('calls container.mark with the correct range and value', () => {
    const b = makeBehavior([{ insert: 'hello' }]);
    const sel = makeSel(1, 4);
    b.applyMark('bold', true, sel);
    expect(b.container.mark).toHaveBeenCalledWith({ start: 1, end: 4 }, 'bold', true);
  });

  it('does nothing for a collapsed selection', () => {
    const b = makeBehavior([{ insert: 'hello' }]);
    b.applyMark('bold', true, makeSel(2, 2));
    expect(b.container.mark).not.toHaveBeenCalled();
  });

  it('does nothing for null selection', () => {
    const b = makeBehavior([{ insert: 'hello' }]);
    b.applyMark('bold', true, null);
    expect(b.container.mark).not.toHaveBeenCalled();
  });
});

// ── removeMark ─────────────────────────────────────────────────────────────

describe('TextBehavior.removeMark', () => {
  it('calls container.unmark with the correct range', () => {
    const b = makeBehavior([{ insert: 'hello', attributes: { bold: true } }]);
    b.removeMark('bold', makeSel(0, 5));
    expect(b.container.unmark).toHaveBeenCalledWith({ start: 0, end: 5 }, 'bold');
  });

  it('does nothing for collapsed selection', () => {
    const b = makeBehavior([{ insert: 'hello' }]);
    b.removeMark('bold', makeSel(2, 2));
    expect(b.container.unmark).not.toHaveBeenCalled();
  });
});

// ── toggleMark ─────────────────────────────────────────────────────────────

describe('TextBehavior.toggleMark', () => {
  it('applies mark when not active', () => {
    const b = makeBehavior([{ insert: 'hello' }]);
    const sel = makeSel(0, 5);
    b.toggleMark('bold', true, sel);
    expect(b.container.mark).toHaveBeenCalled();
    expect(b.container.unmark).not.toHaveBeenCalled();
  });

  it('removes mark when already active', () => {
    const b = makeBehavior([{ insert: 'hello', attributes: { bold: true } }]);
    const sel = makeSel(0, 5);
    // isMarkActive should return true for this delta + sel
    b.toggleMark('bold', true, sel);
    expect(b.container.unmark).toHaveBeenCalled();
    expect(b.container.mark).not.toHaveBeenCalled();
  });
});
