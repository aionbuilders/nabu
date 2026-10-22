# Nabu — Block Editor Engine

> **Alpha** — API in active development. Breaking changes expected.

Nabu is a modular, local-first block editor engine for **Svelte 5**. It combines the intuitive cross-block selection of document editors (Google Docs, ProseMirror) with the structural flexibility of block editors (Notion), built on a **Single ContentEditable** architecture and a **CRDT core** (Loro).

## Installation

```bash
npm install @aionbuilders/nabu
# or
bun add @aionbuilders/nabu
```

## Required: Vite Setup

Nabu depends on `loro-crdt`, which ships as a WebAssembly module. You must configure your Vite bundler to handle it.

The easiest way is the bundled plugin preset:

```js
// vite.config.js
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite'; // or svelte()
import { nabu } from '@aionbuilders/nabu/vite';

export default defineConfig({
  plugins: [
    sveltekit(),
    nabu() // registers vite-plugin-wasm + vite-plugin-top-level-await
  ]
});
```

<details>
<summary>Manual setup (equivalent)</summary>

**1. Install the required Vite plugins:**

```bash
npm install -D vite-plugin-wasm vite-plugin-top-level-await
```

**2. Add them to your `vite.config.js`:**

```js
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite'; // or svelte()
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [
    sveltekit(),
    wasm(),
    topLevelAwait()
  ]
});
```

</details>

Without this setup, Nabu will fail to load.

## Basic Usage

**With a preset (recommended):**

```svelte
<script>
  import { NabuEditor, createFullEditor } from '@aionbuilders/nabu';

  const engine = createFullEditor();
</script>

<NabuEditor {engine} />
```

**Manual setup:**

```svelte
<script>
  import {
    Nabu,
    NabuEditor,
    ParagraphExtension,
    HeadingExtension,
    ListExtension,
    ListItemExtension,
    DialogueExtension,
    RichTextExtension
  } from '@aionbuilders/nabu';

  const engine = new Nabu({
    extensions: [
      ParagraphExtension,
      HeadingExtension,
      ListExtension,
      ListItemExtension,
      DialogueExtension,
      RichTextExtension
    ]
  });
</script>

<NabuEditor {engine} />
```

## Presets

Nabu ships with ready-to-use presets for common use cases.

### Preset arrays

Composable — spread and extend them with your own extensions:

```js
import { FullPreset, createEditor } from '@aionbuilders/nabu';

const engine = createEditor({
  preset: FullPreset,
  extensions: [MyCustomExtension]
});
```

| Preset | Includes |
|---|---|
| `MinimalPreset` | Paragraph only |
| `TextPreset` | Paragraph + rich text marks |
| `DocumentPreset` | Paragraph + Headings + rich text |
| `FullPreset` | All built-in blocks + rich text (including Dialogue) |

### Factory functions

One-liner shortcuts for the most common cases:

```js
import {
  createMinimalEditor,  // paragraph only — textarea replacement
  createTextEditor,     // paragraph + bold/italic/...
  createDocumentEditor, // paragraph + headings + rich text
  createFullEditor,     // everything
  createEditor          // generic — takes any preset
} from '@aionbuilders/nabu';

const engine = createFullEditor();

// Add custom extensions on top of a preset
const engine = createTextEditor({ extensions: [MyExtension] });
```

### Placeholders

Empty blocks can show a hint ("Start writing...", "Heading 2", ...). Configure it with the `placeholders` option, accepted by `new Nabu()` and every factory:

```js
createFullEditor({ placeholders: false });             // no placeholders at all
createFullEditor({ placeholders: true });              // defaults (same as omitting it)
createFullEditor({
  placeholders: {
    show: 'empty',                                     // 'focus' (default) | 'empty'
    text: {
      paragraph: "Type '/' for commands",              // string
      heading: (block) => `Title (h${block.level})`,   // function of the block
      blockquote: false,                               // disable this block type
    },
  },
});
```

- `show: 'focus'` (default): only the empty block that holds the cursor displays its placeholder. `show: 'empty'`: every empty block does.
- `text`: overrides per block type. A string, `false` (no placeholder for that type) or a function `(block) => string | false`.
- Defaults live on the block classes: a custom block declares `static placeholder = 'My hint'` (string, `false` or `(block) => string | false`). The resolved value is exposed as `block.placeholder` and rendered through `data-placeholder` (custom block components: `data-placeholder={block.placeholder}`).
- Style: it is drawn with a `::after` pseudo-element (never selectable, never affects the caret or the text). Set the color with the `--nb-text-placeholder` CSS variable (default: the text color at 35% opacity, so it works on light and dark backgrounds).

### Spellcheck & language

```js
createFullEditor({ spellcheck: false });   // browser spellcheck off (default: true)
createFullEditor({ lang: 'fr' });          // BCP 47 tag; default: inherit the page language

nabu.spellcheck = false;                   // both are reactive at runtime
nabu.lang = 'en-GB';
```

