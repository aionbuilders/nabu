/**
 * @import { Nabu, NabuNode } from "./nabu.svelte.js";
 * @import { MegaBlock } from "./megablock.svelte.js";
 * @import { VariableInit } from "./variable.svelte.js";
 */

import { tick } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { Variable } from "./variable.svelte.js";
import { resolvePlaceholderText } from "../utils/placeholders.js";


export class Block {
    /** @param {Nabu} nabu @param {NabuNode} node */
    constructor(nabu, node) {
        this.nabu = nabu;
        this.node = node;
        const metadata = node.data;
        this.id = node.id.toString()
        this.type = metadata.get("type") || "block";
        this.nabu.blocks.set(this.id, this);
        const blocksOfType = this.nabu.blocksByType.get(this.type) || new SvelteSet();
        blocksOfType.add(this);
        this.nabu.blocksByType.set(this.type, blocksOfType);
        


        const parent = node.parent();
        if (parent) {
            this.parent = this.nabu.blocks.get(parent.id.toString()) || null;
        }
    }

    /** @type {SvelteMap<string, function(any): void>} */
    serializers = new SvelteMap();
    behaviors = new SvelteMap();
    /** @type {SvelteMap<string, Variable<this>>} */
    variables = new SvelteMap();
    
    /**
     * Declare a variable on this block, which can be used in serializers and behaviors.
     * @param {string} name
     * @param {VariableInit<this>} init
     * @returns {Variable<this>}
     */
    var(name, init) {
        const variable = new Variable(this, name, init);
        return variable;
    }


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

    positions = $derived(0);

    /**
     * Number of words contained in this block. Overridden by text blocks
     * (own text) and containers (sum of children) so that parents can
     * aggregate without re-traversing the whole subtree.
     * @type {number}
     */
    wordCount = $derived(0);

    // ── Capability flags ─────────────────────────────────────────────────────
    // Declarative opt-outs respected centrally by the engine. Default true;
    // override to false in a subclass (e.g. CodeBlock) to disable a behavior.
    /** When false, Enter inserts a literal "\n" in place instead of splitting the block. @type {boolean} */
    splitsOnEnter = true;
    /** When false, onBeforeInput markdown-shortcut hooks and inputRules are skipped in this block. @type {boolean} */
    transformsEnabled = true;
    /** When false, inline marks (bold/italic/...) are never applied to this block. @type {boolean} */
    marksEnabled = true;

    /**
     * Resolve a document-local offset to { block, offset } within this block.
     * Leaf blocks with text return themselves directly.
     * Override in MegaBlock (pure containers) and mixed blocks (e.g. ListItem).
     * @param {number} localOffset
     * @returns {{ block: Block, offset: number } | null}
     */
    resolveOffset(localOffset) {
        return { block: this, offset: localOffset };
    }

    /** @type {MegaBlock | null} */
    parent = $state(null);
    index = $state(0);
    /** @type {Block?} */
    previous = $derived(this.index > 0 && this.parent ? this.parent.children[this.index - 1] : null);
    /** @type {Block?} */
    next = $derived(this.parent && this.index < this.parent.children.length - 1 ? this.parent.children[this.index + 1] : null);

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

    /**
     * Resolved placeholder to render in `data-placeholder` ('' = none). Combines the
     * Nabu `placeholders` option, the block's emptiness and — with `show: 'focus'`
     * (default) — whether it holds the collapsed cursor.
     *
     * The default text is declared by each block class as `static placeholder`
     * (string, `false`, or `(block) => string | false`), overridable per type through
     * the `placeholders.text` option. Blocks without a text behavior never show one.
     * (No `static placeholder` is declared here: Svelte forbids a static and a
     * reactive field with the same name in one class.)
     * @type {string}
     */
    placeholder = $derived.by(() => {
        const config = this.nabu.placeholders;
        if (!config.enabled) return '';
        const text = this.behaviors.get("text");
        if (!text || text.text) return '';
        if (config.show === 'focus') {
            const sel = this.nabu.selection;
            if (!sel.isCollapsed || sel.anchorBlock !== this) return '';
        }
        return resolvePlaceholderText(/** @type {any} */ (this), config.text);
    });

