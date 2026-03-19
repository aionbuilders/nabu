/**
 * Unit tests for container.utils.js
 * Pure functions: findDirectChildOf, findLCA, wrapOrphan
 * No Svelte runes needed — plain JS objects.
 */

import { describe, it, expect, vi } from 'vitest';
import { findDirectChildOf, findLCA, wrapOrphan } from '$lib/blocks/container.utils.js';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal fake block tree for testing. */
function makeBlock(id, parent = null) {
  return { id, parent, children: [] };
}

function link(parent, ...children) {
  children.forEach((child, i) => {
    child.parent = parent;
    child.index = i;
    parent.children.push(child);
  });
}

// ── findDirectChildOf ─────────────────────────────────────────────────────

describe('findDirectChildOf', () => {
  it('returns the block itself when it is a direct child of container', () => {
    const container = makeBlock('root');
    const child = makeBlock('child', container);
    expect(findDirectChildOf(child, container)).toBe(child);
  });

  it('returns the top-level child when the block is deeply nested', () => {
    const root = makeBlock('root');
    const list = makeBlock('list', root);
    const item = makeBlock('item', list);
    const para = makeBlock('para', item);
    // The direct child of root that contains para is list
    expect(findDirectChildOf(para, root)).toBe(list);
  });

  it('returns the block when container is its immediate parent', () => {
    const root = makeBlock('root');
    const block = makeBlock('block', root);
    expect(findDirectChildOf(block, root)).toBe(block);
  });

  it('returns null if the block has no parent (root-level block with no container match)', () => {
    // block has no parent — loop terminates early; spine.at(-1) is not container
    // and spine.at(-2) is undefined → returns null
    const block = makeBlock('orphan');
    const unrelated = makeBlock('other');
    const result = findDirectChildOf(block, unrelated);
    // Spine = [block], loop breaks immediately (no parent), spine.at(-1) !== container
    // → returns spine.at(-1) = block (the fallback in source)
    expect(result).toBe(block);
  });
});

// ── findLCA ────────────────────────────────────────────────────────────────

describe('findLCA', () => {
  it('returns parent when two blocks are siblings', () => {
    const root = makeBlock('root');
    const a = makeBlock('a', root);
    const b = makeBlock('b', root);
    expect(findLCA(a, b)).toBe(root);
  });

  it('returns null for two root-level blocks (no shared non-nabu ancestor)', () => {
    const a = makeBlock('a');
    const b = makeBlock('b');
    expect(findLCA(a, b)).toBeNull();
  });

  it('returns the container when one block is nested inside it and the other is a direct child', () => {
    const root = makeBlock('root');
    const list = makeBlock('list', root);
    const item = makeBlock('item', list);
    // LCA(list, item) = list (list is an ancestor of item)
    expect(findLCA(list, item)).toBe(list);
  });

  it('returns the common parent for two blocks in different nested containers', () => {
    //         root
    //        /    \
    //      listA  listB
    //       |      |
    //     itemA  itemB
    const root = makeBlock('root');
    const listA = makeBlock('listA', root);
    const listB = makeBlock('listB', root);
    const itemA = makeBlock('itemA', listA);
    const itemB = makeBlock('itemB', listB);
    expect(findLCA(itemA, itemB)).toBe(root);
  });

  it('returns parent when a block is compared with itself', () => {
    const parent = makeBlock('parent');
    const a = makeBlock('a', parent);
    expect(findLCA(a, a)).toBe(parent);
  });

  it('returns null when identical blocks have no parent', () => {
    const a = makeBlock('a');
    expect(findLCA(a, a)).toBeNull();
  });
});

// ── wrapOrphan ─────────────────────────────────────────────────────────────

describe('wrapOrphan', () => {
  function makeNabu(registryMap = {}) {
    return {
      registry: { get: (type) => registryMap[type] ?? null },
      tree: { move: vi.fn() },
      warn: vi.fn(),
    };
  }

  it('does nothing when block has no requiredParent', () => {
    const nabu = makeNabu();
    const block = {
      requiredParent: null,
      node: { parent: () => null, id: '1', index: () => 0 },
    };
    const result = wrapOrphan(nabu, block);
    expect(result).toBeUndefined();
    expect(nabu.tree.move).not.toHaveBeenCalled();
  });

  it('does nothing when block already has the required parent type', () => {
    const nabu = makeNabu();
    const block = {
      requiredParent: { type: 'list', props: () => ({}) },
      node: {
        parent: () => ({ data: { get: () => 'list' }, id: { toString: () => 'list1' } }),
        id: '2',
        index: () => 0,
      },
    };
    const result = wrapOrphan(nabu, block);
    expect(result).toBeUndefined();
    expect(nabu.tree.move).not.toHaveBeenCalled();
  });

  it('creates a wrapper and moves the block when parent type does not match', () => {
    const wrapper = { node: { id: 'wrapper1' } };
    const WrapperClass = { create: vi.fn().mockReturnValue(wrapper) };
    const nabu = makeNabu({ list: WrapperClass });

    const block = {
      requiredParent: { type: 'list', props: () => ({ listType: 'bullet' }) },
      node: {
        parent: () => ({
          data: { get: () => 'paragraph' },
          id: { toString: () => 'para1' },
        }),
        id: '3',
        index: () => 1,
      },
    };

    const result = wrapOrphan(nabu, block);
    expect(WrapperClass.create).toHaveBeenCalledWith(nabu, 'list', { listType: 'bullet' }, 'para1', 1);
    expect(nabu.tree.move).toHaveBeenCalledWith('3', 'wrapper1');
    expect(result).toBe(wrapper);
  });

  it('warns and returns undefined if the required type is not registered', () => {
    const nabu = makeNabu({}); // no registry entries
    const block = {
      requiredParent: { type: 'list', props: () => ({}) },
      node: {
        parent: () => ({ data: { get: () => 'root' }, id: { toString: () => 'root1' } }),
        id: '4',
        index: () => 0,
      },
    };
    const result = wrapOrphan(nabu, block);
    expect(nabu.warn).toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
