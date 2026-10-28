---
title: Presets
description: The four built-in presets (Minimal, Text, Document, Full), what each contains, their Tab default, and how to add or remove extensions.
section: getting-started
order: 4
---

# Presets

An editor is a list of **extensions**: each one adds a block type, a text behavior, an input rule, a paste handler or a command. A **preset** is just such a list, ready to use. Nabu ships four, from the smallest to the fullest. Each has a factory function that creates an editor from it.

| Preset | Factory | For |
|---|---|---|
| `MinimalPreset` | `createMinimalEditor()` | A `<textarea>` replacement |
| `TextPreset` | `createTextEditor()` | Comment boxes, descriptions |
| `DocumentPreset` | `createDocumentEditor()` | Articles, notes |
| `FullPreset` | `createFullEditor()` | The full Nabu experience (this is also the default of `createEditor()`) |

Presets are plain arrays of extensions, so you can spread, filter and extend them.

## What each preset contains

The exact content of each array, in the order they are listed in the source:

| Extension | Minimal | Text | Document | Full |
|---|:-:|:-:|:-:|:-:|
| `ParagraphExtension` | yes | yes | yes | yes |
| `HeadingExtension` | | | yes | yes |
| `BlockquoteExtension` | | | yes | yes |
| `DividerExtension` | | | yes | yes |
| `CodeExtension` | | | yes | yes |
| `CalloutExtension` | | | yes | yes |
| `ToggleExtension` | | | yes | yes |
| `ImageExtension` | | | yes | yes |
| `VideoExtension` | | | yes | yes |
| `FileExtension` | | | yes | yes |
| `ListExtension`, `ListItemExtension` | | | | yes |
| `DialogueExtension` | | | | yes |
| `RegionsExtension()` | | | | yes |
| `RichTextExtension` | | yes | yes | yes |
| `TypographyExtension` | | yes | yes | yes |
| `MarkdownShortcutsExtension` | | yes | yes | yes |
| `PlainTextPasteExtension` | yes | yes | yes | yes |
| `HtmlPasteExtension` | yes | yes | yes | yes |
| `MarkdownPasteExtension` | | yes | yes | yes |
| `NabuPasteExtension` | yes | yes | yes | yes |
| `BlockExtension` | yes | yes | yes | yes |

Notably, `DocumentPreset` has **no lists**: lists, to-dos, dialogue and regions come with `FullPreset`.

```js test
import { MinimalPreset, TextPreset, DocumentPreset, FullPreset } from '@aionbuilders/nabu';

const names = (preset) => preset.map((extension) => extension.name);

expect(names(MinimalPreset)).toEqual(['paragraph', 'plain-text-paste', 'html-paste', 'nabu-paste', 'block']);

expect(names(TextPreset)).toEqual([
  'paragraph', 'rich-text', 'typography', 'markdown-shortcuts',
  'plain-text-paste', 'html-paste', 'nabu-paste', 'markdown-paste', 'block'
]);

expect(names(DocumentPreset)).toEqual([
  'paragraph', 'heading', 'blockquote', 'divider', 'code', 'callout', 'toggle', 'image', 'video', 'file',
  'rich-text', 'typography', 'markdown-shortcuts',
  'plain-text-paste', 'html-paste', 'markdown-paste', 'nabu-paste', 'block'
]);

expect(names(FullPreset)).toEqual([
  'paragraph', 'heading', 'blockquote', 'divider', 'code', 'callout', 'toggle', 'image', 'video', 'file',
  'list', 'list-item', 'dialogue', 'region',
  'rich-text', 'typography', 'markdown-shortcuts',
  'plain-text-paste', 'html-paste', 'markdown-paste', 'nabu-paste', 'block'
]);
```

### What the extensions do

- **Blocks** (`Paragraph`, `Heading`, `Blockquote`, `Divider`, `Code`, `Callout`, `Toggle`, `Image`, `Video`, `File`, `List` + `ListItem`, `Dialogue`, `Regions`): each registers a block type. Typing the markdown prefix converts a paragraph (`# ` for a heading, `> ` for a quote, `--- ` for a divider, `! ` for a callout). `ListExtension` and `ListItemExtension` always go together.
- **`RichTextExtension`**: the inline marks (bold, italic, underline, code, strikethrough) and links, with their keyboard shortcuts.
- **`TypographyExtension`**: typographic substitutions while typing (`-- ` becomes an em dash).
- **`MarkdownShortcutsExtension`**: inline markdown while typing (`**bold**`, `_italic_`, `` `code` ``, `~~strike~~`).
- **Paste**: `PlainTextPasteExtension` (a plain text fallback, one line per block), `HtmlPasteExtension` (HTML from other pages and apps), `MarkdownPasteExtension` (markdown text; it also powers `engine.importMarkdown()`), `NabuPasteExtension` (copy and paste between Nabu editors, structure kept).
- **`BlockExtension`**: the `block:transform` action that turns a block into another type. The slash menu reaches it through the actions of the block extensions (`heading:1`, `callout`, `code:block`...), which call it. The floating toolbar does not use it: it only applies marks and links.

