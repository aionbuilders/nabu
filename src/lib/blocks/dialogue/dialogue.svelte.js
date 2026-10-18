import { TextBlock } from "../text-block.svelte.js";
import { LoroText } from "loro-crdt";
import DialogueComponent from "./Dialogue.svelte";
import { deltaToMarkdown } from "../../behaviors/text";

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

        this.serializers.set('markdown', () => `${this.dash} ${this.behavior.toMarkdown()}`);
        this.serializers.set('json', () => ({
            id: this.id,
            type: 'dialogue',
            content: this.behavior.toJSON()
        }));
        this.serializers.set('application/x-nabu+json', (ctx) => this.behavior.toClipboardBlock(ctx));
    }

    static placeholder = 'Dialogue...';

    /**
     * Dialogue marker: shown in front of the line (CSS `::before`, see `--nb-dialogue-dash`) and written by the
     * markdown export. Overridden by `createDialogueExtension({ dash })`, which registers a subclass.
     * Markdown import / paste recognizes both `–` and `—` whatever this is.
     */
    static dash = '–';

    /** @returns {string} */
    get dash() { return /** @type {typeof Dialogue} */ (this.constructor).dash; }

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toMarkdown(pb) {
        return `${this.dash} ${deltaToMarkdown(pb.delta || [])}`;
    }

    static markdownRules = [
        {
            priority: 10,
            detect: /^[–—] /,
            consume: () => 1,
        }
    ];

    /**
     * @param {string[]} lines
     * @param {{ parseInline: (text: string) => import('loro-crdt').Delta<string>[] }} helpers
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromMarkdown(lines, { parseInline }) {
        const m = lines[0].match(/^[–—]\s+(.*)/);
        if (!m) return null;
        const delta = parseInline(m[1]);
        if (!delta.length) return null;
        return { type: 'dialogue', delta, partial: false };
    }

    component = $derived(this.nabu.components.get("dialogue") || DialogueComponent);

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(parentId || undefined, index ?? undefined);
        node.data.set("type", "dialogue");
        const container = node.data.setContainer("text", new LoroText());
        if (props.text) container.insert(0, props.text);
        if (props.delta) container.applyDelta([...props.delta]);
        // The registered class: a configured subclass (see createDialogueExtension) must be the one instantiated.
        /** @type {any} */
        const BlockClass = nabu.registry.get("dialogue") || Dialogue;
        const block = new BlockClass(nabu, node);
        return block;
    }
}
