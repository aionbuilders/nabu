<script>
  /** @type {{ block: import('./video.svelte.js').VideoBlock }} */
  let { block } = $props();
  $effect(() => block.holdSource());
  const src = $derived(block.displaySrc);
</script>

<figure
  bind:this={block.element}
  data-block-id={block.id}
  data-block-type="video"
  data-nabu-inert
  contenteditable="false"
  class="nabu-video"
  class:selected={block.selected}
  class:pending={block.status === 'pending'}
  class:error={block.status === 'error'}
  class:missing={block.isMissing}
>
  {#if block.status === 'error'}
    <div class="nabu-video-error">⚠️ Upload failed</div>
  {:else if block.isMissing}
    <div class="nabu-video-error nabu-video-missing" data-nabu-missing>Missing file{block.alt ? ' — ' + block.alt : ''}</div>
  {:else if src}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video src={src} controls draggable="false"></video>{#if block.status === 'pending'}<div class="nabu-video-spinner">Uploading…</div>{/if}
  {:else}
    <div class="nabu-video-empty">No video</div>
  {/if}
</figure>

<style>
  .nabu-video { margin: 0.5em 0; user-select: none; position: relative; display: block; max-width: 100%; }
  .nabu-video video { max-width: 100%; height: auto; border-radius: 6px; display: block; }
  .nabu-video.selected video { outline: 2px solid var(--nb-accent, #4d9fff); }
  .nabu-video.pending video { opacity: 0.6; }
  .nabu-video-spinner, .nabu-video-error, .nabu-video-empty {
    position: absolute; inset: auto 0 0 0; padding: 4px 8px; font-size: 12px;
    background: var(--nb-bg-surface, rgba(0,0,0,0.6)); color: var(--nb-text-primary, #fff); border-radius: 0 0 6px 6px;
  }
  .nabu-video-empty, .nabu-video-error { position: static; padding: 1.5em; text-align: center; border: 1px dashed var(--nb-border, rgba(255,255,255,0.2)); border-radius: 6px; color: var(--nb-text-muted, rgba(255,255,255,0.4)); }
</style>
