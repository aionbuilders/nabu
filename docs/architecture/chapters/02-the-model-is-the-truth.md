---
title: The model is the truth
description: A Loro tree holds the document. Blocks are Svelte classes over it. The DOM only reflects.
chapter: 2
adrs: [2, 4, 10]
xray: model-truth
---

Type in the editor below, then look at the panel. The tree and the log are not a debug view added on the side: they read the Loro document, the same object the editor renders. The page you are looking at is a picture of that document, and the button under the editor proves it, because it changes the picture without touching it.

## A tree, in Loro

The document is a [Loro](https://loro.dev) tree named `blocks`. One node per block. The node's data holds the block's `type` and its props, and a text block keeps its text in a `LoroText` under `text`. A block inside another block is a child node.

```js
// src/lib/blocks/nabu.svelte.js
this.tree = this.doc.getTree("blocks");
```

Loro is a CRDT, so two copies of this tree can be edited apart and merged later without a server deciding who wins. We use that for tabs today ([chapter 06](/architecture/chapters/nothing-gets-lost)). Nothing in the editor depends on a network.

## Blocks are Svelte classes over it

[ADR 002](/architecture/decisions/002) chose classes in `.svelte.js` files for the engine's entities: `Nabu`, `Block`, `MegaBlock` (a block with children), `TextBlock`. A block wraps its Loro node and keeps its reactive state in runes. For text, that is a copy of the Loro text, refreshed whenever Loro says it changed ([`text.behavior.svelte.js`](https://github.com/aionbuilders/nabu/blob/main/src/lib/behaviors/text/text.behavior.svelte.js)):

```js
this.text = $state(this.container.toString());
this.delta = $state(this.container.toDelta());
this.container.subscribe(() => {
  this.text = this.container.toString();
  this.delta = this.container.toDelta();
  // …
});
```

A component reads `block.delta`, and Svelte re-renders what depends on it. The rule that follows from this is the title of the chapter: **nothing writes to the DOM first.** A key press becomes a Loro operation, the operation becomes an event, the event updates a rune, the rune updates the page. Undo, a tab that syncs, a document loaded from disk and your own script all take the same road. That is why the button in the widget works: it inserts text into the first paragraph's `LoroText` with no key press and no DOM event, and the paragraph changes anyway.

## Rich text is marks on one text

[ADR 004](/architecture/decisions/004) settled a question that looks small. Is a paragraph with a bold word one block or three? We said one text with marks. Bold is a range on the `LoroText`, and the renderer ([`RichText.svelte`](https://github.com/aionbuilders/nabu/blob/main/src/lib/behaviors/text/RichText.svelte)) draws the ranges as spans. The reasons in the ADR are the ones you would expect: the caret does not cross component boundaries, a style change does not delete and recreate blocks, and mapping a DOM position to a text offset stays linear. [Chapter 04](/architecture/chapters/where-is-the-caret) depends on that last one.

## What you can check

The model is also the format we save. `serialize('json')` is the tree, and [`roundtrip-structure.test.js`](https://github.com/aionbuilders/nabu/blob/main/tests/unit/roundtrip-structure.test.js) exports, re-imports and compares a kitchen-sink document: nested lists, to-dos, code, toggles, regions with every field type. It compares the Loro nodes, not a serialization, so a field the serializer forgets cannot hide. Markdown is lossy by nature, and we say so in [the clipboard guide](/docs/guides/clipboard-and-markdown). JSON is not meant to be.

Persistence goes one level lower. [ADR 010](/architecture/decisions/010) stores the binary Loro snapshot, history included, not a JSON we derive from it. What we save is the truth itself.

> [!TIP]
> One source of truth means one place to look. The X-ray beside the editor needed no instrumentation: it subscribes to the same Loro document the editor uses and prints what it hears. Persistence, undo and tab sync need no special case for "the DOM changed", because the DOM never does.

> [!WARNING]
> Every block exists twice, as a Loro node and as a Svelte object, and the two must agree. That has cost us. The first import of a 1,000-block document took 5.9 s and a 5,000-block one 163 s, because the tree subscription refreshed the whole root list for each operation (P-104, fixed on 26 October). Upgrading Loro from 1.10.6 to 1.17.1 shrank saves by 39 to 88 percent and, for a while, doubled typing time in a flat 5,000-block document (24 to 47 ms): `tree.roots()` had become slower and we called it on every key. Both are in [the audit](https://github.com/aionbuilders/nabu/blob/main/docs/audit/2026-10.md) (in French). The other bills: Loro ships as WebAssembly, about 1.2 MB gzipped (check with `gzip -c node_modules/loro-crdt/bundler/loro_wasm_bg.wasm | wc -c`), so a Vite setup that loads WASM is mandatory. And a binary snapshot is opaque without Loro, with no schema version: a change to the block structure that is not backward compatible can break old snapshots ([ADR 010](/architecture/decisions/010), consequences).
