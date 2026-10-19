<script>
  /** @type {{ block: import('./image.svelte.js').ImageBlock }} */
  let { block } = $props();
  const src = $derived(block.displaySrc);
</script>

<figure
  bind:this={block.element}
  data-block-id={block.id}
  data-block-type="image"
  data-nabu-inert
  contenteditable="false"
  class="nabu-image"
  class:selected={block.selected}
  class:pending={block.status === 'pending'}
  class:error={block.status === 'error'}
  class:missing={block.status === 'missing'}
>
  {#if block.status === 'error'}
    <div class="nabu-image-error">⚠️ Upload failed</div>
  {:else if block.status === 'missing'}
    <div class="nabu-image-error nabu-image-missing" data-nabu-missing>Missing file{block.alt ? ' — ' + block.alt : ''}</div>
  {:else if src}
    <img src={src} alt={block.alt} draggable="false" />
    {#if block.status === 'pending'}<div class="nabu-image-spinner">Uploading…</div>{/if}
  {:else}
    <div class="nabu-image-empty">No image</div>
  {/if}
</figure>

<style>
  .nabu-image { margin: 0.5em 0; user-select: none; position: relative; display: block; max-width: 100%; }
  .nabu-image img { max-width: 100%; height: auto; border-radius: 6px; display: block; }
  .nabu-image.selected img { outline: 2px solid var(--nb-accent, #4d9fff); }
  .nabu-image.pending img { opacity: 0.6; }
  .nabu-image-spinner, .nabu-image-error, .nabu-image-empty {
    position: absolute; inset: auto 0 0 0; padding: 4px 8px; font-size: 12px;
    background: var(--nb-bg-surface, rgba(0,0,0,0.6)); color: var(--nb-text-primary, #fff); border-radius: 0 0 6px 6px;
  }
  .nabu-image-empty, .nabu-image-error { position: static; padding: 1.5em; text-align: center; border: 1px dashed var(--nb-border, rgba(255,255,255,0.2)); border-radius: 6px; color: var(--nb-text-muted, rgba(255,255,255,0.4)); }
</style>
