---
title: Extensions
description: What an extension is, how to use the built-in ones, and how to write your own with extension(): a block and its component, actions, input rules, hooks, commands and slash menu entries.
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

This guide covers the first half of the list. Paste handlers are covered with the clipboard.

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

## Gaps worth knowing

- A block class calls a few engine members that are not yet a documented contract: `nabu.tree.createNode()` in `create()`, `block.retype()`, `nabu.shortcut()`, `nabu.transact()`. They are what every built-in block uses; they are stable in practice, but they are listed here as the surface to keep an eye on in the changelog until they are typed on the `./extend` entry.
- `static create()` is called by `insert()`, by paste and by `importJSON()`: keep it free of side effects other than creating the node.
