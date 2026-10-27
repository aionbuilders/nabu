<script>
  import { untrack } from 'svelte';
  import ModelView from './ModelView.svelte';

  /**
   * The panel of chapter 02: the tree (+ the operations log) or the JSON export of the same document, live.
   * The JSON is `engine.serialize('json')`, public API, rebuilt once per frame after a change.
   * @type {{ ctx: import('./helpers.js').WidgetContext, view: 'tree' | 'json' }}
   */
  let { ctx, view } = $props();

  const MAX_LINES = 40;
  let json = $state('');

  $effect(() => {
    const { engine } = ctx;
    let raf = 0;
    const render = () => {
      raf = 0;
      try {
        const lines = JSON.stringify(engine.serialize('json'), null, 1).split('\n');
        json = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), '…'].join('\n') : lines.join('\n');
      } catch { json = ''; }
    };
    const refresh = () => { if (!raf) raf = requestAnimationFrame(render); };
    untrack(render);
    const unsubscribe = engine.doc.subscribe(refresh);
    return () => { unsubscribe(); if (raf) cancelAnimationFrame(raf); };
  });
</script>

{#if view === 'tree'}
  <ModelView engine={ctx.engine} opsRows={4} />
{:else}
  <pre class="json" data-testid="xray-json" aria-label="The document as JSON">{json}</pre>
{/if}

<style>
  .json { margin: 0; color: var(--site-text-muted); font: inherit; white-space: pre; overflow: auto; }
</style>
