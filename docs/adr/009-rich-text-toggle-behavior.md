# ADR 009 — Global Toggle Behavior for Rich Text Marks

**Status:** Accepted
**Date:** 2026-03-12
**Original:** [French](fr/009-rich-text-toggle-behavior.md)

## Context

When a keyboard shortcut applies a mark (e.g. Ctrl+B for bold) to a selection that may span **several blocks**, the expected behavior was not defined. Two approaches were possible:

**Option A — Independent per-block toggle:** Each block decides on its own whether to toggle, based on its own internal state. Problem: a fully bold block removes bold while a partially bold block applies it, which gives an inconsistent result.

**Option B — Global toggle (editor standard):** The state of the mark is evaluated over the whole selection, then applied or removed uniformly.

## Decision

Adopt the **standard editor behavior** (Notion, Word, Google Docs, ProseMirror):

> **If the mark is fully active over the whole selection → remove it everywhere.
> Otherwise (partial or absent) → apply it everywhere.**

Implemented in `RichTextExtension` (`src/behaviors/text/rich-text.extension.js`) in two passes:

```javascript
// Pass 1: collect and evaluate globally
const targets = []; // { behavior, sel } for each selected block
const isFullyActive = targets.every(({ behavior, sel }) => behavior.isMarkActive(markName, sel));

// Pass 2: uniform action
for (const { behavior, sel } of targets) {
    if (isFullyActive) behavior.removeMark(markName, sel);
    else behavior.applyMark(markName, true, sel);
}
```

The method `isMarkActive(markName, sel)` on `TextBehavior` returns `true` only if **every operation** of the delta within the selected range carries the mark. A single segment without the mark is enough to return `false`.

## Consequences

- **UX consistency:** Identical behavior to all mainstream editors — no surprise for the user
- **Native multi-block support:** Works correctly on a selection crossing N blocks
- **Zero duplication:** The detection logic (`isMarkActive`) stays in `TextBehavior`; only the multi-block coordination lives in the extension
