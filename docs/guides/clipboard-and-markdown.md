---
title: Clipboard and markdown
description: What copy and cut put on the clipboard, how a paste is read (internal, HTML, markdown, plain text, files), markdown import and export with what round-trips exactly, and how links and HTML are sanitized.
section: guides
order: 60
---

# Clipboard and markdown

Nabu handles the clipboard itself: copy, cut, paste and the drag of a selection all go through the same pipeline, on the single `contenteditable`. The browser never inserts pasted HTML into the page. Everything that arrives is read into blocks first, adapted to the blocks the editor has, sanitized, and inserted as **one undo step**.

Markdown is the exchange format of the same machinery: pasting markdown text and `engine.importMarkdown()` use the same parser, and `engine.serialize('markdown')` writes the syntax it reads.

## Copy and cut

When the selection is not collapsed, the editor takes over the `copy` event and writes **three formats** to the clipboard:

| Format | Content | Read by |
|---|---|---|
| `application/x-nabu+json` | The selected fragment as blocks: type, props, rich-text delta, children, and whether each block is cut at its start or end. The bytes of stored images and files travel with it (`assets`) | Another Nabu editor: full fidelity |
| `text/html` | Clean semantic HTML (`<h2>`, `<strong>`, `<ul>`, `<a href>`...), without Nabu's internal attributes | Mail clients, word processors, other editors |
| `text/plain` | A selection **inside one text block** is its raw text, without any syntax. A selection over several blocks is **markdown** | Terminals, text editors, chat |

So copying a bold word out of a paragraph gives `word` as plain text and `<strong>word</strong>` as HTML, while copying a heading and two paragraphs gives `## Title\n\nOne\n\nTwo` as plain text.

A few precise rules:

