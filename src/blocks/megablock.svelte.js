import { Block } from "./block.svelte";

/**
 * @import { Nabu, NabuNode } from "./nabu.svelte";
 */

export class MegaBlock extends Block {

    /** @param {Nabu} nabu @param {NabuNode} node */
	constructor(nabu, node) {
		super(nabu, node);
        this.updateChildren();
	}

    /** @type {Block[]} */
    children = $state([]);

    updateChildren() {
        const childrenNodes = this.node.children();
        if (!childrenNodes) return;
        this.children = childrenNodes.map(childNode => {
            const id = childNode.id.toString();
            let block = this.nabu.blocks.get(id);
            const currentType = childNode.data.get("type");

            if (!block || block.type !== currentType) {
                if (block) this.nabu.blocks.delete(id);
                block = Block.load(this.nabu, childNode);
            }
            block.parent = this;
            return block;
        });
    }


    /** @param {InputEvent} event @param {{from: Block} & Object} [data={}] */
    beforeinput(event, data) {

    }
}