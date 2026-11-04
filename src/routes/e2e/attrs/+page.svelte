<script>
  import { onMount } from 'svelte';
  import { createEditor, MinimalPreset, NabuEditor } from '#lib';

  /**
   * Test-only page (dev, or a build made with `VITE_NABU_E2E=1`), rendered on the server: the attributes that <NabuEditor> passes to its
   * root (tests/e2e/editor-attrs.spec.ts).
   *   A  "Editor A"        id, class, style, aria-describedby (reactive), autocapitalize, enterkeyhint, inputmode, data-foo
   *   B  "Editor B"        attributes that the editor owns, passed by a host: they must NOT win (and an `onkeydown`, counted in `window.__hostKeydowns`)
   *   C  "Editor C"        `readonly` toggled by a button, no extra attribute
   * `window.attrs` = { a, b, c }; `data-hydrated` is set on <main> once the client has taken the server markup over.
   */

  const a = createEditor({ preset: MinimalPreset });
  const b = createEditor({ preset: MinimalPreset });
  const c = createEditor({ preset: MinimalPreset });

  let describedby = $state(true);
  let readonly = $state(false);
  /** @type {HTMLElement | undefined} */
  let scope = $state();

  onMount(() => {
    const w = /** @type {any} */ (window);
    w.attrs = { a, b, c };
    w.__hostKeydowns = 0;
  });

  $effect(() => {
    scope?.setAttribute('data-hydrated', '');
  });
</script>

<main class="attrs" bind:this={scope}>
  <p id="note-1">First note</p>
  <p>
    <button id="toggle-describedby" onclick={() => (describedby = !describedby)}>describedby</button>
    <button id="toggle-readonly" onclick={() => (readonly = !readonly)}>readonly</button>
  </p>
  <section>
    <NabuEditor
      engine={a}
      label="Editor A"
      id="ed-a"
      class="mine"
      style="outline-offset: 7px"
      aria-describedby={describedby ? 'note-1' : undefined}
      autocapitalize="sentences"
      enterkeyhint="send"
      inputmode="text"
      data-foo="bar"
    />
  </section>
  <section>
    <NabuEditor
      engine={b}
      label="Editor B"
      contenteditable="false"
      role="textbox"
      data-nabu-root="host"
      lang="xx"
      translate="yes"
      aria-label="Host label"
      onkeydown={() => { /** @type {any} */ (window).__hostKeydowns++; }}
    />
  </section>
  <section>
    <NabuEditor engine={c} label="Editor C" {readonly} />
  </section>
</main>

<style>
  :global(body) { margin: 0; font-family: system-ui, sans-serif; font-size: 14px; }
  .attrs { max-width: 660px; margin: 0 auto; padding: 24px; }
  section { border: 1px solid #ccc; margin: 12px 0; }
</style>
