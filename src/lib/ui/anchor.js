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
    // A collapsed range on an empty line can report an all-zero rect: fall back to the block.
    if (!rect || (!rect.width && !rect.height && !rect.top && !rect.left)) {
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
