# ADR 010: Persistence Strategy (IndexedDB and Loro Snapshot)

**Status:** Accepted
**Date:** 2026-03-15
**Original:** [French](fr/010-persistence-strategy.md)

## Context
Nabu is a local-first editor. The edited content must survive page reloads without requiring a backend. We must choose:
- **where** to store the state (localStorage, IndexedDB, file, server),
- **what** to store (plain text, JSON, binary CRDT state),
- **when** to save (on every keystroke, at intervals, on `beforeunload`).

## Decision

### Storage: IndexedDB
IndexedDB is used rather than `localStorage` for two reasons:
- It supports `Uint8Array` natively (no costly base64 serialization).
- Its capacity is much larger (~50% of the available disk versus ~5 MB for localStorage).

The database is named `nabu`, with an object store `snapshots` keyed by `docId` (the current schema version and the other stores are described further down). Each entry contains `{ docId, snapshot: Uint8Array, savedAt: number }`.

### Format: binary Loro snapshot
The state is exported through `doc.export({ mode: 'snapshot' })`, a compact binary format produced by Loro that encodes the entire CRDT DAG (history included). On restore, `doc.import(snapshot)` reloads the state in a single operation, with no manual reconstruction.

This choice avoids maintaining a custom JSON serializer/deserializer and guarantees full fidelity of the CRDT state (including the history needed for undo/redo).

### Trigger: debounce on `doc.subscribe()`
`doc.subscribe()` is the Loro callback fired after every `doc.commit()`. Saving immediately on every keystroke would be too aggressive. A `setTimeout` of 2 seconds (configurable) is re-armed on every new notification, which yields a natural debounce: the save happens 2 s after the last modification.

### Interface: `createPersistedEditor()`
An async factory mirroring `createEditor()` is exposed. It enriches the `Nabu` instance with three additional methods (`saveNow`, `clearPersistence`, `isNew`) without modifying the `Nabu` class itself, in order to preserve separation of concerns.

## Consequences
- **No backend required** for basic persistence.
- **Opaque restore:** the binary snapshot cannot be inspected without Loro. No data migration is possible between major versions of Loro without a dedicated strategy.
- **Multiple tabs:** originally, two tabs on the same `docId` overwrote each other (the last one to save won). **Resolved (2026-10, theme 8, batch 2, P-94):** merge before every save plus live synchronization through `BroadcastChannel` (see "Implementation notes, 2026-10 (theme 8, batch 2)"). A network CRDT provider is still required for collaboration between machines.
- **No schema version management:** if the structure of the blocks changes in an incompatible way, old snapshots may produce errors on import.

## Implementation notes, 2026-10 (theme 8)

Robustness of persistence (audit 2026-10, P-91, P-92, P-93, P-95, P-96; multi-tab, P-94, is the next batch). The happy-path behavior (Loro snapshot in `snapshots`, debounce on `doc.subscribe()`) does not change; the public API (`createPersistedEditor`, `isNew`, `saveNow`, `clearPersistence`, `history`) remains compatible.

