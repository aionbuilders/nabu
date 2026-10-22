/**
 * Region marker schema normalizer (ADR 016 §3.1: a marker lives at the ROOT only).
 *
 * Runs from the Regions extension's `onBeforeTransaction` hook, i.e. BEFORE `doc.commit()`: the move belongs
 * to the transaction (hence the undo step) of the operation that put the marker in a container (a paste, a
 * drop, a retype, a move). Works on Loro tree nodes and MOVES, never delete + recreate: the block id (and the
 * caret) survive. Same mechanism as the list normalizer (`../list/normalize.js`); knows no other block type.
 *
 * Rule R1 — a marker that is not at the root is moved to the root, RIGHT AFTER the top-level container that
 * holds it. Several markers of the same container keep their order (each one goes after the previous one).
 *
 * The target is isolated in `hoistTarget`, so that the rule is one line to change when the product owner decides
 * the open question 3 of ADR 016 (a marker pasted into a toggle: after the toggle, as now, or converted into a
 * plain title).
 *
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

/** Block type of a marker. */
const MARKER_TYPE = 'region';

/** @param {NabuNode} node @returns {string | undefined} */
const typeOf = (node) => /** @type {any} */ (node.data.get("type"));

/** @param {NabuNode} node */
const isAlive = (node) => {
    try { return !node.isDeleted(); } catch { return false; }
};

/**
 * Inspects the pending (uncommitted) transaction. Returns null when it does not change the structure (no tree create /
 * move / delete, no block `type` change): no marker can have been displaced. Otherwise returns the ids of the nodes this
 * transaction RETYPED into a marker (their Block instance does not exist yet: it is created when the transaction commits).
 * @param {Nabu} nabu
 * @returns {{ retyped: Set<string> } | null}
 */
function inspectPendingOps(nabu) {
    const pending = nabu.doc.getUncommittedOpsAsJson();
    if (!pending) return null;
    const treeId = nabu.tree.id;
    let structural = false;
    /** @type {Set<string>} */
    const retyped = new Set();
    for (const change of pending.changes) {
        for (const op of change.ops) {
            const content = /** @type {any} */ (op.content);
            if (op.container === treeId) {
                if (content.type === "create" || content.type === "move" || content.type === "delete") structural = true;
            } else if (content.type === "insert" && content.key === "type" && op.container.endsWith(":Map")) {
                structural = true;
                if (content.value === MARKER_TYPE) retyped.add(op.container.slice(4, -4));
            }
        }
    }
    return structural ? { retyped } : null;
}

/** The top-level node holding `node` (the node itself when it is at the root). @param {NabuNode} node @returns {NabuNode} */
function rootOf(node) {
    let current = node;
    for (let parent = current.parent(); parent; parent = current.parent()) current = /** @type {NabuNode} */ (parent);
    return current;
}

/** Index path from the root, to compare two nodes in document order. @param {NabuNode} node @returns {number[]} */
function treePath(node) {
    /** @type {number[]} */
    const path = [];
    for (let current = node; current; ) {
        path.unshift(current.index() ?? 0);
        current = /** @type {NabuNode} */ (current.parent());
    }
    return path;
}

/** @param {number[]} a @param {number[]} b */
function comparePaths(a, b) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
}

/**
 * Where a misplaced marker goes: the node it is moved right after. THE place to change for ADR 016's open question 3.
 * @param {NabuNode} marker  the misplaced marker
 * @param {NabuNode} topLevel  the top-level container holding it
 * @param {NabuNode | undefined} lastPlaced  the marker of the same container hoisted just before, if any
 * @returns {NabuNode}
 */
function hoistTarget(marker, topLevel, lastPlaced) {
    return lastPlaced ?? topLevel;
}

/**
 * Brings the markers back to the root. Cheap when the document holds no marker or when nothing structural is pending.
 * @param {Nabu} nabu
 */
export function normalizeRegions(nabu) {
    const markers = nabu.blocksByType.get(MARKER_TYPE);
    const pending = inspectPendingOps(nabu);
    if (!pending) return;

    /** @type {Map<string, NabuNode>} */
    const candidates = new Map();
    for (const block of markers ?? []) {
        const node = /** @type {NabuNode | undefined} */ (block.node);
        if (node) candidates.set(node.id.toString(), node);
    }
    for (const id of pending.retyped) {
        if (candidates.has(id) || !nabu.tree.has(/** @type {any} */ (id))) continue;
        candidates.set(id, /** @type {NabuNode} */ (/** @type {unknown} */ (nabu.tree.getNodeByID(/** @type {any} */ (id)))));
    }

    /** @type {NabuNode[]} */
    const misplaced = [];
    for (const node of candidates.values()) {
        if (!node || !isAlive(node) || typeOf(node) !== MARKER_TYPE) continue;
        if (node.parent()) misplaced.push(node);
    }
    if (!misplaced.length) return;

    // document order, so that the markers of one container come out in the same order
    const paths = new Map(misplaced.map((node) => [node, treePath(node)]));
    misplaced.sort((a, b) => comparePaths(/** @type {number[]} */ (paths.get(a)), /** @type {number[]} */ (paths.get(b))));

    /** @type {Map<string, NabuNode>} */
    const lastPlaced = new Map();
    for (const node of misplaced) {
        const topLevel = rootOf(node);
        const key = topLevel.id.toString();
        const target = hoistTarget(node, topLevel, lastPlaced.get(key));
        node.moveAfter(target);
        lastPlaced.set(key, node);
    }
}
