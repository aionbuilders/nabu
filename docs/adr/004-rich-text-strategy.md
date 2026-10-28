# ADR 004: Rich Text Strategy (LoroText vs Nested Blocks)

**Status:** Accepted
**Date:** 2026-02-19
**Original:** [French](fr/004-rich-text-strategy.md)

## Context
A critical question arose: should a paragraph be split into several child blocks to handle bold, italic or links (the MegaBlock approach), or should the paragraph be treated as a single unit of text?

## Decision
Use **`LoroText` and `marks`** exclusively for everything that is inline text enrichment. A paragraph is a `Block` (leaf), never a `MegaBlock`.

## Technical rationale
1.  **Cursor stability:** Avoids Svelte component boundaries when the cursor moves. The browser handles a single text node far better.
2.  **CRDT robustness:** Loro's text algorithms are optimized for character-level conflicts. Using blocks for text would cause massive block deletions and reinsertions on a simple style change, making collaboration unstable.
3.  **Rendering performance:** Drastically reduces the number of class instances and Svelte components.
4.  **Mapping simplicity:** Translating a DOM position into a Loro position is linear and does not require computing offsets across several sub-blocks.

## Consequences
*   Styles (bold, etc.) are rendered through a "Mark Renderer" logic inside the text component, not through the block tree.
