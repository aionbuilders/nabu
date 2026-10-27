<script>
  import ArchEditor from './ArchEditor.svelte';
  import RootPanel from './RootPanel.svelte';
  import { SEED_ROOT } from './seeds.js';

  /**
   * Chapter 01, "One contenteditable" (widget id `single-root`). A live editor, and a panel that COUNTS, in the live DOM, how many
   * elements are editable, how many blocks sit inside the root, and how many blocks the selection touches. "Outline" draws the root and
   * the blocks so that the structure is visible. Nothing here is the library's: it is plain DOM queries on the page.
   */
  let outline = $state(false);
</script>

<ArchEditor id="single-root" label="Try the editor: select across blocks" title="X-ray · the DOM" seed={SEED_ROOT} height={340} panelHeight={320} >
  {#snippet head()}
    <button type="button" class="w-btn" data-testid="outline-btn" aria-pressed={outline} onclick={() => (outline = !outline)}>Outline</button>
  {/snippet}
  {#snippet panel(ctx)}
    <RootPanel {ctx} {outline} />
  {/snippet}
</ArchEditor>

<style>
  /* The outline: the root, then each block. Inside the widget only (the frame carries the attribute set by RootPanel). */
  :global([data-arch-outline] [data-nabu-root]) {
    box-shadow: inset 0 0 0 2px var(--site-accent);
  }
  :global([data-arch-outline] [data-block-id]) {
    outline: 1px dashed var(--site-accent);
    outline-offset: -1px;
  }
</style>
