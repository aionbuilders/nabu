/**
 * Keep the caret visible after an edit the user made. Nabu cancels the native edits and re-renders from the model, so the browser
 * no longer scrolls to the caret by itself: `revealCaret` does it, the way a plain contenteditable would. "Nearest": nothing moves
 * while the caret is already inside the visible area.
 *
 * Every scrollable ancestor is moved by the least amount that brings the caret into its padding box (shadow roots are crossed),
 * then the window, bounded by the visual viewport when there is one (a virtual keyboard shrinks it). A host keeps the caret clear
 * of its own sticky UI with `scroll-padding` (on the scroller, or on the root element for the window). No Svelte, no state.
 */

/** Breathing room left between the caret and the edge it was scrolled to, in px (cut down when the box is too small for it). */
const MARGIN = 8;
/** The overflow values of an element that scrolls, by script or by the user (`overlay` is an alias of `auto`). */
const SCROLLS = new Set(['auto', 'scroll', 'hidden']);

/** @typedef {{ top: number, bottom: number, left: number, right: number }} Box */

/**
 * Scroll everything between the caret and the window so that the caret of the live selection is visible. Does nothing without
 * a usable caret (no selection, the focus is outside `root`, no layout).
 * @param {Element} root  the editor's root: the focus of the selection has to be inside it
 */
