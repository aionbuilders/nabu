# Changelog

## 0.1.0-beta.0

First beta. The library is feature-complete for the beta milestone: everything beyond the stability baseline is **opt-in** — a dedicated extension or a mounted UI component — so `MinimalPreset` stays paragraph-only. 287/287 unit tests, `prepack` + `publint` clean.

### Stability & packaging
- **Beta cut**: version `0.1.0-beta.0`; corrected `repository.url` to the `git+https://….git` form (publint suggestion).
- `createEditor` and the named factories now forward `Nabu` init options (`files`, `snapshot`, …) to the constructor, not just `extensions`.
- Replaced `$app/environment` (SvelteKit-only virtual module) with `esm-env` in `context.svelte.js`. The library now builds correctly for plain Svelte, Vitest, and any non-SvelteKit bundler.
- Removed leftover debug `console.log` statements in the `focus()` method (`nabu.svelte.js`) and the `onBeforeTransaction` hook (`paragraph/index.js`). Focus debug output is now routed through the gated `this.warn(...)` helper (only active when `nabu.debugging` is true).
- Removed stale files: `GEMINI.md`, `src/lib/blocks/zone/ZoneEditor copy.svelte`, and the `trash/` directory.

### Core refactoring
- New `TextBlock` base class (`blocks/text-block.svelte.js`): `Paragraph`, `Heading`, `Dialogue` (and the new `Blockquote`) now inherit the ~10 TextBehavior proxies instead of duplicating them.
- New declarative **input rules** system: extensions can register `inputRules` (`pattern` tested against the text before the cursor + `handler`). The `--` → `—` substitution moved from `TextBehavior` into the new `TypographyExtension`.
- `nabu.transact(mutateFn, cursorIntent?)` centralizes the mutate → commit → setCursor dance. Migrated `mark:*`, `block:transform` and `zone:set*` actions.
- Incremental `wordCount`: every block exposes `wordCount` ($derived); containers sum their children. `ZoneBlock` no longer re-traverses its whole subtree on each keystroke.
- **Capability flags** on `Block` — `splitsOnEnter`, `transformsEnabled`, `marksEnabled` (all default `true`): declarative engine opt-outs so a block can shape core behavior without overriding handlers (Code disables inline transforms, void blocks disable Enter-splitting).

### Native behavior audit
- Implemented `deleteWordBackward` / `deleteWordForward` / `deleteSoftLineBackward` / `historyUndo` / `historyRedo` inputTypes. Word deletion now removes the whitespace surrounding the word — closes issue #4 (Alt+Delete orphan space).
- **IME composition support** (closes issue #6): `compositionstart/update/end` are now handled. During composition the browser mutates the DOM freely (`insertCompositionText` is no longer blocked); the composed text is synced into Loro at `compositionend`, with guards for canceled compositions and destroyed blocks.

### New blocks & features
- **Blockquote** block (`> ` shortcut, Backspace/Enter de-transformations, markdown/HTML paste rules).
- **Divider** block — first non-textual block (`--- ` shortcut, `<hr>` rendering, markdown `---`).
- **Code** block — multi-line monospace, ```` ``` ```` shortcut, stores plain text only (pluggable syntax highlighting deferred — see `docs/adr/013`).
- **Callout** block — `note` / `tip` / `important` / `warning` / `caution` variants, `! ` shortcut.
- **Toggle** block — collapsible (hybrid MegaBlock: own text + child blocks, collapsed state in metadata; Enter spawns a body child, Backspace de-transforms).
- **Checklist / to-do lists** (`listType: 'todo'`) with interactive checkboxes, plus a reactive **`Todos`** registry (`Todos.get(nabu)`) that mirrors the Zones system for document-wide task tracking.
- **Image / Video / File** void media blocks on a shared `MediaBlock` base, with an optimistic local preview while the asset persists.
- **Link mark**: `link:set` / `link:remove` / `link:toggle` actions, `<a>` rendering, `[text](href)` markdown and `<a href>` HTML serialization, link parsing on HTML paste.
- **Document import**: `nabu.importMarkdown(md)`, `nabu.importJSON(json)` and `nabu.importFragment(fragment)` replace the whole document through the paste pipeline.
- **FloatingToolbar** component (`ui/FloatingToolbar.svelte`) + `nabu.isMarkActive(mark)` reactive helper.
- **Placeholders** on empty blocks via `data-placeholder` + global CSS (paragraph, headings, dialogue, blockquote).
- **Vite plugin preset**: `import { nabu } from '@aionbuilders/nabu/vite'` registers `vite-plugin-wasm` + `vite-plugin-top-level-await` (both moved to `dependencies`).
- HTML paste rules now support a `priority` field (specific blocks win over generic fallbacks).
- **File handling**: by default an uploaded file is stored as a blob in a separate Loro `assets` map (the document stays the single source of truth); a `files.onBeforePersist` hook lets the host redirect uploads to its own backend; `Files.get(nabu).resolve(ref)` turns a stored ref into a display URL. Warns above a 2 MB inline threshold.

### Editor UX
- **Slash menu** (`ui/SlashMenu.svelte`) — opt-in command palette: type `/` to open, filter by typing, `↑`/`↓`+`Enter` to run, `Esc` to close. Built-ins cover Text, Headings 1–3, bulleted / numbered / to-do lists, Code, Callout, Quote, Toggle, Divider, Image, Video, File; extend or override via the `commands` prop.
- **Inline markdown shortcuts** (`MarkdownShortcutsExtension`) — `**bold**`, `__bold__`, `*italic*`, `_italic_`, `` `code` ``, `~~strike~~` transform as you type.
- **Stored marks** (ProseMirror-style active formatting) — toggling a mark at a collapsed cursor (e.g. Ctrl+B) starts formatting for the next typed text; marks now use `expand: 'none'` so they no longer leak past their range; cleared on cursor navigation.
- **Drag handles** (`ui/DragHandle.svelte`) — opt-in overlay: hover a block to reveal a `⠿` grip and drag to reorder. Pointer-events based, custom drop indicator, reorder by proximity via `moveBefore` / `moveAfter` on the Loro tree (single transaction → collaborative & undo-safe), `wrapOrphan` structural repair, and an anti-cycle guard.

## alpha.10

### Zone Word Count Logic Refactor
- Fixed a bug where word count indexes (`Counter getIndex`) would miscalculate when zones were deleted or reordered.
- Redesigned `Counter` scoping: `Template.getCounter` now correctly scopes counters by `parentZoneId` directly, isolating word counts natively without manual backtracking.
- Fixed a memory leak where `Template` subscriptions to the counter would duplicate because they were not properly unsubscribing on destroy.
- Ghost zones (zones being removed from the DOM but lingering in the block map) are now properly filtered out of index computations.

### Dynamic Word Count Cap (`maxTarget`)
- `ZoneEditor` now automatically caps a zone's word count target to its parent's capacity.
- Implemented visual indicators for `Max: {target}` in the `ZoneEditor` UI.

### Theme & UI Modularity
- Completely migrated Nabu's design system to semantic CSS variables via a new `nabu-theme.css` file.
- The user interface now uses `var(--nb-*)` tokens for all colors, borders, shadows, and blurs.
- Introduced a bulletproof OS-native theme fallback: auto-switches on `@media (prefers-color-scheme: dark)`, and allows explicit developer overrides via `data-nabu-theme="dark|light"`.
- Refactored all major UI components (`Zone.svelte`, `ZoneEditor.svelte`, `TemplateEditor.svelte`, `Context.svelte`, `ZoneTemplatesList.svelte`) to support this dynamic theming out-of-the-box.

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
