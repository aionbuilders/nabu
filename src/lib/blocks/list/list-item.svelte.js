import { MegaBlock } from "../megablock.svelte.js";
import ListItemComponent from "./ListItem.svelte";
import { List, listStart } from "./list.svelte.js";
import { moveItems, handleTab } from "./indent.js";
import { retypeItem } from "./convert.js";
import { pasteIntoItem } from "./paste.js";
import { LoroText } from "loro-crdt";
import { TextBehavior, deltaToHtml, deltaToMarkdown } from "../../behaviors/text";
import { renderItem, adjacentRun, markerWidth } from "./markdown.js";

/**
 * @import { Nabu, NabuNode, Block } from "..";
 */

/**
 * @typedef {NabuNode<{type: "list-item", text: LoroText, checked?: boolean}>} ListItemNode
 */

/** What the list renderers (markdown.js) need from outside: the inline serializer and the `start` normalizer. */
const markdownEnv = { toMarkdown: (/** @type {any[]} */ delta) => deltaToMarkdown(delta), listStart };

/**
 * Indent a list item (Tab behavior): move under the previous sibling (into its last sublist when of the same type, else a new one).
 * The selection (collapsed caret or range) is restored afterwards. See indent.js.
 * @param {ListItem} item
 * @returns {boolean}
 */
export function indentListItem(item) {
    const node = /** @type {import("../nabu.svelte.js").NabuNode} */ (item.node);
    const movable = !!node.index() && node.parent()?.children()?.[/** @type {number} */ (node.index()) - 1]?.data.get('type') === 'list-item';
    if (movable) moveItems(item.nabu, [node], false);
    return movable;
}

/**
 * Unindent a list item (Shift+Tab behavior): move out of parent sublist, carry followers.
 * The selection (collapsed caret or range) is restored afterwards. See indent.js.
 * @param {ListItem} item
 * @returns {boolean}
 */
export function unindentListItem(item) {
    const node = /** @type {import("../nabu.svelte.js").NabuNode} */ (item.node);
    const movable = node.parent()?.parent()?.data.get('type') === 'list-item';
    if (movable) moveItems(item.nabu, [node], true);
    return movable;
}

export class ListItem extends MegaBlock {
    /** @param {Nabu} nabu @param {ListItemNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        const data = node.data;
        this.container = data.get("text") ?? data.setContainer("text", new LoroText());

        /** @type {TextBehavior} */
        this.behavior = new TextBehavior(this, this.container);
        this.behaviors.set("text", this.behavior);

        // Initialize checked from Loro metadata
        this.checked = !!node.data.get('checked');
        // Subscribe to data changes to keep checked in sync
        this.node.data.subscribe(() => {
            this.checked = !!this.node.data.get('checked');
        });

