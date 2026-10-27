<script>
  /**
   * The heading block of the documentation: the built-in one, plus the anchor `id` the table of contents and the Markdown links point at.
   * (Nabu's own heading has no id: see the gaps in the report.) Contract of a redrawn block: the element is bound to `block.element`, carries
   * the block id and type and wraps a `RichText`, with no whitespace in between.
   */
  import { RichText } from '#lib/extend.js';
  import { getDocMeta } from './context.js';

  /** @type {{ block: import('#lib/extend.js').TextBlock & { level: number } }} */
  let { block } = $props();
  const meta = getDocMeta();
  const id = $derived(meta.ids[block.id]);
</script>

<svelte:element
  this={'h' + block.level}
  bind:this={block.element}
  {id}
  data-block-id={block.id}
  data-block-type="heading"
  data-placeholder={block.placeholder}
  class="nabu-heading"
  class:selected={block.selected}
  class:first={block.isSelectionStart}
  class:last={block.isSelectionEnd}
><RichText delta={block.delta} /></svelte:element>