export function revealCaret(root) {
    if (typeof window === 'undefined') return;
    const live = window.getSelection();
    const node = live?.focusNode;
    if (!live || !node || live.rangeCount === 0 || !root.contains(node)) return;
    const offset = live.focusOffset;
    const holder = /** @type {Element | null} */ (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    if (!holder) return;

    let caret = caretBox(node, offset, holder);
    if (!caret) return;

    for (let el = parentOf(holder); el && el !== document.documentElement; el = parentOf(el)) {
        // The body of a page whose `overflow` went up to the viewport does not scroll: the window does.
        if (el === document.body && getComputedStyle(document.documentElement).overflow === 'visible') continue;
        const style = getComputedStyle(el);
        const y = SCROLLS.has(style.overflowY) && el.scrollHeight > el.clientHeight;
        const x = SCROLLS.has(style.overflowX) && el.scrollWidth > el.clientWidth;
        if (y || x) {
            const box = el.getBoundingClientRect();
            // A transform scales the rects but not `scrollTop`: the amount to scroll is in layout px.
            const { offsetHeight, offsetWidth } = /** @type {HTMLElement} */ (el); // undefined on an SVG element: no scale, then
            const sy = box.height / offsetHeight || 1;
            const sx = box.width / offsetWidth || 1;
            const dy = y ? nudge(caret.top, caret.bottom, box.top + el.clientTop * sy, el.clientHeight * sy, padding(style.scrollPaddingTop, el.clientHeight) * sy, padding(style.scrollPaddingBottom, el.clientHeight) * sy) : 0;
            const dx = x ? nudge(caret.left, caret.right, box.left + el.clientLeft * sx, el.clientWidth * sx, padding(style.scrollPaddingLeft, el.clientWidth) * sx, padding(style.scrollPaddingRight, el.clientWidth) * sx) : 0;
            if (dy || dx) {
                el.scrollBy({ top: dy / sy, left: dx / sx, behavior: 'instant' }); // instant: a `scroll-behavior: smooth` host must not lag behind the typing
                caret = caretBox(node, offset, holder) ?? caret;
            }
        }
        if (style.position === 'fixed') return; // the window cannot move it
    }

    const vv = window.visualViewport;
    const top = vv ? vv.offsetTop : 0;
    const left = vv ? vv.offsetLeft : 0;
    const height = vv ? vv.height : window.innerHeight;
    const width = vv ? vv.width : window.innerWidth;
    const style = getComputedStyle(document.scrollingElement ?? document.documentElement);
    const dy = nudge(caret.top, caret.bottom, top, height, padding(style.scrollPaddingTop, height), padding(style.scrollPaddingBottom, height));
    const dx = nudge(caret.left, caret.right, left, width, padding(style.scrollPaddingLeft, width), padding(style.scrollPaddingRight, width));
    if (dy || dx) window.scrollBy({ top: dy, left: dx, behavior: 'instant' });
}

/**
 * The scroll amount, along one axis, that brings the caret `[start, end]` inside the box `[origin, origin + size]` reduced by its
 * scroll padding and a margin: the smallest one, 0 when it is already inside. A box too small for the caret is aligned on its
 * leading edge (always the same one, so that the next call does not scroll back).
 * @param {number} start @param {number} end @param {number} origin @param {number} size @param {number} before @param {number} after
 * @returns {number}
 */
function nudge(start, end, origin, size, before, after) {
    let lo = origin + before;
    let hi = origin + size - after;
    const room = hi - lo - (end - start);
    const margin = Math.max(0, Math.min(MARGIN, room / 2));
    lo += margin;
    hi -= margin;
    const delta = room < 0 || start < lo ? start - lo : end > hi ? end - hi : 0;
    return Math.abs(delta) < 0.5 ? 0 : delta;
}

/** A `scroll-padding-*` computed value ("auto", "12px", "10%") in px. @param {string} value @param {number} size  what a percentage refers to */
function padding(value, size) {
    const n = parseFloat(value);
    if (!n) return 0;
    return value.endsWith('%') ? (n * size) / 100 : n;
}

/** The parent of `el` in the flat tree: a slot, else the parent element, else the host of the shadow root. @param {Element} el @returns {Element | null} */
function parentOf(el) {
    if (el.assignedSlot) return el.assignedSlot;
    if (el.parentElement) return el.parentElement;
    const top = el.getRootNode();
    return top instanceof ShadowRoot ? top.host : null;
}

/**
 * The caret as a rect, in viewport coordinates. A collapsed range may report no rect, or a zero-height one, in an empty block or at
 * a line edge: the character after it is measured then (its left edge), then the one before (its right edge), then the top of the
 * block with one line (never the whole rect of a tall block). Null when nothing is measurable.
 * @param {Node} node @param {number} offset @param {Element} holder  the element holding `node`
 * @returns {Box | null}
 */
function caretBox(node, offset, holder) {
    const measure = (/** @type {Node} */ a, /** @type {number} */ from, /** @type {number} */ to) => {
        const range = document.createRange();
        try {
            range.setStart(a, from);
            range.setEnd(a, to);
        } catch { return null; }
        for (const r of range.getClientRects()) if (r.height > 0) return r;
        return null;
    };
    const text = (/** @type {Node | undefined} */ n) => (n && n.nodeType === Node.TEXT_NODE ? /** @type {Text} */ (n) : null);
    // The text positions on each side of the caret (it may sit between elements).
    const isText = node.nodeType === Node.TEXT_NODE;
    const next = isText ? /** @type {Text} */ (node) : text(node.childNodes[offset]);
    const nextAt = isText ? offset : 0;
    const prev = isText ? /** @type {Text} */ (node) : text(node.childNodes[offset - 1]);
    const prevAt = isText ? offset : prev ? prev.length : 0;

    const here = measure(node, offset, offset);
    if (here) return { top: here.top, bottom: here.bottom, left: here.left, right: here.left };
    if (next && nextAt < next.length) {
        const r = measure(next, nextAt, nextAt + 1);
        if (r) return { top: r.top, bottom: r.bottom, left: r.left, right: r.left };
    }
    if (prev && prevAt > 0) {
        const r = measure(prev, prevAt - 1, prevAt);
        if (r) return { top: r.top, bottom: r.bottom, left: r.right, right: r.right };
    }

    const block = holder.closest('[data-block-id]') ?? holder;
    const r = block.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    const style = getComputedStyle(block);
    const scale = r.height / /** @type {HTMLElement} */ (block).offsetHeight || 1;
    const line = (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 0) * scale;
    if (!line) return null;
    return { top: r.top, bottom: r.top + line, left: r.left, right: r.left };
}
