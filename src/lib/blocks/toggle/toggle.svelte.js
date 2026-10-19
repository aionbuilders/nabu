import { MegaBlock } from "../megablock.svelte.js";
import { TextBehavior, deltaToHtml, deltaToMarkdown } from "../../behaviors/text";
import { LoroText } from "loro-crdt";
import ToggleComponent from "./Toggle.svelte";
import { parseDetails, toggleMarkdown } from "./markdown.js";
import { isEmptyLastParagraph, exitSubThread, dissolveToParagraph, insertParagraphAfter, pasteIntoHeader } from "../subthread.js";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

/**
 * @typedef {NabuNode<{type: "toggle", text: LoroText, collapsed: boolean}>} ToggleNode
 */

// @ts-ignore — static-side variance on create()
export class ToggleBlock extends MegaBlock {
    /** @param {Nabu} nabu @param {ToggleNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        const data = node.data;
        this.container = data.get("text") ?? data.setContainer("text", new LoroText());

        /** @type {TextBehavior} */
        this.behavior = new TextBehavior(this, this.container);
        this.behaviors.set("text", this.behavior);

        // Initialize collapsed from Loro metadata
        this.collapsed = !!data.get('collapsed');
        // Subscribe to data changes to keep collapsed in sync
        this.node.data.subscribe(() => {
            this.collapsed = !!this.node.data.get('collapsed');
        });

