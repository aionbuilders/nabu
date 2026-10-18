/**
 * Sub-thread helpers: the keyboard rules of a CONTAINER block made of a header (its own text) and a body
 * (child blocks), e.g. the Toggle, and later a container Callout. They are plain tree operations on nodes
 * (no concrete container type in here): a container block composes them from its own `onSplit` /
 * `beforeinput`, so each rule is one line to reuse.
 *
 *  - Enter on an EMPTY paragraph that is the LAST child of the body exits the sub-thread:
 *    `isEmptyLastParagraph` + `exitSubThread`.
 *  - Backspace at offset 0 of the header turns the container into a paragraph, the body goes right after it:
 *    `dissolveToParagraph`.
 *  - Enter in the header of a container whose body is hidden creates the paragraph after the container:
 *    `insertParagraphAfter`.
 *
 * Every helper mutates the tree only (no commit): the caller owns the transaction, so that one user action stays
 * one undo step.
 *
 * @import { Nabu, NabuNode } from "./nabu.svelte.js";
 * @import { Block } from "./block.svelte.js";
 */

/**
 * Whether `source` is an EMPTY paragraph that is the last child of `container`'s body.
 * @param {{ children: Block[] }} container  a block with children (a MegaBlock)
 * @param {Block} source
 * @returns {boolean}
 */
export function isEmptyLastParagraph(container, source) {
    const kids = container.children;
    return source.type === 'paragraph'
        && /** @type {any} */ (source.parent) === container
        && kids[kids.length - 1] === source
        && !(/** @type {any} */ (source).text?.length);
}

/**
 * Exits the sub-thread: moves `child` right after `container`, in the container's own parent. Nothing else is
 * touched (the other children stay in the body, which may become empty).
 * @param {NabuNode} child  a node of the container's body
 * @param {NabuNode} container
 */
export function exitSubThread(child, container) {
    child.moveAfter(container);
}

/**
 * Turns `container` into a paragraph (same node: its id, header text, marks and position survive) and moves its
 * body right after it, in order, in the same parent. Nothing is lost. The props listed in `drop` are removed
 * from the node (container-specific flags, e.g. `collapsed`).
 * @param {NabuNode} container
 * @param {string[]} [drop]
 */
export function dissolveToParagraph(container, drop = []) {
    const kids = container.children() ?? [];
    for (const kid of [...kids].reverse()) kid.moveAfter(container);
    for (const key of drop) if (/** @type {any} */ (container.data).get(key) !== undefined) /** @type {any} */ (container.data).delete(key);
    container.data.set('type', 'paragraph');
}

/**
 * Inserts a paragraph holding `delta` right after `container`, in its parent. The insert commits.
 * @param {Nabu} nabu
 * @param {NabuNode} container
 * @param {import('loro-crdt').Delta<string>[]} delta
 * @returns {Block}
 */
export function insertParagraphAfter(nabu, container, delta) {
    const parentId = container.parent()?.id.toString() ?? null;
    return nabu.insert('paragraph', { delta }, parentId, (container.index() ?? 0) + 1);
}
