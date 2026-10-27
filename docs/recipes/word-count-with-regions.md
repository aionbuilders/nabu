---
title: A word count for a book
description: Count words per chapter and for the whole book with regions, keep the count live while typing, show progress toward a target stored in a field, and know what the count leaves out.
section: recipes
order: 30
---

# A word count for a book

A book is a tree of divisions, and writers want a number for each: this chapter, this part, the whole manuscript, and how far along a target they are. With [regions](../guides/regions.md) you get all of it from the editor, with no parsing of the text.

## What the editor counts

Every block has a `wordCount`, **reactive**: it updates as you type. A region gives you two numbers:

| | |
|---|---|
| `region.wordCount` | The words of its body, **sub-regions included** |
| `region.ownWordCount` | The words of its own text, **sub-regions excluded** |
| `engine.regions.preamble.wordCount` | The words before the first region |

**Titles are never counted**: not the region's own, not its sub-regions'. A title is a label, not prose. A word is a run of characters separated by whitespace.

## A report

Declare your types, with a number field for a target if you want progress. Then everything is a sum over `engine.regions`:

```js test
import { createEditor, DocumentPreset, RegionsExtension } from '@aionbuilders/nabu';

const engine = createEditor({
  preset: DocumentPreset,
  extensions: [RegionsExtension({
    types: {
      part: { level: 1, name: 'Part', label: 'Part {index}: {title}' },
      chapter: {
        level: 2,
        name: 'Chapter',
        label: 'Chapter {index}: {title}',
        numbering: 'document',
        fields: { target: 'number' } // the number of words the author aims for
      }
    }
  })]
});

await engine.importMarkdown([
  'A short epigraph.',
  '',
  '<!-- region:part {} -->',
  '# The river',
  '',
  '<!-- region:chapter {"target":10} -->',
  '## Departure',
  '',
  'One two three four five.',
  '',
  '<!-- region:chapter {} -->',
  '## Arrival',
  '',
  'Six seven eight.'
].join('\n'));

/** Words of the whole manuscript: what comes before the first region, then each top-level region. */
const total = () =>
  engine.regions.preamble.wordCount + engine.regions.tree.reduce((sum, region) => sum + region.wordCount, 0);

/** One line per region, indented by depth. */
const outline = () =>
  engine.regions.list.map((region) => `${'  '.repeat(region.level - 1)}${region.label}: ${region.wordCount}`);

expect(outline()).toEqual([
  'Part 1: The river: 8',
  '  Chapter 1: Departure: 5',
  '  Chapter 2: Arrival: 3'
]);
expect(engine.regions.preamble.wordCount).toBe(3); // the epigraph
expect(total()).toBe(11);

// Titles do not count: renaming a chapter changes nothing.
const departure = engine.regions.list[1];
departure.setField('title', 'A much longer title than before');
await engine.commit();
expect(total()).toBe(11);

// Progress toward the target stored in the field.
const progress = (region) => {
  const target = region.fields.target;
  return target ? Math.min(100, Math.round((region.wordCount / target) * 100)) : null;
};
expect(departure.fields.target).toBe(10);
expect(progress(departure)).toBe(50);
expect(progress(engine.regions.list[2])).toBeNull(); // no target set

// It is live: typing in a chapter changes its count (and its part's) at once.
const before = engine.regions.list[0].wordCount;
departure.ownBlocks[0].insert(departure.ownBlocks[0].text.length, ' six seven');
await engine.commit();
expect(departure.wordCount).toBe(7);
expect(engine.regions.list[0].wordCount).toBe(before + 2);
```

`region.ownWordCount` is for the "this chapter's own text, apart from its scenes" view; `region.wordCount` for the total. The preamble is outside every region (an epigraph, a dedication), so a total adds it.

## Live in a Svelte page

`engine.regions.list` changes when the **structure** changes (a region added, moved, removed), and each `wordCount` is reactive, so a component re-renders itself on both, with no event wiring:

```svelte
<script>
  let { engine } = $props();

  const total = $derived(
    engine.regions.preamble.wordCount +
      engine.regions.tree.reduce((sum, region) => sum + region.wordCount, 0)
  );
</script>

<aside aria-label="Word count">
  <p><strong>{total}</strong> words</p>
  <ol>
    {#each engine.regions.list as region (region.block.id)}
      <li style:margin-left="{(region.level - 1) * 1}rem">
        {region.label}: {region.wordCount}
        {#if region.fields.target}
          ({Math.round((region.wordCount / region.fields.target) * 100)}% of {region.fields.target})
        {/if}
      </li>
    {/each}
  </ol>
</aside>
```

Mount it next to the editor, with the same `engine`. A count shown as text that changes while the user types should not be announced on every keystroke: leave it out of a live region, or announce it only on a pause.

To show the count of the chapter the caret is in, use `engine.regions.caret` (the deepest region holding the caret, while the editor has the focus) instead of the list.

## Without regions

A document with no regions has no per-division number, but the total is the same sum over the root blocks:

```js test
import { createFullEditor } from '@aionbuilders/nabu';

const engine = createFullEditor();
await engine.importMarkdown('# Notes\n\nOne two three.\n\n- four five\n- six');

const words = () => engine.children.reduce((sum, block) => sum + block.wordCount, 0);
expect(words()).toBe(7); // the heading counts here: it is a block of text, not a region title
```

## What the count leaves out

- **Whitespace-separated words only.** Scripts written without spaces (Chinese, Japanese) count each run of text between spaces as one word, so the figure is meaningless for them. Count characters from `block.text` instead.
- **Titles** (above) and, by construction, anything that is not text: images, dividers, files.
- **Code blocks** are counted like text.
- **Hyphenated and apostrophe words** are one word: "well-known" is 1, "l'eau" is 1.

There is no built-in "characters" or "reading time" measure. Both are one line from the figures above (`Math.ceil(words / 230)` minutes).

## Gaps

- No reactive "document word count" on the engine: sum the root blocks (or `preamble` plus the top-level regions), as above.
- No character count and no language-aware word segmentation.