        // One item (and its sublists), indented under the items that hold it. A whole list is rendered by the List.
        this.serializers.set('markdown', () => {
            const list = /** @type {any} */ (this.parent);
            let indent = '';
            for (let item = /** @type {any} */ (this); item.parent?.parent?.type === 'list-item'; item = item.parent.parent) {
                const outer = item.parent.parent;
                indent = ' '.repeat(markerWidth(outer.parent?.listType, (outer.parent?.start ?? 1) + outer.index)) + indent;
            }
            return renderItem(this.toPasteBlock(), markdownEnv, {
                listType: list?.listType ?? 'bullet',
                index: this.index,
                start: list?.start ?? 1,
                run: list ? adjacentRun(list.listType, list.siblingsBefore()) : 0,
                indent,
            });
        });
        this.serializers.set('json', () => {
            /** @type {Record<string, any>} */
            const result = {
                id: this.id,
                type: 'list-item',
                content: this.behavior.toJSON(),
                ...(this.isTodo ? { props: { checked: this.checked } } : {})
            };
            const childrenJson = this.children.map(c => c.serialize('json')).filter(Boolean);
            if (childrenJson.length) result.children = childrenJson;
            return result;
        });
        this.serializers.set('application/x-nabu+json', (ctx = {}) => this.behavior.toClipboardBlock(ctx));
    }

    component = $derived(this.nabu.components.get("list-item") || ListItemComponent);

    /** @type {boolean} */
    checked = $state(false);

    isTodo = $derived(/** @type {any} */ (this.parent)?.listType === 'todo');

    /**
     * This item and its sublists as PasteBlocks (the shape the static serializers read).
     * @returns {import('../../utils/extensions.js').PasteBlock}
     */
    toPasteBlock() {
        const pb = this.behavior.toClipboardBlock({ props: this.clipboardProps });
        const sublists = this.sublists;
        return sublists.length ? { ...pb, children: sublists.map(sub => /** @type {any} */ (sub).toPasteBlock()) } : pb;
    }

    /** A to-do item carries its `checked` state onto the clipboard. */
    get clipboardProps() {
        return this.isTodo ? { checked: this.checked } : {};
    }

    /**
     * Set the checked state and persist to Loro.
     * @param {boolean} v
     */
    setChecked(v) {
        this.checked = !!v;
        /** @type {any} */ (this.node.data).set('checked', !!v);
        this.commit();
    }

    /**
     * Toggle the checked state.
     */
    toggleChecked() {
        this.setChecked(!this.checked);
    }

    get text() {
        return this.behavior.text;
    }

    get delta() {
        return this.behavior.delta;
    }

    selection = $derived(this.behavior.selection);

    // @ts-ignore — `super.positions`: Svelte compiles the parent's `$derived` field to a prototype accessor, which TS sees as a field
    positions = $derived(this.behavior.positions + super.positions);

    wordCount = $derived((this.behavior?.wordCount ?? 0) + this.children.reduce((sum, c) => sum + (c.wordCount ?? 0), 0));

    /**
     * Mixed block: own text comes first, then children (sublists).
     * @param {number} localOffset
     * @returns {{ block: import('../block.svelte.js').Block, offset: number } | null}
     */
    resolveOffset(localOffset) {
        const textPositions = this.behavior.positions; // text.length + 1
        if (localOffset < textPositions || !this.children.length) {
            return { block: this, offset: Math.min(localOffset, this.behavior.text.length) };
        }
        let remaining = localOffset - textPositions;
        for (const child of this.children) {
            const childPositions = child.positions ?? 0;
            if (remaining < childPositions) return child.resolveOffset(remaining);
            remaining -= childPositions;
        }
        return { block: this, offset: this.behavior.text.length };
    }

    /** Every sublist, in order: an item may hold several, of different types (`a > [ul[…], ol[…], ul[…]]`). */
    sublists = $derived(this.children.filter(child => child.node.data.get("type") === "list"));

    /** The first sublist (see `sublists`). */
    sublist = $derived(this.sublists[0]);

    /**
     * A ListItem must always live inside a List.
     * wrapOrphan() uses this to auto-create a List wrapper when a ListItem
     * is relocated to a context that doesn't have a List parent.
     * props() reads this.parent (stale Svelte state) which still points to the
     * original List at relocation time, giving us the correct listType.
     * @returns {{ type: string, props: () => Record<string, any> }}
     */
    get requiredParent() {
        return {
            type: "list",
            props: () => ({
                listType: this.parent?.behaviors?.get("list")?.listType || "bullet"
            })
        };
    }

    /**
     * The sublist that receives a child of type `listType`: the LAST sublist when it has that type, otherwise
     * a new one appended after the existing sublists (an item may hold several sublists of different types).
     * @param {"bullet" | "ordered" | "todo"} [listType]
     */
    getOrCreateSublist(listType = /** @type {any} */ (this.parent)?.listType || "bullet") {
        const last = this.sublists.at(-1);
        if (last && /** @type {any} */ (last).listType === listType) return last;

        // No nabu.insert() here: it commits, and the list schema normalizer would delete this still-empty
        // list before the caller had the chance to fill it.
        return List.create(this.nabu, "list", { listType }, this.node.id.toString());
    }

    /**
     * A list item cannot simply change type where it stands (a list only holds items): it leaves its list,
     * which is split around it, and keeps its text, marks and caret. See convert.js.
     * @param {string} newType
     * @param {Record<string, any>} [props={}]
     */
    retype(newType, props = {}) {
        retypeItem(this.nabu, /** @type {NabuNode} */ (this.node), newType, props);
    }

    /**
     * A paste landing in a list item: paragraphs and lists are absorbed as items of this list, any block an
     * item cannot hold splits the list. See paste.js.
     * @param {import('../../utils/extensions.js').PasteBlock[]} blocks
     * @param {{ offset: number }} ctx
     */
    acceptPaste(blocks, ctx) {
        return pasteIntoItem(/** @type {any} */ (this), ctx.offset, blocks);
    }

    /** @param {KeyboardEvent} event */
    keydown(event) {
        if (event.key !== 'Tab') return false;
        // Single item, or a selection spanning several items that landed here (see ListExtension's onKeyDown).
        if (handleTab(this.nabu, event)) return true;
        // Plain Tab inside the item (modifier combos aside): never let the focus leave the editor.
        return !(event.ctrlKey || event.altKey || event.metaKey);
    }

    /** @param {InputEvent} event */
    beforeinput(event) {
        return this.behavior.handleBeforeInput(event);
    }

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

    /** @param {Parameters<import('../block.svelte.js').Block["split"]>[0]} [options] @returns {ReturnType<import('../block.svelte.js').Block["split"]>} */
    split(options) { 
        return this.ascend("onSplit", null, { 
            offset: options?.offset || 0,
            delta: this.behavior.container.sliceDelta(options?.offset || 0, this.behavior.container.length)
        });
    }

    /**
     * @param {import('../../utils/extensions.js').PasteBlock} pb
     * @param {{ listType?: string, index?: number, start?: number, run?: number, indent?: string }} helpers  `run`: position of the list among adjacent lists (marker alternation), `indent`: what the item is nested under
     */
    static toMarkdown(pb, { listType = 'bullet', index = 0, start = 1, run = 0, indent = '' }) {
        return renderItem(pb, markdownEnv, { listType, index, start, run, indent });
    }

    /**
     * @param {import('../../utils/extensions.js').PasteBlock} pb
     * @param {{ recurse: (child: import('../../utils/extensions.js').PasteBlock) => string }} helpers
     */
    static toHtml(pb, { recurse }) {
        const text = deltaToHtml(pb.delta || []);
        const sublists = (pb.children || []).map(recurse).join('');
        if (pb.props?.checked !== undefined) {
            const checkedAttr = pb.props.checked ? ' checked' : '';
            return `<li><input type="checkbox" disabled${checkedAttr}> ${text}${sublists}</li>`;
        }
        return `<li>${text}${sublists}</li>`;
    }

    static htmlRules = [{ selector: 'li' }];

    /**
     * @param {Element} el
     * @param {{ parseInline: (el: Element) => import('loro-crdt').Delta<string>[], parseBlock: (el: Element) => import('../../utils/extensions.js').PasteBlock | null }} helpers
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromHTML(el, { parseInline, parseBlock }) {
        const delta = parseInline(el);
        const childLists = /** @type {import('../../utils/extensions.js').PasteBlock[]} */ (
            [...el.children]
                .filter(child => child.matches('ul, ol'))
                .map(parseBlock)
                .filter(Boolean)
        );
        // Detect checkbox: <li><input type="checkbox"> or <li><p><input type="checkbox">
        const cb = el.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]') ||
            el.querySelector('input[type=checkbox]');
        /** @type {import('../../utils/extensions.js').PasteBlock} */
        const result = { type: 'list-item', delta, partial: false };
        if (cb) result.props = { checked: cb.hasAttribute('checked') };
        // Google Docs checklist: `<li role="checkbox" aria-checked="true">`
        else if (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-checked') === 'false') result.props = { checked: el.getAttribute('aria-checked') === 'true' };
        if (childLists.length) result.children = childLists;
        return result;
    }

    /** @param {Nabu} nabu @param {string} type @param {Record<string, any>} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(/** @type {import('loro-crdt').TreeID | undefined} */ (parentId || undefined), index ?? undefined);
        node.data.set("type", "list-item");
        const container = node.data.setContainer("text", new LoroText());
        if (props.text) container.insert(0, props.text);
        if (props.delta) container.applyDelta([...props.delta]);
        if (props.checked !== undefined) /** @type {any} */ (node.data).set('checked', !!props.checked);
        const block = new ListItem(nabu, /** @type {ListItemNode} */ (node));
        return block;
    }
}
