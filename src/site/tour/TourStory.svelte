<script>
  import TourDoc from './TourDoc.svelte';

  /**
   * The story under X-ray: one live Nabu document holding every block, and beside it the card of the block under the pointer, the finger or the focus.
   * The block is outlined and labelled over the document (a box drawn from its rectangle, so that nothing in the document changes), and the panel tells what it
   * is: how it is typed, its slash entry, its Markdown and HTML.
   *
   * Pointer: hover (mouse) or tap. Keyboard: the blocks of the story take focus (one tab stop, then the arrow keys, Home and End), and the focused block is the one
   * under X-ray. `onopen(cardId)` opens the card of the wall.
   *
   * @type {{
   *   story: { label: string, doc: { snapshot: string, code: Record<string, Array<[string, string?]>> } },
   *   cards: Array<import('./tour-data.js').TourCard>,
   *   cardOf: Record<string, string>,
   *   onopen: (cardId: string) => void,
   * }}
   */
  let { story, cards, cardOf, onopen } = $props();

  /** @typedef {{ el: HTMLElement, type: string, card: import('./tour-data.js').TourCard, via: 'pointer' | 'focus' | 'tap' }} Target */

  const byId = $derived(new Map(cards.map((c) => [c.id, c])));

  /** @type {HTMLElement | undefined} */
  let frame = $state();
  /** @type {HTMLElement | undefined} */
  let scope = $state();
  /** @type {Target | null} */
  let target = $state.raw(null);
  /** @type {{ top: number, left: number, width: number, height: number } | null} */
  let box = $state.raw(null);

  /** The elements that are a block as a whole while the attribute of the block is on a part of it (a toggle's header, a callout's text, the `<pre>` of a code block). */
  const WRAPPERS = /** @type {const} */ ([['.nabu-toggle', 'toggle'], ['.nabu-callout', 'callout'], ['.nabu-code-wrapper', 'code']]);

  /**
   * The block under X-ray for a node of the story: the innermost block, drawn whole (a list item stands for its list, a region for its seam, a toggle for its
   * header AND its body).
   * @param {EventTarget | null} node
   * @param {Target['via']} via
   * @returns {Target | null}
   */
  function resolve(node, via) {
    const start = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
    /** @type {HTMLElement | null | undefined} */
    let el = start?.closest('.nabu-region-seam'); // the seam of a region (its number, its title, its rule) is the region
    let type = el ? 'region' : '';
    if (!el) {
      el = /** @type {HTMLElement | null | undefined} */ (start?.closest('[data-block-type]'));
      type = el?.getAttribute('data-block-type') ?? '';
    }
    if (!el) {
      // the arrow of a toggle, the icon of a callout, the head of a code block: no block of their own
      for (const [selector, t] of WRAPPERS) {
        const w = /** @type {HTMLElement | null | undefined} */ (start?.closest(selector));
        if (w) { el = w; type = t; break; }
      }
    }
    if (!el || !scope?.contains(el)) return null;
    if (type === 'list-item') {
      const list = /** @type {HTMLElement | null} */ (el.closest('[data-block-type="list"]'));
      if (list) { el = list; type = 'list'; }
    }
    const wrapper = WRAPPERS.find(([, t]) => t === type);
    if (wrapper) el = /** @type {HTMLElement} */ (el.closest(wrapper[0]) ?? el);
    const card = byId.get(cardOf[type]);
    return card ? { el, type, card, via } : null;
  }

  /** @param {Target | null} next */
  function show(next) {
    if (next && target && next.el === target.el && next.via === target.via) return;
    target = next;
    measure();
  }

  function measure() {
    if (!target || !frame || !target.el.isConnected) { box = null; return; }
    const f = frame.getBoundingClientRect();
    const r = target.el.getBoundingClientRect();
    box = { top: r.top - f.top, left: r.left - f.left, width: r.width, height: r.height };
  }

  // The box follows the story when it changes size (a toggle opened, a font loaded, the window resized).
  $effect(() => {
    if (!frame) return;
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    return () => ro.disconnect();
  });

  /** The blocks the keyboard goes through, in document order. */
  function blocks() {
    if (!scope) return [];
    const set = new Set();
    for (const node of scope.querySelectorAll('[data-block-type]')) {
      const t = resolve(node, 'focus');
      if (t) set.add(t.el);
    }
    return /** @type {HTMLElement[]} */ ([...set]);
  }

  /** @param {HTMLElement[]} list @param {HTMLElement | null} current */
  function rove(list, current) {
    for (const el of list) el.tabIndex = el === current ? 0 : -1;
  }

  // One tab stop in the story: the first block, the others reached with the arrows.
  $effect(() => {
    if (!scope) return;
    const list = blocks();
    rove(list, list[0] ?? null);
  });

  /** @param {KeyboardEvent} e */
  function onkeydown(e) {
    const el = /** @type {HTMLElement} */ (e.target);
    const list = blocks();
    const i = list.indexOf(el);
    if (i < 0) return;
    let j = i;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = Math.min(list.length - 1, i + 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = list.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    rove(list, list[j]);
    list[j].focus();
  }

  /** @param {PointerEvent} e */
  function onpointerover(e) {
    if (e.pointerType === 'touch') return; // a finger has no hover: its tap is the click below
    const t = resolve(e.target, 'pointer');
    if (t) show(t);
  }
  // The X-ray stays on the last block while the pointer goes to its card (to click "Open its card"), and ends when the pointer leaves both.
  /** @param {PointerEvent} e */
  function onstageleave(e) {
    if (e.pointerType === 'touch') return;
    if (/** @type {Target | null} */ (target)?.via === 'pointer') show(null);
  }
  /** @param {MouseEvent} e */
  function onclick(e) {
    const kind = /** @type {PointerEvent} */ (e).pointerType;
    if (!kind || kind === 'mouse') return; // a mouse has already hovered it
    const t = resolve(e.target, 'tap');
    if (t) show(t);
  }
  /** @param {FocusEvent} e */
  function onfocusin(e) {
    const t = resolve(e.target, 'focus');
    if (t) show(t);
  }
  /** @param {FocusEvent} e */
  function onfocusout(e) {
    const t = /** @type {Target | null} */ (target);
    if (t?.via === 'focus' && !(e.relatedTarget instanceof Node && scope?.contains(e.relatedTarget))) show(null);
  }

  const kicker = $derived.by(() => {
    const t = /** @type {Target | null} */ (target);
    return !t ? 'X-RAY' : t.via === 'focus' ? 'X-RAY · IN FOCUS' : t.via === 'tap' ? 'X-RAY · YOU TAPPED' : 'X-RAY · UNDER YOUR POINTER';
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="stage" onpointerleave={onstageleave}>
  <div class="story" bind:this={frame} data-testid="tour-story">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="doc" bind:this={scope} role="group" aria-label="The story, block by block. Move between blocks with the arrow keys." {onkeydown} {onpointerover} {onclick} {onfocusin} {onfocusout}>
      <TourDoc doc={story.doc} label={story.label} variant="story" />
    </div>
    {#if target && box}
      <div class="box" aria-hidden="true" data-testid="xray-box" style:top="{box.top}px" style:left="{box.left}px" style:width="{box.width}px" style:height="{box.height}px">
        <span class="tag" data-testid="xray-label">{target.card.xray[target.type] ?? target.type}</span>
      </div>
    {/if}
  </div>

  <aside class="panel" aria-label="The block under X-ray" aria-live={target?.via === 'focus' ? 'polite' : 'off'} data-testid="xray-panel" data-card={target?.card.id}>
    <span class="kicker">{kicker}</span>
    {#if target}
      {@const card = target.card}
      <span class="name">{card.title}</span>
      <span class="sentence">{card.sentence}</span>
      <dl class="facts">
        <dt>Type</dt>
        <dd>{#each card.typed as chip (chip)}<span class="chip">{chip}</span>{:else}<span class="none">nothing: a menu or a paste</span>{/each}</dd>
        <dt>Slash</dt>
        <dd>{#each card.slash as chip (chip)}<span class="chip">{chip}</span>{:else}<span class="none">none</span>{/each}</dd>
        <dt>Markdown</dt>
        <dd>{#each card.md as chip (chip)}<span class="chip">{chip}</span>{:else}<span class="none">none</span>{/each}</dd>
        <dt>HTML</dt>
        <dd>{#each card.html as chip (chip)}<span class="chip">{chip}</span>{/each}</dd>
      </dl>
      <button type="button" class="more" onclick={() => onopen(card.id)}>Open its card <span aria-hidden="true">↓</span></button>
    {:else}
      <span class="name">Nothing yet</span>
      <span class="sentence">Hover, tap or move to a block of the story with the arrow keys. Its card appears here.</span>
    {/if}
  </aside>
</div>

<style>
  .stage {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 28px;
    align-items: start;
  }
  .story {
    position: relative;
    padding: 40px 56px 44px;
    border: 1px solid var(--site-border);
    border-radius: 18px;
    background: var(--site-surface);
  }
  .doc {
    min-width: 0;
  }

  /* The X-ray box: drawn over the document from the rectangle of the block, never inside it. */
  .box {
    position: absolute;
    z-index: 2;
    box-sizing: border-box;
    border-radius: 4px;
    outline: 1.5px solid var(--site-accent);
    outline-offset: 6px;
    pointer-events: none;
  }
  .tag {
    position: absolute;
    bottom: calc(100% + 10px);
    left: -8px;
    padding: 2px 8px;
    border-radius: 6px;
    background: var(--site-accent-fill);
    color: var(--site-on-accent);
    font: 500 11px / 1.5 var(--site-font-mono);
    white-space: nowrap;
  }

  .panel {
    position: sticky;
    top: 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 20px 22px;
    border: 1px solid var(--site-border);
    border-radius: 16px;
    background: var(--site-surface-2);
  }
  .kicker {
    color: var(--site-accent);
    font: 500 12px / 1.4 var(--site-font-mono);
    letter-spacing: 0.08em;
  }
  .name {
    font: 700 24px / 1.2 var(--site-font-display);
    letter-spacing: var(--site-ls-h3);
  }
  .sentence {
    color: var(--site-text-muted);
    font-size: 15px;
    line-height: 1.55;
  }
  .facts {
    display: grid;
    grid-template-columns: 70px minmax(0, 1fr);
    gap: 8px 10px;
    align-items: baseline;
    margin: 0;
    color: var(--site-text-subtle);
    font-size: 13px;
  }
  .facts dt,
  .facts dd {
    margin: 0;
  }
  .facts dd {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    padding: 3px 8px;
    border: 1px solid var(--site-border-strong);
    border-radius: 7px;
    color: var(--site-text);
    font: 400 12px / 1.4 var(--site-font-mono);
    white-space: nowrap;
  }
  .none {
    color: var(--site-text-subtle);
  }
  .more {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--site-accent);
    font: 500 14px / 1.5 var(--site-font-body);
    cursor: pointer;
    text-underline-offset: 3px;
  }
  .more:hover {
    text-decoration: underline;
  }

  /* Keyboard focus is drawn by the X-ray box: the block itself shows no ring of its own. */
  .doc :global([data-block-type]:focus-visible),
  .doc :global(.nabu-region-seam:focus-visible) {
    outline: none;
  }

  /* A phone: the story takes the width, the panel moves under it as an inline card that stays at the foot of the screen while the story is read. */
  @media (max-width: 899.98px) {
    .stage {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }
    .story {
      padding: 28px 20px 32px;
      border-radius: 16px 16px 0 0;
      border-bottom: 0;
    }
    .panel {
      position: sticky;
      top: auto;
      bottom: 0;
      z-index: 3;
      gap: 8px;
      padding: 14px 16px 16px;
      border-radius: 0 0 16px 16px;
      box-shadow: var(--site-shadow-floating);
    }
    .name {
      font-size: 20px;
    }
    .sentence {
      font-size: 14px;
    }
    .facts {
      grid-template-columns: 62px minmax(0, 1fr);
      gap: 6px 8px;
    }
    .tag {
      left: 0;
    }
  }
</style>