- `spellcheck` drives the `spellcheck` attribute of the editor root. Code blocks are never spellchecked. When it is `false`, the root also gets `data-gramm="false"`, `data-gramm_editor="false"` and `data-enable-grammarly="false"`, the opt-out hints honored by the Grammarly extension.
- `lang` sets `lang` on the root, so the browser's spellchecker, hyphenation and screen readers use that language. An invalid tag is ignored (with `nabu.warn`); unset means no attribute.
- Privacy: Chrome's enhanced spell check may send the text you type to Google. If your integrators handle sensitive documents, set `spellcheck: false`.
- Browser extensions such as Grammarly inject their own DOM into editable areas. This is not supported; the opt-out attributes above are only a hint, set when spellcheck is off.

## Extensions

All block types and behaviors are provided as extensions. Pass them to the `Nabu` constructor:

| Extension | Provides | Keyboard shortcuts |
|---|---|---|
| `ParagraphExtension` | `paragraph` block | — |
| `HeadingExtension` | `heading` block (h1–h6) | `# ` → h1, `## ` → h2, ... |
| `ListExtension` | `list` container (bullet/ordered/todo) | — |
| `ListItemExtension` | `list-item` block | `Tab` indent, `Shift+Tab` unindent; `[] ` or `[x] ` → to-do list |
| `DialogueExtension` | `dialogue` block | `-- ` → dialogue, `Enter` → new dialogue line (on an empty one → paragraph), `Backspace` at start → paragraph |
| `BlockquoteExtension` | `blockquote` block | `> ` → blockquote; `Backspace` at start (empty) → paragraph |
| `DividerExtension` | `divider` block (`<hr>`) | `--- ` → divider |
| `CodeExtension` | `code` block (monospace, multi-line) | ` ``` ` + Enter → code block; `Tab` inserts 2 spaces |
| `CalloutExtension` | `callout` block (note/tip/important/warning/caution) | `! ` → callout; click the icon to cycle variant |
| `ToggleExtension` | `toggle` block (collapsible) | created via slash menu |
| `ImageExtension` | `image` void media block | created via slash menu or `image:insert` / `image:pick` |
| `VideoExtension` | `video` void media block | created via slash menu or `video:insert` / `video:pick` |
| `FileExtension` | `file` void media block | created via slash menu or `file:insert` / `file:pick` |
| `RichTextExtension` | Inline marks (bold, italic...) | `Ctrl+B/I/U/E`, `Ctrl+Shift+X` |
| `TypographyExtension` | Smart typography substitutions | `--` + space → `—` |
| `MarkdownShortcutsExtension` | Inline markdown formatting while typing | see below |

### Typographic substitutions

Provided by `TypographyExtension` (included in TextPreset, DocumentPreset, and FullPreset). Nabu automatically applies substitutions as you type:

| Input | Output | Description |
|---|---|---|
| `--` + space | `— ` | Em-dash (French dialogue convention) |

### Dialogue marker

A dialogue line is **displayed** with a dash, an EN dash `–` by default. `DialogueExtension` is the default instance; use the factory to pick another one:

```js
import { createDialogueExtension } from '@aionbuilders/nabu';

new Nabu({ extensions: [/* … */, createDialogueExtension({ dash: '—' })] });
```

The dash is shown through the CSS custom property `--nb-dialogue-dash` (set it on any ancestor or rule to override the configured dash, e.g. `--nb-dialogue-dash: "—"`). It is purely visual: the **markdown syntax** of a dialogue line is always `-- ` (two hyphens + space, e.g. `-- Tu viens ?`), for export, import and paste, whatever the display dash. Lines starting with `–` or `—` are plain text, not dialogue (they are common list bullets in some languages).

### Inline markdown shortcuts

Provided by `MarkdownShortcutsExtension` (included in TextPreset, DocumentPreset, and FullPreset). Typing the closing delimiter applies the mark and strips the syntax characters:

| Type | Result |
|---|---|
| `**bold**` or `__bold__` | bold |
| `*italic*` or `_italic_` | italic |
| `` `code` `` | inline code |
| `~~strike~~` | strikethrough |
| `***bolditalic***` | bold + italic |

### Active formatting (stored marks)

Marks in Nabu are exact ranges — they never bleed into adjacent text. Pressing a mark shortcut (`Ctrl+B` / `Ctrl+I` / `Ctrl+U` / `Ctrl+E` / `Ctrl+Shift+X`) with a **collapsed cursor** starts that formatting for the next typed text. The mark persists as you type and clears automatically when you navigate away (arrow keys or click). With a **text selection**, the shortcut toggles the mark on the selection as usual.

## Programmatic API

```js
// Insert blocks
engine.insert('paragraph', { text: 'Hello' });
engine.insert('heading', { level: 1, text: 'Title' });
engine.insert('list', { listType: 'bullet' });
engine.insert('dialogue', { text: 'Tu viens ce soir ?' });

