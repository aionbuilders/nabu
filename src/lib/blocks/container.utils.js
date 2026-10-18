/**
 * @import { Block } from './block.svelte.js';
 * @import { Nabu } from './nabu.svelte.js';
 */

/**
 * Walks up from `block` toward `container` and returns the direct child of
 * `container` that is (or contains) `block`.
 *
 * Works for both Nabu (root blocks have parent = null, loop breaks before
 * reaching Nabu) and MegaBlock (loop stops when parent === container).
 *
 * @param {Block} block
 * @param {Block | Nabu} container
 * @returns {Block | null}
 */
export function findDirectChildOf(block, container) {
    const spine = [block];
    while (spine.at(-1) && spine.at(-1) !== container) {
        const current = spine.at(-1);
        const parent = current?.parent;
        if (!current || !parent) break;
        spine.push(parent);
    }
    return spine.at(-1) === container ? spine.at(-2) ?? null : spine.at(-1) ?? null;
}

/**
 * Finds the Lowest Common Ancestor (LCA) of two blocks in the block tree.
 *
 * Returns the LCA block, or null if the two blocks only share Nabu as ancestor
 * (i.e. both ancestor chains terminate at a root block with parent = null).
 *
 * Examples:
 *   LCA(subA, subB)  where both are children of subList  →  subList
 *   LCA(para1, para2) where both are root-level blocks    →  null
 *
 * @param {Block} blockA
 * @param {Block} blockB
 * @returns {Block | null}
 */
export function findLCA(blockA, blockB) {
    if (blockA === blockB) return blockA.parent ?? null;

    // Build the ancestor set for blockA (blockA itself included)
    const ancestorsA = new Set();
    let curr = /** @type {Block | null} */ (blockA);
    while (curr) {
        ancestorsA.add(curr);
        curr = curr.parent ?? null;
    }

    // Walk from blockB up until we hit a node in blockA's ancestor set
    let currB = /** @type {Block | null} */ (blockB);
    while (currB) {
        if (ancestorsA.has(currB)) return currB;
        currB = currB.parent ?? null;
    }

    return null; // only Nabu is a common ancestor
}

/**
 * Ensures a block respects its structural parent constraint after being relocated.
 * If the block's current Loro parent doesn't match its `requiredParent` type,
 * creates a wrapper block at the same position WITHOUT committing.
 *
 * Returns the wrapper block if one was created, otherwise undefined.
 *
 * @param {Nabu} nabu
 * @param {Block} block
 * @returns {Block | undefined}
 */
export function wrapOrphan(nabu, block) {
    const req = block.requiredParent;
    if (!req) return;

    // Read the CURRENT Loro parent (not the stale Svelte $state)
    const currentLoroParent = block.node.parent();
    const currentParentType = currentLoroParent?.data?.get("type") ?? null;

    // Already in the correct parent context — nothing to do
    if (currentParentType === req.type) return;

    const WrapperClass = nabu.registry.get(req.type);
    if (!WrapperClass) {
        nabu.warn(`wrapOrphan: block type "${req.type}" is not registered`);
        return;
    }

    // Create wrapper at the block's current position (no commit)
    const loroParentId = currentLoroParent?.id?.toString() || null;
    const index = block.node.index() ?? undefined; // null-guard for safety

    const wrapper = WrapperClass.create(nabu, req.type, req.props?.() || {}, loroParentId, index);

    // Move block into wrapper (no commit)
    nabu.tree.move(block.node.id, wrapper.node.id);
    return wrapper;
}


// ── Deleting a range across blocks ──────────────────────────────────────────

/**
 * A selected range of the document, as model positions.
 * @typedef {object} DeletionRange
 * @property {Block} startBlock   Block holding the start of the range (earlier in document order).
 * @property {number} startOffset Text offset of the start inside `startBlock`.
 * @property {Block} endBlock     Block holding the end of the range.
 * @property {number} endOffset   Text offset of the end inside `endBlock`.
 */

/** @param {Block | null | undefined} block @returns {Block[]} */
const kidsOf = (block) => /** @type {Block[]} */ (/** @type {any} */ (block)?.children ?? []);

/** Children of `parent`, or the root blocks when `parent` is null. @param {Nabu} nabu @param {Block | null} parent */
const childrenOf = (nabu, parent) => (parent ? kidsOf(parent) : /** @type {Block[]} */ (nabu.children));

/** @param {Block} block @returns {import('../behaviors/text/text.behavior.svelte.js').TextBehavior | null} */
const textOf = (block) => /** @type {any} */ (block.behaviors?.get('text')) ?? null;

/**
 * `block` and its ancestors, up to (and excluding) `stop`: `[block, parent, …, child of stop]`.
 * @param {Block} block
 * @param {Block | null} stop
 * @returns {Block[]}
 */
function pathUp(block, stop) {
    /** @type {Block[]} */
    const path = [];
    for (let cur = /** @type {Block | null} */ (block); cur && cur !== stop; cur = cur.parent ?? null) path.push(cur);
    return path;
}

