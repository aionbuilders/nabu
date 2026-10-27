---
title: Extensions
description: What an extension is, how to use the built-in ones, and how to write your own with extension(): a block and its component, actions, input rules, hooks, commands and slash menu entries, and the stable contract (plus the unstable nabu.internals) a third-party block can rely on.
section: guides
order: 10
---

# Extensions

Everything an editor can do is added by an **extension**: a block type, a text behavior, a paste handler, a command, a slash menu entry. The engine itself knows no block type. An editor is a list of extensions, and a [preset](../getting-started/presets.md) is such a list ready to use.

An extension is a plain object made by the `extension(name, init)` function (or `new Extension(name, init)`; they are the same). All the fields of `init` are optional:

| Field | What it adds |
|---|---|
| `block` | A block class registered under the extension's `name` (its **type**) |
| `component` | The Svelte component that renders blocks of that type |
| `defaultBlock` | Marks `block` as the editor's default text block (the paragraph does) |
| `actions` | Topics for `nabu.exec(topic, data)` |
| `commands` | Actions that also have a label, keyboard shortcuts and a context: see [Commands and keymap](./commands-and-keymap.md) |
| `inputRules` | Rewrites applied while typing (markdown shortcuts, typography) |
| `hooks` | Functions called by the engine at defined moments |
| `slashCommands` | Entries of the slash menu |
| `serializers` | Document serializers by format (`nabu.serialize(format)`) |
| `pasteInterpreters`, `pasteFileHandlers` | What a paste makes of text, HTML and files |
| `commandContext` | Facts added to the context of `when` / `run` of commands |
| `loroTextStyles` | How a text attribute grows when typing at its edge |

