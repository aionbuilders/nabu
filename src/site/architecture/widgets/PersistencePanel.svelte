<script>
  import { untrack } from 'svelte';

  /**
   * The panel of chapter 06: what `nabu.persistence` (reactive: `status`, `lastSavedAt`, `available`, `sync`) says, the size of the
   * snapshot Loro would export (`doc.export({ mode: 'snapshot' })`, history included) and what other tabs sent (a Loro commit whose
   * `by` is `import`). "Save now" is `nabu.saveNow()`.
   * @type {{ ctx: import('./helpers.js').WidgetContext }}
   */
  let { ctx } = $props();

  const LABELS = {
    saved: 'Saved',
    pending: 'Changes not saved yet',
    saving: 'Saving…',
    error: 'The last save failed',
    unavailable: 'In memory only: IndexedDB is not available',
  };

  const p = $derived(/** @type {any} */ (ctx.engine).persistence);
  const status = $derived(/** @type {keyof typeof LABELS} */ (p?.status ?? 'unavailable'));

  let bytes = $state(0);
  let received = $state(0);
  /** @type {number | null} */
  let receivedAt = $state(null);
  let saving = $state(false);

  $effect(() => {
    const { engine } = ctx;
    const unsubscribe = engine.doc.subscribe((batch) => {
      if (batch.by !== 'import') return;
      received += 1;
      receivedAt = Date.now();
    });
    return unsubscribe;
  });

  // The snapshot is measured when a save has just happened (that is the size on disk, give or take): not on every key.
  $effect(() => {
    status; // re-run when the status changes
    if (status !== 'saved') return;
    try { bytes = untrack(() => ctx.engine.doc.export({ mode: 'snapshot' }).length); } catch { /* not exportable */ }
  });

  const kb = (/** @type {number} */ n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
  const at = (/** @type {number | null | undefined} */ t) => (t ? new Date(t).toLocaleTimeString() : 'n/a');

  async function saveNow() {
    saving = true;
    try { await /** @type {any} */ (ctx.engine).saveNow(); } catch { /* the status shows it */ } finally { saving = false; }
  }
</script>

<div class="host">
  <p class="status" data-testid="persist-status" data-status={status}>
    <span class="dot" class:ok={status === 'saved'} class:warn={status === 'pending' || status === 'saving'} class:bad={status === 'error' || status === 'unavailable'} aria-hidden="true"></span>
    <span class="w-text">{LABELS[status]}</span>
  </p>
  <dl class="rows">
    <div class="row"><dt>last save</dt><dd data-testid="persist-saved-at">{at(p?.lastSavedAt)}</dd></div>
    <div class="row"><dt>stored in</dt><dd class="w-muted">IndexedDB · nabu · snapshots</dd></div>
    <div class="row"><dt>snapshot</dt><dd data-testid="persist-size">{bytes ? kb(bytes) : 'n/a'}</dd></div>
    <div class="row"><dt>live sync between tabs</dt><dd data-testid="persist-sync" class:w-accent={p?.sync}>{p?.sync ? 'on' : 'off'}</dd></div>
    <div class="row"><dt>updates from other tabs</dt><dd data-testid="persist-received">{received}{received ? ` · last ${at(receivedAt)}` : ''}</dd></div>
  </dl>
  <p><button type="button" class="w-btn" data-testid="save-now" disabled={saving || status === 'unavailable'} onclick={saveNow}>Save now</button></p>
  <p class="note w-muted">The save waits 2 s after the last key, and never more than 3 s into a long burst. When the page closes, the changes since the last save also go to localStorage, as a safety net.</p>
</div>

<style>
  .host { display: flex; flex-direction: column; gap: 10px; }
  .status { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 14px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--site-border-strong); }
  /* The Atelier theme's own success / warning / error colours (4.5:1 or more on the panel in both schemes). */
  .dot.ok { background: light-dark(#15803D, #4ADE80); }
  .dot.warn { background: light-dark(#B45309, #F59E0B); }
  .dot.bad { background: light-dark(#B91C1C, #FF8A80); }
  .rows { margin: 0; display: flex; flex-direction: column; gap: 6px; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  dt { color: var(--site-text-muted); }
  dd { margin: 0; color: var(--site-text); text-align: right; }
  p { margin: 0; }
  .note { font: 400 12.5px / 1.5 var(--site-font-body); }
</style>
