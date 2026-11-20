# ADR 019: A stable identity for every block, as an option

**Status:** Accepted (2026-11-21, validated by the owner; the eight questions of §8 settled according to the recommendation). Not implemented yet.
**Date:** 2026-11-21
**Original:** [French](fr/019-stable-block-ids.md)
**Requested by:** Orduin (the writing app built on Nabu), study `~/@orduin/desktop/docs/format-versioning-research.md` §2 and §4.
**Related:** ADR 000 (CRDT as the source of truth), ADR 015 (undo restores the selection), ADR 018 (regions as containers), `src/lib/blocks/block.svelte.js`, `src/lib/blocks/undo-selection.js`.

---

## 1. Problem

A block's id is its Loro `TreeID` (`block.svelte.js`: `this.id = node.id.toString()`). It survives moves (Nabu moves nodes, it never deletes and recreates them to move them) and saves. It does **not** survive delete then undo: Loro recreates the node under a new `TreeID` (ADR 015, "block recreated by undo under a NEW id"; measured by Orduin on loro-crdt 1.17.1: `0@1` comes back as `32@5`).

Everything that points at a block from outside the document breaks then: a comment anchored to a paragraph, a link to a passage, a search index, an AI assistant citing a paragraph. In Orduin: the saved caret `{ block, offset }`, the outline its MCP server exposes (ids promised to "stay the same"), the fold state of the outline, and later links from character sheets.

This is a general need of block editors (Notion has stable ids, Tiptap has a `UniqueID` extension). The rules that matter (is this new node a paste, an undo, a split?) are editor rules that only the engine sees happen, so they belong in Nabu rather than being recoded by each app.

## 2. What we know (measured by Orduin, loro-crdt 1.17.1)

- A node deleted then undone (from another session too) comes back with a new `TreeID`, **and with its `node.data`**, an extra `uid` key included. A value stored in `node.data` survives undo and redo for free.
- `static create(nabu, type, props)` of every block class writes only the keys it knows (`exportProps` for regions and media). A `uid` key next to them is therefore never copied by copy / paste, duplication or `importJSON`, which all go through `create`. Unknown keys of a region's `fields` ARE copied: the uid must not live in `fields`.
- One key written on both sides of a merge is last-writer-wins, and two concurrent `setContainer` lose a side. Hence the determinism rule of §4.

What the code does today (read for this ADR):

- **Retype** (`Block#retype`, markdown shortcuts, `block:transform`, list step-back, sub-thread exit): in place, same node. A uid would survive.
- **Split** (Enter, `onSplit` of paragraph, heading, dialogue, list item): the original node keeps the text BEFORE the caret, a new node is inserted after with the rest. At offset 0 the original keeps an empty text and the new node takes all of it.
- **Merge** (Backspace at the start, Delete at the end): the previous block consumes the next one, the next one is destroyed. The survivor is the FIRST block, even when it was empty.
- **`importJSON`** goes through `importFragment`: it inserts, it never replaces the document. It is a paste.
- **Drag** to move is a tree move (same node). Drag with Ctrl / Alt copies (through the paste path).

## 3. Decision (proposed)

An editor option, **off by default**: an editor that does not ask for it pays nothing and its documents do not change.

- `block.id` stays the `TreeID`. Nothing changes in the tree mechanics, the selection bridge or ADR 015.
- With the option on, every block node carries **`node.data.uid`**, read as **`block.uid`**, and the engine resolves it: **`nabu.blockByUid(uid)`**.
- The value is **the node's `TreeID` at the moment it is stamped**, behind a short prefix (§8 Q2): `u:12@345`. Unique (Loro never reuses a `TreeID`), free, and **deterministic**: two computers that stamp the same old block write the same value, so their copies converge. Random UUIDs are rejected for that reason (§6).
- A uid is **opaque**: after an undo it no longer equals the node's `TreeID`, and nothing may rely on it doing so.

## 4. The rules, case by case

The general rule: **a uid follows what a reader would call "the same block"**. In text, that is the block holding its **first character**.

