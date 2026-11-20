/**
 * Stable block ids (ADR 019): the rules and constants of `node.data.uid`, in one place.
 *
 * A block id is its Loro `TreeID`, which a delete then undo changes. With the `stableIds` option every block node also carries a
 * `uid` in its data map, which Loro brings back with the node, so it survives undo. The value is `'u:' + TreeID` of the node when
 * it is stamped: unique, free, and DETERMINISTIC (two peers that stamp the same node write the same value, so their copies
 * converge; random ids would not).
 *
 * How nodes get their uid, and why this way:
 * - **New local nodes** are stamped by {@link stampOnCreate}, which wraps `tree.createNode` of the engine's own tree. Every block
 *   class (the built-ins, a custom one from `/extend`, a media factory) creates its node through `nabu.tree.createNode`, so one
 *   wrapper covers them all, runs inside the creating transaction (undo and redo of the creation carry the uid) and costs one
 *   map write per created node. Nothing scans the document: a keystroke commits text ops only and never reaches it.
 * - **Nodes that arrive from elsewhere** (remote import, a snapshot, an undo that recreates a node) come with their data. The
 *   engine hands the ids that the tree events list to {@link healUids}, which stamps those without a uid (a peer without the
 *   option) and renames duplicates. Cost is proportional to the change, not to the document.
 * - **On open** a full pass ({@link stampBlockUids}) runs once.
 *
 * Duplicates (two peers that both deleted and undid the same block, a copy made by an old build): the node with the smallest
 * TreeID ({@link compareTreeIds}) keeps the uid, every other one takes `uidFor(its own id)`. Same rule on every peer, same writes.
 *
 * - **Transfers** ("the uid follows the first character", ADR 019 §4): a few gestures move a uid from one node to another, see
 *   {@link swapUidsOnSplit}, {@link uidOfEmptySurvivor} + {@link giveUid}, {@link carryUid} + {@link giveUid}. They write inside the
 *   gesture's own transaction (undo and redo restore the uids exactly) and never leave two live nodes with one uid when the
 *   transaction ends. The healer only looks at the document after a commit, so an instant of overlap inside a transaction is
 *   never seen; the helpers still avoid it where they can (read first, write after the victim is gone).
 *
 * Every write made here (stamping, healing) uses {@link UIDS_ORIGIN}, which the undo manager ignores (`nabu:silent` prefix).
 */

/** Prefix of every uid, so a uid is never mistaken for a block id (`'u:12@345'` against `'12@345'`). */
export const UID_PREFIX = 'u:';
/** Origin of the commits that stamp and heal uids: silent, so never an undo step. */
export const UIDS_ORIGIN = 'nabu:silent:uids';

/**
 * The uid a node is stamped with.
 * @param {string} treeId a Loro TreeID (`'counter@peer'`)
 * @returns {string}
 */
export function uidFor(treeId) {
    return UID_PREFIX + treeId;
}

/**
 * Total, deterministic order of two TreeIDs: the peer as an unsigned 64-bit integer, then the counter.
 * @param {string} a @param {string} b
 * @returns {number} negative when `a` is smaller
 */
export function compareTreeIds(a, b) {
    const [counterA, peerA] = a.split('@');
    const [counterB, peerB] = b.split('@');
    const pa = BigInt(peerA), pb = BigInt(peerB);
    if (pa !== pb) return pa < pb ? -1 : 1;
    return Number(counterA) - Number(counterB);
}

/**
 * The uid of a node, `undefined` when it has none (or something that is not a string).
 * @param {{ data: { get: (key: string) => any } }} node
 * @returns {string | undefined}
 */
export function readUid(node) {
    const uid = node.data.get('uid');
    return typeof uid === 'string' && uid ? uid : undefined;
}

/**
 * The live node of a TreeID, or `undefined` (unknown or deleted).
 * @param {import('loro-crdt').LoroTree<any>} tree @param {string} id
 */
function liveNode(tree, id) {
    const node = tree.has(/** @type {any} */ (id)) ? tree.getNodeByID(/** @type {any} */ (id)) : undefined;
    return node && !node.isDeleted() ? node : undefined;
}

/** @param {Map<string, string[]>} map @param {string} uid @param {string} id */
function pushTo(map, uid, id) {
    const ids = map.get(uid);
    if (ids) ids.push(id); else map.set(uid, [id]);
}

/**
 * Of the ids that claim one uid, those that must take a new one: all but the smallest TreeID.
 * @param {string[]} ids
 * @returns {string[]}
 */
export function duplicateLosers(ids) {
    if (ids.length < 2) return [];
    return [...ids].sort(compareTreeIds).slice(1);
}

