/**
 * @import { Nabu } from './nabu.svelte.js'
 */

import { tick } from 'svelte';
import { Extension } from '../utils/extensions.js';

/**
 * Transform the anchor block to a new type, then restore cursor position.
 * @param {Nabu} nabu
 * @param {string} type
 * @param {Object} [props={}]
 */
function transformBlock(nabu, type, props = {}) {
    console.log(`Transforming block to type "${type}" with props`, props);
    const block = nabu.selection.anchorBlock;
    if (!block) return;
    const blockId = block.id;
    const offset = block.behaviors?.get('text')?.selection?.from ?? 0;
    block.transformTo(type, props);
    // After transformTo, updateRoots() replaces the block instance — fetch the new one.
    tick().then(() => {
        const newBlock = nabu.blocks.get(blockId);
        if (newBlock) nabu.focus({ from: { block: newBlock, offset }, to: { block: newBlock, offset } });
    });
}

export const BlockExtension = new Extension('block', {
    actions: {
        'block:transform': (nabu, data) => transformBlock(nabu, data?.type, data?.props ?? {}),
    }
});