        this.serializers.set('markdown', () => toggleMarkdown(this.collapsed, this.behavior.toMarkdown(), /** @type {any} */ (this.children.map(c => c.serialize('markdown')))));
        this.serializers.set('json', () => ({
            id: this.id,
            type: 'toggle',
            props: { collapsed: this.collapsed },
            content: this.behavior.toJSON(),
            children: this.children.map(c => c.serialize('json')).filter(Boolean)
        }));
        this.serializers.set('application/x-nabu+json', () => ({
            type: 'toggle',
            props: { collapsed: this.collapsed },
            delta: this.container.sliceDelta(0, this.container.length),
            children: this.children.map(c => c.serialize('application/x-nabu+json')).filter(Boolean)
        }));
    }

    // ── Capability flags ────────────────────────────────────────────────────
    // A typed "# " must not transform the toggle header away
    transformsEnabled = false;
    // marksEnabled stays true (default) — bold/italic work inside the header
    // splitsOnEnter is not set (defaults true) but Enter is overridden in beforeinput

    /** @type {boolean} */
    collapsed = $state(false);

    /** A collapsed toggle does not render its body: navigation must never put the caret in it. */
    get hidesChildren() { return this.collapsed; }

    /** A collapsed toggle stays collapsed on the clipboard. */
    get clipboardProps() { return { collapsed: this.collapsed }; }

    static placeholder = 'Toggle…';

    component = $derived(this.nabu.components.get("toggle") || ToggleComponent);

    get text() { return this.behavior.text; }
    get delta() { return this.behavior.delta; }

    selection = $derived(this.behavior.selection);

    // When collapsed, exclude children from positions so cursor cannot enter hidden body
    positions = $derived(this.behavior.positions + (this.collapsed ? 0 : super.positions));

    // Count body words regardless of collapse state
    wordCount = $derived((this.behavior?.wordCount ?? 0) + this.children.reduce((s, c) => s + (c.wordCount ?? 0), 0));

    /**
     * Mixed block: own text comes first, then children.
     * When collapsed, children are excluded from navigation.
     * @param {number} localOffset
     * @returns {{ block: import('../block.svelte.js').Block, offset: number } | null}
     */
    resolveOffset(localOffset) {
        const textPositions = this.behavior.positions; // text.length + 1
        if (this.collapsed || localOffset < textPositions || !this.children.length) {
            return { block: this, offset: Math.min(localOffset, this.behavior.text.length) };
        }
        let remaining = localOffset - textPositions;
        for (const child of this.children) {
            const cp = child.positions ?? 0;
            if (remaining < cp) return child.resolveOffset(remaining);
            remaining -= cp;
        }
        return { block: this, offset: this.behavior.text.length };
    }

    // ── Collapse control ────────────────────────────────────────────────────

    /**
     * Set the collapsed state and persist to Loro.
     * @param {boolean} v
     */
    setCollapsed(v) {
        this.collapsed = !!v;
        /** @type {any} */ (this.node.data).set('collapsed', !!v);
        this.commit();
    }

    /**
     * Toggle the collapsed state.
     */
    toggleCollapsed() {
        this.setCollapsed(!this.collapsed);
    }

    // ── Proxies to TextBehavior ─────────────────────────────────────────────

    /**
     * @param {number} targetOffset
     * @returns {{node: Node, offset: number} | null}
     */
    getDOMPoint(targetOffset) { return this.behavior.getDOMPoint(targetOffset); }

    /** @param {import('../block.svelte.js').Block} block */
    absorbs(block) { return this.behavior.absorbs(block); }

    /** @param {number} index @param {string} text */
    insert(index, text) { return this.behavior.insert(index, text); }

    /** @param {Parameters<import('../block.svelte.js').Block["delete"]>[0]} [deletion] */
    delete(deletion) { return this.behavior.delete(deletion); }

    /** @param {import('loro-crdt').Delta<string>[]} data */
    applyDelta(data = []) { return this.behavior.applyDelta(data); }

    // ── Sub-thread rules (P-40) ─────────────────────────────────────────────
    // Header = own text, body = children. The tree operations live in ../subthread.js, shared with any other
    // container block (the container Callout will reuse them as is).

    /**
     * Enter in a body child (called through `ascend("onSplit")`). Only the Enter that EXITS the sub-thread is
     * taken here: on an EMPTY paragraph that is the LAST child, the paragraph moves right after the toggle and
     * takes the caret. Anything else is declined (falsy) and goes through the regular split of the child's type.
     * @param {Event | null} event
     * @param {{ from: import('../block.svelte.js').Block }} data
     */
    onSplit(event, data) {
        const source = data.from;
        if (!isEmptyLastParagraph(/** @type {any} */ (this), source)) return false;
        const id = source.node.id.toString();
        exitSubThread(source.node, this.node);
        this.nabu.commit().then(() => {
            const f = this.nabu.blocks.get(id);
            if (f) this.nabu.selection.setCursor(f, 0);
        });
        return { block: source };
    }

    /**
     * Children adopted by a merge (`Block#consume`) never vanish into a HIDDEN body: when collapsed they stay
     * visible, in order, right after the toggle.
     * @param {import('../block.svelte.js').Block[]} children
     * @param {number | null} [index]
     */
    adoptChildren(children, index = null) {
        if (!this.collapsed) return super.adoptChildren(children, index);
        [...children].reverse().forEach(child => { if (child.node) child.node.moveAfter(this.node); });
    }

    /** The body is free-form: an empty paragraph of the body takes the type of a whole block pasted into it. */
    get adoptsPastedTypes() { return true; }

    /**
     * Paste with the caret in the HEADER (text only). One pasted text block is the engine's inline merge
     * (declined). Several blocks: the first completes the header at the caret, the others go to the TOP of the
     * body (like Enter, which creates the first body child), the header text after the caret follows the last
     * one (merged into it when it is text, else in a new paragraph). A COLLAPSED toggle is EXPANDED first: the
     * pasted content would otherwise land hidden. (A paste with the caret in a body child never reaches this
     * hook: the child's own rules apply, inside the body.)
     * @param {import('../../utils/extensions.js').PasteBlock[]} blocks
     * @param {{ offset: number }} ctx
     */
    acceptPaste(blocks, ctx) {
        if (!blocks?.length || (blocks.length === 1 && !blocks[0].children?.length)) return null;
        const landing = pasteIntoHeader(this.nabu, /** @type {any} */ (this), ctx.offset, blocks);
        if (landing && this.collapsed) /** @type {any} */ (this.node.data).set('collapsed', false);
        return landing;
    }

    // ── Custom beforeinput (handles Enter and Backspace in the header) ──────

    /**
     * @param {InputEvent} event
     * @returns {boolean}
     */
    beforeinput(event) {
        const sel = this.behavior.selection;

        // Enter in the header → split at the caret.
        //  - COLLAPSED: the tail goes into a new paragraph AFTER the toggle (caret in it); the toggle stays collapsed
        //    and its hidden body is not touched.
        //  - EXPANDED: the tail goes into a new paragraph as the FIRST body child (caret in it).
        if (event.inputType === 'insertParagraph' && sel) {
            const from = sel.from;
            const to = sel.isCollapsed ? this.behavior.text.length : sel.to;
            const delta = this.container.sliceDelta(from, to);
            if (this.behavior.text.length > from) {
                this.behavior.delete({ index: from, length: this.behavior.text.length - from });
            }
            const p = this.collapsed
                ? insertParagraphAfter(this.nabu, this.node, delta)
                : this.nabu.insert('paragraph', { delta }, this.node.id.toString(), 0);
            this.nabu.commit().then(() => {
                const f = this.nabu.blocks.get(p.id);
                if (f) this.nabu.selection.setCursor(f, 0);
            });
            return true;
        }

        // Backspace at offset 0 of the header (empty or not, with or without body) → the toggle becomes a
        // paragraph with the header text; its body children follow it. One transaction = one undo step.
        if (event.inputType === 'deleteContentBackward' && sel?.isCollapsed && sel.from === 0) {
            const id = this.node.id.toString();
            this.nabu.transact(() => dissolveToParagraph(this.node, ['collapsed'])).then(() => {
                const f = this.nabu.blocks.get(id);
                if (f) f.focus({ start: 0, end: 0 });
            });
            return true;
        }

        return this.behavior.handleBeforeInput(event);
    }

    // ── Statics ─────────────────────────────────────────────────────────────

    /**
     * `<details>` / `<details open>` + `<summary>` + the body as markdown + `</details>` (see markdown.js).
     * @param {import('../../utils/extensions.js').PasteBlock} pb
     * @param {{ recurse: (child: import('../../utils/extensions.js').PasteBlock, ctx?: object) => string, recurseAll?: (children: import('../../utils/extensions.js').PasteBlock[], ctx?: object) => string[] }} helpers
     */
    static toMarkdown(pb, { recurse, recurseAll }) {
        const children = pb.children || [];
        return toggleMarkdown(!!pb.props?.collapsed, deltaToMarkdown(pb.delta || []), recurseAll ? recurseAll(children) : children.map(c => recurse(c)));
    }

    /**
     * Markdown (paste AND `importMarkdown`): the exact `<details>` construct Nabu emits, nothing else (see markdown.js).
     * An opening line without a matching `</details>`, with attributes or without a `<summary>` is not a toggle: it stays text.
     */
    static markdownRules = [
        {
            priority: 20,
            interruptsParagraph: true,
            detect: (/** @type {string} */ line, /** @type {string[]} */ lines, /** @type {number} */ i) => line.startsWith('<details') && !!parseDetails(lines, i),
            consume: (/** @type {string[]} */ lines, /** @type {number} */ i) => (parseDetails(lines, i)?.end ?? i) - i + 1,
        }
    ];

    /**
     * The toggle (header = the summary, parsed as inline markdown; body = the lines between the summary and `</details>`,
     * parsed as a document of their own, nested toggles included).
     * @param {string[]} lines
     * @param {{ parseInline: (text: string) => import('loro-crdt').Delta<string>[], parseBlocks?: (lines: string[]) => import('../../utils/extensions.js').PasteBlock[] }} helpers
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromMarkdown(lines, { parseInline, parseBlocks }) {
        const details = parseDetails(lines, 0);
        if (!details || !parseBlocks) return null;
        const children = parseBlocks(lines.slice(details.bodyStart, details.end));
        return { type: 'toggle', props: { collapsed: !details.open }, delta: parseInline(details.summary), partial: false, ...(children.length ? { children } : {}) };
    }

    /**
     * @param {import('../../utils/extensions.js').PasteBlock} pb
     * @param {{ recurse: (child: import('../../utils/extensions.js').PasteBlock) => string }} helpers
     */
    static toHtml(pb, { recurse }) {
        const open = pb.props?.collapsed ? '' : ' open';
        const head = deltaToHtml(pb.delta || []);
        const body = (pb.children || []).map(c => recurse(c)).join('');
        return '<details' + open + '><summary>' + head + '</summary>' + body + '</details>';
    }

    static htmlRules = [{ selector: 'details' }];

    /**
     * @param {Element} el
     * @param {{ parseInline: (el: Element) => import('loro-crdt').Delta<string>[], parseChildren?: (el: Element) => import('../../utils/extensions.js').PasteBlock[] }} helpers
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromHTML(el, { parseInline, parseChildren }) {
        // Use 'summary' without :scope because happy-dom doesn't support :scope pseudo-class
        const summary = /** @type {Element | null} */ ([...el.children].find(c => c.tagName.toLowerCase() === 'summary') || null);
        const delta = summary ? parseInline(summary) : [];
        const collapsed = !el.hasAttribute('open');
        // Parse non-summary child elements as body blocks
        const bodyEls = [...el.children].filter(c => c.tagName.toLowerCase() !== 'summary');
        /** @type {import('../../utils/extensions.js').PasteBlock[]} */
        let children = [];
        if (parseChildren && bodyEls.length) {
            // Create a temporary wrapper with only the non-summary children
            const ownerDoc = el.ownerDocument;
            if (ownerDoc) {
                const wrapper = ownerDoc.createElement('div');
                for (const bodyEl of bodyEls) {
                    wrapper.appendChild(bodyEl.cloneNode(true));
                }
                children = parseChildren(wrapper);
            }
        }
        return { type: 'toggle', props: { collapsed }, delta, partial: false, ...(children.length ? { children } : {}) };
    }

    /**
     * @param {Nabu} nabu
     * @param {string} type
     * @param {Object} [props={}]
     * @param {string|null} [parentId=null]
     * @param {number|null} [index=null]
     */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(parentId || undefined, index ?? undefined);
        /** @type {any} */ (node.data).set('type', 'toggle');
        /** @type {any} */ (node.data).set('collapsed', props.collapsed ?? false);
        const container = /** @type {any} */ (node.data).setContainer('text', new LoroText());
        if (props.text) container.insert(0, props.text);
        if (props.delta) container.applyDelta([...props.delta]);
        return new ToggleBlock(nabu, /** @type {ToggleNode} */ (/** @type {unknown} */ (node)));
    }
}
