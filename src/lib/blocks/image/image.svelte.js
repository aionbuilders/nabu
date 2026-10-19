import { MediaBlock } from "../media/media-block.svelte.js";
import ImageComponent from "./Image.svelte";
import { escapeHtml, escapeAttr, sanitizeUrl } from "../../utils/html.js";

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
        if (!pb.props?.ref) return pb.props?.alt || ''; // no source (an embedded asset outside Nabu): the alt text only
        return '![' + (pb.props?.alt || '') + '](' + pb.props.ref + ')';
    }

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toHtml(pb) {
        const ref = pb.props?.ref || '';
        const src = sanitizeUrl(ref, { kind: 'media' }); // null for an empty ref too
        const alt = pb.props?.alt || '';
        if (src === null) return alt ? '<p>' + escapeHtml(alt) + '</p>' : ''; // unsafe / empty source: no live <img>
        return '<img src="' + escapeAttr(src) + '" alt="' + escapeAttr(alt) + '">';
    }

    static htmlRules = [
        // `embed`: an <img> inside a paragraph is lifted out as an image block, the text around it stays (paste/html.paste.js).
        { selector: 'img', embed: true },
    ];

    /**
     * @param {Element} el
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromHTML(el) {
        const src = (el.getAttribute('src') || '').trim();
        // No source (a lazy-loaded placeholder) or an unsafe one (javascript:, data:text/html…) never becomes an image block.
        if (!src || sanitizeUrl(src, { kind: 'media' }) === null) return null;
        return {
            type: 'image',
            props: {
                ref: src,
                alt: el.getAttribute('alt') || '',
            },
            partial: false,
        };
    }

    static markdownRules = [
        {
            priority: 25,
            // A line that starts with an image. `fromMarkdown` only accepts a line that IS an image; an image inside
            // text is split out of the paragraph by the paragraph rule.
            detect: /^!\[/,
            consume: () => 1,
        }
    ];

    /**
     * A line that is only an image (`![alt](url "title")`, `![alt][ref]`) becomes an image block; anything else
     * (text around it, unsafe URL) returns null and falls to the paragraph rule.
     * @param {string[]} lines
     * @param {{ parseInlineSegments?: (text: string) => Array<{ image?: { alt: string, ref: string } }> }} [helpers]
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromMarkdown(lines, helpers) {
        if (helpers?.parseInlineSegments) {
            const segments = helpers.parseInlineSegments(lines[0].trim());
            const image = segments.length === 1 ? segments[0].image : undefined;
            return image ? { type: 'image', props: { alt: image.alt, ref: image.ref }, partial: false } : null;
        }
        const m = lines[0].match(/^!\[([^\]]*)\]\(([^)]+)\)/);
        if (!m) return null;
        if (sanitizeUrl(m[2].trim(), { kind: 'media' }) === null) return null; // falls back to a plain paragraph
        return { type: 'image', props: { alt: m[1], ref: m[2] }, partial: false };
    }

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = MediaBlock.createNode(nabu, 'image', props, parentId, index);
        const block = new ImageBlock(nabu, /** @type {ImageNode} */ (/** @type {unknown} */ (node)));
        return block;
    }
}
