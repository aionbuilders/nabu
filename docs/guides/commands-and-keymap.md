---
title: Commands and keymap
description: Run editor actions with nabu.exec, declare commands with keyboard shortcuts, remap or disable shortcuts with the keymap option, ask for confirmations, and configure Tab.
section: guides
order: 20
---

# Commands and keymap

Two layers let you act on the editor from the outside and let an extension react to the keyboard:

- the **action bus**: `nabu.exec(topic, data)` runs a named action (toggle a mark, transform a block, undo). It is what a toolbar button or your own script calls;
- **commands**: an action that also has a label, default keyboard shortcuts and a context in which it applies. The engine resolves the keys, you can remap them, and you can list them to build a help sheet.

Every command is also an action, so `nabu.exec('mark:bold')` always works, with or without the keyboard.

## The action bus: `nabu.exec`

```js
nabu.exec('mark:toggle', { mark: 'bold' });
nabu.exec('heading:2');
await nabu.exec('undo');
```

`exec(topic, data?)` returns a promise. Fire and forget when you do not need the result; `await` it before reading the document, because most actions commit asynchronously.

Things to know:

- Actions act on the **current selection**. A toolbar button must not take the focus away from the editor (use `mousedown` + `preventDefault`), or the selection is gone when the action runs. `exec` re-reads the DOM selection first, so a selection made with the keyboard a moment ago is taken into account.
- A topic that no loaded extension declares **does nothing and raises no error**. `exec('heading:1')` is silent in an editor without `HeadingExtension`.
- Two extensions may declare the same topic: all their handlers run.

### The built-in topics

These are the topics of the built-in extensions. A topic exists only when its extension is loaded.

| Topic | Extension | What it does |
|---|---|---|
| `undo`, `redo` | the engine | History. Always available |
| `mark:toggle` `{ mark }` | `RichTextExtension` | Toggle `'bold'`, `'italic'`, `'underline'`, `'code'` or `'strikethrough'` |
| `mark:apply` `{ mark, value }`, `mark:remove` `{ mark }` | `RichTextExtension` | Apply or remove a mark on the selection |
| `bold`, `italic`, `underline`, `strikethrough` | `RichTextExtension` | Short aliases of `mark:toggle` |
| `link:set` `{ href }`, `link:remove`, `link:toggle` `{ href }` | `RichTextExtension` | Links on the selection. An unsafe URL (`javascript:`...) is refused |
| `block:transform` `{ type, props? }` | `BlockExtension` | Turn the block holding the caret into another type |
| `paragraph`, `heading:1` ... `heading:6` | `ParagraphExtension`, `HeadingExtension` | Aliases of `block:transform` |
| `blockquote`, `callout`, `toggle` | their extension | The same, for these blocks |
| `list:convert` `{ listType }` | `ListItemExtension` | Make the block a list: `'bullet'`, `'ordered'` or `'todo'` |
| `list:indent`, `list:unindent` | `ListItemExtension` | Nest or un-nest the current list item |
| `divider:insert` | `DividerExtension` | A divider after the block (or in place of an empty one) |
| `image:pick`, `video:pick`, `file:pick` | `ImageExtension`... | Open the file picker and insert the result |
| `image:insert` `{ ref, alt? }`, `video:insert`, `file:insert` | `ImageExtension`... | Insert from a URL or a stored reference |
| `region:*` | `RegionsExtension` | Structure operations: see [Regions](./regions.md) |

A few details:

- `mark:toggle` and the aliases act on the selected text. With a **collapsed caret** they toggle the mark for the *next typed text* instead (a "stored mark"). `mark:apply`, `mark:remove` and the link topics do nothing without a selected range.
- `block:transform` works on the block holding the caret and puts the caret back after the change.
- `code` is declared twice: by `RichTextExtension` (the inline code mark) and by `CodeExtension` (the code block), so `exec('code')` triggers both when both are loaded. Use `mark:code` for the mark and `block:transform` with `{ type: 'code' }` for the block.

```js test
import { createDocumentEditor } from '@aionbuilders/nabu';

const engine = createDocumentEditor();

// Every command is an action, and an unknown topic is harmless.
await engine.exec('mark:bold'); // no selection: nothing to bold, no error
await engine.exec('topic:nobody-declared');

expect(engine.commands.has('mark:bold')).toBe(true);
expect(engine.commands.has('topic:nobody-declared')).toBe(false);
```

### Declare actions in an extension

