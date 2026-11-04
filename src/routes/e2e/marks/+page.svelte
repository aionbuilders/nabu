<script>
  import { onMount } from 'svelte';
  import { createEditor, createFullEditor, MinimalPreset, MarkdownPasteExtension, ListExtension, ListItemExtension, NabuEditor } from '#lib';
  import { Extension } from '#lib/utils/extensions.js';

  /**
   * Test-only page (dev, or a build made with `VITE_NABU_E2E=1`): editors that declare different marks, side by side, to check that
   * a mark exists in an editor only if one of its extensions declares it in `loroTextStyles` (tests/e2e/marks-declared.spec.ts):
   *   full     the full preset (every mark)
   *   minimal  MinimalPreset (no mark)
   *   bold     MinimalPreset + an extension that declares `bold` only
   *   lists    MinimalPreset + lists and markdown paste (no mark): nested blocks
   * `window.marks` = { full, minimal, bold, lists }, `window.__marks_ready` = true once they exist.
   */

  /** @typedef {import('#lib').Nabu} Nabu */

  const BoldOnly = new Extension('bold-only', { loroTextStyles: { bold: { expand: 'none' } } });

  /** @type {Record<string, Nabu> | null} */
  let engines = $state(null);

  onMount(() => {
    const built = {
      full: createFullEditor(),
      minimal: createEditor({ preset: MinimalPreset }),
      bold: createEditor({ preset: MinimalPreset, extensions: [BoldOnly] }),
      lists: createEditor({ preset: MinimalPreset, extensions: [MarkdownPasteExtension, ListExtension, ListItemExtension] }),
    };
    engines = built;
    /** @type {any} */ (window).marks = built;
    /** @type {any} */ (window).__marks_ready = true;
  });
</script>

<main class="marks">
  {#if engines}
    {#each Object.entries(engines) as [name, engine] (name)}
      <section data-testid={`box-${name}`}><NabuEditor {engine} label={`Editor ${name}`} /></section>
    {/each}
  {/if}
</main>

<style>
  :global(body) { margin: 0; font-family: system-ui, sans-serif; font-size: 14px; }
  .marks { max-width: 660px; margin: 0 auto; padding: 24px; }
  section { border: 1px solid #ccc; margin: 12px 0; }
</style>
