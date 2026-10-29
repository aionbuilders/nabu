# Nabu

Nabu is a modular, local-first block editor for **Svelte 5**. It combines the cross-block selection of document editors (Google Docs, ProseMirror) with the structural flexibility of block editors (Notion), on a single `contenteditable` and a CRDT core ([Loro](https://loro.dev)). You pick the blocks and behaviors you need from a list of extensions, from a `<textarea>` replacement to a full document editor, and save to the browser with one call.

**Website, documentation and live demos: [nabu.aion.builders](https://nabu.aion.builders)**

Community: [join the Discord](https://discord.gg/gKkyqRRuWe)

> **Status: public beta** (`0.1.0`). The editing core is complete and tested, but the API may still change before 1.0. Breaking changes are listed in the [changelog](https://nabu.aion.builders/changelog) ([CHANGELOG.md](CHANGELOG.md)). Known gaps (mobile keyboards, Firefox and Safari, tables, real-time collaboration between machines) are listed honestly on the [limits page](https://nabu.aion.builders/architecture/limits).

### Versioning (0.x)

- A `0.` version means the API can still change. 1.0.0 will mark the stability commitment.
- Breaking changes arrive only in a minor version (0.2.0, 0.3.0, ...), each with a migration note in the changelog.
- Patch versions (0.1.x) are fixes only: they keep the public API and the stable `@aionbuilders/nabu/extend` contract.
- `nabu.internals` is unstable and may change in any version.

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

Without this setup, Nabu fails to load. Why `esnext`, the manual equivalent and common errors: [Installation](https://nabu.aion.builders/docs/getting-started/installation).

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

Add the optional UI from `@aionbuilders/nabu/ui`, and import a theme once:

```svelte
<script>
  import '@aionbuilders/nabu/nabu-theme.css';
  import { NabuEditor, createDocumentEditor } from '@aionbuilders/nabu';
  import { FloatingToolbar, SlashMenu, DragHandle } from '@aionbuilders/nabu/ui';

  const engine = createDocumentEditor();
</script>

<FloatingToolbar {engine} />
<SlashMenu {engine} />
<DragHandle {engine} />
<NabuEditor {engine} label="Notes" />
```

Save to the browser (IndexedDB) with one call, and show a document as a viewer with `readonly`:

```svelte
<script>
  import { NabuEditor, createPersistedEditor } from '@aionbuilders/nabu';

  let engine = $state(null);
  createPersistedEditor({ docId: 'my-notes' }).then((created) => (engine = created));
</script>

{#if engine}
  <NabuEditor {engine} label="Notes" />
  <!-- or, as a read-only viewer: <NabuEditor {engine} readonly /> -->
{/if}
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

`createEditor({ preset, extensions })` is the generic factory: any preset, plus your own extensions. Details, the exact extension lists and how to add or remove extensions: [Presets](https://nabu.aion.builders/docs/getting-started/presets).

## Documentation

Everything is on the website: **[nabu.aion.builders/docs](https://nabu.aion.builders/docs)**.

- [Installation](https://nabu.aion.builders/docs/getting-started/installation)
- [Your first editor](https://nabu.aion.builders/docs/getting-started/first-editor): mounting, reading and writing content, listening to changes
- [Presets](https://nabu.aion.builders/docs/getting-started/presets)
- Guides: [Extensions](https://nabu.aion.builders/docs/guides/extensions) (including the stable `/extend` contract), [Commands and keymap](https://nabu.aion.builders/docs/guides/commands-and-keymap), [Persistence and sync](https://nabu.aion.builders/docs/guides/persistence-and-sync), [Regions](https://nabu.aion.builders/docs/guides/regions), [Accessibility](https://nabu.aion.builders/docs/guides/accessibility), [Theming](https://nabu.aion.builders/docs/guides/theming)
- Recipes, such as the [read-only viewer](https://nabu.aion.builders/docs/recipes/read-only-viewer)
- [API reference](https://nabu.aion.builders/api), [architecture](https://nabu.aion.builders/architecture) and [live labs](https://nabu.aion.builders/labs)

In the repository: [architecture decisions](docs/adr), [design notes](docs/design), [tests](tests/README.md).

## Contributing

Bug reports, fixes, docs and tests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Questions go to `#help` on the [Discord](https://discord.gg/gKkyqRRuWe).

## License

MIT, as declared in `package.json`.
