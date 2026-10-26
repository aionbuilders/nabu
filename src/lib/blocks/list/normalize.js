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
 *  - R3a (P-28) a `list-item` may hold SEVERAL sublists, of different types, in order: nothing to do here,
 *        only R4 applies to them (adjacent sublists of the same type merge, as at the root).
 *  - R3b a `list-item` with a non-list child: that child (and what follows it, to keep the document
 *        order) is hoisted right after the item, in its parent. R2a / R2b then finish the job.
 *  - R4  adjacent lists of the same `listType` merge into the first one (which keeps its `start`), whatever
 *        their parent (the root, a container, a list item).
 *
 * SCOPE (P-106). The document was valid before the transaction, so only what the transaction touched can be invalid: the nodes it
 * created / moved / retyped, the parents they now sit in, the parent they LEFT and the list neighbours of the seam they left. Those
 * are the only lists and items visited (see `scopeOf`); the passes repeat on the scope of the CUMULATIVE ops, the normalizer's own
 * included, until nothing changes. When the scope cannot be derived (a node leaves a position the block tree does not know) the whole
 * document is scanned, as before. Sibling arrays are cached between two changes (`siblingsOf`): a root-level list no longer costs a
 * `tree.roots()` each.
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
 * structure (no tree create / move / delete, no block `type` or list `listType` change): no list invariant can have been
 * broken, nothing to do. Otherwise returns what the transaction touched, by node id.
 * @param {Nabu} nabu
 * @returns {{ created: Set<string>, placed: Set<string>, left: Set<string>, changed: Set<string>, parents: Set<string> } | null}
 *   `created` the nodes created; `placed` created or moved (they got a new position); `left` moved or deleted (they left one);
 *   `changed` whose `type` / `listType` was set; `parents` every parent a create / move named.
 */
function inspectPendingOps(nabu) {
    const pending = nabu.doc.getUncommittedOpsAsJson();
    if (!pending) return null;
    const treeId = nabu.tree.id;
    let structural = false;
    /** @type {Set<string>} */
    const created = new Set();
    /** @type {Set<string>} */
    const placed = new Set();
    /** @type {Set<string>} */
    const left = new Set();
    /** @type {Set<string>} */
    const changed = new Set();
    /** @type {Set<string>} */
    const parents = new Set();
    for (const change of pending.changes) {
        for (const op of change.ops) {
            const content = /** @type {any} */ (op.content);
            if (op.container === treeId) {
                const target = String(content.target);
                if (content.type === "create") { structural = true; created.add(target); placed.add(target); }
                else if (content.type === "move") { structural = true; placed.add(target); left.add(target); }
                else if (content.type === "delete") { structural = true; left.add(target); }
                if ((content.type === "create" || content.type === "move") && content.parent) parents.add(String(content.parent));
            } else if (content.type === "insert" && (content.key === "type" || content.key === "listType") && op.container.endsWith(":Map")) {
                structural = true;
                changed.add(op.container.slice(4, -4));
            }
        }
    }
    return structural ? { created, placed, left, changed, parents } : null;
}

/** @param {Nabu} nabu @param {string} id @returns {NabuNode | null} the live node, or null */
function liveNode(nabu, id) {
    try {
        if (!nabu.tree.has(/** @type {any} */ (id))) return null;
        const node = /** @type {NabuNode | undefined} */ (nabu.tree.getNodeByID(/** @type {any} */ (id)));
        return node && isAlive(node) ? node : null;
    } catch { return null; }
}

/**
 * Sibling arrays (the root's included), cached until the next change of the tree.
 * @param {Nabu} nabu
 */
function siblingsCache(nabu) {
    /** @type {Map<string, NabuNode[]>} */
    const cache = new Map();
    return {
        /** The children of `node`'s parent (the roots when it has none), `node` included. @param {NabuNode} node @returns {NabuNode[]} */
        of(node) {
            const parent = node.parent();
            const key = parent ? parent.id.toString() : "";
            let siblings = cache.get(key);
            if (!siblings) {
                siblings = parent ? kids(parent) : /** @type {NabuNode[]} */ (nabu.tree.roots());
                cache.set(key, siblings);
            }
            return siblings;
        },
        clear() { cache.clear(); },
    };
}

/**
 * Per editor, the ids of the lists a transaction left EMPTY on purpose (created by it: still under construction). The next
 * structural transaction deletes them if they are still empty then, as a scan of the whole document would: they are part of its scope.
 * @type {WeakMap<Nabu, Set<string>>}
 */
const emptyLists = new WeakMap();

/**
 * The lists and list items one pass has to visit, derived from what the pending ops touched; null = "unknown, scan everything".
 * @param {Nabu} nabu
 * @param {NonNullable<ReturnType<typeof inspectPendingOps>>} pending
 * @param {ReturnType<typeof siblingsCache>} siblings
 * @returns {{ lists: NabuNode[], items: NabuNode[] } | null}
 */
