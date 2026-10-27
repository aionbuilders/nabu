# ADR 017 — Commands, keymap and confirmations

**Status:** Accepted (2026-10-22, validated by the owner)
**Date:** 2026-10-22
**Original:** [French](fr/017-commands-keymap-confirmations.md)
**Reference design for `hold`:** canvas "Zones — exploration", board **8b** (hint above the label, left-aligned, no bubble, amber tint `#B45309`, hairline that drains in the same tint, no shift of the text).
**Related:** ADR 011 (action bus `nabu.exec`), ADR 016 (Regions — first client: "cut here", protected merge), canvas "Zones — exploration" (board 8: merge by holding ⌫)

---

## 1. Context

Today, keyboard shortcuts are handled **case by case**: each extension intercepts `keydown` in its `onKeyDown` hook (marks, lists, code, todos, slash menu…) and **the first one to answer wins**. Consequences:

- nobody knows that two extensions want the same key: conflicts are silent;
- it is impossible to customize a shortcut, or to display a reliable keyboard help;
- there is no common way to **confirm** a risky action (e.g. merging two regions) or to **choose** between two possible actions.

The action bus (`nabu.exec(topic, data)`, ADR 011) already exists: it executes, but knows nothing about keys, context or confirmation.

## 2. Decision

1. A **central command registry**: an extension *declares* its commands (action, label, shortcuts, applicability context, confirmation strategy); the core resolves the keys.
2. Three **confirmation strategies**, chosen by each command: **hold on the target**, **invite at the cursor**, **choose**.
3. The former `onKeyDown` hooks remain supported during the migration (fallback).

## 3. Design

### 3.1 Declaring a command

```js
extension('regions', {
  commands: {
    'region:split': {
      label: 'Cut here',
      keys: ['Mod-Enter'],
      when: (ctx) => ctx.block?.behaviors.has('text') && ctx.inRoot,
      run: (nabu, ctx) => splitRegionAtCaret(nabu, ctx),
    },
    'region:merge-previous': {
      label: (ctx) => `Merge with “${ctx.previousRegion.title}”`,
      keys: ['Backspace'],
      when: (ctx) => ctx.isCollapsed && ctx.atStartOfRegion,
      confirm: { strategy: 'hold', target: (ctx) => ctx.region.marker, holdMs: 700 },
      run: (nabu, ctx) => mergeWithPrevious(nabu, ctx),
    },
  },
});
```

- A command **is** an action of the bus: `nabu.exec('region:split')` always works, without a keyboard (palette, menu, API).
- `keys`: normalized chords (`Mod` = Cmd on macOS, Ctrl elsewhere; explicit `Ctrl`, `Alt`, `Shift`, `KeyboardEvent.key` key names). Chords reserved by the browser or the system (Cmd/Ctrl+W, T, N, Q…) are refused with a warning.
- `when(ctx)`: the context where the command applies. `ctx` is built by the core on every `keydown`: `nabu`, `block`, `selection`, `isCollapsed`, the chain of ancestors (types), plus **facts enriched by the extensions** (e.g. `atStartOfRegion`, `region`, `previousRegion` provided by Regions) — the core knows no block type.
- `label`: text (or function of the context) for the help, the invite and the chooser.

### 3.2 Key resolution

On every `keydown` (capture phase, **ignored during an IME composition**):

1. normalize the chord;
2. gather the commands that have a matching shortcut and whose `when(ctx)` is true;
3. **exactly one** → it runs (with its confirmation strategy, if any), `preventDefault`;
4. **several** → priority: a command bound to the current block's type (`scope`) comes before a generic command; at equal priority → **choose** strategy (§3.4);
5. **none** → fallback to the historical `onKeyDown` hooks, then native behavior.

### 3.3 Conflict detection, customization, help

- **At registration**: two commands with the same chord **and** the same declared `scope` → developer warning (`nabu.warn`); overlaps between `when` conditions can only be detected at run time (§3.2 point 4).
- **Customization**: `createEditor({ keymap: { 'region:split': ['Mod-Shift-Enter'], 'mark:bold': [] } })` replaces or disables shortcuts.
- **Help**: `nabu.commands.list()` returns the commands, their labels and their shortcuts **formatted for the platform** (⌘ ⌥ ⇧ on macOS) — the keyboard sheet (board 4) generates itself.

