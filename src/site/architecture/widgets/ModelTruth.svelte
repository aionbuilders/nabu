<script>
  import ArchEditor from './ArchEditor.svelte';
  import ModelPanel from './ModelPanel.svelte';
  import { SEED_STORY } from './seeds.js';

  /**
   * Chapter 02, "The model is the truth" (widget id `model-truth`). The live Loro tree and the operations Loro reports, as you type,
   * the same model as JSON, and a button that WRITES TO THE MODEL: a text insertion into the first paragraph's `LoroText`, with no
   * key and no DOM event. The editor changes anyway, because the DOM only reflects. Public API only: `engine.doc` and `engine.commit()`.
   */

  /** @type {'tree' | 'json'} */
  let view = $state('tree');
  let count = 0;

  /** Insert at the end of the first paragraph's text, straight into Loro, then commit (one undo step, like any change). @param {import('#lib').Nabu} engine */
  async function writeToModel(engine) {
    const first = engine.doc.getTree('blocks').roots()[0];
    const text = /** @type {any} */ (first?.data.get('text'));
    if (!text || typeof text.insert !== 'function') return;
    count++;
    text.insert(text.length, ` (written to the model, ${count})`);
    await engine.commit();
  }
</script>

<ArchEditor id="model-truth" label="Type to change the model" title="X-ray · the model" seed={SEED_STORY} height={340} panelHeight={340} >
  {#snippet head()}
    <span class="tabs" role="group" aria-label="View">
      <button type="button" class="w-btn" data-testid="view-tree" aria-pressed={view === 'tree'} onclick={() => (view = 'tree')}>Tree</button>
      <button type="button" class="w-btn" data-testid="view-json" aria-pressed={view === 'json'} onclick={() => (view = 'json')}>JSON</button>
    </span>
  {/snippet}
  {#snippet panel(ctx)}
    <ModelPanel {ctx} {view} />
  {/snippet}
  {#snippet below(ctx)}
    <button type="button" class="w-btn" data-testid="write-model" onclick={() => writeToModel(ctx.engine)}>Write to the model</button>
    <span class="hint">No key, no DOM event. Then try Ctrl+Z in the editor.</span>
  {/snippet}
</ArchEditor>

<style>
  .tabs { display: inline-flex; gap: 6px; }
  .hint { color: var(--site-text-subtle); font-size: var(--site-fs-small); }
</style>
