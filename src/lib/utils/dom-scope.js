/**
 * Helpers for a DOM that may hold SEVERAL editors: side by side on a page, or one inside another (an editor mounted in a UI island of
 * a block). A marker such as `[data-nabu-ui]` or `[data-nabu-inert]` found ABOVE an editor's root belongs to the editor around it
 * (or to the page), never to that editor's own content.
 */

/**
 * The nearest ancestor-or-self of `node` that matches `selector` AND lies inside `root` (the root itself included); null when
 * the nearest match is outside, i.e. when nothing between `node` and `root` matches. Safe to call with no root (null).
 * @param {Node | null | undefined} node
 * @param {string} selector
 * @param {Element | null | undefined} root
 * @returns {Element | null}
 */
export function closestWithin(node, selector, root) {
    if (!node || !root) return null;
    const el = /** @type {Element | null} */ (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    const hit = el?.closest(selector) ?? null;
    return hit && root.contains(hit) ? hit : null;
}
