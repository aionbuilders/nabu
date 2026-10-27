---
title: Blocks reference
description: Every extension Nabu ships, one section each: what it does, how to summon it, what it contains, the keys it owns, what it becomes in markdown and HTML, and which presets include it. The examples follow a short story.
section: guides
order: 90
---

# Blocks reference

The facts about every extension Nabu ships, one section each. The examples follow a short story: a river, a ferryman and a traveller who is late.

Each section puts one piece to work on a line of the story. Then it tells you, always in the same order, how to summon the piece, what it holds, which keys it owns and what it turns into when it leaves the editor.

[Presets](../getting-started/presets.md) answers "which bundle do I pick?". This page answers the other question: "what can each piece do?". For a visual walk through the same blocks, one story and one card each, see the [Tour of the blocks](/docs/getting-started/tour-of-the-blocks).

## How to read this page

- **The examples are alive.** The page you are reading is drawn by Nabu itself, in read-only mode. The toggles open. The regions are regions. (The checkboxes do not tick: a read-only page cannot change.) Under each example, a grey block shows the markdown it was written in, so a reader on GitHub sees both.
- **One section per extension.** Its heading carries the name the extension registers under: `toggle`, `list-item`, `markdown-paste`. That name is `extension.name`, the block type in the JSON export, and what you filter a preset by.
- **The same bullets, in the same order.** Type (what you type to get the block), Slash menu, Contains, Keys, From code (the topics of `nabu.exec`), Markdown and HTML, Good to know, Presets, API. A bullet that does not apply is left out. The paste sections say Reads and Makes instead of Type and Contains.
- **`Mod`** is Ctrl on Windows and Linux, Cmd on macOS.
- **The slash menu** is the optional `SlashMenu` of `@aionbuilders/nabu/ui`. Type `/` at the start of a block or after a space, then a few letters. A title matches anywhere in it; an alias matches from its first letter.

An extension is a plain object, so everything below can be read from the code. This is how:

```js test
import { FullPreset } from '@aionbuilders/nabu';

const toggle = FullPreset.find((extension) => extension.name === 'toggle');

expect(toggle.slashCommands.map((entry) => entry.title)).toEqual(['Toggle']);
expect(Object.keys(toggle.actions)).toEqual(['toggle']);
expect(toggle.block.name).toBe('ToggleBlock');
```

## At a glance

