---
title: Persistence and sync
description: Save a document in IndexedDB with createPersistedEditor, follow its save status, survive a corrupted record, edit in several tabs, choose how much history to keep, and sync with your own server through nabu.doc.
section: guides
order: 30
---

# Persistence and sync

Nabu saves a document in the browser with one call: no backend, no save button. The document is a [Loro](https://loro.dev) CRDT, saved as a binary snapshot in **IndexedDB**; the bytes of images and other files go to a separate store. Two tabs on the same document merge instead of overwriting each other, and `nabu.doc` is public so you can sync with a server of your own.

The examples that run as tests import `fake-indexeddb` on their first line, which gives them an IndexedDB. In a browser, leave that line out.

## Quick start

```js
import { createPersistedEditor } from '@aionbuilders/nabu';

const engine = await createPersistedEditor({ docId: 'my-document' });
```

`createPersistedEditor` is the asynchronous twin of `createEditor()`: it loads the stored document first, then creates the editor. With nothing stored, the document starts empty. From then on, every change is saved automatically:

- **2 seconds** after the last change (`debounce`), and at least every **3 seconds** during a long burst of typing (`maxWait`);
- **immediately** when the page is hidden or closed (see [what is guaranteed](#what-is-guaranteed-when-the-page-closes)).

```js test
import 'fake-indexeddb/auto'; // tests only: a browser has IndexedDB
import { createPersistedEditor, DocumentPreset } from '@aionbuilders/nabu';

// A long debounce keeps the example free of timers: we save by hand.
const options = { docId: 'guide-quickstart', preset: DocumentPreset, debounce: 3_600_000 };

const first = await createPersistedEditor(options);
expect(first.isNew).toBe(true); // nothing was stored

await first.importMarkdown('# Notes\n\nSaved in the browser.');
await first.saveNow();
expect(first.persistence.status).toBe('saved');
first.persistence.dispose(); // as when the page goes away

// A later session restores it.
const second = await createPersistedEditor(options);
expect(second.isNew).toBe(false);
expect(second.serialize('markdown')).toBe('# Notes\n\nSaved in the browser.');
second.persistence.dispose();
```

Persistence is for **content in the user's browser**. Undo history is not saved: after a reload, Ctrl+Z only undoes what happens in the new session (the document's own edit history is kept: see [History](#history-full-or-compact)).

## Options

`createPersistedEditor` takes `docId` plus every option of [`createEditor`](../getting-started/first-editor.md) (`preset`, `extensions`, `files`, `placeholders`, `keymap`, `tab`, `lang`...), which are forwarded to the editor. Its own options:

| Option | Default | |
|---|---|---|
| `docId` | required | Key of the document in IndexedDB (database `nabu`). Documents with different ids do not interfere |
| `preset` | `FullPreset` | The extensions, as for `createEditor` |
| `extensions` | `[]` | Extra extensions appended to the preset |
| `debounce` | `2000` | Milliseconds between the last change and the save |
| `maxWait` | `3000` | During an uninterrupted burst of changes, save at least this often (never shorter than `debounce`). `0` or `Infinity`: no maximum, save only after a pause |
| `sync` | `true` | Live sync between tabs that edit the same `docId`, through a `BroadcastChannel`. `false` turns it off; without `BroadcastChannel` it is skipped silently. Merging at save time does not depend on it |
| `history` | `'full'` | `'full'` or `{ mode: 'compact', retain, onBeforeCompact }`: [History](#history-full-or-compact) |
| `onSaveError` | none | `(error) => void`, called when an **automatic** save fails (quota exceeded...) |
| `onRecover` | none | `(recovery) => void`, called at start when the stored document could not be read: [Recovery](#a-document-that-cannot-be-read) |
| `files` | none | File handling: [Files](#files-and-the-asset-store) |

An invalid `history` throws before anything is read (`createPersistedEditor` rejects): a typo must not silently pick a mode.

## What the editor gains

`createPersistedEditor` adds five members to the `Nabu` instance it returns.

### `nabu.isNew`

`true` when no snapshot existed at start (a fresh document, or nothing readable was left), `false` when the content was restored. Use it to show a welcome message.

### `nabu.persistence`

The state of the persistence, **reactive** (Svelte `$state`): read it in a template or an `$effect`, for instance for a "Saved / Saving..." indicator.

```svelte
<script>
  let { engine } = $props();
</script>

<span class="save-status" data-status={engine.persistence.status}>
  {engine.persistence.status}
</span>
```

| Member | |
|---|---|
| `status` | `'saved'`: everything is stored. `'pending'`: changes wait for the next save. `'saving'`: a save is running. `'error'`: the last save failed; the changes stay in memory and **the next change retries**. `'unavailable'`: IndexedDB cannot be used, the editor works in memory only |
| `lastSavedAt` | Epoch milliseconds of the last successful save of this session, or `null` |
| `lastError` | The error of the last failed save, or why storage is unavailable; `null` after a successful save |
| `available` | `false` when IndexedDB could not be opened at start (missing, refused, blocked by another tab...). The editor then starts **in memory**, with a console warning; `createPersistedEditor` does not reject |
| `recovery` | `null`, or what happened when the stored document could not be read |
| `sync` | `true` while live sync with other tabs is running |
| `dispose()` | Stops the persistence of this editor: cancels the pending save, removes the page listeners, closes the sync channel and the IndexedDB connection. The editor keeps working in memory. Idempotent |

Call `dispose()` when the editor is destroyed, for instance in the cleanup of the component that created it:

```svelte
<script>
  import { onDestroy } from 'svelte';
  import { NabuEditor, createPersistedEditor } from '@aionbuilders/nabu';

  let engine = $state(null);

  createPersistedEditor({ docId: 'article-draft' }).then((created) => {
    engine = created;
  });

  onDestroy(() => engine?.persistence.dispose());
</script>

{#if engine}
  <NabuEditor {engine} />
{/if}
```

Persistence warnings (`console.warn`, prefixed `[Nabu]`) are always written, even when `nabu.debugging` is off: the user may be losing work.

### `nabu.saveNow()`

Saves immediately, without waiting for the debounce. It resolves when the IndexedDB write is done and **rejects** if it fails, or if persistence is unavailable or disposed (the failure is yours to handle: `onSaveError` is not called for it). Use it before navigating away on purpose, or before a critical dialog. There is no need to call it when the page closes: Nabu does it.

### `nabu.compact(options)` and `nabu.clearPersistence()`

`compact` is covered in [History](#history-full-or-compact).

`clearPersistence()` deletes the stored snapshot of this `docId`, its backup, the records that were moved aside, and **releases its files**. The next editor created with this `docId` starts empty (`isNew === true`). It is the implementation of a "Reset document" button. The content still in memory is deliberately not saved again when the page closes: only the next change restarts the autosave.

```js test
import 'fake-indexeddb/auto';
import { createPersistedEditor, DocumentPreset } from '@aionbuilders/nabu';

const options = { docId: 'guide-clear', preset: DocumentPreset, debounce: 3_600_000 };

const engine = await createPersistedEditor(options);
await engine.importMarkdown('Throw me away');
await engine.saveNow();

await engine.clearPersistence();
engine.persistence.dispose();

const fresh = await createPersistedEditor(options);
expect(fresh.isNew).toBe(true);
fresh.persistence.dispose();
```

## What is guaranteed when the page closes

Be precise with yourself about this: it is **best effort**, not a guarantee.

On `visibilitychange` (to `hidden`) and on `pagehide`, if anything is unsaved, Nabu saves at once without waiting for the debounce. But an IndexedDB write started while a page unloads is asynchronous: the browser may finish unloading before it commits (Chromium drops it on a reload, and often on a close). So Nabu also writes the changes since the last save **synchronously to `localStorage`**, under `nabu:tail:<docId>` (a Loro update in base64, up to 256 KB). At the next start they are merged into the document (with no duplicate if the IndexedDB write did finish), and the first successful save removes the trace. A tail that does not merge is kept aside under `nabu:tail:<docId>:unapplied`.

What this covers: closing a tab, reloading, navigating away, switching tabs. What it does **not** cover: a crash, a killed process, a browser (mobile ones in particular) that never sends these events, a change larger than the tail. In those cases the last seconds are lost. If that matters more than a convenience, call `saveNow()` at the moments you care about.

## A document that cannot be read

Every successful save keeps the snapshot it replaces as a **backup**. At start, if the stored snapshot cannot be imported (invalid or truncated bytes...):

1. the unreadable record is **never deleted**: it is copied to the `quarantine` store (key `<docId>@<timestamp>`, with the original value, the date and the error);
2. the backup is tried (`recovery.kind === 'backup'`: the document is back at the second-to-last save);
3. otherwise the editor starts **empty** (`recovery.kind === 'empty'`, `isNew === true`);
4. a warning is written, `nabu.persistence.recovery` is set, and `onRecover(recovery)` is called. Telling the user is up to you. The editor starts in every case.

`recovery` is `{ kind, error, quarantinedKey, quarantinedKeys, at }`.

```js test
import 'fake-indexeddb/auto';
import { createPersistedEditor, DocumentPreset } from '@aionbuilders/nabu';

const options = { docId: 'guide-recover', preset: DocumentPreset, debounce: 3_600_000 };

// Two saves, so that a backup exists.
const a = await createPersistedEditor(options);
await a.importMarkdown('First version');
await a.saveNow();
await a.importMarkdown('Second version');
await a.saveNow();
a.persistence.dispose();

// Simulate a corrupted record (the storage layout is documented in the reference at the end of the page).
const db = await new Promise((resolve, reject) => {
  const request = indexedDB.open('nabu');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
await new Promise((resolve, reject) => {
  const tx = db.transaction('snapshots', 'readwrite');
  tx.objectStore('snapshots').put({ docId: options.docId, snapshot: new Uint8Array([1, 2, 3]), savedAt: Date.now() });
  tx.oncomplete = resolve;
  tx.onerror = () => reject(tx.error);
});
db.close();

let recovery = null;
const b = await createPersistedEditor({ ...options, onRecover: (info) => { recovery = info; } });

expect(recovery.kind).toBe('backup');            // restored from the previous save
expect(b.persistence.recovery).toBe(recovery);   // also kept on the instance
expect(recovery.quarantinedKey).toMatch(/^guide-recover@/);
expect(b.serialize('markdown')).toBe('First version');
b.persistence.dispose();
```

If moving the unreadable copy aside fails, the editor starts in memory (`available === false`) so that nothing stored is overwritten. A compaction deletes the backup, so that deleted history does not survive in a copy; the next save recreates it.

## A failing save

An automatic save that fails (quota exceeded...) sets `persistence.status` to `'error'`, writes a warning and calls `onSaveError(error)`. Nothing is thrown; the editor keeps working; the next change (or the page closing) tries again.

```js
const engine = await createPersistedEditor({
  docId: 'article-draft',
  onSaveError: (error) => showToast('Your last changes are not saved yet.')
});
```

## Several tabs on the same document

Two tabs editing the same `docId` do not overwrite each other. Two mechanisms work together.

**Merging at save time.** Every save reads the stored record and writes the result in one IndexedDB transaction: whatever another tab saved and this document lacks is **imported** into the live document (the screen updates like for any remote change), then the document is exported and written. If the record already contains everything, nothing is written. A record that cannot be merged (unreadable bytes, a copy compacted by another tab) is copied to `quarantine` as `<docId>@<date>-unmerged` before being replaced, with a warning: nothing is lost silently.

**Live sync** (option `sync`, on by default). Each local commit is broadcast to the other tabs through a `BroadcastChannel` named `nabu:<docId>`: what you type in one tab shows up in the other within a moment, with no save or reload. A tab opened later asks the others for what it lacks, including their unsaved changes. The caret stays on the same character when a remote change arrives, and a running IME composition is never interrupted (the changes wait for its end).

Changes that come from elsewhere are **not undoable**: Ctrl+Z only undoes your own edits. Uploads to a file host stay with the tab that pasted the file.

```js test
import 'fake-indexeddb/auto';
import { createPersistedEditor, DocumentPreset } from '@aionbuilders/nabu';

const options = { docId: 'guide-tabs', preset: DocumentPreset, debounce: 3_600_000, sync: false };

// A first session creates the document, so that both tabs start from the same history.
const seed = await createPersistedEditor(options);
await seed.importMarkdown('Shared');
await seed.saveNow();
seed.persistence.dispose();

const tabA = await createPersistedEditor(options);
const tabB = await createPersistedEditor(options);
expect(tabA.persistence.sync).toBe(false); // live sync is off here; the merge at save time is not

tabA.insert('paragraph', { text: 'written in A' });
await tabA.commit();
await tabA.saveNow();

tabB.insert('paragraph', { text: 'written in B' });
await tabB.commit();
await tabB.saveNow(); // merges what A stored, then writes

expect(tabB.serialize('markdown')).toContain('written in A');
expect(tabB.serialize('markdown')).toContain('written in B');

tabA.persistence.dispose();
tabB.persistence.dispose();

const reopened = await createPersistedEditor(options);
expect(reopened.serialize('markdown')).toContain('written in A');
expect(reopened.serialize('markdown')).toContain('written in B');
reopened.persistence.dispose();
```

Limits of the multi-tab support:

- Two tabs that create the same **new** document at the same time each keep their own initial empty paragraph, so there are two after the sync. Create the document once (or open it before the second tab).
- A compaction made by another tab during your session cannot be merged; the record is quarantined.
- Sync does not cross browsers or machines. For that, use your own transport: [Sync with your own server](#sync-with-your-own-server).

## History: `full` or `compact`

Loro keeps **all** of a document's history. That is what makes it possible to follow its evolution version by version, and also what makes it grow. Nabu never decides for you.

```js
// Default: the complete history. Nothing is ever compacted, trimmed or deleted.
await createPersistedEditor({ docId: 'book' }); // same as history: 'full'

// Opt-in: compact when the document is opened, keeping 30 days of history.
await createPersistedEditor({
  docId: 'notes',
  history: {
    mode: 'compact',
    retain: '30d',                              // ms, '12h', '30d', '2w'... or 0 = no past history
    onBeforeCompact: async (fullSnapshot) => {  // a Uint8Array: the COMPLETE snapshot
      await archive(fullSnapshot);              // if this throws, the compaction is cancelled
    }
  }
});
```

| | `full` (default) | `compact` |
|---|---|---|
| Text history | Kept in full, without limit | Kept over the `retain` window (none with `retain: 0`) |
| Files in the store | **Never deleted** | Released when neither the current state nor the kept history references them |
| When | Never | **At open**, after loading and upload recovery; never in the middle of a session |

`retain` is strict, and required in `compact` mode (there is no default that would destroy data): a number of milliseconds, `0`, or `'<number><s|m|h|d|w>'`. Versions newer than the retention point remain reachable (`doc.checkout(...)`); older ones are gone. A document whose history has no timestamps (written before they were recorded) is never trimmed by a window: only `retain: 0` compacts it.

```js test
import 'fake-indexeddb/auto';
import { createPersistedEditor, DocumentPreset } from '@aionbuilders/nabu';

// A mistake in `history` fails loudly, before anything is read or written.
await expect(
  createPersistedEditor({ docId: 'guide-history', preset: DocumentPreset, history: { mode: 'compact' } })
).rejects.toThrow(/retain/);
await expect(
  createPersistedEditor({ docId: 'guide-history', preset: DocumentPreset, history: 'forever' })
).rejects.toThrow(/history/);
```

### `nabu.compact({ retain, onBeforeCompact })`

For integrators who want to pick the moment themselves. It **never throws for a refusal** (only for an invalid argument): a refusal means nothing was deleted.

```js test
import 'fake-indexeddb/auto';
import { createPersistedEditor, DocumentPreset } from '@aionbuilders/nabu';

const engine = await createPersistedEditor({ docId: 'guide-compact', preset: DocumentPreset, debounce: 3_600_000 });
await engine.importMarkdown('Draft one');
await engine.saveNow();
await engine.importMarkdown('Draft two');

// Unsaved changes: refused, nothing was dropped.
const refused = await engine.compact({ retain: 0 });
expect(refused).toMatchObject({ compacted: false, reason: 'unsaved-changes' });

await engine.saveNow();
let archived = null;
const result = await engine.compact({ retain: 0, onBeforeCompact: (snapshot) => { archived = snapshot; } });

expect(result.compacted).toBe(true);
expect(archived).toBeInstanceOf(Uint8Array);         // the complete history, before anything was dropped
expect(result.bytesAfter).toBeLessThanOrEqual(result.bytesBefore);
expect(engine.serialize('markdown')).toBe('Draft two'); // the content is untouched
engine.persistence.dispose();
```

The result is `{ compacted, reason?, error?, bytesBefore, bytesAfter, released, deleted, skipped, snapshot }`. Reasons for a refusal include `'unsaved-changes'`, `'pending-uploads'` (a file upload is waiting or running: the local copy is the only one), `'archive-failed'` (`onBeforeCompact` threw), `'detached'` (the document is checked out at an old version), `'busy'` and `'nothing-to-compact'`.

Safeguards:

1. never without an opt-in (`history: { mode: 'compact' }`) or an explicit call;
2. `onBeforeCompact(fullSnapshot)` is awaited **before** anything is changed or written; an error cancels the compaction;
3. a refusal, not an exception, for pending uploads, unsaved changes or a checked-out document;
4. the retention window is honoured, and the compacted snapshot is verified (re-imported and compared to the current state) before it is written;
5. the **undo stack is cleared** after a compaction (its steps could resurrect blocks whose files were released).

How it works: a Loro *shallow* snapshot is written at the retention version. At open, the editor is built from it, so the history leaves memory too. With `nabu.compact()` on an open editor, the saved snapshot is compacted at once and later saves stay compacted, but the document **in memory** keeps its history until the next open. A sync peer that stayed on an earlier version can no longer merge by incremental updates.

## Files and the asset store

Files (images, videos, attachments) are not saved in the snapshot. The document holds only `nabu-asset:sha256-<hash>` references and a small index (`assetIndex`: name, size, type, host URL). The bytes live in an **asset store**:

- `createEditor`: in memory (lost with the page, like the document);
- `createPersistedEditor`: IndexedDB (database `nabu`, object store `assets`), **shared by every document of the origin**, so the same image pasted in two documents is stored once;
- `files.store`: a store of your own with the same interface.

References are content hashes, so the same file is deduplicated and a copy between documents sharing the store copies nothing. Keeping bytes out of the CRDT is what stops deleted images from living forever in the saved history.

The `files` option (`FilesConfig`):

| Option | |
|---|---|
| `store` | Where the bytes live. Default: memory, or IndexedDB for a persisted editor |
| `onBeforePersist(file, { signal, onProgress })` | **Host mode.** Upload to your server and return `{ ref }` (where you keep the file). The file is always written to the local store first and the block keeps its `nabu-asset:` reference; the upload then runs in the background (the block is `pending`, `block.progress` follows `onProgress(0..1)`). Throw to fail (`error`; the local copy is kept; `block.retry()` runs it again). Honour `signal`, and make the upload idempotent: after a reload it may run more than once for one file |
| `autoRetry` | `false`, or `{ initialDelay, maxDelay, maxAttempts }`. Uploads that were interrupted or failed are retried on their own when the document is opened, after 2 s, 4 s, 8 s... up to 60 s, 8 attempts per file and per session; the browser's `online` event starts a new series. A cancelled upload is not retried |
| `outbox` | Where the uploads still to do are listed. Default: memory, or IndexedDB for a persisted editor |
| `onAssetReleased(ref)` | Called with the host reference of a file this document no longer uses, after a compaction or `clearPersistence()`. **Nabu never deletes anything at your host**: you decide, since another document may use the same file |
| `releaseGraceMs` | Default 10 minutes. A release never deletes from the shared store a file whose record is newer than this, or whose age is unknown: another tab may have just added it without having saved its references yet. Such files are skipped and reconsidered later. `0` turns it off |
| `maxFileSize` | Largest accepted file in bytes. A bigger one makes a block with `status: 'rejected'` and a readable `reason` |
| `maxInlineSize` | Above this size (default 2 MB), file bytes are not embedded in a copy or JSON export |
| `resolve(ref)` | Turns a stored reference into a display URL |
| `importRemote` | `true`: a remote image pasted from a web page is fetched and stored instead of hot-linked. Not to be confused with `engine.importRemote(bytes)` |

```js
await createPersistedEditor({
  docId: 'article',
  history: { mode: 'compact', retain: '30d' },
  files: {
    onBeforePersist: async (file, { signal, onProgress }) => ({ ref: await uploadToMyServer(file, signal, onProgress) }),
    onAssetReleased: async (url) => { await deleteFromMyServer(url); }
  }
});
```

Details and the design: [ADR 014](../adr/014-asset-storage.md).

## Sync with your own server

`nabu.doc` is the [`LoroDoc`](https://loro.dev/docs) behind the editor, and it is part of the public API. It is the supported way to connect Nabu to a server, a WebSocket, a peer-to-peer channel or any other transport: Loro handles the merging, you only move bytes.

The loop has two sides:

- **Out.** `doc.subscribeLocalUpdates(callback)` calls you with the bytes of every local change (each keystroke, each block operation). Send them.
- **In.** Give the bytes you receive to **`engine.importRemote(bytes)`**, not to `engine.doc.import(bytes)`: it imports the same way, and it keeps the caret on the same character while the document changes under it. The change is not an undo step, and a running IME composition is not disturbed.

```js test
import { createDocumentEditor } from '@aionbuilders/nabu';

// Both peers start from the same history (a snapshot): independently created
// documents each have their own first paragraph.
const a = createDocumentEditor();
await a.importMarkdown('Hello');
const b = createDocumentEditor({ snapshot: a.doc.export({ mode: 'snapshot' }) });

// The "network": here, a direct call each way. Yours is a WebSocket, a fetch...
const stopA = a.doc.subscribeLocalUpdates((bytes) => b.importRemote(bytes));
const stopB = b.doc.subscribeLocalUpdates((bytes) => a.importRemote(bytes));

a.insert('paragraph', { text: 'from a' });
await a.commit();
b.insert('paragraph', { text: 'from b' });
await b.commit();
await new Promise((resolve) => setTimeout(resolve)); // Loro delivers events asynchronously

// Both converge, in the same order, whoever typed first.
expect(a.serialize('markdown')).toBe(b.serialize('markdown'));
expect(a.serialize('markdown')).toContain('from a');
expect(a.serialize('markdown')).toContain('from b');

stopA();
stopB();
```

To catch a peer up, exchange version vectors instead of whole documents: `doc.version()` is a version, and `doc.export({ mode: 'update', from: version })` returns only what that version lacks. `doc.export({ mode: 'snapshot' })` returns everything, and the `snapshot` option starts an editor from it.

You can combine this with `createPersistedEditor`: the browser keeps a local copy while your server holds the shared one. Imports are saved like any other change, and a file pasted in one peer still uploads from that peer only.

## Reference: where the data lives

You do not need this to use persistence. It is here for exports and diagnostics. The low-level functions (`loadSnapshot`, `saveSnapshot`...) are internal and are not exported by any entry point; go through `createPersistedEditor` and `engine.persistence`.

- Database `nabu` (version 4). Object stores: `snapshots` (`{ docId, snapshot: Uint8Array, savedAt }`, keyed by `docId`), `backups` (same shape: the snapshot the last save replaced), `quarantine` (records moved aside, keyed `<docId>@<timestamp>`), `assets` and `outbox` (files).
- `localStorage`: `nabu:tail:<docId>` (changes since the last save, written when the page hides) and `nabu:rev:<docId>` (a small token that lets tabs tell whether another one wrote).
- A `BroadcastChannel` named `nabu:<docId>` for live sync.

## Known limits

- **Schema.** If the internal structure of blocks changes in an incompatible way between versions, old snapshots may fail to import. There is no automatic migration yet. (A snapshot that fails to import falls back to the backup: see above.)
- **Opacity.** The Loro binary format is not readable without Loro. For a portable export, use `engine.serialize('json')` or `engine.serialize('markdown')`.
- **Cross-device.** Local persistence and tab sync stay on one browser. A network provider is your transport, as above.
