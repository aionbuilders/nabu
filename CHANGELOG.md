# Changelog

## alpha.9

### Selection normalizer (breaking fix)

Complete rewrite of `findNearestTextNode` in `selection.svelte.js`. The previous implementation used a sub-walker starting from the beginning of the element, causing the caret to loop back to the start of a zone when trying to exit. The new logic uses `anchorOffset` as the search pivot, correctly determining where in the element the caret landed before deciding whether to look inside or escape past it.

- Arrow keys now correctly exit zones in both directions
- Shift+arrow into an inert element now corrects only the focus, preserving the anchor (non-collapsed selection)
- `data-nabu-ui` elements (zone title input, etc.) bypass normalization entirely

### Zones — nested zones

`zone:insert` and `zone:wrap` now support zones inside zones.

- `zone:insert` detects the nearest zone ancestor and inserts inside it rather than always jumping to root level
- `zone:wrap` (single-block) no longer bails when wrapping inside a zone — creates a nested zone at the correct position
- `zone:wrap` (multi-block) allows wrapping a selection of zones into a new zone

### Zones — UI

- **Breadcrumb (top)** — when a zone is nested, the title area shows the full ancestor chain: `› Partie II › Chapitre 7`
- **Closing chevrons (bottom)** — replaces the plain bottom boundary line with `‹ Partie II ‹ Chapitre 7` right-aligned, indicating zone exit context
- **Word count** — now displayed on all zones, not only nested ones

### BlockGap — inter-block gap system

New `BlockGap.svelte` component rendered after every block via `Block.svelte`. Hovering the gap between two blocks reveals a subtle `+` line. Clicking emits `gap:click` via `nabu.exec` with `{ parentId, insertIndex }` — completely agnostic, any extension can handle it.

`ParagraphExtension` registers a `gap:click` handler that inserts a paragraph at the gap position and moves the cursor there. This solves the "two consecutive zones with no way to insert content between them" problem.

### Exports

`ZoneBlock`, `Zones`, and `ZoneExtension` are now properly exported from the package root via a new `src/lib/blocks/zone/index.js` barrel.
