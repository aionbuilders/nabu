<script>
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { createFullEditor, FullPreset, createPersistedEditor, NabuEditor } from '#lib';
  import { FloatingToolbar, SlashMenu, DragHandle, CommandInvite, CommandChooser } from '#lib/ui/index.js';
  import { DemoConfirmExtension } from './demo-commands.js';

  /** @type {import('#lib/blocks/nabu.svelte.js').Nabu | null} */
  let engine = $state(null);

  // Test-only: the reactive save status of a persisted editor, as a component sees it (`$effect`), in `window.__statusLog`.
  $effect(() => {
    const persistence = /** @type {any} */ (engine)?.persistence;
    if (!persistence) return;
    const w = /** @type {any} */ (window);
    (w.__statusLog ??= []).push(persistence.status);
  });

  const layout = page.url.searchParams.get('layout');
  const theme = page.url.searchParams.get('theme');
  const vars = page.url.searchParams.get('vars');

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

    // Test / playground only: `?seed=regions` seeds a small NESTED document with regions (ADR 018: a region is a container, its
    // header is its title, its body its children): a preamble paragraph, then two top-level sections; the first holds a
    // paragraph and two sub-sections. In-memory editors only. (Regions can also be added by hand:
    // `nabu.insert('region', { regionType: 'section-1', title: 'X' }, parentId, index)`, `parentId` = null for the root.)
    const seed = page.url.searchParams.get('seed');
    /** @param {import('#lib/blocks/nabu.svelte.js').Nabu} eng */
    const seedRegions = async (eng) => {
      /** @typedef {[string, Record<string, any>, any[]?]} Spec */
      /** @type {Spec[]} */
      const doc = [
        ['paragraph', { text: 'Preamble, outside any region.' }],
        ['region', { regionType: 'section-1', title: 'The ferryman' }, [
          ['paragraph', { text: 'Opening of the first section.' }],
          ['region', { regionType: 'section-2', title: 'The bank' }, [['paragraph', { text: 'Text of the bank.' }]]],
          ['region', { regionType: 'section-2', title: 'The water' }, [['paragraph', { text: 'Text of the water.' }]]],
        ]],
        ['region', { regionType: 'section-1', title: 'The return' }, [['paragraph', { text: 'Closing text.' }]]],
      ];
      for (const child of [...eng.children]) eng.delete(child);
      /** @param {Spec[]} specs @param {string | null} parentId */
      const build = (specs, parentId) => specs.forEach(([type, props, children], i) => {
        const block = eng.insert(type, props, parentId, i);
        if (children) build(children, block.id);
      });
      build(doc, null);
      await eng.commit();
      eng.undoManager.clear();
    };

    // Test / playground only: `?seed=long` seeds 80 numbered paragraphs ("Long line 00 …") so that the page / a scroll container scrolls.
    const seedLong = async (/** @type {import('#lib/blocks/nabu.svelte.js').Nabu} */ eng) => {
      for (const child of [...eng.children]) eng.delete(child);
      for (let i = 0; i < 80; i++) eng.insert('paragraph', { text: `Long line ${String(i).padStart(2, '0')} with some words to select` }, null, i);
      await eng.commit();
      eng.undoManager.clear();
    };

    // Test-only: `?commands=demo` installs the demo commands of the confirmation strategies (./demo-commands.js).
    if (page.url.searchParams.get('commands') === 'demo') options.extensions = [...(options.extensions ?? []), DemoConfirmExtension];

    // Test-only: record the persistence hooks in `window.__saveErrors` (names of the errors of failed autosaves) and `window.__recoveries`.
    if (docId) {
      const w = /** @type {any} */ (window);
      w.__saveErrors = [];
      w.__recoveries = [];
      options.onSaveError ??= (/** @type {any} */ error) => { w.__saveErrors.push(error?.name ?? String(error)); };
      options.onRecover ??= (/** @type {any} */ recovery) => { w.__recoveries.push(recovery.kind); };
    }

    (async () => {
      // No `persist` param: fresh in-memory editor. Otherwise: persisted under that docId (no seeding).
      const eng = docId
        ? await createPersistedEditor({ docId, preset: FullPreset, ...options })
        : createFullEditor(options);
      if (cancelled) { /** @type {any} */ (eng).persistence?.dispose(); return; }
      if (seed === 'regions' && !docId && eng.registry.has('region')) await seedRegions(eng);
      if (seed === 'long' && !docId) await seedLong(eng);
      engine = eng;
      // Expose only once the engine is fully created.
      const w = /** @type {any} */ (window);
      w.nabu = eng;
      w.__nabu_ready = true;
    })();

    return () => {
      cancelled = true;
      /** @type {any} */ (window).nabu?.persistence?.dispose();
    };
  });
</script>

<!--
  Test-only layout options (this route only exists in dev / `build:e2e`):
   - `?layout=scroll`: the editor lives in a fixed-height (360px) `overflow: auto` container (`.e2e-scroll-host`) under an
     opaque `position: fixed` top bar (`.e2e-topbar`, 48px, z-index 1000), like an app shell with a sticky header.
   - `?theme=dark`: a dark HOST page (dark background, light text) that relies on the OS colour scheme only (pair it with
     Playwright's `colorScheme: 'dark'`); `?theme=dark-attr`: the same host + the explicit `data-nabu-theme="dark"` attribute;
     `?theme=light`: a light host with a white background.
   - `?vars=--nb-x:value;--nb-y:value`: custom properties set on the host element (`.e2e-root`).
-->
<main class="e2e-root" class:scroll={layout === 'scroll'} data-e2e-theme={theme || undefined} data-nabu-theme={theme === 'dark-attr' ? 'dark' : undefined} style={vars || undefined}>
  {#if layout === 'scroll'}<div class="e2e-topbar">Top bar (sticky)</div>{/if}
  {#if engine}
    <div class={layout === 'scroll' ? 'e2e-scroll-host' : undefined}>
      <div class="editor-body">
        <FloatingToolbar {engine} />
        <SlashMenu {engine} />
        <DragHandle {engine} />
        <CommandInvite {engine} />
        <CommandChooser {engine} />
        <NabuEditor {engine} />
      </div>
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

  .e2e-topbar {
    position: fixed; top: 0; left: 0; right: 0; height: 48px; z-index: 1000;
    background: #222; color: #fff; display: flex; align-items: center; padding: 0 24px;
  }
  .e2e-scroll-host {
    margin-top: 56px; height: 360px; overflow: auto; border: 1px solid #888;
  }

  .e2e-root[data-e2e-theme='dark'], .e2e-root[data-e2e-theme='dark-attr'] { background: #121212; color: #e8e8e8; }
  .e2e-root[data-e2e-theme='light'] { background: #fff; color: #111; }
  :global(body:has(.e2e-root[data-e2e-theme='dark'])), :global(body:has(.e2e-root[data-e2e-theme='dark-attr'])) { background: #121212; }
</style>
