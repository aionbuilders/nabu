import { MegaBlock } from "..";

/**
 * @import {Block, NabuNode} from "..";
 * @import {LoroText} from "loro-crdt";
 */

/**
 * @typedef {NabuNode<{type: "list", listType: "bullet" | "ordered"}>} ListNode
 */

export class ListBehavior {
    /** @param {Block} block */
    constructor(block) {
        this.block = block;
        this.node = /** @type {ListNode} */ (block.node);
        this.listType = /** @type {"bullet" | "ordered"} */ (this.node.data.get("listType") || "bullet");
        this.node.data.subscribe(() => {
            this.listType = /** @type {"bullet" | "ordered"} */ (this.node.data.get("listType") || "bullet");
        });
    }

    /** @type {"bullet" | "ordered"} */
    listType = $state("bullet");

    /** @param {Block} block */
    absorbs(block) {
        const behavior = block?.behaviors.get("list");
        if (!(behavior && behavior instanceof ListBehavior)) {
            console.warn("Cannot merge: target block is not a list.");
            return;
        }
        if (!(block instanceof MegaBlock)) {
            console.warn("Cannot merge: target block is not a mega block.");
            return;
        }

        if (behavior.listType !== this.listType) {
            console.warn("Cannot merge lists of different types.");
            return;
        }

        // 1. On fusionne les enfants de l'autre liste dans la nôtre
        const otherChildren = block.node.children() || [];
        otherChildren.forEach(child => {
            console.warn("Merging child with id", child.id.toString(), "from list", block.id, "into list", this.block.id);
            const data = /** @type {LoroText} */ (child.data.get("text"));
            const targetIndex = this.block.node.children()?.length; // On ajoute à la fin de notre liste
            if (targetIndex === undefined || targetIndex === null) {
                console.error("Cannot merge: current block's node has no children array.");
                return;
            }
            child.move(this.block.node, targetIndex);
        });

        // block.destroy();


        return true;
    }
}