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
await engine.importJSON(json); // loads a serialize('json') export

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

When a local file is added without any configuration, its bytes are stored **inside the Loro document** itself (in a separate `assets` map). The block stores a `nabu-asset:<id>` reference internally. This works offline and requires no backend — the document is completely self-contained.

Above a configurable size threshold (~2 MB by default), Nabu emits a warning: the CRDT is not designed to carry large binary assets.

### Production mode (your storage)

To keep binary data out of Loro and host assets on your own infrastructure, pass a `files` config to the `Nabu` constructor:

```js
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor({
  files: {
    // Called when a local file is added. Upload it and return a clean ref.
    // Return nothing to fall back to the default (store bytes in Loro).
    onBeforePersist: async (file, { signal, onProgress }) => {
      const url = await uploadToYourCDN(file, { signal, onProgress });
      return { ref: url };
    },

    // Turn a stored ref into a display URL.
    // Default: identity for https:// URLs, native decoder for nabu-asset: refs.
    // Override for private buckets or signed-URL storage.
    resolve: (ref) => ref,

    // Byte threshold before the default (Loro) mode warns. Default ~2 MB.
    maxInlineSize: 2 * 1024 * 1024,

    // Opt-in (default false): import the images of pasted web pages. See "Pasting images and files" below.
    importRemote: false,
  }
});
```

The `files` option is also accepted by the generic `createEditor({ preset, files })` and the bare `new Nabu({ extensions, files })` constructor.

### Pasting images and files

- **Files on the clipboard** (a screenshot, a file copied from the OS): each one becomes a block at the caret, in order. The image / video / file extensions decide by MIME type (`image/*` → Image, `video/*` → Video, anything else → File). The bytes go through `Files`: stored in the document in the default mode, or sent to your `onBeforePersist` (the block is `pending` with a local preview until you answer). Files win over the text payloads of the same clipboard, except an internal Nabu copy (`application/x-nabu+json`) and a spreadsheet range (an HTML table). One undo step. A pasted block lands at the caret: the text block is split around it.
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
