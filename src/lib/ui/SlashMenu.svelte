<script>
  import { SlashMenuController } from './slash-menu.svelte.js';
  import { anchorRect, placeNear, clipBounds, isOutside } from './anchor.js';

  /**
   * The texts the menu exposes to assistive technology (the visible titles come from the entries themselves):
   *  - `label`: the accessible name of the listbox, default "Insert block";
   *  - `groups`: the name of each group of entries (`role="group"`), by `group` id; an unknown id is used as it is;
   *  - `option`: the sentence announced for the active entry, `({ title, subtitle, index, count }) => string` (`index` from 1),
   *    default "Heading 1, Large section heading, 2 of 15".
   * @typedef {Object} SlashMenuMessages
   * @property {string} [label]
   * @property {Record<string, string>} [groups]
   * @property {(info: { title: string, subtitle?: string, index: number, count: number }) => string} [option]
   */

  /** @type {{ engine: import('../blocks/nabu.svelte.js').Nabu, commands?: import('./slash-menu.svelte.js').SlashCommand[], messages?: SlashMenuMessages }} */
  let { engine, commands = [], messages = {} } = $props();
  const ctrl = new SlashMenuController(engine, commands);
  const uid = $props.id();
  const listId = `${uid}-list`;
  const optionId = (/** @type {number} */ i) => `${uid}-opt-${i}`;

  const GROUP_NAMES = { text: 'Text', lists: 'Lists', blocks: 'Blocks', media: 'Media', structure: 'Structure' };
  const label = $derived(messages.label ?? 'Insert block');
  const groupName = (/** @type {string} */ id) => messages.groups?.[id] ?? /** @type {Record<string, string>} */ (GROUP_NAMES)[id] ?? id;

  // Consecutive entries of the same group share one `role="group"` (the entries are already sorted by group). The group is not
  // drawn: the menu looks as before, the grouping is for assistive technology. `i` is the position in the whole list.
  const sections = $derived.by(() => {
    /** @type {{ group: string | null, items: Array<{ item: import('./slash-menu.svelte.js').SlashCommand, i: number }> }[]} */
    const out = [];
    ctrl.filteredItems.forEach((item, i) => {
      const group = item.group || null;
      const last = out[out.length - 1];
      if (last && last.group === group) last.items.push({ item, i });
      else out.push({ group, items: [{ item, i }] });
    });
    return out;
  });
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

  // What a screen reader hears when the active entry changes. The caret stays in the editor (a contenteditable host: focus can
  // never move to the menu), so the menu cannot rely on focus; a polite live region says the active entry, and the editor root
  // points at it with aria-activedescendant (below) for the assistive technologies that follow it.
  const announcement = $derived.by(() => {
    if (!ctrl.open || hidden) return '';
    const item = ctrl.filteredItems[ctrl.selectedIndex];
    if (!item) return '';
    const info = { title: item.title, subtitle: item.subtitle, index: ctrl.selectedIndex + 1, count: ctrl.filteredItems.length };
    return messages.option ? messages.option(info) : `${info.title}${info.subtitle ? `, ${info.subtitle}` : ''}, ${info.index} of ${info.count}`;
  });

  // The editor root is the element that has the focus: while the menu is open it owns the list (aria-controls) and names the
  // active entry (aria-activedescendant), like the combobox pattern but without changing the role of the host (which would
  // flatten the headings inside it). Both are removed when the menu closes.
  $effect(() => {
    if (!ctrl.open || hidden || !menuEl) return;
    const root = ctrl.match?.block?.element?.closest?.('[data-nabu-root]');
    if (!root) return;
    root.setAttribute('aria-controls', listId);
    root.setAttribute('aria-activedescendant', optionId(ctrl.selectedIndex));
    return () => { root.removeAttribute('aria-controls'); root.removeAttribute('aria-activedescendant'); };
  });

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

{#snippet row(/** @type {import('./slash-menu.svelte.js').SlashCommand} */ item, /** @type {number} */ i)}
    <button
      id={optionId(i)}
      type="button"
      role="option"
      tabindex="-1"
      aria-selected={i === ctrl.selectedIndex}
      class="nabu-slash-item"
      class:active={i === ctrl.selectedIndex}
      onmousedown={(e) => { e.preventDefault(); ctrl.select(i); }}
      onmouseenter={() => ctrl.selectedIndex = i}
    >
      <span class="nabu-slash-icon" aria-hidden="true">{item.icon ?? ''}</span>
      <span class="nabu-slash-title">{item.title}</span>
      {#if item.subtitle}<span class="nabu-slash-sub">{item.subtitle}</span>{/if}
    </button>
{/snippet}

{#if ctrl.open && !hidden}
<div
  bind:this={menuEl}
  id={listId}
  class="nabu-slash"
  role="listbox"
  aria-label={label}
  data-nabu-ui
  contenteditable="false"
  style:top={pos.top === null ? null : `${pos.top}px`}
  style:bottom={pos.bottom === null ? null : `${pos.bottom}px`}
  style:left="{pos.left}px"
  style:max-height="{pos.maxHeight}px"
>
  {#each sections as section, s (s)}
    {#if section.group}
      <div class="nabu-slash-group" role="group" aria-label={groupName(section.group)}>
        {#each section.items as { item, i } (item.title)}{@render row(item, i)}{/each}
      </div>
    {:else}
      {#each section.items as { item, i } (item.title)}{@render row(item, i)}{/each}
    {/if}
  {/each}
</div>
{/if}

<!-- Always mounted (a live region must exist before its text changes). Visually hidden. -->
<div class="nabu-slash-live" role="status" aria-live="polite" aria-atomic="true" data-nabu-ui>{announcement}</div>

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
.nabu-slash-live {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
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