- **Blocks:** [Paragraph](#paragraph--paragraph), [Heading](#heading--heading), [Blockquote](#blockquote--blockquote), [Divider](#divider--divider), [Code](#code--code), [Callout](#callout--callout), [Toggle](#toggle--toggle), [Image](#image--image), [Video](#video--video), [File](#file--file), [List](#list--list), [List item](#list-item--list-item), [Dialogue](#dialogue--dialogue), [Regions](#regions--region).
- **Text behaviours:** [Rich text](#rich-text--rich-text), [Typography](#typography--typography), [Markdown shortcuts](#markdown-shortcuts--markdown-shortcuts).
- **Paste:** [Nabu paste](#nabu-paste--nabu-paste), [HTML paste](#html-paste--html-paste), [Markdown paste](#markdown-paste--markdown-paste), [Plain text paste](#plain-text-paste--plain-text-paste).
- **The `block` extension:** [Block](#block--block).
- **And at the end:** [Make your own](#make-your-own).

## Blocks

A block extension registers a block type: a class that knows its data, a component that draws it, and the rules to read and write it.

### Paragraph · `paragraph`

The plain block: a run of text. It is the default block, the one Nabu creates whenever it needs an empty line of its own.

The **ferryman** waited under the eaves, an *unlit* lantern in his hand. Nobody had crossed since noon.

````md live=paragraph
The **ferryman** waited under the eaves, an *unlit* lantern in his hand. Nobody had crossed since noon.
````

- **Slash menu.** Text (`/text`).
- **Contains.** Text, with marks. No children, no props.
- **Keys.** `Enter` splits the block at the caret. `Backspace` at the start of the block joins it to the one above. A document is never empty: delete everything and a fresh paragraph appears.
- **From code.** `paragraph` turns the block holding the caret into a paragraph.
- **Markdown and HTML.** Inline markdown (see [Rich text](#rich-text--rich-text)), and `<p>`.
- **Good to know.** There is no table block yet. A pasted table keeps its text: each row becomes one paragraph, the cells separated by a Tab. An image in the middle of a pasted line splits it into text, image, text.
- **Presets.** Minimal, Text, Document, Full.
- **API.** [`ParagraphExtension`](/api/root/ParagraphExtension).

### Heading · `heading`

A title, from level 1 to level 6. Every story needs a chapter.

#### The last ferry

````md live=heading
#### The last ferry
````

- **Type.** `#` to `######`, then Space. The number of hashes is the level.
- **Slash menu.** Heading 1 (`/h1`), Heading 2 (`/h2`) and Heading 3 (`/h3`). Levels 4 to 6 are for the shortcut and for code.
- **Contains.** Text, with marks. One prop: `level`, from 1 to 6.
- **Keys.** `Enter` at the end of a heading starts a paragraph below. `Enter` in the middle cuts it in two headings of the same level. `Enter` at the start of a non-empty heading slips an empty paragraph above and keeps the caret in the heading. `Backspace` at the start turns the heading into a paragraph.
- **From code.** `heading:1`, `heading:2`, `heading:3`, `heading:4`, `heading:5`, `heading:6`.
- **Markdown and HTML.** `#` to `######`, and `<h1>` to `<h6>`. Markdown also reads the underlined form: a line of text over `===` is a level 1 heading, over `---` a level 2.
- **Presets.** Document, Full.
- **API.** [`HeadingExtension`](/api/root/HeadingExtension).

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor();
await engine.importMarkdown('The last ferry\n===\n\nDusk\n---');

const [first, second] = engine.serialize('json').blocks;
expect(first).toMatchObject({ type: 'heading', props: { level: 1 } });
expect(second).toMatchObject({ type: 'heading', props: { level: 2 } });
// The editor writes the usual form back.
expect(engine.serialize('markdown')).toBe('# The last ferry\n\n## Dusk');
```

### Blockquote · `blockquote`

A line someone else said, set apart by a bar in the margin.

> The river keeps no appointments, only debts.

````md live=blockquote
> The river keeps no appointments, only debts.
````

- **Type.** `>`, then Space.
- **Slash menu.** Quote (`/quote`).
- **Contains.** Text, with marks. A quote is a text block: it cannot hold other blocks.
- **Keys.** `Enter` ends the quote: the text after the caret moves to a paragraph below. `Enter` on an empty quote, and `Backspace` at the start of any quote, turn it back into a paragraph.
- **From code.** `blockquote`.
- **Markdown and HTML.** `> text`, and `<blockquote>`. Reading markdown, nested levels (`> > text`) are flattened into one quote, and a quote that holds a list or a heading gives the quote plus those blocks, none of the text is lost.
- **Presets.** Document, Full.
- **API.** [`BlockquoteExtension`](/api/root/BlockquoteExtension).

### Divider · `divider`

A horizontal rule. The scene changes; the story does not stop.

Dusk fell on the quay.

---

Night fell on the river.

````md live=paragraph,divider,paragraph
Dusk fell on the quay.

---

Night fell on the river.
````

- **Type.** `---`, then Space, in a block that holds nothing else.
- **Slash menu.** Divider (`/divider`).
- **Contains.** Nothing. It is a void block: no text, one caret position.
- **Keys.** `Backspace` at the start of the block under a divider deletes the divider. `Delete` at the end of the block above it does the same.
- **From code.** `divider:insert` puts a divider after the block (or in place of an empty one), and an empty paragraph under it for the caret.
- **Markdown and HTML.** `---` (markdown also reads `***` and `___`), and `<hr>`.
- **Good to know.** In markdown, `---` right under a line of text is not a divider: it underlines the text and makes a level 2 heading (see [Heading](#heading--heading)). Leave a blank line.
- **Presets.** Document, Full.
- **API.** [`DividerExtension`](/api/root/DividerExtension).

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const stuck = createFullEditor();
await stuck.importMarkdown('Dusk.\n---');
expect(stuck.children.map((block) => block.type)).toEqual(['heading']);

const spaced = createFullEditor();
await spaced.importMarkdown('Dusk.\n\n---');
expect(spaced.children.map((block) => block.type)).toEqual(['paragraph', 'divider']);
```

### Code · `code`

Verbatim text, in a monospace box, with a language. The ferryman's rules, kept exactly as written.

```js
const lantern = { lit: false };
if (travellers.length > 0) lantern.lit = true;
```

`````md live=code
```js
const lantern = { lit: false };
if (travellers.length > 0) lantern.lit = true;
```
`````

- **Type.** Three backticks, an optional language glued to them (`` ```js ``), then Enter. A language picker sits on the block; the prop itself takes any string.
- **Slash menu.** Code (`/code`).
- **Contains.** Text, verbatim: no marks, no shortcuts, no typography. One prop: `language` (a string, or `null`).
- **Keys.** `Enter` inserts a new line instead of a new block. `Tab` inserts two spaces, `Shift-Tab` removes up to two at the start of the line. `ArrowDown` on the last line, when nothing follows, creates a paragraph below. `Backspace` at the start of the block turns it into a paragraph (the language is dropped).
- **From code.** `code:block`.
- **Markdown and HTML.** A fence. The fence is made longer than any run of backticks in the code, so code that holds a fence round-trips. HTML is `<pre><code>`. Reading HTML, the language comes from a `language-xxx` class on the `<code>`; the HTML Nabu writes has no such class.
- **Good to know.** Pasting into a code block inserts the plain text as it comes: nothing is read as markdown or HTML. The topic `code` alone is not this block: it is the inline mark of [Rich text](#rich-text--rich-text).
- **Presets.** Document, Full.
- **API.** [`CodeExtension`](/api/root/CodeExtension).

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor();
await engine.importMarkdown('```ts\nlet a = 1;\n```');
expect(engine.serialize('json').blocks[0]).toMatchObject({ type: 'code', props: { language: 'ts' }, content: 'let a = 1;' });

// Code that holds a fence is written with a longer one.
await engine.importMarkdown('````md\n```js\nx\n```\n````');
expect(engine.serialize('markdown')).toBe('````md\n```js\nx\n```\n````');
```

### Callout · `callout`

A note set apart, with an icon and a tint. Five kinds, one prop.

> [!WARNING]
> Do not cross after dark. The far bank is not on any map.

````md live=callout
> [!WARNING]
> Do not cross after dark. The far bank is not on any map.
````

- **Type.** `!`, then Space (it makes a note; click the icon to change the kind).
- **Slash menu.** Callout (`/callout`).
- **Contains.** Text, with marks. One prop: `variant`, one of `note`, `tip`, `important`, `warning`, `caution`. Clicking the icon cycles through them.
- **Keys.** `Enter` inserts a new line inside the callout instead of a new block. `ArrowDown` on the last line, when nothing follows, creates a paragraph below. `Backspace` on an empty callout turns it into a paragraph; at the start of a non-empty one it does nothing, for now.
- **From code.** `callout`.
- **Markdown and HTML.** `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]` or `> [!CAUTION]`, then the text in `> ` lines. HTML is `<aside class="callout callout-warning" data-callout="warning">`.
- **Good to know.** The kind is called `variant` in the data. Typing `# ` or `**bold**` inside a callout does not transform anything (the markdown shortcuts and the typography skip it); `Mod-b` and the toolbar still work.
- **Presets.** Document, Full.
- **API.** [`CalloutExtension`](/api/root/CalloutExtension).

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor();
await engine.importMarkdown(
  ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].map((kind) => `> [!${kind}]\n> Mind the gap.`).join('\n\n')
);
expect(engine.serialize('json').blocks.map((block) => block.props.variant)).toEqual(['note', 'tip', 'important', 'warning', 'caution']);
```

### Toggle · `toggle`

A header that hides a body. Click the arrow. (Try it: the one below is closed.)

<details>
<summary>What was in the lantern?</summary>

Nothing. The oil ran out the day the bridge fell.

</details>

````md live=toggle
<details>
<summary>What was in the lantern?</summary>

Nothing. The oil ran out the day the bridge fell.

</details>
````

- **Type.** Nothing: there is no typed shortcut for a toggle.
- **Slash menu.** Toggle (`/toggle`).
- **Contains.** A header (text, with marks) and a body (children: any blocks, toggles included). One prop: `collapsed`, saved in the document.
- **Keys.** `Enter` in the header cuts it at the caret. Open, the tail becomes the first paragraph of the body. Closed, it becomes a paragraph after the toggle. `Enter` on an empty last paragraph of the body steps out of the toggle. `Backspace` at the start of the header dissolves the toggle into a paragraph: the header text stays, the body follows it, nothing is lost.
- **From code.** `toggle`.
- **Markdown and HTML.** The `<details>` construct: `<details>`, or `<details open>`, then `<summary>` with the header, the body, and `</details>`. Only that exact shape is read; any other markup stays text. HTML is `<details>` and `<summary>`.
- **Good to know.** On a read-only page like this one, a reader can open and close toggles. That is a view state: it is not written to the document and not synced. Pasting several blocks into a header sends the first into the header and the rest to the top of the body (a closed toggle opens first). The header skips the typed shortcuts, like the callout.
- **Presets.** Document, Full.
- **API.** [`ToggleExtension`](/api/root/ToggleExtension).

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor();
await engine.importMarkdown('<details open>\n<summary>The lantern</summary>\n\nEmpty.\n\n</details>');

const toggle = engine.serialize('json').blocks[0];
expect(toggle).toMatchObject({ type: 'toggle', props: { collapsed: false } }); // `open`: not collapsed
expect(toggle.children.map((child) => child.type)).toEqual(['paragraph']);
```

### Image · `image`

A picture, as a block of its own.

![The lantern, drawn here as the Nabu mark](/nabu-icon-512.png)

````md live=image
![The lantern, drawn here as the Nabu mark](/nabu-icon-512.png)
````

- **Type.** Nothing: images come from the picker, a paste, a drop or code.
- **Slash menu.** Image (`/image`). It opens the file picker.
- **Contains.** Nothing to type: a void block. Props: `ref` (where the file is), `alt`, `name` and `status` (`ready`, `pending`, `error`, `missing` or `rejected`). A picked, pasted or dropped file is stored by the [file system of the editor](./persistence-and-sync.md#files-and-the-asset-store) and `ref` points to it.
- **Keys.** None of its own: it holds no text.
- **From code.** `image:pick` opens the picker. `image:insert` inserts from a URL or a stored reference, with `{ ref, alt }`.
- **Markdown and HTML.** `![alt](url)`, and `<img src alt>`. Reading HTML, an `<img>` inside a paragraph is lifted out as a block and the text around it stays.
- **Good to know.** An image file pasted or dropped on the editor becomes this block (this extension takes `image/*` files). A file over `files.maxFileSize` is refused: the block is created as `rejected`, with the reason.
- **Presets.** Document, Full.
- **API.** [`ImageExtension`](/api/root/ImageExtension), [`insertImageFromFile`](/api/root/insertImageFromFile).

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor();
await engine.exec('image:insert', { ref: '/nabu-icon-512.png', alt: 'The lantern' });

const image = engine.serialize('json').blocks.find((block) => block.type === 'image');
expect(image.props).toMatchObject({ ref: '/nabu-icon-512.png', alt: 'The lantern' });
expect(engine.serialize('markdown')).toBe('![The lantern](/nabu-icon-512.png)');
```

### Video · `video`

A video, as a block of its own, with the browser's controls. This page has no video to show, so here is the idea in words: the ferryman's clip of the river at dusk, one block, a play button.

- **Type.** Nothing: videos come from the picker, a paste, a drop or code.
- **Slash menu.** Video (`/video`). It opens the file picker.
- **Contains.** Nothing to type: a void block. Props: `ref`, `alt`, `name` and `status`, as for an image.
- **Keys.** None of its own.
- **From code.** `video:pick`. `video:insert` inserts from a URL or a stored reference, with `{ ref, alt, name }`.
- **Markdown and HTML.** Written as a link, `[label](url)`; HTML is `<video src controls>`. Reading HTML, a `<video>` (or its `<source>`) becomes the block.
- **Good to know.** Markdown has no form for a video: the link below comes back as a paragraph with a link. Use the JSON export to keep the block.
- **Presets.** Document, Full.
- **API.** [`VideoExtension`](/api/root/VideoExtension), [`insertMediaFromFile`](/api/root/insertMediaFromFile).

````md import=paragraph
[The river at dusk](/river-at-dusk.mp4)
````

### File · `file`

Any other file, as a chip you can download. The ferryman's timetable, say.

- **Type.** Nothing: files come from the picker, a paste, a drop or code.
- **Slash menu.** File (`/file`). It opens the file picker.
- **Contains.** Nothing to type: a void block. Props: `ref`, `name` and `status`.
- **Keys.** None of its own.
- **From code.** `file:pick`. `file:insert` inserts from a URL or a stored reference, with `{ ref, name }`.
- **Markdown and HTML.** Written as a link, `[name](url)`; HTML is `<a href download>`. Reading HTML, only an `<a download>` becomes the block; an unsafe `href` leaves the label as plain text.
- **Good to know.** This is the catch-all of pasted files: an image goes to the image block, a video to the video block, and every other file lands here. Like a video, it has no markdown form to read: the link comes back as a paragraph.
- **Presets.** Document, Full.
- **API.** [`FileExtension`](/api/root/FileExtension), [`insertMediaFromFile`](/api/root/insertMediaFromFile).

````md import=paragraph
[ferry-timetable.pdf](/ferry-timetable.pdf)
````

### List · `list`

Bullets, numbers or to-dos. The list is the container; its items are the next section.

- the rope
- the oar
- the lantern, if it can be found

````md live=list
- the rope
- the oar
- the lantern, if it can be found
````

1. Untie the boat.
2. Push off.
3. Do not look down.

````md live=list
1. Untie the boat.
2. Push off.
3. Do not look down.
````

- **Type.** `-` then Space for bullets. A number and a dot, then Space, for a numbered list: `1.`, or `7.` to start at 7. `[ ]`, `[]` or `[x]`, then Space, for a to-do list. (`*` and `+` are for markdown import, not for typing.)
- **Slash menu.** Bulleted list (`/bullet`), Numbered list (`/numbered`) and To-do list (`/todo`).
- **Contains.** Children: list items (see [List item](#list-item--list-item)). Props: `listType` (`bullet`, `ordered` or `todo`) and, for an ordered list, `start`.
- **Keys.** The keys belong to the items. The list adds one thing: `Tab` and `Shift-Tab` over a selection that spans several items move them together.
- **From code.** The topics are the items': see the next section.
- **Markdown and HTML.** `-`, `*`, `+`, `1.` and `1)` markers, nested by indentation, with `- [ ]` and `- [x]` for to-dos. A bullet list followed by a to-do list is written `-` then `*`, so that it comes back as two lists; two lists of the same type in a row merge into one. HTML is `<ul>`, `<ol start>` and `<ul class="contains-task-list">`. Lists copied from Word and Google Docs are rebuilt as real nested lists.
- **Presets.** Full only. `ListExtension` and `ListItemExtension` always go together.
- **API.** [`ListExtension`](/api/root/ListExtension), [`Todos`](/api/root/Todos).

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor();
await engine.importMarkdown('- one\n\n* [ ] two\n\n7. seven\n8. eight');

const lists = engine.serialize('json').blocks;
expect(lists.map((list) => list.props)).toEqual([{ listType: 'bullet' }, { listType: 'todo' }, { listType: 'ordered', start: 7 }]);
// A bullet list then a to-do list stay two lists: their markers alternate.
expect(engine.serialize('markdown')).toBe('- one\n\n* [ ] two\n\n7. seven\n8. eight');

// Two bullet lists in a row are one list.
await engine.importMarkdown('- one\n\n* two');
expect(engine.serialize('json').blocks.map((list) => list.children.length)).toEqual([2]);
```

### List item · `list-item`

One entry of a list. It holds text, and sublists under it. In a to-do list it holds a tick.

What to bring across the river:

- [x] The rope
- [ ] The oar
- [ ] Oil for the lantern

````md live=list
- [x] The rope
- [ ] The oar
- [ ] Oil for the lantern
````

- **Type.** The list's shortcuts create the first item.
- **Slash menu.** None of its own: the list entries convert the item holding the caret, in place.
- **Contains.** Text, with marks, and children: sublists, of any type (an item can hold several, of different types). One prop, on to-do items only: `checked`.
- **Keys.** `Tab` nests the item under the one above it (if there is one), `Shift-Tab` brings it back out, with the items below it in tow. Both work on every item a selection touches. `Enter` starts a new item. `Enter` on an empty item, or `Backspace` at the start of an item, steps back one level: a nested item is un-nested, a top-level item leaves the list as a paragraph. `Mod-Enter` ticks or unticks the to-do items of the selection (if one is unticked, all get ticked). Clicking the box does the same for one item.
- **From code.** `list:indent`, `list:unindent`, `list:convert` and `todo:toggle`.
- **Markdown and HTML.** `- [ ] text` and `- [x] text`; nested items are indented under their parent. HTML is `<li>`, with `<input type="checkbox" disabled>` for a to-do.
- **Good to know.** A paste inside an item absorbs paragraphs and lists as items; a block an item cannot hold (a heading, a code block) splits the list around it. `Todos.get(engine)` counts the to-dos of the document.
- **Presets.** Full only.
- **API.** [`ListItemExtension`](/api/root/ListItemExtension), [`Todos`](/api/root/Todos).

```js test
import { createFullEditor, Todos } from '@aionbuilders/nabu';

const engine = createFullEditor();
await engine.importMarkdown('- [x] The rope\n- [ ] The oar\n- [ ] Oil for the lantern');

const todos = Todos.get(engine);
expect(todos.count).toBe(3);
expect(todos.doneCount).toBe(1);
expect(todos.remaining.map((item) => item.text)).toEqual(['The oar', 'Oil for the lantern']);

todos.checkAll();
await engine.commit();
expect(todos.progress).toBe(1);
expect(engine.serialize('markdown')).toBe('- [x] The rope\n- [x] The oar\n- [x] Oil for the lantern');
```

### Dialogue · `dialogue`

A line of speech, with a dash in front. For novels, plays and chats.

-- Is the ferry running?
-- Not tonight. The river is high.
-- And tomorrow?
-- Ask the river.

````md live=dialogue,dialogue,dialogue,dialogue
-- Is the ferry running?
-- Not tonight. The river is high.
-- And tomorrow?
-- Ask the river.
````

- **Type.** `--`, then Space, at the start of a paragraph.
- **Slash menu.** None: a dialogue line comes from the shortcut or from a paste.
- **Contains.** Text, with marks. No props.
- **Keys.** `Enter` starts the next line of dialogue. `Enter` on an empty line leaves the dialogue (a paragraph). `Backspace` at the start turns the line into a paragraph.
- **Markdown and HTML.** `-- text`, always, whatever dash is drawn. HTML is a plain `<p>`: pasted back, it is a paragraph. A line that starts with `–` or `—` is a paragraph, not a dialogue.
- **Good to know.** The dash on screen is a choice of display: `createDialogueExtension({ dash })`, or `--nb-dialogue-dash` in CSS. See [Language and dialogue](./ime-and-languages.md#the-dialogue-dash).
- **Presets.** Full only.
- **API.** [`DialogueExtension`](/api/root/DialogueExtension), [`createDialogueExtension`](/api/root/createDialogueExtension).

```js test
import { createEditor, FullPreset, createDialogueExtension } from '@aionbuilders/nabu';

const engine = createEditor({
  preset: FullPreset.filter((extension) => extension.name !== 'dialogue'),
  extensions: [createDialogueExtension({ dash: '—' })]
});

await engine.importMarkdown('-- Is the ferry running?\n-- Ask the river.');
expect(engine.children.map((block) => block.type)).toEqual(['dialogue', 'dialogue']);
expect(engine.children[0].dash).toBe('—'); // what is drawn
expect(engine.serialize('markdown')).toBe('-- Is the ferry running?\n\n-- Ask the river.'); // what is written
```

### Regions · `region`

A division of a long text: a part, a chapter, a scene. It has a title, a body, and a number. Regions nest.

<!-- region:section-1 {} -->
# The ferryman

He waited under the eaves.

<!-- region:section-2 {} -->
## The lantern

Unlit, still.

<!-- /region -->

<!-- /region -->

````md live=region
<!-- region:section-1 {} -->
# The ferryman

He waited under the eaves.

<!-- region:section-2 {} -->
## The lantern

Unlit, still.

<!-- /region -->

<!-- /region -->
````

That was one region (a "Section") holding another (a "Subsection"). The two closing comments are in the example only because this page goes on after it. The end of a region is otherwise inferred: it runs to the next region of the same or a higher level, or to the end of its parent, or of the document. At the end of a document, leave them out.

- **Type.** `:::`, then Space, in an empty paragraph: a chooser lists the region types that fit there. `:::` then Enter, in an empty paragraph of a region body, closes the region ("the region ends here").
- **Slash menu.** Section (`/section-1`), Subsection (`/section-2`) and Sub-subsection (`/section-3`), each offered where it fits.
- **Contains.** A title (a locked text field, with marks) and a body (children: any blocks, sub-regions included). Props: `regionType` and `fields`. The default types have no fields of their own besides the title; your own types declare theirs (`text`, `richtext`, `number`, `boolean`, `enum`, `date`).
- **Keys.** `Mod-Enter` cuts the region at the caret: a sibling of the same type takes the rest. `Mod-Shift-Enter` leaves the region: a paragraph right after it, one level up each time. `Tab` and `Shift-Tab` in a title demote and promote the region. `Backspace` at the start of a region, held for 0.7 seconds, merges it into the previous one (`Shift-Backspace` does the same); `Delete` held at the end merges the next one in. Released early, nothing happens. `Enter` in a title goes to the start of the body.
- **From code.** `region:split`, `region:insert`, `region:create`, `region:close`, `region:merge-previous`, `region:merge-next`, `region:exit`, `region:demote`, `region:promote`, `region:unwrap`, `region:move`, `region:move-up`, `region:move-down`, `region:next`, `region:prev` and `region:parent`.
- **Markdown and HTML.** A data comment, `<!-- region:section-1 {} -->`, then the title as a heading, then the body. HTML is `<section data-nabu-region="section-1" data-nabu-fields>` with the title as `<h1>` to `<h6>`.
- **Good to know.** The title is a field, not a heading: a text selection only touches text, never the structure. Regions are never inferred from headings. The types, labels, numbering and fields are yours to declare: see the [Regions guide](./regions.md).
- **Presets.** Full only. `RegionsExtension()` is a function; filter it out of a preset by the name `region`.
- **API.** [`RegionsExtension`](/api/root/RegionsExtension), [`createRegionsExtension`](/api/root/createRegionsExtension), [`Regions`](/api/root/Regions), [`Region`](/api/root/Region).

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor();
await engine.importMarkdown([
  '<!-- region:section-1 {} -->',
  '# The ferryman',
  '',
  'He waited under the eaves.',
  '',
  '<!-- region:section-2 {} -->',
  '## The lantern',
  '',
  'Unlit, still.'
].join('\n'));

// The registry is a view of the tree: labels are computed, never typed.
expect(engine.regions.list.map((region) => region.label)).toEqual(['1. The ferryman', '1.1 The lantern']);
expect(engine.regions.tree[0].children[0].title).toBe('The lantern');
```

## Text behaviours

These extensions register no block. They act on the text inside whatever blocks you have.

### Rich text · `rich-text`

The marks: bold, italic, underline, code, strikethrough, and links. Even a ferryman has moods.

The ferryman was **tired**, *patient* and <u>silent</u>. The lantern was ~~lit~~ `unlit`. The only way out was [the other bank](#make-your-own).

````md live=paragraph
The ferryman was **tired**, *patient* and <u>silent</u>. The lantern was ~~lit~~ `unlit`. The only way out was [the other bank](#make-your-own).
````

- **Type.** The [markdown shortcuts](#markdown-shortcuts--markdown-shortcuts) turn `**text**` into bold as you type. Without them, use the keys.
- **Contains.** Marks on text: `bold`, `italic`, `underline`, `code`, `strikethrough` and `link` (whose value is the URL).
- **Keys.** `Mod-b` bold, `Mod-i` italic, `Mod-u` underline, `Mod-e` code, `Mod-Shift-x` strikethrough. With a selection, the mark is toggled on it. With a collapsed caret, it is toggled for the next text you type. Formatting commands from the OS (a menu, a Touch Bar) go through the same actions. Links have no key: the floating toolbar sets them.
- **From code.** `mark:toggle`, `mark:apply`, `mark:remove`, `link:set`, `link:remove`, `link:toggle`, the short aliases `bold`, `italic`, `underline`, `code`, `strikethrough`, and the topics of the keys: `mark:bold`, `mark:italic`, `mark:underline`, `mark:code`, `mark:strikethrough`.
- **Markdown and HTML.** `**bold**`, `*italic*`, `<u>underline</u>`, `` `code` ``, `~~strike~~` and `[text](url)`. HTML is `<strong>`, `<em>`, `<u>`, `<code>`, `<s>` and `<a href>`.
- **Good to know.** Only safe links are kept: `http:`, `https:`, `mailto:`, `tel:`, relative URLs and `#fragments`. A `javascript:` link keeps its text and loses its link. Code blocks take no marks.
- **Presets.** Text, Document, Full.
- **API.** [`RichTextExtension`](/api/root/RichTextExtension), [`deltaToMarkdown`](/api/root/deltaToMarkdown), [`deltaToHtml`](/api/root/deltaToHtml).

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor();
await engine.importMarkdown('A **tired**, *patient* ferryman with a [lantern](https://example.dev).');

const marks = engine.children[0].delta.filter((run) => run.attributes).map((run) => [run.insert, Object.keys(run.attributes)[0]]);
expect(marks).toEqual([['tired', 'bold'], ['patient', 'italic'], ['lantern', 'link']]);
```

### Typography · `typography`

One small favour while you type: two hyphens and a space become an em dash.

> Nobody -- not even the fog -- had crossed.

becomes

> Nobody — not even the fog — had crossed.

- **Type.** `-- ` (two hyphens, then Space) in the middle of a line.
- **Contains.** One input rule, no options.
- **Good to know.** The rule fires when the space is typed, so `--help` keeps its dashes. A longer run (`---`) is left alone. At the very start of an empty paragraph `-- ` is the [dialogue](#dialogue--dialogue) shortcut instead, and the rule does not run inside code blocks, callouts or toggle headers. No smart quotes, no languages: see [Language and dialogue](./ime-and-languages.md#typography-per-language) to add your own rules.
- **Presets.** Text, Document, Full.
- **API.** [`TypographyExtension`](/api/root/TypographyExtension).

### Markdown shortcuts · `markdown-shortcuts`

Type the markdown, get the mark. The conversion happens when you type the closing delimiter.

| Type | You get |
|---|---|
| `**bold**` or `__bold__` | bold |
| `*italic*` or `_italic_` | italic |
| `***both***` or `___both___` | bold and italic |
| `` `code` `` | code |
| `~~strike~~` | strikethrough |

- **Contains.** Eight input rules, longest delimiter first. Underline has no shortcut: use `Mod-u`.
- **Good to know.** The delimiters must hug the text: `2 * 3 * 4` stays as typed. An underscore never opens or closes inside a word (`snake_case_name` stays), an asterisk may (`a*b*c`). The rules do not run in code blocks, callouts or toggle headers.
- **Presets.** Text, Document, Full.
- **API.** [`MarkdownShortcutsExtension`](/api/root/MarkdownShortcutsExtension).

The shortcuts of the blocks are different. Each belongs to its block, and works even without this extension. They are collected here as a cheat sheet:

| Type | Then | You get |
|---|---|---|
| `#` to `######` | Space | `heading`, level 1 to 6 |
| `>` | Space | `blockquote` |
| `---` | Space | `divider` |
| `` ``` `` or `` ```js `` | Enter | `code`, with its language |
| `!` | Space | `callout` |
| `-` | Space | `list`, bullets |
| `1.` or `7.` | Space | `list`, numbered from that number |
| `[ ]`, `[]` or `[x]` | Space | `list`, to-dos |
| `--` | Space | `dialogue` |
| `:::` | Space | `region`, after a chooser |

The toggle, the image, the video and the file have no typed shortcut.

## Paste

A paste is read in a fixed order, and the first reader that applies wins. Files first (see [Image](#image--image), [Video](#video--video) and [File](#file--file)), then the readers below, from the highest priority down. The whole story, with the sanitizing rules, is in the [Clipboard and markdown guide](./clipboard-and-markdown.md). Here is each reader, in the order it is asked.

### Nabu paste · `nabu-paste`

Copy in one Nabu editor, paste in another, and nothing is lost. Priority 100.

- **Reads.** `application/x-nabu+json`, which Nabu writes on every copy, cut and drag.
- **Makes.** The very blocks that were copied: types, props, marks, children, regions. The files travel with them (up to `files.maxInlineSize`).
- **Good to know.** A fragment of a newer format version is declined, not misread, and the paste falls to the next reader. A block the receiving editor has no extension for degrades to a paragraph with its text; its children follow as ordinary blocks.
- **Presets.** Minimal, Text, Document, Full.
- **API.** [`NabuPasteExtension`](/api/root/NabuPasteExtension), [`CLIPBOARD_FORMAT_VERSION`](/api/root/CLIPBOARD_FORMAT_VERSION).

```js test
import { createFullEditor, createMinimalEditor, NabuPasteExtension } from '@aionbuilders/nabu';

const [nabuJson] = NabuPasteExtension.pasteInterpreters;
expect(nabuJson.format).toBe('application/x-nabu+json');
expect(nabuJson.priority).toBe(100);

// What a heading looks like on the clipboard of a Nabu editor.
const clipboard = JSON.stringify({
  version: 1,
  blocks: [{ type: 'heading', partial: false, props: { level: 2 }, delta: [{ insert: 'The last ferry' }] }]
});

const full = createFullEditor();
await full.importFragment(nabuJson.interpret(clipboard, full));
expect(full.serialize('markdown')).toBe('## The last ferry');

// A paragraph-only editor keeps the text, not the heading.
const minimal = createMinimalEditor();
await minimal.importFragment(nabuJson.interpret(clipboard, minimal));
expect(minimal.serialize('markdown')).toBe('The last ferry');
```

### HTML paste · `html-paste`

The web, Word and Google Docs, read as blocks. Priority 50.

- **Reads.** `text/html`: what other pages and applications put on the clipboard.
- **Makes.** Each block extension reads the elements it knows: headings, paragraphs, quotes, `<pre>`, `<hr>`, lists (nested too, task lists included), `<details>`, images, videos, `<a download>`, callouts and regions written by Nabu. The inline marks come from `<strong>`, `<b>`, `<em>`, `<i>`, `<u>`, `<code>`, `<s>`, `<del>` and from the styled `<span>`s of word processors. A `<div>` or `<section>` is transparent.
- **Good to know.** It is a whitelist reader: what it does not know contributes its text and nothing else, and `<script>`, `<style>` and `<iframe>` contribute nothing at all. Unsafe links lose their `href`. A table keeps its text: one paragraph per row. What comes from outside is marked `external`, which is what lets `files.importRemote` fetch remote images instead of hot-linking them.
- **Presets.** Minimal, Text, Document, Full.
- **API.** [`HtmlPasteExtension`](/api/root/HtmlPasteExtension).

```js test
import { createFullEditor, HtmlPasteExtension } from '@aionbuilders/nabu';

const engine = createFullEditor();
const [html] = HtmlPasteExtension.pasteInterpreters;
expect(html.priority).toBe(50);

const fragment = html.interpret(
  '<h2>The last ferry</h2><p>The <b>ferryman</b> waited. <script>alert(1)</script></p><ul><li>the rope</li><li>the oar</li></ul>',
  engine
);
expect(fragment.blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'list']);

await engine.importFragment(fragment);
expect(engine.serialize('markdown')).toBe('## The last ferry\n\nThe **ferryman** waited.\n\n- the rope\n- the oar');
```

### Markdown paste · `markdown-paste`

Plain text that is really markdown. Priority 25.

- **Reads.** `text/plain`, as markdown.
- **Makes.** Every block that has a markdown form: headings, quotes, dividers, fenced code, callouts, toggles, images, lists and to-dos, dialogue lines, regions. It is the sum of the rules of the blocks of the editor, so `TextPreset` reads `# Title` as a paragraph.
- **Good to know.** In a paste, **one line is one block**. `engine.importMarkdown()` uses the same reader with CommonMark's rules, where consecutive lines join into one paragraph. Take the extension out of a preset and plain text is pasted as text, but `importMarkdown` then has nothing to read with.
- **Presets.** Text, Document, Full.
- **API.** [`MarkdownPasteExtension`](/api/root/MarkdownPasteExtension).

```js test
import { createFullEditor, MarkdownPasteExtension } from '@aionbuilders/nabu';

const engine = createFullEditor();
const [markdown] = MarkdownPasteExtension.pasteInterpreters;
expect(markdown.priority).toBe(25);

const source = '# The last ferry\nfirst line\nsecond line';
// Pasted: one line, one block.
expect(markdown.interpret(source, engine).blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'paragraph']);
// Imported: the two lines join.
expect(markdown.interpret(source, engine, { joinLines: true }).blocks.map((block) => block.type)).toEqual(['heading', 'paragraph']);
```

### Plain text paste · `plain-text-paste`

The last resort: text is text. Priority 0.

- **Reads.** `text/plain`, when nobody else wanted it.
- **Makes.** One paragraph per non-empty line. Blank lines are separators, never empty paragraphs. One line is inserted inline, at the caret.
- **Good to know.** With `MarkdownPasteExtension` in the preset, plain text is read as markdown first; this reader is what `MinimalPreset` has instead.
- **Presets.** Minimal, Text, Document, Full.
- **API.** [`PlainTextPasteExtension`](/api/root/PlainTextPasteExtension).

```js test
import { createMinimalEditor, PlainTextPasteExtension } from '@aionbuilders/nabu';

const [plain] = PlainTextPasteExtension.pasteInterpreters;
expect(plain.priority).toBe(0);

const engine = createMinimalEditor();
const fragment = plain.interpret('# Not a heading\n\n\nNobody had crossed since noon.', engine);
expect(fragment.blocks.map((block) => block.type)).toEqual(['paragraph', 'paragraph']);
expect(fragment.blocks[0].delta).toEqual([{ insert: '# Not a heading' }]);
```

## Turning blocks into other blocks

### Block · `block`

The one action that turns a block into another type. Slash entries and toolbar buttons are made of it.

- **Slash menu.** None: it is not a block.
- **Contains.** One action, `block:transform`. It retypes the block holding the caret and puts the caret back where it was. The text, the marks and the id of the block survive; the props you give are written on it.
- **From code.** `block:transform`, with `{ type, props? }`.
- **Good to know.** The aliases of the blocks (`heading:2`, `callout`, `code:block`…) are `block:transform` underneath: without this extension they do nothing. The callout, the toggle and the code block ignore the typed shortcuts, but this action still retypes them.
- **Presets.** Minimal, Text, Document, Full.
- **API.** [`BlockExtension`](/api/root/BlockExtension).

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor();
await engine.importMarkdown('The last ferry');

const block = engine.children[0];
const id = block.id;
block.transformTo('heading', { level: 2 }); // what block:transform does to the block holding the caret
await engine.commit();

expect(engine.children[0].id).toBe(id); // same block, new type
expect(engine.serialize('markdown')).toBe('## The last ferry');
```

## Make your own

You have met all the pieces. A block of your own is the same kind of object: a class, a component, a few rules, and an `extension()` to bundle them. The model is the ferryman's: one job each, well done.

- [Extensions](./extensions.md) shows how to write one, from the smallest (one action) to a full block with a component, input rules, hooks and slash entries.
- [Commands and keymap](./commands-and-keymap.md) lists every topic of `nabu.exec` and every key, and how to rebind them.
- [Presets](../getting-started/presets.md) shows how to put your extension in a bundle.

The river is still there. Nobody has crossed since noon.
