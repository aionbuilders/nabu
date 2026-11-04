<script>
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { createFullEditor, NabuEditor } from '#lib';

  /**
   * Test-only page (dev, or a build made with `VITE_NABU_E2E=1`): an editor in the layouts that matter to the caret reveal
   * (tests/e2e/caret-reveal.spec.ts). `?layout=` picks one, `?paragraphs=N` seeds N numbered paragraphs (default 1), `?smooth=1`
   * adds `scroll-behavior: smooth` to the scrollers and the page:
   *   scroller   the editor in a 220px scroller (`#scroller`)
   *   window     the editor in the page itself (no scroller), 40px above it and 600px below
   *   nested     an outer scroller (`#outer`, 300px) holding a 220px inner scroller (`#inner`) with the editor, 150px below the top
   *   scale      the 220px scroller under `transform: scale(0.7)`
   *   sticky     the 220px scroller with a 60px sticky footer (`#footer`) and `scroll-padding-bottom: 60px`
   *   two        two editors, each in its own 220px scroller (`#scroller`, `#scroller2`)
   *   code       a narrow scroller whose first block is a code block with one very long line, then an empty paragraph
   * `window.nabu` (and `window.nabu2` for `two`) is the engine, `window.__reveal_ready` is true once everything is mounted.
   */

  /** @typedef {import('#lib').Nabu} Nabu */

  const params = page.url.searchParams;
  const layout = params.get('layout') ?? 'scroller';
  const paragraphs = Number(params.get('paragraphs') ?? 1);
  const smooth = params.get('smooth') === '1';

  /** @type {Nabu[]} */
  let engines = $state.raw([]);

  /** @param {Nabu} engine */
  async function seed(engine) {
    for (const child of [...engine.children]) engine.delete(child);
    if (layout === 'code') {
      engine.insert('code', { text: 'const veryLongIdentifier = ' + 'abcdefghij'.repeat(40), language: 'js' }, null, 0);
      engine.insert('paragraph', { text: '' }, null, 1);
    } else {
      for (let i = 0; i < Math.max(1, paragraphs); i++) engine.insert('paragraph', { text: paragraphs > 1 ? `Line ${String(i).padStart(2, '0')}` : '' }, null, i);
    }
    await engine.commit();
    engine.undoManager.clear();
  }

  onMount(() => {
    (async () => {
      const made = [createFullEditor()];
      if (layout === 'two') made.push(createFullEditor());
      for (const engine of made) await seed(engine);
      const w = /** @type {any} */ (window);
      w.nabu = made[0];
      w.nabu2 = made[1];
      engines = made;
      requestAnimationFrame(() => { w.__reveal_ready = true; });
    })();
  });
</script>

<div class="reveal" class:smooth>
  {#if engines.length}
    {#if layout === 'window'}
      <div class="above">Above the editor</div>
      <NabuEditor engine={engines[0]} label="Editor" />
      <div class="below"></div>
    {:else if layout === 'nested'}
      <div id="outer" class="scroll" style="height: 300px">
        <div class="spacer" style="height: 150px">Outer content above</div>
        <div id="inner" class="scroll"><NabuEditor engine={engines[0]} label="Editor" /></div>
        <div class="spacer" style="height: 600px">Outer content below</div>
      </div>
    {:else if layout === 'scale'}
      <div class="scaled"><div id="scroller" class="scroll"><NabuEditor engine={engines[0]} label="Editor" /></div></div>
    {:else if layout === 'sticky'}
      <div id="scroller" class="scroll sticky">
        <NabuEditor engine={engines[0]} label="Editor" />
        <div id="footer">Sticky footer</div>
      </div>
    {:else if layout === 'two'}
      <div id="scroller" class="scroll"><NabuEditor engine={engines[0]} label="Editor" /></div>
      <div id="scroller2" class="scroll"><NabuEditor engine={engines[1]} label="Editor 2" /></div>
    {:else if layout === 'code'}
      <div id="scroller" class="scroll narrow"><NabuEditor engine={engines[0]} label="Editor" /></div>
    {:else}
      <div id="scroller" class="scroll"><NabuEditor engine={engines[0]} label="Editor" /></div>
    {/if}
  {/if}
</div>

<style>
  :global(body) { margin: 0; font-family: system-ui, sans-serif; font-size: 14px; line-height: 20px; }
  .reveal { padding: 8px 16px; }
  .scroll { height: 220px; overflow: auto; border: 1px solid #999; margin-bottom: 16px; }
  .narrow { width: 320px; }
  .spacer { background: #eee; }
  .above { height: 40px; }
  .below { height: 600px; }
  .scaled { transform: scale(0.7); transform-origin: top left; width: 700px; }
  .sticky { scroll-padding-bottom: 60px; }
  #footer { position: sticky; bottom: 0; height: 60px; background: #333; color: #fff; }
  .smooth .scroll, :global(html:has(.reveal.smooth)) { scroll-behavior: smooth; }
</style>