```js test
import { createEditor, ParagraphExtension } from '@aionbuilders/nabu';
import { extension } from '@aionbuilders/nabu/extend';

const calls = [];

const Counter = extension('counter', {
  actions: {
    // (nabu, data, topic): the editor, the payload given to exec(), and the exact topic emitted.
    'counter:add': (nabu, data, topic) => { calls.push([topic, data?.by ?? 1]); },
    // An alias that delegates to another action.
    'counter:inc': (nabu) => nabu.exec('counter:add', { by: 1 })
  }
});

const engine = createEditor({ preset: [ParagraphExtension], extensions: [Counter] });

await engine.exec('counter:add', { by: 5 });
await engine.exec('counter:inc');

expect(calls).toEqual([['counter:add', 5], ['counter:add', 1]]);
```

Topics are namespaced with colons (`mark:toggle`, `list:indent`); a single segment is a short alias (`bold`). Declare an alias next to the block it is about, so that it disappears with the extension.

Use an **action** when something is only called from code. Use a **command** as soon as a shortcut, a label or a context makes sense.

## Commands

A command is declared in the `commands` field of an extension, keyed by id:

```js test
import { createEditor, ParagraphExtension } from '@aionbuilders/nabu';
import { extension } from '@aionbuilders/nabu/extend';

const ran = [];

const Notes = extension('notes', {
  commands: {
    'notes:stamp': {
      label: 'Stamp the paragraph',
      keys: ['Mod-Alt-s'],
      // Where the command applies. Receives the context of the key press.
      when: (ctx) => ctx.block?.type === 'paragraph',
      // (nabu, ctx, data): data is what exec() was given; a key press has none.
      run: (nabu, ctx, data) => { ran.push(data?.mark ?? '*'); }
    }
  }
});

const engine = createEditor({ preset: [ParagraphExtension], extensions: [Notes], platform: 'other' });

// Runs without any key. `when` is not checked here: exec is explicit.
await engine.exec('notes:stamp', { mark: '#' });
expect(ran).toEqual(['#']);

const info = engine.commands.get('notes:stamp');
expect(info).toMatchObject({ id: 'notes:stamp', label: 'Stamp the paragraph', keys: ['Mod-Alt-s'], display: ['Ctrl+Alt+S'], extension: 'notes' });
```

