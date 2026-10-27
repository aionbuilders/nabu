<script>
  import { onMount } from 'svelte';
  import { createFullEditor, NabuEditor } from '#lib';
  import { EmbedExtension, nested } from './embed.svelte.js';

  /**
   * Test-only page (dev, or a build made with `VITE_NABU_E2E=1`): SEVERAL editors on one page, to check that they never touch each
   * other's selection (tests/e2e/multi-editor.spec.ts):
   *   A  an editable editor, inside a plain container;
   *   B  a read-only editor (a document shown on the page);
   *   O  an editable "outer" editor whose `embed` block hosts N, a NESTED editable editor in its UI island;
   *   X  an extra editor that the buttons mount and unmount next to the others (mount / unmount without errors).
   * `window.multi` = { a, b, o, n, x }, `window.__multi_ready` = true once they are seeded.
   */

  /** @typedef {import('#lib').Nabu} Nabu */

  /** @type {Nabu | null} */ let a = $state(null);
  /** @type {Nabu | null} */ let b = $state(null);
  /** @type {Nabu | null} */ let o = $state(null);
  /** @type {Nabu | null} */ let n = $state(null);
  /** @type {Nabu | null} */ let x = $state(null);
  let showX = $state(false);

  /** @param {Nabu} eng @param {Array<[string, Record<string, any>]>} blocks */
  async function seed(eng, blocks) {
    for (const child of [...eng.children]) eng.delete(child);
    blocks.forEach(([type, props], i) => eng.insert(type, props, null, i));
    await eng.commit();
    eng.undoManager.clear();
  }

  function mountX() {
    if (x) return;
    x = createFullEditor();
    seed(x, [['paragraph', { text: 'Xray text' }]]);
    /** @type {any} */ (window).multi.x = x;
    showX = true;
  }
  function unmountX() {
    showX = false;
    x = null;
    /** @type {any} */ (window).multi.x = null;
  }

  onMount(() => {
    (async () => {
      const ea = createFullEditor();
      const eb = createFullEditor();
      const en = createFullEditor();
      const eo = createFullEditor({ extensions: [EmbedExtension] });
      await seed(ea, [['paragraph', { text: 'Alpha one' }], ['paragraph', { text: 'Alpha two' }]]);
      await seed(eb, [['paragraph', { text: 'Bravo read only one' }], ['paragraph', { text: 'Bravo read only two' }]]);
      await seed(en, [['paragraph', { text: 'Nested text' }]]);
      nested.set('n', en);
      await seed(eo, [['paragraph', { text: 'Outer text' }], ['embed', { key: 'n' }], ['paragraph', { text: 'Outer tail' }]]);
      a = ea; b = eb; o = eo; n = en;
      /** @type {any} */ (window).multi = { a: ea, b: eb, o: eo, n: en, x: null, mountX, unmountX };
      /** @type {any} */ (window).__multi_ready = true;
    })();
  });
</script>

<main class="multi">
  <p><button id="mount-x" onclick={mountX}>Mount X</button> <button id="unmount-x" onclick={unmountX}>Unmount X</button></p>
  {#if a && b && o && n}
    <section class="container" data-testid="container-a"><NabuEditor engine={a} label="Editor A" /></section>
    <section data-testid="box-b"><NabuEditor engine={b} readonly label="Editor B" /></section>
    <section data-testid="box-o"><NabuEditor engine={o} label="Editor O" /></section>
    {#if showX && x}<section data-testid="box-x"><NabuEditor engine={x} label="Editor X" /></section>{/if}
  {/if}
</main>

<style>
  :global(body) { margin: 0; font-family: system-ui, sans-serif; font-size: 14px; }
  .multi { max-width: 660px; margin: 0 auto; padding: 24px; }
  section { border: 1px solid #ccc; margin: 12px 0; }
  .container { background: #fafafa; padding: 8px; }
</style>
