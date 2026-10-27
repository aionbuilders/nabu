---
title: Autosave to your server
description: Save the document to your own backend with subscribeLocalUpdates and load it back with a snapshot, without IndexedDB, and apply changes that arrive from elsewhere with importRemote.
section: recipes
order: 10
---

# Autosave to your server

`createPersistedEditor` saves to the browser's IndexedDB. If your documents live on a server, you do not need it: the editor's document is a [Loro](https://loro.dev) CRDT, and Loro tells you what changed as **bytes** you can store anywhere. This recipe is the whole loop: load, save on change, and apply what comes from elsewhere. The background is in [Persistence and sync, Sync with your own server](../guides/persistence-and-sync.md#sync-with-your-own-server).

## The idea

- **Out.** `engine.doc.subscribeLocalUpdates(callback)` is called with the **bytes of every local change** (each keystroke, each block operation). You keep them in a queue and a debounced `flush` sends the queue as one batch. A new document, which the server has never seen, starts with a full **snapshot**.
- **Failure takes care of itself.** A batch leaves the queue only when `send` succeeds; a failed one goes back in front, and the next flush sends it again with whatever came after.
- **In.** Bytes that arrive from elsewhere (a WebSocket message, a poll) go to `engine.importRemote(bytes)`, not to `engine.doc.import(bytes)`: it keeps the caret on the same character. An imported change is not a local update, so it is **never sent back**.
- **Load.** The server returns the chunks it holds: the first is a snapshot, the rest are updates. Start the editor from the snapshot (the `snapshot` option) and import the rest.

## The code

```js test
import { createDocumentEditor } from '@aionbuilders/nabu';

/**
 * Send the local changes of `engine` to `send(chunks)`, at most once every `wait` ms.
 * `snapshot`: true for a document the server has never seen: its first chunk is the whole document.
 */
function autosave(engine, send, { snapshot = false, wait = 1500 } = {}) {
  let queue = snapshot ? [engine.doc.export({ mode: 'snapshot' })] : [];
  let timer;
  let running = Promise.resolve();

  const flush = () => {
    clearTimeout(timer);
    running = running.then(async () => {
      if (!queue.length) return;
      const batch = queue;
      queue = [];
      try {
        await send(batch);
      } catch {
        queue = [...batch, ...queue]; // back in front: the next flush sends it again
      }
    });
    return running;
  };

  const unsubscribe = engine.doc.subscribeLocalUpdates((bytes) => {
    queue.push(bytes);
    clearTimeout(timer);
    timer = setTimeout(flush, wait);
  });

  return { flush, stop: () => { clearTimeout(timer); unsubscribe(); } };
}

/** Open a document from the chunks the server holds (the first is a snapshot). */
function open(chunks) {
  const [snapshot, ...updates] = chunks;
  const engine = createDocumentEditor(snapshot ? { snapshot } : {});
  for (const bytes of updates) engine.importRemote(bytes);
  return engine;
}

// A stand-in for your backend: store the chunks, hand them back.
const server = {
  chunks: [],
  offline: false,
  async save(batch) {
    if (this.offline) throw new Error('offline');
    this.chunks.push(...batch);
  }
};

// Loro delivers events asynchronously.
const settled = () => new Promise((resolve) => setTimeout(resolve));

// 1. A new document: the first flush sends a snapshot.
const a = createDocumentEditor();
await a.importMarkdown('Hello');
const save = autosave(a, (batch) => server.save(batch), { snapshot: true, wait: 10 });
await save.flush();
expect(server.chunks).toHaveLength(1);

// 2. Edits are sent as small updates.
a.insert('paragraph', { text: 'Second paragraph' });
await a.commit();
await settled();
await save.flush();
expect(server.chunks.length).toBeGreaterThan(1);

// 3. A failed save loses nothing: the next one carries it.
a.insert('paragraph', { text: 'Written offline' });
await a.commit();
await settled();
const saved = server.chunks.length;
server.offline = true;
await save.flush();
expect(server.chunks).toHaveLength(saved);
server.offline = false;
await save.flush();
expect(server.chunks.length).toBeGreaterThan(saved);

// 4. Another client opens the document from what the server holds...
const b = open(server.chunks);
expect(b.serialize('markdown')).toBe('Hello\n\nSecond paragraph\n\nWritten offline');

// ...edits it, and saves (it already has everything up to here, so no snapshot).
const saveB = autosave(b, (batch) => server.save(batch), { wait: 10 });
b.insert('paragraph', { text: 'Added by b' });
await b.commit();
await settled();
const before = server.chunks.length;
await saveB.flush();
const fromB = server.chunks.slice(before);
expect(fromB.length).toBeGreaterThan(0);

// 5. What b sent reaches a (your socket would deliver it): applied, and not sent back.
for (const bytes of fromB) a.importRemote(bytes);
expect(a.serialize('markdown')).toBe(b.serialize('markdown'));
await settled();
await save.flush();
expect(server.chunks).toHaveLength(before + fromB.length);

save.stop();
saveB.stop();
```

## Using it with the component

`createDocumentEditor` returns the engine synchronously, so there is nothing to await to mount it. Load from your API first (in a SvelteKit `load` function, for instance), then create the editor, start the autosave, and hand the engine to `NabuEditor`:

```svelte
<script>
  import { NabuEditor, createDocumentEditor } from '@aionbuilders/nabu';
  import { autosave } from './autosave.js'; // the function above

  let { chunks } = $props(); // fetched by your load function: Uint8Array[]

  const [snapshot, ...updates] = chunks;
  const engine = createDocumentEditor(snapshot ? { snapshot } : {});
  for (const bytes of updates) engine.importRemote(bytes);

  $effect(() => {
    const save = autosave(engine, (batch) => postToMyApi(batch), { snapshot: !snapshot });
    return save.stop;
  });
</script>

<NabuEditor {engine} />
```

## Notes

- **Order and duplicates are safe.** Loro merges updates in any order and ignores what it already has, so a retry, a duplicate or a reordered message never corrupts the document. Your server can store the chunks as they come, or hold a `LoroDoc` of its own and import each one.
- **Compact the chunks.** Every keystroke is a chunk, so a server that stores them as they come grows with the history. Periodically replace the list by one snapshot: a `LoroDoc` on the server that imported them all can `export({ mode: 'snapshot' })`, or take it from a client with `engine.doc.export({ mode: 'snapshot' })`.
- **Save when the page hides.** A debounce can lose the last seconds if the tab closes. Flush on `visibilitychange` when the page becomes hidden, with a request that survives the page (`fetch` with `keepalive: true`, or `navigator.sendBeacon`). Not covered by the test above.
- **Files.** Images and attachments are not in these bytes; they are stored by the `files` option (`onBeforePersist` uploads them to your server): see [Persistence and sync, Files](../guides/persistence-and-sync.md#files-and-the-asset-store).
- **No IndexedDB means no offline copy.** Nothing is saved until `send` succeeds. If you want a local copy too, combine this with `createPersistedEditor`: the guide shows how the two work together.
