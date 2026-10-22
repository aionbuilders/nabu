/**
 * Keyboard block moves (`block:move-up` / `block:move-down`, P-80): the keyboard alternative to dragging (WCAG 2.5.7).
 *
 * Generic: it names no block type. The blocks that move are the SIBLINGS of one parent (the root, or a container's children):
 *  - the caret in a block moves that block; a list item moves among the items of its list, with its sub-lists;
 *  - a selection moves the whole contiguous run of its top-most blocks together: the blocks covered by the selection, taken at
 *    the level of the deepest container that holds both ends (a container selected from its own text to a descendant moves as
 *    one block);
 *  - one step at a time; at the edge of the parent nothing moves (leaving a container is a structural decision of its own:
 *    indent / outdent for lists, drag for the rest) and the key is still consumed;
 *  - one undo step; the selection stays on the same characters.
 *
 * @import { Nabu } from './nabu.svelte.js'
 * @import { Block } from './block.svelte.js'
 */

import { tick } from 'svelte';
import { livePoints, placePoints, revealFocus } from './undo-selection.js';

/**
 * The run of sibling blocks a selection covers: `{ siblings, from, to }` (indexes in `siblings`, `from <= to`).
 * @param {Block} a  one end of the selection
 * @param {Block} b  the other end (the same block for a caret)
 * @param {Nabu} nabu
 * @returns {{ siblings: Block[], from: number, to: number } | null}
 */
export function siblingRun(a, b, nabu) {
    /** @param {Block} block @returns {Block[]} root first */
    const chain = (block) => {
        /** @type {Block[]} */
        const out = [];
        for (let x = /** @type {Block | null} */ (block); x; x = /** @type {Block | null} */ (x.parent)) out.unshift(x);
        return out;
    };
    const ca = chain(a);
    const cb = chain(b);
    let k = 0;
    while (k < ca.length && k < cb.length && ca[k] === cb[k]) k++;
    // One end holds the other (or they are the same block): that block moves as a whole.
    if (k > 0 && (k === ca.length || k === cb.length)) {
        const whole = ca[k - 1];
        const siblings = /** @type {Block[]} */ (whole.parent ? /** @type {any} */ (whole.parent).children : nabu.children);
        const at = siblings.indexOf(whole);
        return at < 0 ? null : { siblings, from: at, to: at };
    }
    const siblings = /** @type {Block[]} */ (k === 0 ? nabu.children : /** @type {any} */ (ca[k - 1]).children);
    const i = siblings.indexOf(ca[k]);
    const j = siblings.indexOf(cb[k]);
    if (i < 0 || j < 0) return null;
    return { siblings, from: Math.min(i, j), to: Math.max(i, j) };
}

/**
 * Move the selected blocks (or `data.block`) one step among their siblings.
 * @param {Nabu} nabu
 * @param {'up' | 'down'} direction
 * @param {Block | string | null} [target]  a block (or its id) to move instead of the selected ones
 * @returns {Promise<boolean> | boolean}  `false` = nothing to act on (no selection in the editor): the key is not handled;
 *   otherwise a promise of `true` (handled, also when the block already is at the edge and nothing moved)
 */
export function moveBlocks(nabu, direction, target = null) {
    const given = typeof target === 'string' ? nabu.blocks.get(target) : target;
    const a = given ?? nabu.selection.anchorBlock ?? nabu.selection.focusBlock ?? null;
    const b = given ?? nabu.selection.focusBlock ?? a;
    if (!a || !b) return false;
    const run = siblingRun(a, b, nabu);
    if (!run) return false;
    const { siblings, from, to } = run;
    const edge = direction === 'up' ? siblings[from - 1] : siblings[to + 1];
    if (!edge) return Promise.resolve(true);
    return perform(nabu, () => {
        // Moving the ONE neighbour past the run is the same order as moving the run, in a single tree operation, and the
        // selected blocks keep their elements.
        if (direction === 'up') edge.node.moveAfter(siblings[to].node);
        else edge.node.moveBefore(siblings[from].node);
    });
}

/**
 * @param {Nabu} nabu
 * @param {() => void} mutate
 * @returns {Promise<boolean>}
 */
async function perform(nabu, mutate) {
    const kept = livePoints(nabu);
    await nabu.transact(mutate);
    if (kept) {
        await tick();
        if (placePoints(nabu, kept)) revealFocus(kept.focus.block);
    }
    return true;
}