## The `tab` option per preset

What Tab and Shift+Tab do in a plain text block depends on the preset, because a small field and a long document do not want the same thing:

| Preset | `tab` default | Behaviour |
|---|---|---|
| `MinimalPreset`, `TextPreset` | `'focus'` | Tab leaves the editor, like in a `<textarea>` |
| `DocumentPreset`, `FullPreset` | `'stay'` | Tab keeps the caret in the editor; press Escape, then Tab, to leave (announced to screen readers) |
| A custom preset array | `'focus'` | |

An explicit `tab` option always wins. The third mode, `'indent'`, makes Tab insert a tab character. Lists, code blocks and region titles keep their own Tab meaning whatever you choose.

```js test
import { createMinimalEditor, createDocumentEditor, createEditor, ParagraphExtension } from '@aionbuilders/nabu';

expect(createMinimalEditor().tab).toBe('focus');
expect(createDocumentEditor().tab).toBe('stay');

// An explicit option wins over the preset's default.
expect(createDocumentEditor({ tab: 'indent' }).tab).toBe('indent');

// A preset that is not one of the four gets 'focus'.
expect(createEditor({ preset: [ParagraphExtension] }).tab).toBe('focus');
```

## Add extensions to a preset

`createEditor({ preset, extensions })` appends your `extensions` to the preset's. Every named factory accepts the same `extensions` option.

```js test
import { createTextEditor, HeadingExtension } from '@aionbuilders/nabu';

// TextPreset has no headings...
const plain = createTextEditor();
expect(() => plain.insert('heading', { level: 1, text: 'Title' })).toThrow(/not registered/);

// ...unless you add them.
const withHeadings = createTextEditor({ extensions: [HeadingExtension] });
withHeadings.insert('heading', { level: 1, text: 'Title' });
await withHeadings.commit();
expect(withHeadings.serialize('markdown')).toBe('# Title');
```

Your own extensions are written with `extension()` from `@aionbuilders/nabu/extend`.

## Remove extensions from a preset

A preset is an array, so filter it and pass the result as the `preset`:

```js test
import { createEditor, DocumentPreset, CalloutExtension, ToggleExtension } from '@aionbuilders/nabu';

const withoutCallouts = DocumentPreset.filter((extension) => extension !== CalloutExtension && extension !== ToggleExtension);
const engine = createEditor({ preset: withoutCallouts });

expect(() => engine.insert('callout')).toThrow(/not registered/);
expect(() => engine.insert('toggle')).toThrow(/not registered/);
expect(() => engine.insert('heading', { level: 2, text: 'Still here' })).not.toThrow();
```

Extensions that are created by a function, such as `RegionsExtension()` in `FullPreset`, are filtered by their `name` (`'region'`):

```js test
import { createEditor, FullPreset } from '@aionbuilders/nabu';

const withoutRegions = FullPreset.filter((extension) => extension.name !== 'region');
const engine = createEditor({ preset: withoutRegions });

expect(() => engine.insert('region')).toThrow(/not registered/);
```

The reverse, configuring regions (their types, fields and numbering), uses `createRegionsExtension(options)`: remove the default `'region'` extension as above, then pass your configured one in `extensions`.

## Build a preset from scratch

Every built-in extension is exported from `@aionbuilders/nabu`, so you can compose exactly what you need. Keep at least `ParagraphExtension` (the default block); add `BlockExtension` if you want blocks to be transformable, and the paste extensions you want.

```js test
import {
  createEditor,
  ParagraphExtension, HeadingExtension, ListExtension, ListItemExtension,
  RichTextExtension, MarkdownPasteExtension, PlainTextPasteExtension, BlockExtension
} from '@aionbuilders/nabu';

const NotesPreset = [
  ParagraphExtension, HeadingExtension, ListExtension, ListItemExtension,
  RichTextExtension, MarkdownPasteExtension, PlainTextPasteExtension, BlockExtension
];

const engine = createEditor({ preset: NotesPreset });
await engine.importMarkdown('# Shopping\n\n- milk\n- eggs');

expect(engine.serialize('markdown')).toBe('# Shopping\n\n- milk\n- eggs');
```

The generic `createEditor()` forwards every other option (`placeholders`, `files`, `keymap`, `lang`…) to the engine, so a custom preset gets the same configuration surface as the named factories.

Next: the [guides](../guides/extensions.md), starting with how to write your own extension.
