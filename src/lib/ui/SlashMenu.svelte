<script>
  import { SlashMenuController } from './slash-menu.svelte.js';
  import { anchorRect, placeNear, clipBounds, isOutside } from './anchor.js';
  /** @type {{ engine: import('../blocks/nabu.svelte.js').Nabu, commands?: import('./slash-menu.svelte.js').SlashCommand[] }} */
  let { engine, commands = [] } = $props();
  const ctrl = new SlashMenuController(engine, commands);
  /** @type {HTMLElement | null} */
  let menuEl = $state(null);
  /** Viewport coordinates (the menu is `position: fixed`): anchored by `top` (below the caret) or `bottom` (above it). */
  /** @type {import('./anchor.js').Placement} */
  let pos = $state({ top: 0, bottom: null, left: 0, maxHeight: 320 });

  /**
   * `true` while the caret line is entirely scrolled out of its visible scroll container (or off the viewport): the menu is then
   * NOT rendered (it would float over the page at a stale anchor) — the slash command stays pending, and the menu is back as
   * soon as the caret line is visible again. Keyboard navigation (arrows / Enter / Tab) is not captured while it is hidden.
   */
  let hidden = $state(false);

  const MAX_HEIGHT = 320; // keep in sync with the CSS max-height
  const MIN_HEIGHT = 100; // never squash the menu below this, even in a tiny viewport

  // Reset the highlighted item whenever the query changes.
  $effect(() => { ctrl.query; ctrl.selectedIndex = 0; });

  // Place the popup next to the caret, in viewport coordinates, inside the viewport (shared rules: anchor.js):
  // below the caret line, or flipped above it when there is no room below; clamped horizontally. Hidden while the caret
  // line is out of the visible area of its scroll container.
  function place() {
    const rect = anchorRect(engine, ctrl.match?.block?.element ?? null);
    if (!rect) return;
    hidden = isOutside(rect, clipBounds(engine.selection?.firstRange?.commonAncestorContainer ?? ctrl.match?.block?.element));
    if (hidden || !menuEl) return;
    pos = placeNear(rect, menuEl, { maxHeight: MAX_HEIGHT, minHeight: MIN_HEIGHT });
  }

  $effect(() => {
    if (!ctrl.open) return;
    ctrl.filteredItems.length; // the menu height depends on it
    menuEl;                    // re-run once the element is mounted
    engine.selection?.firstRange;
    place();
  });

  // The menu is fixed: follow the caret when the page (or a scroll container) scrolls / resizes while it is open.
  $effect(() => {
    if (!ctrl.open) return;
    /** @param {Event} e */
    const onScroll = (e) => { if (e.target !== menuEl) place(); }; // not the menu's own list scrolling
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  });

  // Capture keyboard navigation ONLY while the menu is open (capture phase so it
  // beats the editor's own keydown handler).
  $effect(() => {
    if (!ctrl.open) return;
    /** @param {KeyboardEvent} ev */
    const onKey = (ev) => {
      if (hidden && ev.key !== 'Escape') return; // not on screen: the keys keep their normal meaning
      if (ev.key === 'ArrowDown') { ev.preventDefault(); ev.stopImmediatePropagation(); ctrl.moveSelection(1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); ev.stopImmediatePropagation(); ctrl.moveSelection(-1); }
      else if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); ev.stopImmediatePropagation(); ctrl.select(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); ctrl.close(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });
</script>

{#if ctrl.open && !hidden}
<div
  bind:this={menuEl}
  class="nabu-slash"
  data-nabu-ui
  contenteditable="false"
  style:top={pos.top === null ? null : `${pos.top}px`}
  style:bottom={pos.bottom === null ? null : `${pos.bottom}px`}
  style:left="{pos.left}px"
  style:max-height="{pos.maxHeight}px"
>
  {#each ctrl.filteredItems as item, i (item.title)}
    <button
      class="nabu-slash-item"
      class:active={i === ctrl.selectedIndex}
      onmousedown={(e) => { e.preventDefault(); ctrl.select(i); }}
      onmouseenter={() => ctrl.selectedIndex = i}
    >
      <span class="nabu-slash-icon">{item.icon ?? ''}</span>
      <span class="nabu-slash-title">{item.title}</span>
      {#if item.subtitle}<span class="nabu-slash-sub">{item.subtitle}</span>{/if}
    </button>
  {/each}
</div>
{/if}

<style>
.nabu-slash {
  position: fixed;
  z-index: 200;
  min-width: 220px;
  max-height: 320px;
  overflow-y: auto;
  padding: 4px;
  background: var(--nb-bg-surface, #1a1a1a);
  border: 1px solid var(--nb-border, rgba(255,255,255,0.12));
  border-radius: var(--nb-floating-radius, 8px);
  box-shadow: var(--nb-floating-shadow, 0 8px 24px rgba(0,0,0,0.35));
  pointer-events: all;
}
.nabu-slash-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 6px 8px; border: none; background: transparent;
  color: var(--nb-text-primary, rgba(255,255,255,0.85));
  border-radius: 5px; cursor: pointer; text-align: left; font-size: 13px;
}
.nabu-slash-item.active { background: var(--nb-bg-surface-active, rgba(255,255,255,0.1)); }
.nabu-slash-icon {
  flex-shrink: 0; width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600;
  color: var(--nb-text-secondary, rgba(255,255,255,0.5));
  border: 1px solid var(--nb-border, rgba(255,255,255,0.1)); border-radius: 4px;
}
.nabu-slash-title { flex: 1; }
.nabu-slash-sub { color: var(--nb-text-secondary, rgba(255,255,255,0.4)); font-size: 11px; }
</style>
