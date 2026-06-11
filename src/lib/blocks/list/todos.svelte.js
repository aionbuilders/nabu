import { ListItem } from "./list-item.svelte.js";

/** @import { Nabu } from "../nabu.svelte.js"; */

/**
 * Document-level reactive registry of all to-do items (checklist list-items).
 * Pure derived view over the block tree — stores nothing in Loro.
 * Lazy: obtain via Todos.get(nabu).
 */
export class Todos {
    /** @type {Nabu} */
    #nabu;

    /** @param {Nabu} nabu */
    constructor(nabu) { this.#nabu = nabu; }

    /** @param {Nabu} nabu @returns {Todos} */
    static get(nabu) {
        if (!nabu.systems.has('todos')) {
            const todos = new Todos(nabu);
            nabu.systems.set('todos', todos);
            return todos;
        }
        return /** @type {Todos} */ (nabu.systems.get('todos'));
    }

    /**
     * All to-do items in document order (DFS). A to-do is a list-item whose
     * parent list is a todo list (ListItem.isTodo).
     * @type {ListItem[]}
     */
    all = $derived.by(() => {
        /** @type {ListItem[]} */
        const result = [];
        /** @param {import('../block.svelte.js').Block[]} blocks */
        const traverse = (blocks) => {
            for (const block of blocks) {
                if (block instanceof ListItem && block.isTodo) result.push(block);
                const children = /** @type {any} */ (block).children;
                if (children?.length) traverse(children);
            }
        };
        traverse(this.#nabu.children);
        return result;
    });

    count = $derived(this.all.length);
    done = $derived(this.all.filter(t => t.checked));
    doneCount = $derived(this.done.length);
    remaining = $derived(this.all.filter(t => !t.checked));
    /** Fraction completed, 0..1 (0 when there are no to-dos). */
    progress = $derived(this.count ? this.doneCount / this.count : 0);

    /** @param {ListItem} item */
    toggle(item) { item.toggleChecked(); }

    /** Mark every to-do checked, in a single transaction. */
    checkAll() { this.#setAll(true); }
    /** Mark every to-do unchecked, in a single transaction. */
    uncheckAll() { this.#setAll(false); }

    /** @param {boolean} value */
    #setAll(value) {
        let changed = false;
        for (const item of this.all) {
            if (item.checked === value) continue;
            item.checked = value;
            /** @type {any} */ (item.node.data).set('checked', value);
            changed = true;
        }
        if (changed) this.#nabu.commit();
    }

    /** Move the cursor to a to-do item. @param {ListItem} item */
    goTo(item) { this.#nabu.selection.setCursor(item, 0); }
}
