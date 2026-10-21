// @ts-ignore
import { MediaBlock } from "../media/media-block.svelte.js";
import { markdownMediaLink } from "../media/markdown.js";
import VideoComponent from "./Video.svelte";
import { escapeHtml, escapeAttr, sanitizeUrl } from "../../utils/html.js";

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

        this.serializers.set('markdown', () => VideoBlock.toMarkdown({ type: 'video', partial: false, props: this.exportProps }));
        this.serializers.set('json', () => ({
            id: this.id,
            type: 'video',
            props: this.exportProps,
        }));
        this.serializers.set('application/x-nabu+json', () => ({
            type: 'video',
            props: { ref: this.ref, alt: this.alt, name: this.name, ...this.clipboardState },
            partial: false,
        }));
    }

    component = $derived(this.nabu.components.get("video") || VideoComponent);

    // ── Statics ──────────────────────────────────────────────────────────────

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toMarkdown(pb) {
        if (!pb.props?.ref) return pb.props?.alt || pb.props?.name || ''; // no source: the label only
        return markdownMediaLink(pb.props?.alt || pb.props?.name || 'video', pb.props.ref);
    }

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toHtml(pb) {
        const ref = pb.props?.ref || '';
        const src = sanitizeUrl(ref, { kind: 'media' }); // null for an empty ref too
        const label = pb.props?.alt || pb.props?.name || '';
        if (src === null) return label ? '<p>' + escapeHtml(label) + '</p>' : ''; // no live <video> without a source
        return '<video src="' + escapeAttr(src) + '" controls></video>';
    }

    static htmlRules = [
        { selector: 'video', embed: true },
    ];

    /**
     * @param {Element} el
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromHTML(el) {
        const src = el.getAttribute('src') || el.querySelector('source')?.getAttribute('src') || '';
        if (src && sanitizeUrl(src, { kind: 'media' }) === null) return null;
        return {
            type: 'video',
            props: {
                ref: src,
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
