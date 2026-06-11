<script>
  import { SlashMenuController, DEFAULT_SLASH_COMMANDS } from './slash-menu.svelte.js';
  /** @type {{ engine: import('../blocks/nabu.svelte.js').Nabu, commands?: import('./slash-menu.svelte.js').SlashCommand[] }} */
  let { engine, commands = DEFAULT_SLASH_COMMANDS } = $props();
  const ctrl = new SlashMenuController(engine, commands);
  let pos = $state({ top: 0, left: 0 });

  // Reset the highlighted item whenever the query changes.
  $effect(() => { ctrl.query; ctrl.selectedIndex = 0; });

  // Position the popup just below the caret when open.
  $effect(() => {
    if (!ctrl.open) return;
    const range = engine.selection?.firstRange;
    if (!range) return;
    const r = range.getBoundingClientRect();
    pos = { top: r.bottom + window.scrollY + 4, left: r.left + window.scrollX };
  });

  // Capture keyboard navigation ONLY while the menu is open (capture phase so it
  // beats the editor's own keydown handler).
  $effect(() => {
    if (!ctrl.open) return;
    /** @param {KeyboardEvent} ev */
    const onKey = (ev) => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); ev.stopImmediatePropagation(); ctrl.moveSelection(1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); ev.stopImmediatePropagation(); ctrl.moveSelection(-1); }
      else if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); ev.stopImmediatePropagation(); ctrl.select(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); ctrl.close(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });
</script>

{#if ctrl.open}
<div class="nabu-slash" data-nabu-ui contenteditable="false" style="top: {pos.top}px; left: {pos.left}px;">
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
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.35);
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
