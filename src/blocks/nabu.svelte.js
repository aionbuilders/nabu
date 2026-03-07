import { LoroDoc } from 'loro-crdt';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
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
        
        this.tree.subscribe((event) => {
            event.events.forEach(e => {
                if (e.diff.type === "tree") {
                    e.diff.diff.forEach(action => {
                        if (action.action === 'create' || action.action === 'move' || action.action === 'delete') {
                            if (action.parent) {
                                const parentId = action.parent.toString();
                                const parentBlock = this.blocks.get(parentId);
                                if (parentBlock) parentBlock.updateChildren();
                            } else {
                                this.updateRoots();
                            }

                            if (action.oldParent) {
                                const oldParentId = action.oldParent.toString();
                                const oldParentBlock = this.blocks.get(oldParentId);
                                if (oldParentBlock) oldParentBlock.updateChildren();
                            }
                        }
                    })
                }

                if (e.diff.type === "map") {
                    
                    const newType = e.diff.updated["type"];
                    if (newType !== undefined) {
                        const nodeId = e.path[1].toString();
                        const block = this.blocks.get(nodeId);
                        if (block && block.type !== newType) {
                            if (block.parent) block.parent.updateChildren();
                            else this.updateRoots();
                        }
                    }
                }
            })
        });
        
        this.init();
    }
    
    static BREAK = Symbol("BREAK");
    static CONTINUE = Symbol("CONTINUE");
    BREAK = Nabu.BREAK;
    CONTINUE = Nabu.CONTINUE;
    
    /** @type {LoroDoc} */
    doc;
    /** @type {SvelteMap<string, typeof Block>} */
    registry = new SvelteMap();
    /** @type {SvelteMap<string, Component>} */
    components = new SvelteMap();
    /** @type {SvelteMap<string, Block>} */
    blocks = new SvelteMap();

    /** @type {SvelteMap<string, SvelteSet<Block>>} */
    blocksByType = new SvelteMap();

    /** @type {SvelteMap<string, any>} */
    systems = new SvelteMap();
    
    hooks = new Map();
    
    /** @type {Block[]} */
    children = $state([]);
    
    get isEmpty() {
        return this.children.length === 0;
    }
    
    init() {
        this.hooks.get("onInit")?.forEach(hook => hook(this));
    }

    /** Rafraîchit les blocs racines de l'éditeur */
    updateRoots() {
        const roots = /** @type {NabuNode[]} */ (this.tree.roots());
        this.children = roots.map((root, i) => {
            const id = root.id.toString();
            let block = this.blocks.get(id);
            const currentType = root.data.get("type");
            
            if (!block || block.type !== currentType) {
                if (block) {
                    this.blocks.delete(id);
                    this.blocksByType.get(block.type)?.delete(block);
                }

                block = Block.load(this, root);
            }
            block.index = i;
            block.parent = null;
            return block;
        });
    }

    trigger(hookName, ...args) {
        const hooks = this.hooks.get(hookName) || [];
        for (const hook of hooks) {
            const result = hook(this, ...args);
            if (result === this.BREAK) {
                break;
            }

        }
    }


    commit() {
        this.trigger("onBeforeTransaction", this);
        console.warn("Committing transaction...");
        this.doc.commit();
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
        
        
        this.commit();
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
    }
    
    // EVENT HANDLING

    /** 
     * Route un événement vers le bon bloc en fonction de la sélection courante.
     * @param {string} handlerName - Le nom de la méthode à appeler sur le bloc (ex: 'beforeinput', 'keydown')
     * @param {Event} e - L'événement natif
     * @param {string} [hookName] - Optionnel : Le nom du hook d'extension à vérifier en premier
     */
    dispatchEventToSelection(handlerName, e, hookName) {
        const sel = this.selection;
        if (!sel.anchorBlock || !sel.focusBlock) return;
        
        // 1. Essayer les hooks globaux d'extension d'abord
        if (hookName) {
            const hooks = this.hooks.get(hookName) || [];
            for (const hook of hooks) {
                const handled = hook(this, e, sel.anchorBlock);
                if (handled === this.BREAK) {
                    e.preventDefault();
                    return;
                }
            }
        }
        
        // 2. Trouver la cible et lui déléguer
        let targetBlock = null;
        if (sel.anchorBlock === sel.focusBlock) {
            targetBlock = sel.anchorBlock;
        } else {
            const anchorParents = sel.anchorBlock.parents || [];
            const focusParents = sel.focusBlock.parents || [];
            targetBlock = anchorParents.find(ancestor => focusParents.includes(ancestor)) || this;
        }

        // 3. Appeler la méthode sur le bloc cible s'il la possède
        if (targetBlock && typeof targetBlock[handlerName] === 'function') {
            const handled = targetBlock[handlerName](e);
            if (handled) {
                e.preventDefault();
            }
        }
    }
    
    /** @param {InputEvent} e */
    handleBeforeinput(e) {
        e.preventDefault(); // Toujours bloquer les mutations natives
        this.dispatchEventToSelection('beforeinput', e, 'onBeforeInput');
    }

    /** @param {KeyboardEvent} e */
    handleKeydown(e) {
        this.dispatchEventToSelection('keydown', e, 'onKeyDown');
    }
    
    /** @param {InputEvent} e */
    beforeinput(e) {
        console.log("Nabu beforeinput", e.inputType, e);
        
        
        /** @type {Block} */
        let start;
        /** @type {Block} */
        let end;
        /** @type {Block[]} */
        let intermediates = [];
        this.children.forEach(block => {
            if (!start && block.selected) start = block;
            else if (start && block.isIntermediate) intermediates = [...(intermediates || []), block];
            if (block.selected) end = block;
        });
        if (!start || !end) return;
        const focusData = start.focus(undefined, true);
        console.log("Intermediate blocks in selection:", intermediates);
        if (e.inputType === "deleteContentBackward" || e.inputType === "deleteContentForward") {
            intermediates.forEach(block => block.destroy());
            if (start) start.delete();
            if (end && end !== start) end.delete();
            start?.mergeWith(end);
            this.commit();
            start.focus({offset: focusData.options.startOffset});
        } else if (e.inputType === "insertText" || e.inputType === "insertLineBreak") {
            const textToInsert = e.inputType === "insertText" ? (e.data || "") : "\n";
            intermediates.forEach(block => block.destroy());
            if (start) start.delete();
            if (end && end !== start) end.delete();
            start.insert(focusData.options.startOffset, textToInsert);
            start?.mergeWith(end);
            this.commit();
            start.focus({offset: focusData.options.startOffset + textToInsert.length});
        } else if (e.inputType === "insertParagraph") {
            intermediates.forEach(block => block.destroy());
            if (start) start.delete();
            if (end && end !== start) end.delete();
            const {block: newBlock} = start.split({offset: focusData.options.startOffset}) || {};
            if (!newBlock) return;
            newBlock.mergeWith(end);
            this.commit();
            newBlock.focus({offset: 0});
        }
    }
    
    
}


