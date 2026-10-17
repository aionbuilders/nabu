/**
 * Indent / unindent of list items (Tab / Shift+Tab), for one item or for every item a selection touches.
 *
 * Everything works on Loro tree NODES, never on the Block instances: inside one batch of moves the
 * Block state (`children`, `sublist`, `parent`) is stale until the commit, and the later moves of the
 * batch depend on the earlier ones. All the moves belong to ONE transaction (one undo step); the
 * selection is captured before and restored after.
 *
 * @import { Nabu, NabuNode, Block } from "../nabu.svelte.js";
 */

import { List } from "./list.svelte.js";

/** @param {NabuNode | null | undefined} node */
export const typeOf = (node) => /** @type {any} */ (node?.data.get("type"));

/** @param {NabuNode} node @returns {NabuNode[]} */
export const kids = (node) => /** @type {NabuNode[]} */ (node.children() ?? []);

/** Sublist of an item, read from the tree (not from the possibly stale Block). @param {NabuNode} item */
export const sublistOf = (item) => kids(item).find((child) => typeOf(child) === "list");

/**
 * Sublist of an item, created (empty, appended) when missing. No `nabu.insert()`: it commits, and the
 * normalizer would delete the still-empty list before the caller fills it.
 * @param {Nabu} nabu
 * @param {NabuNode} item
 * @returns {NabuNode}
 */
function getOrCreateSublist(nabu, item) {
    const existing = sublistOf(item);
    if (existing) return existing;
    const parentList = item.parent();
    const listType = /** @type {any} */ (parentList?.data.get("listType")) || "bullet";
    return List.create(nabu, "list", { listType }, item.id.toString()).node;
}

/**
 * Deletes a list this batch just emptied. The normalizer would do it too, but it spares a list created by
 * the same transaction (it may still be "under construction"), and a batch of moves creates then empties
 * such lists (an item unindented, then its adopted follower unindented in turn).
 * @param {Nabu} nabu
 * @param {NabuNode | null | undefined} list
 */
export function dropIfEmpty(nabu, list) {
    if (list && typeOf(list) === "list" && !kids(list).length) nabu.tree.delete(list.id);
}

/**
 * Indent one item: it goes at the end of its previous sibling's sublist, and its whole subtree moves
 * along (its own sublist stays attached to it, so its children stay its children). Moves only; no commit.
 * @param {Nabu} nabu
 * @param {NabuNode} item
 * @returns {boolean} whether the item moved
 */
export function indentNode(nabu, item) {
    const index = item.index();
    if (!index) return false;
    const parentList = item.parent();
    const previous = parentList && kids(parentList)[index - 1];
    if (!previous || typeOf(previous) !== "list-item") return false;

    nabu.tree.move(item.id.toString(), getOrCreateSublist(nabu, previous).id.toString());
    return true;
}

/**
 * Unindent one item: it goes right after its parent item, and the siblings that followed it become its
 * children (after the ones it already has: its own subtree stays attached). Moves only; no commit.
 * @param {Nabu} nabu
 * @param {NabuNode} item
 * @returns {boolean} whether the item moved
 */
export function unindentNode(nabu, item) {
    const parentList = item.parent();
    const parentItem = parentList?.parent();
    if (!parentList || !parentItem || typeOf(parentItem) !== "list-item") return false;
    const targetList = parentItem.parent();
    if (!targetList) return false;

    const followers = kids(parentList).slice((item.index() ?? 0) + 1);
    if (followers.length) {
        const sublistId = getOrCreateSublist(nabu, item).id.toString();
        for (const follower of followers) nabu.tree.move(follower.id.toString(), sublistId);
    }
    nabu.tree.move(item.id.toString(), targetList.id.toString(), (parentItem.index() ?? 0) + 1);
    dropIfEmpty(nabu, parentList);
    return true;
}

/**
 * @typedef {{ block: Block, offset: number }} CaretPoint
 * @typedef {{ anchor: CaretPoint, focus: CaretPoint }} SelectionSnapshot
 */

