/**
 * Placement of a floating element (`position: fixed`) next to the caret, shared by the command components
 * (`CommandInvite`, `CommandChooser`). Same rules as the slash menu: below the caret line, flipped above it when there is
 * no room, clamped inside the viewport.
 */

export const ANCHOR_GAP = 4;     // space between the caret line and the element
export const ANCHOR_MARGIN = 8;  // minimum distance to the viewport edges

/**
 * The viewport rectangle the element hangs from: the caret, else the block holding it, else `fallback`.
 * @param {import('../blocks/nabu.svelte.js').Nabu} engine
 * @param {Element | null} [fallback]
 * @returns {DOMRect | null}
 */
export function anchorRect(engine, fallback = null) {
    const range = engine.selection?.firstRange;
    /** @type {DOMRect | undefined} */
    let rect = range?.getBoundingClientRect?.();
    // A collapsed range on an empty line can report a zero-size rect: fall back to the block.
    if (!rect || (!rect.width && !rect.height)) {
        const el = /** @type {HTMLElement | null | undefined} */ (engine.selection?.anchorBlock?.element) ?? fallback;
        rect = el?.getBoundingClientRect?.();
    }
    return rect ?? null;
}

/**
 * @typedef {Object} Placement
 * @property {number | null} top  distance from the viewport top (placed below the caret), else `null`
 * @property {number | null} bottom  distance from the viewport bottom (placed above the caret), else `null`
 * @property {number} left
 * @property {number} maxHeight
 */

/**
 * @param {DOMRect} rect  the anchor
 * @param {HTMLElement} el  the floating element (measured)
 * @param {{ maxHeight?: number, minHeight?: number }} [options]
 * @returns {Placement}
 */
export function placeNear(rect, el, { maxHeight = 320, minHeight = 60 } = {}) {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const full = el.scrollHeight + (el.offsetHeight - el.clientHeight);
    const natural = Math.min(maxHeight, full);
    const spaceBelow = vh - rect.bottom - ANCHOR_GAP - ANCHOR_MARGIN;
    const spaceAbove = rect.top - ANCHOR_GAP - ANCHOR_MARGIN;
    const left = Math.max(ANCHOR_MARGIN, Math.min(rect.left, vw - ANCHOR_MARGIN - el.offsetWidth));
    if (natural <= spaceBelow || spaceBelow >= spaceAbove) {
        return { top: rect.bottom + ANCHOR_GAP, bottom: null, left, maxHeight: Math.max(minHeight, Math.min(maxHeight, spaceBelow)) };
    }
    return { top: null, bottom: vh - rect.top + ANCHOR_GAP, left, maxHeight: Math.max(minHeight, Math.min(maxHeight, spaceAbove)) };
}

/**
 * @typedef {Object} Bounds  a viewport-coordinates box
 * @property {number} top
 * @property {number} bottom
 * @property {number} left
 * @property {number} right
 */

/**
 * The part of the viewport in which `el` is actually visible: the viewport (the documentElement's client box) intersected with
 * the client box of every ancestor that clips its content (`overflow` other than `visible` on either axis — scroll containers
 * and `overflow: hidden` wrappers; `<html>` / `<body>` are the viewport itself). `topInset` shrinks it from the top, for a
 * host's sticky / fixed header that covers the top of the viewport (see `--nb-toolbar-inset-top` in FloatingToolbar).
 *
 * A floating element is `position: fixed`, so it is never clipped by those ancestors itself: this is what tells where the
 * anchor can still be SEEN, hence where the element may sit and whether it should be shown at all.
 *
 * @param {Node | null | undefined} node  the anchor (an element, or a node inside one)
 * @param {{ topInset?: number }} [options]
 * @returns {Bounds}
 */
export function clipBounds(node, { topInset = 0 } = {}) {
    const doc = document.documentElement;
    /** @type {Bounds} */
    const b = { top: Math.max(0, topInset), bottom: doc.clientHeight, left: 0, right: doc.clientWidth };
    let el = node && node.nodeType === 1 ? /** @type {HTMLElement} */ (node) : (node?.parentElement ?? null);
    for (; el && el !== document.body && el !== doc; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        if (!el.clientWidth && !el.clientHeight) continue; // an inline box does not clip anything
        const r = el.getBoundingClientRect();
        const left = r.left + el.clientLeft;
        const top = r.top + el.clientTop;
        b.left = Math.max(b.left, left);
        b.top = Math.max(b.top, top);
        b.right = Math.min(b.right, left + el.clientWidth);
        b.bottom = Math.min(b.bottom, top + el.clientHeight);
    }
    return b;
}

/**
 * `true` when `rect` lies entirely outside `bounds` (scrolled out of its container / off the viewport): there is nothing to
 * point at any more. A rect that is only partly clipped is still visible.
 * @param {{ top: number, bottom: number, left: number, right: number }} rect
 * @param {Bounds} bounds
 */
export function isOutside(rect, bounds) {
    return rect.bottom <= bounds.top || rect.top >= bounds.bottom || rect.right <= bounds.left || rect.left >= bounds.right;
}

/**
 * Placement of a floating element centred ABOVE a (selection) rectangle, `position: fixed` with `top` / `left`: above when it
 * fits between the top of the visible area and the rect, else flipped BELOW the rect, else (the rect fills the visible area)
 * pinned to the top of the visible area. Clamped horizontally inside the viewport and, when it is wide enough to hold the
 * element, inside the clipping container.
 *
 * @param {{ top: number, bottom: number, left: number, width: number }} rect  the anchor
 * @param {HTMLElement} el  the floating element (measured)
 * @param {Bounds} bounds  from `clipBounds`
 * @param {{ gap?: number, margin?: number }} [options]
 * @returns {{ top: number, left: number, placement: 'above' | 'below' | 'inside' }}
 */
export function placeAround(rect, el, bounds, { gap = 8, margin = ANCHOR_MARGIN } = {}) {
    const vw = document.documentElement.clientWidth;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // horizontal: the container's width when it can hold the element, else the viewport's
    let minX = Math.max(margin, bounds.left);
    let maxX = Math.min(vw - margin, bounds.right);
    if (maxX - minX < w) { minX = margin; maxX = vw - margin; }
    const left = Math.max(minX, Math.min(rect.left + rect.width / 2 - w / 2, maxX - w));
    // vertical
    const minY = Math.max(bounds.top, margin);
    const maxY = Math.min(bounds.bottom, document.documentElement.clientHeight - margin);
    const above = rect.top - gap - h;
    if (above >= minY) return { top: above, left, placement: 'above' };
    const below = rect.bottom + gap;
    if (below + h <= maxY) return { top: below, left, placement: 'below' };
    return { top: Math.max(minY, Math.min(above, maxY - h)), left, placement: 'inside' };
}
