/**
 * Pasting into a list item (P-49): "what a list item can hold is absorbed; everything else splits the list".
 *
 * Reached through the generic `Block#acceptPaste` extension point (see `ListItem#acceptPaste`); the engine
 * knows nothing about lists. The pasted fragment, whatever its source (internal `application/x-nabu+json`,
 * markdown, HTML, multi-line plain text), is a list of PasteBlocks, taken IN ORDER:
 *
 *  - PARAGRAPHS become LIST ITEMS of the list the caret is in, at the same level, with the list's type (a to-do
 *    list gets unchecked items);
 *  - a pasted LIST gives its items to the list the caret is in, at the same level: they ADOPT THE CURRENT
 *    LIST'S TYPE (a numbered list pasted into a bullet list becomes bullets; like Notion, and the destination
 *    decides what the user sees). Their own nested sublists are kept as they are, types included (relative
 *    nesting preserved); a `checked` flag is kept only when the destination is a to-do list;
 *  - anything an item cannot hold (heading, code, quote, callout, divider, image, video, file, toggle,
 *    dialogue…) SPLITS the list at that point: the items before stay, the block goes right after them (at the
 *    list's parent level), the rest of the original list follows below, an ORDERED tail keeps counting
 *    (`start`). This is `liftItemTo` (step-back.js): same mechanism as Backspace / a type change on an item.
 *    From then on we are OUTSIDE the list: the remaining pasted blocks are inserted as they are (a paragraph
 *    stays a paragraph, a list stays a list) between the last block and the list tail.
 *  - the text of the caret item is cut at the caret: the head keeps its item (the FIRST pasted block merges
 *    into it when it is a paragraph, or a partial list item), the tail (text after the caret + the item's
 *    sublists) becomes the item that follows the pasted content, unless the LAST pasted block is a paragraph
 *    (or a partial list item) still inside the list: it then merges with the tail, like Enter + typing would.
 *    A sublist-less empty tail creates nothing; the sublists of the caret item stay under it when there is no
 *    tail text to carry them.
 *  - the caret ends right after the pasted content (at the junction when the last block merged with the tail).
 *
 * Moves / creations on tree NODES only, no commit: the caller owns the transaction (one undo step).
 *
 * @import { Block } from "../block.svelte.js";
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 * @import { PasteBlock } from "../../utils/extensions.js";
 */

import { kids, typeOf, listTypeOf, dropIfEmpty } from "./indent.js";
import { retypeItem } from "./convert.js";

/**
 * @typedef {{ kind: "text" | "item" | "list" | "foreign", pb: PasteBlock }} PasteUnit
 */

/** @param {PasteBlock} pb */
const isLeaf = (pb) => !pb.children?.length;

/** The text of a leaf block cut by the selection at its edges is plain text for the list. @param {PasteBlock} pb @param {boolean} first @param {boolean} last */
const isEdgeText = (pb, first, last) =>
    isLeaf(pb) && ((first && (pb.partial === "start" || pb.partial === "both")) || (last && (pb.partial === "end" || pb.partial === "both")));

/**
 * Sorts every block of the fragment in one of four kinds. Pure: no tree access.
 *  - `text`: a paragraph, or the text of a leaf block cut at the fragment's edges (partial copy);
 *  - `item`: a list item (alone: it comes from a partial copy of an item with its sublists);
 *  - `list`: a list with items;
 *  - `foreign`: whatever an item cannot hold.
 * Returns null when the list has nothing to do: a single `text` block is the engine's inline merge.
 * @param {PasteBlock[]} blocks
 * @returns {PasteUnit[] | null}
 */
export function planPaste(blocks) {
    if (!blocks?.length) return null;
    const last = blocks.length - 1;
    /** @type {PasteUnit[]} */
    const units = blocks.map((pb, i) => {
        if (pb.type === "list" && !isLeaf(pb)) return { kind: "list", pb };
        if (pb.type === "list-item" && !isEdgeText(pb, i === 0, i === last)) return { kind: "item", pb };
        if (pb.type === "paragraph" && isLeaf(pb)) return { kind: "text", pb };
        if (isEdgeText(pb, i === 0, i === last)) return { kind: "text", pb };
        return { kind: "foreign", pb };
    });
    if (units.length === 1 && units[0].kind === "text") return null;
    return units;
}