    /** @type {HTMLElement | null} */
    element = $state(null);

    /** @param {(block: Block) => boolean} predicate @returns {Block | null} */
    findForward(predicate) {
        // 1. Chercher dans les enfants (descendre)
        // @ts-ignore
        if (this.children?.length) {
            // @ts-ignore
            for (const child of this.children) {
                if (predicate(child)) return child;
                const found = child.findForward(predicate);
                if (found) return found;
            }
        }

        // 2. Chercher dans les frères suivants et remonter
        let current = this;
        while (current) {
            const parent = current.parent || current.nabu;
            const i = parent.children.indexOf(current);
            if (i !== -1) {
                for (let j = i + 1; j < parent.children.length; j++) {
                    const sibling = parent.children[j];
                    if (predicate(sibling)) return sibling;
                    const found = sibling.findForward(predicate);
                    if (found) return found;
                }
            }
            current = current.parent;
        }
        return null;
    }

    /** @param {(block: Block) => boolean} predicate @returns {Block | null} */
    findBackward(predicate) {
        let current = this;
        while (current) {
            const parent = current.parent || current.nabu;
            const i = parent.children.indexOf(current);
            
            if (i !== -1) {
                // On parcourt les frères précédents de bas en haut
                for (let j = i - 1; j >= 0; j--) {
                    const sibling = parent.children[j];
                    
                    // Si le frère a des enfants, le "précédent" est le DERNIER de ses descendants
                    // @ts-ignore
                    if (sibling.children?.length) {
                        // @ts-ignore
                        const lastDescendant = sibling.findLastDescendant(predicate);
                        if (lastDescendant) return lastDescendant;
                    }
                    
                    if (predicate(sibling)) return sibling;
                }
            }
            
            // Si aucun frère précédent ne match, on teste le parent lui-même
            if (current.parent) {
                if (predicate(current.parent)) return current.parent;
                current = current.parent;
            } else {
                break;
            }
        }
        return null;
    }

    /**
     * Returns real, uncommitted siblings, which is useful for extensions that want to check the document structure before the transaction is committed.
     */
    getAdjacentSiblings() {
        const parent = this.node.parent();
        const siblings = parent ? parent.children() : this.nabu.tree.roots();
        if (!siblings) return { previous: null, next: null };
        
        const index = this.node.index();
        if (index === null || index === undefined) return { previous: null, next: null };
        
        const previousNode = index > 0 ? siblings[index - 1] : null;
        const nextNode = index < siblings.length - 1 ? siblings[index + 1] : null;
        const previous = previousNode ? this.nabu.blocks.get(previousNode.id.toString()) : null;
        const next = nextNode ? this.nabu.blocks.get(nextNode.id.toString()) : null;

        return {
            previous,
            next,
            previousNode,
            nextNode
        };
    }

