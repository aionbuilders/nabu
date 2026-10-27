import { Block } from "../block.svelte.js";
import DividerComponent from "./Divider.svelte";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

/**
 * @typedef {NabuNode<{type: "divider"}>} DividerNode
 */

/**
 * Horizontal rule. First non-textual block: no TextBehavior, renders an
 * inert <hr> and exposes a single cursor position so document-offset
 * resolution can step over it.
 */
// @ts-ignore — static-side variance on create() (same pattern as Paragraph/Heading)
export class DividerBlock extends Block {
    /** @param {Nabu} nabu @param {DividerNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        this.serializers.set('markdown', () => '---');
        this.serializers.set('json', () => ({ id: this.id, type: 'divider' }));
        this.serializers.set('application/x-nabu+json', () => ({ type: 'divider', partial: false }));
    }

    component = $derived(this.nabu.components.get("divider") || DividerComponent);

    // Un seul point de curseur — avant le bloc
    positions = $derived(1);

    /**
     * No editable text — callers (focus, setCursor) handle null gracefully.
     * @param {number} offset
     * @returns {{node: Node, offset: number} | null}
     */
    getDOMPoint(offset) { return null; }

    /** @param {InputEvent} event */
    beforeinput(event) { return false; }

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toMarkdown(pb) { return '---'; }

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toHtml(pb) { return '<hr>'; }

    /**
     * Thematic break (CommonMark): 3+ `-`, `*` or `_` (the same one), spaces allowed between (`* * *`), up to 3 spaces of
     * indent. A `---` right under a line of text is a setext heading underline, not a divider (see the heading block).
     */
    static markdownRules = [
        {
            priority: 20,
            interruptsParagraph: true,
            detect: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
            consume: () => 1,
        }
    ];

    /**
     * @param {string[]} lines
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromMarkdown(lines) {
        if (!/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(lines[0])) return null;
        return { type: 'divider', partial: false };
    }

    static htmlRules = [
        { selector: 'hr' },
    ];

    /**
     * @returns {import('../../utils/extensions.js').PasteBlock}
     */
    static fromHTML() {
        return { type: 'divider', partial: false };
    }

    /** @param {Nabu} nabu @param {string} type @param {Record<string, any>} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(/** @type {import('loro-crdt').TreeID | undefined} */ (parentId || undefined), index ?? undefined);
        /** @type {any} */ (node.data).set("type", "divider");
        const block = new DividerBlock(nabu, /** @type {DividerNode} */ (/** @type {unknown} */ (node)));
        return block;
    }
}
