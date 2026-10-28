# ADR 000: A CRDT (Loro) as the source of truth

**Status:** Accepted, **retroactive**. The decision predates the first commit (2026-02-18, "Init + Base Relation Blocks + Loro System") and was never written down; this record was written on 2026-10-28. The original reasons come from `docs/archive/PROJECT_CONTEXT.md` (March 2026) and the pre-beta README; the comparison with Yjs (§3.3) is reconstructed from what the code relies on today and is to be confirmed by the owner.
**Date:** 2026-10-28
**Original:** [French](fr/000-crdt-source-of-truth.md)
**Related:** ADR 002, 003, 004 (the model), 010 (persistence, several tabs), 014 (files outside the document, compaction), 015 (undo restores the selection), 018 (regions as containers); chapter 02 "The model is the truth"; `docs/architecture/sources/comparison-2026-10-27.md`.

---

## 1. Context

### Why "000"

ADRs 001 to 005 (2026-02-19) all assume that the document is a Loro document: ADR 003 is the Loro tree, ADR 004 compares `LoroText` with nested blocks, ADR 010 saves a Loro snapshot. The decision before them was never written. Our rule is that a record is written when the decision is taken and never rewritten, so nothing is rewritten here: the gap is filled, and the record says it was filled afterwards. The number 000 gives its place in the logic (before 001); the date says when it was written.

### The original need

`PROJECT_CONTEXT.md` (March 2026) sets out:

- a **local-first** editing engine that works without a backend;
- the **"Loro-First"** rule: the truth is in Loro, Svelte and the DOM are only its reactive reflections;
- persistence in two steps: IndexedDB locally, then SurrealDB remotely;
- eventually, a modular, interconnected CMS ("Metablocks").

### The three questions

1. How do copies of one document, edited apart, reconcile: **operational transformation (OT) or a CRDT**?
2. Where does the truth live: in the **editor's own model**, kept in sync with a CRDT by a binding, or **in the CRDT itself**?
3. **Which CRDT**: Loro, Yjs, Automerge?

## 2. Decision

- The document is a `LoroDoc`: a `LoroTree` named `blocks` (one node per block, type and props in its data), text in `LoroText` with marks (ADR 004).
- This document is the **only source of truth**. There is no second editor model kept in sync with it. Svelte blocks (ADR 002) wrap it, the DOM reflects it, and every write (a keystroke, a paste, an undo, a remote tab, a call from the host) is a Loro operation.
- No server is needed to merge two copies. The network transport is left to the integrator (`nabu.doc` out, `nabu.importRemote(bytes)` in).

## 3. Rationale

### 3.1 A CRDT rather than OT

In practice OT needs a **central authority** that orders operations and makes rejected clients rebase and resubmit: that is the model of `prosemirror-collab`. Serverless OT variants exist, but they are known to be hard to get right. Nabu has to merge **without a server**, in cases it already handles:

- two tabs open on the same document (ADR 010: merge inside one IndexedDB transaction, live sync over `BroadcastChannel`);
- a document reloaded with a `localStorage` tail or recovered from a backup;
- any peer, over any transport, through `importRemote(bytes)`.

A CRDT gives that by construction: every copy can receive the changes of any other, in any order, and they all converge. `doc.import` is idempotent. There is no global order to maintain and no server to run for an offline editor to stay correct.

### 3.2 The CRDT as the truth, not as a sync layer

ProseMirror, Tiptap, Lexical, BlockNote and the others have their own document model and add collaboration through a **binding** (Yjs, or Loro through `loro-prosemirror`) that translates both ways. Nabu has no translation: the tree and the text **are** the CRDT. What that buys:

- undo is Loro's `UndoManager`, with stable cursors that stay right in the face of a remote edit (ADR 015);
- persistence saves the CRDT itself, history included, not a JSON derived from it (ADR 010);
- tab sync, a document loaded from disk, undo and a host script all take the same road: Loro operation, event, rune, DOM. There is no special case for "the DOM changed", because the DOM is never written first.

### 3.3 Loro rather than Yjs or Automerge

The repository keeps no trace of a comparison made at the time: Loro is in the very first commit. The arguments below are the ones the code relies on today; **to be confirmed or corrected by the owner.**

- **A native movable tree.** `LoroTree` implements the move operation of Kleppmann et al. ("A highly-available move operation for replicated trees"): concurrent moves are ordered, cycles are refused, children are ordered by fractional index. Nabu depends on it everywhere: dragging a block, Tab / Shift+Tab in a list, moving a whole region, and normalizers that work "with moves, never delete+recreate" so that ids and the caret survive. Yjs has no native tree move: it is emulated there with a delete followed by a re-insert, which duplicates or loses a node moved concurrently.
- **Rich text with marks** (`LoroText.mark`, deltas), which ADR 004 rests on.
- **A usable history**: binary snapshot with history (ADR 010), version vectors to decide whether to merge (several tabs), shallow snapshots for compaction (ADR 014, lot 3), stable cursors for undo (ADR 015).

## 4. Consequences

### Positive

- **Real local-first**: offline, several tabs, recovery after a crash, with no backend.
- **Network collaboration does not require changing the model**: what is missing is a transport, not an architecture.
- **One truth**: what is saved, exported as JSON, synced and undone is the same object.

### Negative

- **Weight.** Loro ships as WebAssembly: about 1.2 MB gzipped (3.6 MB raw), against 28 KB gzipped for Yjs. A Vite setup that loads WASM is mandatory (`nabu()`, `build.target: 'esnext'`).
- **Opacity.** The binary snapshot cannot be read without Loro and has no schema version (ADR 010).
- **A double representation.** Every block exists twice, as a Loro node and as a Svelte object, and the two must agree. That is where P-104 came from (a 5,000-block import in 163 s), and the cost of `tree.roots()` after the Loro upgrade from 1.10.6 to 1.17.1 (chapter 02, audit 2026-10).
- **A history that grows.** Everything is kept by default; hence files outside the document (ADR 014) and opt-in compaction.
- **Converging is not being valid.** A CRDT guarantees that copies converge, not that the result honours Nabu's schema. Example: `L1[x], P, Q, L2[y]`, two bullet lists separated by two paragraphs; one peer deletes `P`, the other deletes `Q`. Each side stays valid; the merge gives two adjacent lists of the same type (rule R4 of `list/normalize.js` broken; for numbered lists, the numbering restarts at 1 in the middle). Today `importRemote` calls `doc.import` without running the normalizers (`onBeforeTransaction` only runs on a local commit), and the list normalizer is scoped (P-106) to what the local transaction touched, assuming the document was valid before it. An invalid state that arrives through a merge can therefore stay as it is.
- **Two independent creations** of the same new document give two initial paragraphs (ADR 010, known limits).

## 5. Open questions

1. **Normalize after a remote import.** On the whole document, or on the nodes the import touched (from the Loro event)? If every peer normalizes, two peers can emit the same correction at the same time: moves to the same place converge, but deleting a container (R1: an empty list is deleted; R4: the second list is merged then deleted) while another peer inserts into that container may make the insertion disappear. To be checked with a two-document test before deciding.
2. **The network transport** (a server, peer to peer, SurrealDB as first planned): outside the scope of this record.
