# ADR 016: Regions, structuring a continuous text with markers

**Status:** Accepted (2026-10-22, validated by the owner), **data model superseded by ADR 018** (2026-10-23: regions are containers in Loro, seams are the interface). Types, fields, numbering, registry, commands and protection remain valid.
**Date:** 2026-10-22
**Original:** [French](fr/016-regions.md)
**Supersedes:** the Zone block (removed from Nabu on 2026-10-22, nested container)
**Related:** `docs/design/variables.md` (to be reworked on top of Regions), the "Zones" exploration canvas (boards 5–7: Nabu only), ADR 014 (history), audit 2026-10 roadmap

---

## 1. Context

Orduin (a long-form writing application) needs to split **a single continuous document** into parts, chapters and scenes, with metadata per division, navigation, views (outline, corkboard, timeline) and, eventually, lazy rendering of very long texts.

The former Zone modeled each division as a **box** (nested container). Boundaries were walls there: cutting a chapter, merging two scenes or moving a paragraph from one chapter to another required moving blocks between containers, and the nested tree lends itself poorly to lazy rendering.

Owner decisions (2026-10-22): a **marker model**; the **generic primitives** in Nabu (open source), the **"Zone" product** and all its interface in Orduin (private); Zone removed from Nabu without migration (no users).

**Vocabulary**: in Nabu, the generic building block is called a **region** (`RegionsExtension`). "Zone" refers to Orduin's product built on top of it.

## 2. Decision

A region is a **portion of a continuous text**, opened by a **marker** and closed by the next marker of the same or a higher level (or the end of the document). The document stays **flat** at the root level; the structure is a layer placed on top of it.

## 3. Design

### 3.1 The marker

- A `region` block **without text** (a void block, like the divider: the cursor skips it, and it is rendered as a "seam").
- Loro data of the marker: `regionType` (identifier of a declared type) and `fields` (Loro map of the fields declared by that type; `title` is a base field of every region).
- **Root level only.** A marker makes no sense inside a list or a toggle; the normalizer lifts it to the root (same mechanism as the other structure rules). *(containers case: see open questions)*
- The content located **before the first marker** is a preamble outside any region.

### 3.2 Region types (declared by the integrator)

```js
RegionsExtension({
  types: {
    part:    { level: 1, label: 'Part {index}' },
    chapter: { level: 2, label: 'Chapter {index}', numbering: 'document' },
    scene:   { level: 3, numbering: 'parent', fields: { pov: 'text', place: 'text' } },
  },
})
```

- `level`: depth (1 = highest). The extent of a region is deduced from the levels.
- `label`: display template (`{index}`, `{path}` → "2.3", `{title}`).
- `numbering`: `'parent'` (restarts at 1 in each parent region, default), `'document'` (continues over the whole document), `'none'`.
- `fields`: typed fields (`text`, `richtext` = LoroText, `number`, `boolean`, `enum`, `date`): Nabu stores them and makes them reactive; their meaning (synopsis, status, goal…) belongs to the integrator.
- Without configuration: a generic `section` type (levels 1–3, labels "1.", "1.1"…).

### 3.3 Reactive registry `nabu.regions`

- `list`: the regions in document order, each with `type`, `level`, `fields`, computed `index` / `path` / `label`, `parent`, `children`, the block range (`first`, `last`), `wordCount` (sum over the blocks of the range, computed without rendering).
- `tree`: the hierarchy (parts › chapters › scenes).
- `at(position | block)`: the deepest region containing a position (breadcrumb, inspector).
- `of(marker)`, `next(region)`, `prev(region)`, `parentOf(region)`.
- Everything is `$derived`: the integrator's views subscribe to it with no synchronization code.

### 3.4 Gestures (actions) and keyboard

| Action | Effect in the marker model |
|---|---|
| `region:split` (cut here) | cuts the block at the cursor if needed, inserts a marker of the same type as the current region; the cursor moves to the start of the new region |
| `region:insert` | inserts a marker (given type) after the current region or at the cursor |
| `region:merge` | removes the marker: the content joins the previous region |
| `region:move` (`up`/`down`) | moves the region **with its sub-regions** (its block range) before / after its neighbor of the same level |
| `region:promote` / `region:demote` | changes the level (the type); in a marker model, this is all it takes to re-nest |
| `region:next` / `region:prev` / `region:parent` | navigation: cursor at the start of the targeted region |