/**
 * Deletes the sentinel item; the list it leaves empty goes too (the normalizer spares a list created by the
 * same transaction, and a split creates the tail list). @param {Nabu} nabu @param {NabuNode} sentinel
 */
function dropSentinel(nabu, sentinel) {
    const host = sentinel.parent();
    nabu.tree.delete(sentinel.id);
    dropIfEmpty(nabu, host);
}

/** @param {NabuNode} node */
const isAlive = (node) => {
    try { return !node.isDeleted(); } catch { return false; }
};

/** @param {NabuNode} node @returns {number} */
const textLength = (node) => /** @type {any} */ (node.data).get("text")?.length ?? 0;

/**
 * The end of the last text under `node` (the node itself when it has no children), or null when that last
 * leaf holds no text (an image…).
 * @param {NabuNode} node
 * @returns {{ node: NabuNode, offset: number } | null}
 */
function textEnd(node) {
    let current = node;
    for (let children = kids(current); children.length; children = kids(current)) current = children[children.length - 1];
    return /** @type {any} */ (current.data).get("text") ? { node: current, offset: textLength(current) } : null;
}

/**
 * @typedef {Object} ItemEntry
 * @property {any[]} delta
 * @property {PasteBlock[]} subs  the item's sublists
 * @property {boolean | undefined} checked
 * @property {boolean} head  a partial copy starting in this item: its text merges into the caret item
 * @property {boolean} tail  a partial copy ending in this item: its text merges with the tail
 */

/** @param {PasteBlock} pb @returns {ItemEntry} */
const itemEntry = (pb) => ({
    delta: pb.delta ?? [],
    subs: pb.children ?? [],
    checked: pb.props?.checked,
    head: pb.partial === "start" || pb.partial === "both",
    tail: pb.partial === "end" || pb.partial === "both",
});

/**
 * Applies the paste (see the file header). Returns where the caret goes, or null when the list declines
 * (nothing was touched).
 * @param {Block} block  the list item holding the caret
 * @param {number} offset  the caret offset in its text
 * @param {PasteBlock[]} blocks
 * @returns {{ block: Block | null, offset: number } | null}
 */
