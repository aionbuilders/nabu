<script>
  /**
   * The table block of the documentation (see table.svelte.js). Same contract as any block component: the element carries the block id and
   * type, is bound to `block.element`, and the tags are glued (the editor preserves whitespace). The `<table>` itself is the block
   * element and sits inside a scroller, so that a wide table scrolls by itself on a phone and its cells stay inside the block's box.
   */
  import { RichText } from '#lib/extend.js';

  /** @type {{ block: import('./table.svelte.js').DocTableBlock }} */
  let { block } = $props();
</script>

<div class="doc-table" role="region" aria-label="Table" tabindex="0" contenteditable="false" oncopy={(e) => e.stopPropagation()}><table
    bind:this={block.element}
    data-block-id={block.id}
    data-block-type="table"
    class="nabu-table"
><thead><tr>{#each block.head as cell, i}<th scope="col" style:text-align={block.align[i] ?? undefined}>{#if cell.length}<RichText delta={cell} />{/if}</th>{/each}</tr></thead><tbody>{#each block.rows as row}<tr>{#each row as cell, i}<td style:text-align={block.align[i] ?? undefined}>{#if cell.length}<RichText delta={cell} />{/if}</td>{/each}</tr>{/each}</tbody></table></div>
