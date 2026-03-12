import { TextBehavior } from "../../behaviors/text";
import HeadingComponent from "./Heading.svelte";
import { Block } from "../block.svelte";
import { LoroText } from "loro-crdt";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte";
 * @import { TextNode } from "../../behaviors/text";
 */

/**
 * @typedef {NabuNode<{type: "heading", text: LoroText, level: number}>} HeadingNode
 */

export class Heading extends Block {
    /** @param {Nabu} nabu @param {HeadingNode} node */
    constructor(nabu, node) {
        super(nabu, node);
        const data = node.data;
        this.container = data.get("text") ?? data.setContainer("text", new LoroText());

        /** @type {TextBehavior} */
        this.behavior = new TextBehavior(this, this.container);
        this.behaviors.set("text", this.behavior);

        this.level = data.get("level") || 1;

        this.serializers.set('markdown', () => `${'#'.repeat(this.level)} ${this.behavior.toMarkdown()}`);
        this.serializers.set('json', () => ({
            id: this.id,
            type: 'heading',
            props: { level: this.level },
            content: this.behavior.toJSON()
        }));
        
        // Synchronisation du niveau
        this.node.data.subscribe(() => {
            this.level = this.node.data.get("level") || 1;
        });
    }

    /** @type {number} */
    level = $state(1);

    component = $derived(this.nabu.components.get("heading") || HeadingComponent);
    
    get text() {
        return this.behavior.text;
    }

    get delta() {
        return this.behavior.delta;
    }

    selection = $derived(this.behavior.selection);

    /** @param {InputEvent} event */
    beforeinput(event) {
        return this.behavior.handleBeforeInput(event);
    }

    /**
     * @param {number} targetOffset 
     * @returns {{node: Node, offset: number} | null}
     */
    getDOMPoint(targetOffset) { return this.behavior.getDOMPoint(targetOffset); }

    /** @param {Block} block */
    absorbs(block) { return this.behavior.absorbs(block); }

    /** @param {number} index @param {string} text */
    insert(index, text) { return this.behavior.insert(index, text); }
    
    /** @param {Parameters<Block["delete"]>[0]} [deletion] */
    delete(deletion) { return this.behavior.delete(deletion); }

    /** @param {import('loro-crdt').Delta<string>[]} data */
    applyDelta(data = []) { return this.behavior.applyDelta(data); }

    /** @param {Parameters<Block["split"]>[0]} [options] @returns {ReturnType<Block["split"]>} */
    split(options) { return this.behavior.split(options); }

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(parentId || undefined, index || undefined);
        node.data.set("type", "heading");
        node.data.set("level", props.level || 1);
        const container = node.data.setContainer("text", new LoroText());
        if (props.text) container.insert(0, props.text);
        if (props.delta) container.applyDelta([...props.delta]);
        const block = new Heading(nabu, node);
        return block;
    }
}
