# Changelog

## Unreleased

### Paste
- Pasting a whole block (e.g. `# Title`) into an **empty root-level block** now adopts its type. Pasting into existing text, or into a nested block (list item…), never changes the block type.
- Plain-text paste: **one non-blank line = one block** (runs of blank lines are separators). `importMarkdown()` keeps CommonMark semantics (consecutive lines = one paragraph) via the new optional `interpret(raw, nabu, { joinLines })` argument of paste interpreters.
- A paste is always its own undo step; the typing right after it doesn't merge into it.
- New block capability flag `pastesAsPlainText` (default `false`, `true` on Code): pasting inside such a block inserts the clipboard's `text/plain` verbatim (replacing the selection, one undo step) before any paste interpreter runs. No more blocks spilling out of a code block, `# ` / blank lines / `- ` kept as typed.

### Markdown shortcuts
- Block shortcuts (`# `, `- `, `1. `, `[] `, `> `, `! `, `-- `, `--- `) now keep the trigger in the undo history: one Ctrl+Z gives back exactly what was typed (`# `, caret after the space), a second one removes the typing. Implemented once in `nabu.shortcut(block, trigger, transform)` (trigger inserted as a text commit, transform as its own structural step). The code fence (```` ```js ```` + Enter) comes back as the fence line, without the Enter.
- Fix: blocks with `transformsEnabled = false` (Code, Callout, Toggle) are no longer transformed by markdown shortcuts (`# `, `> `, `--- `, `:::`…): the extension `onBeforeInput` hooks are now skipped for typing in such a block (deletion hooks still run), and `nabu.shortcut()` refuses on them. Typing `# comment` in a code block stays plain text.
- Undo/redo restore the caret into the block that exists afterwards: Loro re-creates a block deleted then undone under a new id, so the stored caret now also carries the block's tree path (fixes the lost caret / swallowed key after undoing `- `, `1. `, `[] `).
- Inline shortcuts follow CommonMark flanking rules: no whitespace just inside the delimiters (`2 * 3 * 4`, `* not *` stay literal), `_` / `__` never open or close intraword (`snake_case_name`), `` `a b` `` keeps its spaces. `***both***` typed char by char is bold+italic (the `**…*` rule no longer fires inside a `***` run); `___both___` too.
- Typography: `-- ` becomes an em dash only when the `--` is not preceded by another `-` (`abc --- ` stays).
- `3. ` creates an ordered list that starts at 3: new `start` prop on `List` (`<ol start>`, markdown `3.` `4.`…, markdown / HTML paste, JSON, clipboard). Omitted when 1, ignored for bullet / todo lists; an adjacent list merged into another keeps the first list's start; nested lists start at 1.
- Fix: an ordered list created right under a bullet list was destroyed together with its item by the adjacent-list merge (lists of different types are no longer merged).

### Slash menu
- `/divider` behaves like `--- `: an empty block becomes the divider, otherwise the divider goes after the block (after the whole list inside a list); the caret lands in a new paragraph below. One shared `insertDivider()`.
- The menu is positioned in viewport coordinates (it was off-screen on a scrolled page), flips above the caret when there is no room below, is clamped horizontally and follows the caret on scroll / resize.
- Filtering: titles match by substring, aliases by prefix (`/ul` no longer matches Divider through "rule").

### Undo
- Structural operations (split/Enter, block merge, multi-block deletion, block type transforms incl. markdown shortcuts, list indent/unindent, cut) are their own undo step. Detected centrally at commit time from the pending Loro transaction; plain typing still merges per second.

### Editing
- Fix: block `create()` with `index = 0` (Paragraph, Code, Heading, Blockquote, Divider, Dialogue, Callout, Media, List item) appended the block at the end (`index || undefined`); it is now `index ?? undefined`. Enter in a toggle header puts the new paragraph first in the body.
- The model selection now re-syncs synchronously from the DOM at every input entry point (keydown, beforeinput, compositionstart, copy / cut / paste) via the new idempotent `SvelteSelection.sync()`. `selectionchange` is asynchronous, so a keystroke right after a caret move could act on the previous caret: lost first character after a click, Enter splitting at the old offset, wrong marks range.
- `nabu.exec()` (and `insertFragment()`) now re-sync the model selection from the DOM too, so a programmatic action fired right after a keyboard-only selection change (Shift+Arrow, Home/End, Ctrl+A) acts on the new selection instead of the previous one. `nabu.focus()` returns a promise that resolves once the selection is set (`await nabu.focus(...)` before `exec` / typing); it is asynchronous because it waits for Svelte to render pending blocks.
- Word deletion (Ctrl/Alt+Backspace, Ctrl/Alt+Delete) now uses the model-based rule in every browser: the deleted word takes its surrounding whitespace with it, no orphan or doubled space. Previously Chromium's `getTargetRanges()` bypassed the fix for issue #4.
- Fix (P-34): the caret never rests on a non-text position. Around a Toggle (arrow button, collapsed body), a Divider or an Image the browser parked the native caret on a wrapper / whitespace text node / the editor root, so the next keystroke was swallowed and arrows needed 2-3 presses. `NabuSelection.normalize()` (synchronous, idempotent) now moves any dead endpoint (inert block, element caret, text node outside a text block's own text) to the nearest text position in the direction of travel, skipping void and hidden blocks, in one key press. It runs at selection change, at `keydown` / `keyup` and at `beforeinput` (a keystroke is never swallowed by a dead caret).
- New block capability `hidesChildren` (default `false`; Toggle: collapsed): `findForward` / `findBackward` / `findLastDescendant` and caret navigation never enter a block's hidden children (Backspace after a collapsed toggle no longer merges into its hidden body).
- Fix (P-35): a document ending with a non-text block (divider, image, a container whose end is not a text position) now offers a caret after it. ArrowDown / ArrowRight out of the last text block, and a click in the empty area below the last block, append ONE empty default text block (one undo step) and put the caret in it; nothing is created on load. New `nabu.openTrailingCaret()` / `nabu.lastVisibleBlock`; the default block type comes from the extension flagged `defaultBlock: true` (Paragraph) into `nabu.defaultBlockType`.

### Placeholders
- Placeholders are displayed again (their CSS was disabled). New `placeholders` editor option: `false` to disable, or `{ show: 'focus' | 'empty', text: { [type]: string | false | (block) => string | false } }`. Default `show: 'focus'` (only the empty block holding the caret). Blocks declare their default text with `static placeholder`; color via `--nb-text-placeholder`. `getPlaceholder()` is deprecated.
- `createPersistedEditor()` now forwards all editor init options.

### Lists
- List schema normalizer (`list/normalize.js`, run by the List extension's `onBeforeTransaction`, i.e. inside the transaction/undo step of the operation that broke the structure). Invariants enforced to a fixpoint, with moves only (ids and caret survive): no empty list; no list directly inside a list (unwrapped); only list items inside a list (a foreign block is hoisted out, the list split around it); an item has only lists as children (0..n of them, see P-28 below); adjacent lists of the same type merge.
- Tab / Shift+Tab keep the caret (or range) at the same offset on the moved item (the item's whole text used to end up selected, so the next keystroke replaced it). Indent / unindent now work on tree nodes in `list/indent.js`.
- Tab / Shift+Tab with a selection spanning several items indent / unindent every touched item (document order, relative structure kept, items that cannot move stay, selection restored) as ONE undo step, and the key is always claimed when the selection is in list items, so the focus no longer leaves the editor. Routed by the List extension's `onKeyDown` hook (the keydown of a multi-block selection resolves to the lowest common ancestor, not to an item). `list:indent` / `list:unindent` actions act on the whole selection too.
- **Enter on an EMPTY list item steps back one level**: a nested item is unindented like Shift+Tab (its following siblings become its children), a top-level item leaves the list as a paragraph (list split around it, removed when it was the only item). The exit paragraph used to be inserted inside the parent list item for nested items. The item is retyped in place (same node/id), so its own sub-items are kept as a list below instead of being destroyed.
- **Backspace at offset 0 of a list item steps back one level** (collapsed caret): a nested item is unindented like Shift+Tab; a top-level item alone becomes a paragraph (text, marks, caret kept), the list is split around it, its sub-items stay a list right after it. A second Backspace then merges the paragraph into the previous block as before. Selections, Backspace elsewhere in the item and Delete are unchanged. Implemented in `list/step-back.js`, triggered from the List extension's `onBeforeInput` hook.
- Ordered numbering continues across those splits: the tail list gets `start` = the number its first item had (`1. a 2. b 3. c` with `b` turned into a paragraph reads `1. a`, `b`, `3. c`), taking the original `start` into account.
- **Tab on an item with children moves the whole subtree** one level deeper with it (its children stay its children; they were hoisted to following siblings before). With several selected items, a child selected together with its moved parent is not moved a second time. Shift+Tab keeps the item's children too (followers are appended after them).
- **Changing the type of ONE list item acts on that item only, in place** (slash menu "Numbered list" / "Bulleted list" / "To-do list" / "Text" / "Heading N"…, `block:transform`, `exec('paragraph')`, `exec('heading:1')`, markdown shortcuts typed inside an item). To another list type the item (with its sub-items) goes into a new list between the part before and the part after (`ul[a] ol[b] ul[c]`; adjacent lists of the same type merge, "Numbered list" on a bullet item used to do nothing); the same type is a no-op; entering a to-do list sets `checked: false`, leaving one drops it. To any other block it leaves the list exactly like the top-level Backspace (list split, sub-items stay a list right after it, ordered tail keeps counting through `start`). Converting to another LIST type works at any nesting level, in place (see P-28 below); only a conversion of a NESTED item to a non-list block first unindents it to the top level (what repeated Shift+Tab does: followers become its children). Generic core hook: `Block.retype(type, props)` (mutations only; `transformTo` and `block:transform` use it), overridden by `ListItem`; new `list:convert` action (`{ listType }`) used by the slash menu, which no longer builds lists itself. New `nabu.isolateUndoStep()`.
- **A list item may hold SEVERAL consecutive sublists of DIFFERENT types (P-28)**: `a > [ul[s1], ol[s2], ul[s3]]`, mirroring the root level. The normalizer no longer merges an item's extra sublists into the first one: only ADJACENT sublists of the same type merge (the first keeps its `start`). Converting a nested item to another list type (slash "Numbered list" / "To-do list" / "Bulleted list", `list:convert`) splits its sublist in place inside the same parent item (ordered "after" part keeps counting through `start`; no more promotion to the top level; one undo step), converting it back re-merges. Tab puts the item in the previous sibling's LAST sublist when it has the item's list type, else in a new sublist of that type after the sibling's sublists; Shift+Tab makes the followers children in a sublist of THEIR type after the item's own sublists (the parent's later sublists follow, to keep the document order). Step-back of a top-level item moves ALL its sublists out. Markdown (`- a` / `  - s1` / `  1. s2` / `  - s3`), HTML, JSON and clipboard round-trip them; `ListItem.sublists` (all) replaces the single `sublist` (kept as the first), `sublistsOf(item)` replaces `sublistOf` in `list/indent.js`.
- **Ctrl/Cmd+Enter toggles to-do items**: the item under the caret, or every to-do item of a multi-block selection (any unchecked: check all, else uncheck all). Caret unchanged, one undo step; no-op outside to-do items. The normalizer now also runs when a list's `listType` changes.

### Blocks
- **Behavior change: dialogue markdown export now uses an EN dash (`– text`) instead of an EM dash (`— text`).** New `createDialogueExtension({ dash = '–' })` factory (`DialogueExtension` stays exported as the default instance): the dash is displayed through the CSS custom property `--nb-dialogue-dash` (overridable by a host in CSS) and used by the markdown export. Markdown import / paste recognizes both `–` and `—` as dialogue markers (new `markdownRules` / `fromMarkdown` on `Dialogue`).
- Fix (P-37): a block-type-specific `onSplit` was never run, the generic Paragraph one (registered first) captured the Enter of every block type. `Block#ascend` now runs the hooks registered by the extension that owns the block's type before the generic ones (`nabu.hookOwners`, filled at extension registration; core stays agnostic). Enter in a non-empty dialogue creates a new dialogue line; Enter on an empty dialogue turns it into a paragraph.
- Heading (P-36): Enter in the middle splits into two headings of the same level; at the start of a non-empty heading an empty paragraph is inserted above (heading, level and caret kept); at the end a paragraph is added below (unchanged, also for an empty heading).
- Callout (P-38, interim): Backspace at offset 0 of a non-empty callout is a no-op (nothing merges, variant kept); an empty callout still becomes a paragraph. The callout is planned to become a container.
- Code (P-39): Backspace at offset 0 of a non-empty code block turns it into a paragraph with the same text (language dropped, caret stays at 0); a second Backspace merges normally.
- Divider (P-39): Delete at the end of the block right before a divider deletes the divider (symmetric with Backspace after it); text and caret kept, one undo step. It used to merge the next block across the divider.
- Generic schema rule in `Nabu.commit()`: a block whose class cannot hold children (not a `MegaBlock`) never keeps child nodes. Retyping a node into such a block (`block:transform`, markdown shortcuts, `data.set('type')`) or moving a node under one moves its children to right after it, in order, in the same transaction (nothing is lost; e.g. a list item with a sublist transformed to a paragraph no longer hides the sublist). The tree-subscription no longer throws when a retyped block has no `updateChildren()`.

### Tests
- E2E harness: dedicated dev-only `/e2e` route (fresh editor per test, `?persist=<docId>`, `?options=<json>`), fixing a startup race that made ~35 tests time out. New specs: `text-marks`, `shortcuts-slash`, `fast-input`, `list-start`. 307/307 e2e, 390/390 unit.

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
