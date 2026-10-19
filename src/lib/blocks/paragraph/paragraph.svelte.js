import { TextBlock } from "../text-block.svelte.js";
import { LoroText } from "loro-crdt";
import ParagraphComponent from "./Paragraph.svelte";
import { deltaToHtml, deltaToMarkdown } from "../../behaviors/text";
import { tableToRowParagraphs } from "./table.html.js";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

/**
 * @typedef {NabuNode<{type: "paragraph", text: LoroText}>} ParagraphNode
 */

export class Paragraph extends TextBlock {
    /** @param {Nabu} nabu @param {ParagraphNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        this.serializers.set('markdown', () => this.behavior.toMarkdown());
        this.serializers.set('json', () => ({
            id: this.id,
            type: 'paragraph',
            content: this.behavior.toJSON()
        }));
        this.serializers.set('application/x-nabu+json', (ctx = {}) => this.behavior.toClipboardBlock(ctx));
    }

    static placeholder = 'Start writing...';

    component = $derived(this.nabu.components.get("paragraph") || ParagraphComponent);

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
            consume(/** @type {string[]} */ lines, /** @type {number} */ i, /** @type {{ joinLines?: boolean }} */ { joinLines } = {}) {
                // Paste: one line = one block. Import (CommonMark): lines up to a blank one are one paragraph.
                if (!joinLines) return 1;
                let j = i;
                while (j < lines.length && lines[j].trim()) j++;
                return Math.max(1, j - i);
            },
        }
    ];

    /**
     * Imported lines join into one paragraph: with a space (soft break), or with a newline when the line ends with a
     * hard break (two trailing spaces or a backslash). An image inside the text splits the paragraph: text before,
     * image block, text after (needs `helpers.parseInlineSegments`).
     * @param {string[]} lines
     * @param {{ parseInline: (text: string) => import('loro-crdt').Delta<string>[], parseInlineSegments?: (text: string) => Array<{ delta?: import('loro-crdt').Delta<string>[], image?: { alt: string, ref: string } }>, joinLines?: boolean }} helpers
     * @returns {import('../../utils/extensions.js').PasteBlock | import('../../utils/extensions.js').PasteBlock[] | null}
     */
    static fromMarkdown(lines, { parseInline, parseInlineSegments, joinLines }) {
        let text = '';
        lines.forEach((line, k) => {
            if (k === 0) { text = line; return; }
            text += (/(?: {2,}|\\)$/.test(lines[k - 1]) ? '\n' : ' ') + line.replace(/^\s+/, '');
        });
        // Pasted, a bare paragraph is plain text ('both'): it must not retype an empty block
        // (heading, quote…). Imported, it is a whole block.
        const partial = joinLines ? false : 'both';
        const segments = parseInlineSegments ? parseInlineSegments(text) : [{ delta: parseInline(text) }];
        if (!segments.some((seg) => seg.image)) {
            const delta = segments[0]?.delta ?? [];
            return delta.length ? { type: 'paragraph', delta, partial } : null;
        }
        /** @type {import('../../utils/extensions.js').PasteBlock[]} */
        const blocks = [];
        segments.forEach((seg, k) => {
            if (seg.image) { blocks.push({ type: 'image', props: { alt: seg.image.alt, ref: seg.image.ref }, partial: false }); return; }
            // The block boundary replaces the space that touched the image.
            const delta = (seg.delta ?? []).map((op) => ({ ...op }));
            const first = /** @type {any} */ (delta[0]);
            const last = /** @type {any} */ (delta[delta.length - 1]);
            if (k > 0 && first) first.insert = first.insert.replace(/^\s+/, '');
            if (k < segments.length - 1 && last) last.insert = last.insert.replace(/\s+$/, '');
            const clean = delta.filter((op) => /** @type {any} */ (op).insert);
            if (clean.length) blocks.push({ type: 'paragraph', delta: clean, partial });
        });
        return blocks.length ? blocks : null;
    }

    static htmlRules = [
        { selector: 'p' },
        { selector: 'blockquote' },
        // No table block yet: a pasted table gives one paragraph per row, cells separated by a TAB. LOWEST priority (below
        // every block rule): an extension with a real table block declares its own rule for `table` at a higher priority
        // and takes over, nothing else to change. See table.html.js.
        { selector: 'table', priority: -100 },
    ];

    /**
     * @param {Element} el
     * @param {{ parseInline: (el: Element) => import('loro-crdt').Delta<string>[] }} helpers
     * @returns {import('../../utils/extensions.js').PasteBlock | import('../../utils/extensions.js').PasteBlock[] | null}
     */
    static fromHTML(el, helpers) {
        const { parseInline } = helpers;
        if (el.localName === 'table') return tableToRowParagraphs(el, helpers);
        const delta = parseInline(el);
        if (!delta.length) return null;
        return { type: 'paragraph', delta, partial: false };
    }

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(parentId || undefined, index ?? undefined);
        node.data.set("type", "paragraph");
        const container = node.data.setContainer("text", new LoroText());
        if (props.text) container.insert(0, props.text || "Start writing...");
        if (props.delta) container.applyDelta([...props.delta]);
        const block = new Paragraph(nabu, node);
        return block;
    }
}