### 3.4 The three confirmation strategies

The pending state is exposed, reactive: `nabu.pendingCommand = { id, strategy, label, target?, progress?, options? } | null`. The core handles the keyboard; **the appearance belongs to the integrator** (a neutral default rendering is provided; dedicated design later).

**a) `hold` — hold on the target** (board 8)

- A **fresh press** (`event.repeat === false`) started in the command's context starts the count (`holdMs`, default 700 ms); `progress` goes from 0 to 1; the **target** (e.g. the region's seam) displays the progress.
- **Releasing before the end cancels.** Any other key cancels (and performs its normal action).
- **A hold started elsewhere never counts**: the repeats (`repeat === true`) of a key held down before reaching the context are **stopped** at the context — the key must be released and pressed again. *(Protects someone erasing a sentence by keeping ⌫ pressed.)*
- Announcement to screen readers through an `aria-live` region (e.g. "Hold Backspace to merge with The treeline").
- The command is always executable **without a hold** (menu, palette, `nabu.exec`): accessibility.

**b) `invite` — invite at the cursor**

- First press: `pendingCommand` (strategy `invite`) — an invite appears at the cursor ("⌫ to confirm · Escape to cancel").
- Same chord again (fresh press) → executes; Escape, any other key, a click or a timeout (default 5 s) → cancels.

**c) `choose` — choose between several actions**

- Used automatically in case of real ambiguity (§3.2), or explicitly by a command that offers variants.
- The options (`label`, shortcut) are displayed at the cursor: arrows + Enter, digits, click; Escape cancels.
- Design rule: the chooser is a **safety net**, not a normal mode — default shortcuts must be designed not to step on each other.

### 3.5 What does not change

- The slash menu keeps its modal keyboard (it captures the arrows while it is open).
- Input gestures (`beforeinput`) do not go through this registry: it only concerns **commands**.
- Undo: each structural command remains one step (existing mechanisms); a cancelled confirmation creates no step.

## 4. Breakdown

1. **Lot 1** — registry (`commands` in `Extension`), per-platform chord normalization, context enriched by the extensions, resolution + priorities, customization (`keymap`), `nabu.commands.list()`, conflict warnings. Migration of a few existing shortcuts to prove the model (undo/redo, marks, todo).
2. **Lot 2** — `hold`, `invite`, `choose` strategies + `nabu.pendingCommand` + neutral default renderings (progress hairline, invite, chooser) + `aria-live` announcements.
3. **Lot 3** — migration of the other keyboard hooks (lists, code, toggle…); the `onKeyDown` hooks remain supported for third-party extensions.

Only then: **Regions lot 2** (cut here = `Mod-Enter`, protected merge by holding ⌫ on the seam, move, move up/down, navigate), plugged directly into the registry.

## 5. Open questions

1. ~~Hold duration~~ — **decided**: 700 ms by default, adjustable.
2. ~~Command palette~~ — **decided**: core only (`nabu.commands.list()` + execution); the visual palette will be designed in a design session.
3. ~~Single-key shortcuts~~ — **decided**: enforced — a command bound to a key without a modifier (Backspace, Enter, Tab, letter…) and without `when` is **refused** at registration.

---

## 6. Implementation notes — lot 1 (2026-10-22)

Code: `src/lib/utils/keys.js` (chords), `src/lib/utils/commands.js` (`CommandRegistry`), `Extension#commands` / `Extension#commandContext` (`utils/extensions.js`), wiring in `Nabu` (constructor, `#registerCommands`, `handleKeydown`, `NabuInit.keymap` / `platform`). Tests: `tests/unit/keys.test.js`, `tests/unit/commands.test.js`, `tests/e2e/commands.spec.ts`.

