/**
 * "Step back one level" for a list item: Enter on an EMPTY item, Backspace at offset 0 of an item.
 *
 *  - a NESTED item is unindented one level (exactly Shift+Tab: its following siblings become its children);
 *  - a TOP-LEVEL item leaves the list and becomes a paragraph (same node, so its id, text, marks and caret
 *    survive). The list is split around it: the items before stay, the items after go into a new list
 *    placed after the paragraph. The item's own sublist is moved out right after the paragraph (nothing is
 *    lost, the relative nesting is kept). An ORDERED tail list keeps counting where the list left off
 *    (`start`), so `1. a 2. b 3. c` with b removed reads `1. a`, `b`, `3. c`.
 *
 * Moves on tree NODES only, one transaction (= one undo step), then the caret goes to offset 0.
 *
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

import { List, listStart } from "./list.svelte.js";
import { typeOf, kids, sublistOf, dropIfEmpty, moveItems } from "./indent.js";

/**
 * Takes a top-level item out of its list and retypes it as `type` (a paragraph for the step back, any
 * block for a type change: heading, quote, code…). Moves only; no commit. The `checked` flag is dropped,
 * `props` are written on the node (e.g. a heading `level`).
 * @param {Nabu} nabu
 * @param {NabuNode} item
 * @param {string} [type]
 * @param {Record<string, any>} [props]
 * @returns {boolean} whether the item was lifted (false when it is nested / not in a list)
 */
export function liftItemTo(nabu, item, type = "paragraph", props = {}) {
    const list = item.parent();
    if (!list || typeOf(list) !== "list" || typeOf(list.parent()) === "list-item") return false;

    const index = item.index() ?? 0;
    const followers = kids(list).slice(index + 1);
    const own = sublistOf(item);
    const listType = /** @type {any} */ (list.data.get("listType")) || "bullet";
    // The number the first follower had: the list's own start + the items before it (item included).
    const tailStart = (listStart(listType, list.data.get("start")) ?? 1) + index + 1;
    const parentId = list.parent()?.id.toString();

    item.moveAfter(list);
    /** @type {NabuNode} */
    let anchor = item;
    if (own) {
        own.moveAfter(anchor);
        anchor = own;
    }
    if (followers.length) {
        // List.create, not nabu.insert(): that commits, and the empty tail would be normalized away.
        const tail = List.create(nabu, "list", { listType, start: tailStart }, parentId).node;
        tail.moveAfter(anchor);
        for (const follower of followers) follower.move(tail, kids(tail).length);
    }
    dropIfEmpty(nabu, list);

    if (/** @type {any} */ (item.data).get("checked") !== undefined) /** @type {any} */ (item.data).delete("checked");
    item.data.set("type", type);
    for (const [key, value] of Object.entries(props)) /** @type {any} */ (item.data).set(key, value);
    return true;
}

/**
 * Takes a top-level item out of its list and retypes it as a paragraph. Moves only; no commit.
 * @param {Nabu} nabu
 * @param {NabuNode} item
 * @returns {boolean} whether the item was lifted (false when it is nested / not in a list)
 */
export const liftItemToParagraph = (nabu, item) => liftItemTo(nabu, item, "paragraph");

/**
 * Step a list item back one level (see the file header). Resolves once committed and the caret is back.
 * @param {Nabu} nabu
 * @param {NabuNode} item  a list-item node
 * @returns {Promise<boolean>} whether the structure changed
 */
export async function stepBack(nabu, item) {
    const id = item.id.toString();
    if (typeOf(item.parent()?.parent()) === "list-item") return moveItems(nabu, [item], true);
    if (!liftItemToParagraph(nabu, item)) return false;
    await nabu.commit();
    const block = nabu.blocks.get(id);
    if (block) nabu.selection.setCursor(block, 0);
    return true;
}
