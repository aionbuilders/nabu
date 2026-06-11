import { TextBlock } from "../text-block.svelte.js";
import { LoroText } from "loro-crdt";
import DialogueComponent from "./Dialogue.svelte";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

/**
 * @typedef {NabuNode<{type: "dialogue", text: LoroText}>} DialogueNode
 */

export class Dialogue extends TextBlock {
    /** @param {Nabu} nabu @param {DialogueNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        this.serializers.set('markdown', () => `— ${this.behavior.toMarkdown()}`);
        this.serializers.set('json', () => ({
            id: this.id,
            type: 'dialogue',
            content: this.behavior.toJSON()
        }));
        this.serializers.set('application/x-nabu+json', (ctx) => this.behavior.toClipboardBlock(ctx));
    }

    component = $derived(this.nabu.components.get("dialogue") || DialogueComponent);

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
