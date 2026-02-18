import { LoroDoc } from 'loro-crdt';
import { SvelteMap } from 'svelte/reactivity';
import { Block } from './block.svelte';

/**
 * @import {Component} from "svelte";
 * @import { LoroTreeNode } from "loro-crdt";
 */

/**
 * @typedef {LoroTreeNode<{type: string}>} NabuNode
 */

export class Nabu {
    constructor(snapshot = null) {
        this.doc = new LoroDoc();
        if (snapshot) {
            this.doc.import(snapshot);
        }

        this.tree = this.doc.getTree("blocks");

        const roots = /** @type {NabuNode[]} */ (this.tree.roots());
        if (roots?.length) {
            for (const root of roots) {
                const block = Block.load(this, root);
                this.children.push(block);
            }
        }
    }
    /** @type {LoroDoc} */
    doc;
    /** @type {SvelteMap<string, typeof Block>} */
    registry = new SvelteMap();
    /** @type {SvelteMap<string, Component>} */
    components = new SvelteMap();
    /** @type {SvelteMap<string, Block>} */
    blocks = new SvelteMap();


    /** @type {Block[]} */
    children = $state([]);
}