- Each structural action is **one undo step** (mechanism already in place) and Ctrl+Z restores the selection (ADR 015).
- Default shortcuts are configurable (see open questions). **"Acting on the region as an object"** (Escape from the text to the region) depends on the **block selection primitive**, a separate workstream.

### 3.5 Default rendering (board 5)

- A discreet seam: computed label ("1.1 The ferryman") + hairline; neutral style, CSS variables (`--nb-region-*`).
- Accessibility: the marker is announced as a **heading of level `level`** (`role="heading"`, `aria-level`), so that screen readers can navigate by division.
- No field editing interface in Nabu: that is the integrator's role (Orduin's inspector). Nabu only exposes `region.fields` and the actions.

### 3.6 Serialization, clipboard, paste

- **JSON**: `{ type: 'region', props: { regionType, fields } }`, an exact round trip.
- **Internal clipboard**: markers travel as blocks; pasted elsewhere, they regain their role.
- **Markdown**: data comment + readable heading (decided, question 4; see the lot 3 notes).
- Pasting a marker into a container (list, toggle): rule of §3.1.

### 3.7 Collaboration and history

- Markers and fields live in Loro: synchronized and versioned like the text.
- Two authors cutting at the same place produce two adjacent markers (an empty, visible region), so there is no structural conflict.

## 4. Out of scope (following workstreams, each with its own ADR)

- **Block selection** (acting on a region or a block as an object).
- **Variables** (`{{index}}`, `{{title}}`, scope resolution = `nabu.regions.at(block)`).
- **Lazy rendering** per region.
- The whole product interface (Orduin).

## 5. Breakdown

1. **Lot 1**: marker block, types, normalizer (root), reactive registry, numbering, default rendering.
2. **Lot 2**: actions and keyboard (§3.4).
3. **Lot 3**: JSON / markdown / HTML serialization, clipboard, paste.

## 6. Open questions (to be settled before or during the relevant lot)

1. ~~**Backspace at the start of the first line of a region**~~: **decided (2026-10-22, owner)**: **protect**. A Backspace at the very start of the first text block of a region never merges the text across the marker; the merge is a **hold** of the key (ADR 017 `hold`, 700 ms) on the seam, command `region:merge-previous`; symmetric for Delete (`region:merge-next`, the NEXT marker disappears). First region without a preamble: nothing (no target, no hold).
2. ~~**"Cut here" shortcut**~~: **decided**: `Mod+Enter` (`region:split`, no confirmation), which coexists with `todo:toggle` (the latter, limited to list items, keeps `Mod+Enter` in a task list).
3. ~~Marker pasted into a toggle~~: **decided**: lifted right after the toggle (as for lists; the structure is never lost).
4. ~~Markdown~~: **decided**: an HTML comment carrying the data (`<!-- region:chapter {"title":"The forest"} -->`), read back exactly by Nabu (targeted exception, like `<details>`), **followed by a readable heading** (`## Chapter 2 — The forest`) for humans and other tools.
5. ~~**Preamble**~~: **decided**: allowed as is (content before the first marker = outside any region).

---

## 7. Implementation notes: lot 1 (2026-10-22)

Code: `src/lib/blocks/region/` (`types.js`, `region.svelte.js`, `Region.svelte`, `regions.svelte.js`, `normalize.js`, `insert.js`, `region.extension.js`). Tests: `tests/unit/regions.test.js`, `tests/e2e/regions.spec.ts`.

