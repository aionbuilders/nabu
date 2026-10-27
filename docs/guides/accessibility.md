---
title: Accessibility
description: What Nabu does for keyboard and assistive technology users, what you should add (the accessible name of the editor), the ARIA it exposes, colour contrast of the default and Atelier themes, motion, and the known limits.
section: guides
order: 70
---

# Accessibility

Nabu's main accessibility choice is architectural: the editor is **one native `contenteditable`**, not a canvas and not a pile of editable islands. The caret, the selection, spellcheck, text-to-speech navigation, the input method editor (IME) and the browser's own text commands are the platform's, working on real text. Nabu draws no virtual caret and no virtual selection.

This page lists what is in place, what you have to do on your side, and what is not covered.

## What you should do: name the editor

`<NabuEditor>` renders a `contenteditable` element. Browsers expose it as an editable multi-line text region, but without a name a screen reader announces it as an unlabelled edit field. Name it with the `label` prop (an `aria-label`), or point it at a visible label with `labelledby` (an `aria-labelledby`):

```svelte
<script>
  import { NabuEditor, createDocumentEditor } from '@aionbuilders/nabu';

  const engine = createDocumentEditor();
</script>

<NabuEditor {engine} label="Chapter text" />

<!-- or, next to a visible label -->
<label id="body-label">Body</label>
<NabuEditor {engine} labelledby="body-label" />
```