function scopeOf(nabu, pending, siblings) {
    const waiting = emptyLists.get(nabu);
    /** @type {Map<string, NabuNode>} */
    const lists = new Map();
    /** @type {Map<string, NabuNode>} */
    const items = new Map();
    /** @type {Map<string, NabuNode>} */
    const seams = new Map();
    /** @param {NabuNode | null | undefined} node @param {boolean} [seam]  also a seam: its list neighbours may have to merge */
    const add = (node, seam = false) => {
        if (!node || !isAlive(node)) return;
        const type = typeOf(node);
        const id = node.id.toString();
        if (type === "list") { lists.set(id, node); if (seam) seams.set(id, node); }
        else if (type === "list-item") items.set(id, node);
    };

    // Created / moved nodes, retyped ones: themselves (their content), their parent (its content), their seam.
    for (const id of new Set([...pending.placed, ...pending.changed])) {
        const node = liveNode(nabu, id);
        if (!node) continue;
        add(node, true);
        add(node.parent());
    }
    for (const id of pending.parents) add(liveNode(nabu, id));
    // Lists left empty by an earlier transaction (see `emptyLists`): this one may delete them.
    if (waiting) for (const id of waiting) add(liveNode(nabu, id));

    // Nodes that LEFT a position: the parent they left (it may be empty now) and the lists that were the neighbours of what left
    // (they may be adjacent now). The op does not say where they were: the block tree, which still holds the state before the
    // transaction, does. Grouped by container into runs of consecutive positions: a mass deletion reads two neighbours, not 2 N.
    /** @type {Map<any, number[]>} */
    const gone = new Map();
    for (const id of pending.left) {
        if (pending.created.has(id)) continue; // never was anywhere else: the ops name every parent it went through
        const block = /** @type {any} */ (nabu.blocks.get(id));
        if (!block) return null;
        const container = block.parent ?? nabu;
        const positions = gone.get(container);
        if (positions) positions.push(block.index);
        else { gone.set(container, [block.index]); add(block.parent?.node); }
    }
    for (const [container, positions] of gone) {
        const row = container.children;
        positions.sort((a, b) => a - b);
        for (let i = 0; i < positions.length; ) {
            let end = i;
            while (end + 1 < positions.length && positions[end + 1] === positions[end] + 1) end++;
            const first = positions[i], last = positions[end];
            if (!row[first] || row[first].index !== first) return null; // the block tree is not what the indexes say: scan everything
            for (const neighbour of [row[first - 1], row[last + 1]]) {
                if (neighbour?.type === "list") add(neighbour.node, true);
            }
            i = end + 1;
        }
    }

    // A seam: the list after it may now be adjacent to a list of its own type (its previous sibling is tested by fixList).
    for (const list of seams.values()) {
        const index = list.index();
        if (index == null) continue;
        const next = siblings.of(list)[index + 1];
        if (next) add(next);
    }
    return { lists: [...lists.values()], items: [...items.values()] };
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
 * @param {(node: NabuNode) => NabuNode[]} siblingsOf
 * @returns {boolean}
 */
function fixList(nabu, list, underConstruction, siblingsOf) {
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
    const index = list.index();
    if (index != null && index > 0) {
        const previous = siblingsOf(list)[index - 1];
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

    return false;
}

/** Every live list and list item of the tree (no use of the block registry). @param {Nabu} nabu @returns {{ lists: NabuNode[], items: NabuNode[] }} */
function treeScope(nabu) {
    const nodes = /** @type {NabuNode[]} */ (nabu.tree.nodes()).filter(isAlive);
    return { lists: nodes.filter((node) => typeOf(node) === "list"), items: nodes.filter((node) => typeOf(node) === "list-item") };
}

/**
 * One scan over the given lists and list items (every one of the document when `scope` is null). Returns whether anything changed.
 * @param {Nabu} nabu
 * @param {Set<string>} underConstruction
 * @param {{ lists: NabuNode[], items: NabuNode[] } | null} scope
 * @param {ReturnType<typeof siblingsCache>} siblings
 */
function pass(nabu, underConstruction, scope, siblings) {
    let changed = false;
    const siblingsOf = (/** @type {NabuNode} */ node) => siblings.of(node);
    for (const list of scope ? scope.lists : collect(nabu, "list")) {
        if (fixList(nabu, list, underConstruction, siblingsOf)) { changed = true; siblings.clear(); }
    }
    for (const item of scope ? scope.items : collect(nabu, "list-item")) {
        if (fixItem(nabu, item)) { changed = true; siblings.clear(); }
    }
    return changed;
}

/** Keeps the lists that are still empty (and alive) among those this transaction left alone. @param {Nabu} nabu @param {Set<string>} ids */
function rememberEmpty(nabu, ids) {
    /** @type {Set<string>} */
    const still = new Set();
    for (const id of ids) {
        const list = liveNode(nabu, id);
        if (list && typeOf(list) === "list" && !kids(list).length) still.add(id);
    }
    if (still.size) emptyLists.set(nabu, still);
    else emptyLists.delete(nabu);
}

/**
 * Brings the list structure back to its invariants (see the file header). Cheap when nothing
 * structural is pending or when the document holds no list.
 * @param {Nabu} nabu
 * @param {{ full?: boolean }} [options]  `full`: scan every list of the document instead of the scope of the pending ops
 *   found from the tree itself (the reference the scoped one is tested against: no dependence on the block registry)
 */
export function normalizeLists(nabu, options) {
    if (!nabu.blocksByType.get("list")?.size && !nabu.blocksByType.get("list-item")?.size) return;
    const first = inspectPendingOps(nabu);
    if (!first) return;
    // Lists this transaction created and that are still empty: under construction, not "emptied".
    /** @type {Set<string>} */
    const underConstruction = new Set();
    for (const id of first.created) {
        const list = liveNode(nabu, id);
        if (list && typeOf(list) === "list" && !kids(list).length) underConstruction.add(id);
    }
    const siblings = siblingsCache(nabu);
    let pending = first;
    for (let i = 0; i < MAX_PASSES; i++) {
        if (!pass(nabu, underConstruction, options?.full ? treeScope(nabu) : scopeOf(nabu, pending, siblings), siblings)) {
            rememberEmpty(nabu, underConstruction);
            return;
        }
        // The normalizer's own ops are part of the transaction now: the next pass starts from everything touched so far.
        pending = inspectPendingOps(nabu) ?? pending;
    }
    nabu.warn(`List normalizer did not converge after ${MAX_PASSES} passes; the list structure may be invalid.`);
}
