/**
 * @import { Nabu } from './nabu.svelte.js'
 */

import { Extension } from '../utils/extensions.js';

/**
 * Transform the anchor block to a new type, then restore cursor position.
 * @param {Nabu} nabu
 * @param {string} type
 * @param {Object} [props={}]
 */
async function transformBlock(nabu, type, props = {}) {
    const block = nabu.selection.anchorBlock;
    if (!block) return;
    const blockId = block.id;
    const offset = block.behaviors?.get('text')?.selection?.from ?? 0;
    await nabu.transact(() => {
        const data = /** @type {any} */ (block.node.data);
        data.set("type", type);
        for (const [key, value] of Object.entries(props)) {
            data.set(key, value);
        }
    });
    // After the commit, updateRoots() replaces the block instance — fetch the new one.
    const newBlock = nabu.blocks.get(blockId);
    if (newBlock) nabu.focus({ from: { block: newBlock, offset }, to: { block: newBlock, offset } });
}

export const BlockExtension = new Extension('block', {
    actions: {
        'block:transform': (nabu, data) => transformBlock(nabu, data?.type, data?.props ?? {}),
    }
});
