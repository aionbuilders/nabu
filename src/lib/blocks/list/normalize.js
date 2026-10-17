/**
 * List schema normalizer.
 *
 * Runs from the List extension's `onBeforeTransaction` hook, i.e. BEFORE `doc.commit()`: every
 * mutation made here belongs to the transaction (hence the undo step) of the operation that broke the
 * structure. Everything works on Loro tree nodes (the source of truth) and uses MOVES, never
 * delete+recreate, so block ids (and the caret) survive.
 *
 * Invariants, enforced to a fixpoint:
 *  - R1  a `list` without children is deleted (unless created by the very same transaction).
 *  - R2a a `list` directly inside a `list` is unwrapped: its children go into the parent, in place.
 *  - R2b a child of a `list` that is neither a `list-item` nor a `list` is hoisted out: the list is split
 *        around it (items before stay, the block goes right after, items after go into a new list of the
 *        same `listType`, without `start`, after the block).
 *  - R3a a `list-item` with several sublists: the extra ones are merged into the first, in order.
 *  - R3b a `list-item` with a non-list child: that child (and what follows it, to keep the document
 *        order) is hoisted right after the item, in its parent. R2a / R2b then finish the job.
 *  - R4  adjacent lists of the same `listType` merge into the first one (which keeps its `start`).
 *
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

import { List } from "./list.svelte.js";

/** Safety net against a rule set that would not converge. */
const MAX_PASSES = 50;

/** @param {NabuNode} node @returns {string | undefined} */
const typeOf = (node) => /** @type {any} */ (node.data.get("type"));

/** @param {NabuNode} node @returns {string} */
const listTypeOf = (node) => /** @type {any} */ (node.data).get("listType") || "bullet";

/** @param {NabuNode} node @returns {NabuNode[]} */
const kids = (node) => /** @type {NabuNode[]} */ (node.children() ?? []);

/** @param {NabuNode} node */
const isAlive = (node) => {
    try { return !node.isDeleted(); } catch { return false; }
};

/**
 * Inspects the pending (uncommitted) transaction. Returns null when it does not change the document
 * structure (no tree create / move / delete, no block `type` change): no list invariant can have been
 * broken, nothing to do. Otherwise returns the ids of the nodes created by the transaction.
 * @param {Nabu} nabu
 * @returns {{ created: Set<string> } | null}
 */
function inspectPendingOps(nabu) {
    const pending = nabu.doc.getUncommittedOpsAsJson();
    if (!pending) return null;
    const treeId = nabu.tree.id;
    let structural = false;
    /** @type {Set<string>} */
    const created = new Set();
    for (const change of pending.changes) {
        for (const op of change.ops) {
            const content = /** @type {any} */ (op.content);
            if (op.container === treeId) {
                if (content.type === "create") { structural = true; created.add(String(content.target)); }
                else if (content.type === "move" || content.type === "delete") structural = true;
            } else if (content.type === "insert" && content.key === "type" && op.container.endsWith(":Map")) {
                structural = true;
            }
        }
    }
    return structural ? { created } : null;
}

/**
 * Live (not deleted, still of that type) nodes of the blocks of a given type.
 * @param {Nabu} nabu
 * @param {string} type
 * @returns {NabuNode[]}
 */
function collect(nabu, type) {
    const blocks = nabu.blocksByType.get(type);
    if (!blocks?.size) return [];
    /** @type {Map<string, NabuNode>} */
    const nodes = new Map();
    for (const block of blocks) {
        const node = /** @type {NabuNode | undefined} */ (block.node);
        if (!node || !isAlive(node) || typeOf(node) !== type) continue;
        nodes.set(node.id.toString(), node);
    }
    return [...nodes.values()];
}

/** Appends `node` at the end of `parent`'s children. @param {NabuNode} node @param {NabuNode} parent */
function append(node, parent) {
    node.move(parent, kids(parent).length);
}

/** Moves every child of `from` to the end of `to`, in order. @param {NabuNode} from @param {NabuNode} to */
function moveAll(from, to) {
    for (const child of kids(from)) append(child, to);
}

/**
 * @param {Nabu} nabu
 * @param {NabuNode} node
 */
function remove(nabu, node) {
    nabu.tree.delete(node.id);
}

/**
 * Applies the first rule that matches this list. Returns whether something changed.
 * @param {Nabu} nabu
 * @param {NabuNode} list
 * @param {Set<string>} underConstruction  ids of the lists to leave alone while empty
 * @returns {boolean}
 */
