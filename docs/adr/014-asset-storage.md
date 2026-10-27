# ADR 014 — File storage outside the document, and history modes

**Status:** Accepted (2026-10-20, validated by the owner)
**Date:** 2026-10-20
**Original:** [French](fr/014-asset-storage.md)
**Supersedes:** the "default mode" of `docs/design/file-handling.md` (bytes in the Loro `assets` map)
**Related:** ADR 010 (persistence), `docs/design/clipboard-format.md`, `docs/design/import-export.md`, audit 2026-10 (theme 6)

---

## 1. Context

Since the beta, a file sent in the default mode has been stored **inside the Loro document** (`assets` map, reference `nabu-asset:<uuid>`). The intent was a self-contained document: a single snapshot holds everything.

Problems observed during the audit:

- **Loro keeps the whole history**, and persistence exports a *complete* snapshot (`mode: 'snapshot'`). A deleted file therefore stays **forever** in the saved document. Adding then removing images makes the document grow without limit.
- A CRDT is made for text and structure that change often, not for immutable blobs: every save and every future synchronization carries those bytes.
- Text and a file do not have the same lifetime: text changes constantly, a file never changes once sent.

Moreover, the complete history has real value (e.g. a novelist who wants to follow the whole evolution of their text): it must **never** be lost without an explicit decision.

## 2. Decision

1. **The document and its history contain only references.** The bytes live in a **separate file store**.
2. **References by content hash**: `nabu-asset:sha256-<hex>`.
3. **The complete history is the default mode.** Compaction only happens on the integrator's explicit request, with safeguards.

## 3. Design

### 3.1 References

- Format: `nabu-asset:sha256-<64 hex>` — SHA-256 hash of the bytes (`crypto.subtle.digest`).
- Consequences: deduplication (the same image pasted twice = a single storage entry), integrity check on import, copy-paste between documents sharing the same store without copying the bytes.
- Existing references remain readable: `nabu-asset:<uuid>` (beta, migrated — §3.7) and host URLs (`https://…`, refs returned by `onBeforePersist`).

### 3.2 File index in the document (metadata only)

The document carries a small Loro map `assetIndex`: `hash → { mime, name, size, url? }`.

- **Never any bytes** in it: a few dozen bytes per file, the history stays light.
- `url`: the location at the host once the upload is finished (what `onBeforePersist` returns). Another device opening the document thus knows where to find the file.
- The media block only stores `ref` (+ `alt`, `name`, `status`), as it does today.

### 3.3 Stores (`AssetStore`)

Internal, pluggable interface:

```js
/** @typedef {{ has(hash): Promise<boolean>, get(hash): Promise<Blob|null>,
 *              put(hash, blob, meta): Promise<void>, delete(hash): Promise<void>,
 *              keys(): AsyncIterable<string> }} AssetStore */
```

| Context | Default store |
|---|---|
| `createEditor` / `new Nabu()` (no persistence) | `MemoryAssetStore` (lost on reload, like the document) |
| `createPersistedEditor` | `IndexedDBAssetStore` — database `nabu`, object store `assets`, **shared by all the documents of the origin** (deduplication across documents), with an index `docRefs[docId] → Set<hash>` for housekeeping |
| `files.store` option | store provided by the integrator (same interface) |

The local store also serves as a **cache** for files hosted at the host.

### 3.4 Lifecycle of a file

1. **Reception** (chooser, paste, drag and drop, import): hash computation, **immediate local write** (`store.put`), entry in `assetIndex`, block created with `ref = nabu-asset:sha256-…`.
   - Without a host: status `ready` immediately (offline, instant).
2. **With a host** (`onBeforePersist`): the block is `pending`, the upload starts in the background with `{ signal, onProgress }`.
   - The local copy **is the outbox**: if the tab is closed, the upload **resumes on reopening** (the list of pending uploads is persisted next to the store, outside the document).
   - Success: `assetIndex[hash].url = …`, status `ready` — commit **outside undo** (silent origin, already in place). The block's reference **does not change** (no more ref swap).
   - Failure: status `error`, the local copy is kept so that it can be retried.
   - Opened on another device before the upload ended: neither local bytes nor `url` → displayed status "upload interrupted".
3. **Display**: `Files.resolve(ref)` → objectURL from the local store, otherwise the index `url` (through `config.resolve` if provided), otherwise a "missing file" state. ObjectURLs are revoked when no mounted block uses them any more.
4. **Deleting a block during the upload**: if no block uses this hash any more, the upload is **cancelled** (`AbortController`); a Ctrl+Z restarts it.

