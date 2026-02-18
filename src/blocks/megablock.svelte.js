import { Block } from "./block.svelte";

/**
 * @import { Nabu } from "./nabu.svelte";
 * @import { LoroTreeNode } from "loro-crdt";
 */

export class MegaBlock extends Block {

    /** @param {Nabu} nabu @param {LoroTreeNode<{type: string}>} node */
	constructor(nabu, node) {
		super(nabu, node);
        const children = node.children();
        if (children?.length) {
            for (const child of children) {
                const block = Block.load(nabu, child);
                this.children.push(block);
            }
        }
	}

    /** @type {Block[]} */
    children = $state([]);
}