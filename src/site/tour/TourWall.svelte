<script>
  import { tick } from 'svelte';
  import TourDoc from './TourDoc.svelte';
  import TourCardOpen from './TourCardOpen.svelte';
  import { REFERENCE_PATH } from './tour-data.js';

  /**
   * Every block, as a specimen: a grid of cards (a live example in a frame, the name, the registered type, one sentence, the chips) with filters. A card is a
   * disclosure: its title is the button (`aria-expanded`), and the card it opens spans the grid, right under the row it is in.
   * @type {{ cards: Array<import('./tour-data.js').TourCard & { doc: { snapshot: string, code: Record<string, Array<[string, string?]>> } }> }}
   */
  let { cards } = $props();

  const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'text', label: 'Text' },
    { id: 'containers', label: 'Containers' },
    { id: 'structure', label: 'Structure' },
    { id: 'media', label: 'Media' },
  ];

  let filter = $state('all');
  /** @type {string | null} */
  let openId = $state(null);
  /** Columns of the grid (the open card goes after the last one of its row); 3 until measured. */
  let cols = $state(3);
  /** @type {HTMLElement | undefined} */
  let grid = $state();

  const shown = (/** @type {string} */ f) => cards.filter((c) => f === 'all' || c.groups.includes(f));
  const visible = $derived(shown(filter));
  const openIndex = $derived(visible.findIndex((c) => c.id === openId));
  const rowStart = $derived(openIndex < 0 ? -1 : Math.floor(openIndex / cols) * cols);
  const rowEnd = $derived(openIndex < 0 ? -1 : Math.min(visible.length - 1, rowStart + cols - 1));
  const openCardData = $derived(cards.find((c) => c.id === openId) ?? null);

  $effect(() => {
    if (!grid) return;
    const g = grid;
    const read = () => { cols = Math.max(1, getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length); };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(g);
    return () => ro.disconnect();
  });

  /** @param {string} id */
  function setFilter(id) {
    filter = id;
    if (openId && !shown(id).some((c) => c.id === openId)) openId = null;
  }

  /** @type {string | null} the card whose button gets the focus back when its card closes */
  let opener = null;

  /** Opens (or closes) a card. @param {string} id */
  export async function toggleCard(id) {
    if (openId === id) { close(); return; }
    if (!shown(filter).some((c) => c.id === id)) filter = 'all';
    opener = id;
    openId = id;
    await tick();
    const panel = document.querySelector('[data-testid="card-open"]');
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    panel?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
    /** @type {HTMLElement | null | undefined} */ (panel?.querySelector('h3'))?.focus({ preventScroll: true });
  }

  function close() {
    const id = openId;
    openId = null;
    if (id) tick().then(() => /** @type {HTMLElement | null} */ (document.querySelector(`[data-card="${id}"] button.open`))?.focus());
  }

  /** @param {number} i index among the visible cards */
  const sameRow = (i) => openIndex >= 0 && i >= rowStart && i <= rowEnd;
</script>

