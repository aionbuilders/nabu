<script>
  import { wrapOrphan } from '../blocks/container.utils.js';
  /** @type {{ engine: import('../blocks/nabu.svelte.js').Nabu }} */
  let { engine } = $props();

  let handle = $state({ visible: false, top: 0, left: 0, blockId: /** @type {string|null} */ (null) });
  let dragging = $state(false);
  let indicator = $state({ visible: false, top: 0, left: 0, width: 0 });
  /** @type {{ blockId: string, position: 'before'|'after' } | null} */
  let dropTarget = null;
  let draggedId = /** @type {string|null} */ (null);

  const HANDLE_W = 24;

  /**
   * Find the nearest block element under a point (skipping the dragged one + UI islands).
   * @param {number} x
   * @param {number} y
   * @param {string|null} excludeId
   * @returns {Element|null}
   */
  function blockElAt(x, y, excludeId) {
    let el = /** @type {Element|null} */ (document.elementFromPoint(x, y));
    const root = el?.closest?.('.nabu-editor');
    if (!root) return null;
    const b = el?.closest?.('[data-block-id]');
    if (!b) return null;
    if (excludeId && b.getAttribute('data-block-id') === excludeId) return null;
    // don't target a UI island
    if (b.closest('[data-nabu-ui]')) return null;
    return b;
  }

  /** @param {PointerEvent} e */
  function onPointerMove(e) {
    if (dragging) { onDragMove(e); return; }
    // The handle lives OUTSIDE the editor; while the pointer is over the handle
    // itself, keep it visible — else moving onto it to grab it would hide it.
    const over = document.elementFromPoint(e.clientX, e.clientY);
    if (over?.closest?.('.nabu-drag-handle')) return;
    const b = blockElAt(e.clientX, e.clientY, null);
    if (!b) { handle.visible = false; return; }
    const r = b.getBoundingClientRect();
    // Flush against the block's left edge — no dead gap to cross when grabbing.
    handle = { visible: true, top: r.top + 2, left: r.left - HANDLE_W, blockId: b.getAttribute('data-block-id') };
  }

  /** @param {PointerEvent} e */
  function onHandleDown(e) {
    e.preventDefault();
    e.stopPropagation();
    draggedId = handle.blockId;
    if (!draggedId) return;
    dragging = true;
    // dim the dragged block
    const el = document.querySelector(`[data-block-id="${cssEscape(draggedId)}"]`);
    el?.classList.add('nabu-dragging');
    try { /** @type {any} */ (e.target).setPointerCapture?.(e.pointerId); } catch {}
  }

  /** @param {PointerEvent} e */
  function onDragMove(e) {
    handle.visible = false;
    const b = blockElAt(e.clientX, e.clientY, draggedId);
    if (!b) { indicator.visible = false; dropTarget = null; return; }
    const r = b.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    dropTarget = { blockId: /** @type {string} */ (b.getAttribute('data-block-id')), position: after ? 'after' : 'before' };
    indicator = { visible: true, top: after ? r.bottom : r.top, left: r.left, width: r.width };
  }

  function onPointerUp() {
    if (dragging) {
      const el = draggedId ? document.querySelector(`[data-block-id="${cssEscape(draggedId)}"]`) : null;
      el?.classList.remove('nabu-dragging');
      performDrop();
    }
    dragging = false; draggedId = null; indicator.visible = false; dropTarget = null;
  }

  function performDrop() {
    const id = draggedId;
    if (!dropTarget || !id) return;
    const dragged = engine.blocks.get(id);
    const target = engine.blocks.get(dropTarget.blockId);
    if (!dragged || !target || dragged === target) return;
    // never drop a block into its own subtree (cycle)
    if (target.parents?.some((p) => p.id === dragged.id)) return;
    if (dropTarget.position === 'after') dragged.node.moveAfter(target.node);
    else dragged.node.moveBefore(target.node);
    // repair structural integrity (e.g. a list-item dropped at root → wrap in a list).
    // No-op for blocks without a requiredParent (paragraph, heading, …).
    const orphan = /** @type {any} */ (dragged);
    try { wrapOrphan(engine, orphan); } catch {}
    engine.commit().then(() => {
      // keep the moved block focusable: move the cursor into it if it has text
      const fresh = engine.blocks.get(id);
      if (fresh?.behaviors?.has('text')) engine.selection.setCursor(fresh, 0);
    });
  }

  /** Minimal CSS.escape fallback for the attribute selector. @param {string} s */
  function cssEscape(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\\]]/g, '\\$&'); }
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={onPointerUp} />

{#if handle.visible && !dragging}
  <button
    class="nabu-drag-handle"
    data-nabu-ui
    contenteditable="false"
    type="button"
    aria-label="Drag to reorder"
    title="Drag to reorder"
    style="top: {handle.top}px; left: {handle.left}px;"
    onpointerdown={onHandleDown}
  >⠿</button>
{/if}

{#if indicator.visible}
  <div class="nabu-drop-indicator" style="top: {indicator.top}px; left: {indicator.left}px; width: {indicator.width}px;"></div>
{/if}

<style>
  .nabu-drag-handle {
    position: fixed; z-index: 150; width: 24px; height: 22px;
    display: flex; align-items: center; justify-content: center;
    border: none; background: transparent; cursor: grab;
    color: var(--nb-text-muted, rgba(255,255,255,0.35)); font-size: 14px;
    border-radius: 4px; user-select: none; padding: 0; line-height: 1;
  }
  .nabu-drag-handle:hover { background: var(--nb-bg-surface-hover, rgba(255,255,255,0.08)); color: var(--nb-text-primary, rgba(255,255,255,0.8)); }
  .nabu-drag-handle:active { cursor: grabbing; }
  .nabu-drop-indicator {
    position: fixed; z-index: 150; height: 2px; pointer-events: none;
    background: var(--nb-accent, #4d9fff); border-radius: 2px;
    box-shadow: 0 0 4px var(--nb-accent, #4d9fff);
  }
  :global(.nabu-dragging) { opacity: 0.4; }
</style>
