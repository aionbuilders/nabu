---
title: Regions
description: Structure a long text in divisions (parts, chapters, scenes): declare region types, use the registry, create and close regions from the keyboard and from code, and theme the seams.
section: guides
order: 40
---

# Regions

A **region** is a division of a document: a part, a chapter, a scene, a section. Regions are made for long texts where the structure matters (a novel, a report, a manual): they number themselves, carry typed fields, nest, and can be moved or merged as units.

In the document tree a region is a **container**: its header is its **title** (editable text, inline marks allowed), and its body is an ordinary list of blocks, sub-regions included. On screen and on the keyboard, regions feel like **a continuous text with seams**: the body has no border, margin or background, and the text flows from one region into the next.

`FullPreset` includes `RegionsExtension()` with three generic levels. To declare your own types, replace it with a configured one (below).

## Declare region types

`RegionsExtension({ types, messages })` (also exported as `createRegionsExtension`) takes the types of your document. Each key is a type id; the value declares it:

```js test
import { createEditor, DocumentPreset, RegionsExtension } from '@aionbuilders/nabu';

const engine = createEditor({
  preset: DocumentPreset,
  extensions: [
    RegionsExtension({
      types: {
        part: { level: 1, name: 'Part', label: 'Part {index}' },
        chapter: {
          level: 2,
          name: 'Chapter',
          label: 'Chapter {index}: {title}',
          numbering: 'document',
          fields: { status: { type: 'enum', values: ['draft', 'final'] }, pov: 'text' }
        },
        scene: { level: 3, name: 'Scene', label: '{path} {title}' }
      }
    })
  ]
});

await engine.importMarkdown([
  '<!-- region:part {} -->',
  '# The river',
  '',
  '<!-- region:chapter {"status":"draft"} -->',
  '## Departure',
  '',
  'Dawn.',
  '',
  '<!-- region:scene {} -->',
  '### The bank',
  '',
  'Water.',
  '',
  '<!-- region:chapter {} -->',
  '## Arrival',
  '',
  'Dusk.'
].join('\n'));

expect(engine.regions.list.map((region) => region.label)).toEqual([
  'Part 1',
  'Chapter 1: Departure',
  '1.1.1 The bank',
  'Chapter 2: Arrival'
]);
```

| Field | |
|---|---|
| `level` | Required, an integer from 1 (the highest division). The level **validates** the tree: a sub-region must be strictly deeper than its parent |
| `name` | The readable name ("Chapter"), shown by the `:::` chooser and the slash menu. Defaults to the type id |
| `label` | The display template. Tokens: `{index}` (the number, empty if not numbered), `{path}` ("2.3"), `{title}`, `{type}` (the id), `{level}`. Whitespace is collapsed, so an empty title leaves no dangling space. Default: `{path} {title}`, or `{title}` for an unnumbered type |
| `numbering` | `'parent'` (default): restarts at 1 in each parent region. `'document'`: continues over the whole document for that type. `'none'`: no number |
| `fields` | Typed fields: a kind (`'text'`) or an object (`{ type: 'enum', values: [...] }`). Kinds: `text`, `richtext`, `number`, `boolean`, `enum`, `date` (ISO 8601) |

Without `types`, the extension declares one generic division over three levels: `section-1` ("Section"), `section-2` ("Subsection") and `section-3` ("Sub-subsection"), labelled `1.`, `1.1`, `1.1.1`. The level **is** the type: promoting or demoting a region changes its type.

An invalid declaration is a configuration error and throws when the extension is created:

```js test
import { RegionsExtension, createFullEditor } from '@aionbuilders/nabu';

expect(() => RegionsExtension({ types: { x: { level: 0 } } })).toThrow(/level/);
expect(() => RegionsExtension({ types: { x: { level: 1, fields: { a: 'bogus' } } } })).toThrow(/unknown kind/);
expect(() => RegionsExtension({ types: { x: { level: 1, numbering: 'roman' } } })).toThrow(/numbering/);

// The default types.
const full = createFullEditor();
expect([...full.regions.config.types.keys()]).toEqual(['section-1', 'section-2', 'section-3']);
```

