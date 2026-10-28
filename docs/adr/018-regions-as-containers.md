# ADR 018: Regions as boxes in Loro, seams on screen

**Status:** Accepted (2026-10-23, validated by the owner; the five questions of §6 settled according to the recommendation)
**Date:** 2026-10-23
**Original:** [French](fr/018-regions-as-containers.md)
**Supersedes:** the **data model** of ADR 016 (§2, §3.1, the "marker model" part of §3.4, §3.6 markdown / HTML). The rest of ADR 016 remains valid (types, fields, numbering, registry, commands, protection by hold, messages).
**Related:** ADR 016 (Regions), ADR 017 (commands, keymap, confirmations), `src/lib/blocks/subthread.js` (the Toggle's sub-thread rules), the "Zones" exploration canvas (board 8b).

---

## 1. Context: a misunderstanding about the word "markers"

During the ideation of 2026-10-22, the question "boxes or markers?" was, as I presented it, about the **data model**. The owner answered "markers" thinking of the **interface**: boundaries experienced as seams, in a text that flows. The intent, confirmed on 2026-10-23:

> In the Loro tree, a region is a **container**, a sub-region is a container inside the container. On screen and on the keyboard, it is experienced as **a continuous text with seams**.

ADR 016 was implemented with markers **in the model** (an empty block at the root, a flat document, a computed extent). That model loses things the owner cares about: an explicit **end** (leaving a region, text of the chapter after its scenes), a region that **owns** its content (a node to copy, move, lock, synchronize), metadata and a word count carried by a subtree, lazy rendering per container.

Nothing is published (0.1.0-beta.0 does not contain Regions): we change now, without migration.

## 2. Decision

A region is a **container block** (MegaBlock):

- its **header** is its **title**: a Loro text, edited in place, in the seam (like a Toggle's title);
- its **body** is an ordinary Nabu thread: paragraphs, lists, images… and **sub-regions**;
- its **data**: `regionType` and `fields` (Loro map), as today.

The interface and the keyboard treat boundaries as **seams** (rendering, arrows, Backspace protection, cutting), not as walls. The model itself is a tree.

## 3. Design

### 3.1 The region block

- Type `region`, MegaBlock, text header (inline marks allowed: an italic title is common), body = children.
- The title **is** the header: `region.fields.title` reads it as plain text (registry API compatibility); there is no longer a separately stored `title` field.
- Empty title allowed: the seam then shows the computed label ("Chapter 2") as a placeholder.
- **Where a region lives**: at the root, or in the body of another region. Never in a list, a toggle, a callout: the normalizer lifts it after the topmost container that holds it, **inside its enclosing region** if there is one (same mechanism as today's "root only" rule, `hoistTarget()`).

### 3.2 Levels and nesting

- Types keep their `level` (ADR 016's declaration unchanged). Nesting rule: **a sub-region has a level strictly deeper than its parent region**. A violation (pasting a part into a scene) is corrected by the normalizer: the region moves up to a valid parent, its content with it.
- The level is no longer what **computes** the extent: the tree is. It remains what **validates** the tree and chooses the type on promotion / demotion.
- Unknown type (document coming from elsewhere): accepted anywhere under a region, unnumbered (as today).

### 3.3 Mixed bodies and preamble

- A region's body can mix its own text and sub-regions **in any order** (chapter text, scene 1, transition, scene 2…). *Question 2.*
- At the root, text before, between or after regions is allowed (ADR 016's preamble becomes a special case).
- **End marker**: when content follows a sub-region at the parent's level, the interface must make it legible (a discreet closing seam). Its design is a topic for the design session; the model itself does not need it.

### 3.4 Registry `nabu.regions`

ADR 016's API is kept, computed from the tree instead of the markers:

- `list`, `tree`, `at(block)` (the nearest region ancestor), `of(block)`, `next` / `prev` / `parentOf`, `index` / `path` / `label` (numbering `parent` / `document` / `none` unchanged);
- `blocks` = the subtree; `ownBlocks` = the children that are not regions; `wordCount` / `ownWordCount` accordingly;
- `first` / `last` / `start` / `end` (root indices of the markers) disappear in favor of the region's **node**.

### 3.5 Gestures: what changes

ADR 016's command identifiers remain; their effect becomes structural. Each gesture = one commit = one undo step (ADR 015 unchanged).

| Command | Effect in the box model |
|---|---|
| `region:split` (Mod+Enter) | cuts the block at the cursor if needed; creates a sibling region of the same type **right after** the current region and **moves** the rest of the body (blocks after the cursor) into it |
| `region:insert` | creates a region (given type) before / after the current one, or at the cursor |
| `region:merge-previous` / `-next` (hold ⌫ / Delete, 700 ms) | the region's body joins the end of the previous one (resp. the next body joins this one), the emptied container disappears, its title too |
| `region:move` (+ `-up` / `-down`) | moves the node before / after its sibling of the same level (no more range computation) |
| `region:promote` / `demote` | **structural**, like indenting a list: demoting = becoming the last sub-region of the previous sibling; promoting = leaving right after the parent. *Question 4* |
| `region:unwrap` (new) | dissolves the region: the title becomes a paragraph, the body stays in place (the Toggle's `dissolveToParagraph` rule) |
| `region:next` / `prev` / `parent` | unchanged |

Keymap decided in session (2026-10-23, owner), detailed in §3.9:

- **Enter in the title** → start of the body (first paragraph created if missing). The title is never split.
- **Enter on an empty paragraph** remains an ordinary Enter: an empty paragraph is an author's choice (breathing room, silence), **not** an exit signal (a deliberate difference from the Toggle and lists).
- **Exiting** = explicit command `region:exit`, **Mod+Shift+Enter**: a paragraph is created right after the region, at the parent's level; repeated, it goes up one level (scene → chapter → part → root). Also in the slash menu.
- **Mod+Enter** = cut here (`region:split`).
- **Tab / Shift+Tab** = `region:demote` / `region:promote`, **only in the title**. In the body, Tab keeps its meaning (lists, nesting).
- **Start of region = a single logical position**: a Backspace at the very start of the title **or** at the very start of the first element of the body (whatever its type) triggers the protection; the **hold** merges with the previous region (`region:merge-previous`). Symmetric: hold Delete at the end of the previous region.
- **Creating a region**: `:::` + space in an empty paragraph opens a chooser (`choose` strategy, ADR 017) of the types **valid at that place**; the cursor lands in the title. One slash menu entry per declared type. `#` remains a simple heading.
- **Closing a region** (decided 2026-10-26): `:::` + **Enter** in an empty paragraph (symmetric to `:::` + space, like Pandoc's `:::` container blocks) = "the region ends here". A chooser lists the regions that contain the cursor, from the nearest to the farthest ("Close scene 2.2 — The ferryman", "Close chapter 2"…); a single enclosing region closes directly. Effect: the `:::` paragraph disappears and everything that **followed** it in the chosen region (and in the intermediate regions) leaves it, right after it, at the level of its parent; the cursor at the start of what leaves (an empty paragraph is created if there is nothing). Deliberate difference from Mod+Shift+Enter, which creates a paragraph after the region without moving anything (identical at the end of a region).

ADR 016's **protection** (question 1) remains: no silent merge of text across a boundary (`onBeforeMerge` veto, per region ancestor).

### 3.6 Rendering

- The current seam (board 8b: label, hairline, amber hint, draining hairline) becomes the container's **header**, with the title editable in place; `role="heading"`, `aria-level` = level, unchanged.
- The body carries **no** border, margin or background by default: to the eye, the text flows from one region to the next.
- Lazy rendering (separate workstream): the container is the natural unit.
- End marker ("only if needed") and margin rail of the cursor's region: see §8 (lot D).

### 3.7 Serialization

- **JSON**: a block with children, `{ type: 'region', props: { regionType, fields }, delta: <title>, children: [...] }`, an exact round trip.
- **HTML**: `<section data-nabu-region="<type>" data-nabu-fields="…"><hN>title</hN>…body…</section>`. Read back exactly; a `<section>` without these attributes remains what it is today.
- **Markdown**: ADR 016's data comment opens the region (`<!-- region:chapter {json} -->` followed by the `## …` title, which this time is the **real title** and not an echo). The end is **deduced** on reading (next opening of the same or a higher level, end of the parent, end of the document); an end comment `<!-- /region -->` is written **only** when content follows at the parent's level. *Question 5.*
- **Clipboard**: a **text** selection copies only text (§3.9); the structure travels through structure gestures (seam, future block selection). Pasting a region into a list / a toggle → rule of §3.1.

### 3.8 Collaboration

- Loro tree moves are safe under concurrency (no cycles, last writer wins per node). Two authors cutting at the same place: the moved blocks end up in one of the two new regions, the other stays empty and visible, so nothing is lost and there is no structural conflict.
- A region = a subtree: the basis for future permissions, synchronization or per-chapter loading (Orduin).

### 3.9 The title is a field; a text selection never touches the structure

Decided on 2026-10-23 (owner). **Storage** and **behavior** are distinct: the title is stored as a Loro text in the region (collaboration, undo, inline marks), but it **behaves like a locked field**.

- **Traversable by the plain cursor**: ↓ / → at the end of the block above a region → start of the title; ↑ / ← at the start of the first body element → end of the title; ↓ / → at the end of the title → start of the body. The computed **label** ("Chapter 2") is never a cursor stop.
- **Never merged, split or converted**: nothing enters or leaves the title through ⌫ / Delete; Enter does not split it; block shortcuts (`# `, `- `, `> `…) and "turn into…" do not apply to it; a multi-block paste arrives there **flattened**, on one line.
- **Excluded from extended selections** that are not entirely within it:
  - Nabu's selection model excludes titles from any range that starts or ends outside them: deletion, typing over, copy, marks ignore them;
  - they are not highlighted during such a selection (CSS, driven by the selection state; the title's DOM does not change during a drag, so as not to disturb the native selection);
  - an extending end (Shift+arrows, drag) that would fall in a title **skips** it;
  - a selection that **starts** in a title stays **bounded** there (like a form field);
  - **Ctrl+A** in a title selects the title; elsewhere, all the document's text **without** the titles.
- **Accepted consequences**: a deletion straddling two regions erases the text on both sides but **does not merge them** (title intact); **Ctrl+A then Delete** empties the text and **keeps the skeleton** (regions and titles); deleting, merging or moving a region is done through an explicit structure gesture (hold, seam, future block selection). Principle: *a text selection only touches text*.

## 4. What is reused, what is rewritten

**Kept as is**: `types.js` (declaration, field validation), numbering and templates (`format.js` in part), `messages.js`, the `hold` strategy and its rendering (`Region.svelte`, hint and hairline), the command engine (ADR 017), the generic `onBeforeMerge` hook, the sub-thread helpers.

**Rewritten**: `region.svelte.js` (empty block → MegaBlock with a header), `regions.svelte.js` (registry from the tree), `normalize.js` (nesting rule), `actions.js` / `insert.js` / `facts.js` (structural operations), markdown / HTML serializers, and the Regions tests (unit and e2e), rewritten with the new semantics.

**Removed**: the region's override of `Block#dragRange()` (the generic hook remains: a container already moves with its subtree).

## 5. Breakdown

0. **Design session**: keymap decided (§3.5, §3.9). Still to be drawn on the canvas: the **end marker** (options A always visible / B only if needed / C margin rail following the cursor; preference B + C), the Mod+Shift+Enter exit, the `:::` chooser.
1. **Lot A, model**: container block, title as header, nesting + normalizer, registry, numbering, rendering of the current seam with an editable title, JSON. The existing commands rewritten on the structure without changing their shortcuts.
2. **Lot B, keyboard and selection**: title-as-field (§3.9: arrows, locking, exclusion from selections, Ctrl+A), protection of the start of a region, `exit`, structural promote / demote in the title, `unwrap`, `:::` and slash menu.
3. **Lot C, exchanges**: markdown, HTML, clipboard, paste.

## 6. Questions: all decided on 2026-10-23 (owner) according to the recommendation in bold

1. **Title** = text header of the container (edited in place, collaborative, inline marks) **or** a plain-text `title` field edited elsewhere? → **header**.
2. **Mixed bodies**: parent text allowed between and after sub-regions? → **yes**, with an end marker drawn in the design session.
3. **Levels**: keep `level` as the nesting rule (sub-region strictly deeper, corrective normalizer)? → **yes**.
4. **Promoting** a scene to chapter rank: do the scenes that follow it in the same chapter **follow it** (become its sub-regions, as in the marker model) or **stay** in the old chapter? → **they follow it** (the visible division of the text does not change).
5. **Markdown**: end comment only when it is necessary? → **yes**.

## 7. Implementation notes: lot C (2026-10-26)

Reference forms: `docs/design/import-export.md` ("The region exception"), `docs/design/clipboard-format.md`. Code: `blocks/region/format.js` (comment, `scanRegion`: extent of a region), `serialize.js` (text forms, end comment rule), `region.svelte.js` (statics).

- **Markdown import**: rule with its own extent (like the toggle); `scanRegion` walks the lines with a stack of the open sub-regions (a `<!-- /region -->` closes the innermost; an opening of level ≤ closes everything open up to it) and skips code blocks. The title is the ATX heading **right after** the comment (level ignored); otherwise empty title. An orphan `<!-- /region -->` remains literal text.
- **Writing the end comment**: only if what follows the region is neither the end nor the opening of a region of level ≤; if the parent closes, the last child closes too (otherwise the parent's comment would be taken for its own). Empty title: comment alone, or a bare `##` when the body starts with a heading.
- **Core**: the only generic addition, `after` (the following siblings) next to `before` in the context of the static markdown serializers (`nabu.svelte.js`). The instance path (document export) reads its siblings in the tree.
- **HTML import**: `section[data-nabu-region]` (priority 100); the title is the **first element child** if it is `h1`–`h6` (not "the first heading of any kind": a heading further down would remain a heading of the body).

## 8. Implementation notes: lot D, default UI (2026-10-26)

Decided on the design boards 9 and 11 (owner). Code: `blocks/region/Region.svelte` (markup + CSS), `end-marker.js`, `create.js` (`createOptions`, `previewPrefix`), `regions.svelte.js` (`caret`), `ui/CommandChooser.svelte`.

- **End marker (§3.3, board 9 B, "only when needed")**: after a region's body, when its next sibling in the SAME parent (a body or the root) is not a region: a 24px hairline + "End of {prefix, else title, else type name} · back to {parent label}" (root: "… · outside regions"). `contenteditable="false"`, `data-nabu-ui`, `role="separator"` + `aria-label` of the same text, `user-select: none`, never a caret stop. Reactive. The condition is the pure `needsEndMarker(siblings, block)`, the text `endMarkerText(text, region)`. Messages `endOf`, `backTo`, `outside` (English defaults, overridable). Tokens: `--nb-region-end-color` (default: text colour at 60%), `--nb-region-end-size` (11.5px). Its height is fixed (2.6 × the size, one line, ellipsis) so that the rail can stop above it.
- **Margin rail (board 9 C)**: `Regions#caret` (reactive, computed once) = the DEEPEST region holding the selection anchor, only while the editor has the focus (`focusin` / `focusout` followed by the registry as a `nabu.systems` entry). The region draws `[data-region-caret]`: a 2px rounded `::before` out of the flow (no layout shift), from the seam to the end of its body (end marker excluded), and its seam prefix takes the rail colour. Nothing in `@media print`. Tokens: `--nb-region-rail` (`nabu-theme.css`: `#4F46E5` on light pages, `#818CF8` on dark ones, both about 6:1 against the page), `--nb-region-rail-offset`. The default offset is `calc(-24px - 0.4em)`, NOT the -0.9em of the board: the drag handle is a 24px button flush against each block, and a rail at -0.9em passes behind its glyph; the rail sits just LEFT of the handle strip. On touch screens (`hover: none`, no handle) it comes back to -0.9em. A host with no room left of the editor sets `--nb-region-rail-offset`.
- **Chooser of `:::` (board 11)**: two groups, "Here" (types created inside the current region, or at the root) and "Next" (siblings after the nearest ancestor that accepts them), each omitted when empty; in "Next" the current region's own type comes first. Each option's `detail` is the prefix the new region would get (`previewPrefix`: the registry's numbering rules applied as if it existed there; empty for an unnumbered type). Footer hint (`chooserFooter`). Digits count across the groups, the arrows cross them. Generic core support (no region knowledge in `ui/` or `utils/`): `confirm.options` entries may carry `group` and `detail` (strings), `confirm` may carry `footer` (string or `(ctx) => string`); `PendingOption` and `PendingCommand` expose them, `CommandChooser` draws small uppercase group headers (`role="group"`), a muted right-aligned detail and a sticky footer. Messages `groupHere`, `groupNext`, `chooserFooter`.

## 9. Implementation notes: lot E, closing a region (2026-10-26)

`:::` + **Enter** (§3.5, "Closing a region"). Code: `blocks/region/close.js` (trigger, chain, options, the operation), `commands.js` (`region:close`), `messages.js` (`closeCommand`, `closeOption`, `closeChooser`, `closeFooter`).

- **Trigger** (`onBeforeInput`, `insertParagraph`): a default paragraph without children that is a DIRECT child of a region body, whose text is `:::` followed by spaces only, collapsed caret at its end. Anywhere else (root, list item, other text, caret elsewhere, a selection) Enter is untouched. The `:::` + Space hook of lot B2 is unchanged; the extension tries the close first, then the creation.
- **Command** `region:close`, no default key. `exec('region:close', { region })` (a `Region`, its block or its id) closes that ancestor directly; without data, the innermost. The caret block must be a closing mark (the `:::` paragraph, or an empty default paragraph in a region body), else nothing happens. `when` tests the same. Closing a region that does not contain the caret block is refused (false, no change).
- **Chooser**: only when two regions or more contain the caret (`commandConfirm.offer('region:close')`); a single region is closed at once. Options innermost first, `region` carried in each option, label `Close {type name} {prefix} — {title}` (the dash and title omitted for an empty title; the type name is not repeated when the prefix already starts with it: "Close Chapter 2", not "Close Chapter Chapter 2"), `detail` = the numbering prefix, own footer ("↑↓ choose · ↵ close · Esc cancel", not the create one, which says "create"). All overridable through `messages`.
- **Effect**: the blocks that followed the `:::` paragraph in R0, then those that followed R0 in R1, … up to those that followed R_{k-1} in the closed region X, move in that order right after X in its parent; the `:::` paragraph is deleted. They are moved (ids and text kept), never copied. Moved sub-regions stay valid for the nesting rule (they are deeper than the region they left, which is deeper than X, which is deeper than X's parent): the normalizer has nothing to do, checked by a test that closes a chapter holding a scene and then the part. The caret goes to the first text position of the first moved block (a region: its title; a list: its first item); if there is no text in what moved, or nothing moved, an empty default paragraph is created after the moved blocks (right after X when none) and gets the caret.
- **Undo**: `nabu.shortcut(mark, '', mutate)` as in `createRegionHere`: one step, whose undo gives back the typed `:::`, the structure and the caret after the `:::`.
- **Cancel** (Escape, click away, any other key): nothing changes and no undo step exists; the paragraph keeps its `:::`. The Enter is NOT applied (the trigger consumed it to open the chooser): the user can press Enter again to reopen it, or type on.
- **At the end of a region** the result equals `region:exit` (Mod-Shift-Enter) from the same position (both leave one empty paragraph after the region); tested. The end marker (lot D) appears where text now follows the region.
- **Core**: one generic change in `utils/command-confirm.svelte.js`: in a `choose` confirmation a REPEATING Enter never confirms (like an `invite`, "a repeat never confirms"). Without it, an Enter held down long enough to repeat would open this chooser and pick its first option at once. The core still knows no region.


## Note (2026-10-27)
Lots A to E are implemented (audit 2026-10, entries of 2026-10-23 to 2026-10-26). The end marker, the margin rail and the `:::` chooser left to the design session in §5 point 0 were drawn on boards 9 and 11 and delivered in lot D (§8).
