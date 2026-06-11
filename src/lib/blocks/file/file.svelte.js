// @ts-ignore
import { MediaBlock } from "../media/media-block.svelte.js";
import FileComponent from "./File.svelte";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

/**
 * Void file (attachment) block. Extends MediaBlock for shared void/metadata behavior.
 * Renders as a downloadable chip — not an inline media preview.
 */
// @ts-ignore — static-side variance on create()
export class FileBlock extends MediaBlock {
    /** @param {Nabu} nabu @param {NabuNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        this.serializers.set('markdown', () => '[' + (this.name || 'file') + '](' + this.ref + ')');
        this.serializers.set('json', () => ({
            id: this.id,
            type: 'file',
            props: { ref: this.ref, name: this.name },
        }));
        this.serializers.set('application/x-nabu+json', () => ({
            type: 'file',
            props: { ref: this.ref, name: this.name },
            partial: false,
        }));
    }

    component = $derived(this.nabu.components.get("file") || FileComponent);

    // ── Statics ──────────────────────────────────────────────────────────────

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toMarkdown(pb) {
        return '[' + (pb.props?.name || 'file') + '](' + (pb.props?.ref || '') + ')';
    }

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toHtml(pb) {
        return '<a href="' + (pb.props?.ref || '') + '" download="' + (pb.props?.name || '') + '">' + (pb.props?.name || 'file') + '</a>';
    }

    static htmlRules = [
        { selector: 'a[download]', priority: 10 },
    ];

    /**
     * @param {Element} el
     * @returns {import('../../utils/extensions.js').PasteBlock}
     */
    static fromHTML(el) {
        return {
            type: 'file',
            props: {
                ref: el.getAttribute('href') || '',
                name: el.getAttribute('download') || el.textContent || '',
            },
            partial: false,
        };
    }

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = MediaBlock.createNode(nabu, 'file', props, parentId, index);
        const block = new FileBlock(nabu, /** @type {any} */ (node));
        return block;
    }
}
