/**
 * @import { Block } from './block.svelte.js';
 * @import { Nabu } from './nabu.svelte.js';
 */

import { start } from 'happy-dom/lib/PropertySymbol.js';
import { MegaBlock } from './megablock.svelte.js';

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

/**
 * Shared beforeinput logic for block containers (Nabu root and MegaBlock).
 *
 * Uses a "spine" approach: for each selection boundary, we walk up the parent
 * chain until we hit the container, collecting intermediate blocks to clean up
 * along the way. This correctly handles arbitrarily nested structures.
 *
 * Spine termination differs between the two callers:
 *   - MegaBlock: the container IS pushed into the spine (loop exits on === container),
 *     so the direct child of container is at spine.at(-2).
 *   - Nabu: root blocks have parent = null, so the loop breaks before Nabu is ever
 *     pushed, and the direct child of container is at spine.at(-1).
 * Both cases are unified by the directChild() helper below.
 *
 * @param {{ children: Block[], commit: () => void }} container
 * @param {Nabu} nabu
 * @param {InputEvent} event
 */
export function handleContainerBeforeInput(container, nabu, event) {
    const startBlock = /** @type {Block} */ (nabu.selection.startBlock);
    const endBlock = /** @type {Block} */ (nabu.selection.endBlock);
    if (!startBlock || !endBlock) return false;

    const focusData = startBlock.focus(undefined, true);
    const inputType = event.inputType;

    const toDestroy = new Set();

    // Build start spine: walk from startBlock up to (but not past) container,
    // pruning next-siblings of each intermediate node along the way.
    const startSpine = [startBlock];
    while (startSpine.at(-1) && startSpine.at(-1) !== container) {
        const current = startSpine.at(-1);
        const parent = current?.parent;
        if (!current || !parent) break;
        startSpine.push(parent);
        if (parent !== container) {
            const nextSiblings = parent.children.slice(current.index + 1);
            if (nextSiblings.length) nextSiblings.forEach(block => toDestroy.add(block));
        }
    }

    // Build end spine: walk from endBlock up to (but not past) container,
    // pruning prev-siblings of each intermediate node along the way.
    const endSpine = [endBlock];
    while (endSpine.at(-1) && endSpine.at(-1) !== container) {
        const current = endSpine.at(-1);
        const parent = current?.parent;
        if (!current || !parent) break;
        endSpine.push(parent);
        if (parent !== container) {
            const previousSiblings = parent.children.slice(0, current.index);
            if (previousSiblings.length) previousSiblings.forEach(block => toDestroy.add(block));
        }
    }

    // Resolve the direct children of container from each spine.
    const directChild = (spine) => spine.at(-1) === container ? spine.at(-2) : spine.at(-1);
    const startOfStartSpine = directChild(startSpine);
    const startOfEndSpine = directChild(endSpine);
    if (!startOfStartSpine || !startOfEndSpine) return false;

    // Delete intermediate direct children of container between the two spines.
    const intermediates = container.children.slice(startOfStartSpine.index + 1, startOfEndSpine.index);
    intermediates.forEach(block => toDestroy.add(block));

    // Single-block selection: delegate directly to that block.
    if (startBlock === endBlock) {
        return startBlock.beforeinput(event);
    }

    // Delete the selected portions of both boundary blocks.
    startBlock.delete();
    endBlock.delete();

    let focusBlock = startBlock;

    if (inputType === 'deleteContentBackward' || inputType === 'deleteContentForward') {
        // Text deletion already handled above.
    } else if (inputType === 'insertParagraph') {
        const { block: newBlock } = startBlock.split({ offset: focusData.options.startOffset }) || {};
        if (newBlock) focusBlock = newBlock;
    } else if (inputType === 'insertText' || inputType === 'insertLineBreak') {
        const text = event.data || (inputType === 'insertLineBreak' ? '\n' : '');
        startBlock.insert(focusData.options.startOffset, text);
    } else {
        nabu.warn('Unhandled input type in container:', inputType);
        return false;
    }

    // Merge the end block into focusBlock and relocate orphaned siblings.
    focusBlock.consume(endBlock);

    endSpine.forEach(block => {
        if (block === container) return;
        const brotherhood = block.parent?.children || [];
        const index = brotherhood.indexOf(block);
        if (index !== -1) {
            const nextSiblings = brotherhood.slice(index + 1);
            if (nextSiblings.length) {
                // Reverse to preserve original order: moveAfter(focus) inserts right
                // after focus each time, so forward iteration would reverse the result.
                // wrapOrphan ensures structural integrity (e.g. ListItem → needs List parent).
                [...nextSiblings].reverse().forEach(sibling => {
                    sibling.node.moveAfter(focusBlock.node);
                    wrapOrphan(nabu, sibling);
                });
            }
        }
    });

    if (startOfEndSpine === startOfStartSpine) {
        if (startOfStartSpine instanceof MegaBlock) {
            startOfStartSpine.children.filter(c => c.selected).forEach(c => toDestroy.add(c));
        }
    }
    
    if (startOfEndSpine !== startOfStartSpine) {
        startOfEndSpine?.destroy();
        if (startOfStartSpine !== startBlock && startBlock instanceof MegaBlock) {
            startBlock.children.forEach(child => child.destroy());
        }
    }

    toDestroy.forEach(block => block.destroy());

    container.commit();
    startBlock.focus({
        offset: focusData.options.startOffset + (inputType === 'insertText' ? (event.data?.length || 0) : 0)
    });
    return true;
}

