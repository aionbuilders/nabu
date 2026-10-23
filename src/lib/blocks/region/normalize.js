/**
 * Region schema normalizer (ADR 018 §3.1, §3.2: where a region may live, and how regions nest).
 *
 * Runs from the Regions extension's `onBeforeTransaction` hook, i.e. BEFORE `doc.commit()`: the move belongs
 * to the transaction (hence the undo step) of the operation that displaced the region (a paste, a drop, a retype, a
 * move). Works on Loro tree nodes and MOVES, never delete + recreate: the block id (and the caret) survive, and the
 * region takes its title and its whole body along. Same mechanism as the list normalizer (`../list/normalize.js`);
 * knows no other block type.
 *
 * Rule R1 (placement) — a region lives at the root or directly in the body of another region. A region whose parent
 * is neither is moved RIGHT AFTER its highest ancestor that is still below the nearest region ancestor (or below the
 * root): a region pasted in a list inside chapter C goes right after that list, inside C.
 *
 * Rule R2 (nesting) — a sub-region has a level strictly deeper than its parent region. A DECLARED region whose nearest
 * region parent is declared and has a level >= its own is moved right after that parent; repeated until it is valid
 * (it may climb several levels, up to the root). A region whose type is not declared is valid anywhere under a region
 * and does not constrain its own children.
 *
 * Several regions displaced from one container keep their order (each one goes after the previous one). The target of
 * R1 is isolated in `hoistTarget`, so that the rule is one line to change.
 *
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

/** Block type of a region. */
const REGION_TYPE = 'region';

/** @param {NabuNode} node @returns {string | undefined} */
const typeOf = (node) => /** @type {any} */ (node.data.get("type"));

/** @param {NabuNode} node */
const isAlive = (node) => {
    try { return !node.isDeleted(); } catch { return false; }
};

/** @param {NabuNode | null | undefined} node @returns {node is NabuNode} */
const isRegion = (node) => !!node && typeOf(node) === REGION_TYPE;

/**
 * Inspects the pending (uncommitted) transaction. Returns null when it does not change the structure (no tree create /
 * move / delete, no block `type` or `regionType` change): no region can have been displaced. Otherwise returns the ids of
 * the nodes this transaction RETYPED into a region (their Block instance does not exist yet: it is created when the
 * transaction commits).
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
            } else if (content.type === "insert" && (content.key === "type" || content.key === "regionType") && op.container.endsWith(":Map")) {
                structural = true;
                if (content.key === "type" && content.value === REGION_TYPE) retyped.add(op.container.slice(4, -4));
            }
        }
    }
    return structural ? { retyped } : null;
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
 * Where a misplaced region goes: the node it is moved right after. THE place to change the placement rule.
 * @param {NabuNode} region  the misplaced region
 * @param {NabuNode} anchor  the highest ancestor of the region that is a child of its nearest region ancestor (or of the root)
 * @param {NabuNode | undefined} lastPlaced  the region of the same container hoisted just before, if any
 * @returns {NabuNode}
 */
function hoistTarget(region, anchor, lastPlaced) {
    return lastPlaced ?? anchor;
}

/**
 * The declared level of a region node, or undefined when its type is not declared.
 * @param {import('./types.js').RegionsConfig} config @param {NabuNode} node @returns {number | undefined}
 */
function levelOf(config, node) {
    return config.types.get(/** @type {any} */ (/** @type {any} */ (node.data).get('regionType')))?.level;
}

/**
 * Brings the regions back to where they may live (R1), then nests them by level (R2). Cheap when the document holds no
 * region or when nothing structural is pending.
 * @param {Nabu} nabu
 */
export function normalizeRegions(nabu) {
    const config = /** @type {import('./types.js').RegionsConfig | undefined} */ (/** @type {any} */ (nabu.registry.get(REGION_TYPE))?.config);
    if (!config) return;
    const known = nabu.blocksByType.get(REGION_TYPE);
    const pending = inspectPendingOps(nabu);
    if (!pending) return;

    /** @type {Map<string, NabuNode>} */
    const candidates = new Map();
    for (const block of known ?? []) {
        const node = /** @type {NabuNode | undefined} */ (block.node);
        if (node) candidates.set(node.id.toString(), node);
    }
    for (const id of pending.retyped) {
        if (candidates.has(id) || !nabu.tree.has(/** @type {any} */ (id))) continue;
        candidates.set(id, /** @type {NabuNode} */ (/** @type {unknown} */ (nabu.tree.getNodeByID(/** @type {any} */ (id)))));
    }
    if (!candidates.size) return;

    /** Alive region nodes in document order, read from the CURRENT state of the tree. @returns {NabuNode[]} */
    const regionNodes = () => {
        const nodes = [...candidates.values()].filter((node) => node && isAlive(node) && isRegion(node));
        const paths = new Map(nodes.map((node) => [node, treePath(node)]));
        return nodes.sort((a, b) => comparePaths(/** @type {number[]} */ (paths.get(a)), /** @type {number[]} */ (paths.get(b))));
    };

    // ── R1: a region is at the root or in a region body ──
    /** @type {{ node: NabuNode, anchor: NabuNode }[]} */
    const misplaced = [];
    for (const node of regionNodes()) {
        const parent = node.parent();
        if (!parent || isRegion(parent)) continue;
        /** @type {NabuNode} */
        let anchor = parent;
        for (let up = anchor.parent(); up && !isRegion(up); up = anchor.parent()) anchor = up;
        misplaced.push({ node, anchor });
    }
    /** @type {Map<string, NabuNode>} */
    const lastPlaced = new Map();
    for (const { node, anchor } of misplaced) {
        const key = anchor.id.toString();
        node.moveAfter(hoistTarget(node, anchor, lastPlaced.get(key)));
        lastPlaced.set(key, node);
    }

    // ── R2: a sub-region is strictly deeper than its parent region ──
    /** @type {Map<string, NabuNode>} */
    const placedAfter = new Map();
    for (const node of regionNodes()) {
        const level = levelOf(config, node);
        if (level === undefined) continue; // an undeclared type is valid anywhere under a region
        for (;;) {
            const parent = node.parent();
            if (!parent || !isRegion(parent)) break;
            const parentLevel = levelOf(config, parent);
            if (parentLevel === undefined || parentLevel < level) break; // valid
            const key = parent.id.toString();
            node.moveAfter(placedAfter.get(key) ?? parent);
            placedAfter.set(key, node);
        }
    }
}
