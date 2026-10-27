<script>
  import ModelView from './ModelView.svelte';

  /**
   * The panel of chapter 07: the Loro tree (a region is a node with children, its title the text of the node), then the registry the
   * `RegionsExtension` installs as `engine.regions` (reactive: derived from the tree), one line per region.
   * @type {{ ctx: import('./helpers.js').WidgetContext }}
   */
  let { ctx } = $props();

  const regions = $derived(/** @type {any} */ (ctx.engine).regions);
  /** Depth of a region in the registry's tree (0 = top level). @param {any} region */
  const depth = (region) => { let n = 0; for (let r = region.parent; r; r = r.parent) n++; return n; };
</script>

<div class="host">
  <ModelView engine={ctx.engine} ops={false} />
  <p class="w-label reg-label">registry · engine.regions</p>
  <ul class="reg" data-testid="registry" aria-label="Regions, from the registry">
    {#each regions?.list ?? [] as r (r.block.id)}
      <li class="w-line" style:padding-left="{depth(r) * 2}ch" data-testid="registry-item"><span class="w-accent">{r.label || r.type}</span> <span class="w-muted">· level {r.level} · {r.wordCount} words</span></li>
    {/each}
  </ul>
  <p class="note w-muted">The title is the header of the container, stored as text and edited in place. It behaves like a locked field: Enter does not split it, and Ctrl+A in the body leaves it out.</p>
</div>

<style>
  .host { display: flex; flex-direction: column; }
  .reg-label { margin-top: 10px; }
  .reg { margin: 4px 0 0; padding: 0; list-style: none; }
  .note { margin: 10px 0 0; font: 400 12.5px / 1.5 var(--site-font-body); }
</style>