- **Maximum wait (P-96):** option `maxWait` (default 3000 ms, never shorter than `debounce`, `0`/`Infinity` for the old behavior). The debounce is a pure scheduler (`persistence/autosave.js`, injectable clock, unit-tested): on every change the timer is set to `min(debounce, maxWait - time elapsed since the first change of the burst)`.
- **Save on close (P-91):** `visibilitychange` (→ `hidden`) and `pagehide` listeners, added by the persisted editor and removed by `nabu.persistence.dispose()` (which also cancels the autosave and closes the connection). Immediate save if there are unstored modifications. *Observed limit:* an IndexedDB transaction started during unload does not complete on a reload (Chromium; it does complete on a navigation if its requests are issued synchronously and committed with `tx.commit()`). Measures: a connection kept open since startup (`IDBConnection`); backup rotation done without a prior read (`previous` = last record written or loaded by this session) so that all requests are issued in the same task; and a **tail** in `localStorage` (`nabu:tail:<docId>`, `doc.export({ mode: 'update', from })` in base64, ≤ 256 KB), written synchronously, merged at the next startup (idempotent Loro import; document never saved: the tail is the document), deleted by the first successful save, set aside under `…:unapplied` if it cannot be applied. This remains a reasonable-effort measure (crash, killed process: the last few seconds are lost).
- **Unreadable document (P-92):** schema of the `nabu` database moved to **version 4**, which ADDS `backups` (same shape as `snapshots`) and `quarantine` (key `<docId>@<timestamp>[-backup]`, index `docId`); the data of an older database is not touched and a document without a backup loads as before. Each save (a single transaction) makes the replaced snapshot the backup, if it is readable binary (an unreadable record never replaces a good backup). A compaction deletes the backup (deleted history must not survive in a copy). On load, a pure decision `resolveLoad` (`persistence/recovery.js`): snapshot → backup → empty; every record that fails is copied into `quarantine` BEFORE any modification of the active record (restored from the backup, or deleted if nothing readable remains), in one transaction. If this setting aside fails, nothing is written (in-memory editor). `clearPersistence()` also deletes the document's backup and quarantine.
- **IndexedDB unavailable (P-93):** `indexedDB` absent, `open` in error, or opening blocked for more than 3 s by another tab: the editor starts in memory (`MemoryAssetStore` and an in-memory outbox for files), `nabu.persistence.available === false`, status `'unavailable'`, a warning; no rejection. `saveNow()` rejects ("unavailable"), `clearPersistence()` does nothing.
- **State and errors (P-95):** `nabu.persistence` (`persistence/state.svelte.js`, `$state`: `status`, `lastSavedAt`, `lastError`, `available`, `recovery`); statuses `saved | pending | saving | error | unavailable`. An automatic save that fails: status `error`, a warning, `onSaveError(error)`; the next modification retries; `saveNow()` rejects for whoever awaits it (without calling the hook). Persistence warnings use `console.warn` directly: `nabu.warn` is silent outside `nabu.debugging`.
- **Tests:** `tests/unit/persistence-autosave.test.js` (scheduler, load decision), `tests/unit/persistence-robustness.test.js` (fake-indexeddb: rotation, quarantine, unavailability, statuses, close, tail), `tests/e2e/persistence-audit.spec.ts` (2b, 2b′, 2b″, 2c, 6a–6e, 7a–7e, 7bis).

## Implementation notes, 2026-10 (theme 8, batch 2: multi-tab P-94, pending uploads P-97)

Owner's decisions (2026-10-26): merge before save plus live synchronization between tabs; undo does not survive a reload; automatic retry of pending uploads on open, with spacing.

### Merge before save (P-94, a)

- **One transaction, read and write** (`saveMerged`, `indexeddb.js`): the `readwrite` transaction (snapshots + backups + quarantine) reads the stored record, SYNCHRONOUSLY calls `prepare(stored)`, then writes the result. IndexedDB serializes `readwrite` transactions on the same store across tabs: two simultaneous saves cannot overwrite each other, the second reads what the first wrote.
- **`prepare`** (`persistence.js`, `save()`): if the record is not the one this editor last wrote or loaded (`savedAt` + size), `mergeStored(doc, bytes, nabu.importRemote)` (`merge.js`) reads the record's **version vector** from its header (`decodeImportBlobMeta`, without decoding everything) and compares it with the document's (`VersionVector.compare`): it imports only if the record is ahead or concurrent. Then the document is exported (`snapshot`, or `shallow-snapshot` after a compaction in this session) and written. **If the record already contains the whole document, nothing is written** (the status returns to `saved`; the record read becomes "the last stored one" for the backup rotation). The replaced record becomes the backup, as before.
- **Non-mergeable record** (unreadable bytes, or a *shallow* snapshot from another tab containing changes this document cannot receive: Loro does not import a shallow snapshot into a non-empty document): copied into `quarantine` under `<docId>@<timestamp>-unmerged` BEFORE being replaced, with a warning. Never a silent loss.
- **`Nabu#importRemote(bytes)`** (`nabu.svelte.js`): `doc.import` plus cursor preservation. Loro's `UndoManager` only records LOCAL commits: an import is **never an undoable action** (verified: `canUndo()` stays `false` after an import) and undoing one's own modifications afterwards works (Loro transforms them). Blocks and text are updated through the usual Loro events (tree, `LoroText.subscribe`).
- **"Blind" write on close:** on `pagehide`/`visibilitychange`, the save is still issued without a prior read (`previous` = last known record: all requests in the same task, as closing requires) **as long as no other tab has written since**: each save leaves in `localStorage` (`nabu:rev:<docId>`) the token (`savedAt:size`) of the record, which other tabs can read synchronously. If the token differs from the one this tab knows, the closing save **merges** (asynchronous: it completes when the tab merely goes to the background; for a page that is really going away, the `localStorage` tail, written in all cases, keeps the changes). No token (record written by an older version): as before (blind).

