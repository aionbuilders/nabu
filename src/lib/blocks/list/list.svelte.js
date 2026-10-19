import { MegaBlock } from "../megablock.svelte.js";
import { ListBehavior } from "./list.behavior.svelte.js";
import ListComponent from "./List.svelte";
import { stepBack } from "./step-back.js";
import { hasLeveledItems, docsEntries, docsSiblings, isWordListParagraph, wordEntries, wordSiblings, nestEntries } from "./html-flat.js";
import { isListItem, interruptsParagraph, listLength, parseListLines } from "./markdown.js";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

/**
 * @typedef {NabuNode<{type: "list", listType: "bullet" | "ordered" | "todo", start?: number}>} ListNode
 */

/**
 * Normalize a list's `start` number: only meaningful for ORDERED lists, and `1` is the default.
 * @param {string | undefined} listType
 * @param {any} start  a number, a numeric string (markdown / `<ol start>`), or nothing
 * @returns {number | null}  the number to store / emit, or null = default (omit it)
 */
export function listStart(listType, start) {
    if (listType !== 'ordered' || start === undefined || start === null || start === '') return null;
    const n = Number(start);
    return Number.isInteger(n) && n >= 0 && n !== 1 ? n : null;
}



export class List extends MegaBlock {
    /** @param {Nabu} nabu @param {ListNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        this.behavior = new ListBehavior(this);
        this.behaviors.set("list", this.behavior);

        this.serializers.set('markdown', () =>
            this.children
                .map(child => child.serialize('markdown'))
                .filter(Boolean)
                .join('\n')
        );
        this.serializers.set('json', () => ({
            id: this.id,
            type: 'list',
            props: this.clipboardProps,
            children: this.children.map(child => child.serialize('json')).filter(Boolean)
        }));
    }

    listType = $derived(this.behavior.listType);

    /** First number of an ORDERED list (`<ol start>`); null = 1, the default. @type {number | null} */
    start = $derived(listStart(this.behavior.listType, this.behavior.start));

    /** `start` is only emitted when it is not the default. */
    get clipboardProps() {
        return this.start === null ? { listType: this.listType } : { listType: this.listType, start: this.start };
    }

    /**
     * Copying a slice that starts at item `firstChildIndex` of an ORDERED list: the copy is numbered from that item's
     * visual number (`start + index`), not from the original list start.
     * @param {number} firstChildIndex
     */
    clipboardPropsFrom(firstChildIndex) {
        if (this.listType !== 'ordered' || !firstChildIndex) return this.clipboardProps;
        const start = listStart('ordered', (this.start ?? 1) + firstChildIndex);
        return start === null ? { listType: this.listType } : { listType: this.listType, start };
    }

    component = $derived(this.nabu.components.get("list") || ListComponent);

    root = $derived(!this.parent);


    /** @param {List} otherList */
    absorbs(otherList) {
        return this.behavior.absorbs(otherList);
    }

    /** 
     * @param {Event | null} event
     * @param {{from: import('./list-item.svelte.js').ListItem, offset: number, delta: import('loro-crdt').Delta<string>}} data 
     */
    onSplit(event, data) {
        const { from: sourceItem, offset, delta } = data;
        
        // --- CAS 1 : empty item = step back one level (nested: unindent; top-level: leave the list as a paragraph) ---
        if (sourceItem.text.length === 0) {
            // Same node in both cases (a top-level item is retyped), so the returned block stays valid.
            stepBack(this.nabu, /** @type {import('../nabu.svelte.js').NabuNode} */ (sourceItem.node));
            return { block: sourceItem };
        }
        
        // --- CAS 2 : Comportement normal (Créer un nouvel item en dessous) ---
        
        // 1. On efface la fin du texte dans l'item source
        sourceItem.delete({from: offset, to: -1});
        
        // 2. On trouve l'index de l'item source dans la liste
        const currentIndex = sourceItem.node.index();

        
        // 3. On demande à Nabu d'insérer un nouveau list-item au même niveau
        const newItem = this.nabu.insert(
            "list-item",
            { delta },
            this.node.id.toString(), // Le parent est la liste actuelle
            currentIndex + 1
        );

        // 3.1. On transfère TOUS les enfants du sourceItem vers le newItem
        const sourceChildren = sourceItem.node.children();
        if (sourceChildren && sourceChildren.length > 0) {
            for (const childNode of sourceChildren) {
                // @ts-ignore - Le type string fonctionne avec move()
                this.nabu.tree.move(childNode.id.toString(), newItem.node.id.toString());
            }
        }

        this.nabu.commit().then(() => this.nabu.selection.setCursor(newItem, 0));
        
        return { block: newItem };
    }

    /**
     * @param {import('../../utils/extensions.js').PasteBlock} pb
     * @param {{ recurse: (child: import('../../utils/extensions.js').PasteBlock, ctx?: object) => string, depth?: number }} helpers
     */
    static toMarkdown(pb, { recurse, depth = 0 }) {
        const listType = pb.props?.listType ?? 'bullet';
        const start = listStart(listType, pb.props?.start) ?? 1;
        return (pb.children || [])
            .map((child, i) => recurse(child, { listType, index: i, depth, start }))
            .join('\n');
    }