/**
 * Deletes the current selection content without committing.
 * Handles both single-block and multi-block selections.
 * Returns the resulting insertion position {block, offset}, or null on failure.
 *
 * @param {{ children: import('./block.svelte.js').Block[] }} container
 * @param {import('./nabu.svelte.js').Nabu} nabu
 * @returns {{ block: import('./block.svelte.js').Block, offset: number } | null}
 */
export function deleteSelectionContent(container, nabu) {
    const startBlock = /** @type {import('./block.svelte.js').Block} */ (nabu.selection.startBlock);
    const endBlock = /** @type {import('./block.svelte.js').Block} */ (nabu.selection.endBlock);
    if (!startBlock || !endBlock) return null;

    // Single-block selection: delete the range only
    if (startBlock === endBlock) {
        const sel = startBlock.selection;
        if (!sel || sel.from === sel.to) return { block: startBlock, offset: sel?.from ?? 0 };
        const tb = startBlock.behaviors?.get('text');
        if (tb) tb.delete({ from: sel.from, to: sel.to });
        return { block: startBlock, offset: sel.from };
    }

    // Multi-block selection: same spine logic as handleContainerBeforeInput (no commit)
    const startOffset = startBlock.focus(undefined, true).options.startOffset;

    const startSpine = [startBlock];
    while (startSpine.at(-1) && startSpine.at(-1) !== container) {
        const current = startSpine.at(-1);
        const parent = current?.parent;
        if (!current || !parent) break;
        startSpine.push(parent);
        if (parent !== container) {
            const nextSiblings = parent.children.slice(current.index + 1);
            if (nextSiblings.length) nextSiblings.forEach(block => block.destroy());
        }
    }

    const endSpine = [endBlock];
    while (endSpine.at(-1) && endSpine.at(-1) !== container) {
        const current = endSpine.at(-1);
        const parent = current?.parent;
        if (!current || !parent) break;
        endSpine.push(parent);
        if (parent !== container) {
            const previousSiblings = parent.children.slice(0, current.index);
            if (previousSiblings.length) previousSiblings.forEach(block => block.destroy());
        }
    }

    const directChild = (spine) => spine.at(-1) === container ? spine.at(-2) : spine.at(-1);
    const startOfStartSpine = directChild(startSpine);
    const startOfEndSpine = directChild(endSpine);
    if (!startOfStartSpine || !startOfEndSpine) return null;

    const intermediates = container.children.slice(startOfStartSpine.index + 1, startOfEndSpine.index);
    intermediates.forEach(block => block.destroy());

    startBlock.delete();
    endBlock.delete();
    startBlock.consume(endBlock);

    endSpine.forEach(block => {
        if (block === container) return;
        const brotherhood = block.parent?.children || [];
        const index = brotherhood.indexOf(block);
        if (index !== -1) {
            const nextSiblings = brotherhood.slice(index + 1);
            if (nextSiblings.length) {
                [...nextSiblings].reverse().forEach(sibling => {
                    sibling.node.moveAfter(startBlock.node);
                    wrapOrphan(nabu, sibling);
                });
            }
        }
    });

    startOfEndSpine?.destroy();

    return { block: startBlock, offset: startOffset };
}
