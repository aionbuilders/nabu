// @ts-ignore
import { MediaBlock } from "../media/media-block.svelte.js";
import VideoComponent from "./Video.svelte";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

/**
 * Void video block. Extends MediaBlock for shared void/metadata behavior.
 * Renders an inert <figure> with a <video> element.
 */
// @ts-ignore — static-side variance on create()
export class VideoBlock extends MediaBlock {
    /** @param {Nabu} nabu @param {NabuNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        this.serializers.set('markdown', () => '[' + (this.alt || this.name || 'video') + '](' + this.ref + ')');
        this.serializers.set('json', () => ({
            id: this.id,
            type: 'video',
            props: { ref: this.ref, alt: this.alt, name: this.name },
        }));
        this.serializers.set('application/x-nabu+json', () => ({
            type: 'video',
            props: { ref: this.ref, alt: this.alt, name: this.name },
            partial: false,
        }));
    }

    component = $derived(this.nabu.components.get("video") || VideoComponent);

    // ── Statics ──────────────────────────────────────────────────────────────

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toMarkdown(pb) {
        return '[' + (pb.props?.alt || pb.props?.name || 'video') + '](' + (pb.props?.ref || '') + ')';
    }

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toHtml(pb) {
        return '<video src="' + (pb.props?.ref || '') + '" controls></video>';
    }

    static htmlRules = [
        { selector: 'video' },
    ];

    /**
     * @param {Element} el
     * @returns {import('../../utils/extensions.js').PasteBlock}
     */
    static fromHTML(el) {
        return {
            type: 'video',
            props: {
                ref: el.getAttribute('src') || el.querySelector('source')?.getAttribute('src') || '',
                alt: '',
            },
            partial: false,
        };
    }

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = MediaBlock.createNode(nabu, 'video', props, parentId, index);
        const block = new VideoBlock(nabu, /** @type {any} */ (node));
        return block;
    }
}
