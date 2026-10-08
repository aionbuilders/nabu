import { TextBlock } from "../text-block.svelte.js";
import { LoroText } from "loro-crdt";
import BlockquoteComponent from "./Blockquote.svelte";
import { deltaToHtml, deltaToMarkdown } from "../../behaviors/text";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

/**
 * @typedef {NabuNode<{type: "blockquote", text: LoroText}>} BlockquoteNode
 */

// @ts-ignore — static-side variance on create() (same pattern as Paragraph/Heading)
export class BlockquoteBlock extends TextBlock {
    /** @param {Nabu} nabu @param {BlockquoteNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        this.serializers.set('markdown', () => `> ${this.behavior.toMarkdown()}`);
        this.serializers.set('json', () => ({
            id: this.id,
            type: 'blockquote',
            content: this.behavior.toJSON()
        }));
        this.serializers.set('application/x-nabu+json', (ctx = {}) => this.behavior.toClipboardBlock(ctx));
    }

    static placeholder = 'Quote...';

    component = $derived(this.nabu.components.get("blockquote") || BlockquoteComponent);

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toMarkdown(pb) {
        return `> ${deltaToMarkdown(pb.delta || [])}`;
    }

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toHtml(pb) {
        return `<blockquote>${deltaToHtml(pb.delta || [])}</blockquote>`;
    }

    static markdownRules = [
        {
            priority: 10,
            detect: /^> /,
            consume(/** @type {string[]} */ lines, /** @type {number} */ i) {
                let j = i;
                while (j < lines.length && /^> ?/.test(lines[j])) j++;
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
        const text = lines.map(line => line.replace(/^> ?/, '')).join('\n');
        const delta = parseInline(text);
        if (!delta.length) return null;
        return { type: 'blockquote', delta, partial: false };
    }

    // priority 10 wins over Paragraph's fallback `blockquote` selector
    static htmlRules = [
        { selector: 'blockquote', priority: 10 },
    ];

    /**
     * @param {Element} el
     * @param {{ parseInline: (el: Element) => import('loro-crdt').Delta<string>[] }} helpers
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromHTML(el, { parseInline }) {
        const delta = parseInline(el);
        if (!delta.length) return null;
        return { type: 'blockquote', delta, partial: false };
    }

    /** @param {Nabu} nabu @param {string} type @param {{text?: string, delta?: import('loro-crdt').Delta<string>[]}} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(/** @type {any} */ (parentId || undefined), index || undefined);
        /** @type {any} */ (node.data).set("type", "blockquote");
        const container = /** @type {any} */ (node.data).setContainer("text", new LoroText());
        if (props.text) container.insert(0, props.text);
        if (props.delta) container.applyDelta([...props.delta]);
        const block = new BlockquoteBlock(nabu, /** @type {BlockquoteNode} */ (/** @type {unknown} */ (node)));
        return block;
    }
}
