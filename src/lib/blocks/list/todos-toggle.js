/**
 * Ctrl/Cmd+Enter on a to-do item toggles its `checked`. With a selection spanning several to-do items they
 * are toggled together: if ANY is unchecked every one gets checked, otherwise every one gets unchecked.
 * One transaction (one undo step); the caret / selection is not touched.
 *
 * @import { Nabu } from "../nabu.svelte.js";
 */

import { selectedItems } from "./indent.js";

/**
 * @param {Nabu} nabu
 * @param {KeyboardEvent} event
 * @returns {boolean} whether the key was handled (= at least one to-do item was touched); false for any other key
 */
export function toggleTodos(nabu, event) {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return false;
    const items = selectedItems(nabu).filter((node) => /** @type {any} */ (node.parent()?.data)?.get("listType") === "todo");
    if (!items.length) return false;
    const value = items.some((node) => !(/** @type {any} */ (node.data)).get("checked"));
    for (const node of items) {
        const block = /** @type {any} */ (nabu.blocks.get(node.id.toString()));
        if (block) block.checked = value;
        /** @type {any} */ (node.data).set("checked", value);
    }
    nabu.isolateUndoStep(); // a flag change is not structural: it would merge with the typing around it
    nabu.commit();
    return true;
}
