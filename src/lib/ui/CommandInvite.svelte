<script>
  // Default NEUTRAL rendering of the `invite` strategy (ADR 017 §3.4b): a small hint at the caret. It also serves as the
  // fallback of `hold` when the hold's target cannot draw the progress (no target, or not mounted): see `hold`.
  // Screen readers get the same text from the editor's live region, so the hint itself is aria-hidden.
  import { commandTargetElement } from '../utils/command-confirm.svelte.js';
  import { anchorRect, placeNear } from './anchor.js';

  /**
   * @type {{
   *   engine: import('../blocks/nabu.svelte.js').Nabu,
   *   hold?: 'auto' | boolean,
   * }}
   * `hold`: `'auto'` (default) shows the hint, with a progress bar, for a hold whose target has no element to draw on;
   * `true` always shows it; `false` never (the target draws everything).
   */
  let { engine, hold = 'auto' } = $props();

  const pending = $derived(engine.pendingCommand);
  const visible = $derived.by(() => {
    const p = pending;
    if (!p) return false;
    if (p.strategy === 'invite') return true;
    if (p.strategy !== 'hold' || hold === false) return false;
    return hold === true || !commandTargetElement(p.target);
  });

  /** @type {HTMLElement | null} */
  let el = $state(null);
  /** @type {import('./anchor.js').Placement} */
  let pos = $state({ top: 0, bottom: null, left: 0, maxHeight: 120 });

  function place() {
    if (!el) return;
    const rect = anchorRect(engine);
    if (rect) pos = placeNear(rect, el, { maxHeight: 120, minHeight: 24 });
  }

  $effect(() => {
    if (!visible) return;
    pending?.message; el; // re-place when the text changes / the element mounts
    place();
  });

  $effect(() => {
    if (!visible) return;
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  });
</script>

{#if visible && pending}
<div
  bind:this={el}
  class="nabu-command-invite"
  data-nabu-ui
  data-strategy={pending.strategy}
  contenteditable="false"
  aria-hidden="true"
  style:top={pos.top === null ? null : `${pos.top}px`}
  style:bottom={pos.bottom === null ? null : `${pos.bottom}px`}
  style:left="{pos.left}px"
>
  <span class="nabu-command-invite-text">{pending.message}</span>
  {#if pending.strategy === 'hold'}
    <span class="nabu-command-invite-bar"><span class="nabu-command-invite-fill" style:width="{pending.progress * 100}%"></span></span>
  {/if}
</div>
{/if}

<style>
.nabu-command-invite {
  position: fixed;
  z-index: var(--nb-command-z, 200);
  max-width: min(360px, calc(100vw - 16px));
  padding: var(--nb-command-padding, 6px 10px);
  background: var(--nb-command-bg, var(--nb-bg-surface, #1a1a1a));
  color: var(--nb-command-text, var(--nb-text-primary, rgba(255,255,255,0.85)));
  border: 1px solid var(--nb-command-border, var(--nb-border, rgba(255,255,255,0.12)));
  border-radius: var(--nb-command-radius, 8px);
  box-shadow: var(--nb-command-shadow, 0 8px 24px rgba(0,0,0,0.35));
  font-size: var(--nb-command-font-size, 12px);
  line-height: 1.4;
  pointer-events: none;
}
.nabu-command-invite-bar {
  display: block;
  height: 2px;
  margin-top: 6px;
  background: var(--nb-command-track, color-mix(in srgb, currentColor 18%, transparent));
  border-radius: 1px;
  overflow: hidden;
}
.nabu-command-invite-fill {
  display: block;
  height: 100%;
  background: var(--nb-command-accent, currentColor);
}
</style>