| Case | Rule | How |
|---|---|---|
| Creation (typing, `insert`, a command) | new uid | written in the creating transaction |
| Copy / paste, duplication, drag with Ctrl, `importJSON`, `importMarkdown`, cut then paste | new uid | `create` never copies `uid`; a pasted node is stamped like a new one |
| Undo / redo of a deletion | keeps its uid | free: `node.data` comes back with the node |
| Move (drag, keyboard move, region move, indent / outdent, normalizers that move) | unchanged | same node |
| Retype (paragraph to heading, list step-back...) | unchanged | same node |
| Split in two (Enter) | the half with the first character keeps it; the other half gets a new uid | the usual case is free (the original node keeps the head). Enter at offset 0 of a non-empty block: the NEW node holds the text, so it takes the uid and the original, now empty, takes a new one (§8 Q3) |
| Merge (Backspace / Delete across blocks) | the merged block keeps the uid of the block whose text comes first | usually free (the survivor is the first block). When the survivor was EMPTY, it takes the uid of the consumed block (§8 Q3) |
| Region split, region merge | the region that stays keeps its uid; the new one gets a new uid | same nodes |
| Enter at the start of a container's title (toggle header, region title) | the container keeps its uid; the paragraph that receives the title text gets a new one | a container is its node (title, body, state), not its title text (decided at implementation, 2026-11-21) |
| Duplicate uid (an old build copied it, a merge of two copies, two peers who both undid the same deletion) | the node with the smallest `TreeID` keeps the uid, every other one takes its own `TreeID` | deterministic, so every peer writes the same values and the copies converge |

"Smallest `TreeID`": compared by peer id (as an unsigned 64-bit integer), then by counter. The order is fixed by the format, the same on every machine.

The duplicate case is real even when every build follows the rules: peer A and peer B both delete paragraph P offline, both undo, then sync. Each recreated P carries the same uid. Hence the healer of §5 runs on remote imports too.

## 5. API

```js
const engine = createEditor({ stableIds: true });   // name: §8 Q1

block.uid;                    // 'u:12@345', or undefined when the option is off
engine.blockByUid('u:12@345'); // the live Block, or null
```

