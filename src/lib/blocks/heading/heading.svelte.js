import { TextBlock } from "../text-block.svelte.js";
import { deltaToHtml, deltaToMarkdown } from "../../behaviors/text";
import HeadingComponent from "./Heading.svelte";
import { LoroText } from "loro-crdt";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

/**
 * @typedef {NabuNode<{type: "heading", text: LoroText, level: number}>} HeadingNode
 */

const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;

/**
 * Index of the setext underline (`===` / `---`) that turns the text starting at line `i` into a heading, or -1. A paste
 * heading text is the single line `i`; on import (`joinLines`) it is every line up to the underline, as long as none of
 * them starts a block of its own.
 * @param {string[]} lines
 * @param {number} i
 * @param {{ joinLines?: boolean, interrupts?: (lines: string[], k: number) => boolean }} [helpers]
 * @returns {number}
 */
function setextEnd(lines, i, helpers) {
    const last = helpers?.joinLines ? lines.length - 1 : Math.min(i + 1, lines.length - 1);
    for (let j = i + 1; j <= last; j++) {
        if (SETEXT_UNDERLINE.test(lines[j])) return j;
        if (!lines[j].trim() || helpers?.interrupts?.(lines, j)) return -1;
    }
    return -1;
}

export class Heading extends TextBlock {
    /** @param {Nabu} nabu @param {HeadingNode} node */
    constructor(nabu, node) {
        super(nabu, node);
        const data = node.data;

        this.level = data.get("level") || 1;

        this.serializers.set('markdown', () => { const md = this.behavior.toMarkdown(); return md ? `${'#'.repeat(this.level)} ${md}` : ''; }); // an empty heading has no markdown (`## ` would read back as text)
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

    /** @param {Heading} block */
    static placeholder = (block) => `Heading ${block.level}`;

    component = $derived(this.nabu.components.get("heading") || HeadingComponent);

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toMarkdown(pb) {
        const n = Math.trunc(Number(pb.props?.level));
        const level = n >= 1 && n <= 6 ? n : 1; // never interpolate an arbitrary value into a tag name
        const md = deltaToMarkdown(pb.delta || []);
        return md ? `${'#'.repeat(level)} ${md}` : ''; // an empty heading has no markdown (`## ` would read back as text)
    }

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toHtml(pb) {
        const n = Math.trunc(Number(pb.props?.level));
        const level = n >= 1 && n <= 6 ? n : 1; // never interpolate an arbitrary value into a tag name
        return `<h${level}>${deltaToHtml(pb.delta || [])}</h${level}>`;
    }

    /**
     * Two rules: the ATX heading (`## Title`, up to 3 spaces of indent) and the setext heading (`Title` then `===` for a
     * level 1, `---` for a level 2). The setext rule sits just ABOVE the paragraph catch-all and BELOW every block rule: a
     * line that starts a list, a quote, a fence, a divider… never becomes a heading text, and a `---` after a blank line
     * (nothing to underline) stays a divider. In a paste a heading text is ONE line (one line = one block); on import
     * (`joinLines`) it is the whole paragraph above the underline (CommonMark).
     */
    static markdownRules = [
        {
            priority: 10,
            interruptsParagraph: true,
            detect: /^ {0,3}#{1,6}[ \t]/,
            consume: () => 1,
        },
        {
            priority: 5,
            setext: true,
            detect(/** @type {string} */ line, /** @type {string[]} */ lines, /** @type {number} */ i, /** @type {any} */ helpers) {
                return setextEnd(lines, i, helpers) > i;
            },
            consume(/** @type {string[]} */ lines, /** @type {number} */ i, /** @type {any} */ helpers) {
                return setextEnd(lines, i, helpers) - i + 1;
            },
        }
    ];

    /**
     * @param {string[]} lines
     * @param {{ parseInline: (text: string) => import('loro-crdt').Delta<string>[] }} helpers
     * @param {import('../../utils/extensions.js').MarkdownRule} [rule]
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromMarkdown(lines, { parseInline }, rule) {
        let level;
        let text;
        if (rule?.setext) {
            const underline = lines[lines.length - 1].trim();
            level = underline[0] === '=' ? 1 : 2;
            text = lines.slice(0, -1).map((line) => line.trim().replace(/\\$/, '')).join(' ');
        } else {
            const m = lines[0].match(/^ {0,3}(#{1,6})[ \t]+(.*)/);
            if (!m) return null;
            level = m[1].length;
            text = m[2];
        }
        const delta = parseInline(text);
        if (!delta.length) return null;
        return { type: 'heading', props: { level }, delta, partial: false };
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

    /** @param {Nabu} nabu @param {string} type @param {Record<string, any>} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(/** @type {import('loro-crdt').TreeID | undefined} */ (parentId || undefined), index ?? undefined);
        node.data.set("type", "heading");
        node.data.set("level", props.level || 1);
        const container = node.data.setContainer("text", new LoroText());
        if (props.text) container.insert(0, props.text);
        if (props.delta) container.applyDelta([...props.delta]);
        const block = new Heading(nabu, /** @type {HeadingNode} */ (node));
        return block;
    }
}
