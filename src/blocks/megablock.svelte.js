import { Block } from "./block.svelte";

/**
 * @import { Nabu, NabuNode } from "./nabu.svelte";
 */

export class MegaBlock extends Block {

    /** @param {Nabu} nabu @param {NabuNode} node */
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


    /** @param {InputEvent} event @param {{from: Block} & Object} [data={}] */
    beforeinput(event, data) {

    }
}