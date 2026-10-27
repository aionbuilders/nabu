# ADR 007 — Event Ascension (Chain of Responsibility)

**Status:** Accepted
**Date:** 2026-02-22
**Original:** [French](fr/007-event-ascension.md)

## Context
Who decides how an input event (`Enter`, `Backspace`) is handled in a modular editor? A block cannot modify the structure of the document on its own (create or delete siblings), but the central engine must not know the details of every block (for example, how a `ListBlock` splits).

## Decision
Use a **Chain of Responsibility** pattern through the method `Block.ascend(eventName, event, data)`.

## Mechanism
1.  **Local handling:** The focused block receives the event. If it can handle it locally (e.g. `insertText`), it does so.
2.  **Ascension to the parent:** If it cannot handle it (e.g. `Enter` at the end of a list), it calls `ascend()`. The event moves up to the parent block.
3.  **Delegation to hooks:** If nobody answered on the way up, the event is captured by `Nabu`, which delegates the handling to the **extension hooks** (e.g. `onSplit`, `onDeleteBackward`).

## Consequences
*   **Full modularity:** Each extension (Paragraph, List, Table) defines its own splitting or merging logic.
*   **Encapsulation:** The central `Nabu` engine does not need a giant `switch(type)`. It is agnostic about block types.
*   **Extensibility:** A new block type can be added without modifying the engine's existing code.