// Undo / Redo
engine.undo();
engine.redo();

// Serialize
const markdown = engine.serialize('markdown');
// dialogue blocks serialize as: -- Tu viens ce soir ?

const json = engine.serialize('json');

// Import — replaces the entire document
await engine.importMarkdown('# Title\n\nSome **bold** text.'); // requires MarkdownPasteExtension
await engine.importJSON(json); // loads a serialize('json') export (exact tree; markdown is exact for text, lists, toggles, code… — see docs/design/import-export.md)

// Links
engine.exec('link:set', { href: 'https://example.com' }); // on the current selection
engine.exec('link:remove');
engine.exec('link:toggle', { href: 'https://example.com' });

// Other block actions
engine.exec('blockquote');
engine.exec('code');
engine.exec('callout');
engine.exec('toggle');
engine.exec('image:insert', { ref: 'https://example.com/image.jpg', alt: 'Description' });
engine.exec('image:pick'); // opens a file picker
```

### Usage with FloatingToolbar

A ready-made formatting toolbar that floats above the current selection:

```svelte
<script>
  import { NabuEditor, FloatingToolbar, createDocumentEditor } from '@aionbuilders/nabu';
  const engine = createDocumentEditor();
</script>

<FloatingToolbar {engine} />
<NabuEditor {engine} />
```

The toolbar is `position: fixed` and tracks the selection in viewport coordinates, so it can be dropped anywhere — no positioning wrapper needed. It toggles bold/italic/underline/code/strikethrough/link marks.

## Slash menu

An opt-in command palette, similar to `FloatingToolbar`. Type `/` in any block to open it, filter by typing, use `↑`/`↓` + `Enter` to select a command, and `Esc` to close.

```svelte
<script>
  import { NabuEditor, SlashMenu, createFullEditor } from '@aionbuilders/nabu';
  const engine = createFullEditor();
</script>

<SlashMenu {engine} />
<NabuEditor {engine} />
```

Built-in commands cover: Text (paragraph), Headings 1–3, bulleted / numbered / to-do lists, Code, Callout, Quote, Toggle, Divider, Image, Video, and File.

Pass a `commands` prop to add or override entries:

```svelte
<SlashMenu {engine} commands={[...myCommands]} />
```

Each command object has the shape `{ title, subtitle?, icon?, aliases?, run(engine) }`.

## Drag handles

An opt-in overlay for reordering blocks by dragging. On hover, a `⠿` grip appears to the left of the block under the pointer; drag it to move the block before or after any other block. Like `FloatingToolbar` / `SlashMenu`, it's a `position: fixed` island outside the editable area — drop it anywhere, no positioning wrapper needed.

```svelte
<script>
  import { NabuEditor, DragHandle, createFullEditor } from '@aionbuilders/nabu';
  const engine = createFullEditor();
</script>

