import { Block } from "../block.svelte.js";
import { LoroText } from "loro-crdt";
import ParagraphComponent from "./Paragraph.svelte";
import { TextBehavior, deltaToHtml, deltaToMarkdown } from "../../behaviors/text";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

/**
 * @typedef {NabuNode<{type: "paragraph", text: LoroText}>} ParagraphNode
 */

export class Paragraph extends Block {
    /** @param {Nabu} nabu @param {ParagraphNode} node */
    constructor(nabu, node) {
        super(nabu, node);
        
        const data = node.data;
        this.container = data.get("text") ?? data.setContainer("text", new LoroText());

        /** @type {TextBehavior} */
        this.behavior = new TextBehavior(this, this.container);
        this.behaviors.set("text", this.behavior);

        this.serializers.set('markdown', () => this.behavior.toMarkdown());
        this.serializers.set('json', () => ({
            id: this.id,
            type: 'paragraph',
            content: this.behavior.toJSON()
        }));
        this.serializers.set('application/x-nabu+json', (ctx = {}) => this.behavior.toClipboardBlock(ctx));
    }

    component = $derived(this.nabu.components.get("paragraph") || ParagraphComponent);
    
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
     * Retrouve le nœud texte et l'offset DOM pour un offset Modèle donné
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

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toMarkdown(pb) {
        return deltaToMarkdown(pb.delta || []);
    }

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toHtml(pb) {
        return `<p>${deltaToHtml(pb.delta || [])}</p>`;
    }

    static markdownRules = [
        {
            priority: 0, // catch-all — must be lowest
            detect: () => true,
            consume(/** @type {string[]} */ lines, /** @type {number} */ i) {
                let j = i;
                while (j < lines.length && lines[j].trim()) j++;
                return Math.max(1, j - i);
            },
        }
    ];

    /**
     * @param {string[]} lines
     * @param {{ parseInline: (text: string) => import('loro-crdt').Delta<string>[] }} helpers
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromMarkdown(lines, { parseInline }) {
        const delta = parseInline(lines.join(' '));
        if (!delta.length) return null;
        return { type: 'paragraph', delta, partial: false };
    }

    static htmlRules = [
        { selector: 'p' },
        { selector: 'blockquote' },
        { selector: 'pre' },
    ];

    /**
     * @param {Element} el
     * @param {{ parseInline: (el: Element) => import('loro-crdt').Delta<string>[] }} helpers
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromHTML(el, { parseInline }) {
        const delta = parseInline(el);
        if (!delta.length) return null;
        return { type: 'paragraph', delta, partial: false };
    }

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(parentId || undefined, index || undefined);
        node.data.set("type", "paragraph");
        const container = node.data.setContainer("text", new LoroText());
        if (props.text) container.insert(0, props.text || "Start writing...");
        if (props.delta) container.applyDelta([...props.delta]);
        const block = new Paragraph(nabu, node);
        return block;
    }
}