This guide covers the first half of the list. Paste handlers are covered with the clipboard. What your block and extension code can rely on, and what it cannot, is in [Stability](#stability).

## Use the built-in extensions

Every built-in extension is exported from `@aionbuilders/nabu`. Pick them to build a preset, or add them to one:

```js test
import { createEditor, TextPreset, CalloutExtension, DividerExtension } from '@aionbuilders/nabu';

const engine = createEditor({ preset: TextPreset, extensions: [CalloutExtension, DividerExtension] });

engine.insert('callout', { text: 'Careful' });
engine.insert('divider');
await engine.commit();

expect(engine.children.map((block) => block.type)).toEqual(['paragraph', 'callout', 'divider']);
```

An extension's `name` is its identity. For a block extension it is the block type (`'callout'`), which is also what you pass to `engine.insert()`. Most built-ins are ready-made objects; a few are configurable and come as a function:

- `RegionsExtension({ types, messages })` (also `createRegionsExtension`): see [Regions](./regions.md);
- `createDialogueExtension({ dash })`: the dialogue line, with the dash you want to display (`DialogueExtension` is the default instance).

Order matters in one place: when two hooks answer the same event, they run in the order of the extension list (a hook of the extension that owns the block's type goes first).

## Write an extension

The smallest useful extension is one `actions` entry. An action is a function `(nabu, data, topic)` reached by `nabu.exec(topic, data)`:

```js test
import { createEditor, ParagraphExtension } from '@aionbuilders/nabu';
import { extension } from '@aionbuilders/nabu/extend';

const Shout = extension('shout', {
  actions: {
    'shout:all': (nabu, data) => {
      const loud = nabu.children.filter((block) => block.type === 'paragraph');
      for (const block of loud) block.insert(block.text.length, data?.suffix ?? '!');
      return nabu.commit();
    }
  }
});

const engine = createEditor({ preset: [ParagraphExtension], extensions: [Shout] });
engine.insert('paragraph', { text: 'Hello' });
await engine.commit();

await engine.exec('shout:all', { suffix: '!!' });
expect(engine.serialize('markdown')).toContain('Hello!!');
```

`exec` returns a promise; await it before reading the result. An action whose extension is not loaded does nothing and raises no error, so an `exec` of a topic that might be missing is safe. The built-in topics and the way they relate to commands are in [Commands and keymap](./commands-and-keymap.md).

### A custom block

A block type is three things: a **class** that owns the data and the serialization, a **component** that draws it, and the **extension** that registers both under a name.

For a block that holds text, extend `TextBlock`. It creates the text container and gives the block a `behavior` (a `TextBehavior`), which knows how to read the text as markdown, as JSON and as a clipboard fragment.

```js test
import { createEditor, TextPreset } from '@aionbuilders/nabu';
import { extension, TextBlock } from '@aionbuilders/nabu/extend';

class AsideBlock extends TextBlock {
  constructor(nabu, node) {
    super(nabu, node);
    // One serializer per format. 'json' is the document export; the last one is the clipboard.
    this.serializers.set('markdown', () => `<aside>${this.behavior.toMarkdown()}</aside>`);
    this.serializers.set('json', () => ({ id: this.id, type: 'aside', content: this.behavior.toJSON() }));
    this.serializers.set('application/x-nabu+json', (context = {}) => this.behavior.toClipboardBlock(context));
  }

  // The hint shown in an empty block.
  static placeholder = 'An aside...';

  // How the engine creates one: nabu.insert('aside', props) calls this.
  static create(nabu, type, props = {}, parentId = null, index = null) {
    const node = nabu.tree.createNode(parentId || undefined, index ?? undefined);
    node.data.set('type', 'aside');
    const block = new AsideBlock(nabu, node);
    if (props.text) block.insert(0, props.text);
    if (props.delta) block.applyDelta(props.delta);
    return block;
  }
}

const AsideExtension = extension('aside', { block: AsideBlock /* , component: Aside */ });

const engine = createEditor({ preset: TextPreset, extensions: [AsideExtension] });
engine.insert('aside', { text: 'By the way' });
await engine.commit();

expect(engine.serialize('markdown')).toContain('<aside>By the way</aside>');
expect(engine.serialize('json').blocks.at(-1)).toMatchObject({ type: 'aside', content: [{ text: 'By the way' }] });

// A JSON export round-trips through the class.
const copy = createEditor({ preset: TextPreset, extensions: [AsideExtension] });
await copy.importJSON(engine.serialize('json'));
expect(copy.children.at(-1).type).toBe('aside');
```

The component receives the block as its only prop. Keep the markup of a text block as it is below: the element is bound to `block.element`, carries the block id and type, and wraps a `RichText` that draws the block's `delta`. The editor preserves whitespace, so do not put any between the element and `<RichText>`.

```svelte
<!-- Aside.svelte -->
<script>
  import { RichText } from '@aionbuilders/nabu/extend';

  let { block } = $props();
</script>

<aside
  bind:this={block.element}
  data-block-id={block.id}
  data-block-type="aside"
  data-placeholder={block.placeholder}
  class="my-aside"
  class:selected={block.selected}
><RichText delta={block.delta} /></aside>

<style>
  .my-aside {
    white-space: pre-wrap;
    margin: 0 0 0.5em;
    padding: 0.5em 0.75em;
    border-left: 3px solid var(--nb-border, currentColor);
    background: var(--nb-surface, transparent);
  }
</style>
```

Then give the component to the extension. The engine renders a block with the component registered under its type:

```js
import Aside from './Aside.svelte';

export const AsideExtension = extension('aside', { block: AsideBlock, component: Aside });
```

What this minimal block does not do, and what a built-in block adds when it needs it:

- **Markdown and HTML import.** Without `markdownRules` / `fromMarkdown` and `htmlRules` / `fromHTML` static members, the `<aside>` markdown above is read back as text, not as an aside. The built-ins (`BlockquoteBlock`, `DividerBlock`) are the model to follow; the formats are described with the clipboard.
- **Void blocks** (a divider, an image) extend `Block` rather than `TextBlock`: no text behavior, `positions = 1`, a `getDOMPoint()` that returns `null`.
- **Containers** (a toggle, a callout with a body) extend `MegaBlock`, which owns children.

### Input rules: markdown shortcuts

An input rule rewrites the text while the user types. Its `pattern` is tested on the text **before the caret**, at each `insertText`; `sel.data` is the character being typed. Return `true` when the rule handled the key (the engine then does not insert the character); do **not** call `commit()` in the handler.

Here, typing `!!` then a space turns the block into an aside:

```js test
import { createEditor, TextPreset } from '@aionbuilders/nabu';
import { extension, TextBlock } from '@aionbuilders/nabu/extend';

const Aside = extension('aside', {
  block: class AsideBlock extends TextBlock {
    static create(nabu, type, props = {}, parentId = null, index = null) {
      const node = nabu.tree.createNode(parentId || undefined, index ?? undefined);
      node.data.set('type', 'aside');
      const block = new this(nabu, node);
      if (props.text) block.insert(0, props.text);
      return block;
    }
  },
  inputRules: [
    {
      pattern: /^!!$/,
      handler(nabu, block, match, sel) {
        if (sel.data !== ' ') return; // only when the space is typed
        block.behaviors.get('text').delete({ index: 0, length: 2 }); // remove the "!!"
        block.retype('aside'); // change the type in place (no commit here)
        return true;
      }
    }
  ]
});

const engine = createEditor({ preset: TextPreset, extensions: [Aside] });
engine.insert('paragraph', { text: '!!' });
await engine.commit();
const block = engine.children.at(-1);

// The editor calls the handler while the user types; here we do it by hand.
const [rule] = Aside.inputRules;
const typed = { from: 2, to: 2, isCollapsed: true, data: ' ' };
expect(rule.handler(engine, block, '!!'.match(rule.pattern), typed)).toBe(true);
await engine.commit();

expect(engine.children.at(-1).type).toBe('aside');
```

Rules do not run in a block that opts out of transformations (`transformsEnabled = false`, as in a code block). For a shortcut whose undo should give back what was typed, the built-ins use `nabu.shortcut(block, ' ', (behavior) => { ... })` from an `onBeforeInput` hook (the divider and the quote do); an input rule is the simpler path when that does not matter.

### Hooks

`hooks` are functions the engine calls at defined moments. They receive the editor first.

| Hook | Called | Return |
|---|---|---|
| `onInit(nabu)` | Once, when the editor is built | nothing |
| `onBeforeTransaction(nabu)` | At every `commit()`, before the changes are committed: the place to normalize the document | nothing |
| `onBeforeInput(nabu, event, block)` | Before the browser inserts or deletes text (`event.inputType`: `insertText`, `deleteContentBackward`, `insertParagraph`...) | `nabu.BREAK` to stop the engine, or `nabu.CONTINUE` |
| `onKeyDown(nabu, event, block)` | On a key press, after commands have had their turn | `nabu.BREAK` / `nabu.CONTINUE` |
| `onSplit(nabu, block, event, data)` | When Enter splits a block; `data` is `{ offset, delta }` | `{ block }` (the new block) to take over, or nothing |
| `onBeforeMerge(nabu, survivor, victim)` | Before two text blocks merge (Backspace, Delete) | `nabu.BREAK` to veto the merge |

`onBlockCreate`, `onBlockDelete`, `onBlockUpdate`, `onAfterTransaction` and `onInput` exist in the type but are **not called yet**: do not rely on them.

Any other name is a custom hook that your own code runs with `nabu.trigger(name, ...args)`:

```js test
import { createEditor, ParagraphExtension } from '@aionbuilders/nabu';
import { extension } from '@aionbuilders/nabu/extend';

const log = [];

const Audit = extension('audit', {
  hooks: {
    onInit: () => log.push('init'),
    onBeforeTransaction: () => log.push('commit'),
    // A custom hook: no meaning for the engine, run by nabu.trigger('audit:note', ...).
    'audit:note': (nabu, text) => log.push(`note: ${text}`)
  }
});

const engine = createEditor({ preset: [ParagraphExtension], extensions: [Audit] });
expect(log).toContain('init');

engine.insert('paragraph', { text: 'x' });
await engine.commit();
expect(log).toContain('commit');

engine.trigger('audit:note', 'hello');
expect(log.at(-1)).toBe('note: hello');
```

Prefer a command to a `onKeyDown` hook for any keyboard shortcut: commands are listed, remappable and conflict-checked. `onKeyDown` remains for keys that depend on the exact event.

### Commands

A command is an action with a label, default keys and a `when` that says where it applies. It runs from the keyboard and from `nabu.exec`:

```js
extension('aside', {
  block: AsideBlock,
  commands: {
    'aside:toggle': {
      label: 'Toggle aside',
      keys: ['Mod-Alt-a'],
      run: (nabu) => nabu.exec('block:transform', { type: 'aside' })
    }
  }
});
```

Keys, contexts, the `keymap` option and confirmations have their own guide: [Commands and keymap](./commands-and-keymap.md).

### Slash menu entries

`SlashMenu` has no entries of its own: it lists what the loaded extensions contribute in `slashCommands`. A block type that is not in the editor is therefore never offered.

```js test
import { createEditor, ParagraphExtension } from '@aionbuilders/nabu';
import { extension } from '@aionbuilders/nabu/extend';

const Aside = extension('aside', {
  actions: { aside: (nabu) => nabu.exec('block:transform', { type: 'aside' }) },
  slashCommands: [
    {
      title: 'Aside',
      icon: '!',
      aliases: ['note', 'tip'],
      group: 'blocks',
      order: 50,
      run: (nabu) => nabu.exec('aside')
    }
  ]
});

const engine = createEditor({ preset: [ParagraphExtension], extensions: [Aside] });
expect(engine.slashCommands.map((entry) => entry.title)).toContain('Aside');
```

| Field | |
|---|---|
| `title` | The label; the typed text after `/` matches it anywhere in the title |
| `icon` | A short text glyph |
| `aliases` | Other words that find the entry; they match the **start** of the typed text (`/no` finds `note`) |
| `subtitle` | A second line |
| `group` | `'text'`, `'lists'`, `'blocks'`, `'media'` or `'structure'`, in this display order. Any other string makes a group listed after them; no group goes last |
| `order` | Position inside the group, ascending (default 0). Ties keep the declaration order, whatever the load order of the extensions |
| `when(nabu, block)` | Limits the entry to where it applies; `block` holds the caret. Without it the entry is always offered |
| `run(nabu)` | Called after the typed `/query` is removed. The caret is in the block that held it |

`SlashMenu` also accepts a `commands` prop with extra entries of your own, sorted with the extensions'. The entries are plain data: a theme or an integrator replaces the icon of an entry by providing its own.

## Stability

A block or an extension reaches the engine through two doors, and only one of them is a promise.

1. **The stable contract.** Every member listed in the tables below is tagged `@public` in its JSDoc and typed. It follows the package's versioning: removing it, renaming it or changing what it means is a breaking change, announced in the changelog. New members may be added at any time. The list is pinned by a test (`tests/unit/extend-contract.test.js`), so a change to it is always deliberate. The contract is generous on purpose: it holds what the built-in blocks themselves use, which are the best model of a third-party block.
2. **`nabu.internals`.** Everything else the engine runs on: the machinery behind the stable members. It is reachable, typed and documented, and it is **unstable**: it may change, move or disappear in **any minor version**. Pin the package version if you use it, and read the changelog when you upgrade.

A member of the editor or of a block that is in neither list (you can see it in JavaScript, or in the types) has no promise either.

### The editor, `nabu`

| Member | What it is |
|---|---|
| `tree` | The document tree (Loro). `tree.createNode(parentId?, index?)` makes the node a block's `static create()` wraps; `node.data` holds the block's props |
| `doc` | The Loro document |
| `children` | The root blocks, in order (reactive) |
| `blocks` | Every block by id (reactive map) |
| `blocksByType` | Every block by type |
| `registry` | The block class by type (read it; extensions fill it) |
| `components` | The Svelte component by block type; an extension that reuses a built-in name replaces it |
| `defaultBlockType` | The type of the default text block (the extension with `defaultBlock: true`), or `null` |
| `extensions` | The extensions the editor was built with, in order |
| `systems` | Start/stop subsystems: `nabu.systems.set(name, { start, stop })` is called when the editor mounts and unmounts |
| `positions` | Caret positions of the whole document |
| `isEmpty` | True when there is no block |
| `lastVisibleBlock` | The deepest last block that can hold a caret |
| `transact` | `transact(mutate, cursorIntent?)`: run the Loro mutations, commit, then place the caret |
| `commit` | `commit({ origin? })`: commit the pending changes as one transaction (and one undo step, unless the origin starts with `nabu:silent`) |
| `isolateUndoStep` | Make the next commit its own undo step |
| `insert` | `insert(type, props?, parentId?, index?)`: create a block of a registered type and commit; returns the block |
| `delete` | `delete(block)`: remove a block from the tree (commit afterwards) |
| `shortcut` | `shortcut(block, trigger, transform)`: apply a markdown block shortcut so that undo gives the typed trigger back |
| `undo`, `redo` | History |
| `focus` | `focus(options?)`: place the selection once the DOM is ready (a promise) |
| `openTrailingCaret` | Make sure the document offers a caret after its last block |
| `resolveDocumentOffset` | The block and local offset that hold a document-wide caret offset |
| `importJSON`, `importMarkdown`, `importFragment` | Replace the whole document |
| `importRemote` | Apply a Loro snapshot or update from elsewhere (collaboration, sync) |
| `insertPasteBlock`, `createPasteBlock` | The paste toolbox an `acceptPaste` override builds on (no commit) |
| `exec` | `exec(topic, data?)`: run an action or a command; a promise |
| `trigger` | `trigger(hookName, ...args)`: run the hooks of that name, stopping at the first `BREAK` |
| `BREAK`, `CONTINUE` | What a hook returns to stop the engine, or to go on (also static: `Nabu.BREAK`) |
| `commands` | `list(ctx?)`, `get(id, ctx?)`, `has(id)`, `run(id, data?)`, `offer(id, ctx?)`, `invoke(entry, data?)`, `context(event?)` and `platform`: see [Commands and keymap](./commands-and-keymap.md) |
| `slashCommands` | The slash menu entries the extensions contribute |
| `serializers`, `serialize` | The document serializers by format, and `serialize(format)` |
| `isMarkActive` | Whether every selected text run carries a mark |
| `pendingCommand`, `pendingCommandOn`, `cancelPendingCommand`, `commandAnnouncement` | The command waiting for its confirmation (reactive), and its live-region text |
| `selection` | The selection, in terms of blocks: see below |
| `lang`, `spellcheck`, `tab`, `tabHint`, `placeholders` | The resolved options (reactive; assign to change them) |
| `composing`, `composingBlock` | An IME composition is running, and in which block |
| `debugging` | When true, `warn` logs to the console |
| `warn` | `warn(...args)`: a diagnostic, silent unless `debugging` |
| `internals` | The door to the unstable machinery: see below |

The subsystems an extension or the factories install are public too, with their own documentation: `nabu.regions` (from `RegionsExtension`, see [Regions](./regions.md)), `nabu.persistence` and its methods (from `createPersistedEditor`, see [Persistence and sync](./persistence-and-sync.md)), `Files.get(nabu)` and `Todos.get(nabu)`.

### The selection, `nabu.selection`

| Member | What it is |
|---|---|
| `anchorBlock`, `focusBlock` | The block where the selection starts and where it ends (the caret's block when collapsed) |
| `startBlock`, `endBlock`, `start`, `end` | The same in document order; `start` / `end` add the block's own `{ from, to }` |
| `blocks` | The set of blocks the selection covers |
| `isRange`, `isCollapsed` | Several blocks selected, and no text selected |
| `setCursor` | `setCursor(block, offset)`: put the caret in a block |
| `selectBlockText`, `selectBetween` | Select a block's text, or from one block to another |
| `sync` | Read the DOM selection now (`selectionchange` is asynchronous) |
| `setBaseAndExtent` | The DOM `Selection` method of that name, tracked for undo |
| `anchorNode`, `anchorOffset`, `focusNode`, `focusOffset`, `startOffset`, `endOffset`, `range`, `text`, `is` | The DOM selection, as reactive state |

### A block

Everything of `Block` is part of the contract: a block class overrides the methods it needs, and the engine and your code read the rest.

| Member | What it is |
|---|---|
| `nabu`, `node`, `id`, `type` | The editor, the tree node, the id (also the key in `nabu.blocks`) and the type |
| `parent`, `children`, `index`, `previous`, `next`, `parents` | Its place in the tree (reactive). `children` belongs to `MegaBlock` |
| `element` | The DOM element, bound by the component (`bind:this={block.element}`) |
| `behaviors` | Its behaviors by name; a text block has `'text'` |
| `serializers` | Its serializers by format: `'markdown'`, `'json'`, `'application/x-nabu+json'` |
| `selected`, `isSelectionStart`, `isSelectionEnd`, `isIntermediate` | How the selection covers it (reactive) |
| `selection`, `positions`, `wordCount`, `placeholder`, `component` | Its selection, size, hint text and component (reactive) |
| `splitsOnEnter`, `transformsEnabled`, `marksEnabled`, `hidesChildren`, `isolatesSelection`, `pastesAsPlainText` | Capability flags a subclass overrides |
| `requiredParent`, `adoptsPastedTypes` | Structural rules a subclass overrides |
| `retype` | `retype(type, props?)`: change the type in place (no commit); override when the block cannot simply change type where it stands |
| `transformTo` | `retype` then commit |
| `insert`, `delete`, `split`, `absorbs`, `mergeWith`, `consume` | Text and structure editing, which a subclass implements (Backspace, Delete, Enter, merge) |
| `acceptPaste`, `dragRange` | Let the block decide how a paste lands in it, and what travels when it is dragged |
| `resolveOffset`, `getDOMPoint`, `focus` | Map a document offset to a block and a DOM point |
| `beforeinput`, `keydown`, `ascend` | Event handling: the block's own handler, and the way an event goes up to its container and the hooks |
| `findForward`, `findBackward`, `findLastDescendant`, `getAdjacentSiblings` | Walk the tree |
| `commit`, `serialize`, `clearSelection`, `destroy` | Commit, serialize to a format, reset the selection flags, delete the block |

Statics, all optional unless said otherwise:

| Static | What it is |
|---|---|
| `create` | `create(nabu, type, props?, parentId?, index?)`: make the node and the block (**required** for a block type you insert) |
| `load` | `load(nabu, node)`: build the block of an existing node |
| `htmlRules`, `fromHTML`, `htmlSiblings` | Read pasted HTML: the elements the block takes (`HtmlRule[]`), how it reads one, which following siblings it absorbs |
| `markdownRules`, `fromMarkdown` | Read markdown: how the block starts and how many lines it takes (`MarkdownRule[]`), how it reads them |
| `toMarkdown`, `toHtml` | The block's markdown and HTML, for the clipboard and for containers |
| `placeholder` | The hint of an empty block: a string, `false`, or `(block) => string \| false` (a convention read by the engine; declare it on your class) |

`TextBlock` adds `behavior` (the `TextBehavior`), `container` (the Loro text), `text`, `delta` and `applyDelta`. `MegaBlock` adds `children`, `updateChildren`, `adoptChildren`, `clipboardProps`, `clipboardPropsFrom` and `serializeForClipboard`.

The `TextBehavior` of a text block (`block.behavior`, or `block.behaviors.get('text')`) has `block`, `container`, `text`, `delta`, `selection`, `positions`, `wordCount`, `insert`, `delete`, `applyDelta`, `split`, `absorbs`, `applyMark`, `removeMark`, `isMarkActive`, `toggleMark`, `toMarkdown`, `toJSON`, `toClipboardBlock`, `getDOMPoint` and `handleBeforeInput`.

The types are exported from `@aionbuilders/nabu/extend`: `NabuNode`, `ExtensionInit`, `ExtensionHooks`, `InputRule`, `PasteBlock`, `PasteFragment`, `HtmlRule`, `HtmlHelpers`, `MarkdownRule`, `MarkdownHelpers`, `SerializeContext`, `CommandDef`, `CommandContext`, `Chord`.

### `nabu.internals` (unstable)

`nabu.internals` returns one frozen object of **references to the machinery the engine runs on**, not copies: functions are bound to the editor, and `storedMarks` reads and writes through. Nothing moved: it is where the engine keeps it.

> **Warning.** Everything reached through `nabu.internals` may change in any minor version: a key can be renamed, a signature can change, a piece can be removed. Use it when the stable contract is not enough, keep the package version pinned, and read the changelog before you upgrade. The set of keys is itself pinned by a test, so a change always appears in the changelog.

| Key | What it is |
|---|---|
| `pulse` | The action bus behind `exec()`: `pulse.on(topic, handler)` adds or observes a topic at runtime |
| `commandConfirm` | The confirmation controller of commands (hold, invite, choose): `start`, `stop`, `offer`, `choose`, `cancel` |
| `hooks`, `hookOwners` | The extension hooks by name (the normalizers of `onBeforeTransaction`, the `onBeforeInput` handlers...), and which extension registered each |
| `inputRules` | The input rules collected from the extensions |
| `pasteInterpreters`, `pasteFileHandlers` | The paste interpreters and file handlers collected from the extensions |
| `undoManager` | The Loro `UndoManager` |
| `content`, `fileConfig` | The free-form `content` map of the document, and the resolved `files` option |
| `storedMarks`, `toggleStoredMark`, `clearStoredMarks` | Pending inline marks for the next typed character |
| `noteTextChange`, `captureUndoSelection`, `sealUndoEnd` | The undo bookkeeping around selection and text changes |
| `updateRoots`, `deleteNode` | Re-read the root blocks from the tree, delete a block by node id |
| `rearmTab`, `tabDescription` | The Escape-then-Tab way out, and the `aria-description` that goes with it |
| `dispatchEventToSelection`, `handleKeydown`, `handleBeforeinput`, `beforeinput`, `handleMousedown` | Event routing: commands first, then hooks, then the block |
| `handleCompositionStart`, `handleCompositionUpdate`, `handleCompositionEnd` | IME composition |
| `handleCopy`, `handleCut`, `handlePaste`, `insertFragment` | The clipboard pipeline: what the editor does on copy, cut and paste |
| `handleDragStart`, `handleDragOver`, `handleDragLeave`, `handleDragEnd`, `handleDrop`, `dropAt`, `dropTarget` | The drag and drop pipeline, and the drop indicator (reactive) |
| `selection` | The selection's repair machinery: `normalize`, `scheduleRepair`, `repairAfterRemoval`, `placements` |

```js test
import { createEditor, TextPreset } from '@aionbuilders/nabu';

const engine = createEditor({ preset: TextPreset });

// The door is a getter: the same frozen object every time, made of the references the engine uses.
const { pulse, commandConfirm, hooks } = engine.internals;
expect(engine.internals).toBe(engine.internals);
expect(typeof commandConfirm.choose).toBe('function');
expect(hooks.has('onBeforeInput')).toBe(true);

// The action bus: observe a topic the engine runs (unstable, hence behind the door).
const seen = [];
pulse.on('undo', () => seen.push('undo'));
await engine.exec('undo');
expect(seen).toEqual(['undo']);
```

## Gaps worth knowing

- `static create()` is called by `insert()`, by paste and by `importJSON()`: keep it free of side effects other than creating the node.
- `onBlockCreate`, `onBlockDelete`, `onBlockUpdate`, `onAfterTransaction` and `onInput` are declared in the hook type but not called yet: they are not part of the contract until they are.