- **Stamping new blocks**: the engine stamps every node created in a local transaction (creation, paste, split), inside that transaction, so an undo of the creation removes the uid with the node.
- **The healer**: after `importRemote` / `import` of updates, the engine checks the uids of the nodes that arrived (Loro's tree events list them, so the cost is proportional to the change, not to the document) and renames duplicates by the §4 rule. Silent origin (`nabu:silent:uids`): outside the undo history, like the file writes. Also run on open.
- **`stampBlockUids(doc)`**, exported: stamps every node of a document that has no uid, and heals duplicates. It takes a **bare `LoroDoc`** (no editor, no Svelte), so an app can call it inside its own migration and its tests on bare Loro. Deterministic, commits with the silent origin, and **idempotent**: a second call writes nothing (`doc.version()` unchanged). Returns the number of nodes it wrote.
- **`serialize('json')`** writes `uid` on each block when the option is on (an outline, a search index or an MCP server can then refer to blocks). `importJSON` still mints new uids (it is a paste, §8 Q4).
- **Types**: `uid` on `Block`, the option on `NabuInit`, `blockByUid` on `Nabu`, `stampBlockUids` exported, all through JSDoc like the rest.

Option off: no key written, no index kept, `block.uid` is `undefined`, `blockByUid` returns null. A document that HAS uids stays valid in an editor without the option: the keys are kept (never deleted), just not maintained, and `stampBlockUids` repairs whatever was missed when the option comes back.

## 6. Rejected

- **Make the `TreeID` survive undo.** Not ours to change: it is how Loro recreates a deleted node.
- **Random UUIDs.** Two computers that stamp the same old block in a migration write different values; one side's links dangle after the merge (Orduin's §4).
- **The uid in `fields` (regions) or in a block prop that `create` copies.** Paste would copy it: two live blocks with one identity.
- **A separate `uid -> TreeID` map container.** One more structure to keep in sync with the tree, last-writer-wins on concurrent edits, and it must be rewritten on every undo. `node.data` comes back with the node for free.
- **Doing it in the app.** The app cannot tell a paste from an undo from a split: only the engine sees the transaction that created a node.
- **Always on.** Every document would change, every editor would pay the writes and the index, for a need that most editors do not have.
- **Regions only** (the Orduin study's first proposal). Comments, links to a passage and citations point at paragraphs; the rule costs the same for every block.

## 7. Tests planned

Unit (vitest, real engine), each with the option on, and the same with it off showing nothing is written:

1. A created block has a uid equal to its prefixed `TreeID`; `blockByUid` finds it.
2. Delete then undo: same uid, new `TreeID`; redo after undo: same uid.
3. Copy / paste, duplication, drag with Ctrl, `importJSON`, `importMarkdown`, cut then paste: new uids, never a duplicate.
4. Move (drag, keyboard, indent / outdent, region move), retype (each transform path, including markdown shortcuts and list conversions): uid unchanged.
5. Split in the middle: first half keeps it. Enter at offset 0: the text keeps it. Merge: survivor keeps it; empty survivor takes the consumed block's uid.
   Both transfers write on the original node as well: Enter at offset 0 then Ctrl+Z, and Backspace into an empty block then Ctrl+Z, give every block back exactly its uid from before, with no duplicate; Ctrl+Shift+Z then restores the state after (added at Orduin's review, 2026-11-21: its caret is saved by uid).
6. Region split and merge, toggle and callout bodies, list items and list containers: the rules hold for every block type.
7. Duplicates: two peers delete and undo the same paragraph offline, sync both ways: one uid each, identical documents (`toJSON()` equal) on both sides.
8. `stampBlockUids` on a bare `LoroDoc`: stamps everything, second call writes nothing (`doc.version()` unchanged), two forks stamped separately then merged both ways converge, and a fresh `UndoManager` cannot undo the stamp.
9. Silent: a stamp or a heal adds no undo step; one typed letter then Ctrl+Z removes only the letter.
10. `serialize('json')` carries `uid` with the option, not without; `@aionbuilders/nabu/format` readers ignore it.
11. Cost: the 10,000-block perf case shows no measurable change with the option off, and a bounded one with it on.

e2e (Chromium, WebKit): Enter at the start, Backspace into an empty block, delete then Ctrl+Z, each checked through `blockByUid`; the first two also undone then redone (Ctrl+Z, Ctrl+Shift+Z), uids compared before, after undo and after redo.

Consumer test: `block.uid`, `blockByUid` and `stampBlockUids` are typed in the published `.d.ts`.

## 8. Questions: all decided on 2026-11-21 (owner) according to the recommendation in bold

1. **Name of the option and API.** **`stableIds: true`, `block.uid`, `nabu.blockByUid(uid)`, `stampBlockUids(doc)`.** Alternatives: `uids: true`, `blockUids: true`. **Decided 2026-11-21: as recommended.**
2. **A prefix on the value?** **Yes, `u:` (`u:12@345`).** Without it a uid equals the block id until the first undo, so code that passes one for the other works in every test and breaks in use. With it, the mix-up fails at once. **Decided 2026-11-21: `u:` prefix.**
3. **Enter at the start and Backspace into an empty block: does the uid follow the text?** **Yes** ("the block holding the first character"). Without this rule, Enter at the start of a cited paragraph leaves the citation on the empty line above, and deleting an empty line before a paragraph steals its identity. Cost: two small transfers in the split and merge paths. **Decided 2026-11-21: yes, the uid follows the first character.**
4. **Exporting then importing a whole document as JSON: keep the uids?** **No, `importJSON` always mints new ones** (it inserts, it is a paste, and importing the same file twice must not create duplicates). A `keepUids` mode to restore a backup into an empty editor goes to `docs/later.md` until someone needs it; Orduin saves Loro, not JSON. **Decided 2026-11-21: `importJSON` always mints new uids; `keepUids` is in `docs/later.md`.**
5. **Cut then paste in the same document: new uid?** **Yes, new uid.** Cut is a delete, paste is a creation; recognising a "move by clipboard" would be fragile. Drag to move keeps the uid and is the documented way to move a block. **Decided 2026-11-21: new uid; a cut-paste-as-move detection waits until an app asks for it.**
6. **Heal duplicates automatically after remote imports?** **Yes, in the engine, when the option is on**, incrementally on the nodes that arrived. Without it, two peers that undo the same deletion leave two blocks with one uid until the app thinks of calling the healer. **Decided 2026-11-21: automatic, on open and after remote imports, on the arrived nodes only, outside the undo history.**
7. **Every block type, list containers included?** **Yes, every node.** List containers are created and merged by the list normalizer, so their uid is weak by nature: the docs will say to point at list items, not at the list. No other type is a problem as far as the code shows; the tests of §7.6 will confirm it. **Decided 2026-11-21: every node, list containers included, with that note in the docs.**
8. **Version.** **0.1.9**, additive, off by default. For Orduin it is a schema change (its own migration calls `stampBlockUids`), which belongs in its `docs/format.md`, not in Nabu's. **Decided 2026-11-21: 0.1.9.**
