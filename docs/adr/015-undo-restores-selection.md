# ADR 015 — Undo restores the selection with Loro stable cursors

**Status:** Accepted (2026-10-21, owner decision)
**Date:** 2026-10-21
**Original:** [French](fr/015-undo-restores-selection.md)
**Related:** ADR 006 (selection bridge), ADR 010 (persistence), `nabu.shortcut()` (undo of markdown shortcuts), P-07 (structural undo steps), P-11 (block recreated by undo)

---

## 1. Context

Loro's `UndoManager` only restored a **caret** (block + offset) after an undo / redo: "bold on *important*, Ctrl+Z" removed the bold but left the cursor at the start of the selection. What a modern editor is expected to do:

- **Ctrl+Z** gives back the selection (not only a caret) as it was just BEFORE the undone action: a range within a block, a multi-block range (anchor and focus in different blocks), and the **direction** (a "backwards" selection).
- **Ctrl+Y / Ctrl+Shift+Z** gives back the selection where the action ENDED (caret at the end of the retyped text, text selected after a re-bold).
- The restored selection is brought into view without needless jumping.
- **Collaboration**: stored offsets become wrong as soon as a remote peer edits. Loro's undo only reverts local changes; the restored selection must follow remote edits.

## 2. What Loro gives us (verified experimentally, loro-crdt 1.10.6)

- `onPush(isUndo, counterRange, event)` is called on **every commit**, AFTER the commit (a commit merged by `mergeInterval` also calls `onPush`, but the element kept is the first one: its value remains that of the first commit of the group). It is also called for the *redo* stack: an `undo()` calls `onPop(true, …)` then `onPush(false, …)`.
- The value returned by `onPush` is **serialized**: a live `Cursor` object would come back out of `onPop` as an unusable plain object. We therefore store `cursor.encode()` (`Uint8Array`) there and rebuild with `Cursor.decode`.
- The `UndoManager`'s `cursors` mechanism (positions transformed by Loro) yields positions that do not follow character ids in all cases (absolute positions recomputed). We do not use it: `cursors: []`.
- A Loro `Cursor` is bound to ONE character (the one right after the position; end of text = sentinel). `doc.getCursorPos` returns `{ offset, side, update? }`; `update` is present when the targeted character is deleted. An undo that reverts a deletion re-inserts NEW characters: a cursor bound to a deleted character does not land in the right place.

## 3. Decision

### 3.1 Capture: the selection from BEFORE the change

`onPush` arrives after the commit, and a Loro cursor must be created on the text as it was BEFORE the modification. We therefore cannot capture in `onPush`. `Nabu#captureUndoSelection()` permanently keeps the last selection (`#undoSel`), refreshed as long as the model and the DOM agree:

- `selectionchange`, `keydown` (capture phase, after `sync()`), and every `setBaseAndExtent` that the editor itself performs;
- never during an IME composition, while a commit / an undo is being rendered (`#busy`), nor with a Loro transaction pending (`getPendingTxnLength() > 0`): the DOM then lags behind the model.

`onPush` only has to store `#undoSel` (the one from before the action) in the step's value. A caret decided by the caller (`nabu.shortcut()`: right after the typed trigger) takes precedence for that step, without cursors (the targeted text is not the one the change applies to).

### 3.2 Stored shape (`undo-selection.js`)

`{ anchor, focus }`; each end: `blockId`, `path` (child index at each level), `offset`, id of the text container, `role` (`start` / `end`), and TWO encoded cursors: `next` (bound to the character AFTER the position) and `prev` (bound to the character BEFORE, read +1). Why two: if the action deletes the next character (Delete, start of a deleted range), `next` is dead; if it deletes the previous one (Backspace), `prev` is. At resolution time, the one whose character is alive (`update` absent) wins; if both are alive: the start of a range follows `prev`, the rest follows `next`. If both are dead: the position (tombstone) of `next`. Distinct anchor / focus gives direction and multi-block selections for free.

### 3.3 Redo: where the action ended

The redo step is pushed by `undo()` itself, at a moment when the current selection is the one after the action, but the user may have clicked elsewhere in the meantime. We therefore record, per end of the undo step's `counterRange`, the selection "settled" after the action (`'settle'`: end of the commit once rendered, or caret placed by the editor); the undo's `onPop` remembers the end of the step being undone, and `onPush(false)` stores that selection (fallback: the current selection). A `mousedown` freezes this record (`sealUndoEnd`).

### 3.4 Restoration

`onPop` → `restoreSelection` after `tick()` (recreated blocks are rendered), with the existing retries if a block does not have an element yet. Resolution of an end: the block by id if it is alive; otherwise by tree path (walked as far as it exists, then the nearest text block); the offset comes from the cursors if their container is that of the current block, otherwise the stored offset clamped to the text. Placement goes through the selection bridge (`setCursor` for a caret, `setBaseAndExtent` for a range). Then `revealFocus`: the moving end of the selection is brought into view with `scrollIntoView({ block: 'nearest' })`, only if it is outside the visible area (window and scrollable ancestors).

## 4. Collaborative behavior

- Undo only reverts local changes (Loro behavior, unchanged).
- A remote edit inserted before the selection shifts it; inserted inside it, it stretches it; the ends follow character ids, not offsets. Test: two `LoroDoc`s synchronized through `export` / `import` of updates (`tests/unit/undo-selection.test.js`).
- Targeted text deleted remotely: the two ends meet, caret collapsed to the nearest position. Neighbors deleted too: tombstones, caret clamped to the text.

## 5. Fallbacks (nothing throws, never a dead caret)

1. Block recreated by undo under a NEW id (Loro, since P-11): the text container has changed, the cursors are ignored; tree path + stored offset.
2. Invalid path / block gone: the first text block of the document.
3. No capturable DOM selection (editor without focus, tests without a DOM): the caret of the selection state (`anchorBlock` + `startOffset`), as before.
4. Block without text (void, media): block + path without cursors; the nearest text block receives the caret.

## 6. Consequences

- The core stays agnostic: `undo-selection.js` only knows the `text` behavior (container, `getDOMPoint`); it is in the guard test's list.
- Cost: 4 `getCursor` calls per capture (one per `selectionchange` / `keydown`), to be compared with a render.
- Known limitation: a caret placed by the application (`nabu.focus()`) after an action, without a `mousedown`, replaces the remembered "end of action" for redo.

## Note (2026-10-27)
Since P-111, when both cursors of an end are dead and the block's text has the same length as at capture, `resolveOffset` uses the stored offset instead of the tombstone position of `next` mentioned in §3.2; endpoints now also store the text `length` (`src/lib/blocks/undo-selection.js`).
