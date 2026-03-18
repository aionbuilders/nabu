<script>
  import { NabuEditor } from '$lib/blocks';
  import EditorToolbar from './EditorToolbar.svelte';

  let { engine } = $props();
</script>

<div class="editor-panel">
  <EditorToolbar {engine} />
  <div class="editor-area">
    {#if engine}
      <div class="editor-body">
        <NabuEditor {engine} />
      </div>
    {:else}
      <div class="loading">
        <span>Loading…</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .editor-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    flex: 1;
    overflow: hidden;
  }

  .editor-area {
    flex: 1;
    overflow-y: auto;
    font-size: 14px;
  }

  .editor-body {
    max-width: 660px;
    margin: 0 auto;
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 120px;
    color: var(--color-text-faint);
    font-size: 13px;
  }
</style>
