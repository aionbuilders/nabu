/**
 * Unit tests for Block.consume() — multi-block merge logic.
 */

import { describe, it, expect, vi } from 'vitest';
import { Block } from '$lib/blocks/block.svelte.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeBlock({ id = 'b', absorbs = vi.fn(() => true), children = null } = {}) {
  const block = Object.create(Block.prototype);
  block.id = id;
  block.absorbs = absorbs;
  block.node = { moveAfter: vi.fn() };
  // If children provided, mock adoptChildren (MegaBlock interface)
  if (children !== null) {
    block.children = children;
    block.adoptChildren = vi.fn();
  }
  block.destroy = vi.fn();
  return block;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Block.consume', () => {
  describe("direction = 'from' (default) — otherBlock merges into this", () => {
    it('returns this (survivor) when absorbs succeeds', () => {
      const self = makeBlock({ id: 'self' });
      const other = makeBlock({ id: 'other' });
      self.absorbs = vi.fn(() => true);

      const result = self.consume(other, 'from');
      expect(result).toBe(self);
    });

    it('calls absorbs(victim) on the survivor', () => {
      const self = makeBlock({ id: 'self' });
      const other = makeBlock({ id: 'other' });
      self.absorbs = vi.fn(() => true);

      self.consume(other, 'from');
      expect(self.absorbs).toHaveBeenCalledWith(other);
    });

    it('moves victim after survivor when absorbs returns false', () => {
      const self = makeBlock({ id: 'self' });
      const other = makeBlock({ id: 'other' });
      self.absorbs = vi.fn(() => false);

      self.consume(other, 'from');
      expect(other.node.moveAfter).toHaveBeenCalledWith(self.node);
    });

    it('does NOT call moveAfter when absorbs returns true', () => {
      const self = makeBlock({ id: 'self' });
      const other = makeBlock({ id: 'other' });
      self.absorbs = vi.fn(() => true);

      self.consume(other, 'from');
      expect(other.node.moveAfter).not.toHaveBeenCalled();
    });
  });

  describe("direction = 'into' — this merges into otherBlock", () => {
    it('returns otherBlock as survivor', () => {
      const self = makeBlock({ id: 'self' });
      const other = makeBlock({ id: 'other' });
      other.absorbs = vi.fn(() => true);

      const result = self.consume(other, 'into');
      expect(result).toBe(other);
    });

    it('calls absorbs on otherBlock with self as victim', () => {
      const self = makeBlock({ id: 'self' });
      const other = makeBlock({ id: 'other' });
      other.absorbs = vi.fn(() => true);

      self.consume(other, 'into');
      expect(other.absorbs).toHaveBeenCalledWith(self);
    });
  });

  describe('child relocation', () => {
    it('calls adoptChildren on MegaBlock survivor when victim has children and absorbs succeeds', () => {
      const self = makeBlock({ id: 'self', children: [] });
      const other = makeBlock({ id: 'other', children: [makeBlock({ id: 'c1' }), makeBlock({ id: 'c2' })] });
      self.absorbs = vi.fn(() => true);

      self.consume(other, 'from');
      expect(self.adoptChildren).toHaveBeenCalledWith(other.children);
    });

    it('promotes children as siblings after survivor when absorbs fails', () => {
      const c1 = makeBlock({ id: 'c1' });
      const c2 = makeBlock({ id: 'c2' });
      const self = makeBlock({ id: 'self' });
      const other = makeBlock({ id: 'other', children: [c1, c2] });
      self.absorbs = vi.fn(() => false);

      self.consume(other, 'from');

      // Each child should have moveAfter called with the survivor's node
      // Reversed order: c2 first, then c1
      expect(c2.node.moveAfter).toHaveBeenCalledWith(self.node);
      expect(c1.node.moveAfter).toHaveBeenCalledWith(self.node);
    });

    it('does not call adoptChildren when victim has no children', () => {
      const self = makeBlock({ id: 'self', children: [] });
      const other = makeBlock({ id: 'other' }); // no children property
      self.absorbs = vi.fn(() => true);

      self.consume(other, 'from');
      expect(self.adoptChildren).not.toHaveBeenCalled();
    });
  });
});