| Field | |
|---|---|
| `label` | A string, or a function of the context. Shown in help sheets and prompts |
| `keys` | Default shortcuts, as [chord strings](#chords). A command may have several, or none |
| `when(ctx)` | Where the command applies. Absent means everywhere. **Required for a key without a modifier** (see below) |
| `scope` | A block type the command belongs to. In a block of that type, it beats a generic command on the same key |
| `run(nabu, ctx, data?)` | The work. Returning `false` **synchronously** from a key press means "not handled": the key goes on to the next candidate, then to the native behaviour. Anything else (a promise included) means handled |
| `confirm` | Ask the user first: [Confirmations](#confirmations) |

### The context

`when`, `run` and `label` receive a context built at each key press:

| Field | |
|---|---|
| `nabu` | The editor |
| `event` | The `KeyboardEvent`, or `null` when the command runs from `exec` |
| `block` | The block holding the caret |
| `selection`, `isCollapsed` | The selection and whether it is a caret |
| `ancestors` | Types of the block's ancestors, nearest first |
| `inRoot` | The block is a direct child of the document, not inside a container |

An extension can add **facts** with `commandContext(nabu, ctx)`. The regions extension adds `region`, `atStartOfRegion`... so that its commands can say "only at the start of a region". The engine names no block type; facts are how an extension tells the commands what it knows. Keep a provider cheap: it is called for each candidate key press.

```js test
import { createEditor, ParagraphExtension } from '@aionbuilders/nabu';
import { extension } from '@aionbuilders/nabu/extend';

let mode = 'loud';

const Facts = extension('facts', {
  // Called for each candidate key press, and for commands.list() / get().
  commandContext: () => ({ mode }),
  commands: {
    'facts:calm-down': {
      label: 'Calm down',
      when: (ctx) => ctx.mode === 'loud', // the fact, added by commandContext
      run: () => {}
    }
  }
});

const engine = createEditor({ preset: [ParagraphExtension], extensions: [Facts] });

// A command is `available` when its `when` holds in the current context.
expect(engine.commands.get('facts:calm-down').available).toBe(true);
mode = 'quiet';
expect(engine.commands.get('facts:calm-down').available).toBe(false);
```

### How a key press is resolved

On `keydown` (ignored during an IME composition and when someone already called `preventDefault`):

1. The chord of the event is computed. If no command is bound to it, nothing else happens: typing costs one chord computation.
2. The candidates are the bound commands whose `when` is true (a `when` that throws counts as false).
3. A command whose `scope` is the type of the caret's block goes first, then registration order: the engine's commands, then the extensions in list order.
4. If several candidates remain with the same rank, the user is asked to choose between them (the `choose` strategy below). The ambiguity is also reported to the developer with `nabu.warn`. Give your defaults different keys or different `when`s so this stays a safety net.
5. A candidate whose `run` returns `false` synchronously passes the key to the next one. If none handles it, the key falls back to the older `onKeyDown` hooks, then to the browser.

A key handled by a command is `preventDefault`ed.

### Chords

A chord is written `[Modifier-]*Key`, with modifiers joined by `-`, case-insensitive:

- `Mod` is Cmd on macOS and Ctrl elsewhere. Use it for the main shortcut modifier; `Ctrl`, `Alt` (`Option`), `Shift` and `Meta` (`Cmd`) are the explicit keys.
- `Key` is a `KeyboardEvent.key` name (`Enter`, `Backspace`, `Tab`, `ArrowUp`, `F2`; aliases `Esc`, `Return`, `Del`, `Space`, `Up`...) or one printable character.
- Letters are matched in lower case, and `Shift` stays a separate modifier (`Mod-Shift-z`). Digits and symbols are matched by the character the keystroke **produces**, so `Shift` is not part of the chord: write `Mod-!`, not `Mod-Shift-1`.
- On a non-Latin layout, or with a dead key, the physical key is used, so `Mod-b` works whatever the layout.

```js test
import { canonicalChord, parseChord, isReservedChord, RESERVED_CHORDS } from '@aionbuilders/nabu/extend';
import { formatChord } from '@aionbuilders/nabu';

// Mod resolves per platform; the canonical form orders the modifiers.
expect(canonicalChord('Mod-Shift-Z', { platform: 'mac' })).toBe('Shift-Meta-z');
expect(canonicalChord('Mod-Shift-Z', { platform: 'other' })).toBe('Ctrl-Shift-z');
expect(canonicalChord('Esc')).toBe('Escape');

// Invalid chords are null: an unknown key, and Shift on a symbol.
expect(parseChord('Mod-Nope')).toBeNull();
expect(parseChord('Mod-Shift-1')).toBeNull();
expect(canonicalChord('Mod-!', { platform: 'other' })).toBe('Ctrl-!');

// Displaying a shortcut, per platform.
expect(formatChord('Mod-Shift-z', { platform: 'mac' })).toBe('⇧⌘Z');
expect(formatChord('Mod-Shift-z', { platform: 'other' })).toBe('Ctrl+Shift+Z');
expect(formatChord('Mod-Enter', { platform: 'mac' })).toBe('⌘↩');

// The browser and the OS keep some chords for themselves.
expect(RESERVED_CHORDS).toContain('Mod-w');
expect(isReservedChord(parseChord('Mod-w', { platform: 'other' }), 'other')).toBe(true);
```

### Keys that are refused

A command is always registered, and always runnable with `exec`. Only its **keys** can be refused, each with a developer warning (shown when `nabu.debugging` is on):

- an invalid chord;
- a **reserved chord**: closing, opening and switching tabs and windows, quitting, reload, address bar, zoom, devtools (`RESERVED_CHORDS` lists them);
- a chord **without Ctrl, Alt or Meta** (a bare letter, `Enter`, `Backspace`, `Shift-Tab`) on a command that has no `when`. It would swallow that key everywhere. Add a `when` and the key is accepted: `Backspace` bound to a command that only applies at the start of a region is fine;
- all the keys of a command whose `confirm` strategy is unknown: a risky command is never run from a key without its confirmation.

Two commands with the same chord **and** the same `scope` warn that they are ambiguous; both are kept and the ambiguity is settled at key press (step 4 above).

```js test
import { createEditor, ParagraphExtension } from '@aionbuilders/nabu';
import { extension } from '@aionbuilders/nabu/extend';

const run = () => {};
const Strict = extension('strict', {
  commands: {
    'strict:close': { label: 'Close', keys: ['Mod-w', 'Mod-j'], run },
    'strict:bare': { label: 'Bare', keys: ['Backspace', 'Enter'], run },
    'strict:guarded': { label: 'Guarded', keys: ['Backspace'], when: (ctx) => ctx.isCollapsed, run }
  }
});

const engine = createEditor({ preset: [ParagraphExtension], extensions: [Strict], platform: 'other' });

expect(engine.commands.get('strict:close').keys).toEqual(['Mod-j']); // Mod-w is reserved
expect(engine.commands.get('strict:bare').keys).toEqual([]); // no modifier, no `when`
expect(engine.commands.get('strict:guarded').keys).toEqual(['Backspace']);
```

## The `keymap` option

`keymap` replaces the shortcuts of commands, by id, when you create the editor. An empty array disables a command's keys; the command stays available to `exec`. The same checks apply as for declared keys.

```js test
import { createDocumentEditor } from '@aionbuilders/nabu';

const engine = createDocumentEditor({
  platform: 'other',
  keymap: {
    'mark:bold': ['Mod-Alt-b'], // moved
    'mark:italic': [],          // disabled
    'region:move-up': ['Mod-Alt-ArrowUp']
  }
});

expect(engine.commands.get('mark:bold').keys).toEqual(['Mod-Alt-b']);
expect(engine.commands.get('mark:italic').keys).toEqual([]);
await engine.exec('mark:italic'); // still a command
```

An id that no extension declared is reported with `nabu.warn` (`keymap["x"] names no registered command`); only the commands of the loaded extensions can be remapped. The keymap is read when the editor is built: to change it, create a new editor.

`keymap` is an option of every factory (`createEditor`, `createDocumentEditor`, `createPersistedEditor`...). Bind a keyless command such as `region:move-up` the same way: a key cannot carry `data`, so commands meant for the keyboard come in fixed-argument pairs (`region:move-up` and `region:move-down`, not one `region:move`).

### The default shortcuts

`nabu.commands.list()` is the live source of truth. These are the defaults of the built-in extensions (written for `Mod`):

| Command | Keys | Extension |
|---|---|---|
| `undo` | `Mod-z` | the engine |
| `redo` | `Mod-Shift-z`, `Mod-y` | the engine |
| `block:move-up`, `block:move-down` | `Mod-Shift-ArrowUp`, `Mod-Shift-ArrowDown` | the engine |
| `mark:bold` | `Mod-b` | `RichTextExtension` |
| `mark:italic` | `Mod-i` | `RichTextExtension` |
| `mark:underline` | `Mod-u` | `RichTextExtension` |
| `mark:code` | `Mod-e` | `RichTextExtension` |
| `mark:strikethrough` | `Mod-Shift-x` | `RichTextExtension` |
| `todo:toggle` | `Mod-Enter` (in a list item) | `ListItemExtension` |
| `region:split` | `Mod-Enter` | `RegionsExtension` |
| `region:exit` | `Mod-Shift-Enter` | `RegionsExtension` |
| `region:merge-previous` | `Backspace`, `Shift-Backspace` (hold) | `RegionsExtension` |
| `region:merge-next` | `Delete` (hold) | `RegionsExtension` |
| `region:demote`, `region:promote` | `Tab`, `Shift-Tab` (in a region title) | `RegionsExtension` |

`Mod-Enter` is shared by `todo:toggle` and `region:split`: the first has `scope: 'list-item'`, so it wins inside a to-do, and the split applies elsewhere.

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor({ platform: 'other' });
const keysOf = (id) => engine.commands.get(id).keys;

expect(keysOf('undo')).toEqual(['Mod-z']);
expect(keysOf('redo')).toEqual(['Mod-Shift-z', 'Mod-y']);
expect(keysOf('mark:bold')).toEqual(['Mod-b']);
expect(keysOf('todo:toggle')).toEqual(['Mod-Enter']);
expect(keysOf('region:split')).toEqual(['Mod-Enter']);
expect(engine.commands.get('region:merge-previous').confirm.strategy).toBe('hold');
```

Not everything is a command yet. Tab in lists, the code block's keys, the toggle, Enter and Backspace inside blocks, and the modal keyboard of the slash menu are still handled by the extensions' own hooks and cannot be remapped. They are moving to commands over time.

## Listing commands

`nabu.commands.list()` returns a plain snapshot of every command, in registration order: build a help sheet, a shortcut cheat sheet or a command palette from it. The snapshot is not reactive; the set of commands is fixed once the editor is built.

```js test
import { createDocumentEditor } from '@aionbuilders/nabu';

const mac = createDocumentEditor({ platform: 'mac' });
const bold = mac.commands.list().find((command) => command.id === 'mark:bold');

expect(bold).toMatchObject({
  id: 'mark:bold',
  label: 'Bold',
  keys: ['Mod-b'],       // as declared
  display: ['⌘B'],       // formatted for the platform
  extension: 'rich-text',
  confirm: null
});
expect(typeof bold.available).toBe('boolean'); // `when` in the current context

// The same command, on another platform.
const other = createDocumentEditor({ platform: 'other' });
expect(other.commands.get('mark:bold').display).toEqual(['Ctrl+B']);
```

Each entry has `id`, `label` (a label function is called with the current context), `keys`, `display`, `scope`, `extension` (`'core'` for the engine's own), `available` and `confirm`. `get(id)` returns one entry or `null`; `has(id)` tells whether a command exists; `run(id, data)` is `exec` with a warning for an unknown id. `list(ctx)` and `get(id, ctx)` evaluate labels and `available` against a context you pass.

The `platform` option (`'mac'` or `'other'`) decides what `Mod` means and how shortcuts are displayed. It is detected from the browser; set it for tests and server-side rendering. To show a shortcut anywhere else in your UI, `formatChord(chord, { platform })` is exported from `@aionbuilders/nabu`.

## Confirmations

Some commands are too risky to run from a single key press: merging two regions, for example. A command can declare how it asks for confirmation, with `confirm: { strategy }`. There are three strategies. The engine drives the keyboard and exposes the state; the default look is deliberately neutral, and the appearance is yours to design.

A confirmation only protects **key presses**. `nabu.exec('region:merge-previous')` runs at once, with no confirmation: that is the accessible path (a menu, a palette, a button).

### `hold`: hold the key on a target

```js
'region:merge-previous': {
  label: (ctx) => `Merge with "${ctx.previousRegion.title}"`,
  keys: ['Backspace'],
  when: (ctx) => ctx.isCollapsed && ctx.atStartOfRegion,
  confirm: {
    strategy: 'hold',
    holdMs: 700,                     // the default
    target: (ctx) => ctx.region.block // what shows the progress: a block or an element
  },
  run: (nabu, ctx) => mergeWithPrevious(nabu, ctx)
}
```

- A **fresh press** (not an auto-repeat) that starts in the command's context begins the count. `progress` goes from 0 to 1; the command runs when it reaches 1.
- Releasing the key, or pressing any other key, cancels. The other key then does its normal job.
- A hold that began elsewhere never counts: auto-repeats of a key held down *before* the caret reached the context are swallowed at the context, so you have to release and press again. This protects someone who deletes a sentence by keeping Backspace down: it stops at the boundary instead of merging what is behind it.

### `invite`: press twice

The first press shows a hint at the caret ("Press Backspace again to confirm"); the same chord again (a fresh press) runs the command. Escape, another key, a click or a timeout (5 seconds by default) cancels.

```js
confirm: { strategy: 'invite', inviteMs: 5000 }
```

### `choose`: pick between actions

Used automatically when several commands tie on a key, and explicitly by a command that offers variants. Options appear at the caret: arrows and Enter, a number, or a click; Escape cancels. `run` receives the chosen option as its third argument.

```js
'notes:insert': {
  label: 'Insert...',
  keys: ['Mod-Alt-i'],
  confirm: {
    strategy: 'choose',
    options: (ctx) => [
      { id: 'date', label: 'Today', detail: 'Mod' },
      { id: 'time', label: 'Now', group: 'Time' }
    ],
    footer: 'Arrows to choose, Enter to insert'
  },
  run: (nabu, ctx, option) => insert(nabu, option.id)
}
```

An option has `id`, `label`, optional `display`, `group` (consecutive options with the same group sit under a small header) and `detail` (a muted, right-aligned text); any other field you add comes back in `run`. Choosing *is* the confirmation: the chosen command runs at once.

A `choose` is a safety net, not a normal mode: design the default keys so that they do not step on each other.

### Rendering

`hold` is drawn by its **target**: the editor marks the target element with `data-command-target="hold"` and a `--nb-command-progress` custom property (0 to 1), and ships a neutral outline and fill. A block can read `nabu.pendingCommandOn(block)?.progress` and draw its own (the region seam does this).

`invite` and `choose` are drawn by two optional components of `@aionbuilders/nabu/ui`, mounted next to the editor:

```svelte
<script>
  import { NabuEditor, createFullEditor } from '@aionbuilders/nabu';
  import { CommandInvite, CommandChooser } from '@aionbuilders/nabu/ui';

  const engine = createFullEditor();
</script>

<CommandInvite {engine} />
<CommandChooser {engine} />
<NabuEditor {engine} />
```

`CommandInvite` also shows a hold whose target cannot draw (`hold="auto"`, the default; `true` always shows it, `false` never). Both are positioned at the caret and flip and clamp to stay in the viewport. Without them, the confirmations still work, and screen readers still get the announcements; there is only nothing on screen for `invite` and `choose`.

The state is public and reactive, so you can draw your own:

- `nabu.pendingCommand`: `null`, or `{ id, strategy, label, display, message, target, progress, options, selectedIndex }`;
- `nabu.pendingCommandOn(target)`: the pending confirmation when it is about `target`;
- `nabu.cancelPendingCommand()`: cancel it, nothing runs;
- `nabu.commandAnnouncement`: the text of the editor's polite live region.

### Options and messages

```js
createFullEditor({
  commandConfirm: {
    holdMs: 500,       // default for `hold` (700)
    inviteMs: 8000,    // default for `invite` (5000)
    messages: {        // prompts and outcomes announced to screen readers
      hold: ({ keys, label }) => `Maintenez ${keys} : ${label}`,
      cancelled: ({ label }) => `Annulé : ${label}`
    }
  }
});
```

`messages` accepts `hold`, `invite`, `choose`, `option`, `done` and `cancelled`, each a string or a function of the parameters (English by default). A command can override them with its own `confirm.messages`. The live region announces prompts, and outcomes when the user asked (a release, Escape, a timeout), not when they simply typed on.

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor({
  commandConfirm: { holdMs: 500, messages: { hold: ({ label }) => `Hold to: ${label}` } }
});

expect(engine.pendingCommand).toBeNull();
expect(engine.commandAnnouncement).toBe('');
expect(engine.commands.get('region:merge-previous').confirm.strategy).toBe('hold');
expect(() => engine.cancelPendingCommand()).not.toThrow(); // nothing pending: nothing happens
```

## The `tab` option

What Tab and Shift+Tab do in a **plain text block**, where nothing structural uses them:

| Mode | Behaviour |
|---|---|
| `'focus'` | The browser default: Tab leaves the editor, like a `<textarea>` |
| `'stay'` | Both keys are swallowed and the caret stays. **Escape, then Tab** leaves the editor |
| `'indent'` | Tab inserts a tab character at the caret (replacing a selection inside one block); Shift+Tab removes one just before the caret. With several blocks selected it behaves like `'stay'`. Same Escape-then-Tab way out |

Structural meanings always come first and ignore the option: list indent and un-indent, indentation in a code block, region title promote and demote (commands), and anything an extension handles itself.

The default depends on the preset: `'focus'` for `MinimalPreset` and `TextPreset`, `'stay'` for `DocumentPreset` and `FullPreset`, `'focus'` for a custom array. An explicit `tab` always wins. An unknown value warns and falls back to the preset default; `'nest'` (Notion-style) is planned and not implemented.

A `'stay'` or `'indent'` editor would otherwise be a keyboard trap, so the editor root carries an `aria-description`, `"Press Escape then Tab to leave the editor"`, while the mode traps Tab. Translate or remove it with `tabHint`:

```js test
import { createTextEditor, createDocumentEditor } from '@aionbuilders/nabu';

expect(createTextEditor().tab).toBe('focus');
expect(createDocumentEditor().tab).toBe('stay');
expect(createTextEditor({ tab: 'indent' }).tab).toBe('indent');

// An unknown value falls back to the preset default.
expect(createTextEditor({ tab: 'sideways' }).tab).toBe('focus');

// The announcement: a string, or false for none.
expect(createDocumentEditor().tabHint).toBe('Press Escape then Tab to leave the editor');
expect(createDocumentEditor({ tabHint: 'Echap puis Tab pour quitter' }).tabHint).toBe('Echap puis Tab pour quitter');
expect(createDocumentEditor({ tabHint: false }).tabHint).toBe(false);

// `tab` is reactive: change it at runtime.
const engine = createTextEditor();
engine.tab = 'stay';
expect(engine.tab).toBe('stay');
```

## Gaps

- There is no public API to start a `hold`, `invite` or `choose` from code (the regions extension uses an internal one for `:::`). A confirmation starts from a key press only.
- Commands cannot be registered after the editor is built, and `commands.list()` is not reactive.
- `nabu.exec('code')` runs both the inline mark and the block transform when both extensions are loaded (see above).