- **Default types**: with no options the extension declares THREE types, `section-1`, `section-2`, `section-3` (levels 1–3, labels `{path}. {title}`, `{path} {title}`, `{path} {title}` → "1.", "1.1 The ferryman"). The level IS the type, as §3.4 already says ("changes the level (the type)"): `region:promote` / `demote` will just swap `regionType`, no extra stored `level` field to keep in sync. Passing `types` REPLACES the defaults (no merge).
- **Factory**: `RegionsExtension(options)` throws on an invalid declaration (level not an integer ≥ 1, unknown numbering or field kind, an `enum` without `values`). The configuration is carried by a block subclass (`static config`, like the dialogue dash); `Regions.get(nabu)` reads it back from the registry. `createRegionsExtension` is an alias; there is no separate default instance because `RegionsExtension()` already is the default (and `FullPreset` includes it, consistently with "all built-in blocks").
- **Registry exposure**: `Regions.get(nabu)` (stored in `nabu.systems`, like `Todos`) plus a `nabu.regions` getter that the extension installs from its `onInit` hook: the core never names it. Not installed without the extension.
- **Levels and extent**: as §2. A marker whose type is NOT declared (a document coming from a richer editor) is a leaf at the deepest declared level, unnumbered, labelled by its title. Numbering: `parent` counts per (parent region, type), `document` per type over the whole document, `none` gives no index; `path` = the indexes of the numbered ancestors then its own (`"2.1"`; array in `path`, text in `pathString`).
- **Range**: `first` is the marker, `last` the last ROOT block of the range; `blocks` = everything after the marker up to `last`, sub-regions' markers and content included; `ownBlocks` stops at the first sub-region. `wordCount` / `ownWordCount` follow the same split (markers weigh 0). `next` / `prev` walk document order (a sub-region comes right after its parent).
- **Fields**: `title` plus the declared fields, read through `marker.fields` (reactive): a declared field that is unset or holds a value of the wrong type reads `null` (the stored value is untouched); `richtext` reads as its plain string, the LoroText is `marker.richtext(name)`; unknown fields are returned and exported as-is. `setField` refuses an invalid value for a declared field (returns false, `nabu.warn`); `null` clears. Dates: ISO 8601 `YYYY-MM-DD`, with an optional time; a `Date` is stored as its ISO string.
- **Root-only normalizer** (`normalize.js`, `onBeforeTransaction`, so the move belongs to the transaction (one undo step) of the operation that displaced the marker): a marker with a parent is moved RIGHT AFTER the top-level container holding it; several markers of one container keep their order. A node retyped into a marker while nested is caught too. It runs after the list normalizer (extension order), so a marker in a list item position is first split out of the list by the list rules; what is left (toggle body, callout…) is hoisted by this one. The target is isolated in `hoistTarget()` so that the open question 3 (toggle) can change it in one line (e.g. "convert to a title" would be another branch of the same function).
- **Void block**: modelled on the divider (`positions = 1`, `getDOMPoint` null, `data-nabu-inert`, `contenteditable="false"`); the caret skipping and `openTrailingCaret` are the engine's generic ones. Backspace / Delete next to a marker have NO hook yet: the text merge goes THROUGH the marker (`p(above) ; R ; p(below)` + Backspace → `p(abovebelow) ; R`, one undo step, document valid). This is pinned by e2e, to be replaced by the decision of open question 1 in lot 2.
- **Serialisation (minimal)**: JSON `{ type: 'region', props: { regionType, fields } }` (richtext fields as Loro deltas), same shape on the internal clipboard format; markdown / HTML are empty for now. `TODO(ADR-016 lot 3)` marks the spots.
- **What lot 2 needs from here**: `insertRegion` and `RegionBlock#setRegionType` (promote / demote), `Region#start` / `end` / `ownEnd` (root indexes, for `region:move` and `region:merge`), `Regions#at()` (current region for `split` / `insert`), `config.defaultType`, the hoisting normalizer already guarding the root-only rule, and the Backspace / Delete decision.


---

## 8. Implementation notes: lot 2 (2026-10-22)

Code: `src/lib/blocks/region/`, with `commands.js` (the commands), `facts.js` (`commandContext` facts + the merge veto), `actions.js` (the operations), `messages.js` (overridable texts), `Region.svelte` (hold rendering), `insert.js` (`createMarker`, the commit-less building block). One engine change, generic: the `onBeforeMerge` hook (below). Tests: `tests/unit/region-commands.test.js`, `tests/e2e/regions.spec.ts`.

