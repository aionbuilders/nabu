# Nabu

Nabu is a modular, local-first block editor for **Svelte 5**. It combines the cross-block selection of document editors (Google Docs, ProseMirror) with the structural flexibility of block editors (Notion), on a single `contenteditable` and a CRDT core ([Loro](https://loro.dev)). You pick the blocks and behaviors you need from a list of extensions, from a `<textarea>` replacement to a full document editor, and save to the browser with one call.

> **Status: beta** (`0.1.0-beta.0`). The editing core is complete and tested, but the API may still change before 1.0. Breaking changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Install

```bash
npm install @aionbuilders/nabu
# or
bun add @aionbuilders/nabu
```

### Requirements

- **Svelte 5.20 or newer**.
- A Vite setup (SvelteKit, or Svelte + Vite) that can load WebAssembly. Loro ships as a WebAssembly module loaded with top-level `await`, so the build needs `vite-plugin-wasm` and `build.target: 'esnext'`. The bundled helper does both:

```js
// vite.config.js
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite'; // or svelte()
import { nabu } from '@aionbuilders/nabu/vite';

export default defineConfig({
  plugins: [sveltekit(), nabu()]
});
```

Without this setup, Nabu fails to load. Why `esnext`, the manual equivalent and common errors: [Installation](docs/getting-started/installation.md).

## Minimal example

```svelte
<script>
  import { NabuEditor, createDocumentEditor } from '@aionbuilders/nabu';

  const engine = createDocumentEditor();
</script>

<NabuEditor {engine} />
```

Then read and write the content from the engine:

```js test
import { createDocumentEditor } from '@aionbuilders/nabu';

const engine = createDocumentEditor();
await engine.importMarkdown('# Hello\n\nSome **bold** text.');

expect(engine.serialize('markdown')).toBe('# Hello\n\nSome **bold** text.');
expect(engine.serialize('json').blocks).toHaveLength(2);
```

## Entry points

The public API is these entry points; everything else is internal and may change without notice.

| Import | What it is for |
|---|---|
| `@aionbuilders/nabu` | Using the editor: `NabuEditor`, the factories and presets, the built-in extensions, `createPersistedEditor`, `Files`, `Regions`, `Todos`, `deltaToMarkdown`... |
| `@aionbuilders/nabu/ui` | The optional UI: `FloatingToolbar`, `SlashMenu`, `DragHandle`, `CommandInvite`, `CommandChooser` |
| `@aionbuilders/nabu/extend` | Writing your own blocks and extensions: `extension`, `Block`, `TextBlock`, `MegaBlock`, `TextBehavior`, `RichText`, key-chord helpers |
| `@aionbuilders/nabu/vite` | The Vite helper `nabu()` shown above |

## Presets

A preset is an array of extensions, and each has a factory.

| Preset | Factory | Contains | Tab |
|---|---|---|---|
| `MinimalPreset` | `createMinimalEditor()` | Paragraphs; plain text, HTML and Nabu paste; `BlockExtension` | leaves the editor |
| `TextPreset` | `createTextEditor()` | Minimal + rich text marks, typography, inline markdown shortcuts, markdown paste | leaves the editor |
| `DocumentPreset` | `createDocumentEditor()` | Text + headings, blockquote, divider, code, callout, toggle, image, video, file. **No lists** | stays in the editor |
| `FullPreset` | `createFullEditor()` | Document + lists (bullet, numbered, to-do), dialogue, regions | stays in the editor |

`createEditor({ preset, extensions })` is the generic factory: any preset, plus your own extensions. Details, the exact extension lists and how to add or remove extensions: [Presets](docs/getting-started/presets.md).

## Documentation

- [Installation](docs/getting-started/installation.md)
- [Your first editor](docs/getting-started/first-editor.md): mounting, reading and writing content, listening to changes
- [Presets](docs/getting-started/presets.md)
- Guides: [Action bus (`nabu.exec`)](docs/guides/actions.md), [Local persistence](docs/guides/persistence.md)
- [Architecture decisions](docs/adr) and [design notes](docs/design)
- [Tests](tests/README.md)

## License

MIT, as declared in `package.json`.
