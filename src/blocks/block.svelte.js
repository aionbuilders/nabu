/**
 * @import { Nabu, NabuNode } from "./nabu.svelte";
 * @import { MegaBlock } from "./megablock.svelte";
 */

import { tick } from "svelte";
import { SvelteMap } from "svelte/reactivity";


export class Block {
    /** @param {Nabu} nabu @param {NabuNode} node */
    constructor(nabu, node) {
        this.nabu = nabu;
        this.node = node;
        const metadata = node.data;
        this.id = node.id.toString()
        this.type = metadata.get("type") || "block";
        this.nabu.blocks.set(this.id, this);

        const parent = node.parent();
        if (parent) {
            this.parent = this.nabu.blocks.get(parent.id.toString()) || null;
        }
    }

    behaviors = new SvelteMap();
    selected = $state(false);
    isSelectionStart = $state(false);
    isSelectionEnd = $state(false);
    isIntermediate = $derived(this.selected && !this.isSelectionStart && !this.isSelectionEnd);
    
    clearSelection() {
        this.selected = false;
        this.isSelectionStart = false;
        this.isSelectionEnd = false;
    }

    /** @type {{from: number, to: number, direction: "forward" | "backward" | "none"} | null} */
    selection = $derived(null);

    /** @type {MegaBlock | null} */
    parent = $state(null);

    parents = $derived.by(() => {
        const parents = [];
        let current = this.parent;
        while (current) {
            parents.push(current);
            current = current.parent;
        }
        return parents;
    });

    component = $derived(this.nabu.components.get(this.type) || null);

    /** @type {HTMLElement | null} */
    element = $state(null);


    /** @param {(block: Block) => boolean} predicate @returns {Block | null} */
    findForward(predicate) {
        const parent = this.parent || this.nabu;
        const i = parent?.children.indexOf(this) ?? -1;
        if (i === -1) return null;
        // On traverse les frères suivants
        for (let j = i + 1; j < (parent?.children.length ?? 0); j++) {
            const found = parent?.children[j];
            if (found && predicate(found)) {
                return found;
            } else if (found && found.children?.length) {
                // Si c'est un MegaBlock, on cherche récursivement dedans
                const foundInChild = found.findForward(predicate);
                if (foundInChild) return foundInChild;
            }
        }
        // Si pas trouvé, on remonte dans les parents et on recommence
        if (this.parent) {
            return this.parent.findForward(predicate);
        }
        return null;
    }

    /** @param {(block: Block) => boolean} predicate @returns {Block | null} */
    findBackward(predicate) {
        const parent = this.parent || this.nabu;
        const i = parent?.children.indexOf(this) ?? -1;
        console.log("findBackward in block", this.id, "with predicate", predicate, "parent:", parent?.id, "index in parent:", i);
        if (i === -1) return null;
        // On traverse les frères précédents
        for (let j = i - 1; j >= 0; j--) {
            const found = parent?.children[j];
            if (found && predicate(found)) {
                return found;
            } else if (found && found.children?.length) {
                // Si c'est un MegaBlock, on cherche récursivement dedans (en partant de la fin)
                const foundInChild = found.findBackward(predicate);
                if (foundInChild) return foundInChild;
            }
        }
        // Si pas trouvé, on remonte dans les parents et on recommence
        if (this.parent) {
            return this.parent.findBackward(predicate);
        }
        return null;
    }

    destroy() {
        this.nabu.delete(this);
    }

    /**
     * Transforme ce bloc en un autre type de bloc.
     * @param {string} newType 
     * @param {Object} [props={}] 
     */
    transformTo(newType, props = {}) {
        console.log(`Transforming block ${this.id} from ${this.type} to ${newType}`, props);
        const data = this.node.data;
        data.set("type", newType);
        for (const [key, value] of Object.entries(props)) {
            data.set(key, value);
        }
        this.commit();
    }

    /** @param {number} index @param {string} text */
    insert(index, text) {
        console.warn("Not implemented: insert text", text, "at index", index, "in block", this.id);
    }

    /** @param {{from?: number, to?: number, index?: number, length?: number}} [deletion] */
    delete(deletion) {
        console.warn("Not implemented: delete block", this.id, "with deletion range", deletion);
    }

    /** @param {Block} block */
    mergeWith(block) {
        console.warn("Not implemented: merge block", this.id, "with block", block.id);
    }

    /** @param {{from?: number, to?: number, index?: number, length?: number, offset?: number}} options @returns {{block: Block} | null} */
    split(options) {
        console.warn("Not implemented: split block", this.id, "with options", options);
        return null;
    }

    /** @param {{start?: number, end?: number, offset?: number}} options @param {boolean} [passive=false] */
    focus(options = {}, passive = false) {
        let start = options.start ?? options.offset ?? this.selection?.from ?? 0;
        let end = options.end ?? options.offset ?? this.selection?.to ?? 0;
        const startPoint = this.getDOMPoint(start);
        const endPoint = this.getDOMPoint(end);
        if (!passive && startPoint && endPoint) {
            tick().then(() => {
                console.log("REFOCUS");
                this.nabu.selection.setBaseAndExtent(startPoint.node, startPoint.offset || 0, endPoint.node || null, endPoint.offset || 0)
            })
        }

        return {start: startPoint, end: endPoint, options: {startOffset: start, endOffset: end}};
    } 

    /** 
     * @param {number} offset
     * @returns {{node: Node, offset: number} | null}
     */
    getDOMPoint(offset) {
        console.warn("getDOMPoint not implemented for block", this.type, this.id);
        return null;
    }

    // -- Event Handling --

    /** @param {string} eventName @param {Event} event @param {Object} [data={}] */
    ascend(eventName, event, data = {}) {
        //@ts-ignore
        if (this.parent && typeof this.parent[eventName] === "function") {
            //@ts-ignore
            return this.parent[eventName](event, { ...data, from: this });
        }

        // 2. On essaye les hooks d'extensions enregistrés dans Nabu
        const hooks = this.nabu.hooks.get(eventName);
        if (hooks) {
            for (const hook of hooks) {

                // Si un hook retourne 'true', on considère l'événement géré
                const result = hook(this.nabu, this, event, data);
                if (result) return result;
            }
        }

        return false;
    }

    /** @param {InputEvent} event @returns {any} */
    beforeinput(event) {
        // On peut intercepter les événements d'input ici pour faire des choses comme :
    }



    // -- UTILS --

    commit() {
        console.log("Committing changes in block", this.id);
        this.nabu.doc.commit();
    }


    /** @param {Nabu} nabu @param {NabuNode} node */
    static load(nabu, node) {
        const metadata = node.data;
        const type = metadata.get("type") || "block";
        const BlockClass = nabu.registry.get(type) || Block;
        const block = new BlockClass(nabu, node);
        return block;
    }

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(parentId || undefined, index || undefined);
        node.data.set("type", type);
        const block = Block.load(nabu, node);
        return block;
    }

}
