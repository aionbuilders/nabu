import { tick } from "svelte";
import { TextBehavior } from "../../../behaviors/text";
import { List } from "../list.svelte.js";
import { ListItem } from "../list-item.svelte.js";
import { stepBack } from "../step-back.js";
import { readDelta } from "../../../utils/delta.js";

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

    // Backspace at offset 0 of a list item (collapsed caret): step back one level instead of merging into
    // the previous block. A nested item is unindented, a top-level one becomes a paragraph (the next
    // Backspace then merges it like any paragraph). See step-back.js.
    if (event.inputType === "deleteContentBackward" && block instanceof ListItem) {
        const sel = block.behavior.selection;
        if (!sel || !sel.isCollapsed || sel.from !== 0) return CONTINUE;
        stepBack(nabu, /** @type {import('../../nabu.svelte.js').NabuNode} */ (block.node));
        return BREAK;
    }

    if (event.data !== " ") return CONTINUE;
    if (block.type !== "paragraph") return CONTINUE;

    const behavior = block.behaviors.get("text");
    if (!behavior || !(behavior instanceof TextBehavior)) return CONTINUE;

    const sel = behavior.selection;
    if (!sel || !sel.isCollapsed) return CONTINUE;

    const textBeforeCursor = behavior.text.slice(0, sel.from);

    /** @type {"bullet" | "ordered" | "todo" | null} */
    let listType = null;
    let prefixLength = 0;
    /** @type {boolean | undefined} */
    let checked = undefined;
    /** @type {number | undefined} */
    let start = undefined;

    if (textBeforeCursor.match(/^-$/)) {
        listType = "bullet";
        prefixLength = 1;
    } else if (textBeforeCursor.match(/^\d+\.$/)) {
        listType = "ordered";
        prefixLength = textBeforeCursor.length;
        start = parseInt(textBeforeCursor, 10); // "3. " starts the list at 3 (List drops it when it is 1)
    } else if (textBeforeCursor.match(/^\[\s?\]$/)) {
        listType = "todo";
        checked = false;
        prefixLength = textBeforeCursor.length;
    } else if (textBeforeCursor.match(/^\[[xX]\]$/)) {
        listType = "todo";
        checked = true;
        prefixLength = textBeforeCursor.length;
    }

    if (!listType) return CONTINUE;
    const type = listType;

    /** @type {string | null} */
    let listItemId = null;

    // Undo gives back the typed trigger ("- ", "1. "…, space included): see Nabu.shortcut()
    nabu.shortcut(block, " ", (b) => {
        // Delete the prefix and the trigger space ("- " -> "", "1. " -> "")
        b.delete({ index: 0, length: prefixLength + 1 });

        // Capture remaining text delta (everything after the prefix)
        const delta = readDelta(b.container);

        // Get current tree position from live Loro state (pre-commit)
        const parentNode = block.node.parent();
        const parentId = parentNode?.id.toString() ?? null;
        const index = block.node.index();

        // Create the List at the same position as the paragraph
        /** @type {Record<string, any>} */
        const listProps = { listType: type };
        if (start !== undefined) listProps.start = start;
        const list = List.create(nabu, "list", listProps, parentId, index);

        // Create the ListItem inside the list with the captured content
        /** @type {Record<string, any>} */
        const itemProps = { delta };
        if (checked !== undefined) itemProps.checked = checked;
        const listItem = ListItem.create(nabu, "list-item", itemProps, list.node.id.toString());
        listItemId = listItem.node.id.toString();

        // Destroy the original paragraph; shortcut() commits the whole operation as one transaction
        block.destroy();
    });

    // Restore focus to the new list-item
    tick().then(() => {
        const updatedListItem = listItemId ? nabu.blocks.get(listItemId) : null;
        if (updatedListItem) updatedListItem.focus({ start: 0, end: 0 });
    });

    return BREAK;
};