- **Where keys are resolved**: `Nabu#handleKeydown`, the keydown handler of the editor root, as its FIRST step (after `selection.sync()` / `normalize()`), before `dispatchEventToSelection('keydown', e, 'onKeyDown')`. Not the document-capture listener of `NabuSelection`: that one runs for every editor of the page and without knowing which one owns the key; the root handler is per editor, and it leaves their precedence to the slash menu (document capture, modal) and to anything inside a block that stops the event. Resolution still precedes every legacy hook and every block `keydown`. It ignores IME composition (`isComposing`, `keyCode 229`, `nabu.composing`) and an event already `defaultPrevented`.
- **Cheap path**: the chord of the event is looked up in a map first; if no command is bound to it, no context is built (typing costs one chord computation).
- **Context** (`CommandContext`): `nabu`, `event` (`null` from `exec`), `block` (anchor block), `selection`, `isCollapsed`, `ancestors` (types, nearest first), `inRoot` (the block is a direct child of the document), then FACTS from `Extension#commandContext(nabu, ctx)` (merged in extension order; they cannot replace the fields above; a provider that throws is ignored with a warning). The engine names no fact.
- **Resolution**: candidates = bound commands whose `when` is true (no `when` = true; throwing = false). Ranking: `scope === ctx.block.type` first, then registration order (engine commands, then extensions in order). A real tie warns once (`TODO(ADR-017 lot 2)`: `choose`) and runs the first. A synchronous `false` from `run` = "not handled": the next candidate is tried, then the legacy hooks and the native behavior; a promise or any other value = handled (`preventDefault`). A `run` that throws is logged (`console.error`) and the key is consumed.
- **`Mod`**: Cmd (Meta) on macOS, Ctrl elsewhere; `platform` is detected (`navigator.userAgentData.platform` / `platform` / `userAgent`) and overridable through the `platform` init option (tests, SSR). Consequence for migrated shortcuts: on macOS, Ctrl+B / Ctrl+Z no longer trigger bold / undo (they used to: `ctrlKey || metaKey`), and Win+Z on Windows / Linux no longer undoes; the platform's own modifier is the only one.
- **Chord normalization** (keys.js, one rule for strings and events): canonical form `Ctrl-Alt-Shift-Meta-<key>`; letters lower-cased (Caps Lock irrelevant), Shift kept as a modifier on letters and on named keys; digits / symbols matched by the character produced, Shift NOT part of the chord (`Mod-Shift-1` is invalid, write `Mod-!`); for a non-ASCII `event.key`, `Dead` or `Unidentified`, `event.code` (`KeyB`, `Digit1`) gives the Latin letter / digit; AltGraph keystrokes and pure modifier presses have no chord. Display: `⌃⌥⇧⌘` + key on macOS (`⌘↩`, `⇧⌘Z`), `Ctrl+Alt+Shift+Meta+Key` elsewhere.
- **Refused at registration** (the command stays runnable through `exec`; each refusal is a `nabu.warn`, i.e. visible with `nabu.debugging`): invalid chord; reserved chord (`RESERVED_CHORDS` in keys.js: tab / window / quit `Mod-w/t/n/q` and shifted variants, `Mod-Tab`, `Ctrl-Tab`, `Alt-Tab`, `Alt-F4`, `Mod-PageUp/Down`, `Mod-1…9`, reload `F5` / `Mod-r`, `Mod-l`, `F6`, `Mod-d`, `Mod-h`, zoom `Mod-0 = + -`, `F11`, `F12`, `Mod-Shift-i/j`, `Mod-Alt-i`); a chord without Ctrl / Alt / Meta (Shift alone does not count; function keys are not exempt) on a command without `when`. The same checks apply to `keymap`. Same chord + same `scope` (both absent counts) = dev warning, both kept.
- **Commands with `confirm` before lot 2**: stored (`CommandInfo.confirm`) but their keys are NOT bound (warning); the command stays runnable by `exec` / `commands.run`. Rationale: running a risky command from a key without its confirmation is the one failure that cannot be undone by a later lot; lot 2 only has to stop refusing them (`TODO(ADR-017 lot 2)` in `CommandRegistry#register`).
- **Commands as actions**: each registered command is also a Pulse action under its id, run with a context whose `event` is `null` (no `when` check). If an extension declares both an `actions` entry and a command with the same id, both run: don't. The engine's own `block:move-up` / `block:move-down` (`Mod-Shift-ArrowUp` / `ArrowDown`, `src/lib/blocks/move.js`, P-80: one step among the siblings of one parent, a selection moves as a run, an edge is a no-op, never leaves its container) are core commands too. The engine's own `undo` / `redo` are now commands (`Mod-z`; `Mod-Shift-z`, `Mod-y`), no longer special-cased in `handleKeydown`; `nabu.exec('undo')` is unchanged.
- **Migrated**: undo / redo (engine); `mark:bold` (`Mod-b`), `mark:italic` (`Mod-i`), `mark:underline` (`Mod-u`), `mark:code` (`Mod-e`), `mark:strikethrough` (`Mod-Shift-x`) in `rich-text`; `todo:toggle` (`Mod-Enter`, `scope: 'list-item'`, `when`: the selection touches a to-do item) in `list-item`. The `rich-text` `onKeyDown` hook stays, reduced to swallowing the browser's own Ctrl/Cmd+B / I / U when no command took them (otherwise a rebound or disabled shortcut would come back through the native `formatBold` → `beforeinput`). `toggleTodos(nabu, event)` is kept as a thin wrapper (`toggleSelectedTodos` is the command's body). Everything else (lists Tab, code, toggle, slash menu…) is still legacy hooks (lot 3).
- **Regions lot 2 and Mod-Enter**: `region:split` can declare `Mod-Enter` with `when: ctx.inRoot && …`; in a to-do item `todo:toggle` is scoped to `list-item` and wins; elsewhere the split applies. Pinned by `commands.test.js` ("Mod-Enter coexistence").
- **Introspection**: `nabu.commands.list(ctx?)` / `get(id, ctx?)` return plain snapshots (`id`, `label`, `keys`, `display`, `scope`, `extension`, `available`, `confirm`); not reactive, the set of commands is fixed once the editor is built (no runtime registration yet). `run(id, data)` = `nabu.exec`.
- **What lot 2 needs from here**: `CommandRegistry#handleKeydown` (the tie → `choose` and the `confirm` dispatch go there; `event.repeat` is on the event already in `ctx.event`), `CommandInfo.confirm`, the `register` refusal of `confirm` keys to lift, `ctx.event` for the "fresh press" rule of `hold`, `nabu.pendingCommand` to add on `Nabu`.

