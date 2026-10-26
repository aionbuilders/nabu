<script>
  // Default NEUTRAL rendering of the `choose` strategy (ADR 017 §3.4c): a list at the caret. The keyboard (arrows, Enter,
  // digits 1-9, Escape) is handled by the engine while the chooser is pending; this component renders the state and takes
  // the mouse. The editor keeps the focus, so options are not tabbable: the highlighted one is announced by the live region.
  import { anchorRect, placeNear } from './anchor.js';

  /** @type {{ engine: import('../blocks/nabu.svelte.js').Nabu, label?: string }} */
  let { engine, label = 'Choose an action' } = $props();

  const uid = $props.id();
  const pending = $derived(engine.pendingCommand?.strategy === 'choose' ? engine.pendingCommand : null);

  // Options are shown in order; consecutive options with the same `group` share one small header (`group` is optional: options
  // without one stay as they are). `i` is the position in the whole list, which is what digits and arrows count.
  const sections = $derived.by(() => {
    /** @type {{ group: string | null, items: Array<{ option: import('../utils/command-confirm.svelte.js').PendingOption, i: number }> }[]} */
    const out = [];
    (pending?.options ?? []).forEach((option, i) => {
      const group = option.group || null;
      const last = out[out.length - 1];
      if (last && last.group === group) last.items.push({ option, i });
      else out.push({ group, items: [{ option, i }] });
    });
    return out;
  });

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

{#snippet row(/** @type {import('../utils/command-confirm.svelte.js').PendingOption} */ option, /** @type {number} */ i)}
  <div
    id="{uid}-{i}"
    class="nabu-command-option"
    class:active={i === pending?.selectedIndex}
    role="option"
    aria-selected={i === pending?.selectedIndex}
    tabindex="-1"
    onmousedown={(e) => { e.preventDefault(); engine.commandConfirm.choose(i); }}
    onmouseenter={() => engine.commandConfirm.highlight(i)}
  >
    <span class="nabu-command-option-index">{i + 1}</span>
    <span class="nabu-command-option-label">{option.label}</span>
    {#if option.detail}<span class="nabu-command-option-detail">{option.detail}</span>{/if}
    {#if option.display}<kbd class="nabu-command-option-display">{option.display}</kbd>{/if}
  </div>
{/snippet}

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
  {#each sections as section, s (s)}
    {#if section.group}
      <div class="nabu-command-section" role="group" aria-label={section.group}>
        <div class="nabu-command-group" aria-hidden="true">{section.group}</div>
        {#each section.items as { option, i } (option.id)}{@render row(option, i)}{/each}
      </div>
    {:else}
      {#each section.items as { option, i } (option.id)}{@render row(option, i)}{/each}
    {/if}
  {/each}
  {#if pending.footer}<div class="nabu-command-footer" aria-hidden="true">{pending.footer}</div>{/if}
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
.nabu-command-option-label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.nabu-command-option-detail {
  flex-shrink: 0; margin-left: auto; padding-left: 12px;
  font-size: 12px; font-variant-numeric: tabular-nums;
  color: var(--nb-command-muted, var(--nb-text-secondary, rgba(255,255,255,0.5)));
}
/* Group headers and the footer hint (optional `group` of the options, `confirm.footer`). */
.nabu-command-group {
  padding: 8px 8px 3px;
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--nb-command-muted, var(--nb-text-secondary, rgba(255,255,255,0.5)));
  user-select: none;
}
.nabu-command-section:first-child > .nabu-command-group { padding-top: 4px; }
.nabu-command-footer {
  position: sticky; bottom: -4px;
  margin: 4px -4px -4px; padding: 6px 12px 7px;
  background: var(--nb-command-bg, var(--nb-bg-surface, #1a1a1a));
  border-top: 1px solid var(--nb-command-border, var(--nb-border, rgba(255,255,255,0.12)));
  font-size: 11.5px;
  color: var(--nb-command-muted, var(--nb-text-secondary, rgba(255,255,255,0.5)));
  user-select: none;
}
.nabu-command-option-display { font: inherit; font-size: 11px; color: var(--nb-command-muted, var(--nb-text-secondary, rgba(255,255,255,0.5))); }
</style>
