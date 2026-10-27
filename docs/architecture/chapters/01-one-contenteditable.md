---
title: One contenteditable
description: Why the whole document is one editable surface, and what that costs us.
chapter: 1
adrs: [1, 3]
xray: single-root
---

Drag from the first paragraph into the last one, in the editor below. The selection crosses the blocks the way it does in a text document, and nobody wrote code for that. The whole document is a single `contenteditable`, and the blocks are plain elements inside it.

## The usual way, and the way we did not take

Most block editors give each block its own editable element. It is the easy road: a block is a box, the browser edits it, done. [ADR 001](/architecture/decisions/001) says what we saw on that road: the caret cannot leave the block by itself, a selection cannot cross two blocks, copy and paste becomes a project of its own. Editor.js, which works this way, lists cross-block selection and caret movement as planned work in [its README](https://github.com/codex-team/editor.js).

So Nabu has one editable root. The editor component renders it in [`Nabu.svelte`](https://github.com/aionbuilders/nabu/blob/main/src/lib/blocks/Nabu.svelte), and the DOM looks like this (simplified):

```html
<div contenteditable="true" data-nabu-root="true">
  <div data-block-id="…" data-block-type="paragraph">The ferryman waited…</div>
  <div data-block-id="…" data-block-type="paragraph">Across the river…</div>
</div>
```

The blocks carry an id and a type. They carry no `contenteditable` of their own: they are editable because they sit inside the root. The panel next to the editor counts them on your page, live.

## One root, one listener

A single editable surface also means a single place where the browser tells us what the user did. The root has one `onbeforeinput` handler. Its first move, after syncing the selection, is `preventDefault()`: Nabu cancels every native edit and applies the change to the model instead ([`handleBeforeinput`](https://github.com/aionbuilders/nabu/blob/main/src/lib/blocks/nabu.svelte.js)). The browser never types into the page. [Chapter 02](/architecture/chapters/the-model-is-the-truth) is about why, [chapter 03](/architecture/chapters/the-life-of-a-keystroke) follows one key all the way through.

## Finding a block

Once the document is one surface, we still need to reach a block from two directions: by id when an input arrives, and by hierarchy when we render. [ADR 003](/architecture/decisions/003) keeps both. The engine holds a flat map from block id to block, and the Svelte components render the tree recursively, each container drawing its children. An id lookup does not walk the tree. Rendering does not need a rebuilt tree in memory: Loro already gives us flat nodes with parents.

## The engine does not know your block

The root knows nothing about what lives inside it. There is no `switch (type)` in the engine. A test, [`list-normalize.guards.test.js`](https://github.com/aionbuilders/nabu/blob/main/tests/unit/list-normalize.guards.test.js), checks that nine core files import no concrete block folder. It cannot prove the absence of every shortcut, and there is one: when pasted content has a block type the editor does not know, the engine falls back to `paragraph`. Everything else comes from extensions.

> [!TIP]
> Selection across blocks, drag selection, and the shape of copy and paste come from the browser, not from our code. A paragraph, a list and a quote are neighbours in one flow, and they select like neighbours.

> [!WARNING]
> We own the translation between the browser's selection and ours, and it is where our bugs live: the audit of October 2026 lists five selection bugs found by one audit spec (P-108 to P-112), all in that code and all fixed. Because we cancel every input, any browser gesture we forgot to handle simply did nothing, and spellcheck suggestions and Ctrl+T were exactly that (P-73). Browser extensions that inject markup into the editor, such as Grammarly, are not supported. And we only test in Chromium: Firefox, Safari and mobile keyboards are not covered yet. See [the audit](https://github.com/aionbuilders/nabu/blob/main/docs/audit/2026-10.md) (in French) and [the limits](/architecture/limits).
