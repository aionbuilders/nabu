/**
 * `list:convert` — turn the block holding the caret into a list item of the given type (slash menu
 * "Bulleted / Numbered / To-do list"):
 *  - a list item changes list type on its own, in place (see convert.js);
 *  - any other text block is replaced by a new list (same flow as the "- " / "1. " markdown shortcuts).
 *
 * @import { Nabu } from "../nabu.svelte.js";
 */

import { List } from "./list.svelte.js";
import { ListItem } from "./list-item.svelte.js";
import { convertItemToListType } from "./convert.js";
import { readDelta } from "../../utils/delta.js";

/**
 * @param {Nabu} nabu
 * @param {"bullet" | "ordered" | "todo"} listType
 * @returns {Promise<void>}
 */
export async function convertToList(nabu, listType) {
    const block = nabu.selection.anchorBlock;
    if (!block || !["bullet", "ordered", "todo"].includes(listType)) return;

    if (block.type === "list-item") {
        const id = block.id;
        const offset = block.behaviors?.get("text")?.selection?.from ?? 0;
        await nabu.transact(() => { convertItemToListType(nabu, /** @type {any} */ (block.node), listType); });
        const fresh = nabu.blocks.get(id);
        if (fresh) nabu.focus({ from: { block: fresh, offset }, to: { block: fresh, offset } });
        return;
    }

    const beh = block.behaviors?.get("text");
    const delta = beh ? readDelta(beh.container) : [];
    const parentNode = block.node.parent();
    const parentId = parentNode?.id.toString() ?? null;
    const index = block.node.index();
    const list = List.create(nabu, "list", { listType }, parentId, index);
    const itemProps = listType === "todo" ? { delta, checked: false } : { delta };
    const item = ListItem.create(nabu, "list-item", itemProps, list.node.id.toString());
    block.destroy();
    await nabu.commit();
    const fresh = nabu.blocks.get(item.id);
    if (fresh) fresh.focus({ start: 0, end: 0 });
}
