---
title: Your first editor
description: Mount the NabuEditor component, create an editor with a factory, read and write its content, and react to changes.
section: getting-started
order: 2
---

# Your first editor

An editor has two parts:

- the **engine**, a `Nabu` instance that owns the document (a Loro CRDT), the selection, the undo history and the commands. You create it with a factory such as `createDocumentEditor()`;
- the **`NabuEditor` component**, which renders an engine and handles the keyboard, the clipboard and drag and drop.

Install and configure Vite first: see [Installation](./installation.md).

## Mount it

```svelte
<script>
  import { NabuEditor, createDocumentEditor } from '@aionbuilders/nabu';

  const engine = createDocumentEditor();
</script>

<NabuEditor {engine} />
```

That is a complete editor: paragraphs, headings, quotes, code, callouts, rich text marks, markdown shortcuts and paste handling. What exactly you get depends on the preset; see [Presets](./presets.md).

`NabuEditor` is a single `contenteditable` element that fills the width of its parent. Put it in a container that gives it the width, padding and typography you want.

### Add the optional UI

The toolbar, the slash menu and the drag handles live in a separate entry point, and are mounted next to the editor. None of them is required.

```svelte
<script>
  import { NabuEditor, createDocumentEditor } from '@aionbuilders/nabu';
  import { FloatingToolbar, SlashMenu, DragHandle } from '@aionbuilders/nabu/ui';

  const engine = createDocumentEditor();
</script>

<FloatingToolbar {engine} />
<SlashMenu {engine} />
<DragHandle {engine} />
<NabuEditor {engine} />
```

### Focus

`engine.focus()` places the caret and returns a promise that resolves once the selection is set. Call it after the component is mounted:

```svelte
<script>
  import { onMount } from 'svelte';
  import { NabuEditor, createTextEditor } from '@aionbuilders/nabu';

  const engine = createTextEditor();

  onMount(() => {
    engine.focus();
  });
</script>

<NabuEditor {engine} />
```

## Create an editor

Each factory is a ready-made [preset](./presets.md):

| Factory | For |
|---|---|
| `createMinimalEditor()` | A `<textarea>` replacement: paragraphs only |
| `createTextEditor()` | Comment boxes, descriptions: paragraphs and rich text |
| `createDocumentEditor()` | Articles, notes: headings, quotes, code, callouts, toggles, media |
| `createFullEditor()` | Everything built in: also lists, to-dos, dialogue and regions |
| `createEditor({ preset, extensions })` | The generic one: any preset, plus your own extensions |

A factory returns a `Nabu` engine synchronously. It works without a browser, which is what lets the examples on this page run as tests:

```js test
import { createDocumentEditor, Nabu } from '@aionbuilders/nabu';

const engine = createDocumentEditor();
expect(engine).toBeInstanceOf(Nabu);
```

Every factory takes the same options: the `Nabu` options (`NabuInit`: `placeholders`, `spellcheck`, `lang`, `tab`, `keymap`, `files`, `snapshot`…) and extra `extensions`.

```js test
import { createTextEditor } from '@aionbuilders/nabu';

const engine = createTextEditor({
  lang: 'en-GB',
  spellcheck: false,
  placeholders: false
});

expect(engine.lang).toBe('en-GB');
expect(engine.spellcheck).toBe(false);
```

## Read the content

`engine.serialize(format)` returns the document in a given format:

```js test
import { createDocumentEditor } from '@aionbuilders/nabu';

const engine = createDocumentEditor();
await engine.importMarkdown('# Hello\n\nSome **bold** text.');

// Markdown, as a string.
expect(engine.serialize('markdown')).toBe('# Hello\n\nSome **bold** text.');

// JSON: a plain object, safe to JSON.stringify and store.
const json = engine.serialize('json');
expect(json.version).toBe('1');
expect(json.blocks.map((block) => block.type)).toEqual(['heading', 'paragraph']);
expect(json.blocks[0].content).toEqual([{ text: 'Hello' }]);
expect(json.blocks[1].content).toEqual([
  { text: 'Some ' },
  { text: 'bold', bold: true },
  { text: ' text.' }
]);
```

Two formats exist: `'markdown'` and `'json'`. The JSON export is the exact document tree: it round-trips everything, including blocks that markdown cannot express. Markdown is exact for text, lists, toggles, code and the like, but it is a lossy format by nature. Use JSON to store a document, markdown to exchange it.