/**
 * Model position (block + text offset) of the live selection's anchor and focus, or null when one of
 * them is not in a text block.
 * @param {Nabu} nabu
 * @returns {SelectionSnapshot | null}
 */
export function captureSelection(nabu) {
    const sel = nabu.selection;
    /** @param {Node | null} node @param {number} offset @param {Block | null | undefined} block @returns {CaretPoint | null} */
    const point = (node, offset, block) => {
        const text = /** @type {any} */ (block?.behaviors?.get("text"));
        if (!node || !block?.element || !text) return null;
        return { block, offset: text.calculateOffset(node, offset, block.element) };
    };
    const anchor = point(sel.anchorNode, sel.anchorOffset, sel.anchorBlock);
    const focus = point(sel.focusNode, sel.focusOffset, sel.focusBlock);
    return anchor && focus ? { anchor, focus } : null;
}

/**
 * Put the selection back after a re-render: same blocks (looked up again by id), same offsets, so a
 * collapsed caret stays collapsed and a range stays a range.
 * @param {Nabu} nabu
 * @param {SelectionSnapshot | null} snapshot
 * @returns {Promise<void>}
 */
export async function restoreSelection(nabu, snapshot) {
    if (!snapshot) return;
    const anchor = nabu.blocks.get(snapshot.anchor.block.id);
    const focus = nabu.blocks.get(snapshot.focus.block.id);
    if (!anchor || !focus) return;
    await nabu.focus({
        from: { block: anchor, offset: snapshot.anchor.offset },
        to: { block: focus, offset: snapshot.focus.offset },
    });
}

/**
 * Indent (`unindent = false`) or unindent every given list item, in document order, as ONE transaction.
 * Items that cannot move (e.g. the first item of a list on indent) stay. The selection is restored.
 * @param {Nabu} nabu
 * @param {NabuNode[]} items  list-item nodes, in document order
 * @param {boolean} unindent
 * @returns {Promise<boolean>} whether at least one item moved
 */
export async function moveItems(nabu, items, unindent) {
    const snapshot = captureSelection(nabu);
    // Ancestors read BEFORE any move of the batch: an item whose original ancestor is selected AND moved
    // goes along with it as part of the subtree, so it must not be moved a second time. (Later moves
    // re-parent items: s2 adopted by an unindented s1 is still processed, it was no descendant of s1.)
    const ancestors = items.map((item) => {
        /** @type {string[]} */
        const ids = [];
        for (let a = item.parent(); a; a = a.parent()) ids.push(a.id.toString());
        return ids;
    });
    /** @type {Set<string>} */
    const moved = new Set();
    items.forEach((item, i) => {
        if (ancestors[i].some((id) => moved.has(id))) return;
        if (unindent ? unindentNode(nabu, item) : indentNode(nabu, item)) moved.add(item.id.toString());
    });
    if (!moved.size) return false;
    await nabu.commit();
    await restoreSelection(nabu, snapshot);
    return true;
}

/**
 * The list items a selection touches, in document order: the anchor block alone when the selection is
 * inside one block, otherwise every list item between the start and the end block.
 * @param {Nabu} nabu
 * @returns {NabuNode[]}
 */
export function selectedItems(nabu) {
    const sel = nabu.selection;
    /** @type {Block[]} */
    const blocks = sel.anchorBlock && sel.anchorBlock === sel.focusBlock ? [sel.anchorBlock] : [...sel.blocks];
    return blocks.filter((block) => block.type === "list-item").map((block) => /** @type {NabuNode} */ (block.node));
}

/**
 * Tab / Shift+Tab on the current selection. Returns true (= the key is handled, the default prevented)
 * whenever the selection touches list items, even when none of them could move: focus never leaves the editor.
 * @param {Nabu} nabu
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function handleTab(nabu, event) {
    if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return false;
    const items = selectedItems(nabu);
    if (!items.length) return false;
    moveItems(nabu, items, event.shiftKey);
    return true;
}