Both props are reactive. There is deliberately **no `role` or `aria-multiline`** on the editable element: it would make screen readers flatten the headings, lists and region seams inside it. The name alone is enough. (The website's editor is named this way, and a browser test checks that it is named in the accessibility tree, is exposed as an editable rich-text region, and that its headings are still headings.)

## Keyboard

Everything can be done from the keyboard, because every action is a command with a shortcut and the pointer UI is an addition:

- **Typing and structure.** Markdown shortcuts while typing (`# `, `- `, `> `...), Enter to split a block, Backspace to merge, the arrow keys across blocks (the caret moves through the document as through one text).
- **Marks.** `Mod-b`, `Mod-i`, `Mod-u`, `Mod-e`, `Mod-Shift-x`. The floating toolbar is a pointer convenience for the same commands.
- **Reordering blocks.** The drag handle is for the pointer. The keyboard alternative is `Mod-Shift-ArrowUp` and `Mod-Shift-ArrowDown` (`block:move-up`, `block:move-down`).
- **Undo and redo.** `Mod-z`, `Mod-Shift-z`, `Mod-y`.
- **To-dos and toggles.** `Mod-Enter` toggles a to-do; the arrow of a toggle is a button with `aria-expanded`; the box of a to-do is a button with `aria-pressed`.
- **Regions.** Split, exit, merge, promote and demote have keys; the merges are protected by a hold that is announced (below).

The full table of default shortcuts, how to change them with the `keymap` option and how to list them (for a help dialog) is in [Commands and keymap](./commands-and-keymap.md#the-default-shortcuts).

### Tab and the keyboard trap

In a document editor Tab is useful inside the text (list indentation, code indentation, region titles), so the `tab` option decides what it does elsewhere. Small editors (`MinimalPreset`, `TextPreset`) leave Tab alone: it moves the focus, like in a `<textarea>`. `DocumentPreset` and `FullPreset` keep it in the editor, which would be a keyboard trap, so **Escape, then Tab, leaves the editor**, and the editor root announces it with an `aria-description`: "Press Escape then Tab to leave the editor". Translate or remove the hint with `tabHint`.

```js test
import { createTextEditor, createDocumentEditor } from '@aionbuilders/nabu';

// A small editor lets Tab move the focus: no trap, nothing to announce.
const small = createTextEditor();
expect(small.tab).toBe('focus');
expect(small.tabDescription).toBeUndefined();

// A document editor keeps Tab: the way out is announced on the editor root (`aria-description`).
const document_ = createDocumentEditor();
expect(document_.tab).toBe('stay');
expect(document_.tabDescription).toBe('Press Escape then Tab to leave the editor');

// In your language, or removed.
expect(createDocumentEditor({ tabHint: 'Échap puis Tab pour sortir' }).tabDescription).toBe('Échap puis Tab pour sortir');
expect(createDocumentEditor({ tabHint: false }).tabDescription).toBeUndefined();

// The announcement follows the mode when it changes at runtime.
small.tab = 'indent';
expect(small.tabDescription).toBe('Press Escape then Tab to leave the editor');
```

More on the modes in [Commands and keymap, The `tab` option](./commands-and-keymap.md#the-tab-option).

## What is exposed to assistive technology

### Semantic elements

The blocks are drawn with the elements that mean what they are, not with styled `div`s:

| Block | Element |
|---|---|
| Heading | `h1` to `h6` |
| Bullet, numbered and to-do lists | `ul` / `ol` and `li` |
| Blockquote | `blockquote` |
| Code | `pre` and `code` |
| Callout | `aside` |
| Image | `img` with the block's `alt` text |
| Link | `a` |

Write alt texts for images: `alt` is a field of the image block and travels in the JSON, the markdown (`![alt](url)`) and the clipboard.

### Region seams are headings

A region's title is drawn as `role="heading"` with `aria-level` set to the region's level, so a screen reader user can navigate a book by chapters and scenes with their heading shortcuts. The hairline of the seam is `aria-hidden`. When text of the parent follows a region, the end marker ("End of Chapter 2 - back to Part 1") is a `role="separator"` named by the same sentence. Both sentences are translatable through the `messages` of `RegionsExtension`: see [Regions](./regions.md#texts-and-languages).

### The live region: confirmations and holds

Each `<NabuEditor>` renders one visually hidden **polite live region** (`role="status"`, `aria-live="polite"`, `aria-atomic="true"`). It announces the prompt and the outcome of the [confirmations](./commands-and-keymap.md#confirmations):

- a **hold** ("Hold Backspace to merge with Chapter 1"), which is also drawn on screen;
- an **invite** (press twice);
- a **choose** (the list of options and the chosen one);
- the outcomes the user asked for: a release, Escape, a timeout. Not a keystroke that simply goes on typing.

The texts are English by default and are yours to translate with `commandConfirm.messages` (and, for the regions, the `messages` of `RegionsExtension`). `engine.commandAnnouncement` is the current text, if you want to render it yourself.

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor({
  commandConfirm: {
    holdMs: 1000, // a longer hold: friendlier to people who need more time
    messages: { hold: ({ keys, label }) => `Maintenez ${keys} : ${label}` }
  }
});

expect(engine.commandAnnouncement).toBe(''); // nothing pending: nothing announced
expect(engine.commands.get('region:merge-previous').confirm.strategy).toBe('hold');
```

A destructive merge can never happen with a single stray key press: it needs a hold of 0.7 seconds by default, with the progress drawn on the target and announced, and it cancels on release. The duration is the `commandConfirm.holdMs` option.

### The floating UI

- The **toolbar** is a `role="toolbar"` named "Text formatting"; its buttons are named (`aria-label`) and carry `aria-pressed` for the active marks. The icon of the link button is `aria-hidden`.
- The **command chooser** (the `:::` chooser, the choice between actions) is a `role="listbox"` with `role="option"` items, `aria-selected` and `aria-activedescendant`. Focus stays in the editor while the listbox is driven by the arrow keys.
- The **slash menu** is a `role="listbox"` named "Insert block", with `role="option"` entries and `aria-selected`; entries of the same group (Text, Lists, Blocks, Media, Structure) sit in a `role="group"` named after it (nothing visible changes). Focus never leaves the editor, so the menu cannot rely on focus: while it is open the editor root carries `aria-controls` (the list) and `aria-activedescendant` (the active option), and a visually hidden polite live region says the active entry and its position ("Heading 1, Large heading, 2 of 15"), because screen readers do not all follow `aria-activedescendant` on an editable host. The name, the group names and the sentence are translatable with the `messages` prop of `<SlashMenu>`: `{ label, groups: { text: 'Texte' }, option: ({ title, subtitle, index, count }) => '...' }`.
- The **callout's icon button** (it cycles the variant) has an `aria-label` ("Change callout type (note)"), not only a `title`; the language select of a code block has one too.
- The **drag handle** is a button named "Drag to reorder".

### Placeholders and decoration

The hint shown in an empty block (`placeholders`) is drawn by CSS (`::after` with `content: attr(data-placeholder)`), so it is **not text** of the document and is not read as such. The icons of the toolbar, the rule of a seam and the end-marker's decorations are hidden from assistive technology.

## Read-only mode

`<NabuEditor readonly>` (or the `readonly` option of the engine, or `engine.readonly = true` at any time) shows a document without letting anyone change it. The root becomes `contenteditable="false"` with `role="document"` and keeps the `label` as its name: a screen reader treats it as content to read, not as an edit field. Text stays selectable and copyable, and links work.

`aria-readonly` is not used: it is only valid on widget roles such as `textbox`, and putting `role="textbox"` on the root would flatten the headings (see above). Not being editable, exposed by `contenteditable="false"`, is what tells assistive technology that the content is read-only. The Escape-then-Tab hint is dropped (nothing traps the focus), the toolbar, slash menu and drag handle hide themselves, and the checkboxes and buttons that edit (the to-do box, the callout icon, the code language select) are `aria-disabled` or `disabled`. A toggle can still be opened to read it: see [the read-only recipe](../recipes/read-only-viewer.md).

## Language

`lang` is set on the editor root, so the screen reader's voice, the spellchecker and hyphenation use the right language even when your page is in another one. See [Language and input methods](./ime-and-languages.md#the-lang-option).

## Colour contrast

Contrast depends on the theme and, for the base theme, on your page, because its colours are translucent black or white. The figures are WCAG 2.x ratios; text needs 4.5:1, interface glyphs and focus indicators 3:1.

### The base theme

Computed on pages from pure white, and for dark pages from `#000` to `#1e1e1e`, with the translucent surfaces blended over the page:

| Colour | Light page | Dark page | Use it for |
|---|---|---|---|
| `--nb-text-primary` | 17.5:1 | 13.6 to 16.8:1 | Everything |
| `--nb-text-secondary` | 5.7:1 | 6.8 to 7.4:1 | Hints, quotes: passes for text |
| `--nb-text-muted` | 4.0:1 | 3.7 to 3.8:1 | **Glyphs and non-essential labels only** (drag handle, code language chip): below 4.5:1, so not for text a user must read |
| `--nb-region-warning` | 4.9:1 | 8:1 | The tint of a pending merge |
| `--nb-region-rail` | 6.3:1 | 6.4:1 | The margin rail of a region |

The base theme now sets both of the following, for both schemes:

- **Links.** `--nb-link` is `#0b57d0` on a light page (6.4:1 on white, 6.1:1 on `#fafafa`) and `#8ab4f8` on a dark one (9.9:1 on `#000`, 7.9:1 on `#1e1e1e`, 6.7:1 on `#2b2b2b`): 4.5:1 or more on both. (It used to be `#4d9fff`, 2.7:1 on white.) Without the base theme the same two colours are the fallbacks, chosen by `prefers-color-scheme`. Check your own `--nb-link` against your page.
- **A focus indicator.** The editor element shows a 2 px ring in `--nb-focus-ring` on `:focus-visible` (WCAG 2.4.7 and 1.4.11): `#0b57d0` on a light page, `#8ab4f8` on a dark one, 3:1 or more against the page. It is drawn inside the box, so a clipping ancestor does not cut it. Set `--nb-focus-ring` (colour) and `--nb-focus-ring-width` to restyle it, or `outline: none` on `.nabu-editor` and draw your own. The Atelier theme keeps its own indicator, the stronger border of the pane.

The small buttons inside the document (the to-do box, the toggle arrow, the callout icon, the code language select) still have no ring of their own in the base theme; the Atelier theme gives them one.

### The Atelier theme

The theme's authors computed its ratios from its own hex values; the table is in the header of `themes/atelier.css`. Text is on the pane (the editor surface) and on the floating surface:

| Colour | Dark | Light |
|---|---|---|
| Primary text | 15.7 / 14.5:1 | 18.4:1 |
| Secondary text | 7.9 / 7.3:1 | 7.4:1 |
| Muted text (labels, hints, placeholders, a completed to-do) | 5.4 / 5.0:1 | 5.3:1 |
| Accent (links, labels) | 6.7 / 6.2:1 | 5.4:1 |
| Region warning (hold hint) | 8.6 / 7.9:1 | 5.0:1 |
| Error (file chip) | 8.1 / 7.4:1 | 6.5:1 |

Every text colour of the theme is 4.5:1 or more in both schemes. Non-text elements (the caret, focus rings, the region rail and mark, the drag indicator) are 3:1 or more; the pane's own focus state is a border colour change of 3.3 to 3.4:1 against its resting colour. Hairlines (borders, region rule, divider) are decorative separators and deliberately quiet (1.3 to 1.5:1). Placeholders and the region seam use the muted colour, so they meet 4.5:1.

When you override colours of a theme, check them again: the theme's guarantee is for its own values.

## Motion

Nabu animates very little. The transitions are 0.1 to 0.15 s fades of a colour, a background or an opacity (toolbar buttons, a file chip, a toggle arrow); nothing moves, slides or scrolls by itself. The outline of the target of a pending command is the one transition guarded by `prefers-reduced-motion: no-preference`. The fill that follows a hold is not an animation but the progress of the user's own key press, driven by the hold duration. The others are not guarded by the media query (they are colour fades, not motion).

## Known limits

- **Screen readers are not systematically tested.** The attributes above are checked in Chromium by unit and browser tests (the accessible name, the editable region, heading exposure, the toolbar and listbox roles, the `aria-description` of the Tab hint), and the behaviours follow the platform. Real use with NVDA, JAWS, VoiceOver and Orca has not been audited.
- **Mobile screen readers are untested** (VoiceOver on iOS, TalkBack), as are mobile virtual keyboards: see [Language and input methods](./ime-and-languages.md#what-is-tested).
- **The slash menu's announcements are untested with real screen readers.** The roles, `aria-activedescendant` and the live region are checked in Chromium; how NVDA, JAWS and VoiceOver voice them on a `contenteditable` host has not been audited.
- **The drag handle** is a pointer control; the keyboard path is the move commands above.
- The editor root carries `translate="no"`: the browser's page translation does not apply to the editor's content.