### 3.5 APIs prepared for the interface (no UI for now)

In accordance with the rule "new interface = dedicated design sessions", only the core is delivered:

- `block.progress` (reactive, 0–1, `null` outside an upload); `block.retry()`, `block.cancel()`; `block.setAlt()` (already exists).
- `files.maxFileSize` option (no limit by default): a file that is too large is refused with a `rejected` status and a readable reason (not only a console warning).
- Events for drag and drop (hover, drop) that the future interface will be able to use.

### 3.6 History modes and file housekeeping

```js
createPersistedEditor({ docId, history: 'full' })            // default
createPersistedEditor({ docId, history: { mode: 'compact', retain: '30d', onBeforeCompact } })
nabu.compact({ retain, onBeforeCompact })                      // explicit, for integrators that synchronize
```

| | `full` (default) | `compact` (opt-in) |
|---|---|---|
| Text history | kept in full | kept over the `retain` window (or nothing if `retain: 0`) |
| Files | kept as long as **any version** of the document references them | released when no kept version references them any more |
| Size | grows with the text only (files are no longer in it) | bounded |

**Safeguards** (no essential information lost, including across sessions):

1. **Never any automatic compaction** without an explicit `history: { mode: 'compact' }`.
2. **Prior archiving**: `onBeforeCompact(fullSnapshot)` receives the **complete** snapshot just before; the integrator can archive it.
3. **Configurable retention** (`retain`), through a *shallow* Loro snapshot at a past version.
4. **Refusal** if a file upload is in progress or if changes are not yet saved.
5. **Synchronization**: a peer left on a version prior to the compaction can no longer resynchronize through incremental updates → it is up to the integrator to choose the moment (`nabu.compact()`).
6. Housekeeping of the shared store only deletes a file if **no** document references it (`docRefs` index); in host mode, Nabu deletes nothing at the host: it emits `onAssetReleased(ref)` and the integrator decides.

### 3.7 Migration of beta documents

On opening, if the Loro `assets` map contains bytes (beta format):

1. each entry is hashed and written to the store; `assetIndex` is completed;
2. the `nabu-asset:<uuid>` blocks receive their new ref `nabu-asset:sha256-…` (a silent commit, outside undo);
3. the entries of the `assets` map are removed.

Accepted limitation: in `full` mode, the old bytes remain in the document's **history** (that is the nature of a complete history); only an explicit compaction frees them.

### 3.8 What does not change

- **Export and clipboard** still carry the bytes (`assets` in the fragment / the JSON export, now indexed by hash): an exported document remains self-contained. On import, the hash is verified.
- Security: all URLs remain filtered by `sanitizeUrl`.
- `onBeforePersist(file, { signal, onProgress })` keeps its contract; the `ref` it returns becomes the index `url`. Documents that already contain host refs keep working.

## 4. Consequences