<DragHandle {engine} />
<NabuEditor {engine} />
```

Reordering goes through the Loro tree (`moveBefore` / `moveAfter`) and commits as a single transaction, so it's collaborative and undo-safe. Structural integrity is preserved automatically — e.g. dragging a list item out to the document root re-wraps it in its own list. A block can never be dropped into its own subtree.

## Files, images & media

Image, Video, and File are void (non-editable) media blocks. Insert them via the slash menu (`/image`, `/video`, `/file` — triggers a file picker) or programmatically:

```js
engine.exec('image:insert', { ref: 'https://cdn.example.com/photo.jpg', alt: 'Alt text' });
engine.exec('image:pick');  // opens a file picker
engine.exec('video:insert', { ref: 'https://cdn.example.com/clip.mp4' });
engine.exec('video:pick');
engine.exec('file:insert',  { ref: 'https://cdn.example.com/doc.pdf' });
engine.exec('file:pick');
```

### Default (zero-config) mode

When a local file is added without any configuration, its bytes go to a **separate file store**, never into the Loro document ([ADR 014](docs/adr/014-asset-storage.md)): an in-memory store for `createEditor()` / `new Nabu()` (lost with the page, like the document), an **IndexedDB** store for `createPersistedEditor()` (database `nabu`, shared by all the documents of the origin). The document only holds a content-hash reference (`nabu-asset:sha256-<hex>`, so the same image added twice is stored once) and a small metadata index (`assetIndex`: mime, name, size). This works offline and requires no backend, and the document history stays light.

A document alone is therefore no longer self-contained: its **export** (`serialize('json')`) and the **clipboard** still carry the bytes (keyed by hash, verified on import), so a copy / export is. Documents saved by the beta (bytes inside the document) are migrated automatically when opened. Pass `files: { store }` to plug your own store (`has`, `get`, `put`, `delete`, `keys`).

### History modes and cleanup of files

`createPersistedEditor` keeps the **complete history by default** (`history: 'full'`): nothing is ever compacted, trimmed or deleted, however many times the document is opened (think of a novelist following the evolution of a whole book). Compaction is an explicit opt-in:

```js
await createPersistedEditor({
  docId: 'notes',
  history: {
    mode: 'compact',            // compacts when the document is OPENED, never mid-session
    retain: '30d',              // ms, '12h', '30d'... or 0 = keep no past history
    onBeforeCompact: async (fullSnapshot) => archive(fullSnapshot), // awaited BEFORE anything is dropped; a throw aborts
  },
});
const result = await engine.compact({ retain: 0 }); // explicit, e.g. for integrators that sync: { compacted, reason?, bytesBefore, bytesAfter, released }
```

A compaction (Loro shallow snapshot at the retention point) **refuses** (no exception, nothing dropped) while an upload is pending or changes are unsaved, clears the undo stack, and afterwards releases the files no kept version references: they leave the shared IndexedDB store only when no other document uses them; with a host, `files.onAssetReleased(url)` tells you which hosted files to delete (Nabu never deletes at the host). `clearPersistence()` releases a deleted document's files the same way. See the [persistence guide](docs/guides/persistence.md) and [ADR 014](docs/adr/014-asset-storage.md) §3.6 / §7.

### Production mode (your storage)

To also keep the files on your own infrastructure, pass a `files` config to the `Nabu` constructor:

```js
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor({
  files: {
    // The file is ALREADY in the local store when this is called, and its block shows it at once (status `pending`).
    // Upload it in the background and return where you keep it. The block keeps its `nabu-asset:sha256-…` ref forever;
    // your ref is recorded as `assetIndex[hash].url` (used to display the file where the local copy is not available).
    // Honour `signal` (cancel, last block deleted) and report `onProgress(0..1)`. Throw to fail (status `error`).
    // The upload is re-run from the local copy after a reload, so make it idempotent.
    onBeforePersist: async (file, { signal, onProgress }) => {
      const url = await uploadToYourCDN(file, { signal, onProgress });
      return { ref: url };
    },

    // Turn a stored ref (the host url of the index) into a display URL. Override for private buckets or signed URLs.
    resolve: (ref) => ref,

    // Largest file (and total) embedded in a copy / export. Default ~2 MB.
    maxInlineSize: 2 * 1024 * 1024,

    // Largest file accepted (bytes). Default: none. A bigger file gives a block with status `rejected` and a readable reason.
    maxFileSize: 25 * 1024 * 1024,

    // Opt-in (default false): import the images of pasted web pages. See "Pasting images and files" below.
    importRemote: false,
  }
});
```

The `files` option is also accepted by the generic `createEditor({ preset, files })` and the bare `new Nabu({ extensions, files })` constructor. Documents whose blocks already hold plain host URLs (`https://…`) keep working unchanged.

**Lifecycle of a file with a host** ([ADR 014](docs/adr/014-asset-storage.md) §3.4): the bytes are hashed and written to the local store first, the block (`pending`) appears with its final `nabu-asset:sha256-…` ref, the upload runs in the background, and on success the block becomes `ready` in a silent commit (not an undo step). On failure it becomes `error` and the local copy is kept. Deleting the last block that shows a file aborts its upload (`signal`); an undo that brings the block back restarts it. The list of uploads still to do (the **outbox**) is kept next to the local store, never in the document: with `createPersistedEditor` it lives in IndexedDB, so an upload interrupted by a closed tab **resumes when the document is opened again**. A document opened on another device before the upload ended (no local bytes, no host url) shows the block as `missing` with the reason `interrupted`.

**State of a media block** (no built-in UI for these yet — they are the API an interface builds on):

```js
block.status      // stored: 'ready' | 'pending' | 'error' | 'missing' | 'rejected'
block.displayStatus // shown: 'missing' when the file cannot be displayed (incl. an interrupted upload)
block.reason      // { code, message } for error / rejected / missing, else null.
                  // codes: too-large, upload-failed, cancelled, interrupted, unavailable, not-embedded, corrupt
block.progress    // 0..1 while uploading (reactive), null otherwise
block.retry()     // run a failed / cancelled upload again from the local copy -> Promise<boolean>
block.cancel()    // abort the running upload (status 'error', reason 'cancelled') -> boolean
```

A copy or `serialize('json')` never ships a file silently without its bytes: the preload at open reads the files up to `maxInlineSize`, and when bytes are still missing the entry is marked `omitted` (with a `nabu.warn`), so the receiving document shows the block as `missing` with the reason `not-embedded`. Declared for the cleanup of the next lot: `files.onAssetReleased(ref)` (not called yet).

### Pasting images and files

