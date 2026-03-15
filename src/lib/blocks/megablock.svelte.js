import { Block } from "./block.svelte.js";
import { handleContainerBeforeInput } from "./container.utils.js";

/**
 * @import { Nabu, NabuNode } from "./nabu.svelte.js";
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
        this.children = childrenNodes.map((childNode, i) => {
            const id = childNode.id.toString();
            let block = this.nabu.blocks.get(id);
            const currentType = childNode.data.get("type");

            if (!block || block.type !== currentType) {
                if (block) {
                    this.nabu.blocks.delete(id);
                    this.nabu.blocksByType.get(block.type)?.delete(block);
                }
                block = Block.load(this.nabu, childNode);
            }
            block.parent = this;
            block.index = i;
            return block;
        });
    }


    /** @param {Block[]} children @param {number | null} [index] */
    adoptChildren(children, index = null) {
        // Reverse so that when index is specified, children are inserted in original
        // order (each insert at the same position pushes others down, so reverse of
        // reverse = original). With index=null (append), order doesn't matter.
        // Spread to avoid mutating the input array (which may be a reactive Svelte array).
        [...children].reverse().forEach(child => {
            if (!child.node) return;
            this.nabu.tree.move(child.node.id, this.node.id, index);
        });
    }


    /** @param {InputEvent} event */
    beforeinput(event) {
        return handleContainerBeforeInput(this, this.nabu, event);
    }
}