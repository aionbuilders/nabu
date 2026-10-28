# ADR 008: Shared Multi-Block Logic and the Spine Pattern (container.utils.js)

**Status:** Accepted
**Date:** 2026-03-12
**Original:** [French](fr/008-container-beforeinput-spine.md)

## Context

When a selection crosses several blocks (e.g. selecting text from the end of a paragraph to the middle of a nested list item), the `beforeinput` event must be handled by the **Lowest Common Ancestor (LCA)** of the selection in the block tree.

Two classes play this container role:
- **`MegaBlock`**: the LCA for intra-container selections (e.g. two items of the same list)
- **`Nabu`**: the LCA of last resort for selections that cross root blocks

The initial problem: `Nabu.beforeinput` and `MegaBlock.beforeinput` implemented two distinct logics. The `Nabu` version was a naive, old one (linear scan, deprecated `mergeWith` API), while `MegaBlock` had developed a correct logic based on "spines".

## Decision

Extract the multi-block `beforeinput` logic into **`src/blocks/container.utils.js`**, exported as `handleContainerBeforeInput(container, nabu, event)`.

Both classes delegate to it:
```javascript
// MegaBlock
beforeinput(event) {
    return handleContainerBeforeInput(this, this.nabu, event);
}

// Nabu
beforeinput(e) {
    return handleContainerBeforeInput(this, this, e);
}
```

## Mechanism: the spine approach

For each end of the selection (`startBlock`, `endBlock`), we walk up the chain of parents to the container, building a **spine**:

```
startBlock
  └── parent (listItem)     → deletes the next siblings of startBlock
        └── parent (list)   → deletes the next siblings of listItem
              └── container  ← stop
```

The **start spine** prunes the blocks after each node (what comes "after the start" is selected and therefore to be deleted).
The **end spine** prunes the blocks before each node (what comes "before the end" is selected and therefore to be deleted).

Once the spines are built, we identify the **direct children of the container** in each spine, then delete the intermediate blocks between those two children.

## Unification problem: how the spines terminate

The key difference between `MegaBlock` and `Nabu` is how the spine terminates:

- **MegaBlock**: the container is pushed onto the spine (loop `while at(-1) !== this`), so the direct child is `spine.at(-2)`
- **Nabu**: root blocks have `parent = null`, so the loop breaks before Nabu is pushed, and the direct child is `spine.at(-1)`

**Unified solution:**
```javascript
const directChild = (spine) => spine.at(-1) === container ? spine.at(-2) : spine.at(-1);
```

## Consequences

- **Consistency:** `Nabu` and `MegaBlock` use exactly the same logic; there is no longer any risk of divergence
- **Maintainability:** A single place to modify for multi-block operations
- **Correctness:** The spine logic correctly handles arbitrarily nested structures, unlike `Nabu`'s old linear scan
- **Extensibility:** Any future container (e.g. table, columns) can use `handleContainerBeforeInput` by passing `{ children, commit }` plus its nabu reference

## Why not `Nabu extends MegaBlock`

Inheritance was considered but rejected for three reasons:
1. **Circular dependency:** `Block → Nabu`, `MegaBlock → Block`, `Nabu → MegaBlock → Block → Nabu`
2. **Constructor incompatibility:** `MegaBlock(nabu, node)`, but Nabu has no `LoroTreeNode`
3. **Inheriting useless baggage:** `selected`, `element`, `behaviors`, `parent` and `index` have no meaning on Nabu

## Addendum: `deleteRange` (P-44)

The spine logic existed in two copies (`handleContainerBeforeInput` and `deleteSelectionContent`, used by cut and paste), and they had diverged: cut destroyed the root common to both spines (corrupting the document), and both moved the survivors of the end spine in the wrong order. There is now a single implementation, `deleteRange(nabu, { startBlock, startOffset, endBlock, endOffset })`; `handleContainerBeforeInput` (Backspace, typing, Enter on a selection) and `deleteSelectionContent` (cut, paste) both call it.

Algorithm (generic, no block type involved):
- LCA of the two blocks; start spine = `startBlock` → child of the LCA; end spine likewise.
- Destroyed: the children of the LCA between the two spines; the next siblings of each node of the start spine (and the children of the start block); the previous siblings of each node of the end spine; the nodes of the end spine themselves (their text is inside the selection).
- Survivors: whatever follows the end point in the partially selected blocks of the end spine, in document order (children of `endBlock`, its next siblings, those of its parent…), moved after `startBlock` (`wrapOrphan` for `requiredParent`) BEFORE their former ancestors are destroyed (deleting a Loro node deletes its subtree).
- Case "start block is an ancestor of the end block" (selection from the text of a hybrid block into its body): the rest of the body stays in place; only the first block of the end spine that has its own text is removed, and its survivors take its place.
- Text: the head of the start block and the tail of the end block are merged (`absorbs`); the children of `endBlock` are adopted by the start block if it can carry children, otherwise promoted.
- A single `commit` (one undo step); the normalizers (lists…) then clean up the invariants specific to each type.