- **Files on the clipboard** (a screenshot, a file copied from the OS): each one becomes a block at the caret, in order. The image / video / file extensions decide by MIME type (`image/*` → Image, `video/*` → Video, anything else → File). The bytes go through `Files`: stored in the local asset store in the default mode, or sent to your `onBeforePersist` (the block is `pending` with a local preview until you answer). Files win over the text payloads of the same clipboard, except an internal Nabu copy (`application/x-nabu+json`) and a spreadsheet range (an HTML table). One undo step. A pasted block lands at the caret: the text block is split around it.
- **Images of a pasted web page** (`<img src>` in the `text/html` of the clipboard) become image blocks that reference the **original URL** (hot-linked, nothing is downloaded); an `<img>` inside a paragraph splits it, and unsafe or missing sources are dropped. Set `files.importRemote: true` to **import** them instead: each remote `http(s)` image is fetched and stored through the same path as a local file (so `onBeforePersist` receives the downloaded `File`); the block shows the original URL while it is fetched, and **keeps the original URL if the fetch fails** (network error, CORS, HTTP error, not a media type). The swap to the stored ref is not an undo step. Remote servers must allow cross-origin reads (CORS) for the import to succeed; credentials are never sent.

An extension can make a block of a pasted file with `pasteFileHandlers` (the engine names no block type):

```js
extension('audio', {
  block: AudioBlock,
  pasteFileHandlers: [{
    accepts: (file) => file.type.startsWith('audio/'),
    // The engine stores the bytes and sets `props.ref`; return the type and the other props.
    block: (file) => ({ type: 'audio', partial: false, props: { name: file.name } }),
  }],
});
```

### Dropping files, text and content

Dropping on the editor works like pasting, at the place under the pointer (a text position, or before / after an image or a divider):

- **Files from the OS** become media blocks, in order (same rules as pasted files: `pasteFileHandlers`, the local asset store or your `onBeforePersist`, `files.maxFileSize`).
- **Text, HTML, markdown or a Nabu fragment** dragged from another page or application is interpreted by the same paste engine (bold kept, no Google Docs junk); into a code block it is inserted as plain text.
- **The editor's own selection**, dragged, is **moved** (one undo step; dropping it on itself does nothing). Hold **Ctrl** (Windows / Linux) or **Alt / Option** (macOS) to **copy** instead.
- One undo step each. The browser never inserts anything itself, so the document and the DOM cannot drift apart.

`engine.dropTarget` is reactive state for your own drop indicator (Nabu draws nothing): `{ block, offset, side, kind } | null` while something droppable is over the editor, with `side` `'inside'` (a caret position `offset` in the text of `block`) or `'before'` / `'after'` (beside a block without text) and `kind` `'files'`, `'content'` or `'move'`; `null` when it leaves, is dropped or is cancelled.

```svelte
{#if engine.dropTarget}
  <MyDropIndicator block={engine.dropTarget.block} side={engine.dropTarget.side} />
{/if}
```

`engine.dropAt(dataTransfer, position)` runs the same pipeline programmatically. The block drag handle above is separate (pointer events, not browser drag and drop).

## Task tracking (Todos)

To-do list blocks (`listType: 'todo'`) feed a reactive document-level registry. Use `Todos` to read and control them from outside the editor:

```js
import { Todos } from '@aionbuilders/nabu';

const todos = Todos.get(engine);

todos.count;        // total number of to-do items
todos.doneCount;    // number checked
todos.remaining;    // number unchecked
todos.progress;     // completion ratio, 0–1
todos.all;          // all to-do items in document order

todos.checkAll();
todos.uncheckAll();
todos.goTo(item);   // move the editor cursor to a specific to-do
```

## Commands & shortcuts

Keyboard shortcuts are **commands** that extensions declare (design: `docs/adr/017-commands-keymap-confirmations.md`). The engine resolves the keys, so conflicts are reported, shortcuts can be rebound, and a help sheet can list them.

```js
import { extension } from '@aionbuilders/nabu';

const MyExtension = extension('my-ext', {
  commands: {
    'note:stamp': {
      label: 'Stamp the paragraph',                  // or (ctx) => string
      keys: ['Mod-Shift-k'],                         // Mod = Cmd on macOS, Ctrl elsewhere
      scope: 'paragraph',                            // optional: wins over generic commands when the caret is in such a block
      when: (ctx) => ctx.isCollapsed,                // where it applies; REQUIRED for a key without modifier (Backspace, Enter, a letter…)
      run: (nabu, ctx, data) => { /* … */ },         // returning false = "not handled": the key falls through
    },
  },
  // Optional facts added to `ctx` for every command: { nabu, event, block, selection, isCollapsed, ancestors, inRoot, ...yours }
  commandContext: (nabu, ctx) => ({ atEnd: /* … */ false }),
});
```