An unknown format returns `null`.

## Write the content

`importJSON()` and `importMarkdown()` **replace the whole document** and return a promise.

```js test
import { createDocumentEditor } from '@aionbuilders/nabu';

const source = createDocumentEditor();
await source.importMarkdown('## Notes\n\nFirst line.');

// Load a `serialize('json')` export, as an object or as a JSON string.
const target = createDocumentEditor();
await target.importJSON(JSON.stringify(source.serialize('json')));

expect(target.serialize('markdown')).toBe('## Notes\n\nFirst line.');
```

- `importJSON(json)` accepts the object or its string form. An export of a version the editor does not know is refused (the document is left untouched).
- `importMarkdown(markdown)` needs `MarkdownPasteExtension`, which `TextPreset`, `DocumentPreset` and `FullPreset` include. Only the blocks of the editor's preset are produced: with `TextPreset`, a `# heading` stays a paragraph.
- Both degrade a block type the editor does not know to a paragraph; nothing is dropped.

To **append** a block instead of replacing everything, use `insert()`:

```js test
import { createDocumentEditor } from '@aionbuilders/nabu';

const engine = createDocumentEditor();
await engine.importMarkdown('First');

engine.insert('paragraph', { text: 'Second' });
engine.insert('heading', { level: 2, text: 'A title' });
await engine.commit();

expect(engine.serialize('markdown')).toBe('First\n\nSecond\n\n## A title');
```

Everything the user can do from the keyboard is also a command you can run with `engine.exec(topic, data)`: toggle a mark, transform a block, undo. See [Commands and keymap](../guides/commands-and-keymap.md).

## Listen to changes and export updates

The document is a [Loro](https://loro.dev) document, and it is public: `engine.doc` is the `LoroDoc` behind the editor. This is the way to observe changes and to export them (to sync with a server, for instance).

`engine.doc.subscribe(callback)` calls you after every committed change, including each keystroke, and returns an unsubscribe function:

```js test
import { createDocumentEditor } from '@aionbuilders/nabu';

const engine = createDocumentEditor();

const events = [];
const unsubscribe = engine.doc.subscribe((event) => {
  events.push(event.by); // 'local' (the user or your code), 'import' (loaded data) or 'checkout'
});

engine.insert('paragraph', { text: 'Hello' });
await engine.commit();
await new Promise((resolve) => setTimeout(resolve)); // Loro delivers events asynchronously

expect(events).toContain('local');
expect(engine.serialize('markdown')).toBe('Hello');

unsubscribe();
```

Loro also exports the document as binary data: a full snapshot, or only the updates since a version. Send the updates to another editor with `engine.doc.import(bytes)`, or start an editor from a snapshot with the `snapshot` option:

```js test
import { createDocumentEditor } from '@aionbuilders/nabu';

const a = createDocumentEditor();
await a.importMarkdown('Shared text');

// A full snapshot restores an editor...
const snapshot = a.doc.export({ mode: 'snapshot' });
const b = createDocumentEditor({ snapshot });
expect(b.serialize('markdown')).toBe('Shared text');

// ...and updates keep two editors in sync.
const since = b.doc.version();
await b.importMarkdown('Edited by b');
const update = b.doc.export({ mode: 'update', from: since });
a.importRemote(update);
expect(a.serialize('markdown')).toBe('Edited by b');
```

Use `engine.importRemote(bytes)` rather than `engine.doc.import(bytes)` for data that comes from elsewhere while the editor is on screen: it keeps the caret where it was.

Debounce your callback if you save elsewhere. For saving to the browser you do not need any of this: [persistence](#save-it) does it for you.

## Save it

To keep the document across page reloads, create the engine with `createPersistedEditor`. It is asynchronous: it loads the stored document first, then auto-saves every change to IndexedDB.

```js
import { createPersistedEditor } from '@aionbuilders/nabu';

const engine = await createPersistedEditor({ docId: 'my-document' });
```

Options, multi-tab behaviour, history and recovery are covered in [Persistence and sync](../guides/persistence-and-sync.md).

## Next

- [Presets](./presets.md): choose and customise what the editor can do.
- [Guides](../guides/extensions.md): extensions, commands and keymap, persistence and sync, regions.