- ✅ Light history even in full mode; no more unbounded growth caused by files.
- ✅ Deduplication, integrity, upload resumption, offline.
- ✅ Sound basis for the future synchronization (SurrealDB): files travel through their own channel.
- ⚠️ In local mode without a host, files are **not** synchronized between devices (they are in the browser's IndexedDB) — to be handled together with synchronization.
- ⚠️ A document on its own (Loro snapshot) is no longer self-contained: the export (JSON/clipboard) or the store is needed to have the files. This is the price of the decoupling.
- ⚠️ Breaking change for anyone who read the Loro `assets` map directly (not publicly documented).

## 5. Out of scope

- Synchronization of files between devices in local mode.
- Interface (progress, retry, alternative text, drop hover) — design sessions.
- Eviction policy for the local cache (maximum size) — to be decided if needed.

---

## 6. Implementation notes — lot 2 (host mode, outbox, upload state)

Decisions taken while implementing §3.4 step 2, §3.5 and the clipboard guard of §3.8:

1. **The queue is driven by the document, not by calls.** `Uploads` (`files/uploads.svelte.js`) reconciles after each commit that touches a media `ref` / `status` (or deletes a node while an upload runs): a block `pending` with a `nabu-asset:sha256-…` ref, local bytes, no index `url` and no running upload starts one; a running upload nobody references any more is aborted. This one rule gives resume after a reload, restart on undo, and removes any race between "block inserted" and "upload started". Typing never triggers it. A file nobody has referenced yet (`Files#persist`) is not aborted by the "last block deleted" rule.
2. **The block keeps its hash ref; the host ref lives in the index.** Success = one silent commit: `assetIndex[hash].url = ref` + blocks `pending`/`error` -> `ready`. A host returning nothing keeps the local file (`ready`, no `url`). If the host answers after the last block was deleted (signal ignored) the `url` is still recorded; after a user `cancel()` the answer is ignored.
3. **Status / reason model.** `status` (stored): `ready | pending | error | missing | rejected`. `reason` (stored next to it, `{ code, message }`, validated on read): `too-large` (rejected), `upload-failed` and `cancelled` (error), `unavailable`, `not-embedded`, `corrupt` (missing). A `pending` block that no upload runs for and whose file is neither local nor hosted is SHOWN as `missing` with the reason `interrupted` (`block.isMissing` / `displayStatus` / `reason`); the stored status is left alone, so the original device still resumes it.
4. **Cancel = `error` + reason `cancelled`** (not a new status): the UI treats it like a failed upload and offers `retry()`. Cancel and retry are per file (hash), they affect every block showing it. A cancelled upload is never restarted automatically. A FAILED upload is not restarted during the session (`retry()`), but since 2026-10 (P-97) the uploads the outbox lists when a persisted document is OPENED are retried by themselves in the background (see ADR 010, "Implementation notes — 2026-10 (theme 8, lot 2)", and `files.autoRetry`).
5. **Delete / undo.** Deleting the last block that shows a file in flight aborts it (outbox entry kept as `pending`, block data untouched); the undo brings back a block still `pending`, the reconcile restarts it. If the tab closes in between, the next open drops the entry (the document no longer references the file).
6. **Outbox** = a per-document record (`hash`, `attempts`, `state: pending | error`, `updatedAt`), outside the document, `files.outbox` (default in memory, `IndexedDBOutbox` for `createPersistedEditor`). The document statuses plus the local bytes decide what runs; the outbox adds attempts counting, survives a lost status (an entry still `pending` whose block was saved `ready` puts it back to `pending`), and is cleaned at open (unreferenced, already hosted or no local copy). IndexedDB: version 2 -> 3, new store `outbox` (`keyPath ['docId','hash']`, index `docId`), additive upgrade. Delivery is at-least-once: a tab closed after the host answered but before the snapshot was saved uploads the file again on the next open; hooks should be idempotent.
7. **`maxFileSize`**: the block is CREATED as `rejected` (no ref, `name` kept, `reason`), never only a warning; nothing is stored or uploaded; the refusal travels with a copy; a remote image over the limit keeps its URL.
8. **P-65**: at open, every indexed file up to `maxInlineSize` is read into the embed cache (about the cache budget in total). A copy / export that still lacks bytes writes `{ omitted: true }` entries (no `data`; backward compatible: older readers see "no bytes") and `nabu.warn`s; the receiver flags the block `missing` / `not-embedded` unless its store has the file.
9. **Persist / paste in host mode.** `Files#persist` = ingest + background upload, resolves with the hash ref. `stage` always ingests (no base64 round trip any more) and sets `status: 'pending'` on the block; `adoptAssets` keeps the hash ref and marks `pending` a file the host does not have; the beta-uuid and `importRemote` paths keep a temporary `nabu-pending:` ref and settle to the hash ref (`pending` while a host has to get it).
10. `onAssetReleased(ref)` is only declared (TODO lot 3).

Known limits: a file already `ready` in a document created without a host is not uploaded when a host is configured later (only `pending` blocks are); the progress of an upload is local to the tab that runs it.

---

## 7. Implementation notes — lot 3 (history modes, compaction, release of files)

Code: `persistence/history.js` (option / `retain` parsing, choice of the kept version, scan of referenced files), `persistence/compact.js` (the compaction and all its safeguards), `persistence/release.js` (store / host release), wiring in `persistence/persistence.js`. Nothing in the core (`nabu.svelte.js`, blocks, utils) changed; `Files` gained `hostUrls`, `pendingUploads`, `releaseIndex`.

1. **`full` is the default and drops nothing.** Without `history: { mode: 'compact' }` and without an explicit `nabu.compact()` call, no code path compacts, trims or releases a file: the document saved is always the complete snapshot (`mode: 'snapshot'`), opening and saving any number of times leaves its size unchanged, and every file the index lists stays in the store and in the document's `docRefs` (**full mode = no garbage collection at all** for the files of this document, whichever version references them). Tests: `history-compaction.test.js` (open / save 5 times, first version still reachable), e2e 13.
2. **Option.** `history: 'full' | { mode: 'full' } | { mode: 'compact', retain, onBeforeCompact }`. Invalid values throw a `TypeError` before anything is read (a typo must not pick a mode). `retain` is **required** in compact mode: a duration in ms, `0` (= keep no past history), or `'<number><s|m|h|d|w>'` (`'30d'`, `'12h'`, `'1.5h'`). Strict parser, no other unit, `'30'` is refused.
3. **When.** `compact` mode compacts **at open**, after load, beta migration and the upload reconciliation (`Files#whenIdle()`), never mid-session. `nabu.compact({ retain, onBeforeCompact })` is the explicit API, installed by `createPersistedEditor` (it needs the saved snapshot and the store). It resolves with a `CompactResult` (`compacted`, `reason`, `bytesBefore`, `bytesAfter`, `released`, `deleted`, `snapshot`) and **never throws for a refusal**; only an invalid argument throws. A refusal at open is a `nabu.warn` and the document opens complete.
4. **Timestamps.** Loro does not record them by default; `createPersistedEditor` calls `doc.setRecordTimestamp(true)` right after creating the document (a few bytes per change, nothing else changes; Loro keeps them ascending). Loro merges consecutive commits closer than 1000 s into one change stamped with the first commit's time, so a retention window is applied with a 1000 s margin in favour of keeping more.
5. **Choice of the kept version (the "frontier").** `retain: 0`: the current version. Otherwise the changes are walked in causal order (lamport) and the kept start is the end of the longest prefix whose changes are all older than `now - retain`. A change **without a timestamp** (document written before timestamps were recorded) counts as old only if a LATER dated change is itself old; an undated history is therefore **never windowed away** (only `retain: 0` compacts it) — the cautious reading of "no loss unless opted in". The version is then handed to `doc.export({ mode: 'shallow-snapshot', frontiers })`; history from that version on is kept (a checkout of the retention point or any later version works, older ones throw). A result that does not go past the previous compaction point is `nothing-to-compact` (no write).
6. **Replacing the document.** Loro cannot trim a document in place (importing a shallow snapshot into a non-empty document does not drop its history, and `forkAt` is unsupported on shallow documents), and the blocks / maps / undo manager are bound to the live `LoroDoc`; swapping it under a mounted editor would mean rebinding the core. Therefore:
   - **at open** the instance created to load the document (nobody has seen it yet) is compacted, its shallow snapshot is saved, and a **fresh `Nabu` is built from that snapshot** and returned: the history is gone from memory too, and the editor is seamless;
   - **`nabu.compact()` on a live editor** saves the shallow snapshot to IndexedDB and from then on **every save of that editor is a shallow snapshot at the same version** (`export({ mode: 'shallow-snapshot', frontiers })`), so the saved document stays compacted. The in-memory document keeps its history until the editor is opened again (it is not freed, but the live editor is untouched: zero risk). `result.snapshot` is the compacted snapshot for integrators that sync.
7. **Safeguards (all in `compact.js`, each tested).** (a) never unless opted in / called; (b) `onBeforeCompact(fullSnapshot)` is awaited **before anything is changed or written**; a throw / rejection (sync or async) aborts with `archive-failed`, the stored snapshot, the files and the index untouched. The kept version and the archived snapshot are taken in the same synchronous turn (no `await` between), so what is dropped is exactly what the archive contains; edits made while the archive is awaited are after the kept version and survive; (c) refusals, no throw, nothing dropped: `pending-uploads` (outbox not empty or an upload running — checked before any write, also an `error` entry: the local copy is then the only copy), `unsaved-changes` (uncommitted operations, or a version newer than the last save), `detached` (checked out to an old version), `busy` (another compaction runs); at open the pending changes of the opening itself (a beta migration) are saved first; (d) retention honored (see 5); (e) **the undo stack is cleared** after a compaction (its steps could resurrect blocks whose files were released or point at dropped history); editing afterwards is undoable normally. Extra checks: the shallow snapshot is imported into a scratch document and its state compared with the live one before being written (`verification-failed` aborts); saves and the critical part of a compaction are serialized.
8. **Release of files.** The files kept are those found as `nabu-asset:sha256-…` in the current state, in the state **at the kept version** and in every operation after it (scanned on a scratch copy; generic, no block type involved). The other indexed files are released: their `assetIndex` entries are removed in one silent commit (they remain in the archived / dropped history), `docRefs` of the document is rewritten, then (after the compacted snapshot is saved) `release.js` runs:
   - bytes: a file leaves the shared IndexedDB store **only if no document's `docRefs` lists it**. A custom `files.store` without `setDocRefs / getDocRefs / clearDocRefs / referencedHashes` cannot tell: Nabu never deletes from it;
   - host mode: Nabu never deletes at the host. `files.onAssetReleased(url)` is awaited for each released hash that has an index `url` (the `ref` returned by `onBeforePersist`); an error is swallowed and `nabu.warn`ed;
   - `clearPersistence()` releases ALL the document's files (its `docRefs` plus its index) the same way, in any history mode.
   - **Grace period (multi-tab safety, `files.releaseGraceMs`, default 10 minutes, `0` disables it).** Another tab may have just added a file (or re-added one that was already stored) without having saved its `docRefs` yet. A release therefore never deletes a file whose store record `savedAt` is newer than the grace period, nor one whose `savedAt` is unknown (legacy record, or a store without `savedAt`): it is **skipped** (`result.skipped`). To make that work for deduplicated files, adding a file that is already stored now refreshes its `savedAt` (`AssetStore#touch`, optional; `IndexedDBAssetStore` does it in one transaction). Skipped files stay in this document's `docRefs` (index + "held back" files, so they are tracked and nobody deletes them meanwhile) and are reconsidered by the document's next compaction, or by the next `clearPersistence()` of a document with the same id (a cleared document keeps only its held-back files in its `docRefs`). Bytes nobody lists and that no later release revisits are the only possible leftover, never a loss. Tests: `history-compaction.test.js` (grace period describe), e2e 16.
9. **Legacy bytes.** After a beta migration in `full` mode the old bytes stay in the history (§3.7); a `retain: 0` compaction purges them (test: 60 KB document, saved snapshot back to a few KB, the migrated file still in the store).
10. **Sync (point 5 of §3.6).** A compacted document cannot be incrementally merged with a peer that is behind its shallow start; `nabu.compact()` is explicit for that reason, and `onBeforeCompact` is the place to ship the complete snapshot before the cut.


---

## 8. Implementation notes — lot 4 (drag and drop, protection against desync)

Code: `utils/drop.js` (helpers: position under the pointer, routing, range maths), the `handleDrag*` / `handleDrop` / `dropAt` section of `blocks/nabu.svelte.js`, six `ondrag*` / `ondrop` attributes in `blocks/Nabu.svelte`. The core stays agnostic (no block type is named); the only structural change is that `handlePaste`'s body became the private pipeline `#insertTransfer(dataTransfer, at)` that a drop reuses, and `insertFragment(fragment, { at })` takes an explicit position.

1. **Was the editor exposed to a desync?** The suspicion (the browser inserting DOM nodes on a drop) was checked with a real mouse drag (`page.dragAndDrop` of a `draggable` element carrying `text/plain` + `text/html` onto the editor, before any change): the browser fires `dragstart`, `dragenter`, `dragover`, `drop`, then `beforeinput` with `inputType: 'insertFromDrop'`, which `Nabu#handleBeforeinput` already cancels (it cancels every native mutation). Result: no desync — the model and the DOM stayed identical — but the drop was a silent no-op (the content was lost). The same goes for the `deleteByDrag` of a dragged selection. Files dropped without a `drop` handler would still be left to the browser's default (navigating to the file); not reproduced here, but every drop is now cancelled. So lot 4 is a feature plus a hardening, not a bug fix.
2. **Every drop is taken.** `dragenter` / `dragover` / `dragleave` / `drop` (and `dragstart` / `dragend`) are handled on the editor root, except for events whose target is a nested editor, a `[data-nabu-ui]` island, an `input` / `textarea` / `select`, or during an IME composition (those keep their native behavior). `dragover` is cancelled (= the drop is allowed) only for what the editor can read: files when some extension has a `pasteFileHandlers`, and any format a paste interpreter reads. An unreadable drag is not offered, and a `drop` is cancelled in any case.
3. **Position under the pointer (`resolveDropPosition`).** (a) The innermost block under the pointer (`elementFromPoint`, `[data-block-id]`). (b) A block without text and without children (image, divider…): beside it, `before` / `after` by the pointer's half. (c) A text block: the DOM point from `caretPositionFromPoint` (standard) or `caretRangeFromPoint`, converted with `TextBehavior#calculateOffset`, accepted only when it is a text node of THAT block's own text (not an inert part, a UI island, or a child block); else the start / end of the block by the pointer's half. (d) Anywhere else (editor padding, gaps between blocks, a container): the nearest leaf block by vertical distance (the smallest box wins a tie), start / end of its text or beside it by half — above the first block is the start of the document, below the last its end (`documentEnd`). A position is `{ block, offset, side }` with `side: 'inside' | 'before' | 'after'`.
4. **Content from outside = a paste at that position.** `#insertTransfer` is THE pipeline of `handlePaste` and of a drop: files → `pasteFileHandlers` (`Files#stage`, hash ref, `pending` with a host, `rejected` over `maxFileSize`; several files, several blocks in order), then the verbatim buffer of a `pastesAsPlainText` block (code), then the first paste interpreter that reads the payload (internal fragment, HTML, markdown / plain text). `insertFragment(fragment, { at })` lands the fragment at `at` whatever the DOM selection is; beside a block without text it first creates an empty default text block there (same transaction) that receives the fragment like any empty block (text becomes its text, a media block replaces it), so nothing stray is left. One undo step. The files of a drop are hashed asynchronously, so the text position is followed with a Loro cursor in the meantime (`#followPosition`; a block deleted meanwhile falls back to the end of the document). The editor takes the focus on a drop (Ctrl+Z works after dropping an image).
5. **Moving the editor's own text.** `dragstart` from the text selection serializes it exactly like a copy (`#writeSelection`, shared with `handleCopy`: `application/x-nabu+json`, `text/plain`, `text/html`, so it can also be dropped in another editor or application) and adds a private marker type (`application/x-nabu-drag`, a per-drag token). Dropped back into the editor it is a MOVE (`effectAllowed: 'copyMove'`, `dropEffect: 'move'`): the payload is read first (a move that cannot insert loses nothing), the source range is removed with `deleteRange` — the same function as cut / Backspace — and the fragment is inserted through the paste pipeline, **in the same transaction (one undo step)**. The drop position is corrected for the deletion (`positionAfterRemoval`: shifted back in the same block, followed into the start block when the end block was merged into it). A position inside the dragged range, ends included, does nothing (no undo step; `dropEffect: 'none'`). **Ctrl (Windows / Linux) or Alt / Option (macOS) copies** instead of moving (both accepted everywhere); a copy has no "inside" restriction. A drag out of the editor into another application or another Nabu is always a copy (the source is never deleted from `dragend`). Any other `dragstart` inside the editor (an image, a link, any draggable element) is cancelled: the browser would give a drop its own serialization of the node.
6. **Coexistence with `DragHandle`.** The handle (`ui/DragHandle.svelte`) is NOT HTML5 drag and drop: it moves blocks with pointer events (`pointerdown` on its button, which lives outside the editor, then `pointermove` / `pointerup` on the window) and `moveBefore` / `moveAfter`. No `dragstart` is ever involved, so the two never meet, and `nabu.dropTarget` stays `null` during a handle drag (e2e 26). Both reorder through the Loro tree / the same commit machinery.
7. **Reactive state for a UI (no visuals).** `nabu.dropTarget`: `{ block, offset, side, kind } | null`, a `$state.raw` updated only when it changes. Set while something droppable is over the editor, `null` when it leaves, is dropped, is cancelled (`dragend`), cannot be taken, or is the editor's own selection over itself. `kind`: `'files'` | `'content'` | `'move'`; it is derived from the declared types of the drag (the data itself is unreadable before the drop), so a drag that mixes files and text is `'files'` and resolves as a paste would (files win unless the internal format is present). A UI draws its indicator from `block.element` + `side` / `offset`.
8. **Programmatic API.** `nabu.dropAt(dataTransfer, position, { source? })` is what `handleDrop` calls after resolving the pointer; `source: { range }` makes it a move. Unit tests drive it directly (`tests/unit/drop.test.js`); the pointer mapping needs a layout engine and is covered by `tests/e2e/drag-drop.spec.ts`.

Known limits: a collapsed or hidden block is not a drop target (the nearest visible one is); the drop position is computed from the declared types and from the pointer only, so `kind` can say `'files'` for a drag that the paste rules will resolve as text; dragging a selection out of the editor does not delete the source (copy semantics); dragging selected text between two editors copies.


## Note (2026-10-27)
All four lots are implemented (audit 2026-10, P-64). `onAssetReleased(ref)`, described in §6 point 10 as only declared (TODO lot 3), is implemented in lot 3 (§7 point 8, `persistence/release.js`).
