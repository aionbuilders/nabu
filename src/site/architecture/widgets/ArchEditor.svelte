<script>
  import { onMount, tick } from 'svelte';
  import '#lib/themes/atelier.css';
  import { curatedPreset } from '../../preset.js';

  /**
   * The frame of every Architecture widget: a small LIVE Nabu editor (the Atelier theme, bound to the site theme) and, next to it, an
   * X-ray panel that a widget fills with `panel`. Public API only: the root entry, `#lib/ui`, `#lib/extend` and the theme stylesheet.
   *
   * CLIENT ONLY (Loro WASM, IndexedDB): the server renders a same-size inert shell (skeleton + empty panel), `#lib` is imported on
   * mount so the WASM never enters the server bundle. The shell and the live editor have the same box, so nothing moves at hydration:
   * the editor's `min-height` equals the skeleton's, the panel's size comes from the grid (side by side) or a fixed height (stacked),
   * never from its content (the content is out of the flow and scrolls).
   *
   * Layout: stacked under 1000px (the editor, then the panel), side by side from 1000px, like the home page editor.
   *
   * @type {{
   *   id: string,
   *   label: string,
   *   title: string,
   *   seed: any[],
   *   docId?: string | null,
   *   options?: Record<string, any>,
   *   panel: import('svelte').Snippet<[import('./helpers.js').WidgetContext]>,
   *   head?: import('svelte').Snippet<[import('./helpers.js').WidgetContext]>,
   *   below?: import('svelte').Snippet<[import('./helpers.js').WidgetContext]>,
   *   toolbar?: boolean,
   *   chooser?: boolean,
   *   height?: number,
   *   panelHeight?: number,
   * }}
   *   `id`: widget id (test ids). `label`: accessible name of the editor. `title`: the panel's heading ("X-RAY · LAST KEY").
   *   `seed`: the Nabu JSON blocks of the starting document. `docId`: set it to keep the document in IndexedDB (otherwise in memory).
   *   `options`: more `createEditor` options (read each time an engine is created, so `reset()` picks up a change).
   *   `head`: controls on the right of the panel's heading. `below`: a row of controls under the frame (Reset sits there too).
   *   `height`: the minimum height of the editor when the panel sits beside it (>= 1000px), `panelHeight`: the height of the panel when it sits under it.
   */
  let { id, label, title, seed, docId = null, options = {}, panel, head, below, toolbar = true, chooser = true, height = 340, panelHeight = 340 } = $props();

  /** Site theme: `<html data-theme="dark|light">` (absent = follow the system), see ThemeToggle.svelte and app.html. */
  /** @type {'dark' | 'light' | 'auto'} */
  let scheme = $state('auto');

  /** @type {import('#lib').Nabu | null} */
  let engine = $state.raw(null);
  /** @type {{ lib: typeof import('#lib'), ui: typeof import('#lib/ui/index.js'), ext: typeof import('#lib/extend.js') } | null} */
  let mods = $state.raw(null);
  /** @type {HTMLElement | undefined} */
  let scope = $state();
  let busy = $state(false);
  let announcement = $state('');

  const readScheme = () => {
    const attr = document.documentElement.getAttribute('data-theme');
    return attr === 'dark' || attr === 'light' ? attr : 'auto';
  };

  /** One `importJSON` call, undo history cleared (the seed is not something to undo). @param {import('#lib').Nabu} eng @param {string} version */
  async function seedEngine(eng, version) {
    await eng.importJSON({ version, blocks: seed });
    /** @type {any} */ (eng).undoManager?.clear();
  }

  /** @param {typeof import('#lib')} lib */
  async function createEngine(lib) {
    const preset = curatedPreset(lib);
    if (docId) {
      const eng = await lib.createPersistedEditor({ docId, lang: 'en', preset, ...options });
      if (/** @type {any} */ (eng).isNew) await seedEngine(eng, lib.JSON_FORMAT_VERSION);
      return eng;
    }
    const eng = lib.createEditor({ preset, lang: 'en', ...options });
    await seedEngine(eng, lib.JSON_FORMAT_VERSION);
    return eng;
  }

  /** E2E builds only (`build:e2e`): the specs read the model through `window.nabu`, like the /e2e route. @param {import('#lib').Nabu | null} eng */
  function expose(eng) {
    if (import.meta.env.VITE_NABU_E2E !== '1') return;
    const w = /** @type {any} */ (window);
    w.nabu = eng ?? undefined;
    w.__nabu_ready = !!eng;
  }

  onMount(() => {
    scheme = readScheme();
    const observer = new MutationObserver(() => { scheme = readScheme(); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    let cancelled = false;
    (async () => {
      const [lib, ui, ext] = await Promise.all([import('#lib'), import('#lib/ui/index.js'), import('#lib/extend.js')]);
      const eng = await createEngine(lib);
      if (cancelled) { /** @type {any} */ (eng).persistence?.dispose(); return; }
      mods = { lib, ui, ext };
      engine = eng;
      expose(eng);
    })();

    return () => {
      cancelled = true;
      observer.disconnect();
      /** @type {any} */ (engine)?.persistence?.dispose();
      expose(null);
    };
  });

  // Name the editor: the component renders a bare contenteditable (no `label` can reach it through the engine here), so only the
  // accessible name is added. No `role` / `aria-multiline` override: it would flatten the headings and the region seams for screen readers.
  $effect(() => {
    if (!engine || !scope) return;
    scope.querySelector('[data-nabu-root]')?.setAttribute('aria-label', label);
  });

  /** Back to the seed (a persisted document is cleared first). One action, no confirmation. */
  export async function reset() {
    if (busy || !engine || !mods) return;
    busy = true;
    // Let go of the focus first: a focus listener of the engine (regions follow the focus) must not fire while the editor is torn down.
    /** @type {HTMLElement | null} */ (document.activeElement)?.blur?.();
    await tick();
    const old = /** @type {any} */ (engine);
    engine = null;
    expose(null);
    try {
      if (docId) await old.clearPersistence();
      old.persistence?.dispose();
      const eng = await createEngine(mods.lib);
      engine = eng;
      expose(eng);
      announcement = '';
      await tick();
      announcement = 'Editor reset';
    } finally {
      busy = false;
    }
  }

  /** @type {import('./helpers.js').WidgetContext | null} */
  const ctx = $derived(engine && mods && scope ? /** @type {import('./helpers.js').WidgetContext} */ ({ engine, lib: /** @type {any} */ (mods).lib, ext: /** @type {any} */ (mods).ext, scope }) : null);
</script>

<div class="arch-widget" data-testid="widget" data-widget={id} data-ready={engine ? 'true' : 'false'} style:--arch-h="{height}px" style:--arch-panel-h="{panelHeight}px">
  <div class="frame">
    <div class="nb-theme-atelier slot" data-nb-scheme={scheme} bind:this={scope} data-testid="widget-editor">
      {#if engine && mods}
        {#if toolbar}<mods.ui.FloatingToolbar {engine} />{/if}
        <mods.ui.SlashMenu {engine} />
        {#if chooser}
          <mods.ui.CommandInvite {engine} />
          <mods.ui.CommandChooser {engine} />
        {/if}
        <mods.lib.NabuEditor {engine} />
      {:else}
        <div class="skeleton" aria-hidden="true" data-testid="widget-skeleton">
          <span class="bar" style="width: 74%"></span>
          <span class="bar" style="width: 58%"></span>
          <span class="bar" style="width: 66%"></span>
        </div>
      {/if}
    </div>
    <aside class="panel" aria-label="X-ray" aria-live="off" data-testid="xray">
      <div class="inner">
        <div class="head">
          <span class="title">{title}</span>
          {#if ctx && head}<span class="head-extra">{@render head(ctx)}</span>{/if}
        </div>
        <div class="body">
          {#if ctx}
            {@render panel(ctx)}
          {:else}
            <p class="idle">Waiting for the editor…</p>
          {/if}
        </div>
      </div>
    </aside>
  </div>
  <div class="below">
    <span class="below-extra">{#if ctx && below}{@render below(ctx)}{/if}</span>
    <button type="button" class="reset" data-testid="widget-reset" disabled={!engine || busy} onclick={reset}>Reset</button>
  </div>
  <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
</div>

<style>
  .arch-widget {
    margin-block: var(--site-space-6);
    font: 400 var(--site-fs-small) / var(--site-lh-small) var(--site-font-body);
    color: var(--site-text-muted);
  }

  /* One box: the editor, then the panel under it; from 1000px, side by side. */
  .frame {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    overflow: hidden;
    border: 1px solid var(--site-border);
    border-radius: 18px;
    background: var(--site-surface);
  }
  @media (min-width: 1000px) {
    .frame { grid-template-columns: minmax(0, 3fr) minmax(280px, 2fr); }
  }

  /* The pane's height: the seeds at rest fit (measured at 375px and at 1440px, see the e2e spec), so the page does not jump when the
     editor replaces the skeleton. It only grows when the visitor writes more. */
  .slot {
    min-width: 0;
    --atelier-pane-padding: 22px 24px;
  }
  .slot,
  .slot :global(.nabu-editor) {
    min-height: 320px;
  }
  @media (max-width: 759.98px) {
    .slot { --atelier-pane-padding: 18px 16px; }
    .slot,
    .slot :global(.nabu-editor) { min-height: 300px; }
  }
  @media (min-width: 1000px) {
    .slot,
    .slot :global(.nabu-editor) { min-height: var(--arch-h); }
  }
  /* The frame draws the border and the corners; the editor keeps its focus indicator as an inset ring (the theme's own is its border). */
  .slot :global(.nabu-editor[data-nabu-root]) {
    border: 0;
    border-radius: 0;
  }
  .slot :global(.nabu-editor[data-nabu-root]:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--site-accent);
  }

  /* ── Skeleton: the pane's size, a few bars ── */
  .skeleton {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 22px;
    min-height: inherit;
    padding: var(--atelier-pane-padding);
    background: var(--site-surface);
  }
  .bar {
    display: block;
    height: 12px;
    border-radius: 6px;
    background: var(--site-border);
  }

  /* ── The panel: its size never depends on what it shows ── */
  .panel {
    position: relative;
    min-width: 0;
    box-sizing: border-box;
    height: var(--arch-panel-h);
    background: var(--site-surface-2);
    border-top: 1px solid var(--site-border);
    color: var(--site-text-muted);
    font: 400 13px / 1.55 var(--site-font-mono);
  }
  @media (min-width: 1000px) {
    .panel {
      height: auto;
      border-top: 0;
      border-left: 1px solid var(--site-border);
    }
  }
  .inner {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-sizing: border-box;
    padding: 18px 20px;
  }
  .head {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 30px;
  }
  .title {
    color: var(--site-accent);
    font: 500 12px / 1.4 var(--site-font-mono);
    letter-spacing: var(--site-ls-label);
    text-transform: uppercase;
  }
  .head-extra { display: inline-flex; align-items: center; gap: 8px; }
  .body {
    flex: 1;
    min-height: 0;
    overflow: hidden auto;
  }
  .idle { margin: 0; color: var(--site-text-subtle); }

  /* ── Under the frame ── */
  .below {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--site-space-3);
    margin-top: var(--site-space-2);
  }
  .below-extra { display: inline-flex; align-items: center; flex-wrap: wrap; gap: var(--site-space-2); min-width: 0; }
  .reset {
    margin-left: auto;
    padding: var(--site-space-1) var(--site-space-2);
    border: 0;
    border-radius: var(--site-radius-control);
    background: none;
    color: var(--site-text-subtle);
    font: 500 var(--site-fs-small) / var(--site-lh-small) var(--site-font-body);
    cursor: pointer;
  }
  .reset:hover:not(:disabled) { color: var(--site-text); text-decoration: underline; text-underline-offset: 3px; }
  .reset:disabled { cursor: default; opacity: 0.6; }
  @media (max-width: 759.98px) {
    .reset { min-height: 44px; padding-inline: var(--site-space-3); }
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  /* ── Shared by the panels of the widgets (they sit in `.body`, so these are global, scoped to the widget) ── */
  .arch-widget :global(.w-label) {
    margin: 0;
    color: var(--site-text-subtle);
    font: 500 11px / 1.4 var(--site-font-mono);
    letter-spacing: var(--site-ls-label);
    text-transform: uppercase;
  }
  .arch-widget :global(.w-text) { color: var(--site-text); }
  .arch-widget :global(.w-muted) { color: var(--site-text-subtle); }
  .arch-widget :global(.w-accent) { color: var(--site-accent); }
  .arch-widget :global(.w-line) { overflow: hidden; white-space: pre; text-overflow: ellipsis; }
  .arch-widget :global(.w-btn) {
    min-height: 30px;
    padding: 0 10px;
    border: 1px solid var(--site-border-strong);
    border-radius: var(--site-radius-control);
    background: var(--site-surface);
    color: var(--site-text-muted);
    font: 500 12px / 1 var(--site-font-body);
    cursor: pointer;
  }
  .arch-widget :global(.w-btn:hover:not(:disabled)) { color: var(--site-text); border-color: var(--site-text-subtle); }
  .arch-widget :global(.w-btn[aria-pressed='true']) { color: var(--site-text); border-color: var(--site-accent); }
  .arch-widget :global(.w-btn:disabled) { opacity: 0.6; cursor: default; }
  @media (max-width: 759.98px) {
    .arch-widget :global(.w-btn) { min-height: 44px; padding-inline: 14px; }
  }
</style>
