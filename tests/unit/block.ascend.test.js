/**
 * Unit tests for Block.ascend()
 *
 * NOTE: Svelte 5 compiles $state/$derived class fields to private fields.
 * We must call `new Block(nabu, node)` (not Object.create) to initialise them.
 */

import { describe, it, expect, vi } from 'vitest';
import { Block } from '$lib/blocks/block.svelte.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeNabu(hooks = new Map()) {
  return {
    blocks: new Map(),
    blocksByType: new Map(),
    hooks,
    warn: vi.fn(),
  };
}

function makeNode(id = 'n1') {
  return {
    id: { toString: () => id },
    data: { get: () => null },
    parent: () => null,
    index: () => 0,
  };
}

/** Create a real Block instance, then inject a mock parent via the setter. */
function makeBlock({ parent = null, nabu = makeNabu() } = {}) {
  const block = new Block(nabu, makeNode());
  if (parent) block.parent = parent;
  return block;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Block.ascend', () => {
  it('calls the matching method on the parent and returns its result', () => {
    const parent = { onSplit: vi.fn().mockReturnValue({ block: 'newBlock' }) };
    const block = makeBlock({ parent });

    const result = block.ascend('onSplit', null, { offset: 3 });

    expect(parent.onSplit).toHaveBeenCalledWith(null, { offset: 3, from: block });
    expect(result).toEqual({ block: 'newBlock' });
  });

  it('falls back to nabu hooks when parent has no matching method', () => {
    const parent = {}; // no onSplit
    const hookFn = vi.fn().mockReturnValue('handled');
    const nabu = makeNabu(new Map([['onSplit', [hookFn]]]));
    const block = makeBlock({ parent, nabu });

    const result = block.ascend('onSplit', null, { offset: 0 });

    expect(hookFn).toHaveBeenCalledWith(nabu, block, null, { offset: 0 });
    expect(result).toBe('handled');
  });

  it('returns false when no parent and no hooks match', () => {
    const nabu = makeNabu(new Map());
    const block = makeBlock({ parent: null, nabu });

    expect(block.ascend('onSplit', null, {})).toBe(false);
  });

  it('tries hooks when parent is null', () => {
    const hookFn = vi.fn().mockReturnValue(null); // returns falsy
    const nabu = makeNabu(new Map([['onSplit', [hookFn]]]));
    const block = makeBlock({ parent: null, nabu });

    const result = block.ascend('onSplit', null, {});

    expect(hookFn).toHaveBeenCalled();
    expect(result).toBe(false); // all hooks returned falsy
  });

  it('stops iterating hooks after the first truthy result', () => {
    const hook1 = vi.fn().mockReturnValue('first');
    const hook2 = vi.fn().mockReturnValue('second');
    const nabu = makeNabu(new Map([['onSplit', [hook1, hook2]]]));
    const block = makeBlock({ parent: null, nabu });

    const result = block.ascend('onSplit', null, {});

    expect(hook1).toHaveBeenCalled();
    expect(hook2).not.toHaveBeenCalled();
    expect(result).toBe('first');
  });

  it('passes the correct `from` in the data when calling parent method', () => {
    const parent = { onFoo: vi.fn().mockReturnValue(true) };
    const block = makeBlock({ parent });

    block.ascend('onFoo', null, { custom: 'val' });

    const callArg = parent.onFoo.mock.calls[0][1];
    expect(callArg.from).toBe(block);
    expect(callArg.custom).toBe('val');
  });

  it('works with an event object passed through', () => {
    const fakeEvent = { type: 'keydown', preventDefault: vi.fn() };
    const parent = { onKeydown: vi.fn().mockReturnValue(true) };
    const block = makeBlock({ parent });

    block.ascend('onKeydown', fakeEvent, {});

    expect(parent.onKeydown).toHaveBeenCalledWith(fakeEvent, { from: block });
  });
});
