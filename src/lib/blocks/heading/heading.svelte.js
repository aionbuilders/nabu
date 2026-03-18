import { TextBehavior, deltaToHtml, deltaToMarkdown } from "../../behaviors/text";
import HeadingComponent from "./Heading.svelte";
import { Block } from "../block.svelte.js";
import { LoroText } from "loro-crdt";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
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
        this.serializers.set('application/x-nabu+json', (ctx) => this.behavior.toClipboardBlock({ ...ctx, props: { level: this.level } }));
        
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

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toMarkdown(pb) {
        const level = pb.props?.level ?? 1;
        return `${'#'.repeat(level)} ${deltaToMarkdown(pb.delta || [])}`;
    }

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toHtml(pb) {
        const level = pb.props?.level ?? 1;
        return `<h${level}>${deltaToHtml(pb.delta || [])}</h${level}>`;
    }

    static markdownRules = [
        {
            priority: 10,
            detect: /^#{1,6} /,
            consume: () => 1,
        }
    ];

    /**
     * @param {string[]} lines
     * @param {{ parseInline: (text: string) => import('loro-crdt').Delta<string>[] }} helpers
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromMarkdown(lines, { parseInline }) {
        const m = lines[0].match(/^(#{1,6})\s+(.*)/);
        if (!m) return null;
        const delta = parseInline(m[2]);
        if (!delta.length) return null;
        return { type: 'heading', props: { level: m[1].length }, delta, partial: false };
    }

    static htmlRules = [
        { selector: 'h1', props: { level: 1 } },
        { selector: 'h2', props: { level: 2 } },
        { selector: 'h3', props: { level: 3 } },
        { selector: 'h4', props: { level: 4 } },
        { selector: 'h5', props: { level: 5 } },
        { selector: 'h6', props: { level: 6 } },
    ];

    /**
     * @param {Element} el
     * @param {{ parseInline: (el: Element) => import('loro-crdt').Delta<string>[] }} helpers
     * @param {{ props?: { level?: number } }} [rule]
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromHTML(el, { parseInline }, rule) {
        const delta = parseInline(el);
        if (!delta.length) return null;
        return { type: 'heading', props: { level: rule?.props?.level ?? 1 }, delta, partial: false };
    }

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