---

## 7. Implementation notes — lot 2 (2026-10-22)

Code: `src/lib/utils/command-confirm.svelte.js` (`CommandConfirmation`, `PendingCommand`), the dispatch in `CommandRegistry#handleKeydown` / `register` (`utils/commands.js`), wiring in `Nabu` (`commandConfirm` init option, `pendingCommand`, `cancelPendingCommand()`, `pendingCommandOn()`, `commandAnnouncement`; a `systems` entry attaches the document listeners), `Nabu.svelte` (live region, target marking), `ui/CommandInvite.svelte`, `ui/CommandChooser.svelte`, `ui/anchor.js`. Tests: `tests/unit/command-confirm.test.js` (fake clock), `tests/e2e/command-confirm.spec.ts` with the dev-only demo commands of `/e2e?commands=demo` (`src/routes/e2e/demo-commands.js`).

- **Order**: `CommandRegistry#handleKeydown` first lets the controller see the key while something is pending (or the key of a completed hold is still down); only if it does not consume it does the normal resolution go on. So "another key cancels and acts normally" is just: cancel, then resolve (the key may even be another command). Lone modifier presses are ignored by every strategy.
- **Fresh vs repeated**: `event.repeat`. A winner command with `confirm` that gets a repeat swallows it (`preventDefault`, no state) instead of starting: that is the whole "stop a held key at the context" rule, it needs no memory of where the key was pressed (`when` is evaluated per event: false -> the repeat flows to the native behaviour, true -> swallowed). After a hold completes, the chord is remembered as spent and its repeats are swallowed until its `keyup` (or a blur / a new fresh press of it). Invite / choose use the same rule.
- **Release**: the controller listens to `keyup` (capture) on the document; the main key (by `event.code`, else the normalized key) or any modifier of the chord going up cancels an unfinished hold.
- **Clock**: `CommandConfirmOptions.clock = { now, timeout, frame }` (default `performance.now` / `setTimeout` / `requestAnimationFrame`). `progress = min(1, (now - start) / holdMs)` computed at each frame; the completion is decided by the same frame, so progress and completion cannot disagree. Tests inject a fake clock.
- **Cancellation**: keyup, another key, `selectionchange` away from the DOM selection captured at the start, `mousedown` outside `[data-nabu-ui]`, `focusout` to outside the editor / UI, window `blur`, invite timeout, `nabu.cancelPendingCommand()`. A chooser has no timeout. At completion / confirmation `when` is evaluated again with a fresh context: a command that no longer applies does not run.
- **Choose**: a tie is only among the top-ranked candidates (same `scope` rank): the tied entries become the options (`display` = the shared chord). Running an option runs the command directly (choosing is the confirmation; a tied command's own `confirm` is not asked again) with the context of the key press. Explicit variants: `confirm.options(ctx)`; the options keep their own extra fields and `run(nabu, ctx, option)` receives the chosen option. Empty options: the key falls through. Behaviour change vs lot 1: a command scoped to another block type no longer beats a generic one by registration order, they tie.
- **Live region**: one `role="status" aria-live="polite" aria-atomic` element per `Nabu.svelte` (`[data-nabu-live]`, visually hidden). The controller owns the text (`nabu.commandAnnouncement`); consecutive identical messages alternate an invisible suffix so that they are spoken again. Cancellations are announced when the user asked (release, Escape, timeout), not when they typed on. Texts: `ConfirmMessages` (`hold`, `invite`, `choose`, `option`, `done`, `cancelled`), English by default, overridable globally (`commandConfirm.messages`) and per command (`confirm.messages`).
- **Rendering**: `hold` is drawn by its target. `Nabu.svelte` sets `data-command-target="hold"` and `--nb-command-progress` on the element of `pending.target` (a block with a mounted `element`, or a DOM node) and ships a neutral outline + fill; blocks can ask `nabu.pendingCommandOn(block)` and draw their own. `CommandInvite` also serves as the fallback for a hold without mountable target (`hold: 'auto'`). `CommandChooser` only renders: the keyboard is the engine's, clicks call `nabu.commandConfirm.choose(i)`. Both are `position: fixed`, caret-anchored (flip / clamp as `SlashMenu`), `data-nabu-ui`.
- **Regions lot 2 needs**: declare `region:merge-previous` with `keys: ['Backspace']`, a `when` built on its `commandContext` facts (`atStartOfRegion`...), `confirm: { strategy: 'hold', target: (ctx) => <the marker block> }`, and have the marker component draw `nabu.pendingCommandOn(block)?.progress` (or rely on the default `data-command-target` style). `region:split` on `Mod-Enter` needs no confirmation. Pick default keys that do not tie with other commands in the same context.

---

## 8. Implementation notes — Regions lot 2 (2026-10-22)

The first client of `hold` (ADR 016 §8): `region:merge-previous` (`Backspace`, `Shift-Backspace`) and `region:merge-next` (`Delete`), `confirm: { strategy: 'hold', target: marker, messages: { hold } }` where `target` is the seam being removed and `messages.hold` builds the prompt from the command label ("Hold Backspace to merge with “…”"). Facts: `atStartOfRegion` / `atEndOfRegion` / `region` / `previousRegion` / `nextRegion` / `inRootTextBlock`. `region:split` on `Mod-Enter` has no confirmation and coexists with `todo:toggle` (different `when`: the split needs a root text block; the toggle is scoped to list items). Learned: (1) a command with `confirm` on a bare key swallows the repeats while its `when` holds, which is exactly the "erasing a word stops at the boundary" rule; no extra code in the extension. (2) A key cannot carry `data`, so a command parameterised by `data` (`region:move`) needs fixed-argument siblings (`region:move-up` / `move-down`) to be bindable. (3) A confirmation protects only what goes through the command: the engine's own text merge got a generic `onBeforeMerge(nabu, survivor, victim)` hook (`TextBehavior`, both directions) so that an extension can refuse a merge whatever started it.
