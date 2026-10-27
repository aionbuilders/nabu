<script>
  import { onMount, tick } from 'svelte';
  import '#lib/themes/atelier.css';
  import XRay from './XRay.svelte';

  /**
   * The home page editor: a real, persisted Nabu editor wearing the published "Atelier" theme.
   *
   * Client-only (Loro WASM, IndexedDB): the server renders a same-size skeleton, `#lib` is imported dynamically on mount so the WASM
   * never enters the server bundle. Public API only: the root entry, `#lib/ui/index.js`, and the theme stylesheet.
   * Next to it, the X-ray (XRay.svelte): the live model, read from `engine.doc`. Side by side from 1000px; under the editor, collapsed
   * behind a toggle, below.
   */

  const DOC_ID = 'nabu-home';

  /** Site theme: `<html data-theme="dark|light">` (absent = follow the system), see ThemeToggle.svelte and app.html. */
  /** @type {'dark' | 'light' | 'auto'} */
  let scheme = $state('auto');

  /** @type {import('#lib').Nabu | null} */
  let engine = $state.raw(null);
  /** @type {{ lib: typeof import('#lib'), ui: typeof import('#lib/ui/index.js') } | null} */
  let mods = $state.raw(null);
  let busy = $state(false);
  let announcement = $state('');
  /** The X-ray under 1000px: collapsed until asked for. (Side by side it is always there; the toggle is not shown.) */
  let xrayOpen = $state(false);
  /** @type {HTMLElement | undefined} */
  let scope = $state();

  const readScheme = () => {
    const attr = document.documentElement.getAttribute('data-theme');
    return attr === 'dark' || attr === 'light' ? attr : 'auto';
  };

  /** The seed (English), a Nabu JSON export: one `importJSON` call, undo history cleared. @param {import('#lib').Nabu} eng @param {string} version */
  async function seed(eng, version) {
    await eng.importJSON({
      version,
      blocks: [
        { type: 'paragraph', content: [{ text: 'Start typing', bold: true }, { text: ' — this is Nabu.' }] },
        { type: 'paragraph', content: 'Press / for blocks, ::: for a region, ⌘Z to rewind.' },
        {
          type: 'region',
          props: { regionType: 'section-2', title: 'The bank' },
          children: [
            {
              type: 'list',
              props: { listType: 'bullet' },
              children: [
                { type: 'list-item', content: 'Bold, italic, links, code' },
                { type: 'list-item', content: 'Lists, quotes, code blocks' },
              ],
            },
            { type: 'paragraph', content: 'Everything you type is kept in this browser.' },
          ],
        },
      ],
    });
    /** @type {any} */ (eng).undoManager?.clear();
  }

  /** @param {typeof import('#lib')} lib */
  async function createEngine(lib) {
    const eng = await lib.createPersistedEditor({
      docId: DOC_ID,
      lang: 'en',
      // A curated set: text, headings, lists (+ to-do), quote, code, divider, regions, rich text, shortcuts, paste. No media.
      preset: [
        lib.ParagraphExtension,
        lib.HeadingExtension,
        lib.BlockquoteExtension,
        lib.DividerExtension,
        lib.CodeExtension,
        lib.ListExtension,
        lib.ListItemExtension,
        lib.RegionsExtension(),
        lib.RichTextExtension,
        lib.TypographyExtension,
        lib.MarkdownShortcutsExtension,
        lib.PlainTextPasteExtension,
        lib.HtmlPasteExtension,
        lib.MarkdownPasteExtension,
        lib.NabuPasteExtension,
        lib.BlockExtension,
      ],
    });
    if (/** @type {any} */ (eng).isNew) await seed(eng, lib.JSON_FORMAT_VERSION);
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
      const [lib, ui] = await Promise.all([import('#lib'), import('#lib/ui/index.js')]);
      const eng = await createEngine(lib);
      if (cancelled) { /** @type {any} */ (eng).persistence?.dispose(); return; }
      mods = { lib, ui };
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

  // Name the editor. The component renders a bare contenteditable (no label prop on <NabuEditor>, no engine option), which browsers
  // already expose as a multi-line textbox: only the accessible name is added. No `role` / `aria-multiline` override, it would
  // flatten the headings and region seams inside for screen readers.
  $effect(() => {
    if (!engine || !scope) return;
    scope.querySelector('[data-nabu-root]')?.setAttribute('aria-label', 'Try Nabu');
  });

  /** Clear the stored document and start again from the seed. One action, no confirmation. */
  async function reset() {
    if (busy || !engine || !mods) return;
    busy = true;
    const old = /** @type {any} */ (engine);
    engine = null;
    expose(null);
    try {
      await old.clearPersistence();
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
</script>

<section class="hero-editor" aria-label="Live editor">
  <div class="grid">
    <div class="nb-theme-atelier slot" data-nb-scheme={scheme} bind:this={scope} data-testid="hero-editor">
      {#if engine && mods}
        <mods.ui.FloatingToolbar {engine} />
        <mods.ui.SlashMenu {engine} />
        <mods.ui.DragHandle {engine} />
        <mods.ui.CommandInvite {engine} />
        <mods.ui.CommandChooser {engine} />
        <mods.lib.NabuEditor {engine} />
      {:else}
        <div class="skeleton" aria-hidden="true" data-testid="hero-editor-skeleton">
          <span class="bar" style="width: 52%"></span>
          <span class="bar" style="width: 78%"></span>
          <span class="bar seam"><i></i><span></span></span>
          <span class="bar" style="width: 38%"></span>
          <span class="bar" style="width: 36%"></span>
          <span class="bar" style="width: 62%"></span>
        </div>
      {/if}
    </div>
    <div class="actions">
      <button type="button" class="toggle" data-testid="xray-toggle" aria-expanded={xrayOpen} aria-controls="xray-panel" onclick={() => (xrayOpen = !xrayOpen)}>
        <svg class="chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
        Show the model
      </button>
      <button type="button" class="reset" data-testid="hero-editor-reset" disabled={!engine || busy} onclick={reset}>Reset</button>
    </div>
    <XRay {engine} open={xrayOpen} id="xray-panel" />
  </div>
  <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
</section>

<style>
  .hero-editor {
    padding-bottom: var(--site-space-10);
  }
  /* Below 1000px: the editor, its actions (the model toggle, Reset), then the panel. From 1000px: editor | panel, the actions below. */
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'slot' 'actions' 'xray';
  }
  .slot {
    grid-area: slot;
    min-width: 0;
  }
  @media (min-width: 1000px) {
    .grid {
      grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
      grid-template-areas: 'slot xray' 'actions actions';
    }
  }

  /* The pane's height: the seeded document at rest, measured (282px at 16px with the 36px padding; 258px with the 24px phone padding;
     284px when the first paragraph wraps, ~400-480px wide; 311px when the two first wrap, below ~400px), rounded up, so the page does
     not jump when the editor replaces the skeleton, nor when Reset reseeds. It only grows when the visitor writes more. */
  .slot,
  .slot :global(.nabu-editor) {
    min-height: 283px;
  }
  @media (max-width: 759.98px) {
    .slot,
    .slot :global(.nabu-editor) {
      min-height: 259px;
    }
  }
  @media (max-width: 480px) {
    .slot,
    .slot :global(.nabu-editor) {
      min-height: 285px;
    }
  }
  @media (max-width: 400px) {
    .slot,
    .slot :global(.nabu-editor) {
      min-height: 311px;
    }
  }
  /* Side by side the pane is as tall as the panel needs for the seeded model (up to 10 lines + the 5-line log), and the pane's right edge is
     the join: square corners there, the panel draws the other half. */
  @media (min-width: 1000px) {
    .slot,
    .slot :global(.nabu-editor) {
      min-height: 440px;
    }
    .slot :global(.nabu-editor[data-nabu-root]),
    .skeleton {
      border-radius: var(--atelier-pane-radius) 0 0 var(--atelier-pane-radius);
    }
  }

  /* ── Skeleton: the pane (same box as the theme gives the editor) with a few bars ── */
  .skeleton {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 22px;
    min-height: inherit;
    padding: var(--atelier-pane-padding);
    background: var(--site-surface);
    border: 1px solid var(--site-border);
    border-radius: var(--atelier-pane-radius);
  }
  .bar {
    display: block;
    height: 12px;
    border-radius: 6px;
    background: var(--site-border);
  }
  .bar.seam {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 12px;
    background: none;
  }
  .bar.seam i {
    width: 16px;
    height: 12px;
    border-radius: 3px;
    background: var(--site-accent-fill);
    opacity: 0.6;
  }
  .bar.seam span {
    flex: 1;
    height: 1px;
    background: var(--site-border-strong);
  }

  .actions {
    grid-area: actions;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--site-space-3);
  }
  .toggle,
  .reset {
    padding: var(--site-space-1) var(--site-space-2);
    border: 0;
    border-radius: var(--site-radius-control);
    background: none;
    color: var(--site-text-subtle);
    font: 500 var(--site-fs-small) / var(--site-lh-small) var(--site-font-body);
    cursor: pointer;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--site-space-2);
  }
  .chev {
    transition: transform 0.15s;
  }
  .toggle[aria-expanded='true'] .chev {
    transform: rotate(180deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .chev { transition: none; }
  }
  .reset { margin-left: auto; }
  @media (min-width: 1000px) {
    .toggle { display: none; }
  }
  .toggle:hover,
  .reset:hover:not(:disabled) {
    color: var(--site-text);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .reset:disabled {
    cursor: default;
    opacity: 0.6;
  }
  @media (max-width: 759.98px) {
    .toggle, .reset { min-height: 44px; padding-inline: var(--site-space-3); }
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
</style>