/**
 * Re-homes `blocks`, in order, right after `anchor` (a block of the tree), wrapping the ones whose type
 * demands a specific parent (`requiredParent`) in a fresh wrapper. No commit.
 * @param {Nabu} nabu
 * @param {Block} anchor
 * @param {Block[]} blocks
 */
function rehomeAfter(nabu, anchor, blocks) {
    let after = anchor.node;
    for (const block of blocks) {
        block.node.moveAfter(after);
        const wrapper = wrapOrphan(nabu, block);
        after = (wrapper ?? block).node;
    }
}

/**
 * THE one implementation of "delete the selected range across blocks" (cut, Backspace / Delete, typing over a
 * selection, paste over a selection). Mutates the Loro tree and texts, never commits.
 *
 * Model: document order is pre-order, a block's own text coming before its children. The range runs from
 * (`startBlock`, `startOffset`) to (`endBlock`, `endOffset`):
 *   - the head of the start block and the tail of the end block are merged at the junction (the end block's
 *     children follow it: adopted by the start block when it can hold children, else promoted after it);
 *   - everything strictly inside the range is destroyed: blocks between the two spines, the later children of
 *     every block on the start spine, the earlier children of every block on the end spine, and the blocks of
 *     the end spine themselves (their own text lies inside the range);
 *   - what follows the end point inside the partially-selected blocks of the end spine SURVIVES, in document
 *     order, re-homed right after the start block (`wrapOrphan` honours `requiredParent`), so it keeps its
 *     position relative to everything outside the range; blocks that follow the end spine at the level of the
 *     common ancestor are untouched;
 *   - when the start block is an ANCESTOR of the end block (it starts in a hybrid's text and ends in its
 *     body), the remaining body stays where it is: structure-only blocks of the end spine are kept in place
 *     and only the blocks whose own text was inside the range are removed.
 * Survivors are always moved out BEFORE their former ancestors are destroyed (deleting a Loro node deletes
 * its whole subtree). The result may violate type-specific invariants; the normalizers fix them on commit.
 *
 * @param {Nabu} nabu
 * @param {DeletionRange} range
 * @returns {{ block: Block, offset: number } | null} the junction (where the caret belongs), or null if the range is unusable
 */
export function deleteRange(nabu, range) {
    const { startBlock: start, startOffset, endBlock: end, endOffset } = range;
    const startText = textOf(start);
    const endText = textOf(end);

    // ── One block: a plain text deletion ──
    if (start === end) {
        if (startText && endOffset > startOffset) startText.delete({ from: startOffset, to: endOffset });
        return { block: start, offset: startOffset };
    }

    const lca = findLCA(start, end);
    if (lca === end) return null; // end encloses start: the range is reversed
    const nested = lca === start; // the start block holds the end block in its subtree
    const startPath = nested ? [] : pathUp(start, lca);
    const endPath = pathUp(end, lca);
    if (!endPath.length) return null;

    /** Blocks destroyed at the end (with their subtree). @type {Set<Block>} */
    const doomed = new Set();
    /** Blocks that outlive the cut, in document order, to re-home after `anchor`. @type {Block[]} */
    const survivors = [];
    let anchor = start;
    /** Nested case: the outermost block of the end spine (below `start`) that has own text. @type {Block | null} */
    let hybrid = null;

    if (!nested) {
        const siblings = childrenOf(nabu, lca);
        const first = /** @type {Block} */ (startPath.at(-1));
        const last = /** @type {Block} */ (endPath.at(-1));
        const firstIndex = siblings.indexOf(first);
        const lastIndex = siblings.indexOf(last);
        if (firstIndex < 0 || lastIndex <= firstIndex) return null;

        // Between the two spines.
        siblings.slice(firstIndex + 1, lastIndex).forEach(block => doomed.add(block));
        // After the start, inside the start spine (the start block's own children come right after its text).
        for (const node of startPath) {
            if (node === first) break;
            const brothers = kidsOf(node.parent);
            brothers.slice(brothers.indexOf(node) + 1).forEach(block => doomed.add(block));
        }
        kidsOf(start).forEach(block => doomed.add(block));
        // Before the end, inside the end spine; what follows the end point survives.
        endPath.forEach((node, i) => {
            if (node !== last) {
                const brothers = kidsOf(node.parent);
                const at = brothers.indexOf(node);
                brothers.slice(0, at).forEach(block => doomed.add(block));
                survivors.push(...brothers.slice(at + 1));
            }
            if (i > 0) doomed.add(node);
        });
    } else {
        for (let i = endPath.length - 1; i >= 1; i--) {
            if (textOf(endPath[i])) { hybrid = endPath[i]; break; }
        }
        const hybridIndex = hybrid ? endPath.indexOf(hybrid) : -1;
        endPath.forEach((node, i) => {
            const brothers = kidsOf(node.parent);
            const at = brothers.indexOf(node);
            brothers.slice(0, at).forEach(block => doomed.add(block));
            // Only what sits under a block that is removed has to move; the rest stays in place.
            if (hybrid && i < hybridIndex) survivors.push(...brothers.slice(at + 1));
        });
        if (hybrid) { doomed.add(hybrid); anchor = hybrid; }
    }

    // ── Text: head of the start block + tail of the end block ──
    if (startText) {
        const length = startText.container.length;
        if (length > startOffset) startText.delete({ from: startOffset, to: length });
    }
    if (endText && endOffset > 0) endText.delete({ from: 0, to: endOffset });

    const absorbed = !!(startText && endText && start.absorbs(end));
    const endChildren = [...kidsOf(end)];
    if (absorbed || !endText) doomed.add(end);
    else if (!nested) survivors.unshift(end); // could not be merged: it stays, right after the start

    // The end block's children: adopted by the start block when it holds children, else promoted.
    /** @type {any} */
    const host = start;
    const adopts = typeof host.adoptChildren === 'function';
    let adoptAfterMoves = false;
    if (endChildren.length && (absorbed || !endText)) {
        if (nested && !hybrid) {
            host.adoptChildren(endChildren, kidsOf(start).indexOf(/** @type {Block} */ (endPath.at(-1))));
        } else if (!nested && !hybrid && adopts) {
            adoptAfterMoves = true;
        } else {
            survivors.unshift(...endChildren);
        }
    }

    rehomeAfter(nabu, anchor, survivors);
    if (adoptAfterMoves) host.adoptChildren(endChildren);

    // ── Destroy, outermost blocks only (a Loro delete takes the subtree along) ──
    for (const block of doomed) {
        let covered = false;
        for (let p = block.parent ?? null; p; p = p.parent ?? null) if (doomed.has(p)) { covered = true; break; }
        if (!covered && !block.node.isDeleted?.()) block.destroy();
    }

    return { block: start, offset: startOffset };
}

