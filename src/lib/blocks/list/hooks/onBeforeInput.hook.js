import { tick } from "svelte";
import { TextBehavior } from "../../../behaviors/text";
import { List } from "../list.svelte.js";
import { ListItem } from "../list-item.svelte.js";

/**
 * @import { Nabu, Block } from "../..";
 */

/**
 * Markdown shortcut: typing "- " or "1. " at the start of an empty/new paragraph
 * converts it into a list item inside a new bullet/ordered list.
 *
 * @param {Nabu} nabu
 * @param {InputEvent} event
 * @param {Block} block
 */
export const onBeforeInput = (nabu, event, block) => {
    const { BREAK, CONTINUE } = nabu;

    if (event.data !== " ") return CONTINUE;
    if (block.type !== "paragraph") return CONTINUE;

    const behavior = block.behaviors.get("text");
    if (!behavior || !(behavior instanceof TextBehavior)) return CONTINUE;

    const sel = behavior.selection;
    if (!sel || !sel.isCollapsed) return CONTINUE;

    const textBeforeCursor = behavior.text.slice(0, sel.from);

    /** @type {"bullet" | "ordered" | null} */
    let listType = null;
    let prefixLength = 0;

    if (textBeforeCursor.match(/^-$/)) {
        listType = "bullet";
        prefixLength = 1;
    } else if (textBeforeCursor.match(/^\d+\.$/)) {
        listType = "ordered";
        prefixLength = textBeforeCursor.length;
    }

    if (!listType) return CONTINUE;

    // Delete the prefix ("- " trigger: delete the "-"; "1. " trigger: delete the "1.")
    behavior.delete({ index: 0, length: prefixLength });

    // Capture remaining text delta (everything after the prefix)
    const delta = behavior.container.toDelta();

    // Get current tree position from live Loro state (pre-commit)
    const parentNode = block.node.parent();
    const parentId = parentNode?.id.toString() ?? null;
    const index = block.node.index();

    // Create the List at the same position as the paragraph
    const list = List.create(nabu, "list", { listType }, parentId, index);

    // Create the ListItem inside the list with the captured content
    const listItem = ListItem.create(nabu, "list-item", { delta }, list.node.id.toString());

    // Destroy the original paragraph (no commit)
    block.destroy();

    // Commit the whole operation as a single transaction
    nabu.commit();

    // Restore focus to the new list-item
    const listItemId = listItem.node.id.toString();
    tick().then(() => {
        const updatedListItem = nabu.blocks.get(listItemId);
        if (updatedListItem) updatedListItem.focus({ start: 0, end: 0 });
    });

    return BREAK;
};
