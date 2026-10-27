---
title: Where is the caret?
description: Mapping a browser selection to the model and back, and why undo puts it back.
chapter: 4
adrs: [6, 15]
xray: caret-map
---

Click in the text, or select a few words. The panel shows the same caret twice: where the browser says it is, a DOM node and an offset, and where Nabu keeps it, a block and a character index. Then bold something, press Ctrl+Z, and watch the last line.

## Two ways to say "here"

The browser knows a selection as a **node and an offset into it**. A paragraph with a bold word in the middle is three text nodes, and offset 3 means a different place in each. The model knows a **block and an index into the block's text**: one string, whatever marks sit on it. Loro needs the second, the browser only gives the first, and this chapter is the translation. It is [ADR 006](/architecture/decisions/006), the selection bridge.

## DOM to model

To turn a DOM point into an index, we do not walk the nodes. We build a throwaway `Range` from the start of the block to the point, and measure its text ([`calculateOffset`](https://github.com/aionbuilders/nabu/blob/main/src/lib/behaviors/text/text.behavior.svelte.js)):

```js
const range = document.createRange();
range.setStart(element, 0);
range.setEnd(node, offset);
return range.toString().length;
```

`Range.toString()` skips the tags in between, so a bold span costs nothing. That works because a paragraph is one text with marks ([chapter 02](/architecture/chapters/the-model-is-the-truth)), not three blocks. The result is clamped to the model's text length: an empty block renders a lone newline, and a caret after it is still offset 0 (P-108).

## Model to DOM

The other way, `getDOMPoint` walks the block's text nodes with a `TreeWalker`, adding their lengths until it reaches the index. The engine then calls `setBaseAndExtent`. It does this after nearly every edit, since Svelte may have replaced the text node the caret was in. Edit, `await tick()`, put the caret back. The bridge is the reason the caret does not jump while you type.

## Undo puts it back

Loro's `UndoManager` restored a caret: a block and an offset. [ADR 015](/architecture/decisions/015) asked for more. Ctrl+Z gives back the *selection* as it was before the action, including a selection across blocks and its direction. Ctrl+Y gives back where the action ended.

The hard part is timing. The undo manager tells us about a step after the commit, and a Loro cursor has to be created on the text as it was before. So the engine keeps the last selection all the time, refreshed on every `selectionchange` and every key, and the step takes whatever was kept. Each end of the selection is stored as two Loro stable cursors, one bound to the character after the position and one to the character before. Delete deletes the next character and kills the first one; Backspace kills the second; at restore time, whichever is still alive wins. Because a cursor follows a character and not a number, a remote edit before the selection shifts it correctly: [`undo-selection.test.js`](https://github.com/aionbuilders/nabu/blob/main/tests/unit/undo-selection.test.js) synchronizes two Loro documents to prove it. If a block was recreated by the undo under a new id, we find it again by its path in the tree, then by the nearest text block. Never a dead caret.

The browser-level behaviour is in [`undo-selection.spec.ts`](https://github.com/aionbuilders/nabu/blob/main/tests/e2e/undo-selection.spec.ts).

## What the panel shows

The two readings come from the browser (`window.getSelection()`) and from the engine (`nabu.selection`). They should agree after every move. The interesting moments are the edges: a caret at the end of a bold span, a selection that starts in one paragraph and ends in another, an empty block. The last line is the selection Nabu restored after your latest undo or redo, read once the page has settled.

> [!TIP]
> Undo behaves like it does in a document editor: the selection comes back, not just a caret, and it stays correct when another peer edited in the meantime. None of that is code in the blocks.

> [!WARNING]
> The bridge is where most of our selection bugs live. The audit of 26–27 October found five (P-108 to P-112), among them a redo that put the caret at the end of the block instead of after the character (P-111). The cost is also in the design: capturing the selection is four `getCursor` calls on every `selectionchange` and every key ([ADR 015](/architecture/decisions/015), consequences). A caret placed by the host app with `nabu.focus()` replaces the remembered end of the action for redo. ADR 006 says computing the selection does not depend on the size of the document. The computing does not. Placing the caret makes the browser lay out the page, and that grows with the document: the audit tracks it as P-107. And the bridge steps aside during an IME composition. We test it in Chromium only, and Firefox and Safari fire composition events in a different order ([IME guide](/docs/guides/ime-and-languages)).