### Live synchronization (P-94, b, c)

- **Option `sync`** (default `true`); `nabu.persistence.sync` (reactive) tells whether it is running. No `BroadcastChannel` (or IndexedDB unavailable): silently ignored. `nabu.persistence.dispose()` closes the channel.
- **Protocol** (`sync.js`, channel `nabu:<docId>`, messages `{ t, from, to?, … }`, `from` = random identifier of the editor): `update { bytes }`: Loro update (`export({ mode: 'update', from: <last broadcast version> })`), broadcast after each LOCAL commit (`doc.subscribe`, `by !== 'import'`), or sent to a peer in reply to a `hello`. `hello { vv, reply? }`: "here is my version, send me what I am missing": sent on open and when an update arrives with a gap (`status.pending` non-empty); the recipient replies with an `update` of what the sender is missing and, if the sender has something it lacks (and this is not already a reply), with its own `hello` (`reply: true`): two tabs that have diverged (frozen, offline) converge in both directions.
- **No echo:** `sent` (the version already broadcast) skips over each import; imports emit nothing. An update received during an IME composition waits for it to end (re-checked every 120 ms).
- **Files:** an import never triggers an upload to the host (`Uploads#onDocEvent` ignores `event.by === 'import'`): the tab that pasted the file owns the upload, and two tabs do not upload the same file. If it disappears before completion, the next open resumes (P-97).
- **Cursor (c):** before any remote import, the DOM selection is captured as Loro cursors (the undo mechanism of ADR 015, `captureSelection`), then restored after the render (`restoreSelection(…, reveal = false)`: no scrolling). Otherwise the text of a node rewritten by Svelte would send the cursor to the start of the block.
- **Known limits:** (1) two tabs that create the same NEW document at the same time each have their own initial empty paragraph: after synchronization there are two (Loro merges two independent creations). (2) The `localStorage` tail is shared between the tabs of a `docId`: a tab's save erases it; with synchronization, the other tabs already hold these changes in memory. (3) A compaction done by another tab during a session is not mergeable (see above: quarantine).

### Retrying uploads on open (P-97)

`Uploads` (ADR 014) retries on its own, in the background, the uploads that the outbox lists on open: a file in `error` immediately (attempt 1), then, on each failure, after 2 s, 4 s, 8 s… (cap 60 s); 8 attempts per file and per session; the `online` event gives a fresh series; when offline (`navigator.onLine === false`) no attempt is consumed. An upload cancelled by the user (`cancelled`) is not retried; failures of the current session remain with `block.retry()`. Option `files.autoRetry` (`false` or `{ initialDelay, maxDelay, maxAttempts }`). It goes through `Uploads#retry` (`error` → `pending` → `ready` / `error`), hence the same path as `block.retry()`; `persistence.dispose()` stops the timers.

### Tests

`tests/unit/persistence-multitab.test.js` (merge, protocol, echo, hello, gap, composition, quarantine, token, close), `tests/unit/asset-uploads.test.js` (retry, spacing, cap, `online`, offline, cancellation, `autoRetry: false`, import), `tests/e2e/persistence-audit.spec.ts` sections 4 (4a–4j) and 9 (9, 9b).
