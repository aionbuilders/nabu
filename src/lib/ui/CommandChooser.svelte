<script>
  // Default NEUTRAL rendering of the `choose` strategy (ADR 017 §3.4c): a list at the caret. The keyboard (arrows, Enter,
  // digits 1-9, Escape) is handled by the engine while the chooser is pending; this component renders the state and takes
  // the mouse. The editor keeps the focus, so options are not tabbable: the highlighted one is announced by the live region.
  import { anchorRect, placeNear } from './anchor.js';

  /** @type {{ engine: import('../blocks/nabu.svelte.js').Nabu, label?: string }} */
  let { engine, label = 'Choose an action' } = $props();

  const uid = $props.id();
  const pending = $derived(engine.pendingCommand?.strategy === 'choose' ? engine.pendingCommand : null);

  /** @type {HTMLElement | null} */
  let el = $state(null);
  /** @type {import('./anchor.js').Placement} */
  let pos = $state({ top: 0, bottom: null, left: 0, maxHeight: 320 });

  function place() {
    if (!el) return;
    const rect = anchorRect(engine);
    if (rect) pos = placeNear(rect, el, { maxHeight: 320, minHeight: 100 });
  }

  $effect(() => {
    if (!pending) return;
    pending.options?.length; el;
    place();
  });

  $effect(() => {
    if (!pending) return;
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  });
</script>

{#if pending}
<div
  bind:this={el}
  class="nabu-command-chooser"
  role="listbox"
  aria-label={label}
  aria-activedescendant="{uid}-{pending.selectedIndex}"
  tabindex="-1"
  data-nabu-ui
  contenteditable="false"
  style:top={pos.top === null ? null : `${pos.top}px`}
  style:bottom={pos.bottom === null ? null : `${pos.bottom}px`}
  style:left="{pos.left}px"
  style:max-height="{pos.maxHeight}px"
>
  {#each pending.options ?? [] as option, i (option.id)}
    <div
      id="{uid}-{i}"
      class="nabu-command-option"
      class:active={i === pending.selectedIndex}
      role="option"
      aria-selected={i === pending.selectedIndex}
      tabindex="-1"
      onmousedown={(e) => { e.preventDefault(); engine.commandConfirm.choose(i); }}
      onmouseenter={() => engine.commandConfirm.highlight(i)}
    >
      <span class="nabu-command-option-index">{i + 1}</span>
      <span class="nabu-command-option-label">{option.label}</span>
      {#if option.display}<kbd class="nabu-command-option-display">{option.display}</kbd>{/if}
    </div>
  {/each}
</div>
{/if}

<style>
.nabu-command-chooser {
  position: fixed;
  z-index: var(--nb-command-z, 200);
  min-width: 220px;
  max-width: min(420px, calc(100vw - 16px));
  overflow-y: auto;
  padding: 4px;
  background: var(--nb-command-bg, var(--nb-bg-surface, #1a1a1a));
  color: var(--nb-command-text, var(--nb-text-primary, rgba(255,255,255,0.85)));
  border: 1px solid var(--nb-command-border, var(--nb-border, rgba(255,255,255,0.12)));
  border-radius: var(--nb-command-radius, 8px);
  box-shadow: var(--nb-command-shadow, 0 8px 24px rgba(0,0,0,0.35));
  font-size: var(--nb-command-font-size, 13px);
}
.nabu-command-option {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px;
  border-radius: 5px;
  cursor: pointer;
}
.nabu-command-option.active { background: var(--nb-command-active, var(--nb-bg-surface-active, rgba(255,255,255,0.1))); }
.nabu-command-option-index {
  flex-shrink: 0; width: 18px; height: 18px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px;
  color: var(--nb-command-muted, var(--nb-text-secondary, rgba(255,255,255,0.5)));
  border: 1px solid var(--nb-command-border, var(--nb-border, rgba(255,255,255,0.12)));
  border-radius: 4px;
}
.nabu-command-option-label { flex: 1; }
.nabu-command-option-display { font: inherit; font-size: 11px; color: var(--nb-command-muted, var(--nb-text-secondary, rgba(255,255,255,0.5))); }
</style>
