/**
 * @import { Nabu } from "./nabu.svelte";
 * @import { LoroTreeNode } from "loro-crdt";
 */

export class Block {
    /** @param {Nabu} nabu @param {LoroTreeNode<{type: string}>} node */
    constructor(nabu, node) {
        this.nabu = nabu;
        const metadata = node?.data || new Map();
        this.id = node.id.toString()
        this.type = metadata.get("type") || "block";
        this.nabu.blocks.set(this.id, this);

        const parent = node.parent();
        if (parent) {
            this.parent = this.nabu.blocks.get(parent.id.toString()) || null;
        }
    }

    /** @type {Nabu} */
    nabu;

    /** @type {Block | null} */
    parent = $state(null);


    /** @param {Nabu} nabu @param {LoroTreeNode<{type: string}>} node */
    static load(nabu, node) {
        const metadata = node.data;
        const type = metadata.get("type") || "block";
        const BlockClass = nabu.registry.get(type) || Block;
        const block = new BlockClass(nabu, node);
        return block;
    }

}