    /**
     * @param {import('../../utils/extensions.js').PasteBlock} pb
     * @param {{ recurse: (child: import('../../utils/extensions.js').PasteBlock) => string }} helpers
     */
    static toHtml(pb, { recurse }) {
        const tag = pb.props?.listType === 'ordered' ? 'ol' : 'ul';
        const cls = pb.props?.listType === 'todo' ? ' class="contains-task-list"' : '';
        const start = listStart(pb.props?.listType, pb.props?.start);
        return `<${tag}${cls}${start === null ? '' : ` start="${start}"`}>${(pb.children || []).map(recurse).join('')}</${tag}>`;
    }

    /**
     * Markdown lists, see markdown.js: markers `-` `*` `+` `1.` `1)`, nesting by indentation (2 / 4 spaces, TAB), tasks,
     * loose lists, continuation paragraphs of an item.
     */
    static markdownRules = [
        {
            priority: 10,
            interruptsParagraph: (/** @type {string} */ line) => interruptsParagraph(line),
            detect: (/** @type {string} */ line) => isListItem(line),
            consume: (/** @type {string[]} */ lines, /** @type {number} */ i, /** @type {any} */ helpers) => listLength(lines, i, helpers),
        }
    ];

    /**
     * Parse markdown list lines into a nested List/ListItem PasteBlock tree (an array when the marker type changes at
     * the root: several lists).
     *
     * @param {string[]} lines
     * @param {{ parseInline: (text: string) => import('loro-crdt').Delta<string>[], joinLines?: boolean, softBreak?: string }} helpers
     * @returns {import('../../utils/extensions.js').PasteBlock | import('../../utils/extensions.js').PasteBlock[] | null}
     */
    static fromMarkdown(lines, helpers) {
        return parseListLines(lines, helpers, listStart);
    }

    static htmlRules = [
        { selector: 'ul.contains-task-list', props: { listType: 'todo' }, priority: 10 },
        // Word writes a list as consecutive `<p style="mso-list:l0 level2 lfo1">` (list identity + level), see html-flat.js.
        { selector: 'p', filter: isWordListParagraph, props: { listType: 'bullet' }, priority: 20 },
        { selector: 'ul', props: { listType: 'bullet' } },
        { selector: 'ol', props: { listType: 'ordered' } },
    ];

    /**
     * The elements after `el` that continue its list (the `html` interpreter reads them as part of this list): the `<ul>`
     * per nesting level of Google Docs, the following list paragraphs of Word.
     * @param {Element} el
     * @returns {Element[]}
     */
    static htmlSiblings(el) {
        return el.localName === 'p' ? wordSiblings(el) : docsSiblings(el);
    }

    /**
     * @param {Element} el
     * @param {{ parseChildren: (el: Element) => import('../../utils/extensions.js').PasteBlock[], parseBlock: (el: Element) => import('../../utils/extensions.js').PasteBlock | null, parseInline: (el: Element) => import('loro-crdt').Delta<string>[] }} helpers
     * @param {{ props?: { listType?: string } }} [rule]
     * @param {Element[]} [siblings]  what `htmlSiblings` absorbed
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromHTML(el, helpers, rule, siblings = []) {
        const { parseChildren } = helpers;
        /** @param {string} listType @param {number | null} start */
        const propsOf = (listType, start) => { const n = listStart(listType, start); return n === null ? { listType } : { listType, start: n }; };
        // Word: a run of list paragraphs; Docs: leveled items. Either way the levels are rebuilt as real nested lists.
        if (el.localName === 'p') {
            const raw = wordEntries([el, ...siblings]);
            return nestEntries(raw.flatMap((e) => {
                const delta = helpers.parseInline(e.el);
                return delta.some((op) => typeof op.insert === 'string' && /\S/.test(op.insert))
                    ? [{ ...e, item: /** @type {import('../../utils/extensions.js').PasteBlock} */ ({ type: 'list-item', delta, partial: false }) }] : [];
            }), propsOf);
        }
        if (siblings.length || hasLeveledItems(el)) {
            const raw = [el, ...siblings].flatMap((list) => docsEntries(list));
            return nestEntries(raw.flatMap((e) => {
                const item = helpers.parseBlock(e.el);
                return item ? [{ ...e, item }] : [];
            }), propsOf);
        }
        const children = parseChildren(el);
        if (!children.length) return null;
        // Determine listType: prefer rule, but promote to 'todo' if any child has checked prop
        let listType = rule?.props?.listType ?? 'bullet';
        if (listType !== 'todo' && children.some(c => c.props?.checked !== undefined)) {
            listType = 'todo';
        }
        const start = listStart(listType, el.getAttribute?.('start'));
        return { type: 'list', props: start === null ? { listType } : { listType, start }, children, partial: false };
    }

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(parentId || undefined, index ?? undefined);
        node.data.set("type", "list");
        node.data.set("listType", props.listType || "bullet");
        const start = listStart(props.listType, /** @type {any} */ (props).start);
        if (start !== null) /** @type {any} */ (node.data).set("start", start);
        const block = new List(nabu, node);
        return block;
    }
}