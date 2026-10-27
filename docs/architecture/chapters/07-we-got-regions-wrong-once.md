---
title: We got regions wrong once
description: Markers, then boxes. The story of a decision we reversed, and what it cost.
chapter: 7
adrs: [16, 18]
xray: region-title
---

This is a chapter about a mistake. Regions are the divisions of a long text: parts, chapters, scenes. Click in the text of the region below, not in its title, and press Ctrl+A. The titles stay out of the selection. The panel shows why: a region is a container in the tree, and its title is a field that happens to be stored as text. We built it a different way first, in one day, and took it apart the next.

## What we needed

Orduin, a long-form writing application we are building on Nabu, needs to cut one continuous text into parts, chapters and scenes, with metadata for each, navigation, and views such as an outline. An earlier block called Zone did this with nested boxes. It was removed on 22 October. Cutting a chapter or merging two scenes meant moving blocks between boxes, and boxes lend themselves badly to lazy rendering. We chose **markers**.

## The marker model

[ADR 016](/architecture/decisions/016) put the structure on top of a flat document. A region was an empty block, a marker at the root, and its extent was computed: it ran to the next marker of the same or a higher level. Cutting a region was inserting a marker, merging was removing one, promoting was changing a block's type. The registry, numbering, typed fields and commands came with it. We implemented the three lots on 22 October, and the audit journal ends that day with 845 end-to-end tests green and the words "ADR 016 entièrement implémenté", fully implemented ([the audit](https://github.com/aionbuilders/nabu/blob/main/docs/audit/2026-10.md), in French, entries of 22 October).

## The misunderstanding

The next day, ADR 018 says it plainly. The question "boxes or markers?" had been framed as a question about the **data model**. The answer "markers" came from the owner, who was thinking about the **interface**: boundaries that feel like seams, in a text that flows. What was meant:

> In the Loro tree, a region is a **container**, a sub-region is a container inside the container. On screen and on the keyboard, it is experienced as **a continuous text with seams**.

So the model we had built was a good answer to a question nobody had asked. It also lost things the owner cares about: an explicit end (leaving a region, the chapter's own text after its scenes), a region that owns its content (a node you can copy, move, lock and sync), metadata and a word count carried by a subtree, and a natural unit for lazy rendering.

## The reversal

[ADR 018](/architecture/decisions/018) was accepted on 23 October. A region is now a container block: its header is the title, edited in place, and its body is an ordinary list of blocks, sub-regions included. Lots A to E were implemented from 23 to 26 October.

Not everything was lost. The types, the numbering, the registry API, the commands, the hold-to-merge protection from [chapter 05](/architecture/chapters/commands-not-keycodes), the messages and the generic `onBeforeMerge` hook all carried over. What we rewrote was the block, the registry that now reads the tree, the nesting normalizer, the structural commands, the markdown and HTML forms, and the tests. We did not delete ADR 016. It stays in the repo with its status line saying its data model is superseded. A decision record that only shows the winning choice is not worth much.

## What the box model asks of the interface

A tree in the model means the interface has to build the seams. The title is the header of the container and is edited in place, but it **behaves like a locked field**: Enter does not split it, Backspace does not merge into it, block shortcuts do not apply to it. To make that true we gave the engine a generic capability, `isolatesSelection`, and a region's title uses it: titles are left out of any selection that starts or ends outside them ([`isolated-selection.test.js`](https://github.com/aionbuilders/nabu/blob/main/tests/unit/isolated-selection.test.js)). The rule in ADR 018 is "a text selection only touches text". Its consequences are accepted ones. A deletion across two regions erases the text on both sides and does not merge them. Ctrl+A then Delete empties the text and keeps the skeleton. Closing a region, drawing its end and showing which region holds the caret were all designed after the reversal, in lots D and E. See [the regions guide](/docs/guides/regions) for how it works today.

> [!TIP]
> A region is a node. Copying, moving or synchronizing a chapter is an operation on a subtree. Its word count comes from the tree, and there is room for a title, an explicit end and a container that a renderer can skip when it is off screen. The text still reads and navigates as one flow.

> [!WARNING]
> We did the work twice: three lots in one day, then five more over four days. It was cheap in one way only, because `0.1.0-beta.0` does not contain Regions, so nobody had a document to migrate. The next mistake of this size may come after users, and a project with one author has little slack for rework like this. We also pay for the second design: a new engine capability, a normalizer that enforces nesting, a title that is both text and not-quite-text, and edge cases that read as rules, such as Ctrl+A then Delete keeping the skeleton. The lesson we kept is boring: say whether a question is about the model or about the screen.
