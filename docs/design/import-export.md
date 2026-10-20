# Import / export: JSON and markdown

Status: implemented (lot 5e). Reference for `nabu.serialize('json' | 'markdown')`, `nabu.importJSON()` and `nabu.importMarkdown()`
(the markdown paste interpreter reads the same syntax). The clipboard format (`application/x-nabu+json`) is a different, per-selection
format: see `clipboard-format.md`.

Fidelity is checked by `tests/unit/roundtrip-structure.test.js` (kitchen-sink document, trees compared on the MODEL: every key stored on
the Loro nodes) and `tests/e2e/import-export.spec.ts` (same, in the browser, into a fresh editor).

Zone / variables / Context are out of scope (parked).

## 1. JSON

`serialize('json')` returns a plain object (JSON-safe); `importJSON(doc | string)` replaces the document with it.

```json
{
  "version": "1",
  "blocks": [
    { "id": "12@3", "type": "heading", "props": { "level": 2 }, "content": [{ "text": "Hello " }, { "text": "world", "bold": true }] },
    { "id": "13@3", "type": "toggle", "props": { "collapsed": true }, "content": [{ "text": "Header" }],
      "children": [{ "id": "14@3", "type": "code", "props": { "language": "js" }, "content": "let a = 1;" }] },
    { "id": "15@3", "type": "list", "props": { "listType": "ordered", "start": 3 }, "children": [
      { "id": "16@3", "type": "list-item", "content": [{ "text": "item" }], "children": [
        { "id": "17@3", "type": "list", "props": { "listType": "todo" }, "children": [
          { "id": "18@3", "type": "list-item", "props": { "checked": true }, "content": [{ "text": "done" }] } ] } ] } ] }
  ],
  "assets": { "3f2a...": { "mime": "image/png", "name": "p.png", "size": 4, "data": "<base64>" } }
}
```

- `version`: a string, currently `"1"` (`JSON_FORMAT_VERSION`, `utils/extensions.js`).
  `importJSON` reads version `"1"`, the number `1` and a missing version (as `"1"`). **Any other version is refused**: `nabu.warn` and the
  document is left untouched (same policy as the clipboard format: never mis-parse something newer).
- `blocks`: a tree. A block is `{ id, type, props?, content?, children? }`; `id` is informative (`importJSON` creates new ids).
  - `content`: the text, as Slate-like runs `{ text, ...marks }` with the marks `bold`, `italic`, `underline`, `strikethrough`, `code`
    (booleans) and `link` (the href). The **code** block is the one exception: its `content` is the plain code string (`importJSON`
    reads a string or runs, for every block type).
  - `props`: the block's own state, per type (table below). A prop that has its default value may be absent.
  - `children`: nested blocks (items of a list, sublists of an item, body of a toggle).
- `assets` (optional): `{ [assetId]: { mime, name, size, data } }`, the bytes (base64) of the `nabu-asset:<assetId>` media of the
  document, exactly the map of the clipboard format (`Files#embedAssets`); `assetId` is the content hash (`sha256-<hex>`, ADR 014), verified on
  import (a mismatch is treated as missing, with `nabu.warn`); beta `<uuid>` keys are still accepted. The bytes come from the asset store
  (files of at most `maxInlineSize`, read when the blocks load). Left out (with `nabu.warn`) when their total size exceeds
  `files.maxInlineSize`. `importJSON` re-creates them (`Files#adoptAssets`: reused when already there, sent through
  `onBeforePersist` when the host configured one); a `nabu-asset:` media whose bytes are absent is imported with `status: 'missing'`.

