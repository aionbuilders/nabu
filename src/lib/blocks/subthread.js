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
 *  - A multi-block paste with the caret in the HEADER: the first block completes the header, the others go to
 *    the top of the body, the header text after the caret follows the last one: `pasteIntoHeader`.
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

/**
 * Multi-block paste with the caret in the HEADER of a container (the header is text only, the body holds the
 * blocks). Consistent with "Enter in the header creates the first body child":
 *  - the FIRST pasted block, when it is a text leaf, completes the header at the caret (the header keeps its
 *    type); a first block that is not text (container, image…) leaves the header as it is;
 *  - the other blocks go to the TOP of the body, in order, above the existing children;
 *  - the header text AFTER the caret follows the pasted blocks: it merges into the LAST pasted block when that
 *    one is text (cut at the edge of a partial copy, or a default text block), otherwise it becomes a new default
 *    text block right after it;
 *  - the caret ends at the junction (end of the pasted text), or at the start of the tail block.
 * A single pasted text block is not for this helper (the engine's inline merge handles it): returns null and
 * touches nothing, like `Block#acceptPaste`. Does NOT expand a collapsed container (its caller does: the body
 * must be visible for the pasted content to be). Tree operations only, no commit.
 *
 * @param {Nabu} nabu
 * @param {Block} container  the block holding the caret in its header
 * @param {number} offset  the caret offset in the header text
 * @param {import("../utils/extensions.js").PasteBlock[]} blocks
 * @returns {{ block: Block | null, offset: number } | null}
 */
export function pasteIntoHeader(nabu, container, offset, blocks) {
    if (!blocks?.length || (blocks.length === 1 && !blocks[0].children?.length)) return null;
    const text = /** @type {any} */ (container.behaviors?.get('text'));
    if (!text) return null;
    const defaultType = nabu.defaultBlockType && nabu.registry.has(nabu.defaultBlockType) ? nabu.defaultBlockType : 'paragraph';
    const DefaultClass = nabu.registry.get(defaultType);
    if (!DefaultClass) return null;

    /** @param {any[]} delta */
    const deltaLen = (delta) => delta.reduce((n, op) => n + (typeof op.insert === 'string' ? op.insert.length : 0), 0);

    // ── 1. Cut the header at the caret ──
    const tailDelta = text.container.sliceDelta(offset, text.container.length);
    if (text.container.length > offset) text.delete({ index: offset, length: text.container.length - offset });

    // ── 2. The first block completes the header when it is a text leaf ──
    const first = blocks[0];
    const completesHeader = !first.children?.length && Array.isArray(first.delta);
    /** @type {{ block: Block | null, offset: number }} */
    let landing = { block: container, offset };
    if (completesHeader) {
        const delta = first.delta ?? [];
        if (delta.length) text.applyDelta([{ retain: offset }, ...delta]);
        landing = { block: container, offset: offset + deltaLen(delta) };
    }
    const body = completesHeader ? blocks.slice(1) : blocks;
    const last = body[body.length - 1];
    const hasTail = deltaLen(tailDelta) > 0;
    const lastIsText = !!last && !last.children?.length
        && (last.partial === 'end' || last.partial === 'both' || last.type === nabu.defaultBlockType);
    const mergesTail = hasTail && lastIsText;

    // ── 3. The body blocks, at the TOP of the body ──
    // A placeholder at index 0 anchors the chain (insertPasteBlock inserts AFTER a node); it is removed at the end.
    // (`Class.create`, not `nabu.insert`: the latter commits, and the whole paste is ONE transaction.)
    const placeholder = DefaultClass.create(nabu, defaultType, {}, container.node.id.toString(), 0);
    /** @type {NabuNode} */
    let previous = placeholder.node;
    /** @type {NabuNode | null} */
    let lastNode = null;
    body.forEach((pb, i) => {
        if (mergesTail && i === body.length - 1) {
            // The tail joins the last pasted text, in a default text block (the container's own type is not
            // allowed in its body).
            const delta = [...(pb.delta ?? []), ...tailDelta];
            previous = nabu.insertPasteBlock({ type: defaultType, partial: false, delta }, previous);
            landing = { block: nabu.blocks.get(previous.id.toString()) ?? null, offset: deltaLen(pb.delta ?? []) };
        } else {
            previous = nabu.insertPasteBlock(pb, previous);
        }
        lastNode = previous;
    });
    if (hasTail && !mergesTail) {
        previous = nabu.insertPasteBlock({ type: defaultType, partial: false, delta: tailDelta }, previous);
        landing = { block: nabu.blocks.get(previous.id.toString()) ?? null, offset: 0 };
    } else if (!hasTail && lastNode) {
        const end = textEnd(lastNode);
        if (end) landing = { block: nabu.blocks.get(end.node.id.toString()) ?? null, offset: end.offset };
    }
    nabu.tree.delete(placeholder.node.id);
    return landing;
}

/**
 * The end of the last text under `node` (the node itself when it has no children), or null when that last leaf
 * holds no text (an image…).
 * @param {NabuNode} node
 * @returns {{ node: NabuNode, offset: number } | null}
 */
function textEnd(node) {
    let current = node;
    for (let kids = current.children() ?? []; kids.length; kids = current.children() ?? []) current = kids[kids.length - 1];
    const text = /** @type {any} */ (current.data).get('text');
    return text ? { node: current, offset: text.length } : null;
}