To replace the default extension of a preset, filter it out by name (`'region'`) and pass yours in `extensions`, as shown in [Presets](../getting-started/presets.md#remove-extensions-from-a-preset):

```js
createEditor({
  preset: FullPreset.filter((extension) => extension.name !== 'region'),
  extensions: [RegionsExtension({ types })]
});
```

### Where a region may live

A region lives at the **root** of the document or **directly in the body of another region**: never inside a list, a toggle or a callout. When a region ends up somewhere it does not belong (a paste into a list, say), the normalizer moves it out after the container, inside the enclosing region if there is one. Likewise, a region that is not strictly deeper than its parent is moved up to a valid parent, its content with it. A type that is not declared (a document from another editor) is accepted anywhere under a region, unnumbered.

A body may mix its own text and sub-regions in any order: the text of a chapter, scene 1, a transition, scene 2. At the root, text may come before, between and after regions.

## The registry: `nabu.regions`

`nabu.regions` is a reactive view derived from the tree (it stores nothing in the document). It is recomputed when the **structure** changes, not when text is typed.

| Member | |
|---|---|
| `list` | Every region, in document order |
| `tree` | The top-level regions; each one holds its `children` |
| `count` | The number of regions |
| `preamble` | The root blocks before the first region (`.blocks`, `.wordCount`) |
| `at(block?)` | The deepest region containing a block (the block itself if it is a region). Default: the block holding the caret. `null` outside any region |
| `of(block)` | The `Region` of a region block, or `null` |
| `next(region)`, `prev(region)` | The following or preceding region in document order |
| `parentOf(region)` | Its parent region |
| `caret` | The deepest region holding the caret, while the editor has the focus, else `null` |
| `config` | The resolved types |

A `Region` (a read-only view over its block) has:

| Member | |
|---|---|
| `type`, `level`, `position` | Its type id, depth and rank in the document |
| `index`, `path`, `pathString` | Its number within its scope (`null` if not numbered), and the numbers of its numbered ancestors then its own (`[2, 1]`, `"2.1"`) |
| `parent`, `children` | Its place in the tree |
| `title` | The plain text of its header |
| `label`, `prefix` | The label template applied, and applied with an empty title (what the seam shows before the title: "Chapter 2:") |
| `fields` | Its typed fields, plus `title` |
| `blocks`, `ownBlocks` | The children of the body, and those that are not regions |
| `wordCount`, `ownWordCount` | Words of the body, sub-regions included (their titles count, the region's own title does not), and of the region's own content |
| `setField(name, value)` | Set a field (own undo step); `title` replaces the header text |
| `block` | The region block |

```js test
import { createEditor, DocumentPreset, RegionsExtension } from '@aionbuilders/nabu';

const engine = createEditor({
  preset: DocumentPreset,
  extensions: [RegionsExtension({
    types: {
      chapter: { level: 1, label: 'Chapter {index}: {title}', fields: { status: { type: 'enum', values: ['draft', 'final'] } } },
      scene: { level: 2, label: '{path} {title}' }
    }
  })]
});

await engine.importMarkdown([
  '<!-- region:chapter {} -->',
  '# Departure',
  '',
  'One two three.',
  '',
  '<!-- region:scene {} -->',
  '## The bank',
  '',
  'Four five.'
].join('\n'));

const chapter = engine.regions.tree[0];
const scene = chapter.children[0];

expect(chapter).toMatchObject({ type: 'chapter', level: 1, index: 1, title: 'Departure', label: 'Chapter 1: Departure', prefix: 'Chapter 1:' });
expect(scene).toMatchObject({ pathString: '1.1', label: '1.1 The bank', parent: chapter });
expect(engine.regions.of(scene.block)).toBe(scene);
expect(engine.regions.next(chapter)).toBe(scene);

// The body of the chapter: its own text, then the scene.
expect(chapter.blocks.map((block) => block.type)).toEqual(['paragraph', 'region']);
expect(chapter.ownBlocks).toHaveLength(1);
expect(chapter.ownWordCount).toBe(3);
expect(chapter.wordCount).toBe(7); // 3 own words + the scene (its title, 2 words, and its body, 2 words)
expect(engine.regions.preamble.blocks).toHaveLength(0);

// Fields are validated against the declaration.
expect(chapter.setField('status', 'final')).toBe(true);
expect(chapter.setField('status', 'someday')).toBe(false); // not in the enum: refused, nothing written
await engine.commit();
expect(chapter.fields.status).toBe('final');
expect(chapter.fields.title).toBe('Departure');
```

A field holds `null` when it is unset or holds a value of the wrong type (the stored value is kept untouched). `richtext` fields are stored as Loro text and written as inline markdown in exports. A field that the type does not declare is stored as is.

## Create and close regions

### From the keyboard

- **`:::` then Space** in an empty paragraph (at the root or in a region body) opens a chooser of the region types **valid at that spot**. Pick one with the arrows and Enter, a number, or a click. The caret lands in the new region's title. The chooser has two groups: "Here" (types created inside the current region, or at the root) and "Next" (siblings created after the nearest ancestor that accepts them), each omitted when empty, each option showing the numbering prefix the new region would get. Escape leaves `::: ` as text.
- **The slash menu** has one entry per declared type, in its `structure` group, offered where the type fits.
- **`Mod-Enter`** (`region:split`) cuts the region at the caret: a sibling of the same type is created right after and takes the rest of the body.
- **Close a region with `:::` then Enter** in an empty paragraph of a region body: "the region ends here". Everything that followed the paragraph inside the chosen region leaves it and goes right after it, at the level of its parent; the `:::` paragraph disappears. When several regions contain the caret, a chooser lists them from the nearest ("Close Scene 2.2 - The ferryman", "Close Chapter 2"...); with one, it closes at once. Escape cancels and changes nothing.
- **`Mod-Shift-Enter`** (`region:exit`) leaves the region: it creates a paragraph right after it at the parent's level, moving nothing. Repeated, it goes up one level (scene, chapter, part, root). At the end of a region it equals `:::` + Enter.

An empty paragraph inside a region body is **not** an exit: it is a valid author's choice (a pause, a silence). Enter on it is an ordinary Enter.

Typing `# ` still makes a plain heading: regions are never inferred from headings.

### From code

Every operation is a command: `nabu.exec('region:*', data)` ([Commands and keymap](./commands-and-keymap.md)). A command takes `{ region }` (a `Region`, its block or its id) to act on that region instead of the one holding the caret. Used this way it runs directly, with no confirmation and no keyboard.

```js test
import { createEditor, DocumentPreset, RegionsExtension } from '@aionbuilders/nabu';

const engine = createEditor({
  preset: DocumentPreset,
  extensions: [RegionsExtension({
    types: { chapter: { level: 1, label: 'Chapter {index}' }, scene: { level: 2, label: '{path}' } }
  })]
});

// A new region after an existing one (or at the end of the document, with no region).
await engine.exec('region:insert', { type: 'chapter', title: 'One' });
await engine.exec('region:insert', { type: 'chapter', title: 'Two' });
await engine.exec('region:insert', { type: 'chapter', title: 'Three', at: 'before', region: engine.regions.list[0] });
expect(engine.regions.list.map((region) => region.title)).toEqual(['Three', 'One', 'Two']);

const titles = () => engine.regions.list.map((region) => `${region.type}:${region.title}`);

// Move a region among its siblings (never out of its parent).
await engine.exec('region:move', { region: engine.regions.list[2], direction: 'up' });
expect(titles()).toEqual(['chapter:Three', 'chapter:Two', 'chapter:One']);

// Demote: it becomes the last sub-region of the previous sibling, and takes the type of the deeper level.
await engine.exec('region:demote', { region: engine.regions.list[1] });
expect(titles()).toEqual(['chapter:Three', 'scene:Two', 'chapter:One']);
expect(engine.regions.list[1].parent.title).toBe('Three');

// Promote does the opposite: it leaves its parent, and the following siblings follow it.
await engine.exec('region:promote', { region: engine.regions.list[1] });
expect(titles()).toEqual(['chapter:Three', 'chapter:Two', 'chapter:One']);

// Unwrap: the region disappears, its title becomes a paragraph, its body stays in place.
await engine.exec('region:unwrap', { region: engine.regions.list[0] });
expect(engine.regions.count).toBe(2);
```

| Command | Default keys | `exec` data | |
|---|---|---|---|
| `region:split` | `Mod-Enter` | none | Cut at the caret; the rest goes to a new sibling |
| `region:insert` | none | `{ type?, at?: 'after' \| 'before', title?, fields?, region? }` | A new empty region next to the given or current one |
| `region:create` | `:::` + Space | `{ type? }` | A region where the caret is. Asks for the type through the chooser when typed, runs directly through `exec` |
| `region:close` | `:::` + Enter | `{ region? }` | End the region here. The caret block must be a closing mark: the `:::` paragraph, or an empty default paragraph in a body |
| `region:exit` | `Mod-Shift-Enter` | `{ region? }` | A paragraph right after the region, one level up |
| `region:merge-previous` | `Backspace`, `Shift-Backspace` (hold) | `{ region? }` | At the start of a region: the body joins the end of the previous region, the container and its title go. With nothing to join, the region is dissolved |
| `region:merge-next` | `Delete` (hold) | `{ region? }` | At the end of a region: the next sibling region merges into this one |
| `region:demote` | `Tab` in a title | `{ region? }` | Becomes the last sub-region of the previous sibling |
| `region:promote` | `Shift-Tab` in a title | `{ region? }` | Leaves its parent; the following siblings become its sub-regions |
| `region:unwrap` | none | `{ region? }` | Dissolves the region; the title becomes a paragraph |
| `region:move` | none | `{ direction: 'up' \| 'down', region? }` | Before or after the sibling of the same level |
| `region:move-up`, `region:move-down` | none | `{ region? }` | The same, with the direction built in (what a key can bind) |
| `region:next`, `region:prev`, `region:parent` | none | `{ region? }` | Put the caret at the first text position of the target region |

Each structural gesture is one commit and one undo step. Bind the keyless commands with the `keymap` option: `createEditor({ keymap: { 'region:move-up': ['Mod-Alt-ArrowUp'] } })`.

To build a document from data, you do not need commands: import markdown ([formats](#formats)) or the JSON export, which round-trip the structure.

### Protected merges

A selection of **text** never changes the structure (below), and neither does a stray Backspace. At the start of a region, Backspace is the `region:merge-previous` command with a **hold** confirmation: **hold the key for 0.7 seconds** (the hairline of the seam drains in amber and a hint appears above the title: "Hold Backspace to merge with ..."), and release early to cancel. Delete at the end of a region does the same with the next one. A key held down from earlier (erasing a sentence by keeping Backspace down) stops at the seam instead of merging. The engine also vetoes any silent text merge into, out of or across a title, whichever gesture asks for it (the `onBeforeMerge` hook). The hold duration is the `commandConfirm.holdMs` option; see [Commands and keymap](./commands-and-keymap.md#confirmations).

## The title is a field

A region's title is stored as text in the region (collaboration, undo and inline marks work), but it **behaves as a locked field**:

- The caret crosses it normally: Down or Right at the end of the block above a region goes to the start of its title; Down or Right at the end of the title goes to the start of the body; Up or Left at the start of the body goes to the end of the title. The computed label ("Chapter 2") is never a caret stop.
- **Enter in the title** goes to the start of the body (the first paragraph is created if there is none). The title is never split.
- Nothing merges into or out of a title with Backspace or Delete. Markdown shortcuts (`# `, `- `, `> `) and "transform into..." do not apply in it. A multi-block paste arrives **flattened**, on one line.
- **Tab and Shift-Tab in the title** are `region:demote` and `region:promote`. In the body, Tab keeps its usual meaning (lists, nesting).
- A **selection that is not entirely inside a title excludes it**: deleting, typing over, copying and applying marks skip the titles. A title is not highlighted during such a selection, an end that extends into a title jumps over it, and a selection that starts in a title stays inside it, like a form field.
- **Select All** inside a title selects the title; elsewhere it selects all the text of the document, without the titles.

The consequence is the principle: **a text selection only touches text**. Deleting across two regions erases the text on both sides but does not merge them, and Select All followed by Delete empties the text and keeps the skeleton (regions and titles). Deleting, merging or moving a region is a structure gesture: the hold, the commands, the seam.

## Formats

**JSON** (`serialize('json')`) is exact: a region is a block with children.

```
{ "type": "region", "props": { "regionType": "chapter", "fields": { ... } },
  "content": [ ...the title... ], "children": [ ...the body... ] }
```

**Markdown** (`serialize('markdown')`, `importMarkdown`, paste): a data comment opens the region, the title is a heading on the next line, and the body follows.

```
<!-- region:chapter {"status":"draft"} -->
## La *forêt*

Body, as block markdown (sub-regions included).
```

- The comment is the source of truth for the type and the fields: `<!-- region:<type> <json> -->` (the JSON is `fields`, never the title; `<`, `>` and `&` are escaped so that a field can never contain `-->`). The heading right after it, with no blank line, is the title (its level is ignored on import; on export it is the region's level, from `#` to `######`) and keeps its inline marks. A region with an empty title is written as the comment alone.
- **The end of a region is inferred** on import: it runs to the next opening of a region of the same or a higher level, or to the end of its parent, or of the document. A closing comment `<!-- /region -->` is written **only when something follows at the parent's level**:

```js test
import { createEditor, DocumentPreset, RegionsExtension } from '@aionbuilders/nabu';

const make = () => createEditor({
  preset: DocumentPreset,
  extensions: [RegionsExtension({
    types: { chapter: { level: 1, label: 'Chapter {index}' }, scene: { level: 2, label: '{path}' } }
  })]
});

const source = [
  '<!-- region:chapter {} -->',
  '# One',
  '',
  '<!-- region:scene {} -->',
  '## Scene',
  '',
  'Inside the scene.',
  '',
  '<!-- /region -->',
  '',
  'Back in the chapter.',
  '',
  '<!-- region:chapter {} -->',
  '# Two',
  '',
  'The end.'
].join('\n');

const engine = make();
await engine.importMarkdown(source);

// The closing comment is there because text follows the scene inside the chapter; none is needed elsewhere.
expect(engine.serialize('markdown')).toBe(source);
expect(engine.regions.list.map((region) => region.title)).toEqual(['One', 'Scene', 'Two']);
expect(engine.regions.tree[0].ownBlocks.map((block) => block.text)).toEqual(['Back in the chapter.']);

// The JSON export round-trips the structure too.
const copy = make();
await copy.importJSON(engine.serialize('json'));
expect(copy.serialize('markdown')).toBe(source);
```

Markdown is not lossy here, with one limit: a `richtext` field takes the paragraph's inline limits (whitespace at the edge of a mark moves outside it). A region of an undeclared type, read in an editor that does not know it, falls back to the declared type of the lowest level and keeps its fields. Only these constructs are recognized: regions are never inferred from headings.

**HTML** (the clipboard's `text/html`): `<section data-nabu-region="chapter" data-nabu-fields="...">` holding the title as a heading (`h1` to `h6`, by level) and the body. Pasted back it is read exactly; a `<section>` without these attributes stays a plain section, and the title is the section's **first element child** when that is a heading.

**Clipboard.** Copying a text selection copies text only (the structure is the seam's business). A selection that spans whole regions copies them with their structure for a paste into another Nabu editor; pasting a region into a list or a toggle follows the placement rule above.

## Texts and languages

The labels of the commands, the hold prompt, the chooser, the end marker and the title placeholder are English by default. Override any of them with `messages`: a partial object whose values are strings or functions of the parameters.

```js test
import { createEditor, DocumentPreset, RegionsExtension } from '@aionbuilders/nabu';

const engine = createEditor({
  preset: DocumentPreset,
  extensions: [RegionsExtension({
    types: { chapter: { level: 1, name: 'Chapitre' } },
    messages: {
      split: 'Couper ici',
      untitled: 'Sans titre',
      hold: ({ keys, label }) => `Maintenez ${keys} : ${label}`,
      createOption: ({ name }) => name
    }
  })]
});

expect(engine.commands.get('region:split').label).toBe('Couper ici');
expect(engine.commands.get('region:exit').label).toBe('Leave the region'); // not overridden
```

The keys of `messages`: `split`, `insert`, `mergePrevious`, `mergeNext`, `dissolve`, `exit`, `unwrap`, `move`, `moveUp`, `moveDown`, `promote`, `demote`, `next`, `prev`, `parent`, `create`, `chooser`, `createOption`, `createNext`, `slash`, `untitled`, `closeCommand`, `closeOption`, `closeChooser`, `closeFooter`, `groupHere`, `groupNext`, `chooserFooter`, `endOf`, `backTo`, `outside` and `hold`. The `RegionMessages` typedef documents the parameters of each.

## Theming

A region draws its seam (an editable title between a label and a hairline) and its body; nothing else. There is no editing UI in the region itself: yours goes beside it. Everything below is a CSS custom property you set on the editor or on an ancestor. The defaults follow the text colour, so light and dark pages both work.

| Variable | Default | What |
|---|---|---|
| `--nb-region-color` | text colour at 62% | The label (prefix) of the seam |
| `--nb-region-title-color` | text colour at 88% | The title |
| `--nb-region-rule-color` | text colour at 18% | The hairline |
| `--nb-region-label-size` | `0.75em` | Size of the seam |
| `--nb-region-label-weight` | `500` | Weight of the label |
| `--nb-region-font`, `--nb-region-text-transform`, `--nb-region-letter-spacing` | `inherit`, `none`, `0.02em` | The whole seam, label and title |
| `--nb-region-gap` | `0.75em` | Space between the label, the title and the hairline |
| `--nb-region-margin` | `1.75em 0 0.75em` | Margin around the seam. Keep about one line above it: the hold hint is drawn in that margin |
| `--nb-region-mark` | `none` | A `url(...)` drawn in front of the label (an icon) |
| `--nb-region-warning` | amber (`#b45309` light, `#f59e0b` dark) | The tint of a pending merge, with at least 4.5:1 contrast |
| `--nb-region-end-color`, `--nb-region-end-size` | text colour at 60%, `11.5px` | The end marker (below) |
| `--nb-region-rail` | indigo (`#4F46E5` light, `#818CF8` dark) | The margin rail of the region holding the caret |
| `--nb-region-rail-offset` | `calc(-24px - 0.4em)` | Where the rail sits left of the text |

```css
.editor {
  --nb-region-font: 'Iowan Old Style', serif;
  --nb-region-text-transform: uppercase;
  --nb-region-letter-spacing: 0.08em;
  --nb-region-rule-color: color-mix(in srgb, currentColor 30%, transparent);
  --nb-region-rail-offset: -0.6em; /* no room for the drag handle on the left */
}
```

- **End marker.** When text of the parent follows a region, a discreet 24-pixel hairline and "End of {prefix} - back to {parent}" (or "outside regions" at the root) mark where the region stops. It is not editable and never a caret stop; screen readers read it as a separator.
- **Margin rail.** While the editor has the focus, the region that holds the caret draws a thin rail in the margin, from its seam to the end of its body, out of the flow (it shifts nothing). The default offset puts it just left of the drag handle; on touch screens, where there is no handle, it comes closer. It is not printed.
- **Hooks for your CSS.** A region element carries `data-region-type`, `data-region-level`, `data-region-caret` (the caret is inside) and `data-region-pending` (a hold is running). The seam has `role="heading"` with `aria-level` set to the region's level, so screen readers navigate by division.
- **The hold** is drawn by the seam: the `--nb-command-progress` machinery of [Commands and keymap](./commands-and-keymap.md#rendering) is used by the region itself, with the warning tint.

## Gaps

- Sub-regions can only be created from the keyboard (`:::` in a body, `region:demote`) or from markdown and JSON: there is no public command that creates a child region directly, and `region:insert` creates a sibling.
- `nabu.commands.list()` evaluates region labels without a caret, so `region:merge-previous` reads "Merge with ..." with an empty title until the caret is in a region. Pass a context (`list(ctx)`) to get the names.
