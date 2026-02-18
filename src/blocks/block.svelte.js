/**
 * @import { Nabu, NabuNode } from "./nabu.svelte";
 * @import { MegaBlock } from "./megablock.svelte";
 */


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

    selected = $state(false);

    /** @type {{from: number, to: number, direction: "forward" | "backward" | "none"} | null} */
    selection = $derived(null);

    /** @type {MegaBlock | null} */
    parent = $state(null);

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
                if (hook(this.nabu, this, event, data)) return true;
            }
        }

        return false;
    }

    /** @param {InputEvent} event @returns {any} */
    beforeinput(event) {
        // On peut intercepter les événements d'input ici pour faire des choses comme :
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
