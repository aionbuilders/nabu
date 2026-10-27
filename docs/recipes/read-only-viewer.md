---
title: A read-only viewer
description: Show a stored document to readers, either with the real editor in read-only mode (same rendering as the editor) or as plain HTML from the JSON export with the public helpers (no editor, no WebAssembly).
section: recipes
order: 20
---

# A read-only viewer

There are two ways to show a stored document to people who must not change it:

1. **The editor in read-only mode.** The same rendering and blocks, with selection, copy and links. It needs the editor (WebAssembly and Loro) on the page.
2. **Plain HTML rendered from the JSON export.** No editor at all: lighter, and available for server-side rendering, search engines and print. See [Option 2](#option-2-html-from-the-json-export).

## Option 1: `readonly`

`<NabuEditor readonly>` (or `createEditor({ readonly: true })`, or `engine.readonly = true`) turns the editor into a viewer. It is reactive: toggle it for an "Edit" button.

```svelte
<script>
  import { NabuEditor, createFullEditor } from '@aionbuilders/nabu';

  const engine = createFullEditor({ lang: 'en' });
  let editing = $state(false);

  // Load the document: the host's own calls are never blocked by read-only mode.
  export async function load(json) { await engine.importJSON(json); }
</script>

<button onclick={() => (editing = !editing)}>{editing ? 'Done' : 'Edit'}</button>
<NabuEditor {engine} label="Release notes" readonly={!editing} />
```

What read-only mode does:

- The root is `contenteditable="false"` (with `role="document"`, named by `label`): no caret, no typing, no input method.
- The engine ignores the user's channels, not only the DOM: `beforeinput`, paste, cut (it copies and removes nothing), drop and drag moves, every keyboard shortcut and every command (`commands.run`, `exec` of a command or an action, undo and redo included).
- **Copy works, text can be selected, links open** as normal links. Dragging a selection out to another application copies it.
- The floating UI (`FloatingToolbar`, `SlashMenu`, `DragHandle`) hides itself, so there is nothing to condition on your side. The to-do box, the callout icon and the code language select do nothing.
- **Toggles can be opened and closed to read them.** Collapsing is stored in the document, but in read-only mode it is *view state*: kept in memory only, never written (no Loro change, no undo step, nothing saved or synced), exports keep reporting the document's own state, and it is forgotten when the editor becomes editable again. A reader who opens a toggle changes nothing for the next reader.
- **Your own code is not restricted.** `importJSON`, `importMarkdown`, `importRemote`, `insert` and `transact` still work, which is how a viewer loads and updates its document (live collaboration keeps flowing into a read-only editor).

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor({ readonly: true });
await engine.importMarkdown('first\n\nsecond');
engine.insert('paragraph', { text: 'third' });
await engine.commit();

// the user's channels are closed: undo, a mark, a block action do nothing
await engine.commands.run('undo');
await engine.exec('mark:toggle', { mark: 'bold' });
expect(engine.serialize('markdown')).toBe('first\n\nsecond\n\nthird');

// the host still writes
await engine.importMarkdown('# Updated');
expect(engine.serialize('markdown')).toBe('# Updated');

engine.readonly = false; // editable again
await engine.commands.run('undo');
expect(engine.serialize('markdown')).not.toBe('# Updated');
```

A custom block component that changes the document on a click should check `block.nabu.readonly` first, as the to-do box and the callout icon of the library do.

## Option 2: HTML from the JSON export

For a page that only displays a document (a published article, a preview, an email), you do not need an editor. Render the **JSON export** yourself. This is lighter than an editor: no WebAssembly and no Loro on the page, only the JSON you stored.

The pieces are public:

- `engine.serialize('json')` (or the JSON you saved) is a plain tree: `{ type, props, content, children }` with the text as runs `{ text, bold, italic, underline, strikethrough, code, link }`. See [Your first editor](../getting-started/first-editor.md#read-the-content).
- `deltaToHtml` turns inline runs into HTML: escaped text, the marks as `<strong>`, `<em>`, `<u>`, `<s>`, `<code>`, and a link only if its URL is safe.
- `sanitizeUrl` and `escapeHtml` cover the rest.

## A renderer

The function below handles the built-in blocks of `FullPreset`. Add the types of your own extensions the same way; an unknown type falls back to a paragraph with its text, the way an editor without that block would show it.

```js test
import { createFullEditor, deltaToHtml, sanitizeUrl } from '@aionbuilders/nabu';
import { escapeHtml } from '@aionbuilders/nabu/extend';

/** JSON runs `{ text, ...marks }` to the delta that `deltaToHtml` reads. */
const inline = (runs = []) =>
  deltaToHtml(runs.map(({ text, ...attributes }) => ({ insert: text, attributes })));

/** One block of the JSON export, as HTML. */
function block(b) {
  const children = (b.children ?? []).map(block).join('');
  switch (b.type) {
    case 'heading':
      return `<h${b.props?.level ?? 1}>${inline(b.content)}</h${b.props?.level ?? 1}>`;
    case 'blockquote':
      return `<blockquote>${inline(b.content)}</blockquote>`;
    case 'callout':
      return `<aside class="callout callout-${escapeHtml(b.props?.variant ?? 'note')}">${inline(b.content)}</aside>`;
    case 'code':
      return `<pre><code>${escapeHtml(b.content ?? '')}</code></pre>`;
    case 'divider':
      return '<hr>';
    case 'list': {
      const tag = b.props?.listType === 'ordered' ? 'ol' : 'ul';
      const start = b.props?.start > 1 ? ` start="${Number(b.props.start)}"` : '';
      return `<${tag}${start}>${children}</${tag}>`;
    }
    case 'list-item': {
      const box = b.props?.checked === undefined ? '' : `<input type="checkbox" disabled${b.props.checked ? ' checked' : ''}> `;
      return `<li>${box}${inline(b.content)}${children}</li>`;
    }
    case 'toggle':
      return `<details${b.props?.collapsed ? '' : ' open'}><summary>${inline(b.content)}</summary>${children}</details>`;
    case 'region':
      return `<section data-region="${escapeHtml(b.props?.regionType ?? '')}"><h2>${inline(b.content)}</h2>${children}</section>`;
    case 'image': {
      const src = sanitizeUrl(b.props?.ref, { kind: 'media' });
      return src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(b.props?.alt ?? '')}">` : '';
    }
    case 'video':
    case 'file': {
      const href = sanitizeUrl(b.props?.ref);
      const label = escapeHtml(b.props?.name || b.props?.alt || b.type);
      return href ? `<p><a href="${escapeHtml(href)}">${label}</a></p>` : `<p>${label}</p>`;
    }
    default: // paragraph, dialogue, and any type this viewer does not know
      return `<p>${inline(b.content)}</p>${children}`;
  }
}

