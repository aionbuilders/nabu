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
  /** Ids of every block travelling with the dragged one (see `Block#dragRange`): hidden from the drop targets, dimmed while dragging. */
  let draggedIds = /** @type {Set<string>} */ (new Set());

  const HANDLE_W = 24;
  const HANDLE_H = 22; // keep in sync with the CSS height
  /** First lines at least this tall (body text and up) keep the handle flush with the block's top (+2px), see `handleTop`. */
  const FLUSH_LINE = 16;
  /** Blocks thinner than this (dividers, region seams) are a hard target: the pointer may be within `NEAR` px of them. */
  const THIN = 14;
  const NEAR = 6;

  /**
   * The block's FIRST line box, in viewport coordinates: the client rect of its own first text (not a nested block's), else
   * — void blocks (divider, media, empty text) — the block's top strip: its computed line height (the whole block when it is
   * thinner than that).
   * @param {Element} b
   * @returns {{ cy: number, h: number }}  vertical centre and height of the first line
   */
  function firstLine(b) {
    const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue?.trim() && n.parentElement?.closest('[data-block-id]') === b && !n.parentElement?.closest('[data-nabu-ui]'))
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const text = walker.nextNode();
    if (text) {
      const range = document.createRange();
      range.selectNodeContents(text);
      const line = range.getClientRects()[0];
      if (line && line.height) return { cy: line.top + line.height / 2, h: line.height };
    }
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    const lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 16) * 1.2;
    const h = Math.min(lh, r.height);
    return { cy: r.top + h / 2, h };
  }

  /**
   * Viewport `top` of the handle for block `b`: its centre on the centre of the block's first line. Blocks with a normal-size
   * first line (body text, headings, media) keep the handle from sticking out above the block (flush at +2px, as for every
   * paragraph); a small first line (a region seam's caption) or a hairline block (divider) is centred exactly.
   * @param {Element} b
   */
  function handleTop(b) {
    const { cy, h } = firstLine(b);
    const top = cy - HANDLE_H / 2;
    return h >= FLUSH_LINE ? Math.max(top, b.getBoundingClientRect().top + 2) : top;
  }

  /**
   * The block under the pointer; failing that, a THIN block (divider, seam) within `NEAR` px above / below it — a 1px hairline
   * would otherwise be nearly impossible to hover.
   * @param {number} x
   * @param {number} y
   * @returns {Element|null}
   */
  function hoveredBlock(x, y) {
    const b = blockElAt(x, y, null);
    if (b) return b;
    for (const d of [3, -3, NEAR, -NEAR]) {
      const near = blockElAt(x, y + d, null);
      if (near && near.getBoundingClientRect().height < THIN) return near;
    }
    return null;
  }

  /**
   * Find the nearest block element under a point (skipping the dragged one + UI islands).
   * @param {number} x
   * @param {number} y
   * @param {Set<string> | null} excluded
   * @returns {Element|null}
   */
  function blockElAt(x, y, excluded) {
    let el = /** @type {Element|null} */ (document.elementFromPoint(x, y));
    const root = el?.closest?.('.nabu-editor');
    if (!root) return null;
    const b = el?.closest?.('[data-block-id]');
    if (!b) return null;
    if (excluded && excluded.has(/** @type {string} */ (b.getAttribute('data-block-id')))) return null;
    // don't target a UI island
    if (b.closest('[data-nabu-ui]')) return null;
    return b;
  }

  /** @param {PointerEvent} e */
  function onPointerMove(e) {
    if (engine.readonly) { handle.visible = false; return; } // nothing to reorder
    if (dragging) { onDragMove(e); return; }
    // The handle lives OUTSIDE the editor; while the pointer is over the handle
    // itself, keep it visible — else moving onto it to grab it would hide it.
    const over = document.elementFromPoint(e.clientX, e.clientY);
    if (over?.closest?.('.nabu-drag-handle')) return;
    const b = hoveredBlock(e.clientX, e.clientY);
    if (!b) { handle.visible = false; return; }
    const r = b.getBoundingClientRect();
    // Flush against the block's left edge — no dead gap to cross when grabbing; centred on the block's first line.
    handle = { visible: true, top: handleTop(b), left: r.left - HANDLE_W, blockId: b.getAttribute('data-block-id') };
  }

  /** @param {PointerEvent} e */
  function onHandleDown(e) {
    e.preventDefault();
    e.stopPropagation();
    draggedId = handle.blockId;
    if (!draggedId) return;
    dragging = true;
    // the dragged block and what travels with it (a region seam carries its region): dimmed, and not a drop target
    draggedIds = new Set((engine.blocks.get(draggedId)?.dragRange() ?? []).map((b) => b.id));
    draggedIds.add(draggedId);
    for (const id of draggedIds) document.querySelector(`[data-block-id="${cssEscape(id)}"]`)?.classList.add('nabu-dragging');
    try { /** @type {any} */ (e.target).setPointerCapture?.(e.pointerId); } catch {}
  }

  /** @param {PointerEvent} e */
  function onDragMove(e) {
    handle.visible = false;
    const b = blockElAt(e.clientX, e.clientY, draggedIds);
    if (!b) { indicator.visible = false; dropTarget = null; return; }
    const r = b.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    dropTarget = { blockId: /** @type {string} */ (b.getAttribute('data-block-id')), position: after ? 'after' : 'before' };
    indicator = { visible: true, top: after ? r.bottom : r.top, left: r.left, width: r.width };
  }

  function onPointerUp() {
    if (dragging) {
      for (const id of draggedIds) document.querySelector(`[data-block-id="${cssEscape(id)}"]`)?.classList.remove('nabu-dragging');
      performDrop();
    }
    dragging = false; draggedId = null; draggedIds = new Set(); indicator.visible = false; dropTarget = null;
  }

  function performDrop() {
    const id = draggedId;
    if (!dropTarget || !id || engine.readonly) return;
    const dragged = engine.blocks.get(id);
    const hit = engine.blocks.get(dropTarget.blockId);
    if (!dragged || !hit) return;
    // The range travelling with the block (itself alone, or e.g. a region seam + its region), in document order.
    const moving = dragged.dragRange();
    // never drop a block into itself or into its own subtree (cycle)
    if (moving.some((m) => m === hit || hit.parents?.some((p) => p.id === m.id))) return;
    // A range of several blocks keeps its level (a region's blocks all live at the root): a drop on a block nested in another
    // parent lands next to the ancestor of that block which sits at the range's own level.
    let target = hit;
    if (moving.length > 1) {
      while (target.parent && target.parent !== dragged.parent) target = /** @type {typeof hit} */ (target.parent);
    }
    if (dropTarget.position === 'after') {
      let anchor = target.node;
      for (const m of moving) { m.node.moveAfter(anchor); anchor = m.node; }
    } else {
      for (const m of moving) m.node.moveBefore(target.node);
    }
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

{#if handle.visible && !dragging && !engine.readonly}
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
