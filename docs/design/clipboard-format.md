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

- `assets` (optional, added by P-51, same `version: 1`): `{ [assetId]: { mime, name, size, data } }`, the bytes (`data`, base64) of the
  `nabu-asset:<assetId>` refs used by `blocks` (a media block's `props.ref`). Since ADR 014 `assetId` is the content hash, `sha256-<64 hex>`
  (the ref is `nabu-asset:sha256-<hex>`); the beta used a `<uuid>` and such keys / refs are still read. Older readers ignore the unknown field. Absent when the
  fragment has no such media, or when their total size exceeds `files.maxInlineSize` (then `nabu.warn`, and the blocks keep only the ref).

## Media stored in the document (P-51)

A media block whose ref is `nabu-asset:sha256-<hex>` points at a file held by the asset store of the document it was copied from (ADR 014; the
document itself only has the ref and an `assetIndex` entry). The fragment therefore carries the bytes, and the receiving editor makes the ref
valid (`Files#adoptAssets`, applied by `insertFragment` / `importFragment`). The ref is the hash, so it never changes: the paste is
synchronous and the storage happens in the background (`Files#whenIdle`):

| In the target document | Result |
|---|---|
| the document already indexes this hash (same document, or pasted before) | ref reused, nothing duplicated |
| the fragment carries the bytes, no `files.onBeforePersist` | the bytes are hashed; if the hash is NOT the one in the ref, the file is treated as missing and `nabu.warn` says so (integrity check). Otherwise written to the local store (skipped when it already has them) and indexed in `assetIndex`; neither is an undo step |
| a beta ref / key (`nabu-asset:<uuid>`) with its bytes | re-created through `Files#persist`: the block is `pending` with a local preview, then gets its `sha256` ref (silent commit) |
| the fragment carries the bytes, `files.onBeforePersist` set | `Files#persist(new File(...))`: the host uploads it and returns its ref. The block is created at once with `status: 'pending'` and a local preview (`nabu-pending:<uuid>` transient ref, resolved by `Files#resolve` to an object URL), then gets the final ref / `status: 'ready'` (`'error'` if the upload fails) in a silent commit (`Nabu#commit({ origin: 'nabu:silent:files' })`, excluded from the UndoManager): Ctrl+Z / redo see the paste as ONE step. Pasting the same asset again meanwhile reuses the same upload |
| no bytes (older copy, over the size limit, hand-made fragment, corrupt `data`, hash mismatch) | unless the document's index or the local store already has the file, the block is flagged `status: 'missing'` (a moment after the paste), ref unchanged. Media components render a "Missing file" state (`[data-nabu-missing]`); a custom component should handle `block.status === 'missing'`. Never an exception |

Hosted refs (`http(s):`, `blob:`, whatever a host returns) are not assets: they are not embedded and paste unchanged.

`text/html` and `text/plain` never contain a `nabu-asset:` ref (`Files#externalize`): in HTML an image / video of at most 1 MB whose type
`sanitizeUrl(kind: 'media')` accepts becomes a `data:` URL; anything else (larger, other file types) gets an empty source, which the block
serializers render as a label (alt text / file name), never a broken `src`. In markdown the alt text / name only.

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