<section class="wall" aria-labelledby="wall-title" data-testid="tour-wall">
  <div class="head">
    <div class="title">
      <span class="kicker">THE BLOCKS</span>
      <h2 id="wall-title">Every block, as a specimen</h2>
    </div>
    <div class="filters" role="group" aria-label="Filter the blocks">
      {#each FILTERS as f (f.id)}
        <button type="button" class="pill" aria-pressed={filter === f.id} onclick={() => setFilter(f.id)}>{f.label} <span class="count">{shown(f.id).length}</span></button>
      {/each}
    </div>
  </div>

  <div class="grid" bind:this={grid} data-testid="tour-grid">
    {#each cards as card (card.id)}
      {@const vi = visible.findIndex((c) => c.id === card.id)}
      <article class="card" class:active={openId === card.id} class:dim={openId !== card.id && sameRow(vi)} data-card={card.id} hidden={vi < 0}>
        <div class="frame" inert><TourDoc doc={card.doc} label={`${card.title}, an example`} variant="card" /></div>
        <div class="foot">
          <div class="line">
            <h3><button type="button" class="open" aria-expanded={openId === card.id} aria-controls={openId === card.id ? 'card-open' : undefined} onclick={() => toggleCard(card.id)}>{card.title}</button></h3>
            <span class="type">{card.names.join(' · ')}</span>
          </div>
          <p class="sentence">{card.sentence}</p>
          <ul class="chips" aria-label="How to make one">
            {#each card.wall as chip (chip)}<li class="chip">{chip}</li>{/each}
          </ul>
        </div>
      </article>
      {#if openCardData && vi >= 0 && vi === rowEnd}
        {#key openCardData.id}
          <TourCardOpen card={openCardData} onclose={close} />
        {/key}
      {/if}
    {/each}
  </div>

  <p class="foot-note">
    <span>Click a card to see its state, live. Chips: what you type · the slash menu · the markdown.</span>
    <a href={REFERENCE_PATH}>Every key and edge case: Blocks reference <span aria-hidden="true">→</span></a>
  </p>
</section>

<style>
  .wall {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-end;
    gap: 16px;
  }
  .title {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .kicker {
    color: var(--site-text-subtle);
    font: 500 12px / 1.4 var(--site-font-mono);
    letter-spacing: 0.08em;
  }
  h2 {
    margin: 0;
    font: 700 clamp(28px, 5vw, 36px) / 1.15 var(--site-font-display);
    letter-spacing: var(--site-ls-heading);
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .pill {
    min-height: 34px;
    padding: 0 14px;
    border: 1px solid var(--site-border-strong);
    border-radius: 999px;
    background: transparent;
    color: var(--site-text-muted);
    font: 500 13px var(--site-font-body);
    cursor: pointer;
  }
  .pill:hover {
    color: var(--site-text);
    border-color: var(--site-text-subtle);
  }
  .pill[aria-pressed='true'] {
    border-color: var(--site-text);
    background: var(--site-text);
    color: var(--site-bg);
  }
  .count {
    margin-left: 2px;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 18px;
  }
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid var(--site-border);
    border-radius: 16px;
    background: var(--site-surface);
    overflow: hidden;
    transition: border-color 0.15s, opacity 0.15s;
  }
  .card[hidden] {
    display: none;
  }
  .card:hover {
    border-color: var(--site-border-strong);
  }
  .card.active {
    border-color: var(--site-accent);
  }
  .card.dim {
    opacity: 0.55;
  }
  .frame {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    justify-content: center;
    min-height: 92px;
    padding: 22px;
    border-bottom: 1px solid var(--site-border-subtle);
    background: var(--site-surface-2);
  }
  .foot {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px 18px 18px;
  }
  .line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  h3 {
    margin: 0;
    font: 700 19px / 1.25 var(--site-font-display);
  }
  /* The title is the button, and the button covers the whole card: one target, one name for assistive technology. */
  .open {
    padding: 0;
    border: 0;
    background: none;
    color: var(--site-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .open::after {
    content: '';
    position: absolute;
    inset: 0;
  }
  .open:focus-visible {
    outline: none;
  }
  .card:has(.open:focus-visible) {
    outline: 2px solid var(--site-accent);
    outline-offset: 2px;
  }
  .type {
    color: var(--site-text-subtle);
    font: 400 12px / 1.4 var(--site-font-mono);
    text-align: right;
  }
  .sentence {
    margin: 0;
    color: var(--site-text-muted);
    font-size: 14px;
    line-height: 1.5;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 4px 0 0;
    list-style: none;
  }
  .chip {
    padding: 3px 8px;
    border: 1px solid var(--site-border-strong);
    border-radius: 7px;
    color: var(--site-text);
    font: 400 12px / 1.4 var(--site-font-mono);
    white-space: nowrap;
  }
  .foot-note {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px 24px;
    margin: 0;
    padding-top: 4px;
    color: var(--site-text-subtle);
    font-size: 14px;
  }
  .foot-note a {
    color: var(--site-accent);
    text-underline-offset: 3px;
  }

  @media (max-width: 899.98px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 639.98px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .card.dim {
      opacity: 1;
    }
  }
</style>
