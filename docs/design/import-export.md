# Import / export: JSON and markdown

Status: implemented (lot 5e). Reference for `nabu.serialize('json' | 'markdown')`, `nabu.importJSON()` and `nabu.importMarkdown()`
(the markdown paste interpreter reads the same syntax). The clipboard format (`application/x-nabu+json`) is a different, per-selection
format: see `clipboard-format.md`.

Fidelity is checked by `tests/unit/roundtrip-structure.test.js` (kitchen-sink document, trees compared on the MODEL: every key stored on
the Loro nodes) and `tests/e2e/import-export.spec.ts` (same, in the browser, into a fresh editor).

Zone / variables / Context are out of scope (parked). Regions (ADR 016, containers since ADR 018) are covered below (JSON row, markdown row and the data-comment exception).

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
| `region` (container) | `regionType`, `fields` (the declared fields, never the title; richtext as Loro deltas, an unknown field as it is stored) | the title (runs) | the body: any blocks and sub-regions |

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
| region (container) | data comment + title heading + body, closing comment only when needed (below) | **exact**: type + fields (the comment), title (the heading, inline marks), body and nesting (deduced from the levels, or from the closing comment). Lossy: richtext fields take the paragraph limits (whitespace at the edge of a mark moves outside it); an unknown region type falls back to the default top-level type |

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

### The region exception (data comment + title heading + inferred end)

A region (ADR 018) is a container: a title, a body (blocks and sub-regions). Nabu exports it as:

```
<!-- region:chapter {"status":"draft","synopsis":"A *short* summary"} -->
## La *forêt*

Body, as block markdown (sub-regions included).
```

- Line 1, the **data comment**, is the source of truth for the type and the fields: `<!-- region:<type> <json> -->`. The type is the declared
  region type id (characters outside `[A-Za-z0-9_-]` are percent-encoded). The JSON is `fields` (the title is NOT among them): minimal (no
  whitespace), keys sorted at every level, with `<`, `>`, `&` and the line separators written as `\uXXXX` escapes, so a field can never contain
  `-->` or markup. **Richtext** fields (declared `richtext`) are written as inline markdown strings (a Loro delta would be unreadable) and parsed
  back with the inline parser: marks and links survive, with the same limits as a paragraph (whitespace at the edge of a mark moves outside it).
  The other kinds (text, number, boolean, enum, date, unknown fields) are plain JSON.
- Line 2, the **title**, is an ATX heading of level `clamp(region level, 1, 6)` whose text is the TITLE as inline markdown (marks kept). It is the real
  title, not an echo. An **empty title** is written as the comment alone (the body follows after a blank line); the one exception is a body that
  opens with a heading of its own, which would be read as the title: then a bare heading (`##`) stands for the empty title.
- Then the body blocks, separated by blank lines, exactly as at the root.

**End of a region** (nothing is written when it can be deduced). On import a region contains the blocks that follow it until the first of:

1. an explicit **closing comment** `<!-- /region -->` (consumed with the region). It closes the INNERMOST region still open;
2. the next **opening comment of a region of the same or a higher level** (level = the declared level of its type; an undeclared type counts as the
   default type): it closes this region and every sub-region still open. A DEEPER one nests: it starts a sub-region of this one;
3. the end of the enclosing region's body, or of the document.

Comments inside fenced code blocks are code, never constructs (an unclosed fence runs to the end of the text, as the code block does).

**Export writes the closing comment only when needed**: when, after the region (and its closing, if the parent writes one), comes content that is not
the end of the text and not the opening of a region of the same or a higher level. So a document of consecutive sections has no closing comments; text
after a sub-region (back in the parent's body), text after a region at the root, and a deeper region following a shallower one at the root get one.
When a region closes, the sub-regions still open at the end of its body close too (each writes its own comment: `/region` closes one level). Inference
equals the model in every case; the round trips are pinned.

Import and paste recognise **only these constructs**. Decisions:

- **The heading after the comment** is the title only when it is on the line RIGHT AFTER the comment (no blank line); its level is ignored (the type
  decides). Otherwise the title is empty and the following heading is a real heading block of the body. A heading without the comment is a heading;
  regions are never inferred from headings.
- **Unknown region type** (a document from a richer editor): the region takes the declared default type (the lowest level) and keeps its fields;
  the original type id is lost. (JSON import and the internal clipboard keep an unknown type as it is; the registry treats it as an unnumbered leaf.)
- **Invalid values** for a declared field (a wrong type, a value outside an `enum`) are dropped with `nabu.warn`; unknown fields are kept.
- **Any other HTML comment**, a comment with invalid JSON, a JSON that is not an object, a different shape (extra text on the line, missing spaces)
  stay literal text. A **stray** `<!-- /region -->` (nothing to close) stays literal text too (it is not dropped: nothing is lost by importing).
- A comment on the line right after a paragraph line (no blank line) interrupts the paragraph. A region inside a `<details>` body is read, then
  hoisted after the toggle (root-only rule, regions live at the root or in a region body).
- Older exports (ADR 016) wrote the heading as the computed label echo and the title in the comment: the heading is now read as the title.

Idempotency: `serialize('markdown') -> importMarkdown -> serialize('markdown')` is a fixed point for documents with regions (pinned by
`tests/unit/regions-io.test.js` and `tests/unit/roundtrip-structure.test.js`). The rules live in `blocks/region/format.js` (comment, scan of the extent),
`serialize.js` (text forms, closing rule) and `region.svelte.js` (the block statics). The generic engine only hands every markdown serializer the
siblings that follow (`after`, like `before`); the markdown block parser already lets a rule choose its own extent (as the toggle does).

### HTML

The clipboard `text/html` writes a region as `<section data-nabu-region="chapter" data-nabu-fields='{…}'><hN>title</hN>…body…</section>` (`N` =
`clamp(level, 1, 6)`; the same minimal JSON and richtext form, escaped as an attribute; nested regions are nested sections). HTML paste turns ONLY a
`<section>` carrying a non-empty `data-nabu-region` (at most 200 characters) into a region: the type id is read as text (an unknown one falls back to the
default type), `data-nabu-fields` is parsed as JSON (invalid, oversized or non-object data gives a region without fields; richtext links are
sanitized), the **first element child**, if it is a heading `h1`-`h6`, is the title (inline content, marks kept; its level is ignored), and the other
children are the body, read like any HTML (sub-sections nest). Nothing else of the element is passed through. A plain `<section>` is a transparent
wrapper, a plain `<h2>` is a heading, and `data-nabu-region` on any other element means nothing.

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
