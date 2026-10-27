---
title: Theming
description: Style Nabu at three levels - theme variables (the base theme and the Atelier theme), redrawing a built-in block with your own component, and writing your own blocks.
section: guides
order: 50
---

# Theming

Nabu ships no design of its own beyond a sober default. You can change how it looks at three levels, from the cheapest to the deepest:

1. **Theme variables.** Every colour, border, shadow and radius the editor and its UI use is a CSS custom property `--nb-*`. Import a theme, or set the variables you care about.
2. **Redraw a block.** Replace the Svelte component that draws one block type (the heading, the callout...) and keep everything else: the data, the keyboard, the markdown.
3. **Your own blocks.** A new block type with its own component: [Extensions](./extensions.md).

Fonts are never loaded by Nabu. The host provides the families; the themes only name them (see [Fonts](#fonts)).

## Level 1: theme variables

### The base theme

`@aionbuilders/nabu/nabu-theme.css` defines the default values of the variables, for a light page and a dark one. Import it once, in your root layout:

```js
import '@aionbuilders/nabu/nabu-theme.css';
```

It is optional: every component carries its own dark-leaning fallback for each variable it reads (`var(--nb-bg-surface, #1a1a1a)`), so the editor works without it. Import it to get a coherent light and dark pair.

The scheme follows the system: `prefers-color-scheme: dark` switches the variables on `:root`. To force a scheme, set `data-nabu-theme="light"` or `data-nabu-theme="dark"` on `<html>` (or on any ancestor of the editor and of its floating UI):

```html
<html data-nabu-theme="dark">
```

The base theme styles the **chrome** around the text (menus, toolbar, borders of blocks, status colours). It does not set the editor's own text colour, font or background: those are inherited from your page, so your design stays in charge of the page.

### The Atelier theme

`@aionbuilders/nabu/themes/atelier.css` is a complete look: a warm-coral accent on a near-black surface (and a paper-white counterpart), a "pane" around the editor, typography for headings, quotes, lists, code and callouts, and styles for the toolbar, the slash menu and the regions' seams. It is plain CSS: no JavaScript, no build step.

```svelte
<script>
  import '@aionbuilders/nabu/themes/atelier.css';
  import { NabuEditor, createDocumentEditor } from '@aionbuilders/nabu';
  import { FloatingToolbar, SlashMenu, DragHandle } from '@aionbuilders/nabu/ui';

  const engine = createDocumentEditor();
</script>

<div class="nb-theme-atelier" data-nb-scheme="dark">
  <FloatingToolbar {engine} />
  <SlashMenu {engine} />
  <DragHandle {engine} />
  <NabuEditor {engine} />
</div>
```

- **The scope.** Everything the theme does happens under the class `.nb-theme-atelier`: nothing outside it is touched, and the base theme's values are overridden inside it. Put the class on an ancestor of the editor **and of its floating UI** (toolbar, slash menu, drag handle, command surfaces): they are rendered where you mount them and read their colours from the nearest scope.
- **The scheme**, `data-nb-scheme` on the same element: `"dark"` (the default when absent), `"light"`, or `"auto"` to follow `prefers-color-scheme`.
- **The pane.** The editor element becomes a bordered surface with a radius and padding. Tune it with `--atelier-pane-padding` (default `36px 40px`, `24px 20px` below 760 px), `--atelier-pane-radius` (`16px`), `--atelier-font-size` (`16px`), or set `--atelier-pane: transparent` and remove the border to blend the editor into your own surface.
- **Browser support.** The theme uses `light-dark()` and `color-scheme` (Chrome 123, Firefox 120, Safari 17.5).

You can use the theme as a starting point: set any `--nb-*` or `--atelier-*` variable on the scope element (or an ancestor) and your value wins.

```css
.nb-theme-atelier {
  --atelier-accent: light-dark(#0b57d0, #8ab4f8); /* the accent: caret, links, focus rings */
  --nb-floating-radius: 4px;
}
```

### Fonts

Nabu never loads a font. The Atelier theme names three stacks and falls back to system fonts when a family is absent:

| Variable | Default family | Used by |
|---|---|---|
| `--nb-font-text` | Inter (400, 500, 600) | The editor, the floating UI |
| `--nb-font-heading` | Syne (700), then Inter | Headings |
| `--nb-font-mono` | JetBrains Mono (400, 500) | Code blocks, inline code |

Load the families yourself, for example with Fontsource, or point the variables at the fonts you already use:

```js
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/syne/700.css';
import '@fontsource/jetbrains-mono/400.css';
```

```css
.nb-theme-atelier {
  --nb-font-text: 'Source Serif 4', Georgia, serif;
  --nb-font-heading: var(--nb-font-text);
}
```

`--nb-font-mono` is also read by the code block of the library itself (fallback: Menlo, Monaco, Consolas). `--nb-font-text` and `--nb-font-heading` are read by the Atelier theme only: without it, the editor inherits the font of your page.

### Layout variables

These are not colours and the base theme does not define them. Set them on the editor or any ancestor:

| Variable | Default | What |
|---|---|---|
| `--nb-paragraph-indent` | `0` | First-line indent of paragraphs (the French "alinéa"), for example `1.5em` |
| `--nb-dialogue-dash` | the extension's `dash` (`–`) | The marker drawn before a dialogue line, as a CSS string: `"—"`. Display only; the markdown stays `-- ` |
| `--nb-toolbar-inset-top` | none | A length in px: the floating toolbar never goes above that line. For a sticky header that covers the top of the page |
| `--nb-region-*` | | The seams of regions: see [Regions, Theming](./regions.md#theming) |

The paragraph indent follows the typographic rule: it applies to every paragraph **except** the first block of the document, of a region body or of a container, and the paragraph right after a heading or a divider. It is layout, not content: nothing is added to the text and the markdown is unchanged.

```css
.editor {
  --nb-paragraph-indent: 1.5em; /* a novel */
  --nb-dialogue-dash: '—';
}
```

The dash can also be chosen in code, `createDialogueExtension({ dash: '—' })`: see [Language and dialogue](./ime-and-languages.md#the-dialogue-dash).

### Reference of the variables

The values below are those of the base theme (light, then dark). The Atelier theme overrides all of them inside its scope. Not every block reads every variable; the column "Read by" says where the variable has an effect.

**Text**

| Variable | Light / dark default | Read by |
|---|---|---|
| `--nb-text-primary` | black 90% / white 90% | Toolbar, menus, callout text, toggle header, code |
| `--nb-text-secondary` | black 60% / white 60% | Blockquote, slash menu hints, secondary labels |
| `--nb-text-muted` | black 50% / white 40% | Code language chip, drag handle, empty and error states of media. Meant for glyphs and hints, not for body text (see [Accessibility](./accessibility.md#colour-contrast)) |
| `--nb-text-placeholder` | none (the text colour at 60%) | The hint shown in an empty block |
| `--nb-link` | `#0b57d0` / `#8ab4f8` (6.4:1 on white, 7.9:1 on `#1e1e1e`) | Links. Without the base theme the same two colours are the fallbacks, chosen by `prefers-color-scheme` |
| `--nb-error` | none (`#f44`) | A file chip in error |

**Surfaces**

| Variable | Light / dark default | Read by |
|---|---|---|
| `--nb-bg-surface` | white 85% / grey 12% at 75% | Toolbar, slash menu, command surfaces, code language chip |
| `--nb-bg-surface-sunken` | black 4% / black 20% | Code block background |
| `--nb-bg-surface-hover` | black 4% / white 8% | Hover of toolbar buttons, drag handle, menu items |
| `--nb-bg-surface-active` | black 8% / white 15% | Active toolbar button, active menu item |
| `--nb-bg-hover` | none | Hover of a file chip |

**Borders and lines**

| Variable | Light / dark default | Read by |
|---|---|---|
| `--nb-border` | black 10% / white 10% | Blockquote bar, divider, code block, toggle body rule, floating UI, empty media |
| `--nb-border-subtle` | black 5% / white 5% | Code language chip |
| `--nb-border-focus` | black 15% / white 20% | Defined for hosts and themes; no built-in component reads it |
| `--nb-focus-ring` | `#0b57d0` / `#8ab4f8` | The focus indicator of the editor (a 2 px outline on `:focus-visible`, drawn inside the box). Fallback without the base theme: the same two colours. The Atelier theme replaces it with the border of the pane |
| `--nb-focus-ring-width` | `2px` | Its thickness |

**Accent and status**

| Variable | Light / dark default | Read by |
|---|---|---|
| `--nb-accent` | blue 20% / blue 25% | Selection outline of images, videos and files; the drop indicator of the drag handle |
| `--nb-success`, `--nb-success-bg` | green | Defined for hosts and themes |
| `--nb-warning`, `--nb-danger` | amber 40%, red 40% | Defined for hosts and themes |
| `--nb-region-warning` | `#b45309` / `#f59e0b` | The tint of a pending region merge |
| `--nb-region-rail` | `#4F46E5` / `#818CF8` | The margin rail of the region holding the caret |

**Floating UI**

| Variable | Default | Read by |
|---|---|---|
| `--nb-floating-radius` | `8px` | Toolbar, slash menu |
| `--nb-floating-shadow` | a soft drop shadow | Toolbar, slash menu |
| `--nb-shadow-lg`, `--nb-shadow-inset`, `--nb-shadow-glow` | soft shadows | Defined for hosts and themes |
| `--nb-glass-blur`, `--nb-glass-blur-sm` | `blur(24px) saturate(180%)`, `blur(12px) saturate(140%)` | Defined for hosts and themes (the Atelier theme sets them to `none`) |

**Commands** (the surfaces of [confirmations](./commands-and-keymap.md#confirmations): the target of a hold, the invite, the chooser)

| Variable | Default | What |
|---|---|---|
| `--nb-command-accent` | the text colour | The outline of the target and the progress of the invite |
| `--nb-command-fill` | the text colour at 12% | The fill that follows the hold's progress |
| `--nb-command-radius` | `3px` on the target, `8px` on the surfaces | Corner radius |
| `--nb-command-bg`, `--nb-command-text`, `--nb-command-border` | `--nb-bg-surface`, `--nb-text-primary`, `--nb-border` | The invite and the chooser |
| `--nb-command-muted`, `--nb-command-active`, `--nb-command-track` | secondary text, active surface, the text colour at 18% | Hints, the active option, the invite's track |
| `--nb-command-shadow`, `--nb-command-font-size`, `--nb-command-padding`, `--nb-command-z` | soft shadow, `13px` (`12px` for the invite), `6px 10px`, `200` | Shadow, size, padding and stacking |
| `--nb-command-progress` | set by the engine, `0` to `1` | **Read-only**: the progress of a pending `hold`, for your own rendering |

**Regions.** The seam variables (`--nb-region-color`, `--nb-region-title-color`, `--nb-region-rule-color`, `--nb-region-label-size`, `--nb-region-label-weight`, `--nb-region-font`, `--nb-region-text-transform`, `--nb-region-letter-spacing`, `--nb-region-gap`, `--nb-region-margin`, `--nb-region-mark`, `--nb-region-end-color`, `--nb-region-end-size`, `--nb-region-rail-offset`) are documented, with their defaults, in [Regions](./regions.md#theming).

**Callouts.** The five variants take their colour from `--callout-accent`, set by the class of the variant (`.callout-note`, `.callout-tip`, `.callout-important`, `.callout-warning`, `.callout-caution`). Override it with a selector more specific than the component's:

```css
.nabu-editor .nabu-callout.callout-tip { --callout-accent: #15803d; }
```

### Style a block with CSS

Every block element carries `data-block-type` and `data-block-id`, and the built-in blocks have stable `nabu-*` classes (`.nabu-callout`, `.nabu-code-wrapper`, `.nabu-toolbar`, `.nabu-slash`...). Style them from outside, under the editor element `.nabu-editor` (or `[data-nabu-root]`):

```css
.editor .nabu-editor h2[data-block-type='heading'] {
  font-family: Georgia, serif;
  letter-spacing: -0.01em;
}
```

The built-in components use scoped styles, so a rule of yours needs about the specificity of `.nabu-editor` plus an attribute or a class, as above. The Atelier theme works exactly this way, and its source (`dist/themes/atelier.css` in the package) is the best reference for which selectors are stable.

## Level 2: redraw a block

A block type is a **class** (its data, its markdown, its behaviour) and a **component** (how it is drawn). You can replace only the component of a built-in type: the engine keeps the class, so serialization, paste, undo and the keyboard are unchanged.

There is no dedicated option for this. The component is registered by an extension under the **name of the block type**, and the last extension to register a name wins. So an extension with the same name as the built-in one, carrying only a `component`, redraws that type:

```js test
import { createDocumentEditor, HeadingExtension } from '@aionbuilders/nabu';
import { extension } from '@aionbuilders/nabu/extend';

function MyHeading() {} // stands for a Svelte component, defined below

const engine = createDocumentEditor({
  extensions: [extension('heading', { component: MyHeading })]
});

// The type is drawn by your component...
expect(engine.components.get('heading')).toBe(MyHeading);
// ...and is still the built-in class: same data, same markdown.
expect(engine.registry.get('heading')).toBe(HeadingExtension.block);

await engine.importMarkdown('## A title');
expect(engine.children[0].type).toBe('heading');
expect(engine.serialize('markdown')).toBe('## A title');
```

`extensions` are appended after the preset, which is what makes yours the last. If you build the list by hand, put it after the built-in one.

The component receives the block as its only prop. It must keep the contract of the editable DOM: the element is bound to `block.element`, carries `data-block-id` and `data-block-type`, and wraps a `RichText` that draws the block's `delta`, with no whitespace between them (the editor preserves it). That is the same contract as a custom block, explained in [Extensions](./extensions.md#a-custom-block). A heading with its own typography, for example:

```svelte
<!-- MyHeading.svelte -->
<script>
  import { RichText } from '@aionbuilders/nabu/extend';

  let { block } = $props();
</script>

<svelte:element
  this={'h' + block.level}
  bind:this={block.element}
  data-block-id={block.id}
  data-block-type="heading"
  data-placeholder={block.placeholder}
  class="my-heading"
  class:selected={block.selected}
><RichText delta={block.delta} /></svelte:element>

<style>
  .my-heading {
    white-space: pre-wrap;
    font-family: var(--nb-font-heading, Georgia, serif);
    margin: 1.2em 0 0.4em;
  }
  h1.my-heading { font-size: 2.2em; }
  h2.my-heading { font-size: 1.6em; }
</style>
```

```js
import MyHeading from './MyHeading.svelte';

const engine = createDocumentEditor({
  extensions: [extension('heading', { component: MyHeading })]
});
```

Things to know:

- The properties a component can read are those of the block class: `block.level` for a heading, `block.variant` for a callout, `block.collapsed` for a toggle... Read the built-in component in the source of the package (`dist/blocks/<type>/`) as the model; a block that holds children (list, toggle, callout, region) renders them with `BlockComponent`, exported from `@aionbuilders/nabu/extend`.
- A custom component for a media block should handle `block.status === 'missing'` (the bytes of the file are not available); see the [files section of the persistence guide](./persistence-and-sync.md#files-and-the-asset-store).
- Changing the component does not change the markdown, the HTML paste, the commands or the slash menu entries: those belong to the class and the extension. To change them too, write your own block.

## Level 3: your own blocks

A new type of block (an aside, a quote with an author, a card) is an extension with a class and a component: see [Extensions](./extensions.md).

## Gaps

- No dedicated editor option for component overrides: it goes through an extension that reuses the name of the built-in one (and `engine.components`, a map on the engine, is what holds the result). A first-class `components: { heading: MyHeading }` option would be clearer.
- The base theme does not define `--nb-link`, `--nb-text-placeholder`, `--nb-error` or the floating UI variables; they come from fallbacks in the components (a blue link of 2.7:1 on a white page, for instance: set `--nb-link` on light pages, see [Accessibility](./accessibility.md#colour-contrast)).
- `--nb-border-focus`, `--nb-success`, `--nb-warning`, `--nb-danger`, the shadows and the blur are defined by the themes but no built-in component reads them (yet): they are there for your own UI.
- Two scheme switches exist: `data-nabu-theme` for the base theme and `data-nb-scheme` for Atelier. They are independent, and inside an Atelier scope only the Atelier one applies.
