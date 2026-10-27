---
title: The life of a keystroke
description: From your key to the paint, step by step. Two of the steps are timed live, on your machine.
chapter: 3
adrs: [7, 8]
xray: keystroke
---

Press a key in the editor below. The panel next to it lists the path that key just took through Nabu. We did not draw an animation. Two of the steps carry a time, measured on your machine by this page. The others are explained but not timed, and the reason is further down.

## The path

Here is the road, in order, with the code that runs at each stop.

1. **keydown.** A capture listener on the document syncs the model's idea of the selection with the browser's, so everything after it reads the current caret. Then the root's handler asks the command registry whether this key is a shortcut ([chapter 05](/architecture/chapters/commands-not-keycodes)). A letter is not: typing costs one chord computation and one map lookup ([ADR 017](/architecture/decisions/017)).
2. **beforeinput.** The browser says it is about to insert a character. One handler on the root takes it ([`handleBeforeinput`](https://github.com/aionbuilders/nabu/blob/main/src/lib/blocks/nabu.svelte.js)). It syncs the selection again, moves the caret off any dead position, and calls `preventDefault()`. The browser will not touch the page.
3. **Selection to model.** The caret is a DOM node and an offset. Nabu turns it into a block id and a character index ([chapter 04](/architecture/chapters/where-is-the-caret)).
4. **Dispatch.** Extensions get the first look through their `onBeforeInput` hooks (rich text and regions use them). Then the event goes to the block under the caret. A plain character is handled right there by the block's text behavior, with no ascension. Some keys are not, see below.
5. **Loro.** The text behavior first tries the input rules: this is where `# ` turns a paragraph into a heading and `--` becomes a dash. If none applies, it inserts into the `LoroText` and calls `block.commit()`, which commits the Loro transaction and so makes the undo step ([`handleInsertText`](https://github.com/aionbuilders/nabu/blob/main/src/lib/behaviors/text/text.behavior.svelte.js)).
6. **Svelte.** Loro fires its event, the block's `$state` updates, and Svelte patches the DOM. Then, after the next `tick()`, the engine puts the caret back, because Svelte may have rewritten the text node the caret was in.
7. **Paint.** The browser draws the frame.

## Who answers Enter

The engine does not know what a list is, so when you press Enter it cannot know what should happen. The text behavior asks the block to split, and the block *ascends* ([ADR 007](/architecture/decisions/007), a chain of responsibility):

```js
// src/lib/blocks/block.svelte.js (abridged)
ascend(eventName, event, data = {}) {
  if (this.parent && typeof this.parent[eventName] === "function") {
    const handled = this.parent[eventName](event, { ...data, from: this });
    if (handled) return handled; // a falsy result declines
  }
  // then the hooks registered by extensions, the block's own type first
}
```

The parent container gets the first word. In a list, the `List` answers: it makes a new item, or steps back a level if the item is empty. In a toggle body, the toggle only takes the Enter that leaves the body, and declines the rest. If no container answers, the extension that owns the block's type does: a paragraph splits into two. Press Enter in the widget: the panel names the `inputType` that sent the key down this road (`insertParagraph`), but it cannot say who answered. That is exactly the part we do not instrument.

## When the selection crosses blocks

If the selection spans blocks, the event goes to their lowest common ancestor, which may be the engine itself. [ADR 008](/architecture/decisions/008) describes how it deletes: from each end of the selection, walk up to the ancestor and prune the siblings that fall inside the selection. These are the "spines". One function, `deleteRange`, now serves Backspace, typing over a selection, cut and paste. That is the fix to a bug the ADR records: there were two copies of the logic, they had drifted apart, and a cut destroyed the root both spines shared, corrupting the document (P-44).

## What the panel measures, and what it does not

Two numbers, both defined in [`measure.js`](https://github.com/aionbuilders/nabu/blob/main/src/site/measure.js):

- **Engine work:** from the key's own `event.timeStamp` to the first change in the editor's DOM, seen by a `MutationObserver`.
- **Key to next paint:** from the same start to the first frame painted after the DOM changed. It is the number a user feels, so we also use it in [the performance lab](/labs/performance).

The steps in between are not timed. Timing them needs marks inside the engine, and we would rather show a step without a number than a number we cannot stand behind. Chrome's profiler can time them.

ProseMirror takes the other road: it lets the browser type, then reads the changed DOM back into a transaction ([the guide](https://prosemirror.net/docs/guide/)). We cancel the event, so there is nothing to read back. It also means that every input type we forget to handle does nothing. That is how P-73 happened.

> [!TIP]
> A new block type is one extension, with its own `onSplit` or `onBeforeInput`. The engine never grew a branch for it, and it does not need to know that your block exists.

> [!WARNING]
> At 10,000 blocks the steps after Loro were too slow when we measured them in the lab, and that is being fixed. We do not print the figure here because it moves: [the limits page](/architecture/limits) and [the lab](/labs/performance) have the current one. The design has other costs. Hooks run on every keystroke: each extension's `onBeforeInput` until one answers, and the transaction hooks at every commit. A heavy hook makes every key heavy, and one was: the paragraph extension's hook walked every root block at each commit, most of the typing latency in a large document (P-105, fixed on 26 October, see [the audit](https://github.com/aionbuilders/nabu/blob/main/docs/audit/2026-10.md), in French). And ascension is indirection: to know who handled Enter, you read the chain.
