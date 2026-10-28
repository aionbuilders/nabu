# ADR 006: Selection Bridge Strategy (DOM ↔ Model)

**Status:** Accepted
**Date:** 2026-02-22
**Original:** [French](fr/006-selection-bridge-strategy.md)

## Context
In a single-contenteditable architecture, the browser manages a raw DOM selection (`Node`, `Offset`) that means nothing to the CRDT (Loro), which expects linear text offsets (`blockId`, `index`). In addition, Svelte's reactive rendering may destroy the text node holding the cursor on every state change.

## Decision
1.  **DOM → model mapping:** Use a virtual `Range` (`range.toString().length`) to compute the real offset, ignoring the intermediate HTML tags.
2.  **Model → DOM mapping:** Use a `TreeWalker` to find the exact insertion point again after a Svelte render.
3.  **Differential update:** Only the blocks entering or leaving the selection have their reactive `selected` property modified (O(M)).

## Consequences
*   **Performance:** Computing the selection is nearly instantaneous and does not depend on the total size of the document.
*   **Stability:** The cursor is restored after every Loro mutation (`await tick()`), giving a "native" typing feel.
*   **Precision:** Plain text is handled natively, and rich elements (images, links) are already anticipated.
