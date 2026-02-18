import { LoroDoc } from 'loro-crdt';
import { SvelteMap } from 'svelte/reactivity';
import { Block } from './block.svelte';

/**
 * @import {Component} from "svelte";
 */

export class Nabu {
    constructor(snapshot = null) {
        this.doc = new LoroDoc();
        if (snapshot) {
            this.doc.import(snapshot);
        }

        this.tree = this.doc.getTree("blocks");
        const roots = this.tree.roots();
        if (roots?.length) {
            for (const root of roots) {
                const block = Block.load(this, root);
                this.children.push(block);
            }
        }
    }
    /** @type {LoroDoc} */
    doc;
    /** @type {SvelteMap<string, Component>} */
    registry = new SvelteMap();
    /** @type {SvelteMap<string, Block>} */
    blocks = new SvelteMap();


    /** @type {Block[]} */
    children = $state([]);
}