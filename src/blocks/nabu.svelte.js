import { LoroDoc } from 'loro-crdt';
import { SvelteMap } from 'svelte/reactivity';
import { Block } from './block.svelte';
import { NabuSelection } from './selection.svelte';


/**
* @import {Component} from "svelte";
* @import { LoroTreeNode, LoroTree } from "loro-crdt";
* @import {Extension} from '../utils/extensions.js';
*/

/**
* @template {Object<string, any>} [T={}]
* @typedef {LoroTreeNode<{type: string} & T>} NabuNode
*/

/**
* @typedef {Object} NabuInit
* @property {Extension[]} [extensions]
* @property {Uint8Array<ArrayBufferLike>} [snapshot]
*/

export class Nabu {
    /** @param {NabuInit} init */
    constructor(init = {}) {
        this.doc = new LoroDoc();
        if (init.snapshot) {
            this.doc.import(init.snapshot);
        }
        
        this.selection = new NabuSelection(this);
        this.tree = /** @type {LoroTree<Record<string, NabuNode>>} */ (this.doc.getTree("blocks"));
        this.content = this.doc.getMap("content");
        
        this.extensions = init.extensions || [];
        
        if (this.extensions?.length) {
            for (const ext of this.extensions) {
                if (ext.block) this.registry.set(ext.name, ext.block);
                if (ext.component) this.components.set(ext.name, ext.component);
                if (ext.hooks) {
                    for (const [hookName, hookFn] of Object.entries(ext.hooks)) {
                        if (!this.hooks.has(hookName)) {
                            this.hooks.set(hookName, []);
                        }
                        this.hooks.get(hookName).push(hookFn);
                    }
                }
                
            }
        }
        
        const roots = /** @type {NabuNode[]} */ (this.tree.roots());
        if (roots?.length) {
            for (const root of roots) {
                const block = Block.load(this, root);
                this.children.push(block);
            }
        }

        this.tree.subscribe(() => {
            const roots = /** @type {NabuNode[]} */ (this.tree.roots());
            const newChildren = [];
            for (const root of roots) {
                const id = root.id.toString();
                let block = this.blocks.get(id);
                if (!block) {
                    block = Block.load(this, root);
                }
                newChildren.push(block);
            }
            this.children = newChildren;
        });

        this.init();
    }
    /** @type {LoroDoc} */
    doc;
    /** @type {SvelteMap<string, typeof Block>} */
    registry = new SvelteMap();
    /** @type {SvelteMap<string, Component>} */
    components = new SvelteMap();
    /** @type {SvelteMap<string, Block>} */
    blocks = new SvelteMap();
    
    hooks = new Map();
    
    /** @type {Block[]} */
    children = $state([]);
    
    get isEmpty() {
        return this.children.length === 0;
    }

    init() {
        this.hooks.get("onInit")?.forEach(hook => hook(this));
    }

    /**
    * Insère un nouveau bloc dans le document
    * @param {string} type - Le type du bloc (ex: 'paragraph')
    * @param {Object} [props={}] - Les propriétés initiales
    * @param {string|null} [parentId=null] - ID du parent (null pour racine)
    * @param {number|null} [index=null] - Position dans la liste des enfants
    */
    insert(type, props = {}, parentId = null, index = null) {

        const BlockClass = this.registry.get(type);
        if (!BlockClass) {
            throw new Error(`Block type "${type}" not registered.`);
        }
        
        const block = BlockClass.create(this, type, props, parentId, index);
        
        
        this.doc.commit();
        return block;
    }



    /** @param {Block} block */
    delete(block) {
        this.deleteNode(block.node.id);
    }


    /**
     * @param {string} nodeId 
     * @returns 
     */
    deleteNode(nodeId) {
        const block = this.blocks.get(nodeId);
        if (!block) return;
        this.tree.delete(block.node.id);
        this.doc.commit();
    }

    // EVENT HANDLING

    /** @param {InputEvent} e */
    beforeinput(e) {
        e.preventDefault();
        const sel = this.selection;
        if (!sel.anchorBlock) return;

        if (sel.anchorBlock === sel.focusBlock) {
            const handled = sel.anchorBlock.beforeinput?.(e);
            if (handled) {
                e.preventDefault();
                return;
            }
        }

    }
}