/**
 * The current selection as a {@link DeletionRange}, or null when there is none.
 * A selection inside one block has `startBlock === endBlock`.
 * @param {Nabu} nabu
 * @returns {DeletionRange | null}
 */
export function selectionRange(nabu) {
    const startBlock = /** @type {Block | null} */ (nabu.selection.startBlock);
    const endBlock = /** @type {Block | null} */ (nabu.selection.endBlock);
    if (!startBlock || !endBlock) return null;
    const startSel = /** @type {any} */ (startBlock.selection);
    const startOffset = startSel?.from ?? 0;
    if (startBlock === endBlock) return { startBlock, startOffset, endBlock, endOffset: startSel?.to ?? startOffset };
    const endSel = /** @type {any} */ (endBlock.selection);
    return { startBlock, startOffset, endBlock, endOffset: endSel?.to ?? 0 };
}

/**
 * Shared beforeinput logic for block containers (Nabu root and MegaBlock) when the selection spans SEVERAL
 * blocks (a selection inside one block is that block's business). Backspace / Delete / word deletions delete the
 * range; typing replaces it; Enter replaces it and splits at the junction. All of it is {@link deleteRange}
 * followed by the plain single-block edit at the junction, then ONE commit (one undo step).
 *
 * The `container` (the lowest common ancestor the event was routed to) is not needed any more: the range is
 * resolved from the selection alone, which also makes the same code correct for every depth.
 *
 * @param {{ children: Block[], commit: () => void }} container
 * @param {Nabu} nabu
 * @param {InputEvent} event
 */
export function handleContainerBeforeInput(container, nabu, event) {
    const range = selectionRange(nabu);
    if (!range) return false;

    // Single-block selection: delegate directly to that block.
    if (range.startBlock === range.endBlock) return range.startBlock.beforeinput(event);

    const inputType = event.inputType;
    const typed = inputType === 'insertText' ? (event.data || '')
        : (inputType === 'insertLineBreak' || inputType === 'insertSoftLineBreak') ? '\n'
        : null;
    const isDeletion = inputType.startsWith('delete');
    const isParagraph = inputType === 'insertParagraph';
    if (!isDeletion && !isParagraph && typed === null) {
        if (inputType.startsWith('history')) return true; // undo / redo go through the keydown handler
        nabu.warn('Unhandled input type in container:', inputType);
        return false;
    }

    const junction = deleteRange(nabu, range);
    if (!junction) return false;
    const { block } = junction;
    let { offset } = junction;

    if (typed !== null) {
        block.insert(offset, typed);
        offset += typed.length;
    } else if (isParagraph) {
        const text = textOf(block);
        const split = block.split({ offset, to: text ? text.container.length : offset });
        if (split?.block) {
            // The split commits the whole operation (deletion included) and puts the caret in the new block.
            nabu.commit();
            return true;
        }
    }

    nabu.commit().then(() => nabu.selection.setCursor(nabu.blocks.get(block.id) ?? block, offset));
    return true;
}

/**
 * Deletes the current selection content without committing (cut, paste over a selection).
 * Handles both single-block and multi-block selections — see {@link deleteRange}.
 * Returns the resulting insertion position {block, offset}, or null on failure.
 *
 * @param {{ children: import('./block.svelte.js').Block[] }} container (unused: the range comes from the selection)
 * @param {import('./nabu.svelte.js').Nabu} nabu
 * @returns {{ block: import('./block.svelte.js').Block, offset: number } | null}
 */
export function deleteSelectionContent(container, nabu) {
    const range = selectionRange(nabu);
    if (!range) return null;
    return deleteRange(nabu, range);
}