/**
 * Which TreeIDs hold which uid, for an editor with the option on. Entries may be stale (a deleted node, a renamed one): readers
 * check them against the tree, see {@link UidIndex#live}.
 */
export class UidIndex {
    /** @type {Map<string, Set<string>>} */
    #byUid = new Map();

    /** @param {string} uid @param {string} id */
    add(uid, id) {
        let ids = this.#byUid.get(uid);
        if (!ids) this.#byUid.set(uid, ids = new Set());
        ids.add(id);
    }

    /** @param {string} uid @param {string} id */
    remove(uid, id) {
        const ids = this.#byUid.get(uid);
        if (!ids) return;
        ids.delete(id);
        if (!ids.size) this.#byUid.delete(uid);
    }

    /**
     * The ids that really hold `uid` now (stale entries are dropped on the way).
     * @param {string} uid
     * @param {import('loro-crdt').LoroTree<any>} tree
     * @returns {string[]}
     */
    live(uid, tree) {
        const ids = this.#byUid.get(uid);
        if (!ids) return [];
        const out = [];
        for (const id of [...ids]) {
            const node = tree.has(/** @type {any} */ (id)) ? tree.getNodeByID(/** @type {any} */ (id)) : undefined;
            if (node && !node.isDeleted() && readUid(node) === uid) out.push(id);
            else ids.delete(id);
        }
        if (!ids.size) this.#byUid.delete(uid);
        return out;
    }

    /**
     * Rebuild from every live node of a tree (on open).
     * @param {import('loro-crdt').LoroTree<any>} tree
     */
    seed(tree) {
        this.#byUid.clear();
        for (const node of tree.getNodes({ withDeleted: false })) {
            const uid = readUid(node);
            if (uid) this.add(uid, node.id.toString());
        }
    }
}

/**
 * Make every node created through `tree.createNode` carry its uid, in the same transaction. Replaces `createNode` on that tree
 * object only.
 * @param {import('loro-crdt').LoroTree<any>} tree
 * @param {UidIndex} index
 */
export function stampOnCreate(tree, index) {
    const create = tree.createNode.bind(tree);
    /** @type {any} */ (tree).createNode = (/** @type {any[]} */ ...args) => {
        const node = /** @type {any} */ (create)(...args);
        const id = node.id.toString();
        const uid = uidFor(id);
        node.data.set('uid', uid);
        index.add(uid, id);
        return node;
    };
}

/**
 * Stamp and heal the given nodes of a tree, until no uid is missing or shared. Writes only; the caller commits.
 * @param {import('loro-crdt').LoroTree<any>} tree
 * @param {Iterable<string>} start TreeIDs to look at first
 * @param {(uid: string) => string[]} holders the ids that hold a uid (live ones; may include nodes of `start`)
 * @param {(uid: string, id: string) => void} onWrite called after each write, to keep an index current
 * @returns {number} the nodes written
 */
function settle(tree, start, holders, onWrite) {
    let written = 0;
    const queue = [...start];
    let guard = 0;
    while (queue.length && guard++ < 1_000_000) {
        const id = /** @type {string} */ (queue.pop());
        const node = liveNode(tree, id);
        if (!node) continue;
        let uid = readUid(node);
        if (!uid) {
            uid = uidFor(id);
            node.data.set('uid', uid);
            onWrite(uid, id);
            written++;
        }
        const ids = holders(uid);
        if (!ids.includes(id)) ids.push(id);
        for (const loser of duplicateLosers(ids)) {
            const own = uidFor(loser);
            liveNode(tree, loser)?.data.set('uid', own);
            onWrite(own, loser);
            written++;
            queue.push(loser); // its new uid may itself be taken (a copy of it)
        }
    }
    return written;
}

/**
 * Stamp every live block node of a document that has no uid, and heal duplicates (the smallest TreeID keeps the uid). Works on a
 * bare `LoroDoc`: no editor needed, so an app can call it in its own migration. Deterministic (the values depend only on the
 * TreeIDs), so peers that run it separately converge. Commits with a silent origin (never an undo step), and only if it wrote
 * something: calling it again writes nothing.
 *
 * Caveat: it COMMITS the document. Operations of the caller that are still pending (written, not committed) would be committed
 * under the silent origin and so could not be undone. Call it on a document with nothing pending: in a migration, or before the
 * editor opens.
 * @param {import('loro-crdt').LoroDoc} doc
 * @returns {number} the number of nodes written
 * @public
 */