- A command is also an action: `nabu.exec('note:stamp', data)` works without any key (palette, menu, API).
- Chords are `[Mod|Ctrl|Alt|Shift|Meta-]*Key` (`Mod-Enter`, `Ctrl-Alt-ArrowUp`, `Mod-k`). Chords the browser keeps for itself (`Mod-w`, `Mod-t`, `Mod-n`, `Mod-q`, reload…) and a modifier-less key without `when` are refused with a warning (`nabu.debugging = true` to see warnings).
- Rebind or disable shortcuts when creating the editor: `createEditor({ keymap: { 'mark:bold': ['Mod-Alt-b'], 'mark:italic': [] } })` (`[]` disables the keys; the command still runs through `exec`).
- `nabu.commands.list()` returns `[{ id, label, keys, display, scope, extension, available, confirm }]`, `display` being formatted for the platform (`['⌘B']` or `['Ctrl+B']`); `nabu.commands.run(id, data)` runs one. It is a plain snapshot, the set of commands is fixed once the editor is built.
- Built-in commands: `undo`, `redo`, `mark:bold|italic|underline|code|strikethrough`, `todo:toggle`. The `onKeyDown` hooks keep working for everything else.

### Confirmations: hold, invite, choose

A command that is risky to run from a single key press declares how it asks for confirmation. `nabu.exec(id)` / `nabu.commands.run(id)` always run it directly (menus, palettes, the accessible path); only the KEY goes through the confirmation. What is waiting is exposed as the reactive `nabu.pendingCommand` (`{ id, strategy, label, display, message, target?, progress, options?, selectedIndex }` or `null`); `nabu.cancelPendingCommand()` cancels it, nothing runs and no undo step exists.

```js
'region:merge-previous': {                    // the real one lives in the Regions extension, see "Regions" below
  label: (ctx) => `Merge with "${ctx.previousRegion.title}"`,
  keys: ['Backspace'],
  when: (ctx) => ctx.isCollapsed && ctx.atStartOfRegion,
  confirm: { strategy: 'hold', holdMs: 700, target: (ctx) => ctx.block },   // or 'invite' / 'choose'
  run: (nabu, ctx) => { /* … */ },
},
```