export function pasteIntoItem(block, offset, blocks) {
    const units = planPaste(blocks);
    if (!units) return null;
    const nabu = block.nabu;
    const node = /** @type {NabuNode} */ (block.node);
    const list = node.parent();
    const text = /** @type {any} */ (block.behaviors?.get("text"));
    if (!text || !list || typeOf(list) !== "list") return null;
    const ItemClass = /** @type {any} */ (block.constructor);

    // ── 1. Cut the caret item: head stays, tail (text + sublists) goes to a sentinel item right after it ──
    const container = text.container;
    const tailDelta = container.sliceDelta(offset, container.length);
    const hasTail = container.length > offset;
    if (hasTail) text.delete({ index: offset, length: container.length - offset });
    const sublists = kids(node);
    const sentinel = ItemClass.create(
        nabu, "list-item",
        { delta: tailDelta, ...(listTypeOf(list) === "todo" ? { checked: false } : {}) },
        list.id.toString(), (node.index() ?? 0) + 1,
    ).node;
    if (hasTail) for (const sub of sublists) sub.move(sentinel, kids(sentinel).length);

    // Does the first pasted block merge into the head? A paragraph / partial item does; so does any item
    // when the caret item is empty (it is replaced by the pasted content, not left behind empty).
    const firstUnit = units[0];
    const firstEntry = firstUnit.kind === "list" ? itemEntry(firstUnit.pb.children?.[0] ?? firstUnit.pb)
        : firstUnit.kind === "item" ? itemEntry(firstUnit.pb) : null;
    const mergesHead = firstUnit.kind === "text" || (!!firstEntry && (firstEntry.head || (offset === 0 && !hasTail)));
    // Blank head left behind by a first block that does not merge: gone (nothing precedes the caret).
    if (offset === 0 && !mergesHead && !kids(node).length) nabu.tree.delete(node.id);

    // ── 2. The pasted blocks, in order ──
    /** @type {NabuNode | null} */
    let lastItem = null;      // last item emitted inside the list (the head included)
    let lastMergesTail = false;
    let outside = false;
    /** @type {any} */
    let previousOuter = null; // last block inserted outside the list
    /** @type {{ node: NabuNode, offset: number } | null} */
    let focus = null;
    let lastIsVoid = false;

    /** @param {ItemEntry} entry @param {boolean} isFirst @param {boolean} mergesTailIfLast */
    const emitItem = (entry, isFirst, mergesTailIfLast) => {
        lastMergesTail = mergesTailIfLast;
        if (isFirst && mergesHead) {
            text.applyDelta([{ retain: offset }, ...entry.delta]);
            for (const sub of entry.subs) nabu.createPasteBlock(sub, node.id.toString());
            lastItem = node;
            focus = textEnd(node);
            return;
        }
        const host = /** @type {NabuNode} */ (sentinel.parent());
        /** @type {Record<string, any>} */
        const props = { delta: entry.delta };
        if (listTypeOf(host) === "todo") props.checked = entry.checked === undefined ? false : !!entry.checked;
        const item = ItemClass.create(nabu, "list-item", props, host.id.toString(), sentinel.index() ?? 0);
        for (const sub of entry.subs) nabu.createPasteBlock(sub, item.node.id.toString());
        lastItem = item.node;
        focus = textEnd(item.node);
    };

    units.forEach((unit, u) => {
        const isLastUnit = u === units.length - 1;
        if (outside) {
            previousOuter = nabu.insertPasteBlock(unit.pb, previousOuter);
            focus = textEnd(previousOuter);
            lastIsVoid = !focus;
            return;
        }
        if (unit.kind === "foreign") {
            // Split the list at the sentinel (= the caret): a placeholder item takes the place, is lifted out of
            // the list (items after it go to a new list, numbering continues) and replaced by the real block.
            const host = /** @type {NabuNode} */ (sentinel.parent());
            const placeholder = ItemClass.create(nabu, "list-item", {}, host.id.toString(), sentinel.index() ?? 0).node;
            retypeItem(nabu, placeholder, "paragraph", {}, false);
            previousOuter = nabu.insertPasteBlock(unit.pb, placeholder);
            nabu.tree.delete(placeholder.id);
            outside = true;
            lastItem = null;
            focus = textEnd(previousOuter);
            lastIsVoid = !focus;
            return;
        }
        if (unit.kind === "text") {
            emitItem({ delta: unit.pb.delta ?? [], subs: [], checked: undefined, head: true, tail: true }, u === 0, isLastUnit);
            return;
        }
        const entries = unit.kind === "list" ? (unit.pb.children ?? []).map(itemEntry) : [itemEntry(unit.pb)];
        entries.forEach((entry, k) => emitItem(entry, u === 0 && k === 0, isLastUnit && k === entries.length - 1 && entry.tail));
    });

    // ── 3. The tail ──
    if (!outside && lastItem && lastMergesTail) {
        // The last pasted block merges with the tail: the junction is where the caret ends.
        const target = /** @type {NabuNode} */ (lastItem);
        const targetText = /** @type {any} */ (nabu.blocks.get(target.id.toString())?.behaviors?.get("text"));
        const junction = textLength(target);
        if (hasTail) targetText.applyDelta([{ retain: junction }, ...tailDelta]);
        for (const sub of sublists) if (sub.parent()?.id.toString() !== target.id.toString()) sub.move(target, kids(target).length);
        dropSentinel(nabu, sentinel);
        return { block: nabu.blocks.get(target.id.toString()) ?? null, offset: junction };
    }
    if (!textLength(sentinel) && !kids(sentinel).length) {
        dropSentinel(nabu, sentinel);
    } else if (lastIsVoid || !focus) {
        focus = { node: sentinel, offset: 0 };
    }
    if (!focus && isAlive(node)) focus = textEnd(node);
    const caretBlock = focus ? nabu.blocks.get(focus.node.id.toString()) ?? null : null;
    return { block: caretBlock, offset: focus?.offset ?? 0 };
}
