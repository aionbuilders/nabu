# The `application/x-nabu+json` clipboard format

Status: implemented (P-52). Complements `copy-paste.md` (§3.3 sketches the format; this document is the reference).

## Shape

```json
{
  "version": 1,
  "blocks": [
    { "type": "paragraph", "partial": "start", "delta": [{ "insert": "ello " }] },
    { "type": "toggle", "partial": false, "props": { "collapsed": false },
      "delta": [{ "insert": "Header" }],
      "children": [{ "type": "heading", "partial": false, "props": { "level": 2 }, "delta": [{ "insert": "Body" }] }] }
  ]
}
```

- `version` (number): the format version, currently `1` (`CLIPBOARD_FORMAT_VERSION`, exported from `utils/extensions.js`). Written
  by `Nabu#handleCopy` / `handleCut`.
- `blocks` (`PasteBlock[]`): `type`, `partial` (`"start" | "end" | "both" | false`), optional `props`, `delta` (Loro rich-text delta),
  `children` (nested blocks of a container / hybrid block).

## Reading rules (the Nabu paste interpreter, `paste/nabu.paste.js`)

| Fragment | Result |
|---|---|
| `version: 1` (or the string `"1"`) | read |
| no `version` | read as version 1 (the format shipped without one) |
| any other value (`99`, `2`, `0`, `"x"`, `true`…) | **declined**: the interpreter returns `null` and calls `nabu.warn`; the paste falls back to the next interpreter of the same clipboard (`text/html`, then `text/plain`), so a future format is never mis-parsed |
| invalid JSON, no `blocks` | declined (`null`) |

Changing the format in a way an old reader would mis-read means bumping `CLIPBOARD_FORMAT_VERSION`; additive changes (new optional
fields, new block types) do not.

## Unknown block types

A fragment (clipboard, `insertFragment`, `importFragment`, `importJSON`) may name a block type the receiving editor does not have
registered (copy from a full editor into a minimal one, an extension that is not loaded). Nothing is dropped
(`degradeUnknownBlocks`, applied by `Nabu#insertFragment` / `importFragment`, and by `insertPasteBlock` / `createPasteBlock` for
direct callers):

- the block becomes the editor's default text block (`nabu.defaultBlockType`, the paragraph) with its text (`delta`) kept; its
  `props` are dropped (they belong to the unknown type); `partial` is kept, so a cut edge still merges as text;
- its `children` are kept as normal blocks RIGHT AFTER it, at the same level (the default block has no body), each of them degraded
  recursively when needed;
- the children of a *known* container are degraded in place (an unknown block in a toggle body stays in that body);
- `nabu.warn` lists the degraded types.

Known types registered in the receiving editor keep their full fidelity.
