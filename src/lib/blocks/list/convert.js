/**
 * Changing the TYPE of ONE list item, in place: the rest of the list is not touched.
 *
 *  - to another LIST type (bullet / ordered / todo): the item (with its sublists) goes into a new list of the
 *    target type, placed between the part of the list before it and the part after it (both keep their
 *    type; an ORDERED tail keeps counting through `start`). Adjacent lists of the same type are merged by the
 *    normalizer afterwards. The same type is a no-op. Entering a todo list sets `checked: false`, leaving
 *    one drops `checked`.
 *    This works at ANY nesting level (P-28): inside a sublist the three parts are sublists of the same
 *    parent item, in place, side by side (`a > [ul[s1], ol[s2], ul[s3]]`); nothing is promoted. A sole child
 *    converted to another list type just changes the type of its list (which the normalizer then merges with
 *    an adjacent sublist of the new type).
 *  - to any other block (paragraph, heading, quote, code…): the item leaves its list exactly like the
 *    top-level Backspace (see step-back.js `liftItemTo`). A NESTED item cannot become a non-list block where it
 *    is (a list only holds items), so it is first unindented up to the top level (exactly what repeated
 *    Shift+Tab / Backspace do: the following siblings, level after level, become its children, so the
 *    document order and every item survive) and then lifted as a top-level item.
 *
 * Moves on tree NODES only, no commit (the caller owns the transaction, hence the undo step).
 *
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

import { List, listStart } from "./list.svelte.js";
import { typeOf, kids, listTypeOf, dropIfEmpty, unindentNode } from "./indent.js";
import { liftItemTo } from "./step-back.js";

/** Whether the item sits in a sublist of another item. @param {NabuNode} item */
const isNested = (item) => typeOf(item.parent()?.parent()) === "list-item";

/**
 * Unindents a nested item until it is top-level. Moves only.
 * @param {Nabu} nabu
 * @param {NabuNode} item
 */
function hoistToTopLevel(nabu, item) {
    while (isNested(item)) if (!unindentNode(nabu, item)) break;
}

/**
 * Turns an item into a block that is not a list item (see the file header). Moves only; no commit.
 * @param {Nabu} nabu
 * @param {NabuNode} item  a list-item node
 * @param {string} type
 * @param {Record<string, any>} [props]
 * @param {boolean} [numbered=true]  see `liftItemTo`
 * @returns {boolean} whether the item was retyped
 */
export function retypeItem(nabu, item, type, props = {}, numbered = true) {
    if (type === "list-item") return false;
    hoistToTopLevel(nabu, item);
    return liftItemTo(nabu, item, type, props, numbered);
}

/**
 * Moves an item to a list of another type (see the file header). Moves only; no commit.
 * @param {Nabu} nabu
 * @param {NabuNode} item  a list-item node
 * @param {"bullet" | "ordered" | "todo"} listType
 * @returns {boolean} whether something changed (false: already of that type, or not in a list)
 */
export function convertItemToListType(nabu, item, listType) {
    const list = item.parent();
    if (!list || typeOf(list) !== "list" || listTypeOf(list) === listType) return false;
    const current = listTypeOf(list);
    const data = /** @type {any} */ (item.data);
    if (kids(list).length === 1) {
        // The only item: the list itself changes type.
        /** @type {any} */ (list.data).set("listType", listType);
        if (listType !== "ordered" && /** @type {any} */ (list.data).get("start") !== undefined) /** @type {any} */ (list.data).delete("start");
    } else {
        const index = item.index() ?? 0;
        const followers = kids(list).slice(index + 1);
        const parentId = list.parent()?.id.toString() ?? null;
        // The number the first follower had: the list's own start + the items before it (item included).
        const tailStart = (listStart(current, /** @type {any} */ (list.data).get("start")) ?? 1) + index + 1;
        // List.create, not nabu.insert(): that commits, and the empty list would be normalized away.
        const middle = List.create(nabu, "list", { listType }, parentId).node;
        middle.moveAfter(list);
        item.move(middle, 0);
        if (followers.length) {
            const tail = List.create(nabu, "list", { listType: current, start: tailStart }, parentId).node;
            tail.moveAfter(middle);
            for (const follower of followers) follower.move(tail, kids(tail).length);
        }
        dropIfEmpty(nabu, list);
    }

    if (listType === "todo") data.set("checked", false);
    else if (data.get("checked") !== undefined) data.delete("checked");
    return true;
}
