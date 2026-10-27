<script>
  import ArchEditor from './ArchEditor.svelte';
  import CaretPanel from './CaretPanel.svelte';
  import { SEED_CARET } from './seeds.js';

  /**
   * Chapter 04, "Where is the caret?" (widget id `caret-map`). The browser's selection (DOM node + offset) next to Nabu's (block + index),
   * read live, and what the last undo / redo restored. Undo and Redo buttons sit under the editor (they keep the selection: a mousedown on
   * them is cancelled), Ctrl+Z works too.
   */

  /** @param {import('#lib').Nabu} engine @param {'undo' | 'redo'} which */
  const run = (engine, which) => engine.exec(which);
</script>

<ArchEditor id="caret-map" label="Select text to compare the two selections" title="X-ray · the caret" seed={SEED_CARET} height={340} panelHeight={360} >
  {#snippet panel(ctx)}
    <CaretPanel {ctx} />
  {/snippet}
  {#snippet below(ctx)}
    <button type="button" class="w-btn" data-testid="undo-btn" onmousedown={(e) => e.preventDefault()} onclick={() => run(ctx.engine, 'undo')}>Undo</button>
    <button type="button" class="w-btn" data-testid="redo-btn" onmousedown={(e) => e.preventDefault()} onclick={() => run(ctx.engine, 'redo')}>Redo</button>
  {/snippet}
</ArchEditor>
