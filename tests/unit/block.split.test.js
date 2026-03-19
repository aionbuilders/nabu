/**
 * Unit tests for Block.split() and TextBehavior.split().
 * split() delegates to behavior.split() which calls block.ascend("onSplit").
 * We verify the delegation chain without constructing real blocks.
 */

import { describe, it, expect, vi } from 'vitest';
import { Block } from '$lib/blocks/block.svelte.js';
import { TextBehavior } from '$lib/behaviors/text/text.behavior.svelte.js';

// ── Block.split base (warns, returns null) ─────────────────────────────────

describe('Block.split (base class)', () => {
  it('logs a warning and returns null', () => {
    const nabu = { warn: vi.fn(), hooks: new Map() };
    const block = Object.create(Block.prototype);
    block.id = 'test';
    block.nabu = nabu;

    const result = block.split({ offset: 3 });
    expect(result).toBeNull();
    expect(nabu.warn).toHaveBeenCalled();
  });
});

// ── TextBehavior.split delegates to block.ascend ──────────────────────────

describe('TextBehavior.split', () => {
  function makeBehavior(text = 'hello world') {
    const delta = [{ insert: text }];
    const container = {
      length: text.length,
      toString: () => text,
      toDelta: () => [...delta],
      sliceDelta: vi.fn((from, to) => [{ insert: text.slice(from, to) }]),
      subscribe: vi.fn(),
      insert: vi.fn(),
      delete: vi.fn(),
      mark: vi.fn(),
      unmark: vi.fn(),
      applyDelta: vi.fn(),
    };
    const ascend = vi.fn().mockReturnValue({ block: 'newBlock' });
    const block = {
      nabu: { hooks: new Map(), warn: vi.fn(), selection: null, BREAK: Symbol('break') },
      node: { data: { get: (k) => k === 'text' ? container : null, setContainer: () => container } },
      element: null,
      behaviors: new Map(),
      selected: false,
      commit: vi.fn(),
      ascend,
      findBackward: vi.fn(),
      findForward: vi.fn(),
      destroy: vi.fn(),
      type: 'paragraph',
    };
    // Call actual constructor — initialises Svelte-compiled private fields
    const behavior = new TextBehavior(block, container);
    return { behavior, block, container };
  }

  it('calls block.ascend("onSplit") with offset and sliceDelta', () => {
    const { behavior, block } = makeBehavior('hello world');
    const sel = { from: 5, to: 11, isCollapsed: false };

    behavior.split({ offset: 5 }, sel);

    expect(block.ascend).toHaveBeenCalledWith('onSplit', null, {
      offset: 5,
      delta: expect.any(Array),
    });
  });

  it('uses selection.from when no options provided', () => {
    const { behavior, block } = makeBehavior('hello');
    const sel = { from: 2, to: 5, isCollapsed: false };

    behavior.split(undefined, sel);

    const callData = block.ascend.mock.calls[0][2];
    expect(callData.offset).toBe(2);
  });

  it('returns null when selection is null', () => {
    const { behavior } = makeBehavior('hello');
    expect(behavior.split({}, null)).toBeNull();
  });

  it('passes the sliced delta from the split point', () => {
    const { behavior, container } = makeBehavior('hello world');
    const sel = { from: 5, to: 11, isCollapsed: false };

    behavior.split({ offset: 5 }, sel);

    expect(container.sliceDelta).toHaveBeenCalledWith(5, 5);
  });
});
