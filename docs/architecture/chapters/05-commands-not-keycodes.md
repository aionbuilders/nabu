---
title: Commands, not keycodes
description: One action bus, a keymap you can rebind, confirmations that never trap you.
chapter: 5
adrs: [11, 17]
xray: command-keys
---

Press Ctrl+B in the editor below, then Ctrl+Enter with the caret in the paragraph, then again in the to-do item. The panel does not print a keycode. It prints the chord, the commands bound to it, whether each one applies here, and which one the engine took. Same keys, two different commands, chosen by where the caret is.

## The old way: first to answer wins

Until ADR 017 (22 October), every extension listened for `keydown` on its own and the first one to handle the key won. [ADR 017](/architecture/decisions/017) lists what that cost us. Nobody knew that two extensions wanted the same key, so conflicts were silent. You could not rebind a shortcut, or show a reliable help sheet. And there was no common way to ask "are you sure?" before a risky action.

## A command is declared

An extension now declares its commands: an id, a label, default keys, the context where it applies, what it does. This is the real declaration of the to-do toggle ([`list/index.js`](https://github.com/aionbuilders/nabu/blob/main/src/lib/blocks/list/index.js)):

```js
'todo:toggle': {
  label: 'Toggle to-do',
  keys: ['Mod-Enter'],
  scope: 'list-item',
  when: (ctx) => selectedTodoItems(ctx.nabu).length > 0,
  run: (nabu) => toggleSelectedTodos(nabu),
},
```

`Mod-Enter` is also the key of `region:split`, "cut here". They do not fight, because of `when` and `scope`. On every `keydown` the engine looks up the commands bound to the chord, keeps those whose `when` is true, and takes the one whose `scope` is the type of the block under the caret before a generic one. If several still tie, the user is asked to choose. If none applies, the key falls through to the older `onKeyDown` hooks, then to the browser. IME compositions are never touched ([`commands.js`](https://github.com/aionbuilders/nabu/blob/main/src/lib/utils/commands.js)). The engine names no block type: a command's `when` reads facts that extensions add to the context.

Some rules are strict on purpose. `Mod` is Cmd on a Mac and Ctrl elsewhere, nothing else. A chord that the browser keeps (Ctrl+W, Ctrl+T, Ctrl+1…) is refused. A bare key such as Backspace or Enter needs a `when`, because otherwise it would swallow that key everywhere ([`keys.test.js`](https://github.com/aionbuilders/nabu/blob/main/tests/unit/keys.test.js) and [`commands.test.js`](https://github.com/aionbuilders/nabu/blob/main/tests/unit/commands.test.js)).

## And every command is an action

[ADR 011](/architecture/decisions/011) gave the editor one public entry point for "do this": `nabu.exec(topic, data)`. A command is also an action, so `nabu.exec('mark:bold')` works without a keyboard, from a toolbar, a menu or your own script. The bus runs on a small event library (`@aionbuilders/pulse`) internally, hidden behind `exec` so that it can change without breaking you.

Rebinding is data: `createEditor({ keymap: { 'mark:bold': ['Mod-Shift-b'] } })`, and `[]` disables a shortcut. `nabu.commands.list()` returns every command with its keys already formatted for the platform, which is how a help sheet can write itself. See [Commands and keymap](/docs/guides/commands-and-keymap).

## Confirmations that cannot trap you

Some actions should not fire on one keypress. Merging two regions is one. The registry has three strategies, picked by each command: **hold** the key on the target, **invite** at the cursor (press again to confirm), or **choose** between options. The first client is the region merge, bound to Backspace at the start of a region. You must hold it for 700 ms, and a held key that arrives from earlier text is stopped at the boundary: someone erasing a sentence by keeping Backspace down never erases a seam. The command also runs without the hold through `exec`, so a menu or a screen reader has a way in. [Chapter 07](/architecture/chapters/we-got-regions-wrong-once) comes back to it.

> [!TIP]
> A shortcut is data, so it can be remapped, listed, disabled and explained. The toolbar, the menu and the keyboard call the same command. And a risky command asks for its confirmation in one place, not in each extension.

> [!WARNING]
> Not everything is a command yet. Tab in lists, the code block's keys, the toggle, Enter and Backspace inside blocks and the slash menu's keyboard still live in the extensions' own hooks and cannot be rebound ([the guide](/docs/guides/commands-and-keymap) says so). Two systems coexist, and so does their complexity. `nabu.exec` is asynchronous, so do not expect a value back, and a topic that no extension declares does nothing and raises no error. Making `Mod` strict broke a habit: on a Mac, Ctrl+B no longer bolds (ADR 017, lot 1 notes). Conflicts are only caught at registration when two commands share a chord and a scope. Overlapping `when` conditions show up at runtime, which is why the chooser exists. We treat that chooser as a safety net, not a mode.
