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

## Extensions

All block types and behaviors are provided as extensions. Pass them to the `Nabu` constructor:

| Extension | Provides | Keyboard shortcuts |
|---|---|---|
| `ParagraphExtension` | `paragraph` block | — |
| `HeadingExtension` | `heading` block (h1–h6) | `# ` → h1, `## ` → h2, ... |
| `ListExtension` | `list` container (bullet/ordered) | — |
| `ListItemExtension` | `list-item` block | `Tab` indent, `Shift+Tab` unindent |
| `DialogueExtension` | `dialogue` block | `-- ` → dialogue, `Backspace` at start → paragraph |
| `RichTextExtension` | Inline marks (bold, italic...) | `Ctrl+B/I/U/E`, `Ctrl+Shift+X` |

### Typographic substitutions

When `RichTextExtension` or any text-bearing block is active, Nabu automatically applies typographic substitutions as you type:

| Input | Output | Description |
|---|---|---|
| `--` + space | `— ` | Em-dash (French dialogue convention) |

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
// dialogue blocks serialize as: — Tu viens ce soir ?

const json = engine.serialize('json');
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

This is an **alpha release**. The core editing experience is functional, but some features are still in development:

- [ ] Persistence (IndexedDB)
- [ ] Floating toolbar UI
- [ ] Slash command menu
- [ ] Link support

Contributions and feedback welcome.
