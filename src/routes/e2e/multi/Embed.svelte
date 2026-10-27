<script>
  import { NabuEditor } from '#lib';
  import { nested } from './embed.svelte.js';

  /** @type {{ block: import('./embed.svelte.js').EmbedBlock }} */
  let { block } = $props();
  const inner = $derived(nested.get(/** @type {string} */ (block.node.data.get('key')) ?? 'n'));
</script>

<div bind:this={block.element} data-block-id={block.id} data-block-type="embed" data-nabu-inert contenteditable="false" class="embed"
  ><div data-nabu-ui class="embed-ui">{#if inner}<NabuEditor engine={inner} label="Nested editor" />{/if}</div></div>

<style>
  .embed { border: 1px dashed #888; padding: 8px; margin: 8px 0; }
  .embed-ui { background: #f4f4f8; }
</style>
