/**
 * Ctrl/Cmd+Enter on a to-do item (the `todo:toggle` command, ADR 017) toggles its `checked`. With a selection spanning several to-do items they
 * are toggled together: if ANY is unchecked every one gets checked, otherwise every one gets unchecked.
 * One transaction (one undo step); the caret / selection is not touched.
 *
 * @import { Nabu } from "../nabu.svelte.js";
 */

import { selectedItems } from "./indent.js";

/**
 * The to-do items the selection touches (the anchor item for a caret).
 * @param {Nabu} nabu
 */
export function selectedTodoItems(nabu) {
    return selectedItems(nabu).filter((node) => /** @type {any} */ (node.parent()?.data)?.get("listType") === "todo");
}

/**
 * Toggle the to-do items the selection touches (see the module doc). The `todo:toggle` command.
 * @param {Nabu} nabu
 * @returns {boolean} whether at least one to-do item was touched
 */
export function toggleSelectedTodos(nabu) {
    const items = selectedTodoItems(nabu);
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

/**
 * Key-event form of {@link toggleSelectedTodos}: Ctrl/Cmd+Enter only (the keyboard path is the `todo:toggle` command now;
 * this stays for direct callers).
 * @param {Nabu} nabu
 * @param {KeyboardEvent} event
 * @returns {boolean} whether the key was handled (= at least one to-do item was touched); false for any other key
 */
export function toggleTodos(nabu, event) {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return false;
    return toggleSelectedTodos(nabu);
}