| type | `props` | `content` | `children` |
|---|---|---|---|
| `paragraph`, `blockquote`, `dialogue` | none | runs | none |
| `heading` | `level` 1-6 | runs | none |
| `callout` | `variant`: `note` `tip` `important` `warning` `caution` | runs | none |
| `code` | `language` (string or `null`) | string | none |
| `divider` | none | none | none |
| `toggle` | `collapsed` (boolean) | runs (the header) | the body blocks |
| `list` | `listType`: `bullet` `ordered` `todo`; `start` (ordered, only when not 1) | none | `list-item`s |
| `list-item` | `checked` (only in a to-do list) | runs | sublists (zero or several, of different types: P-28) |
| `image`, `video`, `file` | `ref`, `alt`, `name`, `status` (only when not `ready`) | none | none |

Older exports wrote the `checked` of a to-do item next to `type` (not in `props`); `importJSON` still reads it (any top-level key
other than `id` / `type` / `props` / `content` / `children` is read as a prop).

**Unknown block types** degrade exactly like a clipboard paste (`degradeUnknownBlocks`): the block becomes the default text block with
its text, its children follow it as ordinary blocks (recursively), nothing is dropped.

**Media status.** `status` is `ready` (omitted), `error` (upload failed), `missing` (bytes not available) or `pending` (bytes still
being stored / uploaded, with a transient `nabu-pending:` ref or none). A `pending` block is **never exported as if it were final**: it
is exported as `status: "missing"` with an empty `ref` (its `alt` / `name` label is kept), so the import shows the "Missing file" state
instead of a block stuck pending forever. Markdown sees the same props (a block with no source exports as its label).

**Safety.** `importJSON` goes through the same `sanitizePasteBlocks` as every paste: an unsafe link href (`javascript:`…) is dropped
(text kept), an unsafe media `ref` is emptied.

### JSON fidelity

Exact for every block type listed above: type, props, runs (text + all marks + link), nesting, order. The only loss is the one stated
for `pending` media. The block `id`s change.

## 2. Markdown

`serialize('markdown')` joins the root blocks with a blank line. `importMarkdown(md)` (CommonMark paragraph joining) and a markdown paste
(one line = one block) read it back with `markdown.paste.js`: a recursive loop where each block class declares its own `markdownRules`
/ `fromMarkdown` (`helpers.parseBlocks` parses the body of a container as a document of its own). Inline syntax: `paste/markdown-inline.js`
and `behaviors/text/markdown-syntax.js` (escapes shared by the exporter, the parser and the typing shortcuts). Markdown text is
idempotent (`serialize -> import -> serialize` gives the same string); this section is about the TREE.

| block | markdown | fidelity |
|---|---|---|
| paragraph | inline markdown; a line break is `\` + newline | **exact**: text, bold / italic / strikethrough / underline (`<u>`) / code / links, escapes (`\*`, `\#`, `\<details>`…). Lossy: whitespace at the edge of a mark moves outside it (`**a **` -> `**a** `); a code span takes no other mark; an **empty paragraph is dropped** |
| heading | `#`..`######` + space + text | **exact** (level 1-6). An empty heading is dropped |
| blockquote | `> text` | **exact** for one text block. An empty quote is dropped; a multi-paragraph quote read from markdown is several quotes |
| callout | `> [!NOTE]` / `TIP` / `IMPORTANT` / `WARNING` / `CAUTION`, then `> ` lines | **exact** (variant, line breaks, marks) |
| code | fenced; the fence is longer than any backtick run in the code | **exact** (content verbatim, blank lines, backticks, a code that holds a fence). Lossy: a language with whitespace or backticks keeps its first word only |
| divider | `---` | **exact** |
| dialogue | `-- text` | **exact** (the displayed dash is a CSS option, never exported). An empty line is dropped |
| toggle | `<details>` / `<details open>` + `<summary>` + body + `</details>` (below) | **exact**: `collapsed`, header marks, body blocks, nesting (also a toggle in a toggle, lists in the body) |
| list / list-item | `-` `*` `1.` `1)` `- [ ]` `- [x]` (below) | **exact**: type, `start`, `checked`, nesting, several sublists of one item (P-28), an empty item. A fenced code in an item is item *text* (below) |
| image | `![alt](ref)` | **exact**: `ref`, `alt` (escaped; a ref with spaces or parentheses is written `<…>`). Lossy: `name`, `status` |
| video | `[alt or name or video](ref)` | **lossy**: comes back as a *paragraph with a link* (type, `name` / `alt` distinction and `status` are lost) |
| file | `[name or file](ref)` | **lossy**: a paragraph with a link, like the video |

