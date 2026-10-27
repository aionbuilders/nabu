<script>
  import { onMount, tick } from 'svelte';
  import '#lib/themes/atelier.css';

  /**
   * The home page editor: a real, persisted Nabu editor wearing the published "Atelier" theme.
   *
   * Client-only (Loro WASM, IndexedDB): the server renders a same-size skeleton, `#lib` is imported dynamically on mount so the WASM
   * never enters the server bundle. Public API only: the root entry, `#lib/ui/index.js`, and the theme stylesheet.
   * The layout is a row, ready for a right-hand panel next to `.editor-col` (the "X-ray", later).
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

  // The editor element is the textbox: name it, mark it multi-line (the component renders a bare contenteditable).
  $effect(() => {
    if (!engine || !scope) return;
    const root = scope.querySelector('[data-nabu-root]');
    if (!root) return;
    root.setAttribute('role', 'textbox');
    root.setAttribute('aria-multiline', 'true');
    root.setAttribute('aria-label', 'Try Nabu');
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
  <div class="row">
    <div class="editor-col">
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
        <button type="button" class="reset" data-testid="hero-editor-reset" disabled={!engine || busy} onclick={reset}>Reset</button>
      </div>
      <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    </div>
  </div>
</section>

<style>
  .hero-editor {
    padding-bottom: var(--site-space-10);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--site-space-6);
  }
  .editor-col {
    flex: 1 1 560px;
    min-width: 0;
  }

  /* The pane's height: the seeded document at rest, measured (269px on one line per paragraph at 18px; 259px at 17px; 317px when the
     two first paragraphs wrap, on a phone), so the page does not jump when the editor replaces the skeleton, nor when Reset reseeds.
     It only grows when the visitor writes more. */
  .slot,
  .slot :global(.nabu-editor) {
    min-height: 269px;
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
      min-height: 317px;
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
    display: flex;
    justify-content: flex-end;
    margin-top: var(--site-space-3);
  }
  .reset {
    padding: var(--site-space-1) var(--site-space-2);
    border: 0;
    border-radius: var(--site-radius-control);
    background: none;
    color: var(--site-text-subtle);
    font: 500 var(--site-fs-small) / var(--site-lh-small) var(--site-font-body);
    cursor: pointer;
  }
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
</style>
