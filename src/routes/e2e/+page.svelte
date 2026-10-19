<script>
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { createFullEditor, FullPreset } from '$lib/presets.js';
  import { createPersistedEditor } from '$lib/persistence/persistence.js';
  import { NabuEditor } from '$lib/blocks';
  import { FloatingToolbar, SlashMenu, DragHandle } from '$lib/ui';

  /** @type {import('$lib/blocks/nabu.svelte.js').Nabu | null} */
  let engine = $state(null);

  onMount(() => {
    let cancelled = false;
    const docId = page.url.searchParams.get('persist');
    // Optional JSON-able Nabu init options (e.g. `placeholders`), merged into the editor init.
    /** @type {Record<string, any>} */
    let options = {};
    try {
      const raw = page.url.searchParams.get('options');
      if (raw) options = JSON.parse(raw);
    } catch (e) {
      console.warn('[e2e] invalid ?options JSON', e);
    }

    // Test-only (this route only exists in dev / `build:e2e`): `?hostFiles=1` installs an in-memory `files.onBeforePersist` that "uploads" to
    // a blob: URL and records the call in `window.__hostUploads`; `?hostFiles=gated` makes every upload wait for
    // `window.__hostRelease()` (to observe the pending state of a paste).
    const hostFiles = page.url.searchParams.get('hostFiles');
    if (hostFiles) {
      const w = /** @type {any} */ (window);
      w.__hostUploads = [];
      /** @type {() => void} */
      let release = () => {};
      const gate = hostFiles === 'gated' ? new Promise((resolve) => { release = () => resolve(undefined); }) : null;
      w.__hostRelease = release;
      options.files = {
        ...(options.files ?? {}),
        onBeforePersist: async (/** @type {File} */ file) => {
          const ref = URL.createObjectURL(file);
          w.__hostUploads.push({ name: file.name, size: file.size, type: file.type, ref });
          if (gate) await gate;
          return { ref };
        },
      };
    }

    (async () => {
      // No `persist` param: fresh in-memory editor. Otherwise: persisted under that docId (no seeding).
      const eng = docId
        ? await createPersistedEditor({ docId, preset: FullPreset, ...options })
        : createFullEditor(options);
      if (cancelled) return;
      engine = eng;
      // Expose only once the engine is fully created.
      const w = /** @type {any} */ (window);
      w.nabu = eng;
      w.__nabu_ready = true;
    })();

    return () => {
      cancelled = true;
    };
  });
</script>

<main class="e2e-root">
  {#if engine}
    <div class="editor-body">
      <FloatingToolbar {engine} />
      <SlashMenu {engine} />
      <DragHandle {engine} />
      <NabuEditor {engine} />
    </div>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
  }

  .e2e-root {
    padding: 24px;
  }

  .editor-body {
    max-width: 660px;
    margin: 0 auto;
  }
</style>
