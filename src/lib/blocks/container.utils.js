/**
 * @import { Block } from './block.svelte.js';
 * @import { Nabu } from './nabu.svelte.js';
 */

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
            if (nextSiblings.length) nextSiblings.forEach(block => block.destroy());
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
            if (previousSiblings.length) previousSiblings.forEach(block => block.destroy());
        }
    }

    // Resolve the direct children of container from each spine.
    const directChild = (spine) => spine.at(-1) === container ? spine.at(-2) : spine.at(-1);
    const startOfStartSpine = directChild(startSpine);
    const startOfEndSpine = directChild(endSpine);
    if (!startOfStartSpine || !startOfEndSpine) return false;

    // Delete intermediate direct children of container between the two spines.
    const intermediates = container.children.slice(startOfStartSpine.index + 1, startOfEndSpine.index);
    intermediates.forEach(block => block.destroy());

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
        console.warn('Unhandled input type in container:', inputType);
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
            if (nextSiblings.length) nextSiblings.forEach(sibling => sibling.node.moveAfter(focusBlock.node));
        }
    });

    startOfEndSpine?.destroy();

    container.commit();
    startBlock.focus({
        offset: focusData.options.startOffset + (inputType === 'insertText' ? (event.data?.length || 0) : 0)
    });
    return true;
}
