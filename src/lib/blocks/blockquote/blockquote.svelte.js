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

const QUOTE_MARK = /^ {0,3}>/;

/**
 * A quote line without its `>` marks, however deeply nested (`> > x` gives `x`); a lazy line is returned as it is.
 * @param {string} line
 * @returns {string}
 */
function stripQuote(line) {
    let out = line;
    while (QUOTE_MARK.test(out)) out = out.replace(/^ {0,3}> ?/, '');
    return out;
}

// @ts-ignore — static-side variance on create() (same pattern as Paragraph/Heading)
export class BlockquoteBlock extends TextBlock {
    /** @param {Nabu} nabu @param {BlockquoteNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        this.serializers.set('markdown', () => { const md = this.behavior.toMarkdown(); return md ? `> ${md}` : ''; }); // an empty quote has no markdown
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
        const md = deltaToMarkdown(pb.delta || []);
        return md ? `> ${md}` : ''; // an empty quote has no markdown
    }

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toHtml(pb) {
        return `<blockquote>${deltaToHtml(pb.delta || [])}</blockquote>`;
    }

    /**
     * A quote is a block of TEXT (it cannot hold other blocks), so:
     *  - nested levels (`> > x`) are FLATTENED into the one quote, the text is kept;
     *  - a lazy continuation line (no `>`) belongs to the quote on import (CommonMark) and in a paste after a hard break;
     *  - the content is parsed as a document of its own: its text paragraphs become quotes (one per paragraph, the lines of
     *    a paragraph joined by a line break in a paste, by a space on import), and what it holds that is not text (a list, a
     *    fenced code, a heading, a divider, an image, a table) becomes the block it is, in order, outside any quote: the
     *    quote mark is lost, no text is.
     * A callout (`> [!NOTE]`) has a higher priority rule of its own.
     */
    static markdownRules = [
        {
            priority: 10,
            interruptsParagraph: true,
            detect: /^ {0,3}>/,
            consume(/** @type {string[]} */ lines, /** @type {number} */ i, /** @type {any} */ helpers) {
                let j = i;
                /** @type {string} */
                let previous = '';
                while (j < lines.length) {
                    const line = lines[j];
                    if (QUOTE_MARK.test(line)) { previous = stripQuote(line); j++; continue; }
                    // lazy continuation: plain text under a text line of the quote
                    const lazy = j > i && line.trim() && previous.trim()
                        && (helpers?.joinLines || /(?: {2,}|\\)$/.test(lines[j - 1]))
                        && !helpers?.interrupts?.(lines, j) && !helpers?.interrupts?.([previous], 0);
                    if (!lazy) break;
                    previous = line;
                    j++;
                }
                return Math.max(1, j - i);
            },
        }
    ];

    /**
     * @param {string[]} lines
     * @param {{ parseInline: (text: string) => import('loro-crdt').Delta<string>[], parseBlocks?: (lines: string[], overrides?: object) => import('../../utils/extensions.js').PasteBlock[], joinLines?: boolean }} helpers
     * @returns {import('../../utils/extensions.js').PasteBlock | import('../../utils/extensions.js').PasteBlock[] | null}
     */
    static fromMarkdown(lines, { parseInline, parseBlocks, joinLines }) {
        const inner = lines.map(stripQuote);
        if (!parseBlocks) {
            const delta = parseInline(inner.join('\n'));
            return delta.length ? { type: 'blockquote', delta, partial: false } : null;
        }
        /** @type {import('../../utils/extensions.js').PasteBlock[]} */
        const blocks = parseBlocks(inner, { joinLines: true, softBreak: joinLines ? ' ' : '\n' }).map((pb) =>
            pb.type === 'paragraph' ? { type: 'blockquote', delta: pb.delta, partial: false } : pb);
        if (!blocks.length) return null;
        return blocks.length === 1 ? blocks[0] : blocks;
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
        const node = nabu.tree.createNode(/** @type {any} */ (parentId || undefined), index ?? undefined);
        /** @type {any} */ (node.data).set("type", "blockquote");
        const container = /** @type {any} */ (node.data).setContainer("text", new LoroText());
        if (props.text) container.insert(0, props.text);
        if (props.delta) container.applyDelta([...props.delta]);
        const block = new BlockquoteBlock(nabu, /** @type {BlockquoteNode} */ (/** @type {unknown} */ (node)));
        return block;
    }
}
