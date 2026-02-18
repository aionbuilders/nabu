import { Block } from "../block.svelte";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte";
 * @import { LoroTreeNode } from "loro-crdt";
 */

export class Paragraph extends Block {
    /** @param {Nabu} nabu @param {NabuNode} node */
    constructor(nabu, node) {
        super(nabu, node);
    }
}