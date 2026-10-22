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
    // `window.__hostRelease()` (to observe the pending state); `?hostFiles=fail` makes every upload fail while `window.__hostFailing`
    // is true (set it to false to let a retry succeed). The host reports a progress of 0.5 as soon as it starts, honours the abort
    // `signal` (counted in `window.__hostAborted`, gated mode).
    const hostFiles = page.url.searchParams.get('hostFiles');
    if (hostFiles) {
      const w = /** @type {any} */ (window);
      w.__hostUploads = [];
      w.__hostAborted = 0;
      w.__hostFailing = hostFiles === 'fail';
      /** @type {() => void} */
      let release = () => {};
      const gate = hostFiles === 'gated' ? new Promise((resolve) => { release = () => resolve(undefined); }) : null;
      w.__hostRelease = release;
      options.files = {
        ...(options.files ?? {}),
        onBeforePersist: async (/** @type {File} */ file, /** @type {{ signal?: AbortSignal, onProgress?: (p: number) => void }} */ ctx = {}) => {
          const ref = URL.createObjectURL(file);
          w.__hostUploads.push({ name: file.name, size: file.size, type: file.type, ref });
          ctx.onProgress?.(0.5);
          if (gate) {
            await new Promise((resolve, reject) => {
              ctx.signal?.addEventListener('abort', () => { w.__hostAborted++; reject(new DOMException('aborted', 'AbortError')); });
              gate.then(resolve);
            });
          }
          if (w.__hostFailing) throw new Error('host is down');
          return { ref };
        },
      };
    }

    // Test-only: `?archive=1` gives `history: { mode: 'compact' }` an `onBeforeCompact` that records the size of the snapshot it receives
    // in `window.__archived` (`?archive=fail` makes it throw: the compaction must be aborted).
    const archive = page.url.searchParams.get('archive');
    if (archive && options.history?.mode === 'compact') {
      const w = /** @type {any} */ (window);
      w.__archived = [];
      options.history = {
        ...options.history,
        onBeforeCompact: (/** @type {Uint8Array} */ snapshot) => {
          w.__archived.push(snapshot.length);
          if (archive === 'fail') throw new Error('archive down');
        },
      };
    }

    // Test / playground only: `?seed=regions` seeds a small document with region markers (ADR 016): a preamble, two
    // top-level sections and two sub-sections. In-memory editors only. (Markers can also be added by hand:
    // `nabu.insert('region', { regionType: 'section-1', title: 'X' }, null, index)`.)
    const seed = page.url.searchParams.get('seed');
    /** @param {import('$lib/blocks/nabu.svelte.js').Nabu} eng */
    const seedRegions = async (eng) => {
      const doc = [
        ['paragraph', { text: 'Preamble, outside any region.' }],
        ['region', { regionType: 'section-1', title: 'The ferryman' }],
        ['paragraph', { text: 'Opening of the first section.' }],
        ['region', { regionType: 'section-2', title: 'The bank' }],
        ['paragraph', { text: 'Text of the bank.' }],
        ['region', { regionType: 'section-2', title: 'The water' }],
        ['paragraph', { text: 'Text of the water.' }],
        ['region', { regionType: 'section-1', title: 'The return' }],
        ['paragraph', { text: 'Closing text.' }],
      ];
      for (const child of [...eng.children]) eng.delete(child);
      doc.forEach(([type, props], i) => eng.insert(/** @type {string} */ (type), /** @type {any} */ (props), null, i));
      await eng.commit();
      eng.undoManager.clear();
    };

    (async () => {
      // No `persist` param: fresh in-memory editor. Otherwise: persisted under that docId (no seeding).
      const eng = docId
        ? await createPersistedEditor({ docId, preset: FullPreset, ...options })
        : createFullEditor(options);
      if (cancelled) return;
      if (seed === 'regions' && !docId && eng.registry.has('region')) await seedRegions(eng);
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
