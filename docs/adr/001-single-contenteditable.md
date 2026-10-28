# ADR 001: Single ContentEditable Architecture

**Status:** Accepted
**Date:** 2026-02-19
**Original:** [French](fr/001-single-contenteditable.md)

## Context
Most block-based editors (such as Notion) use one `contenteditable` per block. This simplifies rendering but breaks the browser's native selection: the cursor cannot cross blocks naturally, copy and paste is complex, and performance degrades as the number of blocks grows.

## Decision
Nabu uses a **single `contenteditable="true"` attribute** at the root of the editor. Child blocks are passive DOM elements (not editable by default from the browser's point of view).

## Consequences
*   **Advantages:**
    *   Native selection works fully (selection across several blocks, drag selection with the cursor).
    *   Copy and paste is simpler, because the browser sees a single flow.
    *   Better rendering performance (fewer editable regions for the browser engine to manage).
*   **Challenges:**
    *   Requires a complex mapping (the Selection Bridge) to translate DOM coordinates (Node/Offset) into Loro coordinates (BlockID/TextOffset).
    *   All input events (`beforeinput`) must be intercepted, so that modifications are redirected to Loro instead of letting the browser modify the DOM.