export function stampBlockUids(doc) {
    const tree = doc.getTree('blocks');
    /** @type {Map<string, string[]>} */
    const byUid = new Map();
    /** @type {string[]} */
    const all = [];
    for (const node of tree.getNodes({ withDeleted: false })) {
        const id = node.id.toString();
        all.push(id);
        const uid = readUid(node);
        if (uid) pushTo(byUid, uid, id);
    }
    const written = settle(
        tree,
        all,
        (uid) => (byUid.get(uid) ?? []).filter((id) => { const node = liveNode(tree, id); return !!node && readUid(node) === uid; }),
        (uid, id) => pushTo(byUid, uid, id),
    );
    if (written) doc.commit({ origin: UIDS_ORIGIN });
    return written;
}

/**
 * Stamp and heal the nodes that just arrived (from the tree events of an import, an undo...), against the index. Commits silently
 * if it wrote something.
 * @param {import('loro-crdt').LoroDoc} doc
 * @param {UidIndex} index
 * @param {Iterable<string>} ids
 * @returns {number} the nodes written
 */
export function healUids(doc, index, ids) {
    const tree = doc.getTree('blocks');
    const arrived = [...ids];
    for (const id of arrived) {
        const node = liveNode(tree, id);
        const uid = node ? readUid(node) : undefined;
        if (uid) index.add(uid, id);
    }
    const written = settle(
        tree,
        arrived,
        (uid) => index.live(uid, tree),
        (uid, id) => index.add(uid, id),
    );
    if (written) doc.commit({ origin: UIDS_ORIGIN });
    return written;
}

// ── Transfers (the uid follows the first character) ─────────────────────────

/**
 * Length of the text of a block (0 for a block without text).
 * @param {{ behaviors?: Map<string, any> }} block
 * @returns {number}
 */
function textLength(block) {
    // The Loro container, not the reactive `text`: that one lags until the commit, and a transfer runs before it.
    const length = block.behaviors?.get('text')?.container?.length;
    return typeof length === 'number' ? length : 0;
}

/**
 * Enter at the START of a non-empty block: the new block holds the whole text, so it takes the uid of the original, and the
 * original (now empty) takes the uid the new block had, a swap that keeps both unique and is deterministic (the new block's uid
 * is `uidFor` of its TreeID). Does nothing when the option is off or when the original still has text (an ordinary
 * split: the head keeps the uid). Call it right after the new block exists, in the same transaction.
 * @param {import('./nabu.svelte.js').Nabu} nabu
 * @param {import('./block.svelte.js').Block} original the block that was split (its tail is already deleted)
 * @param {import('./block.svelte.js').Block} created the block that received the tail
 */
export function swapUidsOnSplit(nabu, original, created) {
    if (!nabu.stableIds || original === created) return;
    if (textLength(original) > 0 || textLength(created) === 0) return;
    const kept = readUid(original.node);
    const fresh = readUid(created.node);
    if (!kept || !fresh) return;
    nabu.writeUid(original.node, fresh);
    nabu.writeUid(created.node, kept);
}

/**
 * Merge, step one: the uid the survivor must take, which is the victim's when the survivor is EMPTY (the text that remains is the
 * victim's), `undefined` otherwise (and when the option is off). Read it BEFORE the victim is destroyed, apply it with
 * {@link giveUid} AFTER, so two live nodes never hold one uid.
 * @param {import('./nabu.svelte.js').Nabu} nabu
 * @param {import('./block.svelte.js').Block} survivor
 * @param {import('./block.svelte.js').Block} victim
 * @returns {string | undefined}
 */
export function uidOfEmptySurvivor(nabu, survivor, victim) {
    // Both empty: no text decides, the survivor keeps its own.
    if (!nabu.stableIds || textLength(survivor) > 0 || textLength(victim) === 0) return undefined;
    return readUid(victim.node);
}

/**
 * A block that is about to be replaced by another one (a paragraph becoming a list item through a new list): the uid to carry.
 * @param {import('./nabu.svelte.js').Nabu} nabu
 * @param {import('./block.svelte.js').Block} block
 * @returns {string | undefined} `undefined` when the option is off
 */
export function carryUid(nabu, block) {
    return nabu.stableIds ? readUid(block.node) : undefined;
}

/**
 * Merge / replace, step two: write `uid` (from {@link uidOfEmptySurvivor} or {@link carryUid}) on `block`. No-op for `undefined`.
 * @param {import('./nabu.svelte.js').Nabu} nabu
 * @param {import('./block.svelte.js').Block} block
 * @param {string | undefined} uid
 */
export function giveUid(nabu, block, uid) {
    if (uid && nabu.stableIds) nabu.writeUid(block.node, uid);
}
