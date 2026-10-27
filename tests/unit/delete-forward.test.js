// @ts-nocheck — mocks intentionally implement only the surface TextBehavior uses
/**
 * Unit tests for TextBehavior `deleteContentForward` (the Delete key): one user-perceived character mid-text,
 * a selection inside one block, end-of-block merge, no-op at the end of the last block.
 */

import { describe, it, expect, vi } from 'vitest';
import { TextBehavior, nextGraphemeLength } from '#lib/behaviors/text/text.behavior.svelte.js';

/** Mock LoroText over a real string: `delete` really edits it, so assertions read the resulting text. */
function makeContainer(initial = '') {
  const c = {
    text: initial,
    toString: () => c.text,
    get length() { return c.text.length; },
    toDelta: () => (c.text ? [{ insert: c.text }] : []),
    insert: vi.fn(),
    delete: vi.fn((index, length) => { c.text = c.text.slice(0, index) + c.text.slice(index + length); }),
    mark: vi.fn(), unmark: vi.fn(), subscribe: vi.fn(), applyDelta: vi.fn(),
    sliceDelta: vi.fn(() => []),
  };
  return c;
}

function makeBehavior(text = '', { next = null } = {}) {
  const container = makeContainer(text);
  const block = {
    nabu: {
      hooks: new Map(), warn: vi.fn(), selection: { setCursor: vi.fn() },
      BREAK: Symbol('break'), inputRules: [{ pattern: /./, handler: vi.fn(() => true) }],
    },
    node: { data: { get: (k) => k === 'text' ? container : null, setContainer: () => container } },
    element: null, behaviors: new Map(), selected: false,
    commit: vi.fn(), ascend: vi.fn(), findBackward: vi.fn(),
    findForward: vi.fn(() => next), consume: vi.fn(), destroy: vi.fn(), type: 'paragraph',
  };
  const behavior = new TextBehavior(block, container);
  block.behaviors.set('text', behavior);
  return { behavior, container, block };
}

const sel = (from, to = from) => ({ from, to, isCollapsed: from === to });
const forward = () => ({ inputType: 'deleteContentForward', preventDefault: vi.fn() });

describe('Delete (deleteContentForward)', () => {
  it('mid-text deletes the next character', () => {
    const { behavior, container, block } = makeBehavior('abcdef');
    const e = forward();
    behavior.handleDeleteContentForward(e, sel(3));
    expect(container.text).toBe('abcef');
    expect(e.preventDefault).toHaveBeenCalled();
    expect(block.commit).toHaveBeenCalledTimes(1);
  });

  it('at the start deletes the first character', () => {
    const { behavior, container } = makeBehavior('abc');
    behavior.handleDeleteContentForward(forward(), sel(0));
    expect(container.text).toBe('bc');
  });

  it('with a selection inside the block deletes the selection', () => {
    const { behavior, container } = makeBehavior('abcdef');
    behavior.handleDeleteContentForward(forward(), sel(1, 4));
    expect(container.text).toBe('aef');
  });

  it('places the caret at the same offset and never runs input rules', async () => {
    const { behavior, block } = makeBehavior('abcdef');
    behavior.handleDeleteContentForward(forward(), sel(2));
    await Promise.resolve(); await new Promise(r => setTimeout(r, 0));
    expect(block.nabu.selection.setCursor).toHaveBeenCalledWith(block, 2);
    expect(block.nabu.inputRules[0].handler).not.toHaveBeenCalled();
  });

  it('end of the last block: no-op, no error, nothing committed', () => {
    const { behavior, container, block } = makeBehavior('abc');
    expect(() => behavior.handleDeleteContentForward(forward(), sel(3))).not.toThrow();
    expect(container.text).toBe('abc');
    expect(block.commit).not.toHaveBeenCalled();
  });

  it('end of a block with a text block after it still merges', () => {
    const nextBlock = { behaviors: new Map(), destroy: vi.fn() };
    nextBlock.behaviors.set('text', Object.assign(Object.create(TextBehavior.prototype), { block: nextBlock }));
    const { behavior, container, block } = makeBehavior('abc', { next: nextBlock });
    const e = forward();
    behavior.handleDeleteContentForward(e, sel(3));
    expect(block.consume).toHaveBeenCalledWith(nextBlock);
    expect(container.text).toBe('abc');
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it.each([
    ['family emoji (ZWJ)', '👨‍👩‍👧'],
    ['flag', '🇫🇷'],
    ['e + combining acute', 'é'],
    ['surrogate pair', '𝒳'],
  ])('one press deletes a whole %s', (_name, glyph) => {
    const { behavior, container } = makeBehavior('a' + glyph + 'b');
    behavior.handleDeleteContentForward(forward(), sel(1));
    expect(container.text).toBe('ab');
  });

  it('nextGraphemeLength: 0 at/after the end, clusters measured from their start, caret inside a cluster', () => {
    expect(nextGraphemeLength('abc', 3)).toBe(0);
    expect(nextGraphemeLength('abc', 0)).toBe(1);
    expect(nextGraphemeLength('👨‍👩‍👧', 0)).toBe('👨‍👩‍👧'.length);
    expect(nextGraphemeLength('𝒳', 1)).toBe(1); // between the two surrogates: up to the end of the pair
  });
});
