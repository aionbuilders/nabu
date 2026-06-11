<script>
  /** @type {{ block: import('./file.svelte.js').FileBlock }} */
  let { block } = $props();
</script>

<div
  bind:this={block.element}
  data-block-id={block.id}
  data-block-type="file"
  data-nabu-inert
  contenteditable="false"
  class="nabu-file"
  class:selected={block.selected}
  class:pending={block.status === 'pending'}
  class:error={block.status === 'error'}
>
  {#if block.status === 'error'}
    <div class="nabu-file-chip nabu-file-chip--error">⚠️ Upload failed</div>
  {:else if block.status === 'pending'}
    <div class="nabu-file-chip nabu-file-chip--pending">
      <span>📎</span>
      <span>{block.name || 'file'}</span>
      <span class="nabu-file-chip-status">Uploading…</span>
    </div>
  {:else}
    <a href={block.displaySrc} download={block.name} class="nabu-file-chip">
      <span>📎</span>
      <span>{block.name || 'file'}</span>
    </a>
  {/if}
</div>

<style>
  .nabu-file { margin: 0.25em 0; user-select: none; display: block; }
  .nabu-file-chip {
    display: inline-flex; align-items: center; gap: 0.4em;
    padding: 0.3em 0.75em; border-radius: 999px;
    border: 1px solid var(--nb-border, rgba(255,255,255,0.2));
    background: var(--nb-bg-surface, rgba(255,255,255,0.06));
    color: var(--nb-text-primary, inherit);
    font-size: 0.875em; text-decoration: none; cursor: pointer;
    transition: background 0.15s;
  }
  .nabu-file-chip:hover { background: var(--nb-bg-hover, rgba(255,255,255,0.12)); }
  .nabu-file.selected .nabu-file-chip { outline: 2px solid var(--nb-accent, #4d9fff); }
  .nabu-file-chip--pending { opacity: 0.6; cursor: default; }
  .nabu-file-chip--error { border-color: var(--nb-error, #f44); color: var(--nb-error, #f44); cursor: default; }
  .nabu-file-chip-status { font-size: 0.8em; opacity: 0.7; }
</style>
