/**
 * Chromium workaround for IME compositions that start after an EMPTY block (issue #6).
 *
 * An empty block renders a lone "\n" text node (one line, see RichText.svelte). Chromium locates the running composition by
 * PLAIN-TEXT offsets from the editable root, and the two directions of that mapping disagree on such a node: every lone "\n"
 * block BEFORE the composition drifts its start back by one, so the composed text lands in the wrong (previous) block and the
 * next `compositionupdate` deletes the blocks in between — the commit never lands. A `<br>` in the same place maps cleanly.
 *
 * So for the duration of a composition the lone "\n" nodes before the composing block are swapped for a `<br>` (same single
 * line), and put back at its end, before the model catches up. Nothing in the model or the Svelte-owned nodes changes.
 */

/**
 * Swap, in the document before `element`, every empty block's lone "\n" text node for a `<br>`.
 * @param {Element | null | undefined} element the block holding the composition
 * @returns {Array<{ br: Element, text: Text }>} what {@link restoreEmptyBlocks} puts back
 */
export function swapEmptyBlocks(element) {
    /** @type {Array<{ br: Element, text: Text }>} */
    const swapped = [];
    const root = element?.closest('[data-nabu-root]');
    if (!element || !root) return swapped;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    /** @type {Text[]} */
    const lone = [];
    for (let n = /** @type {Text | null} */ (walker.nextNode()); n; n = /** @type {Text | null} */ (walker.nextNode())) {
        if (!(element.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING)) break; // reached the composing block
        if (n.data !== '\n' || !n.parentNode) continue;
        // Only an empty block's placeholder: nothing but Svelte's anchors (comments, empty text nodes) beside it (no filler <br>, no other text).
        let alone = true;
        for (const s of n.parentNode.childNodes) {
            if (s === n || s.nodeType === Node.COMMENT_NODE || (s.nodeType === Node.TEXT_NODE && !/** @type {Text} */ (s).data)) continue;
            alone = false; break;
        }
        if (alone) lone.push(n);
    }
    for (const text of lone) {
        const br = document.createElement('br');
        text.replaceWith(br);
        swapped.push({ br, text });
    }
    return swapped;
}

/**
 * Put the "\n" text nodes back (Svelte keeps references to them). A `<br>` the browser or Svelte already removed is skipped.
 * @param {Array<{ br: Element, text: Text }>} swapped
 */
export function restoreEmptyBlocks(swapped) {
    for (const { br, text } of swapped) if (br.parentNode) br.replaceWith(text);
}