- **`hold`**: hold the key for `holdMs` (default 700; globally `new Nabu({ commandConfirm: { holdMs } })`). `progress` goes 0 → 1 (animation frames) and the command runs once at the end, even if the key is still down. Releasing the key (or a modifier of the chord) first cancels; any other key cancels AND does its normal action; losing focus or moving the selection cancels. Only a FRESH press (`event.repeat === false`) starts it: the repeats of a key that was held before entering the context are swallowed there, so someone erasing text with Backspace held stops at the boundary and has to release and press again. The `target` (`confirm.target(ctx)`, usually a block) draws the progress: the editor sets `data-command-target="hold"` and `--nb-command-progress` on its element (neutral default style with `--nb-command-accent` / `--nb-command-fill`), or a block reads `nabu.pendingCommandOn(block)?.progress` and draws its own. Without a mountable target, `<CommandInvite {engine} />` shows a small hint with a progress bar.
- **`invite`**: the first press shows a hint at the caret (`<CommandInvite {engine} />`); the same chord pressed again runs it. Escape, any other key (which acts normally), a click or 5 s (`inviteMs`, per command or globally) cancel. Repeats never start nor confirm it.
- **`choose`**: used automatically when several commands tie on a key (neither `scope`d to the caret's block), or explicitly with `confirm: { strategy: 'choose', options: (ctx) => [{ id, label, display? }] }` (`run(nabu, ctx, option)` gets the chosen option). `<CommandChooser {engine} />` lists the options at the caret: Arrow keys + Enter, a digit 1-9, a click; Escape or any other key (which acts normally) cancels. Choosing counts as the confirmation of the chosen command. It is a safety net, not a mode: design default keys that do not collide.
- **Accessibility**: `NabuEditor` renders one polite `aria-live` region (`[data-nabu-live]`) announcing prompts and outcomes (`Hold Ctrl+Backspace to confirm: Merge with "The bank"`, `… : done`, `Cancelled`, `2 of 3: Beta`). The texts are English; override them for every command with `commandConfirm: { messages: { hold, invite, choose, option, done, cancelled } }` (each a string or a function of `{ keys, label, options, option, index, count }`), or per command with `confirm.messages`.
- **Components** (mount them next to the editor, like `SlashMenu`): `CommandInvite` (props `engine`, `hold: 'auto' | true | false`) and `CommandChooser` (props `engine`, `label`). Neutral defaults styled with `--nb-command-bg`, `-text`, `-border`, `-radius`, `-shadow`, `-accent`, `-active`, `-muted`, `-font-size`, `-z` (falling back on the `--nb-*` theme tokens); design your own from `nabu.pendingCommand`.

## Regions

Regions divide one continuous text into parts, chapters, scenes… with **markers** (design: `docs/adr/016-regions.md`). The document stays flat; a `region` marker is a void block (the caret steps over it, like a divider) and a region runs from its marker to the next marker of the same or a higher level. Nabu stores and exposes the structure; what a division *means* (synopsis, status, views) is up to your app. The default rendering is a discreet seam (label + hairline, announced to screen readers as a heading of the region's level, themable with `--nb-region-*` CSS variables); there is no editing UI. A marker exports as markdown in two lines, a data comment plus a readable heading (`<!-- region:chapter {"title":"The ferryman"} -->` then `## Chapter 1 - The ferryman`), which Nabu reads back exactly (see "Regions in markdown, HTML and the clipboard" below).

```js
import { RegionsExtension, insertRegion } from '@aionbuilders/nabu';

const engine = createEditor({
  extensions: [RegionsExtension({
    types: {
      part:    { level: 1, label: 'Part {index}' },
      chapter: { level: 2, label: 'Chapter {index}', numbering: 'document' },
      scene:   { level: 3, fields: { pov: 'text', mood: { type: 'enum', values: ['calm', 'tense'] } } },
    },
  })],
});
// `FullPreset` already includes `RegionsExtension()`: without options, a generic section division over
// three levels, the types `section-1`, `section-2`, `section-3` (labels "1.", "1.1", "1.1.1").

await insertRegion(engine, { type: 'chapter', at: 'end', title: 'The ferryman' });

engine.regions.list;            // every region, in document order (also: Regions.get(engine))
engine.regions.tree;            // top-level regions, each with `children`
engine.regions.preamble;        // the blocks before the first marker (outside any region)
engine.regions.at(block);       // the deepest region containing a block (no argument: the selection)
engine.regions.of(marker);      // the region a marker opens; also next(r), prev(r), parentOf(r)

const r = engine.regions.list[0];
r.type; r.level; r.index; r.path;   // path: [2, 1], r.pathString: "2.1"
r.label;                            // "Chapter 2": the template applied
r.fields;                           // { title, ...your fields }, reactive
r.setField('pov', 'Anna');          // validated against the declared type, own undo step
r.blocks; r.first; r.last;          // the range (sub-regions included), marker .. last block
r.wordCount;                        // words of the range, no rendering needed
```

### Region commands and keys

The extension declares commands (ADR 016 §3.4, ADR 017), all runnable through `nabu.exec(id, data)`. Only three have default keys, the arrow-key chords being mostly taken by the OS and the browser; bind the others with the `keymap` option. `exec` runs a command directly; the confirmation (the hold) is a keyboard concern. Every structural command is ONE undo step and Ctrl+Z gives the selection back. `data.region` (a `Region`, its marker block or its marker id) makes a command act on that region instead of the one holding the caret.

| Command | Default key | Data | What it does |
|---|---|---|---|
| `region:split` | `Mod-Enter` | - | Cut here: the block is split at the caret (head stays, tail starts the new region), a marker of the SAME type as the current region goes between (the default top-level type in the preamble); the caret goes to the start of the tail. At the start of a block nothing is cut, the marker goes before it. Not in a list item, a toggle or a code block (their `Mod-Enter` stays theirs). |
| `region:merge-previous` | `Backspace`, `Shift-Backspace` held | `{ region? }` | At the start of a region: **hold** to remove its marker; its content joins the previous region (or the preamble). |
| `region:merge-next` | `Delete` held | `{ region? }` | At the end of a region: **hold** to remove the NEXT region's marker. |
| `region:insert` | - | `{ type?, at?: 'after' \| 'before', title?, fields? }` | A marker after the region's whole range (default) or before its marker; the caret stays. |
| `region:move` | - | `{ direction: 'up' \| 'down' }` | Moves the region WITH its sub-regions before / after its neighbouring sibling of the same level. No-op at the edges. |
| `region:move-up` / `region:move-down` | - | `{ region? }` | The same with the direction built in: what a `keymap` binds (a key cannot carry `data`). |
| `region:promote` / `region:demote` | - | - | Changes the type to the declared type of the level above / below (the first declared one if several). No-op when there is none. |
| `region:next` / `region:prev` / `region:parent` | - | - | Caret to the first text position of that region, scrolled into view. |

```js
const engine = createEditor({ keymap: {
  'region:move-up': ['Mod-Alt-ArrowUp'],       // bind what you need (these chords are free in most browsers, not in every OS)
  'region:move-down': ['Mod-Alt-ArrowDown'],
  'region:next': ['Mod-Alt-j'],
  'region:split': ['Mod-Shift-Enter'],         // or move the default
} });
engine.exec('region:move', { direction: 'down' });
```

**Backspace and Delete protect the structure.** A caret at the very start of the first text block of a region (a plain paragraph) never merges text through the marker: a quick Backspace does nothing; **holding** it for 700 ms (the `hold` confirmation) removes the marker. The seam shows the prompt above its label, left-aligned, without any bubble, in a warning tint (`--nb-region-warning`, amber by default), and its hairline drains with the progress; releasing early restores everything. Delete at the end of the last text block before a marker is symmetric (the NEXT marker is the one that disappears). Repeats of a key held before the boundary are swallowed there, so erasing a word with Backspace held stops at the seam. A heading, quote, dialogue or code block at the start of a region first converts to a paragraph with Backspace, as anywhere; then the next Backspace is protected. A region at the very start of the document has nothing to merge into: Backspace does nothing. Any other silent path is closed too (a key not bound to a command, a virtual keyboard): the engine's text merge is vetoed through the extension's `onBeforeMerge` hook. A selection that SPANS a marker is explicit: it deletes the selected text and the marker inside it, as one undo step.

Texts are overridable (English by default): `RegionsExtension({ types, messages: { split: 'Couper ici', mergePreamble: '…', mergePrevious: ({ title }) => `Fusionner avec « ${title} »`, hold: ({ keys, label }) => `Maintenez ${keys} : ${label}` } })`. The command facts available in `ctx` for your own commands: `region`, `previousRegion`, `nextRegion`, `atStartOfRegion`, `atEndOfRegion`, `inRootTextBlock`.

Field kinds: `text`, `richtext` (a LoroText, `marker.richtext(name)`), `number`, `boolean`, `enum`, `date` (ISO 8601). An invalid value for a declared field is refused; fields a type does not declare are kept as they are. Markers only live at the root: one that ends up inside a container (a list, a toggle…) is moved out, right after it, in the same undo step.

### Regions in markdown, HTML and the clipboard

A marker is exported as **two markdown lines**: a data comment (the source of truth: type and fields as minimal JSON, keys sorted) and a readable heading (level = the region's level, text = its computed label):

```md
<!-- region:chapter {"status":"draft","synopsis":"A *short* summary","title":"La forêt"} -->
## Chapitre 2 — La forêt
```

`nabu.serialize('markdown')`, the `text/plain` of a copy spanning several blocks, `importMarkdown()` and a markdown paste all use it, and `serialize -> importMarkdown -> serialize` is a fixed point. On the way in, **only this exact construct** makes a marker (a narrow exception, like the `<details>` toggle): the heading line right after the comment is consumed as its echo and its text is ignored (edit the title in the comment, not in the heading); a heading without the comment stays a heading, any other HTML comment (or one with invalid JSON) stays text, and an unknown region type falls back to your top-level type with the fields kept. Richtext fields are inline-markdown strings inside the JSON. The `text/html` of a copy writes `<h2 data-nabu-region="chapter" data-nabu-fields='…'>label</h2>`, and only an element with `data-nabu-region` is read back as a marker (a plain `<h2>` from the web is a heading). The internal clipboard fragment and `serialize('json')` carry markers exactly (richtext as Loro deltas). A marker pasted inside a list, toggle or callout is moved to the root, right after that container.

## Architecture

### Single ContentEditable
The entire editor lives in a single `contenteditable` root. This enables seamless cross-block selection, native copy-paste, and consistent browser performance.

### CRDT Core (Loro)
All state is stored in a [Loro](https://loro.dev) document — a WASM-based CRDT. This provides:
- **Local-first**: offline editing out of the box
- **Collaboration-ready**: conflict-free concurrent edits
- **Rich text**: native delta/mark support via `LoroText`

### Extension System
Every block type is an extension. You can build custom block types by extending the `Block` or `MegaBlock` base classes and registering them via the `extension()` helper.

### Svelte 5 Runes
Nabu uses `$state` and `$derived` throughout for fine-grained reactivity — only modified blocks re-render.

---

## Status

This is a **beta release**. The core editing experience is functional, documented, and shipped:

- [x] Single ContentEditable architecture with Loro-CRDT
- [x] Structural editing (Enter/Backspace, split/merge, undo/redo)
- [x] Rich text marks (bold, italic, underline, code, strikethrough, link)
- [x] Active formatting — stored marks at a collapsed cursor
- [x] Inline markdown shortcuts (`**bold**`, `_italic_`, `` `code` ``, `~~strike~~`)
- [x] Persistence (IndexedDB auto-save via `createPersistedEditor`)
- [x] Floating toolbar UI (`FloatingToolbar` component)
- [x] Link support (`link:set` / `link:remove` / `link:toggle`)
- [x] Blockquote and Divider blocks
- [x] Code block (multi-line, monospace)
- [x] Callout block (note / tip / important / warning / caution variants)
- [x] Toggle block (collapsible)
- [x] To-do lists (`listType: 'todo'`) + `Todos` reactive registry
- [x] Image, Video, and File blocks with configurable upload system
- [x] Slash command menu (`SlashMenu` component)
- [x] Document import (`importMarkdown` / `importJSON`)
- [x] Placeholders and typography input rules
- [x] Drag-to-reorder handles (`DragHandle` component)

Post-beta roadmap:

- [ ] Embed blocks
- [ ] Block-selection primitive (click a drag handle to select the block as an object — insert-after / delete)

Contributions and feedback welcome.