const renderHtml = (json) => json.blocks.map(block).join('\n');

// The document, as stored.
const engine = createFullEditor();
await engine.importMarkdown([
  '## Release notes',
  '',
  'Faster **paste**, and a [guide](https://example.com/guide).',
  '',
  '- [x] shipped',
  '- [ ] next',
  '',
  '<details>',
  '<summary>Details</summary>',
  '',
  'Hidden text.',
  '',
  '</details>'
].join('\n'));
const stored = JSON.stringify(engine.serialize('json'));

// The page: no editor, no engine, only the stored JSON.
const html = renderHtml(JSON.parse(stored));

expect(html).toContain('<h2>Release notes</h2>');
expect(html).toContain('<strong>paste</strong>');
expect(html).toContain('<a href="https://example.com/guide">guide</a>');
expect(html).toContain('<li><input type="checkbox" disabled checked> shipped</li>');
expect(html).toContain('<details><summary>Details</summary><p>Hidden text.</p></details>');

// Stored content is not trusted: an unsafe link keeps its text, and nothing is injected.
const hostile = renderHtml({
  blocks: [
    { type: 'paragraph', content: [{ text: 'click', link: 'javascript:alert(1)' }, { text: ' <script>x</script>' }] },
    { type: 'image', props: { ref: 'javascript:alert(1)', alt: '"><script>' } }
  ]
});
expect(hostile).toBe('<p>click &lt;script&gt;x&lt;/script&gt;</p>\n');
```

## In a Svelte page

Render the string with `{@html}`. It is safe here because the renderer escapes every piece of text and refuses unsafe URLs, as shown by the last assertion above.

```svelte
<script>
  import { renderHtml } from './render-html.js'; // the function above

  let { json } = $props(); // the stored JSON export
</script>

<article class="prose">{@html renderHtml(json)}</article>
```

Because the output is plain semantic HTML, you style it with your own CSS, and it is available for server-side rendering, search engines and print. To give it the look of the editor, scope the [Atelier theme](../guides/theming.md#the-atelier-theme) around it: it styles the elements by their `[data-block-type]` attributes, which this HTML does not carry, so for a pixel-identical result add them to the renderer, or style the tags directly.

## Notes

- **Images stored in the document.** A `nabu-asset:` reference points into the asset store of the editor, which a viewer does not have. Serve the files from your own storage with the `files` option (`onBeforePersist` returns a URL that is stored as the block's `ref`), or resolve the references in the renderer (the JSON export embeds the bytes of small files, in `assets`). See [Persistence and sync, Files](../guides/persistence-and-sync.md#files-and-the-asset-store).
- **Regions.** The viewer above draws a region's title as an `h2`. Use `props.regionType` to choose a level and the numbering yourself, or read the numbers from an editor with `engine.regions.list` (labels, paths) when you have one.
- **From markdown.** If you store markdown, render it with the markdown renderer of your choice; Nabu does not ship one. Its markdown is standard except for the three constructs in [Clipboard and markdown](../guides/clipboard-and-markdown.md#what-round-trips-exactly) (`<details>`, `-- `, the region comment), which a general renderer shows as raw HTML or text.
- **The editor's own rendering** is [Option 1](#option-1-readonly). Use the renderer above when you want no editor on the page.
