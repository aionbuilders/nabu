---
title: Nothing gets lost
description: Saving, merging tabs, going offline, and files that live outside the document.
chapter: 6
adrs: [10, 14]
xray: persistence
---

Type a few words in the editor below and watch the status line. This editor saves into your browser's IndexedDB, under its own document id: nothing leaves your machine, and there is no server on the other end. Then open this page in a second tab and type there. The first tab will receive it.

## The shape of it

Nabu is local-first. `createPersistedEditor({ docId })` loads the document from IndexedDB, and saves a **binary Loro snapshot** of it, history included ([ADR 010](/architecture/decisions/010)). The save is debounced: two seconds after the last change, and never later than three seconds into a long burst. That second rule exists because the first version re-armed the timer on every key, so a long burst saved nothing (P-96). The editor tells you where it stands in a reactive `nabu.persistence`: `saved`, `pending`, `saving`, `error` or `unavailable`. That is the line under the widget.

## Closing the tab

A user closes a tab without telling us. We flush on `visibilitychange` and `pagehide`. In Chromium, though, an IndexedDB write started while the page unloads may not finish, as we observed. So when the page is going away we also write the changes since the last save to `localStorage`, synchronously, up to 256 KB. The next start merges that tail, and the first successful save deletes it. We call this a reasonable effort, not a guarantee: after a crash or a killed process, the last few seconds are lost ([`persistence-audit.spec.ts`](https://github.com/aionbuilders/nabu/blob/main/tests/e2e/persistence-audit.spec.ts) and the notes of ADR 010).

## When the stored data is bad

Each save keeps the record it replaces as a backup. On load, a snapshot that cannot be read is copied into a `quarantine` store before anything else is touched, and the editor starts from the backup, or empty. If IndexedDB is missing or blocked, the editor starts in memory, reports `unavailable`, and does not throw. We wrote this after the audit showed that a corrupt record made the document impossible to open for good (P-92) and a missing IndexedDB meant no editor at all (P-93). The tests are in [`persistence-robustness.test.js`](https://github.com/aionbuilders/nabu/blob/main/tests/unit/persistence-robustness.test.js).

## Two tabs

Until 26 October two tabs on the same document silently overwrote each other, and the last save won (P-94). It was a known limit of ADR 010 and it was a bad one. Now every save runs in one IndexedDB transaction that reads the stored record first. If the record holds changes this tab does not have, they are imported before writing, and nothing is written if the record already has everything. On top of that, tabs talk through a `BroadcastChannel`: each local commit sends a Loro update, and a tab that notices a gap asks the others for what it is missing. A change that arrives from another tab is never an undo step, and the caret stays on its character. The protocol is in [`sync.js`](https://github.com/aionbuilders/nabu/blob/main/src/lib/persistence/sync.js), the tests in [`persistence-multitab.test.js`](https://github.com/aionbuilders/nabu/blob/main/tests/unit/persistence-multitab.test.js).

## Files stay outside the document

We first stored the bytes of an image inside the Loro document. It seemed tidy: one snapshot, everything in it. Then we noticed that Loro keeps history and we save complete snapshots, so a deleted image would live on forever, and every save and sync would carry it. [ADR 014](/architecture/decisions/014) reversed that. The document keeps a reference, `nabu-asset:sha256-…`, and a small index of metadata. The bytes go to a content-addressed store, so pasting the same image twice stores it once. With an upload hook, the local copy is the outbox: close the tab before the upload ends, and it resumes when you come back.

History is kept in full by default. Compaction exists, but it is opt-in and it refuses to run if there are unsaved changes or uploads in flight, and the full snapshot is handed to your code first ([`history-compaction.test.js`](https://github.com/aionbuilders/nabu/blob/main/tests/unit/history-compaction.test.js)).

> [!TIP]
> A document survives a reload, a crash that leaves its last seconds behind, a corrupt record and a second tab, with no server. A pasted file is deduplicated and its upload resumes. And you never lose history without explicitly asking to.

> [!WARNING]
> Nabu ships no network transport. Sync does not cross browsers or machines: for that you bring your own, through `nabu.doc` and `importRemote` ([persistence guide](/docs/guides/persistence-and-sync)). Two peers must start from the same snapshot. Two tabs that create the same new document at once each get their own first paragraph, and after the merge there are two. Saving on close is best effort, and mobile browsers may not fire the events at all. The snapshot is opaque without Loro and has no schema version. Undo does not survive a reload: we decided that, not Loro. And a Loro snapshot alone is no longer a self-contained document, because its files live elsewhere (ADR 014, consequences).
