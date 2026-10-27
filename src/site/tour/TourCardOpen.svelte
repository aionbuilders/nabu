<script>
  import { tick } from 'svelte';
  import TourDoc from './TourDoc.svelte';
  import Inline from './Inline.svelte';
  import { createTourEngine } from './tour-preset.js';
  import { stateOf, changedRange, pieces } from './state.js';

  /**
   * An open card, spanning the grid. On the left, the example (read-only until "Try it" is on, then a real editor), how to make the block, what it contains, the
   * keys it owns, the presets that hold it and where to read more. On the right, the state of the example, LIVE: `serialize('json')`, `serialize('markdown')`
   * and the HTML, rebuilt after every change of the document, the stretch just written lit up.
   *
   * The engine is made here, in the browser, when the card opens: nothing of it is in the prerendered page.
   * @type {{ card: import('./tour-data.js').TourCard & { doc: { snapshot: string, code: Record<string, Array<[string, string?]>>, json?: any } }, onclose: () => void }}
   */
  let { card, onclose } = $props();

  const TABS = [
    { id: 'json', label: 'JSON', note: "The block as Nabu exports it: serialize('json'), block ids left out." },
    { id: 'markdown', label: 'Markdown', note: "What leaves the editor as text: serialize('markdown')." },
    { id: 'html', label: 'HTML', note: 'The HTML each block writes on copy, joined. The library has no whole-document HTML export yet.' },
  ];

  // The example of this card is already on the page (in the wall, from the same snapshot): a second editor with the SAME block ids would answer to the same
  // `data-block-id`s, and a caret put in this one could land in the other. So the engine of an open card is a copy with ids of its own: the blocks of the
  // snapshot, imported as JSON into a new document. (The colours of its code block follow, matched by position.)
  // svelte-ignore state_referenced_locally
  const json = /** @type {any} */ (card.doc).json;
  const engine = createTourEngine();
  let ready = $state(false);
  /** @type {Record<string, Array<[string, string?]>>} */
  let code = $state.raw({});
  /** @param {any[]} blocks @returns {string[]} */
  const codeIds = (blocks) => blocks.flatMap((b) => [...(b.type === 'code' ? [b.id] : []), ...codeIds(b.children ?? [])]);
  engine.importJSON(json).then(() => {
    const from = codeIds(json.blocks), to = codeIds(engine.children);
    code = Object.fromEntries(to.map((id, i) => [id, card.doc.code[from[i]]]).filter(([, t]) => t));
    texts = stateOf(engine);
    ready = true;
  });

  let editable = $state(false);
  /** @type {'json' | 'markdown' | 'html'} */
  let tab = $state('json');
  let texts = $state.raw(stateOf(engine));
  /** @type {Record<string, [number, number] | null>} */
  let hot = $state.raw({ json: null, markdown: null, html: null });

  function refresh() {
    const next = stateOf(engine);
    hot = { json: changedRange(texts.json, next.json), markdown: changedRange(texts.markdown, next.markdown), html: changedRange(texts.html, next.html) };
    texts = next;
  }

  // The state follows the document: one refresh per frame, after the commit has been drawn.
  $effect(() => {
    let raf = 0;
    const off = engine.doc.subscribe(() => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; refresh(); });
    });
    return () => { off(); if (raf) cancelAnimationFrame(raf); };
  });

  /** @type {HTMLElement | undefined} */
  let example = $state();

  async function toggleTry() {
    editable = !editable;
    if (!editable) return;
    // Ready to type: the editor has the focus and the caret is at the end of the text.
    await tick();
    /** @type {HTMLElement | null | undefined} */ (example?.querySelector('[data-nabu-root]'))?.focus({ preventScroll: true });
    const last = /** @type {any} */ (engine.lastVisibleBlock);
    const end = { block: last, offset: typeof last?.text === 'string' ? last.text.length : 0 };
    if (last) await engine.focus({ from: end, to: end });
  }

  /** @param {KeyboardEvent} e */
  function onTabKeys(e) {
    const i = TABS.findIndex((t) => t.id === tab);
    let j = i;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') j = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = TABS.length - 1;
    else return;
    e.preventDefault();
    tab = /** @type {typeof tab} */ (TABS[j].id);
    tick().then(() => document.getElementById(`state-tab-${tab}`)?.focus());
  }

  /** @param {KeyboardEvent} e */
  function onkeydown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); onclose(); }
  }

  const current = $derived(TABS.find((t) => t.id === tab) ?? TABS[0]);
  const parts = $derived(pieces(texts[tab], { json: tab === 'json', hot: hot[tab] }));
  const makeOne = $derived([...card.typed, ...card.slash, ...card.md, ...card.files]);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article class="open" id="card-open" data-testid="card-open" data-card-open={card.id} aria-label={`${card.title}, open`} {onkeydown}>
  <div class="left">
    <div class="top">
      <div class="who">
        <h3 tabindex="-1">{card.title}</h3>
        <span class="type">{card.names.join(' · ')}</span>
      </div>
      <div class="controls">
        <span class="try-label" id="try-label">Try it</span>
        <button type="button" class="switch" role="switch" aria-checked={editable} aria-labelledby="try-label" onclick={toggleTry}><span class="knob"></span></button>
        <button type="button" class="close" aria-label="Close this card" onclick={onclose}><span aria-hidden="true">✕</span></button>
      </div>
    </div>

    <div class="example" class:editing={editable} data-testid="card-example" bind:this={example}>
      {#if ready}
        <TourDoc doc={{ snapshot: card.doc.snapshot, code }} {engine} label={`${card.title}, ${editable ? 'editable example' : 'example'}`} variant="open" readonly={!editable} />
      {/if}
    </div>

    <p class="about"><Inline text={card.about} /></p>

    <dl class="facts">
      <dt>Make one</dt>
      <dd>{#each makeOne as chip (chip)}<span class="chip">{chip}</span>{:else}<span class="muted">a menu, a paste or code</span>{/each}</dd>
      <dt>Contains</dt>
      <dd><Inline text={card.contains} /></dd>
      <dt>Keys</dt>
      <dd>
        {#if card.keys.length}
          <span class="keys">{#each card.keys as k, i (i)}<span class="fact"><span class="combo">{#each k.keys as c, j (c)}{#if j}<span class="sep"> / </span>{/if}<kbd>{c}</kbd>{/each}</span> {k.does}</span>{/each}</span>
        {:else}
          {card.keysNote ?? 'None of its own.'}
        {/if}
      </dd>
      {#if card.shortcuts.length}
        <dt>Shortcuts</dt>
        <dd>{#each card.shortcuts as chord (chord)}<span class="chip">{chord}</span>{/each}</dd>
      {/if}
      <dt>Presets</dt>
      <dd>{#each card.presets as p (p)}<span class="chip">{p}</span>{/each}</dd>
    </dl>

    <div class="links">
      {#each card.reference as r, i (r.href)}
        <a class:primary={i === 0} href={r.href}>{i === 0 ? 'All keys and edge cases' : r.title} <span aria-hidden="true">→</span></a>
      {/each}
      {#each card.api as a (a.href)}
        <a class="secondary" href={a.href}>{a.name} in the API</a>
      {/each}
    </div>
  </div>

  <div class="right">
    <div class="bar">
      <div class="tabs" role="tablist" aria-label="State of the example" tabindex="-1" onkeydown={onTabKeys}>
        {#each TABS as t (t.id)}
          <button type="button" role="tab" id={`state-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="state-panel" tabindex={tab === t.id ? 0 : -1} onclick={() => (tab = /** @type {typeof tab} */ (t.id))}>{t.label}</button>
        {/each}
      </div>
      <span class="live"><span class="dot" aria-hidden="true"></span> live</span>
    </div>
    <div class="state" role="tabpanel" id="state-panel" aria-labelledby={`state-tab-${tab}`} tabindex="0" data-testid="state-panel" data-tab={tab}><pre data-testid="state-text">{#each parts as p, i (i)}<span class={p.tone} class:hot={p.hot}>{p.text}</span>{/each}</pre></div>
    <p class="note">{current.note}{#if tab !== 'html'}{' '}{editable ? 'Type in the example: the lit stretch is what you just wrote.' : 'Turn on Try it, then type in the example.'}{/if}</p>
  </div>
</article>

<style>
  .open {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    border: 1px solid var(--site-accent);
    border-radius: 18px;
    background: var(--site-surface);
    overflow: hidden;
    scroll-margin-top: 24px;
  }
  .left {
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-width: 0;
    padding: 26px 28px;
    border-right: 1px solid var(--site-border-subtle);
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .who {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 10px;
    min-width: 0;
  }
  h3 {
    margin: 0;
    font: 700 28px / 1.2 var(--site-font-display);
    letter-spacing: var(--site-ls-h3);
  }
  h3:focus-visible {
    outline: none;
  }
  .type {
    color: var(--site-text-subtle);
    font: 400 12px / 1.4 var(--site-font-mono);
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .try-label {
    color: var(--site-text-muted);
    font-size: 13px;
  }
  .switch {
    position: relative;
    width: 38px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--site-border-strong);
    border-radius: 999px;
    background: var(--site-surface-2);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .switch[aria-checked='true'] {
    border-color: var(--site-accent-fill);
    background: var(--site-accent-fill);
  }
  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--site-text-muted);
    transition: transform 0.15s, background 0.15s;
  }
  .switch[aria-checked='true'] .knob {
    transform: translateX(16px);
    background: var(--site-on-accent);
  }
  .close {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    margin-left: 6px;
    padding: 0;
    border: 1px solid var(--site-border-strong);
    border-radius: 8px;
    background: transparent;
    color: var(--site-text-muted);
    font-size: 13px;
    cursor: pointer;
  }
  .close:hover {
    color: var(--site-text);
    border-color: var(--site-text-subtle);
  }

  .example {
    min-height: 84px;
    padding: 20px 22px;
    border: 1px solid var(--site-border);
    border-radius: 12px;
    background: var(--site-surface-2);
    transition: border-color 0.15s;
  }
  .example.editing {
    border-color: var(--site-accent);
  }
  .about {
    margin: 0;
    color: var(--site-text-muted);
    font-size: 15px;
    line-height: 1.6;
  }
  .facts {
    display: grid;
    grid-template-columns: 90px minmax(0, 1fr);
    gap: 10px 12px;
    align-items: baseline;
    margin: 0;
    font-size: 14px;
  }
  .facts dt {
    color: var(--site-text-subtle);
  }
  .facts dd {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    color: var(--site-text);
    line-height: 1.55;
  }
  .facts dd:not(:has(.chip)) {
    display: block;
  }
  .chip {
    padding: 3px 8px;
    border: 1px solid var(--site-border-strong);
    border-radius: 7px;
    color: var(--site-text);
    font: 400 12px / 1.4 var(--site-font-mono);
    white-space: nowrap;
  }
  .muted {
    color: var(--site-text-subtle);
  }
  .keys {
    display: block;
  }
  .fact + .fact::before {
    content: ' · ';
    color: var(--site-text-subtle);
  }
  kbd {
    padding: 1px 6px;
    border: 1px solid var(--site-border-strong);
    border-radius: 5px;
    background: var(--site-surface-2);
    font: 500 12px / 1.4 var(--site-font-mono);
  }
  .sep {
    color: var(--site-text-subtle);
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    font-size: 14px;
  }
  .links a {
    color: var(--site-text-muted);
    text-underline-offset: 3px;
  }
  .links a:hover {
    color: var(--site-text);
  }
  .links a.primary {
    color: var(--site-accent);
  }

  .right {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    padding: 18px 22px 22px;
    background: var(--site-bg);
  }
  .bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--site-border-subtle);
  }
  .tabs {
    display: flex;
    gap: 4px;
  }
  .tabs button {
    min-height: 32px;
    padding: 0 12px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--site-text-subtle);
    font: 500 13px var(--site-font-body);
    cursor: pointer;
  }
  .tabs button:hover {
    color: var(--site-text);
  }
  .tabs button[aria-selected='true'] {
    border-bottom-color: var(--site-accent);
    color: var(--site-text);
  }
  .live {
    color: var(--site-ok);
    font: 500 11px / 1 var(--site-font-mono);
  }
  .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 3px;
    border-radius: 50%;
    background: currentColor;
    vertical-align: 1px;
  }
  .state {
    max-height: 430px;
    overflow: auto;
    scrollbar-width: thin;
  }
  pre {
    margin: 0;
    color: var(--site-text);
    font: 400 13px / 1.7 var(--site-font-mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  pre .key {
    color: var(--site-peer);
  }
  pre .string {
    color: var(--site-ok);
  }
  pre .literal {
    color: var(--site-accent);
  }
  pre .punct {
    color: var(--site-text-subtle);
  }
  pre .hot {
    border-radius: 3px;
    background: color-mix(in srgb, var(--site-accent) 30%, transparent);
  }
  .note {
    margin: auto 0 0;
    padding-top: 6px;
    color: var(--site-text-subtle);
    font-size: 13px;
    line-height: 1.5;
  }

  @media (max-width: 899.98px) {
    .open {
      grid-template-columns: minmax(0, 1fr);
    }
    .left {
      padding: 20px 18px;
      border-right: 0;
      border-bottom: 1px solid var(--site-border-subtle);
    }
    .right {
      padding: 14px 18px 18px;
    }
    .facts {
      grid-template-columns: minmax(0, 1fr);
      gap: 2px;
    }
    .facts dt {
      margin-top: 8px;
      font-size: 12px;
    }
    .state {
      max-height: 340px;
    }
  }
</style>
