---
title: A read-only viewer
description: Show a stored document to readers without an editor, by rendering the JSON export as HTML with the public helpers; Nabu has no read-only mode.
section: recipes
order: 20
---

# A read-only viewer

Nabu has **no read-only mode** in the beta: `NabuEditor` always renders an editable element, and there is no `readonly` prop or engine option. For a page that only displays a document (a published article, a preview, an email), do not mount an editor. Render the **JSON export** yourself. This is also lighter than an editor: no WebAssembly and no Loro on the page, only the JSON you stored.

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
- **The editor's own rendering** needs an editable `NabuEditor`: until a read-only mode exists (see the gaps in the report of this documentation), the renderer above is the way to show content without letting anyone change it.