function fixList(nabu, list, underConstruction) {
    if (!isAlive(list) || typeOf(list) !== "list") return false;
    const children = kids(list);

    // R1 — empty list. A list created by THIS transaction is still under construction (the
    // `nabu.insert("list")` + `nabu.insert("list-item", ..., list.id)` pattern commits in between): only a
    // list that this transaction EMPTIED (moved / deleted its last child) is removed.
    if (!children.length) {
        if (underConstruction.has(list.id.toString())) return false;
        remove(nabu, list);
        return true;
    }

    // R2a — list directly inside a list: unwrap in place
    const nested = children.find((child) => typeOf(child) === "list");
    if (nested) {
        for (const grandChild of kids(nested)) grandChild.moveBefore(nested);
        remove(nabu, nested);
        return true;
    }

    // R2b — foreign block inside a list: split the list around it
    const foreignIndex = children.findIndex((child) => typeOf(child) !== "list-item");
    if (foreignIndex !== -1) {
        const foreign = children[foreignIndex];
        const followers = children.slice(foreignIndex + 1);
        foreign.moveAfter(list);
        if (followers.length) {
            const parentId = list.parent()?.id.toString() ?? null;
            const listType = listTypeOf(list);
            const tail = List.create(nabu, "list", { listType }, parentId).node;
            tail.moveAfter(foreign);
            for (const follower of followers) append(follower, tail);
        }
        return true;
    }

    // R4 — adjacent lists of the same type merge into the first one
    const parent = list.parent();
    const siblings = parent ? kids(parent) : /** @type {NabuNode[]} */ (nabu.tree.roots());
    const index = list.index();
    if (index != null && index > 0) {
        const previous = siblings[index - 1];
        if (
            previous && typeOf(previous) === "list" &&
            listTypeOf(previous) === listTypeOf(list)
        ) {
            moveAll(list, previous);
            remove(nabu, list);
            return true;
        }
    }

    return false;
}

/**
 * Applies the first rule that matches this list item. Returns whether something changed.
 * @param {Nabu} nabu
 * @param {NabuNode} item
 * @returns {boolean}
 */
function fixItem(nabu, item) {
    if (!isAlive(item) || typeOf(item) !== "list-item") return false;
    const children = kids(item);

    // R3b — non-list child: hoist it, and what follows it, right after the item (document order kept)
    const foreignIndex = children.findIndex((child) => typeOf(child) !== "list");
    if (foreignIndex !== -1) {
        /** @type {NabuNode} */
        let anchor = item;
        for (const child of children.slice(foreignIndex)) {
            child.moveAfter(anchor);
            anchor = child;
        }
        return true;
    }

    // R3a — several sublists: merge the extra ones into the first
    if (children.length > 1) {
        const [first, ...extras] = children;
        for (const extra of extras) {
            moveAll(extra, first);
            remove(nabu, extra);
        }
        return true;
    }

    return false;
}

/**
 * One scan over every list and list item. Returns whether anything changed.
 * @param {Nabu} nabu
 * @param {Set<string>} underConstruction
 */
function pass(nabu, underConstruction) {
    let changed = false;
    for (const list of collect(nabu, "list")) if (fixList(nabu, list, underConstruction)) changed = true;
    for (const item of collect(nabu, "list-item")) if (fixItem(nabu, item)) changed = true;
    return changed;
}

/**
 * Brings the list structure back to its invariants (see the file header). Cheap when nothing
 * structural is pending or when the document holds no list.
 * @param {Nabu} nabu
 */
export function normalizeLists(nabu) {
    if (!nabu.blocksByType.get("list")?.size && !nabu.blocksByType.get("list-item")?.size) return;
    const pending = inspectPendingOps(nabu);
    if (!pending) return;
    // Lists this transaction created and that are still empty: under construction, not "emptied".
    /** @type {Set<string>} */
    const underConstruction = new Set();
    for (const list of collect(nabu, "list")) {
        const id = list.id.toString();
        if (pending.created.has(id) && !kids(list).length) underConstruction.add(id);
    }
    for (let i = 0; i < MAX_PASSES; i++) {
        if (!pass(nabu, underConstruction)) return;
    }
    nabu.warn(`List normalizer did not converge after ${MAX_PASSES} passes; the list structure may be invalid.`);
}
