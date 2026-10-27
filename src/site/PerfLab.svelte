<script>
  import { onMount, tick } from 'svelte';
  import '#lib/themes/atelier.css';
  import LatencyMeter from './LatencyMeter.svelte';
  import { curatedPreset } from './preset.js';
  import { genDoc } from './gen-doc.js';
  import { createKeyMeter, nextPaint, pushBounded } from './measure.js';

  /**
   * The Performance lab: a real Nabu editor (Atelier theme, the curated extensions of the home editor, NOT persisted) holding a generated
   * document of 1,000 / 5,000 / 10,000 blocks, and the meter next to it (LatencyMeter.svelte, fed by the shared key-to-next-paint
   * measure of measure.js). Client-only: `#lib` is imported on mount (Loro WASM never enters the server bundle). Public API only:
   * the root entry, `#lib/ui/index.js`, `createEditor`, `importJSON`. Nothing leaves the page: the document is generated here.
   */

  const SIZES = [1000, 5000, 10000];
  /** The sparkline shows this many of the last keystrokes. */
  const RECENT = 60;
  /** Samples kept for the p50 / p95 since the load (a bound, not a window the visitor will reach). */
  const KEEP = 5000;

  /** @param {number} n */
  const fmt = (n) => n.toLocaleString('en-US');
  /** @param {number} ms */
  const fmtSeconds = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

  /** @type {'dark' | 'light' | 'auto'} */
  let scheme = $state('auto');
  let size = $state(1000);
  /** @type {'boot' | 'loading' | 'ready' | 'error'} */
  let status = $state('boot');
  /** Blocks of the document being loaded (the generator rounds up to complete containers). */
  let loading = $state(0);
  /** @type {{ nodes: number, ms: number } | null} */
  let loaded = $state(null);
  /** @type {import('#lib').Nabu | null} */
  let engine = $state.raw(null);
  /** @type {{ lib: typeof import('#lib'), ui: typeof import('#lib/ui/index.js') } | null} */
  let mods = $state.raw(null);
  /** @type {Array<{ paint: number, engine: number }>} */
  let samples = $state.raw([]);
  /** @type {HTMLElement | undefined} */
  let scope = $state();
  let runId = 0;

  const readScheme = () => {
    const attr = document.documentElement.getAttribute('data-theme');
    return attr === 'dark' || attr === 'light' ? attr : 'auto';
  };

  /** @param {number} n */
  async function load(n) {
    if (!mods) return;
    const id = ++runId;
    size = n;
    status = 'loading';
    loading = n;
    loaded = null;
    engine = null;
    samples = [];
    // Let the "Loading…" state reach the screen before the main thread is busy.
    await tick();
    await nextPaint();
    try {
      const { lib } = mods;
      const g = genDoc({ blocks: n, regions: true });
      const eng = lib.createEditor({ preset: curatedPreset(lib), lang: 'en' });
      const t0 = performance.now();
      await eng.importJSON({ ...g.doc, version: lib.JSON_FORMAT_VERSION });
      if (id !== runId) return;
      engine = eng;
      // Loaded = every block is in the DOM and the frame showing them is out.
      await tick();
      const t1 = performance.now();
      while (id === runId && document.querySelectorAll('[data-block-id]').length < g.nodes && performance.now() - t1 < 120000) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      await nextPaint();
      if (id !== runId) return;
      loaded = { nodes: g.nodes, ms: performance.now() - t0 };
      status = 'ready';
    } catch (e) {
      if (id !== runId) return;
      console.error(e);
      status = 'error';
    }
  }

  onMount(() => {
    scheme = readScheme();
    const observer = new MutationObserver(() => { scheme = readScheme(); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    let cancelled = false;
    (async () => {
      const [lib, ui] = await Promise.all([import('#lib'), import('#lib/ui/index.js')]);
      if (cancelled) return;
      mods = { lib, ui };
      // `?blocks=1000|5000|10000` picks the size (shareable, and what the specs use). Otherwise a phone starts small: 1,000 blocks;
      // wider screens start at the headline number.
      const asked = Number(new URLSearchParams(location.search).get('blocks'));
      await load(SIZES.includes(asked) ? asked : matchMedia('(max-width: 759.98px)').matches ? 1000 : 10000);
    })();

    return () => {
      cancelled = true;
      runId++;
      observer.disconnect();
    };
  });

  // The shared meter watches the editor once the document is fully loaded (during the load the DOM changes by the thousand).
  $effect(() => {
    if (status !== 'ready' || !engine || !scope) return;
    const root = scope.querySelector('[data-nabu-root]');
    if (!root) return;
    root.setAttribute('aria-label', 'Editor with a large document');
    const meter = createKeyMeter(root, (sample) => { samples = pushBounded(samples, sample, KEEP); });
    return () => meter.dispose();
  });

  /** Move the caret into a paragraph in the middle of the document (so the first key is typed far from either end). */
  function jumpToMiddle() {
    const root = scope?.querySelector('[data-nabu-root]');
    if (!(root instanceof HTMLElement)) return;
    const paragraphs = root.querySelectorAll('[data-block-type="paragraph"]');
    const target = paragraphs[Math.floor(paragraphs.length / 2)];
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    root.focus({ preventScroll: true });
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode();
    if (!text) return;
    const range = document.createRange();
    range.setStart(text, Math.min(12, text.textContent?.length ?? 0));
    range.collapse(true);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
</script>

<section class="lab" aria-label="Performance lab">
  <div class="controls">
    <fieldset class="seg" disabled={status === 'boot' || status === 'loading'} data-testid="lab-sizes">
      <legend class="label">Load</legend>
      {#each SIZES as n (n)}
        <label class="opt">
          <input type="radio" name="lab-size" value={n} checked={size === n} onchange={() => load(n)} data-testid="lab-size-{n}" />
          <span>{fmt(n)}<span class="long">&nbsp;blocks</span></span>
        </label>
      {/each}
    </fieldset>
    <p class="status" role="status" aria-live="polite" data-testid="lab-status" data-state={status}>
      {#if status === 'boot'}
        Starting the editor…
      {:else if status === 'loading'}
        Loading {fmt(loading)} blocks…
      {:else if status === 'error'}
        Could not load the document. Reload the page to try again.
      {:else if loaded}
        <span data-testid="lab-loaded">{fmt(loaded.nodes)} blocks loaded in {fmtSeconds(loaded.ms)}</span>
      {/if}
    </p>
  </div>

  <div class="grid">
    <div class="nb-theme-atelier slot" data-nb-scheme={scheme} bind:this={scope} data-testid="lab-editor" aria-busy={status === 'loading'}>
      {#if engine && mods}
        <mods.ui.FloatingToolbar {engine} />
        <mods.ui.SlashMenu {engine} />
        <mods.ui.DragHandle {engine} />
        <mods.ui.CommandInvite {engine} />
        <mods.ui.CommandChooser {engine} />
        <mods.lib.NabuEditor {engine} />
      {/if}
      {#if status !== 'ready'}
        <div class="overlay" data-testid="lab-loading">
          {#if status !== 'error'}
            <span class="bar" aria-hidden="true"><i></i></span>
          {/if}
        </div>
      {/if}
    </div>
    <div class="meter-slot">
      <LatencyMeter {samples} recent={RECENT} ready={status === 'ready'} />
      <button type="button" class="jump" disabled={status !== 'ready'} onclick={jumpToMiddle} data-testid="lab-jump">Put the caret in the middle of the document</button>
    </div>
  </div>

  <details class="how" data-testid="lab-how">
    <summary>How we measure</summary>
    <div class="body">
      <h3>Key to next paint</h3>
      <p>
        The clock starts at the keyboard event's own timestamp: the moment the browser received the key, so any time the key spent
        waiting behind other work counts. It stops at the first frame painted after the text on screen has been updated. It is the
        idea behind the browser's "Interaction to Next Paint", applied to every keystroke. This is the big number.
      </p>
      <h3>Engine work</h3>
      <p>
        Same start, but it stops as soon as the text of the edited block has changed in the page, before the browser lays out and
        paints. It is what Nabu itself spends, without the browser's share. A detail, shown in small.
      </p>
      <h3>The budget</h3>
      <p>
        16.7 ms is one frame on a 60 Hz screen. A keystroke on screen within one frame cannot be told from an instant one. On a
        120 Hz screen the frame is 8.3 ms, and the first keys of a session are slower while the browser warms up. p50 is the
        typical keystroke, p95 the slow one in twenty, both since the document was loaded.
      </p>
      <h3>Your machine, your numbers</h3>
      <p>
        Everything runs in your browser, on your device: the document is generated here, nothing is saved, nothing is sent anywhere.
        The results depend on your CPU, your browser, your screen's refresh rate and the extensions you run.
      </p>
    </div>
  </details>
</section>

<style>
  .lab {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-6);
  }

  /* ── Controls ── */
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--site-space-3) var(--site-space-6);
  }
  .seg {
    display: flex;
    align-items: center;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .seg legend {
    float: left; /* the legend and the options on one line */
    padding: 0;
    margin-right: var(--site-space-3);
    color: var(--site-text-subtle);
    text-transform: uppercase;
  }
  .opt {
    position: relative;
    display: inline-flex;
  }
  .opt input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .opt > span {
    display: inline-flex;
    align-items: center;
    min-height: 40px;
    padding: 0 var(--site-space-4);
    border: 1px solid var(--site-border-strong);
    color: var(--site-text-muted);
    font: 500 var(--site-fs-small) / 1 var(--site-font-mono);
    font-variant-numeric: tabular-nums;
    white-space: pre;
  }
  @media (max-width: 559.98px) {
    .opt .long { display: none; }
    .opt > span { padding: 0 var(--site-space-3); }
  }
  .opt:first-of-type > span { border-radius: var(--site-radius-control) 0 0 var(--site-radius-control); }
  .opt:last-of-type > span { border-radius: 0 var(--site-radius-control) var(--site-radius-control) 0; }
  .opt + .opt > span { margin-left: -1px; }
  .opt input:checked + span {
    background: var(--site-hover-bg);
    border-color: var(--site-text-subtle);
    color: var(--site-text);
    position: relative;
  }
  .opt input:hover:not(:checked):not(:disabled) + span { color: var(--site-text); }
  .opt input:focus-visible + span { outline: 2px solid var(--site-accent); outline-offset: 2px; }
  .seg:disabled .opt input { cursor: default; }
  .seg:disabled { opacity: 0.7; }
  .status {
    margin: 0;
    color: var(--site-text-muted);
    font: 400 13px / 1.5 var(--site-font-mono);
    font-variant-numeric: tabular-nums;
  }
  .status[data-state='loading'] { color: var(--site-accent); }

  /* ── Editor + meter ── */
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'meter' 'slot';
    gap: var(--site-space-4);
  }
  .slot {
    grid-area: slot;
    position: relative;
    min-width: 0;
    /* A fixed-height scroll container: the pane (the editor) scrolls, the page does not move while the document grows. */
    height: clamp(320px, 58vh, 520px);
  }
  .slot :global(.nabu-editor[data-nabu-root]) {
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .meter-slot {
    grid-area: meter;
    display: flex;
    flex-direction: column;
    gap: var(--site-space-2);
    min-width: 0;
  }
  .jump {
    align-self: flex-start;
    padding: var(--site-space-1) var(--site-space-2);
    border: 0;
    border-radius: var(--site-radius-control);
    background: none;
    color: var(--site-text-subtle);
    font: 500 var(--site-fs-small) / var(--site-lh-small) var(--site-font-body);
    cursor: pointer;
  }
  .jump:hover:not(:disabled) { color: var(--site-text); text-decoration: underline; text-underline-offset: 3px; }
  .jump:disabled { cursor: default; opacity: 0.6; }
  @media (max-width: 759.98px) {
    .jump { min-height: 44px; }
  }
  @media (min-width: 1000px) {
    .grid {
      grid-template-columns: minmax(0, 3fr) minmax(300px, 2fr);
      grid-template-areas: 'slot meter';
      align-items: start;
      gap: var(--site-space-6);
    }
    .slot { height: 560px; }
  }

  /* While loading: the pane's place is held by a quiet surface with a moving bar (transform only: it keeps moving while the thread is busy). */
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--site-surface);
    border: 1px solid var(--site-border);
    border-radius: var(--atelier-pane-radius, 16px);
  }
  .bar {
    position: relative;
    width: min(240px, 60%);
    height: 2px;
    overflow: hidden;
    background: var(--site-border);
    border-radius: 2px;
  }
  .bar i {
    position: absolute;
    inset: 0;
    width: 40%;
    background: var(--site-accent-fill);
    animation: slide 1.1s ease-in-out infinite;
  }
  @keyframes slide {
    from { transform: translateX(-100%); }
    to { transform: translateX(250%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar i { animation: none; width: 100%; opacity: 0.5; }
  }

  /* ── How we measure ── */
  .how {
    border-top: 1px solid var(--site-border);
    border-bottom: 1px solid var(--site-border);
  }
  .how summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 52px;
    padding: 0 var(--site-space-1);
    color: var(--site-text);
    font-weight: 500;
    cursor: pointer;
    list-style: none;
  }
  .how summary::-webkit-details-marker { display: none; }
  .how summary::after {
    content: '+';
    color: var(--site-text-subtle);
    font: 400 20px / 1 var(--site-font-mono);
  }
  .how[open] summary::after { content: '−'; }
  .body {
    display: grid;
    gap: var(--site-space-2) var(--site-space-8);
    padding: var(--site-space-2) var(--site-space-1) var(--site-space-6);
    max-width: 720px;
  }
  .body h3 {
    margin: var(--site-space-3) 0 0;
    color: var(--site-text);
    font: 500 var(--site-fs-small) / var(--site-lh-small) var(--site-font-body);
  }
  .body p {
    margin: 0;
    color: var(--site-text-muted);
    font-size: var(--site-fs-small);
    line-height: var(--site-lh-body);
  }
</style>
