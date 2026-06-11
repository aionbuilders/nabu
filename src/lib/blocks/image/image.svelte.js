import { MediaBlock } from "../media/media-block.svelte.js";
import ImageComponent from "./Image.svelte";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

/**
 * @typedef {NabuNode<{type: "image", ref: string, alt: string, status: string}>} ImageNode
 */

/**
 * Void image block. Extends MediaBlock for shared void/metadata behavior.
 * No editable text — renders an inert <figure> with a single cursor position.
 */
// @ts-ignore — static-side variance on create()
export class ImageBlock extends MediaBlock {
    /** @param {Nabu} nabu @param {ImageNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        this.serializers.set('markdown', () => '![' + this.alt + '](' + this.ref + ')');
        this.serializers.set('json', () => ({
            id: this.id,
            type: 'image',
            props: { ref: this.ref, alt: this.alt },
        }));
        this.serializers.set('application/x-nabu+json', () => ({
            type: 'image',
            props: { ref: this.ref, alt: this.alt },
            partial: false,
        }));
    }

    component = $derived(this.nabu.components.get("image") || ImageComponent);

    // ── Statics ──────────────────────────────────────────────────────────────

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toMarkdown(pb) {
        return '![' + (pb.props?.alt || '') + '](' + (pb.props?.ref || '') + ')';
    }

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toHtml(pb) {
        return '<img src="' + (pb.props?.ref || '') + '" alt="' + (pb.props?.alt || '') + '">';
    }

    static htmlRules = [
        { selector: 'img' },
    ];

    /**
     * @param {Element} el
     * @returns {import('../../utils/extensions.js').PasteBlock}
     */
    static fromHTML(el) {
        return {
            type: 'image',
            props: {
                ref: el.getAttribute('src') || '',
                alt: el.getAttribute('alt') || '',
            },
            partial: false,
        };
    }

    static markdownRules = [
        {
            priority: 25,
            detect: /^!\[[^\]]*\]\([^)]+\)/,
            consume: () => 1,
        }
    ];

    /**
     * @param {string[]} lines
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromMarkdown(lines) {
        const m = lines[0].match(/^!\[([^\]]*)\]\(([^)]+)\)/);
        if (!m) return null;
        return { type: 'image', props: { alt: m[1], ref: m[2] }, partial: false };
    }

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = MediaBlock.createNode(nabu, 'image', props, parentId, index);
        const block = new ImageBlock(nabu, /** @type {ImageNode} */ (/** @type {unknown} */ (node)));
        return block;
    }
}