- **Commands** (`region:*`, each also an action: `nabu.exec(id, data)`; `data.region` = a `Region`, its marker block or its marker id, acts on that region instead of the caret's). Default keys: `region:split` `Mod-Enter`, `region:merge-previous` `Backspace` + `Shift-Backspace` (hold), `region:merge-next` `Delete` (hold). No default keys for `insert`, `move` (+ `move-up` / `move-down`, the same with the direction built in, because a key cannot carry `data`), `promote`, `demote`, `next`, `prev`, `parent`: the arrow chords are mostly taken by the OS / browser; integrators bind them with `keymap`. `exec` runs a command directly: the hold is a keyboard concern (ADR 017 §3.4a), the accessible path has none.
- **Facts** (`commandContext`): `region` (deepest, `null` in the preamble), `previousRegion` (document order), `nextRegion` (first marker after the caret block; the first region from the preamble), `inRootTextBlock` (top-level text block without children: not a list item, toggle, callout…), `atStartOfRegion` (collapsed, offset 0, root text block, and NO text block between the marker and here: an image or divider in between does not count), `atEndOfRegion` (collapsed, end of text, and the block a Delete would merge into this one lies in ANOTHER region; this one is not limited to root blocks, so a Delete at the end of the last list item before a marker is protected too).
- **Protection = the `hold` command + a veto**. (1) `region:merge-previous` applies (`when`) only to a plain paragraph (`block.type === nabu.defaultBlockType`) at `atStartOfRegion` with something to merge into (a previous region or a non-empty preamble). A heading, quote, dialogue or code block at the start keeps its own Backspace (convert to a paragraph, as anywhere) and the NEXT Backspace is protected. Held-key repeats are swallowed by the confirmation controller while `when` holds (the word stops at the seam). (2) The engine's text merge (`TextBehavior#handleDeleteContentBackward` / `Forward`) now asks `onBeforeMerge(nabu, survivor, victim)` first; the extension answers `BREAK` when the two blocks are not in the same region (`Regions#at`). This closes every path that does not go through the command: first region of the document (nothing to merge into), a key not bound, a virtual keyboard (keyCode 229, no keydown), a third-party block type. The hook is generic (the engine names no reason; ADR 017 lot 1 principle). The empty block right after a marker is the same case as any block there: it asks for the hold; the veto keeps its Backspace from deleting it and jumping across.
- **Selections** spanning a marker are explicit and keep the engine's `deleteRange` semantics: the text of the range goes AND the marker inside it (a block strictly between the ends is destroyed), the junction merges the head and the tail, one commit = one undo step (pinned by unit and e2e).
- **`region:split`**: `when` = collapsed caret in a ROOT text block (`inRootTextBlock`), so a list item or a toggle title falls through (and `todo:toggle`, scoped to `list-item` and with its own `when`, keeps `Mod-Enter` in to-do items; pinned with real keys). Mid-text or at the end: `block.split({ offset, to: length })` (what Enter does, hooks included: a heading cut at its end gives a paragraph, mid-text both halves are headings), then the marker is created right before the tail, in the SAME synchronous turn, so the engine's structural burst merges the three commits into one undo step. At offset 0: no cut, the marker goes before the block. A block that does not split on Enter (a code block) is excluded from the `when` (Mod-Enter there keeps its own behaviour: the existing code-block e2e caught it). Type = the current region's, else the default (top-level) type. The caret goes to the start of the tail.
- **`region:insert`**: `{ type?, at?: 'after' | 'before', title?, fields? }`. `after` = after the region's WHOLE range (sub-regions included), `before` = before its marker; the preamble counts as a region (`before` = start of the document, `after` = end of the preamble). The caret stays (no paragraph is added: an empty region is allowed).
- **`region:move`**: moves the root blocks `[start, end)` of the region (sub-regions included) with Loro `moveBefore` / `moveAfter`, one commit. The sibling is the neighbour in the parent's `children` (the top level for a root region) and must be of the SAME level; at an edge or next to a sibling of another level nothing moves and nothing is committed. The caret is put back.
- **`region:promote` / `demote`**: `setRegionType` to the first declared type of level -1 / +1; no-op when there is none or the marker's type is not declared. Following regions re-nest by their levels (the model of §3.4: the type is all that has to change).
- **Navigation**: `next` / `prev` / `parent` put the caret at the first text position of the target region (its own content, else its first sub-region) and scroll it into view (`scrollIntoView({ block: 'center' })`); a region without text only scrolls its seam. `prev` has no target from the first region (the preamble is not a region).
- **Undo**: every structural command is one commit / one step; the selection captured before it (ADR 015) comes back on Ctrl+Z, including after a merge (marker restored, caret back at the start of the block); covered by e2e.
- **Hold rendering (default seam)**: `Region.svelte` reads `nabu.pendingCommandOn(block)`; when it is a hold it shows the pending message (`Hold Backspace to merge with “One”`; the controller's `hold` text built from the command label) in a `[data-region-hint]` span, `position: absolute; bottom: 100%` inside the seam's top margin (left-aligned, no bubble / background / border, `--nb-region-warning`, default `#B45309`), and a 1 px warning-tint overlay on the hairline whose `scaleX` is `1 - progress` (it drains). Nothing is in the flow, so the seam does not move (e2e compares the bounding box); it relies on `--nb-region-margin` leaving about one line above the seam (the default does). The engine's default target outline / fill is switched off on a seam. The hint is `aria-hidden` (the live region announces the same text). Nothing remains once the marker is gone. The "Merged with … · Ctrl+Z to undo" confirmation line (board 8b, state 3) is NOT done: it needs a transient element that belongs to no marker.
- **Texts**: `RegionsExtension({ messages })` (`messages.js`): labels of the commands and the hold prompt, English by default.
- **Left for lot 3**: serialization (JSON is done; markdown / HTML), clipboard and paste rules for markers, the open question 3 (marker pasted into a toggle). Not covered by the protection: the first item of a list or the first child of a container at the start of a region keeps its own Backspace (outdent / convert), as it does not merge text through the marker.

---

## 9. Implementation notes: lot 3 (2026-10-22)

Code: `src/lib/blocks/region/format.js` (pure text forms: comment, echo, HTML), `region.svelte.js` (serializers, `toMarkdown` / `toHtml`, `markdownRules` / `fromMarkdown`, `htmlRules` / `fromHTML`). The core is untouched (the guard test stays green): the engine already dispatches `BlockClass.toMarkdown` / `toHtml` / `markdownRules` / `htmlRules`. Tests: `tests/unit/regions-io.test.js`, `tests/unit/roundtrip-structure.test.js` (the kitchen sink holds markers), `tests/e2e/regions-clipboard.spec.ts`. Reference of the forms: `docs/design/import-export.md` ("The region marker exception"), `docs/design/clipboard-format.md`.

- **Markdown**: `<!-- region:<type> <json> -->` then an ATX heading of level `clamp(level, 1, 6)` holding the computed label. The comment is the source of truth; the JSON is the `fields`, minimal, keys sorted, `<` `>` `&` and U+2028/9 as `\uXXXX` (so `-->` can never appear inside). The type id is written as is when it matches `[A-Za-z0-9_-]+`, percent-encoded otherwise (decoded on import).
- **Richtext fields** are inline-markdown strings inside the JSON (`deltaToMarkdown` / the inline parser), in the comment AND in the HTML attribute; the clipboard fragment and JSON keep the Loro delta. Lossy like a paragraph (whitespace at the edge of a mark). Links are sanitized with `sanitizeUrl` whenever a richtext delta is stored (`writeField`), so no path (paste, import, `setField`) can store a `javascript:` link.
- **Import is strict and local**: a rule (priority 20, may interrupt a paragraph) detects the exact line and valid-object JSON; the heading line IMMEDIATELY after is consumed. Everything else keeps its previous meaning (heading, other comment, invalid JSON = literal text).
- **Edited heading policy**: the comment wins, the heading text and level are ignored on import (the next export rewrites it); no warning (the heading is not data). **Unknown type**: falls back to the default (lowest-level) declared type, fields kept (JSON import and the internal clipboard keep an unknown type, which the registry tolerates). Invalid declared-field values: dropped by `create` with `nabu.warn`.
- **Label in static serializers**: the clipboard `toMarkdown(pb)` / `toHtml(pb)` get PasteBlocks, not the document, so the live block writes `echo: { label, level }` (from the registry) next to `props` in the `application/x-nabu+json` serialization. It is ignored on paste. Without it (a hand-made block) the echo is derived from the type (`level` of the declaration, the label template without numbering, else the type id).
- **HTML**: `<hN data-nabu-region data-nabu-fields>`; a high-priority rule (100) with `[data-nabu-region]` (non-empty) beats `h1`-`h6`; hostile or invalid attributes degrade to a marker without fields, never to markup. Type ids and fields are text; nothing from the element is passed through.
- **Root-only paste**: pinned in unit and e2e. Pasting `[p x, marker, p y]` in a toggle body at "body|one" gives: the text before the marker lands in the body, the text after the marker too, and ONLY the marker is hoisted right after the toggle (the content order across the marker is therefore not kept inside a container: the marker cannot be there). In a list item the list normalizer cuts the list around the marker (the rest of the list follows it); in a nested list the marker goes after the top-level list structure; in a callout it is hoisted after the callout.
- **Copying only a marker** (selection reduced to a marker) gives its two markdown lines as `text/plain` and the heading element as `text/html` (it is not a text block, so the "raw selected text" rule does not apply).
- **Left out**: no warning on an edited echo; richtext of UNDECLARED fields (an unknown field holding a text container) is exported as a delta array and comes back as a plain JSON array.


## Note (2026-10-27)
The marker block and the implementation described in the lot 1–3 notes (§7–§9) were replaced by ADR 018 (lots A–E, implemented 2026-10-23 to 2026-10-26): `region` is now a container block. The types, fields, numbering, registry, commands, hold protection and messages carry over; the marker block, the root-only normalizer and the markdown/HTML forms of this ADR do not.