    /** 
     * Helper pour trouver le dernier descendant profond qui matche
     * @param {(block: Block) => boolean} predicate 
     * @returns {Block | null} 
     */
    findLastDescendant(predicate) {
        // @ts-ignore
        const children = this.children || [];
        for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i];
            const found = child.findLastDescendant(predicate);
            if (found) return found;
            if (predicate(child)) return child;
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
        this.retype(newType, props);
        this.commit();
    }

    /**
     * The mutations of a type change, without the commit: the caller owns the transaction
     * (`transformTo`, the `block:transform` action…). By default the block is retyped IN PLACE (same node:
     * its id, text and position survive). Override it when a block cannot simply change type where it
     * stands (e.g. because its parent only accepts some children): do the same job with Loro mutations only.
     * @param {string} newType
     * @param {Object} [props={}]
     */
    retype(newType, props = {}) {
        const data = this.node.data;
        data.set("type", newType);
        for (const [key, value] of Object.entries(props)) {
            data.set(key, value);
        }
    }

    /** @param {number} index @param {string} text */
    insert(index, text) {
        this.nabu.warn("Not implemented: insert text", text, "at index", index, "in block", this.id);
    }

    /** @param {{from?: number, to?: number, index?: number, length?: number}} [deletion] */
    delete(deletion) {
        this.nabu.warn("Not implemented: delete block", this.id, "with deletion range", deletion);
    }

    /** @param {Block} block @returns {any} */
    absorbs(block) {
        this.nabu.warn("Not implemented: check if block", this.id, "absorbs block", block.id);
        return false;
    }


    /** @param {Block} block @returns {any} */
    mergeWith(block) {
        const success = this.absorbs(block);
        if (success) {
            block.destroy();
            return true;
        }
        return false;
    }

    /**
     * Consumes another block, handling children relocation intelligently.
     * @param {Block} otherBlock - The block to consume or be consumed by
     * @param {'into' | 'from'} direction - 'into' = this merges into other, 'from' = other merges into this
     * @returns {Block} The surviving block
     */
    consume(otherBlock, direction = 'from') {
        const [survivor, victim] = direction === 'into'
            ? [otherBlock, this]
            : [this, otherBlock];

        const absorbed = survivor.absorbs(victim);

        // Handle children relocation if victim has any
        // @ts-ignore - MegaBlock has children
        if (victim.children?.length) {
            // @ts-ignore - adoptChildren only exists on MegaBlock, not on Block base class
            if (absorbed && survivor.adoptChildren) {
                // MegaBlock survivor adopts children
                // @ts-ignore
                survivor.adoptChildren(victim.children);
            } else {
                // Non-MegaBlock survivor: promote children as siblings after survivor.
                // Reverse to preserve original order (each moveAfter inserts right after
                // survivor, so forward iteration would reverse the result).
                // @ts-ignore
                [...victim.children].reverse().forEach(child => {
                    child.node.moveAfter(survivor.node);
                });
            }
        }

        // Handle the victim block itself if not absorbed
        if (!absorbed) {
            victim.node.moveAfter(survivor.node);
        }

        return survivor;
    }

    /**
     * Declares a required parent type for structural integrity.
     * Override in subclasses (e.g. ListItem requires a "list" parent).
     * Used by wrapOrphan() after block relocations.
     * @returns {{ type: string, props: () => Record<string, any> } | null}
     */
    get requiredParent() { return null; }

    /** @param {{from?: number, to?: number, index?: number, length?: number, offset?: number}} options @returns {{block: Block} | null} */
    split(options) {
        this.nabu.warn("Not implemented: split block", this.id, "with options", options);
        return null;
    }

    /** @param {{start?: number, end?: number, offset?: number} | null } options @param {boolean} [passive=false] */
    focus(options = {}, passive = false) {
        let start = options?.start ?? options?.offset ?? this.selection?.from ?? 0;
        let end = options?.end ?? options?.offset ?? this.selection?.to ?? 0;
        const startPoint = this.getDOMPoint(start);
        const endPoint = this.getDOMPoint(end);
        if (!passive && startPoint && endPoint) {
            tick().then(() => {
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
        this.nabu.warn("getDOMPoint not implemented for block", this.type, this.id);
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

    /** @param {KeyboardEvent} event @returns {any} */
    keydown(event) {
        // Intercepter les touches spéciales (Tab, Enter, flèches)
    }

    // -- UTILS --

    commit() {
        return this.nabu.commit();
    }


    /** @param {string} format @param {Record<string, any>} [context] */
    serialize(format, context = {}) {
        const serializer = this.serializers.get(format);
        if (serializer) {
            return serializer(context);
        } else {
            this.nabu.warn(`No serializer found for format "${format}" on block type "${this.type}"`);
            return null;
        }
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