Other markdown limits: a `nabu-asset:<id>` ref is exported as is (the bytes are only exported by JSON): it is meaningful in the same
document or a peer; elsewhere it imports as `missing`. A pending media exports as its label (no source). Everything markdown cannot
express (empty blocks, exact media types, statuses) is what JSON is for.

### The `<details>` exception (toggle)

Nabu exports a toggle as

```
<details>                              (or `<details open>` when expanded)
<summary>Header, **inline** markdown</summary>

Body, block markdown

</details>
```

The summary is escaped like any text (a `<` that would read as `<details>` / `<summary>` / `</details>` is written `\<`), and the body
is the markdown of its blocks (an empty body is just the blank line). Import and paste recognise **only this construct**: an opening line
that is exactly `<details>` or `<details open>` (lower case, nothing else on the line; the older `<details><summary>…` on one line is
read too), then `<summary>…</summary>` (on that line or the next; the text may span lines, with no blank line), the body, and a closing
line that is exactly `</details>`. A nested `<details>` is matched with its own closing line (fenced code is skipped). The result is a
Toggle block with `collapsed = !open`, the summary parsed as inline markdown and the body parsed with `helpers.parseBlocks`.

**Everything else stays literal text** (decision P-59): any other tag, any attribute (`<details class=…>`, `<details open="">`,
`onclick`…), another case, no `<summary>`, no closing line, text after `</summary>`. Nothing of the markup is passed through to the
model (a toggle has no prop but `collapsed`); no HTML is ever created, and the inline parser keeps `<script>` / `<img onerror>` as text.
A `<details>` can interrupt a paragraph (CommonMark). The rule lives in `blocks/toggle/markdown.js`.

### Lists: markers

CommonMark boundaries (P-30): **a change of marker at the same level starts a new list**, the marker being the bullet character
(`-` `*` `+`) or the ordered delimiter (`.` `)`), or a switch between bulleted and numbered. `- a\n1. b` is two lists; `- [ ] a\n* b`
is a to-do list then a bullet list. (Adjacent lists of the SAME type are merged back by the List normalizer when imported into a
document, so `- a\n* b` is still one bullet list in the model.)

The exporter relies on it: **adjacent lists at the same level alternate their marker** so that they come back as written. Within a run
of adjacent lists of the same family, the bullet character goes `-`, `*`, `-`…, the ordered delimiter `.`, `)`, `.`… A to-do list
directly followed by a bullet list is `- [ ] a` then `* b`. A block that is not a list, or a list of the other family, ends the run.
This also holds for the sublists of one item, in the clipboard `text/plain`, and inside a toggle body (the static serializers get the
siblings before a block through `recurseAll` / `before`).

Nested content (continuation lines, sublists) is indented by the **width of the marker** (`- ` = 2, `3. ` = 3, `10. ` = 4), so any
CommonMark reader nests it under the item; a to-do counts the bullet only.

### Lists: a fenced code in an item

An item holds text and sublists, not blocks, so a fenced code in an item is **text of the item** (line breaks included). Decision: it is
exported so that it round-trips as item text *exactly* and still renders as code elsewhere:

```
- install
  ```sh
  npm i nabu
  ```
- done
```

The importer keeps the fence verbatim as part of the item text (blank lines, markdown and TABs inside are not interpreted); the exporter
writes a well-formed fence (an opener at the start of a line of the text, not the first, and its closer) back as an indented fence.
Text a fence cannot carry exactly (unclosed fence, fence on the first line, blank line next to it) is exported as ordinary escaped text,
which also round-trips. Lossy: marks inside the fence are not exported (the fence is verbatim text).
