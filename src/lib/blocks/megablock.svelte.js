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
        /** @type {Block[]} */
        let skipped = [];
        children.reverse().forEach(child => {
            const childNode = child.node;
            if (!childNode) return;
            if (false) {
                //TODO: conditions de skip, ex: si le block est déjà dans la mega block, ou si c'est un block parent de la mega block, etc.
                this.nabu.warn("Skipping child with id", child.id, "because ...");
                return skipped.push(child);
            }
            this.nabu.tree.move(childNode.id, this.node.id, index);
        })

        return {skipped: skipped.length ? skipped.reverse() : false};
    }


    /** @param {InputEvent} event */
    beforeinput(event) {
        return handleContainerBeforeInput(this, this.nabu, event);
    }
}