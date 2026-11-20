---
title: Stable block ids
description: Give every block an identity that survives undo, with the stableIds option, block.uid and blockByUid, and the rules that say which block keeps a uid when you split, merge or move.
section: guides
order: 45
---

# Stable block ids

`block.id` is the Loro tree id of the block. It is unique, but **undo changes it**: delete a block, undo, and the block that comes back has a new `id`. An app that stores "the caret is in this block", a comment anchor or a link to a block cannot use it.

The `stableIds` option gives every block a second identity, `uid`, that Loro brings back with the block. It is off by default and costs nothing when off (nothing is written, no index is kept).

```js test
import { createEditor } from '@aionbuilders/nabu';

const engine = createEditor({ stableIds: true });
await engine.commit();
engine.insert('paragraph', { text: 'keep me' });
await engine.commit();

const block = engine.children[engine.children.length - 1];
const uid = block.uid; // 'u:12@345'
expect(engine.blockByUid(uid)).toBe(block);

// Delete, then undo: the block is a new object with a new `id`, and the same `uid`.
engine.delete(block);
await engine.commit();
expect(engine.blockByUid(uid)).toBeNull();
engine.undo();
await new Promise((resolve) => setTimeout(resolve, 20));
const back = engine.blockByUid(uid);
expect(back.text).toBe('keep me');
expect(back.id).not.toBe(block.id);
```

## The API

| | |
|---|---|
| `createEditor({ stableIds: true })` | Turns the option on. Given once, at creation. Read back as `engine.stableIds`. |
| `block.uid` | The uid (`'u:12@345'`), or `undefined` when the option is off. Opaque: never compare it with `block.id`. |
| `engine.blockByUid(uid)` | The live block that carries the uid, or `null` (unknown, deleted, or the option is off). |
| `stampBlockUids(doc)` | Exported. Stamps every block of a bare `LoroDoc` that has no uid and renames duplicates. Returns the number of blocks it wrote. |
| `serialize('json')` | With the option on, each block of the export carries its `uid`. |

New blocks get their uid in the transaction that creates them, so undo and redo of a creation carry it. A document that arrives from elsewhere (a remote update, a snapshot, a peer without the option) is stamped and checked for duplicates when it arrives, in a silent commit that is never an undo step.

## Which block keeps the uid

A uid follows what a reader would call "the same block". In text, that is the block holding its **first character**.

| What you do | The uid |
|---|---|
| Create a block (typing, `insert`, a command) | A new uid. |
| Copy and paste, duplicate, `importJSON`, `importMarkdown` | New uids. A uid in an imported JSON is ignored. |
| Cut, then paste | A new uid. To move a block and keep its uid, drag it (or use the move keys). |
| Delete, then undo | The same uid. |
| Move (drag, keyboard move, indent, outdent, region move) | Unchanged. |
| Retype (paragraph to heading, paragraph to list item, step back from a list) | Unchanged. |
| Press Enter in the middle of a block | The first half keeps the uid, the second half gets a new one. |
| Press Enter at the very start of a block that has text | The block that holds the text keeps the uid. The empty block above gets a new one. |
| Backspace or Delete merges two blocks | The merged block keeps the uid of the block whose text comes first. If that block was empty, it takes the uid of the other one. |
| Split or merge a region | The region that stays keeps its uid. The new one gets a new uid. |
| Two blocks end up with the same uid (an old build copied it, two peers undid the same deletion) | The block with the smallest tree id keeps it, the others take a uid of their own. Every peer decides the same way. |

Undo and redo restore exactly the uids from before and after each of these gestures.

**List containers are weak.** The engine merges adjacent lists and splits them when an item steps out, so the `list` block itself comes and goes. Point at the **list items** instead, which follow the text.

## Migrating an existing document

`stampBlockUids(doc)` works on a bare Loro document, with no editor: call it in your own migration, or in tests on bare Loro. It is deterministic (the values depend only on the tree ids), so peers that run it separately converge, and idempotent (a second call writes nothing).

```js test
import { stampBlockUids } from '@aionbuilders/nabu';
import { createEditor } from '@aionbuilders/nabu';

const old = createEditor(); // a document written without the option
old.insert('paragraph', { text: 'a' });
await old.commit();

const written = stampBlockUids(old.doc);
expect(written).toBeGreaterThan(0);
expect(stampBlockUids(old.doc)).toBe(0);
```

It **commits** the document, with a silent origin. Operations that are pending (written but not committed) would be committed under that origin and could not be undone. Call it on a document with nothing pending: in a migration, or before the editor opens.

Opening a document that has uids in an editor without the option is fine: the keys are kept, just not maintained. `stampBlockUids` repairs what was missed when you turn the option back on.