- **Cut** is copy plus delete, in one undo step.
- A **collapsed** selection copies nothing: the browser's default applies.
- A **text selection copies text only**. Region titles are not copied, and a region is never copied by a text selection (the seam is a structure gesture): see [Regions](./regions.md#the-title-is-a-field). A selection that spans whole regions does copy them, with their structure, for another Nabu editor.
- **Stored files.** An image or file of the document is a `nabu-asset:` reference to the asset store, meaningless in another document. In the `application/x-nabu+json` payload its bytes are embedded (up to `files.maxInlineSize`, 2 MB by default; above that the reference travels alone and a debug warning is emitted). In `text/html` an image of at most 1 MB becomes a `data:` URL, anything bigger has no source (its label is written instead); in `text/plain` only the alt text or file name is written. A `nabu-asset:` reference never leaks outside Nabu.
- **Dragging** a text selection writes the same three formats to the drag data.

The exact shape of the internal format, with its version and reading rules, is in the design note [`clipboard-format.md`](../design/clipboard-format.md).

## Paste

A paste is read in a fixed order. The first step that applies wins:

1. **Files.** If the clipboard holds files (a screenshot, a file copied from the OS) and an extension takes them, each file becomes the block that extension makes of it: `ImageExtension`, `VideoExtension` and `FileExtension` accept images, videos and any other file. The bytes are stored (and uploaded when you configured `files.onBeforePersist`), and the blocks are inserted in order. Exceptions: an internal copy (`application/x-nabu+json`, which already carries its blocks) and a text payload that is worth more than the files next to it (a spreadsheet range comes with an image of its table: the table wins). Everything about files is in [Persistence and sync, Files](./persistence-and-sync.md#files-and-the-asset-store).
2. **A verbatim block.** In a block that takes text as it comes (a code block), the plain text is inserted as is, with no interpretation.
3. **The paste interpreters**, from the highest priority down. Each one reads one format of the clipboard and returns blocks, or declines:

| Interpreter | Extension | Format | Priority |
|---|---|---|---|
| Nabu fragment | `NabuPasteExtension` | `application/x-nabu+json` | 100 |
| HTML | `HtmlPasteExtension` | `text/html` | 50 |
| Markdown | `MarkdownPasteExtension` | `text/plain` | 25 |
| Plain text | `PlainTextPasteExtension` | `text/plain` | 0 |

The first interpreter whose format is on the clipboard **and** that accepts it makes the fragment. So a paste from another Nabu editor restores everything; a paste from a web page or a word processor is read from its HTML; and plain text is read as markdown, then, if `MarkdownPasteExtension` is not loaded, as plain text.

Two consequences worth knowing:

- **Plain text is read as markdown** whenever `MarkdownPasteExtension` is in the preset (`TextPreset`, `DocumentPreset`, `FullPreset`; `MinimalPreset` has only the plain-text fallback). Pasting `# Title` into an empty paragraph gives a heading. In a paste, **one line is one block**; `importMarkdown` uses CommonMark's rules instead, where consecutive lines join into one paragraph.
- **A fragment is adapted to the editor.** The pasted types are limited to the blocks the editor registers: a heading pasted into a `MinimalPreset` editor becomes a paragraph with its text, and the children of a toggle it does not have follow as ordinary blocks. Nothing is dropped. A fragment of a format version the editor does not know is declined (not mis-read) and the paste falls to the next format.

A whole block pasted into an empty block takes the place of that block and adopts its type (`# Title` pasted into an empty paragraph gives a heading). Each paste is a single undo step.

```js test
import { createFullEditor, createMinimalEditor, HtmlPasteExtension, NabuPasteExtension, MarkdownPasteExtension, PlainTextPasteExtension } from '@aionbuilders/nabu';

// The interpreters are plain objects of the extensions: read one format, return a fragment (or null).
const [html] = HtmlPasteExtension.pasteInterpreters;
const [nabuJson] = NabuPasteExtension.pasteInterpreters;
const [markdown] = MarkdownPasteExtension.pasteInterpreters;
const [plain] = PlainTextPasteExtension.pasteInterpreters;
expect([nabuJson.priority, html.priority, markdown.priority, plain.priority]).toEqual([100, 50, 25, 0]);

const engine = createFullEditor();

// A paste of markdown text: one line is one block.
const fragment = markdown.interpret('# Title\nfirst line\nsecond line', engine);
expect(fragment.blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'paragraph']);

// Importing markdown joins consecutive lines (CommonMark).
const joined = markdown.interpret('first line\nsecond line', engine, { joinLines: true });
expect(joined.blocks).toHaveLength(1);

// A clipboard fragment of a version this editor does not know is declined, not mis-read.
expect(nabuJson.interpret(JSON.stringify({ version: 99, blocks: [] }), engine)).toBeNull();

// A fragment is adapted to the receiving editor: a heading pasted into a paragraph-only editor stays as text.
const minimal = createMinimalEditor();
await minimal.importFragment({
  blocks: [{ type: 'heading', partial: false, props: { level: 2 }, delta: [{ insert: 'Title' }] }]
});
expect(minimal.children.map((block) => block.type)).toEqual(['paragraph']);
expect(minimal.serialize('markdown')).toBe('Title');
```

### HTML

`HtmlPasteExtension` reads the HTML of other pages and applications: headings, paragraphs, lists (nested too), quotes, code, images, links and the inline marks (`<strong>`, `<em>`, `<u>`, `<code>`, `<s>`), including the styled `<span>`s that word processors write. Containers such as `<div>` and `<section>` are transparent. What the editor has no block for keeps its text: a table becomes one paragraph per cell. Content that comes from outside is marked `external`, which is what lets `files.importRemote` fetch remote images instead of hot-linking them.

### Writing your own interpreter

An extension adds a reader with `pasteInterpreters`: `{ format, priority, interpret(raw, nabu, options) }`, where `interpret` returns `{ blocks }` (the `PasteFragment`) or `null` to decline. A file reader is `pasteFileHandlers`: `{ priority, accepts(file, nabu), block(file, nabu) }`. Both are documented in [Extensions](./extensions.md); the built-in `NabuPasteExtension`, `HtmlPasteExtension` and `MarkdownPasteExtension` are the models.

A block gets its own paste syntax by declaring static `markdownRules` / `fromMarkdown` and `htmlRules` / `fromHTML` members, as `BlockquoteExtension` and `DividerExtension` do.

```js test
import { createTextEditor } from '@aionbuilders/nabu';
import { extension } from '@aionbuilders/nabu/extend';

// Reads tab-separated text as one paragraph per row, cells joined with " | ".
const Tsv = extension('tsv-paste', {
  pasteInterpreters: [
    {
      format: 'text/plain',
      priority: 40, // above markdown (25): asked first
      interpret(raw) {
        if (!raw.includes('\t')) return null; // decline: the next interpreter reads it
        const rows = raw.split('\n').map((row) => row.split('\t').join(' | '));
        return { blocks: rows.map((row) => ({ type: 'paragraph', partial: false, delta: [{ insert: row }] })) };
      }
    }
  ]
});

const engine = createTextEditor({ extensions: [Tsv] });
const [interpreter] = Tsv.pasteInterpreters;

await engine.importFragment(interpreter.interpret('a\tb\nc\td', engine));
expect(engine.serialize('markdown')).toBe('a | b\n\nc | d');
expect(interpreter.interpret('no tab here', engine)).toBeNull();
```

## Markdown

### Export and import

`engine.serialize('markdown')` returns the document as a string, blocks separated by a blank line. `engine.importMarkdown(text)` replaces the whole document with it. Both belong to the editor's preset: only the blocks it has are written and produced (with `TextPreset`, `# Title` imports as a paragraph).

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const source = [
  '# Title',
  '',
  'A paragraph with **bold**, *italic*, ~~gone~~, `code` and [a link](https://example.com).',
  '',
  '> A quote',
  '',
  '> [!TIP]',
  '> Useful',
  '',
  '```js',
  'let a = 1;',
  '```',
  '',
  '---',
  '',
  '- one',
  '- two',
  '  - nested',
  '',
  '1. first',
  '2. second',
  '',
  '- [ ] to do',
  '- [x] done',
  '',
  '<details open>',
  '<summary>More</summary>',
  '',
  'Hidden **text**',
  '',
  '</details>',
  '',
  '-- Hello there',
  '',
  '![alt text](https://example.com/a.png)'
].join('\n');

const engine = createFullEditor();
await engine.importMarkdown(source);

// Every block type above is read back as itself...
expect(engine.serialize('json').blocks.map((block) => block.type)).toEqual([
  'heading', 'paragraph', 'blockquote', 'callout', 'code', 'divider',
  'list', 'list', 'list', 'toggle', 'dialogue', 'image'
]);
// ...and written back exactly as it was read.
expect(engine.serialize('markdown')).toBe(source);
```

Markdown text is **idempotent**: `serialize`, then `importMarkdown`, then `serialize` again gives the same string.

### What round-trips exactly

Exporting a document to markdown and importing it back gives the same tree for:

| Block | Syntax |
|---|---|
| Paragraph | Inline markdown: `**bold**`, `*italic*`, `~~strike~~`, `<u>underline</u>`, `` `code` ``, `[link](url)`, escapes. A line break is a backslash and a newline |
| Heading | `#` to `######` |
| Blockquote | `> text` |
| Callout | `> [!NOTE]`, `TIP`, `IMPORTANT`, `WARNING` or `CAUTION`, then `> ` lines |
| Code | A fence, longer than any run of backticks in the code, with the language. The content is kept verbatim |
| Divider | `---` |
| Lists | `-`, `*`, `1.`, `1)`, `- [ ]`, `- [x]`; nesting; the start number; several sublists in one item |
| Toggle | `<details>` (below) |
| Dialogue | `-- text` (below) |
| Image | `![alt](url)` |
| Region | A data comment and a heading (below) |

Three of these are not plain CommonMark, by necessity. Each recognises **only the construct below**, and everything else stays literal text.

**Toggle: `<details>`.** An opening line that is exactly `<details>` or `<details open>`, a `<summary>` with the header as inline markdown, the body as block markdown, and a closing line that is exactly `</details>`:

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor();
await engine.importMarkdown('<details>\n<summary>Header, **inline**</summary>\n\nBody\n\n</details>');

const toggle = engine.serialize('json').blocks[0];
expect(toggle).toMatchObject({ type: 'toggle', props: { collapsed: true } }); // no `open`: collapsed
expect(engine.serialize('markdown')).toBe('<details>\n<summary>Header, **inline**</summary>\n\nBody\n\n</details>');

// Any other markup is plain text: no tag, no attribute, no HTML is ever passed through.
const other = createFullEditor();
await other.importMarkdown('<details class="x">\n<summary>Head</summary>\n\nBody\n\n</details>');
expect(other.serialize('json').blocks.every((block) => block.type === 'paragraph')).toBe(true);
```

**Dialogue: `-- `.** A line that starts with two hyphens and a space. The dash shown on screen is a display option and is never written: see [Language and dialogue](./ime-and-languages.md#the-dialogue-dash).

**Region: a comment and a heading.** The comment carries the type and the fields as JSON, the heading right after it is the title, and the end of the region is inferred (a closing comment `<!-- /region -->` is written only when something follows at the parent's level):

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const source = [
  'Before the first region.',
  '',
  '<!-- region:section-1 {} -->',
  '# One',
  '',
  'Text of one.',
  '',
  '<!-- region:section-2 {} -->',
  '## A sub-section',
  '',
  'Text of the sub-section.',
  '',
  '<!-- region:section-1 {} -->',
  '# Two'
].join('\n');

const engine = createFullEditor();
await engine.importMarkdown(source);

expect(engine.regions.list.map((region) => region.title)).toEqual(['One', 'A sub-section', 'Two']);
expect(engine.regions.tree[1].title).toBe('Two');
expect(engine.serialize('markdown')).toBe(source);
```

The full grammar, including the unknown-type and invalid-field cases, is in [Regions, Formats](./regions.md#formats) and in the design note [`import-export.md`](../design/import-export.md).

### What markdown cannot express

Markdown is a lossy format by nature; use **JSON** (`serialize('json')`, `importJSON`) to store a document and markdown to exchange one. The differences to expect:

- **Empty blocks are dropped**: an empty paragraph, heading, quote or dialogue line has no markdown.
- **Video and file** are written as a link, so they come back as a paragraph with a link. Their type, name and status are lost. An image keeps its URL and alt text, but not its name or status.
- A **code span** takes no other mark. Whitespace at the edge of a mark moves outside it (a bold run `"a "` is written `**a** `).
- A **multi-paragraph quote** read from markdown is several quotes.
- A **code block's language** keeps its first word.
- A file stored in the document is written as its `nabu-asset:` reference, without its bytes: the file is meaningful in the same document or a peer, and imports as `missing` elsewhere. JSON embeds the bytes (up to `files.maxInlineSize`).

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor();
await engine.importMarkdown('First\n\nSecond');
engine.insert('paragraph', { text: '' }); // an empty block...
await engine.commit();

expect(engine.children).toHaveLength(3);
expect(engine.serialize('markdown')).toBe('First\n\nSecond'); // ...has no markdown

// JSON keeps it.
expect(engine.serialize('json').blocks).toHaveLength(3);
```

### HTML export

There is no `serialize('html')` for a whole document. The HTML Nabu writes is the `text/html` of the clipboard, made when the user copies. To produce HTML from stored content (for a read-only page, an email, a feed), render the JSON export yourself, with `deltaToHtml` for the text: see the recipe [A read-only viewer](../recipes/read-only-viewer.md). The same function also gives you the inline escaping and link rules described below.

## Sanitization

What comes from outside is never trusted, and the same checks apply to every entry point: a paste, a drop, `importMarkdown`, `importJSON` and `importFragment`.

- **Links.** Only `http:`, `https:`, `mailto:`, `tel:`, relative URLs and `#fragments` are kept as links. `javascript:`, `data:`, `vbscript:`, `file:` and their disguises (mixed case, embedded whitespace or control characters, HTML entities such as `&#106;avascript:`, percent-encoding) are refused: the **text stays, the link goes**.
- **Media.** The source of an image, a video or a file may be `http:`, `https:`, relative, `blob:`, `nabu-asset:`, or a `data:` URL of an image or video. An unsafe `ref` is emptied.
- **HTML.** The HTML interpreter is a whitelist reader, not a filter: it builds blocks from the elements it knows and ignores the rest. `<script>`, `<style>`, `<iframe>`, `<object>`, event attributes and the like contribute nothing, not even their text, and no pasted markup is ever put in the page as HTML.
- **Output.** The HTML the editor writes escapes text and attributes, and writes a link only if its URL passes the same check.

```js test
import { createFullEditor, HtmlPasteExtension, deltaToHtml, sanitizeUrl } from '@aionbuilders/nabu';

const engine = createFullEditor();
const [html] = HtmlPasteExtension.pasteInterpreters;

const fragment = html.interpret(
  '<h2>Title</h2><p>A <strong>bold</strong> <a href="javascript:alert(1)">bad</a> and <a href="https://example.dev">good</a> link.<script>alert(1)</script></p>',
  engine
);
await engine.importFragment(fragment);

// The unsafe link keeps its text and loses its href; the script is gone entirely.
expect(engine.serialize('markdown')).toBe('## Title\n\nA **bold** bad and [good](https://example.dev) link.');

// The same rules in a JSON import.
await engine.importJSON({
  version: '1',
  blocks: [{ type: 'paragraph', content: [{ text: 'bad', link: 'javascript:alert(1)' }, { text: ' and ' }, { text: 'good', link: 'https://example.dev' }] }]
});
expect(engine.serialize('markdown')).toBe('bad and [good](https://example.dev)');

// The helpers are public: sanitizeUrl returns the URL, or null.
expect(sanitizeUrl('https://example.dev')).toBe('https://example.dev');
expect(sanitizeUrl('/relative/path')).toBe('/relative/path');
expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
expect(sanitizeUrl('data:text/html,x')).toBeNull();
expect(sanitizeUrl('data:image/png;base64,AAAA', { kind: 'media' })).not.toBeNull();

// deltaToHtml escapes the text and drops an unsafe href.
expect(deltaToHtml([{ insert: '<b>', attributes: { bold: true } }])).toBe('<strong>&lt;b&gt;</strong>');
expect(deltaToHtml([{ insert: 'x', attributes: { link: 'javascript:1' } }])).toBe('x');
```

## Gaps

- No `serialize('html')` for a whole document (the HTML export is the clipboard's).
- No option to turn the markdown reading of plain text off while keeping `MarkdownPasteExtension` (for `importMarkdown`): leave the extension out of the preset and plain text is pasted as text, but `importMarkdown` then needs a reader (it warns and does nothing without a `text/plain` interpreter).
- `handleCopy`, `handleCut` and `handlePaste` are methods of the engine that `NabuEditor` calls with the browser's events. They are not a supported way to copy or paste from code: use `importFragment`, `insert` or the commands for that.
- Tables are not a block yet: a pasted table keeps its text as paragraphs.
