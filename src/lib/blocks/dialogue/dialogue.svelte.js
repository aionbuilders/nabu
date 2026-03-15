import { Block } from "../block.svelte.js";
import { LoroText } from "loro-crdt";
import DialogueComponent from "./Dialogue.svelte";
import { TextBehavior } from "../../behaviors/text";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

/**
 * @typedef {NabuNode<{type: "dialogue", text: LoroText}>} DialogueNode
 */

export class Dialogue extends Block {
    /** @param {Nabu} nabu @param {DialogueNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        const data = node.data;
        this.container = data.get("text") ?? data.setContainer("text", new LoroText());

        /** @type {TextBehavior} */
        this.behavior = new TextBehavior(this, this.container);
        this.behaviors.set("text", this.behavior);

        this.serializers.set('markdown', () => `— ${this.behavior.toMarkdown()}`);
        this.serializers.set('json', () => ({
            id: this.id,
            type: 'dialogue',
            content: this.behavior.toJSON()
        }));
    }

    component = $derived(this.nabu.components.get("dialogue") || DialogueComponent);

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
    getDOMPoint(targetOffset) {
        if (!this.element) return null;
        return this.behavior.getDOMPoint(targetOffset);
    }

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
        node.data.set("type", "dialogue");
        const container = node.data.setContainer("text", new LoroText());
        if (props.text) container.insert(0, props.text);
        if (props.delta) container.applyDelta([...props.delta]);
        const block = new Dialogue(nabu, node);
        return block;
    }
}
