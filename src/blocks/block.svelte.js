/**
 * @import { Nabu, NabuNode } from "./nabu.svelte";
 */

export class Block {
    /** @param {Nabu} nabu @param {NabuNode} node */
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

    /** @type {Block | null} */
    parent = $state(null);

    component = $derived(this.nabu.components.get(this.type) || null);


    /** @param {Nabu} nabu @param {NabuNode} node */
    static load(nabu, node) {
        const metadata = node.data;
        const type = metadata.get("type") || "block";
        const BlockClass = nabu.registry.get(type) || Block;
        const block = new BlockClass(nabu, node);
        return block;
    }

}